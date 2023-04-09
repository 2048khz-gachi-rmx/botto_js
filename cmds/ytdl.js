var ytdl = require('youtube-dl-exec');
ytdl = ytdl.create("yt-dlp");

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

module.maxMegsUploadSize = 8;
module.maxUploadSize = module.maxMegsUploadSize * (1 << 20);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ytdl')
		.setDescription('download via yt-dlp')
		.addStringOption(option =>
			option.setName('link')
				.setDescription('URL of whatever you want to download')
				.setRequired(true))

		,

	async execute(interaction) {
		const subprocess = ytdl.exec(interaction.options.getString('link'), {
			o: '-',
			f: `(bv[vcodec~='^(avc|h264|vp8|vp9)']+ba)[filesize<8M]`,
		});

		// Yeah this is weird
		const fnSub = ytdl.exec(interaction.options.getString('link'), {
			print: 'filename',
			o: '%(title)s.%(ext)s',
			f: `(bv[vcodec~='^(avc|h264|vp8|vp9)']+ba)[filesize<8M]`,
		})

		let curSize = 0;

		var fnPromise = new Promise((resolve, die) => {
			var out = false;

			fnSub.stdout.on("data", (chunk) => {
					out = chunk;
				})
				.on("close", () => {
					if (!out) {
						die("No output; perhaps there are no <8mb download options...?");
					}

					resolve(out)
				})
		});

		var dlPromise = new Promise((resolve, die) => {
			let chunks = []; // basically an array of buffers

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

		var replyPromise = interaction.deferReply({fetchReply: true});

		Promise.all([fnPromise, dlPromise, replyPromise]).then((values) => {
			var fn = values[0].toString();
			var buf = values[1];
			var msg = values[2]

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
