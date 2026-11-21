import type { Command } from "../shared/machine.ts";
import { advanceDeadlines, applyCommand, initialState, ROLE_COMMANDS, reconcileState } from "../shared/machine.ts";
import type { AdminState, DeviceStatus, RoleState, ServerMessage } from "../shared/protocol.ts";
import { parseClientMessage, toDisplayState } from "../shared/protocol.ts";
import type { ExhibitState, Question, ResultColor, Role, Sequence } from "../shared/types.ts";

/** 最後の受信からこの時間を過ぎた端末を、管理画面で切断と表示する。端末は5秒ごとに `ping` を送る。 */
export const STALE_AFTER_MS = 15_000;
/** 端末の最終受信時刻だけが変わったときに管理画面へ送る間隔。 */
const ADMIN_REFRESH_MS = 5_000;

/** 展示状態を保存するキー・値ストア。Durable Objectでは `ctx.storage.kv` を使う。 */
export interface Store {
	get<T>(key: string): T | undefined;
	put(key: string, value: unknown): void;
}

/** 接続ごとの情報。Durable ObjectではWebSocketのattachmentへ保存する。 */
export interface ConnectionMeta {
	role: Role;
	/** 展示ディスプレイと写真用の画面番号（1始まり）。それ以外は `null`。 */
	screen: number | null;
	lastReceivedAt: number;
}

export interface Connection {
	readonly meta: ConnectionMeta;
	setMeta(meta: ConnectionMeta): void;
	send(message: ServerMessage): void;
}

export interface CoreOptions {
	store: Store;
	now: () => number;
	randomId: () => string;
	connections: () => Connection[];
	questions: readonly Question[];
	colors: readonly ResultColor[];
	sequences: readonly Sequence[];
}

const KEY_STATE = "state";
const ROLE_ORDER: Readonly<Record<DeviceStatus["role"], number>> = { controller: 0, display: 1, photo: 2 };

/**
 * 展示状態の正本。Durable Objectは要求を一件ずつ処理するため、状態の読み書きに競合はない。
 * 状態が変わったら保存し、全接続へ役割別の状態を配信する。
 */
export class ExhibitCore {
	private lastAdminRefreshAt = 0;

	constructor(private readonly options: CoreOptions) {}

	private load(): ExhibitState {
		const stored = this.options.store.get<ExhibitState>(KEY_STATE);
		// `nickname` を追加する前に保存した状態には、このフィールドがない。
		// 質問定義を変えてデプロイする前に保存した回答は、現在の定義に合わせて除く。
		if (stored) return reconcileState({ ...stored, nickname: stored.nickname ?? null }, this.options.questions);
		const created = initialState(this.options.now());
		this.options.store.put(KEY_STATE, created);
		return created;
	}

	/** 期限切れの状態を進めてから現在状態を返す。進んだ場合は保存して配信する。 */
	current(): ExhibitState {
		const state = this.load();
		const advanced = advanceDeadlines(state, this.options.now(), this.options.sequences);
		if (advanced !== state) this.commit(advanced);
		return advanced;
	}

	private commit(next: ExhibitState): void {
		this.options.store.put(KEY_STATE, next);
		for (const connection of this.options.connections()) this.sendState(connection, next);
		this.lastAdminRefreshAt = this.options.now();
	}

	private sendState(connection: Connection, state: ExhibitState): void {
		connection.send({ type: "state", serverTime: this.options.now(), state: this.viewFor(connection.meta, state) });
	}

	/** 役割別の配信範囲。回答内容とニックネームは診断用iPadにだけ送る。 */
	private viewFor(meta: ConnectionMeta, state: ExhibitState): RoleState {
		switch (meta.role) {
			case "controller":
				return state;
			case "display":
			case "photo":
				return toDisplayState(state);
			case "admin":
				return this.adminView(state);
		}
	}

	private adminView(state: ExhibitState): AdminState {
		const { answers: _answers, nickname: _nickname, ...rest } = state;
		return { ...rest, devices: this.devices() };
	}

	/**
	 * 管理画面の端末一覧。同じ端末の古い接続が残っている場合は、最後に受信した接続だけを表示する。
	 * 診断用iPadは台数を区別せず一行にまとめる。
	 */
	private devices(): DeviceStatus[] {
		const now = this.options.now();
		const latest = new Map<string, ConnectionMeta>();
		for (const { meta } of this.options.connections()) {
			if (meta.role === "admin") continue;
			const key = `${meta.role}:${meta.screen}`;
			const seen = latest.get(key);
			if (!seen || seen.lastReceivedAt < meta.lastReceivedAt) latest.set(key, meta);
		}
		return [...latest.values()]
			.map((meta) => ({
				role: meta.role as DeviceStatus["role"],
				screen: meta.screen,
				connected: now - meta.lastReceivedAt < STALE_AFTER_MS,
				lastReceivedAt: meta.lastReceivedAt,
			}))
			.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.screen ?? 0) - (b.screen ?? 0));
	}

	private refreshAdmins(state: ExhibitState = this.load()): void {
		this.lastAdminRefreshAt = this.options.now();
		for (const connection of this.options.connections()) {
			if (connection.meta.role === "admin") this.sendState(connection, state);
		}
	}

	/** WebSocketを受け入れた直後に呼ぶ。現在状態を送り、管理画面の端末一覧を更新する。 */
	open(connection: Connection): void {
		const state = this.current();
		this.sendState(connection, state);
		this.refreshAdmins(state);
	}

	handleMessage(connection: Connection, raw: string | ArrayBuffer): void {
		const state = this.current();
		const now = this.options.now();
		connection.setMeta({ ...connection.meta, lastReceivedAt: now });
		if (typeof raw !== "string") return;
		const message = parseClientMessage(raw);
		if (!message) return;

		if (message.type === "ping") {
			connection.send({ type: "pong", clientSentAt: message.clientSentAt, serverTime: now });
			if (now - this.lastAdminRefreshAt >= ADMIN_REFRESH_MS) this.refreshAdmins(state);
			return;
		}
		this.handleCommand(connection, message.command, state);
	}

	/**
	 * コマンドを適用する。受理したら全接続へ配信する。拒否したら送信元へ現在状態を送り直し、
	 * 送信元が確定待ちの表示を解除できるようにする。
	 */
	private handleCommand(connection: Connection, command: Command, state: ExhibitState): void {
		const allowed = ROLE_COMMANDS[connection.meta.role].includes(command.name);
		const outcome = allowed
			? applyCommand(state, command, {
					now: this.options.now(),
					questions: this.options.questions,
					colors: this.options.colors,
					sequences: this.options.sequences,
					newSessionId: this.options.randomId,
				})
			: null;
		if (outcome?.ok) this.commit(outcome.state);
		else this.sendState(connection, state);
	}

	handleClose(): void {
		this.refreshAdmins();
	}

	/** 期限の処理。alarmから呼ぶ。 */
	handleAlarm(): void {
		this.current();
	}

	/** 次にalarmを実行する時刻。期限がなければ `null`。 */
	nextWakeAt(): number | null {
		return this.load().phaseEndsAt;
	}
}
