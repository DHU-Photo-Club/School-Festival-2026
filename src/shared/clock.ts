/** 一回の `ping` と `pong` の計測。時刻はクライアントの `performance.timeOrigin + performance.now()`。 */
export interface ClockSample {
	clientSentAt: number;
	clientReceivedAt: number;
	serverTime: number;
}

export interface ClockEstimate {
	offset: number;
	minRoundTripTime: number;
	offsetSpread: number;
}

/**
 * 時刻補正値を求める（仕様書8.6節）。往復時間が長い2件を除き、残る3件の補正値の中央値を使う。
 * 5件に満たない場合は、そろった件数から同じ規則で求める。
 */
export function estimateClock(samples: readonly ClockSample[]): ClockEstimate | null {
	if (samples.length === 0) return null;
	const measured = samples
		.map((sample) => ({
			roundTripTime: sample.clientReceivedAt - sample.clientSentAt,
			offset: sample.serverTime - (sample.clientSentAt + sample.clientReceivedAt) / 2,
		}))
		.sort((a, b) => a.roundTripTime - b.roundTripTime);
	const kept = measured.slice(0, Math.max(1, measured.length - 2));
	const offsets = kept.map((sample) => sample.offset).sort((a, b) => a - b);
	const middle = Math.floor(offsets.length / 2);
	const offset = offsets.length % 2 === 1 ? offsets[middle] : (offsets[middle - 1] + offsets[middle]) / 2;
	return {
		offset,
		minRoundTripTime: measured[0].roundTripTime,
		offsetSpread: offsets[offsets.length - 1] - offsets[0],
	};
}
