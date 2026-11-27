<script lang="ts">
import { createOrbCanvas } from "../archive/orb-canvas.ts";
import { coloredOrb, orbShapeFor } from "../archive/orb-shapes.ts";

/**
 * iPadの結果の最初の画面に置く、結果の二色のオーブ（docs/visual-language.md 4.2節）。アーカイブサイトの
 * `OrbImage.svelte`（`production` ブランチ）と同じ形と描画（`orb-canvas.ts`）を使い、ポインターへの反応だけを除く。
 * アーカイブサイトの大きさ（146.381×138.211px）で描き、外側の箱の幅に合わせて拡大する。
 */
let { colors, motionKey }: { colors: readonly [string, string]; motionKey: string } = $props();

/** アーカイブサイトでのオーブの幅（px）。 */
const ORB_WIDTH = 146.381;

let host: HTMLDivElement;
let canvas: HTMLCanvasElement;
let width = $state(0);
const src = $derived(coloredOrb(orbShapeFor(motionKey), colors[0], colors[1]));
const scale = $derived(width > 0 ? width / ORB_WIDTH : 1);
let renderer = $state<ReturnType<typeof createOrbCanvas>>();

$effect(() => {
	const next = createOrbCanvas(canvas, host, src, motionKey);
	renderer = next;
	return () => next.destroy();
});
$effect(() => {
	renderer?.configure({ paused: false, scale });
});
</script>

<div class="orb-box" bind:clientWidth={width} aria-hidden="true">
	<div bind:this={host} class="orb-image" style:transform="translate(-50%, -50%) scale({scale})">
		<div class="orb-artwork">
			<img class="orb-still" {src} alt="">
			<canvas bind:this={canvas} width="0" height="0"></canvas>
		</div>
	</div>
</div>

<style>
.orb-box {
	position: relative;
	width: min(34vmin, 260px);
	aspect-ratio: 146.381 / 138.211;
}
/* ここから下は、アーカイブサイトの `OrbImage.svelte` と同じ寸法。 */
.orb-image {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 146.381px;
	height: 138.211px;
	isolation: isolate;
}
.orb-artwork {
	position: absolute;
	inset: -96px;
	pointer-events: none;
}
.orb-still {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 146.381px;
	height: 138.211px;
	transform: translate(-50%, -50%);
}
.orb-image:global([data-rendered="true"]) .orb-still {
	visibility: hidden;
}
canvas {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 240px;
	height: 240px;
	transform: translate(-50%, -50%);
}
</style>
