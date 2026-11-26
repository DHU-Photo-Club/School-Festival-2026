import { describe, expect, it } from "vitest";
import { drawDust } from "../../src/client/common/dust.ts";
import { DUST_COUNT, DUST_RAMP_MS, dustPoses } from "../../src/shared/dust.ts";

describe("判定中の塵", () => {
	const [width, height] = [1920, 1080];
	const distance = (pose: { x: number; y: number }) => Math.hypot(pose.x - width / 2, pose.y - height / 2);

	it("同じ時刻には同じ塵を返し、始まる前と全体が消えたあとは何も出さない", () => {
		expect(dustPoses(5_000, width, height)).toEqual(dustPoses(5_000, width, height));
		expect(dustPoses(0, width, height)).toEqual([]);
		expect(dustPoses(-100, width, height)).toEqual([]);
		expect(dustPoses(5_000, width, height, 0)).toEqual([]);
	});

	it("塵の数と濃さは、時間とともに少しずつ増える", () => {
		const total = (elapsed: number) => dustPoses(elapsed, width, height).reduce((sum, pose) => sum + pose.alpha, 0);
		const counts = [1_000, 3_000, 5_000, 7_000, DUST_RAMP_MS].map((time) => dustPoses(time, width, height).length);
		for (let index = 1; index < counts.length; index++) expect(counts[index]).toBeGreaterThan(counts[index - 1]);
		const totals = [1_000, 3_000, 5_000, 7_000, DUST_RAMP_MS].map(total);
		for (let index = 1; index < totals.length; index++) expect(totals[index]).toBeGreaterThan(totals[index - 1]);
		// 始めは少しだけ、最後でもすべてが同時に出るわけではない。
		expect(counts[0]).toBeLessThan(DUST_COUNT * 0.1);
		expect(counts[counts.length - 1]).toBeLessThanOrEqual(DUST_COUNT);
	});

	it("塵は細かく、薄い。画面の縁の外から現れて、中心の近くで消える", () => {
		const poses = dustPoses(DUST_RAMP_MS, width, height);
		for (const pose of poses) {
			expect(pose.size).toBeLessThanOrEqual(5.5);
			expect(pose.alpha).toBeLessThanOrEqual(0.95);
		}
		// 中心から離れた塵と近い塵が両方ある。
		expect(Math.max(...poses.map(distance))).toBeGreaterThan(Math.min(width, height) / 2);
		expect(Math.min(...poses.map(distance))).toBeLessThan(Math.min(width, height) * 0.2);
	});

	it("一粒の塵は、外から中心へ向かって動く", () => {
		// 最初に現れる塵の動きを追う。
		const first = (elapsed: number) => dustPoses(elapsed, width, height)[0];
		const early = distance(first(700));
		const mid = distance(first(3_000));
		expect(mid).toBeLessThan(early);
	});

	it("全体の倍率で薄くなる", () => {
		const full = dustPoses(DUST_RAMP_MS, width, height);
		const half = dustPoses(DUST_RAMP_MS, width, height, 0.5);
		expect(half.length).toBeLessThanOrEqual(full.length);
		const sum = (poses: typeof full) => poses.reduce((acc, pose) => acc + pose.alpha, 0);
		expect(sum(half)).toBeCloseTo(sum(full) / 2, 0);
	});

	it("canvas に描き、塵がなければ消す", () => {
		const calls: string[] = [];
		const context = {
			canvas: { width: 100, height: 100 },
			setTransform: () => calls.push("transform"),
			clearRect: () => calls.push("clear"),
			save: () => calls.push("save"),
			restore: () => calls.push("restore"),
			beginPath: () => calls.push("begin"),
			moveTo: () => calls.push("move"),
			arc: () => calls.push("arc"),
			fill: () => calls.push("fill"),
			fillStyle: "",
		} as unknown as CanvasRenderingContext2D;
		drawDust(context, [], 1);
		expect(calls).not.toContain("fill");
		drawDust(context, dustPoses(5_000, width, height), 1);
		expect(calls).toContain("arc");
		expect(calls).toContain("fill");
	});
});
