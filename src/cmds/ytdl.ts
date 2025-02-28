const ytdl = require("youtube-dl-exec").create("yt-dlp");
const { SlashCommandBuilder } = require('@discordjs/builders');

import * as flags from "libs/channel_flags";
import { formatBytes } from "libs/filesize";
import { log } from "libs/log";
import { Payload, RequestedDownload } from "youtube-dl-exec";
import path from "path";
import { CommandInteraction, InteractionEditReplyOptions, Message, MessagePayload } from "discord.js";
const url = require("url");

const maxMegsUploadSize = 10;
const maxUploadSize = maxMegsUploadSize * (1 << 20);

function isFormatNotFoundError(errStr: string) {
	// ugly but whatever, i don't have better ideas
	return errStr.includes("Requested format is not available. Use --list-formats for a list of available formats")
}

interface DownloadMetadata
	extends Payload, RequestedDownload {
		// https://github.com/microlinkhq/youtube-dl-exec/blob/master/src/index.d.ts#L229
		// https://github.com/microlinkhq/youtube-dl-exec/blob/master/src/index.d.ts#L57
		// probably a youtube-dl-exec bug
		language: string
	}

interface DownloadedVideo {
    filename: string;
    videoBuffer: Buffer;
	metadata: Payload;
}

function downloadVideo(link, lowQuality, audioOnly): Promise<DownloadedVideo> {
	// limit options to H265/VP9/H264
	// (av1 waiting room)
	var codecLimit = "[vcodec~='^(hevc.*|h265.*|vp0?9.*|avc.*|h264.*)']"

	var lqVid = lowQuality ? "[height<=480]" : ""
	var lqAud = lowQuality ? "[abr<=100]" : ""

	// https://github.com/yt-dlp/yt-dlp/issues/2518
	// https://github.com/yt-dlp/yt-dlp/issues/9530
	// i can write a custom format parser & selector probably, but ehhhhhhhh lmfao

	// UPDATE: i've so fucking had it with yt-dlp's filtering bullshit
	// we can't combine filters because yt-dlp is fucking stupid and either won't match if one of the filesizes is missing (when filters aren't optional),
	// or take the best possible video if both of the filesizes are missing (when filters are optional), even if its a billion megs
	// (for example, downloading this video would pick 617+250: https://youtu.be/bVLwYa46Cf0)
	// by the way this solution still sucks because, theoretically, if a lower-res video has filesize and higher-res only has filesize_approx (but is still <8meg),
	// the lower res will be preferred due to simply that filter being first
	// THERE IS NO WAY AROUND THIS WITHOUT APPLICATION-LOGIC FILTERING. WHICH REQUIRES TWO INVOCATIONS. THIS IS DOGSHIT
	var contentFormat = audioOnly ? `bestaudio${lqAud}`
		: `(` +
			   `(bv[filesize<8M]${codecLimit}${lqVid}+ba[filesize<2M]${lqAud})` +
			` / (bv[filesize<8M]${codecLimit}${lqVid}+ba[filesize_approx<2M]${lqAud})` +
			` / (bv[filesize_approx<8M]${codecLimit}${lqVid}+ba[filesize<2M]${lqAud})` +
			` / (bv[filesize_approx<8M]${codecLimit}${lqVid}+ba[filesize_approx<2M]${lqAud})` +
			` / best[filesize<9500K]${codecLimit}${lqVid}` +
			` / best[filesize_approx<9500K]${codecLimit}${lqVid}` +
		`)`

	var parsedLink: URL = url.parse(link);

	var tiktokWorkaround = (parsedLink.hostname ?? "").includes("tiktok")
		? "tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com;app_info=7355728856979392262"
		: undefined;

	// we can download both the video and the JSON metadata in one run (via `-j --no-simulate`)
	// video will be piped to stdout and JSON to stderr, but if a real error occurs, it'll go to stderr
	// awesome!
	const ytdlProcess = ytdl.exec(link, {
		o: '-',
		f: contentFormat,
		j: true,
		["no-simulate"]: true,
		["no-warnings"]: true,

		["extractor-args"]: tiktokWorkaround,
		["downloader-args"]: "-movflags frag_keyframe+empty_moov -f mp4",
	});


	var payloadPromise = new Promise<DownloadMetadata>((resolve, die) => {
		ytdlProcess.then((p) => {
			var errContents : string = p.stderr;

			try {
				var metadata : DownloadMetadata = JSON.parse(errContents);
				resolve(metadata);
			} catch {
				// should only throw if stderr wasn't a json (ie an actual error occured)
				// so just bubble up the contents of stderr
				die(errContents);
			}
		}).catch((err) => {
			if (err.stderr && isFormatNotFoundError(err.stderr)) {
				die("No formats available for embedding at this URL.");
				return;
			}

			die(err.stderr ?? err.message)
		});
	});

	var dlPromise = new Promise<Buffer>((resolve, die) => {
		// we receive via "data" event instead of just concatting process.stdout so we're able
		// to abort the download early in case it exceeds 10 megs (which shouldn't happen anymore tbf)
		let videoChunks : Buffer[] = [];
		let curSize = 0;

		function onData(chunk: Buffer) {
			videoChunks.push(chunk)
			curSize += chunk.length;

			if (curSize > maxUploadSize) {
				ytdlProcess.kill();
				ytdlProcess.stdout.removeListener("data", onData);
				die(`Downloaded filesize exceeded (${formatBytes(curSize)}+ / ${formatBytes(maxUploadSize)})`);
				return;
			}
		}

		ytdlProcess.stdout
			.on("data", onData)
			.on("close", () => {
				resolve(Buffer.concat(videoChunks))
			});

		ytdlProcess.catch((err) => die(err.stderr));
	});

	return Promise.all([payloadPromise, dlPromise])
		.then(([payload, videoBuffer]) => {
			let fn = payload.title
				? path.format({ name: payload.title, ext: "mp4" /* see: extractor-args */ })
				: payload.filename;

			fn = fn.replace(",", ""); // discord tweaks out if u have a comma in the name for some reason ???

			if (audioOnly) {
				// youtube started serving webms as audio formats?
				// also it puts a newline at the end just to make my life miserable
				fn = fn.replace(/\.webm\n?$/, ".ogg")
			}

			return {
				filename: fn,
				videoBuffer: videoBuffer,
				metadata: payload
			}
		})
}

function vcodecToFriendly(vcodec: string) {
	if (vcodec.match(/^(avc|h264)/)) return "H264 (AVC)";
	if (vcodec.match(/^(hevc|h265)/)) return "H265 (HEVC)";
	if (vcodec.match(/^vp0?9/)) return "VP9";

	return vcodec;
}

function videoDataToMessage(videoData: DownloadedVideo, shouldSpoiler = false) : InteractionEditReplyOptions {
	return {
		content: `-# ${videoData.metadata.resolution} / ${formatBytes(videoData.videoBuffer.length)} / ${vcodecToFriendly(videoData.metadata.vcodec)}`,
		files: [
			{
				name: shouldSpoiler ? `SPOILER_${videoData.filename}` : videoData.filename,
				attachment: videoData.videoBuffer,
			}
		]
	}
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ytdl')
		.setDescription('download via yt-dlp')
		.addStringOption(option =>
			option.setName('link')
				.setDescription('URL of whatever you want to download')
				.setRequired(true))
		.addBooleanOption(option =>
					option.setName('audioonly')
						.setDescription('whether you want only the audio')
						.setRequired(false))
		.addBooleanOption(option =>
					option.setName('lowquality')
						.setDescription('whether you want low quality (<=480p, <=100kbps audio)')
						.setRequired(false))

		,

	async execute(interaction : CommandInteraction) {
		let audioOnly = interaction.options.getBoolean('audioonly');
		let lowQuality = interaction.options.getBoolean('lowquality');
		let link = interaction.options.getString('link');

		let replyPromise = interaction.deferReply({ fetchReply: true });
		let videoPromise = downloadVideo(link, lowQuality, audioOnly);

		await replyPromise;

		try {
			let videoData = await videoPromise

			try {
				await interaction.editReply(videoDataToMessage(videoData))
			} catch(err) {
				interaction.editReply({ content: `failed to embed the new file. too large? (${formatBytes(videoData.videoBuffer.length)})\n\n${err}` });
				if (err.stack) {
					log.warn(err.stack);
				}
			}
		} catch(err) {
			interaction.editReply({ content: "Error while downloading: " + err });
		}
	},
};


var audioFlags = {
	["audioonly"]: true,
	["audio"]: true,
}

var lqFlags = {
	["lq"]: true,
	["lowquality"]: true,
}

global.Botto.on("ogCommandInvoked", (msg: Message, cmd, ...args) => {
	if (cmd != "ytdl") return;

	let audioOnly = false;
	let lowQuality = false;

	let idx = args.findIndex(x => audioFlags[x.toLowerCase()]);
	if (idx >= 0) {
		audioOnly = true;
		args.splice(idx, 1);
	}

	idx = args.findIndex(x => lqFlags[x.toLowerCase()]);
	if (idx >= 0) {
		lowQuality = true;
		args.splice(idx, 1);
	}

	var link = args[0];
	if (!link) {
		msg.reply("no link found in your message")
		return;
	}

	var videoPromise = downloadVideo(link, lowQuality, audioOnly);

	videoPromise.then((data) => {
		msg.reply(videoDataToMessage(data))
			.catch((err) => {
				msg.reply({ content: `failed to embed the new file. too large? (${formatBytes(data.videoBuffer.length)})\n\n${err.substring(0, 512)}` });
				if (err.stack) {
					console.log(err.stack);
				}
			})
	}, (err) => {
		msg.reply({ content: "Error while downloading: " + err });
	})
});

const eligibleRegexes = [
	// instagram reels
	/https?:\/\/(?:www\.)?instagram\.com\/reels?\/\w+/g,

	// tiktok
	/https?:\/\/(?:www\.)?tiktok\.com\/.+\/video\/\d+/g,
	/https?:\/\/(?:www\.)?tiktok\.com\/t\/\w+/g,
	/https?:\/\/vm\.tiktok\.com\/[^\/]+/g,

	// x.com / vxtwitter
	/https?:\/\/(?:x\.com|vxtwitter\.com)\/[^\/]+\/status\/.+/g,
];

global.Botto.on('noncommandMessage', async (message: Message) => {
	if (message.author.bot) return;

	var chanFlags = flags.getChannelFlags(message.channel.id);
	if (!chanFlags.ytdl) return;

	var url;

	for (var regex of eligibleRegexes) {
		url = message.content.match(regex)

		if (url) {
			url = url[0]
			break;
		}
	}

	if (!url) return;

	var videoPromise = downloadVideo(url, false, false)
		.then((videoData) => {
			message.reply(videoDataToMessage(videoData))
				.then(() => message.suppressEmbeds(true))
				.catch((err) => {
					if (err.stack) {
						console.log(err.stack);
					}
				});
		}, (err) => {
			let reactions = {
				"❌": () => {
					message.reply(err.substring(0, 512));
					for (let r in reactions) {
						message.reactions.cache.get(r).remove()
					}
				}
			}

			let handled = false;

			const filter = (react, user) => {
				if (handled) return false;
				if (!reactions[react.emoji.name]) return false;

				if (user.id == message.author.id) {
					return true;
				}
			}

			let coll = message.createReactionCollector({time: 60 * 15 * 1000, filter: filter});
			coll.on("collect", (reaction, user) => {
				if (handled) return;

				handled = true;
				reactions[reaction.emoji.name] (message, user);
			});

			let prs = Promise.resolve();
			for (let emoji in reactions) {
				prs = prs.then(() => {
					message.react(emoji)
				});
			}
		});
});