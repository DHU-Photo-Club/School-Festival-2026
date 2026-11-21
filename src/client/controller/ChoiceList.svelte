<script lang="ts">
import CheckIcon from "@lucide/svelte/icons/check";
import type { Answer, MultipleChoiceQuestion, SingleChoiceQuestion } from "../../shared/types.ts";
import type { InputMode } from "./input-mode.ts";

let {
	question,
	value,
	mode,
	onselect,
}: {
	question: SingleChoiceQuestion | MultipleChoiceQuestion;
	/** 単選択は選択肢ID、複数選択は選択肢IDの配列（定義順）。未回答は `null`。 */
	value: Answer | null;
	mode: InputMode;
	onselect: (answer: Answer) => void;
} = $props();

/** 選んでいる選択肢のID。 */
const selected: readonly string[] = $derived(
	typeof value === "string" ? [value] : Array.isArray(value) ? (value as readonly string[]) : [],
);
const locked = $derived(mode === "disabled" || mode === "pending");
/** 複数選択で上限まで選んだか。上限に達したら、選んでいない選択肢を押せなくする。 */
const full = $derived(question.kind === "multiple" && selected.length >= question.maxSelections);

/** 複数選択で選べる個数の説明。例: `2つまで`、`1〜3つ`、`2つ`。 */
const range = $derived.by(() => {
	if (question.kind !== "multiple") return "";
	const { minSelections: min, maxSelections: max } = question;
	if (min === max) return `${max}つ`;
	if (min === 1) return `${max}つまで`;
	return `${min}〜${max}つ`;
});

const labels = $derived(question.options.filter((option) => selected.includes(option.id)).map((o) => o.label));

const caption = $derived.by(() => {
	switch (mode) {
		case "disabled":
			return "操作できません";
		case "pending":
			return "送信しています";
		case "unanswered":
			return question.kind === "single" ? "一つ選んでください" : `${range}選んでください`;
		case "answered":
			return `回答済み: ${labels.join("、")}`;
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
	const has = selected.includes(id);
	if (!has && full) return;
	const next = has ? selected.filter((candidate) => candidate !== id) : [...selected, id];
	// 回答は選択肢の定義順に並べる。
	onselect(question.options.filter((option) => next.includes(option.id)).map((option) => option.id));
}
</script>

<div class="choices" data-answer-input={question.kind} data-mode={mode}>
	<div class="options" role={question.kind === "single" ? "radiogroup" : "group"} aria-label={question.prompt}>
		{#each question.options as option (option.id)}
			{@const checked = selected.includes(option.id)}
			<button
				type="button"
				class="option"
				class:checked
				role={question.kind === "single" ? "radio" : "checkbox"}
				aria-checked={checked}
				disabled={locked}
				aria-disabled={!checked && full ? "true" : undefined}
				onclick={() => toggle(option.id)}
			>
				<span class="mark" class:square={question.kind === "multiple"} aria-hidden="true">
					{#if checked}
						{#if question.kind === "multiple"}
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
