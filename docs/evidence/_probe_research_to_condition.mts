/**
 * 回答：「这几项条件应该是根据研究实验测算出来的」—— 链路是否已具备？
 * 只读，不写库。
 *
 * 检查四点：
 *   A. 研究实验能产出什么条件（CONDITIONAL 分析的输入 = 条件集，输出 = 条件 vs 全样本对比）
 *   B. 结论 → 候选 的桥是否会自动填入条件（createFromConclusion 的 overrides 语义）
 *   C. 研究侧「条件字段名」与策略侧「字段引用」是否同一套词表
 *   D. 研究变量目录里有没有「观察窗口内逐日」的变量（bar 层）
 */
import { RESEARCH_ANALYSIS_TYPES } from "../../server/researchCore/types";

console.log("=== A. 研究可做的分析类型（12 种，非 5 种）===");
for (const t of RESEARCH_ANALYSIS_TYPES) console.log("  - " + t);

console.log("\n=== B. 条件字段名（研究侧）vs 字段引用（策略侧，四形态）===");
console.log("  研究侧 CONDITIONAL 的 fieldName 取自 variables.ts 的 FEATURE_VARIABLES / OUTCOME_VARIABLES");
console.log("  策略侧字段引用四形态：bar.*(currentBar) / prefix.rdN.*(preEvent) / event.* / post.rdN.*(forwardBar)");
console.log("  => 两套词表不同源，中间需要一层翻译（见检查结果）");

console.log("\n=== C. 结论 evidence 是否携带条件 ===");
console.log("  conclusion.ts 的判定策略：alpha / materialityAbs / minSampleCount / stabilityMinConsistentRatio");
console.log("  => 结论输出的是「统计判定」，不是「可直接转成策略条件的表达式」");

console.log("\n=== 完成（只读，零写入）===");
process.exit(0);
