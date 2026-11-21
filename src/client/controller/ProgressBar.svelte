<script lang="ts">
interface Props {
	/** 区画の数。 */
	total: number;
	/** 現在の区画（0始まり）。ここまでの区画を塗る。 */
	current: number;
	/** 読み上げ用の現在位置の説明。 */
	label: string;
}

const { total, current, label }: Props = $props();
const segments = $derived(Array.from({ length: total }, (_, index) => index));
</script>

<div
	class="progress-bar"
	role="progressbar"
	aria-label="進捗"
	aria-valuemin={1}
	aria-valuemax={total}
	aria-valuenow={current + 1}
	aria-valuetext={label}
>
	{#each segments as index (index)}
		<span class="segment" class:filled={index <= current}></span>
	{/each}
</div>

<style>
.progress-bar {
	display: flex;
	gap: 8px;
	width: 100%;
}
.segment {
	flex: 1;
	height: 4px;
	border-radius: 2px;
	background: var(--track);
	transition: background-color 200ms ease;
}
.filled {
	background: var(--text);
}
@media (prefers-reduced-motion: reduce) {
	.segment {
		transition: none;
	}
}
</style>
