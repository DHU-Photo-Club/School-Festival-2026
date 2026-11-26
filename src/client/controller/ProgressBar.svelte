<script module lang="ts">
// 画面の切り替えでバーが作り直されても、前の位置から動き出せるように、最後に見せた位置を覚えておく。
let lastShown = 0;
</script>

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

/** 区画の間の隙間（px）。CSSの `gap` と揃える。 */
const GAP = 8;

// 塗りは区画ごとに切り替えず、全体を右へ連続して伸ばす。作り直された直後は前の位置から始め、次のフレームで今の位置へ動かす。
let shown = $state(lastShown);
$effect(() => {
	const target = current;
	lastShown = target;
	const frame = requestAnimationFrame(() => {
		shown = target;
	});
	return () => cancelAnimationFrame(frame);
});

/** 塗る区画の右端まで見せる切り抜き。右側から削る長さを、区画の幅と隙間から求める。 */
const clip = $derived.by(() => {
	const index = Math.min(shown, total - 1);
	return `inset(0 calc(100% - ((100% - ${(total - 1) * GAP}px) * ${index + 1} / ${total} + ${index * GAP}px)) 0 0)`;
});
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
	<div class="track">
		{#each segments as index (index)}
			<span class="segment"></span>
		{/each}
	</div>
	<div class="track fill" style:clip-path={clip}>
		{#each segments as index (index)}
			<span class="segment"></span>
		{/each}
	</div>
</div>

<style>
.progress-bar {
	position: relative;
	width: 100%;
}
.track {
	display: flex;
	gap: 8px;
	width: 100%;
}
.segment {
	flex: 1;
	height: 4px;
	border-radius: 2px;
	background: var(--track);
}
.fill {
	position: absolute;
	inset: 0;
	/* easeOutCubic。出だしが速く、終わりへ向けて減速する。 */
	transition: clip-path 1000ms cubic-bezier(0.33, 1, 0.68, 1);
}
.fill .segment {
	background: var(--text);
}
@media (prefers-reduced-motion: reduce) {
	.fill {
		transition: none;
	}
}
</style>
