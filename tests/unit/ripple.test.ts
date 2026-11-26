import { describe, expect, it } from "vitest";
import { drawRipple } from "../../src/client/common/ripple.ts";
import { RIPPLE_MS, RIPPLE_WIDTH_END, RIPPLE_WIDTH_START, rippleRings } from "../../src/shared/ripple.ts";

describe("波紋の輪", () => {
	const [width, height] = [1920, 1080];
	const corner = Math.hypot(width, height) / 2;

	it("回答の瞬間に、最初の輪が中心に最も濃く細い線で現れる", () => {
		const [first, ...rest] = rippleRings(0, width, height);
		expect(rest).toHaveLength(0);
		expect(first.radius).toBe(0);
		expect(first.alpha).toBeGreaterThan(0.2);
		// 細い線で、濃すぎない（薄く広がる）。
		expect(first.width).toBeLessThanOrEqual(RIPPLE_WIDTH_START);
		expect(first.alpha).toBeLessThan(0.5);
	});

	it("輪は外側へ広がり、広がるほど薄く細くなる", () => {
		let previous = rippleRings(0, width, height)[0];
		for (let time = 100; time < RIPPLE_MS - 1_500; time += 100) {
			const current = rippleRings(time, width, height)[0];
			expect(current.radius).toBeGreaterThan(previous.radius);
			expect(current.alpha).toBeLessThan(previous.alpha);
			expect(current.width).toBeLessThan(previous.width);
			previous = current;
		}
		expect(previous.width).toBeGreaterThanOrEqual(RIPPLE_WIDTH_END);
	});

	it("輪は2本で、二本目は一本目の0.3秒後に出る", () => {
		expect(rippleRings(299, width, height)).toHaveLength(1);
		expect(rippleRings(300, width, height)).toHaveLength(2);
		for (let time = 0; time < RIPPLE_MS; time += 50) {
			expect(rippleRings(time, width, height).length).toBeLessThanOrEqual(2);
		}
		expect(RIPPLE_MS).toBe(5_100);
	});

	it("輪は画面の隅の外まで広がってから消え、続く輪ほど遅れて出て、薄い", () => {
		const farthest = Math.max(
			...Array.from({ length: 60 }, (_, i) => rippleRings(i * 100, width, height)[0]?.radius ?? 0),
		);
		expect(farthest).toBeGreaterThan(corner * 0.99);
		const rings = rippleRings(1_500, width, height);
		expect(rings.length).toBeGreaterThan(1);
		for (let index = 1; index < rings.length; index++) {
			expect(rings[index].radius).toBeLessThan(rings[index - 1].radius);
			expect(rings[index].alpha / (rings[index].width + 0)).toBeGreaterThan(0);
		}
	});

	it("波紋の時間を過ぎると輪は残らない。時刻だけから決まり、画面の大きさに比例する", () => {
		expect(rippleRings(RIPPLE_MS, width, height)).toEqual([]);
		expect(rippleRings(1_000, width, height)).toEqual(rippleRings(1_000, width, height));
		const small = rippleRings(1_000, width / 2, height / 2)[0];
		const large = rippleRings(1_000, width, height)[0];
		expect(small.radius).toBeLessThan(large.radius);
	});

	it("全ての輪は、透明度が最大でも0.4を超えない", () => {
		for (let time = 0; time < RIPPLE_MS; time += 50) {
			for (const ring of rippleRings(time, width, height)) expect(ring.alpha).toBeLessThanOrEqual(0.4);
		}
	});
});

/** canvas 2Dの呼び出しを記録する。 */
function recordingContext() {
	const calls: string[] = [];
	const strokes: { style: string; width: number; arc: number[] }[] = [];
	let arc: number[] = [];
	const context = {
		canvas: { width: 200, height: 100 },
		lineWidth: 0,
		strokeStyle: "",
		save: () => calls.push("save"),
		restore: () => calls.push("restore"),
		setTransform: () => calls.push("setTransform"),
		clearRect: () => calls.push("clearRect"),
		beginPath: () => calls.push("beginPath"),
		arc: (...args: number[]) => {
			calls.push("arc");
			arc = args;
		},
		stroke: () => {
			calls.push("stroke");
			strokes.push({ style: context.strokeStyle, width: context.lineWidth, arc });
		},
	};
	return { context: context as unknown as CanvasRenderingContext2D, calls, strokes };
}

describe("波紋の描画", () => {
	it("輪がなければcanvasを消すだけにする", () => {
		const { context, calls } = recordingContext();
		drawRipple(context, [], 2);
		expect(calls).toEqual(["setTransform", "clearRect"]);
	});

	it("輪を画面の中心に、輪ごとの太さと不透明度の白い線で描く", () => {
		const { context, strokes } = recordingContext();
		drawRipple(
			context,
			[
				{ radius: 40, alpha: 0.25, width: 1.5 },
				{ radius: 0, alpha: 0.3, width: 1 },
			],
			2,
		);
		// canvasは200×100画素で、比が2なので中心は CSS画素で (50, 25)。半径0の輪は描かない。
		expect(strokes).toEqual([
			{ style: "rgba(255, 255, 255, 0.250)", width: 1.5, arc: [50, 25, 40, 0, Math.PI * 2] },
		]);
	});
});
