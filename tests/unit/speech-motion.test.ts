import { expect, it } from "vitest";
import envelopes from "../../src/data/speech-envelope.json";
import { planSpeech, speakingShards, speechLevel } from "../../src/client/display/speech-motion.ts";
import { shardPoses } from "../../src/shared/shards.ts";

it("全ナレーションで発話には反応し、末尾の余韻では完全に止まる", () => {
	for (const [number, clip] of Object.entries(envelopes)) {
		const plan = planSpeech({ kind: "narration", numbers: [Number(number)], scene: "question" }, 1000, null);
		expect(Math.max(...clip.levels)).toBeGreaterThan(50);
		expect(speechLevel(plan, 999)).toBe(0);
		for (let at = clip.durationMs - 1200; at < clip.durationMs + 200; at += 40) {
			expect(speechLevel(plan, 1000 + at)).toBe(0);
		}
	}
	expect(speechLevel(null, 1000)).toBe(0);
});

it("導入の重ね合わせと質問の遅延は既存の音声設定と揃う", () => {
	const welcome = planSpeech({ kind: "narration", numbers: [1, 2, 3, 4], scene: "welcome" }, 1000, null);
	expect(welcome.clips[1].at).toBeCloseTo(1000 + envelopes["1"].durationMs - 1500);
	expect(welcome.clips[2].at).toBeCloseTo(welcome.clips[1].at + envelopes["2"].durationMs - 1500);
	const next = planSpeech({ kind: "narration", numbers: [5], scene: "questionSwitch" }, 2000, welcome);
	expect(next.clips[0].at).toBe(3660);
});

it("中心軌道・明るさを変えず一部だけ震え、無音では元の形をそのまま返す", () => {
	const poses = shardPoses(1920, 1080, 2000);
	expect(speakingShards(poses, 2000, 0)).toBe(poses);
	const moved = speakingShards(poses, 2000, 1);
	let changed = 0;
	for (const [index, piece] of moved.entries()) {
		const original = poses[index];
		expect([piece.x, piece.y, piece.alpha, piece.shade]).toEqual([original.x, original.y, original.alpha, original.shade]);
		if (piece !== original) changed++;
		for (const [n, vertex] of piece.vertices.entries()) {
			expect(Math.hypot(vertex[0] - original.vertices[n][0], vertex[1] - original.vertices[n][1])).toBeLessThan(4);
		}
	}
	expect(changed).toBeGreaterThan(0);
	expect(changed).toBeLessThan(poses.length / 2);
});
