import { afterEach, describe, expect, it, vi } from "vitest";
import { UiEntranceController, UI_ENTRANCE_END_MS, uiEntranceDelay, uiEntranceFrames } from "../../src/client/archive/ui-entrance.ts";
import { ENTRANCE_DURATION_MS } from "../../src/client/archive/entrance.ts";

class Style {
	values = new Map<string, { value: string; priority: string }>();
	getPropertyValue(key: string) { return this.values.get(key)?.value ?? ""; }
	getPropertyPriority(key: string) { return this.values.get(key)?.priority ?? ""; }
	setProperty(key: string, value: string, priority = "") { this.values.set(key, { value, priority }); }
	removeProperty(key: string) { const value = this.getPropertyValue(key); this.values.delete(key); return value; }
}
class Motion {
	currentTime: number | null = null;
	onfinish: (() => void) | null = null;
	cancel = vi.fn();
	pause = vi.fn();
	play = vi.fn();
}
class Node extends EventTarget {
	style = new Style();
	motions: Motion[] = [];
	getBoundingClientRect() { return { left: 120, top: 77, width: 51, height: 50 }; }
	animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => { const motion = new Motion(); this.motions.push(motion); return motion as unknown as Animation; });
}
function setup(reduced = false, visible = true) {
	const doc = Object.assign(new EventTarget(), { visibilityState: visible ? "visible" : "hidden" });
	const media = Object.assign(new EventTarget(), { matches: reduced });
	vi.stubGlobal("document", doc);
	vi.stubGlobal("matchMedia", () => media);
	vi.stubGlobal("getComputedStyle", (node: Node) => ({ opacity: node.style.getPropertyValue("opacity") || "1" }));
	const root = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 402, height: 874 }) } as unknown as HTMLElement;
	let now = 1000;
	let nextFrame = 0;
	const frames = new Map<number, FrameRequestCallback>();
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
	vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
	const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(now); };
	const skip = vi.fn();
	const controller = new UiEntranceController(() => root, skip, () => now);
	return { controller, media, doc, skip, flush, setTime: (value: number) => { now = value; } };
}
const element = (node: Node) => node as unknown as HTMLElement;
afterEach(() => vi.unstubAllGlobals());

describe("layered UI page entrance", () => {
	it("overlaps the end of the logo/orbs and orders backgrounds before foreground layers", () => {
		expect(uiEntranceDelay({ group: "sound", layer: 0 })).toBe(ENTRANCE_DURATION_MS - 200);
		for (const group of ["sound", "view", "camera", "search"] as const) {
			expect(uiEntranceDelay({ group, layer: 0 })).toBeLessThan(uiEntranceDelay({ group, layer: 1 }));
			expect(uiEntranceDelay({ group, layer: 1, item: 1 })).toBeLessThan(uiEntranceDelay({ group, layer: 2 }));
		}
		expect(uiEntranceDelay({ group: "search", layer: 2 }) + ENTRANCE_DURATION_MS).toBe(UI_ENTRANCE_END_MS);
	});

	it("uses the same perspective, scale, blur and exact final identity as the scene", () => {
		const frames = uiEntranceFrames(-100, -200);
		expect(frames[0]).toEqual({ offset: 0, opacity: 0, filter: "blur(14px)", transform: "translate(-150px, -300px) scale(2.5)" });
		expect(frames.at(-1)).toEqual({ offset: 1, opacity: 1, filter: "none", transform: "translate(0px, 0px) scale(1)" });
		expect(frames.every((frame, index) => !index || Number(frame.offset) > Number(frames[index - 1].offset))).toBe(true);
	});

	it("hides parts before first paint and projects from the page camera center on the shared clock", () => {
		const { controller, setTime, flush } = setup(); const background = new Node();
		controller.part(element(background), { group: "sound", layer: 0 });
		expect(background.style.getPropertyValue("opacity")).toBe("0"); expect(background.animate).not.toHaveBeenCalled();
		controller.start(); flush(); expect(controller.elapsed()).toBe(0);
		expect(background.animate.mock.calls[0][1]).toEqual({ duration: 900, delay: 700, easing: "linear", fill: "both" });
		expect(background.animate.mock.calls[0][0][0].transform).toBe("translate(-233.25px, -577.5px) scale(2.5)");
		setTime(1250); const icon = new Node(); controller.part(element(icon), { group: "sound", layer: 1 });
		expect(icon.motions[0].currentTime).toBe(250);
		controller.start(); flush(); expect(background.animate).toHaveBeenCalledOnce();
	});

	it("restores original styles and skips all layers when a UI control is touched or focused", () => {
		const { controller, skip, flush } = setup(); const node = new Node(), control = new Node();
		node.style.setProperty("opacity", "0.65", "important");
		node.style.setProperty("transform-origin", "left center");
		controller.part(element(node), { group: "view", layer: 2 }); controller.start(); flush();
		const handler = controller.control(element(control));
		control.dispatchEvent(new Event("pointerdown"));
		expect(skip).toHaveBeenCalledOnce(); expect(node.motions[0].cancel).toHaveBeenCalledOnce();
		expect(node.style.getPropertyValue("opacity")).toBe("0.65"); expect(node.style.getPropertyPriority("opacity")).toBe("important");
		expect(node.style.getPropertyValue("transform-origin")).toBe("left center"); expect(node.style.getPropertyValue("will-change")).toBe("");
		control.dispatchEvent(new Event("focusin")); expect(skip).toHaveBeenCalledOnce(); handler.destroy();
	});

	it("cleans up naturally without skipping the scene or replaying remounted UI", () => {
		const { controller, skip, setTime, flush } = setup(); const node = new Node();
		controller.part(element(node), { group: "search", layer: 2 }); controller.start(); flush(); setTime(1000 + UI_ENTRANCE_END_MS);
		node.motions[0].onfinish?.();
		expect(skip).not.toHaveBeenCalled(); expect(node.style.getPropertyValue("opacity")).toBe("");
		const remounted = new Node(); controller.part(element(remounted), { group: "camera", layer: 0 });
		expect(remounted.animate).not.toHaveBeenCalled(); expect(remounted.style.getPropertyValue("opacity")).toBe("");
	});

	it("does not restart late parts after the page entrance deadline", () => {
		const { controller, setTime, flush } = setup(); controller.start(); flush(); setTime(5000);
		const node = new Node(); controller.part(element(node), { group: "camera", layer: 1 });
		expect(node.animate).not.toHaveBeenCalled(); expect(node.style.getPropertyValue("opacity")).toBe("");
	});

	it("honors reduced motion immediately and also during playback", () => {
		const first = setup(true); const still = new Node();
		first.controller.part(element(still), { group: "sound", layer: 0 }); first.controller.start();
		expect(still.animate).not.toHaveBeenCalled(); expect(still.style.getPropertyValue("opacity")).toBe(""); first.controller.destroy();
		const second = setup(); const moving = new Node();
		second.controller.part(element(moving), { group: "sound", layer: 0 }); second.controller.start(); second.flush();
		second.media.matches = true; second.media.dispatchEvent(new Event("change"));
		expect(moving.motions[0].cancel).toHaveBeenCalledOnce(); expect(second.skip).toHaveBeenCalledOnce();
	});

	it("pauses on backgrounding without consuming or cancelling the opening timeline", () => {
		const { controller, doc, skip, media, flush, setTime } = setup(); const node = new Node();
		const part = controller.part(element(node), { group: "sound", layer: 0 }); controller.start(); flush();
		setTime(1300); doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
		expect(skip).not.toHaveBeenCalled(); expect(node.motions[0].pause).toHaveBeenCalledOnce();
		setTime(8000); expect(controller.elapsed()).toBe(300);
		doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange"));
		expect(controller.elapsed()).toBe(300); expect(node.motions[0].currentTime).toBe(300); expect(node.motions[0].play).toHaveBeenCalledOnce();
		part.destroy(); controller.destroy(); skip.mockClear();
		media.matches = true; media.dispatchEvent(new Event("change")); doc.dispatchEvent(new Event("visibilitychange"));
		expect(skip).not.toHaveBeenCalled(); expect(node.style.getPropertyValue("will-change")).toBe("");
	});

	it("does not treat browser-restored focus on reload as a user request to skip", () => {
		const { controller, skip, flush, setTime } = setup(); const node = new Node(), control = new Node();
		controller.part(element(node), { group: "search", layer: 2 }); controller.control(element(control));
		control.dispatchEvent(new Event("focusin")); controller.start();
		expect(skip).not.toHaveBeenCalled(); expect(node.animate).not.toHaveBeenCalled();
		setTime(1200); flush(); // Actual first visible frame determines time zero.
		expect(controller.elapsed()).toBe(0); expect(node.animate).toHaveBeenCalledOnce();
		control.dispatchEvent(new Event("focusin")); expect(skip).not.toHaveBeenCalled();
		setTime(1500); expect(controller.elapsed()).toBe(300);
	});

	it("skips when focus follows a real Tab navigation or the user types in a restored field", () => {
		const first = setup(); const control = new Node(); first.controller.control(element(control)); first.controller.start(); first.flush();
		first.doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Tab" }));
		control.dispatchEvent(new Event("focusin")); expect(first.skip).toHaveBeenCalledOnce(); first.controller.destroy();
		const second = setup(); const restored = new Node(); second.controller.control(element(restored)); second.controller.start(); second.flush();
		restored.dispatchEvent(new Event("focusin")); expect(second.skip).not.toHaveBeenCalled();
		restored.dispatchEvent(new Event("keydown")); expect(second.skip).toHaveBeenCalledOnce();
	});

	it("waits for a visible frame if the document initially loads hidden", () => {
		const { controller, doc, skip, flush, setTime } = setup(false, false); const node = new Node();
		controller.part(element(node), { group: "sound", layer: 0 }); controller.start();
		setTime(10000); flush(); expect(node.animate).not.toHaveBeenCalled(); expect(controller.elapsed()).toBe(0);
		doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); flush();
		expect(node.animate).toHaveBeenCalledOnce(); expect(controller.elapsed()).toBe(0); expect(skip).not.toHaveBeenCalled();
	});

	it("starts a fresh opening on a new page instance after a completed previous page", () => {
		const first = setup(); const old = new Node(); first.controller.part(element(old), { group: "sound", layer: 0 }); first.controller.start(); first.flush(); first.controller.finish(); first.controller.destroy();
		const next = setup(); const fresh = new Node(); next.controller.part(element(fresh), { group: "sound", layer: 0 }); next.controller.start(); next.flush();
		expect(fresh.animate).toHaveBeenCalledOnce(); expect(fresh.motions[0].currentTime).toBe(0);
	});

});
