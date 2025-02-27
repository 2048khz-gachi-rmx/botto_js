import ffmpeg from "fluent-ffmpeg";
import { randomUUID } from "crypto";
import { FfmpegResult, tempDirPath } from "./common";
import path from "path";
import fs from "node:fs";

export function twopass(inPath: string, crf: number = 35): Promise<FfmpegResult> {
	let uuid = randomUUID().replace("-", "");
	let outPath = path.join(tempDirPath, "out" + uuid);

	return new Promise<FfmpegResult>((resolve, rej) => {
		let pass1 = ffmpeg(inPath)
			.addOutputOptions([
				"-c:v libvpx-vp9",
				"-b:v 0",
				"-row-mt 1", // nice multithreading
				`-crf ${crf}`,
				`-passlogfile ${outPath}`
			])

		let pass2 = pass1.clone();

		pass1.addOption("-pass 1")
			.noAudio()
			.format("null")
			.output("-")
			.on("error", (err) => pass2.emit("error", err))
			.on("end", () => {
				pass2.save(outPath)
			});

		pass2.outputOption("-pass 2")
			.outputOption("-c:a libopus")
			.outputOption("-b:a 64k")
			.outputOption("-speed 2")
			.format("webm")
			.on("error", rej)
			.on("end", () => {
				let result : FfmpegResult = {
					resultPath: outPath,
					uuid: uuid
				};

				resolve(result);
			})

		pass1.run();
	})
	.finally(() => {
		fs.unlink(`${outPath}-0.log`, () => {}); // Delete the ffmpeg 2-pass log file
	})
}