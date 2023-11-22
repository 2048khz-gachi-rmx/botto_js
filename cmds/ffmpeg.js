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

global.Botto.on('messageCreate', async (message) => {
	if (message.author.bot) return;
	if (!message.attachments || message.attachments.length == 0) return;

	let chanFlags = flags.getChannelFlags(message.channel.id);
	if (!chanFlags.vidCompress) return;

	var toCheck = []

	message.attachments.each(att => {
		let typ = att.contentType;
		if (!typ || !typ.startsWith("video/")) return;

		toCheck.push(att);
	})

	var outputs = [];

	// run every attached video through ffmpeg
	toCheck.forEach(att => {
		var uuid = randomUUID().replace("-", "");
		var dlPath = path.join(tempDirPath, "tmp" + uuid + att.name);
		var outPath = path.join(tempDirPath, "out" + uuid + att.name);

		outputs.push( new Promise((res, rej) => {
			const crf = 32

			downloadFile(att.url, dlPath).then((buf) => {
				var pass1 = ffmpeg(dlPath)
					.addOutputOptions([
						"-vf mpdecimate",
						"-c:v libvpx-vp9",
						"-b:v 0",
						"-row-mt 1", // nice multithreading
						`-crf ${crf}`,
						`-passlogfile ${uuid}`
					])


				var pass2 = pass1.clone();

				pass1.addOption("-pass 1")
				     .noAudio()
					 .format("null")
					 .output("-")
					 .on("error", (err) => pass2.emit("error", err))
					 .on("end", () => {
						pass2.save(outPath)
					});

				pass2.addOption("-pass 2")
				     .addOption("-c:a libopus")
					 .format("webm")
					 .on("error", rej)
					 .on('end', () => {
				     	fs.stat(outPath, (err, stats) => res({path: outPath, stats: stats, att: att}))
						})

				pass1.run();
			})
			.catch((why) => {
				log.error("failed to download embed attachment: %s", why);
			})
			
		})
		.catch((why) => {
			log.error("failed to transcode embed attachment: %s", why);
		})
		.finally(() => {
			fs.unlink(dlPath, () => {});
			fs.unlink(`${uuid}-0.log`, console.log); // Delete the ffmpeg 2-pass log file
		}))
	});


	const results = await Promise.all(outputs)
		.catch((why) => {
			log.error("ffmpeg error during conversion: %s", why);
		});

	if (!results) return;

	var toEmbed = [];
	var ratioThreshold = 0.75;

	var oldTotal = 0;
	var newTotal = 0;

	for (var result of results) {
		oldTotal += result.att.size;
		newTotal += result.stats.size;

		toEmbed.push(result.path);
	}

	var perc = Math.ceil(newTotal / oldTotal * 100)

	if (newTotal > 0 && newTotal / oldTotal > ratioThreshold) {
		return; // not worth
	}

	// then send them over
	var msgOutputs = [];
	var compText = `(${filesize(oldTotal)} -> ${filesize(newTotal)} (${perc}%))`
	var replyText = message.content.length > 0 ? `${message.author.username}: ${message.content}\n${compText}`
					: `by ${message.author.username} ${compText}:`;

	if (toEmbed.length > 0) {
		msgOutputs.push(message.channel.send({
			content: replyText,
			files: toEmbed,
		}));

		// message.delete();
	}

	Promise.all(msgOutputs)
		.catch((why) => {
			log.error("failed to send discord message!? %s", why);
		})
		.finally(() => {
			for (var result of results) {
				fs.unlink(result.path, () => {});
			}
		})

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