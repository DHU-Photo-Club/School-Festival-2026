import type { Question } from "../shared/types.ts";

/**
 * 診断定義。質問文、入力方式（`kind`）、選択肢や端の語と補助文、配点を一つのデータとして管理する。
 *
 * 仮データ: 仕様書16章「各問の本文、入力方式、選択肢や端の語、補助文、配点」の決定前の値。
 * テーマは仕様書6.1節の基本案（季節、時間帯、場所、光、音、手触り、過ごし方）に従う。
 * 入力方式の確認のため、時間帯を単選択、場所を2Dマップ、音を複数選択にしている。
 */
export const QUESTIONS: readonly Question[] = [
	{
		id: "aaa",
		kind: "multiple",
		theme: "音",
		prompt: "今、こんな時間を過ごせるなら、どれに惹かれますか？",
		minSelections: 1,
		maxSelections: 2,
		options: [
			{ id: "birds", label: "見たことのない景色に出会う", scores: { green: 1 } },
			{ id: "waves", label: "好きな音楽や物語に浸る", scores: { cyan: 1 } },
			{ id: "rain", label: "気になることをじっくり探る", scores: { blue: 1 } },
			{ id: "voices", label: "誰かと気兼ねなく話す", scores: { orange: 1 } },
			{ id: "music", label: "自分の手でなにか作る", scores: { magenta: 1 } },
			{ id: "silence", label: "何も決めず、のんびり過ごす", scores: { violet: 1 } },
		],
	},
	{
		id: "moment",
		kind: "multiple",
		theme: "瞬間",
		prompt: "あなたが幸せを感じるのは、どんな瞬間？",
		minSelections: 1,
		maxSelections: 2,
		options: [
			{ id: "birds", label: "新しいことを発見したとき", scores: { green: 1 } },
			{ id: "waves", label: "大切な人と時間を共有するとき", scores: { cyan: 1 } },
			{ id: "rain", label: "自分の好きなことに没頭しているとき", scores: { blue: 1 } },
			{ id: "voices", label: "努力が実を結んだとき", scores: { orange: 1 } },
			{ id: "music", label: "何も気にせず緩やかに過ごせるとき", scores: { magenta: 1 } },
		],
	},
	{
		id: "you",
		kind: "slider",
		theme: "光",
		prompt: "なにか気になることがあったとき、あなたはどちらに近いですか？",
		leftLabel: "まず、じっくり知りたい",
		rightLabel: "まず、試してみたい",
		stops: [
			{ id: "far-left", caption: "やわらかい光", scores: { orange: 2 } },
			{ id: "left", caption: "ややわらかい光", scores: { magenta: 2 } },
			{ id: "center", caption: "どちらでもない光", scores: { yellow: 1, violet: 1 } },
			{ id: "right", caption: "ややくっきりした光", scores: { cyan: 2 } },
			{ id: "far-right", caption: "くっきりした光", scores: { red: 1, blue: 1 } },
		],
	},
	{
		id: "place",
		kind: "map",
		theme: "場所",
		prompt: "今のあなたの心は、どんな状態？",
		leftLabel: "内向的",
		rightLabel: "外向的",
		topLabel: "エネルギーが高い",
		bottomLabel: "エネルギーが低い",
		cells: [
			{ id: "top-left", caption: "ひらけた自然の中", scores: { green: 2 } },
			{ id: "top", caption: "自然の中", scores: { green: 1, orange: 1 } },
			{ id: "top-right", caption: "こもれる自然の中", scores: { green: 1, violet: 1 } },
			{ id: "left", caption: "ひらけた場所", scores: { yellow: 1, cyan: 1 } },
			{ id: "center", caption: "どちらでもない場所", scores: { magenta: 1, blue: 1 } },
			{ id: "right", caption: "こもれる場所", scores: { violet: 2 } },
			{ id: "bottom-left", caption: "ひらけた街の中", scores: { yellow: 1, red: 1 } },
			{ id: "bottom", caption: "街の中", scores: { magenta: 2 } },
			{ id: "bottom-right", caption: "こもれる街の中", scores: { blue: 1, violet: 1 } },
		],
	},
	{
		id: "time",
		kind: "single",
		theme: "時間帯",
		prompt: "今いたい時間帯は？",
		options: [
			{ id: "morning", label: "朝", scores: { yellow: 2 } },
			{ id: "noon", label: "昼", scores: { cyan: 1, green: 1 } },
			{ id: "evening", label: "夕方", scores: { orange: 1, magenta: 1 } },
			{ id: "night", label: "夜", scores: { blue: 2 } },
		],
	},
	{
		id: "out",
		kind: "multiple",
		theme: "瞬間",
		prompt: "ここを出るとき、どんな気持ちになっていたい？",
		minSelections: 1,
		maxSelections: 2,
		options: [
			{ id: "birds", label: "心が落ち着いている", scores: { green: 1 } },
			{ id: "waves", label: "わくわくしている", scores: { cyan: 1 } },
			{ id: "rain", label: "新しい発見を感じている", scores: { blue: 1 } },
			{ id: "voices", label: "心が暖かくなっている", scores: { orange: 1 } },
			{ id: "music", label: "開放感を感じている", scores: { magenta: 1 } },
		],
	},
];
