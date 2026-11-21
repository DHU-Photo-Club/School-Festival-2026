<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PHOTOS } from "../../data/photos.ts";
import { idlePlaylist } from "../../shared/assignment.ts";
import { IDLE_FRAME_MS } from "../../shared/motion.ts";
import PhotoImage from "../common/PhotoImage.svelte";
import { RealtimeClient } from "../lib/realtime.ts";

/** URLの画面番号（`/photo/2` の `2`）。 */
let { screen }: { screen: number } = $props();

// svelte-ignore state_referenced_locally
const order = screen - 1;
const playlist = idlePlaylist(PHOTOS);
let cycle = $state(0);
let imageStatus = $state<Record<string, "loaded" | "failed">>({});
let client: RealtimeClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const currentPhoto = $derived(playlist[(cycle + order) % playlist.length] ?? null);
const currentLoaded = $derived(currentPhoto !== null && imageStatus[currentPhoto.id] === "loaded");
const slots = $derived.by(() => {
	if (playlist.length === 0) return [];
	const indices = cycle > 0 ? [cycle - 1, cycle, cycle + 1] : [cycle, cycle + 1];
	return [...new Set(indices.map((index) => playlist[(index + order) % playlist.length]))];
});

onMount(() => {
	// 展示状態は使わない。管理画面の端末一覧に表示するためだけに接続する。
	client = new RealtimeClient({ role: "photo", screen, onState: () => {}, onStatus: () => {} });
	client.start();
	if (playlist.length > 1) timer = setInterval(() => (cycle += 1), IDLE_FRAME_MS);
});

onDestroy(() => {
	if (timer) clearInterval(timer);
	client?.stop();
});
</script>

<main class="photo-display" data-screen={screen} data-photo-id={currentPhoto?.id}>
	<p class:visible={!currentLoaded}>{EXHIBIT.title}</p>
	<div class="frame">
		{#each slots as photo (photo.id)}
			<div class="photo" class:visible={photo.id === currentPhoto?.id && currentLoaded}>
				<PhotoImage {photo} onstatus={(status) => (imageStatus[photo.id] = status)} />
			</div>
		{/each}
	</div>
</main>

<style>
.photo-display {
	position: fixed;
	inset: 0;
	overflow: hidden;
	background: #0b0b0b;
	cursor: none;
}
.frame {
	position: absolute;
	inset: clamp(32px, 5vmin, 96px);
}
.photo,
p {
	position: absolute;
	inset: 0;
	opacity: 0;
	transition: opacity 1s ease-in-out;
}
.visible {
	opacity: 1;
}
p {
	display: grid;
	place-content: center;
	margin: 0;
	color: #e8e6e3;
	text-align: center;
	font-size: 6vmin;
	font-weight: 500;
	letter-spacing: 0.12em;
}
@media (prefers-reduced-motion: reduce) {
	.photo,
	p {
		transition: none;
	}
}
</style>
