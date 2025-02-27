const fs = require('fs');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
import cfg from "config";
const { clientId, guildId, token } = cfg.get("discord") as any;
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const path = require("path");

import * as commands from "cmds/index";
import { SlashCommandBuilder } from "@discordjs/builders";
import { CommandInteraction } from "discord.js";

const commandLookup : { [key: string]: BottoCommand } = {};
const devCmds = [];

interface BottoCommand {
	data?: SlashCommandBuilder,
	execute: (interaction: CommandInteraction) => Promise<void>;
}

for (const [name, command] of Object.entries(commands) as [string, BottoCommand][]) {
	if (!('data' in command || 'execute' in command)) {
		console.warn(`No command provided from \`${name}\`.`)
		continue;
	}

	if (!('name' in command.data)) {
		console.warn(`No name provided from \`${name}\`.`)
		continue;
	}

	console.log(`loaded "${command.data.name}"`)
	devCmds.push(command.data.toJSON());
	commandLookup[command.data.name] = command;
}

export { commandLookup as commands };

const rest = new REST().setToken(token);

(async () => {
	try {
		if (!cfg.has("discord.guildId") || !cfg.has("discord.clientId")) {
			console.log('> skipping reloading slash-commands; no guildId/clientId set');
			return;
		}

		console.log('< reloading slash-commands...');

		const data = await rest.put(
			Routes.applicationGuildCommands(cfg.get("discord.clientId"), cfg.get("discord.guildId")),
			{ body: devCmds },
		);

		console.log('> reloaded slash-commands.');
	} catch (error) {
		console.error(error);
	}
})();
