// ghetto command system from back in the day when slash commands didn't exist
// i'm still on android app version 126.21 and it doesn't have slash commands support,
// but i'd really prefer to still be able to run commands
// FUCK REACT NATIVE

import cfg from "config";

const split = require('split-string');
let prefix = cfg.get("command_prefix", ".");

global.Botto.on('messageCreate', async (message) => {
	if (message.author.bot) return;

	let content = message.content;

	// TODO: this is stupid as fuck... maybe there's some kind of priority i can set up?
	if (!content.startsWith(prefix)) {
		global.Botto.emit("noncommandMessage", message)
		return;
	}

	let argsStr = content.replace(new RegExp("^" + prefix), "");
	let args = split(argsStr, { separator: ' ', quotes: [ '"' ] });

	global.Botto.emit("ogCommandInvoked", message, ...args)
});