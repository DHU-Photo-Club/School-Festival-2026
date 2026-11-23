import { describe, expect, it } from "vitest";
import { ENTRANCE_DURATION_MS, entranceFilter, entrancePose, orbEntranceDelay } from "../../src/client/archive/entrance.ts";

describe("page entrance perspective", () => {
	it("removes subpixel blur surfaces before completion while retaining the initial depth blur", () => {
		for (const kind of ["logo", "orb"] as const) {
			expect(entranceFilter(entrancePose(0, 0, 0, 0, kind).blur)).toBe(kind === "logo" ? "blur(20px)" : "blur(14px)");
			const nearEnd = entrancePose(0, 0, 750, 0, kind);
			expect(nearEnd.done).toBe(false);
			expect(entranceFilter(nearEnd.blur)).toBe("none");
			expect(entranceFilter(entrancePose(0, 0, ENTRANCE_DURATION_MS, 0, kind).blur)).toBe("none");
		}
	});
	it("keeps the logo at the camera center while its size and blur reduce", () => {
		let previousScale = Infinity, previousBlur = Infinity;
		for (let time = 0; time <= ENTRANCE_DURATION_MS; time += 10) {
			const pose = entrancePose(0, 0, time, 0, "logo");
			expect(pose.x).toBe(0); expect(pose.y).toBe(0);
			expect(pose.scale).toBeLessThanOrEqual(previousScale); expect(pose.blur).toBeLessThanOrEqual(previousBlur);
			previousScale = pose.scale; previousBlur = pose.blur;
		}
		expect(entrancePose(0, 0, 0, 0, "logo").scale).toBe(2.5);
		expect(entrancePose(0, 0, 0, 0, "logo").blur).toBe(20);
	});

	it("starts off-center orbs farther toward the screen edge, along their own camera ray", () => {
		for (const [x, y] of [[120, 90], [-171, -200], [0, -220], [600, -900]]) {
			for (const [width, height] of [[320, 568], [402, 874], [874, 402]]) {
				const initial = entrancePose(x, y, 0);
				const projected = { x: width / 2 + x + initial.x, y: height / 2 + y + initial.y };
				expect(projected.x - width / 2).toBeCloseTo(x * 2.5, 9);
				expect(projected.y - height / 2).toBeCloseTo(y * 2.5, 9);
				expect(x * (y + initial.y) - y * (x + initial.x)).toBeCloseTo(0, 9);
			}
		}
	});

	it("reduces projected distance and size with the same perspective factor", () => {
		const x = 150, y = -240;
		let previousDistance = Infinity;
		for (let time = 0; time <= ENTRANCE_DURATION_MS; time += 10) {
			const pose = entrancePose(x, y, time);
			const distance = Math.hypot(x + pose.x, y + pose.y);
			expect(distance).toBeCloseTo(Math.hypot(x, y) * pose.scale, 9);
			expect(distance).toBeLessThanOrEqual(previousDistance);
			previousDistance = distance;
		}
	});

	it("keeps delayed orbs hidden and starts them after the logo", () => {
		const delay = orbEntranceDelay("preview-1", 0);
		expect(delay).toBeGreaterThanOrEqual(220);
		expect(entrancePose(120, 80, delay - 1, delay).opacity).toBe(0);
		expect(entrancePose(120, 80, delay + 20, delay).opacity).toBeGreaterThan(0);
		expect(entrancePose(0, 0, delay, 0, "logo").opacity).toBe(1);
		expect(entrancePose(120, 80, ENTRANCE_DURATION_MS, delay).done).toBe(false);
	});

	it("gives every orb a deterministic, ordered small stagger within a two-second opening", () => {
		const delays = Array.from({ length: 50 }, (_, index) => orbEntranceDelay(`preview-${index + 1}`, index));
		expect(new Set(delays).size).toBe(50);
		expect(delays.every((delay, index) => index === 0 || delay > delays[index - 1])).toBe(true);
		expect(Math.max(...delays) + ENTRANCE_DURATION_MS).toBeLessThan(2000);
		expect(orbEntranceDelay("a", 3)).toBe(orbEntranceDelay("a", 3));
	});

	it("finishes at the exact original positions with no blur or residual scaling", () => {
		for (let index = 0; index < 50; index++) {
			const delay = orbEntranceDelay(`preview-${index}`, index);
			const result = entrancePose(index * 30, index * -20, delay + ENTRANCE_DURATION_MS, delay);
			expect(result).toEqual({ x: 0, y: 0, scale: 1, blur: 0, opacity: 1, done: true });
		}
	});

	it("clamps pre-start and completed times so a background-tab return cannot overshoot", () => {
		expect(entrancePose(100, -200, -500).scale).toBe(2.5);
		expect(entrancePose(100, -200, 100000)).toEqual({ x: 0, y: 0, scale: 1, blur: 0, opacity: 1, done: true });
	});
});
