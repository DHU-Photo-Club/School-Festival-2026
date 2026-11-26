<script lang="ts">
	import { onMount } from "svelte";
	import { fade } from "svelte/transition";
	import { cubicInOut } from "svelte/easing";
	import ArchiveSymbolShapes from "./ArchiveSymbolShapes.svelte";
	import ArchivePhotoViewer from "./ArchivePhotoViewer.svelte";
	import { PALETTE } from "../../data/palette";
	import { baseColor } from "../../shared/palette";
	import type { ArchiveEntry } from "./entries";
	import type { ArchiveDetailData } from "./detail";
	import { DetailShadeTransition, logoHasExited, shadeMasks } from "./detail-shade";
	let { entry, detail, playing, toggleSound, close, reducedMotion = false }: { entry: ArchiveEntry; detail: ArchiveDetailData; playing: boolean; toggleSound: () => void; close: () => void; reducedMotion?: boolean } = $props();
	let panel: HTMLElement;
	let closeButton: HTMLButtonElement;
	let mark: HTMLDivElement;
	let shade: HTMLDivElement;
	let selectedPhotoId = $state<string | null>(null);
	const photoIndex = $derived(detail.photos.findIndex((photo) => photo.id === selectedPhotoId));
	const logoColors = $derived(entry.colors.map((id) => baseColor(PALETTE.colors.find((color) => color.id === id)!)) as [string, string]);
	onMount(() => {
		const previous = document.activeElement as HTMLElement | null;
		closeButton.focus({ preventScroll: true });
		return () => previous?.focus({ preventScroll: true });
	});
	onMount(() => {
		const transition = new DetailShadeTransition();
		const preference = matchMedia("(prefers-reduced-motion: reduce)");
		let frame = 0;
		function update(now: number, immediate = false) {
			transition.setColored(logoHasExited(mark.getBoundingClientRect().bottom, panel.getBoundingClientRect().top), now, immediate || preference.matches);
			const masks = shadeMasks(transition.sample(now));
			shade.style.setProperty("--shade-color-mask", masks.color);
			shade.style.setProperty("--shade-black-mask", masks.black);
		}
		function animate(now: number) {
			frame = 0; update(now);
			if (transition.running) frame = requestAnimationFrame(animate);
		}
		function schedule() { if (!frame) frame = requestAnimationFrame(animate); }
		function preferenceChanged() { update(performance.now(), preference.matches); schedule(); }
		const resize = new ResizeObserver(schedule);
		resize.observe(panel); resize.observe(mark);
		panel.addEventListener("scroll", schedule, { passive: true });
		preference.addEventListener("change", preferenceChanged);
		update(performance.now(), true);
		return () => { cancelAnimationFrame(frame); resize.disconnect(); panel.removeEventListener("scroll", schedule); preference.removeEventListener("change", preferenceChanged); };
	});
	function keyboard(event: KeyboardEvent) {
		if (event.key === "Escape") { event.preventDefault(); close(); }
		if (event.key !== "Tab") return;
		const controls = [...panel.querySelectorAll<HTMLElement>("button, a[href], [tabindex='0']")];
		const first = controls[0], last = controls.at(-1);
		if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
	}
</script>

<svelte:head><title>{detail.colorName} — {entry.nickname} | あなた色写真展</title></svelte:head>
<div class="detail-transition" transition:fade|global={{ duration: reducedMotion ? 0 : 420, easing: cubicInOut }}>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div bind:this={panel} class="detail-page" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="detail-title" onkeydown={keyboard} inert={photoIndex >= 0} aria-hidden={photoIndex >= 0}>
	<div bind:this={shade} class="top-shade" aria-hidden="true" style:--shade-color-one={logoColors[0]} style:--shade-color-two={logoColors[1]}>
		<div class="shade-black"></div>
		<div class="shade-color"><div class="shade-clouds"></div></div>
	</div>
	<button class="sound" type="button" aria-label={playing ? "BGMをミュート" : "BGMを再生"} aria-pressed={playing} onclick={toggleSound}><img src={playing ? "/archive/figma/67e77.svg" : "/archive/figma/fac56.svg"} alt="" /></button>
	<button bind:this={closeButton} class="close" type="button" aria-label="詳細を閉じて一覧に戻る" onclick={close}><img src="/archive/figma/detail/c691e.svg" alt="" /></button>
	<header>
		<div bind:this={mark} class="mark">
			<svg viewBox="22.0698 0 102.774 102.667" width="120" height="120" role="img" aria-label="あなた色写真展のシンボル">
				<!-- Transparent isolated backdrop matches OrbImage; black here alters hard-light colors. -->
				<ArchiveSymbolShapes colors={logoColors} />
			</svg>
		</div>
		<h1 id="detail-title">{detail.colorName}</h1>
		<p class="nickname">{entry.nickname}</p>
		<p class="description">{detail.description}</p>
	</header>
	<div class="photos" aria-label="展示写真">
		{#each detail.photos as photo (photo.id)}
			<button class="photo-button" type="button" aria-label={`${photo.alt}の詳細を開く`} onclick={() => { selectedPhotoId = photo.id; }}>
				{#if photo.src}<img class="photo" src={photo.src} alt={photo.alt} loading="lazy" />{:else}<span class="photo" role="img" aria-label={`${photo.alt}（準備中）`}></span>{/if}
			</button>
		{/each}
	</div>
</div>
{#if photoIndex >= 0}
	<ArchivePhotoViewer photos={detail.photos} index={photoIndex} select={(index) => { selectedPhotoId = detail.photos[index].id; }} close={() => { selectedPhotoId = null; }} {reducedMotion} />
{/if}
</div>

<style>
	.detail-transition { position:fixed; inset:0; z-index:20; }
	.detail-page { position:fixed; inset:0; z-index:20; overflow-y:auto; overscroll-behavior:contain; background:#000; color:#fff; padding:127px 20px max(24px,env(safe-area-inset-bottom)); font-family:"Shippori Mincho B1","Hiragino Mincho ProN","Yu Mincho",serif; }
	.top-shade { position:fixed; inset:0 0 auto; height:100px; z-index:2; pointer-events:none; }
	.shade-black, .shade-color, .shade-clouds { position:absolute; inset:0; }
	.shade-black { background:linear-gradient(#000 25%,transparent); -webkit-mask-image:var(--shade-black-mask,linear-gradient(#000,#000)); mask-image:var(--shade-black-mask,linear-gradient(#000,#000)); }
	.shade-color { -webkit-mask-image:var(--shade-color-mask,linear-gradient(transparent,transparent)); mask-image:var(--shade-color-mask,linear-gradient(transparent,transparent)); }
	.shade-clouds {
		opacity:.85;
		background:
			radial-gradient(ellipse 53% 125% at 12% -18%,var(--shade-color-one) 0%,transparent 74%),
			radial-gradient(ellipse 47% 145% at 90% -8%,var(--shade-color-two) 0%,transparent 76%),
			radial-gradient(ellipse 43% 100% at 67% 22%,var(--shade-color-one) 0%,transparent 78%),
			radial-gradient(ellipse 36% 110% at 35% 8%,var(--shade-color-two) 0%,transparent 75%);
		-webkit-mask-image:linear-gradient(#000 0%,transparent 100%); mask-image:linear-gradient(#000 0%,transparent 100%);
	}
	button { position:fixed; top:max(27px,env(safe-area-inset-top)); z-index:3; width:51px; height:50px; padding:0; display:grid; place-items:center; border:0; border-radius:10px; background:#3d3d3d80; backdrop-filter:blur(5px); cursor:pointer; transition:background-color 140ms ease-out; }
	button img { display:block; }
	.sound { left:max(20px,env(safe-area-inset-left)); } .close { right:max(20px,env(safe-area-inset-right)); }
	button:focus-visible { outline:2px solid white; outline-offset:3px; }
	header { max-width:362px; margin:auto; text-align:center; }
	.mark { display:flex; justify-content:center; height:120px; isolation:isolate; }
	.mark svg { display:block; isolation:isolate; }
	h1 { margin:18px 0 0; font-size:35px; line-height:50px; font-weight:500; overflow-wrap:anywhere; }
	.nickname { margin:0; color:#b9b9b9; font-size:16.25px; line-height:24px; overflow-wrap:anywhere; }
	.description { margin:32px 0 0; font-size:16.25px; line-height:1.45; color:#b9b9b9; overflow-wrap:anywhere; white-space:pre-line; }
	.photos { max-width:960px; margin:35px auto 0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; }
	.photo { display:block; width:100%; aspect-ratio:177.5/235; object-fit:cover; background:#272727; }
	.photo-button { position:relative; inset:auto; z-index:auto; display:block; width:100%; height:auto; border-radius:0; background:#272727; backdrop-filter:none; cursor:zoom-in; }
	@media(min-width:768px) {
		header { max-width:640px; }
		.description { line-height:1.7; }
		.photos { grid-template-columns:repeat(3,minmax(0,1fr)); }
	}
	@media(min-width:1100px) { .photos { grid-template-columns:repeat(4,minmax(0,1fr)); } }
	@media(hover:hover) and (pointer:fine) { button:hover { background:#545454aa; } }
	@media(prefers-reduced-motion:reduce) { button { transition:none; } }
</style>
