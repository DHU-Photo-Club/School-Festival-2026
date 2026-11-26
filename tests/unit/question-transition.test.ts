import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	DESCEND_TARGETS,
	descendStep,
	isQuestionSwitch,
	QUESTION_ENTER_BLUR_PX,
	QUESTION_ENTER_DELAY_MS,
	QUESTION_ENTER_EASING,
	QUESTION_ENTER_FADE_MS,
	QUESTION_ENTER_MS,
	QUESTION_ENTER_SCALE,
	QUESTION_ENTER_TOTAL_MS,
	QUESTION_LEAVE_BLUR_PX,
	QUESTION_LEAVE_EASING,
	QUESTION_LEAVE_FADE_MS,
	QUESTION_LEAVE_MS,
	QUESTION_LEAVE_SCALE,
	QUESTION_LEAVE_TOTAL_MS,
	QUESTION_LOCK_MARGIN_MS,
	QUESTION_LOCK_MS,
	QUESTION_STAGGER_MAX,
	QUESTION_STAGGER_MS,
	QUESTION_TRANSITION_MS,
	questionLeave,
	questionMotionStyle,
} from "../../src/client/controller/question-transition.ts";

/** `setAttribute` で付けた属性だけを覚える、要素の代わり。 */
function fakeNode(): Element & { attributes: Record<string, string> } {
	const attributes: Record<string, string> = {};
	return { attributes, setAttribute: (name: string, value: string) => (attributes[name] = value) } as never;
}

describe("質問の入れ替え", () => {
	it("前の質問は、最後の要素が奥へ落ち終わるまで残り、質問全体には何も掛けない", () => {
		const node = fakeNode();
		const leave = questionLeave(node, { reducedMotion: false });
		// 前の質問の動きは、この属性で見分ける（Svelteの `inert` は、対応しないブラウザでは属性にならない）。
		expect(node.attributes["data-leaving"]).toBe("");
		expect(leave.duration).toBe(QUESTION_LEAVE_TOTAL_MS);
		expect(leave.delay).toBeUndefined();
		// 質問全体に `scale` や `filter` を掛けると、スライダーの操作面の基準が変わって縮む。
		expect(leave.css).toBeUndefined();
		expect(QUESTION_LEAVE_TOTAL_MS).toBe(QUESTION_STAGGER_MAX * QUESTION_STAGGER_MS + QUESTION_LEAVE_MS);
	});

	it("次の質問は前の質問がすべて落ちきってから降り始め、入れ替え全体は次の質問の最後の要素が降り終わるまで続く", () => {
		// 前の質問の最後の要素が落ち終わり、透明になるのと同時に降り始める。
		expect(QUESTION_ENTER_DELAY_MS).toBe(QUESTION_LEAVE_TOTAL_MS);
		// docs/visual-language.md 4.5節に書いた値。定数を変えたら、ドキュメントも合わせて直す。
		expect([QUESTION_ENTER_DELAY_MS, QUESTION_TRANSITION_MS, QUESTION_LOCK_MS]).toEqual([1660, 3320, 3420]);
		expect(QUESTION_LEAVE_TOTAL_MS).toBeGreaterThanOrEqual(
			QUESTION_STAGGER_MAX * QUESTION_STAGGER_MS + QUESTION_LEAVE_FADE_MS,
		);
		expect(QUESTION_ENTER_TOTAL_MS).toBe(
			QUESTION_ENTER_DELAY_MS + QUESTION_STAGGER_MAX * QUESTION_STAGGER_MS + QUESTION_ENTER_MS,
		);
		expect(QUESTION_TRANSITION_MS).toBe(Math.max(QUESTION_ENTER_TOTAL_MS, QUESTION_LEAVE_TOTAL_MS));
		// 見え始めと消え終わりは、それぞれ降りてくる動きと落ちていく動きの中で終わるため、ロックに収まる。
		expect(QUESTION_ENTER_FADE_MS).toBeLessThan(QUESTION_ENTER_MS);
		// 前の質問は、落ちる動きを最後まで見せながら透明になる。
		expect(QUESTION_LEAVE_FADE_MS).toBe(QUESTION_LEAVE_MS);
	});

	it("ボタンと質問の操作は、最後の要素が動き終わってから数フレームの余裕をおいて戻る", () => {
		const step = descendStep(Number.MAX_SAFE_INTEGER) * QUESTION_STAGGER_MS;
		const lastEnd = Math.max(QUESTION_ENTER_DELAY_MS + step + QUESTION_ENTER_MS, step + QUESTION_LEAVE_MS);
		expect(QUESTION_LOCK_MS).toBe(lastEnd + QUESTION_LOCK_MARGIN_MS);
		// 前の質問がDOMから消える前にロックが解けない。
		expect(QUESTION_LOCK_MS).toBeGreaterThan(QUESTION_LEAVE_TOTAL_MS);
		// 30fpsに落ちた端末の三フレーム分（約33ms × 3）以上。
		expect(QUESTION_LOCK_MARGIN_MS).toBeGreaterThanOrEqual(100);
	});

	it("要素ごとに順に遅れて降り、上限より後の要素は上限の要素と同時に降りる", () => {
		expect([0, 1, 2].map(descendStep)).toEqual([0, 1, 2]);
		expect(descendStep(QUESTION_STAGGER_MAX)).toBe(QUESTION_STAGGER_MAX);
		expect(descendStep(QUESTION_STAGGER_MAX + 3)).toBe(QUESTION_STAGGER_MAX);
	});

	it("降りる要素は質問文と各入力の部品で、質問全体やスライダーの外側の箱は含めない", () => {
		const targets = DESCEND_TARGETS.split(", ");
		expect(targets).toContain(".heading > *");
		expect(targets).toContain(".choices .option");
		expect(targets).toContain(".slider > .area > .handle");
		// `.slider` や `.body` を動かすと、画面全体に広がるスライダーの操作面の基準になって縮む。
		// 操作面（`.area`）そのものを拡大すると、画面からはみ出して画面が縦にスクロールできるようになる。
		expect(targets).not.toContain(".slider");
		expect(targets).not.toContain(".slider > .area");
		expect(targets.some((target) => target.startsWith(".body"))).toBe(false);
	});

	it("降り始めは手前にあるように大きく、ぼけている", () => {
		expect(QUESTION_ENTER_SCALE).toBeGreaterThan(1);
		expect(QUESTION_ENTER_BLUR_PX).toBeGreaterThan(0);
	});

	it("落ちきった前の質問は奥にあるように小さく、ぼけている", () => {
		expect(QUESTION_LEAVE_SCALE).toBeLessThan(1);
		expect(QUESTION_LEAVE_SCALE).toBeGreaterThan(0);
		expect(QUESTION_LEAVE_BLUR_PX).toBeGreaterThan(0);
	});

	it("動きの値をCSSのカスタムプロパティで渡す", () => {
		const style = questionMotionStyle();
		expect(style).toContain(`--motion-stagger: ${QUESTION_STAGGER_MS}ms`);
		expect(style).toContain(`--enter-delay: ${QUESTION_ENTER_DELAY_MS}ms`);
		expect(style).toContain(`--enter-easing: ${QUESTION_ENTER_EASING}`);
		expect(style).toContain(`--leave-easing: ${QUESTION_LEAVE_EASING}`);
		expect(style).toContain(`--enter-duration: ${QUESTION_ENTER_MS}ms`);
		expect(style).toContain(`--enter-fade: ${QUESTION_ENTER_FADE_MS}ms`);
		expect(style).toContain(`--enter-scale: ${QUESTION_ENTER_SCALE}`);
		expect(style).toContain(`--enter-blur: ${QUESTION_ENTER_BLUR_PX}px`);
		expect(style).toContain(`--leave-duration: ${QUESTION_LEAVE_MS}ms`);
		expect(style).toContain(`--leave-fade: ${QUESTION_LEAVE_FADE_MS}ms`);
		expect(style).toContain(`--leave-scale: ${QUESTION_LEAVE_SCALE}`);
		expect(style).toContain(`--leave-blur: ${QUESTION_LEAVE_BLUR_PX}px`);
	});

	it("前の質問は、落ちる動きも消える動きもイーズインで、次の質問はイーズアウトで動く", () => {
		const source = readFileSync(new URL("../../src/client/controller/Controller.svelte", import.meta.url), "utf8");
		expect(source).toMatch(/question-recede var\(--leave-duration\) var\(--leave-easing\)/);
		expect(source).toMatch(/question-vanish var\(--leave-fade\) var\(--leave-easing\)/);
		expect(source).toMatch(/question-descend var\(--enter-duration\) var\(--enter-easing\)/);
		expect(QUESTION_LEAVE_EASING).toBe("cubic-bezier(0.12, 0, 0.39, 0)");
	});

	it("渡したカスタムプロパティを、Controller.svelteのCSSがすべて使う", () => {
		// 名前が食い違うと、アニメーションの値が無効になって動きが止まる。
		const source = readFileSync(new URL("../../src/client/controller/Controller.svelte", import.meta.url), "utf8");
		const names = [...questionMotionStyle().matchAll(/(--[\w-]+):/g)].map((match) => match[1]);
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) expect(source).toContain(`var(${name})`);
	});

	it("reduced-motionでは時間をかけずに切り替える", () => {
		expect(questionLeave(fakeNode(), { reducedMotion: true })).toEqual({ duration: 0 });
	});
});

describe("質問の切り替えの判定", () => {
	it("質問から別の質問へ移るときだけ入れ替える", () => {
		expect(isQuestionSwitch(0, 1)).toBe(true);
		expect(isQuestionSwitch(3, 1)).toBe(true);
	});

	it("質問の外から入る、質問の外へ出る、同じ質問のままのときは入れ替えない", () => {
		expect(isQuestionSwitch(null, 0)).toBe(false);
		expect(isQuestionSwitch(4, null)).toBe(false);
		expect(isQuestionSwitch(2, 2)).toBe(false);
	});
});
