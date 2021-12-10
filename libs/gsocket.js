let WS = require('ws');

// \x4C \x2A = L* = 19498
const PORT = global.cfg.relay_port
const wss = new WS.WebSocketServer({ port: PORT });
console.log(`> discord relay listening on port ${PORT}`)

function heartbeat() {
	this.isAlive = true;
}

wss.on('connection', function connection(ws) {
  ws.on('message', function message(data) {
    console.log('received: %s', data);
  });

  ws.isAlive = true;
  ws.on('pong', heartbeat);
});


const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', function close() {
	clearInterval(interval);
});

wss.SendMessage = function(color, username, message) {
	const col = [color[0], color[1], color[2]]; // r g b
	const name = username || "???"
	const msg = message || "???"

	wss.clients.forEach(function each(ws) {
	    if (ws.isAlive === false) return;

		ws.isAlive = false;
		ws.ping();
		ws.once('pong', function() {
			ws.send(col.toString() + "|" + name.length + "|" + name + msg);
		})
	});
}

global.GmodWSS = wss