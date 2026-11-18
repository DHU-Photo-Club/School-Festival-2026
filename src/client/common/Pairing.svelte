<script lang="ts">
  import { fetchDeviceSession, type DeviceSession } from '../lib/session.ts';

  let { message = '' }: { message?: string } = $props();

  let code = $state('');
  let busy = $state(false);
  /** サーバーがコードを消費した後は、同じ画面から再送しない。再送すると別の画面IDで登録し直すことになる。 */
  let consumed = $state(false);
  let failed = $state<'code' | 'cookie' | 'unverified' | null>(null);

  async function pair(): Promise<(DeviceSession & { location: string }) | null> {
    try {
      const response = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) return null;
      consumed = true;
      return (await response.json()) as DeviceSession & { location: string };
    } catch {
      return null;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || consumed) return;
    busy = true;
    failed = null;
    const paired = await pair();
    busy = false;
    if (!paired) {
      // 応答の読み取りだけに失敗した場合は、コードが消費済みのため再登録を促さない。
      failed = consumed ? 'unverified' : 'code';
      return;
    }
    // Cookieが保存されないまま遷移すると、遷移先で再び登録画面になり、別の画面IDの登録を繰り返す。
    const saved = await fetchDeviceSession().catch(() => undefined);
    if (saved === undefined) {
      failed = 'unverified';
      return;
    }
    if (saved === null || saved.role !== paired.role || saved.screenId !== paired.screenId) {
      failed = 'cookie';
      return;
    }
    location.assign(paired.location);
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
      pattern={'[0-9]{6}'}
      maxlength="6"
      aria-label="ペアリングコード"
      placeholder="000000"
    />
    <button class="primary-button" type="submit" disabled={busy || consumed || !/^\d{6}$/.test(code)}>登録する</button>
  </form>
  {#if failed === 'code'}
    <p class="error" role="alert">コードを確認できませんでした。新しいコードを発行してください。</p>
  {:else if failed === 'cookie'}
    <p class="error" role="alert">このブラウザに登録情報を保存できませんでした。登録を繰り返さず、運営スタッフに連絡してください。設定を直した後は、ページを再読み込みしてください。</p>
  {:else if failed === 'unverified'}
    <p class="error" role="alert">登録を確認できませんでした。ページを再読み込みしてください。登録画面が再び表示された場合は、運営スタッフに連絡してください。</p>
  {/if}
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
