import os from "node:os";
import { log } from "libs/log";
import path from "node:path";
import fs from "node:fs";

export var tempDirPath: string;

export interface FfmpegResult {
	resultPath: string,
	uuid: string,
}

fs.mkdir(`${os.tmpdir()}${path.sep}botto_vids`,
	{ recursive: true /* why not, i guess */ },
	(err, dir) => {
		if (err && err.code != "EEXIST") {
			log.error("failed to create temp video folder:", err);
			return;
		}

		tempDirPath = `${os.tmpdir()}${path.sep}botto_vids`;

		fs.readdir(tempDirPath, (err, files) => {
			if (err) {
				log.error("failed to cleanup temp video folder:", err);
				return;
			}

			for (const file of files) {
				fs.unlink(path.join(tempDirPath, file), () => {});
			}
		});
	});