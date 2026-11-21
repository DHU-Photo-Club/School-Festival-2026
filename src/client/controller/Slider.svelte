<script lang="ts">
import { nearestStop, roundPosition } from "../../shared/answer.ts";
import type { SliderQuestion } from "../../shared/types.ts";
import type { InputMode } from "./input-mode.ts";

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

/** つまみのタップ領域の半分（44 CSS px の半分、仕様書7.1節）。 */
const HALF = 22;

let area = $state<HTMLDivElement>();
/** ドラッグ中の指の `pointerId`。ドラッグしていなければ `null`。 */
let pointer = $state<number | null>(null);

const locked = $derived(mode === "disabled" || mode === "pending");
/** 表示する状態。操作できない状態になったら、ドラッグ中でもその状態を見せる。 */
const shownMode = $derived(pointer !== null && !locked ? "dragging" : mode);

const shown = $derived(value ?? 0.5);
/** 補助文と強調する目盛りに使う、最も近い回答位置。 */
const stop = $derived(nearestStop(shown));
const position = (ratio: number) => `calc(${HALF}px + (100% - ${HALF * 2}px) * ${ratio})`;
/** 回答位置の目盛りの位置（0〜1）。 */
const ticks = $derived(question.stops.map((_, index) => index / (question.stops.length - 1)));

const caption = $derived.by(() => {
	switch (shownMode) {
		case "disabled":
			return "操作できません";
		case "pending":
			return "送信しています";
		case "unanswered":
			return "動かして選んでください";
		case "answered":
			return `回答済み: ${question.stops[stop].caption}`;
		default:
			return question.stops[stop].caption;
	}
});

/** 指の位置をトラック上の位置（0〜1）にする。トラックの外は端にする。 */
function positionAt(clientX: number): number {
	if (!area) return shown;
	// `.area` の内側（枠線を除く）を基準にする。つまみや目盛りの `left` も同じ基準で決まる。
	const left = area.getBoundingClientRect().left + area.clientLeft;
	return roundPosition((clientX - left - HALF) / Math.max(1, area.clientWidth - HALF * 2));
}

// トラックの任意位置のタップとつまみのドラッグの両方で、指の位置をそのまま選ぶ（仕様書7.1節）。
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
	<div class="ends">
		<span>{question.leftLabel}</span>
		<span>{question.rightLabel}</span>
	</div>
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
	>
		<!-- 読み上げとキーボード操作用。矢印キーで別の回答位置へ移ると、つまみがその回答位置へ動く。 -->
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
		<!-- トラックの線。ポインター操作は囲みの領域（.area）、キーボード操作はラジオボタンで受け付ける。 -->
		<span class="track"></span>
		{#each ticks as tick, index (index)}
			<span class="tick" class:current={value !== null && stop === index} style:left={position(tick)}></span>
		{/each}
		<span class="thumb" style:left={position(shown)}></span>
	</div>
	<p class="caption" aria-live="polite">{caption}</p>
</div>

<style>
.slider {
	width: 100%;
	max-width: 640px;
	min-width: 280px;
	display: grid;
	gap: 8px;
}
.area {
	position: relative;
	height: 64px;
	touch-action: none;
	cursor: pointer;
}
/* 見えないラジオボタンにフォーカスがあるときは、トラックに枠を出す。 */
.area:has(input:focus-visible) {
	outline: 2px solid var(--text);
	outline-offset: 3px;
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
.track {
	position: absolute;
	left: 0;
	right: 0;
	top: 50%;
	height: 4px;
	border-radius: 2px;
	background: #5a5754;
	transform: translateY(-50%);
	pointer-events: none;
}
.tick {
	position: absolute;
	top: 50%;
	width: 4px;
	height: 16px;
	border-radius: 2px;
	background: #8a8784;
	transform: translate(-50%, -50%);
	pointer-events: none;
}
.tick.current {
	width: 6px;
	height: 28px;
	background: var(--text);
}
.thumb {
	position: absolute;
	top: 50%;
	width: 28px;
	height: 28px;
	border-radius: 50%;
	transform: translate(-50%, -50%);
	background: var(--text);
	border: 3px solid var(--text);
	pointer-events: none;
	transition:
		width 120ms,
		height 120ms;
}
/* 未回答: 中央に薄く、破線の枠。 */
[data-mode="unanswered"] .thumb {
	background: transparent;
	border: 3px dashed #8a8784;
	opacity: 0.8;
}
/* 操作中: 大きく、太い実線の枠。 */
[data-mode="dragging"] .thumb,
[data-mode="active"] .thumb {
	width: 40px;
	height: 40px;
	border: 5px solid var(--idle);
	box-shadow: 0 0 0 3px var(--text);
}
/* 確定待ち: 点線の輪が回る。 */
[data-mode="pending"] .thumb {
	background: transparent;
	border: 4px dotted var(--text);
	animation: turn 1.6s linear infinite;
}
/* 確定済み: 二重線。 */
[data-mode="answered"] .thumb {
	width: 32px;
	height: 32px;
	border: 6px double var(--idle);
	box-shadow: 0 0 0 2px var(--text);
}
/* 無効: 枠なしの暗い円。 */
[data-mode="disabled"] .thumb {
	background: var(--line);
	border-color: var(--line);
}
[data-mode="disabled"] .area {
	cursor: default;
}
@keyframes turn {
	to {
		transform: translate(-50%, -50%) rotate(360deg);
	}
}
@media (prefers-reduced-motion: reduce) {
	[data-mode="pending"] .thumb {
		animation: none;
	}
	.thumb {
		transition: none;
	}
}
.ends {
	display: flex;
	justify-content: space-between;
	font-size: 18px;
}
.caption {
	margin: 0;
	min-height: 1.6em;
	text-align: center;
	font-size: 18px;
	color: var(--muted);
}
[data-mode="active"] .caption,
[data-mode="dragging"] .caption,
[data-mode="answered"] .caption {
	color: var(--text);
}
</style>
