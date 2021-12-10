//

const https = require('https')
const apiKey = global.cfg.CridentAPI

function doReq(id, url) {
	var dat = {
		hostname: 'dino.gg',
		port: 443,
		path: url, //,
		method: 'GET',
		headers: {
			"Authorization": "Bearer " + apiKey,
			"Accept": "application/vnd.wisp.v1+json",
			"Content-Type": "application/json"
		}
	}

	var pr = new Promise((resolve, reject) => {
		var req = https.request(dat, res => {
			data = [];
			res.on('data', chunk => {
				data.push(chunk);
			});

			res.on('end', () => {
				try {
					const dat = JSON.parse(Buffer.concat(data).toString());
				} catch {
					reject(-1);
				}
				dat.id = id;
				resolve(dat);
			});
		})

		req.on('error', err => {
			console.log('Error: ', err.message);
			reject(err.message);
		});

		req.end()
	});

	return pr;
}


function getServerData() {
	let prs = [];

	for (let id of global.cfg.ServersOfInterest) {
		prs.push(Promise.all([
			doReq(id, "/api/client/servers/" + id + "/utilization"),
			doReq(id, "/api/client/servers/" + id + "?include=allocations"),
		]))
	}

	let pr = Promise.all(prs)
	return pr.then((res) => {
		let listId = {}

		for (let dat of res) {
			listId[dat[1].id] = dat;
		}

		let out = {};

		for (let id of global.cfg.ServersOfInterest) {
			let dat = listId[id];
			let util = dat[0].attributes;
			let internal = dat[1].attributes;
			let alloc = dat[1].attributes.relationships.allocations.data[0].attributes; // wtf

			let qry = util.query;

			let svOut = {};
			svOut.name = qry.name;
			svOut.intName = internal.name;
			svOut.map = qry.map;
			svOut.players = qry.raw.numplayers; // workaround
			svOut.maxPlayers = qry.maxplayers;

			svOut.ip = alloc.ip;
			svOut.port = alloc.port;

			svOut.raw_response =  dat;

			out[id] = svOut;
		}

		return out;
	});
}

global.getServerData = getServerData;