let Lib = (function() {

	function wsSend(ws, route, body) {
		ws.send(JSON.stringify({
			route: route,
			body: body
		}));
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

	return {
		wsSend: wsSend,
		wsReceive: wsReceive,
		log: log
	};

}());