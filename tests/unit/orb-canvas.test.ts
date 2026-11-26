import { describe, expect, it } from "vitest";
import { orbEase, orbRenderBudget } from "../../src/client/archive/orb-canvas";

describe("orb rendering budget", () => {
	it("caps coarse-pointer devices at 30fps while retaining 60fps on desktop", () => {
		expect(orbRenderBudget(1, true, 3)).toEqual({ fps: 30, density: 2 });
		expect(orbRenderBudget(1, false, 2)).toEqual({ fps: 60, density: 2 });
	});
	it("lowers frame rate and pixel work for small orbs, restoring quality when enlarged", () => {
		expect(orbRenderBudget(.5, true, 3)).toEqual({ fps: 15, density: 1 });
		expect(orbRenderBudget(.35, false, 2)).toEqual({ fps: 15, density: .7 });
		expect(orbRenderBudget(2, true, 3)).toEqual({ fps: 30, density: 2 });
	});
	it("retains CSS ease-in-out symmetry for the original drift and glow", () => {
		expect(orbEase(0)).toBeCloseTo(0, 5);
		expect(orbEase(.5)).toBeCloseTo(.5, 3);
		expect(orbEase(1)).toBeCloseTo(1, 5);
		for (const p of [.1, .25, .4]) expect(orbEase(p) + orbEase(1 - p)).toBeCloseTo(1, 4);
		expect(orbEase(.25)).toBeCloseTo(.12916, 3);
	});
});
