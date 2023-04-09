
const { SlashCommandBuilder } = require('@discordjs/builders');
require.main.require('./libs/gmysql.js');
var db = global.DB
var client = global.Bot

async function createWH(chan, resolve) {
	let newWH = await chan.createWebhook("Relay");
	db.query("INSERT INTO `webhooks` (id, token, channel, url) VALUES(?, ?, ?, ?)",
		[newWH.id, newWH.token, chan.id, newWH.id + "/" + newWH.token], () => {resolve(newWH)});
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('addrelay')
		.setDescription('admin only')

		.addStringOption(option =>
			option.setName('name')
				.setDescription('relay name')
				.setRequired(true))
	,

	async execute(it) {
		var sender = it.user;
		var mgr = it.guild.members;

		var member = await mgr.fetch(sender);

		if (!member.permissions.has("ADMINISTRATOR")) {
			return false;
		}

		var chan = it.channel;

		let pr = new Promise((resolve, reject) => {
			db.query("SELECT id FROM `webhooks` WHERE channel = " + chan.id, async function(err, res, fld) {
				if (res.length == 0) {
					console.log("no webhook");
					createWH(chan, resolve)
				} else {
					console.log(res);
					console.log(res[0])
					cl.fetchWebhook(res[0].id)
						.then((hook) => {
							if (!hook) {
								createWH(chan, resolve);
							}
							else {
								console.log("hook:" + hook.name);
								resolve(hook);
							}
						})

						.catch(console.error);
				}
			})
		});

		let cl = global.Bot;

		var wh = await pr;
		let mode = it.options.getString("name")

		db.query("SELECT modes FROM `relays` WHERE id = " + chan.id, async function(err, res, fld) {
			if (res.length == 0) {
				// no webhook relay registered
				let modes = [ it.options.getString("name") ]

				db.query("INSERT INTO `relays`(id, modes, whook_url) VALUES(?, ?, ?)",
					[chan.id, JSON.stringify(modes), wh.id + "/" + wh.token], () => {
						it.reply(`Added mode ${mode}, new modes: ${modes}`);
					})
			} else {
				let modes = JSON.parse(res[0].modes);

				modes.push(mode);
				db.query("UPDATE `relays` SET modes = ? WHERE id = ?",
					[JSON.stringify(modes), chan.id], () => {
						it.reply(`Added mode ${mode}, new modes: ${modes}`);
					});
			}
		})
	},
};

// pihole pw oR_7N7cq

let relayIDs = {};

setInterval(updateRelays, 15000);

function updateRelays() {
	relayIDs = {};

	db.query("SELECT id FROM `relays` WHERE json_search(`modes`, 'one', ?) IS NOT NULL", ["chat"], async function(err, res, fld) {
		if (err) {
			console.error(err);
			return;
		}
		for (let id of res) {
			relayIDs[id.id] = true;
		}
	})
}

updateRelays()

global.Bot.on('messageCreate', async (message) => {
	if (message.author.bot) return;
	if (!relayIDs[message.channel.id]) return;
	let col = message.member.displayColor;

	global.GmodWSS.SendMessage(
		[(col & 0xFF0000) >> 16, (col & 0xFF00) >> 8, (col & 0xFF)],
		message.member.displayName,
		message.content
	)
});

global.Bot.on('commits', async (core, head, coms) => {
	if (coms.length == 0)
		return;

	let embed = {
		color: 0x7289da,

		author: {
			name: core.sender,
			url: core.senderURL,
			icon_url: core.senderAvatar
		},

		title: "⚠️honey " + coms.length + " new " + core.repoName + " commit" + ((coms.length > 1 && "s") || "") +
			" just dropped⚠️ ",
		url: core.repoURL,

		timestamp: new Date(),

		footer: {
			icon_url: core.senderAvatar,
			text: core.branch + " branch"
		}
	}

	let desc = "";
	for (let com of coms) {
		desc += "[`" + com.hash.substring(0, 7) + "`](" + com.url + ") - " +
			com.message.split(/\r?\n/)[0] + " // " + com.author + "\n"
	}

	embed.description = desc

	db.query("SELECT id FROM `relays` WHERE json_search(`modes`, 'one', ?) IS NOT NULL", ["github"], async function(err, res, fld) {
		if (err) {
			throw err; // not much we can really do, eh?
		}

		for (let id of res) {
			client.channels.fetch(id.id).then(
				(c) => { c.send({ embeds: [embed] }); }
			)
		}
	})
});
