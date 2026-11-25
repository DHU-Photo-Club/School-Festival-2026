import { describe, expect, it } from "vitest";
import { drawShards, SHARD_OUTLINE_WIDTH, SHARD_STREAK_PROFILE } from "../../src/client/common/shards.ts";
import { shardPoses } from "../../src/shared/shards.ts";

/** 線形グラデーションの引数と、各位置の色。 */
interface Gradient {
	line: number[];
	stops: [number, string][];
}

/** 一回の塗りか線。`style` は描いた時点の色か線形グラデーション。 */
interface Paint {
	kind: "fill" | "stroke";
	style: string | Gradient;
	width: number;
	join: string;
}

/** canvas 2Dの呼び出しを記録する。`shards` は `beginPath` ごとに区切った破片一枚ずつの塗りと線。 */
function recordingContext() {
	const calls: string[] = [];
	const shards: Paint[][] = [];
	const context = {
		canvas: { width: 100, height: 100 },
		fillStyle: "" as string | Gradient,
		strokeStyle: "",
		lineWidth: 0,
		lineJoin: "miter",
		save: () => calls.push("save"),
		restore: () => calls.push("restore"),
		setTransform: () => calls.push("setTransform"),
		clearRect: () => calls.push("clearRect"),
		beginPath: () => {
			calls.push("beginPath");
			shards.push([]);
		},
		moveTo: () => calls.push("moveTo"),
		lineTo: () => calls.push("lineTo"),
		closePath: () => calls.push("closePath"),
		createLinearGradient: (...line: number[]): Gradient => {
			const gradient: Gradient = { line, stops: [] };
			return Object.assign(gradient, {
				addColorStop: (offset: number, color: string) => gradient.stops.push([offset, color]),
			});
		},
		fill: () => {
			calls.push("fill");
			shards.at(-1)?.push({ kind: "fill", style: context.fillStyle, width: 0, join: "" });
		},
		stroke: () => {
			calls.push("stroke");
			shards.at(-1)?.push({
				kind: "stroke",
				style: context.strokeStyle,
				width: context.lineWidth,
				join: context.lineJoin,
			});
		},
	};
	return { context: context as unknown as CanvasRenderingContext2D, calls, shards };
}

const alphaOf = (style: string) => Number(style.slice(style.lastIndexOf(",") + 1, -1));
const channelsOf = (style: string) => style.slice(5, style.lastIndexOf(",")).split(",").map(Number);

describe("破片の描画", () => {
	const poses = shardPoses(800, 600, 12_345);
	const streaked = poses.map((pose) => pose.streak !== null);

	it("光の筋のある破片とない破片の両方を含む", () => {
		expect(streaked).toContain(true);
		expect(streaked).toContain(false);
	});

	it("破片ごとにアウトライン、塗り、光の筋の順に描く", () => {
		const { context, shards } = recordingContext();
		drawShards(context, poses, 2, 1);
		expect(shards.map((paints) => paints.map((paint) => paint.kind))).toEqual(
			streaked.map((has) => (has ? ["stroke", "fill", "fill"] : ["stroke", "fill"])),
		);
	});

	it("アウトラインは太さ1 CSS画素で角を丸めた線にし、塗りと同じ不透明度にする", () => {
		const { context, shards } = recordingContext();
		drawShards(context, poses, 2, 0.5);
		expect(SHARD_OUTLINE_WIDTH).toBe(1);
		for (const [stroke, fill] of shards) {
			expect(stroke.width).toBe(SHARD_OUTLINE_WIDTH);
			expect(stroke.join).toBe("round");
			const [line, body] = [stroke.style as string, fill.style as string];
			expect(alphaOf(line)).toBe(alphaOf(body));
			// 白に近い破片は整数へ丸めると塗りと同じ色になるので、各成分が塗りの値以上であることを確かめる。
			const outline = channelsOf(line);
			channelsOf(body).forEach((value, channel) => {
				expect(outline[channel]).toBeGreaterThanOrEqual(value);
			});
		}
	});

	it("光の筋は中央が最も明るい白の線形グラデーションにし、中心線の不透明度は筋の明るさに破片の不透明度と全体の不透明度を掛けた値にする", () => {
		const { context, shards } = recordingContext();
		const opacity = 0.5;
		drawShards(context, poses, 2, opacity);
		poses.forEach((pose, index) => {
			if (!pose.streak) return;
			const gradient = shards[index][2].style as Gradient;
			expect(gradient.line).toEqual([...pose.streak.from, ...pose.streak.to]);
			const peak = pose.streak.strength * pose.alpha * opacity;
			expect(gradient.stops.map(([offset]) => offset)).toEqual(SHARD_STREAK_PROFILE.map(([offset]) => offset));
			gradient.stops.forEach(([, color], stop) => {
				expect(channelsOf(color)).toEqual([255, 255, 255]);
				// 描画は不透明度を小数第3位へ丸めて渡す。
				expect(alphaOf(color)).toBe(Number((peak * SHARD_STREAK_PROFILE[stop][1]).toFixed(3)));
			});
		});
	});

	it("光の筋は両端を透明にし、中央を最も明るくする", () => {
		const shares = SHARD_STREAK_PROFILE.map(([, share]) => share);
		expect(shares[0]).toBe(0);
		expect(shares.at(-1)).toBe(0);
		expect(Math.max(...shares)).toBe(1);
		expect(SHARD_STREAK_PROFILE.find(([, share]) => share === 1)?.[0]).toBe(0.5);
	});

	it("線の設定を描画の後に戻す", () => {
		const { context, calls } = recordingContext();
		drawShards(context, poses, 2, 1);
		expect(calls.filter((call) => call === "save" || call === "restore")).toEqual(["save", "restore"]);
		expect(calls.at(-1)).toBe("restore");
	});

	it("`detail` が偽ならアウトラインと光の筋を描かない", () => {
		const { context, shards } = recordingContext();
		drawShards(context, poses, 0.125, 1, undefined, false);
		expect(shards.map((paints) => paints.map((paint) => paint.kind))).toEqual(poses.map(() => ["fill"]));
	});
});
