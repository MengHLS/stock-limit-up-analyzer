/**
 * 分仓口径核对探针 —— 回答「现在到底在用哪种分仓」以及「同一个 1 笔计划，三种口径各是多少」。
 *
 * 为什么需要它：页面「下一交易日准备买入」在只入选 1 只时会显示 100%（占可用现金），
 * 容易被读成「算错」。本探针用**唯一权威实现** `server/positionBudget#allocatePlannedBudgets`
 * 喂真实运行时数字复算，证明 100% 是「等权」在该情形下的定义结果，而不是计算错误；
 * 同时给出等权 / 评分加权 / 固定单笔比例 三种口径的并列值，便于判断口径是否符合预期。
 *
 * 只读：不连库、不发请求、不写文件（除本探针自身 stdout）。
 * 运行：node_modules/.bin/tsx docs/evidence/_probe_position_sizing_caliber.mts
 */

import { allocatePlannedBudgets } from "../../server/positionBudget";
import type { PositionSizingStrategy } from "../../server/realisticBacktest";

/** 真实运行时快照（取自 `_probe_planned_position_render.out.txt` 的真机渲染数据）。 */
type StrategyCase = {
  key: string;
  label: string;
  /** 决策时点可用现金（= 该策略研究-legacy 模拟末点现金）。 */
  cash: number;
  /** 该策略回测截止日总权益。 */
  equity: number;
  /** 组合初始资金。 */
  initialCapital: number;
  /** 下一交易日准备买入清单（策略生效分）。 */
  planned: Array<{ name: string; strategyScore: number }>;
};

const CASES: StrategyCase[] = [
  { key: "baseline", label: "原始评分基准", cash: 460_838, equity: 462_635, initialCapital: 100_000, planned: [{ name: "华瓷股份", strategyScore: 67 }, { name: "澳弘电子", strategyScore: 66 }] },
  { key: "riskPenalty", label: "风险扣分策略", cash: 525_596, equity: 743_241, initialCapital: 100_000, planned: [{ name: "华瓷股份", strategyScore: 62.8 }] },
  { key: "hardFilter", label: "高风险硬过滤", cash: 321_574, equity: 453_752, initialCapital: 100_000, planned: [{ name: "华瓷股份", strategyScore: 67 }] },
  { key: "qualityBlend", label: "质量复合评分", cash: 524_172, equity: 746_693, initialCapital: 100_000, planned: [{ name: "华瓷股份", strategyScore: 67 }] },
  { key: "qualityGate", label: "质量门控策略", cash: 154_707, equity: 154_707, initialCapital: 100_000, planned: [{ name: "华瓷股份", strategyScore: 67 }] },
];

const CALIBERS: PositionSizingStrategy[] = ["equal", "scoreWeighted", "fixedPercent"];
const CALIBER_LABEL: Record<PositionSizingStrategy, string> = {
  equal: "等权分仓",
  scoreWeighted: "评分加权",
  fixedPercent: "固定单笔比例 20%",
};
const FIXED_PERCENT = 20;

const money = (value: number) => `¥${value.toFixed(0)}`;
const pct = (value: number) => `${value.toFixed(2)}%`;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` —— ${detail}` : ""}`);
};

console.log("分仓口径核对（唯一权威实现 = server/positionBudget#allocatePlannedBudgets）");
console.log("口径定义：等权 = 可用现金 ÷ 本批笔数；评分加权 = 可用现金 × 本笔分 ÷ 本批分合计；固定比例 = 初始资金 × 20%\n");

for (const item of CASES) {
  const planned = item.planned;
  console.log(`【${item.label}】可用现金 ${money(item.cash)} · 总权益 ${money(item.equity)} · 初始资金 ${money(item.initialCapital)} · 本批 ${planned.length} 笔`);
  for (const caliber of CALIBERS) {
    const budgets = allocatePlannedBudgets({
      strategy: caliber,
      cash: item.cash,
      initialCapital: item.initialCapital,
      fixedPositionPercent: FIXED_PERCENT,
      targets: planned.map((plan) => ({ score: plan.strategyScore })),
    });
    const rows = planned.map((plan, index) => {
      const budget = budgets[index] ?? 0;
      return `${plan.name} ${money(budget)}（占可用现金 ${pct((budget / item.cash) * 100)} · 占总权益 ${pct((budget / item.equity) * 100)}）`;
    });
    console.log(`    ${CALIBER_LABEL[caliber].padEnd(12, " ")} ${rows.join("  |  ")}`);
  }
  console.log("");
}

console.log("--- 断言 ---");
const single = CASES[1]!;
const equalSingle = allocatePlannedBudgets({ strategy: "equal", cash: single.cash, initialCapital: single.initialCapital, fixedPositionPercent: FIXED_PERCENT, targets: single.planned.map((plan) => ({ score: plan.strategyScore })) })[0]!;
check(
  "等权 · 当日仅 1 只入选 ⇒ 该笔吃掉全部可用现金（页面显示的 100% 即此）",
  Math.abs(equalSingle - single.cash) < 1e-6,
  `${money(equalSingle)} = 100.00% 可用现金 = ${pct((equalSingle / single.equity) * 100)} 总权益`,
);
const fixedSingle = allocatePlannedBudgets({ strategy: "fixedPercent", cash: single.cash, initialCapital: single.initialCapital, fixedPositionPercent: FIXED_PERCENT, targets: single.planned.map((plan) => ({ score: plan.strategyScore })) })[0]!;
check(
  "固定单笔比例 20% ⇒ 每笔恒为初始资金 × 20%（与权益增长脱钩）",
  Math.abs(fixedSingle - single.initialCapital * 0.2) < 1e-6,
  `${money(fixedSingle)} = 20% 初始资金，但仅 ${pct((fixedSingle / single.equity) * 100)} 当前权益`,
);
const weightedSingle = allocatePlannedBudgets({ strategy: "scoreWeighted", cash: single.cash, initialCapital: single.initialCapital, fixedPositionPercent: FIXED_PERCENT, targets: single.planned.map((plan) => ({ score: plan.strategyScore })) })[0]!;
check(
  "评分加权 · 单笔时合计分 = 本笔分 ⇒ 退化为满仓（与等权同值）",
  Math.abs(weightedSingle - single.cash) < 1e-6,
  money(weightedSingle),
);
const base = CASES[0]!;
const equalPair = allocatePlannedBudgets({ strategy: "equal", cash: base.cash, initialCapital: base.initialCapital, fixedPositionPercent: FIXED_PERCENT, targets: base.planned.map((plan) => ({ score: plan.strategyScore })) });
check(
  "等权 · 2 笔时各 1/2（合计 100.00% 可用现金）",
  Math.abs(equalPair[0]! - base.cash / 2) < 1e-6 && Math.abs(equalPair.reduce((a, b) => a + b, 0) - base.cash) < 1e-6,
  `${money(equalPair[0]!)} + ${money(equalPair[1]!)} = ${money(base.cash)}`,
);
const weightedPair = allocatePlannedBudgets({ strategy: "scoreWeighted", cash: base.cash, initialCapital: base.initialCapital, fixedPositionPercent: FIXED_PERCENT, targets: base.planned.map((plan) => ({ score: plan.strategyScore })) });
check(
  "评分加权 · 2 笔按分数比例（67:66）且合计仍为全部现金",
  Math.abs(weightedPair[0]! / base.cash - 67 / 133) < 1e-9,
  `${money(weightedPair[0]!)} : ${money(weightedPair[1]!)} = 67 : 66`,
);

console.log(`\n结论：${failures === 0 ? "全部断言通过" : `${failures} 条断言失败`}`);
console.log("等权在「当日仅 1 只入选」时必然等于满仓；这正是页面出现 100% 的唯一原因，非计算错误。");
process.exit(failures === 0 ? 0 : 1);
