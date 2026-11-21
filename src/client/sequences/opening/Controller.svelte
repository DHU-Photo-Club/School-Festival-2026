<script lang="ts">
import type { SequenceProps } from "../props.ts";

// 仮の演出: 二つの文言を順に表示する。最後の文言は、サーバーが次の段階へ進めるまで表示し続ける
// （alarm の遅れで次の段階の表示が遅れても、画面を空にしない）。
let { t, reducedMotion }: SequenceProps = $props();

const SECOND_FROM = 1_200;
const LINES = [{ from: 0, to: SECOND_FROM, title: "ディスプレイをご覧ください", body: null }];
const FADE_IN_MS = 400;
const FADE_OUT_MS = 300;

const line = $derived(
	LINES.find((candidate) => t >= candidate.from && (candidate.to === null || t < candidate.to)) ?? null,
);
const opacity = $derived.by(() => {
	if (!line || reducedMotion) return 1;
	const fadeOut = line.to === null ? 1 : (line.to - t) / FADE_OUT_MS;
	return Math.min(1, (t - line.from) / FADE_IN_MS, fadeOut);
});
</script>

{#if line}
	<div class="line" style:opacity>
		<h1>{line.title}</h1>
		{#if line.body}
			<p>{line.body}</p>
		{/if}
	</div>
{/if}

<style>
.line {
	display: grid;
	justify-items: center;
	gap: 24px;
}
p {
	margin: 0;
	font-size: 22px;
}
h1 {
	margin: 0;
	font-size: clamp(26px, 4.5vmin, 40px);
	font-weight: 600;
	letter-spacing: 0.06em;
}
</style>
