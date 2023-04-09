const fs = require('fs');
const { Client, Collection, Intents } = require('discord.js');
global.cfg = require('./config.json');
const token = global.cfg.token;

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
global.Bot = client

client.commands = new Collection();

require("./deploy-commands.js");

const libs = fs.readdirSync('./libs').filter(file => file.endsWith('.js'));

for (const file of libs) {
	require(`./libs/${file}`);
}

client.once('ready', () => {
	console.log('>> ready!');
});

client.on('interactionCreate', async interaction => {
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

client.login(token);
