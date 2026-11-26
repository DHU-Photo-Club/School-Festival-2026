import type { SoundState } from "./types.ts";

/** 場面ごとの音の対応（`src/data/sound.ts` の `SOUND_CUES`）。番号は引き継ぎ資料の番号。 */
export interface SoundCueMap {
	welcome: readonly number[];
	nicknameAnswer: number;
	questions: Readonly<Record<string, { narration: readonly number[]; answer: number }>>;
	judging: readonly number[];
	result: readonly number[];
}

/** 状態の変化から決まる、サウンド用の画面が鳴らす音。 */
export type SoundCue =
	/** 読んでいるナレーションを止め、`numbers` を順に読む。 */
	| {
			kind: "narration";
			numbers: readonly number[];
			/**
			 * `question` は質問へ入った直後（iPadがすぐに質問を出す）、`questionSwitch` は質問から別の質問へ移ったとき
			 * （iPadは前の質問を落としてから次の質問を降ろす）。
			 */
			scene: "welcome" | "question" | "questionSwitch" | "judging" | "result";
	  }
	/** 読んでいるナレーションを止める。 */
	| { kind: "stopNarration" }
	/** 回答SE（引き継ぎ資料の `Q{number}.caf`）。 */
	| { kind: "answer"; number: number }
	/** 完了SE（Complete_v13_open_chord）。 */
	| { kind: "complete" };

/**
 * 直前に受け取った状態 `prev` から `next` への変化で鳴らす音（仕様書11.2節）。
 *
 * - 状態は受理のたびに `revision` が1増え、全端末へ配信される。`revision` が飛んだ（切断中に進んだ、
 *   サーバーが期限をまとめて進めた）ときと、ページを開いた直後（`prev` が `null`）は、過ぎた出来事を
 *   後から鳴らさない。ただし体験が終わっていればナレーションは止める。
 * - 回答SEは回答を受け付けた時点で鳴らす（iPadの送信からの遅れは会場のネットワークの往復だけ）。
 * - 質問のナレーションは、質問が画面に出る時に鳴らす。質問から質問へ移るときは、iPadが前の質問を落としてから
 *   次の質問を降ろすため、`questionSwitch` として、その遅れの分を再生側で待つ。
 * - AIの選定に失敗して最終問へ戻ったときは、質問のナレーションを読み直さず、色の探索のナレーションを止める。
 */
export function soundCues(
	prev: SoundState | null,
	next: SoundState,
	questionIds: readonly string[],
	cues: SoundCueMap,
): SoundCue[] {
	if (prev === null || next.revision !== prev.revision + 1) {
		return prev !== null && next.sessionId !== prev.sessionId ? [{ kind: "stopNarration" }] : [];
	}
	if (next.sessionId !== prev.sessionId) {
		return next.sessionId === null
			? [{ kind: "stopNarration" }]
			: [{ kind: "narration", numbers: cues.welcome, scene: "welcome" }];
	}
	if (next.sessionId === null) return [];

	const out: SoundCue[] = [];
	if (prev.phase === "intro" && (next.phase === "sequence" || next.phase === "question")) {
		out.push({ kind: "answer", number: cues.nicknameAnswer });
	}
	// 回答を受け付けると `answeredAt` が変わる。`judging` へは最終問の回答でしか入らない。
	const answered = (next.answeredAt !== prev.answeredAt && next.answeredAt !== null) || next.phase === "judging";
	if (answered && prev.phase === "question") {
		const id = prev.questionIndex === null ? undefined : questionIds[prev.questionIndex];
		const cue = id === undefined ? undefined : cues.questions[id];
		if (cue) out.push({ kind: "answer", number: cue.answer });
	}
	if (next.phase === "question" && next.questionIndex !== null) {
		if (prev.phase === "judging") {
			out.push({ kind: "stopNarration" });
		} else if (prev.phase !== "question" || prev.questionIndex !== next.questionIndex) {
			const id = questionIds[next.questionIndex];
			const cue = id === undefined ? undefined : cues.questions[id];
			const scene = prev.phase === "question" ? "questionSwitch" : "question";
			out.push(cue ? { kind: "narration", numbers: cue.narration, scene } : { kind: "stopNarration" });
		}
	}
	if (next.phase === "judging" && prev.phase !== "judging") {
		out.push({ kind: "narration", numbers: cues.judging, scene: "judging" });
	}
	if (next.phase === "result" && prev.phase !== "result") {
		out.push({ kind: "complete" }, { kind: "narration", numbers: cues.result, scene: "result" });
	}
	return out;
}

/**
 * ガラス音の次の一巡の順番（引き継ぎ資料5節）。`count` 種類をシャッフルし、一巡の境界で直前の音 `last` と
 * 同じ音が続かないようにする。`random` は0以上1未満を返す。
 */
export function glassCycle(count: number, last: number | null, random: () => number): number[] {
	const order = Array.from({ length: count }, (_, index) => index);
	for (let index = count - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1));
		[order[index], order[swap]] = [order[swap], order[index]];
	}
	if (count > 1 && order[0] === last) {
		const swap = 1 + Math.floor(random() * (count - 1));
		[order[0], order[swap]] = [order[swap], order[0]];
	}
	return order;
}

/** `[min, max]` から一様に選ぶ。 */
export function randomIn([min, max]: readonly [number, number], random: () => number): number {
	return min + (max - min) * random();
}
