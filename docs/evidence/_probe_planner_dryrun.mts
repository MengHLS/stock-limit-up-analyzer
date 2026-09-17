/**
 * RESEARCH-PLANNER-001 — 计划生成验证探针（只读）。
 *
 * 验什么：
 *   1. 两个验收研究问题在真实 Dataset 上能否定位到正确的研究方法（§27 首板回踩 / §28 回踩深度）；
 *   2. 生成的计划是否**只含该数据集真的支持的变量**（§22）；
 *   3. §9 规模裁剪 / §10 优先级是否按预期工作；
 *   4. 未采纳分句是否被如实登记（不静默丢）。
 *
 * 用法：npx tsx docs/evidence/_probe_planner_dryrun.mts [datasetVersionId]
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";
import { DbDatasetRegistry } from "../../server/datasetRegistry/db";
import { RegistryResearchDatasetReader } from "../../server/researchEngine/datasetReader";
import { ResearchVariableCatalog } from "../../server/researchEngine/variables";
import {
  generateAnalysisPlan,
  MAX_REFINEMENT_RECIPES,
  rankRecipesByQuestion,
} from "../../server/researchEngine/planner/analysisPlan";
import { detectResearchIntent, describeIntent } from "../../server/researchEngine/planner/intent";
import { DEFAULT_RESEARCH_MODULE_REGISTRY } from "../../server/researchEngine/planner/moduleRegistry";
import { loadPlanDataFacts } from "../../server/researchPlannerRouter";

const out: string[] = [];
function say(line = "") {
  out.push(line);
}

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

// ---- Dataset 候选：默认取事件最多的那个 READY 版本 ----
const requested = process.argv[2] ? Number(process.argv[2]) : null;
const verRows = (await db.execute(
  sql`select v.id, v.version, v.status, d.datasetCode, v.startDate, v.endDate, v.totalEvents
      from dataset_version v join dataset_definition d on d.id = v.datasetId
      where v.status = 'READY'
      order by v.totalEvents desc limit 8`,
)) as unknown as [Array<Record<string, unknown>>];
const versions = verRows[0] ?? [];
say("=== [0] READY Dataset Version 候选（按事件数降序）===");
for (const r of versions) {
  say(`  id=${r["id"]} code=${r["datasetCode"]} v=${r["version"]} events=${r["totalEvents"]} ${r["startDate"]}..${r["endDate"]}`);
}
const target = requested ?? Number(versions[0]?.["id"]);
say(`\n>>> 使用 datasetVersionId = ${target}`);

// ---- 真实事实 ----
const reader = new RegistryResearchDatasetReader({ registryRepo: new DbDatasetRegistry() });
const facts = await loadPlanDataFacts(reader, target);
const ctx = await reader.getVersionContext(target);
say("\n=== [1] Dataset 真实事实（loadPlanDataFacts）===");
say(JSON.stringify(
  {
    datasetVersionId: facts.datasetVersionId,
    status: ctx?.status,
    startDate: ctx?.startDate,
    endDate: ctx?.endDate,
    totalEvents: ctx?.totalEvents,
    outcomeHorizons: facts.outcomeHorizons,
    pathHorizons: facts.pathHorizons,
    postRelativeDayRange: ctx?.postRelativeDayRange,
    observationMaxOffset: facts.observationMaxOffset,
    featureCount: facts.features.length,
    dimensions: facts.dimensions,
  },
  null,
  2,
));

// ---- 关键变量可用性直查（防「计划引用了不存在的变量」）----
const pathHorizons = facts.pathHorizons;
const postHorizons = ctx?.postRelativeDayRange
  ? Array.from(
      { length: ctx.postRelativeDayRange.max - Math.max(1, ctx.postRelativeDayRange.min) + 1 },
      (_, i) => Math.max(1, ctx.postRelativeDayRange!.min) + i,
    )
  : [];
const catalog = new ResearchVariableCatalog(facts.outcomeHorizons, pathHorizons, postHorizons);
say("\n=== [2] 关键变量可用性（新增口径 holds_event_open 必须为 true）===");
for (const name of [
  "pullback_holds_event_open_2d",
  "pullback_holds_event_open_3d",
  "pullback_holds_event_open_5d",
  "pullback_holds_event_low_3d",
  "pullback_min_volume_ratio_3d",
  "pullback_last_volume_ratio_3d",
  "pullback_last_is_bullish_3d",
  "pullback_close_ratio_3d",
  "obs_3d.return_from_event_close",
  "future_return_5d",
  "future_return_10d",
  "future_return_20d",
  "max_drawdown_5d",
  "segment_max_drawdown_0_3d",
  "segment_return_3_8d",
  "segment_max_drawdown_1_3d",
  "segment_return_4_8d",
  "turnover",
  "limit_up_premium",
  "market_cap",
  "pre_volatility_20d",
]) {
  const kind = catalog.hasFeature(name)
    ? "FEATURE"
    : catalog.hasOutcome(name)
      ? "OUTCOME"
      : catalog.hasObservation(name)
        ? "OBSERVATION"
        : "UNKNOWN";
  say(`  ${name.padEnd(34)} ${kind}`);
}

// ---- 两个验收问题 ----
const QUESTIONS = [
  "首板之后回踩，只要不跌破首板开盘价，后面的收益是不是更好？",
  "首板后回踩深度是否影响后续收益？回踩得深一点是不是更值得买入，还是回踩浅一点更好？",
];

for (const q of QUESTIONS) {
  say("\n" + "=".repeat(78));
  say(`研究问题：${q}`);
  say("=".repeat(78));
  const intent = detectResearchIntent(q, DEFAULT_RESEARCH_MODULE_REGISTRY);
  say(`主方法：${intent.primaryModuleKey}（${intent.primaryModule.label}） fallback=${intent.fallbackApplied}`);
  for (const line of describeIntent(intent)) say(`  · ${line}`);

  const g = generateAnalysisPlan({
    primary: intent.primaryModule,
    secondary: intent.rankedModules
      .filter((m) => m.moduleKey !== intent.primaryModuleKey)
      .map((m) => DEFAULT_RESEARCH_MODULE_REGISTRY.get(m.moduleKey))
      .filter((s): s is NonNullable<typeof s> => s !== undefined),
    facts,
    // 🔴 必须传 questionText：精修配方的排序只由它决定（§28「问深度 ⇒ 深度分档排前面」）。
    // 旧版探针漏传 ⇒ 排序恒等于注册顺序，于是「排序是否真的生效」这件事从来没被验过。
    questionText: q,
  });

  // 精修配方的最终采纳顺序（= 计划里 CONDITIONAL 精修项的生成顺序）。
  const ranked = rankRecipesByQuestion(intent.primaryModule.refinementRecipes, q);
  say(`\n精修配方排序（注册 ${intent.primaryModule.refinementRecipes.length} 条 → 排序后取前 ${MAX_REFINEMENT_RECIPES} 条）：`);
  ranked.forEach((r, i) => {
    const taken = i < MAX_REFINEMENT_RECIPES;
    say(`  ${taken ? "✓" : "✗"} [${String(i).padStart(2)}] ${r.id.padEnd(22)} ${r.label}`);
  });

  say(`\n生成的计划：${g.items.length} 条（上限 ${g.maxAnalysisPerPlan}，裁剪=${g.capApplied}），丢弃 ${g.dropped.length} 条`);
  for (const item of g.items) {
    const cond = (item.conditions ?? [])
      .map((c) => `${c.fieldName} ${c.operator} ${String(c.value)}`)
      .join(" 且 ");
    say(`  [${item.priority}]${item.required ? "*" : " "} ${item.analysisType.padEnd(16)} ${item.name}`);
    if (cond) say(`       条件: ${cond}`);
    say(`       目标: ${item.target ?? "-"}`);
  }
  if (g.dropped.length > 0) {
    say("\n  丢弃明细：");
    for (const d of g.dropped) say(`   - [${d.reason}] ${d.name} :: ${d.detail.slice(0, 120)}`);
  }
  say("\n  条件口径回执：");
  for (const r of g.conditionReadback) {
    say(`   · ${r.fieldName} ${r.operator} ${String(r.value)} ⇒ ${r.readback}`);
  }
}

// ---- §9 裁剪压力测试 ----
say("\n" + "=".repeat(78));
say("§9 裁剪压力测试：把上限压到 10，验证 P0 必需项永不丢弃");
const pullback = DEFAULT_RESEARCH_MODULE_REGISTRY.require("PULLBACK_EFFECTIVENESS");
const capped = generateAnalysisPlan({ primary: pullback, facts, maxAnalysisPerPlan: 10 });
const requiredKept = capped.items.filter((i) => i.required).length;
const requiredTotal = generateAnalysisPlan({ primary: pullback, facts }).items.filter((i) => i.required).length;
say(`  上限 10 ⇒ 保留 ${capped.items.length} 条（其中必需 ${requiredKept} 条 / 全量必需 ${requiredTotal} 条）`);
say(`  capApplied=${capped.capApplied}，被裁 ${capped.dropped.filter((d) => d.reason === "CAP_EXCEEDED").length} 条`);
say(`  保留项优先级分布：P0=${capped.items.filter((i) => i.priority === "P0").length} P1=${capped.items.filter((i) => i.priority === "P1").length} P2=${capped.items.filter((i) => i.priority === "P2").length}`);
say(`  必需项是否全部保留：${requiredKept === requiredTotal ? "✓ 是" : "✗ 否"}`);

const { writeFileSync } = await import("node:fs");
writeFileSync("docs/evidence/_probe_planner_dryrun.out.txt", out.join("\n"), "utf8");
console.log(out.join("\n"));
process.exit(0);
