import { describe, expect, it } from "vitest";
import { drawShards, SHARD_OUTLINE_WIDTH } from "../../src/client/common/shards.ts";
import { shardPoses } from "../../src/shared/shards.ts";

/** 一回の塗りか線。`style` は描いた時点の色。 */
interface Paint {
	kind: "fill" | "stroke";
	style: string;
	width: number;
	join: string;
}

/** canvas 2Dの呼び出しを記録する。`shards` は `beginPath` ごとに区切った破片一枚ずつの塗りと線。 */
function recordingContext() {
	const calls: string[] = [];
	const shards: Paint[][] = [];
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
		beginPath: () => {
			calls.push("beginPath");
			shards.push([]);
		},
		moveTo: () => {
			calls.push("moveTo");
		},
		lineTo: () => {
			calls.push("lineTo");
		},
		closePath: () => calls.push("closePath"),
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

	it("破片ごとにアウトライン、塗りの順に描く", () => {
		const { context, shards } = recordingContext();
		drawShards(context, poses, 2, 1);
		expect(shards.map((paints) => paints.map((paint) => paint.kind))).toEqual(poses.map(() => ["stroke", "fill"]));
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

	it("線の設定を描画の後に戻す", () => {
		const { context, calls } = recordingContext();
		drawShards(context, poses, 2, 1);
		expect(calls.filter((call) => call === "save" || call === "restore")).toEqual(["save", "restore"]);
		expect(calls.at(-1)).toBe("restore");
	});

	it("`detail` が偽ならアウトラインを描かない", () => {
		const { context, shards } = recordingContext();
		drawShards(context, poses, 0.125, 1, undefined, false);
		expect(shards.map((paints) => paints.map((paint) => paint.kind))).toEqual(poses.map(() => ["fill"]));
	});
});
