<script lang="ts">
import { EXHIBIT } from "../data/exhibit.ts";
import { parseScreenNumber } from "../shared/screens.ts";
import Controller from "./controller/Controller.svelte";
import Display from "./display/Display.svelte";
import PhotoDisplay from "./photo/PhotoDisplay.svelte";
import ResultPage from "./result/ResultPage.svelte";

// ルート数が固定で少ないため、起動時のパスで最上位コンポーネントを決める。
const path = location.pathname.replace(/\/+$/, "") || "/";
const display = parseScreenNumber(path.match(/^\/display\/([^/]+)$/)?.[1] ?? null);
const photo = parseScreenNumber(path.match(/^\/photo\/([^/]+)$/)?.[1] ?? null);
const result = path.match(/^\/result\/([^/]+)$/);
const pageLabel = display
	? `展示ディスプレイ ${display}`
	: photo
		? `写真用 ${photo}`
		: path === "/"
			? "診断用iPad"
			: path === "/admin"
				? "運営管理"
				: "ページが見つかりません";
</script>

<svelte:head>
	{#if !result}
		<title>{pageLabel} | {EXHIBIT.title}</title>
	{/if}
</svelte:head>

{#if path === "/"}
	<Controller />
{:else if display}
	<Display screen={display} />
{:else if photo}
	<PhotoDisplay screen={photo} />
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
	<ResultPage colorId={decodeURIComponent(result[1])} />
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
