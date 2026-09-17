/**
 * RESEARCH-PLANNER-001（§28）—— **第二研究问题复用验证**（Phase I）。
 *
 * 任务书 §31 Phase I 要求验证：换一个研究问题，系统能否**复用**同一套能力
 * （Event Study / Conditional / Quantile / Segment Relation / Stability / Finding / Conclusion）
 * 而不需要任何新的执行器、新的表、新的入口。
 *
 * 本探针用的是 §28 指定的第二验收案例：
 *
 *   「首板后回踩深度是否影响后续收益？回踩得深一点是不是更值得买入，还是回踩浅一点更好？」
 *
 * 与 §27 那个问题（「不跌破首板开盘价」）的三点关键差异：
 *
 *   ① 它问的是**程度**（深 vs 浅），不是**成立与否**——系统必须同时给出两档的分析，
 *      否则「深一点好还是浅一点好」根本无法回答；
 *   ② 它显式点出了「深度」这个词——精修配方的排序必须因此改变（§28 实测缺陷的修复点）；
 *   ③ 它走的是 §20 定义的**单次调用入口** `runFromQuestion`
 *      （入参只有 `{datasetVersionId, researchQuestion}`），而不是 §27 的两段式
 *      `createQuestion` + `runResearch` —— 顺带验证 Workbuddy 侧封装是通的。
 *
 * 全程真实 tRPC（`appRouter.createCaller`）→ 真实 TiDB，零 mock。
 * 用法：npx tsx docs/evidence/_e2e_research_second_question.mts
 */
import "dotenv/config";
import { appRouter } from "../../server/routers";
import { createDbResearchRepositories } from "../../server/researchCore";
import { createDefaultAnalysisExecutorRegistry } from "../../server/researchEngine/analyses/registry";
import {
  DEFAULT_RESEARCH_MODULE_REGISTRY,
} from "../../server/researchEngine/planner/moduleRegistry";
import { detectResearchIntent } from "../../server/researchEngine/planner/intent";
import {
  MAX_REFINEMENT_RECIPES,
  rankRecipesByQuestion,
} from "../../server/researchEngine/planner/analysisPlan";

const out: string[] = [];
function say(line = ""): void {
  out.push(line);
}
let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  say(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}
function section(title: string): void {
  say(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}
function j(v: unknown, max = 700): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s === undefined ? "undefined" : s.length > max ? `${s.slice(0, max)}…` : s;
}

// ---------------------------------------------------------------------------
// 用户输入：**只有两项**（§5 / §20）
// ---------------------------------------------------------------------------
const DATASET_VERSION_ID = 390002;
const QUESTION = "首板后回踩深度是否影响后续收益？回踩得深一点是不是更值得买入，还是回踩浅一点更好？";

/** §27 的 Run（来自 `_e2e_research_planner.out.txt`），用于「复用对照」。 */
const PRIOR_QUESTION_RUN_ID = 720001;

const adminUser = {
  id: 1,
  openId: "verify-research-planner-q2",
  name: "verify-research-planner-q2",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: adminUser });
const repos = createDbResearchRepositories();

section("[0] 用户输入（只有两项 —— 与 §27 完全同构，没有任何底层分析字段）");
say(`  datasetVersionId = ${DATASET_VERSION_ID}`);
say(`  researchQuestion = ${QUESTION}`);
say("  未传：feature / target / horizon / descriptiveVariable / segment / grouping / condition / analysisType");
say("  入口：researchPlanner.runFromQuestion（§20 Workbuddy 单次调用入口，同步长请求）");

// ---------------------------------------------------------------------------
// [1] §20 单次调用：runFromQuestion
// ---------------------------------------------------------------------------
section("[1] §20 runFromQuestion —— 单次调用返回 @20 约定的出参");
const t0 = Date.now();
const res = await caller.researchPlanner.runFromQuestion({
  datasetVersionId: DATASET_VERSION_ID,
  researchQuestion: QUESTION,
  generatedBy: "SYSTEM",
});
const ms = Date.now() - t0;

say(`  researchId     = ${res.researchId}`);
say(`  researchPlanId = ${res.researchPlanId}`);
say(`  researchRunId  = ${res.researchRunId}`);
say(`  questionId     = ${res.questionId}`);
say(`  analysisCount  = ${res.analysisCount}`);
say(`  findings       = ${res.findings.length} 条（Total ${res.findingsTotal}）`);
say(`  conclusion     = ${res.conclusion?.conclusionType ?? "（无）"}`);
say(`  单次调用总耗时 = ${(ms / 1000).toFixed(1)}s`);

check("§20 出参含 researchId", typeof res.researchId === "number" && res.researchId > 0, String(res.researchId));
check("§20 出参含 researchPlanId", typeof res.researchPlanId === "number" && res.researchPlanId > 0, String(res.researchPlanId));
check("§20 出参含 analysisCount", typeof res.analysisCount === "number" && res.analysisCount > 0, String(res.analysisCount));
check("§20 出参含 findings 数组", Array.isArray(res.findings));
check("§20 出参含 conclusion", res.conclusion !== null && res.conclusion !== undefined);

const outcome = res.outcome;
const view = outcome;

// ---------------------------------------------------------------------------
// [2] 意图识别：同一个 Dataset，不同问题 ⇒ 侧重不同（§5）
// ---------------------------------------------------------------------------
section("[2] 意图识别复核（系统自己判定「问的是什么」）");
const intent = detectResearchIntent(QUESTION, DEFAULT_RESEARCH_MODULE_REGISTRY);
say(`  主方法      = ${intent.primaryModuleKey}（${intent.primaryModule.label}）  fallback=${intent.fallbackApplied}`);
say(`  研究类型    = ${intent.researchType}`);
say(`  回落基线    = ${intent.fallbackApplied ? "是（零命中）" : "否"}`);
say(`  命中分句（分句 → 关键词 → 方法）：`);
for (const c of intent.evidence.matchedClauses) say(`    · 「${c.clause}」 命中「${c.keyword}」 → ${c.moduleKeys.join(" / ")}`);
say(`  已登记关键词命中：${intent.evidence.keywordHits.filter((k) => k.matched).map((k) => `${k.moduleKey}:${k.keyword}`).join(" / ") || "（无）"}`);
say(`  未命中关键词（用于解释「为什么没选某方法」）：${intent.evidence.keywordHits.filter((k) => !k.matched).map((k) => `${k.moduleKey}:${k.keyword}`).join(" / ") || "（无）"}`);
say(`  未采纳分句：${intent.evidence.unresolvedClauses.length > 0 ? intent.evidence.unresolvedClauses.join(" ¶ ") : "（无）"}`);

check("§5 与 §27 同 Dataset 但问题不同 ⇒ 仍识别为 PULLBACK_EFFECTIVENESS", intent.primaryModuleKey === "PULLBACK_EFFECTIVENESS", intent.primaryModuleKey);
check("§5 未回落基线（关键词真的命中了，不是兜底）", intent.fallbackApplied === false);

// ---------------------------------------------------------------------------
// [3] §28 核心：计划里必须**同时**有「深」和「浅」两档深度分档
// ---------------------------------------------------------------------------
section("[3] §28 核心判据：计划里同时存在「深档」与「浅档」深度分档");
const planId = res.researchPlanId!;
const planRead = await caller.researchPlanner.getPlan({ planId });
const planItems = planRead.plan.items;

const depthItems = planItems.filter((i) => (i.conditions ?? []).some((c) => /^pullback_close_ratio_\d+d$/.test(c.fieldName)));
/** 深档 = 上界 0.95 的「<=」；浅档 = 下界 0.98 的「>=」。 */
const deepItems = depthItems.filter((i) => (i.conditions ?? []).some((c) => /^pullback_close_ratio_\d+d$/.test(c.fieldName) && String(c.value) === "0.95"));
const shallowItems = depthItems.filter((i) => (i.conditions ?? []).some((c) => /^pullback_close_ratio_\d+d$/.test(c.fieldName) && String(c.value) === "0.98"));

say(`  计划条数 = ${planRead.preview.plannedCount}（上限 ${planRead.preview.maxAnalysisPerPlan}，裁剪=${planRead.preview.capApplied}）`);
say(`  优先级分布：P0 ${planRead.preview.coreCount} / P1 ${planRead.preview.auxiliaryCount} / P2 ${planRead.preview.exploratoryCount}`);
say(`\n  含「回踩深度」条件的分析共 ${depthItems.length} 条：`);
for (const i of depthItems) {
  const cond = (i.conditions ?? []).map((c) => `${c.fieldName} ${c.operator} ${String(c.value)}`).join(" 且 ");
  say(`    [${i.priority}] ${i.name}`);
  say(`        条件：${cond}`);
}
say(`\n  ⇒ 深档（close_ratio <= 0.95）${deepItems.length} 条 / 浅档（close_ratio >= 0.98）${shallowItems.length} 条`);

check("§28 计划里存在「深档」深度分档分析", deepItems.length > 0, `deep=${deepItems.length}`);
check("§28 计划里存在「浅档」深度分档分析", shallowItems.length > 0, `shallow=${shallowItems.length}`);
check("§28 深档与浅档都在同一个 Dataset 上可比（各 ≥ 1 条）", deepItems.length >= 1 && shallowItems.length >= 1);

const rankedRefinements = rankRecipesByQuestion(
  intent.primaryModule.refinementRecipes,
  QUESTION,
).slice(0, MAX_REFINEMENT_RECIPES);
say(`\n  精修配方最终采纳顺序（上限 ${MAX_REFINEMENT_RECIPES} 条）：`);
rankedRefinements.forEach((r, i) => say(`    ${i + 1}. ${r.id.padEnd(22)} ${r.label}`));

/**
 * 🔴 §28 的缺陷修复判据。
 *
 * 修复前：`slice(0, 6)` 在排序**之前**执行，深度分档注册在第 6/7/8 位 ⇒
 *        只有 `depth_shallow` 进得来，`depth_deep` 永远出局，
 *        「回踩深一点是不是更值得买入」这个问题**无法被回答**。
 * 修复后：先排序（强调词命中的配方加权），再裁剪 ⇒ 深度分档排到第 1、2 位。
 */
const adoptedDepthIds = rankedRefinements.filter((r) => r.id.startsWith("depth_")).map((r) => r.id);
check(
  "§28 排序生效：深度分档位于精修序列的第 1 位（修复前它在末位且被裁掉）",
  rankedRefinements[0]?.id.startsWith("depth_") === true,
  `第 1 位 = ${rankedRefinements[0]?.id ?? "（空）"}`,
);
check(
  "§28 深档与浅档同时被采纳（都落在精修上限之内）",
  adoptedDepthIds.length >= 2,
  adoptedDepthIds.join(" / ") || "（无）",
);

say(`\n  落库的 selectionRationale（用户可核对系统为什么这么理解）：`);
for (const line of planRead.plan.notes?.selectionRationale ?? []) say(`    · ${line}`);

// ---------------------------------------------------------------------------
// [4] 复用证据（§31 Phase I 的「复用」判据）
// ---------------------------------------------------------------------------
section("[4] 复用证据：没有第二套统计实现、没有新执行器、没有新入口");
const registry = createDefaultAnalysisExecutorRegistry();
const registeredTypes = registry.listTypes();
const EXPECTED_RESEARCH_002_TYPES = ["CONDITIONAL", "DESCRIPTIVE", "EVENT_STUDY", "QUANTILE", "SEGMENT_RELATION", "STABILITY"];

say(`  执行器注册表里的分析类型（${registeredTypes.length} 个）：`);
for (const t of registeredTypes) say(`    · ${t}`);
check(
  "复用①：执行器集合 = RESEARCH-002 原样的 6 类（PLANNER-001 未新增执行器）",
  JSON.stringify(registeredTypes) === JSON.stringify(EXPECTED_RESEARCH_002_TYPES),
  registeredTypes.join("/"),
);

const planTypes = [...new Set(planItems.map((i) => i.analysisType))].sort();
const unregistered = planTypes.filter((t) => !registeredTypes.includes(t as never));
say(`\n  本计划用到的分析类型（${planTypes.length} 类）：${planTypes.join(" / ")}`);
say(`  其中未注册的：${unregistered.length === 0 ? "（无）" : unregistered.join(" / ")}`);
check("复用②：计划只用到已注册的执行器（无 UNKNOWN_ANALYSIS_TYPE）", unregistered.length === 0, unregistered.join("/"));

/** §27 那一轮 Run 用到的分析类型（用于「两问共用同一批能力」的对照）。 */
const priorAnalyses = await repos.analyses.list({ runId: PRIOR_QUESTION_RUN_ID });
const priorTypes = [...new Set(priorAnalyses.map((a) => a.analysisType))].sort();
if (priorAnalyses.length === 0) {
  say(`\n  ⚠️ 跳过「与 §27 对照」：Run ${PRIOR_QUESTION_RUN_ID} 在库里查不到分析（可能已被清理）。`);
} else {
  const shared = planTypes.filter((t) => priorTypes.includes(t as never));
  say(`\n  §27 那一轮（Run ${PRIOR_QUESTION_RUN_ID}，${priorAnalyses.length} 条分析）用到的类型：${priorTypes.join(" / ")}`);
  say(`  两问共用的执行器：${shared.join(" / ") || "（无）"}`);
  check("复用③：两个验收问题共用同一批执行器（不是各写一套）", shared.length > 0, `shared=${shared.length}`);
}

// ---------------------------------------------------------------------------
// [5] 真实执行
// ---------------------------------------------------------------------------
section("[5] 真实执行（物化 → 逐条执行 → Finding → Conclusion）");
say(`  runId=${outcome.runId} runStatus=${outcome.runStatus} 冻结样本数=${outcome.sampleCount}`);
say(`  完成 ${outcome.completedCount} / 失败 ${outcome.failedCount} / 未完成 ${outcome.pendingCount}（共 ${outcome.analysisCount}）`);
say(`  结果行合计 ${outcome.analyses.reduce((s, a) => s + a.resultCount, 0)}`);
check("§23 执行已收尾（无未完成项）", outcome.pendingCount === 0, `pending=${outcome.pendingCount}`);
check("零失败", outcome.failedCount === 0, `failed=${outcome.failedCount}`);
check("执行条数 = 计划条数（预览即所跑）", outcome.analysisCount === planRead.preview.plannedCount, `${outcome.analysisCount} vs ${planRead.preview.plannedCount}`);

const emptyResultIds = outcome.analyses.filter((a) => a.status === "COMPLETED" && a.resultCount === 0).map((a) => a.analysisId);
say(`  零结果分析：${emptyResultIds.length === 0 ? "无" : emptyResultIds.map((id) => `#${id}`).join(", ")}`);
say(`  §22 数据有效性：passed=${outcome.dataValidity.passed} 失败=${outcome.dataValidity.failedCount} 未完成=${outcome.dataValidity.pendingCount} 零结果=${outcome.dataValidity.emptyResultCount}`);
for (const n of outcome.dataValidity.notes) say(`    · ${n}`);
check(
  "§22 passed 与三个缺口维度自洽",
  outcome.dataValidity.passed ===
    (outcome.dataValidity.failedCount === 0 && outcome.dataValidity.pendingCount === 0 && outcome.dataValidity.emptyResultCount === 0),
  `passed=${outcome.dataValidity.passed}`,
);

// ---------------------------------------------------------------------------
// [6] 两个方向的证据：深档与浅档都真的产出了结果
// ---------------------------------------------------------------------------
section("[6] §28 两个方向的证据（深档 / 浅档都必须有可读数字）");
/** 名字 → 分析 id（计划项与分析是按**名字**对应的；不要用 sortOrder 猜）。 */
const analysisIdByName = new Map(outcome.analyses.map((a) => [a.name, a.analysisId]));
const depthAnalysisIds = new Set(
  depthItems.map((i) => analysisIdByName.get(i.name)).filter((x): x is number => x !== undefined),
);
/** 从计划项的条件里判出这一条属于深档还是浅档。 */
function depthSideOf(item: { conditions?: ReadonlyArray<{ fieldName: string; value: unknown }> }): "deep" | "shallow" | "none" {
  for (const c of item.conditions ?? []) {
    if (!/^pullback_close_ratio_\d+d$/.test(c.fieldName)) continue;
    if (String(c.value) === "0.95") return "deep";
    if (String(c.value) === "0.98") return "shallow";
  }
  return "none";
}
let deepWithResult = 0;
let shallowWithResult = 0;
let depthMissing = 0;
for (const item of depthItems) {
  const a = outcome.analyses.find((x) => x.name === item.name);
  const side = depthSideOf(item);
  if (a === undefined) {
    depthMissing += 1;
    say(`    ? ${side} 档「${item.name}」在 Run 里找不到同名分析`);
    continue;
  }
  if (side === "deep" && a.resultCount > 0) deepWithResult += 1;
  if (side === "shallow" && a.resultCount > 0) shallowWithResult += 1;
  say(`    ${a.status === "COMPLETED" ? "✓" : "✗"} ${side.padEnd(7)} 结果 ${String(a.resultCount).padStart(3)} 行  #${a.analysisId} ${item.name}`);
}
say("");
check("§28 深档分析全部落了库并跑出结果（否则「深一点好不好」无从判断）", deepWithResult === deepItems.length && deepItems.length > 0, `${deepWithResult}/${deepItems.length}`);
check("§28 浅档分析全部落了库并跑出结果", shallowWithResult === shallowItems.length && shallowItems.length > 0, `${shallowWithResult}/${shallowItems.length}`);
check("§28 计划项与落库分析一一对应（无丢失）", depthMissing === 0, `missing=${depthMissing}`);

/**
 * 深档 vs 浅档：把两个方向的 T+5 收益摆在一起。
 *
 * 🔴 取值必须走 **Finding 层**（`effect.groupReturn / benchmarkReturn / sampleCount`），
 *    不能直接从 `research_result` 里按 `metricCode` 抓第一行 —— 实测踩过：
 *    分组行与基准行的 `resultType` **同为 `GROUPED`**、`dimensionJson` 同为 null，
 *    仅靠**行序**区分（前 5 行 = 全样本基准，后 5 行 = 条件组）。
 *    按 metricCode 抓第一行必然抓到基准行，于是四条分析打印出来的数字**全都一样**，
 *    看上去像「条件没生效」—— 那是读数方式错了，不是执行错了。
 */
const runFindings = await repos.findings.list({ runId: outcome.runId! });
function effectOf(analysisId: number): Record<string, unknown> | null {
  const f = runFindings.find((x) => x.primaryAnalysisId === analysisId);
  const eff = f?.effect as Record<string, unknown> | undefined;
  return eff ?? null;
}
say("  深档 / 浅档 的 T+5 收益对照（同一 Dataset、同一求值日口径；数值取自 Finding 层）：");
for (const [side, arr] of [["deep", deepItems], ["shallow", shallowItems]] as const) {
  for (const item of arr) {
    const a = outcome.analyses.find((x) => x.name === item.name);
    if (a === undefined) continue;
    const eff = effectOf(a.analysisId);
    const pp = (v: unknown): string =>
      typeof v === "number" ? `${(v * 100).toFixed(2)} 个百分点` : "不可用";
    say(`    ${side.padEnd(7)} ${item.name.replace(" → T+5 收益", "")}`);
    say(`        条件组收益 ${pp(eff?.["groupReturn"])}   全样本基准 ${pp(eff?.["benchmarkReturn"])}   超额 ${pp(eff?.["excessReturn"])}`);
    const buckets = eff?.["buckets"];
    if (Array.isArray(buckets)) {
      for (const b of buckets as Array<Record<string, unknown>>) {
        say(`          · 组「${b["label"]}」 n=${b["sampleCount"]}  均值 ${pp(b["metricValue"])}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// [7] Finding / 结论 / 建议（§12–§15）
// ---------------------------------------------------------------------------
section("[7] Finding 聚合 → 结论 → 建议");
say(`  问题：${view.questionText}`);
say(`  研究方法：${view.moduleKeys.join(" / ")}`);
say(`  Finding：共 ${view.findingsTotal} 条，去重合并 ${view.dedupedCount} 条，默认展示 ${view.topFindings.length} 条（折叠 ${view.hiddenFindingCount} 条）`);
check("§12–§14 Finding 已聚合且默认只展示 Top N", view.findingsTotal > 0 && view.topFindings.length > 0 && view.topFindings.length <= view.findingsTotal, `${view.findingsTotal} → ${view.topFindings.length}`);

say(`\n--- Top Findings ---`);
for (const f of view.topFindings) {
  const isDepth = f.primaryAnalysisId !== null && depthAnalysisIds.has(f.primaryAnalysisId);
  say(`\n  ── #${f.findingId} [${f.findingType}] 强度 ${f.researchStrength ?? "-"}（${f.researchStrengthGrade ?? "-"}）${isDepth ? "  ★ 来自深度分档分析" : ""}`);
  say(`     标题：${f.title}`);
  say(`     来自分析 #${f.primaryAnalysisId}（${f.analysisType}）「${f.analysisName}」`);
  say(`     样本：n=${f.sampleCount ?? "-"}（${f.sampleGrade ?? "-"}）  视界 T+${f.horizon ?? "?"}`);
  say(`     效果：${j(f.effect, 400)}`);
}
say(`\n--- 提问锚点（§13 / §15 / §28）---`);
say(`  source        = ${view.questionAlignment.source}`);
say(`  note          = ${view.questionAlignment.note}`);
say(`  候选分析条数  = ${view.questionAlignment.analysisCount}`);
say(`  相关 Finding  = ${view.questionAlignedFindings.length} 条`);
for (const f of view.questionAlignedFindings) {
  say(`    · #${f.findingId} ${f.title}`);
  say(`        来自 #${f.primaryAnalysisId}（${f.analysisType}）「${f.analysisName}」  n=${f.sampleCount ?? "-"}`);
}
/**
 * 🔴 Phase I 的核心判据：**用户问的那件事必须在结论页上可读**。
 *
 * 修复前的实测：深度分档的 Finding 确实存在（第 6 / 7 名），但既不在按
 * `researchStrength` 排序的 Top 8 里，也不被结论正文引用 —— 用户在自己的
 * 问题页上读不到答案。因此这里断言的不是「排进 Top 8」，而是
 * 「提问锚点确实锁定了深度分档、且这些证据被单独列出」。
 */
const alignedAnalysisIds = new Set(view.questionAlignedFindings.map((f) => f.primaryAnalysisId));
const alignedDepthCount = depthItems.filter((i) => {
  const id = analysisIdByName.get(i.name);
  return id !== undefined && alignedAnalysisIds.has(id);
}).length;
check(
  "§28 提问锚点锁定的是「强调词命中的分析」（source=EMPHASIS，不是回落）",
  view.questionAlignment.source === "EMPHASIS",
  view.questionAlignment.source,
);
check(
  "§28 深度分档的证据被列进「针对你的问题」区块（用户不必翻折叠区）",
  alignedDepthCount > 0,
  `alignedDepth=${alignedDepthCount} / alignedTotal=${view.questionAlignedFindings.length}`,
);

say(`\n--- §15 结论 ---`);
say(j(view.conclusion, 1800));
check("§15 结论已生成", view.conclusion !== null && view.conclusion !== undefined);
check("§15 结论锚定了研究问题（researchQuestion 非空且为原文）", view.conclusion?.researchQuestion === QUESTION, String(view.conclusion?.researchQuestion));
check("§15 结论正文含「【研究问题】」段（视图层拼装生效）", (view.conclusion?.conclusion ?? "").includes("【研究问题】"));
const conclusionText = view.conclusion?.conclusion ?? "";
check("§15 结论正文含「【针对该问题】」段（显式回答用户问的事）", conclusionText.includes("【针对该问题】"));
check(
  "§15 结论正文不再出现占位符「(未登记假设陈述)」（假设已注册，结论锚定问题原文）",
  !conclusionText.includes("(未登记假设陈述)") && conclusionText.includes("【统计判定】"),
);

say(`\n--- §15 建议（只能表示「是否值得进入下一研究阶段」）---`);
say(`  stage = ${view.recommendation.stage}`);
say(`  text  = ${view.recommendation.text}`);
for (const r of view.recommendation.reasons) say(`    · ${r}`);
say(`  免责声明：${view.recommendation.disclaimer}`);
const recText = `${view.recommendation.text} ${view.recommendation.reasons.join(" ")}`;
check("§15 建议不含「稳赚 / 必涨 / 保证收益 / 一定盈利」类断言", !/稳赚|必涨|保证收益|一定盈利/.test(recText));
check("§15 建议附独立免责声明字段", typeof view.recommendation.disclaimer === "string" && view.recommendation.disclaimer.length > 0);
check("§15 结论正文已拼接免责声明（withDisclaimer 生效）", (view.conclusion?.conclusion ?? "").includes(view.recommendation.disclaimer));

// ---------------------------------------------------------------------------
// [8] §16 Candidate（仍然必须人工确认）
// ---------------------------------------------------------------------------
section("[8] §16 createCandidate（研究 → 候选，状态仍为 DRAFT）");
const coreGuard = outcome.analyses.find((a) => a.priority === "P0" && a.analysisType === "CONDITIONAL")
  ?? outcome.analyses.find((a) => a.analysisType === "CONDITIONAL");
let candidateId: number | null = null;
if (coreGuard !== undefined) {
  const c = await caller.researchPlanner.createCandidate({
    questionId: res.questionId!,
    name: "[E2E-Q2] 首板回踩深度分档",
    description: `第二个验收问题（§28）自动规划并执行的候选。planId=${planId}。${QUESTION}`,
    deriveFilterFromAnalysisId: coreGuard.analysisId,
  });
  candidateId = c.candidate.id ?? null;
  say(`  candidateId = ${candidateId} status=${c.candidate.status}`);
  say(`  provenance  = ${j(c.provenance, 400)}`);
  say(`  filterRule  = ${j(c.candidate.filterRule, 500)}`);
  check("§16 provenance 六项齐备", c.provenance.complete === true);
  check("§16 候选状态为 DRAFT（不自动进 Strategy）", c.candidate.status === "DRAFT", c.candidate.status);
  check("§16 sourceResearchPlanId 指向本轮计划", c.candidate.sourceResearchPlanId === planId, `${c.candidate.sourceResearchPlanId} vs ${planId}`);
}

// ---------------------------------------------------------------------------
// [9] §28 验收判据汇总
// ---------------------------------------------------------------------------
section("[9] §28 验收判据");
say(`  ① 输入只有 datasetVersionId + researchQuestion：✓（runFromQuestion 的全部入参）`);
say(`  ② 系统识别为：${intent.primaryModuleKey}（用户未填 Feature/Target/Horizon/Descriptive/Segment）`);
say(`  ③ 计划由系统生成：${planRead.preview.plannedCount} 条（P0 ${planRead.preview.coreCount} / P1 ${planRead.preview.auxiliaryCount} / P2 ${planRead.preview.exploratoryCount}）`);
say(`  ④ 「深 vs 浅」两档都在计划里：深档 ${deepItems.length} 条 / 浅档 ${shallowItems.length} 条`);
say(`  ⑤ 分析真实执行：完成 ${outcome.completedCount} / ${outcome.analysisCount}，结果行合计 ${outcome.analyses.reduce((s, a) => s + a.resultCount, 0)}`);
say(`  ⑥ Finding 聚合：${view.findingsTotal} 条 → 默认展示 ${view.topFindings.length} 条（其中「针对你的问题」${view.questionAlignedFindings.length} 条，深度分档 ${alignedDepthCount} 条）`);
say(`  ⑦ 结论已生成：${view.conclusion?.conclusionType ?? "（无）"}；建议阶段：${view.recommendation.stage}`);
say(`  ⑧ Candidate 可创建且带全套 provenance：${candidateId !== null ? `✓ #${candidateId}` : "✗"}`);
say(`  ⑨ 复用：执行器仍为 RESEARCH-002 的 ${registeredTypes.length} 类，未新增任何执行器 / 表 / 入口`);

say(`\n${"=".repeat(78)}`);
say(`检查项：${checks}  失败：${failures}`);
say(failures === 0 ? "结论：✓ 第二问题（§28 回踩深度）E2E 全部通过" : `结论：✗ 有 ${failures} 项未通过`);
say(`${"=".repeat(78)}`);

const { writeFileSync } = await import("node:fs");
// 🔴 落盘必须在**所有** say 之后：上一版把 writeFileSync 写在汇总行之前，
//    于是 out.txt 里读不到「检查项 / 失败 / 结论」——证据文件自己不自洽。
writeFileSync("docs/evidence/_e2e_research_second_question.out.txt", out.join("\n"), "utf8");
console.log(out.join("\n"));
process.exit(failures === 0 ? 0 : 2);
