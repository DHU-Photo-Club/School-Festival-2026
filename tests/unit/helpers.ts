import { RESULT_COLORS } from "../../src/data/colors.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import type { AdminState, ServerMessage } from "../../src/shared/protocol.ts";
import type { Role, Sequence } from "../../src/shared/types.ts";
import type { Connection, ConnectionMeta, Store } from "../../src/worker/core.ts";
import { ExhibitCore } from "../../src/worker/core.ts";

export class MemoryStore implements Store {
	readonly data = new Map<string, string>();
	get<T>(key: string): T | undefined {
		const value = this.data.get(key);
		return value === undefined ? undefined : (JSON.parse(value) as T);
	}
	put(key: string, value: unknown): void {
		this.data.set(key, JSON.stringify(value));
	}
	delete(key: string): void {
		this.data.delete(key);
	}
	list<T>(prefix: string): [string, T][] {
		return [...this.data.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, value]) => [key, JSON.parse(value) as T]);
	}
}

/**
 * テスト用のソケット。Harness は wrap() で包んで ExhibitCore へ渡す。
 * 接続オブジェクトの作り直しと meta の複製は wrap() が担う。
 */
export class FakeConnection implements Connection {
	meta: ConnectionMeta;
	readonly sent: ServerMessage[] = [];
	closed: { code: number; reason: string } | null = null;
	constructor(
		meta: ConnectionMeta,
		private readonly onClose: (connection: FakeConnection) => void,
	) {
		this.meta = meta;
	}
	setMeta(meta: ConnectionMeta): void {
		this.meta = meta;
	}
	send(message: ServerMessage): void {
		this.sent.push(message);
	}
	close(code: number, reason: string): void {
		if (this.closed) return;
		this.closed = { code, reason };
		this.onClose(this);
	}
	last(): ServerMessage {
		return this.sent[this.sent.length - 1];
	}
	ofType<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
		return this.sent.filter((message) => message.type === type) as Extract<ServerMessage, { type: T }>[];
	}
	clear(): void {
		this.sent.length = 0;
	}
}

/** 接続が受け取った最後の `state` メッセージの管理状態。 `state` メッセージが無ければエラーを投げる。 */
export function lastAdminState(connection: FakeConnection): AdminState {
	const last = connection.ofType("state").at(-1);
	if (!last) throw new Error("`state` メッセージがまだ届いていない");
	return last.state as AdminState;
}

/**
 * Durable Objectの `wrap(socket)` と同じく、呼び出しごとに新しい接続オブジェクトを返す。
 * meta も deserializeAttachment() と同じく複製を返し、直接の書き換えを反映しない。
 */
function wrap(connection: FakeConnection): Connection {
	return {
		get meta() {
			return structuredClone(connection.meta);
		},
		setMeta: (meta) => connection.setMeta(meta),
		send: (message) => connection.send(message),
		close: (code, reason) => connection.close(code, reason),
	};
}

/** Durable Objectの外側を模したテスト用の環境。時刻は手動で進める。 */
export class Harness {
	time = 1_800_000_000_000;
	readonly store = new MemoryStore();
	readonly connections: FakeConnection[] = [];
	private counter = 0;
	readonly core: ExhibitCore;

	/** `sequences` を省略すると、シーケンスを再生しない展示として動かす。 */
	constructor(options: { sequences?: readonly Sequence[] } = {}) {
		this.core = new ExhibitCore({
			store: this.store,
			now: () => this.time,
			randomId: () => `id-${this.nextCount()}`,
			randomDigits: (length) =>
				String(this.nextCount() * 7919)
					.padStart(length, "0")
					.slice(-length),
			// 本番は readyState が OPEN の接続に絞る。テストでは閉じていない接続がそれに当たる。
			connections: () =>
				this.connections.filter((connection) => !connection.closed).map((connection) => wrap(connection)),
			questions: QUESTIONS,
			colors: RESULT_COLORS,
			sequences: options.sequences ?? [],
		});
	}

	advance(ms: number): void {
		this.time += ms;
	}

	/** カウンター値を1つ進め、その値を返す。テスト用の一意なIDの生成に使う。 */
	private nextCount(): number {
		this.counter += 1;
		return this.counter;
	}

	/** 認証セッションを発行して接続し、`hello` まで済ませる。 */
	connect(role: Role, options: { screenId?: string; clientId?: string; hello?: boolean } = {}): FakeConnection {
		const authKey = `key-${this.nextCount()}`;
		const session = this.core.issueSession(
			authKey,
			role === "admin" ? "admin" : "device",
			role,
			options.screenId ?? null,
		);
		return this.open(authKey, session, options);
	}

	open(
		authKey: string,
		session: ReturnType<ExhibitCore["issueSession"]>,
		options: { clientId?: string; hello?: boolean } = {},
	): FakeConnection {
		const meta = this.core.createConnectionMeta(authKey, session, `conn-${this.nextCount()}`);
		const connection = new FakeConnection(meta, (closed) => this.core.handleClose(wrap(closed)));
		this.connections.push(connection);
		if (options.hello !== false)
			this.send(connection, { type: "hello", clientId: options.clientId ?? `client-${authKey}` });
		return connection;
	}

	send(connection: FakeConnection, message: Record<string, unknown>): void {
		this.sendRaw(connection, JSON.stringify({ version: 1, ...message }));
	}

	/** 生のフレームをそのまま送る。JSONでないメッセージ、バイナリフレーム、異なる `version` の検証に使う。 */
	sendRaw(connection: FakeConnection, raw: string | ArrayBuffer): void {
		this.core.handleMessage(wrap(connection), raw);
	}

	command(
		connection: FakeConnection,
		command: Record<string, unknown>,
		options: { requestId?: string; expectedRevision?: number | null } = {},
	) {
		const requestId = options.requestId ?? `req-${this.nextCount()}`;
		const expectedRevision =
			options.expectedRevision === null ? undefined : (options.expectedRevision ?? this.core.current().revision);
		this.send(connection, { type: "command", requestId, expectedRevision, command });
		return connection.sent.filter(
			(message) => (message.type === "ack" || message.type === "error") && message.requestId === requestId,
		);
	}

	alarm(): void {
		this.core.handleAlarm();
	}
}
