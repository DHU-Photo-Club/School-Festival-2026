import type { SampleResolution } from "./answer.ts";
import { answerCandidates, answerScores, DEFAULT_RESOLUTION, isValidAnswer } from "./answer.ts";
import type { Answer, ColorId, Question, QuestionId, ResultColor, Scores } from "./types.ts";
import { COLOR_IDS } from "./types.ts";

/** 同点時に優先する後半の問数（仕様書6.3節）。 */
const LATE_QUESTION_COUNT = 3;

/** 配点を `COLOR_IDS` の順の点数の配列にする。 */
function scoreVector(list: readonly Scores[]): number[] {
	const vector = COLOR_IDS.map(() => 0);
	for (const scores of list) {
		for (const [colorId, points] of Object.entries(scores) as [ColorId, number][]) {
			vector[COLOR_IDS.indexOf(colorId)] += points;
		}
	}
	return vector;
}

/** `COLOR_IDS` の順の固定優先順位。定義のない色は最後。 */
function priorities(colors: readonly ResultColor[]): number[] {
	const byId = new Map(colors.map((color) => [color.id, color.tieBreakPriority]));
	return COLOR_IDS.map((id) => byId.get(id) ?? Number.POSITIVE_INFINITY);
}

/**
 * 点数を同じとみなす差。スライダーと2Dマップの点数は小数になるため、足す順による浮動小数点の
 * 誤差で同点の判定が変わらないようにする。
 */
const SCORE_EPSILON = 1e-9;
const compare = (a: number, b: number) => (Math.abs(a - b) <= SCORE_EPSILON ? 0 : a - b);

/** 合計点、後半3問の得点、固定優先順位の順に比べて最も高い色。それでも並べば `COLOR_IDS` の先の色。 */
function pick(total: readonly number[], late: readonly number[], priority: readonly number[]): ColorId {
	let best = 0;
	for (let index = 1; index < COLOR_IDS.length; index += 1) {
		const diff =
			compare(total[index], total[best]) || compare(late[index], late[best]) || priority[best] - priority[index];
		if (diff > 0) best = index;
	}
	return COLOR_IDS[best];
}

const isLate = (questions: readonly Question[], index: number) => index >= questions.length - LATE_QUESTION_COUNT;

/**
 * 回答から結果色を決める（仕様書6.3節）。
 * 合計点、後半3問の得点、色定義の固定優先順位の順に比較する。複数選択は選んだ選択肢の配点を合計し、
 * スライダーと2Dマップは近くの回答位置や区画の配点を距離で混ぜる。
 * 全問の回答がそろっていない場合と、回答が質問の形式に合わない場合は例外を投げる。
 */
export function judge(
	questions: readonly Question[],
	colors: readonly ResultColor[],
	answers: Readonly<Record<QuestionId, Answer>>,
): ColorId {
	const total = COLOR_IDS.map(() => 0);
	const late = COLOR_IDS.map(() => 0);
	questions.forEach((question, index) => {
		const answer = answers[question.id];
		if (!isValidAnswer(question, answer)) throw new Error(`回答がありません: ${question.id}`);
		const vector = scoreVector(answerScores(question, answer));
		vector.forEach((points, color) => {
			total[color] += points;
			if (isLate(questions, index)) late[color] += points;
		});
	});
	return pick(total, late, priorities(colors));
}

/**
 * 集計する回答パターンの件数。各質問の回答の候補（スライダーと2Dマップは `resolution` で区切った位置）
 * の数の積。
 */
export function answerPatternCount(
	questions: readonly Question[],
	resolution: SampleResolution = DEFAULT_RESOLUTION,
): number {
	return questions.reduce((count, question) => count * answerCandidates(question, resolution).length, 1);
}

/**
 * 回答パターンごとの結果色の件数を数える（仕様書6.3節の公開前集計）。単選択と複数選択はすべての回答、
 * スライダーと2Dマップは `resolution` で格子状に区切った位置を組み合わせる。
 */
export function resultDistribution(
	questions: readonly Question[],
	colors: readonly ResultColor[],
	resolution: SampleResolution = DEFAULT_RESOLUTION,
): Record<ColorId, number> {
	const counts = Object.fromEntries(COLOR_IDS.map((id) => [id, 0])) as Record<ColorId, number>;
	const priority = priorities(colors);
	// 各質問の回答ごとの点数を先に求め、深さ優先で足し引きしながら全パターンを数える。
	const vectors = questions.map((question) =>
		answerCandidates(question, resolution).map((answer) => scoreVector(answerScores(question, answer))),
	);
	const total = COLOR_IDS.map(() => 0);
	const late = COLOR_IDS.map(() => 0);
	const visit = (index: number) => {
		if (index === questions.length) {
			counts[pick(total, late, priority)] += 1;
			return;
		}
		const lateQuestion = isLate(questions, index);
		for (const vector of vectors[index]) {
			for (let color = 0; color < vector.length; color += 1) {
				total[color] += vector[color];
				if (lateQuestion) late[color] += vector[color];
			}
			visit(index + 1);
			for (let color = 0; color < vector.length; color += 1) {
				total[color] -= vector[color];
				if (lateQuestion) late[color] -= vector[color];
			}
		}
	};
	visit(0);
	return counts;
}
