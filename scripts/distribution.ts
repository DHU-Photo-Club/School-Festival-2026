// 全回答パターンの結果色の分布を表示する（仕様書6.3節の公開前集計）。
import { RESULT_COLORS } from '../src/data/colors.ts';
import { QUESTIONS } from '../src/data/questions.ts';
import { resultDistribution } from '../src/shared/diagnosis.ts';

const counts = resultDistribution(QUESTIONS, RESULT_COLORS);
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
console.log(`全${total}通り`);
for (const [colorId, count] of Object.entries(counts)) {
  console.log(`${colorId.padEnd(8)} ${String(count).padStart(6)}  ${((count / total) * 100).toFixed(2)}%`);
}
