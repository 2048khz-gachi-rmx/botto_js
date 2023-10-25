const { SlashCommandBuilder } = require('@discordjs/builders');

const path = require("path");
const flags = require(path.join(require.main.path, "libs", "channel_flags"));

var client = global.Botto

module.exports.execute = async(it) => {
	var sender = it.user;
	var mgr = it.guild.members;

	var member = await mgr.fetch(sender);

	if (!member.permissions.has("ADMINISTRATOR")) {
		return false;
	}

	let chan = it.channel;
	let hidden = it.options.getBoolean("hidden");
	let chanFlags = flags.getChannelFlags(chan.id);
	let outString = Object.keys(chanFlags).join(", ");

	it.reply({ content: `This channel's flags are: **${outString}**`, ephemeral: hidden });
}

module.exports.data = new SlashCommandBuilder()
	.setName('listflags')
	.setDescription('(admin only) list this channel\'s flags')

	.addBooleanOption(option =>
		option.setName('hidden')
			.setDescription('reply to this command privately (default: yes)'))