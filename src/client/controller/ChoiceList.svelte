<script lang="ts">
import CheckIcon from "@lucide/svelte/icons/check";
import { toggleSelection } from "../../shared/answer.ts";
import type { Answer, ChoiceQuestion } from "../../shared/types.ts";
import type { InputMode } from "./input-mode.ts";

let {
	question,
	value,
	mode,
	onselect,
}: {
	question: ChoiceQuestion;
	/**
	 * 単選択は選択肢ID、複数選択は選択肢IDの配列（定義順）、順位つき選択は選んだ順の配列。未回答は `null`。
	 */
	value: Answer | null;
	mode: InputMode;
	onselect: (answer: Answer) => void;
} = $props();

/** 選んでいる選択肢のID。 */
const selected: readonly string[] = $derived(
	typeof value === "string" ? [value] : Array.isArray(value) ? (value as readonly string[]) : [],
);
const locked = $derived(mode === "disabled" || mode === "pending");
/** 複数選びの質問か（複数選択と順位つき選択）。 */
const many = $derived(question.kind !== "single");
/**
 * 上限まで選んだか。上限に達したら、選んでいない選択肢を押せなくする。単独選択の選択肢は、他の選択を
 * 置き換えるため押せるままにする。
 */
const full = $derived(question.kind !== "single" && selected.length >= question.maxSelections);
const exclusiveOf = (id: string) => question.options.find((option) => option.id === id)?.exclusive === true;

/** 複数選びで選べる個数の説明。例: `2つまで`、`1〜3つ`、`2つ`。 */
const range = $derived.by(() => {
	if (question.kind === "single") return "";
	const { minSelections: min, maxSelections: max } = question;
	if (min === max) return `${max}つ`;
	if (min === 1) return `${max}つまで`;
	return `${min}〜${max}つ`;
});

/** 選んだ選択肢の表示文。順位つき選択は選んだ順。 */
const labels = $derived(selected.map((id) => question.options.find((option) => option.id === id)?.label ?? id));

const caption = $derived.by(() => {
	switch (mode) {
		case "disabled":
			return "操作できません";
		case "pending":
			return "送信しています";
		case "unanswered":
			if (question.kind === "single") return "一つ選んでください";
			if (question.kind === "ranked") return `順番に${range}選んでください`;
			return `${range}選んでください`;
		case "answered":
			return question.kind === "ranked"
				? `回答済み: ${labels.map((label, i) => `${i + 1}位 ${label}`).join("、")}`
				: `回答済み: ${labels.join("、")}`;
		default:
			if (question.kind === "single") return labels[0] ?? "";
			if (selected.length < question.minSelections)
				return `あと${question.minSelections - selected.length}つ選んでください`;
			return `${selected.length}つ選んでいます（${range}選べます）`;
	}
});

function toggle(id: string) {
	if (locked) return;
	if (question.kind === "single") {
		onselect(id);
		return;
	}
	// 複数選択は定義順、順位つき選択は選んだ順に並べる。上限を超える選択は `null`。
	const next = toggleSelection(question, selected, id);
	if (next) onselect(next);
}
</script>

<div class="choices" data-answer-input={question.kind} data-mode={mode}>
	<div class="options" role={question.kind === "single" ? "radiogroup" : "group"} aria-label={question.prompt}>
		{#each question.options as option (option.id)}
			{@const checked = selected.includes(option.id)}
			{@const rank = selected.indexOf(option.id) + 1}
			<button
				type="button"
				class="option"
				class:checked
				class:exclusive={option.exclusive}
				role={question.kind === "single" ? "radio" : "checkbox"}
				aria-checked={checked}
				disabled={locked}
				aria-disabled={!checked && full && !exclusiveOf(option.id) ? "true" : undefined}
				onclick={() => toggle(option.id)}
			>
				<span class="mark" class:square={many} aria-hidden="true">
					{#if checked}
						{#if question.kind === "ranked"}
							<span class="rank">{rank}</span>
						{:else if question.kind === "multiple"}
							<CheckIcon size={18} strokeWidth={3} />
						{:else}
							<span class="dot"></span>
						{/if}
					{/if}
				</span>
				<span class="label">{option.label}</span>
			</button>
		{/each}
	</div>
	<p class="caption" aria-live="polite">{caption}</p>
</div>

<style>
.choices {
	width: 100%;
	max-width: 640px;
	min-width: 280px;
	display: grid;
	gap: 16px;
}
.options {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 12px;
}
.option {
	display: flex;
	align-items: center;
	gap: 16px;
	min-height: 64px;
	padding: 12px 20px;
	border: 1.5px solid var(--text);
	border-radius: 0;
	background: var(--idle);
	color: var(--text);
	font-size: 22px;
	letter-spacing: 0.04em;
	text-align: left;
	white-space: normal;
	cursor: pointer;
	touch-action: manipulation;
	transition:
		background 120ms,
		color 120ms;
}
/* 選んだ選択肢: 塗りつぶしと、印の中の点またはチェック。 */
.option.checked {
	background: var(--text);
	color: var(--idle);
}
.option:disabled {
	cursor: default;
}
/*
 * 上限に達して押せない選択肢と、無効中の選んでいない選択肢を薄くする。上限に達した選択肢は
 * 読み上げで残りの選択肢を確かめられるよう、`disabled` ではなく `aria-disabled` にする。
 */
.option:disabled:not(.checked),
.option[aria-disabled="true"] {
	opacity: 0.35;
}
.option[aria-disabled="true"] {
	cursor: default;
}
.option:focus-visible {
	outline: 2px solid var(--text);
	outline-offset: 3px;
}
.mark {
	flex: none;
	display: grid;
	place-items: center;
	width: 28px;
	height: 28px;
	border: 2px solid currentColor;
	border-radius: 50%;
}
.mark.square {
	border-radius: 0;
}
/* 単独選択の選択肢（例:「どれとも決められない」）は、他の選択肢と区別できるよう全幅に置く。 */
.option.exclusive {
	grid-column: 1 / -1;
}
.rank {
	font-size: 16px;
	font-weight: 700;
	line-height: 1;
}
.dot {
	width: 12px;
	height: 12px;
	border-radius: 50%;
	background: currentColor;
}
/* 確定待ち: 選んだ選択肢の印の枠を点線にする。四角い印が回ると壊れて見えるため、回さない。 */
[data-mode="pending"] .checked .mark {
	border-style: dotted;
}
/* 確定済み: 選んだ選択肢の枠の内側に白い線を重ねて二重線にする。枠の太さは変えない。 */
[data-mode="answered"] .option.checked {
	box-shadow:
		inset 0 0 0 3px var(--text),
		inset 0 0 0 5px var(--idle);
}
/* 無効: 枠を暗い色にする。 */
[data-mode="disabled"] .option {
	border-color: var(--line);
}
@media (prefers-reduced-motion: reduce) {
	.option {
		transition: none;
	}
}
.caption {
	margin: 0;
	min-height: 1.6em;
	text-align: center;
	font-size: 18px;
	color: var(--muted);
}
[data-mode="active"] .caption,
[data-mode="answered"] .caption {
	color: var(--text);
}
</style>
