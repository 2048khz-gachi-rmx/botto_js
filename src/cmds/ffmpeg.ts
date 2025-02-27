import { SlashCommandBuilder } from "@discordjs/builders";
import path from "path";
import fs from "node:fs";
import https from "https";
import { randomUUID } from "crypto";
import { Client, Message, MessageReaction, ReactionCollector, User } from "discord.js";
import { log } from "libs/log";
import { FfmpegResult, tempDirPath, vp9 } from "libs/ffmpeg";
import * as flags from "libs/channel_flags";
import cfg from "config";
import { formatBytes } from "libs/filesize";

const client : Client = global.Botto;

function downloadFile(url, fn) {
	return new Promise<void>((resolve, reject) => {
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

const discordCdnRegex = /https?:\/\/(?:media|cdn)\.discord(?:app)?.(?:net|com)\/attachments\/(\d{18,}\/\d{18,})\/(.*\.\w{3,}).*$/g;
const videoExtsRegex = /\.(mov|mp4|webm)$/g; // mkv's arent embeddable anyhow

async function compressMessageEmbeds(message: Message) {
	let toDownload : { url: string, name: string }[] = [];
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

	let compressPromises = [];
	message.channel.sendTyping();
	const intervalId = setInterval(() => message.channel.sendTyping(), 5000);
	let results;

	try {
		// run every attached video through ffmpeg
		toDownload.forEach(att => {
			let uuid = randomUUID().replace("-", "");
			let outName = path.basename(att.name).replace(path.extname(att.name), ".webm");

			let dlPath = path.join(tempDirPath, "tmp" + uuid);

			let prom = downloadFile(att.url, dlPath)
				.then(() => vp9.twopass(dlPath))
				.then((result: FfmpegResult) => ({
					// replace whatever extension the original had with `.webm`
					name: outName,
					path: result.resultPath,
					dlStats: fs.statSync(dlPath),
					outStats: fs.statSync(result.resultPath),
				}))
				.finally(() => {
					fs.unlink(dlPath, () => {});
				})

			compressPromises.push(prom)
		});

		results = await Promise.all(compressPromises)
			.catch((why) => {
				log.error("ffmpeg error during conversion: %s", why);
			});
	} finally {
		clearInterval(intervalId);
	}

	if (!results) return;

	let toEmbed : {name: string, attachment: string}[] = [];

	let ratioNeverThreshold : number = cfg.get("recompress_percent_never_threshold");
	let ratioAlwaysThreshold : number = cfg.get("recompress_percent_always_threshold");
	let absoluteThreshold : number = cfg.get("recompress_filesize_threshold"); // the difference in filesize must be at least this big

	let oldTotal = 0;
	let newTotal = 0;

	for (let result of results) {
		oldTotal += result.dlStats.size;
		newTotal += result.outStats.size;

		toEmbed.push({name: result.name, attachment: result.path});
	}

	let perc = Math.ceil(newTotal / oldTotal * 100)
	let replyPromises = [];
	let ratio = newTotal / oldTotal;

	if (toEmbed.length > 0
		&& (ratio > ratioNeverThreshold	 || oldTotal - newTotal < absoluteThreshold)
		&& ratio > ratioAlwaysThreshold) {

		log.warn(`not sending compressed video (${perc}% / ${formatBytes(oldTotal - newTotal)} saving)`);

	} else if (toEmbed.length > 0) {
		// send all recompressed videos as one message
		let compText = `(${formatBytes(oldTotal)} -> ${formatBytes(newTotal)} (${perc}%))`
		let replyText = replyContent.length > 0 ? `${message.author.username}: ${replyContent}\n${compText}`
						: `by ${message.author.username} ${compText}:`;

		let pr = message.channel.send({
			content: replyText,
			files: toEmbed,
		});

		let deleteEmoji = Math.random() < 0.01 ? "<:ouse:1164630871589003326>" : "🖕"

		const reactions = {
			"👍": (botMsg: Message) => {
				try {
					message.delete()
				} catch {}

				for (let r in reactions) {
					try {
						botMsg.reactions.cache.get(r).remove()
					} catch {}
				}
			},

			[deleteEmoji]: (botMsg: Message) => {
				try {
					botMsg.delete()
				} catch {}
			},
		}

		let handled = false;
		let coll : ReactionCollector;

		const filter = (react: MessageReaction, user: User) => {
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

		replyPromises.push(pr.then((msg : Message) => {
			coll = msg.createReactionCollector({time: 60 * 60 * 6 * 1000, filter: filter});
			coll.on("collect", (reaction, user) => {
				if (handled) return;

				handled = true;
				reactions[reaction.emoji.name] (msg);
			});

			let prs = Promise.resolve();
			for (let emoji in reactions) {
				prs = prs.then(() => {
					msg.react(emoji)
				});
			}

			return prs;
		}));
	}

	Promise.all(replyPromises)
		.catch((why) => {
			log.error("failed to send discord message!? %s", why);
		})
		.finally(() => {
			for (let result of results) {
				fs.unlink(result.path, () => {});
			}
		})
}

global.Botto.on('messageCreate', async (message) => {
	if (message.author.bot) return;
	if (!message.attachments || message.attachments.length == 0) return;

	let chanFlags = flags.getChannelFlags(message.channel.id);
	if (!chanFlags.vidCompress) return;

	compressMessageEmbeds(message);
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
