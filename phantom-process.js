// Code to be run by PhantomJS.
// The docs for these modules are here: http://phantomjs.org/api/
// Note that the 'fs' module here has a different API than the one in node.js core.
var webpage = require('webpage');
var system = require('system');
var fs = require('fs');
 
var page = webpage.create();
 
var fifoFile = system.args[1];

var forcePrintMedia = function() {
	page.evaluate(function() {
		var findPrintMedia = function() {
			var styles = [];

			Array.prototype.slice.call(document.querySelectorAll('style')).forEach(function(el) {
				styles.push(el.innerText);
			});
			Array.prototype.slice.call(document.querySelectorAll('link')).forEach(function(el) {
				if (el.rel && el.rel.indexOf('stylesheet') === -1) return;

				try {
					// try-catch is just precaution (we already set web-security to no)

					var xhr = new XMLHttpRequest();

					// 99.99% of the cases we just hit the cache so no real io
					xhr.open('GET', el.href, false);
					xhr.send(null);

					styles.push(xhr.responseText);
				} catch (err) {
					// do nothing
				}
			});

			var style = styles.join('\n');

			return style.split('@media print').slice(1).filter(function(text) {
				return text.indexOf('attr(href)') === -1;
			}).map(function(text) {
				var lvl = 0;

				var from = text.indexOf('{');

				for (var i = from; i < text.length; i++) {
					if (text[i] === '{') lvl++;
					if (text[i] === '}') lvl--;
					if (lvl === 0) break;
				}

				return text.substring(from+1, i-1);
			}).join('\n');
		};

		var div = document.createElement('div');

		div.innerHTML = '<style>\n'+findPrintMedia()+'\n</style>';
		document.body.appendChild(div);
		document.body.style.backgroundImage = 'none';
		document.body.style.backgroundColor = 'white';
	});
};

// Requests we make to PhantomJS are received and process here.
// Each requests as a single line of stringified JSON standard in.
// It unpacks to an object corresponding to a call to render(), with 'url' added as a key.
var loop = function() {
	var line = system.stdin.readLine();

  // If there's no more data, clean-up the FIFO file and close down phantom.
	if (!line.trim()) {
		fs.remove(fifoFile);
		return phantom.exit(0);
	}

  // If we can't parse the data returned,  clean up the FIFO file and close down phantom
  // This "shouldn't happen" because we are supplying and stringify the JSON ourselves.
	try {
		line = JSON.parse(line);
	} catch (err) {
		fs.remove(fifoFile);
		return process.exit(0);
	}

	if (!page) page = webpage.create();

	page.viewportSize = {
		width: line.width || 1280,
		height: line.height || 960
	};

	page.paperSize = {
		format: line.paperFormat || 'A4',
		orientation: line.orientation || 'portrait',
		margin: line.margin || '0cm'
	};

	if (line.userAgent) page.settings.userAgent = line.userAgent;
	if (line.crop) page.clipRect = page.viewportSize;

  page.onResourceError = function(resourceError) {
    page.resourceError = resourceError;
  };

    // Need detailed debugging? Uncomment this.
    // page.onResourceRequested = function (request) {
    //     system.stderr.writeLine('= onResourceRequested()');
    //     system.stderr.writeLine('  request: ' + JSON.stringify(request, undefined, 4));
    // };
    //  
    // page.onResourceReceived = function(response) {
    //     system.stderr.writeLine('= onResourceReceived()' );
    //     system.stderr.writeLine('  id: ' + response.id + ', stage: "' + response.stage + '", response: ' + JSON.stringify(response));
    // };
    //  
    // page.onLoadStarted = function() {
    //     system.stderr.writeLine('= onLoadStarted()');
    //     var currentUrl = page.evaluate(function() {
    //         return window.location.href;
    //     });
    //     system.stderr.writeLine('  leaving url: ' + currentUrl);
    // };
    //  
    // page.onLoadFinished = function(status) {
    //     system.stderr.writeLine('= onLoadFinished()');
    //     system.stderr.writeLine('  status: ' + status);
    // };
    //  
    // page.onNavigationRequested = function(url, type, willNavigate, main) {
    //     system.stderr.writeLine('= onNavigationRequested');
    //     system.stderr.writeLine('  destination_url: ' + url);
    //     system.stderr.writeLine('  type (cause): ' + type);
    //     system.stderr.writeLine('  will navigate: ' + willNavigate);
    //     system.stderr.writeLine('  from page\'s main frame: ' + main);
    // };
    //  
    // page.onResourceError = function(resourceError) {
    //     system.stderr.writeLine('= onResourceError()');
    //     system.stderr.writeLine('  - unable to load url: "' + resourceError.url + '"');
    //     system.stderr.writeLine('  - error code: ' + resourceError.errorCode + ', description: ' + resourceError.errorString );
    // };
    //  
    // page.onError = function(msg, trace) {
    //     system.stderr.writeLine('= onError()');
    //     var msgStack = ['  ERROR: ' + msg];
    //     if (trace) {
    //         msgStack.push('  TRACE:');
    //         trace.forEach(function(t) {
    //             msgStack.push('    -> ' + t.file + ': ' + t.line + (t.function ? ' (in function "' + t.function + '")' : ''));
    //         });
    //     }
    //     system.stderr.writeLine(msgStack.join('\n'));
    // };

    page.open(line.url, function(requestStatus) {
    // If there's a failure, communicate that through the FIFO by writing just the "!" character.
    // Also, log to Phantom's stderr, which will get piped into the parent's Stderr
    // Note that some connection failures will result an undefined 'resourceError'
		if (requestStatus !== 'success') {
      system.stderr.write(
        "Phantom Error opening url \"" + line.url
        + "\" Error Code: " + page.resourceError.errorCode + ", Error String: " + page.resourceError.errorString);

			fs.write(fifoFile,"!", 'w');
			page = null;
			loop();
			return;
		}

		var render = function() {
			setTimeout(function() {
				if (line.printMedia) forcePrintMedia();
				page.render(fifoFile, {format:line.format || 'png'});
				page = null;
				loop();
			}, 0);
		};

		var waitAndRender = function() {
			var timeout = setTimeout(function() {
				page.onAlert('webpage-renderable');
			}, 10000);

			var rendered = false;
			page.onAlert = function(msg) {
				if (rendered || msg !== 'webpage-renderable') return; 
				rendered = true;
				clearTimeout(timeout);
				render();
			};

			page.evaluate(function() {
				if (window.renderable) return alert('webpage-renderable');
				var renderable = false;
				Object.defineProperty(window, 'renderable', {
					get: function() {
						return renderable;
					},
					set: function(val) {
						renderable = val;
						alert('webpage-renderable');
					}
				});
			});
		};

		var renderable = page.evaluate(function() {
			return window.renderable;
		});
		if (renderable === false) return waitAndRender();
		render();

	});
};

loop();
