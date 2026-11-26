export interface Point { x: number; y: number }
export interface FocusTarget extends Point { id: string }
export interface CameraPose extends Point { scale: number }
export interface SpringAxis { position: number; velocity: number }
export type CameraMode = "idle" | "dragging" | "pinching" | "waiting" | "coasting" | "snapping" | "searching" | "zooming";
export const LOGO_TARGET: FocusTarget = { id: "__logo__", x: 0, y: 0 };
export const MIN_SCALE = 0.35;
export const MAX_SCALE = 3;

/** Analytic critically damped spring, independent of frame rate. Velocities are px/s. */
export function springAxis(position: number, velocity: number, target: number, dt: number, omega = 14): SpringAxis {
	const error = position - target;
	const coefficient = velocity + omega * error;
	const decay = Math.exp(-omega * dt);
	return { position: target + (error + coefficient * dt) * decay, velocity: (velocity - omega * coefficient * dt) * decay };
}

export function limitVector(point: Point, maximum: number): Point {
	const length = Math.hypot(point.x, point.y);
	const ratio = length > maximum ? maximum / length : 1;
	return { x: point.x * ratio, y: point.y * ratio };
}

export function centeredPose(target: Point, scale: number, width: number, height: number): CameraPose {
	return { x: width / 2 - (width / 2 + target.x) * scale, y: height / 2 - (height / 2 + target.y) * scale, scale };
}

export function projectTarget(target: Point, pose: CameraPose, width: number, height: number): Point {
	return { x: (width / 2 + target.x) * pose.scale + pose.x, y: (height / 2 + target.y) * pose.scale + pose.y };
}

export function nearestTarget(targets: readonly FocusTarget[], pose: CameraPose, width: number, height: number, previousId?: string): FocusTarget {
	const candidates = [LOGO_TARGET, ...targets];
	let winner = candidates[0];
	let best = Infinity;
	for (const target of candidates) {
		const screen = projectTarget(target, pose, width, height);
		const distance = (screen.x - width / 2) ** 2 + (screen.y - height / 2) ** 2;
		const tied = Math.abs(distance - best) <= 1e-7;
		if (distance < best - 1e-7 || (tied && target.id === previousId)) { best = distance; winner = target; }
	}
	return winner;
}

export function floatingLagSeconds(key: string): number {
	let hash = 2166136261;
	for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return 0.06 + ((hash >>> 0) % 61) / 1000;
}

export interface FloatingState { x: number; y: number; vx: number; vy: number }
export function stepFloating(state: FloatingState, cameraVelocity: Point, lagSeconds: number, dt: number, strength = 1): FloatingState {
	const target = limitVector({ x: -cameraVelocity.x * lagSeconds * strength, y: -cameraVelocity.y * lagSeconds * strength }, 20);
	const x = springAxis(state.x, state.vx, target.x, dt, 20);
	const y = springAxis(state.y, state.vy, target.y, dt, 20);
	const offset = limitVector({ x: x.position, y: y.position }, 20);
	return { x: offset.x, y: offset.y, vx: x.velocity, vy: y.velocity };
}

export class ScatterCamera {
	x = 0;
	y = 0;
	scale = 1;
	width = 402;
	height = 874;
	vx = 0;
	vy = 0;
	mode: CameraMode = "idle";
	centeredId = LOGO_TARGET.id;
	lockedTarget: FocusTarget | null = null;
	reducedMotion = false;
	private elapsed = 0;
	private waitSeconds = 0;
	private zoomTarget = 1;
	private zoomVelocity = 0;
	private targets: readonly FocusTarget[];

	constructor(targets: readonly FocusTarget[]) { this.targets = targets; }
	get pose(): CameraPose { return { x: this.x, y: this.y, scale: this.scale }; }
	get running(): boolean { return ["waiting", "coasting", "snapping", "searching", "zooming"].includes(this.mode); }

	private find(id: string) { return id === LOGO_TARGET.id ? LOGO_TARGET : this.targets.find((target) => target.id === id); }
	private nearest() { return nearestTarget(this.targets, this.pose, this.width, this.height, this.centeredId); }

	setTargets(targets: readonly FocusTarget[]) {
		this.targets = targets;
		if (this.lockedTarget) {
			const current = this.find(this.lockedTarget.id);
			if (current) this.lockedTarget = current;
			else this.snapNearest();
		} else if (this.mode === "idle") {
			const current = this.find(this.centeredId);
			if (current) this.finishSnap(current);
			else this.snapNearest();
		}
	}

	private clamp() {
		const reachX = Math.max(1800, ...this.targets.map((target) => Math.abs(target.x)));
		const reachY = Math.max(1800, ...this.targets.map((target) => Math.abs(target.y)));
		const midX = this.width / 2 * (1 - this.scale), midY = this.height / 2 * (1 - this.scale);
		const nextX = Math.max(midX - reachX * this.scale, Math.min(midX + reachX * this.scale, this.x));
		const nextY = Math.max(midY - reachY * this.scale, Math.min(midY + reachY * this.scale, this.y));
		if (nextX !== this.x) this.vx = 0;
		if (nextY !== this.y) this.vy = 0;
		this.x = nextX; this.y = nextY;
	}

	beginInteraction(mode: "dragging" | "pinching" = "dragging") {
		this.mode = mode; this.lockedTarget = null; this.elapsed = 0; this.vx = this.vy = 0;
	}

	panBy(dx: number, dy: number, dt = 0.016, recordVelocity = false) {
		this.x += dx; this.y += dy;
		if (recordVelocity) {
			const measured = limitVector({ x: dx / Math.max(dt, 0.008), y: dy / Math.max(dt, 0.008) }, 2000);
			this.vx = this.vx * 0.65 + measured.x * 0.35;
			this.vy = this.vy * 0.65 + measured.y * 0.35;
		}
		this.clamp();
	}

	zoomAt(next: number, px = this.width / 2, py = this.height / 2) {
		const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
		const ratio = scale / this.scale;
		this.x = px - (px - this.x) * ratio;
		this.y = py - (py - this.y) * ratio;
		this.scale = scale;
		this.clamp();
	}

	/** Button/key zoom keeps the center map point fixed; repeated clicks accumulate their goal. */
	zoomBy(factor: number) {
		const continuing = this.mode === "zooming";
		this.zoomTarget = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (continuing ? this.zoomTarget : this.scale) * factor));
		if (!continuing) this.zoomVelocity = 0;
		this.mode = "zooming"; this.lockedTarget = null; this.elapsed = 0; this.vx = this.vy = 0;
		if (this.reducedMotion) { this.zoomAt(this.zoomTarget); this.snapNearest(); }
	}

	endInteraction(allowInertia: boolean) {
		if (this.reducedMotion || !allowInertia || Math.hypot(this.vx, this.vy) < 40) { this.vx = this.vy = 0; this.snapNearest(); return; }
		const velocity = limitVector({ x: this.vx, y: this.vy }, 2000);
		this.vx = velocity.x; this.vy = velocity.y;
		this.mode = "coasting"; this.elapsed = 0;
	}

	/** Freeze the exact view under a detail overlay; do not resume a pending snap on close. */
	stopMotion() { this.mode = "idle"; this.lockedTarget = null; this.vx = this.vy = this.zoomVelocity = 0; this.elapsed = 0; }

	queueSnap() { this.mode = "waiting"; this.lockedTarget = null; this.waitSeconds = 0.14; this.vx = this.vy = 0; }
	snapNearest() { this.startSnap(this.nearest(), "snapping"); }
	focus(id: string) {
		const target = this.find(id);
		if (target) { this.vx = this.vy = 0; this.startSnap(target, "searching"); }
	}

	cancelSearch() {
		if (this.mode !== "searching") return;
		this.vx = this.vy = 0;
		this.snapNearest();
	}

	private startSnap(target: FocusTarget, mode: "snapping" | "searching") {
		this.lockedTarget = target; this.mode = mode; this.elapsed = 0;
		if (this.reducedMotion) this.finishSnap(target);
	}

	private finishSnap(target: FocusTarget) {
		const pose = centeredPose(target, this.scale, this.width, this.height);
		this.x = pose.x; this.y = pose.y; this.vx = this.vy = 0;
		this.centeredId = target.id; this.lockedTarget = null; this.mode = "idle";
	}

	reset() { this.scale = 1; this.finishSnap(LOGO_TARGET); }

	setReducedMotion(reduced: boolean) {
		this.reducedMotion = reduced;
		if (reduced && this.mode === "zooming") { this.zoomAt(this.zoomTarget); this.snapNearest(); }
		if (reduced && this.running) this.finishSnap(this.lockedTarget ?? this.nearest());
	}

	resize(width: number, height: number) {
		// Keep the same map point at the viewport center while its dimensions change.
		this.x += (width - this.width) / 2 * (1 - this.scale);
		this.y += (height - this.height) / 2 * (1 - this.scale);
		this.width = width; this.height = height;
		if (this.mode === "idle") this.finishSnap(this.find(this.centeredId) ?? this.nearest());
		this.clamp();
	}

	advance(dt: number) {
		if (!this.running || dt <= 0) return;
		if (this.mode === "waiting") {
			this.waitSeconds -= dt;
			if (this.waitSeconds <= 0) this.snapNearest();
			return;
		}
		this.elapsed += dt;
		if (this.mode === "zooming") {
			// Log scale gives zoom-in and zoom-out the same proportional speed.
			const target = Math.log(this.zoomTarget);
			const next = springAxis(Math.log(this.scale), this.zoomVelocity, target, dt, 22);
			this.zoomVelocity = next.velocity;
			this.zoomAt(Math.exp(next.position));
			if ((Math.abs(Math.log(this.scale) - target) < 0.0001 && Math.abs(this.zoomVelocity) < 0.001) || this.elapsed >= 0.5) {
				this.zoomAt(this.zoomTarget); this.zoomVelocity = 0; this.snapNearest();
			}
			return;
		}
		if (this.mode === "coasting") {
			const decay = Math.exp(-dt / 0.16);
			this.x += this.vx * 0.16 * (1 - decay);
			this.y += this.vy * 0.16 * (1 - decay);
			this.vx *= decay; this.vy *= decay;
			this.clamp();
			if (Math.hypot(this.vx, this.vy) < 40 || this.elapsed >= 0.35) this.snapNearest();
			return;
		}
		if (!this.lockedTarget) { this.snapNearest(); return; }
		const target = centeredPose(this.lockedTarget, this.scale, this.width, this.height);
		const x = springAxis(this.x, this.vx, target.x, dt), y = springAxis(this.y, this.vy, target.y, dt);
		this.x = x.position; this.y = y.position; this.vx = x.velocity; this.vy = y.velocity;
		this.clamp();
		if ((Math.hypot(this.x - target.x, this.y - target.y) < 0.25 && Math.hypot(this.vx, this.vy) < 5) || this.elapsed >= 0.9) this.finishSnap(this.lockedTarget);
	}
}
