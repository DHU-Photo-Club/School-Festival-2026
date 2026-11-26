import type { LightSettings } from "../shared/lights.ts";

/**
 * スマート電球（Matter）の設定（仕様書11章）。電球は会場のPCで動かす中継スクリプト（`scripts/light-bridge.ts`）が操作する。
 * 仮の値。色の実機確認（仕様書12.3節）で見直す。
 */
export const LIGHT_SETTINGS: LightSettings = {
	/** 通常時の白色の色度座標（約4000K。黒体軌跡上の値）。 */
	whiteXy: { x: 0.3805, y: 0.3768 },
	/** xy 色空間に対応しない電球の白色（4000K = 1,000,000 / 4000 ミレッド）。 */
	whiteMireds: 250,
	/** 明るさ（Matter の LevelControl、1〜254）。白色と、`colors` で上書きしない色に使う。 */
	level: 254,
	/** 白色から結果の色へ移る秒数。 */
	toColorSeconds: 3,
	/** 結果の色から白色へ戻る秒数。 */
	toWhiteSeconds: 2,
	/**
	 * 色ごとの照明シーン。会場で電球を見ながら調整した値を書く。書かない色は、パレットの色（sRGB）から
	 * 計算した色度座標と `level` を使う。色相と彩度でしか色を変えられない電球には `xy` を使わない。
	 * 例: `sky: { xy: { x: 0.2, y: 0.25 }, level: 200 }`
	 */
	colors: {},
};
