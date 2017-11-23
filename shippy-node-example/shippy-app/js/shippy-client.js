/**
 * Only Shippy client-specific logic
 */
Shippy.Client = (function() {

    // Our (single) WS connection.
    let ws;

	// Our routes for messages received from the server. These will be called from WS message events.
	let routes = {
		// The server accepted us and gave us a clientId. We want to save this so we will know when we should
		// become the next server depending on the succ list.
		welcome: function(body) {
			Lib.log("Client route 'welcome' called", body);
			Shippy.internal.clientId(body.clientId);
			if (Shippy.internal.serving()) {
				// If we have the double role, we should tell the server such that he removes us from the
				// succ list.
				Lib.wsSend(ws, "_revealdoublerole", {clientId: body.clientId});
			}
		},
		// The state was updated. If we don't have the double role we need to tell Shippy to update it's state.
		stateupdate: function(body) {
			Lib.log("Client route 'stateupdate' called", body);

			if (!Shippy.internal.serving()) {
				let updateFunc = getUpdateFunc(body);
				updateState(isServerAhead(body), updateFunc);
			}
			Shippy.internal.trigger("stateupdate", Shippy.internal.state());
		}
	};

    function isServerAhead(body) {
        let currentVersion = Shippy.internal.version();
        let serverVersion = body.version || body.state.version;

        return currentVersion <= serverVersion;
    }

    // Check if the payload carries the entire update or just an operation.
    // Based on that, this function creates an update function callback that will be used to update the client state
    // The callback either overrides the entire state, or updates the state/version based on a registered operation
	function getUpdateFunc(body) {
		if (typeof body.state !== 'undefined') {
			return function () {
                Shippy.internal.state(body.state);
            };
		}
		return function () {
            routes[body.route] && routes[body.route](Shippy.internal.state(), body.payload);
            Shippy.internal.updateVersion(body.version);
        };
    }

    // it will check whether the server has a state newer then the client
    // If it does, it will apply the state update function
    // Otherwise, it will send a _mostuptodate message back to the server
    function updateState(isServerAhead, updateFunc) {
        if (isServerAhead){
            updateFunc();
        } else {
            Lib.wsSend(ws, "_mostuptodate", {state: Shippy.internal.state()});
        }
    }

    // Become a Shippy client. When this is called there must be already a current Flyweb service available
    // and its URL will be used for the WS connection.
    function becomeClient() {
        // Mount the routes for the app operations onto our WS routes.
        // This is necessary in the client because state updates may carry operations rather than the entire state
        routes = Object.assign(routes, Shippy.internal.appSpec().operations);

        ws = new WebSocket("ws://" + Shippy.internal.currentFlywebService().serviceUrl);

        // Tell shippy that we are now connected.
        ws.addEventListener("open", function(e) {
            Lib.log("CLIENT: OPEN");
            Shippy.internal.connected(true);
        });

        // Delegate a received message to the associated route.
        ws.addEventListener("message", function(e) {
            Lib.log("CLIENT: MESSAGE");
            let data = Lib.wsReceive(e);
            routes[data.route] && routes[data.route](data.body);
        });

        // Tell shippy that we are now disconnected.
        ws.addEventListener("close", function(e) {
            Lib.log("CLIENT: CLOSE");
            Shippy.internal.connected(false);
        });

        // Don't really know what to do here
        ws.addEventListener("error", function(e) {
            Lib.log("CLIENT: ERROR");
        });
    }

    // We as client are responsible for calling the app operations. Essentially this will become
    // messages on our WS connection. Then on the server, the associated operations will be called with the
    // current state and the params below as arguments.
    function call(operationName, params) {
        Lib.wsSend(ws, operationName, params);
    }

    // Interface exposed as Shippy.Client
    return {
        becomeClient: becomeClient,
        call: call
    };

}());