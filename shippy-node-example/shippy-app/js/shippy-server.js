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
			Lib.log("Double role revealed: ", params.clientId);
			Shippy.internal.removeSuccessor(params.clientId);
			// Should we trigger a broadcast here? I think I will always be the first client when I reveal
			// myself but I'm not really sure.
		},
		_mostuptodate: function (state, params) {
			// This route is called when upon connection, a client signals that it has the most up-to-date state
			// In that case, the server needs to make a copy of his list of successors and then, update the state based on what he received from the client
			// This is not optimal. Ideally, instead of sending the most up-to-date state,
			// the client sends missing operations that need to be added such that the server can reconstruct his state
			Lib.log("Upon new connection, a client had the most up-to-date state", params.clientId);
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
		Lib.log("ONFETCH");
		let url = event.request.url;
		let file = Shippy.Storage.get(url);
		if (file) {
			event.respondWith(new Response(file.content, createOptions(file.mimeType)));
		} else {
			event.respondWith(new Response({}, createOptions('application/json', 404)));
		}

	}

	// Run through all WS connections and send the state.
	function broadcastState() {
		for (let clientId in wss) {
			Lib.wsSend(wss[clientId], "stateupdate", {state: Shippy.internal.state()});
		}
	}

	function broadcastOperation(ws, route, body) {
		let data = {route: route, payload: body, version: Shippy.internal.version()};
		for (let clientId in wss) {
			let dest = wss[clientId];
			data.origin = ws === dest;

			Lib.wsSend(dest, "stateupdate", data);
		}
	}

	// Called for all WS requests.
	function onWebsocket(event) {
		let ws = event.accept(); // just accept all connections

		Lib.log("SERVER: INITIAL");


		// Open is the event when a the connection for a client is opened.
		// Here we create the client ID and add the WS connection to our collection. Then we add the client ID to
		// our successor list (if this client has also the server role this id will be removed later when the
		// _revealdoublerole route is called from this client). We send a welcome message to the client containing
		// the clientId. We also broadcast the state because the contained successor list changed.
		ws.addEventListener("open", function(e) {
			Lib.log("SERVER: OPEN");
			let clientId = new Date().getTime();
			ws.clientId = clientId;
			wss[clientId] = ws;
			Shippy.internal.addSuccessor(clientId);
			Lib.wsSend(ws, "welcome", {clientId: clientId});
			broadcastState();
		});

		// Whenever the server receives a message it calls the associated route that's extracted from the payload.
		// The route will either be a mounted on from the app operations or a private _ one (e.g. _revealdoublerole).
		ws.addEventListener("message", function(e) {
			Lib.log("SERVER: MESSAGE");
			let data = Lib.wsReceive(e);
			let currentState = Shippy.internal.state();

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
			Lib.log("SERVER: CLOSE");
			if (ws.clientId) {
				delete wss[ws.clientId];
				Shippy.internal.removeSuccessor(ws.clientId);
				broadcastState();
			}
		});

		// Don't really know what to do here
		ws.addEventListener("error", function(e) {
			Lib.log("SERVER: ERROR");
		});

	}

	// Don't really know what to do here
	function onClose() {
		Lib.log("ON CLOSE");
	}

	function becomeServer() {
		// Mount the routes for the app operations onto our WS routes.
		routes = Object.assign(routes, Shippy.internal.appSpec().operations);
		Lib.log("BECOME SERVER");
		// Now REALLY become the server!
		navigator.publishServer(Shippy.internal.appName()).then(function(server) {
			Lib.log("New Server created for app:", Shippy.internal.appName());
			// When we have a new server we want to start with a fresh succ list.
			Shippy.internal.clearSuccessors();
			// Indicate that we are now the serving node.
			Shippy.internal.serving(true);
			server.onfetch = onFetch;
			server.onwebsocket = onWebsocket;
			server.onclose = onClose;
			Lib.log(server);
		}).catch(function (err) {
			Lib.log("Error creating server", err);
		});
	}

	// Interface exposed as Shippy.Server
	return {
		becomeServer: becomeServer
	};

}());