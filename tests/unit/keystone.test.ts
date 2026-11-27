import { describe, expect, it } from "vitest";
import type { Keystone } from "../../src/shared/keystone.ts";
import {
	applyKeystone,
	IDENTITY_KEYSTONE,
	isValidKeystone,
	KEYSTONE_LIMIT,
	keystoneCorners,
	keystoneTransform,
	moveCorner,
	parseKeystone,
} from "../../src/shared/keystone.ts";

const W = 1920;
const H = 1080;

/** 上辺を左右から縮めた台形。プロジェクターを下から見上げて投影したときの補正。 */
const TRAPEZOID: Keystone = [
	[0.08, 0],
	[-0.05, 0.02],
	[0, 0],
	[0.01, -0.03],
];

describe("台形補正", () => {
	it("補正しない状態では変換を掛けない", () => {
		expect(keystoneTransform(IDENTITY_KEYSTONE, W, H)).toBe("none");
		expect(applyKeystone(IDENTITY_KEYSTONE, W, H, 100, 200)).toEqual([100, 200]);
	});

	it("画面の四隅を補正後の四隅へ写す", () => {
		const targets = keystoneCorners(TRAPEZOID, W, H);
		const sources = [
			[0, 0],
			[W, 0],
			[W, H],
			[0, H],
		];
		sources.forEach(([x, y], index) => {
			const [px, py] = applyKeystone(TRAPEZOID, W, H, x, y);
			expect(px).toBeCloseTo(targets[index][0], 3);
			expect(py).toBeCloseTo(targets[index][1], 3);
		});
	});

	it("平行移動だけなら中心も同じだけずれる", () => {
		const shift: Keystone = [
			[0.1, 0.1],
			[0.1, 0.1],
			[0.1, 0.1],
			[0.1, 0.1],
		];
		const [x, y] = applyKeystone(shift, W, H, W / 2, H / 2);
		expect(x).toBeCloseTo(W / 2 + 0.1 * W, 3);
		expect(y).toBeCloseTo(H / 2 + 0.1 * H, 3);
	});

	it("凹んだりねじれたりする四角形は写せないので受け付けない", () => {
		expect(isValidKeystone(TRAPEZOID)).toBe(true);
		// 右上の角を左下の角より内側へ寄せると凹む。
		expect(
			isValidKeystone([
				[0, 0],
				[-0.5, 0.5],
				[0, 0],
				[0, 0],
			]),
		).toBe(false);
		// 右上の角を左上の角と同じ位置まで寄せると、上辺がつぶれる。
		const twisted = moveCorner(
			[
				[0.5, 0],
				[0, 0],
				[0, 0],
				[0, 0],
			],
			1,
			[-0.5, 0],
		);
		expect(twisted).toEqual([
			[0.5, 0],
			[0, 0],
			[0, 0],
			[0, 0],
		]);
	});

	it("角は動かせる範囲の外へ出さない", () => {
		const moved = moveCorner(IDENTITY_KEYSTONE, 0, [1, -1]);
		expect(moved[0]).toEqual([KEYSTONE_LIMIT, -KEYSTONE_LIMIT]);
	});

	it("保存した値は形と範囲を確かめてから読む", () => {
		expect(parseKeystone(JSON.parse(JSON.stringify(TRAPEZOID)))).toEqual(TRAPEZOID);
		expect(parseKeystone(null)).toBeNull();
		expect(
			parseKeystone([
				[0, 0],
				[0, 0],
				[0, 0],
			]),
		).toBeNull();
		expect(
			parseKeystone([
				[0, 0],
				[0, 0],
				[0, 0],
				[0, "1"],
			]),
		).toBeNull();
		expect(
			parseKeystone([
				[0, 0],
				[0, 0],
				[0, 0],
				[0, 0.9],
			]),
		).toBeNull();
		expect(
			parseKeystone([
				[0, 0],
				[-0.5, 0.5],
				[0, 0],
				[0, 0],
			]),
		).toBeNull();
	});
});
