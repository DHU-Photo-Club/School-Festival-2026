import { describe, expect, it } from "vitest";
import {
	ANSWER_ORBIT_BOOST_MS,
	answerOrbitAdvance,
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

describe("待機用の円形に沿った破片", () => {
	it("公転・呼吸・揺れの軌道と明るさを変えず、半径方向の突き出しを抑える", () => {
		for (const time of [0, 5_000, 40_000, 1_800_000_000_000]) {
			const normal = shardPoses(1920, 1080, time, { scale: 0.3 });
			const idle = shardPoses(1920, 1080, time, { scale: 0.3, idleFit: 1 });
			for (const [index, piece] of idle.entries()) {
				const original = normal[index];
				expect([piece.x, piece.y, piece.shade, piece.alpha]).toEqual([original.x, original.y, original.shade, original.alpha]);
				const r = Math.hypot(piece.x - 960, piece.y - 540);
				const [rx, ry] = [(piece.x - 960) / r, (piece.y - 540) / r];
				for (const [vertexIndex, [x, y]] of piece.vertices.entries()) {
					const [ox, oy] = original.vertices[vertexIndex];
					expect((x - piece.x) * rx + (y - piece.y) * ry).toBeCloseTo(((ox - piece.x) * rx + (oy - piece.y) * ry) * 0.7, 5);
					expect(-(x - piece.x) * ry + (y - piece.y) * rx).toBeCloseTo(-(ox - piece.x) * ry + (oy - piece.y) * rx, 5);
				}
			}
			// 待機の整形を使わない質問・結果は元の幾何形状のまま。
			expect(shardPoses(1920, 1080, time, { idleFit: 0 })).toEqual(shardPoses(1920, 1080, time));
		}
	});
	it("待機の形も時間とともに動き、すべて同じ大きさ・向きには揃えない", () => {
		const idle = shardPoses(1920, 1080, 0, { scale: 0.3, idleFit: 1 });
		expect(idle).not.toEqual(shardPoses(1920, 1080, 5_000, { scale: 0.3, idleFit: 1 }));
		const lengths = idle.map(({ vertices }) => Math.hypot(vertices[0][0] - vertices[1][0], vertices[0][1] - vertices[1][1]));
		expect(Math.max(...lengths) / Math.min(...lengths)).toBeGreaterThan(2);
	});
});

it("回答の加速は角度を逆戻りさせず、終わると一定の追加角度に落ち着く", () => {
	expect(answerOrbitAdvance(-1)).toBe(0);
	expect(answerOrbitAdvance(0)).toBe(0);
	for (let t = 1; t <= 3000; t += 20) expect(answerOrbitAdvance(t)).toBeGreaterThanOrEqual(answerOrbitAdvance(t - 1));
	expect(answerOrbitAdvance(ANSWER_ORBIT_BOOST_MS)).toBeCloseTo(12600);
	expect(answerOrbitAdvance(10000)).toBe(answerOrbitAdvance(ANSWER_ORBIT_BOOST_MS));
	expect(answerOrbitAdvance(1)).toBeLessThan(0.001);
	expect(answerOrbitAdvance(ANSWER_ORBIT_BOOST_MS) - answerOrbitAdvance(ANSWER_ORBIT_BOOST_MS - 1)).toBeLessThan(0.001);
});
