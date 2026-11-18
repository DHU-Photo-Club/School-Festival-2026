<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { easeInOutSine } from "../../shared/motion.ts";
import { shardPoses } from "../../shared/shards.ts";
import { drawShards } from "../common/shards.ts";

/** iPadの待機画面に置く三角形の破片の輪と床（docs/visual-language.md 4.4節）。 */
let {
	still = false,
	dim = false,
}: {
	/** true のとき動かさず、静止した一枚だけを描く。 */
	still?: boolean;
	/** true のとき破片の不透明度を下げる（受付停止）。 */
	dim?: boolean;
} = $props();

const FADE_IN_MS = 1_400;
const DIM_ALPHA = 0.35;

let canvas = $state<HTMLCanvasElement>();
let frame = 0;
let startedAt = 0;
let width = 0;
let height = 0;

const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

function draw(elapsed: number) {
	const context = canvas?.getContext("2d");
	if (!context) return;
	const fade = still ? 1 : easeInOutSine(elapsed / FADE_IN_MS);
	drawShards(context, shardPoses(width, height, elapsed), pixelRatio(), fade * (dim ? DIM_ALPHA : 1));
}

function resize() {
	if (!canvas) return;
	const ratio = pixelRatio();
	width = canvas.clientWidth;
	height = canvas.clientHeight;
	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	if (still) draw(0);
}

function tick(timestamp: number) {
	frame = requestAnimationFrame(tick);
	if (!startedAt) startedAt = timestamp;
	draw(timestamp - startedAt);
}

onMount(() => {
	resize();
	window.addEventListener("resize", resize);
});

$effect(() => {
	// still、dim が変わったときに描き方を切り替える。
	cancelAnimationFrame(frame);
	if (still) {
		void dim;
		draw(0);
	} else {
		frame = requestAnimationFrame(tick);
	}
});

onDestroy(() => {
	cancelAnimationFrame(frame);
	window.removeEventListener("resize", resize);
});
</script>

<canvas class="shards" bind:this={canvas} aria-hidden="true"></canvas>

<style>
.shards {
	position: fixed;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}
</style>
