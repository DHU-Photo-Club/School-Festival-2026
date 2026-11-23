import { describe, expect, it, vi } from "vitest";
import { createPreviewEntries } from "../../src/client/archive/entries.ts";
import { animatedOrbSvg, orbDrift, orbElapsedSeconds, orbMotion, orbShardSpread, orbShardSpreadDistance, watchOrbActivity, orbSupportGeometry, ORB_SUPPORT_COUNT, ORB_SUPPORT_HALF_ANGLE, ORB_SUPPORT_DRIFT } from "../../src/client/archive/orb-motion.ts";

const entries = createPreviewEntries(50, () => 0.25);
const paths = (svg: string) => [...svg.matchAll(/<path\b[^>]*>/g)].map((match) => match[0]);
const originalPaths = (svg: string) => paths(svg).filter((path) => !path.includes('class="orb-support"'));
const geometry = (svg: string) => originalPaths(svg).map((path) => path.match(/\bd="([^"]*)"/)?.[1]);

describe("orb animation", () => {
	it("rotates each shard independently at 60–120 seconds, in both directions", () => {
		for (const entry of entries) {
			const motion = Array.from({ length: 12 }, (_, index) => orbMotion(entry.id, index));
			expect(motion.every((item) => item.rotationSeconds >= 60 && item.rotationSeconds <= 120)).toBe(true);
			expect(new Set(motion.map((item) => item.rotationSeconds)).size).toBe(12);
			expect(new Set(motion.map((item) => item.direction))).toEqual(new Set(["normal", "reverse"]));
		}
	});

	it("uses stable keys and different 16–24 second glow cycles and phases", () => {
		const motion = entries.map((entry) => orbMotion(entry.id, 0));
		expect(motion.every((item) => item.glowSeconds >= 16 && item.glowSeconds <= 24)).toBe(true);
		expect(motion.every((item) => item.glowOffsetSeconds >= 0 && item.glowOffsetSeconds < item.glowSeconds)).toBe(true);
		expect(new Set(motion.map((item) => item.glowSeconds)).size).toBeGreaterThan(1);
		expect(new Set(motion.map((item) => item.glowOffsetSeconds)).size).toBeGreaterThan(1);
		expect(orbMotion("preview-5", 3)).toEqual(orbMotion("preview-5", 3));
	});

	it("preserves geometry, fills, opacity and glow across all five shapes", () => {
		for (const entry of entries.slice(0, 5)) {
			const before = decodeURIComponent(entry.scatterImage.split(",")[1]);
			const after = animatedOrbSvg(entry.scatterImage, "sample", entry.id);
			expect(geometry(after)).toEqual(geometry(before));
			expect(originalPaths(after)).toHaveLength(12);
			expect(paths(after)).toHaveLength(24);
			for (const [index, path] of originalPaths(after).entries()) {
				expect(path.match(/\bfill="([^"]*)"/)?.[1]).toBe(paths(before)[index].match(/\bfill="([^"]*)"/)?.[1]);
				expect(path).toContain('opacity="0.95"');
				expect(path).toContain("--orb-spread-x:");
			}
			const rotators = [...after.matchAll(/<g class="orb-(?:shard|support)-rotation"[^>]*>/g)].map((match) => match[0]);
			expect(rotators).toHaveLength(24);
			expect(rotators.every((group) => /mix-blend-mode:\s*hard-light/.test(group))).toBe(true);
			expect(after.match(/<circle[^>]*>/)?.[0]).toContain('class="orb-glow"');
			expect(after.match(/<circle[^>]*>/)?.[0]).not.toContain("transform");
			expect([...after.matchAll(/<stop[^>]*>/g)].slice(0, 2).map((match) => match[0])).toEqual([...before.matchAll(/<stop[^>]*>/g)].map((match) => match[0]));
			expect(after).not.toContain("clip-path=");
			const circle = before.match(/<circle[^>]*>/)![0];
			const cx = circle.match(/cx="([^"]*)"/)![1];
			const cy = circle.match(/cy="([^"]*)"/)![1];
			expect(paths(after).every((path) => path.includes(`transform-origin:${cx}px ${cy}px`))).toBe(true);
		}
	});

	it("anchors every shape's actual glow center to the visual layout center", () => {
		const vectorScale = 2.323821467976;
		for (const entry of entries.slice(0, 5)) {
			const svg = animatedOrbSvg(entry.scatterImage, "origin", entry.id);
			const root = svg.match(/<svg[^>]*>/)![0];
			expect([...root.matchAll(/\bstyle="/g)]).toHaveLength(1);
			const circle = svg.match(/<circle[^>]*>/)![0];
			const cx = Number(circle.match(/cx="([^"]*)"/)![1]);
			const cy = Number(circle.match(/cy="([^"]*)"/)![1]);
			const x = Number(root.match(/--orb-origin-x:([^p]*)px/)![1]);
			const y = Number(root.match(/--orb-origin-y:([^p]*)px/)![1]);
			expect(x + cx * vectorScale).toBeCloseTo(0, 10);
			expect(y + cy * vectorScale).toBeCloseTo(0, 10);
		}
	});

	it("namespaces all SVG references even when the same orb is mounted twice", () => {
		const allIds = new Set<string>();
		for (const [index, entry] of [...entries, entries[0]].entries()) {
			const svg = animatedOrbSvg(entry.scatterImage, `instance-${index}`, entry.id);
			const ids = [...svg.matchAll(/\bid="([^"]*)"/g)].map((match) => match[1]);
			for (const id of ids) { expect(allIds.has(id)).toBe(false); allIds.add(id); }
			for (const ref of svg.matchAll(/url\(#([^)]*)\)/g)) expect(ids).toContain(ref[1]);
		}
	});

	it("keeps phase independent of the mounting instance", () => {
		const a = animatedOrbSvg(entries[0].scatterImage, "first-mount", entries[0].id);
		const b = animatedOrbSvg(entries[0].scatterImage, "second-mount", entries[0].id);
		expect(a.replace(/first-mount/g, "instance")).toBe(b.replace(/second-mount/g, "instance"));
		const now = performance.now();
		expect(orbElapsedSeconds(now + 10000) - orbElapsedSeconds(now)).toBeCloseTo(10, 8);
	});

	it("does not inline arbitrary remote images", () => {
		expect(animatedOrbSvg("https://example.com/orb.svg", "instance", "test")).toBe("");
	});
	it("stops outside the viewport, in a hidden tab, and with reduced motion; releases observers", () => {
		const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
		const media = Object.assign(new EventTarget(), { matches: false });
		let notify: (visible: boolean) => void = () => {};
		const disconnect = vi.fn();
		vi.stubGlobal("document", doc);
		vi.stubGlobal("matchMedia", () => media);
		vi.stubGlobal("IntersectionObserver", class {
			constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
				notify = (visible) => callback([{ isIntersecting: visible }]);
			}
			observe() {}
			disconnect = disconnect;
		});
		try {
			const update = vi.fn();
			const cleanup = watchOrbActivity({} as Element, update);
			notify(true); expect(update).toHaveBeenLastCalledWith(true);
			notify(false); expect(update).toHaveBeenLastCalledWith(false);
			notify(true);
			doc.visibilityState = "hidden";
			doc.dispatchEvent(new Event("visibilitychange"));
			expect(update).toHaveBeenLastCalledWith(false);
			doc.visibilityState = "visible";
			doc.dispatchEvent(new Event("visibilitychange"));
			expect(update).toHaveBeenLastCalledWith(true);
			media.matches = true; media.dispatchEvent(new Event("change"));
			expect(update).toHaveBeenLastCalledWith(false);
			media.matches = false; media.dispatchEvent(new Event("change"));
			expect(update).toHaveBeenLastCalledWith(true);
			cleanup(); expect(disconnect).toHaveBeenCalledOnce();
			update.mockClear();
			doc.dispatchEvent(new Event("visibilitychange"));
			media.dispatchEvent(new Event("change"));
			expect(update).not.toHaveBeenCalled();
		} finally { vi.unstubAllGlobals(); }
	});

	it("maintains overlapping circular support sectors even at opposite motion extremes", () => {
		expect(360 / ORB_SUPPORT_COUNT + 2 * ORB_SUPPORT_DRIFT).toBeLessThan(2 * ORB_SUPPORT_HALF_ANGLE);
		for (const entry of entries.slice(0, 5)) {
			const svg = animatedOrbSvg(entry.scatterImage, "coverage", entry.id);
			const supports = paths(svg).filter((path) => path.includes('class="orb-support"'));
			expect(supports).toHaveLength(12);
			expect(supports.every((path) => path.includes('opacity="0.95"') && path.includes("--orb-spread-x:"))).toBe(true);
			const original = decodeURIComponent(entry.scatterImage.split(",")[1]);
			const colors = new Set(paths(original).map((path) => path.match(/fill="([^"]*)"/)![1]));
			expect(supports.every((path) => colors.has(path.match(/fill="([^"]*)"/)![1]))).toBe(true);
			expect(svg.indexOf('class="orb-support"')).toBeLessThan(svg.indexOf('class="orb-shard"'));
			expect(svg.indexOf('class="orb-shard"')).toBeLessThan(svg.indexOf('class="orb-glow"'));
		}
	});

	it("covers every direction within the orb's core throughout the allowed support drift", () => {
		const cx = 31.4957, cy = 29.737, radius = 28.5;
		const geometry = orbSupportGeometry(cx, cy, radius);
		expect(geometry).toHaveLength(12);
		expect(geometry.every((item) => item.radius >= radius * 0.96 && item.radius <= radius)).toBe(true);
		// The covered disk extends to at least this radius even at the polygon edges.
		const guaranteedRadius = radius * 0.96 * Math.cos(ORB_SUPPORT_HALF_ANGLE * Math.PI / 180);
		expect(guaranteedRadius / radius).toBeGreaterThan(0.90);
		for (let time = 0; time <= 1200; time += 7) {
			const centers = geometry.map((shape, index) => shape.angle + ORB_SUPPORT_DRIFT * Math.sin(time / orbMotion("preview-1", index).rotationSeconds * Math.PI * 2));
			for (let index = 0; index < centers.length; index++) {
				const gap = (centers[(index + 1) % centers.length] - centers[index] + 360) % 360;
				expect(gap).toBeLessThan(2 * ORB_SUPPORT_HALF_ANGLE);
			}
		}
	});

	it("translates every original/support triangle outward without changing any edge length during rotation", () => {
		for (const entry of entries.slice(0, 5)) {
			const svg = animatedOrbSvg(entry.scatterImage, "spread", entry.id);
			const circle = svg.match(/<circle[^>]*>/)![0];
			const cx = Number(circle.match(/cx="([^"]*)"/)![1]), cy = Number(circle.match(/cy="([^"]*)"/)![1]);
			for (const [index, path] of paths(svg).entries()) {
				const d = path.match(/\bd="([^"]*)"/)![1];
				const distance = orbShardSpreadDistance(entry.id, index);
				const spread = orbShardSpread(d, cx, cy, distance);
				expect(Math.hypot(spread.x, spread.y)).toBeCloseTo(distance, 10);
				expect(Number(path.match(/--orb-spread-x:([^p]*)px/)![1])).toBeCloseTo(spread.x, 10);
				expect(Number(path.match(/--orb-spread-y:([^p]*)px/)![1])).toBeCloseTo(spread.y, 10);
				const points = [...d.matchAll(/[ML]\s*([-+\d.e]+)[ ,]+([-+\d.e]+)/gi)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
				const centroid = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
				expect((centroid.x - cx) * spread.x + (centroid.y - cy) * spread.y).toBeGreaterThan(0);
				for (const angle of [0, 0.7, 2.1]) {
					const moved = points.map((point) => ({ x: cx + (point.x + spread.x - cx) * Math.cos(angle) - (point.y + spread.y - cy) * Math.sin(angle), y: cy + (point.x + spread.x - cx) * Math.sin(angle) + (point.y + spread.y - cy) * Math.cos(angle) }));
					for (let i = 0; i < points.length; i++) {
						const j = (i + 1) % points.length;
						expect(Math.hypot(moved[i].x - moved[j].x, moved[i].y - moved[j].y)).toBeCloseTo(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y), 10);
					}
				}
			}
		}
	});

	it("uses the same glow center and radius with an opaque hover center that is independent of breathing", () => {
		for (const entry of entries.slice(0, 5)) {
			const svg = animatedOrbSvg(entry.scatterImage, "glow", entry.id);
			const circles = [...svg.matchAll(/<circle[^>]*>/g)].map((match) => match[0]);
			expect(circles).toHaveLength(2);
			for (const attribute of ["cx", "cy", "r"]) expect(circles[1].match(new RegExp(`\\b${attribute}="([^"]*)"`))![1]).toBe(circles[0].match(new RegExp(`\\b${attribute}="([^"]*)"`))![1]);
			expect(circles[1]).toContain('class="orb-glow-hover"');
			expect(circles[1]).not.toContain("--orb-duration");
			const hoverId = circles[1].match(/fill="url\(#([^)]*)\)"/)![1];
			const gradients = [...svg.matchAll(/<radialGradient\b[\s\S]*?<\/radialGradient>/g)].map((match) => match[0]);
			const hover = gradients.find((gradient) => gradient.includes(`id="${hoverId}"`))!;
			expect(hover.match(/<stop[^>]*>/)![0]).toContain('stop-opacity="1"');
			expect(gradients[0].match(/<stop[^>]*>/)![0]).toContain('stop-opacity="0.9"');
			const cx = circles[0].match(/\bcx="([^"]*)"/)![1], cy = circles[0].match(/\bcy="([^"]*)"/)![1];
			expect(svg).toContain(`<g class="orb-glow-boost" style="transform-box:view-box;transform-origin:${cx}px ${cy}px;">${circles[1]}</g>`);
		}
	});

	it("sends a stable subset of pieces farther out with several distances, without changing colors", () => {
		for (const entry of entries) {
			const distances = Array.from({ length: 24 }, (_, index) => orbShardSpreadDistance(entry.id, index));
			expect(distances.filter((distance) => distance === 6)).toHaveLength(18);
			expect(distances.filter((distance) => distance >= 9 && distance <= 12)).toHaveLength(6);
			expect(new Set(distances).size).toBe(5);
			expect(distances).toEqual(Array.from({ length: 24 }, (_, index) => orbShardSpreadDistance(entry.id, index)));
		}
	});

	it("gives orbs bounded, independent slow drifting paths without consuming color randomness", () => {
		const configurations = entries.map((entry) => orbDrift(entry.id));
		expect(configurations.every((motion) => motion.seconds >= 18 && motion.seconds <= 26 && motion.x >= 3 && motion.x <= 6 && motion.y >= 4 && motion.y <= 7 && motion.offsetSeconds >= 0 && motion.offsetSeconds < motion.seconds)).toBe(true);
		expect(new Set(configurations.map((motion) => motion.offsetSeconds)).size).toBeGreaterThan(1);
		expect(orbDrift("a")).toEqual(orbDrift("a"));
	});

});
