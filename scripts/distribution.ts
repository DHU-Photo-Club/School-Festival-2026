// 回答パターンごとの結果色の分布を表示する（仕様書6.3節の公開前集計）。
// スライダーと2Dマップは連続値のため、等しい幅の区間に分けて各区間の中点で数える。
import { RESULT_COLORS } from "../src/data/colors.ts";
import { QUESTIONS } from "../src/data/questions.ts";
import { DEFAULT_RESOLUTION } from "../src/shared/answer.ts";
import { answerPatternCount, resultDistribution } from "../src/shared/diagnosis.ts";

/** 全パターンを数える上限。これを超えると集計に時間がかかりすぎるため止める。 */
const MAX_PATTERNS = 50_000_000;

const patterns = answerPatternCount(QUESTIONS);
if (patterns > MAX_PATTERNS) {
	console.error(
		`集計する回答パターンが${patterns.toLocaleString()}通りあり、上限の${MAX_PATTERNS.toLocaleString()}通りを超えています。` +
			"src/shared/answer.ts の DEFAULT_RESOLUTION（スライダーと2Dマップの区切りの細かさ）、複数選択の選択肢の数や選択数の上限、問数を見直してください。",
	);
	process.exit(1);
}
const counts = resultDistribution(QUESTIONS, RESULT_COLORS);
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
console.log(
	`${total}通り（スライダーは${DEFAULT_RESOLUTION.slider}区間、2Dマップは${DEFAULT_RESOLUTION.map}×${DEFAULT_RESOLUTION.map}区間の中点）`,
);
for (const [colorId, count] of Object.entries(counts)) {
	console.log(`${colorId.padEnd(8)} ${String(count).padStart(6)}  ${((count / total) * 100).toFixed(2)}%`);
}
