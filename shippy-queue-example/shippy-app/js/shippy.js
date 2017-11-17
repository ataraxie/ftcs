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
			successors: []
		},
		currentFlywebService: null,
		appName: null,
		appSpec: null,
		clientId: null,
		isConnected: null,
		initialHtml: null,
		isServing: null
	};

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
		env.appName = appName;
		env.appSpec = appSpec;

		// If an init function was specified by the app, call it with the state
		if (typeof env.appSpec.init === 'function') {
			env.appSpec.init(env.state);
		}

		// When the app is registered and there is currently no FlyWeb service with that name, we
		// want to become the server.
		if (!env.currentFlywebService && shouldBecomeNextServer()) {
			Shippy.Server.becomeServer();
		}
	}

	// Operation calls are actually delegated to the Client module since these are called from clients
	function call(operationName, params) {
		Lib.log('Operation called: ' + operationName + '; params:', params);
		Shippy.Client.call(operationName, params);
	}

	// This initial HTML has this flag set to 'server' when the webapp is accessed.
	// FlyWeb clients will have this flag set to 'client'
	function hasServerRole() {
		return $('html').attr('data-flyweb-role') === 'server';
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
		Lib.log('Should become server? ' + should);
		return should;
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

	// ========
	// Below are single-function getters/setters
	// ========

	function connected(paramConnected) {
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
			$('html').attr('data-flyweb-role', serving ? 'server' : 'client');
		} else {
			return env.serving;
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

	function currentFlywebService() {
		return env.currentFlywebService;
	}

	function initialHtml() {
		return env.initialHtml;
	}

	// This is the event that's regularly triggered from our addon. It always contains a list of services with
	// a serviceName and serviceUrl field.
	// Unfortunately, this is not always up-to-date, so we are confronted with delays.
	window.addEventListener('flywebServicesChanged', function(event) {
		// Reinit to null so if we don't find a service for our app right now we will now
		env.currentFlywebService = null;
		if (env.appName) { // If an app was registered
			let services = JSON.parse(event.detail).services;
			for (let service of services) {
				if (service.serviceName === env.appName) { // if this service is for our app
					env.currentFlywebService = service; // then set it in our env
				}
			}

			// If a service was set and we are not already connected we want to become a client
			if (env.currentFlywebService && !env.isConnected) {
				Shippy.Client.becomeClient();
			}
			// If (a) there is currently no service for our name
			// and (b) env.isConnected was set to false before due to a disconnect (initially it was null)
			// and (c) we should become the next server based on the succ list etc.
			// then really become the server
			else if (!env.currentFlywebService && env.isConnected === false && shouldBecomeNextServer()) {
				Shippy.Server.becomeServer();
			}
		}
		Lib.log('Current Flyweb Service: ' + JSON.stringify(env.currentFlywebService));
	});

	// When the document has loaded, we save the initial HTML such that it can be served by our Flyweb server.
	window.onload = function() {
		env.initialHtml = '<html data-flyweb-role="client">'+$('html').html()+'</html>';
	};

	// This will be the exposed interface. The global Shippy object.
	// The internal sub-object "should" only be used by other Shippy modules (this could be improved).
	return {
		register: register,
		on: on,
		call: call,
		internal: {
			trigger: trigger,
			addSuccessor: addSuccessor,
			removeSuccessor: removeSuccessor,
			clearSuccessors: clearSuccessors,
			connected: connected,
			clientId: clientId,
			appName: appName,
			appSpec: appSpec,
			state: state,
			currentFlywebService: currentFlywebService,
			initialHtml: initialHtml,
			serving: serving,
			shouldBecomeNextServer: shouldBecomeNextServer
		}
	};

}());