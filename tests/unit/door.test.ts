import { describe, expect, it } from "vitest";
import { RIBBON_SEGMENTS, ribbonPoints } from "../../src/shared/door.ts";

describe("扉の中の光の帯", () => {
	it("同じ時刻には同じ形を返し、扉の上下の外まで縦に並べる", () => {
		const points = ribbonPoints(123_456);
		expect(points).toEqual(ribbonPoints(123_456));
		expect(points).toHaveLength(RIBBON_SEGMENTS + 1);
		expect(points[0].y).toBeLessThan(0);
		expect(points[points.length - 1].y).toBeGreaterThan(1);
		for (const [index, point] of points.entries()) {
			if (index > 0) expect(point.y).toBeGreaterThan(points[index - 1].y);
		}
	});

	it("帯は扉の内側で揺れ、幅は扉の幅より十分細い", () => {
		for (let time = 0; time < 120_000; time += 1_700) {
			for (const point of ribbonPoints(time)) {
				expect(point.half).toBeGreaterThan(0.05);
				expect(point.half).toBeLessThan(0.25);
				expect(point.x - point.half).toBeGreaterThan(0);
				expect(point.x + point.half).toBeLessThan(1);
			}
		}
	});

	it("揺れは遅い。1フレーム（約16ミリ秒）で帯の中心は扉の幅の0.04%未満しか動かない", () => {
		for (let time = 0; time < 60_000; time += 2_300) {
			const [now, next] = [ribbonPoints(time), ribbonPoints(time + 16)];
			for (const [index, point] of now.entries()) {
				expect(Math.abs(next[index].x - point.x)).toBeLessThan(0.0004);
			}
		}
	});
});
