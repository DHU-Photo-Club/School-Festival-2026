<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PHOTOS } from "../../data/photos.ts";
import { resultPhotoFor } from "../../shared/assignment.ts";
import type { DisplayState } from "../../shared/types.ts";
import PhotoImage from "../common/PhotoImage.svelte";
import { RealtimeClient } from "../lib/realtime.ts";

/** URLの画面番号（`/photo/2` の `2`）。 */
let { screen }: { screen: number } = $props();

let client: RealtimeClient | null = null;
let exhibit = $state<DisplayState | null>(null);
let resultStarted = $state(false);
let photoStatus = $state<{ key: string; status: "loaded" | "failed" } | null>(null);

// 判定中に届く結果を先読みし、画面番号順に選定写真を一枚ずつ割り当てる。
const photo = $derived(
	(exhibit?.phase === "judging" || exhibit?.phase === "result") && exhibit.result
		? resultPhotoFor(PHOTOS, exhibit.result.photoIds, screen - 1)
		: null,
);
const photoKey = $derived(photo ? `${exhibit?.sessionId}:${photo.id}` : null);
const photoVisible = $derived(
	resultStarted && photoKey !== null && photoStatus?.key === photoKey && photoStatus.status === "loaded",
);

$effect(() => {
	resultStarted = exhibit?.phase === "result";
	if (exhibit?.phase !== "judging" || !exhibit.result || exhibit.phaseEndsAt === null || !client) return;
	// iPad・展示ディスプレイと同じ補正済みサーバー時刻で、結果の先出しを防ぐ。
	const remaining = exhibit.phaseEndsAt - client.serverNow();
	if (remaining <= 0) {
		resultStarted = true;
		return;
	}
	const timer = window.setTimeout(() => (resultStarted = true), remaining);
	return () => window.clearTimeout(timer);
});

onMount(() => {
	client = new RealtimeClient({
		role: "photo",
		screen,
		onState: (state) => (exhibit = state as DisplayState),
		onStatus: () => {},
	});
	client.start();
});

onDestroy(() => {
	client?.stop();
});
</script>

<main class="photo-display" data-screen={screen} data-phase={exhibit?.phase ?? "connecting"}>
	{#if photo && photoKey}
		{@const key = photoKey}
		{#key key}
			<div class="photo" class:visible={photoVisible} aria-hidden={!photoVisible}>
				<PhotoImage {photo} onstatus={(status) => (photoStatus = { key, status })} />
			</div>
		{/key}
	{/if}
	{#if !photoVisible}
		<p>{EXHIBIT.title}</p>
	{/if}
</main>

<style>
.photo-display {
	position: fixed;
	inset: 0;
	display: grid;
	place-content: center;
	overflow: hidden;
	background: #0b0b0b;
	cursor: none;
}
.photo {
	position: absolute;
	inset: 0;
	visibility: hidden;
}
.photo.visible {
	visibility: visible;
}
p {
	margin: 0;
	color: #e8e6e3;
	text-align: center;
	font-size: 6vmin;
	font-weight: 500;
	letter-spacing: 0.12em;
}
</style>
