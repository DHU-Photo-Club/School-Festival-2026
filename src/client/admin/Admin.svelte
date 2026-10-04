<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RESULT_COLORS } from '../../data/colors.ts';
  import type { Command } from '../../shared/machine.ts';
  import type { AdminState } from '../../shared/protocol.ts';
  import { RealtimeClient } from '../lib/realtime.ts';
  import type { AlertMessage, ConnectionStatus } from '../lib/realtime.ts';

  interface SessionRow {
    id: string;
    role: 'controller' | 'display';
    screenId: string | null;
    issuedAt: number;
    expiresAt: number;
    lastReceivedAt: number | null;
    connected: boolean;
  }

  const PHASE_LABELS = { idle: '待機', intro: '導入', question: '質問', judging: '判定', result: '結果' } as const;

  let admin = $state<AdminState | null>(null);
  let status = $state<ConnectionStatus>('connecting');
  let busy = $state(false);
  let message = $state<string | null>(null);
  let alerts = $state<AlertMessage[]>([]);
  let sessions = $state<SessionRow[]>([]);
  let pairingRole = $state<'controller' | 'display'>('display');
  let issued = $state<{ code: string; expiresAt: number; label: string } | null>(null);
  let client: RealtimeClient | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const colorName = (id: string | null) => RESULT_COLORS.find((color) => color.id === id)?.name ?? '—';
  const time = (value: number | null) =>
    value === null ? '—' : new Date(value).toLocaleTimeString('ja-JP', { hour12: false });

  async function api(path: string, init?: RequestInit) {
    const response = await fetch(path, { cache: 'no-store', ...init });
    if (response.status === 401) location.assign('/admin/login');
    return response;
  }

  async function loadSessions() {
    const response = await api('/api/admin/sessions');
    if (!response.ok) return;
    sessions = ((await response.json()) as { sessions: SessionRow[] }).sessions;
  }

  async function command(next: Command) {
    if (!client || !admin || busy) return;
    busy = true;
    const reply = await client.request(
      next.name === 'forceReset' ? { type: 'command', command: next } : { type: 'command', expectedRevision: admin.revision, command: next },
    );
    busy = false;
    message = reply.type === 'error' ? reply.message : null;
    if (next.name === 'releaseController') void loadSessions();
  }

  async function issueCode(event: SubmitEvent) {
    event.preventDefault();
    const response = await api('/api/admin/pairing-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: pairingRole }),
    });
    const body = (await response.json()) as { code?: string; expiresAt?: number; message?: string };
    if (response.ok && body.code && body.expiresAt) {
      issued = { code: body.code, expiresAt: body.expiresAt, label: pairingRole === 'display' ? '展示ディスプレイ' : '診断用iPad' };
      message = null;
    } else {
      message = body.message ?? 'コードを発行できませんでした。';
    }
  }

  async function revoke(id: string) {
    await api(`/api/admin/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadSessions();
  }

  async function logout() {
    await api('/api/admin/logout', { method: 'POST' });
    location.assign('/admin/login');
  }

  onMount(() => {
    client = new RealtimeClient({
      role: 'admin',
      onState: (state) => (admin = state as AdminState),
      onStatus: (next) => {
        status = next;
        if (next === 'unauthenticated') location.assign('/admin/login');
      },
      onAlert: (alert) => (alerts = [alert, ...alerts].slice(0, 20)),
      checkAuth: async () => (await fetch('/api/admin/sessions', { cache: 'no-store' })).status !== 401,
    });
    client.start();
    void loadSessions();
    refreshTimer = setInterval(() => void loadSessions(), 5_000);
  });

  onDestroy(() => {
    client?.stop();
    if (refreshTimer) clearInterval(refreshTimer);
  });
</script>

<main class="admin">
  <header>
    <h1>運営管理</h1>
    <span class="badge" data-ok={status === 'open'}>{status === 'open' ? 'サーバー接続中' : 'サーバー切断'}</span>
    <button class="link" onclick={logout}>ログアウト</button>
  </header>

  {#if message}<p class="message" role="alert">{message}</p>{/if}

  {#if admin}
    <section>
      <h2>展示状態</h2>
      <dl>
        <dt>段階</dt>
        <dd data-testid="phase">{PHASE_LABELS[admin.phase]}（{admin.phase}）</dd>
        <dt>結果色</dt>
        <dd data-testid="result-color">{colorName(admin.resultColorId)}</dd>
        <dt>受付</dt>
        <dd>{admin.accepting ? '受付中' : '停止中'}</dd>
        <dt>revision</dt>
        <dd data-testid="revision">{admin.revision}</dd>
        <dt>セッション</dt>
        <dd>{admin.sessionId ?? '—'}</dd>
        <dt>操作端末</dt>
        <dd>{admin.controllerAssigned ? '割り当て済み' : '未割り当て'}</dd>
        <dt>障害</dt>
        <dd class:bad={admin.lastInternalErrorAt !== null}>
          {admin.lastInternalErrorAt === null ? 'なし' : `${time(admin.lastInternalErrorAt)} にサーバー内部の失敗`}
        </dd>
      </dl>
      <div class="actions">
        <button onclick={() => command({ name: 'setAccepting', accepting: !admin?.accepting })} disabled={busy}>
          {admin.accepting ? '受付を停止' : '受付を再開'}
        </button>
        <button class="danger" onclick={() => command({ name: 'forceReset' })} disabled={busy}>強制リセット</button>
        <button onclick={() => command({ name: 'releaseController' })} disabled={busy || !admin.controllerAssigned}>
          操作端末を解放
        </button>
      </div>
    </section>

    <section>
      <h2>端末</h2>
      <p data-testid="display-count">展示ディスプレイ {admin.devices.filter((device) => device.role === 'display').length} 台（登録済み）</p>
      <table>
        <thead>
          <tr><th>端末</th><th>接続</th><th>最終受信</th><th>準備</th><th>時刻同期</th></tr>
        </thead>
        <tbody>
          {#each admin.devices as device (device.screenId ?? 'controller')}
            <tr data-testid="device-{device.screenId ?? 'controller'}">
              <td>{device.role === 'controller' ? '診断用iPad' : device.screenId}</td>
              <td class:bad={!device.connected}>{device.connected ? '接続中' : '切断'}</td>
              <td>{time(device.lastReceivedAt)}</td>
              <td>
                {#if device.role === 'controller'}
                  —
                {:else if device.preload}
                  準備完了（成功 {device.preload.succeeded}件{device.preload.failedPhotoIds.length > 0
                    ? `、失敗 ${device.preload.failedPhotoIds.join(', ')}`
                    : ''}）
                {:else}
                  未報告
                {/if}
              </td>
              <td class:bad={device.clockSync?.degraded}>
                {#if device.clockSync}
                  {device.clockSync.degraded ? '同期精度低下' : '正常'}（往復 {Math.round(device.clockSync.minRoundTripTime)}ms、差
                  {Math.round(device.clockSync.offsetSpread)}ms）
                {:else}
                  未計測
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section>
      <h2>結果同期</h2>
      {#if admin.syncReport}
        <p>
          同期差 <strong data-testid="sync-spread">{admin.syncReport.syncSpread === null ? '—' : `${Math.round(admin.syncReport.syncSpread)}ms`}</strong>
          ／ 最終回答の受理から表示開始まで
          <strong>{admin.syncReport.startLatency === null ? '—' : `${Math.round(admin.syncReport.startLatency)}ms`}</strong>
        </p>
        <table>
          <thead><tr><th>画面</th><th>開始時刻</th><th>結果開始時刻との差</th><th>計測対象外の理由</th></tr></thead>
          <tbody>
            {#each admin.syncReport.entries as entry (entry.screenId)}
              <tr>
                <td>{entry.screenId}</td>
                <td>{entry.actualStartedAt === null ? '未報告' : time(entry.actualStartedAt)}</td>
                <td>{entry.actualStartedAt === null ? '—' : `${Math.round(entry.actualStartedAt - (admin.syncReport?.resultStartAt ?? 0))}ms`}</td>
                <td>{entry.excludedReason ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted">まだ計測していません。</p>
      {/if}
    </section>

    <section>
      <h2>結果色の表示確認</h2>
      <div class="colors">
        {#each RESULT_COLORS as color (color.id)}
          <button
            class="swatch"
            style:background={color.backgroundColor}
            style:color={color.foregroundColor}
            aria-pressed={admin.previewColorId === color.id}
            disabled={busy || admin.phase !== 'idle'}
            onclick={() => command({ name: 'previewColor', colorId: color.id })}
          >
            <span class="dot" style:background={color.baseColor}></span>{color.name}
          </button>
        {/each}
        <button disabled={busy || admin.previewColorId === null} onclick={() => command({ name: 'clearPreview' })}>
          表示確認を終了
        </button>
      </div>
    </section>

    <section>
      <h2>運用通知</h2>
      {#if alerts.length === 0}
        <p class="muted">通知はありません。</p>
      {:else}
        <ul>
          {#each alerts as alert (alert.sessionId + alert.occurredAt)}
            <li data-testid="alert">
              {time(alert.occurredAt)} QRコード生成失敗（qrGenerationFailed） 結果色 {colorName(alert.colorId)} ／ セッション {alert.sessionId}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <section>
    <h2>端末の登録</h2>
    <form class="pairing" onsubmit={issueCode}>
      <select bind:value={pairingRole} aria-label="端末種別">
        <option value="display">展示ディスプレイ</option>
        <option value="controller">診断用iPad</option>
      </select>
      <button type="submit">ペアリングコードを発行</button>
    </form>
    <p class="muted">
      展示ディスプレイは、登録した順に display-1、display-2…と番号が付き、その順に写真を割り当てます。来場者から見た順に登録してください。
    </p>
    {#if issued}
      <p class="code">
        {issued.label}: <strong data-testid="pairing-code">{issued.code}</strong>（{time(issued.expiresAt)} まで有効、一回限り）
      </p>
    {/if}
    <table>
      <thead><tr><th>端末</th><th>発行</th><th>最終受信</th><th>接続</th><th></th></tr></thead>
      <tbody>
        {#each sessions as session (session.id)}
          <tr>
            <td>{session.role === 'display' ? session.screenId : '診断用iPad'}</td>
            <td>{time(session.issuedAt)}</td>
            <td>{time(session.lastReceivedAt)}</td>
            <td>{session.connected ? '接続中' : '切断'}</td>
            <td><button onclick={() => revoke(session.id)}>失効</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</main>

<style>
  .admin {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px;
    display: grid;
    gap: 28px;
    font-size: 15px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  h1 {
    margin: 0;
    font-size: 22px;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 17px;
  }
  .badge {
    padding: 4px 10px;
    border-radius: 12px;
    background: #5a1d1d;
  }
  .badge[data-ok='true'] {
    background: #1d3a2a;
  }
  .link {
    margin-left: auto;
    background: none;
    border: 0;
    color: var(--muted);
    cursor: pointer;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0 0 12px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .actions,
  .colors,
  .pairing {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  button,
  select {
    padding: 8px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #1a1918;
    color: var(--text);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .danger {
    border-color: #a33;
  }
  .swatch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .swatch[aria-pressed='true'] {
    outline: 3px solid var(--text);
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    text-align: left;
  }
  .bad {
    color: #ff8a80;
  }
  .muted {
    color: var(--muted);
  }
  .message {
    margin: 0;
    padding: 10px 14px;
    border-radius: 8px;
    background: #3a2a10;
  }
  .code strong {
    font-size: 24px;
    letter-spacing: 0.2em;
  }
</style>
