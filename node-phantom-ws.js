var http			= require('http');
var WebSocketServer = require('ws').Server;
var spawn 			= require('child_process').spawn;

function callbackOrDummy (callback) {
    if (callback === undefined) callback = function () {};
    return callback;
}

function unwrapArray (arr) {
    return arr && arr.length == 1 ? arr[0] : arr
}

module.exports = {
    create: function(callback, options) {
        if (options === undefined) options = {};
        if (options.phantomPath === undefined) options.phantomPath = 'phantomjs';
        if (options.parameters === undefined) options.parameters = {};

        function spawnPhantom (port, callback) {
            var args=[];
            for(var parm in options.parameters) {
                args.push('--' + parm + '=' + options.parameters[parm]);
            }
            args = args.concat([__dirname + '/bridge.js', port]);

            var phantom = spawn(options.phantomPath, args);
            phantom.on('error', function (err) {
            	callback(err);
            });
            phantom.stdout.on('data', function (data) {
                return console.log('phantom stdout: '+data);
            });
            phantom.stderr.on('data', function (data) {
                return console.warn('phantom stderr: '+data);
            });
            var exitCode = 0;
            phantom.on ('exit', function (code) {
                exitCode = code;
            });
            setTimeout(function () {    //wait a bit to see if the spawning of phantomjs immediately fails due to bad path or similar
            	if (exitCode !== 0) {
            		return callback("Phantom immediately exited with: " + exitCode);
            	}

                callback(null, phantom);
            },100);
        };
        
        var server = http.createServer(function(request,response) {
        	response.writeHead(200, {"Content-Type": "text/html"});
            response.end('<html><head><script type="text/javascript">\n\
                window.onload = function () {\n\
                    var socket = new WebSocket("ws://" + window.location.hostname + ":" + ' + server.address().port + ');\n\
                    socket.onerror = function (err) {\n\
                    	console.log("Error connecting: " + err);\n\
                    }\n\
                    socket.onopen = function (evt) {\n\
                    	// console.log("Opened WS connection!")\n\
                    	socket.emit = function (event, data) {\n\
                    		socket.send(JSON.stringify({event: event, data: data}));\n\
                    	}\n\
                    	window.socket = socket;\n\
                	}\n\
                	socket.onmessage = function (evt) {\n\
                		// console.log("Got message: " + evt.data);\n\
                		var event = JSON.parse(evt.data);\n\
                		window.callPhantom(event);\n\
                	}\n\
                }\n\
            	</script></head><body></body></html>');
        }).listen(function () {
        	var wss = new WebSocketServer({server: server});
            // server.on('request', function (req, res) {
            //     res.setHeader('Access-Control-Allow-Origin', '*');
            // });
        	// console.log("Created wss");
        	wss.on('error', function (err) {
        		console.error("Wss error: " + err);
        	})
        	var port = server.address().port;
	        var phantom = spawnPhantom(port, function (err,phantom) {
	            if (err) {
	                try {
	                    server.close();
	                } catch (e) {
	                    console.log('Error closing server:', e);
	                }
	                return callback(err);
	            }

	            phantom.removeAllListeners('error'); // Let callers handle this
	            
	            var pages = {};
	            var cmds  = {};
	            var cmdid = 0;
	            
	            wss.on('connection', function(ws) {
	            	// console.log("Got websocket connection");

        	        function request (args, callback) {
        	            args.splice(1,0,cmdid);
        	            ws.send(JSON.stringify(args), function (err) {
                            if (err) {
                                return callback(err);
                            }
                        });
                        cmds[cmdid] = {cb:callback};
                        cmdid++;
        	        }
        	        
	            	ws.on('message', function (data, flags) {
	            		var event = JSON.parse(data);
	            		var response = event.data;
						if (event.event === 'res') {
		                    var id    = response[0];
		                    var cmdId = response[1];
                            if (cmdId) {
                                if (!cmds[cmdId]) {
                                    return console.log("Command id " + cmdId + " either already executed or doesn't exist");
                                }
                            }
		                    switch (response[2]) {
		                    case 'pageCreated':
		                        var pageProxy = {
		                            open: function(url, callback) {
		                                if (callback === undefined) {
		                                    request([id, 'pageOpen', url], callbackOrDummy(null));
		                                } else {
		                                    request([id, 'pageOpenWithCallback', url], callback);
		                                }
		                            },
		                            close:function(callback){
		                                request([id, 'pageClose'], callbackOrDummy(callback));
		                            },
		                            render:function(filename, callback){
		                                request([id, 'pageRender', filename], callbackOrDummy(callback));
		                            },
		                            renderBase64:function(extension, callback){
		                                request([id, 'pageRenderBase64', extension], callbackOrDummy(callback));
		                            },
		                            injectJs:function(url, callback){
		                                request([id, 'pageInjectJs', url], callbackOrDummy(callback));
		                            },
		                            includeJs:function(url, callback){
		                                request([id, 'pageIncludeJs', url], callbackOrDummy(callback));
		                            },
		                            sendEvent:function(event, x, y, callback){
		                                request([id,'pageSendEvent',event,x,y],callbackOrDummy(callback));
		                            },
		                            uploadFile:function(selector, filename, callback){
		                                request([id, 'pageUploadFile',selector, filename],callbackOrDummy(callback));
		                            },
		                            evaluate:function(evaluator, callback){
		                                request([id, 'pageEvaluate', evaluator.toString()].concat(Array.prototype.slice.call(arguments, 2)),callbackOrDummy(callback));
		                            },
		                            set:function(name, value, callback){
		                                request([id, 'pageSet', name, value], callbackOrDummy(callback));
		                            },
		                            get:function(name, callback){
		                                request([id, 'pageGet', name], callbackOrDummy(callback));
		                            },
		                            setFn: function(pageCallbackName, fn, callback) {
		                                request([id, 'pageSetFn', pageCallbackName, fn.toString()], callbackOrDummy(callback));
		                            },
		                            switchToFrame: function(name, callback) {
		                            	request([id, 'pageSwitchToFrame', name], callbackOrDummy(callback));
		                            },
		                            switchToMainFrame: function(callback) {
		                            	request([id, 'pageSwitchToMainFrame'], callbackOrDummy(callback));
		                            },
		                        };
		                        pages[id] = pageProxy;
		                        cmds[cmdId].cb(null,pageProxy);
		                        delete cmds[cmdId];
		                        break;
		                    case 'phantomExited':
		                        request([0,'exitAck'], callbackOrDummy(null));
		                        try {
		                            server.close();
		                        } catch (e) {
		                            console.log('Error closing server:', e);
		                        }
		                        io.set('client store expiration', 0);
		                        cmds[cmdId].cb();
		                        delete cmds[cmdId];
		                        break;
		                    case 'pageJsInjected':
		                    case 'jsInjected':
		                        cmds[cmdId].cb(JSON.parse(response[3]) === true ? null : true);
		                        delete cmds[cmdId];
		                        break;
		                    case 'pageOpened':
		                        if(cmds[cmdId] !== undefined){    //if page is redirected, the pageopen event is called again - we do not want that currently.
		                            if(cmds[cmdId].cb !== undefined){
		                                cmds[cmdId].cb(null, response[3]);
		                            }
		                            delete cmds[cmdId];
		                        }
		                        break;
		                    case 'pageRenderBase64Done':
		                        cmds[cmdId].cb(null, response[3]);
		                        delete cmds[cmdId];
		                        break;
		                    case 'pageGetDone':
		                    case 'pageEvaluated':
		                        cmds[cmdId].cb(null, JSON.parse(response[3]));
		                        delete cmds[cmdId];
		                        break;
		                    case 'pageClosed':
		                        delete pages[id]; // fallthru
		                    case 'pageSetDone':
		                    case 'pageJsIncluded':
		                    case 'cookieAdded':
		                    case 'pageRendered':
		                    case 'pageSwitchToFrameDone':
		                    case 'pageSwitchToMainFrameDone':
		                    case 'pageEventSent':
		                    case 'pageFileUploaded':
		                        cmds[cmdId].cb(null);
		                        delete cmds[cmdId];
		                        break;
		                    default:
		                        console.error('got unrecognized response:' + response);
		                        break;
		                    }                
		                }
		                else if (event.event === 'push') {
		                    var id = response[0];
		                    var cmd = response[1];
		                    // console.log("Got push event for: " + cmd);
		                    var callback = callbackOrDummy(pages[id] ? pages[id][cmd] : undefined);
		                    callback(unwrapArray(response[2]));
		                }
		                else if (event.event === 'disconnect') {
		                    console.log('Socket disconnect:', cmds);
		                    for (var cmdId in cmds) if (cmds.hasOwnProperty(cmdId)) {
		                        if (cmds[cmdId].cb) cmds[cmdId].cb(true);
		                        delete cmds[cmdId];
		                    }
		                }
		                else {
		                	console.log("Unknown event: " + event.event);
		                }
		            });
	                
	                var proxy = {
	                	process: phantom,
	                    createPage: function(callback) {
	                    	request([0,'createPage'], callbackOrDummy(callback));
	                    },
	                    injectJs: function(filename,callback){
	                        request([0,'injectJs', filename], callbackOrDummy(callback));
	                    },
	                    addCookie: function(cookie, callback){
	                        request([0,'addCookie', cookie], callbackOrDummy(callback));
	                    },                 
	                    exit: function(callback){
	                        request([0,'exit'], callbackOrDummy(callback));
	                        phantom.kill('SIGTERM');
	                    },
	                    on: function(){
	                        phantom.on.apply(phantom, arguments);
	                    },
	                };
	                
	                callback(null, proxy);
				});

	            // An exit event listener that is registered AFTER the phantomjs process
	            // is successfully created.
	            phantom.on('exit', function(code, signal){
	                // Close server upon phantom crash.
	                if (code !== 0 && signal === null){
	                    console.warn('phantom crash: code '+code);
	                    try {
	                        server.close();
	                    } catch (e) {
	                        console.log('Error closing server:', e);
	                    }
	                }
	                else {
	                    console.warn('phantom signal:', signal);
	                    try {
	                        server.close();
	                    } catch (e) {
	                        console.log('Error closing server:', e);
	                    }
	                 }
	            });
	        });
		});


    }
};
