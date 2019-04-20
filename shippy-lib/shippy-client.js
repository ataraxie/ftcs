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