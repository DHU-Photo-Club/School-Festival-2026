<script lang="ts">
import { onMount } from "svelte";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PALETTE } from "../../data/palette.ts";
import { PHOTOS } from "../../data/photos.ts";
import { backgroundColor, baseColor, foregroundColor, gradientCss, paletteColor } from "../../shared/palette.ts";
import type { PublicResult } from "../../shared/result.ts";
import type { PaletteColor, Photo } from "../../shared/types.ts";
import PhotoImage from "../common/PhotoImage.svelte";

/**
 * QRから開く公開結果ページ（仕様書10.2節）。リアルタイム状態へ接続せず、保存した結果を
 * `/result/{id}/data` から読む。結果に選ばれた写真のうち、配布を許可した写真だけを見せる。
 */
let { resultId }: { resultId: string } = $props();

let status = $state<"loading" | "loaded" | "missing" | "failed">("loading");
let result = $state<PublicResult | null>(null);
let failedPhotos = $state<Record<string, boolean>>({});

const colors = $derived.by((): [PaletteColor, PaletteColor] | null => {
	if (!result) return null;
	const [a, b] = result.colors.map((color) => paletteColor(PALETTE.colors, color.id));
	return a && b ? [a, b] : null;
});
const photos = $derived(
	(result?.photoIds ?? [])
		.map((id) => PHOTOS.find((photo) => photo.id === id))
		.filter((photo): photo is Photo => photo?.shareAllowed === true),
);

onMount(async () => {
	try {
		const response = await fetch(`/result/${encodeURIComponent(resultId)}/data`, { cache: "no-store" });
		if (!response.ok) {
			status = response.status === 404 || response.status === 410 ? "missing" : "failed";
			return;
		}
		result = (await response.json()) as PublicResult;
		status = "loaded";
	} catch {
		status = "failed";
	}
});
</script>

<svelte:head>
	<title>{result ? `${result.name} | ${EXHIBIT.title}` : EXHIBIT.title}</title>
</svelte:head>

{#if status === "loaded" && result && colors}
	<main class="result" style:background={backgroundColor(colors[0])} style:color={foregroundColor(colors[0])}>
		<div class="gradient" style:background={gradientCss(colors[0], colors[1])}></div>
		<p class="caption">あなたの色は</p>
		<h1>{result.name}</h1>
		<p class="name-reason">{result.nameReason}</p>
		<p class="message">{result.reading}</p>
		<ul class="colors">
			{#each result.colors as choice, i (choice.id)}
				<li>
					<span class="swatch" style:background={baseColor(colors[i])} aria-hidden="true"></span>
					<span class="color-name">{colors[i].name}</span>
					<span class="reason">{choice.reason}</span>
				</li>
			{/each}
		</ul>
		<p class="message">{result.relationship}</p>
		{#each photos as photo (photo.id)}
			{#if !failedPhotos[photo.id]}
				<figure>
					<div class="photo">
						<PhotoImage
							{photo}
							onstatus={(next) => (failedPhotos = { ...failedPhotos, [photo.id]: next === "failed" })}
						/>
					</div>
					<figcaption>
						{#if photo.creditUrl}
							<a href={photo.creditUrl} rel="noopener noreferrer" style:color={foregroundColor(colors[0])}
								>© {photo.creditName}</a
							>
						{:else}
							© {photo.creditName}
						{/if}
					</figcaption>
				</figure>
			{/if}
		{/each}
		<footer>
			<p class="title">{EXHIBIT.title}</p>
			<p>{EXHIBIT.eventInfo}</p>
		</footer>
	</main>
{:else if status === "loading"}
	<main class="result"><p>読み込んでいます</p></main>
{:else if status === "missing"}
	<main class="result"><p>ページが見つかりません</p></main>
{:else}
	<main class="result"><p>結果を読み込めませんでした。ページを再読み込みしてください。</p></main>
{/if}

<style>
.result {
	min-height: 100vh;
	display: grid;
	justify-items: center;
	align-content: start;
	gap: 16px;
	padding: 48px 20px;
	text-align: center;
}
.gradient {
	width: min(72vw, 320px);
	aspect-ratio: 1;
	border-radius: 50%;
}
.caption {
	margin: 8px 0 0;
	opacity: 0.8;
}
h1 {
	margin: 0;
	font-size: 32px;
	letter-spacing: 0.06em;
}
.name-reason {
	margin: 0;
	font-size: 14px;
	opacity: 0.8;
}
.message {
	margin: 0;
	max-width: 32em;
	line-height: 1.7;
}
.colors {
	display: grid;
	gap: 12px;
	width: min(100%, 560px);
	margin: 8px 0;
	padding: 0;
	list-style: none;
	text-align: left;
}
.colors li {
	display: grid;
	grid-template-columns: 32px 1fr;
	column-gap: 12px;
	align-items: center;
}
.swatch {
	grid-row: span 2;
	width: 32px;
	height: 32px;
	border-radius: 50%;
}
.color-name {
	font-weight: 600;
}
.reason {
	font-size: 14px;
	line-height: 1.6;
	opacity: 0.85;
}
figure {
	margin: 16px 0 0;
	width: min(100%, 560px);
	display: grid;
	gap: 8px;
}
.photo {
	position: relative;
	width: 100%;
	aspect-ratio: 4 / 3;
}
figcaption {
	font-size: 14px;
}
footer {
	margin-top: 24px;
	font-size: 14px;
	opacity: 0.85;
}
footer p {
	margin: 4px 0;
}
.title {
	font-weight: 600;
}
</style>
