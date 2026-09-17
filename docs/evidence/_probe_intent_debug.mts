/**
 * 临时调试：意图打分逐关键词核对（只读、无 DB）。
 * 用法：npx tsx docs/evidence/_probe_intent_debug.mts
 */
import { detectResearchIntent, splitQuestionClauses } from "../../server/researchEngine/planner/intent";
import { DEFAULT_RESEARCH_MODULE_REGISTRY } from "../../server/researchEngine/planner/moduleRegistry";

const qs = [
  "首板之后回踩，只要不跌破首板开盘价，后面的收益是不是更好？",
  "首板后回踩深度是否影响后续收益？回踩得深一点是不是更值得买入，还是回踩浅一点更好？",
];

for (const q of qs) {
  console.log("Q: " + q);
  console.log("clauses: " + JSON.stringify(splitQuestionClauses(q)));
  const r = detectResearchIntent(q);
  const lines = r.rankedModules.map(function (s) {
    return "   score=" + s.score + "  " + s.moduleKey + "  kw=[" + s.matchedKeywords.join(",") + "]";
  });
  console.log(lines.join("\n") || "   (no module matched)");
  console.log("   primary=" + r.primaryModuleKey + " fallback=" + r.fallbackApplied);
  console.log("");
}

console.log("PULLBACK keywords: " + DEFAULT_RESEARCH_MODULE_REGISTRY.require("PULLBACK_EFFECTIVENESS").keywords.join("|"));
console.log("EVENT keywords:    " + DEFAULT_RESEARCH_MODULE_REGISTRY.require("EVENT_RETURN_RESEARCH").keywords.join("|"));
console.log("ENTRY keywords:    " + DEFAULT_RESEARCH_MODULE_REGISTRY.require("ENTRY_TIMING_RESEARCH").keywords.join("|"));
console.log("HOLDING keywords:  " + DEFAULT_RESEARCH_MODULE_REGISTRY.require("HOLDING_PERIOD_RESEARCH").keywords.join("|"));
