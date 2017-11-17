const express = require('express');
const http = require('http');
const serveStatic = require('serve-static');

const app = express();
const port = 3000;

const server = http.createServer(app);

app.use(serveStatic('shippy-app', {
	index: ['index.html']
}));

server.listen(port, function listening() {
	console.log('Listening on %d', server.address().port);
});