import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { INTRO_AUDIO } from "../../src/data/sound.ts";

// 音源差し替えによる導入の同期ずれを検出する。Opusは48kHzで、先頭のpre-skipを除く。
it("導入の画面時刻が配信する音源01〜03の実尺と一致する", () => {
	for (const [index, expected] of Object.values(INTRO_AUDIO).entries()) {
		const data = readFileSync(new URL(`../../public/sounds/narration/${String(index + 1).padStart(2, "0")}.ogg`, import.meta.url));
		const head = data.indexOf("OpusHead");
		expect(head).toBeGreaterThanOrEqual(0);
		const skip = data.readUInt16LE(head + 10);
		let offset = 0;
		let samples = 0;
		while (offset < data.length) {
			expect(data.toString("ascii", offset, offset + 4)).toBe("OggS");
			const granule = data.readBigUInt64LE(offset + 6);
			if (granule !== 0xffffffffffffffffn) samples = Number(granule);
			const count = data[offset + 26];
			const sizes = data.subarray(offset + 27, offset + 27 + count);
			offset += 27 + count + sizes.reduce((sum, size) => sum + size, 0);
		}
		expect((samples - skip) / 48).toBeCloseTo(expected, 6);
	}
});
