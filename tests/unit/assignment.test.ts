import { describe, expect, it } from "vitest";
import { resultPhotoFor } from "../../src/shared/assignment.ts";
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
});
