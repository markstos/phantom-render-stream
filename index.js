var fs = require('fs');
var cp = require('child_process');
var stream = require('stream');
var thunky = require('thunky');
var os = require('os');
var path = require('path');
var afterAll = require('after-all');
var xtend = require('xtend');
var once = require('once');
var http = require('http');
var phantomjsPath = require('phantomjs').path;

/**
 * spawn pops a request off the request queue and sends it to a member of the phantom process pool
 * The 'opts' to spawn may be just the current pool member number: {pool:1}
 * Other possible options include:
 *
 *  fifoDir     (defaults to os.TmpDir)
 *  maxRetries  (defaults to 2)
 *  timeout     (defaults to 5 seconds)
 *  debug       (defaults to false)
 *
 */

var spawn = function(opts) {
	opts = opts || {};
	var child;

  // Each queued request is represented by an object with the following keys:
  //    callback -- a function to call with when done
  //    message  -- JSON structure used to form the request to Phantom JS
  //    date     -- current date, just for reference.
  // Each member of the phantom request pool has its own request queue.
	var requestQueue = [];

	var fifoFile = 'phantom-queue-' + process.pid + '-' + Math.random().toString(36).slice(2);
	if (opts.fifoDir) fifoFile = path.join(opts.fifoDir, fifoFile);
	else fifoFile = path.join(os.tmpDir(), fifoFile);

	var looping = false;
	var loop = function() {
		if (looping) return;
		looping = true;

		var retries = 0;
		var timeoutFn = function() {
			if (++retries >= (opts.maxRetries || 2)) {
				cb(new Error('Too many retries'));
				looping = false;
				if (requestQueue.length) loop();
			} else {
				timeout = setTimeout(timeoutFn, 5000);
				timeout.unref();
			}
			if (child) child.kill();
			
		};
		var timeout; 
		if (opts.timeout) {
			timeout = setTimeout(timeoutFn, opts.timeout);
			timeout.unref();
		}


		var result = fs.createReadStream(fifoFile);
		var cb = once(function(err, val) {
			clearTimeout(timeout);
			requestQueue.shift().callback(err, val);
		});

		result.once('readable', function() {
			var first = result.read(2) || result.read(1);
      // Receiving exactly a "!" back from phantom-process.js indicates failure.
			if (first && first.toString() === '!') return cb(new Error('Render failed'));

			result.unshift(first);
			cb(null, result);
		});

		result.on('error', cb);

		result.on('close', function() {
			cb(new Error('Render failed (no data)'));

			looping = false;
			if (requestQueue.length) loop();
		});
	};

  // Ensure we have a child rendering process and return it.
  // We can send our requests to it as JSON messages on its STDIN
	var ensure = function() {
		if (child) return child;
    var phantomJsArgs = [path.join(__dirname, 'phantom-process.js'), fifoFile];
		child = cp.spawn(phantomjsPath, phantomJsArgs);

		var onerror = once(function() {
			child.kill();
		});

		child.stdin.on('error', onerror);
		child.stdout.on('error', onerror);
		child.stderr.on('error', onerror);

		child.stdin.unref();
		child.stdout.unref();
		child.stderr.unref();
		child.unref();

		if (opts.debug) {
			child.stdout.pipe(process.stdout);
		} else {
			child.stdout.resume();
		}

    // Always make the child's stderr available for better diagnostics.
    child.stderr.pipe(process.stderr);

    child.on('error', function(error) {
      throw new Error("Failed to spawn Phantom. Error was: '"+error+"'. System call was: "+phantomjsPath+' '+phantomJsArgs.join(' '));
    });

		child.on('exit', function() {
			child = null;
			if (!requestQueue.length) return;
			requestQueue.forEach(function(el) {
				ensure().stdin.write(el.message);
			});
		});
		return child;
	};

	var fifo = thunky(function(cb) {
		cp.spawn('mkfifo', [fifoFile], { stdio: 'inherit' }).on('exit', cb).on('error', cb);
	});

	var free = function() {
		ret.using--;
	};

  // The return value of this pool member.
	var ret = function(renderOpts, cb) {
		ret.using++;

    // When done, reduce the number of of active pool members by one.
		var done = function(err, stream) {
			if (stream) stream.on('end', free);
			else free();
			cb(err, stream);
			if (opts.debug) console.log('queue size: ', requestQueue.length);
		};

    // Create the fifo if it's not been created, and write our request to it.
    // Push a copy of the the request and a "done()" callback on to requestQueue to keep track of it.
		fifo(function(err) {
			if (err) return done(typeof err === 'number' ? new Error('mkfifo '+fifoFile+' exited with '+err) : err);
			var msg = JSON.stringify(renderOpts)+'\n';
			requestQueue.push({callback: done, message: msg, date: Date.now()});
			ensure().stdin.write(msg);
			if (requestQueue.length === 1) loop();
			if (opts.debug) console.log('queue size: ', requestQueue.length);
		});
	};

	ret.using = 0;
	ret.destroy = function(cb) {
		if (child) child.kill();
		fs.unlink(fifoFile, function() {
			if (cb) cb();
		});
	};

	return ret;
};

module.exports = function(defaultOpts) {
	var opts = defaultOpts || {};
	opts.pool = opts.pool || 1;

  // Create a pool of Phantom processes size  the number provided in opts.pool
	var phantomPool = [];
	for (var i = 0; i < opts.pool; i++) {
		phantomPool.push(spawn(opts));
	}

  // Find the phantom pool member with the shortest queue and send our request to it.
	var select = function() {
		return phantomPool.reduce(function(a, b) {
			return a.using <= b.using ? a : b;
		});
	};

  // Move the 'url' to the options and pass it to a pool member to render.
	var render = function(url, renderOpts) {
		renderOpts = xtend(opts, renderOpts);
		renderOpts.url = url;
		var pt = stream.PassThrough();
		select()(renderOpts, function(err, stream) {
			if (err) return pt.emit('error', err);
			if (destroyed) return stream.destroy();
			stream.pipe(pt);
			pt.destroy = once(function() {
				stream.destroy();
				pt.emit('close');
			});
		});

		var destroyed = false;
		pt.destroy = once(function() {
			destroyed = true;
			pt.emit('close');
		});

		return pt;
	};

	render.destroy = function(cb) {
		var next = afterAll(cb);
		phantomPool.forEach(function(ps) {
			ps.destroy(next());
		});
	};

	return render;
};
