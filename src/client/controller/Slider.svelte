<script lang="ts">
import ChevronsLeftRightIcon from "@lucide/svelte/icons/chevrons-left-right";
import { nearestStop, roundPosition } from "../../shared/answer.ts";
import type { SliderQuestion } from "../../shared/types.ts";
import type { InputMode } from "./input-mode.ts";
import { splitAt, valueAt } from "./split.ts";

let {
	question,
	value,
	mode,
	onselect,
	oninteract,
}: {
	question: SliderQuestion;
	/** 選択中の位置（左端0から右端1）。未回答は `null`。 */
	value: number | null;
	mode: InputMode;
	onselect: (position: number) => void;
	oninteract: (interacting: boolean) => void;
} = $props();

/** 左右の語が同じ大きさのときの文字の大きさ（px）。 */
const LABEL_BASE = 24;
/** 端まで寄せたとき、広い側の語を `LABEL_BASE` の何倍にするか。狭い側は同じ割合で小さくする。 */
const LABEL_RATIO = 2.2;
/** 狭い側の語の文字の大きさの下限（px）。 */
const LABEL_MIN = 13;

let area = $state<HTMLDivElement>();
/** ドラッグ中の指の `pointerId`。ドラッグしていなければ `null`。 */
let pointer = $state<number | null>(null);

const locked = $derived(mode === "disabled" || mode === "pending");
/** 表示する状態。操作できない状態になったら、ドラッグ中でもその状態を見せる。 */
const shownMode = $derived(pointer !== null && !locked ? "dragging" : mode);

const shown = $derived(Math.min(1, Math.max(0, value ?? 0.5)));
/** 補助文に使う、最も近い回答位置。 */
const stop = $derived(nearestStop(shown));
/** 仕切り線の位置（画面幅に対する割合）。 */
const split = $derived(splitAt(shown));
/** 左の語への寄り具合。左端で1、中央で0、右端で-1。 */
const lean = $derived(1 - shown * 2);
const labelSize = (weight: number) => `${Math.max(LABEL_MIN, LABEL_BASE * LABEL_RATIO ** weight)}px`;
/** 回答位置の値（0〜1）。キーボード操作で選ぶ位置に使う。 */
const ticks = $derived(question.stops.map((_, index) => index / (question.stops.length - 1)));

const caption = $derived.by(() => {
	switch (shownMode) {
		case "disabled":
			return "操作できません";
		case "pending":
			return "送信しています";
		case "unanswered":
			return "しっくりくる位置に動かしてください。真ん中でも大丈夫です。";
		case "answered":
			return `回答済み: ${question.stops[stop].caption}`;
		default:
			return question.stops[stop].caption;
	}
});

/** 指の位置を回答の位置（0〜1）にする。仕切り線を動かせる範囲の外は端にする。 */
function positionAt(clientX: number): number {
	if (!area) return shown;
	const rect = area.getBoundingClientRect();
	return roundPosition(valueAt((clientX - rect.left) / Math.max(1, rect.width)));
}

// 画面の任意の位置のタップと仕切り線のドラッグの両方で、指の位置へ仕切り線を動かす（仕様書7.1節）。
// 最初に触れた指だけを追い、ほかの指は無視する。
function down(event: PointerEvent) {
	if (locked || pointer !== null) return;
	area?.setPointerCapture(event.pointerId);
	pointer = event.pointerId;
	oninteract(true);
	onselect(positionAt(event.clientX));
}

function move(event: PointerEvent) {
	if (locked || event.pointerId !== pointer) return;
	const next = positionAt(event.clientX);
	if (next !== value) onselect(next);
}

function up(event: PointerEvent) {
	if (event.pointerId !== pointer) return;
	pointer = null;
	if (area?.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId);
	oninteract(false);
}
</script>

<div class="slider" data-answer-input="slider" data-mode={shownMode}>
	<!-- ドラッグ中は補助文が次々に変わるため読み上げない。 -->
	<p class="caption" aria-live={shownMode === "dragging" ? "off" : "polite"}>{caption}</p>
	<!-- 画面全体を覆う操作面。質問文と補助文の上も含め、どこを触っても仕切り線が指の位置へ動く。 -->
	<div
		class="area"
		bind:this={area}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onlostpointercapture={up}
		role="presentation"
		data-value={value ?? ""}
		style:--split={split}
	>
		<!-- 読み上げとキーボード操作用。矢印キーで別の回答位置へ移ると、仕切り線がその回答位置へ動く。 -->
		<div
			class="sr-only"
			role="radiogroup"
			aria-label="{question.prompt}（左: {question.leftLabel}、右: {question.rightLabel}）"
		>
			{#each question.stops as item, index (item.id)}
				<label>
					<input
						type="radio"
						name="slider-{question.id}"
						value={item.id}
						checked={value !== null && stop === index}
						disabled={locked}
						onchange={() => onselect(ticks[index])}
					>
					{item.caption}
				</label>
			{/each}
		</div>
		<span class="label left" aria-hidden="true" style:font-size={labelSize(lean)}>{question.leftLabel}</span>
		<span class="label right" aria-hidden="true" style:font-size={labelSize(-lean)}>{question.rightLabel}</span>
		<span class="divider"></span>
		<span class="handle">
			<ChevronsLeftRightIcon aria-hidden="true" size={22} strokeWidth={2} />
		</span>
	</div>
</div>

<style>
.slider {
	display: grid;
	justify-items: center;
}
/* `.screen` を基準に画面全体へ広げる。進捗バーと質問文の上にも重なるが、背景は透明。 */
.area {
	position: absolute;
	inset: 0;
	z-index: 0;
	touch-action: none;
	cursor: ew-resize;
	user-select: none;
	-webkit-user-select: none;
}
/* 見えないラジオボタンにフォーカスがあるときは、つまみに枠を出す。 */
.area:has(input:focus-visible) .handle {
	outline: 2px solid var(--text);
	outline-offset: 4px;
}
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
	border: 0;
}
.label {
	position: absolute;
	top: 50%;
	padding: 0 8px;
	box-sizing: border-box;
	transform: translateY(-50%);
	text-align: center;
	font-weight: 600;
	letter-spacing: 0.08em;
	line-height: 1.3;
	overflow-wrap: anywhere;
	pointer-events: none;
}
.label.left {
	left: 0;
	width: calc(100% * var(--split));
}
.label.right {
	left: calc(100% * var(--split));
	right: 0;
}
/* 仕切り線。質問文と重なる上部は薄くし、文字を読みやすくする。 */
.divider {
	position: absolute;
	top: 0;
	bottom: 0;
	left: calc(100% * var(--split));
	width: 2px;
	transform: translateX(-50%);
	background: var(--text);
	mask-image: linear-gradient(to bottom, transparent 0, transparent 22%, #000 36%);
	pointer-events: none;
}
.handle {
	position: absolute;
	top: 50%;
	left: calc(100% * var(--split));
	display: grid;
	place-items: center;
	width: 40px;
	height: 40px;
	border-radius: 50%;
	transform: translate(-50%, -50%);
	background: var(--idle);
	color: var(--text);
	pointer-events: none;
	transition:
		width 120ms,
		height 120ms;
}
/* 枠は疑似要素に描き、確定待ちで枠だけを回す。 */
.handle::before {
	content: "";
	position: absolute;
	inset: 0;
	border-radius: 50%;
	border: 2px solid var(--text);
}
/* 未回答: 破線の枠。 */
[data-mode="unanswered"] .handle::before {
	border-style: dashed;
}
/* 操作中: 大きく、太い実線の枠。 */
[data-mode="dragging"] .handle,
[data-mode="active"] .handle {
	width: 48px;
	height: 48px;
}
[data-mode="dragging"] .handle::before,
[data-mode="active"] .handle::before {
	border-width: 3px;
}
/* 確定待ち: 点線の輪が回る。 */
[data-mode="pending"] .handle::before {
	border-style: dotted;
	border-width: 3px;
	animation: turn 1.6s linear infinite;
}
/* 確定済み: 二重線。 */
[data-mode="answered"] .handle::before {
	border: 6px double var(--text);
}
/* 無効: 枠なしの暗い円。仕切り線と語も暗くする。 */
[data-mode="disabled"] .handle {
	background: var(--line);
	color: var(--idle);
}
[data-mode="disabled"] .handle::before {
	border-color: var(--line);
}
[data-mode="disabled"] .divider {
	background: var(--line);
}
[data-mode="disabled"] .label {
	color: var(--muted);
}
[data-mode="disabled"] .area,
[data-mode="pending"] .area {
	cursor: default;
}
@keyframes turn {
	to {
		transform: rotate(360deg);
	}
}
@media (prefers-reduced-motion: reduce) {
	[data-mode="pending"] .handle::before {
		animation: none;
	}
	.handle {
		transition: none;
	}
}
.caption {
	margin: 0;
	min-height: 1.7em;
	text-align: center;
	font-size: 16px;
	color: var(--muted);
}
[data-mode="active"] .caption,
[data-mode="dragging"] .caption,
[data-mode="answered"] .caption {
	color: var(--text);
}
</style>
