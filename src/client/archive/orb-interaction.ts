import { limitVector, springAxis, type FloatingState, type Point, type SpringAxis } from "./scatter-camera";

type OrbBounds = { left: number; top: number; width: number; height: number };
export const ORB_MAGNET_LIMIT = 10;

/** All distances and offsets are screen pixels, independent of camera zoom. */
export function orbPointerResponse(pointer: Point | null, bounds: OrbBounds) {
	if (!pointer) return { x: 0, y: 0, hovered: false, proximity: 0 };
	const dx = pointer.x - (bounds.left + bounds.width / 2);
	const dy = pointer.y - (bounds.top + bounds.height / 2);
	const distance = Math.hypot(dx, dy);
	const radius = Math.min(bounds.width, bounds.height) / 2;
	const proximity = Math.max(0, 1 - distance / (radius + 140));
	const weight = proximity * proximity * (3 - 2 * proximity);
	return { ...limitVector({ x: dx * weight * 0.12, y: dy * weight * 0.12 }, ORB_MAGNET_LIMIT), hovered: distance <= radius, proximity: weight };
}

export function stepOrbMagnet(state: FloatingState, target: Point, dt: number): FloatingState {
	const x = springAxis(state.x, state.vx, target.x, dt, 16);
	const y = springAxis(state.y, state.vy, target.y, dt, 16);
	return { ...limitVector({ x: x.position, y: y.position }, ORB_MAGNET_LIMIT), vx: x.velocity, vy: y.velocity };
}

/** A softly damped spring: one small overshoot, with subsequent movement below visibility. */
export function stepOrbExpansion(state: SpringAxis, target: number, dt: number): SpringAxis {
	if (dt <= 0) return state;
	const frequency = 12, dampingRatio = 0.72;
	const damping = frequency * dampingRatio;
	const oscillation = frequency * Math.sqrt(1 - dampingRatio ** 2);
	const error = state.position - target;
	const coefficient = (state.velocity + damping * error) / oscillation;
	const decay = Math.exp(-damping * dt), cosine = Math.cos(oscillation * dt), sine = Math.sin(oscillation * dt);
	return {
		position: target + decay * (error * cosine + coefficient * sine),
		velocity: decay * ((oscillation * coefficient - damping * error) * cosine - (oscillation * error + damping * coefficient) * sine),
	};
}

type Record = { node: HTMLElement; visible: boolean; hovered: boolean; proximity: number; state: FloatingState; expansion: SpringAxis };
const records = new Map<Element, Record>();
const zero = (): FloatingState => ({ x: 0, y: 0, vx: 0, vy: 0 });
let pointer: Point | null = null;
let frame = 0;
let lastTime = 0;
let preference: MediaQueryList | null = null;
let observer: IntersectionObserver | null = null;

const enabled = () => preference?.matches && document.visibilityState === "visible";

function paint(record: Record, bounds: OrbBounds) {
	// Translate an inner layer: the measured host and the hover center never move in response.
	const scale = Math.max(0.01, bounds.width / 146.381);
	record.node.style.setProperty("--orb-magnet-x", `${record.state.x / scale}px`);
	record.node.style.setProperty("--orb-magnet-y", `${record.state.y / scale}px`);
	record.node.dataset.orbHover = String(record.hovered);
	record.node.style.setProperty("--orb-proximity", String(record.proximity));
	record.node.style.setProperty("--orb-expansion", String(record.expansion.position));
}

function reset(record: Record) {
	record.state = zero(); record.hovered = false; record.proximity = 0;
	record.expansion = { position: 0, velocity: 0 };
	record.node.style.removeProperty("--orb-magnet-x"); record.node.style.removeProperty("--orb-magnet-y");
	record.node.style.removeProperty("--orb-proximity");
	record.node.style.removeProperty("--orb-expansion");
	delete record.node.dataset.orbHover;
}

function update(now: number) {
	frame = 0;
	if (!enabled()) return;
	const dt = Math.max(0.001, Math.min(0.032, (now - lastTime) / 1000)); lastTime = now;
	let moving = false;
	// Read layout before writing any transforms.
	const visible = [...records.values()].filter((record) => record.visible).map((record) => ({ record, bounds: record.node.getBoundingClientRect() }));
	for (const { record, bounds } of visible) {
		const blocked = record.node.closest('[inert], [data-entering="true"]');
		const target = orbPointerResponse(blocked ? null : pointer, bounds);
		record.hovered = target.hovered;
		record.proximity = target.proximity;
		record.state = stepOrbMagnet(record.state, target, dt);
		const settling = Math.hypot(record.state.x - target.x, record.state.y - target.y) > 0.02 || Math.hypot(record.state.vx, record.state.vy) > 0.1;
		if (!settling) record.state = { x: target.x, y: target.y, vx: 0, vy: 0 };
		const expansionTarget = record.hovered ? 1 : 0;
		record.expansion = stepOrbExpansion(record.expansion, expansionTarget, dt);
		const expanding = Math.abs(record.expansion.position - expansionTarget) > 0.0005 || Math.abs(record.expansion.velocity) > 0.005;
		if (!expanding) record.expansion = { position: expansionTarget, velocity: 0 };
		moving ||= settling || expanding;
		paint(record, bounds);
	}
	if (moving) frame = requestAnimationFrame(update);
}

/** Also called when the scene camera moves under a stationary cursor. */
export function refreshOrbInteractions() {
	if (!records.size || frame || !enabled()) return;
	lastTime = performance.now(); frame = requestAnimationFrame(update);
}

function move(event: PointerEvent) {
	if (event.pointerType !== "mouse") return;
	const overUi = event.target instanceof Element && event.target.closest('button, input, form, [role="group"]');
	pointer = !event.buttons && !overUi ? { x: event.clientX, y: event.clientY } : null;
	refreshOrbInteractions();
}
function clear() { pointer = null; refreshOrbInteractions(); }
function leave(event: PointerEvent) { if (!event.relatedTarget) clear(); }
function change() {
	if (!enabled()) {
		pointer = null; cancelAnimationFrame(frame); frame = 0;
		for (const record of records.values()) reset(record);
	} else refreshOrbInteractions();
}

/** One shared pointer listener, visibility observer and RAF for both views. */
export function watchOrbInteraction(node: HTMLElement): () => void {
	if (!records.size) {
		preference = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
		observer = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const record = records.get(entry.target);
				if (record) { record.visible = entry.isIntersecting; if (!record.visible) reset(record); }
			}
			refreshOrbInteractions();
		});
		window.addEventListener("pointermove", move, { passive: true });
		window.addEventListener("pointerdown", clear, true);
		window.addEventListener("pointerout", leave);
		window.addEventListener("blur", clear);
		window.addEventListener("scroll", refreshOrbInteractions, true);
		window.addEventListener("resize", refreshOrbInteractions);
		document.addEventListener("visibilitychange", change);
		preference.addEventListener("change", change);
	}
	const record: Record = { node, visible: false, hovered: false, proximity: 0, state: zero(), expansion: { position: 0, velocity: 0 } };
	records.set(node, record); observer?.observe(node);
	return () => {
		observer?.unobserve(node); reset(record); records.delete(node);
		if (records.size) return;
		cancelAnimationFrame(frame); frame = 0; pointer = null;
		observer?.disconnect(); observer = null;
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerdown", clear, true);
		window.removeEventListener("pointerout", leave);
		window.removeEventListener("blur", clear);
		window.removeEventListener("scroll", refreshOrbInteractions, true);
		window.removeEventListener("resize", refreshOrbInteractions);
		document.removeEventListener("visibilitychange", change);
		preference?.removeEventListener("change", change); preference = null;
	};
}
