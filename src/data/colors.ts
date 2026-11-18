import type { ResultColor } from "../shared/types.ts";

/**
 * 結果色の定義。
 *
 * 仮データ: 仕様書16章「8色の正式名称、基準色、背景色、文字色、メッセージ」と
 * 「8色の代表画像と作者クレジット」の決定前の値。表示名と基準色は仕様書6.2節の仮値、
 * 背景色、文字色、メッセージ、代表画像は仮に設定した値である。
 */
export const RESULT_COLORS: readonly ResultColor[] = [
	{
		id: "red",
		name: "ルビーレッド",
		baseColor: "#C9364F",
		backgroundColor: "#4A1420",
		foregroundColor: "#F8E4E7",
		message: "近くにあるものの温度を、まっすぐ受け取れる色。",
		tieBreakPriority: 0,
		representativePhotoId: "sdi1218-3",
	},
	{
		id: "orange",
		name: "コーラルオレンジ",
		baseColor: "#F0784B",
		backgroundColor: "#4E2414",
		foregroundColor: "#FCEADF",
		message: "夕方のように、誰かと過ごす時間をあたためる色。",
		tieBreakPriority: 3,
		representativePhotoId: "sdi0743",
	},
	{
		id: "yellow",
		name: "サンイエロー",
		baseColor: "#E5B83B",
		backgroundColor: "#45360F",
		foregroundColor: "#FBF1D6",
		message: "ひらけた場所の光のように、軽やかに広がる色。",
		tieBreakPriority: 1,
		representativePhotoId: "sdi1092-2",
	},
	{
		id: "green",
		name: "エメラルドグリーン",
		baseColor: "#2F9B78",
		backgroundColor: "#10392C",
		foregroundColor: "#DDF2EA",
		message: "水と葉のあいだで、静かに育っていく色。",
		tieBreakPriority: 2,
		representativePhotoId: "sdi0225",
	},
	{
		id: "cyan",
		name: "アクアブルー",
		baseColor: "#39A8B8",
		backgroundColor: "#0F363D",
		foregroundColor: "#DCF1F4",
		message: "風が通りぬけるように、景色を映して澄んでいく色。",
		tieBreakPriority: 4,
		representativePhotoId: "sdi0565-2",
	},
	{
		id: "blue",
		name: "コバルトブルー",
		baseColor: "#315AA9",
		backgroundColor: "#122247",
		foregroundColor: "#E0E7F6",
		message: "夜の奥行きのなかで、ひとつのことに向かう色。",
		tieBreakPriority: 6,
		representativePhotoId: "sdi1195-3",
	},
	{
		id: "violet",
		name: "アメジスト",
		baseColor: "#7653A6",
		backgroundColor: "#2A1B42",
		foregroundColor: "#ECE4F6",
		message: "影と余韻をまとって、いつもと違う景色を見せる色。",
		tieBreakPriority: 7,
		representativePhotoId: "sdi1031-2",
	},
	{
		id: "magenta",
		name: "マゼンタピンク",
		baseColor: "#B94083",
		backgroundColor: "#461434",
		foregroundColor: "#F8E1EE",
		message: "遊びごころで、その場をはなやかに動かす色。",
		tieBreakPriority: 5,
		representativePhotoId: "sdi1070-2",
	},
];
