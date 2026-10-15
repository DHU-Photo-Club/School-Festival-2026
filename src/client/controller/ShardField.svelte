<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { easeInOutSine } from '../../shared/motion.ts';

  /** iPadの待機画面に置く三角形の破片の輪と床（docs/visual-language.md 4.4節）。 */
  let {
    still = false,
    dim = false,
  }: {
    /** true のとき動かさず、静止した一枚だけを描く。 */
    still?: boolean;
    /** true のとき破片の不透明度を下げる（受付停止）。 */
    dim?: boolean;
  } = $props();

  const SEED = 0x5eed_c0de;
  const RING_COUNT = 130;
  const FLOOR_COUNT = 110;
  /** 輪の半径（画面短辺に対する比）。 */
  const RING_RADIUS = 0.38;
  /** 輪の半径方向の散らばり（輪の半径に対する比、片側）。 */
  const RING_SPREAD = 0.2;
  /** 輪の一周の周期（ミリ秒）。 */
  const ORBIT_MS = 150_000;
  /** 床の破片が画面幅を一度流れる周期（ミリ秒）。 */
  const FLOOR_DRIFT_MS = 210_000;
  /** 床の上端（画面の高さに対する比）。 */
  const FLOOR_TOP = 0.78;
  const FADE_IN_MS = 1_400;
  const DIM_ALPHA = 0.35;

  type Shard = {
    /** 重心からの頂点座標。長さは基準長に対する比。 */
    points: [number, number][];
    /** 基準長に対する破片の大きさ。 */
    size: number;
    gray: number;
    alpha: number;
    /** 自転の初期角（ラジアン）と角速度（ラジアン/ミリ秒）。 */
    spin: number;
    spinSpeed: number;
    /** 揺れの位相（ラジアン）と角速度（ラジアン/ミリ秒）。 */
    sway: number;
    swaySpeed: number;
    /** 輪: 初期角（ラジアン）、半径の比、公転速度の倍率。床: 横位置の比、高さの比、流れる速度の倍率。 */
    a: number;
    b: number;
    speed: number;
  };

  let canvas = $state<HTMLCanvasElement>();
  let frame = 0;
  let startedAt = 0;
  let width = 0;
  let height = 0;

  /** 32ビットの種から [0, 1) の擬似乱数列を作る（mulberry32）。 */
  function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 細長い不規則な三角形の頂点を作る。x軸方向に長く、重心を原点に置く。 */
  function triangle(next: () => number): [number, number][] {
    const squash = 0.25 + 0.4 * next();
    const start = next() * Math.PI * 2;
    const raw: [number, number][] = [0, 1, 2].map((index) => {
      const angle = start + index * ((Math.PI * 2) / 3) + (next() - 0.5) * 1.2;
      const length = 0.45 + 0.55 * next();
      return [Math.cos(angle) * length, Math.sin(angle) * length * squash];
    });
    const cx = (raw[0][0] + raw[1][0] + raw[2][0]) / 3;
    const cy = (raw[0][1] + raw[1][1] + raw[2][1]) / 3;
    return raw.map(([x, y]) => [x - cx, y - cy]);
  }

  function shard(next: () => number, a: number, b: number, size: number): Shard {
    return {
      points: triangle(next),
      size,
      gray: Math.round(150 + 105 * next()),
      alpha: 0.3 + 0.45 * next(),
      spin: next() * Math.PI * 2,
      spinSpeed: ((next() < 0.5 ? -1 : 1) * Math.PI * 2) / (40_000 + 60_000 * next()),
      sway: next() * Math.PI * 2,
      swaySpeed: (Math.PI * 2) / (14_000 + 18_000 * next()),
      a,
      b,
      speed: 0.8 + 0.4 * next(),
    };
  }

  const next = random(SEED);
  const ringShards: Shard[] = Array.from({ length: RING_COUNT }, () => {
    const angle = next() * Math.PI * 2;
    // 三角分布で輪の中心線付近を密にする。
    const offset = (next() + next() - 1) * RING_SPREAD;
    return shard(next, angle, 1 + offset, 0.14 + 0.2 * next());
  });
  const floorShards: Shard[] = Array.from({ length: FLOOR_COUNT }, () => {
    const x = next();
    // 下端ほど密にする。
    const y = FLOOR_TOP + (1.04 - FLOOR_TOP) * Math.sqrt(next());
    return shard(next, x, y, 0.07 + 0.11 * next());
  });

  function drawShard(context: CanvasRenderingContext2D, item: Shard, x: number, y: number, rotation: number, unit: number, alpha: number) {
    const length = item.size * unit;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    context.beginPath();
    item.points.forEach(([px, py], index) => {
      const vx = x + (px * cos - py * sin) * length;
      const vy = y + (px * sin + py * cos) * length;
      if (index === 0) context.moveTo(vx, vy);
      else context.lineTo(vx, vy);
    });
    context.closePath();
    context.fillStyle = `rgba(${item.gray}, ${item.gray}, ${item.gray}, ${(item.alpha * alpha).toFixed(3)})`;
    context.fill();
  }

  function draw(elapsed: number) {
    const context = canvas?.getContext('2d');
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const radius = unit * RING_RADIUS;
    const cx = width / 2;
    const cy = height / 2;
    const fade = still ? 1 : easeInOutSine(elapsed / FADE_IN_MS);
    const alpha = fade * (dim ? DIM_ALPHA : 1);

    // 輪は時計回りに公転し、破片は輪の接線方向を向いたまま自転する。
    for (const item of ringShards) {
      const theta = item.a + ((elapsed * item.speed) / ORBIT_MS) * Math.PI * 2;
      const r = radius * (item.b + 0.04 * Math.sin(item.sway + elapsed * item.swaySpeed));
      const rotation = theta + Math.PI / 2 + item.spin + elapsed * item.spinSpeed * 0.3;
      drawShard(context, item, cx + Math.cos(theta) * r, cy + Math.sin(theta) * r, rotation, radius, alpha);
    }

    // 床は輪の下端と同じ向き（左）へ流れ、画面の端で反対側へ回り込む。
    const margin = unit * 0.2;
    const span = width + margin * 2;
    for (const item of floorShards) {
      const travel = ((elapsed * item.speed) / FLOOR_DRIFT_MS) * span;
      const x = ((((item.a * span - travel) % span) + span) % span) - margin;
      const y = height * item.b + unit * 0.012 * Math.sin(item.sway + elapsed * item.swaySpeed);
      const rotation = item.spin * 0.35 + 0.25 * Math.sin(item.sway * 0.5 + elapsed * item.spinSpeed);
      drawShard(context, item, x, y, rotation, unit, alpha);
    }
  }

  function resize() {
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    if (still) draw(0);
  }

  function tick(timestamp: number) {
    frame = requestAnimationFrame(tick);
    if (!startedAt) startedAt = timestamp;
    draw(timestamp - startedAt);
  }

  onMount(() => {
    resize();
    window.addEventListener('resize', resize);
  });

  $effect(() => {
    // still、dim が変わったときに描き方を切り替える。
    cancelAnimationFrame(frame);
    if (still) {
      void dim;
      draw(0);
    } else {
      frame = requestAnimationFrame(tick);
    }
  });

  onDestroy(() => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
  });
</script>

<canvas class="shards" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .shards {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
