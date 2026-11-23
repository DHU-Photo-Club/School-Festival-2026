import { describe, expect, it, vi } from "vitest";
import { scatterPosition } from "../../src/client/archive/scatter-layout.ts";
import { createPreviewEntries } from "../../src/client/archive/entries.ts";

const points = Array.from({ length: 50 }, (_, index) => scatterPosition(index));

describe("logo-centered scatter layout", () => {
	it("keeps the original spiral outside the adjusted lower-left pair", () => {
		for (const [index, point] of points.entries()) {
			if (index === 7) continue;
			const positionIndex = index === 4 ? 7 : index;
			const angle = -Math.PI / 2 + positionIndex * Math.PI * (3 - Math.sqrt(5));
			const radius = Math.sqrt(220 ** 2 + 6400 * positionIndex ** 1.5);
			expect(point.y).toBe(Math.sin(angle) * radius);
			expect(point.x).toBe(Math.cos(angle) * radius);
		}
		const oldBottomAngle = -Math.PI / 2 + 4 * Math.PI * (3 - Math.sqrt(5));
		const oldBottomRadius = Math.sqrt(220 ** 2 + 6400 * 4 ** 1.5);
		const midpoint = { x: (-155 + Math.cos(oldBottomAngle) * oldBottomRadius) / 2, y: (points[4].y + Math.sin(oldBottomAngle) * oldBottomRadius) / 2 };
		expect(Math.hypot(points[7].x - midpoint.x, points[7].y - midpoint.y)).toBeLessThan(2);
	});

	it("shows one lower-left orb between the former pair on portrait phones", () => {
		for (const [width, height] of [[320, 844], [390, 844], [402, 874]]) {
			const point = points[7], x = width / 2 + point.x, y = height / 2 + point.y;
			const visibleWidth = Math.min(width, x + 70) - Math.max(0, x - 70);
			const visibleHeight = Math.min(height - 90, y + 70) - Math.max(90, y - 70);
			expect(point.x).toBeLessThan(-100); expect(point.y).toBeGreaterThan(100);
			expect(visibleWidth).toBeGreaterThan(60); expect(visibleHeight).toBeGreaterThan(60);
			const lowerLeft = points.filter((candidate) => candidate.x < 0 && candidate.y > 100 && candidate.x + 70 > -width / 2 && candidate.y - 70 < height / 2 - 90);
			expect(lowerLeft).toHaveLength(1);
		}
	});

	it("leaves the logo and wordmark clear and avoids coincident neighboring orbs", () => {
		for (const point of points.slice(0, 8)) {
			const dx = Math.max(0, Math.abs(point.x) - 94), dy = Math.max(0, Math.abs(point.y) - 88);
			expect(Math.hypot(dx, dy)).toBeGreaterThan(100);
		}
		for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
			expect(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)).toBeGreaterThan(150);
		}
	});

	it("preserves the sparse outer spiral and placement without consuming palette randomness", () => {
		const random = vi.fn(() => 0.25);
		const entries = createPreviewEntries(50, random);
		expect(random).toHaveBeenCalledTimes(100);
		for (const [index, point] of points.entries()) expect({ x: entries[index].x, y: entries[index].y }).toEqual(point);
		for (let i = 8; i < points.length; i++) {
			expect(Math.hypot(points[i].x, points[i].y)).toBeCloseTo(Math.sqrt(220 ** 2 + 6400 * i ** 1.5), 9);
		}
	});
});
