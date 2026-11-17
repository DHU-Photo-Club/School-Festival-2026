import { DurableObject } from 'cloudflare:workers';
import { RESULT_COLORS } from '../data/colors.ts';
import { QUESTIONS } from '../data/questions.ts';
import { ADMIN_COOKIE, DEVICE_COOKIE, authKeyFromToken, newToken, readCookie, sessionCookie } from './auth.ts';
import { ExhibitCore } from './core.ts';
import type { Connection, ConnectionMeta, Store } from './core.ts';
import type { ServerMessage } from '../shared/protocol.ts';

/** Durable ObjectのSQLiteストレージを使うキー・値ストア。 */
class SqlStore implements Store {
  constructor(private readonly sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  get<T>(key: string): T | undefined {
    const row = this.sql.exec<{ value: string }>('SELECT value FROM kv WHERE key = ?', key).toArray()[0];
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  put(key: string, value: unknown): void {
    this.sql.exec(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }

  delete(key: string): void {
    this.sql.exec('DELETE FROM kv WHERE key = ?', key);
  }

  list<T>(prefix: string): [string, T][] {
    return this.sql
      .exec<{ key: string; value: string }>(
        'SELECT key, value FROM kv WHERE key >= ? AND key < ? ORDER BY key',
        prefix,
        `${prefix}￿`,
      )
      .toArray()
      .map((row) => [row.key, JSON.parse(row.value) as T]);
  }
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

/** 展示全体で一つのDurable Object（仕様書9.3節）。 */
export class Exhibit extends DurableObject<Env> {
  private readonly core: ExhibitCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new ExhibitCore({
      store: new SqlStore(ctx.storage.sql),
      now: () => Date.now(),
      randomId: () => crypto.randomUUID(),
      randomDigits: (length) => {
        const values = crypto.getRandomValues(new Uint32Array(length));
        return Array.from(values, (value) => String(value % 10)).join('');
      },
      connections: () =>
        ctx
          .getWebSockets()
          .filter((socket) => socket.readyState === WebSocket.OPEN)
          .map((socket) => this.wrap(socket)),
      questions: QUESTIONS,
      colors: RESULT_COLORS,
    });
  }

  private wrap(socket: WebSocket): Connection {
    return {
      get meta() {
        return socket.deserializeAttachment() as ConnectionMeta;
      },
      setMeta: (meta) => socket.serializeAttachment(meta),
      send: (message: ServerMessage) => {
        try {
          socket.send(JSON.stringify(message));
        } catch {
          // 切断済みの接続への送信失敗は無視する。
        }
      },
      close: (code, reason) => {
        try {
          socket.close(code, reason);
        } catch {
          // 切断済み。
        }
      },
    };
  }

  private async schedule(): Promise<void> {
    const wakeAt = this.core.nextWakeAt();
    if (wakeAt === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(wakeAt, Date.now() + 10));
  }

  /** Workerが Upgrade 前に呼ぶ認可（仕様書9.3節）。 */
  async authorizeRealtime(token: string | null, role: string | null, screenId: string | null): Promise<number> {
    const authKey = token ? await authKeyFromToken(token) : null;
    const check = this.core.authorizeRealtime(authKey, role, screenId);
    return check.ok ? 200 : check.status;
  }

  async fetch(request: Request): Promise<Response> {
    this.core.current();
    try {
      return await this.route(request);
    } finally {
      await this.schedule();
    }
  }

  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/realtime') return this.upgrade(request, url);
    if (path === '/api/pair' && method === 'POST') return this.pair(request);
    if (path === '/api/session' && method === 'GET') return this.whoami(request);
    if (path === '/api/admin/session' && method === 'POST') return this.adminSession(request);

    if (path.startsWith('/api/admin/')) {
      if (path === '/api/admin/sessions' && method === 'GET') {
        return json({ sessions: this.core.listDeviceSessions() });
      }
      const revoke = path.match(/^\/api\/admin\/sessions\/([^/]+)$/);
      if (revoke && method === 'DELETE') {
        return this.core.revokeDeviceSessionById(decodeURIComponent(revoke[1]))
          ? json({ ok: true })
          : json({ error: 'NOT_FOUND' }, 404);
      }
      if (path === '/api/admin/pairing-codes' && method === 'POST') {
        const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
        if (body?.role !== 'controller' && body?.role !== 'display' && body?.role !== 'photo') return json({ error: 'INVALID_REQUEST' }, 400);
        return json(this.core.issuePairingCode(body.role));
      }
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }

  /**
   * 管理画面のWebSocket接続に使う管理セッションを用意する。管理画面は認証しない。
   * セッションは接続の識別と冪等性の記録に使うため、有効なものがあれば使い続ける。
   */
  private async adminSession(request: Request): Promise<Response> {
    const current = readCookie(request, ADMIN_COOKIE);
    if (current && this.core.resolveSession(await authKeyFromToken(current))?.kind === 'admin') return json({ ok: true });
    const token = newToken();
    this.core.issueSession(await authKeyFromToken(token), 'admin', 'admin', null);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(ADMIN_COOKIE, token) });
  }

  private async pair(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    if (typeof body?.code !== 'string' || !/^\d{6}$/.test(body.code)) return json({ error: 'INVALID_CODE' }, 400);
    const token = newToken();
    const paired = this.core.pair(body.code, await authKeyFromToken(token));
    if (!paired.ok) return json({ error: 'INVALID_CODE' }, 400);
    const { role, screenId } = paired.session;
    return json(
      { role, screenId, location: role === 'controller' ? '/' : `/${role}/${encodeURIComponent(screenId ?? '')}` },
      200,
      { 'Set-Cookie': sessionCookie(DEVICE_COOKIE, token) },
    );
  }

  private async whoami(request: Request): Promise<Response> {
    const token = readCookie(request, DEVICE_COOKIE);
    const session = token ? this.core.resolveSession(await authKeyFromToken(token)) : null;
    if (!session || session.kind !== 'device') return json({ error: 'UNAUTHENTICATED' }, 401);
    return json({ role: session.role, screenId: session.screenId });
  }

  private async upgrade(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const role = url.searchParams.get('role');
    const cookieName = role === 'admin' ? ADMIN_COOKIE : DEVICE_COOKIE;
    const token = readCookie(request, cookieName);
    const authKey = token ? await authKeyFromToken(token) : null;
    const check = this.core.authorizeRealtime(authKey, role, url.searchParams.get('screenId'));
    if (!check.ok || !authKey) return new Response(null, { status: check.ok ? 401 : check.status });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(this.core.createConnectionMeta(authKey, check.session, crypto.randomUUID()));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.core.handleMessage(this.wrap(socket), message);
    await this.schedule();
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.core.handleClose(this.wrap(socket));
    await this.schedule();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.core.handleClose(this.wrap(socket));
    await this.schedule();
  }

  async alarm(): Promise<void> {
    this.core.handleAlarm();
    await this.schedule();
  }
}
