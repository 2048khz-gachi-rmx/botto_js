
const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wipe')
		.setDescription('clear recent bot messages from you'),

	async execute(it) {
		var sender = it.user;
		var chan = it.channel;

		chan.messages.fetch()
			.then(messages => {

				messages = messages.filter(m => {
					if (!m.interaction) return false;
					var msgIt = m.interaction;

					console.log(it.user.id, sender.id, m.applicationId, it.applicationId);
					return msgIt.user.id == sender.id
						&& m.applicationId == it.applicationId;
				});

				chan.bulkDelete(messages);

				it.reply(`cleared ${messages.size} messages.`)
					.then(() => {
						setTimeout(() => {
							it.deleteReply();
						}, 10000);
					});
			})
			.catch(console.error)
	},
};
