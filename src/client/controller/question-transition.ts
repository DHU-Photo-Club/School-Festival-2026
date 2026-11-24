// iPadの質問が切り替わるときの入れ替え（docs/visual-language.md 4.5節）。
import type { TransitionConfig } from "svelte/transition";
import { easeInSine, easeOutCubic } from "../../shared/motion.ts";
import type { Question } from "../../shared/types.ts";

/** 前の質問が消える時間。 */
export const QUESTION_LEAVE_MS = 240;
/** 次の質問が現れる時間。前の質問が消えてから始める。 */
export const QUESTION_ENTER_MS = 480;
/** 入れ替え全体の時間。 */
export const QUESTION_TRANSITION_MS = QUESTION_LEAVE_MS + QUESTION_ENTER_MS;
/** 横へずらす距離（px）。 */
export const QUESTION_SHIFT_PX = 32;

/** 入れ替えで動かす部分。`body` は質問全体、`heading` は質問文と案内文。 */
export type QuestionPart = "body" | "heading";

export interface QuestionTransitionParams {
	/** `1` は次の質問へ進むとき、`-1` は前の質問へ戻るとき。 */
	direction: 1 | -1;
	/** 横へずらすなら `true`。 */
	move: boolean;
	/** 透明度を変えるなら `true`。 */
	fade: boolean;
	reducedMotion: boolean;
}

/**
 * 質問の切り替えの向き。質問から別の質問へ移るときだけ値を返し、それ以外（質問の外から入る、
 * 質問の外へ出る、同じ質問のまま）は `null` を返す。
 */
export function questionDirectionOf(previousIndex: number | null, nextIndex: number | null): 1 | -1 | null {
	if (previousIndex === null || nextIndex === null || previousIndex === nextIndex) return null;
	return nextIndex < previousIndex ? -1 : 1;
}

/**
 * 入れ替えの設定。スライダーの操作面は `.screen` を基準に画面全体へ広がり、質問全体をずらすと
 * ずらした要素が操作面の基準になって質問の区画へ縮むため、スライダーでは質問全体の透明度だけを変え、
 * 質問文と案内文だけをずらす。
 */
export function questionMotion(
	part: QuestionPart,
	kind: Question["kind"],
	direction: 1 | -1,
	reducedMotion: boolean,
): QuestionTransitionParams {
	const slider = kind === "slider";
	return { direction, move: part === "body" ? !slider : slider, fade: part === "body", reducedMotion };
}

function style(offset: number, opacity: number, params: QuestionTransitionParams): string {
	const parts: string[] = [];
	if (params.move) parts.push(`translate: ${offset.toFixed(2)}px 0;`);
	if (params.fade) parts.push(`opacity: ${opacity.toFixed(3)};`);
	return parts.join(" ");
}

/** 動かす値がなければ、空のアニメーションを作らずに済ませる。 */
const still = (params: QuestionTransitionParams) => params.reducedMotion || (!params.move && !params.fade);

/**
 * 次の質問の入り方。進むときは右から、戻るときは左から、`QUESTION_SHIFT_PX` 離れた位置から現れる。
 * 前の質問が消えるまで待ち、二つの質問が重なって見えないようにする。待つ間は透明なだけでなく
 * `visibility: hidden` にし、見えない入力に触れて回答が変わらないようにする（スライダーの操作面は画面全体に広がる）。
 */
export function questionEnter(_node: Element, params: QuestionTransitionParams): TransitionConfig {
	if (still(params)) return { duration: 0 };
	return {
		delay: QUESTION_LEAVE_MS,
		duration: QUESTION_ENTER_MS,
		easing: easeOutCubic,
		css: (t, u) => {
			const css = style(params.direction * QUESTION_SHIFT_PX * u, t, params);
			return params.fade && t === 0 ? `${css} visibility: hidden;` : css;
		},
	};
}

/** 前の質問の去り方。進むときは左へ、戻るときは右へずれながら消える。 */
export function questionLeave(_node: Element, params: QuestionTransitionParams): TransitionConfig {
	if (still(params)) return { duration: 0 };
	return {
		duration: QUESTION_LEAVE_MS,
		easing: easeInSine,
		css: (t, u) => style(-params.direction * QUESTION_SHIFT_PX * u, t, params),
	};
}
