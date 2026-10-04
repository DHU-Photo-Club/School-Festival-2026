import type { Primitive } from '../../shared/motion.ts';

const DEG = Math.PI / 180;

/** `computeScene` の描画内容をcanvasへ描く。座標はcanvasの画素単位。 */
export function drawScene(context: CanvasRenderingContext2D, primitives: readonly Primitive[]): void {
  const { width, height } = context.canvas;
  for (const primitive of primitives) {
    context.globalAlpha = 1;
    switch (primitive.type) {
      case 'fill':
        context.globalAlpha = primitive.alpha ?? 1;
        context.fillStyle = primitive.color;
        context.fillRect(0, 0, width, height);
        break;
      case 'ring': {
        if (primitive.outer <= primitive.inner) break;
        const step = (2 * Math.PI) / primitive.colors.length;
        // 12時方向を0として時計回りに測る。
        const origin = primitive.angle * DEG - Math.PI / 2;
        primitive.colors.forEach((color, index) => {
          const start = origin + index * step;
          context.beginPath();
          context.arc(primitive.cx, primitive.cy, primitive.outer, start, start + step);
          context.arc(primitive.cx, primitive.cy, primitive.inner, start + step, start, true);
          context.closePath();
          context.fillStyle = color;
          context.fill();
        });
        break;
      }
      case 'circle':
        context.beginPath();
        context.arc(primitive.cx, primitive.cy, Math.max(0, primitive.r), 0, 2 * Math.PI);
        context.fillStyle = primitive.color;
        context.fill();
        break;
      case 'rect':
        context.fillStyle = primitive.color;
        context.fillRect(primitive.x, primitive.y, primitive.w, primitive.h);
        break;
      case 'ellipseHole':
        context.fillStyle = primitive.color;
        context.fillRect(0, 0, width, height);
        if (primitive.rx > 0 && primitive.ry > 0) {
          context.beginPath();
          context.ellipse(primitive.cx, primitive.cy, primitive.rx, primitive.ry, 0, 0, 2 * Math.PI);
          context.fillStyle = primitive.holeColor;
          context.fill();
        }
        break;
      case 'fan':
        context.beginPath();
        context.moveTo(primitive.cx, primitive.cy);
        context.arc(primitive.cx, primitive.cy, primitive.r, primitive.start, primitive.start + primitive.sweep);
        context.closePath();
        context.fillStyle = primitive.color;
        context.fill();
        break;
    }
  }
  context.globalAlpha = 1;
}
