<script lang="ts">
/**
 * 「扉を開く」の後のiPadの画面（docs/visual-language.md 4.2節）。黒の全面に、結果の二色でぼかした破片、
 * 「あなた色の写真展が完成しました」「扉へお進み下さい」、床に立つ扉と、扉へ向かう矢印を置く。現れるときに扉の枠を中央から左右へ開き、
 * 開き始めて少し待ってから、開くのと重ねて扉の中のカーテン（尖塔の形）の輪郭を中央から左右へ広げる。カーテンのグラデーションは
 * 扉の奥へ向かって流し続ける。それ以外は動かさない。
 */
import { onDestroy, onMount } from "svelte";
import { clamp01 } from "../../shared/motion.ts";
import { shardPoses } from "../../shared/shards.ts";
import { drawShards, hexToRgb } from "../common/shards.ts";

/**
 * `colors` は結果の二色（`#RRGGBB`）で、破片とカーテンの光を塗る。`stops` は一色目から二色目へOKLCHで補間した
 * 色止め（`#RRGGBB`、両端は `colors` と同じ）で、カーテンのグラデーションを塗る。`reducedMotion` が `true` のときは
 * 扉の枠を開かずカーテンも広げず、初めから開き終えた形で描く。
 */
let {
	colors,
	stops,
	reducedMotion = false,
}: { colors: readonly [string, string]; stops: readonly string[]; reducedMotion?: boolean } = $props();

let canvas = $state<HTMLCanvasElement>();
const gradientId = `door-guide-${Math.random().toString(36).slice(2)}`;

/** 破片の配置を決める時刻。展示ディスプレイの破片と同じ並べ方で、止めた一瞬を描く。 */
const SHARD_TIME = 42_000;

/** 枠が開き始めてからカーテンが広がり始めるまでの待ち時間と、カーテンが広がる時間。 */
const CURTAIN_WAIT_MS = 600;
const CURTAIN_OPEN_MS = 2_600;

/**
 * カーテンが広がる緩急。easeInOutExpoの指数を10から8へ下げて柔らかくし、前倒しして、前半（加速）を時間の35%、
 * 後半（減速）を65%に割り当てる。
 */
const CURTAIN_EASE = { split: 0.35, exponent: 8 } as const;
function curtainEase(t: number): number {
	const x = clamp01(t);
	if (x === 0 || x === 1) return x;
	const { split, exponent } = CURTAIN_EASE;
	if (x < split) return 0.5 * 2 ** (exponent * (x / split - 1));
	return 1 - 0.5 * 2 ** ((-exponent * (x - split)) / (1 - split));
}

/**
 * カーテンの輪郭。viewBox（100 x 200）の中の、底の広い、側面のくぼんだ尖塔の形を、横方向だけ中央（x=50）を
 * 軸に `spread` 倍する。`spread` が0のときは中央の縦の線、1のときは広がり終えた形になる。
 */
function curtainPath(spread: number): string {
	const x = (value: number) => Number((50 + (value - 50) * spread).toFixed(3));
	return `M${x(6)} 200 C${x(30)} 190 ${x(46)} 120 50 20 C${x(54)} 120 ${x(70)} 190 ${x(94)} 200 Z`;
}

/** カーテンの広がり具合（0〜1）。 */
let spread = $state(0);
const curtain = $derived(curtainPath(spread));

/** 現れてから `CURTAIN_WAIT_MS` 待ってカーテンを広げる。reduced-motionでは初めから広がり終えた形にする。 */
$effect(() => {
	if (reducedMotion) {
		spread = 1;
		return;
	}
	const startedAt = performance.now();
	let frame = 0;
	const tick = (now: number) => {
		const t = (now - startedAt - CURTAIN_WAIT_MS) / CURTAIN_OPEN_MS;
		spread = curtainEase(t);
		if (t < 1) frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);
	return () => cancelAnimationFrame(frame);
});

/**
 * カーテンのグラデーションの一周期の向きと長さ（尖塔の絵の外接矩形に対する割合）。一周期で一色目から二色目へ移り、
 * 一色目へ戻る。カーテンの左上から右下までに約1.5周期が入る。
 */
const CURTAIN_PERIOD = { x: 0.4, y: 2 / 3 } as const;
/**
 * カーテンのグラデーションが一周期ぶん流れる時間。docs/visual-language.md 1章の「繰り返す動きの周期は12秒以上」
 * という決まりを満たす。
 */
const CURTAIN_FLOW_S = 12;

/**
 * カーテンのグラデーションの一周期分の色止め。前半に `stops` を順に、後半に逆順に等間隔で並べ、折り返しの重複は省く。
 * 周期の両端が同じ色になるので、`spreadMethod="repeat"` で繰り返しても継ぎ目が出ない。
 */
const curtainStops = $derived.by(() => {
	const last = Math.max(1, stops.length - 1);
	const forward = stops.map((color, i) => ({ offset: (0.5 * i) / last, color }));
	const back = [...stops].reverse().map((color, i) => ({ offset: 0.5 + (0.5 * i) / last, color }));
	return [...forward, ...back.slice(1)];
});

/** 破片を描く。画面の大きさが変わったときだけ描き直す。 */
function draw() {
	const context = canvas?.getContext("2d");
	if (!canvas || !context) return;
	const ratio = Math.min(window.devicePixelRatio || 1, 2);
	const { clientWidth: width, clientHeight: height } = canvas;
	canvas.width = Math.max(1, Math.round(width * ratio));
	canvas.height = Math.max(1, Math.round(height * ratio));
	const poses = shardPoses(width, height, SHARD_TIME, { fill: 1, orbit: 0 });
	drawShards(context, poses, ratio, 1, { colors: colors.map(hexToRgb), amount: 1 });
}

$effect(() => {
	void colors;
	draw();
});

onMount(() => window.addEventListener("resize", draw));

onDestroy(() => window.removeEventListener("resize", draw));
</script>

<section class="guide">
	<div class="field" aria-hidden="true"><canvas bind:this={canvas}></canvas></div>
	<div class="message">
		<p>あなた色の写真展が完成しました</p>
		<p>扉へお進み下さい</p>
	</div>
	<div class="portal" aria-hidden="true">
		<!-- 枠と黒の内側。現れるときに中央の幅0から左右へ開き、中のカーテンは開いた幅の分だけ見せる。 -->
		<div class="frame" class:opening={!reducedMotion}>
			<svg class="spire" viewBox="0 0 100 200" preserveAspectRatio="none" aria-hidden="true">
				<defs>
					<!--
						グラデーションの座標は、広がり終えたカーテンの外接矩形（x 6〜94、y 20〜200）に対する割合で書く。
						輪郭が広がる途中も模様は伸び縮みさせず、広がり終えたときと同じ位置に置く。
					-->
					<linearGradient
						id={`${gradientId}-body`}
						gradientUnits="userSpaceOnUse"
						gradientTransform="translate(6 20) scale(88 180)"
						x1="0.2"
						y1="0"
						x2={0.2 + CURTAIN_PERIOD.x}
						y2={CURTAIN_PERIOD.y}
						spreadMethod="repeat"
					>
						{#each curtainStops as stop, i (i)}
							<stop offset={stop.offset} stop-color={stop.color} />
						{/each}
						<!-- 一周期ぶん左上（扉の奥）へずらす動きを、等速で繰り返す。 -->
						{#if !reducedMotion}
							<animateTransform
								attributeName="gradientTransform"
								type="translate"
								additive="sum"
								from="0 0"
								to={`${-CURTAIN_PERIOD.x} ${-CURTAIN_PERIOD.y}`}
								dur={`${CURTAIN_FLOW_S}s`}
								repeatCount="indefinite"
							/>
						{/if}
					</linearGradient>
					<radialGradient
						id={`${gradientId}-glow`}
						gradientUnits="userSpaceOnUse"
						gradientTransform="translate(6 20) scale(88 180)"
						cx="0.62"
						cy="0.74"
						r="0.3"
					>
						<stop offset="0" stop-color={colors[0]} stop-opacity="0.95" />
						<stop offset="1" stop-color={colors[0]} stop-opacity="0" />
					</radialGradient>
				</defs>
				<!-- 扉の中のカーテン。底の広い、側面のくぼんだ尖塔の形。 -->
				<path d={curtain} fill={`url(#${gradientId}-body)`} />
				<path d={curtain} fill={`url(#${gradientId}-glow)`} />
			</svg>
		</div>
		<svg class="arrow" viewBox="0 0 80 50" aria-hidden="true">
			<!-- 床の上を扉へ向かう道（手前ほど広い）と、扉の手前の上向きの矢じり。 -->
			<path class="arrow-path" d="M23.5 20 L56.5 20 L70.5 50 L9.5 50 Z" />
			<path class="arrow-head" d="M40 0 L80 20 L0 20 Z" />
		</svg>
	</div>
</section>

<style>
.guide {
	/* 扉の高さ。幅はこの半分。 */
	--door-height: min(48vh, 96vw);
	/* 床の高さ（画面の下端からの距離）。 */
	--floor: 11vh;
	/* 扉の枠の太さ。 */
	--frame-border: max(2px, 0.3vmin);
	/* 枠が開く時間。 */
	--frame-open: 1.6s;
	position: fixed;
	inset: 0;
	overflow: hidden;
	background: #000000;
	color: #ffffff;
}
/* 破片は床より上だけに置き、ぼかす。 */
.field {
	position: absolute;
	inset: 0 0 var(--floor) 0;
	overflow: hidden;
}
.field canvas {
	display: block;
	width: 100%;
	height: 100%;
	filter: blur(max(10px, 2.2vmin));
	opacity: 0.85;
}
.message {
	position: absolute;
	left: 0;
	right: 0;
	top: 21vh;
	padding: 0 24px;
	text-align: center;
}
.message p {
	margin: 0;
	font-size: clamp(22px, 3.8vmin, 34px);
	font-weight: 600;
	letter-spacing: 0.08em;
	line-height: 1.65;
}
.portal {
	position: absolute;
	left: 50%;
	bottom: var(--floor);
	width: calc(var(--door-height) / 2);
	height: var(--door-height);
	transform: translateX(-50%);
}
.frame {
	position: absolute;
	inset: 0;
	box-sizing: border-box;
	overflow: hidden;
	border: var(--frame-border) solid #6e6e6e;
	border-bottom: none;
	background: #000000;
}
/* 枠を中央から左右へ開く。展示ディスプレイの扉が開く時間（DOOR_OPEN_MS）と揃え、easeInOutSineで動かす。 */
.frame.opening {
	animation: frame-open var(--frame-open) cubic-bezier(0.37, 0, 0.63, 1) both;
}
@keyframes frame-open {
	from {
		left: 50%;
		right: 50%;
	}
	to {
		left: 0;
		right: 0;
	}
}
/* カーテンは開いた後の内側の幅で中央に固定し、開く途中は枠の外にはみ出た分を隠す。 */
.spire {
	position: absolute;
	left: 50%;
	top: 0;
	width: calc(var(--door-height) / 2 - var(--frame-border) * 2);
	height: 100%;
	transform: translateX(-50%);
}
/* 矢印の幅は扉の幅の8割。矢じりの底辺を床から扉の幅の9%上に置き、道は床の下へ扉の幅の21%まで伸ばす。 */
.arrow {
	position: absolute;
	left: 50%;
	bottom: calc(var(--door-height) / 2 * -0.21);
	width: 80%;
	height: auto;
	transform: translateX(-50%);
	overflow: visible;
}
/* 矢じりと道は同じ明るい灰色で、不透明に塗る。 */
.arrow path {
	fill: #e6e6e6;
}
</style>
