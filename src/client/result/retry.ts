/**
 * 結果ページがデータを読み直すまでの待ち時間（仕様書10.1節）。会場サーバーから結果ページのWorkerへ結果が届くまで
 * （施設回線の切断からの再送を含む）と、Workers KVへの反映（最大60秒）を待つ。
 * 最初は短い間隔で、その後は10秒ごとに、合わせて約3分読み直す。`attempt` は0始まりの読み直しの回数。
 * 読み直さない場合は `null`。
 */
const FIRST_DELAYS_MS = [1_000, 2_000, 3_000, 5_000];
const LATER_DELAY_MS = 10_000;
/** 読み直しの回数の上限。1 + 2 + 3 + 5 + 10 × 17 = 181秒。 */
export const MAX_RETRIES = 21;

export function retryDelay(attempt: number): number | null {
	if (attempt < 0 || attempt >= MAX_RETRIES) return null;
	return FIRST_DELAYS_MS[attempt] ?? LATER_DELAY_MS;
}

/** 読み直す応答か。まだ届いていない結果（404）、サーバーの一時的な失敗（5xx）、通信の失敗（`null`）。 */
export function shouldRetry(status: number | null): boolean {
	return status === null || status === 404 || status >= 500;
}
