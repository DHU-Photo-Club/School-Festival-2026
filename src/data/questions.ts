import type { Question } from "../shared/types.ts";

/** 質問定義の版（refs/handoff config/questions.json）。AIへの入力と結果の記録に使う。 */
export const QUESTION_VERSION = "questions-v0.3";

/**
 * 5問の質問定義（refs/handoff 実装仕様書3章、config/questions.json）。質問IDと選択肢IDは handoff と同じ。
 *
 * - Q1、Q3、Q5 は合意済み。Q2 と Q4 は現行案で、最終確定ではない。
 * - Q4 の案内文、Q3 と Q4 の補助文（`caption`）は handoff にないため、仮に書いた値。
 */
export const QUESTIONS: readonly Question[] = [
	{
		id: "Q1",
		kind: "multiple",
		prompt: "今、こんな時間を過ごせるなら、どれにひかれますか？",
		guide: "直感で、最大2つ選んでください。",
		minSelections: 1,
		maxSelections: 2,
		options: [
			{ id: "q1_1", label: "見たことのない景色に出会う" },
			{ id: "q1_2", label: "好きな音楽や物語にひたる" },
			{ id: "q1_3", label: "気になることを、じっくり探る" },
			{ id: "q1_4", label: "誰かと気兼ねなく話す" },
			{ id: "q1_5", label: "自分の手で何かをつくる" },
			{ id: "q1_6", label: "何も決めず、のんびり過ごす" },
			{ id: "q1_7", label: "今は、どれとも決められない", exclusive: true },
		],
	},
	{
		id: "Q2",
		kind: "multiple",
		prompt: "あなたが幸せを感じるのは、どんな瞬間？",
		guide: "自分に当てはまるものを最大2つ選んでください。",
		minSelections: 1,
		maxSelections: 2,
		options: [
			{ id: "q2_1", label: "新しいことを発見したとき" },
			{ id: "q2_2", label: "大切な人と時間を共有するとき" },
			{ id: "q2_3", label: "自分の好きなことに没頭しているとき" },
			{ id: "q2_4", label: "努力が実を結んだとき" },
			{ id: "q2_5", label: "何も気にせず穏やかに過ごせるとき" },
		],
	},
	{
		id: "Q3",
		kind: "slider",
		prompt: "何か気になることがあったとき、あなたはどちらに近いですか？",
		guide: "しっくりくる位置に動かしてください。真ん中でも大丈夫です。",
		leftLabel: "まず、じっくり知りたい",
		rightLabel: "まず、試してみたい",
		stops: [
			{ id: "far-left", caption: "まず、じっくり知りたい" },
			{ id: "left", caption: "どちらかといえば、じっくり知りたい" },
			{ id: "center", caption: "どちらとも言えない" },
			{ id: "right", caption: "どちらかといえば、試してみたい" },
			{ id: "far-right", caption: "まず、試してみたい" },
		],
		interpretation: [
			{ upTo: 39, label: "理解から入る傾向" },
			{ upTo: 60, label: "理解と体験の中間" },
			{ upTo: 100, label: "体験から入る傾向" },
		],
	},
	{
		id: "Q4",
		kind: "map",
		prompt: "今のあなたの心は、どんな状態？",
		guide: "今の気分に近い位置を選んでください。真ん中でも大丈夫です。",
		leftLabel: "内向き",
		rightLabel: "外向き",
		topLabel: "エネルギーが高い",
		bottomLabel: "エネルギーが低い",
		axisIds: { horizontal: "direction", vertical: "energy" },
		cells: [
			{ id: "top-left", caption: "内向きで、エネルギーが高い" },
			{ id: "top", caption: "エネルギーが高い" },
			{ id: "top-right", caption: "外向きで、エネルギーが高い" },
			{ id: "left", caption: "内向き" },
			{ id: "center", caption: "どちらとも言えない" },
			{ id: "right", caption: "外向き" },
			{ id: "bottom-left", caption: "内向きで、エネルギーが低い" },
			{ id: "bottom", caption: "エネルギーが低い" },
			{ id: "bottom-right", caption: "外向きで、エネルギーが低い" },
		],
	},
	{
		id: "Q5",
		kind: "ranked",
		prompt: "ここを出るとき、どんな気持ちになっていたい？",
		guide: "望む気持ちを、優先度の高い順に2つ選んでください。",
		minSelections: 2,
		maxSelections: 2,
		options: [
			{ id: "q5_1", label: "心が落ち着いている" },
			{ id: "q5_2", label: "わくわくしている" },
			{ id: "q5_3", label: "新しい発見を感じている" },
			{ id: "q5_4", label: "心が温かくなっている" },
			{ id: "q5_5", label: "解放感を感じている" },
		],
	},
];
