
const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wipeuser')
		.setDescription('clear recent messages from someone')

		.addNumberOption(option =>
			option.setName('time')
				.setDescription('how far back to clear, in minutes')
				.setRequired(false))

		.addUserOption(option =>
			option.setName("user")
			.setDescription("who to wipe")
			.setRequired(false))
	,

	async execute(it) {
		var sender = it.user;

		var range = it.options.getNumber("time")
		if (range == null) { range = 60 * 24; }

		var user = it.options.getUser("user")
		var toWipe = sender;

		if (user != null) {
			if (!it.memberPermissions.has("ADMINISTRATOR")) {
				it.reply(`only admins can set the "user" argument`)
					.then(() => {
						setTimeout(() => {
							it.deleteReply();
						}, 5000);
					});

				return
			} else {
				toWipe = user;
			}
		}

		range = Math.min(range, 60 * 24 * 14);

		var chan = it.channel;
		var rn = Date.now();

		chan.messages.fetch()
			.then(messages => {
				messages = messages.filter(m => {
					// theres probably a fancy way to do it in js
					var minutes = Math.floor( (rn - m.createdAt) / 1000 / 60 );

					return m.author.id == toWipe.id && minutes < range;
				});

				chan.bulkDelete(messages);

				it.reply(`cleared ${messages.size} messages.`)
					.then(() => {
						setTimeout(() => {
							it.deleteReply();
						}, 5000);
					});
			})
			.catch(console.error)
	},
};
