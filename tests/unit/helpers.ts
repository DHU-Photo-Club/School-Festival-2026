import { RESULT_COLORS } from "../../src/data/colors.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import type { ServerMessage } from "../../src/shared/protocol.ts";
import type { Role } from "../../src/shared/types.ts";
import { ExhibitCore } from "../../src/worker/core.ts";
import type { Connection, ConnectionMeta, Store } from "../../src/worker/core.ts";

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

/** Durable Objectの外側を模したテスト用の環境。時刻は手動で進める。 */
export class Harness {
	time = 1_800_000_000_000;
	readonly store = new MemoryStore();
	readonly connections: FakeConnection[] = [];
	private counter = 0;
	readonly core: ExhibitCore;

	constructor() {
		this.core = new ExhibitCore({
			store: this.store,
			now: () => this.time,
			randomId: () => `id-${(this.counter += 1)}`,
			randomDigits: (length) =>
				String((this.counter += 1) * 7919)
					.padStart(length, "0")
					.slice(-length),
			connections: () => this.connections.filter((connection) => !connection.closed),
			questions: QUESTIONS,
			colors: RESULT_COLORS,
		});
	}

	advance(ms: number): void {
		this.time += ms;
	}

	/** 認証セッションを発行して接続し、`hello` まで済ませる。 */
	connect(role: Role, options: { screenId?: string; clientId?: string; hello?: boolean } = {}): FakeConnection {
		const authKey = `key-${(this.counter += 1)}`;
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
		const meta = this.core.createConnectionMeta(authKey, session, `conn-${(this.counter += 1)}`);
		const connection = new FakeConnection(meta, (closed) => this.core.handleClose(closed));
		this.connections.push(connection);
		if (options.hello !== false)
			this.send(connection, { type: "hello", clientId: options.clientId ?? `client-${authKey}` });
		return connection;
	}

	send(connection: FakeConnection, message: Record<string, unknown>): void {
		this.core.handleMessage(connection, JSON.stringify({ version: 1, ...message }));
	}

	command(
		connection: FakeConnection,
		command: Record<string, unknown>,
		options: { requestId?: string; expectedRevision?: number | null } = {},
	) {
		const requestId = options.requestId ?? `req-${(this.counter += 1)}`;
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
