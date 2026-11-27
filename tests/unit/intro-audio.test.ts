import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { INTRO_AUDIO, INTRO_WELCOME_OVERLAP_MS, INTRO_EXPLANATION_OVERLAP_MS, INTRO_EXPLANATION_AT_MS, INTRO_INVITATION_AT_MS, INTRO_NICKNAME_AT_MS, SOUND_MIX, welcomeNarrationGapAfterMs } from "../../src/data/sound.ts";

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

it("01・02の余韻へ次の音声を重ね、画面も各再生開始と一致する", () => {
	expect(welcomeNarrationGapAfterMs(1)).toBe(-1_500);
	expect(welcomeNarrationGapAfterMs(2)).toBe(-1_500);
	expect(welcomeNarrationGapAfterMs(3)).toBe(SOUND_MIX.narrationGapMs);
	expect(welcomeNarrationGapAfterMs(7)).toBe(SOUND_MIX.narrationGapMs);
	expect(INTRO_EXPLANATION_AT_MS).toBe(INTRO_AUDIO.narration01Ms - INTRO_WELCOME_OVERLAP_MS);
	expect(INTRO_INVITATION_AT_MS).toBe(INTRO_AUDIO.narration01Ms - INTRO_WELCOME_OVERLAP_MS + INTRO_AUDIO.narration02Ms - INTRO_EXPLANATION_OVERLAP_MS);
	expect(INTRO_NICKNAME_AT_MS).toBe(INTRO_AUDIO.narration01Ms - INTRO_WELCOME_OVERLAP_MS + INTRO_AUDIO.narration02Ms - INTRO_EXPLANATION_OVERLAP_MS + INTRO_AUDIO.narration03Ms);
});
