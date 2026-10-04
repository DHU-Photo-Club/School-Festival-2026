<script lang="ts">
  let { message = '' }: { message?: string } = $props();

  let code = $state('');
  let busy = $state(false);
  let failed = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    failed = false;
    try {
      const response = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        failed = true;
        return;
      }
      const { location: next } = (await response.json()) as { location: string };
      location.assign(next);
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<main class="pairing">
  <h1>端末の登録</h1>
  {#if message}<p class="message">{message}</p>{/if}
  <p>管理画面で発行した6桁のコードを入力してください。</p>
  <form onsubmit={submit}>
    <input
      bind:value={code}
      inputmode="numeric"
      autocomplete="one-time-code"
      pattern="[0-9]{6}"
      maxlength="6"
      aria-label="ペアリングコード"
      placeholder="000000"
    />
    <button class="primary-button" type="submit" disabled={busy || !/^\d{6}$/.test(code)}>登録する</button>
  </form>
  {#if failed}<p class="error" role="alert">コードを確認できませんでした。新しいコードを発行してください。</p>{/if}
</main>

<style>
  .pairing {
    min-height: 100vh;
    display: grid;
    place-content: center;
    gap: 16px;
    padding: 24px;
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  p {
    margin: 0;
    color: var(--muted);
  }
  .message {
    color: var(--text);
  }
  form {
    display: grid;
    gap: 16px;
    justify-items: center;
  }
  input {
    width: 240px;
    padding: 12px;
    border: 2px solid var(--line);
    border-radius: 12px;
    background: transparent;
    color: var(--text);
    font-size: 32px;
    letter-spacing: 0.3em;
    text-align: center;
  }
  .error {
    color: var(--text);
  }
</style>
