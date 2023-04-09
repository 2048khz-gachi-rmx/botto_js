const { SlashCommandBuilder } = require('@discordjs/builders');

function reloadCmd(command) {
	delete require.cache[require.resolve(`${command.data.file}`)];
	try {
		interaction.client.commands.delete(command.data.name);
		const newCommand = require(`${command.data.file}`);
		interaction.client.commands.set(newCommand.data.name, newCommand);
		return true;
	} catch (error) {
		return error;
	}
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('reload')
		.setDescription('(admin-only) Reloads a command.')
		.addStringOption(option =>
			option.setName('command')
				.setDescription('The command to reload. Leave blank to reload all.')),

	async execute(interaction) {
		var sender = interaction.user;
		var mgr = interaction.guild.members;

		var member = await mgr.fetch(sender);

		if (!member.permissions.has("ADMINISTRATOR")) {
			return false;
		}

		const commandName = interaction.options.getString('command');

		if (commandName) {
			const command = interaction.client.commands.get(commandName);

			if (!command) {
				return interaction.reply(`There is no command with name \`${commandName}\`!`);
			}

			console.log(command);

			var ok = reloadCmd(command);
			if (ok == true) {
				await interaction.reply(`Command \`${newCommand.data.name}\` was reloaded!`);
			} else {
				await interaction.reply(`error while reloading a command \`${command.data.name}\`:\n\`${ok.message}\``);
			}

		} else {
			var errors = [];

			interaction.client.commands.forEach((cmd) => {
				var ok = reloadCmd(cmd);
				if (ok != true) {
					errors[cmd.data.name] = ok.message;
				}
			})

			if (errors.length > 0) {
				var str = "";

				for (const [key, value] of Object.entries(errors)) {
					str += `\`$(key)\`:\n\`\`\`$(value)\`\`\`\n`
				}

				await interaction.reply(`error(s) while reloading commands:\n${str}`);
			} else {
				await interaction.reply(`reloaded all commands with no errors`);
			}
		}
	},
};
