import { PALETTE } from "../../src/data/palette.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { QUESTION_VERSION, QUESTIONS } from "../../src/data/questions.ts";
import { answerCandidates } from "../../src/shared/answer.ts";
import type { AdminState, RoleState, ServerMessage } from "../../src/shared/protocol.ts";
import type { Answer, Question, Role, Sequence } from "../../src/shared/types.ts";
import type { Judge } from "../../src/worker/ai/judge.ts";
import { createStubJudge } from "../../src/worker/ai/judge.ts";
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
}

/** テスト用のソケット。Harness は wrap() で包んで ExhibitCore へ渡す。 */
export class FakeConnection {
	meta: ConnectionMeta;
	readonly sent: ServerMessage[] = [];
	closed = false;
	constructor(meta: ConnectionMeta) {
		this.meta = meta;
	}
	/** 受け取った `state` メッセージの状態。 */
	states(): RoleState[] {
		return this.sent.flatMap((message) => (message.type === "state" ? [message.state] : []));
	}
	lastState<T extends RoleState = RoleState>(): T {
		const state = this.states().at(-1);
		if (!state) throw new Error("`state` メッセージがまだ届いていない");
		return state as T;
	}
	clear(): void {
		this.sent.length = 0;
	}
}

export const lastAdminState = (connection: FakeConnection) => connection.lastState<AdminState>();

/**
 * Durable Objectの `wrap(socket)` と同じく、呼び出しごとに新しい接続オブジェクトを返す。
 * meta も deserializeAttachment() と同じく複製を返し、直接の書き換えを反映しない。
 */
function wrap(connection: FakeConnection): Connection {
	return {
		get meta() {
			return structuredClone(connection.meta);
		},
		setMeta: (meta) => {
			connection.meta = meta;
		},
		send: (message) => connection.sent.push(message),
	};
}

/** Durable Objectの外側を模したテスト用の環境。時刻は手動で進める。 */
/** 質問の取りうる回答のうち `n` 番目（候補の数で割った余り）。入力方式によらず有効な回答を作る。 */
export function sampleAnswer(question: Question, n = 0): Answer {
	const candidates = answerCandidates(question);
	return candidates[n % candidates.length];
}

export class Harness {
	time = 1_800_000_000_000;
	readonly store = new MemoryStore();
	readonly connections: FakeConnection[] = [];
	private counter = 0;
	readonly core: ExhibitCore;

	/** 結果IDの連番。 */
	private resultCounter = 0;
	readonly log: string[] = [];

	/**
	 * `sequences` を省略すると、シーケンスを再生しない展示として動かす。
	 * `judge` を省略すると、決まった二色を返す仮の選定（`AI_STUB=1` と同じ）を使う。`null` なら選定なし。
	 */
	constructor(options: { sequences?: readonly Sequence[]; judge?: Judge | null; judgingMaxMs?: number } = {}) {
		const newResultId = () => {
			this.resultCounter += 1;
			return this.resultCounter.toString(16).padStart(16, "0");
		};
		const judge =
			options.judge === null
				? undefined
				: (options.judge ??
					createStubJudge({
						questionVersion: QUESTION_VERSION,
						palette: PALETTE,
						photos: PHOTOS,
						now: () => this.time,
						newResultId,
					}));
		this.core = new ExhibitCore({
			store: this.store,
			now: () => this.time,
			randomId: () => {
				this.counter += 1;
				return `id-${this.counter}`;
			},
			// 本番は readyState が OPEN の接続に絞る。テストでは閉じていない接続がそれに当たる。
			connections: () =>
				this.connections.filter((connection) => !connection.closed).map((connection) => wrap(connection)),
			questions: QUESTIONS,
			sequences: options.sequences ?? [],
			photos: PHOTOS,
			judge,
			judgingMaxMs: options.judgingMaxMs,
			log: (message) => this.log.push(message),
		});
	}

	advance(ms: number): void {
		this.time += ms;
	}

	connect(role: Role, screen: number | null = null): FakeConnection {
		const connection = new FakeConnection({ role, screen, lastReceivedAt: this.time });
		this.connections.push(connection);
		this.core.open(wrap(connection));
		return connection;
	}

	disconnect(connection: FakeConnection): void {
		connection.closed = true;
		this.core.handleClose();
	}

	send(connection: FakeConnection, message: Record<string, unknown>): void {
		this.sendRaw(connection, JSON.stringify(message));
	}

	sendRaw(connection: FakeConnection, raw: string | ArrayBuffer): void {
		this.core.handleMessage(wrap(connection), raw);
	}

	command(connection: FakeConnection, command: Record<string, unknown>): void {
		this.send(connection, { type: "command", command });
	}

	/** `command` と同じ。AIの選定を待ち始めた場合は、その Promise を返す。 */
	commandWithResult(connection: FakeConnection, command: Record<string, unknown>): Promise<void> | null {
		return this.core.handleMessage(wrap(connection), JSON.stringify({ type: "command", command }));
	}

	alarm(): void {
		this.core.handleAlarm();
	}
}
