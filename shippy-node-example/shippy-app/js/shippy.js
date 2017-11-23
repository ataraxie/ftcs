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
		currentFlywebService: null,
		appName: null,
		appSpec: null,
		clientId: null,
		isConnected: null,
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
		if (!env.currentFlywebService && !env.isConnected) {
			if (waitingTime <= 0 && env.state.successors[0] !== env.clientId) {
				Lib.log('A successor is unreachable after T seconds. Removing first successor from the successor list', env.state.successors);
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

	function version() {
		return env.state.version;
	}

	// ========
	// Below is the mDNS service discovery listener
	// ========

	// This is the event that's regularly triggered from our addon. It always contains a list of services with
	// a serviceName and serviceUrl field.
	// Unfortunately, this is not always up-to-date, so we are confronted with delays.
	window.addEventListener('flywebServicesChanged', function (event) {
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
				resetWaitingTime();
				Shippy.Client.becomeClient();
			}
			// If (a) there is currently no service for our name
			// and (b) env.isConnected was set to false before due to a disconnect (initially it was null)
			// and (c) we should become the next server based on the succ list etc.
			// then really become the server
			else if (!env.currentFlywebService && env.isConnected === false && shouldBecomeNextServer()) {
				resetWaitingTime();
				Shippy.Server.becomeServer();
			}
			// If I' neither the next server, nor I'm connected I need to keep track of probable unreachable successors
			// If after some time period now successor has assumed the server role, I need to update my successor list
			// At some point, I'll be the next server, thus recovering from a chain of consecutive disconnections
			else if (!env.currentFlywebService && !env.isConnected) {
				pruneUnreachableSuccessor();
			}
		}
		Lib.log('Current Flyweb Service: ' + JSON.stringify(env.currentFlywebService));
	});

	// When the document has loaded, we save the initial HTML such that it can be served by our Flyweb server.
	window.onload = function () {
		env.initialHtml = '<html data-flyweb-role="client">' + $('html').html() + '</html>';
		Shippy.Storage.init(); // Get files required to run this app and add them to the session storage.
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
			currentFlywebService: currentFlywebService,
			initialHtml: initialHtml,
			serving: serving,
			shouldBecomeNextServer: shouldBecomeNextServer
		}
	};

}());