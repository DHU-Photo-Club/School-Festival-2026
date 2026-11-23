<script lang="ts">
	import { onMount } from "svelte";
	import { blur } from "svelte/transition";
	import { cubicInOut } from "svelte/easing";
	import type { ArchivePhoto } from "./detail";
	let { photos, index, select, close, reducedMotion = false }: { photos: readonly ArchivePhoto[]; index: number; select: (index: number) => void; close: () => void; reducedMotion?: boolean } = $props();
	let panel: HTMLDivElement;
	let closeButton: HTMLButtonElement;
	let failed = $state(false);
	const photo = $derived(photos[index]);
	const source = $derived(photo?.fullSrc ?? photo?.src);
	$effect(() => { void source; failed = false; });
	onMount(() => {
		const previous = document.activeElement as HTMLElement | null;
		closeButton.focus({ preventScroll: true });
		return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
	});
	function navigate(direction: number) {
		const next = index + direction;
		if (next >= 0 && next < photos.length) select(next);
	}
	function keyboard(event: KeyboardEvent) {
		if (["Escape", "ArrowLeft", "ArrowRight"].includes(event.key)) {
			event.preventDefault(); event.stopPropagation();
			if (event.key === "Escape") close();
			else navigate(event.key === "ArrowLeft" ? -1 : 1);
		}
		if (event.key !== "Tab") return;
		const controls = [...panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
		if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
		else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div bind:this={panel} class="photo-viewer" role="dialog" tabindex="-1" aria-modal="true" aria-label="写真の詳細" onkeydown={keyboard} onclick={(event) => { if (event.target === event.currentTarget) close(); }} transition:blur|global={{ duration: reducedMotion ? 0 : 420, amount: 8, opacity: 0, easing: cubicInOut }}>
	<div class="viewer-content">
		<div class="viewer-toolbar"><button bind:this={closeButton} class="close" type="button" aria-label="画像詳細を閉じる" onclick={close}><img src="/archive/figma/detail/c691e.svg" alt="" /></button></div>
		<div class="image-frame">
			{#if source && !failed}
				{#key photo.id}<img class="full-photo" src={source} alt={photo.alt} onerror={() => { failed = true; }} />{/key}
			{:else}
				<div class="placeholder" role="img" aria-label={failed ? `${photo.alt}：画像を読み込めませんでした` : `${photo.alt}（準備中）`}></div>
			{/if}
		</div>
		<div class="navigation" role="group" aria-label="写真の切り替え">
			<button type="button" aria-label="前の写真" disabled={index <= 0} onclick={() => navigate(-1)}><img src="/archive/figma/photo/8c611.svg" alt="" /></button>
			<button type="button" aria-label="次の写真" disabled={index >= photos.length - 1} onclick={() => navigate(1)}><img src="/archive/figma/photo/3747a.svg" alt="" /></button>
		</div>
		<p class="screen-reader" role="status">{index + 1} / {photos.length}：{photo.alt}{failed ? "（読み込み失敗）" : ""}</p>
	</div>
</div>

<style>
	.photo-viewer { position:fixed; inset:0; z-index:40; overflow-y:auto; overscroll-behavior:contain; background:rgba(0,0,0,.8); -webkit-backdrop-filter:blur(5px); backdrop-filter:blur(5px); padding:clamp(20px,8.81dvh,77px) max(20px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left)); color:#fff; }
	.viewer-content { width:min(100%,calc(max(120px,100dvh - 270px) * 362 / 479),900px); margin-inline:auto; }
	.viewer-toolbar { display:flex; justify-content:flex-end; }
	button { display:grid; place-items:center; padding:0; border:0; color:white; cursor:pointer; transition:background-color 140ms ease-out; }
	.close { width:51px; height:50px; border-radius:10px; background:#3d3d3d80; -webkit-backdrop-filter:blur(5px); backdrop-filter:blur(5px); }
	button img { display:block; }
	button:focus-visible { outline:2px solid white; outline-offset:3px; }
	button:disabled { opacity:.25; cursor:default; }
	.image-frame { margin-top:27px; width:100%; aspect-ratio:362/479; background:#272727; }
	.full-photo { display:block; width:100%; height:100%; object-fit:contain; }
	.placeholder { width:100%; height:100%; }
	.navigation { display:flex; justify-content:center; gap:9px; margin-top:20px; }
	.navigation button { width:44px; height:44px; background:transparent; border-radius:6px; }
	.screen-reader { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
	@media(hover:hover) and (pointer:fine) { button:not(:disabled):hover { background-color:#ffffff1f; } }
	@media(prefers-reduced-motion:reduce) { button { transition:none; } }
</style>
