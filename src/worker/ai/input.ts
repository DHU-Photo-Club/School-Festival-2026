import { toPercent } from "../../shared/answer.ts";
import type { Answer, MapPoint, Question, QuestionId } from "../../shared/types.ts";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** 選択肢IDを表示文にする。 */
function labelsOf(question: Question & { options: readonly { id: string; label: string }[] }, ids: readonly string[]) {
	return ids.map((id) => question.options.find((option) => option.id === id)?.label ?? id);
}

/** 一問の回答を、質問の語と軸の意味を含む形にする（refs/handoff examples/color-ai-input.json）。 */
function describeAnswer(question: Question, answer: Answer): Json {
	switch (question.kind) {
		case "single":
			return labelsOf(question, [answer as string])[0];
		case "multiple":
			return labelsOf(question, answer as readonly string[]);
		case "ranked":
			return labelsOf(question, answer as readonly string[]).map((label, index) => ({
				rank: index + 1,
				answer: label,
			}));
		case "slider": {
			const value = toPercent(answer as number);
			const summary = question.interpretation.find((range) => value <= range.upTo)?.label ?? "";
			return { left: question.leftLabel, right: question.rightLabel, value, range: [0, 100], summary };
		}
		case "map": {
			const point = answer as MapPoint;
			return {
				[question.axisIds.horizontal]: {
					left: question.leftLabel,
					right: question.rightLabel,
					value: toPercent(point.x),
				},
				// 画面の上端が高い側。AIへは低い側を0、高い側を100で渡す。
				[question.axisIds.vertical]: {
					left: question.bottomLabel,
					right: question.topLabel,
					value: toPercent(1 - point.y),
				},
				range: [0, 100],
			};
		}
	}
}

/**
 * AIへ渡す回答データ（refs/handoff 実装仕様書8章）。IDだけでなく、質問文と回答文言、軸の方向を含める。
 * ニックネームは含めない。
 */
export function answerInput(
	questionVersion: string,
	questions: readonly Question[],
	answers: Readonly<Record<QuestionId, Answer>>,
): { questionVersion: string; questions: { id: string; question: string; answer: Json }[] } {
	return {
		questionVersion,
		questions: questions.map((question) => ({
			id: question.id,
			question: question.prompt,
			answer: answers[question.id] === undefined ? null : describeAnswer(question, answers[question.id]),
		})),
	};
}

/** AIの返答からJSONの値を読む。コードフェンスや前後の文があっても、最初の `{` から最後の `}` までを読む。 */
export function readJson(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return undefined;
	}
}
