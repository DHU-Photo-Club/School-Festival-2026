import { describe, expect, it } from "vitest";
import { ScatterCamera, LOGO_TARGET, MAX_SCALE, MIN_SCALE, centeredPose, projectTarget, nearestTarget, springAxis, floatingLagSeconds, stepFloating, type FloatingState } from "../../src/client/archive/scatter-camera.ts";

const targets = [{ id: "a", x: 280, y: 0 }, { id: "b", x: -450, y: 100 }, { id: "far", x: 1400, y: -1300 }];
function run(camera: ScatterCamera, fps = 60) { for (let i = 0; i < fps * 3 && camera.running; i++) camera.advance(1 / fps); expect(camera.mode).toBe("idle"); }
function centered(camera: ScatterCamera, target: { x: number; y: number }) {
	const point = projectTarget(target, camera.pose, camera.width, camera.height);
	expect(point.x).toBeCloseTo(camera.width / 2, 9);
	expect(point.y).toBeCloseTo(camera.height / 2, 9);
}

describe("scatter camera", () => {
	it("retains the exact pose when a detail interrupts a pending snap or zoom", () => {
		for (const mode of ["snap", "zoom"]) {
			const camera = new ScatterCamera(targets);
			camera.panBy(123, -87);
			if (mode === "snap") camera.endInteraction(false); else camera.zoomBy(1.5);
			const before = camera.pose;
			camera.stopMotion();
			for (let i = 0; i < 120; i++) camera.advance(1 / 60);
			expect(camera.pose).toEqual(before);
			expect(camera.running).toBe(false);
			camera.focus("a"); run(camera); centered(camera, targets[0]);
		}
	});
	it("centers every target including the logo at every supported zoom and orientation", () => {
		for (const [width, height] of [[320, 568], [390, 844], [402, 874], [874, 402], [768, 1024], [1280, 800], [1920, 1080]]) for (const scale of [MIN_SCALE, 1, 1.5, MAX_SCALE]) {
			const camera = new ScatterCamera(targets); camera.resize(width, height);
			camera.zoomAt(scale);
			for (const target of [LOGO_TARGET, ...targets]) { camera.focus(target.id); run(camera); centered(camera, target); expect(camera.scale).toBe(scale); }
		}
	});

	it("uses the closest logical center, with previous target then logo then list order as tie-breakers", () => {
		const pose = { x: -140, y: 0, scale: 1 };
		expect(nearestTarget(targets, pose, 402, 874).id).toBe(LOGO_TARGET.id);
		expect(nearestTarget(targets, pose, 402, 874, "a").id).toBe("a");
		expect(nearestTarget([{ id: "one", x: 200, y: -10 }, { id: "two", x: 200, y: 10 }], { x: -200, y: 0, scale: 1 }, 402, 874).id).toBe("one");
	});

	it("coasts first and selects the landing area's nearest target rather than the release area's", () => {
		const camera = new ScatterCamera(targets);
		camera.beginInteraction(); camera.panBy(-80, 0);
		expect(nearestTarget(targets, camera.pose, 402, 874).id).toBe(LOGO_TARGET.id);
		camera.vx = -1500; camera.endInteraction(true);
		expect(camera.mode).toBe("coasting");
		run(camera);
		expect(camera.centeredId).toBe("a"); centered(camera, targets[0]);
	});

	it("locks its snap target and finishes within 900ms, independent of refresh rate", () => {
		for (const fps of [30, 60, 120]) {
			const camera = new ScatterCamera(targets);
			camera.beginInteraction(); camera.panBy(-250, 100); camera.endInteraction(false);
			expect(camera.lockedTarget?.id).toBe("a");
			let seconds = 0;
			while (camera.running && seconds < 1) { camera.advance(1 / fps); seconds += 1 / fps; }
			expect(seconds).toBeLessThanOrEqual(0.9 + 1 / fps);
			centered(camera, targets[0]);
		}
	});

	it("caps flick speed and stops outward inertia at the world bounds", () => {
		const camera = new ScatterCamera(targets);
		camera.beginInteraction(); camera.vx = 10000; camera.vy = 10000; camera.endInteraction(true);
		expect(Math.hypot(camera.vx, camera.vy)).toBeCloseTo(2000, 8);
		camera.beginInteraction(); camera.panBy(1e6, 1e6, 0.008, true);
		expect(camera.vx).toBe(0); expect(camera.vy).toBe(0);
		camera.endInteraction(true); run(camera);
		centered(camera, [LOGO_TARGET, ...targets].find((target) => target.id === camera.centeredId)!);
	});

	it("interrupts a snap and gives a subsequent drag control immediately", () => {
		const camera = new ScatterCamera(targets);
		camera.focus("far"); camera.advance(0.05);
		const before = camera.pose;
		camera.beginInteraction(); camera.panBy(10, 15);
		expect(camera.lockedTarget).toBeNull(); expect(camera.mode).toBe("dragging");
		camera.advance(0.5);
		expect(camera.x).toBeCloseTo(before.x + 10); expect(camera.y).toBeCloseTo(before.y + 15);
	});

	it("preserves the pinch focal point and snaps only after all-pointer interaction ends", () => {
		const camera = new ScatterCamera(targets);
		camera.beginInteraction("pinching");
		const focal = { x: 110, y: 210 };
		camera.zoomAt(2, focal.x, focal.y);
		expect(focal.x * 2 + camera.x).toBe(focal.x); expect(focal.y * 2 + camera.y).toBe(focal.y);
		const before = camera.pose;
		camera.beginInteraction("dragging"); camera.panBy(8, 9);
		expect(camera.x).toBe(before.x + 8); expect(camera.y).toBe(before.y + 9);
		camera.advance(0.5); expect(camera.mode).toBe("dragging");
		camera.endInteraction(false); run(camera); expect(camera.scale).toBe(2);
		centered(camera, [LOGO_TARGET, ...targets].find((target) => target.id === camera.centeredId)!);
	});

	it("waits 140ms after wheel/arrow input, and a new input restarts that wait", () => {
		const camera = new ScatterCamera(targets);
		camera.beginInteraction(); camera.panBy(-250, 0); camera.queueSnap();
		camera.advance(0.1); expect(camera.mode).toBe("waiting");
		camera.beginInteraction(); camera.panBy(-10, 0); camera.queueSnap();
		camera.advance(0.1); expect(camera.mode).toBe("waiting");
		camera.advance(0.041); expect(camera.mode).toBe("snapping"); run(camera); centered(camera, targets[0]);
	});

	it("animates button zoom without an immediate jump, retaining the centered orb at every frame", () => {
		for (const fps of [30, 60, 120]) for (const factor of [1.25, 1 / 1.25]) {
			const camera = new ScatterCamera(targets); camera.focus("a"); run(camera);
			const start = camera.pose; camera.zoomBy(factor);
			expect(camera.pose).toEqual(start); expect(camera.mode).toBe("zooming");
			let previous = camera.scale;
			while (camera.mode === "zooming") {
				camera.advance(1 / fps); centered(camera, targets[0]);
				expect(camera.scale).toBeGreaterThanOrEqual(Math.min(1, factor));
				expect(camera.scale).toBeLessThanOrEqual(Math.max(1, factor));
				expect((camera.scale - previous) * Math.sign(factor - 1)).toBeGreaterThanOrEqual(0);
				previous = camera.scale;
			}
			run(camera); expect(camera.scale).toBe(factor); expect(camera.centeredId).toBe("a");
		}
	});

	it("accumulates quick zoom clicks and reverses direction from the currently rendered pose", () => {
		const camera = new ScatterCamera(targets);
		camera.zoomBy(1.25); camera.advance(0.05);
		const before = camera.pose; camera.zoomBy(1.25); expect(camera.pose).toEqual(before);
		camera.advance(0.05); const reversing = camera.pose;
		camera.zoomBy(1 / 1.25); expect(camera.pose).toEqual(reversing);
		run(camera); expect(camera.scale).toBe(1.25); centered(camera, LOGO_TARGET);
	});

	it("clamps button zoom at both limits and still centers correctly after resizing mid-flight", () => {
		const camera = new ScatterCamera(targets); camera.focus("b"); run(camera);
		camera.zoomBy(100); camera.advance(0.1); camera.resize(874, 402); centered(camera, targets[1]);
		run(camera); expect(camera.scale).toBe(MAX_SCALE); centered(camera, targets[1]);
		camera.zoomBy(0.001); run(camera); expect(camera.scale).toBe(MIN_SCALE); centered(camera, targets[1]);
	});

	it("gives drag, pinch, search and reset priority over a pending zoom goal", () => {
		for (const mode of ["dragging", "pinching"] as const) {
			const camera = new ScatterCamera(targets); camera.zoomBy(1.25); camera.advance(0.05);
			const scale = camera.scale;
			camera.beginInteraction(mode); camera.panBy(8, 9); const pose = camera.pose;
			camera.advance(1); expect(camera.pose).toEqual(pose); expect(camera.scale).toBe(scale);
			camera.endInteraction(false); run(camera);
		}
		const camera = new ScatterCamera(targets); camera.zoomBy(1.25); camera.advance(0.05);
		const interruptedScale = camera.scale; camera.focus("far"); run(camera);
		expect(camera.scale).toBe(interruptedScale); centered(camera, targets[2]);
		camera.zoomBy(1.25); camera.advance(0.05); camera.reset();
		camera.advance(1); expect(camera.scale).toBe(1); centered(camera, LOGO_TARGET);
	});

	it("applies zoom immediately for reduced motion, including a preference change mid-flight", () => {
		const camera = new ScatterCamera(targets); camera.setReducedMotion(true);
		camera.zoomBy(1.25); expect(camera.scale).toBe(1.25); expect(camera.mode).toBe("idle");
		camera.setReducedMotion(false); camera.zoomBy(1.25); camera.advance(0.05);
		camera.setReducedMotion(true); expect(camera.scale).toBe(1.5625); expect(camera.mode).toBe("idle"); centered(camera, LOGO_TARGET);
	});

	it("lets search override both inertia and nearest-target snapping", () => {
		const camera = new ScatterCamera(targets);
		camera.beginInteraction(); camera.vx = 1000; camera.endInteraction(true);
		camera.focus("far"); expect(camera.mode).toBe("searching");
		run(camera); expect(camera.centeredId).toBe("far"); centered(camera, targets[2]);
	});

	it("cancels search travel at its current location without cancelling unrelated zoom or drag", () => {
		const camera = new ScatterCamera(targets);
		camera.focus("far"); camera.advance(0.02);
		const before = camera.pose;
		camera.cancelSearch(); expect(camera.pose).toEqual(before);
		expect(camera.mode).toBe("snapping"); expect(camera.lockedTarget?.id).toBe(LOGO_TARGET.id);
		run(camera); centered(camera, LOGO_TARGET);
		camera.zoomBy(1.25); camera.advance(0.05); camera.cancelSearch();
		expect(camera.mode).toBe("zooming"); run(camera); expect(camera.scale).toBe(1.25);
		camera.beginInteraction(); camera.panBy(10, 20); camera.cancelSearch(); expect(camera.mode).toBe("dragging");
	});

	it("keeps the centered target after resize, handles deletion, and resets to the logo at 100%", () => {
		const camera = new ScatterCamera(targets);
		camera.zoomAt(2); camera.focus("b"); run(camera);
		camera.resize(874, 402); centered(camera, targets[1]);
		camera.setTargets([]); run(camera); centered(camera, LOGO_TARGET);
		camera.reset(); expect(camera.scale).toBe(1); centered(camera, LOGO_TARGET);
	});

	it("updates a locked target when positions change and handles an empty world", () => {
		const camera = new ScatterCamera(targets);
		camera.focus("a"); camera.advance(0.02);
		const moved = { id: "a", x: 500, y: 300 };
		camera.setTargets([moved]); run(camera); centered(camera, moved);
		camera.setTargets([]); run(camera); centered(camera, LOGO_TARGET);
		camera.beginInteraction(); camera.panBy(800, -900); camera.endInteraction(false); run(camera);
		centered(camera, LOGO_TARGET);
	});

	it("disables inertia and animated snapping for reduced motion, including a live preference change", () => {
		const camera = new ScatterCamera(targets);
		camera.setReducedMotion(true); camera.beginInteraction(); camera.panBy(-250, 0, 0.01, true); camera.endInteraction(true);
		expect(camera.mode).toBe("idle"); centered(camera, targets[0]);
		camera.setReducedMotion(false); camera.focus("far"); camera.advance(0.02); camera.setReducedMotion(true);
		expect(camera.mode).toBe("idle"); centered(camera, targets[2]);
	});
});

describe("floating motion", () => {
	it("gives deterministic 60–120ms lag without using random color generation", () => {
		const values = Array.from({ length: 50 }, (_, i) => floatingLagSeconds(`preview-${i}`));
		expect(values.every((value) => value >= 0.06 && value <= 0.12)).toBe(true);
		expect(new Set(values).size).toBeGreaterThan(1);
		expect(floatingLagSeconds("a")).toBe(floatingLagSeconds("a"));
	});

	it("trails the movement, stays within 20 screen pixels, and settles back to zero", () => {
		for (const scale of [0.35, 1, 3]) {
			let state: FloatingState = { x: 0, y: 0, vx: 0, vy: 0 };
			for (let i = 0; i < 120; i++) {
				state = stepFloating(state, { x: 2000, y: -1800 }, 0.12, 1 / 60);
				expect(state.x).toBeLessThan(0); expect(state.y).toBeGreaterThan(0);
				expect(Math.hypot(state.x / scale, state.y / scale) * scale).toBeLessThanOrEqual(20 + 1e-9);
			}
			for (let i = 0; i < 120; i++) state = stepFloating(state, { x: 0, y: 0 }, 0.12, 1 / 60);
			expect(Math.hypot(state.x, state.y)).toBeLessThan(0.001);
		}
	});

	it("uses a critically damped spring that composes across frame steps without overshoot", () => {
		const one = springAxis(200, 0, 0, 0.1);
		let split = { position: 200, velocity: 0 };
		for (let i = 0; i < 10; i++) split = springAxis(split.position, split.velocity, 0, 0.01);
		expect(split.position).toBeCloseTo(one.position, 10); expect(split.velocity).toBeCloseTo(one.velocity, 10);
		expect(one.position).toBeGreaterThan(0);
	});

	it("centers using the logical anchor rather than a transient float displacement", () => {
		const pose = centeredPose(targets[0], 3, 402, 874);
		expect(nearestTarget(targets, pose, 402, 874).id).toBe("a");
	});
});
