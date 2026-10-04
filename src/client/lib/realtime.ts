import { estimateClock } from '../../shared/clock.ts';
import type { ClockSample } from '../../shared/clock.ts';
import { CLOSE_CODES } from '../../shared/protocol.ts';
import type { ClientMessage, Diagnostic, RoleState, ServerMessage } from '../../shared/protocol.ts';
import type { Command } from '../../shared/machine.ts';
import type { Role } from '../../shared/types.ts';

/** 応答待ちの再送タイマー（仕様書8.5節）。 */
const RESEND_AFTER_MS = 3_000;
const MAX_RESENDS = 2;
/** 生存確認と時刻補正（仕様書8.6節）。 */
const PING_INTERVAL_MS = 5_000;
const PONG_TIMEOUT_MS = 15_000;
const SYNC_BURST_COUNT = 5;
const SYNC_BURST_GAP_MS = 200;
const SYNC_INTERVAL_MS = 30_000;
/** 再接続の指数バックオフ。 */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** 別のiPadが操作中のときに再確認する間隔。 */
const CONTROLLER_RETRY_MS = 3_000;

export type ConnectionStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'unauthenticated'
  | 'controllerInUse'
  | 'closed';

export type Reply = Extract<ServerMessage, { type: 'ack' | 'error' }>;
export type AlertMessage = Extract<ServerMessage, { type: 'alert' }>;

type RequestBody =
  | { type: 'command'; expectedRevision?: number; command: Command }
  | { type: 'resultStarted'; sessionId: string; screenId: string; actualStartedAt: number }
  | ({ type: 'diagnostic' } & Diagnostic);

interface PendingRequest {
  requestId: string;
  payload: string;
  resolve: (reply: Reply) => void;
  resends: number;
  resentAfterReconnect: boolean;
  sent: boolean;
  stalled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface RealtimeOptions {
  role: Role;
  screenId?: string;
  onState: (state: RoleState, revision: number) => void;
  onStatus: (status: ConnectionStatus) => void;
  /** 再送しても応答がない要求があるとき `true`（仕様書8.5節）。 */
  onStalled?: (stalled: boolean) => void;
  onAlert?: (alert: AlertMessage) => void;
  /** Upgradeが成立しなかったときに認証が有効かを確かめる。 */
  checkAuth: () => Promise<boolean>;
}

const clientNow = () => performance.timeOrigin + performance.now();

function storedClientId(role: Role): string {
  const key = `dpc-client-id:${role}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

/** 同一オリジンのWSSで展示状態を受信し、要求を送る。 */
export class RealtimeClient {
  /** サーバー時刻 - クライアント時刻。 */
  offset = 0;
  status: ConnectionStatus = 'connecting';
  private socket: WebSocket | null = null;
  private welcomed = false;
  private stopped = false;
  private attempt = 0;
  private revision = -1;
  private lastPongAt = 0;
  private readonly clientId: string;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly burst = new Map<string, number>();
  private samples: ClockSample[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stalled = false;

  constructor(private readonly options: RealtimeOptions) {
    this.clientId = storedClientId(options.role);
  }

  /** 補正済みサーバー時刻。 */
  serverNow(): number {
    return clientNow() + this.offset;
  }

  /** `performance.now()` の値をサーバー時刻へ直す。 */
  toServerTime(performanceTime: number): number {
    return performance.timeOrigin + performanceTime + this.offset;
  }

  get online(): boolean {
    return this.status === 'open';
  }

  start(): void {
    this.stopped = false;
    this.timers.push(
      setInterval(() => this.ping(), PING_INTERVAL_MS),
      setInterval(() => this.checkLiveness(), 1_000),
      setInterval(() => this.syncClock(), SYNC_INTERVAL_MS),
    );
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, 'stopped');
    this.socket = null;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.options.onStatus(status);
  }

  private setStalled(stalled: boolean): void {
    if (this.stalled === stalled) return;
    this.stalled = stalled;
    this.options.onStalled?.(stalled);
  }

  private connect(): void {
    if (this.stopped) return;
    const url = new URL('/api/realtime', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('role', this.options.role);
    if (this.options.screenId) url.searchParams.set('screenId', this.options.screenId);
    const socket = new WebSocket(url);
    this.socket = socket;
    this.welcomed = false;
    socket.addEventListener('open', () => {
      this.lastPongAt = clientNow();
      this.sendRaw({ version: 1, type: 'hello', clientId: this.clientId });
    });
    socket.addEventListener('message', (event) => {
      if (socket !== this.socket || typeof event.data !== 'string') return;
      this.handle(JSON.parse(event.data) as ServerMessage);
    });
    socket.addEventListener('close', (event) => {
      if (socket !== this.socket) return;
      void this.handleClose(event.code);
    });
  }

  private async handleClose(code: number): Promise<void> {
    const wasWelcomed = this.welcomed;
    this.socket = null;
    this.welcomed = false;
    if (this.stopped) return;
    if (code === CLOSE_CODES.sessionExpired) return this.setStatus('unauthenticated');
    if (code === CLOSE_CODES.protocolMismatch || code === CLOSE_CODES.controllerMoved) {
      this.stopped = true;
      return this.setStatus('closed');
    }
    if (this.status === 'controllerInUse') {
      this.reconnectTimer = setTimeout(() => this.connect(), CONTROLLER_RETRY_MS);
      return;
    }
    if (!wasWelcomed && !(await this.options.checkAuth().catch(() => true))) {
      this.stopped = true;
      return this.setStatus('unauthenticated');
    }
    this.setStatus('reconnecting');
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        this.welcomed = true;
        this.attempt = 0;
        this.lastPongAt = clientNow();
        this.offset = message.serverTime - clientNow();
        this.revision = -1;
        this.applyState(message.state, message.state.revision);
        this.setStatus('open');
        this.syncClock();
        this.resendAfterReconnect();
        return;
      case 'state':
        this.applyState(message.state, message.revision);
        return;
      case 'ack':
      case 'error':
        if (message.state) this.applyState(message.state, message.state.revision);
        if (message.type === 'error' && message.requestId === null) {
          if (message.code === 'CONTROLLER_IN_USE') {
            this.setStatus('controllerInUse');
            this.socket?.close(1000, 'controller in use');
          } else if (message.code === 'UNAUTHENTICATED') {
            this.stopped = true;
            this.setStatus('unauthenticated');
          }
          return;
        }
        if (message.requestId) this.settle(message.requestId, message);
        return;
      case 'pong':
        this.lastPongAt = clientNow();
        if (this.burst.has(message.pingId)) {
          this.burst.delete(message.pingId);
          this.samples.push({ clientSentAt: message.clientSentAt, clientReceivedAt: clientNow(), serverTime: message.serverTime });
          if (this.samples.length === SYNC_BURST_COUNT) this.finishSync();
        }
        return;
      case 'alert':
        this.options.onAlert?.(message);
        return;
    }
  }

  private applyState(state: RoleState, revision: number): void {
    if (revision < this.revision) return;
    this.revision = revision;
    this.options.onState(state, revision);
  }

  private sendRaw(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  // ---- 生存確認と時刻補正（仕様書8.6節） ----

  private ping(id = crypto.randomUUID()): void {
    if (!this.welcomed) return;
    this.sendRaw({ version: 1, type: 'ping', pingId: id, clientSentAt: clientNow() });
  }

  private checkLiveness(): void {
    if (!this.socket || !this.welcomed) return;
    if (clientNow() - this.lastPongAt > PONG_TIMEOUT_MS) {
      // 15秒間 pong がなければ通信断として扱い、接続し直す（仕様書8.8節）。
      const socket = this.socket;
      this.socket = null;
      socket.close(1000, 'pong timeout');
      void this.handleClose(1006);
    }
  }

  private syncClock(): void {
    if (!this.welcomed) return;
    this.samples = [];
    this.burst.clear();
    for (let i = 0; i < SYNC_BURST_COUNT; i += 1) {
      setTimeout(() => {
        const id = crypto.randomUUID();
        this.burst.set(id, i);
        this.ping(id);
      }, i * SYNC_BURST_GAP_MS);
    }
  }

  private finishSync(): void {
    const estimate = estimateClock(this.samples);
    if (!estimate) return;
    this.offset = estimate.offset;
    if (this.options.role !== 'admin') {
      void this.request({
        type: 'diagnostic',
        name: 'clockSync',
        minRoundTripTime: estimate.minRoundTripTime,
        offsetSpread: estimate.offsetSpread,
      });
    }
  }

  // ---- 要求と再送（仕様書8.5節） ----

  /** 要求を送り、同じ `requestId` の `ack` または `error` を待つ。未接続なら接続後に送る。 */
  request(body: RequestBody): Promise<Reply> {
    const requestId = crypto.randomUUID();
    const payload = JSON.stringify({ version: 1, requestId, ...body });
    return new Promise((resolve) => {
      const entry: PendingRequest = {
        requestId,
        payload,
        resolve,
        resends: 0,
        resentAfterReconnect: false,
        sent: false,
        stalled: false,
        timer: null,
      };
      this.pending.set(requestId, entry);
      if (this.welcomed) this.transmit(entry);
    });
  }

  private transmit(entry: PendingRequest): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(entry.payload);
    entry.sent = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.onTimeout(entry), RESEND_AFTER_MS);
  }

  private onTimeout(entry: PendingRequest): void {
    entry.timer = null;
    if (!this.pending.has(entry.requestId)) return;
    if (!this.welcomed) return;
    if (!entry.resentAfterReconnect && entry.resends < MAX_RESENDS) {
      entry.resends += 1;
      this.transmit(entry);
      return;
    }
    entry.stalled = true;
    this.setStalled(true);
  }

  private resendAfterReconnect(): void {
    for (const entry of this.pending.values()) {
      if (!entry.sent) {
        this.transmit(entry);
      } else if (!entry.resentAfterReconnect) {
        entry.resentAfterReconnect = true;
        this.transmit(entry);
      }
    }
  }

  private settle(requestId: string, reply: Reply): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(requestId);
    if (![...this.pending.values()].some((other) => other.stalled)) this.setStalled(false);
    entry.resolve(reply);
  }
}
