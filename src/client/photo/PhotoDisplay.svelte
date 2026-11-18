<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PHOTOS } from "../../data/photos.ts";
import { idlePlaylist } from "../../shared/assignment.ts";
import { IDLE_FRAME_MS } from "../../shared/motion.ts";
import { displayOrderOf } from "../../shared/screens.ts";
import Pairing from "../common/Pairing.svelte";
import PhotoImage from "../common/PhotoImage.svelte";
import { RealtimeClient } from "../lib/realtime.ts";
import { fetchDeviceSession } from "../lib/session.ts";

let { screenId }: { screenId: string } = $props();

const order = $derived(displayOrderOf(screenId, "photo"));
const playlist = idlePlaylist(PHOTOS);
let auth = $state<"checking" | "ok" | "unpaired" | "mismatch">("checking");
let cycle = $state(0);
let imageStatus = $state<Record<string, "loaded" | "failed">>({});
let client: RealtimeClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let disposed = false;

const currentPhoto = $derived(playlist[(cycle + (order ?? 0)) % playlist.length] ?? null);
const currentLoaded = $derived(currentPhoto !== null && imageStatus[currentPhoto.id] === "loaded");
const slots = $derived.by(() => {
	if (playlist.length === 0) return [];
	const indices = cycle > 0 ? [cycle - 1, cycle, cycle + 1] : [cycle, cycle + 1];
	return [...new Set(indices.map((index) => playlist[(index + (order ?? 0)) % playlist.length]))];
});

function stopTimer() {
	if (timer) clearInterval(timer);
	timer = null;
}

onMount(async () => {
	if (order === null) {
		auth = "mismatch";
		return;
	}
	const session = await fetchDeviceSession().catch(() => null);
	if (disposed) return;
	if (!session) {
		auth = "unpaired";
		return;
	}
	if (session.role !== "photo" || session.screenId !== screenId) {
		auth = "mismatch";
		return;
	}
	auth = "ok";
	client = new RealtimeClient({
		role: "photo",
		screenId,
		// 展示状態の更新ではスライドショーの位置を変更しない。
		onState: () => {},
		onStatus: (status) => {
			if (status === "unauthenticated") {
				auth = "unpaired";
				stopTimer();
			}
		},
		checkAuth: async () => {
			const current = await fetchDeviceSession();
			return current?.role === "photo" && current.screenId === screenId;
		},
	});
	client.start();
	if (playlist.length > 1) timer = setInterval(() => (cycle += 1), IDLE_FRAME_MS);
});

onDestroy(() => {
	disposed = true;
	stopTimer();
	client?.stop();
});
</script>

{#if auth === "unpaired"}
	<Pairing />
{:else if auth === "mismatch"}
	<Pairing message="この画面は再登録が必要です。" />
{:else if auth === "ok"}
	<main class="photo-display" data-screen-id={screenId} data-photo-id={currentPhoto?.id}>
		<p class:visible={!currentLoaded}>{EXHIBIT.title}</p>
		<div class="frame">
			{#each slots as photo (photo.id)}
				<div class="photo" class:visible={photo.id === currentPhoto?.id && currentLoaded}>
					<PhotoImage {photo} onstatus={(status) => (imageStatus[photo.id] = status)} />
				</div>
			{/each}
		</div>
	</main>
{/if}

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
