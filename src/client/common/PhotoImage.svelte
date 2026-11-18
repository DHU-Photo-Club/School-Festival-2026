<script lang="ts">
import type { Photo } from "../../shared/types.ts";

let {
	photo,
	onstatus,
}: {
	photo: Photo;
	onstatus?: (status: "loaded" | "failed") => void;
} = $props();

// AVIFの取得に失敗した場合は <source> を外し、同じ写真のJPEGを表示する（仕様書9.4節、15章）。
let avifFailed = $state(false);

function loaded(event: Event) {
	const image = event.currentTarget as HTMLImageElement;
	image
		.decode()
		.then(() => onstatus?.("loaded"))
		.catch(() => onstatus?.("failed"));
}

function failed(event: Event) {
	const image = event.currentTarget as HTMLImageElement;
	if (!avifFailed && image.currentSrc.endsWith(".avif")) {
		avifFailed = true;
		return;
	}
	onstatus?.("failed");
}
</script>

<picture>
	{#if !avifFailed}
		<source srcset="/photos/{photo.id}.avif" type="image/avif">
	{/if}
	<img src="/photos/{photo.id}.jpg" alt="" data-photo-id={photo.id} onload={loaded} onerror={failed}>
</picture>

<style>
picture {
	display: contents;
}
img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
	object-position: center;
}
</style>
