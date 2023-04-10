	// Require express and body-parser
const express = require("express")
const bodyParser = require("body-parser")// Initialize express and define a port

const app = express()
app.use(express.json({limit: '5mb'}));

const PORT = global.cfg.github_port

app.use(bodyParser.json())// Start express on the defined port
app.listen(PORT, () => console.log(`> github webhook listening on port ${PORT}`))

app.use(bodyParser.json())
app.post("/git_bw", (req, res) => {
	console.log(req.body) // Call your action on the request here
	let dat = req.body;
	let comDat = dat.commits
	if (!comDat || comDat.length == 0 || !dat.head_commit) {
		res.status(200).end() // Responding is important
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

	res.status(200).end() // Responding is important
	global.Bot.emit("commits", coreData, head, reportCommits);
})