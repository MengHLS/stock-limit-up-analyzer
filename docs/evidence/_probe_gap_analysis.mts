/**
 * 方案设计用探针：把「研究测算条件 → 策略条件」链路的三处缺口钉死在代码坐标上。
 * 只读，不写库，不改任何生产代码。
 */
import { RESEARCH_ANALYSIS_TYPES } from "../../server/researchCore/types";
import { FEATURE_VARIABLES } from "../../server/researchEngine/variables";
import { resolveSignalTimeline } from "../../server/research/strategySchema/definition";

const IMPLEMENTED = ["DESCRIPTIVE", "EVENT_STUDY", "QUANTILE", "CONDITIONAL", "STABILITY", "SEGMENT_RELATION"];

console.log("=== 缺口 0: 声明 vs 实现 ===");
const declared = [...RESEARCH_ANALYSIS_TYPES];
const missing = declared.filter((t) => !IMPLEMENTED.includes(t));
console.log("  声明 " + declared.length + " 种 / 已实现 " + IMPLEMENTED.length + " 种");
console.log("  未实现: " + missing.join(" / "));

console.log("\n=== 缺口 A: 研究侧变量能否覆盖「观察日」 ===");
const featNames = Object.keys(FEATURE_VARIABLES);
console.log("  FEATURE 变量数 = " + featNames.length + "（全部只读 event + prefix，即 <= T）");
for (const f of featNames) {
  const def: any = (FEATURE_VARIABLES as any)[f];
  const days = def.prefixRelativeDays ? "prefix rd=" + JSON.stringify(def.prefixRelativeDays) : "(event 列)";
  console.log("    " + f.padEnd(28) + days);
}
const outNames = ["future_return_{h}d", "high_return_{h}d", "low_return_{h}d", "volume_ratio_{h}d",
  "pullback_from_event_high_{h}d", "max_return_{h}d", "min_return_{h}d", "max_drawdown_{h}d",
  "is_breakout_{h}d", "days_to_breakout_{h}d", "holds_event_low_{h}d", "event_low_margin_{h}d",
  "window_stat_{kind}_{from}_{to}"];
console.log("  OUTCOME 变量族 = " + outNames.length + " 族（只读 path + outcome，即 >= T+1；h 取 5/10/20）");
console.log("  🔴 观察日（T+1..T+5 中间某一天）的「当日 bar 属性」变量数 = 0");

console.log("\n=== 缺口 B: 结论 -> 候选 是否自动填条件 ===");
console.log("  createFromConclusion 的 5 个草图列只来自可选 input.overrides");
console.log("  => 不传 overrides 时草图为空；结论 evidence 只带统计判定");

console.log("\n=== 缺口 C: 策略侧 bar.* 在观察日能引用什么 ===");
const t = resolveSignalTimeline("FIRST_VALID_DAY", { start: 1, end: 5, unit: "TRADING_DAY" });
console.log("  window 1..5 + FIRST_VALID_DAY => 最早信号 T+" + t.earliestSignalOffset);
console.log("  bar.* 可引用: low/high/open/close/volume/amount（当日无前视）");
console.log("  prefix.rd0.* 可引用: 事件日属性（基准线）");

console.log("\n=== 结论 ===");
console.log("  研究能力(6种) + 事件日属性变量(" + featNames.length + ") 已具备");
console.log("  缺: 观察日变量 + 词表映射 + 自动填充，三件独立的事");

process.exit(0);
