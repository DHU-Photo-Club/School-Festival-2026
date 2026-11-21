import { describe, expect, it } from "vitest";
import { SPLIT_MAX, SPLIT_MIN, splitAt, valueAt } from "../../src/client/controller/split.ts";

describe("スライダーの仕切り線", () => {
	it("左の語を選ぶほど仕切り線が右へ寄る", () => {
		expect(splitAt(0)).toBeCloseTo(SPLIT_MAX);
		expect(splitAt(0.5)).toBeCloseTo(0.5);
		expect(splitAt(1)).toBeCloseTo(SPLIT_MIN);
	});

	it("0〜1の外は端に収める", () => {
		for (const value of [Number.NEGATIVE_INFINITY, -1, 0, 0.5, 1, 2, Number.POSITIVE_INFINITY]) {
			expect(splitAt(value)).toBeGreaterThanOrEqual(SPLIT_MIN);
			expect(splitAt(value)).toBeLessThanOrEqual(SPLIT_MAX);
		}
		expect(splitAt(-1)).toBeCloseTo(SPLIT_MAX);
		expect(splitAt(2)).toBeCloseTo(SPLIT_MIN);
	});

	it("可動範囲の外の仕切り線の位置は、0〜1に収めずに返す", () => {
		expect(valueAt(0)).toBeGreaterThan(1);
		expect(valueAt(1)).toBeLessThan(0);
	});

	it("仕切り線の位置から回答の位置へ戻せる", () => {
		for (const value of [0, 0.25, 0.4, 0.5, 1]) expect(valueAt(splitAt(value))).toBeCloseTo(value);
		expect(valueAt(0.15)).toBeCloseTo(1);
		expect(valueAt(0.85)).toBeCloseTo(0);
	});
});
