<script lang="ts">
import { EXHIBIT } from "../data/exhibit.ts";
import { parseScreenNumber, parseSplitScreen } from "../shared/screens.ts";
import Fullscreen from "./common/Fullscreen.svelte";
import Keystone from "./common/Keystone.svelte";
import Controller from "./controller/Controller.svelte";
import Display from "./display/Display.svelte";
import SplitDisplay from "./display/SplitDisplay.svelte";
import PhotoDisplay from "./photo/PhotoDisplay.svelte";
import ResultPage from "./result/ResultPage.svelte";
import SoundPage from "./sound/SoundPage.svelte";

// ルート数が固定で少ないため、起動時のパスで最上位コンポーネントを決める。
const path = location.pathname.replace(/\/+$/, "") || "/";
// 二台のディスプレイを合わせた36:9の一つの画面を、ディスプレイごとのタブで左右に分けて描く画面分割。
const split = parseSplitScreen(path.match(/^\/display\/split\/([^/]+)$/)?.[1] ?? null);
const display = parseScreenNumber(path.match(/^\/display\/([^/]+)$/)?.[1] ?? null);
const photo = parseScreenNumber(path.match(/^\/photo\/([^/]+)$/)?.[1] ?? null);
const result = path.match(/^\/result\/([^/]+)$/);
/** 台形補正を、このブラウザにパスごとに残すキー（展示ディスプレイと写真用）。 */
const keystoneKey = `dpc-keystone:${path}`;
const pageLabel = split
	? `展示ディスプレイ ${split}（画面分割）`
	: display
		? `展示ディスプレイ ${display}`
		: photo
			? `写真用 ${photo}`
			: path === "/"
				? "診断用iPad"
				: path === "/admin"
					? "運営管理"
					: path === "/sound"
						? "サウンド"
						: "ページが見つかりません";
</script>

<svelte:head>
	{#if !result}
		<title>{pageLabel} | {EXHIBIT.title}</title>
	{/if}
</svelte:head>

{#if path === "/"}
	<Controller />
{:else if split}
	<Keystone storageKey={keystoneKey}><SplitDisplay screen={split} /></Keystone>
	<Fullscreen />
{:else if display}
	<Keystone storageKey={keystoneKey}><Display screen={display} /></Keystone>
	<Fullscreen />
{:else if photo}
	<Keystone storageKey={keystoneKey}><PhotoDisplay screen={photo} /></Keystone>
	<Fullscreen />
{:else if path === "/sound"}
	<SoundPage />
{:else if path === "/admin"}
	<!-- 管理画面は Tailwind CSS（要素の初期化を含む）を読み込むため、展示用の画面に影響しないよう別のチャンクに分ける。 -->
	{#await import("./admin/Admin.svelte")}
		<main class="not-found">管理画面を読み込んでいます…</main>
	{:then { default: Admin }}
		<Admin />
	{:catch}
		<main class="not-found">管理画面を読み込めませんでした。ページを再読み込みしてください。</main>
	{/await}
{:else if result}
	<ResultPage resultId={decodeURIComponent(result[1])} />
{:else}
	<main class="not-found">ページが見つかりません</main>
{/if}

<style>
.not-found {
	display: grid;
	place-content: center;
	min-height: 100vh;
	color: var(--muted);
}
</style>
