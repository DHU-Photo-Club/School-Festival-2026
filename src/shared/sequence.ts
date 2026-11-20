import type { ExhibitState, Sequence, SequenceTarget } from "./types.ts";

/** 段階 `target` へ入る直前に再生するシーケンス。なければ `null`。 */
export function sequenceBefore(sequences: readonly Sequence[], target: SequenceTarget): Sequence | null {
	return sequences.find((sequence) => sequence.before === target && sequence.durationMs > 0) ?? null;
}

export function findSequence(sequences: readonly Sequence[], id: string | null): Sequence | null {
	return sequences.find((sequence) => sequence.id === id) ?? null;
}

/**
 * 再生時間。サーバーが決めた `phaseEndsAt` を正とし、端末のシーケンス定義と食い違っても
 * サーバーの遷移時刻に合わせる。`phaseEndsAt` がなければ定義の `durationMs`。
 */
export function sequenceDuration(
	sequence: Sequence,
	state: Pick<ExhibitState, "phaseStartedAt" | "phaseEndsAt">,
): number {
	return state.phaseEndsAt === null ? sequence.durationMs : Math.max(0, state.phaseEndsAt - state.phaseStartedAt);
}

/** 補正済みサーバー時刻 `now` での再生位置（ミリ秒）。0から `durationMs` までに収める。 */
export function sequenceTime(durationMs: number, phaseStartedAt: number, now: number): number {
	return Math.min(durationMs, Math.max(0, now - phaseStartedAt));
}
