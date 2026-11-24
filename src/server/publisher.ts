import type { PublicResult } from "../shared/result.ts";
import type { SqliteStore } from "./store.ts";

/** 送信待ちの結果のキー。送れたら消す。 */
const outboxKey = (id: string) => `outbox:${id}`;
/** 送れなかった結果を送り直す間隔。 */
export const RETRY_MS = 30_000;
/** 一回の送信の上限。 */
const UPLOAD_TIMEOUT_MS = 10_000;

export interface PublisherOptions {
	store: SqliteStore;
	/** 結果ページのWorkerのorigin（`PUBLIC_ORIGIN`）。 */
	origin: string;
	token: string;
	fetch?: typeof fetch;
	retryMs?: number;
	log?: (message: string) => void;
}

/**
 * 結果ページへ公開する部分を、結果ページのWorker（`PUT /api/results/{id}`）へ送る（仕様書10.1節）。
 * 送る前にSQLiteへ保存し、施設回線が切れていても、つながってから送り直す。会場サーバーを再起動しても残る。
 */
export class ResultPublisher {
	private readonly options: PublisherOptions;
	private flushing: Promise<void> | null = null;
	private pending = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private closed = false;

	constructor(options: PublisherOptions) {
		this.options = options;
	}

	private log(message: string): void {
		(this.options.log ?? console.error)(message);
	}

	/** 結果を送信待ちに加えて、すぐに送る。 */
	enqueue(result: PublicResult): void {
		this.options.store.put(outboxKey(result.id), result);
		void this.flush();
	}

	/** 送信待ちの結果をすべて送る。送信中に呼ばれたら、終わってからもう一度送る。 */
	flush(): Promise<void> {
		if (this.flushing) {
			this.pending = true;
			return this.flushing;
		}
		this.flushing = (async () => {
			try {
				do {
					this.pending = false;
					await this.sendAll();
				} while (this.pending && !this.closed);
			} catch (error) {
				// SQLiteの読み書きの失敗など。送信待ちは残っているため、間隔をあけて送り直す。
				this.log(`結果の送信に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
				this.retryLater();
			} finally {
				this.flushing = null;
			}
		})();
		return this.flushing;
	}

	private async sendAll(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		let failed = false;
		for (const result of this.options.store.list<PublicResult>("outbox:")) {
			if (this.closed) return;
			const sent = await this.send(result);
			// 送信中に閉じた場合は、SQLiteも閉じているため触らない。送信待ちは次の起動で送る。
			if (this.closed) return;
			if (sent) this.options.store.delete(outboxKey(result.id));
			else failed = true;
		}
		if (failed) this.retryLater();
	}

	private retryLater(): void {
		if (this.closed || this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush();
		}, this.options.retryMs ?? RETRY_MS);
	}

	/**
	 * 送れたら `true`。送り直しても受け付けられない場合（公開期間の終了、内容の不備）も、送り直さないため `true` にする。
	 * トークンの不一致（401、403）は設定を直して再起動すれば送れるため、送信待ちに残す。
	 */
	private async send(result: PublicResult): Promise<boolean> {
		const url = `${this.options.origin}/api/results/${encodeURIComponent(result.id)}`;
		try {
			const response = await (this.options.fetch ?? fetch)(url, {
				method: "PUT",
				headers: { Authorization: `Bearer ${this.options.token}`, "Content-Type": "application/json" },
				body: JSON.stringify(result),
				signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
			});
			if (response.ok) return true;
			if (response.status === 410) {
				this.log(`結果ページの公開期間が終わっているため、結果 ${result.id} を送りません`);
				return true;
			}
			if (response.status === 400 || response.status === 413) {
				this.log(
					`結果 ${result.id} は結果ページのWorkerが受け付けないため、送りません: HTTP ${response.status} ${await response.text()}`,
				);
				return true;
			}
			this.log(
				`結果 ${result.id} を結果ページへ送れませんでした: HTTP ${response.status} ${await response.text()}`,
			);
		} catch (error) {
			this.log(
				`結果 ${result.id} を結果ページへ送れませんでした: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		return false;
	}

	/** 送信待ちの件数。 */
	backlog(): number {
		return this.options.store.list("outbox:").length;
	}

	close(): void {
		this.closed = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}
}
