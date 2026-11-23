import { PALETTE } from "../../data/palette.ts";
import { baseColor } from "../../shared/palette.ts";
import type { PaletteId } from "../../shared/types.ts";
import { scatterPosition } from "./scatter-layout";
import original from "../../../public/archive/figma/orbs/fd824.svg?raw";
import spiral from "../../../public/archive/figma/orbs/e0f29.svg?raw";
import fan from "../../../public/archive/figma/orbs/dea6a.svg?raw";
import bloom from "../../../public/archive/figma/orbs/f2480.svg?raw";
import burst from "../../../public/archive/figma/orbs/ff2ca.svg?raw";

const ORB_SHAPES = [original, spiral, fan, bloom, burst] as const;

export interface ArchiveEntry {
	id: string;
	nickname: string;
	colors: readonly [PaletteId, PaletteId];
	scatterImage: string;
	gridImage: string;
	x: number;
	y: number;
}

function coloredOrb(template: string, first: string, second: string): string {
	// Keep the exported geometry and glow. Replace only shard fills with the entry's two colors.
	let shardIndex = 0;
	const svg = template
		.replace('style="display: block;"', 'style="display: block; isolation: isolate;"')
		.replace(/<path\b[^>]*>/g, (path) => {
			const color = shardIndex++ % 2 === 0 ? first : second;
			return path
				.replace(/fill="#[0-9a-fA-F]{6}"/, `fill="${color}"`)
				.replace(/opacity="[^"]*"/, 'opacity="0.95"')
				.replace('<path ', '<path style="mix-blend-mode: hard-light" ');
		});
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Temporary demo data; generated once per page load, shared by both views. */
export function createPreviewEntries(count = 50, random: () => number = Math.random): ArchiveEntry[] {
	return Array.from({ length: count }, (_, index) => {
		const a = Math.floor(random() * PALETTE.colors.length);
		const b = (a + 1 + Math.floor(random() * (PALETTE.colors.length - 1))) % PALETTE.colors.length;
		const first = PALETTE.colors[a];
		const second = PALETTE.colors[b];
		const image = coloredOrb(ORB_SHAPES[index % ORB_SHAPES.length], baseColor(first), baseColor(second));
		return {
			id: `preview-${index + 1}`,
			nickname: `ニックネーム ${String(index + 1).padStart(2, "0")}`,
			colors: [first.id, second.id],
			scatterImage: image,
			gridImage: image,
			...scatterPosition(index),
		};
	});
}

export const previewEntries = createPreviewEntries();
