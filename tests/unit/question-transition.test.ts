import { describe, expect, it } from "vitest";
import {
	QUESTION_ENTER_MS,
	QUESTION_LEAVE_MS,
	QUESTION_SHIFT_PX,
	type QuestionTransitionParams,
	questionDirectionOf,
	questionEnter,
	questionLeave,
	questionMotion,
} from "../../src/client/controller/question-transition.ts";

const node = {} as Element;
const params = (overrides: Partial<QuestionTransitionParams> = {}): QuestionTransitionParams => ({
	direction: 1,
	move: true,
	fade: true,
	reducedMotion: false,
	...overrides,
});

describe("質問の入れ替え", () => {
	it("次の質問は前の質問が消えてから現れる", () => {
		const enter = questionEnter(node, params());
		expect(enter.delay).toBe(QUESTION_LEAVE_MS);
		expect(enter.duration).toBe(QUESTION_ENTER_MS);
		expect(questionLeave(node, params()).duration).toBe(QUESTION_LEAVE_MS);
		expect(questionLeave(node, params()).delay).toBeUndefined();
	});

	it("進むときは右から入って左へ去り、戻るときは逆になる", () => {
		// Svelteは `css(t, u)` の `t` を、入るときは0から1へ、去るときは1から0へ進める。どちらも `t = 0` が画面の外側。
		expect(questionEnter(node, params()).css?.(0, 1)).toContain(`translate: ${QUESTION_SHIFT_PX.toFixed(2)}px 0;`);
		expect(questionLeave(node, params()).css?.(0, 1)).toContain(`translate: -${QUESTION_SHIFT_PX.toFixed(2)}px 0;`);
		expect(questionEnter(node, params({ direction: -1 })).css?.(0, 1)).toContain(
			`translate: -${QUESTION_SHIFT_PX.toFixed(2)}px 0;`,
		);
		expect(questionLeave(node, params({ direction: -1 })).css?.(0, 1)).toContain(
			`translate: ${QUESTION_SHIFT_PX.toFixed(2)}px 0;`,
		);
	});

	it("終わりの見た目は元の位置で不透明", () => {
		const css = questionEnter(node, params()).css?.(1, 0);
		expect(css).toContain("translate: 0.00px 0;");
		expect(css).toContain("opacity: 1.000;");
	});

	it("ずらさない、または透明度を変えない指定では、その値を書かない", () => {
		expect(questionEnter(node, params({ move: false })).css?.(0.5, 0.5)).toBe("opacity: 0.500;");
		expect(questionEnter(node, params({ fade: false })).css?.(0.5, 0.5)).not.toContain("opacity");
	});

	it("現れるのを待つ間は見えない入力に触れないよう隠し、動き始めたら表示する", () => {
		const enter = questionEnter(node, params());
		expect(enter.css?.(0, 1)).toContain("visibility: hidden;");
		expect(enter.css?.(0.01, 0.99)).not.toContain("visibility");
		expect(questionLeave(node, params()).css?.(0, 1)).not.toContain("visibility");
	});

	it("ずらさず透明度も変えない部分は、アニメーションを作らない", () => {
		const none = params({ move: false, fade: false });
		expect(questionEnter(node, none)).toEqual({ duration: 0 });
		expect(questionLeave(node, none)).toEqual({ duration: 0 });
	});

	it("reduced-motionでは時間をかけずに切り替える", () => {
		expect(questionEnter(node, params({ reducedMotion: true }))).toEqual({ duration: 0 });
		expect(questionLeave(node, params({ reducedMotion: true }))).toEqual({ duration: 0 });
	});
});

describe("質問の切り替えの向き", () => {
	it("後の質問へ移ると進む、前の質問へ移ると戻る", () => {
		expect(questionDirectionOf(0, 1)).toBe(1);
		expect(questionDirectionOf(3, 1)).toBe(-1);
	});

	it("質問の外から入る、質問の外へ出る、同じ質問のままのときは入れ替えない", () => {
		expect(questionDirectionOf(null, 0)).toBeNull();
		expect(questionDirectionOf(4, null)).toBeNull();
		expect(questionDirectionOf(2, 2)).toBeNull();
	});
});

describe("入れ替えで動かす部分", () => {
	it("スライダー以外は質問全体をずらしながら透明度を変え、質問文は質問全体と一緒に動く", () => {
		for (const kind of ["single", "multiple", "ranked", "map"] as const) {
			expect(questionMotion("body", kind, 1, false)).toMatchObject({ move: true, fade: true });
			expect(questionMotion("heading", kind, 1, false)).toMatchObject({ move: false, fade: false });
		}
	});

	it("スライダーは質問全体の透明度だけを変え、質問文だけをずらす", () => {
		expect(questionMotion("body", "slider", -1, false)).toEqual({
			direction: -1,
			move: false,
			fade: true,
			reducedMotion: false,
		});
		expect(questionMotion("heading", "slider", -1, false)).toMatchObject({ move: true, fade: false });
	});
});
