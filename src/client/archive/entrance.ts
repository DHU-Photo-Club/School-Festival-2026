export const ENTRANCE_DURATION_MS = 900;
export const ENTRANCE_DEPTH = 0.6;

/** Remove the filter once visually sharp, rather than keeping a near-zero SVG blur surface. */
export function entranceFilter(blur: number): string {
	return blur >= 0.5 ? `blur(${blur}px)` : "none";
}

/** Deterministic stagger without consuming the palette's random sequence. */
export function orbEntranceDelay(id: string, index: number): number {
	let hash = 2166136261;
	for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return 220 + index * 16 + (hash >>> 0) % 12;
}

/** Perspective projection with fixed world X/Y and depth approaching the scene plane. */
export function entrancePose(x: number, y: number, elapsedMs: number, delayMs = 0, kind: "logo" | "orb" = "orb") {
	const progress = Math.max(0, Math.min(1, (elapsedMs - delayMs) / ENTRANCE_DURATION_MS));
	if (progress === 1) return { x: 0, y: 0, scale: 1, blur: 0, opacity: 1, done: true };
	const remainingDepth = (1 - progress) ** 3;
	const scale = 1 / (1 - ENTRANCE_DEPTH * remainingDepth);
	return {
		x: x * (scale - 1),
		y: y * (scale - 1),
		scale,
		blur: (kind === "logo" ? 20 : 14) * remainingDepth,
		opacity: Math.min(1, progress / 0.16),
		done: progress === 1,
	};
}
