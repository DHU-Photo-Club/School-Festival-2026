// 展示ディスプレイとiPadの演出を、補正済みサーバー時刻と受信状態だけから決める（docs/visual-language.md）。
import { INACTIVITY_MS } from "./machine.ts";
import type { ColorId, DisplayState, ResultColor } from "./types.ts";

// ---- 時間（docs/visual-language.md 3章） ----

export const IDLE_FRAME_MS = 8_000;
export const IDLE_CROSSFADE_MS = 1_000;
export const QUESTION_PHOTO_FADE_MS = 1_500;
export const GLOW_APPEAR_DELAY_MS = 600;
export const GLOW_APPEAR_MS = 3_000;
export const GLOW_TURN_MS = 6_000;
export const GLOW_PULSE = 0.08;
export const JUDGING_FADE_MS = 1_200;
export const RESULT_SETTLE_MS = 1_000;
export const RESULT_PHOTO_DELAY_MS = 400;
export const RESULT_PHOTO_FADE_MS = 1_200;
export const RESULT_REDUCED_HOLD_MS = 1_600;
export const IDLE_RETURN_MS = 1_000;
const SECTOR_DEGREES = 45;

export const COLORS = {
	idle: "#0B0B0B",
	dark: "#000000",
	text: "#E8E6E3",
	muted: "#8A8784",
	line: "#3A3836",
} as const;

/** 結果色ごとの広がり方と所要時間（docs/visual-language.md 3.4節）。 */
export const RESULT_FORMS: Readonly<Record<ColorId, { form: ResultForm; durationMs: number }>> = {
	red: { form: "openingBand", durationMs: 1_600 },
	orange: { form: "risingSlant", durationMs: 1_800 },
	yellow: { form: "fallingTide", durationMs: 1_600 },
	green: { form: "risingTide", durationMs: 2_200 },
	cyan: { form: "sweepingTide", durationMs: 1_600 },
	blue: { form: "closingFrame", durationMs: 2_000 },
	violet: { form: "diagonalTide", durationMs: 2_600 },
	magenta: { form: "meetingTides", durationMs: 1_400 },
};

export type ResultForm =
	| "openingBand"
	| "risingSlant"
	| "fallingTide"
	| "risingTide"
	| "sweepingTide"
	| "closingFrame"
	| "diagonalTide"
	| "meetingTides";

/** 質問中の破片の色で、画面の幅に並ぶ区画の数（docs/visual-language.md 3.2節）。 */
export const SPECTRUM_SPAN = 2.5;
/** 隣り合う色が溶け合う幅（区画に対する割合）。 */
export const SPECTRUM_BLEND = 0.9;
/** 結果色の縁のぼけ幅（画面短辺に対する割合）。広がり始めから終わりへ広げる（docs/visual-language.md 3.4節）。 */
export const BLOOM_FEATHER_START = 0.2;
export const BLOOM_FEATHER_END = 0.75;
/** ノイズによる縁の揺れ幅（ぼけ幅に対する割合）。描画側の `BLOOM_WARP` と同じ値にする。 */
export const BLOOM_WARP = 0.6;

/** 色相が隣り合わない固定順（docs/visual-language.md 2.2節）。 */
export const NEUTRAL_ORDER: readonly ColorId[] = [
	"red",
	"cyan",
	"yellow",
	"violet",
	"green",
	"magenta",
	"blue",
	"orange",
];

// ---- 補助関数 ----

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** 端点では厳密に0と1を返す。 */
const eased = (ease: (t: number) => number) => (t: number) => {
	const x = clamp01(t);
	return x === 0 ? 0 : x === 1 ? 1 : ease(x);
};
export const easeInOutSine = eased((t) => (1 - Math.cos(Math.PI * t)) / 2);
export const easeOutCubic = eased((t) => 1 - (1 - t) ** 3);
export const easeInSine = eased((t) => 1 - Math.cos((t * Math.PI) / 2));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** FNV-1a 32bit。 */
export function hash32(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

function seededRandom(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 輪の8区画の並び順。セッションの間は全画面で同じ（docs/visual-language.md 2.2節）。 */
export function ringOrder(sessionId: string | null): ColorId[] {
	if (!sessionId) return [...NEUTRAL_ORDER];
	const order = [...NEUTRAL_ORDER];
	const random = seededRandom(hash32(sessionId));
	for (let i = order.length - 1; i > 0; i -= 1) {
		const j = Math.floor(random() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order;
}

/** 輪の基準角（度）。 */
export function ringBaseAngle(sessionId: string | null): number {
	return sessionId ? (hash32(`${sessionId}:angle`) % 4500) / 100 : 0;
}

/** サーバーが最後にiPad操作を受理した時刻（`question` の `phaseEndsAt` は最終操作から5分後）。 */
export function lastOperationAt(state: Pick<DisplayState, "phase" | "phaseStartedAt" | "phaseEndsAt">): number {
	if ((state.phase === "question" || state.phase === "intro") && state.phaseEndsAt !== null) {
		return state.phaseEndsAt - INACTIVITY_MS;
	}
	return state.phaseStartedAt;
}

/**
 * 輪の回転量（区画数）。`revision` が増えた時刻から `turnMs` かけて一区画回る。
 * `judging` では最終回答の確定として一区画回りながら消える。
 */
export function ringSteps(
	state: Pick<DisplayState, "phase" | "phaseStartedAt" | "phaseEndsAt" | "revision">,
	now: number,
	turnMs: number,
	reducedMotion: boolean,
): number {
	const changedAt = lastOperationAt(state);
	const turning =
		(state.phase === "judging" || (state.phase === "question" && changedAt > state.phaseStartedAt)) &&
		now - changedAt < turnMs;
	if (!turning || reducedMotion) return state.revision;
	return state.revision - 1 + easeInOutSine((now - changedAt) / turnMs);
}

/** 輪の回転角（度、12時方向から時計回り）。画面が右へ一つ進むごとに一区画戻す。 */
export function ringAngle(sessionId: string | null, steps: number, displayOrder: number): number {
	return ringBaseAngle(sessionId) + (steps - displayOrder) * SECTOR_DEGREES;
}

/**
 * 質問中の破片の色のずれ（区画数）。輪の回転角を区画数で表した値で、画面の左端に
 * `-offset` 番目の区画の位置が来る。画面が右へ一つ進むごとに一区画戻し、一問確定すると一区画進む。
 */
export function spectrumOffset(sessionId: string | null, steps: number, displayOrder: number): number {
	return ringAngle(sessionId, steps, displayOrder) / SECTOR_DEGREES;
}

// ---- 描画内容 ----

/**
 * 一フレームの描画内容。座標と長さはcanvasの画素単位。`drift` はノイズを流す時刻（秒）で、
 * 補正済みサーバー時刻と状態の開始時刻の差から求めるため全画面で同じ値になる。
 */
export type Primitive =
	| { type: "fill"; color: string; alpha?: number }
	/**
	 * 結果色のにじみ。起点からの距離 `d` が `reach - feather` より近い範囲を塗りつぶし、
	 * `reach + feather` より遠い範囲は塗らない。距離はどれも直線か画面の縁から測る。
	 * - `line`: 点 `(x, y)` を通り向き `(dx, dy)`（単位ベクトル）に垂直な直線から、向きの側へ測った距離
	 * - `band`: 同じ直線から両側へ測った距離
	 * - `frame`: 最も近い画面の縁から内側へ測った距離
	 */
	| {
			type: "bloom";
			shape: "line" | "band" | "frame";
			x: number;
			y: number;
			dx: number;
			dy: number;
			reach: number;
			feather: number;
			color: string;
			drift: number;
	  };

/**
 * 質問中の三角形の破片（docs/visual-language.md 3.2節）。配置と動きは `shardPoses` で求め、
 * 破片の色は重心の横位置で決まる。`colors[i]` は位置 `x / 幅 × span - offset` が `i` から
 * `i + 1` までの区画を占める（8区画で一巡する）。
 */
export interface ShardLayer {
	/** `shardPoses` に渡す経過時間（ミリ秒）。補正済みサーバー時刻なので全画面で同じ値になる。 */
	time: number;
	/** 輪の半径の倍率。 */
	swell: number;
	offset: number;
	span: number;
	blend: number;
	colors: string[];
	/** 不透明度（0〜1）。 */
	intensity: number;
}

export interface Scene {
	primitives: Primitive[];
	/** WebGLの描画の上に重ねる破片。 */
	shards: ShardLayer | null;
	/** 待機写真またはタイトルの層の不透明度。 */
	idleLayer: number;
	/** 結果写真またはタイポグラフィの層の不透明度。 */
	resultLayer: number;
	/** 前の結果色を1秒で消すための覆い。 */
	veil: { color: string; opacity: number } | null;
	/** 次のフレームで描画内容が変わりうるか。 */
	animating: boolean;
}

export interface SceneInput {
	state: DisplayState;
	now: number;
	displayOrder: number;
	width: number;
	height: number;
	reducedMotion: boolean;
	colors: readonly ResultColor[];
	/**
	 * 結果の見せ方。`animate` は `judging` から接続していた画面、`complete` は結果開始後に接続した画面。
	 */
	resultMode: "animate" | "complete";
	/** 直前に表示していた結果の背景色。`idle` へ戻るときの覆いに使う。 */
	previousBackground: string | null;
}

const colorOf = (colors: readonly ResultColor[], id: ColorId | null) => colors.find((color) => color.id === id) ?? null;

/** 状態の開始時刻からの経過秒。reduced-motionではノイズを流さない。 */
const driftOf = (now: number, since: number, reducedMotion: boolean) =>
	reducedMotion ? 0 : Math.max(0, now - since) / 1000;

/** 質問中の破片。reduced-motionでは時刻を進めず、初期配置のまま止める。 */
function questionShards(input: SceneInput, intensity: number, steps: number, swell = 1): ShardLayer {
	const { state, now, reducedMotion, colors } = input;
	return {
		time: reducedMotion ? 0 : now,
		swell,
		offset: spectrumOffset(state.sessionId, steps, input.displayOrder),
		span: SPECTRUM_SPAN,
		blend: SPECTRUM_BLEND,
		colors: ringOrder(state.sessionId).map((id) => colorOf(colors, id)?.baseColor ?? COLORS.line),
		intensity: clamp01(intensity),
	};
}

/**
 * 結果色の広がりの一フレーム（docs/visual-language.md 3.4節）。`progress` は0〜1。
 * `progress` が1のとき、縁がノイズで揺れても画面全体を塗りつぶす。
 */
export function resultFormPrimitives(
	colorId: ColorId,
	color: string,
	progress: number,
	width: number,
	height: number,
	displayOrder: number,
	drift: number,
): Primitive[] {
	const m = Math.min(width, height);
	const seed = 0.08 * m;
	// 縁のぼけ幅の分だけ遠くまで広げるため、序盤で一気に進む easeOutCubic では早く満ちて見える。
	const p = easeInOutSine(progress);
	const feather = lerp(BLOOM_FEATHER_START, BLOOM_FEATHER_END, p) * m;
	// 最も遠い点までの距離に、ぼけ幅と揺れ幅を足した位置まで広げる。
	const reachTo = (extent: number) => lerp(seed, extent + BLOOM_FEATHER_END * m * (1 + BLOOM_WARP), p);
	const bloom = (
		shape: "line" | "band" | "frame",
		x: number,
		y: number,
		extent: number,
		dx = 0,
		dy = 0,
	): Primitive => ({
		type: "bloom",
		shape,
		x,
		y,
		dx,
		dy,
		reach: reachTo(extent),
		feather,
		color,
		drift,
	});
	/** 点 `(x, y)` を通り向き `(dx, dy)` に垂直な直線から、画面の四隅のうち最も遠い隅まで広がる。 */
	const tide = (x: number, y: number, dx: number, dy: number) => {
		const length = Math.hypot(dx, dy);
		const [nx, ny] = [dx / length, dy / length];
		const corners = [
			[0, 0],
			[width, 0],
			[0, height],
			[width, height],
		];
		const extent = Math.max(...corners.map(([cx, cy]) => (cx - x) * nx + (cy - y) * ny));
		return bloom("line", x, y, extent, nx, ny);
	};
	switch (RESULT_FORMS[colorId].form) {
		case "openingBand":
			return [bloom("band", 0, height / 2, height / 2, 0, 1)];
		case "risingSlant":
			return [tide(width, height, -0.45, -1)];
		case "fallingTide":
			return [tide(0, 0, 0, 1)];
		case "risingTide":
			return [tide(0, height, 0, -1)];
		case "sweepingTide":
			return [displayOrder % 2 === 0 ? tide(0, 0, 1, 0) : tide(width, 0, -1, 0)];
		case "closingFrame":
			return [bloom("frame", 0, 0, m / 2)];
		case "diagonalTide":
			return [tide(0, 0, width / height, 1)];
		case "meetingTides":
			// 左右の二つが画面の中央で出会う。
			return [bloom("line", 0, 0, width / 2, 1, 0), bloom("line", width, 0, width / 2, -1, 0)];
	}
}

function resultScene(input: SceneInput): Scene {
	const { state, now, colors, reducedMotion, width, height, displayOrder } = input;
	const color = colorOf(colors, state.resultColorId);
	if (!color || !state.resultColorId) {
		return {
			primitives: [{ type: "fill", color: COLORS.dark }],
			shards: null,
			idleLayer: 0,
			resultLayer: 0,
			veil: null,
			animating: false,
		};
	}
	const complete: Scene = {
		primitives: [{ type: "fill", color: color.backgroundColor }],
		shards: null,
		idleLayer: 0,
		resultLayer: 1,
		veil: null,
		animating: false,
	};
	if (input.resultMode === "complete") return complete;

	// `judging` の `phaseEndsAt` と `result` の `phaseStartedAt` は同じ時刻。
	const startAt = state.phase === "judging" ? (state.phaseEndsAt ?? now) : state.phaseStartedAt;
	const elapsed = now - startAt;
	if (reducedMotion) {
		if (elapsed < RESULT_REDUCED_HOLD_MS) {
			return {
				primitives: [{ type: "fill", color: color.baseColor }],
				shards: null,
				idleLayer: 0,
				resultLayer: 0,
				veil: null,
				animating: true,
			};
		}
		return complete;
	}

	const { durationMs } = RESULT_FORMS[state.resultColorId];
	const settleEnd = durationMs + RESULT_SETTLE_MS;
	const photoEnd = durationMs + RESULT_PHOTO_DELAY_MS + RESULT_PHOTO_FADE_MS;
	if (elapsed >= Math.max(settleEnd, photoEnd)) return complete;

	const primitives: Primitive[] = [{ type: "fill", color: COLORS.dark }];
	if (elapsed < durationMs) {
		const drift = driftOf(now, startAt, false);
		primitives.push(
			...resultFormPrimitives(
				state.resultColorId,
				color.baseColor,
				elapsed / durationMs,
				width,
				height,
				displayOrder,
				drift,
			),
		);
	} else {
		primitives.push({ type: "fill", color: color.baseColor });
		primitives.push({
			type: "fill",
			color: color.backgroundColor,
			alpha: easeInOutSine((elapsed - durationMs) / RESULT_SETTLE_MS),
		});
	}
	return {
		primitives,
		shards: null,
		idleLayer: 0,
		resultLayer: easeInOutSine((elapsed - durationMs - RESULT_PHOTO_DELAY_MS) / RESULT_PHOTO_FADE_MS),
		veil: null,
		animating: true,
	};
}

/** 一フレームの描画内容を求める。同じ入力には同じ結果を返す。 */
export function computeScene(input: SceneInput): Scene {
	const { state, now, reducedMotion, colors } = input;

	if (state.phase === "idle" || state.phase === "intro") {
		const preview = state.phase === "idle" ? colorOf(colors, state.previewColorId) : null;
		if (preview) {
			return {
				primitives: [{ type: "fill", color: preview.backgroundColor }],
				shards: null,
				idleLayer: 0,
				resultLayer: 1,
				veil: null,
				animating: false,
			};
		}
		const sinceIdle = now - state.phaseStartedAt;
		const veiled =
			state.phase === "idle" && input.previousBackground !== null && !reducedMotion && sinceIdle < IDLE_RETURN_MS;
		return {
			primitives: [{ type: "fill", color: COLORS.idle }],
			shards: null,
			idleLayer: 1,
			resultLayer: 0,
			veil: veiled
				? { color: input.previousBackground as string, opacity: 1 - easeInOutSine(sinceIdle / IDLE_RETURN_MS) }
				: null,
			animating: !reducedMotion,
		};
	}

	if (state.phase === "question") {
		const sinceStart = now - state.phaseStartedAt;
		const appear = reducedMotion ? 1 : easeInOutSine((sinceStart - GLOW_APPEAR_DELAY_MS) / GLOW_APPEAR_MS);
		const changedAt = lastOperationAt(state);
		const turn = (now - changedAt) / GLOW_TURN_MS;
		const pulse =
			!reducedMotion && changedAt > state.phaseStartedAt && turn < 1
				? GLOW_PULSE * Math.sin(Math.PI * clamp01(turn))
				: 0;
		const steps = ringSteps(state, now, GLOW_TURN_MS, reducedMotion);
		return {
			primitives: [{ type: "fill", color: COLORS.idle }],
			shards: questionShards(input, appear, steps, 1 + pulse),
			idleLayer: reducedMotion ? 0 : 1 - easeInOutSine(sinceStart / QUESTION_PHOTO_FADE_MS),
			resultLayer: 0,
			veil: null,
			animating: !reducedMotion,
		};
	}

	// `judging`。結果開始時刻を過ぎたフレームからは結果を描く（仕様書8.7節）。
	if (state.phase === "judging" && (state.phaseEndsAt === null || now < state.phaseEndsAt)) {
		if (reducedMotion) {
			return {
				primitives: [{ type: "fill", color: COLORS.dark }],
				shards: null,
				idleLayer: 0,
				resultLayer: 0,
				veil: null,
				animating: false,
			};
		}
		const fade = easeInSine((now - state.phaseStartedAt) / JUDGING_FADE_MS);
		const primitives: Primitive[] = [
			{ type: "fill", color: COLORS.idle },
			{ type: "fill", color: COLORS.dark, alpha: fade },
		];
		const shards = fade < 1 ? questionShards(input, 1 - fade, ringSteps(state, now, GLOW_TURN_MS, false)) : null;
		return { primitives, shards, idleLayer: 0, resultLayer: 0, veil: null, animating: true };
	}

	return resultScene(input);
}

// ---- 待機写真の巡回（仕様書7.2.3節） ----

/** `floor((補正済みサーバー時刻 - idle.phaseStartedAt) / 8000)`。 */
export function idleCycleIndex(now: number, idleStartedAt: number): number {
	return Math.max(0, Math.floor((now - idleStartedAt) / IDLE_FRAME_MS));
}

/** 現在の枠のクロスフェード進み具合（0〜1）。reduced-motionでは常に1。 */
export function idleCrossfade(now: number, idleStartedAt: number, reducedMotion: boolean): number {
	if (reducedMotion) return 1;
	const intoFrame = (now - idleStartedAt) % IDLE_FRAME_MS;
	return easeInOutSine(intoFrame / IDLE_CROSSFADE_MS);
}
