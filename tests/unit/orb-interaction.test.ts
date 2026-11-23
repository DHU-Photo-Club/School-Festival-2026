import { afterEach, describe, expect, it, vi } from "vitest";
import { ORB_MAGNET_LIMIT, orbPointerResponse, stepOrbExpansion, stepOrbMagnet, watchOrbInteraction } from "../../src/client/archive/orb-interaction.ts";

const bounds = { left: 100, top: 100, width: 146.381, height: 138.211 };
const origin = () => ({ x: 0, y: 0, vx: 0, vy: 0 });
const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.unstubAllGlobals(); });

describe("desktop orb pointer response", () => {
	it("settles after one gentle overshoot without a visible second bounce at every refresh rate", () => {
		for (const fps of [30, 60, 120]) {
			let state = { position: 0, velocity: 0 };
			let peak = 0, returnMinimum = Infinity;
			for (let i = 0; i < fps * 3; i++) {
				state = stepOrbExpansion(state, 1, 1 / fps);
				peak = Math.max(peak, state.position);
				if (peak > 1.025) returnMinimum = Math.min(returnMinimum, state.position);
			}
			expect(peak).toBeGreaterThan(1.025); expect(peak).toBeLessThan(1.05);
			expect(returnMinimum).toBeGreaterThan(0.998);
			expect(state.position).toBeCloseTo(1, 5); expect(Math.abs(state.velocity)).toBeLessThan(0.0001);
		}
	});

	it("preserves velocity on reversal and composes across frame steps without restarting the spring", () => {
		const initial = { position: 0, velocity: 0 };
		const moving = stepOrbExpansion(initial, 1, 0.1);
		expect(stepOrbExpansion(moving, 0, 0)).toEqual(moving);
		const one = stepOrbExpansion(moving, 0, 0.2);
		let split = moving;
		for (let i = 0; i < 20; i++) split = stepOrbExpansion(split, 0, 0.01);
		expect(split.position).toBeCloseTo(one.position, 10); expect(split.velocity).toBeCloseTo(one.velocity, 10);
		for (let i = 0; i < 180; i++) split = stepOrbExpansion(split, 0, 1 / 60);
		expect(Math.abs(split.position)).toBeLessThan(0.00001);
	});
	it("attracts toward nearby cursors, with smooth falloff and a screen-space limit at every zoom", () => {
		for (const scale of [0.35, 1, 1.5, 3]) {
			const box = { ...bounds, width: bounds.width * scale, height: bounds.height * scale };
			const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
			for (const dx of [-250, -100, -30, 0, 30, 100, 250]) {
				const result = orbPointerResponse({ x: center.x + dx, y: center.y }, box);
				expect(Math.hypot(result.x, result.y)).toBeLessThanOrEqual(ORB_MAGNET_LIMIT + 1e-9);
				expect(result.x * dx).toBeGreaterThanOrEqual(0); expect(result.y).toBe(0);
			}
			const reach = box.height / 2 + 140;
			expect(orbPointerResponse({ x: center.x + reach + 1, y: center.y }, box).x).toBe(0);
			expect(orbPointerResponse({ x: center.x + reach - 0.01, y: center.y }, box).x).toBeLessThan(0.001);
			expect(orbPointerResponse(center, box)).toEqual({ x: 0, y: 0, hovered: true, proximity: 1 });
		}
	});

	it("distinguishes an orb hover from proximity and is neutral without a cursor", () => {
		const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
		expect(orbPointerResponse({ x: center.x + 100, y: center.y }, bounds).hovered).toBe(false);
		expect(orbPointerResponse({ x: center.x + 20, y: center.y }, bounds).hovered).toBe(true);
		expect(orbPointerResponse(null, bounds)).toEqual({ x: 0, y: 0, hovered: false, proximity: 0 });
	});

	it("increases glow strength smoothly before reaching the hover boundary and fades to zero at a distance", () => {
		const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
		let previous = 0;
		for (const distance of [300, 200, 150, 100, 50, 0]) {
			const result = orbPointerResponse({ x: center.x + distance, y: center.y }, bounds);
			expect(result.proximity).toBeGreaterThanOrEqual(previous);
			expect(result.proximity).toBeLessThanOrEqual(1); previous = result.proximity;
			if (distance === 100) { expect(result.hovered).toBe(false); expect(result.proximity).toBeGreaterThan(0); }
		}
	});

	it("eases toward the cursor and back to rest without full tracking or unbounded displacement", () => {
		for (const fps of [30, 60, 120]) {
			let state = origin();
			for (let i = 0; i < fps; i++) {
				state = stepOrbMagnet(state, { x: 8, y: -5 }, 1 / fps);
				expect(Math.hypot(state.x, state.y)).toBeLessThanOrEqual(ORB_MAGNET_LIMIT);
			}
			expect(state.x).toBeCloseTo(8, 3); expect(state.y).toBeCloseTo(-5, 3);
			for (let i = 0; i < fps; i++) state = stepOrbMagnet(state, { x: 0, y: 0 }, 1 / fps);
			expect(Math.hypot(state.x, state.y)).toBeLessThan(0.001);
		}
	});

	it("shares listeners and a frame loop, ignores UI, resets offscreen/disabled and cleans up", () => {
		class Host extends EventTarget {
			dataset: { orbHover?: string } = {};
			values = new Map<string, string>();
			style = { setProperty: (key: string, value: string) => this.values.set(key, value), removeProperty: (key: string) => this.values.delete(key) };
			getBoundingClientRect = () => bounds;
			closest = (_selector: string): object | null => null;
		}
		const win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
		const media = Object.assign(new EventTarget(), { matches: true });
		let notify: (target: Host, visible: boolean) => void = () => {};
		let now = 1000, nextId = 0;
		const frames = new Map<number, FrameRequestCallback>();
		const disconnect = vi.fn();
		vi.stubGlobal("window", win); vi.stubGlobal("document", doc); vi.stubGlobal("Element", Host);
		vi.stubGlobal("performance", { now: () => now }); vi.stubGlobal("matchMedia", () => media);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; });
		vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
		vi.stubGlobal("IntersectionObserver", class {
			constructor(callback: (entries: { target: Host; isIntersecting: boolean }[]) => void) { notify = (target, visible) => callback([{ target, isIntersecting: visible }]); }
			observe() {} unobserve() {} disconnect = disconnect;
		});
		const flush = () => { now += 16; const batch = [...frames.values()]; frames.clear(); for (const callback of batch) callback(now); };
		const pointer = (target: object = win) => {
			const event = Object.assign(new Event("pointermove"), { pointerType: "mouse", buttons: 0, clientX: 195, clientY: 170 });
			Object.defineProperty(event, "target", { value: target }); win.dispatchEvent(event);
		};
		const a = new Host(), b = new Host();
		cleanups.push(watchOrbInteraction(a as unknown as HTMLElement), watchOrbInteraction(b as unknown as HTMLElement));
		notify(a, true); notify(b, true); pointer();
		expect(frames.size).toBe(1); flush(); expect(a.dataset.orbHover).toBe("true"); expect(b.dataset.orbHover).toBe("true");
		const ui = new Host(); ui.closest = () => ({}); pointer(ui); flush(); expect(a.dataset.orbHover).toBe("false");
		pointer(); flush(); notify(a, false); expect(a.dataset.orbHover).toBeUndefined(); expect(a.values.size).toBe(0);
		media.matches = false; media.dispatchEvent(new Event("change")); expect(b.dataset.orbHover).toBeUndefined(); expect(frames.size).toBe(0);
		while (cleanups.length) cleanups.pop()!(); expect(disconnect).toHaveBeenCalledOnce();
		pointer(); expect(frames.size).toBe(0);
	});
});
