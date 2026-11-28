<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { EXHIBIT } from "../../data/exhibit.ts";
import { RealtimeClient } from "../lib/realtime.ts";

/** URLの画面番号（`/photo/2` の `2`）。 */
let { screen }: { screen: number } = $props();

let client: RealtimeClient | null = null;

onMount(() => {
	// 展示状態は使わない。管理画面の端末一覧に表示するためだけに接続する。
	client = new RealtimeClient({ role: "photo", screen, onState: () => {}, onStatus: () => {} });
	client.start();
});

onDestroy(() => {
	client?.stop();
});
</script>

<main class="photo-display" data-screen={screen}>
	<p>{EXHIBIT.title}</p>
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
p {
	margin: 0;
	color: #e8e6e3;
	text-align: center;
	font-size: 6vmin;
	font-weight: 500;
	letter-spacing: 0.12em;
}
</style>
