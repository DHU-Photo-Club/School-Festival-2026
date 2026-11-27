import { computeScene } from "../../src/shared/motion.ts";
import { PALETTE } from "../../src/data/palette.ts";
import type { SceneInput } from "../../src/shared/motion.ts";
import { expect, it } from "vitest";
import { finaleColors, finaleDust, burstShards, gatheringOrbit } from "../../src/shared/finale.ts";
import { shardPoses } from "../../src/shared/shards.ts";
const palette = ["#ff3300", "#00cc66", "#3366ff", "#cc44aa"];
it("色の入れ替えは再現可能で、フレーム境界で大きく飛ばない", () => {
	expect(finaleColors(1200, palette, true)).toEqual(finaleColors(1200, palette, true));
	expect(finaleColors(1200, palette, true)).not.toEqual(finaleColors(7000, palette, true));
	const a = finaleColors(4000, palette, true), b = finaleColors(4001, palette, true);
	for (let i = 0; i < a.length; i++) for (const channel of [1, 3, 5]) expect(Math.abs(parseInt(a[i].slice(channel, channel + 2), 16) - parseInt(b[i].slice(channel, channel + 2), 16))).toBeLessThanOrEqual(1);
	expect(new Set(finaleColors(0, palette.slice(0, 2), false))).toEqual(new Set(palette.slice(0, 2)));
});
it("爆発の最初は同じ小リングで、終了後はリングに戻らず画面全体へ分布する", () => {
	expect(burstShards(1920, 1080, 10000, 0, 0)).toEqual(shardPoses(1920, 1080, 10000, { scale: 0.3, density: 0.42, idleFit: 1 }));
	for (const elapsed of [800, 1800, 30000]) {
		const pieces = burstShards(1920, 1080, 10000, elapsed, 0);
		const original = burstShards(1920, 1080, 10000, 0, 0);
		for (const [i, piece] of pieces.entries()) expect(Math.hypot(piece.x - 960, piece.y - 540)).toBeGreaterThan(Math.hypot(original[i].x - 960, original[i].y - 540));
		expect(Math.min(...pieces.map((p) => p.x))).toBeLessThan(300);
		expect(Math.max(...pieces.map((p) => p.x))).toBeGreaterThan(1600);
		expect(Math.min(...pieces.map((p) => p.y))).toBeLessThan(200);
		expect(Math.max(...pieces.map((p) => p.y))).toBeGreaterThan(900);
	}
});
it("粒子は集約の位置から連続して飛び出し、二色に変わって1.8秒で消える", () => {
	const gather = finaleDust(1920, 1080, 10000, palette);
	const launch = finaleDust(1920, 1080, 10000, palette.slice(0, 2), 0);
	expect(launch.map(({ x, y, size, alpha }) => ({ x, y, size, alpha }))).toEqual(gather.map(({ x, y, size, alpha }) => ({ x, y, size, alpha })));
	expect(new Set(launch.map((p) => p.color))).toEqual(new Set(palette.slice(0, 2)));
	const after = finaleDust(1920, 1080, 10000, palette.slice(0, 2), 300);
	expect(Math.hypot(after[0].x - 960, after[0].y - 540)).toBeGreaterThan(Math.hypot(launch[0].x - 960, launch[0].y - 540));
	expect(finaleDust(1920, 1080, 10000, palette, 1800)).toEqual([]);
	expect(gather.length).toBeLessThanOrEqual(1600);
	// 配色・不透明度別にまとめて描けるよう、集約中の色数をパレット数以下に制限する。
	expect(new Set(gather.map((p) => p.color)).size).toBeLessThanOrEqual(palette.length);
});
it("待機の追加回転は逆戻りせず、長い判定でも2倍回転へ落ち着く", () => {
	expect(gatheringOrbit(0)).toBe(0);
	expect(gatheringOrbit(2000)).toBeGreaterThan(gatheringOrbit(1500));
	expect(gatheringOrbit(30001) - gatheringOrbit(30000)).toBeCloseTo(1, 5);
});

it("最終回答はバウンスせず縮み続け、外向きの波紋は0.45秒後に出る", () => {
	const input: SceneInput = { state: { phase: "judging", phaseStartedAt: 0, phaseEndsAt: 10000, answeredAt: 0, sessionId: "test", sequenceId: null, previewColorId: null, revision: 1, result: null }, now: 0, width: 1920, height: 1080, displayOrder: 0, reducedMotion: false, colors: PALETTE.colors, resultMode: "animate", previousBackground: null };
	let scale = 1;
	for (let now = 0; now <= 10000; now += 25) {
		const next = computeScene({ ...input, now }).shards.scale;
		expect(next).toBeLessThanOrEqual(scale + 1e-9); scale = next;
	}
	expect(scale).toBeCloseTo(0.3);
	expect(computeScene({ ...input, now: 449 }).ripple).toBeNull();
	expect(computeScene({ ...input, now: 450 }).ripple).not.toBeNull();
	for (const phase of ["idle", "question"] as const) {
		const scene = computeScene({ ...input, state: { ...input.state, phase }, now: 20000 });
		expect(scene.dust).toBeNull(); expect(scene.shards.burst).toBeUndefined();
	}
});
