/** 一回の `ping` と `pong` の計測。時刻はクライアントの `performance.timeOrigin + performance.now()`。 */
export interface ClockSample {
	clientSentAt: number;
	clientReceivedAt: number;
	serverTime: number;
}

/**
 * サーバー時刻 - クライアント時刻の推定値。往復時間が最も短い計測を使う。
 * 往復が短いほど、行きと帰りの遅延の偏りによる誤差が小さいため。
 */
export function bestOffset(samples: readonly ClockSample[]): number | null {
	let best: ClockSample | null = null;
	for (const sample of samples) {
		const rtt = sample.clientReceivedAt - sample.clientSentAt;
		if (!best || rtt < best.clientReceivedAt - best.clientSentAt) best = sample;
	}
	return best ? best.serverTime - (best.clientSentAt + best.clientReceivedAt) / 2 : null;
}
