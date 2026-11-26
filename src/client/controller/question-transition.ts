// iPadの質問が切り替わるときの入れ替え（docs/visual-language.md 4.5節）。
// 前の質問がすべて落ちきってから、次の質問が降り始める。質問文、案内文、選択肢などの要素ごとに少しずつ遅れて、
// 前の質問は画面の奥へ縮んでぼけながら落ちて消え、次の質問は画面の手前から拡大されてぼけた状態で降りてきて
// 画面に貼り付く。
// どちらの動きもCSSアニメーションで描く（Controller.svelte）。`scale` と `filter` を掛けた要素は
// 中の絶対配置の要素の基準になり、画面全体に広がるスライダーの操作面が縮むため、質問全体には掛けず、
// `DESCEND_TARGETS` の要素へ個別に掛ける。操作面そのものにも、拡大すると画面からはみ出して縦に
// スクロールしてしまうため掛けず、中の語、仕切り線、つまみへ掛ける（はみ出しは操作面が切り落とす）。
import type { TransitionConfig } from "svelte/transition";

/** 次の質問の一つの要素が手前から降りてきて貼り付くまでの時間。 */
export const QUESTION_ENTER_MS = 1300;
/**
 * 次の質問の一つの要素が透明から不透明になるまでの時間。降りてくる動きが終わる前に不透明になるよう、`QUESTION_ENTER_MS` より
 * 短くする。
 */
export const QUESTION_ENTER_FADE_MS = 900;
/** 前の質問の一つの要素が奥へ落ちていくまでの時間。 */
export const QUESTION_LEAVE_MS = 1300;
/**
 * 前の質問の一つの要素が不透明から透明になるまでの時間。奥へ落ちる動きと同じ長さ・同じ曲線（イーズイン）にし、落ちる動きを
 * 最後まで見せながら、加速して遠ざかるにつれて透明になるようにする。短くすると、イーズインのためまだ大きく動いていない
 * うちに透明になり、落ちる動きが見えなくなる。
 */
export const QUESTION_LEAVE_FADE_MS = QUESTION_LEAVE_MS;
/** ある要素が動き始めてから、次の番の要素が動き始めるまでの遅れ。降りてくる要素と落ちていく要素で同じ値を使う。 */
export const QUESTION_STAGGER_MS = 60;
/**
 * 遅らせる順番の上限。選択肢が多い質問でも待ち時間が延びすぎないよう、これより後の要素は
 * 順番が上限の要素と同時に動き始める。
 */
export const QUESTION_STAGGER_MAX = 6;
/** 前の質問の最後の要素が落ち終わるまでの時間。前の質問はこの間DOMに残る。 */
export const QUESTION_LEAVE_TOTAL_MS = QUESTION_STAGGER_MAX * QUESTION_STAGGER_MS + QUESTION_LEAVE_MS;
/**
 * 前の質問が落ち始めてから、次の質問が降り始めるまでの時間。前の質問の要素がすべて落ちきって透明になってから、
 * 次の質問を降ろす。
 */
export const QUESTION_ENTER_DELAY_MS = QUESTION_LEAVE_TOTAL_MS;
/** 次の質問の最後の要素が降り終わるまでの時間。 */
export const QUESTION_ENTER_TOTAL_MS =
	QUESTION_ENTER_DELAY_MS + QUESTION_STAGGER_MAX * QUESTION_STAGGER_MS + QUESTION_ENTER_MS;
/** 入れ替え全体の時間。前後の質問の最後の要素が動き終わるまで（今は前の質問が落ちきってから降りる次の質問のほうが長くかかるが、どちらが長くなっても長いほうに合わせる）。 */
export const QUESTION_TRANSITION_MS = Math.max(QUESTION_ENTER_TOTAL_MS, QUESTION_LEAVE_TOTAL_MS);
/**
 * 入れ替えの時間に足す余裕。解除はタイマー、動きは描画のフレームで進むため、描画が遅れて一フレームが
 * 長くなった端末（30fpsなら33ms）でも、最後の要素が動き終わる前に解除しないよう、数フレーム分を足す。
 * 保証ではなく安全側の余裕で、さらに遅れて動きの途中で解除されても、次の質問の各要素は最後の見た目（等倍、ぼけなし、
 * 不透明）へ移るだけで崩れない。前の質問の動きは解除と関係なく `data-leaving` を条件に掛かり続けるため、透明のままDOMから消える。
 * また、この余裕は数フレーム分の遅れを見込んだもので、切り替えの直後に重い処理が入って動きの開始がそれ以上遅れた場合は、
 * 最後の要素が降り終わる前に解除されることがある（わずかな超過なら、イーズアウトで残りの動きはごく小さい）。
 */
export const QUESTION_LOCK_MARGIN_MS = 100;
/** 入れ替えの間に下部のボタンと質問の操作を止める時間。 */
export const QUESTION_LOCK_MS = QUESTION_TRANSITION_MS + QUESTION_LOCK_MARGIN_MS;
/** 降り始めの大きさ（貼り付いた大きさに対する倍率）。 */
export const QUESTION_ENTER_SCALE = 1.8;
/** 降り始めのぼけ（被写界深度の外にあるように見せる）。貼り付くと0になる。 */
export const QUESTION_ENTER_BLUR_PX = 24;
/** 前の質問が落ちきったときの大きさ（貼り付いていた大きさに対する倍率）。 */
export const QUESTION_LEAVE_SCALE = 0.5;
/** 前の質問が落ちきったときのぼけ。 */
export const QUESTION_LEAVE_BLUR_PX = 24;
/** 降りてくる動きのイーズアウト。終わり際に大きく減速し、画面に貼り付いて止まるように見せる。 */
export const QUESTION_ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/**
 * 落ちていく動きと消える動きのイーズイン（`easeInSine` と同じ曲線。docs/visual-language.md 2.4節）。
 * 画面からゆっくり離れ始め、加速しながら奥へ落ちていくように見せる。消える動きも同じ曲線にし、
 * 離れ始めのうちは見えたまま、加速して遠ざかるにつれて透明になるようにする。
 */
export const QUESTION_LEAVE_EASING = "cubic-bezier(0.12, 0, 0.39, 0)";

/**
 * 降りてくる要素と落ちていく要素。質問文、案内文、やり直しの案内（切り替えた時点で表示しているとき）、選択肢一つずつ、選択肢の下のラベル、
 * 2Dマップの軸の語と平面とラベル、スライダーのラベルと、操作面の中の語、仕切り線、つまみ。
 * 配列の並びは順番に関係しない。`querySelectorAll` が返す文書順に動く。
 */
export const DESCEND_TARGETS = [
	".heading > *",
	".choices .option",
	".choices > .caption",
	".map > *",
	".slider > .caption",
	".slider > .area > .label",
	".slider > .area > .divider",
	".slider > .area > .handle",
].join(", ");

/** 動く順番（0始まり）を遅れの段数に直す。 */
export function descendStep(order: number): number {
	return Math.min(order, QUESTION_STAGGER_MAX);
}

/**
 * 質問の要素へ動く順番を付ける（Svelteのaction）。動く要素に `data-descend` と、
 * 遅れの段数 `--descend-step` を設定する。質問が表示されるときに付けた順番を、その質問が去るときにも使う。
 * 動き自体は入れ替えの間だけCSSで掛ける。
 */
export function markDescendOrder(node: HTMLElement): void {
	for (const [order, element] of [...node.querySelectorAll<HTMLElement>(DESCEND_TARGETS)].entries()) {
		element.dataset.descend = "";
		element.style.setProperty("--descend-step", String(descendStep(order)));
	}
}

/** 質問から別の質問へ移るときだけ `true`。質問の外から入る、質問の外へ出る、同じ質問のままのときは `false`。 */
export function isQuestionSwitch(previousIndex: number | null, nextIndex: number | null): boolean {
	return previousIndex !== null && nextIndex !== null && previousIndex !== nextIndex;
}

/** 前後の質問の動きの値。CSSのカスタムプロパティとして `.stage` に渡す。 */
export function questionMotionStyle(): string {
	return [
		`--motion-stagger: ${QUESTION_STAGGER_MS}ms`,
		`--enter-delay: ${QUESTION_ENTER_DELAY_MS}ms`,
		`--enter-easing: ${QUESTION_ENTER_EASING}`,
		`--leave-easing: ${QUESTION_LEAVE_EASING}`,
		`--enter-duration: ${QUESTION_ENTER_MS}ms`,
		`--enter-fade: ${QUESTION_ENTER_FADE_MS}ms`,
		`--enter-scale: ${QUESTION_ENTER_SCALE}`,
		`--enter-blur: ${QUESTION_ENTER_BLUR_PX}px`,
		`--leave-duration: ${QUESTION_LEAVE_MS}ms`,
		`--leave-fade: ${QUESTION_LEAVE_FADE_MS}ms`,
		`--leave-scale: ${QUESTION_LEAVE_SCALE}`,
		`--leave-blur: ${QUESTION_LEAVE_BLUR_PX}px`,
	].join("; ");
}

/**
 * 前の質問の去り方。要素ごとの動きはCSSで描き、ここでは前の質問に `data-leaving` を付けて、最後の要素が落ち終わるまで
 * DOMに残す時間だけを決める。`css` を返さないため、質問全体には何も掛からない。Svelteが去る質問にプロパティとして設定する `inert` は、
 * `inert` に対応しない古いブラウザでは属性にならずCSSで選べないため、見分けるための属性を自分で付ける。
 */
export function questionLeave(node: Element, params: { reducedMotion: boolean }): TransitionConfig {
	node.setAttribute("data-leaving", "");
	if (params.reducedMotion) return { duration: 0 };
	return { duration: QUESTION_LEAVE_TOTAL_MS };
}
