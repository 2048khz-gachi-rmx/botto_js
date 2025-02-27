import { SlashCommandBuilder } from "@discordjs/builders";
import path from "path";
import { connection as db } from "./mysql_db";
import { Channel, Client } from "discord.js";
import { log } from "./log";

var client : Client = global.Botto

async function createWH(chan, resolve) {
	let newWH = await chan.createWebhook("Relay");
	db.query("INSERT INTO `webhooks` (id, token, channel, url) VALUES(?, ?, ?, ?)",
		[newWH.id, newWH.token, chan.id, newWH.id + "/" + newWH.token], () => { resolve(newWH) });
}

let flagNameToIds = {}; // { "chat": ["12345", "6789"], "joinleave": [ ... ] }
let chanIdToData = {}; // { "12345": { flags: {chat: true, joinleave: true}, whook_path?: "id/token" }, "6789": { ... } }

export function getChannelsByFlag(flag) {
	if (!flagNameToIds[flag]) return [];
	return flagNameToIds[flag];
}

export function getChannelFlags(chanId) {
	// TODO: maybe convert actual channel to id?
	if (!chanIdToData[chanId]) return {};
	return chanIdToData[chanId].flags;
}

/**
 * @deprecated This function is really old and needs to be rewritten and tested. I'm pretty sure it doesn't work...
 */
async function createWebhook(chan: Channel) {
	// Check if we have a valid relay webhook there already first
	return new Promise((resolve, reject) => {
		db.query("SELECT id FROM `webhooks` WHERE channel = ?", chan.id, async function(err, res, fld) {
			if (res.length == 0) {
				// no relay webhooks stored; create one
				createWH(chan, resolve)
			} else {
				// we had some already; check if it still exists
				client.fetchWebhook(res[0].id)
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

export async function addFlag(chan: Channel, flagAdd: string, needWebhook): Promise<string[]> {
	return new Promise(async (resolve, reject) => {
		var webhookData = null;

		if (needWebhook) {
			log.warn("channel flag adding with webhook: it probably doesn't work!");
			createWebhook(chan);
		}

		db.query("SELECT modes, whook_url FROM `relays` WHERE id = ?", chan.id, async function(err, res, fld) {
			var newWH = webhookData ? (webhookData.id + "/" + webhookData.token)
			                        : res.whook_url

			if (res.length == 0) {
				// no modes registered before; make a new entry
				let newFlags = [flagAdd]

				db.query("INSERT INTO `relays`(id, modes, whook_url) VALUES(?, ?, ?)",
					[chan.id, JSON.stringify(newFlags), newWH], (err) => {
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
					[JSON.stringify(newFlags), newWH, chan.id], (err) => {
						updateFlags();

						err ? reject(err)
						    : resolve(newFlags);
					});
			}
		})
	})
}

export async function removeFlag(chanId, flagRemove) {
	return new Promise<void>(async (resolve, reject) => {
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

// poll the db every N seconds and update channel flags
// realistically, this should be a VERY VERY rare occurence when this actually does anything,
// as servers should have only one instance, and that instance will be the one updating the flags
// (i.e. will already know of the new flags)
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