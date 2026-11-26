<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PALETTE } from "../../data/palette.ts";
import { SEQUENCES } from "../../data/sequences.ts";
import type { Scene, ShardLayer } from "../../shared/motion.ts";
import {
	computeScene,
	IDLE_RETURN_MS,
	screenColorId,
	WELCOME_FADE_OUT_MS,
	introDescriptionOpacity,
	welcomeOpacity,
} from "../../shared/motion.ts";
import { backgroundColor, foregroundColor, paletteColor } from "../../shared/palette.ts";
import { rippleRings } from "../../shared/ripple.ts";
import { findSequence, sequenceBefore, sequenceDuration, sequenceTime } from "../../shared/sequence.ts";
import { shardPoses } from "../../shared/shards.ts";
import type { DisplayState, PaletteId } from "../../shared/types.ts";
import { drawRipple } from "../common/ripple.ts";
import { drawShardBloom, drawShards, hexToRgb, SHARD_BLOOM_SCALE } from "../common/shards.ts";
import { RealtimeClient } from "../lib/realtime.ts";
import { watchReducedMotion } from "../lib/reduced-motion.ts";
import { displaySequence } from "../sequences/displays.ts";
import type { SceneRenderer } from "./renderer.ts";
import { createRenderer } from "./renderer.ts";

/** URLの画面番号（`/display/2` の `2`）。来場者から見た順に1から振る。 */
let { screen }: { screen: number } = $props();

// svelte-ignore state_referenced_locally
const displayOrder = screen - 1;

let displayState = $state<DisplayState | null>(null);
let reducedMotion = $state(false);
/** `sequence` の再生位置。再生中だけ毎フレーム更新する。 */
let sequenceT = $state(0);
/** 結果表示でこの画面が見せる色。結果開始のフレームで決め、そのセッション中は変えない。 */
let resultChoice = $state<{ sessionId: string | null; colorId: PaletteId } | null>(null);

let canvas = $state<HTMLCanvasElement>();
let shardCanvas = $state<HTMLCanvasElement>();
let bloomCanvas = $state<HTMLCanvasElement>();
let rippleCanvas = $state<HTMLCanvasElement>();
let resultLayer = $state<HTMLDivElement>();
let veil = $state<HTMLDivElement>();
let welcome = $state<HTMLParagraphElement>();
let description = $state<HTMLParagraphElement>();

let client: RealtimeClient | null = null;
let renderer: SceneRenderer | null = null;
let frame = 0;
let lastDrawn = "";
let lastShards = "";
let lastRipple = "";
let animateSessionId: string | null = null;
/** 今の質問へ `intro` から入ったか。`intro` の大きく色づいた輪から、質問中の灰色の輪へ戻すために使う。 */
let questionFromIntro = false;
let previousBackground: string | null = null;
let stopWatching = () => {};

/** `intro` の直前に再生するシーケンス。歓迎の文字はここから現れ始める。 */
const welcomeLead = sequenceBefore(SEQUENCES, "intro");

const colorOf = (id: PaletteId | null) => paletteColor(PALETTE.colors, id);

function onState(next: DisplayState) {
	const previous = displayState;
	if (next.phase === "idle") {
		if (previous && previous.phase !== "idle" && resultChoice) {
			const color = colorOf(resultChoice.colorId);
			previousBackground = color ? backgroundColor(color) : null;
		}
		if (previous?.phase !== "idle") resultChoice = null;
	}
	if (next.phase === "judging") animateSessionId = next.sessionId;
	if (next.phase === "question" && previous?.phase !== "question") questionFromIntro = previous?.phase === "intro";
	// 前のシーケンスの再生位置を、新しいシーケンスの最初のフレームへ持ち込まない。再生途中に接続した画面でも
	// 0を経由しないよう、受信した時点の再生位置から始める。
	if (next.phase === "sequence" && previous?.phase !== "sequence") {
		const sequence = findSequence(SEQUENCES, next.sequenceId);
		sequenceT =
			sequence && client
				? sequenceTime(
						sequenceDuration(sequence, next),
						next.phaseStartedAt,
						client.toServerTime(performance.now()),
					)
				: 0;
	}
	displayState = next;
}

/**
 * canvasはCSS画素の半分の解像度で描き、表示時に引き伸ばす。描くのはなだらかなグラデーションと
 * 全面の塗りだけなので見た目は変わらず、フラグメントシェーダーの負荷が `devicePixelRatio` に依存しない。
 */
const CANVAS_SCALE = 0.5;

/** 破片は輪郭を見せるため、CSS画素の2倍までの解像度で描く。 */
const shardRatio = () => Math.min(window.devicePixelRatio || 1, 2);

function resize() {
	if (!canvas) return;
	canvas.width = Math.max(1, Math.round(window.innerWidth * CANVAS_SCALE));
	canvas.height = Math.max(1, Math.round(window.innerHeight * CANVAS_SCALE));
	lastDrawn = "";
	lastShards = "";
	lastRipple = "";
	if (rippleCanvas) {
		rippleCanvas.width = Math.max(1, Math.round(window.innerWidth * shardRatio()));
		rippleCanvas.height = Math.max(1, Math.round(window.innerHeight * shardRatio()));
	}
	if (shardCanvas) {
		shardCanvas.width = Math.max(1, Math.round(window.innerWidth * shardRatio()));
		shardCanvas.height = Math.max(1, Math.round(window.innerHeight * shardRatio()));
	}
	if (bloomCanvas) {
		bloomCanvas.width = Math.max(1, Math.round(window.innerWidth * SHARD_BLOOM_SCALE));
		bloomCanvas.height = Math.max(1, Math.round(window.innerHeight * SHARD_BLOOM_SCALE));
	}
}

/**
 * 展示ディスプレイは写真を置かず、常に破片とそのブルームを描く。結果の二色が決まると、破片を交互に二色へ
 * 振り分けて色づける（docs/visual-language.md 3.2〜3.4節、4.4節）。
 */
function drawShardLayer(layer: ShardLayer) {
	const context = shardCanvas?.getContext("2d");
	if (!context) return;
	const key = JSON.stringify(layer);
	if (key === lastShards) return;
	lastShards = key;
	const bloom = bloomCanvas?.getContext("2d");
	const poses = shardPoses(window.innerWidth, window.innerHeight, layer.time, {
		scale: layer.scale,
		density: layer.density,
		size: layer.size,
		spread: layer.spread,
	});
	const tint = layer.colors ? { colors: layer.colors.map(hexToRgb), amount: layer.tint } : undefined;
	drawShards(context, poses, shardRatio(), layer.intensity, tint);
	if (bloom) {
		const ratio = bloom.canvas.width / window.innerWidth;
		drawShardBloom(bloom, poses, ratio, Math.min(window.innerWidth, window.innerHeight), layer.intensity, tint);
	}
}

/**
 * 質問の回答を受け付けた瞬間に、画面の中心から細い輪を外側へ薄く広げる（docs/visual-language.md 3.2節）。
 * 広げていないフレームは、輪を消した状態を一度だけ描く。
 */
function drawRippleLayer(layer: Scene["ripple"]) {
	const context = rippleCanvas?.getContext("2d");
	if (!context) return;
	const rings = layer ? rippleRings(layer.elapsed, window.innerWidth, window.innerHeight) : [];
	const key = rings.length === 0 ? "" : JSON.stringify(rings);
	if (key === lastRipple) return;
	lastRipple = key;
	drawRipple(context, rings, shardRatio());
}

/** 結果表示でこの画面が見せる色を決める。 */
function chooseResult(sessionId: string | null, colorId: PaletteId) {
	resultChoice = { sessionId, colorId };
}

/** 値が変わったときだけ書き換え、変化のないフレームでスタイルの再計算を起こさない。 */
function setStyle(element: HTMLElement | undefined, property: "opacity" | "backgroundColor", value: string) {
	if (element && element.style[property] !== value) element.style[property] = value;
}

const opacity = (value: number) => String(Math.round(value * 1000) / 1000);

function applyLayers(scene: Scene) {
	setStyle(resultLayer, "opacity", opacity(scene.resultLayer));
	setStyle(veil, "opacity", opacity(scene.veil?.opacity ?? 0));
	if (scene.veil) setStyle(veil, "backgroundColor", scene.veil.color);
}

/**
 * 歓迎の文字（`intro` と、その直前のシーケンス）。現れるときは `welcomeOpacity` で時刻から決め、
 * 見せる段階を終えて消えるときだけトランジションを付ける（reduced-motionでは即時）。
 */
function applyWelcome(state: DisplayState, now: number) {
	if (!welcome) return;
	const shown = welcomeOpacity(state, now, reducedMotion, welcomeLead);
	const visiblePhase =
		state.phase === "intro" ||
		(state.phase === "sequence" && welcomeLead !== null && state.sequenceId === welcomeLead.id);
	const transition = visiblePhase || reducedMotion ? "none" : `opacity ${WELCOME_FADE_OUT_MS}ms ease-in-out`;
	if (welcome.style.transition !== transition) welcome.style.transition = transition;
	setStyle(welcome, "opacity", opacity(shown));
	// 説明の文は `intro` の間だけ見せる。`intro` を終えるときの消える変化は歓迎の文字と同じ。
	if (!description) return;
	const descriptionTransition = state.phase === "intro" || reducedMotion ? "none" : transition;
	if (description.style.transition !== descriptionTransition) description.style.transition = descriptionTransition;
	setStyle(description, "opacity", opacity(introDescriptionOpacity(state, now, reducedMotion, welcomeLead)));
}

function tick(timestamp: number) {
	frame = requestAnimationFrame(tick);
	const state = displayState;
	if (!client || !state || !canvas) return;
	const now = client.toServerTime(timestamp);

	if (sequence && state.phase === "sequence") {
		const t = sequenceTime(sequenceMs, state.phaseStartedAt, now);
		if (t !== sequenceT) sequenceT = t;
	}
	if (state.phase === "idle" && previousBackground && now - state.phaseStartedAt > IDLE_RETURN_MS) {
		previousBackground = null;
	}

	// 結果開始のフレーム。`judging` の `phaseEndsAt` を全画面が補正済みサーバー時刻で待つ。
	const result = state.phase === "judging" || state.phase === "result" ? state.result : null;
	const resultColor = screenColorId(result, displayOrder);
	const startAt =
		state.phase === "judging" ? state.phaseEndsAt : state.phase === "result" ? state.phaseStartedAt : null;
	const resultMode = animateSessionId !== null && animateSessionId === state.sessionId ? "animate" : "complete";
	if (result && resultColor && startAt !== null && now >= startAt) {
		if (!resultChoice || resultChoice.sessionId !== state.sessionId) {
			chooseResult(state.sessionId, resultColor);
		}
	} else if (state.phase === "idle" && state.previewColorId) {
		// 管理画面の表示確認は色だけを見せる。
		if (resultChoice?.colorId !== state.previewColorId) {
			resultChoice = { sessionId: null, colorId: state.previewColorId };
		}
	} else if (state.phase === "idle" && resultChoice && !state.previewColorId) {
		resultChoice = null;
	}

	const scene = computeScene({
		state,
		now,
		displayOrder,
		width: canvas.width,
		height: canvas.height,
		reducedMotion,
		colors: PALETTE.colors,
		resultMode,
		previousBackground,
		lead: welcomeLead,
		questionFromIntro,
	});
	applyLayers(scene);
	applyWelcome(state, now);
	const key = JSON.stringify(scene.primitives);
	if (key !== lastDrawn) {
		renderer ??= createRenderer(canvas, () => (lastDrawn = ""));
		renderer.draw(scene.primitives);
		lastDrawn = key;
	}
	drawShardLayer(scene.shards);
	drawRippleLayer(scene.ripple);
}

onMount(() => {
	stopWatching = watchReducedMotion((reduced) => (reducedMotion = reduced));
	client = new RealtimeClient({
		role: "display",
		screen,
		onState: (state) => onState(state as DisplayState),
		onStatus: () => {},
	});
	client.start();
	window.addEventListener("resize", resize);
	resize();
	frame = requestAnimationFrame(tick);
});

onDestroy(() => {
	cancelAnimationFrame(frame);
	client?.stop();
	stopWatching();
	window.removeEventListener("resize", resize);
});

const shownColor = $derived(resultChoice ? colorOf(resultChoice.colorId) : null);
const sequence = $derived(displayState?.phase === "sequence" ? findSequence(SEQUENCES, displayState.sequenceId) : null);
const SequenceView = $derived(sequence ? displaySequence(sequence.id) : null);
const sequenceMs = $derived(sequence && displayState ? sequenceDuration(sequence, displayState) : 0);
</script>

<main
	class="display"
	data-phase={displayState?.phase}
	data-revision={displayState?.revision}
	data-result-color={resultChoice?.colorId}
>
	<canvas bind:this={canvas}></canvas>
	<canvas class="shard-bloom" bind:this={bloomCanvas}></canvas>
	<canvas class="shards" bind:this={shardCanvas}></canvas>
	<canvas class="ripple" bind:this={rippleCanvas}></canvas>

	<div class="layer" bind:this={resultLayer} style="opacity: 0">
		{#if shownColor && resultChoice}
			<p class="color-name" style:color={foregroundColor(shownColor)}>{shownColor.name}</p>
		{/if}
	</div>

	<div class="veil" bind:this={veil} style="opacity: 0"></div>

	{#if sequence && SequenceView}
		<div class="sequence" data-sequence={sequence.id}>
			<SequenceView
				t={sequenceT}
				durationMs={sequenceMs}
				sessionId={displayState?.sessionId ?? null}
				{displayOrder}
				{reducedMotion}
			/>
		</div>
	{/if}

	<!-- 歓迎の文字は、演出の覆いの上に置く。 -->
	<p class="welcome" bind:this={welcome} style="opacity: 0">{EXHIBIT.title}へようこそ</p>
	<p class="description" bind:this={description} style="opacity: 0">
		{#each EXHIBIT.introDescription as line (line)}
			<span>{line}</span>
		{/each}
	</p>
</main>

<style>
.display {
	position: fixed;
	inset: 0;
	overflow: hidden;
	background: #0b0b0b;
	cursor: none;
	/* 破片とブルームの合成先をこの要素の中に限る。 */
	isolation: isolate;
}
canvas,
.layer,
.veil,
.sequence {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}
/* 破片のブルーム。色面と破片の間に置き、スクリーン合成で下の色面へ明るさを足す（docs/visual-language.md 4.4節、7章）。 */
.shard-bloom {
	opacity: 0.45;
	mix-blend-mode: screen;
}
/* 破片。ハードライト合成で下の色面とブルームへ重ねる（docs/visual-language.md 4.4節、7章）。 */
.shards {
	mix-blend-mode: hard-light;
}
.ripple {
	pointer-events: none;
}
.sequence {
	overflow: hidden;
	pointer-events: none;
}
.layer,
.veil {
	pointer-events: none;
	will-change: opacity;
}
.welcome,
.description {
	position: absolute;
	inset: 0;
	margin: 0;
	display: grid;
	place-content: center;
	text-align: center;
	font-size: 5vmin;
	font-weight: 500;
	letter-spacing: 0.12em;
	color: #e8e6e3;
	pointer-events: none;
	will-change: opacity;
}
.description {
	line-height: 1.9;
}
.color-name {
	position: absolute;
	inset: 0;
	margin: 0;
	display: grid;
	place-content: center;
	text-align: center;
	font-size: 6vmin;
	font-weight: 500;
	letter-spacing: 0.12em;
}
</style>
