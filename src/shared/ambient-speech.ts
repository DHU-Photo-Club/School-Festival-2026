import envelopes from "../data/narration-envelope.json";
import { SOUND_CUES, SOUND_MIX, welcomeNarrationGapAfterMs } from "../data/sound.ts";
import { QUESTIONS } from "../data/questions.ts";
import { soundCues } from "./sound.ts";
import type { DisplayState, SoundState } from "./types.ts";
/** 50msごとの音源解析値。閾値以下の余韻は除外済み。音源差し替え時は再生成する。 */
export class AmbientSpeech {
	private schedule: { number: number; at: number }[] = [];
	update(prev: DisplayState | null, next: DisplayState, now: number) {
		const state = (s: DisplayState): SoundState => ({ ...s, questionIndex: s.questionIndex ?? null });
		for (const cue of soundCues(prev ? state(prev) : null, state(next), QUESTIONS.map(q => q.id), SOUND_CUES)) {
			if (cue.kind === "stopNarration") this.schedule = [];
			if (cue.kind !== "narration") continue;
			const playing = this.schedule.some(s => s.at <= now && s.at + envelopes[s.number - 1].durationMs > now);
			const delay = cue.scene === "result" ? SOUND_MIX.resultNarrationDelayMs : cue.scene === "questionSwitch" ? SOUND_MIX.questionSwitchNarrationDelayMs : 0;
			let at = now + Math.max(playing ? SOUND_MIX.narrationFadeOutMs : 0, delay);
			this.schedule = cue.numbers.map(number => {
				const entry = { number, at };
				at += envelopes[number - 1].durationMs + (cue.scene === "welcome" ? welcomeNarrationGapAfterMs(number) : SOUND_MIX.narrationGapMs);
				return entry;
			});
		}
	}
	level(now: number) {
		return Math.max(0, ...this.schedule.map(({ number, at }) => {
			const levels = envelopes[number - 1].levels;
			const t = (now - at) / 50, i = Math.floor(t), f = t - i;
			return (levels[i] ?? 0) * (1 - f) + (levels[i + 1] ?? 0) * f;
		}));
	}
}
