// 展示ディスプレイとiPadの演出を、補正済みサーバー時刻と受信状態だけから決める（docs/visual-language.md）。
import { SETTLE_MARGIN_MS } from "./machine.ts";
import { backgroundColor, baseColor, paletteColor } from "./palette.ts";
import type { DisplayState, PaletteColor, PaletteId } from "./types.ts";

// ---- 時間（docs/visual-language.md 3章） ----

export const IDLE_FRAME_MS = 8_000;
export const IDLE_CROSSFADE_MS = 1_000;
export const QUESTION_PHOTO_FADE_MS = 1_500;
export const GLOW_APPEAR_DELAY_MS = 600;
export const GLOW_APPEAR_MS = 3_000;
export const JUDGING_FADE_MS = 1_200;
/** 判定中に灰色の破片を沈める不透明度。 */
export const JUDGING_SHARD_DIM = 0.4;
/**
 * 破片が灰色から結果の二色へ色づく時間。結果の配信から結果開始までの最短の間隔
 * （`SETTLE_MARGIN_MS`）に合わせ、結果開始の時刻に色づき終える。
 */
export const SHARD_TINT_MS = SETTLE_MARGIN_MS;
/** 結果開始から、色づいた破片が消えるまでの時間。 */
export const RESULT_SHARD_FADE_MS = 1_200;
export const RESULT_SETTLE_MS = 1_000;
export const RESULT_PHOTO_DELAY_MS = 400;
export const RESULT_PHOTO_FADE_MS = 1_200;
export const RESULT_REDUCED_HOLD_MS = 1_600;
export const IDLE_RETURN_MS = 1_000;
export const COLORS = {
	idle: "#0B0B0B",
	dark: "#000000",
	text: "#E8E6E3",
	muted: "#8A8784",
} as const;

/**
 * パレットの色ごとの広がり方と所要時間（docs/visual-language.md 3.4節）。8種類の広がり方を、
 * 色相の近い色どうしが同じにならないよう割り当てる（仮の割り当て。docs/progress.md）。
 */
export const RESULT_FORMS: Readonly<Record<PaletteId, { form: ResultForm; durationMs: number }>> = {
	vermilion: { form: "openingBand", durationMs: 1_600 },
	orange: { form: "risingSlant", durationMs: 1_800 },
	amber: { form: "meetingTides", durationMs: 1_400 },
	gold: { form: "fallingTide", durationMs: 1_600 },
	leaf: { form: "risingTide", durationMs: 2_200 },
	forest: { form: "closingFrame", durationMs: 2_000 },
	emerald: { form: "sweepingTide", durationMs: 1_600 },
	jade: { form: "diagonalTide", durationMs: 2_600 },
	sky: { form: "fallingTide", durationMs: 1_600 },
	blue: { form: "closingFrame", durationMs: 2_000 },
	indigo: { form: "risingTide", durationMs: 2_200 },
	wisteria: { form: "diagonalTide", durationMs: 2_600 },
	rose: { form: "sweepingTide", durationMs: 1_600 },
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

/** 結果色の縁のぼけ幅（画面短辺に対する割合）。広がり始めから終わりへ広げる（docs/visual-language.md 3.4節）。 */
export const BLOOM_FEATHER_START = 0.2;
export const BLOOM_FEATHER_END = 0.75;
/** ノイズによる縁の揺れ幅（ぼけ幅に対する割合）。描画側の `BLOOM_WARP` と同じ値にする。 */
export const BLOOM_WARP = 0.6;

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
 * 質問中から結果色が広がり始めるまでの三角形の破片（docs/visual-language.md 3.2〜3.4節）。配置と動きは `shardPoses` で求める。
 * 破片は灰色で描き、結果の二色が決まると、破片を交互に二色へ振り分けて色づける。
 */
export interface ShardLayer {
	/** `shardPoses` に渡す経過時間（ミリ秒）。補正済みサーバー時刻なので全画面で同じ値になる。 */
	time: number;
	/** 結果の二色の基準色。偶数番目の破片が一色目、奇数番目が二色目になる。結果が決まる前は `null`。 */
	colors: readonly [string, string] | null;
	/** 灰色から `colors` への進み具合（0〜1）。 */
	tint: number;
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
	/** 風景色パレットの色。 */
	colors: readonly PaletteColor[];
	/**
	 * 結果の見せ方。`animate` は `judging` から接続していた画面、`complete` は結果開始後に接続した画面。
	 */
	resultMode: "animate" | "complete";
	/** 直前に表示していた結果の背景色。`idle` へ戻るときの覆いに使う。 */
	previousBackground: string | null;
}

/**
 * この画面が結果で見せる色。二色を画面の順に交互に割り当てる（画面 k は `colors[k % 2]`）。
 * 結果がなければ `null`。
 */
export function screenColorId(
	result: Pick<NonNullable<DisplayState["result"]>, "colors"> | null,
	displayOrder: number,
): PaletteId | null {
	return result ? result.colors[displayOrder % 2] : null;
}

/** 状態の開始時刻からの経過秒。reduced-motionではノイズを流さない。 */
const driftOf = (now: number, since: number, reducedMotion: boolean) =>
	reducedMotion ? 0 : Math.max(0, now - since) / 1000;

/** 結果の二色の基準色。どちらかがパレットになければ `null`。 */
function resultShardColors(input: SceneInput): readonly [string, string] | null {
	const result = input.state.result;
	if (!result) return null;
	const [first, second] = result.colors.map((id) => paletteColor(input.colors, id));
	return first && second ? [baseColor(first), baseColor(second)] : null;
}

/** 破片の層。reduced-motionでは時刻を進めず、初期配置のまま止める。 */
function shardLayer(
	input: SceneInput,
	intensity: number,
	options: { colors?: readonly [string, string] | null; tint?: number } = {},
): ShardLayer {
	const colors = options.colors ?? null;
	return {
		time: input.reducedMotion ? 0 : input.now,
		colors,
		tint: colors ? clamp01(options.tint ?? 1) : 0,
		intensity: clamp01(intensity),
	};
}

/**
 * 判定中の破片。灰色のまま沈め、結果の二色が決まると結果開始までに二色へ色づける（docs/visual-language.md 3.3節）。
 * 色づき始める時刻は `phaseEndsAt - SHARD_TINT_MS` とする。結果の配信時刻は全画面で共有できないが、
 * サーバーは通常、配信から `SETTLE_MARGIN_MS` 以上あとを結果開始にするため、この時刻には全画面に結果が届いている。
 * `judging` の期限の直前に結果が決まると間隔が短くなり、色づきは届いた時点の進み具合から始まる。
 */
function judgingShards(input: SceneInput): ShardLayer {
	const { state, now, reducedMotion } = input;
	const colors = resultShardColors(input);
	// 暗転を終えてから色づける。`judgingMaxMs` が `JUDGING_MS` より短い設定でも暗転と重ねない。
	const tintAt =
		state.phaseEndsAt === null
			? null
			: Math.max(state.phaseStartedAt + JUDGING_FADE_MS, state.phaseEndsAt - SHARD_TINT_MS);
	const tintProgress = colors && tintAt !== null ? (now - tintAt) / SHARD_TINT_MS : 0;
	if (reducedMotion) {
		const tinted = tintProgress >= 0 && colors !== null;
		return shardLayer(input, tinted ? 1 : JUDGING_SHARD_DIM, { colors: tinted ? colors : null });
	}
	const tint = easeInOutSine(tintProgress);
	const dim = lerp(1, JUDGING_SHARD_DIM, easeInSine((now - state.phaseStartedAt) / JUDGING_FADE_MS));
	return shardLayer(input, lerp(dim, 1, tint), { colors, tint });
}

/**
 * 結果色の広がりの一フレーム（docs/visual-language.md 3.4節）。`progress` は0〜1。
 * `progress` が1のとき、縁がノイズで揺れても画面全体を塗りつぶす。
 */
export function resultFormPrimitives(
	colorId: PaletteId,
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
	const colorId = screenColorId(state.result, displayOrder);
	const color = paletteColor(colors, colorId);
	if (!color || !colorId) {
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
		primitives: [{ type: "fill", color: backgroundColor(color) }],
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
				primitives: [{ type: "fill", color: baseColor(color) }],
				shards: null,
				idleLayer: 0,
				resultLayer: 0,
				veil: null,
				animating: true,
			};
		}
		return complete;
	}

	const { durationMs } = RESULT_FORMS[colorId];
	const settleEnd = durationMs + RESULT_SETTLE_MS;
	const photoEnd = durationMs + RESULT_PHOTO_DELAY_MS + RESULT_PHOTO_FADE_MS;
	if (elapsed >= Math.max(settleEnd, photoEnd)) return complete;

	const primitives: Primitive[] = [{ type: "fill", color: COLORS.dark }];
	if (elapsed < durationMs) {
		const drift = driftOf(now, startAt, false);
		primitives.push(
			...resultFormPrimitives(
				colorId,
				baseColor(color),
				elapsed / durationMs,
				width,
				height,
				displayOrder,
				drift,
			),
		);
	} else {
		primitives.push({ type: "fill", color: baseColor(color) });
		primitives.push({
			type: "fill",
			color: backgroundColor(color),
			alpha: easeInOutSine((elapsed - durationMs) / RESULT_SETTLE_MS),
		});
	}
	// 色づいた破片は、結果色が広がる間に消える。
	const shardFade = elapsed / RESULT_SHARD_FADE_MS;
	const shardColors = resultShardColors(input);
	return {
		primitives,
		shards:
			shardFade < 1 && shardColors ? shardLayer(input, 1 - easeInSine(shardFade), { colors: shardColors }) : null,
		idleLayer: 0,
		resultLayer: easeInOutSine((elapsed - durationMs - RESULT_PHOTO_DELAY_MS) / RESULT_PHOTO_FADE_MS),
		veil: null,
		animating: true,
	};
}

/** 一フレームの描画内容を求める。同じ入力には同じ結果を返す。 */
export function computeScene(input: SceneInput): Scene {
	const { state, now, reducedMotion, colors } = input;

	// `sequence` の演出はシーケンスのコンポーネントが上に重ねて描く。下には待機写真の巡回を続ける。
	if (state.phase === "idle" || state.phase === "sequence" || state.phase === "intro") {
		const preview = state.phase === "idle" ? paletteColor(colors, state.previewColorId) : null;
		if (preview) {
			return {
				primitives: [{ type: "fill", color: backgroundColor(preview) }],
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
		// 回答の確定や「戻る」には反応しない。輪は常時の動き（4.4節）だけで動く。
		return {
			primitives: [{ type: "fill", color: COLORS.idle }],
			shards: shardLayer(input, appear),
			idleLayer: reducedMotion ? 0 : 1 - easeInOutSine(sinceStart / QUESTION_PHOTO_FADE_MS),
			resultLayer: 0,
			veil: null,
			animating: !reducedMotion,
		};
	}

	// `judging`。結果開始時刻を過ぎたフレームからは結果を描く（仕様書7.2.4節）。
	if (state.phase === "judging" && (state.phaseEndsAt === null || now < state.phaseEndsAt)) {
		if (reducedMotion) {
			return {
				primitives: [{ type: "fill", color: COLORS.dark }],
				shards: judgingShards(input),
				idleLayer: 0,
				resultLayer: 0,
				veil: null,
				// 色づく時刻に一度だけ構図が切り替わる。
				animating: true,
			};
		}
		const fade = easeInSine((now - state.phaseStartedAt) / JUDGING_FADE_MS);
		const primitives: Primitive[] = [
			{ type: "fill", color: COLORS.idle },
			{ type: "fill", color: COLORS.dark, alpha: fade },
		];
		return { primitives, shards: judgingShards(input), idleLayer: 0, resultLayer: 0, veil: null, animating: true };
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
