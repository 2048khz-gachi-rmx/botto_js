import cfg from "config";

const express = require("express")
const bodyParser = require("body-parser")
import * as flags from "libs/channel_flags";
import { log } from "libs/log";

var client = global.Botto

const app = express()
app.use(express.json({limit: '5mb'}));

const PORT = cfg.get("github_port")

app.use(bodyParser.json())// Start express on the defined port
app.listen(PORT, () => console.log(`> github webhook listening on port ${PORT}`))

app.use(bodyParser.json())
app.post("/git_bw", (req, res) => {
	let dat = req.body;
	let comDat = dat.commits
	if (!comDat || comDat.length == 0 || !dat.head_commit) {
		res.status(200).end()
		console.log("aye what the heck", comDat, dat.head_commit)
		return;
	}

	let branch = dat.ref.split("/")[2]

	let reportCommits = [];
	let author = dat.head_commit.author.username;
	let head = dat.head_commit

	let coreData = {
		repoName: dat.repository.name,
		repoURL: dat.repository.html_url,
		branch: branch,

		sender: dat.sender.login,
		senderURL: dat.sender.html_url,
		senderAvatar: dat.sender.avatar_url,

		head: dat.head_commit,
		allCommits: dat.commits
	}

	if (head.message.startsWith(";")) {
		head.message = "_[This commit was marked as hidden.]_";
	}

	for (let commit of comDat) {
		let msg = commit.message;

		if (msg.startsWith(";")) {
			msg = "_[This commit was marked as hidden.]_"
		} else if (msg.startsWith("-")) {
			continue
		}

		let hash = commit.id;

		reportCommits.push({
			author: commit.author.username,
			message: msg,
			hash: hash,
			url: commit.url
		})
		console.log(commit.message);
	}

	res.status(200).end()
	client.emit("commits", coreData, head, reportCommits);
})

client.on('commits', async (core, head, coms) => {
	if (coms.length == 0)
		return;

	let embed = {
		color: 0x7289da,

		author: {
			name: core.sender,
			url: core.senderURL,
			icon_url: core.senderAvatar
		},

		title: "⚠️honey " + coms.length + " new " + core.repoName + " commit" + ((coms.length > 1 && "s") || "") +
			" just dropped⚠️ ",
		url: core.repoURL,

		timestamp: new Date(),

		footer: {
			icon_url: core.senderAvatar,
			text: core.branch + " branch"
		}
	}

	let desc = "";
	for (let com of coms) {
		desc += "[`" + com.hash.substring(0, 7) + "`](" + com.url + ") - " +
			com.message.split(/\r?\n/)[0] + " // " + com.author + "\n"
	}

	embed.description = desc

	for (let id of flags.getChannelsByFlag("github")) {
		client.channels.fetch(id)
			.then( (c) => { c.send({ embeds: [embed] }); } )
			.catch( (e) => { log.error("error while pushing commit msg; ignoring", e) })
	}
});
