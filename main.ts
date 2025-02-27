"use strict";

import fs from "fs";
import { Client, Collection, CommandInteraction, Intents } from "discord.js";
import cfg from "config";
import { SlashCommandBuilder } from "@discordjs/builders";

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MESSAGE_REACTIONS] });
global.Botto = client;

if (!cfg.get("discord.token") || cfg.get("discord.token") == "0000") {
	console.error("token not set in the config; check out the config/ folder");
	process.exit();
}

var importPromises = [
	import("./src/deploy-commands"),
	import("./src/modules")
];

importPromises[0]

Promise.all(importPromises)
	.then(([commandExports, _]) => {
		let commands = commandExports.commands;

		client.once("ready", () => {
			console.log(">> ready!");
		});

		client.on("interactionCreate", async (interaction) => {
			if (!interaction.isCommand()) return;

			const command: SlashCommandBuilder = commands[interaction.commandName];
			if (!command) return;

			try {
				await command.execute(interaction);
			} catch (error) {
				console.error(error);
				await interaction.reply({ content: "There was an error while executing this command!", ephemeral: true });
			}
		});

		client.login(cfg.get("discord.token"));
	})