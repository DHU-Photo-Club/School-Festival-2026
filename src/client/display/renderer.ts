import { BLOOM_WARP } from '../../shared/motion.ts';
import type { Primitive } from '../../shared/motion.ts';

/** `computeScene` の描画内容をcanvasへ描く。座標はcanvasの画素単位。 */
export interface SceneRenderer {
  draw(primitives: readonly Primitive[]): void;
}

/** 一フレームで重ねる描画内容の上限。`computeScene` は最大4つ（背景、暗転、にじみ2つ）を返す。 */
const MAX_LAYERS = 4;
const KIND = { fill: 0, spectrum: 1, bloom: 2 } as const;
const SHAPE = { line: 0, band: 1, frame: 2 } as const;

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// 全レイヤーを一度に合成し、グラデーションの部分だけにディザをかける。ベタ塗りの部分は指定色をそのまま出力する。
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

#define MAX_LAYERS ${MAX_LAYERS}
#define BLOOM_WARP ${BLOOM_WARP.toFixed(4)}

uniform vec2 u_size;
uniform int u_count;
uniform int u_kind[MAX_LAYERS];
uniform vec4 u_color[MAX_LAYERS];
// spectrum: (offset, span, rise, spread)  bloom: (x, y, dx, dy)
uniform vec4 u_geometry[MAX_LAYERS];
// spectrum: (blend, intensity, drift, 0)  bloom: (reach, feather, shape, drift)
uniform vec4 u_params[MAX_LAYERS];
uniform vec3 u_spectrum[8];

out vec4 outColor;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// -1〜1。q は画面短辺を1とする座標、t は秒。
float flow(vec2 q, float t) {
  float n = 0.0;
  n += 0.55 * noise(q * 1.1 + vec2(0.021, -0.013) * t);
  n += 0.30 * noise(q * 2.3 + vec2(-0.017, 0.024) * t + 5.2);
  n += 0.15 * noise(q * 4.7 + vec2(0.029, 0.011) * t + 11.7);
  return n * 2.0 - 1.0;
}

vec4 spectrum(vec2 p, vec2 q, vec4 g, vec4 k) {
  float spread = g.w;
  if (spread <= 0.0 || k.y <= 0.0) return vec4(0.0);
  float t = k.z;
  // 色の位置と明るさの山を、画面短辺ほどの大きな模様のノイズで揺らす。
  float lean = (u_size.y - p.y) / u_size.y - 0.5;
  float s = p.x / u_size.x * g.y - g.x + flow(q * 0.6, t) * 0.7 + lean * 0.35;
  float lift = u_size.y - p.y + flow(q * 0.6 + 17.0, t) * spread * 0.45;

  // colors[i] の区画の中央で i になる位置。隣の区画の中央へ向けて blend の幅で溶け合う。
  s -= 0.5;
  float i0 = floor(s);
  float f = s - i0;
  float w = smoothstep(0.5 - k.x * 0.5, 0.5 + k.x * 0.5, f);
  int a = int(mod(i0, 8.0));
  int b = int(mod(i0 + 1.0, 8.0));
  vec3 rgb = mix(u_spectrum[a], u_spectrum[b], w);

  // 下端から rise の高さを明るさの山とし、上へ早く、下へゆるやかに背景へ溶ける。
  float x = (lift - g.z) / (spread * (lift < g.z ? 1.8 : 0.8));
  float glow = exp(-x * x) * (0.8 + 0.2 * flow(q * 0.9 + 3.1, t));
  return vec4(rgb, clamp(glow * k.y, 0.0, 1.0));
}

vec4 bloom(vec2 p, vec2 q, vec4 color, vec4 g, vec4 k) {
  float reach = k.x;
  float feather = k.y;
  int shape = int(k.z + 0.5);
  float d;
  if (shape == 0) {
    d = dot(p - g.xy, g.zw);
  } else if (shape == 1) {
    d = abs(dot(p - g.xy, g.zw));
  } else {
    // 四辺からの距離の最小値をなめらかに取り、隅から中心へ向かう折れ目を出さない（最小値以下になる）。
    float k = 0.05 * min(u_size.x, u_size.y);
    vec4 edges = vec4(p.x, u_size.x - p.x, p.y, u_size.y - p.y);
    vec4 e = exp(-(edges - min(min(edges.x, edges.y), min(edges.z, edges.w))) / k);
    d = min(min(edges.x, edges.y), min(edges.z, edges.w)) - k * log(e.x + e.y + e.z + e.w);
  }
  d += flow(q * 0.6 + 4.0, k.w) * feather * BLOOM_WARP;
  float coverage = 1.0 - smoothstep(reach - feather, reach + feather, d);
  return vec4(color.rgb, coverage);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  float m = min(u_size.x, u_size.y);
  vec2 q = p / m;
  vec3 rgb = vec3(0.0);
  float soft = 0.0;
  for (int i = 0; i < MAX_LAYERS; i++) {
    if (i >= u_count) break;
    vec4 layer;
    if (u_kind[i] == 0) {
      layer = u_color[i];
    } else if (u_kind[i] == 1) {
      layer = spectrum(p, q, u_geometry[i], u_params[i]);
      soft += layer.a * (1.0 - layer.a);
    } else {
      layer = bloom(p, q, u_color[i], u_geometry[i], u_params[i]);
      soft += layer.a * (1.0 - layer.a);
    }
    rgb = mix(rgb, layer.rgb, layer.a);
  }
  // 暗い色のなだらかな変化で出る段差を、1階調未満のノイズで崩す。
  rgb += (hash(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0) * min(1.0, soft * 24.0);
  outColor = vec4(rgb, 1.0);
}
`;

function parseHex(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1, 7), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failed');
  return shader;
}

type Uniforms = Record<'size' | 'count' | 'kind' | 'color' | 'geometry' | 'params' | 'spectrum', WebGLUniformLocation | null>;

function setup(gl: WebGL2RenderingContext): Uniforms {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
  gl.useProgram(program);

  // 画面全体を覆う三角形一枚。
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const at = (name: string) => gl.getUniformLocation(program, name);
  return {
    size: at('u_size'),
    count: at('u_count'),
    kind: at('u_kind'),
    color: at('u_color'),
    geometry: at('u_geometry'),
    params: at('u_params'),
    spectrum: at('u_spectrum'),
  };
}

function drawGl(gl: WebGL2RenderingContext, uniforms: Uniforms, primitives: readonly Primitive[]): void {
  const layers = primitives.slice(0, MAX_LAYERS);
  const kind = new Int32Array(MAX_LAYERS);
  const color = new Float32Array(MAX_LAYERS * 4);
  const geometry = new Float32Array(MAX_LAYERS * 4);
  const params = new Float32Array(MAX_LAYERS * 4);
  const spectrum = new Float32Array(8 * 3);
  layers.forEach((primitive, index) => {
    const o = index * 4;
    kind[index] = KIND[primitive.type];
    switch (primitive.type) {
      case 'fill':
        color.set([...parseHex(primitive.color), primitive.alpha ?? 1], o);
        break;
      case 'spectrum':
        geometry.set([primitive.offset, primitive.span, primitive.rise, primitive.spread], o);
        params.set([primitive.blend, primitive.intensity, primitive.drift, 0], o);
        primitive.colors.slice(0, 8).forEach((entry, i) => spectrum.set(parseHex(entry), i * 3));
        break;
      case 'bloom':
        color.set([...parseHex(primitive.color), 1], o);
        geometry.set([primitive.x, primitive.y, primitive.dx, primitive.dy], o);
        params.set([primitive.reach, primitive.feather, SHAPE[primitive.shape], primitive.drift], o);
        break;
    }
  });
  const { width, height } = gl.canvas;
  gl.viewport(0, 0, width, height);
  gl.uniform2f(uniforms.size, width, height);
  gl.uniform1i(uniforms.count, layers.length);
  gl.uniform1iv(uniforms.kind, kind);
  gl.uniform4fv(uniforms.color, color);
  gl.uniform4fv(uniforms.geometry, geometry);
  gl.uniform4fv(uniforms.params, params);
  gl.uniform3fv(uniforms.spectrum, spectrum);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/**
 * WebGL2を使えない環境の代替描画。色のにじみはcanvasの線形グラデーションで近似し、ノイズの揺れは描かない。
 */
function draw2d(context: CanvasRenderingContext2D, primitives: readonly Primitive[]): void {
  const { width, height } = context.canvas;
  for (const primitive of primitives) {
    context.save();
    switch (primitive.type) {
      case 'fill':
        context.globalAlpha = primitive.alpha ?? 1;
        context.fillStyle = primitive.color;
        context.fillRect(0, 0, width, height);
        break;
      case 'spectrum':
        drawSpectrum2d(context, primitive);
        break;
      case 'bloom':
        drawBloom2d(context, primitive);
        break;
    }
    context.restore();
  }
}

function drawSpectrum2d(context: CanvasRenderingContext2D, primitive: Extract<Primitive, { type: 'spectrum' }>): void {
  const { width, height } = context.canvas;
  const { offset, span, rise, spread, colors } = primitive;
  if (spread <= 0 || primitive.intensity <= 0 || colors.length === 0) return;
  // 区画 i の中央の横位置。画面の外の区画まで並べて、両端の色が途切れないようにする。
  const centerX = (index: number) => ((index + 0.5 + offset) / span) * width;
  const first = Math.floor(-offset) - 1;
  const last = Math.ceil(span - offset) + 1;
  const hue = context.createLinearGradient(centerX(first), 0, centerX(last), 0);
  for (let index = first; index <= last; index += 1) {
    hue.addColorStop((index - first) / (last - first), colors[((index % colors.length) + colors.length) % colors.length]);
  }
  const top = rise + spread * 1.6;
  const glow = context.createLinearGradient(0, height, 0, height - top);
  glow.addColorStop(0, `rgba(0,0,0,${Math.exp(-((rise / (spread * 1.8)) ** 2))})`);
  glow.addColorStop(Math.min(1, rise / top), 'rgba(0,0,0,1)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  const layer = new OffscreenCanvas(width, height);
  const layerContext = layer.getContext('2d');
  if (!layerContext) return;
  layerContext.fillStyle = hue;
  layerContext.fillRect(0, 0, width, height);
  layerContext.globalCompositeOperation = 'destination-in';
  layerContext.fillStyle = glow;
  layerContext.fillRect(0, 0, width, height);
  context.globalAlpha = primitive.intensity;
  context.drawImage(layer, 0, 0);
}

function drawBloom2d(context: CanvasRenderingContext2D, primitive: Extract<Primitive, { type: 'bloom' }>): void {
  const { width, height } = context.canvas;
  const { x, y, dx, dy, reach, feather, color } = primitive;
  // 同じ色の透明へ向けて補間し、縁が黒ずまないようにする。
  const clear = `${color}00`;
  const near = Math.max(0, reach - feather);
  const far = reach + feather;
  /** 点 `(ox, oy)` から向き `(nx, ny)` へ、距離 near で塗り、far で消えるグラデーション。 */
  const fade = (ox: number, oy: number, nx: number, ny: number) => {
    const gradient = context.createLinearGradient(ox + nx * near, oy + ny * near, ox + nx * far, oy + ny * far);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, clear);
    return gradient;
  };
  if (primitive.shape === 'line') {
    context.fillStyle = fade(x, y, dx, dy);
    context.fillRect(0, 0, width, height);
  } else if (primitive.shape === 'band') {
    // 直線の両側を、それぞれの側の半平面に限って塗る。
    for (const side of [1, -1]) {
      context.save();
      context.beginPath();
      const [tx, ty] = [-dy * width * 4, dx * width * 4];
      context.moveTo(x - tx, y - ty);
      context.lineTo(x + tx, y + ty);
      context.lineTo(x + tx + dx * side * width * 4, y + ty + dy * side * width * 4);
      context.lineTo(x - tx + dx * side * width * 4, y - ty + dy * side * width * 4);
      context.closePath();
      context.clip();
      context.fillStyle = fade(x, y, dx * side, dy * side);
      context.fillRect(0, 0, width, height);
      context.restore();
    }
  } else {
    // 最も近い縁が同じになる四つの台形ごとに、その縁から内側へ塗る。
    const inset = Math.min(width, height) / 2;
    const edges: [number, number, number, number, [number, number][]][] = [
      [0, 0, 0, 1, [[0, 0], [width, 0], [width - inset, inset], [inset, inset]]],
      [0, height, 0, -1, [[0, height], [width, height], [width - inset, height - inset], [inset, height - inset]]],
      [0, 0, 1, 0, [[0, 0], [0, height], [inset, height - inset], [inset, inset]]],
      [width, 0, -1, 0, [[width, 0], [width, height], [width - inset, height - inset], [width - inset, inset]]],
    ];
    for (const [ox, oy, nx, ny, corners] of edges) {
      context.save();
      context.beginPath();
      corners.forEach(([cx, cy], index) => (index === 0 ? context.moveTo(cx, cy) : context.lineTo(cx, cy)));
      context.closePath();
      context.clip();
      context.fillStyle = fade(ox, oy, nx, ny);
      context.fillRect(0, 0, width, height);
      context.restore();
    }
  }
}

// テストと表示確認で画素を読めるように、描画結果を次の描画まで保持する。
const GL_OPTIONS: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true };

/** 一度canvasでWebGLを使うと2Dへ切り替えられないため、別のcanvasでシェーダーを組めるか確かめる。 */
function shaderAvailable(): boolean {
  const gl = document.createElement('canvas').getContext('webgl2', GL_OPTIONS);
  if (!gl) return false;
  try {
    setup(gl);
    return true;
  } catch (error) {
    console.error('display shader setup failed', error);
    return false;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * 描画器を作る。WebGL2のシェーダーで描き、使えない環境ではcanvas 2Dで近似する。
 * `onRestore` はGPUのコンテキストが失われて復帰したときに呼ばれ、呼び出し側は次のフレームで描き直す。
 */
export function createRenderer(canvas: HTMLCanvasElement, onRestore: () => void): SceneRenderer {
  const gl = shaderAvailable() ? canvas.getContext('webgl2', GL_OPTIONS) : null;
  if (gl) {
    let uniforms: Uniforms | null = setup(gl);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      uniforms = null;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      uniforms = setup(gl);
      onRestore();
    });
    return {
      draw(primitives) {
        if (uniforms && !gl.isContextLost()) drawGl(gl, uniforms, primitives);
      },
    };
  }
  const context = canvas.getContext('2d', { alpha: false });
  return {
    draw(primitives) {
      if (context) draw2d(context, primitives);
    },
  };
}
