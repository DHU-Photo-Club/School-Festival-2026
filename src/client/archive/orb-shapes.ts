import fan from "../../../public/archive/figma/orbs/dea6a.svg?raw";
import spiral from "../../../public/archive/figma/orbs/e0f29.svg?raw";
import bloom from "../../../public/archive/figma/orbs/f2480.svg?raw";
import original from "../../../public/archive/figma/orbs/fd824.svg?raw";
import burst from "../../../public/archive/figma/orbs/ff2ca.svg?raw";

/** アーカイブサイトのオーブの形（Figmaから書き出したSVG）。`production` ブランチの `entries.ts` と同じ5種類。 */
export const ORB_SHAPES = [original, spiral, fan, bloom, burst] as const;

/**
 * 形のSVGの破片を、一枚おきに二色で塗り直したデータURL。形と中心の光は書き出したまま残す。
 * `production` ブランチの `entries.ts` の `coloredOrb` と同じ処理。
 */
export function coloredOrb(template: string, first: string, second: string): string {
	let shardIndex = 0;
	const svg = template
		.replace('style="display: block;"', 'style="display: block; isolation: isolate;"')
		.replace(/<path\b[^>]*>/g, (path) => {
			const color = shardIndex++ % 2 === 0 ? first : second;
			return path
				.replace(/fill="#[0-9a-fA-F]{6}"/, `fill="${color}"`)
				.replace(/opacity="[^"]*"/, 'opacity="0.95"')
				.replace("<path ", '<path style="mix-blend-mode: hard-light" ');
		});
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** キー（結果ID）から形を一つ選ぶ。同じキーには常に同じ形を返す。 */
export function orbShapeFor(key: string): string {
	let hash = 2166136261;
	for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return ORB_SHAPES[(hash >>> 0) % ORB_SHAPES.length];
}
