<script lang="ts">
  import Admin from './admin/Admin.svelte';
  import AdminLogin from './admin/AdminLogin.svelte';
  import Controller from './controller/Controller.svelte';
  import Display from './display/Display.svelte';
  import ResultPage from './result/ResultPage.svelte';

  // ルート数が固定で少ないため、起動時のパスで最上位コンポーネントを決める（仕様書9.2節）。
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const display = path.match(/^\/display\/([^/]+)$/);
  const result = path.match(/^\/result\/([^/]+)$/);
</script>

{#if path === '/'}
  <Controller />
{:else if display}
  <Display screenId={decodeURIComponent(display[1])} />
{:else if path === '/admin/login'}
  <AdminLogin />
{:else if path === '/admin'}
  <Admin />
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
