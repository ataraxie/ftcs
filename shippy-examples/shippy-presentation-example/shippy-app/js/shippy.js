/**
 * Our trace module. This is only used for evalation purposes and should not be shipped with a productive version
 * of our library. Also, it introduces a second global object `Trace` which we want to avoid in case of becoming
 * productive.
 */
let Trace = (function () {

	const TRACE_ENABLED = false;

	const logKey = 'shippy:log:' + Date.now().toString() + ':' + Math.random().toString();

	let shippyLog = [];
	const thresholdInc = 500;
	let backupThreshold = 500;

	function save() {
		if (!TRACE_ENABLED) {
			return;
		}
		// Creates chuncks of the log with at most 500 events.
		// This will prevent POSTs with a payload size higher than what our measurement server can handle
		let chunks = [], size = 500;

		while (shippyLog.length > 0) {
			chunks.push(shippyLog.splice(0, size));
		}

		let i = 0;
		for (let chunk of chunks) {
			let payload = {clientId: Shippy.internal.clientId(), log: chunk, id: i++};
			$.ajax({
				type: "POST",
				url: 'http://127.0.0.1:4321',
				contentType: "application/json; charset=utf-8",
				dataType: "json",
				async: false,
				//json object to sent to the authentication url
				data: JSON.stringify(payload),
				success: function () {
				}
			});
		}
	}

	function backup() {
		if (shippyLog.length > backupThreshold){
			sessionStorage.setItem(logKey, JSON.stringify(shippyLog));
			backupThreshold += thresholdInc;
		}
	}

	function log(traceData) {
		if (!TRACE_ENABLED) {
			return;
		}
		shippyLog.push(traceData);
		backup();
	}

	return {
		log: log,
		save: save
	};

})();

/**
 * The main Shippy controller.
 *
 * Exposes the interface specified as return statement to the module at the bottom.
 */
let Shippy = (function() {

	/**
	 * The Shippy environment. This contains the state, the app name and specification, etc.
	 * This is exposed to other Shippy modules currently with the 'internal' property in the exposed interface.
	 * It contains single-function getters/setters depending on whether an argument is specified.
	 *
	 * e.g.
	 * Shippy.internal.state() => getter
	 * Shippy.internal.state({...}) => setter
	 */
	let env = {
		state: {
			successors: [],
			version: 0,
		},
		currentZerotiesService: null,
		appName: null,
		appSpec: null,
		clientId: null,
		isConnected: null,
		isConnecting: null,
		initialHtml: null,
		isServing: null
	};

	const time = {
		defaultWaitingTime: 21000,
		minDecrementTime: 1000,
		maxDecrementTime: 4000
	};

	let waitingTime = time.defaultWaitingTime;

	// Listeners registered via Shippy.on(...)
	let listeners = {};

	// Trigger Shippy events that will call listeners specified with Shippy.on(...)
	function trigger(eventName, data) {
		if (listeners[eventName]) {
			for (let listener of listeners[eventName]) {
				listener(data);
			}
		}
	}

	// Register listeners for Shippy events
	function on(eventName, callback) {
		if (!listeners[eventName]) {
			listeners[eventName] = [];
		}
		listeners[eventName].push(callback);
	}

	// Register the app
	function register(appName, appSpec) {
		console.log("called register");
		env.appName = appName;
		env.appSpec = appSpec;

		// If an init function was specified by the app, call it with the state
		if (typeof env.appSpec.init === 'function') {
			env.appSpec.init(env.state);
		}

		// When the app is registered and there is currently no Zeroties service with that name, we
		// want to become the server.
		if (!env.currentZerotiesService && shouldBecomeNextServer()) {
			console.log("didnt find a service");
			Shippy.Server.becomeServer();
		}
	}

	// Operation calls are actually delegated to the Client module since these are called from clients
	function call(operationName, params) {
		Shippy.Util.log('Operation called: ' + operationName + '; params:', params);
		Shippy.Client.call(operationName, params);
	}

	// This initial HTML has this flag set to 'server' when the webapp is accessed.
	// Zeroties clients will have this flag set to 'client'
	function hasServerRole() {
		return $('html').attr('data-zeroties-role') === 'server';
	}

	// Determine if I should become the next server
	function shouldBecomeNextServer() {
		let successors = env.state.successors;
		let should = false;
		if (!successors.length) { // If there are no successors, just check the server role flag
			should = hasServerRole();
		} else { // If there are successors, check if I'm the first one
			should = successors[0] === env.clientId;
		}
		Shippy.Util.log('Should become server? ' + should);
		return should;
	}

	function updateStateKeepSuccessors(params) {
		// TODO: change from overriding the entire state to reconstructing the state based on a set of operations
		let successors = env.state.successors;
		Object.assign(env.state, params.state);
		env.state.successors = successors;
	}

	function addSuccessor(successor) {
		env.state.successors.push(successor);
	}

	function removeSuccessor(successor) {
		let index = env.state.successors.indexOf(successor);
		if (index >= 0) {
			env.state.successors.splice(index, 1);
		}
	}

	function clearSuccessors() {
		env.state.successors = [];
	}

	function resetWaitingTime() {
		waitingTime = time.defaultWaitingTime;
	}

	function updateVersion(version) {
		if (version){
			env.state.version = version;
		} else {
			env.state.version++;
		}
	}

	// Random number in the interval of [1000 ms to 4000ms]
	// Such that clients can try to become the next server and drop elements from the list faster than others
	function decrementTime() {
		return Math.random() * (time.maxDecrementTime - time.minDecrementTime) + time.minDecrementTime;
	}

	// Remove the first successor of the successors list if this successor does not become the new server after T seconds
	function pruneUnreachableSuccessor() {
		if (!env.currentZerotiesService && !env.isConnected) {
			if (waitingTime <= 0 && env.state.successors[0] !== env.clientId) {
				Shippy.Util.log('A successor is unreachable after T seconds. Removing first successor from the successor list', env.state.successors);
				Trace.log({ timestamp: Date.now(), event: 'shippy_client_prune_successor', source: clientId()});
				env.state.successors.splice(0, 1);
				resetWaitingTime();

			} else {
				waitingTime -= decrementTime();
			}
		}
	}


	// ========
	// Below are single-function getters/setters
	// ========

	function connected(paramConnected) {
		env.isConnecting = false;
		if (typeof paramConnected !== 'undefined' && !(env.isConnected === null && paramConnected === false)) {
			env.isConnected = paramConnected;
			trigger(paramConnected ? 'connect' : 'disconnect');
		} else {
			return env.isConnected;
		}
	}

	function clientId(paramClientId) {
		if (typeof paramClientId !== 'undefined') {
			env.clientId = paramClientId;
		} else {
			return env.clientId;
		}
	}

	function serving(paramServing) {
		if (typeof paramServing !== 'undefined') {
			env.serving = paramServing;
			$('html').attr('data-zeroties-role', serving ? 'server' : 'client');
		} else {
			return !!env.serving;
		}
	}

	function appName() {
		return env.appName;
	}

	function appSpec() {
		return env.appSpec;
	}

	function state(paramState) {
		if (typeof paramState !== 'undefined') {
			Object.assign(env.state, paramState);
		} else {
			return env.state;
		}
	}

	function currentZerotiesService() {
		return env.currentZerotiesService;
	}

	function initialHtml() {
		return env.initialHtml;
	}

	function version() {
		return env.state.version;
	}

	// ========
	// Below is the mDNS service discovery listener
	// ========

	// This is the event that's regularly triggered from our addon. It always contains a list of services with
	// a serviceName and serviceUrl field.
	// Unfortunately, this is not always up-to-date, so we are confronted with delays.
	window.addEventListener('zerotiesServicesChanged', function (event) {
		console.log("recieved event");
		// Reinit to null so if we don't find a service for our app right now we will now
		env.currentZerotiesService = null;
		if (env.appName) { // If an app was registered
			let services = JSON.parse(event.detail).services;
			for (let service of services) {
				if (service.serviceName === env.appName) { // if this service is for our app
					trigger("servicefound", service);
					env.currentZerotiesService = service; // then set it in our env
				}
			}

			// If a service was set and we are not already connected we want to become a client
			if (env.currentZerotiesService && !env.isConnected && !env.isConnecting) {
				env.isConnecting = true;
				resetWaitingTime();
				Shippy.Client.becomeClient();
			}
			// If (a) there is currently no service for our name
			// and (b) env.isConnected was set to false before due to a disconnect (initially it was null)
			// and (c) we should become the next server based on the succ list etc.
			// then really become the server
			else if (!env.currentZerotiesService && env.isConnected === false && shouldBecomeNextServer()) {
				resetWaitingTime();
				Shippy.Server.becomeServer();
			}
			// If I' neither the next server, nor I'm connected I need to keep track of probable unreachable successors
			// If after some time period now successor has assumed the server role, I need to update my successor list
			// At some point, I'll be the next server, thus recovering from a chain of consecutive disconnections
			else if (!env.currentZerotiesService && !env.isConnected) {
				pruneUnreachableSuccessor();
			}
		}
		Shippy.Util.log('Current Zeroties Service: ' + JSON.stringify(env.currentZerotiesService));
	});

	// When the document has loaded, we save the initial HTML such that it can be served by our Zeroties server.
	window.onload = function () {
		env.initialHtml = '<html data-zeroties-role="client">' + $('html').html() + '</html>';
		Shippy.Storage.init(); // Get files required to run this app and add them to the session storage.
	};

	window.onbeforeunload = function (e) {
		Trace.log({ timestamp: Date.now(), event: 'disconnecting', source: clientId(), isServer: serving() });
		Trace.save();
	};

	// This will be the exposed interface. The global Shippy object.
	// The internal sub-object "should" only be used by other Shippy modules (this could be improved).
	return {
		register: register,
		on: on,
		call: call,
		internal: {
			updateVersion: updateVersion,
			trigger: trigger,
			addSuccessor: addSuccessor,
			removeSuccessor: removeSuccessor,
			clearSuccessors: clearSuccessors,
			connected: connected,
			clientId: clientId,
			version: version,
			appName: appName,
			appSpec: appSpec,
			state: state,
			updateStateKeepSuccessors: updateStateKeepSuccessors,
			currentZerotiesService: currentZerotiesService,
			initialHtml: initialHtml,
			serving: serving,
			shouldBecomeNextServer: shouldBecomeNextServer
		}
	};

}());

Shippy.Util = (function () {

	const payloadLength = [1, 4, 16, 64, 256, 1024, 4096, 1, 4, 16, 64, 256,
		1024, 4096, 1, 4, 16, 64, 256, 1024, 4096, , 1, 4, 16, 64, 256, 1, 4, 16, 64, 256, 1024, 1, 4, 16, 64, 256,
		1, 4, 16, 64, 256, 1024, 1, 4, 16, 64, 256, 1024, 4096,
		1048576, 1, 4, 16, 64, 256, 1, 1, 4, 16, 64, 256, 1024, 1, 4, 16, 64, 256,
		4, 16, 64, 256, 1, 4, 16, 64,
		256, 1024, 4096,
		1024, 4096];

	function wsSend(ws, route, body) {
		ws.send(JSON.stringify({
			route: route,
			body: body
		}));
	}

	function payloadSize(data) {
		let str = JSON.stringify(data);
		let m = encodeURIComponent(str).match(/%[89ABab]/g);
		return str.length + (m ? m.length : 0);
	}

	// https://stackoverflow.com/questions/35786857/generate-random-string-with-a-specific-sign-in-it-using-js
	function stringGen(len) {
		let text = "";
		let charset = "abcdefghijklmnopqrstuvwxyz0123456789";

		for (let i = 0; i < len; i++) {
			text += charset.charAt(Math.floor(Math.random() * charset.length));
		}

		return text;
	}

	function randomPayload() {
		let strLength = payloadLength[Math.floor(Math.random() * payloadLength.length)];
		return stringGen(strLength);

	}

	function wsReceive(event) {
		return JSON.parse(event.data);
	}

	function log(msg, argument) {
		console.log(msg);
		if (argument) {
			console.log(argument);
		}
	}

	// See https://stackoverflow.com/questions/4998908/convert-data-uri-to-file-then-append-to-formdata
	function dataURItoBlob(dataURI) {
		let byteString = atob(dataURI.split(',')[1]);
		let mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
		let ab = new ArrayBuffer(byteString.length);
		let ia = new Uint8Array(ab);
		for (let i = 0; i < byteString.length; i++) {
			ia[i] = byteString.charCodeAt(i);
		}
		return new Blob([ab], {type: mimeString});
	}

	return {
		wsSend: wsSend,
		wsReceive: wsReceive,
		log: log,
		dataURItoBlob: dataURItoBlob,
		payloadSize: payloadSize,
		randomPayload: randomPayload
	};

}());

/**
 * The SessionStorage controller used by Shippy
 *
 * Exposes the interface specified as return statement to the module at the bottom.
 */
Shippy.Storage = (function() {

	/*
	 * This MIME types were extracted from:
	 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Complete_list_of_MIME_types
	 * However, this is not a comprehensive list
	 */
	let extToMimes = {
		'img': 'image/jpeg',
		'png': 'image/png',
		'css': 'text/css',
		'gif': 'image/gif',
		'htm': 'text/html',
		'html': 'text/html',
		'ico': 'image/x-icon',
		'jpeg': 'image/jpeg',
		'jpg': 'image/jpeg',
		'js': 'application/javascript',
		'json': 'application/json',
		'xml': 'application/xml',
		'default': 'text/plain',
		'woff': 'font/woff',
		'woff2': 'font/woff2',
		'ttf': 'font/ttf'
	};

	// Default path function to be used in addFiles if no preprocessing is required
	let defaultPath = function (file) {
		return file;
	};

	// Default key function to be used in addFiles if no preprocessing is required
	let defaultKey = function (file) {
		return '/'.concat(file);
	};

	// Converts a file to a MIME type
	function fileToMime(file) {
		let extension = file.split(".").pop();
		if (extToMimes.hasOwnProperty(extension)) {
			return extToMimes[extension];
		}
		return extToMimes.default;
	}

	// Adds a file to session storage
	function addFile(file, key, cacheEnabled) {
		cacheEnabled = cacheEnabled || false;
		// If you keep changing the js files, this may cause issues. That's why cacheEnabled is false by default
		// When we have a stable API/sytem, we can enable it to true later on
		if (cacheEnabled && sessionStorage.getItem(key)) {
			return;
		}

		// Creates a XMLHttpRequest to extract the content of files referenced through src or href into the index.html
		let xhr = new XMLHttpRequest(),
			fileReader = new FileReader();

		xhr.open("GET", file, true);
		xhr.responseType = "blob";

		// Wait the file to be loaded so we can extract its content
		xhr.addEventListener("load", function () {
			if (xhr.status === 200) {
				// onload needed since Google Chrome doesn't support addEventListener for FileReader
				fileReader.onload = function (evt) {
					let content = evt.target.result;
					let mimeType = fileToMime(file);
					let data = {mimeType: mimeType, content: content};

					try {
						sessionStorage.setItem(key, JSON.stringify(data));
					}
					catch (e) {
						Shippy.Util.log("Storage failed: ", e);
					}
				};
				// Encoding the file as Data URL makes it easier to serve different file types in the onFetch server function
				fileReader.readAsDataURL(xhr.response);
			}
		}, false);
		xhr.send();
	}

	// get one file from the session storage
	function get(key) {
		let file = sessionStorage.getItem(key);
		if (file) {
			return JSON.parse(file);
		}
		return null;
	}

	// Iterate and add files to the session storage based on functions with extract the data required to do so
	// Only add files which have a source path (src or href).
	function addFiles(fileList, getPath, getKey) {
		for (let file of fileList) {
			try {
				let path = getPath(file);
				if (typeof path !== 'undefined' && path !== "") {
					let key = getKey(file);

					addFile(path, key);
				}
			} catch (err){

			}
		}
	}

	// add script files to the session storage
	function addScripts() {
		let scripts = document.getElementsByTagName('script');
		let getPath = function (script) {
			return script.src;
		};
		let getKey = function (script) {
			// Workaround because of the frameworks that add #/ to the URI path
			let aux = script.baseURI.replace('#/', '');
			aux = '/'.concat(script.src.replace(aux, ''));
			return aux;
		};

		addFiles(scripts, getPath, getKey);
	}

	// add style sheet files to the session storage
	function addStyleSheets() {
		let styleSheets = document.styleSheets;
		let getPath = function (styleSheet) {
			return styleSheet.href;
		};
		let getKey = function (styleSheet) {
			// Workaround because of the frameworks that add #/ to the URI path
			let aux = styleSheet.ownerNode.baseURI.replace('#/', '');
			aux = '/'.concat(styleSheet.href.replace(aux, ''));
			return aux;
		};

		addFiles(styleSheets, getPath, getKey);
		addEmbeddedUrls(styleSheets);
	}

	function addEmbeddedUrls(styleSheets) {
		for (let styleSheet of styleSheets) {
			if (!!styleSheet.cssRules) {
				for (let rule of styleSheet.cssRules) {
					if (rule.style && rule.style.backgroundImage) {
						addCssBackgroundImage(rule.style.backgroundImage)
					}
				}
			}
		}
	}

	function addCssBackgroundImage(backgroundImage) {
		const urlRgx = /url\((.*?)\)/g;
		const urlPrefix = "url(\"".length;
		const urlSuffix = "\")".length;
		let matches = backgroundImage.match(urlRgx);
		if (!!matches) {
			let imgs = matches.map(function (img) {
				let aux = img.substring(urlPrefix, img.length - urlSuffix);
				if (aux.startsWith('data')) {
					return null;
				} else {
					let path = aux.split("/");
					path = path.filter(function (p) {
						return p !== '..';
					});
					return path.join("/");
				}
			}).filter(function (img) {
				return img !== null;
			});

			addFiles(imgs, defaultPath, defaultKey);
		}
	}

	function addHtmls() {
		let content = Shippy.internal.initialHtml();
		let data = {mimeType: extToMimes.html, content: content};
		sessionStorage.setItem('/', JSON.stringify(data));
		sessionStorage.setItem('/index.html', JSON.stringify(data));
		addImages(content);
	}

	function addImages(html) {
		// I need two regex because first I want to filter all images that have a src and then
		// another one to fetch only the content inside the source
		const imgRgx = /img(.*?)src=\"(.*?)\"/g;
		const srcRgx = /src=\"(.*?)\"/g;
		const srcPrefix = "src=\"".length;
		const srcSuffix = "\"".length;
		let matches = html.match(imgRgx);
		if (!!matches) {
			let imgs = matches.map(function (img) {
				let src = img.match(srcRgx);
				if (src) {
					let aux = src[0].substring(srcPrefix, src[0].length - srcSuffix);
					return aux.replace("\"", "");
				} else {
					return null;
				}
			}).filter(function (img) {
				return img !== null;
			});

			addFiles(imgs, defaultPath, defaultKey);
		}
	}

	function init() {
		addScripts();
		addStyleSheets();
		addHtmls();
	}

	return {
		get: get,
		init: init,
		extToMimes: extToMimes
	}
})();

/**
 * Only Shippy server-specific logic
 */
Shippy.Server = (function() {

	// Dictionary of web socket connections in form clientId => websocket object
	let wss = {};

	// Routes for WS requests to our server. Routes beginning with _ are private Shippy-internal routes.
	// Other routes will be mounted on this object from the operations registered from the app. This happens
	// when we become the server.
	let routes = {
		// This route is called by the client that has both the server and the client role upon connect.
		// We don't want the client that is also the server in our successor list because when the server dies
		// this client dies too.
		_revealdoublerole: function (state, params) {
			Shippy.Util.log("Double role revealed: ", params.clientId);
			Shippy.internal.removeSuccessor(params.clientId);
			broadcastState();
			// Should we trigger a broadcast here? I think I will always be the first client when I reveal
			// myself but I'm not really sure.
		},
		_aheadofserver: function (state, params) {
			// This route is called when upon connection, a client signals that it has the most up-to-date state
			// In that case, the server needs to make a copy of his list of successors and then, update the state based on what he received from the client
			// This is not optimal. Ideally, instead of sending the most up-to-date state,
			// the client sends missing operations that need to be added such that the server can reconstruct his state
			Shippy.Util.log("Upon new connection, a client had the most up-to-date state", params.clientId);
			Shippy.internal.updateStateKeepSuccessors(params);
		}
	};

	// Checks whether a route is private or not
	function privateRoute(route) {
		return route.startsWith("_");
	}

	function createOptions(mimeType, status) {
		status = status || 200;
		return {
			status: status,
			headers: {'Content-Type': mimeType}
		};
	}

	function onFetch(event) {
		Shippy.Util.log("ONFETCH");

		let l = document.createElement("a");
		l.href = event.request.url;
		let url = l.pathname;

		let file = Shippy.Storage.get(url);
		if (file) {
			let options = createOptions(file.mimeType);
			if (url === '/' || url === '/index.html') {
				event.respondWith(new Response(file.content, options));
			} else {
				let blob = Shippy.Util.dataURItoBlob(file.content);
				event.respondWith(new Response(blob, options));
			}
		} else {
			event.respondWith(new Response({}, createOptions('application/json', 404)));
		}
	}

	// Run through all WS connections and send the state.
	function broadcastState() {
		console.log(wss);
		for (let clientId in wss) {
			console.log("broadcasting to " + clientId);
			Shippy.Util.wsSend(wss[clientId], "stateupdate", {state: Shippy.internal.state()});
		}
	}

	function broadcastOperation(ws, route, body) {
		let data = {route: route, payload: body, version: Shippy.internal.version()};
		for (let clientId in wss) {
			let dest = wss[clientId];
			data.origin = ws === dest;

			Shippy.Util.wsSend(dest, "stateupdate", data);
		}
	}

	// Called for all WS requests.
	function onWebsocket(event) {
		let ws = event.accept(); // just accept all connections

		Shippy.Util.log("SERVER: INITIAL");


		// Open is the event when a the connection for a client is opened.
		// Here we create the client ID and add the WS connection to our collection. Then we add the client ID to
		// our successor list (if this client has also the server role this id will be removed later when the
		// _revealdoublerole route is called from this client). We send a welcome message to the client containing
		// the clientId. We also broadcast the state because the contained successor list changed.
		ws.addEventListener("open", function(e) {
			Shippy.Util.log("SERVER: OPEN");
			let clientId = new Date().getTime();
			ws.clientId = clientId;
			wss[clientId] = ws;
			Trace.log({ timestamp: Date.now(), event: 'shippy_server_ws_open', source: Shippy.internal.clientId(), from: ws.clientId});
			Shippy.internal.addSuccessor(clientId);
			Shippy.Util.wsSend(ws, "welcome", {clientId: clientId});
			broadcastState();
		});

		// Whenever the server receives a message it calls the associated route that's extracted from the payload.
		// The route will either be a mounted on from the app operations or a private _ one (e.g. _revealdoublerole).
		ws.addEventListener("message", function(e) {
			let data = Shippy.Util.wsReceive(e);
			console.log(data);
			Shippy.Util.log("SERVER: MESSAGE");
			let currentState = Shippy.internal.state();
			if (ws.clientId) {
				Trace.log({
					timestamp: Date.now(),
					event: 'shippy_server_received_' + data.route,
					source: Shippy.internal.clientId(),
					from: ws.clientId,
					pkgSize: Shippy.Util.payloadSize(data)
				});
			}

			routes[data.route] && routes[data.route](currentState, data.body);

			// Now, instead of broadcasting the entire state, we can broadcast just an operation and the required payload to execute that operation
			// Whenever we have a non private operation, we also update our server versioning such that clients can assess whether they have the most up-to-date state
			// Sending a version number in the broadcast is essential to synchronize clients after a client becomes the new server
			if (!privateRoute(data.route)) {
				Shippy.internal.updateVersion();
				broadcastOperation(ws, data.route, data.body);
			} else {
				// In some scenarios we still send the entire state
				// later on we can send an array of operations such that the clients can reconstruct the state themselves
				broadcastState();
			}
		});

		// When a client closed the connection we remove it from the succ list and broadcast the state.
		ws.addEventListener("close", function(e) {
			Shippy.Util.log("SERVER: CLOSE");
			if (ws.clientId) {
				Trace.log({ timestamp: Date.now(), event: 'shippy_server_ws_close', source: Shippy.internal.clientId(), from: ws.clientId});
				delete wss[ws.clientId];
				Shippy.internal.removeSuccessor(ws.clientId);
				broadcastState();
			}
		});

		// Don't really know what to do here
		ws.addEventListener("error", function(e) {
			Shippy.Util.log("SERVER: ERROR");
		});

	}

	// Don't really know what to do here
	function onClose() {
		Shippy.Util.log("ON CLOSE");
		Trace.log({ timestamp: Date.now(), event: 'shippy_server_disconnecting', source: Shippy.internal.clientId()});
	}

	function becomeServer() {
		Trace.log({ timestamp: Date.now(), event: 'shippy_become_server_begin', source: Shippy.internal.clientId()});
		// Mount the routes for the app operations onto our WS routes.
		routes = Object.assign(routes, Shippy.internal.appSpec().operations);
		Shippy.Util.log("BECOME SERVER");
		// Now REALLY become the server!
		navigator.publishServer(Shippy.internal.appName()).then(function(server) {
			Shippy.Util.log("New Server created for app:", Shippy.internal.appName());
			// When we have a new server we want to start with a fresh succ list.
			Shippy.internal.clearSuccessors();
			// Indicate that we are now the serving node.
			Shippy.internal.serving(true);
			server.onfetch = onFetch;
			server.onwebsocket = onWebsocket;
			server.onclose = onClose;
			Shippy.Util.log(server);
			Trace.log({ timestamp: Date.now(), event: 'shippy_become_server_end', source: Shippy.internal.clientId()});
		}).catch(function (err) {
			Shippy.Util.log("Error creating server", err);
			Trace.log({ timestamp: Date.now(), event: 'shippy_become_server_error', source: Shippy.internal.clientId()});
		});
	}

	// Interface exposed as Shippy.Server
	return {
		becomeServer: becomeServer
	};

}());

/**
 * Only Shippy client-specific logic
 */
Shippy.Client = (function() {

	// Our (single) WS connection.
	let ws;

	let tempID = Date.now(); // temp ID while server does not assign an ID to this client

	// Our routes for messages received from the server. These will be called from WS message events.
	let routes = {
		// The server accepted us and gave us a clientId. We want to save this so we will know when we should
		// become the next server depending on the succ list.
		welcome: function(body) {
			Shippy.Util.log("Client route 'welcome' called", body);
			Shippy.internal.clientId(body.clientId);
			Trace.log({
				timestamp: Date.now(),
				event: 'shippy_client_received_welcome',
				source: Shippy.internal.clientId(),
				from: tempID,
				pkgSize: Shippy.Util.payloadSize(body)
			});
			if (Shippy.internal.serving()) {
				// If we have the double role, we should tell the server such that he removes us from the
				// succ list.
				Shippy.Util.wsSend(ws, "_revealdoublerole", {clientId: body.clientId});
			}
			Shippy.internal.trigger("clientid", { serving: Shippy.internal.serving(), clientId: body.clientId });
		},
		// The state was updated. If we don't have the double role we need to tell Shippy to update it's state.
		stateupdate: function(body) {
			Shippy.Util.log("Client route 'stateupdate' called", body);

			if (!Shippy.internal.serving()) {
				updateState(body);
			}
			Shippy.internal.trigger("stateupdate", Shippy.internal.state());
		}
	};

	function isServerAhead(body) {
		let currentVersion = Shippy.internal.version();
		let serverVersion = body.version || body.state.version;

		return currentVersion <= serverVersion;
	}

	// it will check whether the server has a state newer then the client
	// If it does, it will apply the state update function
	// Otherwise, it will send a _aheadofserver message back to the server
	function updateState(body) {
		let currentState = Shippy.internal.state();
		if (isServerAhead(body)){
			if (body.state) {
				Shippy.internal.state(body.state);
			} else if (typeof body.version === 'number' && body.payload && body.route && routes[body.route]) {
				routes[body.route](currentState, body.payload);
				Shippy.internal.updateVersion(body.version);
			} else {
				Shippy.Util.log("Error in updateState", body);
			}
			Trace.log({
				timestamp: Date.now(),
				event: 'shippy_client_received_stateupdate',
				source: Shippy.internal.clientId(),
				pkgSize: Shippy.Util.payloadSize(body),
				numSuccessors: Shippy.internal.state().successors.length,
				isBroadcast: typeof body.state !== 'undefined',
				version: Shippy.internal.version(),
				tempID: tempID,
			});
		} else {
			Shippy.Util.wsSend(ws, "_aheadofserver", {state: currentState});
		}
	}

	// Become a Shippy client. When this is called there must be already a current Zeroties service available
	// and its URL will be used for the WS connection.
	function becomeClient() {
		Trace.log({ timestamp: Date.now(), event: 'shippy_become_client_begin', source: tempID});
		// Mount the routes for the app operations onto our WS routes.
		// This is necessary in the client because state updates may carry operations rather than the entire state
		routes = Object.assign(routes, Shippy.internal.appSpec().operations);
		Shippy.Util.log("BECOME CLIENT");
		ws = new WebSocket("ws://" + Shippy.internal.currentZerotiesService().serviceUrl);

		// Tell shippy that we are now connected.
		ws.addEventListener("open", function(e) {
			Shippy.Util.log("CLIENT: OPEN");
			Shippy.internal.connected(true);
		});

		// Delegate a received message to the associated route.
		ws.addEventListener("message", function(e) {
			Shippy.Util.log("CLIENT: MESSAGE");
			let data = Shippy.Util.wsReceive(e);
			routes[data.route] && routes[data.route](data.body);
		});

		// Tell shippy that we are now disconnected.
		ws.addEventListener("close", function(e) {
			Shippy.Util.log("CLIENT: CLOSE");
			Shippy.internal.connected(false);
		});

		// Don't really know what to do here
		ws.addEventListener("error", function(e) {
			Shippy.Util.log("CLIENT: ERROR");
		});
		Trace.log({ timestamp: Date.now(), event: 'shippy_become_client_end', source: Shippy.internal.clientId()});
	}

	// We as client are responsible for calling the app operations. Essentially this will become
	// messages on our WS connection. Then on the server, the associated operations will be called with the
	// current state and the params below as arguments.
	function call(operationName, params) {
		Trace.log({ timestamp: Date.now(), event: 'shippy_client_call_' + operationName, source: Shippy.internal.clientId(), version: Shippy.internal.version()});
		Shippy.Util.wsSend(ws, operationName, params);
	}

	// Interface exposed as Shippy.Client
	return {
		becomeClient: becomeClient,
		call: call
	};

}());