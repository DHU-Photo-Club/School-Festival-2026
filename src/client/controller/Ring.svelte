<script lang="ts">
import { RESULT_COLORS } from "../../data/colors.ts";
import { COLORS, ringOrder } from "../../shared/motion.ts";

/** iPadに置く8区画の輪（docs/visual-language.md 4.1節）。 */
let {
	sessionId,
	angle,
	size,
	radius = 1,
	thickness = 1,
	gray = false,
}: {
	sessionId: string | null;
	/** 12時方向から時計回りの回転角（度）。 */
	angle: number;
	size: string;
	/** 外径の倍率（0〜1）。 */
	radius?: number;
	/** 帯の太さの倍率（0〜1）。 */
	thickness?: number;
	gray?: boolean;
} = $props();

const BAND = 0.34;

function point(r: number, degrees: number): string {
	const a = (degrees * Math.PI) / 180;
	return `${(r * Math.sin(a)).toFixed(3)} ${(-r * Math.cos(a)).toFixed(3)}`;
}

const sectors = $derived.by(() => {
	const outer = 100 * radius;
	const inner = Math.max(0, outer * (1 - BAND * thickness));
	if (outer <= 0 || outer - inner <= 0.01) return [];
	return ringOrder(sessionId).map((id, index) => {
		const start = angle + index * 45;
		const end = start + 45;
		const color = gray ? COLORS.line : (RESULT_COLORS.find((c) => c.id === id)?.baseColor ?? COLORS.line);
		const d = `M${point(outer, start)}A${outer} ${outer} 0 0 1 ${point(outer, end)}L${point(inner, end)}A${inner} ${inner} 0 0 0 ${point(inner, start)}Z`;
		return { d, color };
	});
});
</script>

<svg class="ring" viewBox="-100 -100 200 200" style:width={size} style:height={size} aria-hidden="true">
	{#each sectors as sector, index (index)}
		<path d={sector.d} fill={sector.color} />
	{/each}
</svg>

<style>
.ring {
	display: block;
	flex: none;
}
</style>
