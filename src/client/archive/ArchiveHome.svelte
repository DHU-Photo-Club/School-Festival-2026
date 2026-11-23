<script lang="ts">
	import { onMount, setContext, tick } from "svelte";
	import { UI_ENTRANCE_CONTEXT, UiEntranceController } from "./ui-entrance";
	import { blur } from "svelte/transition";
	import { cubicInOut } from "svelte/easing";
	import { BgmPlayer, type BgmStatus } from "./bgm-player";
	import { previewEntries, type ArchiveEntry } from "./entries";
	import ScatterView from "./ScatterView.svelte";
	import ArchiveLogo from "./ArchiveLogo.svelte";
	import OrbImage from "./OrbImage.svelte";

	let { entries = previewEntries }: { entries?: ArchiveEntry[] } = $props();
	let nickname = $state("");
	let bgm: HTMLAudioElement;
	let player: BgmPlayer | undefined;
	let sound = $state<BgmStatus>({ state: "muted", error: "" });
	onMount(() => {
		player = new BgmPlayer(bgm, (status) => { sound = status; });
		return () => player?.dispose();
	});
	let viewMode = $state<"scatter" | "grid">("scatter");
	let hasSwitchedView = $state(false);
	let initialEntrance = $state(true);
	let canvas: HTMLDivElement;
	const uiIntro = new UiEntranceController(() => canvas, () => { initialEntrance = false; });
	setContext(UI_ENTRANCE_CONTEXT, uiIntro);
	onMount(() => { uiIntro.start(); return () => uiIntro.destroy(); });
	let reducedMotion = $state(false);
	onMount(() => {
		const preference = matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => { reducedMotion = preference.matches; };
		update();
		preference.addEventListener("change", update);
		return () => preference.removeEventListener("change", update);
	});
	let viewTransition = $derived({ duration: hasSwitchedView && !reducedMotion ? 420 : 0, amount: 8, opacity: 0, easing: cubicInOut });
	let searchQuery = $state("");
	let selectedIndex = $state(0);
	let searchRequest = $state(0);
	let gridScroll = $state<HTMLElement>();
	let matches = $derived(searchQuery ? entries.filter((entry) =>
		entry.nickname.normalize("NFKC").toLocaleLowerCase("ja").includes(searchQuery.normalize("NFKC").toLocaleLowerCase("ja"))
	) : []);
	let targetId = $derived(matches[selectedIndex]?.id ?? null);

	async function centerGridTarget() {
		await tick();
		const card = [...(gridScroll?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? [])].find((item) => item.dataset.entryId === targetId);
		if (card && gridScroll) gridScroll.scrollTo({ top: card.offsetTop - (gridScroll.clientHeight - card.offsetHeight) / 2, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
	}

	function search(event: SubmitEvent) {
		event.preventDefault();
		searchQuery = nickname.trim();
		selectedIndex = 0;
		searchRequest++;
		(event.currentTarget as HTMLFormElement).querySelector("input")?.blur();
		if (viewMode === "grid") void centerGridTarget();
	}

	function nextResult(direction: number) {
		selectedIndex = (selectedIndex + direction + matches.length) % matches.length;
		searchRequest++;
		if (viewMode === "grid") void centerGridTarget();
	}

	function cancelSearch() {
		searchQuery = "";
		selectedIndex = 0;
		searchRequest++;
		if (gridScroll) gridScroll.scrollTo({ top: gridScroll.scrollTop, behavior: "instant" });
	}

	function clearSearch() {
		nickname = "";
		cancelSearch();
	}

	function changeMode(mode: "scatter" | "grid") {
		if (mode === viewMode) return;
		hasSwitchedView = true;
		initialEntrance = false;
		viewMode = mode;
		if (mode === "grid" && targetId) void centerGridTarget();
	}

</script>

<svelte:head>
	<meta name="theme-color" content="#000000" />
	<meta name="description" content="あなた色写真展の写真アーカイブ" />
</svelte:head>

{#snippet brand()}
	<div class="brand">
		<div class="brand-anchor"><ArchiveLogo /></div>
	</div>
{/snippet}

<main class="archive-page" data-layout={viewMode}>
	<div bind:this={canvas} class="archive-canvas">

	{#if viewMode === "grid"}
		<div class="mode-layer" transition:blur={viewTransition} inert={viewMode !== "grid"} aria-hidden={viewMode !== "grid"}>
		<section bind:this={gridScroll} class="grid-scroll" aria-label="写真のグリッド">
			<header class="grid-header">{@render brand()}</header>
			<div class="photo-grid">
				{#each entries as entry (entry.id)}
					<figure class="grid-card" class:is-target={targetId === entry.id} data-entry-id={entry.id}>
						<div class="grid-orb"><OrbImage src={entry.gridImage} motionKey={entry.id} /></div>
						<figcaption>{entry.nickname}</figcaption>
					</figure>
				{:else}
					<p class="empty-results" role="status">該当するニックネームが見つかりません</p>
				{/each}
			</div>
		</section>
		</div>
	{:else}
		<div class="mode-layer" transition:blur={viewTransition} inert={viewMode !== "scatter"} aria-hidden={viewMode !== "scatter"}>
			<ScatterView {entries} {targetId} {searchRequest} intro={initialEntrance} onIntroComplete={(interrupted) => { initialEntrance = false; if (interrupted) uiIntro.finish(true); }}>{@render brand()}</ScatterView>
		</div>
	{/if}

	<div class="edge-fade edge-fade-top" aria-hidden="true"></div>
	<div class="edge-fade edge-fade-bottom" aria-hidden="true"></div>
	<audio bind:this={bgm} src="/archive/audio/BGM01.m4a" preload="none" loop muted></audio>
	<button
		class="sound-button"
		use:uiIntro.control
		type="button"
		aria-label={sound.state === "playing" ? "BGMをミュート" : sound.state === "starting" ? "BGMの再生を中止" : "BGMのミュートを解除"}
		aria-pressed={sound.state === "playing"}
		aria-busy={sound.state === "starting"}
		title={sound.state === "playing" ? "BGMをミュート" : "BGMを再生"}
		onclick={() => player?.toggle()}
	>
		<span class="ui-surface" aria-hidden="true" use:uiIntro.part={{ group: "sound", layer: 0 }}></span>
		<img src={sound.state === "playing" ? "/archive/figma/67e77.svg" : "/archive/figma/fac56.svg"} alt="" use:uiIntro.part={{ group: "sound", layer: 1 }} />
	</button>
	{#if sound.error}<p class="sound-error" role="status">{sound.error}</p>{/if}

	{#if searchQuery}
		<div class="search-results" role="group" aria-label="検索結果">
			{#if matches.length > 1}<button type="button" aria-label="前の検索結果" onclick={() => nextResult(-1)}>‹</button>{/if}
			<span role="status">{matches.length ? `${selectedIndex + 1} / ${matches.length} 件` : "見つかりませんでした"}</span>
			{#if matches.length > 1}<button type="button" aria-label="次の検索結果" onclick={() => nextResult(1)}>›</button>{/if}
		</div>
	{/if}
	<form class="archive-toolbar" role="search" onsubmit={search} use:uiIntro.control>
		<span class="ui-surface" aria-hidden="true" use:uiIntro.part={{ group: "search", layer: 0 }}></span>
		<label class="search-field">
			<img src="/archive/figma/1a63a.svg" alt="" use:uiIntro.part={{ group: "search", layer: 1 }} />
			<input use:uiIntro.part={{ group: "search", layer: 2 }} bind:value={nickname} oninput={(event) => { if (!event.currentTarget.value.trim()) cancelSearch(); }} type="search" placeholder="あなたのニックネームを検索..." aria-label="ニックネームを検索" />
		</label>
		{#if nickname.length > 0}
			<button class="search-clear" type="button" aria-label="入力をクリアして検索をキャンセル" onclick={clearSearch}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" /></svg>
			</button>
		{/if}
	</form>
		<div class="view-switch" data-mode={viewMode} role="group" aria-label="表示形式" use:uiIntro.control>
			<span class="ui-surface" aria-hidden="true" use:uiIntro.part={{ group: "view", layer: 0 }}></span>
			<div class="view-highlight-position" aria-hidden="true">
				<span class="view-highlight" use:uiIntro.part={{ group: "view", layer: 1 }}></span>
			</div>
			<button
				type="button"
				aria-label="散らばって表示"
				aria-pressed={viewMode === "scatter"}
				onclick={() => changeMode("scatter")}
			>
				<img src="/archive/figma/a28e7.svg" alt="" use:uiIntro.part={{ group: "view", layer: 2, item: 0 }} />
			</button>
			<button
				type="button"
				aria-label="グリッド表示"
				aria-pressed={viewMode === "grid"}
				onclick={() => changeMode("grid")}
			>
				<img src="/archive/figma/40050.svg" alt="" use:uiIntro.part={{ group: "view", layer: 2, item: 1 }} />
			</button>
		</div>
	</div>
</main>

<style>
	.archive-page {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		overflow: hidden;
		background: #000;
		color: #fff;
		isolation: isolate;
		--edge-gap: 20px;
		--side-gap: max(var(--edge-gap), env(safe-area-inset-left), env(safe-area-inset-right));
		--bottom-gap: max(var(--edge-gap), env(safe-area-inset-bottom));
	}

	.archive-canvas {
		position: relative;
		width: 100%;
		height: 100dvh;
		overflow: hidden;
		background:
			radial-gradient(ellipse 58% 42% at 50% 51%, rgba(36, 36, 36, 0.34) 0%, rgba(13, 13, 13, 0.19) 48%, transparent 100%),
			#000;
	}

	.mode-layer {
		position: absolute;
		inset: 0;
		z-index: 0;
	}
	.mode-layer[inert] { pointer-events: none; }

	.brand {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.brand-anchor {
		position: absolute;
		left: 50%;
		top: var(--brand-center-y, 49.3%);
		width: min(186.33616px, calc(100% - 40px));
		transform: translate(-50%, -50%);
		filter: var(--logo-intro-filter, none);
	}

	.archive-toolbar {
		position: absolute;
		z-index: 4;
		left: 50%;
		width: min(560px, calc(100% - var(--side-gap) - var(--side-gap)));
		transform: translateX(-50%);
		bottom: var(--bottom-gap);
		display: flex;
		align-items: center;
		gap: 0;
		height: 50px;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: 10px;
		background: transparent;
	}

	.search-field {
		position: relative;
		z-index: 1;
		min-width: 0;
		flex: 1;
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 0 13px;
	}

	.search-field > img {
		flex: 0 0 18px;
		width: 18px;
		height: 18px;
	}

	.search-field input {
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: #fff;
		font-family: Inter, Arial, "Noto Sans JP", sans-serif;
		font-size: 16px;
		font-weight: 400;
		letter-spacing: 0;
	}

	.search-field input::placeholder { color: #9a9a9a; }
	.search-field input::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
	.search-clear {
		position: relative;
		z-index: 1;
		flex: 0 0 44px;
		width: 44px;
		height: 44px;
		margin-right: 3px;
		padding: 0;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: #ccc;
		cursor: pointer;
		touch-action: manipulation;
	}
	.search-clear:active { color: #fff; background: #ffffff14; }
	.search-clear:focus-visible { outline: 1px solid #fff; outline-offset: -2px; }

	.ui-surface {
		position: absolute;
		inset: 0;
		z-index: 0;
		border-radius: inherit;
		background: rgba(61, 61, 61, 0.5);
		-webkit-backdrop-filter: blur(5px);
		backdrop-filter: blur(5px);
		pointer-events: none;
	}
	.sound-button, .view-switch { z-index: 4; border: 0; border-radius: 10px; background: transparent; }
	.sound-button > img, .view-switch button > img { position: relative; z-index: 1; }

	.sound-button {
		position: absolute;
		left: var(--side-gap);
		top: max(27px, env(safe-area-inset-top));
		width: 51px;
		height: 50px;
		display: grid;
		place-items: center;
		padding: 0;
	}

	.sound-button { cursor: pointer; touch-action: manipulation; }
	.sound-button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
	.sound-error { position: absolute; z-index: 4; top: 84px; left: var(--side-gap); max-width: calc(100% - 180px); margin: 0; color: #ddd; font: 12px/1.6 system-ui, sans-serif; }

	.view-switch {
		position: absolute;
		top: max(27px, env(safe-area-inset-top));
		right: var(--side-gap);
		width: 98px;
		height: 50px;
		padding: 6px;
		justify-content: space-between;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	/* Position and entrance transforms live on separate layers so both can run independently. */
	.view-highlight-position {
		position: absolute;
		left: 6px;
		top: 50%;
		width: 39px;
		height: 39px;
		pointer-events: none;
		transform: translate(0, -50%);
		transition: transform 300ms cubic-bezier(.22, 1, .36, 1);
	}
	.view-switch[data-mode="grid"] .view-highlight-position { transform: translate(calc(100% + 8px), -50%); }
	.view-highlight { position: absolute; inset: 0; border-radius: 4px; background: #5e5e5e; }
	@media (prefers-reduced-motion: reduce) {
		.view-highlight-position { transition: none; }
	}

	.view-switch button {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 39px;
		height: 39px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.view-switch button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
	.view-switch button img { display: block; }

	.grid-header {
		position: relative;
		height: 38.787dvh;
	}

	.grid-header .brand-anchor {
		top: 23.33dvh;
	}

	.grid-scroll {
		--grid-edge-fade: min(40px, 25%);
		position: absolute;
		inset: 0 0 calc(var(--bottom-gap) + 70px);
		overflow-y: auto;
		overscroll-behavior-y: contain;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: thin;
		scrollbar-color: #555 transparent;
		/* Keep the scroll boundaries fixed, with zero opacity exactly at each edge. */
		-webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 var(--grid-edge-fade), #000 calc(100% - var(--grid-edge-fade)), transparent 100%);
		mask-image: linear-gradient(to bottom, transparent 0%, #000 var(--grid-edge-fade), #000 calc(100% - var(--grid-edge-fade)), transparent 100%);
		-webkit-mask-size: 100% 100%;
		mask-size: 100% 100%;
		-webkit-mask-repeat: no-repeat;
		mask-repeat: no-repeat;
	}


	.photo-grid {
		display: grid;
		width: 100%;
		max-width: 960px;
		margin-inline: auto;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 32px 0;
		padding: 0 40px 24px 20px;
	}

	@media (min-width: 640px) {
		.grid-header { height: clamp(280px, 38.787dvh, 360px); }
		.grid-header .brand-anchor { top: clamp(170px, 23.33dvh, 220px); }
		.photo-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 40px 24px;
			padding-inline: max(24px, var(--side-gap));
		}
	}
	@media (min-width: 960px) {
		.photo-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
	}

	.grid-card {
		min-width: 0;
		margin: 0;
		text-align: center;
	}

	.grid-orb {
		position: relative;
		z-index: 0;
		display: flex;
		align-items: end;
		justify-content: center;
		height: 138.207px;
	}


	.grid-card figcaption {
		position: relative;
		z-index: 1;
		margin-top: 4px;
		font-family: "Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif;
		font-size: 12.781px;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.empty-results {
		grid-column: 1 / -1;
		margin: 20px 0;
		color: #9a9a9a;
		font-family: sans-serif;
		font-size: 13px;
		text-align: center;
	}

	.edge-fade { position: absolute; z-index: 3; left: 0; right: 0; pointer-events: none; }
	.edge-fade-top { top: 0; height: max(180px, calc(env(safe-area-inset-top) + 140px)); background: linear-gradient(to bottom, #000 0%, rgba(0,0,0,.9) 35%, transparent 100%); }
	.edge-fade-bottom { bottom: 0; height: calc(var(--bottom-gap) + 150px); background: linear-gradient(to top, #000 0%, rgba(0,0,0,.9) 35%, transparent 100%); }
	.search-results { position: absolute; z-index: 4; bottom: calc(var(--bottom-gap) + 62px); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; white-space: nowrap; font: 13px system-ui, sans-serif; color: #ddd; }
	.search-results button { width: 36px; height: 36px; border: 0; border-radius: 6px; color: #fff; background: #303030c0; font: 24px system-ui; cursor: pointer; }
	.ui-surface { transition: background-color 140ms ease-out; }
	.view-switch button, .search-clear, .search-results button { transition: background-color 140ms ease-out, color 140ms ease-out; }
	@media (hover: hover) and (pointer: fine) {
		.sound-button:hover > .ui-surface, .view-switch:hover > .ui-surface, .archive-toolbar:hover > .ui-surface { background-color: rgba(84, 84, 84, .6); }
		.view-switch button:hover, .search-clear:hover { background-color: #ffffff14; color: #fff; }
		.search-results button:hover { background-color: #484848df; }
	}
	@media (prefers-reduced-motion: reduce) {
		.ui-surface, .view-switch button, .search-clear, .search-results button { transition: none; }
	}
	.grid-card.is-target figcaption { color: #fff; text-decoration: underline; text-underline-offset: 5px; }

	.archive-canvas::after {
		content: "";
		position: absolute;
		z-index: 3;
		inset: 0;
		pointer-events: none;
		box-shadow: inset 0 4px 34px 30px rgba(0, 0, 0, 0.8);
	}

</style>
