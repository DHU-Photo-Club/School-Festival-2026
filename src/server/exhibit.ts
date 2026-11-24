import { AI_SETTINGS } from "../data/ai.ts";
import { PALETTE } from "../data/palette.ts";
import { PHOTOS } from "../data/photos.ts";
import { QUESTION_VERSION, QUESTIONS } from "../data/questions.ts";
import { SEQUENCES } from "../data/sequences.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import type { PublicResult } from "../shared/result.ts";
import type { Judge } from "./ai/judge.ts";
import { createJudge, createStubJudge } from "./ai/judge.ts";
import type { ServerConfig } from "./config.ts";
import type { Connection, ConnectionMeta } from "./core.ts";
import { ExhibitCore } from "./core.ts";
import { DEFAULT_MISTRAL_MODEL, sendPrompt } from "./mistral.ts";
import { ResultPublisher } from "./publisher.ts";
import type { SqliteStore } from "./store.ts";
import { openStore } from "./store.ts";

/** 推測されにくい結果ID（16桁の16進数）。 */
function newResultId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * 結果を決める `Judge`（refs/handoff 実装仕様書2章）。`MISTRAL_API_KEY` があれば Mistral AI で選ぶ。
 * `AI_STUB=1` なら開発用の仮の結果を返す。どちらもなければ `undefined`（結果を決められない）。
 */
function judgeFor(config: ServerConfig): Judge | undefined {
	const common = {
		questionVersion: QUESTION_VERSION,
		palette: PALETTE,
		photos: PHOTOS,
		now: () => Date.now(),
		newResultId,
	};
	// E2Eテストは `.env` にAPIキーがあってもAIへ接続しないよう、仮の選定を優先する。本番では設定しない。
	if (config.aiStub) return createStubJudge(common);
	if (config.mistralApiKey) {
		const mistral = {
			apiKey: config.mistralApiKey,
			model: config.mistralModel ?? DEFAULT_MISTRAL_MODEL,
			baseUrl: config.mistralBaseUrl,
		};
		return createJudge({
			...common,
			send: (request) => sendPrompt(mistral, request),
			model: mistral.model,
			questions: QUESTIONS,
		});
	}
	return undefined;
}

/** 会場サーバーが受け入れたWebSocket。`ws` と、テスト用の偽の接続が満たす。 */
export interface Socket {
	readonly readyState: number;
	send(data: string): void;
}

const OPEN = 1;

/** 展示全体で一つの展示状態。保存し、接続した全端末へ配信する。 */
export class Exhibit {
	private readonly store: SqliteStore;
	private readonly core: ExhibitCore;
	private readonly publisher: ResultPublisher | null;
	private readonly sockets = new Map<Socket, ConnectionMeta>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** 期限の処理が続けて失敗した回数。失敗が続く間は、間隔を広げて処理し直す。 */
	private alarmFailures = 0;

	constructor(config: ServerConfig) {
		this.store = openStore(config.dataFile);
		this.publisher = config.resultsUploadToken
			? new ResultPublisher({ store: this.store, origin: config.publicOrigin, token: config.resultsUploadToken })
			: null;
		if (!this.publisher) console.warn("RESULTS_UPLOAD_TOKEN が未設定のため、結果を結果ページへ送りません");
		const judge = judgeFor(config);
		if (!judge) console.warn("MISTRAL_API_KEY が未設定のため、AIの選定ができず、結果を出せません");
		this.core = new ExhibitCore({
			store: this.store,
			now: () => Date.now(),
			randomId: () => crypto.randomUUID(),
			connections: () =>
				[...this.sockets.keys()]
					.filter((socket) => socket.readyState === OPEN)
					.map((socket) => this.wrap(socket)),
			questions: QUESTIONS,
			sequences: SEQUENCES,
			photos: PHOTOS,
			judge,
			judgingMaxMs: AI_SETTINGS.judgingMaxMs,
			onResult: (result) => this.publisher?.enqueue(result),
		});
		// 前回の起動で送れなかった結果を送る。
		void this.publisher?.flush();
		this.schedule();
	}

	private wrap(socket: Socket): Connection {
		const sockets = this.sockets;
		return {
			get meta() {
				return { ...(sockets.get(socket) as ConnectionMeta) };
			},
			setMeta: (meta) => {
				if (sockets.has(socket)) sockets.set(socket, meta);
			},
			send: (message: ServerMessage) => {
				try {
					socket.send(JSON.stringify(message));
				} catch {
					// 切断済みの接続への送信失敗は無視する。
				}
			},
		};
	}

	/** 次の期限にタイマーを設定する。期限がなければ止める。 */
	private schedule(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const wakeAt = this.core.nextWakeAt();
		if (wakeAt === null) return;
		this.timer = setTimeout(
			() => {
				this.timer = null;
				try {
					this.core.handleAlarm();
					this.alarmFailures = 0;
				} catch (error) {
					// SQLiteへ書けない間は期限が過ぎたままになるため、1秒から30秒まで間隔を倍にしてやり直す。
					this.alarmFailures++;
					if (this.alarmFailures <= 3 || this.alarmFailures % 10 === 0) {
						console.error(`期限の処理に失敗しました（${this.alarmFailures}回目）`, error);
					}
				} finally {
					this.schedule();
				}
			},
			Math.max(
				wakeAt - Date.now(),
				this.alarmFailures > 0 ? Math.min(1_000 * 2 ** (this.alarmFailures - 1), 30_000) : 10,
			),
		);
	}

	/** WebSocketを受け入れた直後に呼ぶ。 */
	open(socket: Socket, meta: Omit<ConnectionMeta, "lastReceivedAt">): void {
		this.sockets.set(socket, { ...meta, lastReceivedAt: Date.now() });
		this.core.open(this.wrap(socket));
		this.schedule();
	}

	async message(socket: Socket, message: string | ArrayBuffer): Promise<void> {
		if (!this.sockets.has(socket)) return;
		let pending: Promise<void> | null;
		try {
			pending = this.core.handleMessage(this.wrap(socket), message);
		} finally {
			// 処理の途中で失敗しても、保存済みの期限でタイマーを設定し直す。
			this.schedule();
		}
		if (!pending) return;
		// AIの選定を待つ間も、他の端末のメッセージは処理される。
		// 選定で `judging` の終了時刻が変わったら、タイマーを設定し直す。
		try {
			await pending;
		} catch (error) {
			console.error("AIの選定の反映に失敗しました", error);
		}
		this.schedule();
	}

	close(socket: Socket): void {
		if (!this.sockets.delete(socket)) return;
		try {
			this.core.handleClose();
		} catch (error) {
			console.error("切断の処理に失敗しました", error);
		}
	}

	/** 結果ページへ公開する部分。なければ `null`。 */
	publicResult(id: string): PublicResult | null {
		return this.core.publicResult(id);
	}

	/** サーバーの終了時に呼ぶ。タイマーを止め、SQLiteを閉じる。 */
	dispose(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.publisher?.close();
		this.store.close();
	}
}
