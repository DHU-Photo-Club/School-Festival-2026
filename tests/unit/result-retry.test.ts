import { describe, expect, it } from "vitest";
import { MAX_RETRIES, retryDelay, shouldRetry } from "../../src/client/result/retry.ts";

describe("結果ページの読み直し", () => {
	it("短い間隔から10秒ごとへ広げ、合わせて約3分で打ち切る", () => {
		const delays = Array.from({ length: MAX_RETRIES + 1 }, (_, attempt) => retryDelay(attempt));
		expect(delays.slice(0, 5)).toEqual([1_000, 2_000, 3_000, 5_000, 10_000]);
		expect(delays[MAX_RETRIES]).toBeNull();
		const total = delays.reduce<number>((sum, delay) => sum + (delay ?? 0), 0);
		// 会場サーバーの再送（30秒）と送信の上限（10秒）、KVの反映（60秒）を足した100秒より長く待つ。
		expect(total).toBeGreaterThan(100_000);
		expect(total).toBe(181_000);
	});

	it("まだ届いていない結果、一時的な失敗、通信の失敗だけを読み直す", () => {
		expect(shouldRetry(404)).toBe(true);
		expect(shouldRetry(503)).toBe(true);
		expect(shouldRetry(null)).toBe(true);
		expect(shouldRetry(410)).toBe(false);
		expect(shouldRetry(400)).toBe(false);
	});
});
