import { describe, expect, it } from "vitest";
import { DetailShadeTransition, logoHasExited, shadeMasks, SHADE_TRANSITION_MS } from "../../src/client/archive/detail-shade.ts";

describe("detail top shade", () => {
	it("switches only when the entire logo has passed the viewport top", () => {
		expect(logoHasExited(0.1, 0)).toBe(false);
		expect(logoHasExited(0, 0)).toBe(true);
		expect(logoHasExited(-100, 0)).toBe(true);
		expect(logoHasExited(20.1, 20)).toBe(false);
	});
	it("starts black, reveals color from top to bottom, and finishes at 560ms", () => {
		const transition = new DetailShadeTransition();
		expect(transition.sample(0)).toEqual([0, 0, 0, 0, 0]);
		transition.setColored(true, 1000);
		const progress = [...transition.sample(1100)];
		expect(progress[0]).toBeGreaterThan(progress[1]);
		expect(progress[1]).toBeGreaterThan(progress[2]);
		expect(progress[4]).toBe(0);
		transition.sample(1559); expect(transition.running).toBe(true);
		expect(SHADE_TRANSITION_MS).toBe(560);
		expect(transition.sample(1560)).toEqual([1, 1, 1, 1, 1]); expect(transition.running).toBe(false);
	});
	it("also restores black from top to bottom", () => {
		const transition = new DetailShadeTransition(); transition.setColored(true, 0, true);
		transition.setColored(false, 1000);
		const progress = transition.sample(1100);
		expect(progress[0]).toBeLessThan(progress[1]); expect(progress[1]).toBeLessThan(progress[2]); expect(progress[4]).toBe(1);
		expect(transition.sample(1560)).toEqual([0, 0, 0, 0, 0]);
	});
	it("retargets from the current values without a jump or restarting for repeated scroll events", () => {
		const transition = new DetailShadeTransition(); transition.setColored(true, 0);
		const before = [...transition.sample(230)];
		transition.setColored(false, 230); expect(transition.sample(230)).toEqual(before);
		transition.setColored(false, 300);
		expect(transition.sample(790)).toEqual([0, 0, 0, 0, 0]); expect(transition.running).toBe(false);
	});
	it("snaps immediately for reduced motion even during an active fade", () => {
		const transition = new DetailShadeTransition(); transition.setColored(true, 0); transition.sample(100);
		transition.setColored(true, 100, true); expect(transition.sample(100)).toEqual([1, 1, 1, 1, 1]); expect(transition.running).toBe(false);
		transition.setColored(false, 200, true); expect(transition.sample(200)).toEqual([0, 0, 0, 0, 0]);
	});
	it("uses complementary smooth mask stops without exposing values outside opacity bounds", () => {
		const transition = new DetailShadeTransition(); transition.setColored(true, 0);
		for (let time = 0; time <= 600; time += 10) expect(transition.sample(time).every((value) => value >= 0 && value <= 1)).toBe(true);
		const masks = shadeMasks([0, .25, .5, .75, 1]);
		expect(masks.color).toContain("rgba(0,0,0,0) 0%"); expect(masks.color).toContain("rgba(0,0,0,1) 100%");
		expect(masks.black).toContain("rgba(0,0,0,1) 0%"); expect(masks.black).toContain("rgba(0,0,0,0) 100%");
	});
});
