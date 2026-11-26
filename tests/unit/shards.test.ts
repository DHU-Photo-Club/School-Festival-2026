import { describe, expect, it } from "vitest";
import type { ShardPose } from "../../src/shared/shards.ts";
import {
	BREATH_CYCLE,
	BREATH_DEPTH,
	ringBreath,
	SHARD_RING_RADIUS,
	SHARD_STREAK_HALF_WIDTH,
	shardColor,
	shardOutlineColor,
	shardPoses,
} from "../../src/shared/shards.ts";

describe("破片の配置", () => {
	it("同じ大きさと時刻からは同じ配置を返す", () => {
		expect(shardPoses(1920, 1080, 123_456)).toEqual(shardPoses(1920, 1080, 123_456));
	});

	it("輪の半径の倍率は、輪の半径だけを縮め、破片の大きさは変えない", () => {
		const distances = (scale?: number) =>
			shardPoses(1920, 1080, 5_000, { scale }).map((pose) => Math.hypot(pose.x - 960, pose.y - 540));
		const full = distances();
		for (const [index, value] of distances(0.3).entries()) expect(value).toBeCloseTo(full[index] * 0.3, 5);
		const size = (scale?: number) =>
			shardPoses(1920, 1080, 5_000, { scale }).map(({ vertices }) =>
				Math.hypot(vertices[0][0] - vertices[1][0], vertices[0][1] - vertices[1][1]),
			);
		const fullSizes = size();
		for (const [index, value] of size(0.3).entries()) expect(value).toBeCloseTo(fullSizes[index], 5);
	});

	it("密度は先頭から数えた枚数だけ見せ、並び順は変えない", () => {
		const full = shardPoses(1920, 1080, 5_000);
		const sparse = shardPoses(1920, 1080, 5_000, { density: 0.3 });
		expect(sparse).toHaveLength(full.length);
		const shown = sparse.filter((pose) => pose.alpha > 0);
		expect(shown).toHaveLength(Math.ceil(full.length * 0.3));
		// 先頭の破片は全枚数のときと同じ位置と不透明度で、境の一枚だけ不透明度が下がる。
		expect(sparse[0]).toEqual(full[0]);
		for (const pose of sparse.slice(shown.length)) expect(pose).toMatchObject({ alpha: 0, streak: null });
	});

	it("散らばりは輪の内側の縁を残したまま、破片を外側へ画面いっぱいに広げる", () => {
		const distances = (spread: number) =>
			shardPoses(1920, 1080, 5_000, { spread }).map((pose) => Math.hypot(pose.x - 960, pose.y - 540));
		const ring = distances(0);
		const scatter = distances(1);
		// どの破片も内側へは動かない。
		for (const [index, value] of scatter.entries()) expect(value).toBeGreaterThanOrEqual(ring[index] * 0.99);
		// 外側の縁の破片は、輪の半径の2倍を超えて画面の隅の近くまで広がる。
		const unit = 1080 * SHARD_RING_RADIUS;
		expect(Math.max(...scatter)).toBeGreaterThan(unit * 2);
		// 内側は空けたまま（輪の内側の縁より内には破片が来ない）。
		expect(Math.min(...scatter)).toBeGreaterThan(unit * 0.7);
		// 画面の外へ出る破片と、画面の中に散らばる破片の両方がある。
		const inside = shardPoses(1920, 1080, 5_000, { spread: 1 }).filter(
			(pose) => pose.x > 0 && pose.x < 1920 && pose.y > 0 && pose.y < 1080,
		);
		expect(inside.length).toBeGreaterThan(60);
	});

	it("時刻が進むと動く", () => {
		expect(shardPoses(1920, 1080, 0)).not.toEqual(shardPoses(1920, 1080, 5_000));
	});

	it("大きな時刻でも配置が崩れない（補正済みサーバー時刻をそのまま使う）", () => {
		const now = 1_800_000_000_000;
		for (const pose of shardPoses(1920, 1080, now)) {
			for (const [x, y] of pose.vertices) {
				expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
			}
		}
	});

	it("輪の内側は空けておく", () => {
		const [width, height] = [1180, 820];
		const radius = Math.min(width, height) * SHARD_RING_RADIUS;
		for (const time of [0, 40_000, 90_000]) {
			const near = shardPoses(width, height, time)
				.flatMap((pose) => pose.vertices)
				.map(([x, y]) => Math.hypot(x - width / 2, y - height / 2));
			expect(Math.min(...near)).toBeGreaterThan(radius * 0.2);
		}
	});
});

/** 浮動小数点の末尾の差を除くため、破片の位置を小数第4位で丸める。 */
const rounded = (pose: ShardPose) => ({
	x: Number(pose.x.toFixed(4)),
	y: Number(pose.y.toFixed(4)),
	vertices: pose.vertices.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]),
	shade: Number(pose.shade.toFixed(4)),
	alpha: Number(pose.alpha.toFixed(4)),
});

describe("輪の破片", () => {
	it("130枚を画面中央の周りに置く", () => {
		const [width, height] = [1180, 820];
		const all = shardPoses(width, height, 40_000);
		expect(all).toHaveLength(130);
		// 重心は画面中央から輪の半径の1.37倍以内にある（半径の比の最大1.2に揺れの0.04を足し、呼吸の最大1.1倍を掛ける）。
		const reach = Math.min(width, height) * SHARD_RING_RADIUS * 1.37;
		for (const pose of all) {
			expect(Math.hypot(pose.x - width / 2, pose.y - height / 2)).toBeLessThan(reach);
		}
	});

	it("配置と動きの値が変わらない", () => {
		const all = shardPoses(800, 600, 12_345);
		expect(rounded(all[0])).toMatchInlineSnapshot(`
			{
			  "alpha": 0.667,
			  "shade": 0.992,
			  "vertices": [
			    [
			      358.2245,
			      129.318,
			    ],
			    [
			      315.8436,
			      113.1298,
			    ],
			    [
			      321.5858,
			      63.7253,
			    ],
			  ],
			  "x": 331.8846,
			  "y": 102.0577,
			}
		`);
		expect(rounded(all[129])).toMatchInlineSnapshot(`
			{
			  "alpha": 0.4711,
			  "shade": 0.8255,
			  "vertices": [
			    [
			      552.467,
			      319.9854,
			    ],
			    [
			      627.0635,
			      399.0537,
			    ],
			    [
			      537.4694,
			      405.6821,
			    ],
			  ],
			  "x": 572.3333,
			  "y": 374.9071,
			}
		`);
	});
});

describe("輪の呼吸", () => {
	// 三つの波を重ねた呼吸の一周期（約3.9時間）をすべて調べる。
	it("半径の倍率は0.9〜1.1の範囲をほぼ使い切り、ゆっくり変わる", () => {
		let previous = ringBreath(0);
		let [low, high, step] = [previous, previous, 0];
		for (let time = 100; time <= BREATH_CYCLE; time += 100) {
			const value = ringBreath(time);
			[low, high] = [Math.min(low, value), Math.max(high, value)];
			step = Math.max(step, Math.abs(value - previous));
			previous = value;
		}
		expect(low).toBeGreaterThanOrEqual(1 - BREATH_DEPTH);
		expect(low).toBeLessThan(1 - BREATH_DEPTH * 0.96);
		expect(high).toBeLessThanOrEqual(1 + BREATH_DEPTH);
		expect(high).toBeGreaterThan(1 + BREATH_DEPTH * 0.96);
		// 100ミリ秒あたりの変化は半径の0.4%未満。実際の最大は約0.32%。
		expect(step).toBeLessThan(0.0033);
	});

	it("ふくらむ深さと間隔が一定にならず、一つの呼吸は12秒以上かかる", () => {
		const peaks: { time: number; value: number }[] = [];
		const turns: number[] = [];
		// 20ミリ秒刻みにして、標本化による頂点の時刻のずれを12秒の決まりに対して小さくする。
		for (let time = 20; time <= BREATH_CYCLE; time += 20) {
			const [before, now, after] = [ringBreath(time - 20), ringBreath(time), ringBreath(time + 20)];
			if (now > before && now >= after) {
				peaks.push({ time, value: now });
				turns.push(time);
			}
			if (now < before && now <= after) turns.push(time);
		}
		const gaps = peaks.slice(1).map(({ time }, index) => time - peaks[index].time);
		const depths = new Set(peaks.map(({ value }) => value.toFixed(3)));
		expect(depths.size).toBeGreaterThan(20);
		expect(new Set(gaps).size).toBeGreaterThan(4);
		// 繰り返す動きの周期は12秒以上（docs/visual-language.md 1章）。実際の最短は約12.46秒。
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(12_000);
		expect(Math.max(...gaps)).toBeLessThanOrEqual(17_500);
		// ふくらみと縮みの向きの入れ替わりの間隔は5秒以上あける（同書4.4節の「5〜9秒」）。
		const halves = turns.slice(1).map((time, index) => time - turns[index]);
		expect(Math.min(...halves)).toBeGreaterThanOrEqual(5_000);
	});

	it("呼吸は約3.9時間で同じ形へ戻り、各波の周期の継ぎ目でも途切れない", () => {
		const now = 1_800_000_123_456;
		expect(ringBreath(now + BREATH_CYCLE)).toBe(ringBreath(now));
		for (const period of [15_000, 23_000, 41_000]) {
			const seam = Math.ceil(now / period) * period;
			expect(Math.abs(ringBreath(seam + 1) - ringBreath(seam - 1))).toBeLessThan(0.0001);
		}
	});

	it("輪の半径は呼吸の倍率に合わせて変わる", () => {
		const [width, height] = [1920, 1080];
		const mean = (time: number) =>
			shardPoses(width, height, time).reduce(
				(sum, pose) => sum + Math.hypot(pose.x - width / 2, pose.y - height / 2),
				0,
			) / 130;
		// 呼吸の倍率が最大の時刻と最小の時刻を探し、輪の平均の半径の比が呼吸の倍率の比と合うことを確かめる。
		const times = Array.from({ length: 600 }, (_, index) => index * 1_000);
		const widest = times.reduce((best, time) => (ringBreath(time) > ringBreath(best) ? time : best));
		const narrowest = times.reduce((best, time) => (ringBreath(time) < ringBreath(best) ? time : best));
		const expected = ringBreath(widest) / ringBreath(narrowest);
		expect(expected).toBeGreaterThan(1.06);
		// 破片ごとの半径方向の揺れ（±4%）があるので、1%の差まで許す。
		expect(Math.abs(mean(widest) / mean(narrowest) / expected - 1)).toBeLessThan(0.01);
	});
});

describe("破片の色", () => {
	const RED = [255, 0, 0] as const;
	const BLUE = [0, 0, 255] as const;
	const two = { colors: [RED, BLUE] as const, amount: 1 };

	it("色づける前は明るさの灰色にする", () => {
		expect(shardColor(0.8, 0)).toEqual([204, 204, 204]);
		expect(shardColor(0.8, 1, { ...two, amount: 0 })).toEqual([204, 204, 204]);
	});

	it("偶数番目の破片を一色目、奇数番目を二色目へ振り分ける", () => {
		const dark = 150 / 255;
		expect(shardColor(dark, 0, two)).toEqual([255, 0, 0]);
		expect(shardColor(dark, 1, two)).toEqual([0, 0, 255]);
		expect(shardColor(dark, 2, two)).toEqual([255, 0, 0]);
	});

	it("明るい破片ほど白へ寄せ、最大で35%寄せる", () => {
		const [r, g, b] = shardColor(1, 1, two);
		expect(r).toBeCloseTo(255 * 0.35);
		expect(g).toBeCloseTo(255 * 0.35);
		expect(b).toBeCloseTo(255);
	});

	it("灰色から色へ進み具合だけ寄せる", () => {
		const dark = 150 / 255;
		const [r, g, b] = shardColor(dark, 0, { ...two, amount: 0.5 });
		expect(r).toBeCloseTo((150 + 255) / 2);
		expect(g).toBeCloseTo(150 / 2);
		expect(b).toBeCloseTo(150 / 2);
	});
});

describe("破片のアウトライン", () => {
	it("塗りの色を白へ12%寄せる", () => {
		const [r, g, b] = shardOutlineColor([150, 150, 150]);
		expect(r).toBeCloseTo(150 + 105 * 0.12);
		expect(g).toBeCloseTo(r);
		expect(b).toBeCloseTo(r);
	});

	it("各成分を塗りの値以上255以下にし、白は白のままにする", () => {
		const tinted = shardColor(200 / 255, 0, {
			colors: [
				[20, 40, 200],
				[0, 0, 0],
			],
			amount: 1,
		});
		for (const fill of [[0, 0, 0], [20, 40, 200], tinted, [255, 255, 255]] as const) {
			const outline = shardOutlineColor(fill);
			outline.forEach((value, channel) => {
				expect(value).toBeGreaterThanOrEqual(fill[channel]);
				expect(value).toBeLessThanOrEqual(255);
			});
		}
		expect(shardOutlineColor([255, 255, 255])).toEqual([255, 255, 255]);
	});

	it("色づけた破片では色相を保ち、白へ少し寄せる", () => {
		const [r, g, b] = shardOutlineColor([20, 40, 200]);
		expect(r).toBeCloseTo(20 + 235 * 0.12);
		expect(g).toBeCloseTo(40 + 215 * 0.12);
		expect(b).toBeCloseTo(200 + 55 * 0.12);
		expect(b > g && g > r).toBe(true);
	});
});

describe("破片の光の筋", () => {
	type Streak = NonNullable<ShardPose["streak"]>;
	const middle = (streak: Streak) => [(streak.from[0] + streak.to[0]) / 2, (streak.from[1] + streak.to[1]) / 2];
	const lit = (time: number) => shardPoses(1920, 1080, time).filter((pose) => pose.streak);

	it("筋の明るさは0〜1で、グラデーションの幅は一定", () => {
		for (const time of [0, 40_000, 90_000]) {
			for (const { streak } of lit(time)) {
				if (!streak) continue;
				expect(streak.strength).toBeGreaterThan(0);
				expect(streak.strength).toBeLessThanOrEqual(1);
				const length = Math.hypot(streak.to[0] - streak.from[0], streak.to[1] - streak.from[1]);
				expect(length).toBeCloseTo(SHARD_STREAK_HALF_WIDTH * 2);
			}
		}
	});

	it("筋は破片の長い向きに沿い、破片の幅と重なる位置を通る", () => {
		for (const pose of lit(40_000)) {
			if (!pose.streak) continue;
			const [dx, dy] = [pose.streak.to[0] - pose.streak.from[0], pose.streak.to[1] - pose.streak.from[1]];
			const across = Math.hypot(dx, dy);
			const [wx, wy] = [dx / across, dy / across];
			const spans = pose.vertices.map(([x, y]) => (x - pose.x) * wx + (y - pose.y) * wy);
			const [cx, cy] = middle(pose.streak);
			const offset = (cx - pose.x) * wx + (cy - pose.y) * wy;
			expect(offset).toBeGreaterThanOrEqual(Math.min(...spans) - SHARD_STREAK_HALF_WIDTH - 1e-9);
			expect(offset).toBeLessThanOrEqual(Math.max(...spans) + SHARD_STREAK_HALF_WIDTH + 1e-9);
			// 中心線の中点は重心を通る幅の向きの直線上にあり、中心線自体は長い向きに走る（重心からの長い向きの成分は0）。
			expect((cx - pose.x) * -wy + (cy - pose.y) * wx).toBeCloseTo(0);
		}
	});

	it("筋の値と、筋のある破片の数が変わらない", () => {
		const round = (streak: Streak | null) =>
			streak && {
				center: middle(streak).map((value) => Number(value.toFixed(2))),
				strength: Number(streak.strength.toFixed(4)),
			};
		const all = shardPoses(1920, 1080, 40_000);
		const first = all.flatMap((pose, index) => (pose.streak ? [{ index, ...round(pose.streak) }] : [])).slice(0, 3);
		expect(first).toMatchInlineSnapshot(`
			[
			  {
			    "center": [
			      676.99,
			      798.55,
			    ],
			    "index": 20,
			    "strength": 0.6799,
			  },
			  {
			    "center": [
			      881,
			      199.19,
			    ],
			    "index": 22,
			    "strength": 0.7263,
			  },
			  {
			    "center": [
			      819.69,
			      173.27,
			    ],
			    "index": 27,
			    "strength": 0.6315,
			  },
			]
		`);
		expect(all.filter((pose) => pose.streak).length).toMatchInlineSnapshot(`32`);
	});

	it("一部の破片だけに筋があり、筋のある破片は入れ替わる", () => {
		const indices = (time: number) =>
			shardPoses(1920, 1080, time).flatMap((pose, index) => (pose.streak ? [index] : []));
		const now = indices(40_000);
		expect(now.length).toBeGreaterThan(0);
		expect(now.length).toBeLessThan(130 / 2);
		expect(indices(70_000)).not.toEqual(now);
	});

	it("筋はゆっくり面の上を走り、明るさは急変しない", () => {
		let previous = shardPoses(1920, 1080, 0);
		let [brightness, step] = [0, 0];
		for (let time = 100; time <= 300_000; time += 100) {
			const current = shardPoses(1920, 1080, time);
			current.forEach((pose, index) => {
				const [before, after] = [previous[index].streak, pose.streak];
				if (!before || !after) return;
				brightness = Math.max(brightness, Math.abs(after.strength - before.strength));
				const [[ax, ay], [bx, by]] = [middle(before), middle(after)];
				step = Math.max(step, Math.hypot(bx - ax, by - ay));
			});
			previous = current;
		}
		// 100ミリ秒あたりの明るさの変化の上限。1.4秒かけても明るさが最大まで上がらない程度に抑える。
		expect(brightness).toBeLessThan(0.035);
		// 筋は動くが、100ミリ秒で5 CSS画素以上は飛ばない（docs/visual-language.md 4.4節）。
		expect(step).toBeGreaterThan(1);
		expect(step).toBeLessThan(5);
	});

	it("筋は、明るさが下限の近くにあるときか、破片の幅の端でだけ現れたり消えたりする", () => {
		/** 筋の中心線の、破片の幅の両端からの距離（CSS画素）。幅の外なら負。 */
		const inset = (pose: ShardPose, streak: Streak) => {
			const [dx, dy] = [streak.to[0] - streak.from[0], streak.to[1] - streak.from[1]];
			const length = Math.hypot(dx, dy);
			const [wx, wy] = [dx / length, dy / length];
			const spans = pose.vertices.map(([x, y]) => (x - pose.x) * wx + (y - pose.y) * wy);
			const [cx, cy] = middle(streak);
			const offset = (cx - pose.x) * wx + (cy - pose.y) * wy;
			return Math.min(offset - Math.min(...spans), Math.max(...spans) - offset);
		};
		let previous = shardPoses(1920, 1080, 0);
		let changes = 0;
		for (let time = 100; time <= 300_000; time += 100) {
			const current = shardPoses(1920, 1080, time);
			current.forEach((pose, index) => {
				const [before, after] = [previous[index], pose];
				if (Boolean(before.streak) === Boolean(after.streak)) return;
				changes += 1;
				const [shown, streak] = before.streak ? [before, before.streak] : [after, after.streak as Streak];
				// 明るさが下限（0.05）の近くにあるか、中心線が幅の端から4 CSS画素以内にある。
				expect(streak.strength < 0.08 || inset(shown, streak) < 4).toBe(true);
			});
			previous = current;
		}
		expect(changes).toBeGreaterThan(0);
	});
});
