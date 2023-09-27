const { SlashCommandBuilder } = require('@discordjs/builders');
const path = require("path");
const flags = require(path.join(require.main.path, "libs", "channel_flags"));
const db = global.DB
const client = global.Bot
const fs = require("node:fs");
const os = require("node:os");
const https = require('https');
const crypto = require('crypto');
const ffmpeg = require("fluent-ffmpeg")
const stream = require('node:stream');

var tempDirPath;

fs.mkdir(`${os.tmpdir()}${path.sep}botto_vids`, (err, dir) => {
	if (!err || err.code == "EEXIST") {
		tempDirPath = `${os.tmpdir()}${path.sep}botto_vids`;

		fs.readdir(tempDirPath, (err, files) => {
			if (err) {
				console.error("failed to cleanup temp video folder:", err);
				return;
			}

			for (const file of files) {
				fs.unlink(path.join(tempDirPath, file), () => {});
			}
		})
	}
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

global.Bot.on('messageCreate', async (message) => {
	if (message.author.bot) return;
	if (!message.attachments || message.attachments.length == 0) return;

	let chanFlags = flags.getChannelFlags(message.channel.id);
	if (!chanFlags.vidCompress) return;

	var toCheck = []

	message.attachments.each(att => {
		let typ = att.contentType;
		if (!typ.startsWith("video/")) return;

		toCheck.push(att);
	})

	var outputs = [];

	toCheck.forEach(att => {
		console.log("downloading att", att)
		outputs.push( new Promise((res, rej) => {
			var dlPath = path.join(tempDirPath, att.id + "_temp_" + att.name);
			var outPath = path.join(tempDirPath, att.id + "_out_" + att.name);

			downloadFile(att.url, dlPath).then((buf) => {
				ffmpeg(dlPath)
					.addOutputOptions([
						"-movflags +faststart",
						"-vf mpdecimate",
						"-preset veryfast",
						"-crf 22",
					])
					.format("mp4")
					.save(outPath)
					.on('end', () => {
						fs.stat(outPath, (err, stats) => res({path: outPath, stats: stats, att: att}))
						fs.unlink(dlPath, () => {}); // remove the old file; we don't need it anymore
					})
					.on("error", rej);
			})
		}))
	});

	var reses = await Promise.all(outputs);

	var angerLevels = [
		0.8,
		0.6,
		0.4,
		0.25
	]

	var text = "dicks";
	var toEmbed = [];
	var maxAngry = 0
	var minRatio = 1

	for (var result of reses) {
		var stat = result.stats;

		var oldSize = result.att.size;
		var newSize = stat.size;

		var angry = 0

		for (var mult of angerLevels) {
			if (oldSize * mult > newSize) {
				angry++;
			}
		}

		console.log("compress angry level:", angry);
		maxAngry = Math.max(maxAngry, angry);
		minRatio = Math.min(minRatio, newSize / oldSize)

		if (angry > 0 && newSize < 25 * (1 << 20)) {
			toEmbed.push(result.path)
		}
	}

	var perc = Math.ceil(minRatio * 100)
	var angerTexts = [
		`here's a slightly more efficient version (${perc}% of the size)`,
		`here's a more efficient version (${perc}% of the size)`,
		`here's a much more efficient version (${perc}% of the size)`,
		`damn bitch you record like this? here's a version with only ${perc}% the size`,
	]

	if (toEmbed.length > 0) {
		message.reply({
			content: angerTexts[maxAngry - 1],
			files: toEmbed,
		})
	}
});

/*setTimeout(() => {
	var dlPath = path.join(tempDirPath, "12345" + "_temp_" + "cat.mp4");
	var outPath = path.join(tempDirPath, "12345" + "_out_" + "cat.mp4");

	// downloadFile("https://cdn.discordapp.com/attachments/738225258393501757/1156579310073823232/ohh_sdhit.mp4?ex=65157beb&is=65142a6b&hm=5e1a78d69f4e68daea4789e4f3e47478663fa6ddebe4253e38afd79d47877aa9&",
	// 	dlPath)
	// 	.then((buf) => {
			console.log("out yes yes", dlPath);

			ffmpeg(dlPath)
				.addOutputOptions([
					"-movflags +faststart",
					"-vf mpdecimate",
					"-preset veryfast",
					"-crf 23",
				])
				.format("mp4")
				.on("stderr", console.log)
				.save(outPath);
	// 	});
}, 500);*/