import type { Palette } from "../shared/types.ts";

/**
 * 風景色パレット `scenery-v2`（refs/handoff config/palette.json、実装仕様書4章）。
 *
 * 写真から抽出した色ではなく、自然や都市風景の写真につながる展示用の候補色。写真収集後に見直す場合は
 * `version` を変えて更新する（AIの出力は `paletteVersion` が一致するものだけを受け付ける）。
 */
export const PALETTE: Palette = {
	version: "scenery-v2",
	colors: [
		{ id: "vermilion", name: "朱色", h: 12, s: 76, l: 53, scene: "紅葉、鳥居、赤い外壁" },
		{ id: "orange", name: "夕映えオレンジ", h: 28, s: 79, l: 57, scene: "夕日、柑橘、街の灯り" },
		{ id: "amber", name: "琥珀色", h: 38, s: 78, l: 54, scene: "夕方の光、黄葉、灯り" },
		{ id: "gold", name: "山吹色", h: 45, s: 83, l: 55, scene: "黄色い花、銀杏、日差し" },
		{ id: "leaf", name: "若葉色", h: 85, s: 55, l: 48, scene: "新緑、日を受けた草木" },
		{ id: "forest", name: "深緑", h: 128, s: 48, l: 39, scene: "森、木陰の葉" },
		{ id: "emerald", name: "エメラルドグリーン", h: 147, s: 58, l: 43, scene: "光を受けた緑、水辺" },
		{ id: "jade", name: "翡翠色", h: 160, s: 44, l: 46, scene: "緑がかった水面、葉の影" },
		{ id: "sky", name: "空色", h: 207, s: 66, l: 61, scene: "晴れた空、遠景" },
		{ id: "blue", name: "瑠璃色", h: 218, s: 65, l: 51, scene: "青空、海、青い建物" },
		{ id: "indigo", name: "藍色", h: 232, s: 52, l: 47, scene: "薄暮、青い影、染められた布" },
		{ id: "wisteria", name: "藤紫", h: 269, s: 37, l: 59, scene: "藤の花、夕暮れの雲" },
		{ id: "rose", name: "薔薇色", h: 347, s: 57, l: 61, scene: "花びら、夕焼けの雲" },
	],
};
