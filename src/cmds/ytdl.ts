const ytdl = require("youtube-dl-exec").create("yt-dlp");
const { SlashCommandBuilder } = require('@discordjs/builders');

import * as flags from "libs/channel_flags";
import { formatBytes } from "libs/filesize";
import { log } from "libs/log";
import { Payload, RequestedDownload } from "youtube-dl-exec";
import path from "path";

const maxMegsUploadSize = 10;
const maxUploadSize = maxMegsUploadSize * (1 << 20);

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
	var lqVid = lowQuality ? "[height<=480][filesize_approx<8M]" : "[filesize_approx<8M]"
	var lqAud = lowQuality ? "[abr<=100][filesize_approx<2M]" : "[filesize_approx<2M]"

	// https://github.com/yt-dlp/yt-dlp/issues/2518
	// https://github.com/yt-dlp/yt-dlp/issues/9530
	// i can write a custom format parser & selector probably, but ehhhhhhhh lmfao
	var contentFormat = audioOnly ? `bestaudio${lqAud}`
		: `(` +
			// 1. try split h265
			`(bv[vcodec~='^(hevc.*|h265.*)']${lqVid})+` +
				`ba${lqAud}` +
			// 2. try split VP9 webm
			`/ (bv[vcodec~='^vp0?9.*']${lqVid})+` +
				`ba${lqAud}` +
			// 3. try split H264 mp4
			`/ (bv[vcodec~='^(avc.*|h264.*)']${lqVid})+` +
				`ba${lqAud}` +
			// 4. try premerged h265/vp9/h264
			`/ b[vcodec~='^h265']${lqVid}${lqAud}` +
			`/ b[vcodec~='^(vp0?9.*)']${lqVid}${lqAud}` +
			`/ b[vcodec~='^(avc.*|h264.*)']${lqVid}${lqAud}` +
			// 5. go for the best video (probably wont embed though)
			`/ bv${lqVid}+ba${lqAud}` +
			`/ best${lqVid}` +
		`)`
	
	/*
	var filters = [
		"[filesize<10M]",
		"[filesize_approx<10M]",
		"[filesize_approx<?10M]",
	]
	*/

	// this fucking reeks
	var format = contentFormat // + filters.join(" / " + contentFormat)
	// lemme get uhhhhhh
	// ((bv[vcodec~='^vp0?9.*'])+ba/ (bv[vcodec~='^(avc.*|h264.*)'])+ba/ b[vcodec~='^(vp0?9.*)']/ b[vcodec~='^(avc|h264.*)']/ bv+ba/ best)[filesize<25M] / ((bv[vcodec~='^vp0?9.*'])+ba/ (bv[vcodec~='^(avc.*|h264.*)'])+ba/ b[vcodec~='^(vp0?9.*)']/ b[vcodec~='^(avc|h264.*)']/ bv+ba/ best)[filesize_approx<25M] / ((bv[vcodec~='^vp0?9.*'])+ba/ (bv[vcodec~='^(avc.*|h264.*)'])+ba/ b[vcodec~='^(vp0?9.*)']/ b[vcodec~='^(avc|h264.*)']/ bv+ba/ best)[filesize_approx<?25M]

	var parsedLink = URL.parse(link)
	var tiktokWorkaround = (parsedLink.hostname ?? "").includes("tiktok")
		? "tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com;app_info=7355728856979392262"
		: undefined;

	// we can download both the video and the JSON metadata in one run (via `-j --no-simulate`)
	// video will be piped to stdout and JSON to stderr, but if a real error occurs, it'll go to stderr
	// awesome!
	const ytdlProcess = ytdl.exec(link, {
		o: '-',
		f: format,
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
		})
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
				? path.format({ name: payload.title, ext: payload.ext })
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

function videoDataToMessage(videoData: DownloadedVideo, shouldSpoiler = false) {
	var fn = videoData.filename;
	var buf = videoData.videoBuffer;

	return {
		files: [
			{
				name: shouldSpoiler ? `SPOILER_${fn}` : fn,
				attachment: buf,
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
// yt-dlp -f "(bv[vcodec~='^(avc|h264.+)'][ext~='^(mp4)']+ba[ext~='^(m4a)'] / bv[vcodec~='^(vp8|vp9)'][ext~='^(webm)']+ba[ext~='^(webm)'])[filesize<8M]" https://www.youtube.com/watch?v=bFLBEjSSwnw
	async execute(interaction) {
		let audioOnly = interaction.options.getBoolean('audioonly');
		let lowQuality = interaction.options.getBoolean('lowquality');
		let link = interaction.options.getString('link');

		let replyPromise = interaction.deferReply({ fetchReply: true });
		
		try {
			let videoData = await downloadVideo(link, lowQuality, audioOnly);
			await replyPromise;
			
			try {
				await interaction.editReply(videoDataToMessage(videoData))
			} catch(err) {
				interaction.editReply({content: `failed to embed the new file. too large? (${formatBytes(videoData.videoBuffer.length)})\n\n${err.substring(0, 512)}`, ephemeral: true});
				if (err.stack) {
					log.warn(err.stack);
				}
			}
		} catch(err) {
			interaction.editReply({content: "Error while downloading: " + err.substring(0, 512), ephemeral: true});
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

global.Botto.on("ogCommandInvoked", (msg, cmd, ...args) => {
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
				msg.reply({content: `failed to embed the new file. too large? (${formatBytes(data.videoBuffer.length)})\n\n${err.substring(0, 512)}`, ephemeral: true});
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

global.Botto.on('noncommandMessage', async (message) => {
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