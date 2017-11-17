(function() {

	let myName; // Will be set from the browser prompt when the site is accessed

	// It's easiest to always build the UI from the current state
	function updateUi(state) {
		$('#state').text(JSON.stringify(state));
	}

	// This function will be called from Shippy upon initializing the app
	// The app hereby tells Shippy what the initial state should look like
	let init = function(state) {
		state.queue = [];
		Lib.log("init called. State is now...", state);
		updateUi(state);
	};

	// These are the operations that Shippy should perform on the state for my app
	let operations = {
		add: function(state, params) {
			if (state.queue.indexOf(params.name) < 0) {
				state.queue.push(params.name);
			}
		},
		remove: function(state, params) {
			let index = state.queue.indexOf(params.name);
			if (index >= 0) {
				state.queue.splice(index, 1);
			}
		}
	};

	// Register my Shippy app
	Shippy.register("app", {
		init: init,
		operations: operations
	});

	// Whenever the state is updated, I want to update my UI
	Shippy.on("stateupdate", function(state) {
		Lib.log("App event received: stateupdate");
		updateUi(state);
	});

	// My app is now connected. Show a green box.
	Shippy.on("connect", function() {
		Lib.log("App event received: connect");
		$('#connection-status').addClass('connected');

	});

	// My app is now disconnected. Show a red box.
	Shippy.on("disconnect", function(state) {
		Lib.log("App event received: disconnect");
		$('#connection-status').removeClass('connected');
	});

	// When the add button is clicked, I want Shippy to trigger my "add" operation with my name
	// as the payload.
	function onAddClick(e) {
		e.preventDefault();
		Shippy.call("add", { name: myName });
	}

	// Same for the remove button
	function onRemoveClick(e) {
		e.preventDefault();
		Shippy.call("remove", { name: myName });
	}

	// When the document is ready I want to tell the queue app my name such that it knows
	// what name to add and remove from the queue.
	$(document).ready(function() {
		myName = prompt("Please tell me your name");
		$("#myname").text(myName);
		$("#add-button").click(onAddClick);
		$("#remove-button").click(onRemoveClick);
	});

}());