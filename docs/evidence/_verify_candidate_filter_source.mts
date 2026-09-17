/**
 * _verify_candidate_filter_source.mts —— 「创建候选」取错分析导致恒失败的修复验收。
 *
 * 缺陷报告（用户原文）：
 *   「创建候选失败 分析 780001 没有任何条件，无法导出候选题筛选条件。」
 *
 * 实测根因（本探针 [0] 段复现）：
 *   `/research/ask` 结论页 `handleCreateCandidate` 用
 *   `outcome.analyses.find(a => a.priority === "P0")` 挑分析来导出候选筛选条件。
 *   而计划里**第一条 P0** 是 `EVENT_STUDY 全样本基准`（`analysisPlan.ts:361` 是全函数
 *   第一条 `push`，`priority = "P0"`、`requiredFlag = true`）——
 *   它天然没有 `research_analysis_condition` 行 ⇒ 服务端按设计拒绝 ⇒ **恒失败**。
 *
 * 🔴 为什么 E2E 全绿却没抓到：`_e2e_research_planner.mts` 自己写了更严的判据
 *    （`priority === "P0" && analysisType === "CONDITIONAL"`）。
 *    **测试比产品严 ⇒ 测试通过只证明测试的挑法对，不证明产品可用。**
 *    本次修复把挑选规则收敛成**唯一实现**（`aggregate.ts#rankCandidateSourceAnalyses`），
 *    产品、Workbuddy、E2E 从此共用同一份。
 *
 * 本探针跑在用户**真实失败的那份数据**上（Run 780002 / Plan 120002），不是新造数据。
 * 全程真实 tRPC + 真实 TiDB，零 mock。
 *
 * 用法：npx tsx docs/evidence/_verify_candidate_filter_source.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { appRouter } from "../../server/routers";
import { createDbResearchRepositories } from "../../server/researchCore";
import { candidateFilterOriginLabelOf } from "../../client/src/components/research/researchAskForm";

const RUN_ID = 780002;
const PLAN_ID = 120002;
const BASELINE_ANALYSIS_ID = 780001; // EVENT_STUDY 全样本基准（无条件的那个）
const GUARD_ANALYSIS_ID = 780004; // CONDITIONAL 守卫条件分析（有条件的那个）

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

const adminUser = {
  id: 1,
  openId: "verify-candidate-filter-source",
  name: "verify-candidate-filter-source",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: adminUser });
const repos = createDbResearchRepositories();
const db = await getDb();
if (db === null) throw new Error("数据库不可用（DATABASE_URL 未配置）");

/** 探针建出来的候选（收尾要删掉，不留残渣）。 */
const createdCandidateIds: number[] = [];

function statusOf(err: unknown): string {
  const e = err as { code?: string; message?: string };
  return `${e.code ?? "?"}: ${e.message ?? String(err)}`;
}

// ---------------------------------------------------------------------------
// [0] 缺陷复现（只读）—— 证明「旧前端口径必然挑到无条件分析」
// ---------------------------------------------------------------------------
section("[0] 缺陷复现：旧前端口径（first P0）会挑中哪条分析");
const outcome = await caller.researchPlanner.getOutcome({ runId: RUN_ID });

const byId = new Map(outcome.analyses.map((a) => [a.analysisId, a]));
const p0 = outcome.analyses.filter((a) => a.priority === "P0");
say(`  Run ${RUN_ID}：${outcome.analysisCount} 条分析，其中 P0 ${p0.length} 条（下按 analysisId 升序 = 旧前端 find 的遍历顺序）`);
for (const a of p0) {
  say(`    · #${a.analysisId} [${a.analysisType}] 条件数=${a.conditionCount} requiredFlag=${a.requiredFlag} ${a.name}`);
}
const firstP0 = p0[0];
check("旧口径 `find(a => a.priority === \"P0\")` 命中的是无条件基准分析", firstP0?.analysisId === BASELINE_ANALYSIS_ID, `实得 #${firstP0?.analysisId}`);
check("该基准分析条件数为 0（⇒ 旧口径调用必然被服务端拒绝）", firstP0?.conditionCount === 0, `conditionCount=${firstP0?.conditionCount}`);
check("同 Run 存在带条件的守卫分析（⇒ 本来就有可用的来源，只是挑错了）", (byId.get(GUARD_ANALYSIS_ID)?.conditionCount ?? 0) > 0, `#${GUARD_ANALYSIS_ID} conditionCount=${byId.get(GUARD_ANALYSIS_ID)?.conditionCount}`);

// ---------------------------------------------------------------------------
// [1] 新的数据通路：聚合层如实列出「可导出条件的分析」
// ---------------------------------------------------------------------------
section("[1] 聚合层新增 candidateEligibleAnalyses（排序的唯一实现）");
say(`  candidateEligibleAnalyses = ${j(outcome.candidateEligibleAnalyses)}`);
const eligible = outcome.candidateEligibleAnalyses;
check("清单非空", eligible.length > 0, `count=${eligible.length}`);
check("清单里每一条都 conditionCount > 0（硬门槛，不是「排后面」）", eligible.every((c) => c.conditionCount > 0));
check("无条件的 EVENT_STUDY 基准**不在**清单里", !eligible.some((c) => c.analysisId === BASELINE_ANALYSIS_ID));
check("清单第 0 条 = 带条件的守卫分析", eligible[0]?.analysisId === GUARD_ANALYSIS_ID, `实得 #${eligible[0]?.analysisId}`);
check("清单第 0 条给出了排序理由（可审查，非黑箱）", (eligible[0]?.why ?? "").length > 0, eligible[0]?.why);
check("逐条分析视图已带 conditionCount 字段", outcome.analyses.every((a) => typeof a.conditionCount === "number"));

// ---------------------------------------------------------------------------
// [1b] 两种定位入口必须给出**同一份研究**（questionId / runId）
// ---------------------------------------------------------------------------
section("[1b] getOutcome({runId}) 与 getOutcome({questionId}) 必须等价");
say(`  byRun      : planId=${outcome.planId} datasetVersionId=${outcome.datasetVersionId} questionId=${outcome.questionId} moduleKeys=${j(outcome.moduleKeys, 200)}`);
say(`  questionAlignment.source = ${outcome.questionAlignment.source}（${outcome.questionAlignment.note}）`);
check("按 runId 定位也能解析出 planId", outcome.planId === PLAN_ID, `实得 ${outcome.planId}`);
check("按 runId 定位也能解析出 datasetVersionId", outcome.datasetVersionId !== null, `实得 ${outcome.datasetVersionId}`);
check("按 runId 定位也能解析出 questionId", outcome.questionId !== null, `实得 ${outcome.questionId}`);
if (outcome.questionId !== null) {
  const byQuestion = await caller.researchPlanner.getOutcome({ questionId: outcome.questionId });
  say(`  byQuestion : planId=${byQuestion.planId} datasetVersionId=${byQuestion.datasetVersionId} moduleKeys=${j(byQuestion.moduleKeys, 200)}`);
  check("两条入口的 planId 一致", byQuestion.planId === outcome.planId, `${byQuestion.planId} vs ${outcome.planId}`);
  check("两条入口的 datasetVersionId 一致", byQuestion.datasetVersionId === outcome.datasetVersionId);
  check("两条入口的 moduleKeys 一致", JSON.stringify(byQuestion.moduleKeys) === JSON.stringify(outcome.moduleKeys));
  check(
    "两条入口的 §13 提问锚点一致（emphasisAnalysisNames 随 plan 一起恢复）",
    byQuestion.questionAlignment.source === outcome.questionAlignment.source,
    `${byQuestion.questionAlignment.source} vs ${outcome.questionAlignment.source}`,
  );
  check(
    "两条入口的 candidateEligibleAnalyses 完全一致",
    JSON.stringify(byQuestion.candidateEligibleAnalyses) === JSON.stringify(outcome.candidateEligibleAnalyses),
  );
}

// ---------------------------------------------------------------------------
// [2] 产品的真实调用方式：**不传** deriveFilterFromAnalysisId
// ---------------------------------------------------------------------------
section("[2] createCandidate 不传 analysisId（产品 / Workbuddy 的真实调用方式）");
let autoCandidateId: number | null = null;
let autoFilterJson = "";
try {
  /**
   * 🔴 载荷必须与页面**逐字一致**（`ResearchAsk.tsx#handleCreateCandidate`）：
   *      { questionId, name, description } —— **没有** deriveFilterFromAnalysisId。
   *    这一点是本探针的价值所在：`_e2e_research_planner.mts` 当年传了显式的
   *    `deriveFilterFromAnalysisId` 并自己写了挑选判据，于是**绕过了产品的真实调用路径**，
   *    缺陷就这么一直绿着。验收必须走产品真正发出去的那份载荷。
   */
  const res = await caller.researchPlanner.createCandidate({
    questionId: outcome.questionId!,
    name: (outcome.questionText ?? "自动研究").slice(0, 80),
    description: `由研究问题自动规划并执行（planId=${outcome.planId}）。`,
  });
  autoCandidateId = res.candidate.id ?? null;
  if (autoCandidateId !== null) createdCandidateIds.push(autoCandidateId);
  say(`  candidateId = ${autoCandidateId}`);
  say(`  filterRuleSource = ${j(res.filterRuleSource)}`);
  say(`  candidate.filterRule = ${j(res.candidate.filterRule)}`);
  say(`  provenance = ${j(res.provenance, 400)}`);
  autoFilterJson = JSON.stringify(res.candidate.filterRule ?? null);

  check("创建成功（旧口径在此必然失败）", autoCandidateId !== null);
  check("filterRuleSource.origin === \"AUTO\"", res.filterRuleSource.origin === "AUTO", res.filterRuleSource.origin);
  check(
    "自动挑选落在带条件的守卫分析上",
    res.filterRuleSource.analysisId === GUARD_ANALYSIS_ID,
    `实得 #${res.filterRuleSource.analysisId}`,
  );
  check("导出的条件数 > 0", res.filterRuleSource.conditionCount > 0, `conditionCount=${res.filterRuleSource.conditionCount}`);
  check("候选真的带上了 filterRule（不是空口径）", res.candidate.filterRule !== null && res.candidate.filterRule !== undefined);
  check(
    "filterRule.groups 非空",
    Array.isArray((res.candidate.filterRule as { groups?: unknown[] } | null)?.groups)
      && ((res.candidate.filterRule as { groups: unknown[] }).groups.length > 0),
  );
  check("provenance 六项齐备", res.provenance.complete === true);
  check(
    "sourceTraceJson 记下了来源分析（可追溯）",
    (res.candidate.sourceTraceJson as { derivedFilterFromAnalysisId?: number } | null)?.derivedFilterFromAnalysisId === GUARD_ANALYSIS_ID,
  );
} catch (err) {
  check("创建成功（旧口径在此必然失败）", false, statusOf(err));
}

// ---------------------------------------------------------------------------
// [2b] 按 runId 调用也必须等价（Workbuddy / 高级模式的入口）
// ---------------------------------------------------------------------------
section("[2b] createCandidate({ runId }) 与 { questionId } 产出同一份条件");
try {
  const res2 = await caller.researchPlanner.createCandidate({
    runId: RUN_ID,
    name: "[验证] 候选条件来源修复 · 按 runId 入口",
  });
  if (res2.candidate.id !== null && res2.candidate.id !== undefined) createdCandidateIds.push(res2.candidate.id);
  say(`  candidateId = ${res2.candidate.id}  origin=${res2.filterRuleSource.origin}  来源=#${res2.filterRuleSource.analysisId}`);
  check("按 runId 调用同样成功", res2.candidate.id !== null && res2.candidate.id !== undefined);
  check("导出的 filterRule 与 questionId 入口逐字一致", JSON.stringify(res2.candidate.filterRule ?? null) === autoFilterJson);
  check("§16 provenance 六项齐备（runId 入口修复前为 false）", res2.provenance.complete === true, j(res2.provenance, 300));
} catch (err) {
  check("按 runId 调用同样成功", false, statusOf(err));
}

// ---------------------------------------------------------------------------
// [3] 显式传一条**没有条件**的分析 —— 仍须拒绝，且错误信息要可操作
// ---------------------------------------------------------------------------
section("[3] 显式传无条件的分析：仍拒绝，但错误信息必须告诉调用方该选哪条");
try {
  await caller.researchPlanner.createCandidate({
    runId: RUN_ID,
    name: "[验证] 应当失败",
    deriveFilterFromAnalysisId: BASELINE_ANALYSIS_ID,
  });
  check("显式传无条件分析被拒绝", false, "竟然成功了");
} catch (err) {
  const msg = statusOf(err);
  say(`  $ ${msg}`);
  check("显式传无条件分析被拒绝", msg.includes("没有任何条件"), msg.slice(0, 120));
  check("错误信息给出了「本 Run 可导出条件的分析」", msg.includes("本 Run 可导出条件的分析"));
  check("错误信息点名了正确的那条备选", msg.includes(`#${GUARD_ANALYSIS_ID}`), msg.slice(0, 200));
}

// ---------------------------------------------------------------------------
// [4] 显式传**有效**分析 —— 与自动挑选逐字一致（证明只有一份口径）
// ---------------------------------------------------------------------------
section("[4] 显式传有效分析：与自动挑选结果逐字一致");
try {
  const res = await caller.researchPlanner.createCandidate({
    runId: RUN_ID,
    name: "[验证] 候选条件来源修复 · 显式指定",
    deriveFilterFromAnalysisId: GUARD_ANALYSIS_ID,
  });
  const id = res.candidate.id ?? null;
  if (id !== null) createdCandidateIds.push(id);
  say(`  candidateId = ${id}  filterRule = ${j(res.candidate.filterRule, 400)}`);
  check("显式指定有效分析创建成功", id !== null);
  check("filterRuleSource.origin === \"EXPLICIT\"", res.filterRuleSource.origin === "EXPLICIT", res.filterRuleSource.origin);
  check(
    "显式与自动两条路径导出的 filterRule 逐字一致（同一份分组逻辑）",
    JSON.stringify(res.candidate.filterRule ?? null) === autoFilterJson,
  );
} catch (err) {
  check("显式指定有效分析创建成功", false, statusOf(err));
}

// ---------------------------------------------------------------------------
// [5] 前端纯函数（复用，不重写一套口径）
// ---------------------------------------------------------------------------
section("[5] 前端展示层纯函数（从 React-free 模块直接 import，零重复实现）");
check("AUTO 标签", candidateFilterOriginLabelOf("AUTO") === "系统自动选择", candidateFilterOriginLabelOf("AUTO"));
check("EXPLICIT 标签", candidateFilterOriginLabelOf("EXPLICIT") === "调用方指定", candidateFilterOriginLabelOf("EXPLICIT"));
check("NONE 标签（必须与「有条件」明显区分）", candidateFilterOriginLabelOf("NONE") === "无可用条件", candidateFilterOriginLabelOf("NONE"));

// ---------------------------------------------------------------------------
// [6] 收尾：删掉探针建出来的候选，不留残渣
// ---------------------------------------------------------------------------
section("[6] 收尾：清理探针产生的候选草稿");
// `ResearchStrategyCandidateRepository` **没有 delete**（候选是研究资产，产品上不该随手删，
// 只能经 `transition` 走状态机）。探针自建的验证候选因此走**定向单表 SQL** 清理：
// `research_strategy_candidate` 无子表（已核 schema），删除无级联副作用。
for (const id of createdCandidateIds) {
  try {
    await db.execute(sql`DELETE FROM research_strategy_candidate WHERE id = ${id}`);
    const still = await repos.candidates.getById(id);
    check(`候选 #${id} 已删除`, still === undefined, JSON.stringify(still ?? null).slice(0, 100));
  } catch (err) {
    check(`候选 #${id} 已删除`, false, statusOf(err));
  }
}
check("清理后确实读不到（不是静默失败）", (await repos.candidates.getById(createdCandidateIds[0] ?? -1)) === undefined);

// ---------------------------------------------------------------------------
section("汇总");
say(`  检查项 ${checks} / 失败 ${failures}`);
say(`  结论：${failures === 0 ? "ALL PASS —— 缺陷已修复且在真实失败数据上验证通过" : `FAILURES(${failures})`}`);
if (createdCandidateIds.length > 0) say(`  建于并已清理的候选：${createdCandidateIds.map((i) => `#${i}`).join(", ")}`);

writeFileSync("docs/evidence/_verify_candidate_filter_source.out.txt", `${out.join("\n")}\n`, "utf8");
console.log(out.join("\n"));
process.exit(failures === 0 ? 0 : 1);
