const ytdl = require("youtube-dl-exec").create("yt-dlp");
const path = require("path");
const url = require("url");
const flags = require(path.join(require.main.path, "libs", "channel_flags"));

const { MessagePayload, AttachmentBuilder, Client, Events, GatewayIntentBits } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');

function formatBytes(bytes, decimals = 2) {
	if (!+bytes) return '0 Bytes'

	const k = 1024
	const dm = decimals < 0 ? 0 : decimals
	const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB']

	const i = Math.floor(Math.log(bytes) / Math.log(k))

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

function downloadVideo(link, lowQuality, audioOnly) {
	var lqVid = lowQuality ? "[height<=480]" : ""
	var lqAud = lowQuality ? "[abr<=100]" : ""

	var contentFormat = audioOnly ? `bestaudio${lqAud}`
		: `(` +
			// 1. try split VP9 webm
			`(bv[vcodec~='^vp0?9.*']${lqVid})+` +
				`ba${lqAud}` +
			// 2. try split H264 mp4
			`/ (bv[vcodec~='^(avc.*|h264.*)']${lqVid})+` +
				`ba${lqAud}` +
			// 3. try premerged h264 or vp9
			`/ b[vcodec~='^(vp0?9.*)']${lqVid}${lqAud}` +
			`/ b[vcodec~='^(avc.*|h264.*)']${lqVid}${lqAud}` +
			// 4. go for the best video (probably wont embed though)
			`/ bv${lqVid}+ba${lqAud}` +
			`/ best` +
		`)`

	var filters = [
		"[filesize<25M]",
		"[filesize_approx<25M]",
		"[filesize_approx<?25M]",
	]

	// this fucking reeks
	var format = contentFormat + filters.join(" / " + contentFormat)
	// lemme get uhhhhhh
	// ((bv[vcodec~='^vp0?9.*'])+ba/ (bv[vcodec~='^(avc.*|h264.*)'])+ba/ b[vcodec~='^(vp0?9.*)']/ b[vcodec~='^(avc|h264.*)']/ bv+ba/ best)[filesize<25M] / ((bv[vcodec~='^vp0?9.*'])+ba/ (bv[vcodec~='^(avc.*|h264.*)'])+ba/ b[vcodec~='^(vp0?9.*)']/ b[vcodec~='^(avc|h264.*)']/ bv+ba/ best)[filesize_approx<25M] / ((bv[vcodec~='^vp0?9.*'])+ba/ (bv[vcodec~='^(avc.*|h264.*)'])+ba/ b[vcodec~='^(vp0?9.*)']/ b[vcodec~='^(avc|h264.*)']/ bv+ba/ best)[filesize_approx<?25M]

	var parsedLink = url.parse(link)
	var tiktokWorkaround = (parsedLink.hostname ?? "").includes("tiktok")
		? "tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com;app_info=7355728856979392262"
		: undefined;

	const subprocess = ytdl.exec(link, {
		o: '-',
		f: format,

		["extractor-args"]: tiktokWorkaround,
		["downloader-args"]: "-movflags frag_keyframe+empty_moov -f mp4",
	});

	const fnSub = ytdl.exec(link, {
		print: 'filename',
		o: '%(title.0:64)S_%(id)s.%(ext)s',
		f: format,

		["extractor-arg"]: tiktokWorkaround,
	})

	var fnPromise = new Promise((resolve, die) => {
		var out = false;

		fnSub.stdout.on("data", (chunk) => {
			out = chunk;
		})
		.on("close", () => {
			if (!out) {
				die("No output; perhaps there are no valid download options?");
				return;
			}

			// discord does NOT like commas in the filename
			// there might be other characters but so far only this one popped up
			resolve(out)
		})
	});

	var dlPromise = new Promise((resolve, die) => {
		let chunks = []; // basically an array of buffers
		let curSize = 0;

		subprocess.stdout
			.on("data", (chunk) => {
				chunks.push(chunk)
				curSize += chunk.length;

				if (curSize > module.maxUploadSize) {
					subprocess.kill();
					die(`Downloaded filesize exceeded (${formatBytes(curSize)})`);
					return;
				}
			})
			.on("close", () => {
				resolve(Buffer.concat(chunks))
			})
	});

	return Promise.all([fnPromise, dlPromise])
		.then((values) => {
			let fn = values[0].toString();
			fn = fn.replace(",", "");

			if (audioOnly) {
				// youtube started serving webms as audio formats?
				// also it puts a newline at the end just to make my life miserable
				fn = fn.replace(/\.webm\n?$/, ".ogg") 
			}
			
			return {
				filename: fn,
				videoBuffer: values[1]
			}
		})
}

function videoDataToMessage(videoData, shouldSpoiler) {
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

module.maxMegsUploadSize = 25;
module.maxUploadSize = module.maxMegsUploadSize * (1 << 20);

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
		var audioOnly = interaction.options.getBoolean('audioonly');
		var lowQuality = interaction.options.getBoolean('lowquality');
		var link = interaction.options.getString('link');

		var replyPromise = interaction.deferReply({ fetchReply: true });
		var videoPromise = downloadVideo(link, lowQuality, audioOnly);

		Promise.all([videoPromise, replyPromise]).then((values) => {
			var fn = values[0].filename;
			var buf = values[0].videoBuffer;

			interaction.editReply({
				files: [
					{
						name: fn,
						attachment: buf,
					}
				]
			})
			.catch((err) => {
				interaction.editReply({content: `failed to embed the new file. too large? (${formatBytes(buf.length)})\n\n${err}`, ephemeral: true});
				if (err.stack) {
					console.log(err.stack);
				}
			})
		})
		.catch((err) => {
			interaction.editReply({content: "Error while downloading: " + err, ephemeral: true});
		})
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
	if (!url) return;

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
				msg.reply({content: `failed to embed the new file. too large? (${formatBytes(data.videoBuffer.length)})\n\n${err}`, ephemeral: true});
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
	/https?:\/\/(?:www\.)?instagram\.com\/reels\/\w+/g,

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
					message.reply(err);
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