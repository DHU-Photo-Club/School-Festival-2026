<script lang="ts">
	import { onMount } from "svelte";
	import { fade } from "svelte/transition";
	import { cubicInOut } from "svelte/easing";
	import type { ArchivePhoto } from "./detail";
	let { photos, index, select, close, reducedMotion = false }: { photos: readonly ArchivePhoto[]; index: number; select: (index: number) => void; close: () => void; reducedMotion?: boolean } = $props();
	let panel: HTMLDivElement;
	let closeButton: HTMLButtonElement;
	let failed = $state(false);
	const photo = $derived(photos[index]);
	const source = $derived(photo?.fullSrc ?? photo?.src);
	$effect(() => { void source; failed = false; });
	let imageFrame: HTMLDivElement;
	let zoom = $state(1), offsetX = $state(0), offsetY = $state(0);
	const touches = new Map<number, { x: number; y: number }>();
	let swipeStart = { x: 0, y: 0 }, pinched = false, canSwipe = false;
	$effect(() => { void photo.id; zoom = 1; offsetX = offsetY = 0; touches.clear(); });
	function constrain() {
		const x = imageFrame.clientWidth * (zoom - 1) / 2;
		const y = imageFrame.clientHeight * (zoom - 1) / 2;
		offsetX = Math.max(-x, Math.min(x, offsetX)); offsetY = Math.max(-y, Math.min(y, offsetY));
	}
	function touchDown(event: PointerEvent) {
		if (event.pointerType === "mouse") return;
		if (!touches.size) { swipeStart = { x: event.clientX, y: event.clientY }; pinched = false; canSwipe = zoom <= 1.01; }
		touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (touches.size > 1) pinched = true;
		imageFrame.setPointerCapture(event.pointerId);
	}
	function touchMove(event: PointerEvent) {
		if (!touches.has(event.pointerId)) return;
		const before = [...touches.values()];
		touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
		const after = [...touches.values()];
		if (after.length >= 2) {
			const distance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
			if (distance < 1) return;
			const next = Math.max(1, Math.min(4, zoom * Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y) / distance));
			const rect = imageFrame.getBoundingClientRect();
			const oldX = (before[0].x + before[1].x) / 2 - rect.left - rect.width / 2;
			const oldY = (before[0].y + before[1].y) / 2 - rect.top - rect.height / 2;
			const newX = (after[0].x + after[1].x) / 2 - rect.left - rect.width / 2;
			const newY = (after[0].y + after[1].y) / 2 - rect.top - rect.height / 2;
			offsetX = newX - (oldX - offsetX) * next / zoom;
			offsetY = newY - (oldY - offsetY) * next / zoom;
			zoom = next; constrain();
		} else if (zoom > 1) {
			offsetX += after[0].x - before[0].x; offsetY += after[0].y - before[0].y; constrain();
		}
	}
	function touchUp(event: PointerEvent) {
		if (!touches.delete(event.pointerId) || touches.size) return;
		const dx = event.clientX - swipeStart.x, dy = event.clientY - swipeStart.y;
		if (event.type === "pointerup" && canSwipe && !pinched && Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.3) navigate(dx < 0 ? 1 : -1);
		constrain();
	}
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
<div bind:this={panel} class="photo-viewer" role="dialog" tabindex="-1" aria-modal="true" aria-label="写真の詳細" onkeydown={keyboard} onclick={(event) => { if (event.target === event.currentTarget) close(); }} transition:fade|global={{ duration: reducedMotion ? 0 : 420, easing: cubicInOut }}>
	<div class="viewer-content">
		<div class="viewer-toolbar"><button bind:this={closeButton} class="close" type="button" aria-label="画像詳細を閉じる" onclick={close}><img src="/archive/figma/detail/c691e.svg" alt="" /></button></div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div bind:this={imageFrame} class="image-frame" onpointerdown={touchDown} onpointermove={touchMove} onpointerup={touchUp} onpointercancel={touchUp} onlostpointercapture={touchUp}>
			<div class="image-transform" style:transform={`translate(${offsetX}px, ${offsetY}px) scale(${zoom})`}>
			{#if source && !failed}
				{#key photo.id}<img class="full-photo" src={source} alt={photo.alt} onerror={() => { failed = true; }} />{/key}
			{:else}
				<div class="placeholder" role="img" aria-label={failed ? `${photo.alt}：画像を読み込めませんでした` : `${photo.alt}（準備中）`}></div>
			{/if}
			</div>
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
	.image-frame { margin-top:27px; width:100%; aspect-ratio:362/479; background:#272727; overflow:hidden; touch-action:none; user-select:none; -webkit-user-select:none; }
	.image-transform { width:100%; height:100%; transform-origin:center; }
	.full-photo { -webkit-user-drag:none; display:block; width:100%; height:100%; object-fit:contain; }
	.placeholder { width:100%; height:100%; }
	.navigation { display:flex; justify-content:center; gap:9px; margin-top:20px; }
	.navigation button { width:44px; height:44px; background:transparent; border-radius:6px; }
	.screen-reader { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
	@media(hover:hover) and (pointer:fine) { button:not(:disabled):hover { background-color:#ffffff1f; } }
	@media(prefers-reduced-motion:reduce) { button { transition:none; } }
</style>
