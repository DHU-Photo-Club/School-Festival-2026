<script lang="ts">
	import { onMount } from "svelte";
	import { createOrbCanvas } from "./orb-canvas";
	import { watchOrbInteraction } from "./orb-interaction";

	let { src, motionKey, paused = false, scale = 1 }: { src: string; motionKey: string; paused?: boolean; scale?: number } = $props();
	let host: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let renderer = $state<ReturnType<typeof createOrbCanvas>>();
	$effect(() => {
		const next = createOrbCanvas(canvas, host, src, motionKey);
		renderer = next;
		return () => next.destroy();
	});
	$effect(() => { renderer?.configure({ paused, scale }); });
	onMount(() => watchOrbInteraction(host));
</script>

<div bind:this={host} class="orb-image" aria-hidden="true">
	<div class="orb-pointer-response"><div class="orb-artwork"><img class="orb-still" {src} alt="" /><canvas bind:this={canvas} width="0" height="0"></canvas></div></div>
</div>

<style>
	.orb-image { position: relative; flex: none; width: 146.381px; height: 138.211px; margin-inline: auto; isolation: isolate; }
	.orb-pointer-response { position: absolute; inset: 0; transform: translate(var(--orb-magnet-x, 0px), var(--orb-magnet-y, 0px)); }
	.orb-artwork { position: absolute; inset: -96px; filter: var(--orb-intro-filter, none); pointer-events: none; }
	.orb-still { position: absolute; left: 50%; top: 50%; width: 146.381px; height: 138.211px; transform: translate(-50%, -50%); }
	.orb-image:global([data-rendered="true"]) .orb-still { visibility: hidden; }
	canvas { position: absolute; left: 50%; top: 50%; width: 240px; height: 240px; transform: translate(-50%, -50%); }
</style>
