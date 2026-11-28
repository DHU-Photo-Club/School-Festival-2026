import { describe, expect, it } from "vitest";
import { resultPhotoFor, resultPhotoOrder } from "../../src/shared/assignment.ts";
import type { Photo } from "../../src/shared/types.ts";

/** 三画面構成（仕様書9.3節）。 */
const DISPLAY_ORDERS = [0, 1, 2];

const photo = (id: string, patch: Partial<Photo> = {}): Photo => ({
	id,
	width: 1600,
	height: 1200,
	shareAllowed: false,
	creditName: "x",
	colorTags: { overall: [], partial: [] },
	contentTags: [],
	moodTags: [],
	description: "x",
	tagStatus: "provisional",
	...patch,
});

describe("結果写真の割り当て", () => {
	it("選定した写真の displayOrder 番目を、その画面に見せる", () => {
		const photos = [photo("a"), photo("b"), photo("c")];
		expect(DISPLAY_ORDERS.map((order) => resultPhotoFor(photos, ["c", "a", "b"], order)?.id)).toEqual([
			"c",
			"a",
			"b",
		]);
	});

	it("写真が足りない画面と、カタログにない写真IDは、複製せずタイポグラフィ表示（null）にする", () => {
		const photos = [photo("a")];
		expect(resultPhotoFor(photos, ["a"], 1)).toBeNull();
		expect(resultPhotoFor(photos, [], 0)).toBeNull();
		expect(resultPhotoFor(photos, ["missing"], 0)).toBeNull();
	});

	it("同じ診断では全端末・再接続で同じ順序を使い、選定写真を重複なく割り当てる", () => {
		const ids = Array.from({ length: 10 }, (_, i) => `photo-${i}`);
		const catalog = ids.map((id) => photo(id));
		const original = [...ids];
		const assigned = ids.map((_, i) => resultPhotoFor(catalog, ids, i, "session-a")?.id);
		expect(assigned).toEqual(resultPhotoOrder(ids, "session-a"));
		expect(new Set(assigned)).toEqual(new Set(ids));
		expect(resultPhotoOrder(ids, "session-a")).toEqual(assigned);
		expect(resultPhotoOrder(ids, "session-b")).not.toEqual(assigned);
		expect(ids).toEqual(original);
		expect(resultPhotoFor(catalog, ids, 10, "session-a")).toBeNull();
	});

	it("先頭の写真だけに偏らず、追加写真を含む選定写真全体から選ぶ", () => {
		const ids = ["old-a", "old-b", ...Array.from({ length: 8 }, (_, i) => `new-${i}`)];
		const chosen = new Set(Array.from({ length: 100 }, (_, i) => resultPhotoOrder(ids, `session-${i}`)[0]));
		expect(chosen).toEqual(new Set(ids));
		expect(resultPhotoOrder([], "session")).toEqual([]);
		expect(resultPhotoOrder(["only"], "session")).toEqual(["only"]);
	});
});
