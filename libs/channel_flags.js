const { SlashCommandBuilder } = require('@discordjs/builders');

const path = require("path");
require(path.join(require.main.path, "libs", "mysql_db"));
// require.main.require is also an option but seems wrong... ALL OF THIS SEEMS WRONG!!!

var db = global.DB
var client = global.Bot


async function createWH(chan, resolve) {
	let newWH = await chan.createWebhook("Relay");
	db.query("INSERT INTO `webhooks` (id, token, channel, url) VALUES(?, ?, ?, ?)",
		[newWH.id, newWH.token, chan.id, newWH.id + "/" + newWH.token], () => { resolve(newWH) });
}


let flagNameToIds = {}; // { "chat": ["12345", "6789"], "joinleave": [ ... ] }
let chanIdToData = {}; // { "12345": { flags: {chat: true, joinleave: true}, whook_path?: "id/token" }, "6789": { ... } }

function getChannelsByFlag(flag) {
	if (!flagNameToIds[flag]) return [];
	return flagNameToIds[flag];
}

function getChannelFlags(chanId) {
	// TODO: maybe convert actual channel to id?
	if (!chanIdToData[chanId]) return {};
	return chanIdToData[chanId].flags;
}

module.exports.getChannelsByFlag = getChannelsByFlag;
module.exports.getChannelFlags = getChannelFlags;

async function addFlag(chanId, flagAdd, needWebhook) {
	return new Promise(async (resolve, reject) => {
		var webhookData = null;

		if (needWebhook) {
			// Check if we have a valid relay webhook there already first
			webhookData = await new Promise((resolve, reject) => {
				db.query("SELECT id FROM `webhooks` WHERE channel = ?", chanId, async function(err, res, fld) {
					if (res.length == 0) {
						// no relay webhooks stored; create one
						createWH(chan, resolve)
					} else {
						// we had some already; check if it still exists
						cl.fetchWebhook(res[0].id)
							.then((hook) => {
								if (!hook) {
									// didn't exist; create a new relay wh
									createWH(chan, resolve);
								} else {
									// existed; just reuse it
									resolve(hook);
								}
							})

							.catch(console.error);
					}
				})
			});
		}

		db.query("SELECT modes, whook_url FROM `relays` WHERE id = ?", chanId, async function(err, res, fld) {
			var newWH = webhookData ? (webhookData.id + "/" + webhookData.token)
			                        : res.whook_url

			if (res.length == 0) {
				// no modes registered before; make a new entry
				let newFlags = [flagAdd]

				db.query("INSERT INTO `relays`(id, modes, whook_url) VALUES(?, ?, ?)",
					[chanId, JSON.stringify(newFlags), newWH], (err) => {
						updateFlags();

						err ? reject(err)
						    : resolve(newFlags);
					})
			} else {
				// this channel had modes already, just push the new one and update the array (and webhook, maybe)
				let newFlags = JSON.parse(res[0].modes);
				if (newFlags.includes(flagAdd)) {
					reject("This channel already has this flag!");
					return;
				}

				newFlags.push(flagAdd);

				db.query("UPDATE `relays` SET modes = ?, whook_url = ? WHERE id = ?",
					[JSON.stringify(newFlags), newWH, chanId], (err) => {
						updateFlags();

						err ? reject(err)
						    : resolve(newFlags);
					});
			}
		})
	})
}

module.exports.addFlag = addFlag;

async function removeFlag(chanId, flagRemove) {
	return new Promise(async (resolve, reject) => {
		var curFlags = getChannelFlags(chanId);
		if (!curFlags[flagRemove]) {
			reject(`This channel doesn't have the **${flagRemove}** flag!`);
			return;
		}

		// https://dba.stackexchange.com/questions/293864/is-it-possible-to-remove-a-json-array-element-by-value-in-mysql
		db.query(`UPDATE \`relays\` SET
			modes = JSON_REMOVE( \`modes\`, JSON_UNQUOTE(JSON_SEARCH(\`modes\`, 'one', ?)) )
		WHERE id = ?;`,
		[flagRemove, chanId], async(err, res, fld) => {
			updateFlags();

			err ? reject(err)
			    : resolve();
		})
	})
}

module.exports.removeFlag = removeFlag;

function updateFlags() {
	db.query("SELECT * FROM `relays`", async function(err, res, fld) {
		if (err) {
			console.error(err);
			return;
		}

		chanIdToData = {};
		flagNameToIds = {};

		for (let row of res) {
			const chanId = row.id
			let modes
			try {
				modes = JSON.parse(row.modes) // god i hate js error handling
			} catch(e) {
				continue;
			}

			chanIdToData[chanId] = chanIdToData[chanId] || { flags: {}, whook_path: row.whook_url };

			// I wanted to use a bidirectional multimap here, but none of the packages fit the bill
			// They're either broken (more-maps) or are immutable (!?) (rimbu)
			// I guess we do it the old-fashioned two-maps way
			for (let mode of modes) {
				flagNameToIds[mode] = flagNameToIds[mode] || [];

				chanIdToData[chanId].flags[mode] = true;
				flagNameToIds[mode].push(chanId)
			}
		}
	})
}

setInterval(updateFlags, 15000);
updateFlags()