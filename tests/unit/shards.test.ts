import { describe, expect, it } from "vitest";
import {
	BREATH_CYCLE,
	BREATH_DEPTH,
	ringBreath,
	SHARD_RING_RADIUS,
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

	it("密度は先頭から数えた順に、段階的に不透明度を上げて見せ、並び順は変えない", () => {
		const full = shardPoses(1920, 1080, 5_000);
		const sparse = shardPoses(1920, 1080, 5_000, { density: 0.3 });
		expect(sparse).toHaveLength(full.length);
		const shown = sparse.filter((pose) => pose.alpha > 0);
		expect(shown.length).toBeGreaterThan(0);
		expect(shown.length).toBeLessThan(full.length);
		// 先頭の破片は全枚数のときと同じ位置と不透明度で、後ろへ向かって不透明度が下がり、一枚ずつ急に現れない。
		expect(sparse[0]).toEqual(full[0]);
		const alphas = sparse.map((pose, index) => pose.alpha / full[index].alpha);
		for (let index = 1; index < alphas.length; index++)
			expect(alphas[index]).toBeLessThanOrEqual(alphas[index - 1] + 1e-9);
		expect(alphas.filter((ratio) => ratio > 0 && ratio < 1).length).toBeGreaterThan(10);
		for (const pose of sparse.slice(shown.length)) expect(pose).toMatchObject({ alpha: 0 });
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

	it("画面全体への散らばりは、輪の内側も含めて画面の中心から縁まで破片を偏りなく並べる", () => {
		for (const [width, height] of [
			[1920, 1080],
			[1080, 1920],
			[1000, 1000],
		]) {
			// 一フレームでは枚数の揺らぎが大きいので、公転の一周より長い時間にわたって50フレームを合算する。
			const cells = Array.from({ length: 9 }, () => 0);
			let inside = 0;
			let total = 0;
			for (let frame = 0; frame < 50; frame++) {
				for (const pose of shardPoses(width, height, frame * 7_919, { fill: 1 })) {
					total++;
					if (pose.x <= 0 || pose.x >= width || pose.y <= 0 || pose.y >= height) continue;
					inside++;
					cells[Math.floor((pose.y / height) * 3) * 3 + Math.floor((pose.x / width) * 3)]++;
				}
			}
			// 四隅を通る楕円の中に一様に並ぶので、画面の中にあるのは楕円と画面の面積の比（2/π、約64%）になる。
			expect(inside / total).toBeCloseTo(2 / Math.PI, 1);
			// 画面を3×3に分けた区画のどれも（中央も、横長の画面の左右も）、平均の±10%以内の枚数になる。
			for (const count of cells) {
				expect(count / (inside / 9)).toBeGreaterThan(0.9);
				expect(count / (inside / 9)).toBeLessThan(1.1);
			}
		}
	});

	it("画面全体へ散らばった破片は、直線ではなく、画面と同じ縦横比の楕円の上を公転する", () => {
		const [width, height] = [1920, 1080];
		const sample = (time: number) =>
			shardPoses(width, height, time, { fill: 1 }).map(({ x, y }) => [
				(x - width / 2) / (width / 2),
				(y - height / 2) / (height / 2),
			]);
		const start = sample(0);
		// 揺れ（輪の半径の±4%）を除けば、正規化した座標での中心からの距離は公転の間に変わらない（直線の辺を滑らない）。
		for (let time = 5_000; time <= 150_000; time += 5_000) {
			for (const [index, [x, y]] of sample(time).entries()) {
				expect(Math.abs(Math.hypot(x, y) - Math.hypot(start[index][0], start[index][1]))).toBeLessThan(0.15);
			}
		}
	});

	it("画面の幅か高さが0でも、画面全体への散らばりの座標が NaN にならない", () => {
		for (const [width, height] of [
			[0, 1080],
			[1920, 0],
			[0, 0],
		]) {
			for (const pose of shardPoses(width, height, 5_000, { fill: 1 })) {
				const values = [pose.x, pose.y, ...pose.vertices.flat()];
				expect(values.every(Number.isFinite)).toBe(true);
			}
		}
	});

	it("画面全体への散らばりは、0なら輪の配置と同じで、途中の値でも時刻でも位置が跳ばない", () => {
		expect(shardPoses(1920, 1080, 5_000, { fill: 0 })).toEqual(shardPoses(1920, 1080, 5_000));
		const step = (a: ReturnType<typeof shardPoses>, b: ReturnType<typeof shardPoses>) =>
			Math.max(...a.map((pose, index) => Math.hypot(pose.x - b[index].x, pose.y - b[index].y)));
		// 散らばりを少し進めても、どの破片も少ししか動かない。
		for (let fill = 0; fill < 1; fill += 0.05) {
			expect(
				step(shardPoses(1920, 1080, 5_000, { fill }), shardPoses(1920, 1080, 5_000, { fill: fill + 0.01 })),
			).toBeLessThan(25);
		}
		// 散らばり終えた破片は、公転の間、1フレームで少ししか動かない。最も遅い破片の一周（187.5秒）より長く
		// 1フレームずつ進め、どの破片も公転の角度の2πの折り返しをまたぐ。
		for (let time = 0; time < 190_000; time += 16) {
			expect(
				step(shardPoses(1920, 1080, time, { fill: 1 }), shardPoses(1920, 1080, time + 16, { fill: 1 })),
			).toBeLessThan(5);
		}
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

describe("散らばった破片の公転", () => {
	it("公転の時刻を止めると、画面全体へ散らばった破片は公転せず、その場で揺れるだけになる", () => {
		const [width, height] = [1920, 1080];
		const radius = Math.min(width, height) * SHARD_RING_RADIUS;
		const at = (elapsed: number, orbit?: number) => shardPoses(width, height, elapsed, { fill: 1, orbit });
		const still = at(0, 5_000);
		const later = at(60_000, 5_000);
		// 半径方向の揺れ（輪の半径の±4%）の分しか動かない。
		for (const [index, pose] of still.entries())
			expect(Math.hypot(later[index].x - pose.x, later[index].y - pose.y)).toBeLessThanOrEqual(
				0.08 * radius + 1e-6,
			);
		// 公転を止めなければ、60秒で輪の周りを回って大きく動く破片がある。
		const moving = at(60_000);
		expect(
			Math.max(...still.map((pose, index) => Math.hypot(moving[index].x - pose.x, moving[index].y - pose.y))),
		).toBeGreaterThan(0.5 * radius);
	});

	it("`orbit` を省略すると `elapsed` で公転する", () => {
		expect(shardPoses(1920, 1080, 12_345, { fill: 0.5 })).toEqual(
			shardPoses(1920, 1080, 12_345, { fill: 0.5, orbit: 12_345 }),
		);
	});
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
			  "alpha": 0.8854,
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
			  "alpha": 0.7331,
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
