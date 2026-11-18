import { describe, expect, it } from "vitest";
import type { ShardPose } from "../../src/shared/shards.ts";
import { floorShardPoses, SHARD_RING_RADIUS, shardPoses, spectrumColor } from "../../src/shared/shards.ts";

const COLORS = [
	[255, 0, 0],
	[0, 255, 0],
	[0, 0, 255],
	[255, 255, 0],
	[0, 255, 255],
	[255, 0, 255],
	[128, 128, 128],
	[255, 255, 255],
] as const;

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
				.filter((pose) => pose.y < height * 0.75)
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

describe("輪と床の破片（展示ディスプレイ）", () => {
	it("輪130枚、床110枚の順に並ぶ", () => {
		const all = shardPoses(1180, 820, 40_000);
		expect(all).toHaveLength(240);
		expect(all.slice(130)).toEqual(floorShardPoses(1180, 820, 40_000));
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
		expect(rounded(all[239])).toMatchInlineSnapshot(`
			{
			  "alpha": 0.5353,
			  "shade": 0.8673,
			  "vertices": [
			    [
			      745.1358,
			      586.1645,
			    ],
			    [
			      811.4508,
			      616.2057,
			    ],
			    [
			      749.0604,
			      619.1048,
			    ],
			  ],
			  "x": 768.549,
			  "y": 607.1583,
			}
		`);
	});

	it("`swell` は輪の半径だけを変え、床には掛けない", () => {
		const [width, height, time] = [800, 600, 12_345];
		const distance = (pose: ShardPose) => Math.hypot(pose.x - width / 2, pose.y - height / 2);
		const normal = shardPoses(width, height, time);
		const half = shardPoses(width, height, time, 0.5);
		for (let i = 0; i < 130; i += 1) {
			expect(distance(half[i])).toBeCloseTo(distance(normal[i]) / 2);
		}
		expect(half.slice(130)).toEqual(floorShardPoses(width, height, time));
	});
});

describe("床の破片（iPadの待機画面）", () => {
	it("床の110枚だけを返す", () => {
		expect(floorShardPoses(1180, 820, 40_000)).toHaveLength(110);
	});

	it("画面の下部だけに置く", () => {
		const [width, height] = [1180, 820];
		for (const time of [0, 40_000, 90_000]) {
			for (const pose of floorShardPoses(width, height, time)) {
				expect(pose.y).toBeGreaterThan(height * 0.7);
			}
		}
	});
});

describe("破片の色", () => {
	it("区画の中央ではその区画の色になる", () => {
		expect(spectrumColor(0.5, COLORS, 0.9)).toEqual([255, 0, 0]);
		expect(spectrumColor(2.5, COLORS, 0.9)).toEqual([0, 0, 255]);
	});

	it("8区画で一巡する", () => {
		const [a, b] = [spectrumColor(1.3, COLORS, 0.9), spectrumColor(9.3, COLORS, 0.9)];
		a.forEach((value, index) => {
			expect(value).toBeCloseTo(b[index]);
		});
		expect(spectrumColor(-0.5, COLORS, 0.9)).toEqual([255, 255, 255]);
	});

	it("区画の境目では隣の色と半分ずつ混ざる", () => {
		const [r, g, b] = spectrumColor(1, COLORS, 0.9);
		expect(r).toBeCloseTo(127.5);
		expect(g).toBeCloseTo(127.5);
		expect(b).toBeCloseTo(0);
	});
});
