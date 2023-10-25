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

	var chan = it.channel;
	var flag = it.options.getString("name");
	var hidden = it.options.getBoolean("hidden");

	flags.removeFlag(chan.id, flag).then((newFlags) => {
		it.reply({ content: `Removed flag: **${flag}**.`, ephemeral: hidden });
	}).catch((err) => {
		it.reply({ content: `Error while removing flag ${flag}:\n\t${err}`, ephemeral: hidden });
	});
}

module.exports.data = new SlashCommandBuilder()
	.setName('removeflag')
	.setDescription('(admin only) remove a flag from this channel')

	.addStringOption(option =>
		option.setName('name')
			.setDescription('flag name')
			.setRequired(true))

	.addBooleanOption(option =>
		option.setName('hidden')
			.setDescription('reply to this command privately (default: no)'))