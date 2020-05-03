var express = require('express');
var http = require('http');
var url = require('url');
var fs = require('fs');
var jsontemplate = require("./json-template").jsontemplate;
var iconv = require('iconv-lite');
//var rcdesign = require("./rcdesign").rcdesign;
var dateformat = require("dateformat");

var app = express();
var server = http.createServer(app);

var HEADER_FILENAME = "header.html";
var FOOTER_FILENAME = "footer.html";

var txtHeader = fs.readFileSync(HEADER_FILENAME, "utf8")
var tplFooter = jsontemplate.Template(fs.readFileSync(FOOTER_FILENAME, "utf8"));

var outFolder = "./out/";

var DEBUG = false;
var TRACE = false;
var INFO  = true;
var FILE  = false;
var CHUNK = false;

var port = process.env.PORT || 8080;

app.get('/ping', function(req, res) {
//  res.writeHead(200, {'Content-Type': 'text/html'});
  res.header("Content-Type", "text/html");
  res.charset = "utf8";
  res.end("<H1>Currently is "+(new Date())+"</H1>\n\n");
});

function logDate(s) {
  console.log(dateformat(new Date(), "yyyy-mm-dd HH:MM:ss.l")+" | "+s);
}

app.get('/prn', function(req, res) {
	if (INFO) logDate('Query received\n', req.query);

	var startURL = req.query.url;
	if (INFO) logDate('url=', startURL);

	if (startURL == undefined) {
		res.send("Parameter url not found.");
		return;
	}

	var parsedUrl = url.parse (startURL);
	if (parsedUrl.hostname != "forum.rcdesign.ru") {
		res.send("Unknown host: "+parsedUrl.hostname);
		return;
	}

	res.header("Content-Type", "text/html");
	res.charset = "utf8";
	res.write(txtHeader);

	var isBlog = startURL.indexOf("/blogs") >= 0;
	var pagesCount = 0;

	getURL(startURL, processURL);

	function processURL(pageURL, html, e) {
		if (e || html == null) {
    			logDate("ERROR: Error getting <B>"+pageURL+"</B><BR>"+e);
			res.end(String(e));
			return;
		}

		if (FILE) {
			var fileName = makeFileName(pageURL, [".htm", ".html"]);
    			logDate("FILE: "+fileName);
			fs.writeFileSync(fileName, String(html), 'utf8');
		}

		pagesCount++;
    		if (INFO) logDate("processURL, Processing "+pagesCount+" page ("+html.length+" bytes): "+pageURL); 
	
		var text;
		try {
			if (isBlog) {
				processBlog(pageURL, html, completeEntry, completePage);
			} else {
				processForumThread(pageURL, html, pagesCount == 1, completeEntry, completePage);
			}
		} catch (e) {
    			logDate("Parsing error at <B>"+pageURL+"</B><BR>"+e);
			res.end(String(e));
			return;
		}

		function completeEntry(text) {
			if (text == null)
				return;

			res.write (text);
		}

		function completePage(pageURL, html, e) {
			if (e || html == null) {
    				logDate("ERROR: Parsing error at <B>"+pageURL+"</B><BR>"); 
				res.end("Parsing error");
				return;
			}

			var pageStat = processPages(html);
				if (pageStat != null && 
				pageStat.nextURL != pageURL) { // Prevent infinite loop.
				getURL (pageStat.nextURL, processURL);
				return;
			} else {
    				if (INFO) logDate("processURL, completePage: "+pagesCount+" pages read"); 
    				res.end(tplFooter.expand({pagesCount: pagesCount}));
				return;
			}
		}
	}

});

//----------------------------------------------------------------------------------------------

// returns Html or null;
function getURL(pageURL, callback) {
       if (INFO) logDate('getURL: ' + pageURL);
       http.get(pageURL, function(resOther) {
       	if (DEBUG) logDate('STATUS: ' + resOther.statusCode);
       	if (DEBUG) logDate('HEADERS: ' + JSON.stringify(resOther.headers));
       	var data = [];
       	var i = 0;
       	var totallength = 0;
       	resOther.on("data", function(chunk) {
       		i++;

       		if (CHUNK) {
       			var fileName = makeFileName(pageURL, [".htm", ".html"])+"_"+i;
   				logDate("CHUNK: "+fileName);
       			fs.writeFileSync(fileName, String(chunk), 'utf8');
       		}
       		data.push(chunk);
       		totallength += chunk.length;
 		});	
       	resOther.on("end", function() {
       		var results = new Buffer(totallength);
       		if (DEBUG) logDate("Received "+data.length+" chunks of total "+totallength+" bytes");
       		var pos = 0;
       		for (var i = 0; i < data.length; i++) {
       			data[i].copy(results, pos);
       			pos += data[i].length;
       		}
       		var html = iconv.decode(results, 'utf8');
       		callback(pageURL, html, null);
       		if (DEBUG) logDate("end");
 		});	
       }).on('error', function(e) {
       	logDate('ERROR: ' + e.message);
       	callback(pageURL, null, e);
       });
}

//----------------------------------------------------------------------------------------------

function processPages(html) {
	var startPaginator = findStrAfter(html, 'id="pagination_bottom"');
	if (startPaginator < 0) return null;

	// Страница
	var startPage = findStrAfter(html, 'Страница ', startPaginator); 
	if (startPage < 0) return null;

	var endPage = findStrAfter(html, ' из ', startPage); 
	if (endPage < 0) return null;

        var pageRangeStart = parseInt(trim(subStr(html, startPage, endPage)));

	var endPage2 = findStr(html, '<', endPage); 
	if (endPage2 < 0) return null;

        var pageRangeEnd = parseInt(trim(subStr(html, endPage, endPage2)));

        if (DEBUG ) logDate ("Pages="+pageRangeStart+".."+pageRangeEnd);

	// Показано с
	var startPage = findStrAfter(html, 'Показано с ', startPaginator); 
	if (startPage < 0) return null;

	var endPage = findStrAfter(html, ' из ', startPage); 
	if (endPage < 0) return null;

	var endPage2 = findStr(html, '"', endPage); 
	if (endPage2 < 0) return null;

        var recordsNum = parseInt(trim(subStr(html, endPage, endPage2)));

        if (DEBUG) logDate ("recordsNum="+recordsNum);
	
	// name="LinkNext" 
	var startNextPage = findStrAfter(html, 'name="LinkNext"', startPaginator);
	if (startNextPage < 0) return null;
	
        var startHref = findStrAfter(html, 'href="', startNextPage);	
        if (startHref < 0) return null;

        var endHref = findStr(html, '"', startHref);
        if (endHref < 0) return null;

        var nextPageURL = purifyStr(subStr(html, startHref, endHref));
        if (DEBUG) logDate ("nextPageURL="+nextPageURL); 	

	return {nextURL: nextPageURL, recordsNum: recordsNum, pageRangeStart: pageRangeStart, pageRangeEnd: pageRangeEnd};
}

//----------------------------------------------------------------------------------------------

function processBlog(startURL, html, completeEntryCallBack, completePageCallBack) {
	var start = 0;
	var entries = [];
	while (true) {
        	var startClass = findStrAfter(html, 'class="blogtitle"', start);
        	if (startClass < 0) break;

        	startHref = findStrAfter(html, 'href="', -startClass);	
        	if (startHref < 0) break;

        	var endHref = findStr(html, '"', startHref);
        	if (endHref < 0) break;

        	var entryURL = purifyStr(subStr(html, startHref, endHref));
        	if (DEBUG) logDate ("entryURL="+entryURL);
        	
        	var endA = findStr(html, '>', endHref);
        	if (endA < 0) break;

        	var endTitle = findStr(html, '</a>', endA);
        	if (endTitle < 0) break;

        	var entryTitle = purifyStr(subStr(html, endA+1, endTitle));
        	if (DEBUG) logDate ("entryTitle="+entryTitle);

		entries.push({entryURL: entryURL, entryTitle: entryTitle});

		start = endTitle;
	}

        if (DEBUG) logDate ("entries.length="+entries.length);

	iterate();

	function iterate() {
		if (entries.length == 0) {
        		if (DEBUG) logDate ("processBlog, no more entries.");
			completePageCallBack(startURL, html, null);
			return;
		}

		var entry = entries.shift(); // pop from start of the queue;
                getURL(entry.entryURL, handleBlogEntry);

		function handleBlogEntry(pageURL, htmlEntry, e) {	
			if (e || htmlEntry == null) {
				completePageCallBack(startURL, htmlEntry, e);
				return;
			}

			if (FILE) {
				var fileName = makeFileName(pageURL, [".htm", ".html"]);
    				logDate("FILE: "+fileName);
				fs.writeFileSync(fileName, String(htmlEntry), 'utf8');
			}

			var acc = [];
        		if (DEBUG) logDate ("processBlog, processBlogEntry, pageURL="+pageURL);

			processBlogEntry(acc, htmlEntry, e);

			completeEntryCallBack(acc.join(''));

			iterate();
		}
		
	}; 

}

function processBlogEntry(acc, html, e) {
	var startTitle = findStrAfter(html, 'id="blog_title"');
        var startTitle = findStrAfter(html, '>', startTitle);
        if (startTitle < 0) return null;

	var endTitle = findStr(html, '<', startTitle);
        if (endTitle < 0) return null;

        var title = trim(subStr(html, startTitle, endTitle));
        if (DEBUG) logDate ("title="+title);

        var startClass = findStrAfter(html, '<div class="blog_date">');
        if (startClass < 0) return null;
        
       	var startHref = findStrAfter(html, 'href="', startClass);	
       	if (startHref < 0) return null;

       	var endHref = findStr(html, '"', startHref);
       	if (endHref < 0) return null;

       	var memberURL = purifyStr(subStr(html, startHref, endHref));
       	if (DEBUG) logDate ("memberURL="+memberURL);

       	var startName = findStrAfter(html, '<strong>', startClass);
       	if (startName < 0) return null;

       	var endName = findStr(html, '</strong>', startName);
       	if (endName < 0) return null;

       	var userName = purifyStr(removeHTML(subStr(html, startName, endName)));
       	if (DEBUG) logDate ("userName="+userName);

        var startDate = findStrAfter(html, '</div>', endName);
        if (startDate < 0) return null;

	var endDate = findStr(html, ' в ', startDate);
        if (endDate < 0) return null;

        var date = trim(subStr(html, startDate, endDate));
        if (DEBUG) logDate ("date="+date);

        var startTime = endDate+' в '.length;

	var endTime = findStr(html, '(', startTime);
        if (endTime < 0) return null;

        var time = trim(subStr(html, startTime, endTime));
        if (DEBUG) logDate ("time="+time);

        var startText = findStrAfter(html, '<blockquote', endDate);
        if (startText < 0) return null;

        var startText = findStrAfter(html, '>', startText);
        if (startText < 0) return null;
        
	var endText = findStr(html, '</blockquote>', startText);
        if (endText < 0) return null;
	
        var text = trim(removeHTMLComment(subStr(html, startText, endText)));

	text = replaceIFrames(text);

        if (TRACE) logDate ("text="+text);

	renderBlogPage(acc, {title: title, userName: userName, memberURL: memberURL, 
		entryDate: date, entryTime: time, text: text});
}

function renderBlogPage(acc, data) {
	acc.push("\n<div class='PostHeader'>");
	acc.push("<A class='PostMember' href='"+encodeHTML(data.memberURL)+"'>");
	acc.push(encodeHTML(data.userName));
	acc.push("</A>");
	acc.push("<span class='PostTimeStamp'>"+encodeHTML(data.entryDate)+" "+encodeHTML(data.entryTime)+"</span>");
	acc.push("</div>");

	acc.push("\n<div class='PostContent'>");
	acc.push(data.text);
	acc.push("\n</div>");
}

//----------------------------------------------------------------------------------------------

function processForumFirstPage(acc, startURL, html) {
	var start = 0;

        var startClass = findStrAfter(html, 'class="pagetitle"', start);
//        var startClass = findStrAfter(html, 'class="threadtitle"', start);
        if (startClass < 0) return null;

//        var startHref = findStrAfter(html, 'href="', startClass);	
//        if (startHref < 0) return null;

//        var endHref = findStr(html, '"', startHref);
//        if (endHref < 0) return null;

//        var threadURL = purifyStr(subStr(html, startHref, endHref));
//        if (DEBUG) logDate ("threadURL="+threadURL);
        	
//        var endA = findStrAfter(html, '>', endHref);
	var endA = findStrAfter(html, 'class="relevant_replacement">', startClass);
        if (endA < 0) return null;

//        var endThreadName = findStr(html, '</a>', endA);
        var endThreadName = findStr(html, '<', endA);
        if (endThreadName < 0)
        	return null;

        var threadName = purifyStr(subStr(html, endA, endThreadName));
        if (DEBUG) logDate ("threadName="+threadName);

	renderForumPage (acc, {threadURL: startURL, threadName: threadName});
}

function processForumThread(startURL, html, first, completeEntryCallBack, completePageCallBack) {
	var start = 0;

	while (true) {
		var acc = [];

		if (first) {
        		if (DEBUG) logDate ("1st page");		
			processForumFirstPage(acc, startURL, html);
			first = false;
		}

        	var startClass = findStrAfter(html, 'class="postdate old">', start);
        	if (startClass < 0) break;

        	var startDate = findStrAfter(html, '<span class="date">', startClass);
        	if (startDate < 0) break;

        	var endDate = findStr(html, '<span class="time">', startDate);
        	if (endDate < 0) break;

        	var entryDate = purifyStr(subStr(html, startDate, endDate));
        	if (DEBUG) logDate ("entryDate="+entryDate);

        	var startTime = findStrAfter(html, '<span class="time">', startDate);
        	if (startTime < 0) break;

        	var endTime = findStr(html, '</span>', startTime);
        	if (endTime < 0) break;

        	var entryTime = purifyStr(subStr(html, startTime, endTime));
        	if (DEBUG) logDate ("entryTime="+entryTime);

        	var startClass = findStrAfter(html, 'class="postcounter">', start);
        	if (startClass < 0) break;

        	var startHref = findStrAfter(html, 'href="', -startClass);	
        	if (startHref < 0) break;

        	var endHref = findStr(html, '"', startHref);
        	if (endHref < 0) break;

        	var entryURL = purifyStr(subStr(html, startHref, endHref));
        	if (DEBUG) logDate ("entryURL="+entryURL);
        	
        	var endA = findStr(html, '>', endHref);
        	if (endA < 0) break;

        	var endPostCount = findStr(html, '</a>', endA);
        	if (endPostCount < 0) break;

        	var postCount = purifyStr(subStr(html, endA+1, endPostCount));
        	if (DEBUG) logDate ("postCount="+postCount);

        	var startClass = findStrAfter(html, 'class="username_container"', start);
        	if (startClass < 0) break;

        	var startHref = findStrAfter(html, 'href="', startClass);	
        	if (startHref < 0) break;

        	var endHref = findStr(html, '"', startHref);
        	if (endHref < 0) break;

        	var memberURL = purifyStr(subStr(html, startHref, endHref));
        	if (DEBUG) logDate ("memberURL="+memberURL);

        	var startName = findStrAfter(html, '<strong>', startClass);
        	if (startName < 0) break;

        	var endName = findStr(html, '</strong>', startName);
        	if (endName < 0) break;

        	var userName = purifyStr(removeHTML(subStr(html, startName, endName)));
        	if (DEBUG) logDate ("userName="+userName);

                var startText = findStrAfter(html, '<blockquote', start);
                if (startText < 0) break;

                var startText = findStrAfter(html, '>', startText);
                if (startText < 0) break;
                
        	var endText = findStr(html, '</blockquote>', startText);
                if (endText < 0) break;
        	
                var text = trim(removeHTMLComment(subStr(html, startText, endText)));
		text = replaceIFrames(text);
        	if (TRACE) logDate ("text="+text);

		renderForumPost(acc, {entryDate: entryDate, entryTime: entryTime, entryURL: entryURL, postCount: postCount, 
			memberURL: memberURL, userName: userName, text: text});

		completeEntryCallBack(acc.join(''));

		start = endText;
	}

	completePageCallBack(startURL, html, null);
}

function renderForumPage(acc, data) {
	acc.push("\n<div class='ThreadHeader'>");
	acc.push("<A href='"+encodeHTML(data.threadURL)+"'>");
	acc.push(encodeHTML(data.threadName));
	acc.push("</A></div>");
}

function renderForumPost(acc, data) {
	acc.push("\n<div class='PostHeader'>");
	acc.push("<A class='PostCount' href='"+encodeHTML(data.entryURL)+"'>");
	acc.push(encodeHTML(data.postCount));
	acc.push("</A>");
	acc.push("<A class='PostMember' href='"+encodeHTML(data.memberURL)+"'>");
	acc.push(encodeHTML(data.userName));
	acc.push("</A>");
	acc.push("<span class='PostTimeStamp'>"+encodeHTML(data.entryDate)+" "+encodeHTML(data.entryTime)+"</span>");
	acc.push("</div>");

	acc.push("\n<div class='PostContent'>");
	acc.push(data.text);
	acc.push("\n</div>");
}

//----------------------------------------------------------------------------------------------

function findStr(s, pattern, start) {
	if (typeof(start) == "undefined")
		start = 0;
	var pos = start >= 0 ? s.indexOf(pattern, start) : s.lastIndexOf(pattern, -start);
	if (TRACE) logDate("findStr at "+start+": "+pattern+" => "+pos);
	return pos;
}

function findStrAfter(s, pattern, start) {
	if (typeof(start) == "undefined")
		start = 0;
	var pos = start >= 0 ? s.indexOf(pattern, start) : s.lastIndexOf(pattern, -start);
	if (pos >= 0)
		pos += pattern.length;
	if (TRACE) logDate("findStrAfter at "+start+": "+pattern+" => "+pos);
	return pos;
}

function subStr(s, start, end) {
	var str = s.substr(start, end-start);
	if (TRACE) logDate("subStr "+start+".."+end+" => "+str);
	return str;
}

function purifyStr(s) {
	s = trim(s);
	s = s.replace( /\&amp;/g, "&" );
	s = s.replace( /\&lt;/g, "<" );
	s = s.replace( /\&gt;/g, ">" );
	s = s.replace( /\&quot;/g, "\"" );
	s = s.replace( /\&apos;/g, "'" );
	s = s.replace( /\&nbsp;/g, " " );
	s = trim(s);
	return s;
}

function encodeHTML(s) {
	s = s.replace( /\&/g, "&amp;" );
	s = s.replace( /</g, "&lt;" );
	s = s.replace( />/g, "&gt;" );
	s = s.replace( /"/g, "&quot;" );
	s = s.replace( /'/g, "&apos;" );
	return s;
}

function removeHTML(s) {
   s = s.replace(/<(.*?)>/g,"");
   return s;
}

function removeHTMLComment(s) {
   s = s.replace(/<!--(.*?)-->/g,"");
   return s;
}

function trim(s) {
   return s.replace(/^\s+|\s+$/g,"");
}

function replaceIFrames(text) {
	return text.replace(/(.*?)<iframe.*?src="(.*?)".*?<\/iframe>(.*?)/g, 
		"$1<div class='YouTube'><A href='http:$2'>Video: http:$2</A></div>$3")
}

function endsWith (s, str) {
    var i = s.lastIndexOf(str);
    return (i >= 0) && (i + str.length == s.length);
}

function makeFileName(url, ext) {
	if (TRACE) logDate ("makeFileName: "+url);

	url = url.replace( /http:\/\//g, "" );
	url = url.replace( /\//g, "_" );

	if (endsWith(url, "_"))
		url = url.substr(0, url.length-1);

	if (ext != null) {
		var extFound = false;
		for (extStr in ext) {
			if (TRACE) logDate ("makeFileName, extStr="+ext[extStr]);
			if (endsWith(url, ext[extStr])) {
				extFound = true;
				break;
			}
		}
		if (!extFound)
			url += ext[0];
	}

	if (outFolder != null)
		url = outFolder+url;

	if (DEBUG) logDate ("makeFileName fileName="+url);
	return url;
}

//----------------------------------------------------------------------------------------------

logDate("App started; port: "+port);

server.listen(port);
