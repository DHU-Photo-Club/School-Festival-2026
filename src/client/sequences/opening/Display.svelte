<script lang="ts">
import type { DisplaySequenceProps } from "../props.ts";

// 仮の演出: 待機写真を暗くし、光の帯を左の画面から順に流してから写真へ戻す。
let { t, displayOrder, reducedMotion }: DisplaySequenceProps = $props();

const DARKEN_MS = 600;
const SWEEP_FROM = 1_200;
const SWEEP_MS = 1_000;
/** 画面が右へ一つ進むごとに帯の出発を遅らせる。 */
const SWEEP_STAGGER_MS = 200;
const RETURN_FROM = 2_600;
const RETURN_MS = 800;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const darkness = $derived.by(() => {
	if (reducedMotion) return t < RETURN_FROM ? 1 : 0;
	return Math.min(clamp01(t / DARKEN_MS), 1 - clamp01((t - RETURN_FROM) / RETURN_MS));
});
const sweep = $derived(clamp01((t - SWEEP_FROM - displayOrder * SWEEP_STAGGER_MS) / SWEEP_MS));
const showBand = $derived(!reducedMotion && sweep > 0 && sweep < 1);
</script>

<div class="veil" style:opacity={darkness}></div>
{#if showBand}
	<!-- 帯の幅は画面の30%。左端 -30% から 130% まで、画面の160%（帯の幅の 160 / 30 倍）動かす。 -->
	<div class="band" style:transform="translateX({(sweep * 160) / 0.3}%)"></div>
{/if}

<style>
.veil,
.band {
	position: absolute;
	top: 0;
	bottom: 0;
	pointer-events: none;
}
.veil {
	left: 0;
	right: 0;
	background: #0b0b0b;
}
.band {
	left: -30%;
	width: 30%;
	will-change: transform;
	background: linear-gradient(90deg, transparent, rgb(232 230 227 / 0.35), transparent);
}
</style>
