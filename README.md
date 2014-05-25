# phantom-render-stream

Render a webpage and get the image as a stream.

	npm install phantom-render-stream

[![Build Status](https://travis-ci.org/e-conomic/phantom-render-stream.png)](https://travis-ci.org/e-conomic/phantom-render-stream)

It uses a pool of phantom processes so it doesn't need to spawn a new process for each website.
New requests are added to the pool member with the shortest queue length.

## Synopsis

This module depends on the [phantomjs](https://www.npmjs.org/package/phantomjs) module, which will install
`phantomjs` for you if you don't already have it.

``` js
var phantom = require('phantom-render-stream');
var fs = require('fs');

var render = phantom();
render('http://example.com/my-site').pipe(fs.createWriteStream('out.png'));
```

You can also pass some options

``` js
var render = phantom({
	pool: 5, // change the pool size. defaults to 1,
	format: 'jpeg', // the default output format
	width: 1280, // changes the width size. default to 1280
	height: 800 // changes the height size. default to 960
  phantomFlags: [], // extra command flags to pass to Phantom
});
```

Or override the options for each render stream

``` js
render(myUrl, {format:'jpeg', width: 1280, height: 960}).pipe(...)
```

As an exception, you can't override the `phantomFlags` for each stream, as
`phantomjs` as an existing phantom process may be re-used.

## Supported output formats

We support the output formats that [Phantom's render method](http://phantomjs.org/api/webpage/method/render.html)
supports. At the time of this writing these are:

 * png
 * gif
 * jpg
 * pdf

## Example

Since the interface is just a stream you can pipe the web site anywhere!
Try installing [picture-tube](https://github.com/substack/picture-tube) and run the following example

``` js
var phantom = require('phantom-render-stream');
var pictureTube = require('picture-tube');
var render = phantom();

render('http://google.com')
	.pipe(pictureTube())
	.pipe(process.stdout);
```

## Deferred render

If you need your page to do something before phantom renders it you just need to immediately set
`window.renderable` to false. If that is set when the page is opened the module will wait for 
`window.renderable` to be set to true and when this happens the render will occur.

Here is an example to illustrate it better.

```html

<!DOCTYPE HTML>
<html lang="en">
<head>
	...
	<script type="text/javascript">window.renderable = false</script>
	<meta charset="UTF-8">
	<title></title>
</head>
<body>
	
</body>
...
<script type="text/javascript">
  doSomeAjaxLoading(function() {
    doSomeRendering();
	window.renderable = true;
  })
</script>
</html>

```

## Troubleshooting

You can pass `debug:true` as an option to turn on additional diagnostics including:

 * piping STDOUT from the phantom processes to STDOUT of this parent process
 * Printing out the queue size of periodically.

If you are getting undefined error codes and responses when attempting to
render, it's likely a connection issue of some sort. If the URL uses SSL, adding
`--ignore-ssl-errors=true` to phantomFlags may help. You also try adding `--debug=true` to
the `phantomFlags` array.

For extensive detail on what Phantom is doing, there is also some commented out code
in phantom-process.js that can be enabled by commenting it in for now.

## OS Dependencies

We use `mkfifo` which is known to exist and work on OS X and Linux, but may not work other plaforms,
particularly Windows, which has different notions about named pipes.

## License

[MIT](http://opensource.org/licenses/MIT)
