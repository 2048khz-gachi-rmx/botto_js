if (true) return;

const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('servers')
		.setDescription('retrieve server info'),
	async execute(interaction) {
		let servers = null;

		try {
			servers = await getServerData();
		} catch(e) {
			if (e === -1) {
				interaction.reply({content: "Crident broke something; this command isn't functional for now.", ephemeral: true});
			} else {
				interaction.reply({content: "Something went wrong while fetching server info...?", ephemeral: true});
			}

			return;
		}
		console.log("retrieved:", servers);

		let embed = {
			color: 0x60c0e0,

			title: "Server information:",
			timestamp: new Date(),

			url: "https://ldstar.net/",

			fields: []
		}

		for (let id of global.cfg.ServersOfInterest) {
			let s = servers[id];
			embed.fields.push({
				name: `${s.intName} @ ${s.map} (${s.players} / ${s.maxPlayers})`,
				value: `Join: steam://connect/${s.ip}:${s.port}`
			})
		}

		interaction.reply({ embeds: [embed] });
	},
};
