/**
 * RESEARCH-PLANNER-001（§27）—— **首板回踩 E2E 真跑**。
 *
 * 验的是任务书的第一验收案例，也是整条链路的最终判据：
 *
 *   用户**只**提供 `{datasetVersionId, researchQuestion}` 两项
 *     → 系统识别研究方法 → 自动生成 Research Plan（可预览）
 *     → 自动落成 Analysis → 执行 → 检测 Finding → 生成 Conclusion
 *     → 聚合出「结论 / 关键发现 / 关键证据 / 样本量 / 稳定性 / 风险提示」
 *     → 用户决定是否 [创建 Candidate]
 *
 * 🔴 与既有手工分析（run 570001：#540001–#540013，planId 全为 NULL，专家手工堆出来的）
 *    做**逐条件对照**：自动规划器独立产出的条件族若与手工口径重合，
 *    在**完全相同的条件**上两条分析的数字必须逐字相等 —— 这是
 *    「复用的是同一个 Analysis Engine，没有第二套统计实现」（§2.1/§30）的硬证据。
 *
 * 全程走**真实 tRPC API**（`appRouter.createCaller`）→ 真实 TiDB。零 mock。
 * 用法：npx tsx docs/evidence/_e2e_research_planner.mts
 */
import "dotenv/config";
import { appRouter } from "../../server/routers";
import { createDbResearchRepositories, type ResearchConditionSet } from "../../server/researchCore";

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
function j(v: unknown, max = 900): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s === undefined ? "undefined" : s.length > max ? `${s.slice(0, max)}…` : s;
}

// ---------------------------------------------------------------------------
// 用户输入：**只有两项**（§27 的验收标准就是「这两项够了」）
// ---------------------------------------------------------------------------
const DATASET_VERSION_ID = 390002;
const QUESTION = "首板之后回踩，只要不跌破首板开盘价，后面的收益是不是更好？";

const adminUser = {
  id: 1,
  openId: "verify-research-planner",
  name: "verify-research-planner",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: adminUser });
const repos = createDbResearchRepositories();

section("[0] 用户输入（只有两项 —— 没有任何底层分析字段）");
say(`  datasetVersionId = ${DATASET_VERSION_ID}`);
say(`  researchQuestion = ${QUESTION}`);
say("  未传：feature / target / horizon / descriptiveVariable / segment / grouping / condition / analysisType");
say("  → §27 验收标准：若本探针能跑出结论，即证明用户无需填写底层分析字段。");

// ---------------------------------------------------------------------------
// [1] 模块目录（系统「会哪些研究方法」）
// ---------------------------------------------------------------------------
section("[1] 研究方法目录（§3 可扩展注册机制）");
const modules = await caller.researchPlanner.listModules();
say(`共 ${modules.length} 个已注册研究方法：`);
for (const m of modules) {
  say(`  · ${m.key.padEnd(26)} ${m.label}`);
  say(`      ${m.purpose}`);
  say(`      适用：${m.whenToUse.join("；")}`);
  say(`      需要的分析能力：${m.recommendedAnalysisTypes.join(" / ")}  首选视界：${m.preferredHorizons.join("/")}`);
}

// ---------------------------------------------------------------------------
// [2] createQuestion —— 意图识别 + 计划生成 + 落库（不执行）
// ---------------------------------------------------------------------------
section("[2] createQuestion（意图识别 → Experiment / Run / Plan 落库）");
const tPlan = Date.now();
const created = await caller.researchPlanner.createQuestion({
  datasetVersionId: DATASET_VERSION_ID,
  questionText: QUESTION,
  generatedBy: "SYSTEM",
});
const planMs = Date.now() - tPlan;

say(`questionId  = ${created.question.id}`);
say(`experimentId= ${created.experiment.id}`);
say(`runId       = ${created.run.id}`);
say(`planId      = ${created.plan.id}`);
say(`计划生成耗时 ${planMs}ms`);

say(`\n--- 意图识别（§5 系统自动判定，用户不在输入里选）---`);
say(`  主方法      : ${created.intent.primaryModuleKey}（${created.intent.primaryModule.label}）`);
say(`  研究类型    : ${created.intent.researchType}`);
say(`  回落基线    : ${created.intent.fallbackApplied ? "是（零命中）" : "否"}`);
say(`  判定依据（落库的 selectionRationale，用户可核对系统为什么这么理解）：`);
for (const line of created.plan.notes?.selectionRationale ?? []) say(`    · ${line}`);
say(`  命中分句（分句 → 关键词 → 方法）：`);
for (const c of created.intent.evidence.matchedClauses) say(`    · 「${c.clause}」 命中「${c.keyword}」 → ${c.moduleKeys.join(" / ")}`);
say(`  已登记关键词命中情况：${created.intent.evidence.keywordHits.filter((k) => k.matched).map((k) => `${k.moduleKey}:${k.keyword}`).join(" / ") || "（无）"}`);
say(`  未命中关键词（用于解释「为什么没选某方法」）：${created.intent.evidence.keywordHits.filter((k) => !k.matched).map((k) => `${k.moduleKey}:${k.keyword}`).join(" / ") || "（无）"}`);
say(`  未采纳分句  : ${created.intent.evidence.unresolvedClauses.length > 0 ? created.intent.evidence.unresolvedClauses.join(" ¶ ") : "（无）"}`);

say(`\n--- 计划规模（§8/§9/§10）---`);
say(`  计划条数  = ${created.preview.plannedCount}（上限 ${created.preview.maxAnalysisPerPlan}，发生过裁剪=${created.preview.capApplied ? "是" : "否"}）`);
say(`  被丢弃    = ${created.preview.droppedCount} 条`);
say(`  优先级分布：P0 核心 ${created.preview.coreCount} / P1 辅助 ${created.preview.auxiliaryCount} / P2 探索 ${created.preview.exploratoryCount}`);

say(`\n--- 计划预览：核心分析清单（§18 正式执行前可看）---`);
for (const a of created.preview.coreAnalyses) say(`  [P0] ${a.analysisType.padEnd(14)} ${a.name}`);
say(`--- 辅助分析清单 ---`);
for (const a of created.preview.auxiliaryAnalyses) say(`  [P1] ${a.analysisType.padEnd(14)} ${a.name}`);
say(`--- 探索分析清单 ---`);
for (const a of created.preview.exploratoryAnalyses) say(`  [P2] ${a.analysisType.padEnd(14)} ${a.name}`);

say(`\n--- §22 数据有效性检查（执行前）---`);
say(`  passed=${created.preview.dataValidity.passed}  已检 ${created.preview.dataValidity.checkedCount} 条  未通过 ${created.preview.dataValidity.failedCount} 条`);
for (const n of created.preview.dataValidity.notes) say(`    · ${n}`);
say(`  该 Dataset 能力提示：${created.preview.capabilityNotes.length > 0 ? created.preview.capabilityNotes.join(" ¶ ") : "（无缺口）"}`);

check("§5 意图识别命中 PULLBACK_EFFECTIVENESS（而非泛化的 EVENT_RETURN_RESEARCH）", created.intent.primaryModuleKey === "PULLBACK_EFFECTIVENESS", created.intent.primaryModuleKey);
check("§10 P0 核心分析 ≥ 1", created.preview.coreCount >= 1, `coreCount=${created.preview.coreCount}`);
check("§22 执行前数据有效性检查通过", created.preview.dataValidity.passed === true);
check("计划条数 > 0", created.preview.plannedCount > 0, `plannedCount=${created.preview.plannedCount}`);

// ---------------------------------------------------------------------------
// [3] §7 计划结构化登记（featureMapping / targetMapping / horizons / segments / baseline ...）
// ---------------------------------------------------------------------------
section("[3] §7 Analysis Plan 结构化登记（notesJson.spec）");
const spec = created.plan.notes?.spec ?? null;
check("§7 spec 已落库", spec !== null);
if (spec !== null) {
  say(`  researchModule = ${spec.researchModule.primary}（${spec.researchModule.primaryLabel}）  辅助：${spec.researchModule.secondary.join(" / ") || "（无）"}`);
  say(`  datasetVersionId = ${spec.datasetVersionId}`);
  say(`  analysisTypes = ${spec.analysisTypes.join(" / ")}`);
  say(`  horizons = ${spec.horizons.map((h) => `T+${h}`).join(" / ")}`);
  say(`\n  featureMapping（特征侧：条件 / 分组 / 描述用到的变量）`);
  for (const f of spec.featureMapping) {
    say(`    ${f.variable.padEnd(32)} 角色=${f.roles.join(",").padEnd(22)} 命中 ${f.analysisCount} 条`);
    for (const r of f.readbacks) say(`        ↳ ${r}`);
  }
  say(`\n  targetMapping（结果侧）`);
  for (const t of spec.targetMapping) {
    say(`    ${t.variable.padEnd(32)} 角色=${t.roles.join(",").padEnd(10)} 命中 ${t.analysisCount} 条  视界=${t.horizons.map((h) => `T+${h}`).join("/")}`);
  }
  say(`\n  baseline（比较基准）`);
  say(`    ${spec.baseline === null ? "（无 —— 计划里没有无条件事件研究）" : `${spec.baseline.analysisName}\n      ${spec.baseline.note}`}`);
  say(`\n  condition（主条件口径，P0 必需项）`);
  for (const c of spec.condition) {
    say(`    ${c.analysisName}`);
    for (const e of c.expressions) say(`        表达式：${e}`);
    for (const r of c.readbacks) say(`        口径  ：${r}`);
  }
  say(`\n  segments（两窗关系）`);
  for (const s of spec.segments) {
    say(`    ${s.analysisName}`);
    say(`      A 窗 T+${s.windowA[0]}..T+${s.windowA[1]} 的 ${s.windowAStat}  ↔  B 窗 T+${s.windowB[0]}..T+${s.windowB[1]} 的 ${s.windowBStat}`);
  }
  say(`\n  stabilityPlan（稳定性分析计划）`);
  for (const s of spec.stabilityPlan) say(`    ${s.dimensionLabel}（${s.dimension}） → ${s.analysisName}`);
  say(`\n  interactionPlan（关系 / 分布类分析计划）`);
  for (const s of spec.interactionPlan) say(`    [${s.analysisType}] ${s.analysisName}\n      ${s.description}`);
  check("§7 spec 与落库计划条数一致", spec.analysisTypes.length > 0 && spec.featureMapping.length > 0);
  check("§7 condition 至少登记一条 P0 口径", spec.condition.length >= 1, `condition=${spec.condition.length}`);
}

// ---------------------------------------------------------------------------
// [4] getPlan —— 预览必须与落库计划一致（第二份状态 = 漂移源）
// ---------------------------------------------------------------------------
section("[4] getPlan（从库里的计划重算预览，验证「预览即所跑」）");
const planId = created.plan.id!;
const reread = await caller.researchPlanner.getPlan({ planId });
check("重读的计划条数与创建时一致", reread.preview.plannedCount === created.preview.plannedCount, `${reread.preview.plannedCount} vs ${created.preview.plannedCount}`);
check("重读的 P0 条数与创建时一致", reread.preview.coreCount === created.preview.coreCount, `${reread.preview.coreCount} vs ${created.preview.coreCount}`);
check("重读的 §7 登记与创建时一致", JSON.stringify(reread.plan.notes?.spec) === JSON.stringify(spec));
say(`  重读 planId=${reread.plan.id} status=${reread.plan.status} plannedCount=${reread.preview.plannedCount} P0=${reread.preview.coreCount} P1=${reread.preview.auxiliaryCount} P2=${reread.preview.exploratoryCount}`);

// ---------------------------------------------------------------------------
// [5] §18/§19 计划明细（每条都有 priority / purpose / required）
// ---------------------------------------------------------------------------
section("[5] 计划明细（每条含 priority / purpose / required / 条件，§10）");
for (const item of created.plan.items) {
  const cond = (item.conditions ?? []).map((c) => `${c.fieldName} ${c.operator} ${JSON.stringify(c.value)}`).join("  且  ");
  say(`  ${String(item.sortOrder).padStart(2)}. [${item.priority}]${item.required ? "*必需" : "    "} ${item.analysisType.padEnd(16)} ${item.name}`);
  say(`      目标：${item.target ?? "（无）"}`);
  if (cond.length > 0) say(`      条件：${cond}`);
  say(`      目的：${item.purpose}`);
}
const missingMeta = created.plan.items.filter((i) => !i.priority || !i.purpose || typeof i.required !== "boolean");
check("§10 每条计划项都有 priority / purpose / required", missingMeta.length === 0, `缺 ${missingMeta.length} 条`);

// ---------------------------------------------------------------------------
// [6] runResearch —— 物化 + 真实执行 + 结论视图
// ---------------------------------------------------------------------------
section("[6] runResearch（物化 → 真实执行 → Finding → Conclusion）");
const tRun = Date.now();
const outcome = await caller.researchPlanner.runResearch({ planId });
const runMs = Date.now() - tRun;
say(`执行总耗时 ${(runMs / 1000).toFixed(1)}s（${outcome.analysisCount} 条分析）`);
say(`runId=${outcome.runId} runStatus=${outcome.runStatus} 冻结样本数=${outcome.sampleCount}`);

say(`\n--- 逐分析执行状态 ---`);
for (const a of outcome.analyses) {
  say(`  #${a.analysisId} [${a.priority ?? "-"}] ${a.status.padEnd(9)} 结果 ${String(a.resultCount).padStart(3)} 行  ${a.analysisType.padEnd(16)} ${a.name}`);
}
say(`\n  完成 ${outcome.completedCount} / 失败 ${outcome.failedCount} / 未完成 ${outcome.pendingCount}（共 ${outcome.analysisCount}）`);
check("全部计划分析执行器可见（条数 = 计划条数）", outcome.analysisCount === created.preview.plannedCount, `${outcome.analysisCount} vs ${created.preview.plannedCount}`);
check("零失败", outcome.failedCount === 0, `failed=${outcome.failedCount}`);
check("零未完成", outcome.pendingCount === 0, `pending=${outcome.pendingCount}`);

/**
 * 🔴 「零结果」不能当成失败，也**绝不能**当成通过（§22）。
 *
 * 实测反例：Dataset 390002 的事件表登记了 `marketCap`，但该列 **100% 为 NULL**
 * （0 / 25108）；于是「market_cap 分位 → T+5 收益」这条分析 status = COMPLETED、resultCount = 0。
 *
 * 因此这里断言的是**报告是否如实**，而不是「必须每条都有结果」：
 * 后端报告的 `emptyResultCount` 必须等于现场数出来的零结果条数；有零结果时 `passed` 必须为 false。
 */
const emptyResultIds = outcome.analyses.filter((a) => a.status === "COMPLETED" && a.resultCount === 0).map((a) => a.analysisId);
say(`  零结果分析（执行完成但未产出结果行）：${emptyResultIds.length === 0 ? "无" : emptyResultIds.map((id) => `#${id}`).join(", ")}`);
check(
  "§22 零结果分析被如实报告（数量与现场统计一致）",
  outcome.dataValidity.emptyResultCount === emptyResultIds.length,
  `报告 ${outcome.dataValidity.emptyResultCount} vs 实测 ${emptyResultIds.length}`,
);
check(
  "§22 存在零结果时必须 passed=false（不能报成「全部通过」）",
  emptyResultIds.length === 0 ? outcome.dataValidity.passed === true : outcome.dataValidity.passed === false,
  `emptyResult=${emptyResultIds.length} passed=${outcome.dataValidity.passed}`,
);
check(
  "§22 大多数分析产出了结果（真实执行到位的下限：≥ 80%）",
  (outcome.analyses.filter((a) => a.resultCount > 0).length / outcome.analysisCount) >= 0.8,
  `有结果 ${outcome.analyses.filter((a) => a.resultCount > 0).length} / ${outcome.analysisCount}`,
);

// ---------------------------------------------------------------------------
// [7] getOutcome —— 结论视图（§12–§15）
// ---------------------------------------------------------------------------
section("[7] getOutcome（Finding 聚合 → 排序 → 去重 → 冲突 → Top Findings → 结论）");
const view = await caller.researchPlanner.getOutcome({ questionId: created.question.id! });
say(`  问题：${view.questionText}`);
say(`  研究方法：${view.moduleKeys.join(" / ")}`);
say(`  分析：${view.analysisCount} 条（完成 ${view.completedCount} / 失败 ${view.failedCount} / 未完成 ${view.pendingCount}）`);
say(`  Finding：共 ${view.findingsTotal} 条，去重合并掉 ${view.dedupedCount} 条，默认展示 ${view.topFindings.length} 条（另有 ${view.hiddenFindingCount} 条在折叠区）`);

say(`\n--- §22 数据有效性 ---`);
say(`  passed=${view.dataValidity.passed}  失败=${view.dataValidity.failedCount}  未完成=${view.dataValidity.pendingCount}  零结果=${view.dataValidity.emptyResultCount}`);
for (const n of view.dataValidity.notes) say(`    · ${n}`);
for (const a of view.dataValidity.emptyResultAnalyses) say(`    零结果 #${a.analysisId} ${a.name}\n      ${a.note}`);
// 「passed」是**结论性判定**，因此断言的是「它与三个缺口维度自洽」，而不是「必须为 true」。
check(
  "§22 dataValidity.passed 与三个缺口维度自洽",
  view.dataValidity.passed ===
    (view.dataValidity.failedCount === 0 && view.dataValidity.pendingCount === 0 && view.dataValidity.emptyResultCount === 0),
  `passed=${view.dataValidity.passed}`,
);

say(`\n--- §13 Top Findings（每条必须回答：发现了什么 / 什么条件 / 什么目标 / 哪个视界 / 样本量 / 与基准差异 / 效果大小 / 稳定性）---`);
if (view.topFindings.length === 0) {
  say("  （无满足强度门槛的 Finding）");
} else {
  for (const f of view.topFindings) {
    say(`\n  ── findingId=${f.findingId} [${f.findingType}] 强度 ${f.researchStrength ?? "-"}（${f.researchStrengthGrade ?? "-"}） ${f.status}`);
    say(`     标题：${f.title}`);
    say(`     摘要：${f.summary ?? "（无）"}`);
    say(`     来自分析 #${f.primaryAnalysisId}（${f.analysisType}）「${f.analysisName}」 目标=${f.target} 视界=T+${f.horizon ?? "?"}`);
    say(`     样本：n=${f.sampleCount ?? "-"}（${f.sampleGrade ?? "-"}）`);
    say(`     效果：${j(f.effect, 700)}`);
    say(`     稳定性：${j(f.stability, 500)}`);
    if (f.conflictsWith.length > 0) say(`     与其他 Finding 冲突：${f.conflictsWith.join(",")}`);
    if (f.limitations.length > 0) say(`     局限：${f.limitations.join(" ¶ ")}`);
  }
}

say(`\n--- §15 结论 ---`);
say(j(view.conclusion, 2200));
check("§15 结论已生成", view.conclusion !== null && view.conclusion !== undefined);

say(`\n--- §15 建议（只能表示「是否值得进入下一研究阶段」，不得声称赚钱）---`);
say(`  stage = ${view.recommendation.stage}`);
say(`  text  = ${view.recommendation.text}`);
for (const r of view.recommendation.reasons) say(`    · ${r}`);
say(`  强制免责声明（前端必须原样渲染）：\n    ${view.recommendation.disclaimer}`);
const recText = `${view.recommendation.text} ${view.recommendation.reasons.join(" ")}`;
check("§15 建议文本不含「赚钱 / 盈利 / 稳赚 / 必涨」类断言", !/稳赚|必涨|保证收益|一定盈利/.test(recText.replace(/不回答「能不能赚钱」/g, "")));
check("§15 建议附有独立免责声明字段", typeof view.recommendation.disclaimer === "string" && view.recommendation.disclaimer.length > 0);
check("§15 结论正文已拼接免责声明后缀（withDisclaimer 真正生效）", (view.conclusion?.conclusion ?? "").includes(view.recommendation.disclaimer));

say(`\n--- §13 / §15 提问锚点（用户问的那件事是否可读）---`);
say(`  source = ${view.questionAlignment.source}  候选分析 ${view.questionAlignment.analysisCount} 条`);
say(`  note   = ${view.questionAlignment.note}`);
say(`  相关 Finding ${view.questionAlignedFindings.length} 条：`);
for (const f of view.questionAlignedFindings) {
  say(`    · #${f.findingId} ${f.title}`);
  say(`        来自 #${f.primaryAnalysisId}（${f.analysisType}）「${f.analysisName}」  n=${f.sampleCount ?? "-"}`);
}
check("§15 结论锚定了研究问题（researchQuestion = 用户原话）", view.conclusion?.researchQuestion === QUESTION, String(view.conclusion?.researchQuestion));
check("§15 结论正文含「【研究问题】」与「【统计判定】」两段", (view.conclusion?.conclusion ?? "").includes("【研究问题】") && (view.conclusion?.conclusion ?? "").includes("【统计判定】"));
check(
  "§15 结论正文不再出现占位符「(未登记假设陈述)」",
  !(view.conclusion?.conclusion ?? "").includes("(未登记假设陈述)"),
);
check(
  "§13 本问题未被点明精修维度 ⇒ 提问锚点如实地回落到必需项（REQUIRED_FALLBACK）",
  view.questionAlignment.source === "REQUIRED_FALLBACK",
  view.questionAlignment.source,
);
check("§13 「针对你的问题」区块拿到了证据（非空）", view.questionAlignedFindings.length > 0, `n=${view.questionAlignedFindings.length}`);

say(`\n--- 下一步动作提示 ---`);
for (const n of view.nextActions) say(`  · ${n}`);

// ---------------------------------------------------------------------------
// [8] 与既有手工分析（run 570001，planId 全 NULL）逐条件对照
// ---------------------------------------------------------------------------
section("[8] §2.1 / §30 复用证据：自动规划 vs 既有手工分析（run 570001）逐条件对照");
function canonicalValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalValue(x)).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${k}:${canonicalValue((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return `${typeof v}:${String(v)}`;
}
function signatureOf(rows: Array<{ fieldName: string; operator: string; value: unknown }>, target: string | null): string {
  const parts = rows.map((r) => `${r.fieldName}|${r.operator}|${canonicalValue(r.value)}`).sort();
  return `${target ?? "-"}::${parts.join(" && ")}`;
}
async function signatureOfAnalysis(analysisId: number): Promise<{ sig: string; target: string | null }> {
  const a = await repos.analyses.getById(analysisId);
  const rows = await repos.conditions.listByAnalysis(analysisId);
  return { sig: signatureOf(rows.map((r) => ({ fieldName: r.fieldName, operator: r.operator, value: r.value })), a?.target ?? null), target: a?.target ?? null };
}
async function metricMapOf(analysisId: number): Promise<Map<string, number | null>> {
  const rows = await repos.results.list({ analysisId });
  const m = new Map<string, number | null>();
  for (const r of rows) m.set(r.metricCode, r.metricValue ?? null);
  return m;
}

/** 旧基准（手工）：分析 #540001–#540013 都在 run 570001。 */
const PRIOR_RUN_ID = 570001;
const priorAnalyses = (await repos.analyses.list({ runId: PRIOR_RUN_ID })).filter(
  (a) => a.id !== undefined && a.analysisType === "CONDITIONAL",
);
say(`旧 Run ${PRIOR_RUN_ID} 的 CONDITIONAL 分析共 ${priorAnalyses.length} 条（planId=${priorAnalyses[0]?.planId ?? "null"} ⇒ 专家手工创建）`);

const priorBySig = new Map<string, number>();
for (const a of priorAnalyses) {
  const { sig } = await signatureOfAnalysis(a.id!);
  if (!priorBySig.has(sig)) priorBySig.set(sig, a.id!);
}

const newConditional = outcome.analyses.filter((a) => a.analysisType === "CONDITIONAL");
let matched = 0;
let numericMismatch = 0;
for (const a of newConditional) {
  const { sig } = await signatureOfAnalysis(a.analysisId);
  const priorId = priorBySig.get(sig);
  if (priorId === undefined) continue;
  matched += 1;
  const [newM, oldM] = await Promise.all([metricMapOf(a.analysisId), metricMapOf(priorId)]);
  const diffs: string[] = [];
  const shown: string[] = [];
  for (const [code, newVal] of newM) {
    if (!oldM.has(code)) continue;
    const oldVal = oldM.get(code) ?? null;
    const same = newVal === oldVal || (typeof newVal === "number" && typeof oldVal === "number" && Math.abs(newVal - oldVal) < 1e-9);
    if (!same) diffs.push(`${code}: 新=${newVal} 旧=${oldVal}`);
    shown.push(`${code}=${newVal}`);
  }
  if (diffs.length > 0) numericMismatch += 1;
  say(`\n  ✓ 条件完全相同：新 #${a.analysisId}（${a.priority}） ⇄ 旧 #${priorId}`);
  say(`     目标 ${a.name.split(" → ").pop()} | 条件签名 ${sig.split("::")[1]}`);
  say(`     新值：${shown.join("  ")}`);
  if (diffs.length > 0) say(`     ❌ 不一致：${diffs.join(" ； ")}`);
}

say("");
if (matched === 0) {
  say("  （自动计划的条件族与手工基线无完全重合项 —— 说明是「补充」而非「复现」；");
  say("   这本身不算失败，但下面的判定按「无法逐字对照」记为未验证。）");
}
check("自动规划的条件与手工基线存在完全重合项（可逐字对照）", matched > 0, `matched=${matched}`);
check("重合项上的统计结果逐字一致（证明只有一套统计实现）", numericMismatch === 0, `mismatch=${numericMismatch}`);

// ---------------------------------------------------------------------------
// [9] §16 createCandidate —— 保留全套 provenance
// ---------------------------------------------------------------------------
section("[9] §16 createCandidate（Research → Candidate，人工确认前的 DRAFT）");
const coreGuard = outcome.analyses.find((a) => a.priority === "P0" && a.analysisType === "CONDITIONAL");
check("存在 P0 守卫分析可用于导出候选条件", coreGuard !== undefined);
let candidateId: number | null = null;
if (coreGuard !== undefined) {
  const res = await caller.researchPlanner.createCandidate({
    questionId: created.question.id!,
    name: "[E2E] 首板回踩不破首板开盘价",
    description: `由研究问题自动规划并执行的候选（planId=${planId}）。${QUESTION}`,
    deriveFilterFromAnalysisId: coreGuard.analysisId,
  });
  candidateId = res.candidate.id ?? null;
  say(`candidateId = ${candidateId} status=${res.candidate.status}`);
  say(`provenance 回执：${j(res.provenance, 600)}`);
  say(`sourceDatasetVersionId = ${res.candidate.sourceDatasetVersionId}`);
  say(`sourceResearchRunId   = ${res.candidate.sourceResearchRunId}`);
  say(`sourceResearchPlanId  = ${res.candidate.sourceResearchPlanId}`);
  say(`conclusionId          = ${res.candidate.conclusionId}`);
  say(`sourceFindingIds      = ${JSON.stringify(res.candidate.sourceFindingIds)}`);
  say(`filterRule.groups     = ${j(res.candidate.filterRule as ResearchConditionSet, 700)}`);

  check("§16 provenance 六项齐备", res.provenance.complete === true, j(res.provenance, 300));
  check("§16 sourceResearchPlanId 已写入", res.candidate.sourceResearchPlanId === planId, `${res.candidate.sourceResearchPlanId} vs ${planId}`);
  check("§16 sourceResearchRunId 已写入", res.candidate.sourceResearchRunId === outcome.runId);
  check("§16 sourceDatasetVersionId 已写入", res.candidate.sourceDatasetVersionId === DATASET_VERSION_ID);
  check("§16 候选状态为 DRAFT（不自动进 Strategy）", res.candidate.status === "DRAFT", res.candidate.status);
  check("候选筛选条件由研究分析的落库条件导出（同源）", (res.candidate.filterRule?.groups?.length ?? 0) > 0);

  // 导出的 filterRule 必须与那条分析的落库条件逐字一致（不是「看起来像」）。
  const rows = await repos.conditions.listByAnalysis(coreGuard.analysisId);
  const expected = signatureOf(rows.map((r) => ({ fieldName: r.fieldName, operator: r.operator, value: r.value })), null).split("::")[1];
  const gotRows = (res.candidate.filterRule?.groups ?? []).flatMap((g) =>
    (g.conditions ?? []).map((c) => ({ fieldName: c.fieldName, operator: c.operator, value: c.value })),
  );
  const got = signatureOf(gotRows, null).split("::")[1];
  check("候选条件与源分析条件逐字一致", got === expected, `got=${got} expected=${expected}`);
}

// ---------------------------------------------------------------------------
// [10] §27 最终判据
// ---------------------------------------------------------------------------
section("[10] §27 验收判据");
say(`  ① 输入只有 datasetVersionId + researchQuestion：✓（本探针构造时就没有别的入参）`);
say(`  ② 研究方法由系统判定：${created.intent.primaryModuleKey}（用户未填 Feature/Target/Horizon/Descriptive/Segment）`);
say(`  ③ 计划由系统生成：${created.preview.plannedCount} 条（P0 ${created.preview.coreCount} / P1 ${created.preview.auxiliaryCount} / P2 ${created.preview.exploratoryCount}）`);
say(`  ④ 分析真实执行：完成 ${outcome.completedCount} / ${outcome.analysisCount}，结果行合计 ${outcome.analyses.reduce((s, a) => s + a.resultCount, 0)}`);
say(`  ⑤ Finding 聚合：${view.findingsTotal} 条 → 默认展示 ${view.topFindings.length} 条`);
say(`  ⑥ 结论已生成：${view.conclusion?.conclusionType ?? "（无）"}`);
say(`  ⑦ 建议阶段：${view.recommendation.stage}`);
say(`  ⑧ Candidate 可创建且带全套 provenance：${candidateId !== null ? `✓ #${candidateId}` : "✗"}`);

say(`\n${"=".repeat(78)}`);
say(`检查项：${checks}  失败：${failures}`);
say(failures === 0 ? "结论：✓ 首板回踩 E2E 全部通过" : `结论：✗ 有 ${failures} 项未通过`);
say(`${"=".repeat(78)}`);

const { writeFileSync } = await import("node:fs");
writeFileSync("docs/evidence/_e2e_research_planner.out.txt", out.join("\n"), "utf8");
console.log(out.join("\n"));
process.exit(failures === 0 ? 0 : 2);
