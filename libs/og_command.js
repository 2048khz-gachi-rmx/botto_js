// ghetto command system from back in the day when slash commands didn't exist
// i'm still on android app version 126.21 and it doesn't have slash commands support,
// but i'd really prefer to still be able to run commands
// FUCK REACT NATIVE

const split = require('split-string');
var prefix = global.cfg.command_prefix;

global.Botto.on('messageCreate', async (message) => {
	if (message.author.bot) return;

	var content = message.content;
	if (!content.startsWith(prefix)) return;

	var argsStr = content.replace(new RegExp("^" + prefix), "");
	var args = split(argsStr, { separator: ' ', quotes: [ '"' ] });

	global.Botto.emit("ogCommandInvoked", message, ...args)
});