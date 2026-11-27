import envelopes from "../../data/speech-envelope.json";
import { SOUND_MIX, welcomeNarrationGapAfterMs } from "../../data/sound.ts";
import type { ShardPose } from "../../shared/shards.ts";
import type { SoundCue } from "../../shared/sound.ts";

export interface SpeechPlan { clips: { number: number; at: number }[]; endsAt: number }
const clips = envelopes as Record<string, { durationMs: number; levels: number[] }>;
const FRAME_MS = 40;

/** 音声と同じ順序・間隔で、描画専用の発話強度を読む。通信・音声再生には触れない。 */
export function planSpeech(cue: Extract<SoundCue, { kind: "narration" }>, at: number, previous: SpeechPlan | null): SpeechPlan {
	const delay = cue.scene === "questionSwitch" ? SOUND_MIX.questionSwitchNarrationDelayMs
		: cue.scene === "result" ? SOUND_MIX.resultNarrationDelayMs : 0;
	let start = at + Math.max(previous && previous.endsAt > at ? SOUND_MIX.narrationFadeOutMs : 0, delay);
	const scheduled = cue.numbers.map((number) => {
		const entry = { number, at: start };
		start += (clips[number]?.durationMs ?? 0) + (cue.scene === "welcome" ? welcomeNarrationGapAfterMs(number) : SOUND_MIX.narrationGapMs);
		return entry;
	});
	const last = scheduled.at(-1);
	return { clips: scheduled, endsAt: last ? last.at + clips[last.number].durationMs : at };
}

export function speechLevel(plan: SpeechPlan | null, now: number): number {
	if (!plan) return 0;
	let level = 0;
	for (const clip of plan.clips) {
		const position = (now - clip.at) / FRAME_MS;
		const envelope = clips[clip.number];
		if (position < 0 || !envelope || now >= clip.at + envelope.durationMs) continue;
		const index = Math.floor(position);
		const a = envelope.levels[index] ?? 0;
		const b = envelope.levels[index + 1] ?? 0;
		level = Math.max(level, (a + (b - a) * (position - index)) / 100);
	}
	return level;
}

/** 選んだ一部だけを微小に傾ける。中心位置・軌道・元の呼吸は変えない。 */
export function speakingShards(poses: ShardPose[], now: number, level: number): ShardPose[] {
	if (level <= 0) return poses;
	return poses.map((piece, index) => {
		if ((index * 37) % 17 >= 6) return piece;
		const phase = index * 2.39996;
		const angle = Math.sin(now * 0.051 + phase) * 0.014 * level;
		const scale = 1 + Math.sin(now * 0.037 + phase) * 0.012 * level;
		const c = Math.cos(angle) * scale;
		const s = Math.sin(angle) * scale;
		return { ...piece, vertices: piece.vertices.map(([x, y]) => {
			const dx = x - piece.x;
			const dy = y - piece.y;
			return [piece.x + dx * c - dy * s, piece.y + dx * s + dy * c] as const;
		}) };
	});
}
