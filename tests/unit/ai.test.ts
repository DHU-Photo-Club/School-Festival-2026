import { describe, expect, it, vi } from "vitest";
import { PALETTE } from "../../src/data/palette.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { QUESTION_VERSION, QUESTIONS } from "../../src/data/questions.ts";
import { colorMatch, selectPhotos } from "../../src/shared/photo-selection.ts";
import type { Answer, Photo } from "../../src/shared/types.ts";
import { checkColorOutput } from "../../src/worker/ai/color.ts";
import { answerInput, readJson } from "../../src/worker/ai/input.ts";
import type { JudgeOptions } from "../../src/worker/ai/judge.ts";
import { createJudge } from "../../src/worker/ai/judge.ts";
import { checkPhotoOutput, photoCatalogInput } from "../../src/worker/ai/photos.ts";
import type { PromptRequest } from "../../src/worker/mistral.ts";

const QUESTION_IDS = QUESTIONS.map((question) => question.id);

const ANSWERS: Record<string, Answer> = {
	Q1: ["q1_1", "q1_6"],
	Q2: ["q2_5"],
	Q3: 0.3,
	Q4: { x: 0.2, y: 0.75 },
	Q5: ["q5_3", "q5_1"],
};

/** refs/handoff examples/color-ai-output.json と同じ形の出力。 */
const colorOutput = (patch: Record<string, unknown> = {}) => ({
	paletteVersion: "scenery-v2",
	name: "アンバーグリーン",
	nameReason: "琥珀色と翡翠色が混ざり、黄みのある緑に見えるため。",
	reading: "新しい景色に惹かれつつ、今は落ち着いて過ごしたい気持ちが見えます。",
	colors: [
		{ id: "jade", reason: "落ち着いた時間を望む気持ちを表します。", evidence: ["Q2", "Q5"] },
		{ id: "amber", reason: "新しい景色への関心を表します。", evidence: ["Q1"] },
	],
	relationship: "静かな色に温かい色を添え、落ち着きと好奇心が並ぶ様子を表します。",
	...patch,
});

describe("AIへの入力", () => {
	it("質問文と回答文言、軸の向きを含め、ニックネームを含まない", () => {
		const input = answerInput(QUESTION_VERSION, QUESTIONS, ANSWERS);
		expect(input.questionVersion).toBe("questions-v0.3");
		expect(input.questions.map((question) => question.id)).toEqual(QUESTION_IDS);
		const [q1, q2, q3, q4, q5] = input.questions;
		expect(q1).toMatchObject({
			question: QUESTIONS[0].prompt,
			answer: ["見たことのない景色に出会う", "何も決めず、のんびり過ごす"],
		});
		expect(q2.answer).toEqual(["何も気にせず穏やかに過ごせるとき"]);
		expect(q3.answer).toEqual({
			left: "まず、じっくり知りたい",
			right: "まず、試してみたい",
			value: 30,
			range: [0, 100],
			summary: "理解から入る傾向",
		});
		// 画面の上端がエネルギーの高い側。AIへは低い側を0として渡す。
		expect(q4.answer).toEqual({
			direction: { left: "内向き", right: "外向き", value: 20 },
			energy: { left: "エネルギーが低い", right: "エネルギーが高い", value: 25 },
			range: [0, 100],
		});
		expect(q5.answer).toEqual([
			{ rank: 1, answer: "新しい発見を感じている" },
			{ rank: 2, answer: "心が落ち着いている" },
		]);
		expect(JSON.stringify(input)).not.toContain("nickname");
	});

	it("写真カタログは内容の判定に使う項目だけを渡す", () => {
		const [first] = photoCatalogInput(PHOTOS);
		expect(Object.keys(first).sort()).toEqual(["contentTags", "description", "id", "moodTags"]);
	});

	it("返答の前後の文とコードフェンスを除いてJSONを読む", () => {
		expect(readJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
		expect(readJson('こちらです {"a":{"b":2}} 以上')).toEqual({ a: { b: 2 } });
		expect(readJson("{broken")).toBeUndefined();
		expect(readJson("なし")).toBeUndefined();
	});
});

describe("二色の出力の検証", () => {
	const check = (value: unknown) => checkColorOutput(value, PALETTE, QUESTION_IDS);

	it("正しい出力の前後の空白を除いて受け取る", () => {
		const result = check(colorOutput({ name: " アンバーグリーン " }));
		expect(result).toMatchObject({
			ok: true,
			value: { name: "アンバーグリーン", colors: [{ id: "jade" }, { id: "amber" }] },
		});
	});

	it.each([
		["パレットの版の違い", colorOutput({ paletteVersion: "scenery-v1" })],
		["二色の列挙", colorOutput({ name: "翡翠×琥珀" })],
		["名前の改行", colorOutput({ name: "アンバー\nグリーン" })],
		["長すぎる名前", colorOutput({ name: "ア".repeat(25) })],
		["長すぎる読み取り", colorOutput({ reading: "あ".repeat(151) })],
		["空の関係", colorOutput({ relationship: " " })],
		["一色だけ", colorOutput({ colors: [colorOutput().colors[0]] })],
		["同じ色を二つ", colorOutput({ colors: [colorOutput().colors[0], colorOutput().colors[0]] })],
		[
			"パレットにない色",
			colorOutput({ colors: [{ ...colorOutput().colors[0], id: "magenta" }, colorOutput().colors[1]] }),
		],
		["自由なHSL", colorOutput({ colors: [{ ...colorOutput().colors[0], h: 160 }, colorOutput().colors[1]] })],
		[
			"根拠のない色",
			colorOutput({ colors: [{ ...colorOutput().colors[0], evidence: [] }, colorOutput().colors[1]] }),
		],
		[
			"存在しない質問ID",
			colorOutput({ colors: [{ ...colorOutput().colors[0], evidence: ["Q9"] }, colorOutput().colors[1]] }),
		],
		["オブジェクトでない", ["jade", "amber"]],
	])("%sを拒否する", (_label, value) => {
		expect(check(value).ok).toBe(false);
	});
});

describe("写真の出力の検証", () => {
	it("カタログにない写真、重複、根拠の欠けた項目を除き、除いた数を返す", () => {
		const result = checkPhotoOutput(
			{
				contentMatches: [
					{ photoId: "sdi0225", questionIds: ["Q2"], matchedTags: ["森"], reason: "落ち着き" },
					{ photoId: "sdi0225", questionIds: ["Q2"], matchedTags: [], reason: "重複" },
					{ photoId: "invented", questionIds: ["Q2"], matchedTags: [], reason: "架空" },
					{ photoId: "sdi0776", questionIds: [], matchedTags: [], reason: "根拠なし" },
					{ photoId: "sdi1091", questionIds: ["Q9"], matchedTags: [], reason: "不明な質問" },
				],
			},
			PHOTOS,
			QUESTION_IDS,
		);
		expect(result).toEqual({
			ok: true,
			value: {
				matches: [{ photoId: "sdi0225", questionIds: ["Q2"], matchedTags: ["森"], reason: "落ち着き" }],
				dropped: 4,
			},
		});
		expect(checkPhotoOutput({ photos: [] }, PHOTOS, QUESTION_IDS).ok).toBe(false);
	});
});

describe("写真の選定", () => {
	const photo = (id: string, overall: string[], partial: string[] = []): Photo => ({
		...PHOTOS[0],
		id,
		colorTags: { overall: overall as never, partial: partial as never },
	});
	const catalog = [
		photo("color-partial", [], ["jade"]),
		photo("color-overall", ["amber"]),
		photo("both", ["jade"]),
		photo("content-only", ["rose"]),
		photo("none", ["blue"]),
	];
	const match = (photoId: string) => ({ photoId, questionIds: ["Q1"], matchedTags: [], reason: "x" });

	it("二色のどちらかが全体か一部分の色タグにあれば色が合う", () => {
		expect(colorMatch(catalog[0], ["jade", "amber"])).toEqual({ kind: "partial", matchedResultColorId: "jade" });
		expect(colorMatch(catalog[1], ["jade", "amber"])).toEqual({ kind: "overall", matchedResultColorId: "amber" });
		expect(colorMatch(catalog[4], ["jade", "amber"])).toBeNull();
	});

	it("段階1→2→3の順に選び、段階2は全体の色を先にし、足りない枚数を記録する", () => {
		const selection = selectPhotos({
			photos: catalog,
			colors: ["jade", "amber"],
			contentMatches: [match("content-only"), match("both"), match("missing")],
			count: 10,
			policyVersion: "photo-policy-v1",
		});
		expect(selection.selected.map((pick) => [pick.photoId, pick.tier])).toEqual([
			["both", 1],
			["color-overall", 2],
			["color-partial", 2],
			["content-only", 3],
		]);
		expect(selection).toMatchObject({ requested: 10, shortage: 6, contentStatus: "ai" });
		expect(selection.selected[3].colorEvidence).toBeNull();
		expect(selection.selected[1].contentEvidence).toBeNull();
	});

	it("内容の判定がなければ色だけで選び、枚数で打ち切る", () => {
		const selection = selectPhotos({
			photos: catalog,
			colors: ["jade", "amber"],
			contentMatches: null,
			count: 2,
			policyVersion: "photo-policy-v1",
		});
		expect(selection.selected.map((pick) => pick.tier)).toEqual([2, 2]);
		expect(selection).toMatchObject({ shortage: 0, contentStatus: "unavailable" });
	});
});

describe("AIで結果を決める", () => {
	const photoReply = JSON.stringify({
		contentMatches: [{ photoId: "sdi1195-3", questionIds: ["Q2"], matchedTags: ["水辺"], reason: "穏やか" }],
	});

	function setup(replies: (string | Error)[]) {
		const requests: PromptRequest[] = [];
		const log = vi.fn();
		const send = vi.fn(async (request: PromptRequest) => {
			requests.push(request);
			const reply = replies.shift();
			if (reply === undefined) throw new Error("返答がもうない");
			if (reply instanceof Error) throw reply;
			return reply;
		});
		const options: JudgeOptions = {
			send,
			model: "mistral-small-latest",
			questionVersion: QUESTION_VERSION,
			questions: QUESTIONS,
			palette: PALETTE,
			photos: PHOTOS,
			now: () => 1_000,
			newResultId: () => "0123456789abcdef",
			log,
			settings: { retries: 1, callTimeoutMs: 1_000 },
		};
		return { judge: createJudge(options), requests, log, send };
	}

	it("二色を選んでから写真を選び、モデルを含む記録を返す", async () => {
		const { judge, requests } = setup([JSON.stringify(colorOutput()), photoReply]);
		const record = await judge(ANSWERS, new AbortController().signal);
		expect(record).toMatchObject({
			schemaVersion: "color-result-v1",
			id: "0123456789abcdef",
			createdAt: 1_000,
			questionVersion: "questions-v0.3",
			paletteVersion: "scenery-v2",
			model: "mistral-small-latest",
			answers: ANSWERS,
			color: { name: "アンバーグリーン" },
			photos: { contentStatus: "ai", requested: 10 },
		});
		expect(record?.photos.selected[0]).toMatchObject({ photoId: "sdi1195-3", tier: 1 });
		// 色の選定にはパレットと回答、写真の選定には確定した二色とカタログを渡す。
		expect(requests[0].prompt).toContain('"version": "scenery-v2"');
		expect(requests[0].prompt).toContain(QUESTIONS[0].prompt);
		expect(requests[1].prompt).toContain('"id": "jade"');
		expect(requests[1].prompt).toContain('"id": "sdi1195-3"');
		expect(requests[1].prompt).not.toContain("colorTags");
	});

	it("色の出力が使えなければ一度だけやり直し、理由と返答をログに残す", async () => {
		const { judge, log, send } = setup([
			JSON.stringify(colorOutput({ name: "翡翠×琥珀" })),
			JSON.stringify(colorOutput()),
			photoReply,
		]);
		expect(await judge(ANSWERS, new AbortController().signal)).not.toBeNull();
		expect(send).toHaveBeenCalledTimes(3);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("色の選定の出力を使えません（1回目）"));
		expect(log.mock.calls[0][0]).toContain("翡翠×琥珀");
	});

	it("やり直しても色を選べなければ null を返し、固定の結果を作らない", async () => {
		const { judge, log, send } = setup([new Error("Mistral AI 503: down"), "わかりません"]);
		expect(await judge(ANSWERS, new AbortController().signal)).toBeNull();
		expect(send).toHaveBeenCalledTimes(2);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("Mistral AI 503: down"));
	});

	it("写真の選定に失敗しても二色は保ち、色の適合だけで写真を選ぶ", async () => {
		const { judge } = setup([JSON.stringify(colorOutput()), "壊れた", "{}"]);
		const record = await judge(ANSWERS, new AbortController().signal);
		expect(record?.color.colors.map((color) => color.id)).toEqual(["jade", "amber"]);
		expect(record?.photos.contentStatus).toBe("unavailable");
		expect(record?.photos.selected.every((pick) => pick.tier === 2)).toBe(true);
	});

	it("打ち切られたら送らずに null を返す", async () => {
		const { judge, send } = setup([JSON.stringify(colorOutput())]);
		const controller = new AbortController();
		controller.abort();
		expect(await judge(ANSWERS, controller.signal)).toBeNull();
		expect(send).not.toHaveBeenCalled();
	});
});
