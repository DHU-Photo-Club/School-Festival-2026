import { describe, expect, it } from "vitest";
import { SHARD_RING_RADIUS, shardPoses, spectrumColor } from "../../src/shared/shards.ts";

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

describe("破片の色", () => {
	it("区画の中央ではその区画の色になる", () => {
		expect(spectrumColor(0.5, COLORS, 0.9)).toEqual([255, 0, 0]);
		expect(spectrumColor(2.5, COLORS, 0.9)).toEqual([0, 0, 255]);
	});

	it("8区画で一巡する", () => {
		const [a, b] = [spectrumColor(1.3, COLORS, 0.9), spectrumColor(9.3, COLORS, 0.9)];
		a.forEach((value, index) => expect(value).toBeCloseTo(b[index]));
		expect(spectrumColor(-0.5, COLORS, 0.9)).toEqual([255, 255, 255]);
	});

	it("区画の境目では隣の色と半分ずつ混ざる", () => {
		const [r, g, b] = spectrumColor(1, COLORS, 0.9);
		expect(r).toBeCloseTo(127.5);
		expect(g).toBeCloseTo(127.5);
		expect(b).toBeCloseTo(0);
	});
});
