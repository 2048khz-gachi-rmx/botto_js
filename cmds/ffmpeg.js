const { SlashCommandBuilder } = require('@discordjs/builders');
const path = require("path");
const flags = require(path.join(require.main.path, "libs", "channel_flags"));
const fs = require("node:fs");
const os = require("node:os");
const https = require('https');
const { randomUUID } = require('crypto');
const ffmpeg = require("fluent-ffmpeg");
const { filesize } = require("filesize");
const client = global.Botto
const log = client.log;

var tempDirPath;

fs.mkdir(`${os.tmpdir()}${path.sep}botto_vids`, (err, dir) => {
	if (err && err.code != "EEXIST") {
		log.error("failed to create temp video folder:", err);
		return;
	}

	tempDirPath = `${os.tmpdir()}${path.sep}botto_vids`;

	fs.readdir(tempDirPath, (err, files) => {
		if (err) {
			log.error("failed to cleanup temp video folder:", err);
			return;
		}

		for (const file of files) {
			fs.unlink(path.join(tempDirPath, file), () => {});
		}
	});
});

function downloadFile(url, fn) {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if (res.statusCode === 200) {
                res.pipe(fs.createWriteStream(fn))
                	.on('error', reject)
                	.on("close", resolve)
            } else {
                res.resume();
                reject(new Error(`Request Failed With a Status Code: ${res.statusCode}`));
            }
		})
	})
}

/* god this sucks LMAO */
function fsWrapPromise(fn, ...args) {
	return new Promise((resolve, reject) => {
		fn(...args, (err, result) => {
			if (err) return reject(err);
			resolve(result);
		})
	})
}

const discordCdnRegex = /https?:\/\/(?:media|cdn)\.discord(?:app)?.(?:net|com)\/attachments\/(\d{18,}\/\d{18,})\/(.*\.\w{3,}).*$/g;
const videoExtsRegex = /\.(mov|mp4|webm)$/g; // mkv's arent embeddable anyhow

async function compressMessageEmbeds(message, compressMethod) {
	let toDownload = [
		// { name: string, url: string }
	]

	let replyContent = message.cleanContent

	message.attachments.each(att => {
		let typ = att.contentType;
		if (!typ || !typ.startsWith("video/")) return;

		toDownload.push({name: att.name, url: att.url});
	})

	if (replyContent) {
		// try extracting URLs from the message in an attempt to grab shit like "https://cdn.discordapp.net/..."
		const txt = replyContent
		let added = {};

		for (let match of txt.matchAll(discordCdnRegex)) {
			const url = match[0];
			const id = match[1];
			if (added[id]) continue;
			added[id] = true;

			const fn = match[2].toLowerCase();
			if (!fn.match(videoExtsRegex)) continue; // not a video (probably)

			replyContent = replyContent.replace(url, "");
			toDownload.push({name: fn, url: url})
		}
	}

	if (toDownload.length == 0) return;

	let outputs = [];
	message.channel.sendTyping();
	const intervalId = setInterval(() => message.channel.sendTyping(), 5000);
	let results;

	try {
		// run every attached video through ffmpeg
		toDownload.forEach(att => {
			let uuid = randomUUID().replace("-", "");
			let dlPath = path.join(tempDirPath, "tmp" + uuid);

			outputs.push( new Promise((res, rej) => {
					downloadFile(att.url, dlPath)
						.then(() => compressMethod(uuid, dlPath, att.name, res, rej))
						.catch(rej)
				})
				.finally(() => {
					fs.unlink(dlPath, () => {});
					fs.unlink(`${uuid}-0.log`, () => {}); // Delete the ffmpeg 2-pass log file
				})
			)
		});

		results = await Promise.all(outputs)
			.catch((why) => {
				log.error("ffmpeg error during conversion: %s", why);
			});
	} finally {
		clearInterval(intervalId);
	}

	if (!results) return;

	let toEmbed = [];
	let ratioThreshold = 0.75;

	let oldTotal = 0;
	let newTotal = 0;
	/* result = {
		att = discordjs_attachment,
		dlStats = fs.stat(inputPath),
		outStats = fs.stat(outputPath),
		path = outputPath,
	} */

	for (let result of results) {
		oldTotal += result.dlStats.size;
		newTotal += result.outStats.size;

		toEmbed.push({name: result.name, attachment: result.path});
	}

	let perc = Math.ceil(newTotal / oldTotal * 100)
	let msgOutputs = [];

	if (newTotal > 0 && newTotal / oldTotal > ratioThreshold) {
		log.warn(`not sending compressed video (${perc}% saving)`);

	} else if (toEmbed.length > 0) {
		// then send them over
		let compText = `(${filesize(oldTotal)} -> ${filesize(newTotal)} (${perc}%))`
		let replyText = replyContent.length > 0 ? `${message.author.username}: ${replyContent}\n${compText}`
						: `by ${message.author.username} ${compText}:`;

		let pr = message.channel.send({
			content: replyText,
			files: toEmbed,
		});

		let deleteEmoji = Math.random() < 0.01 ? "<:ouse:1164630871589003326>" : "🖕"

		const reactions = {
			"👍": (botMsg, user) => {
				try {
					message.delete()
					for (let r in reactions) {
						botMsg.reactions.cache.get(r).remove()
					}
				} catch { }
			},

			[deleteEmoji]: (botMsg, user) => {
				try {
					botMsg.delete()
				} catch { }
			},
		}

		let handled = false;
		let coll;

		const filter = (react, user) => {
			if (handled) return false;
			if (!reactions[react.emoji.name]) return false;

			if (user.id == message.author.id) {
				return true;
			}

			let guild = message.guild;
			if (!guild) return false;

			guild.members.fetch({
				user: user.id,
				cache: true,
				force: false,
			}).then((mem) => {
				if (mem.permissions.has("ADMINISTRATOR")) {
					coll.emit("collect", react, user); // eek!
				}
			})

			return false; // Asynchronous fetch above; we'll call the collect manually
		}

		msgOutputs.push(pr.then((msg) => {
			coll = msg.createReactionCollector({time: 60 * 60 * 6 * 1000, filter: filter});
			coll.on("collect", (reaction, user) => {
				if (handled) return;

				handled = true;
				reactions[reaction.emoji.name] (msg, user);
			});

			let prs = Promise.resolve();
			for (let emoji in reactions) {
				prs = prs.then(() => {
					msg.react(emoji)
				});
			}

			return prs;
		}));

		// message.delete();
	}

	Promise.all(msgOutputs)
		.then((arr) => {
			// ?
		})
		.catch((why) => {
			log.error("failed to send discord message!? %s", why);
		})
		.finally(() => {
			for (let result of results) {
				fs.unlink(result.path, () => {});
			}
		})
}

function convert_VP9_2Pass(uuid, inPath, embedname, res, rej) {
	const crf = 35
	let outPath = path.join(tempDirPath, "out" + uuid);
	let outName = embedname ? path.basename(embedname).replace(path.extname(embedname), ".webm")
	                        : "vp9comp_" + uuid.substring(1, 8) + ".webm"

	let pass1 = ffmpeg(inPath)
		.addOutputOptions([
			"-c:v libvpx-vp9",
			"-b:v 0",
			"-row-mt 1", // nice multithreading
			`-crf ${crf}`,
			`-passlogfile ${uuid}`
		])

	let pass2 = pass1.clone();

	pass1.addOption("-pass 1")
		.noAudio()
		.format("null")
		.output("-")
		.on("error", (err) => pass2.emit("error", err))
		.on("end", () => {
			pass2.save(outPath)
		});

	pass2.outputOption("-pass 2")
		.outputOption("-c:a libopus")
		.outputOption("-b:a 64k")
		.outputOption("-speed 2")
		.format("webm")
		.on("error", rej)
		.on('end', () => {
			Promise.all([
				fsWrapPromise(fs.stat, inPath),
				fsWrapPromise(fs.stat, outPath),
			]).then((vals) => {
				res({
					// replace whatever extension the original had with `.webm`
					name: outName,
					path: outPath,
					dlStats: vals[0],
					outStats: vals[1],
				})
			})
		})

	pass1.run();
}

global.Botto.on('messageCreate', async (message) => {
	if (message.author.bot) return;
	if (!message.attachments || message.attachments.length == 0) return;

	let chanFlags = flags.getChannelFlags(message.channel.id);
	if (!chanFlags.vidCompress) return;

	compressMessageEmbeds(message, convert_VP9_2Pass);
});

/*
module.exports = {
	data: new SlashCommandBuilder()
		.setName('ffmpeg')
		.setDescription('convert an embed')
		.addAttachmentOption(option =>
			option.setName("attachment")
				.setDescription("what to convert (if not provided, uses the last message's embeds)")
			)
		.addStringOption(option =>
			option.setName('format')
				.setDescription('what file to convert it to')
				.addChoices(
					{ name: "(default) Video - VP9", value: "vp9", },
					{ name: "Video - x264", value: "x264", },
					{ name: "(default) Image - WebP", value: "webp", }
				)
		),

	async execute(it) {
		let att = interaction.options.getAttachment('attachment');
		let fmt = interaction.options.getString('format');

		console.log(att, fmt);

		let sender = it.user;
		let chan = it.channel;
	},
};
*/
