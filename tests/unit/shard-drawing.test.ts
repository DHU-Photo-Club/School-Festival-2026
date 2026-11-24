import { describe, expect, it } from "vitest";
import { drawShards, SHARD_OUTLINE_WIDTH } from "../../src/client/common/shards.ts";
import { shardPoses } from "../../src/shared/shards.ts";

/** canvas 2Dの呼び出しと、塗りと線を描いた時点のスタイルを記録する。 */
function recordingContext() {
	const calls: string[] = [];
	const fills: { style: string }[] = [];
	const strokes: { style: string; width: number; join: string }[] = [];
	const context = {
		canvas: { width: 100, height: 100 },
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 0,
		lineJoin: "miter",
		save: () => calls.push("save"),
		restore: () => calls.push("restore"),
		setTransform: () => calls.push("setTransform"),
		clearRect: () => calls.push("clearRect"),
		beginPath: () => calls.push("beginPath"),
		moveTo: () => calls.push("moveTo"),
		lineTo: () => calls.push("lineTo"),
		closePath: () => calls.push("closePath"),
		fill: () => {
			calls.push("fill");
			fills.push({ style: context.fillStyle });
		},
		stroke: () => {
			calls.push("stroke");
			strokes.push({ style: context.strokeStyle, width: context.lineWidth, join: context.lineJoin });
		},
	};
	return { context: context as unknown as CanvasRenderingContext2D, calls, fills, strokes };
}

const alphaOf = (style: string) => style.slice(style.lastIndexOf(",") + 1, -1).trim();
const channelsOf = (style: string) => style.slice(5, style.lastIndexOf(",")).split(",").map(Number);

describe("破片の描画", () => {
	const poses = shardPoses(800, 600, 12_345);

	it("破片ごとにアウトラインを先に描き、同じ輪郭へ塗りを重ねる", () => {
		const { context, calls, fills, strokes } = recordingContext();
		drawShards(context, poses, 2, 1);
		expect(strokes).toHaveLength(poses.length);
		expect(fills).toHaveLength(poses.length);
		const drawing = calls.filter((call) => ["closePath", "stroke", "fill"].includes(call));
		expect(drawing).toEqual(poses.flatMap(() => ["closePath", "stroke", "fill"]));
	});

	it("アウトラインは太さ1 CSS画素で角を丸めた線にし、塗りと同じ不透明度にする", () => {
		const { context, fills, strokes } = recordingContext();
		drawShards(context, poses, 2, 0.5);
		expect(SHARD_OUTLINE_WIDTH).toBe(1);
		strokes.forEach((stroke, index) => {
			expect(stroke.width).toBe(SHARD_OUTLINE_WIDTH);
			expect(stroke.join).toBe("round");
			expect(alphaOf(stroke.style)).toBe(alphaOf(fills[index].style));
			// 白に近い破片は整数へ丸めると塗りと同じ色になるので、各成分が塗りの値以上であることを確かめる。
			const outline = channelsOf(stroke.style);
			channelsOf(fills[index].style).forEach((value, channel) => {
				expect(outline[channel]).toBeGreaterThanOrEqual(value);
			});
		});
	});

	it("線の設定を描画の後に戻す", () => {
		const { context, calls } = recordingContext();
		drawShards(context, poses, 2, 1);
		expect(calls.filter((call) => call === "save" || call === "restore")).toEqual(["save", "restore"]);
		expect(calls.at(-1)).toBe("restore");
	});

	it("`outline` が偽ならアウトラインを描かない", () => {
		const { context, fills, strokes } = recordingContext();
		drawShards(context, poses, 0.125, 1, undefined, false);
		expect(strokes).toHaveLength(0);
		expect(fills).toHaveLength(poses.length);
	});
});
