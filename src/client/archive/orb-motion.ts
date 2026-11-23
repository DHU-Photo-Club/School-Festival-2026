/** Shared epoch: remounted orbs resume at the same point on the page timeline. */
const startedAt = performance.now();
const SVG_DATA_PREFIX = "data:image/svg+xml;charset=utf-8,";

export function orbElapsedSeconds(now = performance.now()): number {
	return Math.max(0, (now - startedAt) / 1000);
}

function hashKey(value: string): number {
	let hash = 2166136261;
	for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return hash >>> 0;
}

export function orbDrift(key: string) {
	const seed = hashKey(key);
	const seconds = 18 + (seed % 8001) / 1000;
	return { seconds, offsetSeconds: ((seed >>> 10) % 10000) / 10000 * seconds, x: 3 + ((seed >>> 4) % 4), y: 4 + ((seed >>> 7) % 4) };
}

/** One quarter of the pieces reach farther; stable across modes without palette randomness. */
export function orbShardSpreadDistance(key: string, index: number): number {
	const seed = hashKey(key);
	return (index + seed % 4) % 4 === 0 ? 9 + (((seed >>> 4) + Math.floor(index / 4) * 7) % 4) : 6;
}

/** The local triangle's centroid determines its outward direction before parent rotation. */
export function orbShardSpread(path: string, cx: number, cy: number, distance = 6) {
	const points = [...path.matchAll(/[ML]\s*([-+\d.e]+)[ ,]+([-+\d.e]+)/gi)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
	if (!points.length) return { x: 0, y: 0 };
	const x = points.reduce((sum, point) => sum + point.x - cx, 0) / points.length;
	const y = points.reduce((sum, point) => sum + point.y - cy, 0) / points.length;
	const length = Math.hypot(x, y);
	return length > 1e-8 ? { x: x / length * distance, y: y / length * distance } : { x: 0, y: 0 };
}

export function orbMotion(key: string, shardIndex: number) {
	const seed = hashKey(key);
	return {
		rotationSeconds: 60 + ((seed % 61 + shardIndex * 17) % 61),
		direction: ((seed >>> 8) + shardIndex) % 2 === 0 ? "normal" : "reverse",
		glowSeconds: 16 + (seed % 8001) / 1000,
		glowOffsetSeconds: ((seed >>> 8) % 10000) / 10000 * (16 + (seed % 8001) / 1000),
	};
}

// Twelve support sectors are 30° apart and 36° wide. At opposite drift extremes,
// their centers are at most 34° apart: fewer shards, with a continuously covered core.
export const ORB_SUPPORT_COUNT = 12;
export const ORB_SUPPORT_HALF_ANGLE = 18;
export const ORB_SUPPORT_DRIFT = 2;

export function orbSupportGeometry(cx: number, cy: number, radius: number) {
	return Array.from({ length: ORB_SUPPORT_COUNT }, (_, index) => {
		const angle = index * 360 / ORB_SUPPORT_COUNT;
		const reach = radius * (0.96 + (index % 5) * 0.01);
		const point = (degrees: number) => {
			const radians = degrees * Math.PI / 180;
			return `${(cx + Math.cos(radians) * reach).toFixed(6)} ${(cy + Math.sin(radians) * reach).toFixed(6)}`;
		};
		return {
			angle,
			radius: reach,
			d: `M${cx} ${cy}L${point(angle - ORB_SUPPORT_HALF_ANGLE)}L${point(angle + ORB_SUPPORT_HALF_ANGLE)}Z`,
		};
	});
}

/** Only accepts the SVG markup generated from our local orb templates. */
export function animatedOrbSvg(src: string, namespace: string, motionKey: string): string {
	if (!src.startsWith(SVG_DATA_PREFIX)) return "";
	let svg = decodeURIComponent(src.slice(SVG_DATA_PREFIX.length));
	const circle = svg.match(/<circle\b[^>]*>/)?.[0];
	const cx = circle?.match(/\bcx="([\d.+-]+)"/)?.[1];
	const cy = circle?.match(/\bcy="([\d.+-]+)"/)?.[1];
	const radius = circle?.match(/\br="([\d.+-]+)"/)?.[1];
	if (cx === undefined || cy === undefined || radius === undefined) return "";

	// Align the glow center (which differs slightly between templates) with the layout anchor.
	svg = svg.replace(/<svg\b[^>]*>/, (root) => root.replace(/style="([^"]*)"/, (_, style: string) =>
		`style="${style};--orb-origin-x:${-Number(cx) * 2.323821467976}px;--orb-origin-y:${-Number(cy) * 2.323821467976}px;"`));

	// Inline SVGs share a document. Namespace every definition and local reference.
	const ids = new Map<string, string>();
	svg = svg.replace(/\bid="([^"]*)"/g, (_, id: string) => {
		if (!ids.has(id)) ids.set(id, `${namespace}-${ids.size}`);
		return `id="${ids.get(id)}"`;
	});
	svg = svg.replace(/url\(#([^)]*)\)/g, (_, id: string) => `url(#${ids.get(id) ?? id})`);
	// Rotation must not be cropped to the rectangular Figma export bounds.
	svg = svg.replace(/\sclip-path="[^"]*"/g, "");
	let index = 0;
	svg = svg.replace(/<path\b[^>]*>/g, (path) => {
		const motion = orbMotion(motionKey, index++);
		const style = `transform-box:view-box;transform-origin:${cx}px ${cy}px;--orb-duration:${motion.rotationSeconds}s;--orb-direction:${motion.direction};--orb-offset:0s;`;
		return path.replace("<path ", '<path class="orb-shard" ')
			.replace(/style="([^"]*)"/, (_, original: string) => `style="${original};${style}"`);
	});
	const colors = [...new Set([...svg.matchAll(/<path\b[^>]*\bfill="(#[0-9a-fA-F]{6})"/g)].map((match) => match[1]))];
	if (colors.length >= 2) {
		const supports = orbSupportGeometry(Number(cx), Number(cy), Number(radius)).map((shape, shardIndex) => {
			const motion = orbMotion(motionKey, shardIndex);
			const phase = (shardIndex * 7.31 + orbMotion(motionKey, 0).glowOffsetSeconds) % motion.rotationSeconds;
			return `<path class="orb-support" d="${shape.d}" fill="${colors[shardIndex % 2]}" opacity="0.95" style="mix-blend-mode:hard-light;transform-box:view-box;transform-origin:${cx}px ${cy}px;--orb-duration:${motion.rotationSeconds}s;--orb-offset:${phase}s;--orb-drift:${ORB_SUPPORT_DRIFT}deg;--orb-drift-negative:${-ORB_SUPPORT_DRIFT}deg;"/>`;
		}).join("");
		// Behind the free-moving shards, and below the unchanged central glow.
		svg = svg.replace(/<path\b/, supports + "<path");
	}
	// Rotate the parent about the original glow center, then translate the unchanged triangle
	// in that rotating coordinate system. This never scales the triangle or shifts its axis.
	let spreadIndex = 0;
	svg = svg.replace(/<path\b[^>]*\/>/g, (path) => {
		const support = path.includes('class="orb-support"');
		const motion = path.match(/\bstyle="([^"]*)"/)?.[1] ?? "";
		const geometry = path.match(/\bd="([^"]*)"/)?.[1] ?? "";
		const spread = orbShardSpread(geometry, Number(cx), Number(cy), orbShardSpreadDistance(motionKey, spreadIndex++));
		const piece = path.replace(/style="[^"]*"/, `style="transform-box:view-box;transform-origin:${cx}px ${cy}px;--orb-spread-x:${spread.x}px;--orb-spread-y:${spread.y}px;"`);
		return `<g class="${support ? "orb-support-rotation" : "orb-shard-rotation"}" style="${motion}">${piece}</g>`;
	});
	const glow = orbMotion(motionKey, 0);
	svg = svg.replace(/<circle\b/, `<circle class="orb-glow" style="--orb-duration:${glow.glowSeconds}s;--orb-offset:${glow.glowOffsetSeconds}s;"`);
	// The hover gradient has a fully opaque center and bypasses the breathing opacity.
	// Keep the original gradient and pulse unchanged underneath it.
	const gradient = svg.match(/<radialGradient\b[\s\S]*?<\/radialGradient>/)?.[0];
	if (gradient) {
		const hoverId = `${namespace}-hover-glow`;
		const hoverGradient = gradient.replace(/\bid="[^"]*"/, `id="${hoverId}"`)
			.replace(/<stop\b[^>]*>/, (stop) => stop.replace(/stop-opacity="[^"]*"/, 'stop-opacity="1"'));
		svg = svg.replace("</defs>", `${hoverGradient}</defs>`);
		svg = svg.replace(/<circle\b[^>]*\/>/, (circle) => {
			const hoverCircle = circle.replace(/\sid="[^"]*"/, "").replace('class="orb-glow"', 'class="orb-glow-hover"')
				.replace(/\sstyle="[^"]*"/, "").replace(/fill="url\(#[^)]*\)"/, `fill="url(#${hoverId})"`);
			return `${circle}<g class="orb-glow-boost" style="transform-box:view-box;transform-origin:${cx}px ${cy}px;">${hoverCircle}</g>`;
		});
	}
	return svg;
}

/** Keep offscreen, hidden-tab and reduced-motion orbs static, with no per-frame JS. */
export function watchOrbActivity(element: Element, update: (active: boolean) => void): () => void {
	let inView = false;
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");
	function refresh() {
		update(inView && document.visibilityState === "visible" && !reduced.matches);
	}
	const observer = new IntersectionObserver(([entry]) => {
		inView = entry.isIntersecting;
		refresh();
	});
	observer.observe(element);
	document.addEventListener("visibilitychange", refresh);
	reduced.addEventListener("change", refresh);
	return () => {
		observer.disconnect();
		document.removeEventListener("visibilitychange", refresh);
		reduced.removeEventListener("change", refresh);
	};
}
