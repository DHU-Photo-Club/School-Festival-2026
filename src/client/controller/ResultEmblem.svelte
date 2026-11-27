<script lang="ts">
/**
 * iPadの結果の最初の画面に置く、結果の二色で色づけた破片の束（docs/visual-language.md 4.2節）。中心から放射状に
 * 細い三角形を並べ、中心に白い光を重ねる。動かさない。
 */
let { colors }: { colors: readonly [string, string] } = $props();

/**
 * 一枚の破片。外側の二つの頂点（向き `at` で距離 `far`、向き `at + width` で距離 `reach`）と、中心の近くの頂点
 * （向き `at - tip`、距離 `near`）を結ぶ。角度は度。
 */
interface Blade {
	at: number;
	near: number;
	width: number;
	tip: number;
	far: number;
	reach: number;
	opacity: number;
}

/** 破片の並び。偶数番目を一色目、奇数番目を二色目で塗る。風車のように、中心の近くの頂点を反時計回りへずらす。 */
const BLADES: readonly Blade[] = [
	{ at: -96, near: 4, width: 26, tip: 14, far: 78, reach: 64, opacity: 0.88 },
	{ at: -66, near: 6, width: 22, tip: 18, far: 62, reach: 82, opacity: 0.78 },
	{ at: -34, near: 3, width: 30, tip: 10, far: 84, reach: 68, opacity: 0.85 },
	{ at: -2, near: 5, width: 22, tip: 16, far: 66, reach: 78, opacity: 0.75 },
	{ at: 28, near: 4, width: 28, tip: 14, far: 80, reach: 60, opacity: 0.88 },
	{ at: 60, near: 6, width: 22, tip: 18, far: 60, reach: 84, opacity: 0.78 },
	{ at: 92, near: 3, width: 30, tip: 10, far: 86, reach: 70, opacity: 0.85 },
	{ at: 124, near: 5, width: 24, tip: 16, far: 64, reach: 78, opacity: 0.75 },
	{ at: 154, near: 4, width: 28, tip: 14, far: 82, reach: 62, opacity: 0.88 },
	{ at: 186, near: 6, width: 22, tip: 18, far: 60, reach: 82, opacity: 0.78 },
	{ at: 216, near: 3, width: 30, tip: 10, far: 84, reach: 66, opacity: 0.85 },
	{ at: 246, near: 5, width: 24, tip: 16, far: 66, reach: 76, opacity: 0.75 },
];

const point = (degrees: number, distance: number) => {
	const radians = (degrees * Math.PI) / 180;
	return `${(Math.cos(radians) * distance).toFixed(2)},${(Math.sin(radians) * distance).toFixed(2)}`;
};

const blades = BLADES.map((blade) => ({
	points: [
		point(blade.at - blade.tip, blade.near),
		point(blade.at, blade.far),
		point(blade.at + blade.width, blade.reach),
	].join(" "),
	opacity: blade.opacity,
}));
</script>

<svg class="emblem" viewBox="-100 -100 200 200" aria-hidden="true">
	<defs>
		<radialGradient id="emblem-glow">
			<stop offset="0" stop-color="#ffffff" stop-opacity="1" />
			<stop offset="0.25" stop-color="#ffffff" stop-opacity="0.8" />
			<stop offset="1" stop-color="#ffffff" stop-opacity="0" />
		</radialGradient>
	</defs>
	{#each blades as blade, index (index)}
		<polygon points={blade.points} fill={colors[index % 2]} fill-opacity={blade.opacity} />
	{/each}
	<circle r="44" fill="url(#emblem-glow)" />
</svg>

<style>
.emblem {
	display: block;
	width: min(34vmin, 260px);
	height: min(34vmin, 260px);
	overflow: visible;
}
</style>
