const fs = require('fs');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { clientId, guildId, token } = require('./config.json');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const path = require("path");

Bot.commands = new Collection();

const devCmds = [];

// Load commands from the `cmds` subdirectory, recursively
function recurRequire(cd) {
	const dirContents = fs.readdirSync(cd, { withFileTypes: true });

	// Require the files in the directory first
	const cmdFiles = dirContents
		.filter(file => (file.isFile() && file.name.endsWith('.js')))
		.map(file => file.name);

	for (const file of cmdFiles) {
		const command = require(path.join(cd, file));

		if (!('data' in command || 'execute' in command)) {
			console.warn(`No command provided from \`${file}\`.`)
			continue;
		}

		if (!('name' in command.data)) {
			console.warn(`No name provided from \`${file}\`.`)
			continue;
		}

		console.log(`loaded "${command.data.name}" from \`${file}\``)
		command.data.file = path.join(cd, file);
		Bot.commands.set(command.data.name, command);

		devCmds.push(command.data.toJSON());
	}

	// Then recurse into directories
	const folders = dirContents
		.filter(dirent => dirent.isDirectory())
    	.map(dirent => dirent.name);

    for (const fld of folders) {
    	recurRequire(path.join(cd, fld));
    }
}

recurRequire(path.join(__dirname, "cmds"));

const rest = new REST().setToken(token);

(async () => {
	try {
		console.log('< reloading slash-commands...');

		const data = await rest.put(
			Routes.applicationGuildCommands(clientId, guildId),
			{ body: devCmds },
		);

		console.log('> reloaded slash-commands.');
	} catch (error) {
		console.error(error);
	}
})();
