<script lang="ts">
import { cellCenter, cellOf, roundPosition } from "../../shared/answer.ts";
import type { MapPoint, MapQuestion } from "../../shared/types.ts";
import { MAP_SIZE } from "../../shared/types.ts";
import type { InputMode } from "./input-mode.ts";

let {
	question,
	value,
	mode,
	onselect,
	oninteract,
}: {
	question: MapQuestion;
	/** 選択中の位置。未回答は `null`。 */
	value: MapPoint | null;
	mode: InputMode;
	onselect: (point: MapPoint) => void;
	oninteract: (interacting: boolean) => void;
} = $props();

const CELLS = Array.from({ length: MAP_SIZE * MAP_SIZE }, (_, index) => index);

let area = $state<HTMLDivElement>();
/** ドラッグ中の指の `pointerId`。ドラッグしていなければ `null`。 */
let pointer = $state<number | null>(null);

const locked = $derived(mode === "disabled" || mode === "pending");
/** 表示する状態。操作できない状態になったら、ドラッグ中でもその状態を見せる。 */
const shownMode = $derived(pointer !== null && !locked ? "dragging" : mode);

const shown = $derived(value ?? { x: 0.5, y: 0.5 });
/** 補助文と強調する印に使う、位置を含む区画。 */
const cell = $derived(cellOf(shown));
const percent = (ratio: number) => `${ratio * 100}%`;

const caption = $derived.by(() => {
	switch (shownMode) {
		case "disabled":
			return "操作できません";
		case "pending":
			return "送信しています";
		case "unanswered":
			return "さわって場所を選んでください";
		case "answered":
			return `回答済み: ${question.cells[cell].caption}`;
		default:
			return question.cells[cell].caption;
	}
});

/** 指の位置を平面上の位置にする。平面の外は最も近い辺の上にする。 */
function pointAt(clientX: number, clientY: number): MapPoint {
	if (!area) return shown;
	// 枠線の内側を基準にする。ピンや印の `left` と `top` も枠線の内側で決まる。
	const rect = area.getBoundingClientRect();
	return {
		x: roundPosition((clientX - rect.left - area.clientLeft) / Math.max(1, area.clientWidth)),
		y: roundPosition((clientY - rect.top - area.clientTop) / Math.max(1, area.clientHeight)),
	};
}

// 平面の任意位置のタップとピンのドラッグの両方で、指の位置をそのまま選ぶ。
// 最初に触れた指だけを追い、ほかの指は無視する。
function down(event: PointerEvent) {
	if (locked || pointer !== null) return;
	area?.setPointerCapture(event.pointerId);
	pointer = event.pointerId;
	oninteract(true);
	onselect(pointAt(event.clientX, event.clientY));
}

function move(event: PointerEvent) {
	if (locked || event.pointerId !== pointer) return;
	const next = pointAt(event.clientX, event.clientY);
	if (next.x !== value?.x || next.y !== value?.y) onselect(next);
}

function up(event: PointerEvent) {
	if (event.pointerId !== pointer) return;
	pointer = null;
	if (area?.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId);
	oninteract(false);
}

/** 区画の中心の位置。タップと同じく小数第3位に丸める。 */
function roundedCenter(index: number): MapPoint {
	const center = cellCenter(index);
	return { x: roundPosition(center.x), y: roundPosition(center.y) };
}
</script>

<div class="map" data-answer-input="map" data-mode={shownMode}>
	<span class="edge top">{question.topLabel}</span>
	<span class="edge left">{question.leftLabel}</span>
	<div
		class="area"
		bind:this={area}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onlostpointercapture={up}
		role="presentation"
		data-cell={value === null ? "" : cell}
		data-x={value?.x ?? ""}
		data-y={value?.y ?? ""}
	>
		<!-- 読み上げとキーボード操作用。矢印キーで別の区画へ移ると、ピンがその区画の中心へ動く。 -->
		<div
			class="sr-only"
			role="radiogroup"
			aria-label="{question.prompt}（左: {question.leftLabel}、右: {question.rightLabel}、上: {question.topLabel}、下: {question.bottomLabel}）"
		>
			{#each question.cells as item, index (item.id)}
				<label>
					<input
						type="radio"
						name="map-{question.id}"
						value={item.id}
						checked={value !== null && cell === index}
						disabled={locked}
						onchange={() => onselect(roundedCenter(index))}
					>
					{item.caption}
				</label>
			{/each}
		</div>
		<span class="axis horizontal"></span>
		<span class="axis vertical"></span>
		{#each CELLS as index (index)}
			{@const center = cellCenter(index)}
			<span
				class="cell"
				class:current={value !== null && cell === index}
				style:left={percent(center.x)}
				style:top={percent(center.y)}
			></span>
		{/each}
		<span class="pin" style:left={percent(shown.x)} style:top={percent(shown.y)}></span>
	</div>
	<span class="edge right">{question.rightLabel}</span>
	<span class="edge bottom">{question.bottomLabel}</span>
	<p class="caption" aria-live="polite">{caption}</p>
</div>

<style>
/* 平面の上下に縦軸の語、左右に横軸の語を縦書きで置く。 */
.map {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	grid-template-areas:
		". top ."
		"left area right"
		". bottom ."
		"caption caption caption";
	align-items: center;
	justify-items: center;
	gap: 8px 12px;
	width: min(100%, 520px);
}
.edge {
	font-size: 18px;
	letter-spacing: 0.08em;
}
.top {
	grid-area: top;
}
.bottom {
	grid-area: bottom;
}
.left,
.right {
	writing-mode: vertical-rl;
}
.left {
	grid-area: left;
}
.right {
	grid-area: right;
}
.area {
	grid-area: area;
	position: relative;
	width: min(100%, 44dvh);
	min-width: 220px;
	aspect-ratio: 1;
	border: 1.5px solid var(--text);
	touch-action: none;
	cursor: pointer;
}
/* 見えないラジオボタンにフォーカスがあるときは、平面に枠を出す。 */
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
/* 中央を通る二本の軸。 */
.axis {
	position: absolute;
	background: #5a5754;
	pointer-events: none;
}
.axis.horizontal {
	left: 0;
	right: 0;
	top: 50%;
	height: 2px;
	transform: translateY(-50%);
}
.axis.vertical {
	top: 0;
	bottom: 0;
	left: 50%;
	width: 2px;
	transform: translateX(-50%);
}
/* 各区画の中心の印。選択中の区画は大きくする。 */
.cell {
	position: absolute;
	width: 10px;
	height: 10px;
	border-radius: 50%;
	background: #8a8784;
	transform: translate(-50%, -50%);
	pointer-events: none;
}
.cell.current {
	width: 16px;
	height: 16px;
	background: var(--text);
}
.pin {
	position: absolute;
	width: 28px;
	height: 28px;
	border-radius: 50%;
	transform: translate(-50%, -50%);
	background: var(--text);
	border: 3px solid var(--text);
	pointer-events: none;
	/* 指に遅れないよう、位置は動かさずに大きさだけを変化させる。 */
	transition:
		width 120ms,
		height 120ms;
}
/* 状態ごとのピンの形はスライダーのつまみと同じにする（docs/visual-language.md 4.3節）。 */
[data-mode="unanswered"] .pin {
	background: transparent;
	border: 3px dashed #8a8784;
	opacity: 0.8;
}
[data-mode="dragging"] .pin,
[data-mode="active"] .pin {
	width: 40px;
	height: 40px;
	border: 5px solid var(--idle);
	box-shadow: 0 0 0 3px var(--text);
}
[data-mode="pending"] .pin {
	background: transparent;
	border: 4px dotted var(--text);
	animation: turn 1.6s linear infinite;
}
[data-mode="answered"] .pin {
	width: 32px;
	height: 32px;
	border: 6px double var(--idle);
	box-shadow: 0 0 0 2px var(--text);
}
[data-mode="disabled"] .pin {
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
	[data-mode="pending"] .pin {
		animation: none;
	}
	.pin {
		transition: none;
	}
}
.caption {
	grid-area: caption;
	/* 下辺の語と見分けるため、間を空ける。 */
	margin: 12px 0 0;
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
