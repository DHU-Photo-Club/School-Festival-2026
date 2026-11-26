import type { Command } from "../shared/machine.ts";
import {
	advanceDeadlines,
	applyCommand,
	DEFAULT_JUDGING_MAX_MS,
	initialState,
	ROLE_COMMANDS,
	reconcileState,
	settleJudging,
} from "../shared/machine.ts";
import type { AdminState, DeviceStatus, RoleState, ServerMessage } from "../shared/protocol.ts";
import { parseClientMessage, toDisplayState } from "../shared/protocol.ts";
import type { PublicResult, ResultRecord } from "../shared/result.ts";
import { RESULT_ID_PATTERN } from "../shared/result.ts";
import type { Answer, ExhibitState, Question, QuestionId, Role, Sequence, SessionResult } from "../shared/types.ts";
import type { Judge } from "./ai/judge.ts";

/** 最後の受信からこの時間を過ぎた端末を、管理画面で切断と表示する。端末は5秒ごとに `ping` を送る。 */
export const STALE_AFTER_MS = 15_000;
/** 端末の最終受信時刻だけが変わったときに管理画面へ送る間隔。 */
const ADMIN_REFRESH_MS = 5_000;

/** 展示状態を保存するキー・値ストア。会場サーバーではSQLiteのファイルを使う（src/server/store.ts）。 */
export interface Store {
	get<T>(key: string): T | undefined;
	put(key: string, value: unknown): void;
}

/** 接続ごとの情報。会場サーバーではWebSocketごとに持つ（src/server/exhibit.ts）。 */
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
	sequences: readonly Sequence[];
	/** 写真の配布許可を引くためのカタログ。 */
	photos: readonly { id: string; shareAllowed: boolean }[];
	/**
	 * 回答から結果を決める関数（refs/handoff 実装仕様書2章）。省略すると結果を決められないため、
	 * 最終問の回答のたびに選定失敗として最終問へ戻る（固定計算で代わりの結果を作らない）。
	 */
	judge?: Judge;
	/** `judging` の最長の長さ。省略すると `DEFAULT_JUDGING_MAX_MS`。 */
	judgingMaxMs?: number;
	/** 結果の記録を保存した直後に呼ぶ。会場サーバーはここで結果ページへ公開する部分を外部へ送る。 */
	onResult?: (result: PublicResult) => void;
	log?: (message: string) => void;
}

const KEY_STATE = "state";
/** 結果の記録のキー。 */
const resultKey = (id: string) => `result:${id}`;
const ROLE_ORDER: Readonly<Record<DeviceStatus["role"], number>> = { controller: 0, display: 1, photo: 2, light: 3 };

/**
 * 展示状態の正本。Node.jsはメッセージを一件ずつ処理し、状態の読み書きは同期処理のため、競合はない。
 * 状態が変わったら保存し、全接続へ役割別の状態を配信する。
 */
export class ExhibitCore {
	private lastAdminRefreshAt = 0;
	private readonly options: CoreOptions;

	constructor(options: CoreOptions) {
		this.options = options;
	}

	private load(): ExhibitState {
		const stored = this.options.store.get<ExhibitState>(KEY_STATE);
		// 8色の配点判定の版で保存した状態（`judgeFailed` がない）は、セッションを捨てて待機から始める。
		// `accepting` と `revision` は引き継ぐ。
		if (stored && !("judgeFailed" in stored)) {
			const legacy = stored as Partial<ExhibitState>;
			const migrated = {
				...initialState(this.options.now()),
				accepting: legacy.accepting ?? true,
				revision: (legacy.revision ?? 0) + 1,
			};
			this.options.store.put(KEY_STATE, migrated);
			return migrated;
		}
		// 質問定義を変えてデプロイする前に保存した回答は、現在の定義に合わせて除く。
		if (stored) return reconcileState(stored, this.options.questions);
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

	/** 役割別の配信範囲。回答内容とニックネームは診断用iPadにだけ送る。電球の中継には展示ディスプレイと同じ範囲を送る。 */
	private viewFor(meta: ConnectionMeta, state: ExhibitState): RoleState {
		switch (meta.role) {
			case "controller":
				return state;
			case "display":
			case "photo":
			case "light":
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

	/**
	 * メッセージを処理する。AIの選定を待ち始めた場合は、結果を反映し終えたら解決する
	 * Promise を返す（会場サーバーは解決後に期限のタイマーを設定し直す）。それ以外は `null`。
	 */
	handleMessage(connection: Connection, raw: string | ArrayBuffer): Promise<void> | null {
		const state = this.current();
		const now = this.options.now();
		connection.setMeta({ ...connection.meta, lastReceivedAt: now });
		if (typeof raw !== "string") return null;
		const message = parseClientMessage(raw);
		if (!message) return null;

		if (message.type === "ping") {
			connection.send({ type: "pong", clientSentAt: message.clientSentAt, serverTime: now });
			if (now - this.lastAdminRefreshAt >= ADMIN_REFRESH_MS) this.refreshAdmins(state);
			return null;
		}
		return this.handleCommand(connection, message.command, state);
	}

	/**
	 * コマンドを適用する。受理したら全接続へ配信する。拒否したら送信元へ現在状態を送り直し、
	 * 送信元が確定待ちの表示を解除できるようにする。
	 */
	private handleCommand(connection: Connection, command: Command, state: ExhibitState): Promise<void> | null {
		const allowed = ROLE_COMMANDS[connection.meta.role].includes(command.name);
		const outcome = allowed
			? applyCommand(state, command, {
					now: this.options.now(),
					questions: this.options.questions,
					sequences: this.options.sequences,
					newSessionId: this.options.randomId,
					judgingMaxMs: this.judgingMaxMs(),
				})
			: null;
		if (!outcome?.ok) {
			this.sendState(connection, state);
			return null;
		}
		this.commit(outcome.state);
		const { sessionId } = outcome.state;
		if (!outcome.judgedAnswers || sessionId === null) return null;
		return this.runJudge(sessionId, outcome.judgedAnswers);
	}

	private judgingMaxMs(): number {
		return this.options.judgingMaxMs ?? DEFAULT_JUDGING_MAX_MS;
	}

	/**
	 * AIで結果を決め、`judging` を締める（refs/handoff 実装仕様書2章）。結果は記録として保存してから配信する。
	 * `judging` の期限までに決まらなければ打ち切り、期限の処理で最終問へ戻す。
	 */
	private async runJudge(sessionId: string, answers: Readonly<Record<QuestionId, Answer>>): Promise<void> {
		const { judge } = this.options;
		let record: ResultRecord | null = null;
		if (judge) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), this.judgingMaxMs());
			try {
				record = await judge(answers, controller.signal);
			} catch (error) {
				// `Judge` は例外を投げない約束だが、投げても `judging` に取り残さず最終問へ戻す。
				(this.options.log ?? console.error)(
					`AIの選定で予期しない例外が起きました: ${error instanceof Error ? error.message : String(error)}`,
				);
			} finally {
				clearTimeout(timer);
			}
		} else {
			(this.options.log ?? console.error)(
				"AIの選定が設定されていないため、結果を決められません。.env に MISTRAL_API_KEY を設定してください（開発中は AI_STUB=1 でも動きます）",
			);
		}
		const state = this.current();
		// 期限の処理や強制リセットで、待っていたセッションの `judging` が終わっていれば何もしない。
		if (state.phase !== "judging" || state.sessionId !== sessionId) return;
		let result: SessionResult | null = null;
		if (record) {
			this.options.store.put(resultKey(record.id), record);
			const published = this.publicResult(record.id);
			if (published) this.options.onResult?.(published);
			result = {
				id: record.id,
				name: record.color.name,
				reading: record.color.reading,
				colors: [record.color.colors[0].id, record.color.colors[1].id],
				photoIds: record.photos.selected.map((pick) => pick.photoId),
			};
		}
		const settled = settleJudging(state, sessionId, result, this.options.now());
		if (settled) this.commit(settled);
	}

	/** 保存した結果の記録。 */
	resultRecord(id: string): ResultRecord | null {
		if (!RESULT_ID_PATTERN.test(id)) return null;
		return this.options.store.get<ResultRecord>(resultKey(id)) ?? null;
	}

	/** 結果ページへ公開する部分（refs/handoff 実装仕様書8章）。回答と写真の根拠は含めない。 */
	publicResult(id: string): PublicResult | null {
		const record = this.resultRecord(id);
		if (!record) return null;
		const shareable = new Set(this.options.photos.filter((photo) => photo.shareAllowed).map((photo) => photo.id));
		const { color } = record;
		return {
			id: record.id,
			name: color.name,
			nameReason: color.nameReason,
			reading: color.reading,
			relationship: color.relationship,
			colors: [
				{ id: color.colors[0].id, reason: color.colors[0].reason },
				{ id: color.colors[1].id, reason: color.colors[1].reason },
			],
			photoIds: record.photos.selected.map((pick) => pick.photoId).filter((id) => shareable.has(id)),
		};
	}

	handleClose(): void {
		this.refreshAdmins();
	}

	/** 期限の処理。期限のタイマーから呼ぶ。 */
	handleAlarm(): void {
		this.current();
	}

	/** 次に期限のタイマーを実行する時刻。期限がなければ `null`。 */
	nextWakeAt(): number | null {
		return this.load().phaseEndsAt;
	}
}
