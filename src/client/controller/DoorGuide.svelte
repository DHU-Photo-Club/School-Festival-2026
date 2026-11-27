<script lang="ts">
/**
 * 「扉を開く」の後のiPadの画面（docs/visual-language.md 4.2節）。黒の全面に、結果の二色でぼかした破片、
 * 「あなた色の写真展が完成しました」「扉へお進み下さい」、床に立つ扉と、扉へ向かう矢印を置く。現れるときに扉の枠を中央から左右へ開き、
 * 開き始めて少し待ってから、開くのと重ねて扉の中の道（尖塔の形）を下から上へ伸ばす。その後は動かさない。
 */
import { onDestroy, onMount } from "svelte";
import { shardPoses } from "../../shared/shards.ts";
import { drawShards, hexToRgb } from "../common/shards.ts";

/**
 * `colors` は結果の二色（`#RRGGBB`）で、破片と扉の中の光を塗る。`reducedMotion` が `true` のときは
 * 扉の枠を開かず道も伸ばさず、初めから開き終えた形で描く。
 */
let { colors, reducedMotion = false }: { colors: readonly [string, string]; reducedMotion?: boolean } = $props();

let canvas = $state<HTMLCanvasElement>();
const gradientId = `door-guide-${Math.random().toString(36).slice(2)}`;

/** 破片の配置を決める時刻。展示ディスプレイの破片と同じ並べ方で、止めた一瞬を描く。 */
const SHARD_TIME = 42_000;

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
		<!-- 枠と黒の内側。現れるときに中央の幅0から左右へ開き、中の道は開いた幅の分だけ見せる。 -->
		<div class="frame" class:opening={!reducedMotion}>
			<svg class="spire" viewBox="0 0 100 200" preserveAspectRatio="none" aria-hidden="true">
				<defs>
					<linearGradient id={`${gradientId}-body`} x1="0.2" y1="0" x2="0.8" y2="1">
						<stop offset="0" stop-color={colors[0]} />
						<stop offset="0.45" stop-color={colors[1]} />
						<stop offset="0.75" stop-color={colors[0]} />
						<stop offset="1" stop-color={colors[1]} />
					</linearGradient>
					<radialGradient id={`${gradientId}-glow`} cx="0.62" cy="0.74" r="0.3">
						<stop offset="0" stop-color={colors[0]} stop-opacity="0.95" />
						<stop offset="1" stop-color={colors[0]} stop-opacity="0" />
					</radialGradient>
				</defs>
				<!-- 扉の奥へ続く道。底の広い、側面のくぼんだ尖塔の形。 -->
				<path d="M6 200 C30 190 46 120 50 20 C54 120 70 190 94 200 Z" fill={`url(#${gradientId}-body)`} />
				<path d="M6 200 C30 190 46 120 50 20 C54 120 70 190 94 200 Z" fill={`url(#${gradientId}-glow)`} />
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
	/* 枠が開く時間、枠が開き始めてから道が伸び始めるまでの待ち時間、道が伸びる時間。 */
	--frame-open: 1.6s;
	--road-wait: 0.6s;
	--road-grow: 1.6s;
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
/* 枠を中央から左右へ開く。展示ディスプレイの扉が下から現れる時間（DOOR_RISE_MS）と揃え、easeInOutSineで動かす。 */
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
/* 尖塔は開いた後の内側の幅で中央に固定し、開く途中は枠の外にはみ出た分を隠す。 */
.spire {
	position: absolute;
	left: 50%;
	top: 0;
	width: calc(var(--door-height) / 2 - var(--frame-border) * 2);
	height: 100%;
	transform: translateX(-50%);
}
/* 枠が開き始めて `--road-wait` だけ待ってから、道を下端から上へ見せていく。形の大きさは変えず、見せる範囲だけを広げる。 */
.frame.opening .spire {
	animation: road-grow var(--road-grow) cubic-bezier(0.37, 0, 0.63, 1) var(--road-wait) both;
}
@keyframes road-grow {
	from {
		clip-path: inset(100% 0 0 0);
	}
	to {
		clip-path: inset(0 0 0 0);
	}
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
.arrow-head {
	fill: #e6e6e6;
	fill-opacity: 0.8;
}
.arrow-path {
	fill: #b3b3b3;
}
</style>
