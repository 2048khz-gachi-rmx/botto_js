const { SlashCommandBuilder } = require('@discordjs/builders');

const path = require("path");
const flags = require(path.join(require.main.path, "libs", "channel_flags"));

var db = global.DB
var client = global.Bot

module.exports.execute = async(it) => {
	var sender = it.user;
	var mgr = it.guild.members;

	var member = await mgr.fetch(sender);

	if (!member.permissions.has("ADMINISTRATOR")) {
		return false;
	}

	var chan = it.channel;
	var flag = it.options.getString("name");
	var wantWh = it.options.getBoolean("need_webhook");
	var hidden = it.options.getBoolean("hidden");

	flags.addFlag(chan.id, flag, wantWh).then((newFlags) => {
		let outString = newFlags.join(", ");
		it.reply({ content: `Added new flag: **${flag}**.\n\t**New flags**: ${outString}`, ephemeral: hidden });
	}).catch((err) => {
		it.reply({ content: `Error while adding flag ${flag}:\n\t${err}`, ephemeral: hidden });
	});
}

module.exports.data = new SlashCommandBuilder()
	.setName('addflag')
	.setDescription('(admin only) add a flag to this channel')

	.addStringOption(option =>
		option.setName('name')
			.setDescription('flag name')
			.setRequired(true))

	.addBooleanOption(option =>
		option.setName('need_webhook')
			.setDescription('do you need a webhook here? (default: no)'))

	.addBooleanOption(option =>
		option.setName('hidden')
			.setDescription('reply to this command privately (default: no)'))