import { COLOR_IDS, SLIDER_STOP_IDS } from './types.ts';
import type { ColorId, Question, QuestionId, ResultColor, SliderStopId } from './types.ts';

/** 同点時に優先する後半の問数（仕様書6.3節）。 */
const LATE_QUESTION_COUNT = 3;

function emptyScores(): Record<ColorId, number> {
  return { red: 0, orange: 0, yellow: 0, green: 0, cyan: 0, blue: 0, violet: 0, magenta: 0 };
}

/**
 * 回答から結果色を決める（仕様書6.3節）。
 * 合計点、後半3問の得点、色定義の固定優先順位の順に比較する。
 * 全問の回答がそろっていない場合は例外を投げる。
 */
export function judge(
  questions: readonly Question[],
  colors: readonly ResultColor[],
  answers: Readonly<Record<QuestionId, SliderStopId>>,
): ColorId {
  const total = emptyScores();
  const late = emptyScores();
  questions.forEach((question, index) => {
    const stopId = answers[question.id];
    const stop = question.stops.find((candidate) => candidate.id === stopId);
    if (!stop) throw new Error(`回答がありません: ${question.id}`);
    const isLate = index >= questions.length - LATE_QUESTION_COUNT;
    for (const [colorId, points] of Object.entries(stop.scores) as [ColorId, number][]) {
      total[colorId] += points;
      if (isLate) late[colorId] += points;
    }
  });

  const priority = new Map(colors.map((color) => [color.id, color.tieBreakPriority]));
  const ranked = [...COLOR_IDS].sort(
    (a, b) =>
      total[b] - total[a] ||
      late[b] - late[a] ||
      (priority.get(a) ?? Number.POSITIVE_INFINITY) - (priority.get(b) ?? Number.POSITIVE_INFINITY),
  );
  return ranked[0];
}

/** 全回答パターン（5の問数乗）の結果色の件数を数える（仕様書6.3節の公開前集計）。 */
export function resultDistribution(
  questions: readonly Question[],
  colors: readonly ResultColor[],
): Record<ColorId, number> {
  const counts = emptyScores();
  const answers: Record<QuestionId, SliderStopId> = {};
  const visit = (index: number) => {
    if (index === questions.length) {
      counts[judge(questions, colors, answers)] += 1;
      return;
    }
    for (const stopId of SLIDER_STOP_IDS) {
      answers[questions[index].id] = stopId;
      visit(index + 1);
    }
  };
  visit(0);
  return counts;
}
