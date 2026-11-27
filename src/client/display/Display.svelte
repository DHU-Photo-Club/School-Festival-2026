<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PALETTE } from "../../data/palette.ts";
import { QUESTIONS } from "../../data/questions.ts";
import { SEQUENCES } from "../../data/sequences.ts";
import { ribbonPoints } from "../../shared/door.ts";
import { dustPoses } from "../../shared/dust.ts";
import { LAB_LOOP_NOTES, LabPlayer, parseLab } from "../../shared/lab.ts";
import type { Scene, ShardLayer } from "../../shared/motion.ts";
import {
	COLORS,
	computeScene,
	IDLE_RETURN_MS,
	introDescriptionOpacity,
	SHARD_RESULT_BLUR,
	screenColorId,
	WELCOME_FADE_OUT_MS,
	welcomeOpacity,
} from "../../shared/motion.ts";
import { nameColor, nameGradientCss, nameGradientStops, paletteColor } from "../../shared/palette.ts";
import { toDisplayState } from "../../shared/protocol.ts";
import { rippleRings } from "../../shared/ripple.ts";
import { findSequence, sequenceBefore, sequenceDuration, sequenceTime } from "../../shared/sequence.ts";
import { shardPoses } from "../../shared/shards.ts";
import type { DisplayState, PaletteId } from "../../shared/types.ts";
import { drawDust } from "../common/dust.ts";
import { drawRipple } from "../common/ripple.ts";
import { drawShardBloom, drawShards, hexToRgb, SHARD_BLOOM_SCALE } from "../common/shards.ts";
import { RealtimeClient } from "../lib/realtime.ts";
import { watchReducedMotion } from "../lib/reduced-motion.ts";
import { displaySequence } from "../sequences/displays.ts";
import { DOOR_RIBBON_BLUR, drawDoorRibbon } from "./door.ts";
import type { SceneRenderer } from "./renderer.ts";
import { createRenderer } from "./renderer.ts";

/**
 * `screen` はURLの画面番号（`/display/2` の `2`）で、来場者から見た順に1から振り、サーバーへの接続に使う。
 * `order` は二色の割り当てと演出のずれに使う並び順で、省略すると画面番号 - 1。画面分割では、二つのタブが
 * 一つの画面を描くため、どちらも0にする。
 */
let { screen, order }: { screen: number; order?: number } = $props();

// svelte-ignore state_referenced_locally
const displayOrder = order ?? screen - 1;

let displayState = $state<DisplayState | null>(null);
let reducedMotion = $state(false);
/** `sequence` の再生位置。再生中だけ毎フレーム更新する。 */
let sequenceT = $state(0);
/** 結果表示でこの画面が見せる色。結果開始のフレームで決め、そのセッション中は変えない。 */
let resultChoice = $state<{ sessionId: string | null; colorId: PaletteId } | null>(null);

let root = $state<HTMLElement>();
let canvas = $state<HTMLCanvasElement>();
let shardCanvas = $state<HTMLCanvasElement>();
let bloomCanvas = $state<HTMLCanvasElement>();
let rippleCanvas = $state<HTMLCanvasElement>();
let dustCanvas = $state<HTMLCanvasElement>();
let resultLayer = $state<HTMLDivElement>();
let door = $state<HTMLDivElement>();
let doorFrame = $state<HTMLDivElement>();
let doorCanvas = $state<HTMLCanvasElement>();
let veil = $state<HTMLDivElement>();
let welcome = $state<HTMLParagraphElement>();
let description = $state<HTMLParagraphElement>();

let client: RealtimeClient | null = null;
let renderer: SceneRenderer | null = null;
let frame = 0;
let lastDrawn = "";
let lastShards = "";
let lastRipple = "";
let lastDoor = "";
/** 塵を描いたままのフレームか。描いていないフレームでは、消した状態を一度だけ描く。 */
let dustDrawn = false;
let animateSessionId: string | null = null;
/** 今の質問へ `intro` から入ったか。`intro` の大きく色づいた輪から、質問中の灰色の輪へ戻すために使う。 */
let questionFromIntro = false;
let previousBackground: string | null = null;
let stopWatching = () => {};
let resizeObserver: ResizeObserver | null = null;
/**
 * この画面の大きさ（CSS画素）。一つのウィンドウに二台分を並べる画面分割（`/display/split`）でも画面ごとに
 * 描けるよう、ウィンドウではなく画面の要素の大きさを使う。
 */
let width = 1;
let height = 1;

/** `intro` の直前に再生するシーケンス。歓迎の文字はここから現れ始める。 */
const welcomeLead = sequenceBefore(SEQUENCES, "intro");

/**
 * 演出の調整用ループ（`/display/1?loop=result&color=jade`）。開発サーバーだけで有効にし、サーバーへは接続せず、
 * 一つの演出の台本（`src/shared/lab.ts`）を繰り返す。`h` キーでHUDを隠す。
 */
const lab = import.meta.env.DEV ? parseLab(location.search) : null;
const labPlayer = lab
	? new LabPlayer(
			lab,
			{ lead: welcomeLead, questionCount: QUESTIONS.length },
			{
				// 前の周の結果の色や覆いを持ち越さない。
				onCycle: () => {
					resultChoice = null;
					previousBackground = null;
				},
				// 台本の場面の状態を、サーバーから受信したのと同じ範囲に絞って、同じ経路で流し込む。
				onState: (state) => onState(toDisplayState(state)),
			},
		)
	: null;
let labHud = $state("");
let labHudVisible = $state(true);

/** 補正済みサーバー時刻。調整用ループでは端末の時計をそのまま使う。 */
const serverTime = (timestamp: number) =>
	lab ? performance.timeOrigin + timestamp : (client?.toServerTime(timestamp) ?? 0);

/** 台本の時刻になった場面の状態を流し込む。 */
function driveLab(now: number) {
	if (!labPlayer) return;
	const text = labPlayer.advance(now);
	if (text !== labHud) labHud = text;
}

function onKey(event: KeyboardEvent) {
	if (lab && event.key === "h") labHudVisible = !labHudVisible;
}

const colorOf = (id: PaletteId | null) => paletteColor(PALETTE.colors, id);

function onState(next: DisplayState) {
	const previous = displayState;
	if (next.phase === "idle") {
		if (previous && previous.phase !== "idle" && resultChoice) {
			previousBackground = colorOf(resultChoice.colorId) ? COLORS.dark : null;
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
			sequence && (lab || client)
				? sequenceTime(sequenceDuration(sequence, next), next.phaseStartedAt, serverTime(performance.now()))
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
	if (!canvas || !root) return;
	width = Math.max(1, root.clientWidth);
	height = Math.max(1, root.clientHeight);
	canvas.width = Math.max(1, Math.round(width * CANVAS_SCALE));
	canvas.height = Math.max(1, Math.round(height * CANVAS_SCALE));
	lastDrawn = "";
	lastShards = "";
	lastRipple = "";
	if (rippleCanvas) {
		rippleCanvas.width = Math.max(1, Math.round(width * shardRatio()));
		rippleCanvas.height = Math.max(1, Math.round(height * shardRatio()));
	}
	if (dustCanvas) {
		dustCanvas.width = Math.max(1, Math.round(width * shardRatio()));
		dustCanvas.height = Math.max(1, Math.round(height * shardRatio()));
		dustDrawn = true;
	}
	if (shardCanvas) {
		shardCanvas.width = Math.max(1, Math.round(width * shardRatio()));
		shardCanvas.height = Math.max(1, Math.round(height * shardRatio()));
	}
	if (bloomCanvas) {
		bloomCanvas.width = Math.max(1, Math.round(width * SHARD_BLOOM_SCALE));
		bloomCanvas.height = Math.max(1, Math.round(height * SHARD_BLOOM_SCALE));
	}
	if (doorCanvas) {
		// 扉の中の光はぼかして見せるので、CSS画素と同じ解像度で足りる。
		doorCanvas.width = Math.max(1, Math.round(doorCanvas.clientWidth));
		doorCanvas.height = Math.max(1, Math.round(doorCanvas.clientHeight));
		doorCanvas.style.filter = `blur(${(DOOR_RIBBON_BLUR * doorCanvas.clientWidth).toFixed(1)}px)`;
		lastDoor = "";
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
	const poses = shardPoses(width, height, layer.time, {
		scale: layer.scale,
		density: layer.density,
		size: layer.size,
		spread: layer.spread,
		fill: layer.fill,
		orbit: layer.orbit,
	});
	const tint = layer.colors ? { colors: layer.colors.map(hexToRgb), amount: layer.tint } : undefined;
	drawShards(context, poses, shardRatio(), layer.intensity, tint);
	if (bloom) {
		const ratio = bloom.canvas.width / width;
		drawShardBloom(bloom, poses, ratio, Math.min(width, height), layer.intensity, tint);
	}
}

/**
 * 質問の回答を受け付けた瞬間に、画面の中心から細い輪を外側へ薄く広げる（docs/visual-language.md 3.2節）。
 * 広げていないフレームは、輪を消した状態を一度だけ描く。
 */
function drawRippleLayer(layer: Scene["ripple"]) {
	const context = rippleCanvas?.getContext("2d");
	if (!context) return;
	const rings = layer ? rippleRings(layer.elapsed, width, height) : [];
	const key = rings.length === 0 ? "" : JSON.stringify(rings);
	if (key === lastRipple) return;
	lastRipple = key;
	drawRipple(context, rings, shardRatio());
}

/**
 * 判定中に、画面の外から中心へ細かい塵を集め、少しずつ数と濃さを増す（docs/visual-language.md 3.3節）。
 * 出していないフレームは、塵を消した状態を一度だけ描く。
 */
function drawDustLayer(layer: Scene["dust"]) {
	const context = dustCanvas?.getContext("2d");
	if (!context) return;
	if (!layer) {
		if (!dustDrawn) return;
		dustDrawn = false;
		drawDust(context, [], shardRatio());
		return;
	}
	dustDrawn = true;
	drawDust(context, dustPoses(layer.elapsed, width, height, layer.fade), shardRatio());
}

/**
 * 「扉を開く」の後に中央の扉の中へ、結果の二色の光の帯を描く（docs/visual-language.md 3.4.1節）。
 * 扉を出していないフレームは、帯を消した状態を一度だけ描く。
 */
function drawDoorLayer(layer: Scene["door"]) {
	const context = doorCanvas?.getContext("2d");
	if (!context) return;
	const stops = layer ? doorStops : null;
	const key = layer && stops ? `${layer.time}|${stops.join()}` : "";
	if (key === lastDoor) return;
	lastDoor = key;
	drawDoorRibbon(context, layer && stops ? ribbonPoints(layer.time) : [], stops ?? []);
}

/** 結果表示でこの画面が見せる色を決める。 */
function chooseResult(sessionId: string | null, colorId: PaletteId) {
	resultChoice = { sessionId, colorId };
}

/** 値が変わったときだけ書き換え、変化のないフレームでスタイルの再計算を起こさない。 */
function setStyle(
	element: HTMLElement | undefined,
	property: "opacity" | "backgroundColor" | "filter" | "left" | "right",
	value: string,
) {
	if (element && element.style[property] !== value) element.style[property] = value;
}

/** 扉の枠の左右の辺の位置。`open` が0で両辺が中央に重なり、1で扉の両端に来る。扉の幅に対する百分率。 */
const doorInset = (open: number) => `${(((1 - open) * 100) / 2).toFixed(3)}%`;

const opacity = (value: number) => String(Math.round(value * 1000) / 1000);

function applyLayers(scene: Scene) {
	setStyle(resultLayer, "opacity", opacity(scene.resultLayer));
	// 扉の枠を中央から左右へ開く。中の光は大きさと位置を変えず、開いた幅の分だけ見せる。
	// 扉の中の光の色が決まらない画面（結果の色がパレットにないときなど）では、光のない扉を出さない。
	setStyle(door, "opacity", scene.door && doorStops ? "1" : "0");
	const inset = doorInset(scene.door?.open ?? 0);
	setStyle(doorFrame, "left", inset);
	setStyle(doorFrame, "right", inset);
	// 結果で散らばり終えた破片をぼかす。canvas 2Dの描画は増やさず、要素のフィルターで合成時にぼかす。
	// ぼかしの分だけ合成の負荷は増えるので、会場のPCで結果のフレーム時間を確かめる。
	const blur = scene.shards.blur * SHARD_RESULT_BLUR * Math.min(width, height);
	setStyle(shardCanvas, "filter", blur > 0.05 ? `blur(${blur.toFixed(1)}px)` : "");
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
	const now = serverTime(timestamp);
	driveLab(now);
	const state = displayState;
	if (!(lab || client) || !state || !canvas) return;

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
	drawDustLayer(scene.dust);
	drawDoorLayer(scene.door);
}

onMount(() => {
	stopWatching = watchReducedMotion((reduced) => (reducedMotion = reduced));
	if (!lab) {
		client = new RealtimeClient({
			role: "display",
			screen,
			onState: (state) => onState(state as DisplayState),
			onStatus: () => {},
		});
		client.start();
	}
	resizeObserver = new ResizeObserver(() => resize());
	if (root) resizeObserver.observe(root);
	window.addEventListener("keydown", onKey);
	resize();
	frame = requestAnimationFrame(tick);
});

onDestroy(() => {
	cancelAnimationFrame(frame);
	client?.stop();
	stopWatching();
	resizeObserver?.disconnect();
	window.removeEventListener("keydown", onKey);
});

const shownColor = $derived(resultChoice ? colorOf(resultChoice.colorId) : null);
/**
 * 色名に重ねるグラデーションの二色。左端をこの画面の色、右端をもう一方の色にする。管理画面の表示確認では
 * その色だけ。もう一方の色がパレットにないときも、この画面の色だけにする。
 */
const namePair = $derived.by(() => {
	if (!shownColor) return null;
	const matched = resultChoice?.sessionId != null && displayState?.sessionId === resultChoice.sessionId;
	const result = matched ? displayState?.result : null;
	const other = result ? colorOf(result.colors[(displayOrder + 1) % 2]) : null;
	return [shownColor, other ?? shownColor] as const;
});
/** 扉の中の光の帯の色止め。色名のグラデーションと同じく、OKLCHで補間する。 */
const doorStops = $derived(namePair ? nameGradientStops(nameColor(namePair[0]), nameColor(namePair[1]), 7) : null);
const sequence = $derived(displayState?.phase === "sequence" ? findSequence(SEQUENCES, displayState.sequenceId) : null);
const SequenceView = $derived(sequence ? displaySequence(sequence.id) : null);
const sequenceMs = $derived(sequence && displayState ? sequenceDuration(sequence, displayState) : 0);
</script>

<main
	class="display"
	bind:this={root}
	data-phase={displayState?.phase}
	data-revision={displayState?.revision}
	data-result-color={resultChoice?.colorId}
>
	<canvas bind:this={canvas}></canvas>
	<canvas class="shard-bloom" bind:this={bloomCanvas}></canvas>
	<canvas class="shards" bind:this={shardCanvas}></canvas>
	<canvas class="ripple" bind:this={rippleCanvas}></canvas>
	<canvas class="dust" bind:this={dustCanvas}></canvas>

	<div class="layer" bind:this={resultLayer} style="opacity: 0">
		{#if shownColor && resultChoice && namePair}
			<div class="result-title">
				<p class="color-lead">あなたの色は</p>
				<!-- 鉤括弧も色名と同じグラデーションで塗る。 -->
				<p class="color-title" style:background-image={nameGradientCss(namePair[0], namePair[1])}>
					<span>「</span><span class="color-name">{shownColor.name}</span><span>」</span>
				</p>
			</div>
		{/if}
	</div>

	<!-- 「扉を開く」の後に中央に出す扉。色名と同じ時間で入れ替わる。 -->
	<div class="door" bind:this={door} style="opacity: 0">
		<!-- 枠と黒の内側。中央の幅0から左右へ開く。 -->
		<div class="door-frame" bind:this={doorFrame} style="left: 50%; right: 50%">
			<canvas bind:this={doorCanvas}></canvas>
		</div>
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

	{#if lab && labHudVisible}
		<p class="lab-hud" data-lab={lab.loop}>{labHud}<br>{LAB_LOOP_NOTES[lab.loop]}（h で隠す）</p>
	{/if}
</main>

<style>
/* 親の枠いっぱいに広げる。単独の画面ではウィンドウ全体、画面分割では左右の半分。 */
.display {
	position: absolute;
	inset: 0;
	overflow: hidden;
	background: #0b0b0b;
	cursor: none;
	/* 破片とブルームの合成先をこの要素の中に限る。 */
	isolation: isolate;
	/* 文字や扉の大きさを、ウィンドウではなくこの画面の大きさ（cqh、cqmin など）で決める。 */
	container-type: size;
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
.ripple,
.dust {
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
/* 扉には `will-change` を付けない。ぼかしたcanvasを含む扉を別の層にして見せ方を毎フレーム変えると、現れる途中に
   扉の上へ崩れた描画が出た（ヘッドレスのChromiumで確認）。 */
.door {
	pointer-events: none;
}
/* 縦長の扉。左右の中央に置き、下端を画面の下端に揃える（docs/visual-language.md 3.4.1節）。 */
.door {
	/* 扉の高さと、枠の太さ。 */
	--door-height: 78cqh;
	--door-border: max(1px, 0.16cqmin);
	position: absolute;
	left: 50%;
	bottom: 0;
	height: var(--door-height);
	aspect-ratio: 5 / 12;
	transform: translateX(-50%);
}
/* 細い明るい灰色の枠と、黒の内側。左右の辺の位置（left、right）は描画のたびに `doorInset` で決める。 */
.door-frame {
	position: absolute;
	top: 0;
	bottom: 0;
	box-sizing: border-box;
	border: var(--door-border) solid #c8c8c8;
	background: #000000;
	overflow: hidden;
}
/* 中の光は開き終えた内側の幅で中央に固定し、開く途中は枠の外にはみ出た分を隠す。 */
.door-frame canvas {
	left: 50%;
	right: auto;
	width: calc(var(--door-height) * 5 / 12 - var(--door-border) * 2);
	transform: translateX(-50%);
}
.welcome,
.description {
	position: absolute;
	inset: 0;
	margin: 0;
	display: grid;
	place-content: center;
	text-align: center;
	font-size: 5cqmin;
	font-weight: 500;
	letter-spacing: 0.12em;
	color: #e8e6e3;
	pointer-events: none;
	will-change: opacity;
}
.description {
	line-height: 1.9;
}
.lab-hud {
	position: absolute;
	left: 12px;
	bottom: 10px;
	margin: 0;
	font:
		12px / 1.5 ui-monospace,
		monospace;
	color: #e8e6e3;
	opacity: 0.55;
	pointer-events: none;
}
.result-title {
	position: absolute;
	inset: 0;
	display: grid;
	place-content: center;
	justify-items: center;
	gap: 3cqmin;
	text-align: center;
}
.color-lead {
	margin: 0;
	font-size: 5cqmin;
	font-weight: 500;
	letter-spacing: 0.12em;
	color: #ffffff;
}
.color-title {
	margin: 0;
	/* 最も長い色名（9文字）も、鉤括弧と字間を含めて画面幅の9割に収まる大きさ。 */
	font-size: min(14cqmin, 7.3cqw);
	white-space: nowrap;
	font-weight: 500;
	letter-spacing: 0.12em;
	/* 結果の二色のグラデーションを文字の形で切り抜く。 */
	-webkit-background-clip: text;
	background-clip: text;
	color: transparent;
}
</style>
