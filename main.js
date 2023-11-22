const fs = require('fs');
const { Client, Collection, Intents } = require('discord.js');

global.cfg = require('./config.json');
global.Botto = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MESSAGE_REACTIONS] });

const client = global.Botto
client.commands = new Collection();

var includeRegex = new RegExp("\.[tj]s$");
const libs = fs.readdirSync('./libs')
	.filter((file) => includeRegex.test(file))
	.forEach((file) => require(`./libs/${file}`))

require("./deploy-commands.js");



client.once('ready', () => {
	console.log('>> ready!');
});

client.on('interactionCreate', async (interaction) => {
	if (!interaction.isCommand()) return;

	const command = client.commands.get(interaction.commandName);

	if (!command) return;

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
	}
});

client.login(global.cfg.token);
