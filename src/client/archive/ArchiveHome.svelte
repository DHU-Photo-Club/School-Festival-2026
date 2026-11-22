<script lang="ts">
	let nickname = $state("");
	let viewMode = $state<"scatter" | "grid">("scatter");
</script>

<svelte:head>
	<meta name="theme-color" content="#000000" />
	<meta name="description" content="あなた色写真展の写真アーカイブ" />
</svelte:head>

<main class="archive-page" data-layout={viewMode}>
	<div class="archive-canvas">
	<section class="brand" aria-label="あなた色写真展 IN YOUR COLORS">
		<div class="brand-mark" aria-hidden="true">
			<img class="mark-piece mark-991b2" src="/archive/figma/991b2.svg" alt="" />
			<img class="mark-piece mark-35305" src="/archive/figma/35305.svg" alt="" />
			<img class="mark-piece mark-edb72" src="/archive/figma/edb72.svg" alt="" />
			<img class="mark-piece mark-ac8b2" src="/archive/figma/ac8b2.svg" alt="" />
			<img class="mark-piece mark-261c8" src="/archive/figma/261c8.svg" alt="" />
			<img class="mark-piece mark-c5574" src="/archive/figma/c5574.svg" alt="" />
			<img class="mark-piece mark-52ced" src="/archive/figma/52ced.svg" alt="" />
			<img class="mark-piece mark-768bf" src="/archive/figma/768bf.svg" alt="" />
			<img class="mark-piece mark-089e7" src="/archive/figma/089e7.svg" alt="" />
			<img class="mark-piece mark-25635" src="/archive/figma/25635.svg" alt="" />
			<img class="mark-piece mark-5733b" src="/archive/figma/5733b.svg" alt="" />
			<img class="mark-piece mark-75d4c" src="/archive/figma/75d4c.svg" alt="" />
			<img class="mark-piece mark-540ef" src="/archive/figma/540ef.svg" alt="" />
			<img class="mark-piece mark-a4a87" src="/archive/figma/a4a87.svg" alt="" />
		</div>
		<img class="wordmark" src="/archive/figma/9f8d1.svg" alt="あなた色写真展 IN YOUR COLORS" />
	</section>

	<section class="floating-photos" aria-label="写真のプレビュー">
		<figure class="photo-orb photo-orb-left">
			<img src="/archive/figma/665aa.svg" alt="" />
			<figcaption>ニックネーム</figcaption>
		</figure>
		<figure class="photo-orb photo-orb-right">
			<img src="/archive/figma/fea1c.svg" alt="" />
			<figcaption>ニックネーム</figcaption>
		</figure>
	</section>

	<form class="archive-toolbar" role="search" onsubmit={(event) => event.preventDefault()}>
		<label class="search-field">
			<img src="/archive/figma/1a63a.svg" alt="" />
			<input bind:value={nickname} type="search" placeholder="ニックネームを検索..." aria-label="ニックネームを検索" />
		</label>
		<div class="view-switch" role="group" aria-label="表示形式">
			<button
				type="button"
				class:active={viewMode === "scatter"}
				aria-label="散らばって表示"
				aria-pressed={viewMode === "scatter"}
				onclick={() => (viewMode = "scatter")}
			>
				<img src="/archive/figma/a28e7.svg" alt="" />
			</button>
			<button
				type="button"
				class:active={viewMode === "grid"}
				aria-label="グリッド表示"
				aria-pressed={viewMode === "grid"}
				onclick={() => (viewMode = "grid")}
			>
				<img src="/archive/figma/40050.svg" alt="" />
			</button>
		</div>
	</form>
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
	}

	.archive-canvas {
		position: relative;
		width: min(100vw, calc(100dvh * 402 / 874), 402px);
		aspect-ratio: 402 / 874;
		overflow: hidden;
		background:
			radial-gradient(ellipse 58% 42% at 50% 51%, rgba(36, 36, 36, 0.34) 0%, rgba(13, 13, 13, 0.19) 48%, transparent 100%),
			#000;
	}

	.brand,
	.floating-photos {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.brand-mark {
		position: absolute;
		inset: 0;
	}

	.mark-piece {
		position: absolute;
		display: block;
		object-fit: fill;
		mix-blend-mode: hard-light;
	}

	.mark-991b2 { left: 40.66%; top: 50.97%; width: 20.19%; height: 1.44%; }
	.mark-35305 { left: 50.25%; top: 44.52%; width: 9.93%; height: 3.92%; }
	.mark-edb72 { left: 40.22%; top: 44.52%; width: 10.37%; height: 4.2%; }
	.mark-ac8b2 { left: 52.42%; top: 45.36%; width: 7.02%; height: 2.52%; }
	.mark-261c8 { left: 40.66%; top: 45.48%; width: 6.84%; height: 7.11%; }
	.mark-c5574 { left: 42.39%; top: 45.24%; width: 7.24%; height: 2.76%; }
	.mark-52ced { left: 40.66%; top: 44.37%; width: 20.76%; height: 4.08%; }
	.mark-768bf { left: 40.66%; top: 46.07%; width: 20.76%; height: 2.37%; }
	.mark-089e7 { left: 55.98%; top: 48.44%; width: 4.54%; height: 4.15%; }
	.mark-25635 { left: 40.37%; top: 50.24%; width: 20.67%; height: 2.17%; }
	.mark-5733b { left: 37.34%; top: 41.23%; width: 19.14%; height: 5.25%; }
	.mark-75d4c { left: 35.86%; top: 40.85%; width: 13.77%; height: 5.77%; }
	.mark-540ef { left: 46.94%; top: 42.85%; width: 7.86%; height: 2.01%; }
	.mark-a4a87 { left: 55.91%; top: 44.74%; width: 4.94%; height: 4.2%; }

	.wordmark {
		position: absolute;
		left: 30.37%;
		top: 54.52%;
		width: 39.28%;
		height: 3.22%;
	}

	.photo-orb {
		position: absolute;
		margin: 0;
		width: 32.58%;
		text-align: center;
		transition: left 350ms ease, top 350ms ease, transform 350ms ease;
	}

	.photo-orb > img {
		display: block;
		width: 100%;
		height: auto;
	}

	.photo-orb figcaption {
		margin-top: 1px;
		color: #fff;
		font-family: Georgia, "Times New Roman", serif;
		font-size: clamp(13px, 3.5vw, 15px);
		font-weight: 400;
		line-height: 1.45;
		letter-spacing: 0.04em;
	}

	.photo-orb-left {
		left: -9.45%;
		top: 19.11%;
	}

	.photo-orb-right {
		left: calc(60% + 7.66%);
		top: 11.56%;
	}

	.archive-toolbar {
		position: absolute;
		z-index: 2;
		left: 20px;
		right: 20px;
		bottom: 11.67%;
		display: flex;
		align-items: center;
		gap: 12px;
		height: 50px;
		margin: 0;
		padding: 5px;
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 10px;
		background: rgba(61, 61, 61, 0.5);
		-webkit-backdrop-filter: blur(5px);
		backdrop-filter: blur(5px);
	}

	.search-field {
		min-width: 0;
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 8px;
	}

	.search-field > img {
		flex: 0 0 18px;
		width: 18px;
		height: 18px;
		opacity: 0.76;
	}

	.search-field input {
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: #fff;
		font-family: Arial, "Noto Sans JP", sans-serif;
		font-size: 14px;
		font-weight: 400;
		letter-spacing: 0.01em;
	}

	.search-field input::placeholder { color: rgba(255, 255, 255, 0.72); }
	.search-field input::-webkit-search-cancel-button { filter: invert(1); }

	.view-switch {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.view-switch button {
		display: grid;
		place-items: center;
		width: 39px;
		height: 39px;
		padding: 0;
		border: 0;
		border-radius: 7px;
		background: transparent;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.view-switch button.active { background: #5e5e5e; }
	.view-switch button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
	.view-switch button img { display: block; width: 24px; height: 24px; }

	.archive-page[data-layout="grid"] .photo-orb-left {
		left: 8%;
		top: 24%;
		width: 36%;
	}

	.archive-page[data-layout="grid"] .photo-orb-right {
		left: 56%;
		top: 24%;
		width: 36%;
	}

	@media (max-width: 360px) {
		.archive-toolbar { left: 12px; right: 12px; gap: 6px; }
		.search-field { gap: 6px; padding-inline: 5px; }
		.search-field input { font-size: 12px; }
		.view-switch { gap: 1px; }
		.view-switch button { width: 35px; height: 39px; }
	}

	@media (prefers-reduced-motion: reduce) {
		.photo-orb { transition: none; }
	}
</style>
