// 演出の調整用に、一つの演出だけを繰り返し再生するための台本（開発サーバー専用。展示の本番では使わない）。
// サーバーを介さずに、展示状態（`ExhibitState`）の列を時刻つきで作る。展示ディスプレイは `toDisplayState` で
// 配信と同じ範囲に絞って受け取り、診断用iPadはそのまま受け取る。
// どちらも本番と同じ `onState` を通るので、調整した見た目がそのまま本番になる。

import { INTRO_NICKNAME_AT_MS } from "../data/sound.ts";
import { FINALE_SETTLE_MS } from "./finale.ts";
import { JUDGING_MS, RESULT_MS } from "./machine.ts";
import { ANSWER_PULSE_IN_MS } from "./motion.ts";
import { RIPPLE_MS } from "./ripple.ts";
import type { ExhibitState, PaletteId, SessionResult } from "./types.ts";
import { PALETTE_IDS } from "./types.ts";

/** 単体で繰り返せる演出。 */
export const LAB_LOOPS = ["idle", "opening", "answer", "judging", "result", "door"] as const;
export type LabLoop = (typeof LAB_LOOPS)[number];

/** 各演出が何を繰り返すか（HUDと使い方の案内に出す）。 */
export const LAB_LOOP_NOTES: Readonly<Record<LabLoop, string>> = {
	idle: "質問中の輪から待機の小さな輪へ縮む",
	opening: "待機 → シーケンス → intro（ようこそ、説明、色を見つける案内）→ 質問中の灰色の輪",
	answer: "回答の縮みと波紋",
	judging: "最終問の回答 → 暗転と塵 → 色づき → 結果",
	result: "色づき → 破片の散らばり → 色名 → 待機へ戻る",
	door: "色名が出た結果 → 扉を開く → 中央の扉 → 待機へ戻る",
};

export interface LabOptions {
	loop: LabLoop;
	/** 結果で見せる色。`all` は一周ごとに全色を順に見せる。 */
	color: PaletteId | "all";
}

/** `?loop=result&color=jade` を読む。演出名が不正なら `null`（通常の画面として動く）。 */
export function parseLab(search: string): LabOptions | null {
	const params = new URLSearchParams(search);
	const loop = params.get("loop");
	if (!LAB_LOOPS.includes(loop as LabLoop)) return null;
	const color = params.get("color");
	return {
		loop: loop as LabLoop,
		color: PALETTE_IDS.includes(color as PaletteId) ? (color as PaletteId) : "all",
	};
}

/** 台本の一場面。`atMs` は一周の開始からの時刻。 */
export interface LabStep {
	atMs: number;
	state: ExhibitState;
}

export interface LabCycle {
	/** 一周の長さ（ミリ秒）。 */
	lengthMs: number;
	/** この周で結果として見せる色。結果を使わない演出では `null`。 */
	colorId: PaletteId | null;
	steps: LabStep[];
}

/** `intro` の直前に再生するシーケンス。 */
export interface LabLead {
	id: string;
	durationMs: number;
}

export interface LabContext {
	/** 何周目か（0から）。 */
	index: number;
	/** 一周の開始時刻（補正済みサーバー時刻に相当する時刻）。 */
	startedAt: number;
	lead: LabLead | null;
	/** 質問の数。`judging` と `result` の前の質問は最終問にする。 */
	questionCount: number;
}

/** 結果を見せている時間。集合した破片の放射バーストと色名が現れ終えたあと、しばらく眺められる長さ。 */
const RESULT_HOLD_MS = 7_000;
/** 結果開始から、放射バーストが終わり、色名が現れ終えるまでの長さ。 */
const RESULT_SETTLED_MS = FINALE_SETTLE_MS;
/** `door` で、色名が出た結果を見せてから「扉を開く」を押すまでの長さ。 */
const DOOR_AT_MS = 2_500;
/** 扉を見せている長さ。扉の中の光の揺れを確かめられる長さ。 */
const DOOR_HOLD_MS = 12_000;
/** `idle` の質問中の輪が縮み終えて、しばらく見せる長さ。 */
const IDLE_HOLD_MS = 4_000;
/** 質問中の輪を見せる長さ。 */
const QUESTION_HOLD_MS = 4_000;

/** 一周の台本を作る。同じ入力には同じ台本を返す。 */
export function labCycle(options: LabOptions, context: LabContext): LabCycle {
	const { index, startedAt } = context;
	const lastQuestion = Math.max(0, context.questionCount - 1);
	const colorId = options.color === "all" ? PALETTE_IDS[index % PALETTE_IDS.length] : options.color;
	const sessionId = `lab-${index}`;
	let revision = index * 100;

	const state = (at: number, over: Partial<ExhibitState>): LabStep => ({
		atMs: at,
		state: {
			sessionId,
			phase: "idle",
			nickname: null,
			sequenceId: null,
			questionIndex: null,
			answers: {},
			judgeFailed: false,
			previewColorId: null,
			phaseStartedAt: startedAt + at,
			phaseEndsAt: null,
			answeredAt: null,
			doorOpenedAt: null,
			revision: ++revision,
			accepting: true,
			result: null,
			...over,
		},
	});
	const at = (ms: number) => startedAt + ms;
	// 二色目は、パレットで約半周離れた色にする。色づいた破片と色名のグラデーションで、二色の見え方を確かめられる。
	// 一画面目（`displayOrder` が0）は一色目を見せる。
	const partner =
		PALETTE_IDS[(PALETTE_IDS.indexOf(colorId) + Math.floor(PALETTE_IDS.length / 2)) % PALETTE_IDS.length];
	const result: SessionResult = {
		id: sessionId,
		name: "lab",
		reading: "演出の調整用の結果です。",
		colors: [colorId, partner],
		photoIds: [],
	};
	const last = { phase: "question", questionIndex: lastQuestion } as const;

	switch (options.loop) {
		case "idle": {
			// 縮む3.0秒のあと、小さな輪をしばらく見せる。
			return {
				lengthMs: 2_000 + 3_000 + IDLE_HOLD_MS,
				colorId: null,
				steps: [state(0, { phase: "question", questionIndex: 0 }), state(2_000, { phase: "idle" })],
			};
		}
		case "opening": {
			const leadMs = context.lead?.durationMs ?? 0;
			// `intro` は、ナレーション03を読み終えて少し見せるまで。
			const introAt = IDLE_HOLD_MS + leadMs;
			const introMs = INTRO_NICKNAME_AT_MS + 3_000 - leadMs;
			const questionAt = introAt + Math.max(1_000, introMs);
			const steps: LabStep[] = [state(0, { phase: "idle" })];
			if (context.lead) {
				steps.push(
					state(IDLE_HOLD_MS, {
						phase: "sequence",
						sequenceId: context.lead.id,
						phaseEndsAt: at(IDLE_HOLD_MS + leadMs),
					}),
				);
			}
			steps.push(state(introAt, { phase: "intro" }), state(questionAt, { phase: "question", questionIndex: 0 }));
			return { lengthMs: questionAt + QUESTION_HOLD_MS, colorId: null, steps };
		}
		case "answer": {
			// サーバーと同じく、回答を受け付けると段階の開始時刻はそのままで、回答の時刻と次の質問の番号だけが変わる。
			const answeredAt = 1_000;
			return {
				lengthMs: answeredAt + ANSWER_PULSE_IN_MS + RIPPLE_MS + 700,
				colorId: null,
				steps: [
					state(0, { phase: "question", questionIndex: 0 }),
					state(answeredAt, {
						phase: "question",
						phaseStartedAt: at(0),
						questionIndex: Math.min(1, lastQuestion),
						answeredAt: at(answeredAt),
					}),
				],
			};
		}
		case "judging": {
			const judgingAt = 1_500;
			const resultAt = judgingAt + JUDGING_MS;
			const judging = { phase: "judging", answeredAt: at(judgingAt), phaseEndsAt: at(resultAt) } as const;
			return {
				lengthMs: resultAt + 4_000,
				colorId,
				steps: [
					state(0, last),
					state(judgingAt, judging),
					// 結果は判定の途中で届く。届く前の塵と、届いたあとの色づきを見分けられるよう、半ばにする。
					state(judgingAt + 5_000, { ...judging, result }),
					state(resultAt, { phase: "result", phaseEndsAt: at(resultAt + RESULT_MS), result }),
				],
			};
		}
		case "result": {
			const judgingAt = 1_000;
			// 暗転（1.2秒）が済んでから色づく（0.8秒）長さ。
			const resultAt = judgingAt + 2_400;
			const idleAt = resultAt + RESULT_HOLD_MS;
			return {
				lengthMs: idleAt + 4_000,
				colorId,
				steps: [
					state(0, last),
					state(judgingAt, {
						phase: "judging",
						answeredAt: at(judgingAt),
						phaseEndsAt: at(resultAt),
						result,
					}),
					state(resultAt, { phase: "result", phaseEndsAt: at(resultAt + RESULT_MS), result }),
					state(idleAt, { phase: "idle" }),
				],
			};
		}
		case "door": {
			// 結果の前半（判定と破片の散らばり）は `result` で見るので、色名が出終えた結果から始める。
			// 結果の開始時刻を一周の開始より前にし、結果の途中から接続した画面と同じく、完了した結果を描かせる。
			const doorAt = DOOR_AT_MS;
			const idleAt = doorAt + DOOR_HOLD_MS;
			const resultStartedAt = at(-RESULT_SETTLED_MS);
			const shown = {
				phase: "result",
				phaseStartedAt: resultStartedAt,
				phaseEndsAt: resultStartedAt + RESULT_MS,
				result,
			} as const;
			return {
				lengthMs: idleAt + 4_000,
				colorId,
				steps: [
					state(0, shown),
					state(doorAt, { ...shown, doorOpenedAt: at(doorAt) }),
					state(idleAt, { phase: "idle" }),
				],
			};
		}
	}
}

export interface LabPlayerHandlers {
	/** 新しい周を始める直前に呼ぶ。前の周の表示を持ち越さないために使う。 */
	onCycle?: () => void;
	/** 台本の時刻になった場面の状態。サーバーから受信した状態と同じように扱う。 */
	onState: (state: ExhibitState) => void;
}

/**
 * 台本を時刻どおりに繰り返し再生する。周の区切りは端末の時計の0時（`now` が0）から一周の長さごとに置き、
 * 再生を始めた時刻には依らない。画面分割の二つのタブや、展示ディスプレイと診断用iPadのように、別々に開いた
 * 画面でも同じ時刻に同じ周の同じ場面を流し込むので、ループの動きが揃う。周の途中から始めたときは、
 * その時刻までの場面をまとめて流し込み、本番で途中から接続した画面と同じように描かせる。
 * 一周の長さは周によらず一定（`labCycle` は周の番号で長さを変えない）。
 */
export class LabPlayer {
	private readonly lengthMs: number;
	private index: number | null = null;
	private plan: LabCycle | null = null;
	private step = -1;
	/** この画面で再生した周の数（HUD用）。 */
	private played = 0;

	constructor(
		private readonly options: LabOptions,
		private readonly context: Omit<LabContext, "index" | "startedAt">,
		private readonly handlers: LabPlayerHandlers,
	) {
		this.lengthMs = labCycle(options, { ...context, index: 0, startedAt: 0 }).lengthMs;
	}

	/** `now`（補正済みサーバー時刻に相当する時刻）までの場面を流し込み、HUDの文を返す。 */
	advance(now: number): string {
		const index = Math.floor(now / this.lengthMs);
		if (!this.plan || index !== this.index) {
			this.index = index;
			this.plan = labCycle(this.options, { ...this.context, index, startedAt: index * this.lengthMs });
			this.step = -1;
			this.played++;
			this.handlers.onCycle?.();
		}
		const plan = this.plan;
		const elapsed = now - index * this.lengthMs;
		while (this.step + 1 < plan.steps.length && plan.steps[this.step + 1].atMs <= elapsed) {
			this.step++;
			this.handlers.onState(plan.steps[this.step].state);
		}
		const color = plan.colorId ? ` / ${plan.colorId}` : "";
		return `${this.options.loop}${color}  ${(elapsed / 1000).toFixed(1)} / ${(plan.lengthMs / 1000).toFixed(1)}s  #${this.played}`;
	}
}
