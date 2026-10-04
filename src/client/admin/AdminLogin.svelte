<script lang="ts">
  let passphrase = $state('');
  let busy = $state(false);
  let failed = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    failed = false;
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (response.ok) location.assign('/admin');
      else failed = true;
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<main class="login">
  <h1>管理画面ログイン</h1>
  <form onsubmit={submit}>
    <label>
      管理パスフレーズ
      <input type="password" bind:value={passphrase} autocomplete="current-password" />
    </label>
    <button class="primary-button" type="submit" disabled={busy || passphrase.length === 0}>ログイン</button>
  </form>
  {#if failed}<p role="alert">ログインできませんでした。</p>{/if}
</main>

<style>
  .login {
    min-height: 100vh;
    display: grid;
    place-content: center;
    gap: 20px;
    padding: 24px;
  }
  h1 {
    margin: 0;
    font-size: 22px;
  }
  form {
    display: grid;
    gap: 16px;
  }
  label {
    display: grid;
    gap: 8px;
    color: var(--muted);
  }
  input {
    width: 320px;
    padding: 12px;
    border: 2px solid var(--line);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font-size: 18px;
  }
</style>
