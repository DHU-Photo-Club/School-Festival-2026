<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PALETTE } from "../../data/palette.ts";
import { PHOTOS } from "../../data/photos.ts";
import { SEQUENCES } from "../../data/sequences.ts";
import { idlePhotoFor, idlePlaylist, resultPhotoFor } from "../../shared/assignment.ts";
import type { Scene, ShardLayer } from "../../shared/motion.ts";
import { computeScene, IDLE_RETURN_MS, idleCrossfade, idleCycleIndex, screenColorId } from "../../shared/motion.ts";
import { backgroundColor, foregroundColor, paletteColor } from "../../shared/palette.ts";
import { findSequence, sequenceDuration, sequenceTime } from "../../shared/sequence.ts";
import { shardPoses, spectrumColor } from "../../shared/shards.ts";
import type { DisplayState, PaletteId, Photo } from "../../shared/types.ts";
import PhotoImage from "../common/PhotoImage.svelte";
import { drawShards, hexToRgb } from "../common/shards.ts";
import { RealtimeClient } from "../lib/realtime.ts";
import { watchReducedMotion } from "../lib/reduced-motion.ts";
import { displaySequence } from "../sequences/displays.ts";
import type { SceneRenderer } from "./renderer.ts";
import { createRenderer } from "./renderer.ts";

/** URLの画面番号（`/display/2` の `2`）。来場者から見た順に1から振る。 */
let { screen }: { screen: number } = $props();

type LoadStatus = "loading" | "loaded" | "failed";

// svelte-ignore state_referenced_locally
const displayOrder = screen - 1;
const playlist = idlePlaylist(PHOTOS);
/**
 * 結果写真はセッションごとにAIの選定で決まるため、どの写真になってもすぐ見せられるよう、全作品を
 * 先に読み込んでおく（12点）。
 */
const resultCandidates = PHOTOS;

let displayState = $state<DisplayState | null>(null);
let reducedMotion = $state(false);
let resultStatus = $state<Record<string, LoadStatus>>({});
let cycle = $state(0);
/** `sequence` の再生位置。再生中だけ毎フレーム更新する。 */
let sequenceT = $state(0);
/** 結果表示でこの画面が見せるもの。結果開始のフレームで決め、そのセッション中は変えない。 */
let resultChoice = $state<{ sessionId: string | null; colorId: PaletteId; photo: Photo | null } | null>(null);

let canvas = $state<HTMLCanvasElement>();
let shardCanvas = $state<HTMLCanvasElement>();
let idleLayer = $state<HTMLDivElement>();
let resultLayer = $state<HTMLDivElement>();
let veil = $state<HTMLDivElement>();

let client: RealtimeClient | null = null;
let renderer: SceneRenderer | null = null;
let frame = 0;
let lastDrawn = "";
let lastShards = "";
let idleReference: number | null = null;
let animateSessionId: string | null = null;
let previousBackground: string | null = null;
let stopWatching = () => {};

const colorOf = (id: PaletteId | null) => paletteColor(PALETTE.colors, id);

function onState(next: DisplayState) {
	const previous = displayState;
	if (next.phase === "idle") {
		idleReference = next.phaseStartedAt;
		if (previous && previous.phase !== "idle" && resultChoice) {
			const color = colorOf(resultChoice.colorId);
			previousBackground = color ? backgroundColor(color) : null;
		}
		if (previous?.phase !== "idle") resultChoice = null;
	} else if (idleReference === null) {
		idleReference = next.phaseStartedAt;
	}
	if (next.phase === "judging") animateSessionId = next.sessionId;
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

function setResultStatus(photoId: string, status: LoadStatus) {
	resultStatus = { ...resultStatus, [photoId]: status };
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
	if (shardCanvas) {
		shardCanvas.width = Math.max(1, Math.round(window.innerWidth * shardRatio()));
		shardCanvas.height = Math.max(1, Math.round(window.innerHeight * shardRatio()));
		lastShards = "";
	}
}

/** 質問中の破片を描く。破片の色は重心の横位置の区画で決まる（docs/visual-language.md 3.2節）。 */
function drawShardLayer(layer: ShardLayer | null) {
	const context = shardCanvas?.getContext("2d");
	if (!context) return;
	const key = layer ? JSON.stringify(layer) : "";
	if (key === lastShards) return;
	lastShards = key;
	if (!layer) {
		drawShards(context, [], shardRatio(), 0);
		return;
	}
	const width = window.innerWidth;
	const height = window.innerHeight;
	const colors = layer.colors.map(hexToRgb);
	drawShards(context, shardPoses(width, height, layer.time, layer.swell), shardRatio(), layer.intensity, (x) =>
		spectrumColor((x / width) * layer.span - layer.offset, colors, layer.blend),
	);
}

/**
 * 結果表示で見せるもの。この画面の写真は選定された写真の `displayOrder` 番目（足りなければ写真なし）。
 * 結果開始のフレームで写真を読み込めていなければタイポグラフィ表示に決め、そのセッション中は変えない。
 * 結果開始後に接続した画面は演出を再生しないため、割り当て写真の読み込みが終わった時点で決める。
 */
function chooseResult(
	sessionId: string | null,
	result: NonNullable<DisplayState["result"]>,
	colorId: PaletteId,
	waitForLoad: boolean,
) {
	const photo = resultPhotoFor(PHOTOS, result.photoIds, displayOrder);
	const status = photo ? resultStatus[photo.id] : "failed";
	if (waitForLoad && status !== "loaded" && status !== "failed") return;
	resultChoice = { sessionId, colorId, photo: status === "loaded" ? photo : null };
}

/** 値が変わったときだけ書き換え、変化のないフレームでスタイルの再計算を起こさない。 */
function setStyle(element: HTMLElement | undefined, property: "opacity" | "backgroundColor", value: string) {
	if (element && element.style[property] !== value) element.style[property] = value;
}

const opacity = (value: number) => String(Math.round(value * 1000) / 1000);

function applyLayers(scene: Scene) {
	setStyle(idleLayer, "opacity", opacity(scene.idleLayer));
	setStyle(resultLayer, "opacity", opacity(scene.resultLayer));
	setStyle(veil, "opacity", opacity(scene.veil?.opacity ?? 0));
	if (scene.veil) setStyle(veil, "backgroundColor", scene.veil.color);
}

function tick(timestamp: number) {
	frame = requestAnimationFrame(tick);
	const state = displayState;
	if (!client || !state || !canvas) return;
	const now = client.toServerTime(timestamp);

	// 待機写真の巡回（仕様書7.2.3節）。
	if (idleReference !== null) {
		const nextCycle = idleCycleIndex(now, idleReference);
		if (nextCycle !== cycle) cycle = nextCycle;
		// 枠の切り替えフレームでもDOMの更新を待たずに正しい写真を選ぶため、写真IDで不透明度を決める。
		const fade = idleCrossfade(now, idleReference, reducedMotion);
		const currentId = idlePhotoFor(playlist, nextCycle, displayOrder)?.id;
		const previousId = nextCycle > 0 ? idlePhotoFor(playlist, nextCycle - 1, displayOrder)?.id : undefined;
		for (const element of idleLayer?.querySelectorAll<HTMLElement>("[data-photo-id]") ?? []) {
			if (element.tagName === "IMG") continue;
			const id = element.dataset.photoId;
			setStyle(element, "opacity", opacity(id === currentId ? fade : id === previousId ? 1 - fade : 0));
		}
	}
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
			chooseResult(state.sessionId, result, resultColor, resultMode === "complete");
		}
	} else if (state.phase === "idle" && state.previewColorId) {
		// 管理画面の表示確認は色だけを見せる（写真はセッションごとに選ぶため、色に決まった写真はない）。
		if (resultChoice?.colorId !== state.previewColorId) {
			resultChoice = { sessionId: null, colorId: state.previewColorId, photo: null };
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
	});
	applyLayers(scene);
	const key = JSON.stringify(scene.primitives);
	if (key !== lastDrawn) {
		renderer ??= createRenderer(canvas, () => (lastDrawn = ""));
		renderer.draw(scene.primitives);
		lastDrawn = key;
	}
	drawShardLayer(scene.shards);
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

// 待機写真は前枠・現在枠・次枠の作品だけを読み込む。
const idleSlots = $derived.by(() => {
	if (playlist.length === 0 || displayOrder >= playlist.length) return [];
	const slots: { slot: "previous" | "current" | "next"; photo: Photo }[] = [];
	const previous = cycle > 0 ? idlePhotoFor(playlist, cycle - 1, displayOrder) : null;
	const current = idlePhotoFor(playlist, cycle, displayOrder);
	const next = idlePhotoFor(playlist, cycle + 1, displayOrder);
	if (previous && previous.id !== current?.id) slots.push({ slot: "previous", photo: previous });
	if (current) slots.push({ slot: "current", photo: current });
	if (next && next.id !== current?.id && next.id !== previous?.id) slots.push({ slot: "next", photo: next });
	return slots;
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
	data-result-view={resultChoice ? (resultChoice.photo ? "photo" : "typography") : undefined}
>
	<canvas bind:this={canvas}></canvas>
	<canvas bind:this={shardCanvas}></canvas>

	<div class="layer" bind:this={idleLayer} style="opacity: 0">
		{#if displayOrder >= playlist.length}
			<p class="title">{EXHIBIT.title}</p>
		{:else}
			<div class="frame">
				{#each idleSlots as { slot, photo } (photo.id)}
					<div class="photo" data-slot={slot} data-photo-id={photo.id} style="opacity: 0">
						<PhotoImage {photo} />
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="layer" bind:this={resultLayer} style="opacity: 0">
		<div class="frame">
			{#each resultCandidates as photo (photo.id)}
				<div
					class="photo"
					data-result-photo={photo.id}
					style:opacity={resultChoice?.photo?.id === photo.id ? 1 : 0}
				>
					<PhotoImage {photo} onstatus={(status) => setResultStatus(photo.id, status)} />
				</div>
			{/each}
		</div>
		{#if shownColor && resultChoice && !resultChoice.photo}
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
</main>

<style>
.display {
	position: fixed;
	inset: 0;
	overflow: hidden;
	background: #0b0b0b;
	cursor: none;
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
.sequence {
	overflow: hidden;
	pointer-events: none;
}
.layer,
.veil {
	pointer-events: none;
	will-change: opacity;
}
/* 上下左右に clamp(32px, 5vmin, 96px) の余白を取った写真の配置領域（仕様書7.2.2節）。 */
.frame {
	position: absolute;
	inset: clamp(32px, 5vmin, 96px);
}
.photo {
	position: absolute;
	inset: 0;
}
.title,
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
.title {
	color: #e8e6e3;
}
</style>
