import qrcode from "qrcode-generator";

/** Quiet Zone の幅（仕様書10.3節）。 */
export const QUIET_ZONE_MODULES = 4;

export interface QrModel {
	/** Quiet Zone を含む一辺のモジュール数。 */
	size: number;
	/** 暗いモジュールを並べたSVGのパス。 */
	path: string;
}

/** 誤り訂正レベルMでQRコードを作り、SVGで描くための形にする。 */
export function createQrModel(text: string): QrModel {
	const code = qrcode(0, "M");
	code.addData(text, "Byte");
	code.make();
	const count = code.getModuleCount();
	const parts: string[] = [];
	for (let row = 0; row < count; row += 1) {
		for (let col = 0; col < count; col += 1) {
			if (code.isDark(row, col)) parts.push(`M${col + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h1v1h-1z`);
		}
	}
	return { size: count + QUIET_ZONE_MODULES * 2, path: parts.join("") };
}
