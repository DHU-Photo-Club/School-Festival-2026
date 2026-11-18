<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { RESULT_COLORS } from "../../data/colors.ts";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PHOTOS } from "../../data/photos.ts";
import { idlePhotoFor, idlePlaylist, resultPhotoFor } from "../../shared/assignment.ts";
import { displayOrderOf } from "../../shared/screens.ts";
import { computeScene, idleCrossfade, idleCycleIndex, IDLE_RETURN_MS } from "../../shared/motion.ts";
import type { Scene, ShardLayer } from "../../shared/motion.ts";
import { shardPoses, spectrumColor } from "../../shared/shards.ts";
import { COLOR_IDS } from "../../shared/types.ts";
import type { ColorId, DisplayState, Photo } from "../../shared/types.ts";
import Pairing from "../common/Pairing.svelte";
import PhotoImage from "../common/PhotoImage.svelte";
import { drawShards, hexToRgb } from "../common/shards.ts";
import { RealtimeClient } from "../lib/realtime.ts";
import { fetchDeviceSession, watchReducedMotion } from "../lib/session.ts";
import { createRenderer } from "./renderer.ts";
import type { SceneRenderer } from "./renderer.ts";

let { screenId }: { screenId: string } = $props();

type LoadStatus = "loading" | "loaded" | "failed";

// 並び順は登録時に振られた画面IDの番号で決まる。
const parsedOrder = displayOrderOf(screenId);
const displayOrder = parsedOrder ?? 0;
const playlist = idlePlaylist(PHOTOS);
// 8色それぞれで自分に割り当てられる結果写真（仕様書7.2.5節）。写真がない色は読み込まない。
const resultAssignments = COLOR_IDS.map((colorId) => ({
	colorId,
	photo: resultPhotoFor(PHOTOS, colorId, displayOrder),
}));

let auth = $state<"checking" | "unpaired" | "mismatch" | "ok">("checking");
let displayState = $state<DisplayState | null>(null);
let reducedMotion = $state(false);
let resultStatus = $state<Record<string, LoadStatus>>({});
let idleStatus = $state<Record<string, LoadStatus>>({});
let retryRound = $state(0);
let cycle = $state(0);
/** 結果表示でこの画面が見せるもの。結果開始のフレームで決め、そのセッション中は変えない。 */
let resultChoice = $state<{ sessionId: string | null; colorId: ColorId; photo: Photo | null } | null>(null);

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
let reportedSessionId: string | null = null;
let previousBackground: string | null = null;
let preloadReported = false;
/** 最初の待機二作品。`null` は未確定。 */
let firstIdlePhotoIds: string[] | null = null;
let stopWatching = () => {};

const colorOf = (id: ColorId | null) => RESULT_COLORS.find((color) => color.id === id) ?? null;

function onState(next: DisplayState) {
	const previous = displayState;
	if (next.phase === "idle") {
		idleReference = next.phaseStartedAt;
		if (previous && previous.phase !== "idle" && resultChoice) {
			previousBackground = colorOf(resultChoice.colorId)?.backgroundColor ?? null;
		}
		if (previous?.phase !== "idle") {
			resultChoice = null;
			// 結果表示で読み込めなかった写真は、次の待機状態で再試行する（仕様書7.2.5節）。
			if (Object.values(resultStatus).includes("failed")) retryFailedResultPhotos();
		}
	} else if (idleReference === null) {
		idleReference = next.phaseStartedAt;
	}
	if (next.phase === "judging") animateSessionId = next.sessionId;
	displayState = next;
}

function retryFailedResultPhotos() {
	const next = { ...resultStatus };
	for (const [id, status] of Object.entries(next)) if (status === "failed") next[id] = "loading";
	resultStatus = next;
	retryRound += 1;
}

function setResultStatus(photoId: string, status: LoadStatus) {
	resultStatus = { ...resultStatus, [photoId]: status };
	maybeReportPreload();
}

function setIdleStatus(photoId: string, status: LoadStatus) {
	if (idleStatus[photoId] === status) return;
	idleStatus = { ...idleStatus, [photoId]: status };
	maybeReportPreload();
}

/** 結果用写真8色分と最初の待機二作品の読み込み結果を報告する（仕様書7.2.5節）。 */
function maybeReportPreload() {
	if (preloadReported || !client || firstIdlePhotoIds === null) return;
	const targets = [
		...resultAssignments.flatMap(({ photo }) => (photo ? [{ id: photo.id, status: resultStatus[photo.id] }] : [])),
		...firstIdlePhotoIds.map((id) => ({ id, status: idleStatus[id] ?? resultStatus[id] })),
	];
	if (targets.some((target) => target.status !== "loaded" && target.status !== "failed")) return;
	preloadReported = true;
	void client.request({
		type: "diagnostic",
		name: "preloadReport",
		succeeded: targets.filter((target) => target.status === "loaded").length,
		failedPhotoIds: targets.filter((target) => target.status === "failed").map((target) => target.id),
	});
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
 * 結果表示で見せるもの。結果開始のフレームで写真を読み込めていなければタイポグラフィ表示に決め、
 * そのセッション中は変えない（仕様書7.2.5節）。結果開始後に接続した画面は演出を再生しないため、
 * 割り当て写真の読み込みが終わった時点で決める（docs/progress.md 参照）。
 */
function chooseResult(sessionId: string | null, colorId: ColorId, waitForLoad: boolean) {
	const photo = resultPhotoFor(PHOTOS, colorId, displayOrder);
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
		// 最初の待機二作品は、接続後に初めて求めた枠の現在作品と次作品（仕様書7.2.5節）。
		if (firstIdlePhotoIds === null) {
			firstIdlePhotoIds = [nextCycle, nextCycle + 1]
				.map((index) => idlePhotoFor(playlist, index, displayOrder)?.id)
				.filter((id, index, ids): id is string => id !== undefined && ids.indexOf(id) === index);
			maybeReportPreload();
		}
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
	if (state.phase === "idle" && previousBackground && now - state.phaseStartedAt > IDLE_RETURN_MS) {
		previousBackground = null;
	}

	// 結果開始のフレーム（仕様書8.7節）。
	const resultColor = state.phase === "judging" || state.phase === "result" ? state.resultColorId : null;
	const startAt =
		state.phase === "judging" ? state.phaseEndsAt : state.phase === "result" ? state.phaseStartedAt : null;
	const resultMode = animateSessionId !== null && animateSessionId === state.sessionId ? "animate" : "complete";
	if (resultColor && startAt !== null && now >= startAt) {
		if (!resultChoice || resultChoice.sessionId !== state.sessionId) {
			chooseResult(state.sessionId, resultColor, resultMode === "complete");
			if (resultMode === "animate" && reportedSessionId !== state.sessionId && state.sessionId) {
				reportedSessionId = state.sessionId;
				void client.request({
					type: "resultStarted",
					sessionId: state.sessionId,
					screenId,
					actualStartedAt: now,
				});
			}
		}
	} else if (state.phase === "idle" && state.previewColorId) {
		// 管理画面の表示確認は読み込みが終わり次第写真へ切り替える。
		const photo = resultPhotoFor(PHOTOS, state.previewColorId, displayOrder);
		const shown = photo && resultStatus[photo.id] === "loaded" ? photo : null;
		if (resultChoice?.colorId !== state.previewColorId || resultChoice.photo?.id !== shown?.id) {
			resultChoice = { sessionId: null, colorId: state.previewColorId, photo: shown };
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
		colors: RESULT_COLORS,
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

onMount(async () => {
	stopWatching = watchReducedMotion((reduced) => (reducedMotion = reduced));
	if (parsedOrder === null) {
		auth = "mismatch";
		return;
	}
	const session = await fetchDeviceSession().catch(() => null);
	if (!session) {
		auth = "unpaired";
		return;
	}
	// URLと端末セッションの screenId が一致しない場合は表示を開始しない（仕様書7.2.1節）。
	if (session.role !== "display" || session.screenId !== screenId) {
		auth = "mismatch";
		return;
	}
	auth = "ok";
	client = new RealtimeClient({
		role: "display",
		screenId,
		onState: (state) => onState(state as DisplayState),
		onStatus: (status) => {
			if (status === "unauthenticated") auth = "unpaired";
		},
		checkAuth: async () => (await fetchDeviceSession()) !== null,
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

// 待機写真は現在枠と次枠の二作品だけを読み込む（仕様書7.2.5節）。
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
</script>

{#if auth === "unpaired"}
	<Pairing />
{:else if auth === "mismatch"}
	<Pairing message="この画面は再登録が必要です。" />
{:else}
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
							<PhotoImage {photo} onstatus={(status) => setIdleStatus(photo.id, status)} />
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="layer" bind:this={resultLayer} style="opacity: 0">
			<div class="frame">
				{#key retryRound}
					{#each resultAssignments as { colorId, photo } (colorId)}
						{#if photo}
							<div
								class="photo"
								data-result-color={colorId}
								style:opacity={resultChoice?.photo?.id === photo.id ? 1 : 0}
							>
								<PhotoImage {photo} onstatus={(status) => setResultStatus(photo.id, status)} />
							</div>
						{/if}
					{/each}
				{/key}
			</div>
			{#if shownColor && resultChoice && !resultChoice.photo}
				<p class="color-name" style:color={shownColor.foregroundColor}>{shownColor.name}</p>
			{/if}
		</div>

		<div class="veil" bind:this={veil} style="opacity: 0"></div>
	</main>
{/if}

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
.veil {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
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
