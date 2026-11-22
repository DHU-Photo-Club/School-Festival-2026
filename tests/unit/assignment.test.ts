import { describe, expect, it } from "vitest";
import { PHOTOS } from "../../src/data/photos.ts";
import { idlePhotoFor, idlePlaylist, resultPhotoFor } from "../../src/shared/assignment.ts";
import type { Photo } from "../../src/shared/types.ts";

/** 三画面構成（仕様書9.3節）。 */
const DISPLAY_ORDERS = [0, 1, 2];

const photo = (id: string, patch: Partial<Photo> = {}): Photo => ({
	id,
	width: 1600,
	height: 1200,
	idleEnabled: true,
	idleOrder: 0,
	shareAllowed: false,
	creditName: "x",
	colorTags: { overall: [], partial: [] },
	contentTags: [],
	moodTags: [],
	description: "x",
	tagStatus: "provisional",
	...patch,
});

describe("待機プレイリスト", () => {
	it("idleEnabled の写真を idleOrder 昇順、同値は写真ID昇順で並べる", () => {
		const list = idlePlaylist([
			photo("c", { idleOrder: 1 }),
			photo("b", { idleOrder: 0 }),
			photo("a", { idleOrder: 1 }),
			photo("z", { idleEnabled: false }),
		]);
		expect(list.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
	});

	it("(cycleIndex + displayOrder) mod P 番目を表示し、同時刻に同じ写真を複数画面へ表示しない", () => {
		const playlist = idlePlaylist(PHOTOS);
		for (let cycle = 0; cycle < playlist.length * 2; cycle += 1) {
			const shown = DISPLAY_ORDERS.map((order) => idlePhotoFor(playlist, cycle, order)?.id);
			expect(new Set(shown).size).toBe(DISPLAY_ORDERS.length);
			expect(shown[0]).toBe(playlist[cycle % playlist.length].id);
		}
	});

	it("displayOrder >= P の画面は写真の代わりに展示タイトルを表示する", () => {
		const playlist = [photo("a"), photo("b")];
		expect(idlePhotoFor(playlist, 5, 1)?.id).toBe("a");
		expect(idlePhotoFor(playlist, 5, 2)).toBeNull();
		expect(idlePhotoFor([], 0, 0)).toBeNull();
	});
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
