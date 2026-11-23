<script lang="ts">
	import { onMount } from "svelte";
	import { animatedOrbSvg, orbDrift, orbElapsedSeconds, watchOrbActivity } from "./orb-motion";
	import { watchOrbInteraction } from "./orb-interaction";

	let { src, motionKey }: { src: string; motionKey: string } = $props();
	const componentId = $props.id();
	const namespace = `orb-${componentId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
	let host: HTMLDivElement;
	let active = $state(false);
	let elapsed = $state(0);
	const svg = $derived(animatedOrbSvg(src, namespace, motionKey));
	const drift = $derived(orbDrift(motionKey));

	onMount(() => watchOrbActivity(host, (shouldRun) => {
		if (shouldRun && !active) elapsed = orbElapsedSeconds();
		active = shouldRun;
	}));
	onMount(() => watchOrbInteraction(host));
</script>

<!-- Trusted SVG from local templates. Transforms below act on shards, never on the orb. -->
<div bind:this={host} class="orb-image" data-active={active} style:--orb-elapsed={`-${elapsed}s`} style:--orb-drift-duration={`${drift.seconds}s`} style:--orb-drift-offset={`${drift.offsetSeconds}s`} style:--orb-drift-x={`${drift.x}px`} style:--orb-drift-y={`${drift.y}px`} aria-hidden="true">
	<div class="orb-drift"><div class="orb-pointer-response"><div class="orb-artwork">{@html svg}</div></div></div>
</div>

<style>
	.orb-image { position: relative; flex: none; width: 146.381px; height: 138.211px; margin-inline: auto; isolation: isolate; }
	.orb-pointer-response { position: absolute; inset: 0; transform: translate(var(--orb-magnet-x, 0px), var(--orb-magnet-y, 0px)); }
	.orb-drift { position: absolute; inset: 0; animation: orb-drift var(--orb-drift-duration) ease-in-out infinite; animation-delay: calc(var(--orb-elapsed) - var(--orb-drift-offset)); animation-play-state: paused; }
	.orb-image[data-active="true"] .orb-drift { animation-play-state: running; }
	/* Space for outward translation, spring overshoot and the entrance blur. */
	.orb-artwork { position: absolute; inset: -96px; filter: var(--orb-intro-filter, none); pointer-events: none; }
	.orb-image :global(svg) { position: absolute; left: 50%; top: 50%; display: block; overflow: visible; transform-origin: 0 0; transform: translate(var(--orb-origin-x), var(--orb-origin-y)) scale(2.323821467976); }
	.orb-image :global(.orb-glow) { opacity: 1; }
	.orb-image :global(.orb-glow-hover) { opacity: 1; }
	/* Both transforms use the same spring progress; opacity remains a smooth bounded fade. */
	.orb-image :global(.orb-glow-boost) { opacity: var(--orb-proximity, 0); transform: scale(calc(1 + .6 * var(--orb-expansion, 0))); transition: opacity 420ms ease-out; }
	.orb-image[data-active="true"] :global(.orb-shard-rotation) {
		animation: orb-turn var(--orb-duration) linear infinite;
		animation-direction: var(--orb-direction);
		animation-delay: calc(var(--orb-elapsed) - var(--orb-offset));
	}
	.orb-image[data-active="true"] :global(.orb-support-rotation) {
		animation: orb-support-drift var(--orb-duration) ease-in-out infinite;
		animation-delay: calc(var(--orb-elapsed) - var(--orb-offset));
	}
	.orb-image[data-active="true"] :global(.orb-glow) {
		animation: orb-breathe var(--orb-duration) ease-in-out infinite;
		animation-delay: calc(var(--orb-elapsed) - var(--orb-offset));
	}
	@keyframes orb-turn { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
	@keyframes orb-support-drift { 0%, 100% { transform: rotate(var(--orb-drift-negative)); } 50% { transform: rotate(var(--orb-drift)); } }
	@keyframes orb-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
	@keyframes orb-drift {
		0%, 100% { transform: translate(0, calc(-1 * var(--orb-drift-y))); }
		25% { transform: translate(var(--orb-drift-x), 0); }
		50% { transform: translate(0, var(--orb-drift-y)); }
		75% { transform: translate(calc(-1 * var(--orb-drift-x)), 0); }
	}
	@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
		.orb-image :global(.orb-shard), .orb-image :global(.orb-support) { transform: translate(calc(var(--orb-spread-x) * var(--orb-expansion, 0)), calc(var(--orb-spread-y) * var(--orb-expansion, 0))); }
		.orb-image:global([data-orb-hover="true"]) :global(.orb-glow-boost) { opacity: 1; }
	}
	@media (prefers-reduced-motion: reduce) {
		.orb-drift, .orb-image :global(.orb-shard-rotation), .orb-image :global(.orb-support-rotation), .orb-image :global(.orb-glow) { animation: none !important; }
		.orb-image :global(.orb-glow-boost) { opacity: 0; transition: none; }
	}
</style>
