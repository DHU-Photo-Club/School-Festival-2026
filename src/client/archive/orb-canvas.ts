import { animatedOrbSvg, orbDrift, orbElapsedSeconds } from "./orb-motion";

const SIZE = 240;
const SVG_SCALE = 2.323821467976;
type Job = { active: boolean; interval: number; last: number; draw: (now: number) => void };
const jobs = new Set<Job>();
let frame = 0;
function schedule() {
	if (!frame && [...jobs].some((job) => job.active)) frame = requestAnimationFrame(tick);
}
function tick(now: number) {
	frame = 0;
	for (const job of jobs) {
		if (!job.active || now - job.last < job.interval - 0.5) continue;
		job.last = now;
		job.draw(now);
	}
	schedule();
}

/** CSS ease-in-out (0.42, 0, 0.58, 1), including the original drift keyframes. */
export function orbEase(progress: number): number {
	const x = Math.max(0, Math.min(1, progress));
	let lo = 0, hi = 1;
	for (let i = 0; i < 12; i++) {
		const t = (lo + hi) / 2;
		const value = 3 * (1 - t) ** 2 * t * .42 + 3 * (1 - t) * t * t * .58 + t ** 3;
		if (value < x) lo = t; else hi = t;
	}
	const t = (lo + hi) / 2;
	return 3 * t * t - 2 * t ** 3;
}
function cycle(seconds: number, duration: number) { return (seconds % duration + duration) % duration / duration; }
function pulse(phase: number) { return orbEase(phase < .5 ? phase * 2 : (1 - phase) * 2); }

export function orbRenderBudget(scale: number, mobile: boolean, dpr: number) {
	const small = scale < .65;
	return { fps: small ? 15 : mobile ? 30 : 60, density: Math.max(.5, Math.min(small ? 1 : 2, dpr * scale)) };
}

/** One transparent surface per orb; hard-light never needs separate DOM layers per shard. */
export function createOrbCanvas(canvas: HTMLCanvasElement, host: HTMLElement, src: string, key: string) {
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D is unavailable");
	const svg = new DOMParser().parseFromString(animatedOrbSvg(src, "canvas", key), "image/svg+xml");
	const circle = svg.querySelector<SVGCircleElement>("circle")!;
	const cx = Number(circle.getAttribute("cx")), cy = Number(circle.getAttribute("cy")), radius = Number(circle.getAttribute("r"));
	const pieces = [...svg.querySelectorAll<SVGElement>(".orb-support-rotation, .orb-shard-rotation")].map((group) => {
		const path = group.querySelector<SVGElement>("path")!;
		return { path: new Path2D(path.getAttribute("d")!), color: path.getAttribute("fill")!, opacity: Number(path.getAttribute("opacity") ?? 1),
			support: group.classList.contains("orb-support-rotation"), duration: parseFloat(group.style.getPropertyValue("--orb-duration")),
			offset: parseFloat(group.style.getPropertyValue("--orb-offset")), reverse: group.style.getPropertyValue("--orb-direction") === "reverse",
			x: parseFloat(path.style.getPropertyValue("--orb-spread-x")), y: parseFloat(path.style.getPropertyValue("--orb-spread-y")) };
	});
	const glowDuration = parseFloat(circle.style.getPropertyValue("--orb-duration"));
	const glowOffset = parseFloat(circle.style.getPropertyValue("--orb-offset"));
	const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
	glow.addColorStop(0, "rgba(255,255,255,.9)"); glow.addColorStop(.812874, "rgba(255,255,255,0)");
	const hoverGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
	hoverGlow.addColorStop(0, "white"); hoverGlow.addColorStop(.812874, "rgba(255,255,255,0)");
	const drift = orbDrift(key);
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");
	const mobile = matchMedia("(pointer: coarse)");
	let visible = false, paused = false, scale = 1, density = 0, nextDensity = 1;
	// Invisible orbs own no backing store. Mobile browsers can otherwise retain dozens of GPU surfaces.
	canvas.width = canvas.height = 0;
	let painted = false;
	let expansion = 0, proximity = 0, glowFrom = 0, glowTarget = 0, glowChanged = 0;
	const job: Job = { active: false, interval: 1000 / 60, last: -Infinity, draw };
	jobs.add(job);
	function draw(now: number) {
		if (!ctx) return;
		if (density !== nextDensity) { density = nextDensity; canvas.width = canvas.height = Math.ceil(SIZE * density); }
		painted = true;
		host.dataset.rendered = "true";
		proximity = glowFrom + (glowTarget - glowFrom) * (1 - (1 - Math.min(1, Math.max(0, (now - glowChanged) / 420))) ** 3);
		const seconds = reduced.matches ? 0 : orbElapsedSeconds(now);
		const phase = cycle(seconds + drift.offsetSeconds, drift.seconds) * 4;
		const points = [[0, -drift.y], [drift.x, 0], [0, drift.y], [-drift.x, 0], [0, -drift.y]];
		const part = Math.floor(phase), eased = orbEase(phase - part);
		const dx = reduced.matches ? 0 : points[part][0] + (points[part + 1][0] - points[part][0]) * eased;
		const dy = reduced.matches ? 0 : points[part][1] + (points[part + 1][1] - points[part][1]) * eased;
		ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(density * SVG_SCALE, 0, 0, density * SVG_SCALE, density * (SIZE / 2 + dx), density * (SIZE / 2 + dy));
		for (const piece of pieces) {
			const p = cycle(seconds + piece.offset, piece.duration);
			const angle = reduced.matches ? 0 : piece.support ? (-2 + 4 * pulse(p)) * Math.PI / 180 : p * Math.PI * 2 * (piece.reverse ? -1 : 1);
			const spread = reduced.matches ? 0 : expansion;
			ctx.save(); ctx.rotate(angle); ctx.translate(piece.x * spread - cx, piece.y * spread - cy);
			ctx.globalCompositeOperation = "hard-light"; ctx.globalAlpha = piece.opacity; ctx.fillStyle = piece.color; ctx.fill(piece.path); ctx.restore();
		}
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = reduced.matches ? 1 : 1 - .3 * pulse(cycle(seconds + glowOffset, glowDuration));
		ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
		if (proximity > 0 && !reduced.matches) {
			ctx.save(); ctx.scale(1 + .6 * expansion, 1 + .6 * expansion); ctx.globalAlpha = proximity;
			ctx.fillStyle = hoverGlow; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
		}
		ctx.globalAlpha = 1;
	}
	function refresh() {
		const budget = orbRenderBudget(scale, mobile.matches, window.devicePixelRatio || 1);
		job.interval = 1000 / budget.fps;
		// Quantize resolution so zoom gestures do not reallocate the backing store every frame.
		nextDensity = Math.ceil(budget.density * 4) / 4;
		job.active = visible && !paused && document.visibilityState === "visible" && !reduced.matches;
		host.dataset.active = String(job.active);
		if (!visible || document.visibilityState !== "visible") {
			if (painted) { canvas.width = canvas.height = 0; density = 0; painted = false; }
			delete host.dataset.rendered;
		} else if (!paused && (!painted || reduced.matches)) draw(performance.now());
		if (![...jobs].some((item) => item.active)) { cancelAnimationFrame(frame); frame = 0; }
		schedule();
	}
	const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); }, { rootMargin: "100px" });
	visibility.observe(host);
	function sceneSettled() { visibility.unobserve(host); visibility.observe(host); }
	window.addEventListener("archive:scene-settled", sceneSettled);
	// Pointer interaction already computes the spring. Read its values only when they change.
	const interaction = new MutationObserver(() => {
		expansion = Number(host.style.getPropertyValue("--orb-expansion")) || 0;
		const target = host.dataset.orbHover === "true" ? 1 : Number(host.style.getPropertyValue("--orb-proximity")) || 0;
		if (target !== glowTarget) { glowFrom = proximity; glowTarget = target; glowChanged = performance.now(); }
	});
	interaction.observe(host, { attributes: true, attributeFilter: ["style", "data-orb-hover"] });
	refresh();
	document.addEventListener("visibilitychange", refresh);
	window.addEventListener("resize", refresh);
	reduced.addEventListener("change", refresh); mobile.addEventListener("change", refresh);
	return {
		configure(options: { paused: boolean; scale: number }) { if (paused === options.paused && scale === options.scale) return; paused = options.paused; scale = options.scale; refresh(); },
		destroy() {
			jobs.delete(job); visibility.disconnect(); interaction.disconnect();
			window.removeEventListener("archive:scene-settled", sceneSettled);
			document.removeEventListener("visibilitychange", refresh); window.removeEventListener("resize", refresh);
			reduced.removeEventListener("change", refresh); mobile.removeEventListener("change", refresh);
			if (![...jobs].some((item) => item.active)) { cancelAnimationFrame(frame); frame = 0; }
			canvas.width = canvas.height = 0;
		},
	};
}
