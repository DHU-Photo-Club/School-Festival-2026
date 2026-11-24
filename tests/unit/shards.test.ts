import { describe, expect, it } from "vitest";
import type { ShardPose } from "../../src/shared/shards.ts";
import { SHARD_RING_RADIUS, shardColor, shardPoses } from "../../src/shared/shards.ts";

describe("破片の配置", () => {
	it("同じ大きさと時刻からは同じ配置を返す", () => {
		expect(shardPoses(1920, 1080, 123_456)).toEqual(shardPoses(1920, 1080, 123_456));
	});

	it("時刻が進むと動く", () => {
		expect(shardPoses(1920, 1080, 0)).not.toEqual(shardPoses(1920, 1080, 5_000));
	});

	it("大きな時刻でも配置が崩れない（補正済みサーバー時刻をそのまま使う）", () => {
		const now = 1_800_000_000_000;
		for (const pose of shardPoses(1920, 1080, now)) {
			for (const [x, y] of pose.vertices) {
				expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
			}
		}
	});

	it("輪の内側は空けておく", () => {
		const [width, height] = [1180, 820];
		const radius = Math.min(width, height) * SHARD_RING_RADIUS;
		for (const time of [0, 40_000, 90_000]) {
			const near = shardPoses(width, height, time)
				.flatMap((pose) => pose.vertices)
				.map(([x, y]) => Math.hypot(x - width / 2, y - height / 2));
			expect(Math.min(...near)).toBeGreaterThan(radius * 0.2);
		}
	});
});

/** 浮動小数点の末尾の差を除くため、破片の位置を小数第4位で丸める。 */
const rounded = (pose: ShardPose) => ({
	x: Number(pose.x.toFixed(4)),
	y: Number(pose.y.toFixed(4)),
	vertices: pose.vertices.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]),
	shade: Number(pose.shade.toFixed(4)),
	alpha: Number(pose.alpha.toFixed(4)),
});

describe("輪の破片", () => {
	it("130枚を画面中央の周りに置く", () => {
		const [width, height] = [1180, 820];
		const all = shardPoses(width, height, 40_000);
		expect(all).toHaveLength(130);
		// 重心は画面中央から輪の半径の1.25倍以内にある（半径の比の最大1.2と揺れの0.04）。
		const reach = Math.min(width, height) * SHARD_RING_RADIUS * 1.25;
		for (const pose of all) {
			expect(Math.hypot(pose.x - width / 2, pose.y - height / 2)).toBeLessThan(reach);
		}
	});

	it("配置と動きの値が変わらない", () => {
		const all = shardPoses(800, 600, 12_345);
		expect(rounded(all[0])).toMatchInlineSnapshot(`
			{
			  "alpha": 0.667,
			  "shade": 0.992,
			  "vertices": [
			    [
			      354.6188,
			      118.84,
			    ],
			    [
			      312.238,
			      102.6519,
			    ],
			    [
			      317.9801,
			      53.2474,
			    ],
			  ],
			  "x": 328.279,
			  "y": 91.5798,
			}
		`);
		expect(rounded(all[129])).toMatchInlineSnapshot(`
			{
			  "alpha": 0.4711,
			  "shade": 0.8255,
			  "vertices": [
			    [
			      561.5894,
			      323.9506,
			    ],
			    [
			      636.1859,
			      403.0188,
			    ],
			    [
			      546.5917,
			      409.6473,
			    ],
			  ],
			  "x": 581.4557,
			  "y": 378.8722,
			}
		`);
	});

	it("`swell` は輪の半径を変える", () => {
		const [width, height, time] = [800, 600, 12_345];
		const distance = (pose: ShardPose) => Math.hypot(pose.x - width / 2, pose.y - height / 2);
		const normal = shardPoses(width, height, time);
		const half = shardPoses(width, height, time, 0.5);
		for (let i = 0; i < 130; i += 1) {
			expect(distance(half[i])).toBeCloseTo(distance(normal[i]) / 2);
		}
	});
});

describe("破片の色", () => {
	const RED = [255, 0, 0] as const;
	const BLUE = [0, 0, 255] as const;
	const two = { colors: [RED, BLUE] as const, amount: 1 };

	it("色づける前は明るさの灰色にする", () => {
		expect(shardColor(0.8, 0)).toEqual([204, 204, 204]);
		expect(shardColor(0.8, 1, { ...two, amount: 0 })).toEqual([204, 204, 204]);
	});

	it("偶数番目の破片を一色目、奇数番目を二色目へ振り分ける", () => {
		const dark = 150 / 255;
		expect(shardColor(dark, 0, two)).toEqual([255, 0, 0]);
		expect(shardColor(dark, 1, two)).toEqual([0, 0, 255]);
		expect(shardColor(dark, 2, two)).toEqual([255, 0, 0]);
	});

	it("明るい破片ほど白へ寄せ、最大で35%寄せる", () => {
		const [r, g, b] = shardColor(1, 1, two);
		expect(r).toBeCloseTo(255 * 0.35);
		expect(g).toBeCloseTo(255 * 0.35);
		expect(b).toBeCloseTo(255);
	});

	it("灰色から色へ進み具合だけ寄せる", () => {
		const dark = 150 / 255;
		const [r, g, b] = shardColor(dark, 0, { ...two, amount: 0.5 });
		expect(r).toBeCloseTo((150 + 255) / 2);
		expect(g).toBeCloseTo(150 / 2);
		expect(b).toBeCloseTo(150 / 2);
	});
});
