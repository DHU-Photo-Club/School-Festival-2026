// 展示ディスプレイとiPadの演出を、補正済みサーバー時刻と受信状態だけから決める（docs/visual-language.md）。
import { INTRO_EXPLANATION_AT_MS, INTRO_INVITATION_AT_MS, INTRO_NICKNAME_AT_MS } from "../data/sound.ts";
import { SETTLE_MARGIN_MS } from "./machine.ts";
import { backgroundColor, baseColor, paletteColor } from "./palette.ts";
import { RIPPLE_MS } from "./ripple.ts";
import type { DisplayState, PaletteColor, PaletteId } from "./types.ts";

// ---- 時間（docs/visual-language.md 3章） ----

/** `/photo` の写真表示が写真を切り替える間隔。展示ディスプレイは写真を置かない。 */
export const IDLE_FRAME_MS = 8_000;
export const JUDGING_FADE_MS = 1_200;
/** 待機中の輪の半径（質問中の輪に対する倍率）。破片の大きさは変えない。 */
export const SHARD_IDLE_SCALE = 0.3;
/** 待機中に見せる破片の割合（質問中の全枚数に対する比）。 */
export const SHARD_IDLE_DENSITY = 0.3;
/** 輪が大きさや枚数を変える時間（待機へ縮む、`intro` の輪へ広がる、`intro` から質問中の輪へ戻る）。 */
export const SHARD_SCALE_MS = 3_000;
/** `intro` の破片の散らばり（`shardPoses` の `spread`）。輪の内側を空けたまま、画面いっぱいに散らばる。 */
export const SHARD_OPENING_SPREAD = 1;
/** `intro` の破片の大きさ（質問中の破片に対する倍率）。 */
export const SHARD_OPENING_SIZE = 2;
/** 質問の回答を受け付けた瞬間に、輪の半径を縮める割合（縮み切ったときの輪の半径は `1 - この値` 倍）。 */
export const ANSWER_PULSE_DEPTH = 0.1;
/** 輪が縮み切るまでの時間。動き出しと縮み切りは `easeInOutSine` でなめらかにする。 */
export const ANSWER_PULSE_IN_MS = 450;
/** 縮んだ輪が元の大きさへ戻る時間。縮む時間と合わせて2.2秒になる。 */
export const ANSWER_PULSE_OUT_MS = 1_750;
/**
 * 戻る動きの前寄りの度合い。大きいほど、戻り始めの勢いが強く、早めに最高速に達して、長く減速しながら元の大きさへ着く。
 * 1なら前寄りにならない。
 */
export const ANSWER_PULSE_RELEASE_BIAS = 2.5;
/** `intro` で歓迎の文字がゆっくり現れる時間。 */
export const WELCOME_FADE_MS = 3_000;
/** `intro` を終えて歓迎の文字が消える時間。歓迎の文字から説明の文へ入れ替えるときに歓迎の文字が消える時間にも使う。 */
export const WELCOME_FADE_OUT_MS = 1_500;
/** 歓迎の文字が現れ終えてから、説明の文へ入れ替えるために消え始めるまで、そのまま見せる時間。 */
export const WELCOME_HOLD_MS = INTRO_EXPLANATION_AT_MS - WELCOME_FADE_MS;
/** 歓迎の文字が消え始める時刻（現れ始めからの経過時間）。 */
export const WELCOME_LEAVE_AT_MS = WELCOME_FADE_MS + WELCOME_HOLD_MS;
/** 01の読み上げが終わり、歓迎の文字から説明の文へ切り替え始める時刻（現れ始めからの経過時間）。 */
export const INTRO_DESCRIPTION_AT_MS = INTRO_EXPLANATION_AT_MS;
/** 01〜03の文字がクロスフェードする時間。 */
export const INTRO_DESCRIPTION_FADE_MS = 600;
/** iPadの `intro` で、説明の文を現れ終えたあとに、進捗バーとニックネームの入力欄が現れる時間。 */
export const NICKNAME_FADE_IN_MS = 800;
/** 判定中に灰色の破片を沈める不透明度。 */
export const JUDGING_SHARD_DIM = 0.4;
/**
 * 破片が灰色から結果の二色へ色づく時間。結果の配信から結果開始までの最短の間隔
 * （`SETTLE_MARGIN_MS`）に合わせ、結果開始の時刻に色づき終える。
 */
export const SHARD_TINT_MS = SETTLE_MARGIN_MS;
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
	/** 破片を並び順で順に振り分ける基準色。結果の二色なら偶数番目が一色目、奇数番目が二色目。灰色のときは `null`。 */
	colors: readonly string[] | null;
	/** 灰色から `colors` への進み具合（0〜1）。 */
	tint: number;
	/** 不透明度（0〜1）。 */
	intensity: number;
	/** 輪の半径の倍率。1が質問中の大きさで、待機中は `SHARD_IDLE_SCALE`。 */
	scale: number;
	/** 見せる破片の割合。1が全枚数で、待機中は `SHARD_IDLE_DENSITY`。 */
	density: number;
	/** 破片の大きさの倍率。1が質問中の大きさ。 */
	size: number;
	/** 輪の太さの広がり。0が輪、1が画面いっぱいの散らばり。 */
	spread: number;
}

/** 質問の回答のあと、輪が戻り始める瞬間から広がる波紋（`rippleRings` に渡す経過時間）。 */
export interface RippleLayer {
	/** 輪が戻り始めた時刻からの経過時間（ミリ秒）。補正済みサーバー時刻なので全画面で同じ値になる。 */
	elapsed: number;
}

/** 判定中に画面の外から中心へ集まる塵（`dustPoses` に渡す値）。 */
export interface DustLayer {
	/** `judging` の開始からの経過時間（ミリ秒）。補正済みサーバー時刻なので全画面で同じ値になる。 */
	elapsed: number;
	/** 全体の不透明度の倍率（0〜1）。結果の色づきに合わせて消えていく。 */
	fade: number;
}

export interface Scene {
	primitives: Primitive[];
	/** WebGLの描画の上に重ねる破片。展示ディスプレイは写真を置かず、どの状態でも破片を描く。 */
	shards: ShardLayer;
	/** 回答の直後に中心から広がる波紋。広がっていなければ `null`。 */
	ripple: RippleLayer | null;
	/** 判定中に外から中心へ集まる塵。出していなければ `null`。 */
	dust: DustLayer | null;
	/** 結果の色名の層の不透明度。 */
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
	/** `intro` の直前に再生するシーケンス。なければ `null`。 */
	lead?: WelcomeLead | null;
	/** 今の質問へ `intro` から入ったか。`intro` の大きな輪から質問中の輪へ戻す。 */
	questionFromIntro?: boolean;
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

/**
 * 質問の回答を受け付けた瞬間の、輪の半径の倍率。`answeredAt` から一瞬（`ANSWER_PULSE_IN_MS`、`easeInOutSine`）で縮み、
 * 押された勢いで戻り、早めに最高速に達して、減速しながら元の大きさへ着く（`ANSWER_PULSE_OUT_MS`）。縮み切った点は速度0で途切れずにつなぐ。弾性はなく、元の大きさを超えない。`question` と、最終問の回答で入った `judging` だけで、reduced-motionでは縮めない。
 * 回答の時刻はサーバーが決めた `answeredAt` なので、全画面が同じ倍率にする。
 */
export function answerPulseScale(
	state: Pick<DisplayState, "phase" | "answeredAt">,
	now: number,
	reducedMotion: boolean,
): number {
	if (reducedMotion || state.answeredAt == null) return 1;
	if (state.phase !== "question" && state.phase !== "judging") return 1;
	const elapsed = now - state.answeredAt;
	if (elapsed <= 0 || elapsed >= ANSWER_PULSE_IN_MS + ANSWER_PULSE_OUT_MS) return 1;
	if (elapsed < ANSWER_PULSE_IN_MS) {
		return 1 - ANSWER_PULSE_DEPTH * easeInOutSine(elapsed / ANSWER_PULSE_IN_MS);
	}
	// 縮み切った点は速度0で、縮む動きから途切れずにつなぐ。戻る動きは速度0から勢いよく立ち上がり、早めに最高速に達して
	// （時間を前へ寄せる）、減速しながら元の大きさへ着く。元の大きさを超えない。
	const returned = easeInOutSine(
		1 - (1 - clamp01((elapsed - ANSWER_PULSE_IN_MS) / ANSWER_PULSE_OUT_MS)) ** ANSWER_PULSE_RELEASE_BIAS,
	);
	const pulse = 1 - returned;
	return 1 - ANSWER_PULSE_DEPTH * pulse;
}

/** 破片の層。reduced-motionでは時刻を進めず、初期配置のまま止める。 */
function shardLayer(
	input: SceneInput,
	intensity: number,
	options: {
		colors?: readonly string[] | null;
		tint?: number;
		scale?: number;
		density?: number;
		size?: number;
		spread?: number;
	} = {},
): ShardLayer {
	const colors = options.colors ?? null;
	return {
		time: input.reducedMotion ? 0 : input.now,
		colors,
		tint: colors ? clamp01(options.tint ?? 1) : 0,
		intensity: clamp01(intensity),
		scale: (options.scale ?? 1) * answerPulseScale(input.state, input.now, input.reducedMotion),
		density: options.density ?? 1,
		size: options.size ?? 1,
		spread: options.spread ?? 0,
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

function resultScene(input: SceneInput): BaseScene {
	const { state, now, colors, reducedMotion, width, height, displayOrder } = input;
	const colorId = screenColorId(state.result, displayOrder);
	const color = paletteColor(colors, colorId);
	if (!color || !colorId) {
		return {
			primitives: [{ type: "fill", color: COLORS.dark }],
			shards: shardLayer(input, 1),
			resultLayer: 0,
			veil: null,
			animating: !reducedMotion,
		};
	}
	// 結果が出た後も破片は残り、結果の二色で動き続ける。
	const shards = shardLayer(input, 1, { colors: resultShardColors(input) });
	const complete: BaseScene = {
		primitives: [{ type: "fill", color: backgroundColor(color) }],
		shards,
		resultLayer: 1,
		veil: null,
		animating: !reducedMotion,
	};
	if (input.resultMode === "complete") return complete;

	// `judging` の `phaseEndsAt` と `result` の `phaseStartedAt` は同じ時刻。
	const startAt = state.phase === "judging" ? (state.phaseEndsAt ?? now) : state.phaseStartedAt;
	const elapsed = now - startAt;
	if (reducedMotion) {
		if (elapsed < RESULT_REDUCED_HOLD_MS) {
			return {
				primitives: [{ type: "fill", color: baseColor(color) }],
				shards,
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
	return {
		primitives,
		shards,
		resultLayer: easeInOutSine((elapsed - durationMs - RESULT_PHOTO_DELAY_MS) / RESULT_PHOTO_FADE_MS),
		veil: null,
		animating: true,
	};
}

/** `intro` の直前に再生するシーケンス。歓迎の文字はこのシーケンスの開始から現れ始める。 */
export interface WelcomeLead {
	id: string;
	durationMs: number;
}

/**
 * 歓迎の文字の不透明度。`intro` と、その直前に再生するシーケンス `lead` の間だけ見せる。現れ始めるのは
 * シーケンスの開始（シーケンスがなければ `intro` の開始）で、`intro` に入っても途切れずにゆっくり現れ続ける。
 * 01の終了で説明の文へクロスフェードする（`INTRO_DESCRIPTION_FADE_MS`）。
 * `intro` の経過時間にシーケンスの定義上の長さを足すので、`intro` の途中から接続した画面も同じ不透明度になる。
 * 見せない段階では0で、`intro` を終えて文字が消えるときの変化（`WELCOME_FADE_OUT_MS`）は描画側のトランジションで付ける。
 */
export function welcomeOpacity(
	state: Pick<DisplayState, "phase" | "phaseStartedAt" | "sequenceId">,
	now: number,
	reducedMotion: boolean,
	lead: WelcomeLead | null = null,
): number {
	const inLead = state.phase === "sequence" && lead !== null && state.sequenceId === lead.id;
	if (state.phase !== "intro" && !inLead) return 0;
	const elapsed = openingElapsed(state, now, lead);
	if (reducedMotion) return elapsed < WELCOME_LEAVE_AT_MS ? 1 : 0;
	return (
		easeInOutSine(elapsed / WELCOME_FADE_MS) *
		(1 - easeInOutSine((elapsed - WELCOME_LEAVE_AT_MS) / INTRO_DESCRIPTION_FADE_MS))
	);
}

/**
 * `intro` の説明の文の不透明度。01の音源終了時刻から（`INTRO_DESCRIPTION_AT_MS`）、`intro` の間だけ
 * ゆっくり現れ、ナレーション02が終わるまで見せる。時刻の数え方は `welcomeOpacity` と同じ。
 * `intro` を終えて文字が消えるときの変化（`WELCOME_FADE_OUT_MS`）は描画側のトランジションで付ける。
 */
export function introDescriptionOpacity(
	state: Pick<DisplayState, "phase" | "phaseStartedAt" | "sequenceId">,
	now: number,
	reducedMotion: boolean,
	lead: WelcomeLead | null = null,
): number {
	if (state.phase !== "intro") return 0;
	const elapsed = openingElapsed(state, now, lead);
	if (reducedMotion) return elapsed >= INTRO_DESCRIPTION_AT_MS && elapsed < INTRO_INVITATION_AT_MS ? 1 : 0;
	return easeInOutSine((elapsed - INTRO_DESCRIPTION_AT_MS) / INTRO_DESCRIPTION_FADE_MS) *
		(1 - easeInOutSine((elapsed - INTRO_INVITATION_AT_MS) / INTRO_DESCRIPTION_FADE_MS));
}

/** 02の終了で表示し、03の間は白い輪の中央に見せる案内文。 */
export function introInvitationOpacity(
	state: Pick<DisplayState, "phase" | "phaseStartedAt" | "sequenceId">,
	now: number,
	reducedMotion: boolean,
	lead: WelcomeLead | null = null,
): number {
	if (state.phase !== "intro") return 0;
	const elapsed = openingElapsed(state, now, lead) - INTRO_INVITATION_AT_MS;
	if (elapsed < 0) return 0;
	const leave = openingElapsed(state, now, lead) - INTRO_NICKNAME_AT_MS;
	if (reducedMotion) return leave < 0 ? 1 : 0;
	return easeInOutSine(elapsed / INTRO_DESCRIPTION_FADE_MS) *
		(1 - easeInOutSine(leave / INTRO_DESCRIPTION_FADE_MS));
}

/** 04の読み上げ開始から、展示のニックネーム入力案内を見せる。 */
export function introNicknameOpacity(
	state: Pick<DisplayState, "phase" | "phaseStartedAt" | "sequenceId">,
	now: number,
	reducedMotion: boolean,
	lead: WelcomeLead | null = null,
): number {
	if (state.phase !== "intro") return 0;
	const elapsed = openingElapsed(state, now, lead) - INTRO_NICKNAME_AT_MS;
	if (elapsed < 0) return 0;
	return reducedMotion ? 1 : easeInOutSine(elapsed / INTRO_DESCRIPTION_FADE_MS);
}

/**
 * 導入ナレーション04が始まるまでの残り時間（ミリ秒）。0以下なら案内を始めている。iPadは、これが0以下に
 * なるまでニックネームの入力欄を出さない。時刻の数え方は `welcomeOpacity` と同じ。
 * reduced-motionでも音声を省略しないため、同じ長さを待つ。
 */
export function introDescriptionRemainingMs(
	state: Pick<DisplayState, "phaseStartedAt">,
	now: number,
	reducedMotion: boolean,
	lead: WelcomeLead | null = null,
): number {
	const doneAt = INTRO_NICKNAME_AT_MS;
	return doneAt - openingElapsed({ ...state, phase: "intro" }, now, lead);
}

/**
 * `intro` の直前のシーケンス `lead` の開始からの経過時間（ミリ秒）。`intro` では、その開始からの経過時間に
 * シーケンスの定義上の長さを足す。`intro` の途中から接続した画面もほかの画面と同じ値になる。
 */
function openingElapsed(
	state: Pick<DisplayState, "phase" | "phaseStartedAt">,
	now: number,
	lead: WelcomeLead | null,
): number {
	return now - state.phaseStartedAt + (state.phase === "intro" ? (lead?.durationMs ?? 0) : 0);
}

/**
 * `intro` の直前のシーケンスと `intro` の破片。待機の小さな灰色の輪から、パレットの全色で色づきながら、
 * 輪の内側を空けたまま画面いっぱいに散らばり、破片も大きく、枚数も全枚数へ増える。散らばり終えた破片は
 * `intro` の間そのまま動き続ける。
 */
function openingShards(input: SceneInput): ShardLayer {
	const { state, now, reducedMotion } = input;
	const elapsed = openingElapsed(state, now, input.lead ?? null);
	const p = reducedMotion ? 1 : easeInOutSine(elapsed / SHARD_SCALE_MS);
	const returnToRing = elapsed < INTRO_INVITATION_AT_MS ? 0
		: reducedMotion ? 1 : easeInOutSine((elapsed - INTRO_INVITATION_AT_MS) / SHARD_SCALE_MS);
	return shardLayer(input, 1, {
		colors: input.colors.map(baseColor),
		tint: p * (1 - returnToRing),
		scale: lerp(SHARD_IDLE_SCALE, 1, p),
		density: lerp(SHARD_IDLE_DENSITY, 1, p),
		size: lerp(1, SHARD_OPENING_SIZE, p * (1 - returnToRing)),
		spread: lerp(0, SHARD_OPENING_SPREAD, p * (1 - returnToRing)),
	});
}

/** 追加の案内場面で白い輪へ戻っているため、質問でも同じ輪を保つ。 */
function questionShards(input: SceneInput): ShardLayer {
	return shardLayer(input, 1);
}

/** 波紋以外の描画内容。 */
type BaseScene = Omit<Scene, "ripple" | "dust">;

/**
 * 質問の回答の波紋。輪が縮み切って戻り始める瞬間（回答を受け付けた時刻 `answeredAt` から `ANSWER_PULSE_IN_MS` 後）に
 * 中心から広がり始める。`question` と `judging`（最終問の回答）だけで広がり、reduced-motionでは広げない。
 * 時刻はサーバーが決めた `answeredAt` から求めるので、全画面が同じ経過時間で描く。
 */
function rippleLayer(input: SceneInput): RippleLayer | null {
	const { state, now, reducedMotion } = input;
	if (reducedMotion || state.answeredAt == null) return null;
	if (state.phase !== "question" && state.phase !== "judging") return null;
	const elapsed = now - (state.answeredAt + ANSWER_PULSE_IN_MS);
	// 輪が戻り始めるまでは出さない。
	return elapsed >= 0 && elapsed < RIPPLE_MS ? { elapsed } : null;
}

/**
 * 判定中の塵。結果の二色が決まる前から、画面の外から中心へ集まり、少しずつ数と濃さを増す。結果の色づきが始まる
 * 時刻（`phaseEndsAt - SHARD_TINT_MS`）からは、色づきに合わせて消える。reduced-motionでは出さない。
 * 結果の開始時刻を過ぎたフレームでは出さない。
 */
function dustLayer(input: SceneInput): DustLayer | null {
	const { state, now, reducedMotion } = input;
	if (reducedMotion || state.phase !== "judging") return null;
	if (state.phaseEndsAt !== null && now >= state.phaseEndsAt) return null;
	const elapsed = now - state.phaseStartedAt;
	if (elapsed <= 0) return null;
	const fade =
		state.phaseEndsAt === null ? 1 : 1 - easeInOutSine((now - (state.phaseEndsAt - SHARD_TINT_MS)) / SHARD_TINT_MS);
	return { elapsed, fade };
}

/** 一フレームの描画内容を求める。同じ入力には同じ結果を返す。 */
export function computeScene(input: SceneInput): Scene {
	const ripple = rippleLayer(input);
	const dust = dustLayer(input);
	const scene = computeBaseScene(input);
	return { ...scene, ripple, dust, animating: scene.animating || ripple !== null || dust !== null };
}

function computeBaseScene(input: SceneInput): BaseScene {
	const { state, now, reducedMotion, colors } = input;

	// `sequence` の演出はシーケンスのコンポーネントが上に重ねて描く。下には待機写真の巡回を続ける。
	if (state.phase === "idle" || state.phase === "sequence" || state.phase === "intro") {
		const preview = state.phase === "idle" ? paletteColor(colors, state.previewColorId) : null;
		if (preview) {
			return {
				primitives: [{ type: "fill", color: backgroundColor(preview) }],
				shards: shardLayer(input, 1, { colors: [baseColor(preview), baseColor(preview)] }),
				resultLayer: 1,
				veil: null,
				animating: !reducedMotion,
			};
		}
		// `intro` と、その直前のシーケンスは、色づいて大きく広がる輪を描く。
		const opening =
			state.phase === "intro" ||
			(state.phase === "sequence" && input.lead != null && state.sequenceId === input.lead.id);
		if (opening) {
			return {
				primitives: [{ type: "fill", color: COLORS.idle }],
				shards: openingShards(input),
				resultLayer: 0,
				veil: null,
				animating: !reducedMotion,
			};
		}
		const sinceIdle = now - state.phaseStartedAt;
		const veiled =
			state.phase === "idle" && input.previousBackground !== null && !reducedMotion && sinceIdle < IDLE_RETURN_MS;
		// 結果や質問から待機へ戻った直後は、質問中の大きさから待機の小さな輪へ縮む。
		const shrink = state.phase === "idle" && !reducedMotion ? easeInOutSine(sinceIdle / SHARD_SCALE_MS) : 1;
		return {
			primitives: [{ type: "fill", color: COLORS.idle }],
			shards: shardLayer(input, 1, {
				scale: lerp(1, SHARD_IDLE_SCALE, shrink),
				density: lerp(1, SHARD_IDLE_DENSITY, shrink),
			}),
			resultLayer: 0,
			veil: veiled
				? { color: input.previousBackground as string, opacity: 1 - easeInOutSine(sinceIdle / IDLE_RETURN_MS) }
				: null,
			animating: !reducedMotion,
		};
	}

	if (state.phase === "question") {
		// 回答の確定や「戻る」には反応しない。輪は常時の動き（4.4節）だけで動く。
		return {
			primitives: [{ type: "fill", color: COLORS.idle }],
			shards: questionShards(input),
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
		return { primitives, shards: judgingShards(input), resultLayer: 0, veil: null, animating: true };
	}

	return resultScene(input);
}
