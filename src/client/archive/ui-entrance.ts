import { ENTRANCE_DURATION_MS, entranceFilter, entrancePose } from "./entrance";

export const UI_ENTRANCE_CONTEXT = Symbol("archive-ui-entrance");
export type UiGroup = "sound" | "view" | "camera" | "search";
export interface UiPart { group: UiGroup; layer: number; item?: number }
const GROUP_ORDER: Record<UiGroup, number> = { sound: 0, view: 1, camera: 2, search: 3 };
const STYLE_PROPERTIES = ["opacity", "transform-origin", "will-change"];
export const UI_ENTRANCE_START_MS = ENTRANCE_DURATION_MS - 400;
export const UI_ENTRANCE_END_MS = UI_ENTRANCE_START_MS + GROUP_ORDER.search * 120 + 2 * 80 + ENTRANCE_DURATION_MS;

export function uiEntranceDelay({ group, layer, item = 0 }: UiPart): number {
	return UI_ENTRANCE_START_MS + GROUP_ORDER[group] * 120 + layer * 80 + item * 24;
}

export function uiEntranceFrames(x: number, y: number, opacity = 1): Keyframe[] {
	return Array.from({ length: 61 }, (_, index) => {
		const pose = entrancePose(x, y, index / 60 * ENTRANCE_DURATION_MS);
		return { offset: index / 60, opacity: pose.opacity * opacity, filter: entranceFilter(pose.blur), transform: `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})` };
	});
}

type PartRecord = {
	node: HTMLElement;
	config: UiPart;
	opacity: number;
	original: { property: string; value: string; priority: string }[];
	animation: Animation | null;
	done: boolean;
};

/** One page-wide timeline shared by independent UI layers and the scene entrance. */
export class UiEntranceController {
	private epoch: number | null = null;
	private ended = false;
	private requested = false;
	private startFrame = 0;
	private pausedAt: number | null = null;
	private pausedDuration = 0;
	private keyboardIntent = false;
	private records = new Set<PartRecord>();
	private cleanup: (() => void) | null = null;

	constructor(private readonly root: () => HTMLElement, private readonly onSkip: () => void, private readonly now = () => performance.now()) {}

	/** The clock stays at zero until the first visible, fully mounted browser frame. */
	elapsed(now = this.now()): number {
		return this.epoch === null ? 0 : Math.max(0, (this.pausedAt ?? now) - this.epoch - this.pausedDuration);
	}

	start(): void {
		if (this.requested || this.ended) return;
		this.requested = true;
		const media = matchMedia("(prefers-reduced-motion: reduce)");
		const preference = () => { if (media.matches) this.finish(true); };
		const keyboard = (event: KeyboardEvent) => { this.keyboardIntent = event.key === "Tab"; };
		const visibility = () => {
			if (document.visibilityState === "hidden") {
				cancelAnimationFrame(this.startFrame); this.startFrame = 0;
				if (this.epoch !== null && this.pausedAt === null) {
					this.pausedAt = this.now();
					for (const record of this.records) record.animation?.pause();
				}
			} else {
				if (this.pausedAt !== null) {
					this.pausedDuration += this.now() - this.pausedAt; this.pausedAt = null;
					for (const record of this.records) if (record.animation) {
						record.animation.currentTime = this.elapsed(); record.animation.play();
					}
				}
				this.scheduleStart();
			}
		};
		media.addEventListener("change", preference);
		document.addEventListener("visibilitychange", visibility);
		document.addEventListener("keydown", keyboard, true);
		this.cleanup = () => {
			media.removeEventListener("change", preference);
			document.removeEventListener("visibilitychange", visibility);
			document.removeEventListener("keydown", keyboard, true);
		};
		if (media.matches) this.finish(true);
		else this.scheduleStart();
	}

	private scheduleStart() {
		if (this.ended || this.epoch !== null || this.startFrame || document.visibilityState !== "visible") return;
		this.startFrame = requestAnimationFrame((now) => {
			this.startFrame = 0;
			if (this.ended || document.visibilityState !== "visible") return;
			this.epoch = now;
			for (const record of this.records) this.animate(record);
		});
	}

	private restore(record: PartRecord) {
		record.done = true;
		for (const { property, value, priority } of record.original) {
			if (value) record.node.style.setProperty(property, value, priority);
			else record.node.style.removeProperty(property);
		}
		record.animation?.cancel();
		record.animation = null;
	}

	private animate(record: PartRecord) {
		if (record.done || record.animation || this.epoch === null) return;
		const elapsed = this.elapsed();
		if (this.ended || elapsed >= UI_ENTRANCE_END_MS || typeof record.node.animate !== "function") { this.restore(record); return; }
		const rect = record.node.getBoundingClientRect(), canvas = this.root().getBoundingClientRect();
		const x = rect.left + rect.width / 2 - (canvas.left + canvas.width / 2);
		const y = rect.top + rect.height / 2 - (canvas.top + canvas.height / 2);
		record.node.style.setProperty("transform-origin", "50% 50%");
		record.node.style.setProperty("will-change", "transform, filter, opacity");
		const animation = record.node.animate(uiEntranceFrames(x, y, record.opacity), {
			duration: ENTRANCE_DURATION_MS, delay: uiEntranceDelay(record.config), easing: "linear", fill: "both",
		});
		record.animation = animation;
		animation.currentTime = elapsed;
		if (this.pausedAt !== null) animation.pause();
		animation.onfinish = () => {
			if (record.done) return;
			this.restore(record);
			if ([...this.records].every((part) => part.done)) this.ended = true;
		};
	}

	part = (node: HTMLElement, config: UiPart) => {
		const opacity = Number(getComputedStyle(node).opacity);
		const record: PartRecord = {
			node, config, opacity: Number.isFinite(opacity) ? opacity : 1,
			original: STYLE_PROPERTIES.map((property) => ({ property, value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property) })),
			animation: null, done: false,
		};
		this.records.add(record);
		if (this.ended || matchMedia("(prefers-reduced-motion: reduce)").matches) this.restore(record);
		else { node.style.setProperty("opacity", "0"); this.animate(record); }
		return { destroy: () => { this.restore(record); this.records.delete(record); } };
	};

	control = (node: HTMLElement) => {
		const skip = () => this.finish(true);
		// A reload may restore focus automatically. Only actual pointer/keyboard intent skips.
		const focus = () => { if (this.keyboardIntent) skip(); };
		node.addEventListener("pointerdown", skip, true);
		node.addEventListener("keydown", skip);
		node.addEventListener("focusin", focus);
		return { destroy: () => {
			node.removeEventListener("pointerdown", skip, true);
			node.removeEventListener("keydown", skip);
			node.removeEventListener("focusin", focus);
		} };
	};

	finish(interrupted = false) {
		if (this.ended) return;
		this.ended = true;
		cancelAnimationFrame(this.startFrame); this.startFrame = 0;
		for (const record of this.records) this.restore(record);
		if (interrupted) this.onSkip();
	}

	destroy() { this.finish(); this.cleanup?.(); this.records.clear(); }
}
