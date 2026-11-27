/** 開発サーバー起動中に node scripts/generate-narration-envelope.ts [URL] で再生成。
 * 音源を再生せず、50msごとのRMSを解析。ピークの15%未満の余韻は0へ落とす。
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage();
	await page.goto(process.argv[2] ?? "http://localhost:5186/display/1");
	const data = await page.evaluate(async () => {
		const context = new AudioContext();
		try {
			const out = [];
			for (let number = 1; number <= 12; number++) {
				const response = await fetch(`/sounds/narration/${String(number).padStart(2, "0")}.ogg`);
				if (!response.ok) throw new Error(`音源${number}: ${response.status}`);
				const buffer = await context.decodeAudioData(await response.arrayBuffer());
				const samples = buffer.getChannelData(0), step = Math.round(buffer.sampleRate * .05);
				const rms = [];
				for (let i = 0; i < samples.length; i += step) {
					let sum = 0;
					for (let j = i; j < Math.min(i + step, samples.length); j++) sum += samples[j] ** 2;
					rms.push(Math.sqrt(sum / step));
				}
				const peak = Math.max(...rms);
				out.push({ durationMs: buffer.duration * 1000, levels: rms.map(v => v < peak * .15 ? 0 : Math.round(Math.min(1, v / peak) * 100) / 100) });
			}
			return out;
		} finally { await context.close(); }
	});
	writeFileSync(new URL("../src/data/narration-envelope.json", import.meta.url), JSON.stringify(data) + "\n");
} finally { await browser.close(); }
