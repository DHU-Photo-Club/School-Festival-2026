/**
 * サウンド演出の設定（仕様書11.2節）。正本は refs/サウンド実装引き継ぎ（v1.5）の
 * `handoff/サウンド演出仕様と実装引き継ぎ.md` と `playback-config.json`。
 *
 * 番号の注意: 引き継ぎ資料の「Q1〜Q6」はニックネーム入力をQ1、内容の質問をQ2〜Q6と数える。
 * このアプリの質問ID（`src/data/questions.ts`）は内容の質問だけを `Q1`〜`Q5` と数えるため、一つずれる。
 * 下の `SOUND_CUES.questions` はアプリの質問IDで引き、音源の番号は引き継ぎ資料の番号で書く。
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** 配信用の音源（`pnpm export-sounds` で public/ の下へ書き出す）。 */
export const SOUND_FILES = {
	/** BGM01.m4a。展示中は常にループする。 */
	bgm: "/sounds/bgm.m4a",
	/** ガラス音「遠く小さく鳴る18種類」。並びは引き継ぎ資料の個別WAVの番号（01〜18）。 */
	glass: Array.from({ length: 18 }, (_, index) => `/sounds/glass/${pad(index + 1)}.ogg`),
	/** ナレーション（とまくらボイス）1.wav〜12.wav。`narration[0]` が 1.wav。 */
	narration: Array.from({ length: 12 }, (_, index) => `/sounds/narration/${pad(index + 1)}.ogg`),
	/** 回答送信時のQ1.caf〜Q6.caf。`answer[0]` が Q1.caf（ニックネーム入力）。 */
	answer: Array.from({ length: 6 }, (_, index) => `/sounds/answer/q${index + 1}.ogg`),
	/** 完了SE Complete_v13_open_chord.caf。 */
	complete: "/sounds/complete.ogg",
} as const;

/** 質問ごとのナレーションと回答SE。番号は引き継ぎ資料の番号（ナレーションは `N.wav`、回答SEは `QN.caf`）。 */
export interface QuestionCue {
	/** 質問へ入ったときに順に読むナレーション。 */
	narration: readonly number[];
	/** 回答を受け付けたときに鳴らす回答SE。 */
	answer: number;
}

/** どの場面で何を鳴らすか。ナレーションと回答SEの対応はユーザー確認済み（引き継ぎ資料 v1.5）。 */
export const SOUND_CUES = {
	/**
	 * 「はじめる」で新しい体験が始まったとき。導入の1〜3.wav（ようこそ、企画説明、体験への導入）に続けて、
	 * ニックネーム入力の案内4.wavまで読む。
	 */
	welcome: [1, 2, 3, 4],
	/** ニックネームを送ったとき（引き継ぎ資料のQ1）。 */
	nicknameAnswer: 1,
	/** アプリの質問IDごと。アプリの `Q1` は引き継ぎ資料のQ2（過ごしたい時間）。 */
	questions: {
		Q1: { narration: [5], answer: 2 },
		Q2: { narration: [6], answer: 3 },
		// 物事への向き合い方（スライダー）は、質問7.wavの後に操作案内8.wavを読む。
		Q3: { narration: [7, 8], answer: 4 },
		Q4: { narration: [9], answer: 5 },
		Q5: { narration: [10], answer: 6 },
	} as Readonly<Record<string, QuestionCue>>,
	/** 全問に答えて `judging` へ入ったとき（色の探索）。 */
	judging: [11],
	/** `result` へ入ったとき（色の発見）。完了SEと一緒に鳴らす。 */
	result: [12],
} as const;

/**
 * 系統ごとの音量と、ナレーションの間の取り方。
 * ガラス音の音量（0.63）は確定。それ以外は仮の値で、会場の機器で聞いて決める（引き継ぎ資料8節）。
 * 素材の音量は書き出しの時点で釣り合っている（BGM -34 LUFS、ナレーション -22 LUFS、回答SE -28〜-32 LUFS）ため、
 * 仮の値は1から始める。
 */
export const SOUND_MIX = {
	bgm: 1,
	glass: 0.63,
	narration: 1,
	effects: 1,
	/** ナレーションを読んでいる間、BGMとガラス音をこの倍率へ下げる（仮）。 */
	duck: { bgm: 0.6, glass: 0.8, attackMs: 400, releaseMs: 1_200 },
	/** 続けて読むナレーションの間（仮）。Q4の7.wavと8.wavの間もこの値。 */
	narrationGapMs: 400,
	/** 次の場面へ移って前のナレーションを止めるときのフェードアウト（仮）。 */
	narrationFadeOutMs: 400,
	/** `result` へ入ってから12.wavを読み始めるまで（仮）。完了SEは `result` へ入ると同時に鳴らす。 */
	resultNarrationDelayMs: 1_500,
	/**
	 * 質問から次の質問へ移ってから、ナレーションを読み始めるまで。iPadが次の質問を降ろし始める時刻
	 * （`QUESTION_ENTER_DELAY_MS`）に合わせる。値が一致することは tests/unit/sound.test.ts が確かめる。
	 */
	questionSwitchNarrationDelayMs: 1_660,
} as const;

/** ガラス音の常時ランダム再生（確定。引き継ぎ資料5節）。 */
export const GLASS_SETTINGS = {
	/** 鳴り始めから次の鳴り始めまで。この範囲から一様に選ぶ。 */
	intervalMs: [5_000, 7_000],
	/** 発音ごとに選ぶ音の位置（Web AudioのHRTF。距離による自動減衰は使わない）。 */
	position: { x: [-3.5, 3.5], y: [-1, 1], z: [-6, -1] },
	/** ガラス音の系統の後ろに置くコンプレッサー。 */
	compressor: { threshold: -10, knee: 12, ratio: 6 },
} as const;

/** 導入音源の実尺（Opusの総サンプル数から算出）。音源を差し替えたら更新する。
 * サーバーの進行を変えず、画面と音声が同じ導入の時刻を参照する。
 */
export const INTRO_AUDIO = {
	narration01Ms: 6174.541666666667,
	narration02Ms: 9598.979166666666,
	narration03Ms: 9125.958333333334,
} as const;
export const INTRO_INVITATION_AT_MS = INTRO_AUDIO.narration01Ms + SOUND_MIX.narrationGapMs + INTRO_AUDIO.narration02Ms;
export const INTRO_NICKNAME_AT_MS = INTRO_INVITATION_AT_MS + INTRO_AUDIO.narration03Ms;
