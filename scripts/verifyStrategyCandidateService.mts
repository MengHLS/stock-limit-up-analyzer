/**
 * RESEARCH-006.2 — 真实 TiDB 上的 `Conclusion → Strategy Candidate` 全链验收（**自建自清**）。
 *
 * 目的（006.2 §26 / §27 / §28）：
 *   1. 用**真实 Conclusion**（用户的 `research_conclusion` 既有行，仅只读引用）走完
 *      `createFromConclusion → update → transition`，坐标 / 证据快照 / 状态全部落真实库；
 *   2. `sourceDatasetVersionId` 与 `sourceResearchRunId` 用**裸 SQL 独立复核**
 *      （不用 Service 自己的判断当证据）；
 *   3. 负例（不存在 / 被取代 / 未 READY / 跨 Run）逐个断言错误码，且**零写入**；
 *   4. 证明**行数守恒**、`strategy_versions` **始终 0 行**（§28：本 STEP 绝不写 Strategy）。
 *
 * 纪律：
 *   - 只 DELETE 本脚本自己 INSERT 的候选行（名字带 `[VERIFY-0062]` 前缀 + 按 id 精确删除）；
 *   - 绝不修改任何既有 Research / Strategy / Dataset 行；
 *   - 若库中有在途 Run（`RUNNING` / `PENDING`）会**显著告警**（本脚本只读它们，不会打断）。
 *
 * 用法：npx tsx scripts/verifyStrategyCandidateService.mts
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { createDbResearchRepositories } from "../server/researchCore/repository/db";
import type { ResearchRepositories } from "../server/researchCore/repository/contract";
import { RegistryDatasetVersionReadPort } from "../server/research/strategyCandidate/datasetVersionPort";
import {
  STRATEGY_CANDIDATE_ERROR,
  StrategyCandidateError,
} from "../server/research/strategyCandidate/candidateTypes";
import {
  createStrategyCandidateService,
  type DatasetVersionReadPort,
  type StrategyCandidateService,
} from "../server/research/strategyCandidate/service";

const NAME_PREFIX = "[VERIFY-0062] ";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)![1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});

const ROWCOUNT_TABLES = [
  "research_experiment",
  "research_hypothesis",
  "research_run",
  "research_analysis",
  "research_analysis_condition",
  "research_analysis_metric",
  "research_result",
  "research_conclusion",
  "research_strategy_candidate",
  "research_artifact",
  "research_analysis_template",
  "research_analysis_template_item",
  "strategies",
  "strategy_versions",
  "strategy_version_datasets",
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_research_provenance",
  "dataset_version",
];

async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ROWCOUNT_TABLES) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    out[t] = Number((rows as Array<{ n: number }>)[0].n);
  }
  return out;
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const checks: Check[] = [];
const failures: string[] = [];

function ok(name: string, detail?: string): void {
  checks.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) });
  console.log(`✓ ${name}${detail === undefined ? "" : ` — ${detail}`}`);
}

function bad(name: string, detail: string): void {
  checks.push({ name, ok: false, detail });
  failures.push(`${name}：${detail}`);
  console.log(`✗ ${name} — ${detail}`);
}

function assert(name: string, condition: boolean, detail: string): boolean {
  if (condition) {
    ok(name, detail);
    return true;
  }
  bad(name, detail);
  return false;
}

/** 断言某次调用以指定错误码失败（并返回实际错误信息）。 */
async function expectError(
  name: string,
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    bad(name, `期望 ${code}，但调用成功返回`);
  } catch (err) {
    if (err instanceof StrategyCandidateError && err.code === code) {
      ok(name, err.code);
    } else {
      bad(name, `期望 ${code}，实际抛出：${String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 0. 前状态
// ---------------------------------------------------------------------------

console.log("\n=== 0. 前状态（真实 TiDB）===");
const before = await snapshot();
console.log(JSON.stringify(before, null, 2));

const [runningRuns] = await conn.query(
  "SELECT id, experimentId, runNo, status FROM research_run WHERE status IN ('RUNNING','PENDING') ORDER BY id",
);
if ((runningRuns as unknown[]).length > 0) {
  console.log("\n⚠️ 警告：库中存在在途 Run（本脚本只读、不会打断，但请知悉）：");
  console.log(JSON.stringify(runningRuns, null, 2));
} else {
  console.log("在途 Run：无");
}

// ---------------------------------------------------------------------------
// 1. 选一条真实可用的 Conclusion（Experiment 的 Dataset Version 必须 READY）
// ---------------------------------------------------------------------------

console.log("\n=== 1. 发现真实坐标 ===");
const [coordRows] = await conn.query(
  "SELECT c.id AS conclusionId, c.status AS conclusionStatus, c.title, c.evidenceJson, " +
    "e.id AS experimentId, e.datasetVersionId, v.version AS datasetLabel, v.status AS datasetStatus " +
    "FROM research_conclusion c " +
    "JOIN research_experiment e ON e.id = c.experimentId " +
    "JOIN dataset_version v ON v.id = e.datasetVersionId " +
    "WHERE v.status = 'READY' AND c.status IN ('DRAFT','FINAL') " +
    "ORDER BY c.id DESC LIMIT 5",
);
const coords = coordRows as Array<{
  conclusionId: number;
  conclusionStatus: string;
  title: string;
  evidenceJson: string | null;
  experimentId: number;
  datasetVersionId: number;
  datasetLabel: string;
  datasetStatus: string;
}>;
if (coords.length === 0) {
  console.error("没有可用的真实 Conclusion（需 Experiment 绑定 READY 的 Dataset Version）—— 验收中止");
  process.exit(1);
}
const target = coords[0]!;
console.log(JSON.stringify(target, null, 2));
ok(
  "选定真实 Conclusion",
  `#${target.conclusionId}（${target.conclusionStatus}）→ experiment #${target.experimentId} → dataset version #${target.datasetVersionId}(${target.datasetLabel}/${target.datasetStatus})`,
);

// 独立复核：裸 SQL 反查 evidence 引用的 analysis 与其 runId（不依赖 Service 的判断）
const evidence = target.evidenceJson ? (JSON.parse(target.evidenceJson) as Record<string, unknown>) : null;
const primary = (evidence?.primaryAnalysis ?? null) as Record<string, unknown> | null;
const primaryAnalysisId = typeof primary?.analysisId === "number" ? primary.analysisId : null;
const contributingIds = Array.isArray(evidence?.contributingAnalyses)
  ? (evidence!.contributingAnalyses as Array<Record<string, unknown>>)
      .map((a) => (typeof a.analysisId === "number" ? a.analysisId : null))
      .filter((x): x is number => x !== null)
  : [];
const involvedIds = Array.from(
  new Set([...(primaryAnalysisId === null ? [] : [primaryAnalysisId]), ...contributingIds]),
);
let expectedRunId: number | null = null;
if (involvedIds.length > 0) {
  const [anRows] = await conn.query(
    `SELECT id, runId FROM research_analysis WHERE id IN (${involvedIds.map(() => "?").join(",")})`,
    involvedIds,
  );
  const runIds = Array.from(
    new Set((anRows as Array<{ id: number; runId: number }>).map((r) => Number(r.runId))),
  );
  expectedRunId = runIds.length === 1 ? runIds[0]! : null;
  console.log(
    `裸 SQL 反查：analysisIds=${JSON.stringify(involvedIds)} → distinctRunIds=${JSON.stringify(runIds)} ⇒ 期望 sourceResearchRunId=${String(expectedRunId)}`,
  );
  ok("裸 SQL 独立算出「期望 runId」", `expectedRunId=${String(expectedRunId)}`);
}

// 另选一条**真实存在但 evidence 指向不存在 analysis** 的结论？真实库没有 ⇒ 用单测覆盖；
// 这里只对「跨 Run / 无证据」的 NULL 分支做真实库负例（见 C7）。

// ---------------------------------------------------------------------------
// 2. 真实依赖装配
// ---------------------------------------------------------------------------

const repos: ResearchRepositories = createDbResearchRepositories();
const registryPort = new RegistryDatasetVersionReadPort();
const service: StrategyCandidateService = createStrategyCandidateService({
  repos,
  datasetVersions: registryPort,
});

const createdIds: number[] = [];

function isolatedRepos(patch: Partial<ResearchRepositories>): ResearchRepositories {
  return { ...repos, ...patch };
}

/** 只替换 analyses 读取（其余全真实）——用于制造「Run 提不出来」的负例。 */
const noAnalysesRepos = isolatedRepos({
  analyses: {
    ...repos.analyses,
    getById: async () => undefined,
  },
});

// ---------------------------------------------------------------------------
// 3. C1 真实创建
// ---------------------------------------------------------------------------

console.log("\n=== 3. C1 · createFromConclusion（真实落库）===");
const createdName = `${NAME_PREFIX}${target.title}`.slice(0, 200);
let candidateId = 0;
try {
  const view = await service.createFromConclusion({
    conclusionId: target.conclusionId,
    name: createdName,
  });
  candidateId = view.candidate.id as number;
  createdIds.push(candidateId);

  assert("C1 候选真实插入（获得 id）", Number.isInteger(candidateId) && candidateId > 0, `id=${candidateId}`);
  assert("C1 初始状态 = DRAFT", view.candidate.status === "DRAFT", String(view.candidate.status));
  assert(
    "C1 conclusionId / experimentId 正确",
    view.candidate.conclusionId === target.conclusionId && view.candidate.experimentId === target.experimentId,
    `conclusion=${String(view.candidate.conclusionId)} experiment=${String(view.candidate.experimentId)}`,
  );
  assert(
    "C1 sourceDatasetVersionId 正确复制自 Experiment",
    view.candidate.sourceDatasetVersionId === target.datasetVersionId,
    `${String(view.candidate.sourceDatasetVersionId)}`,
  );
  assert(
    "C1 sourceResearchRunId 与裸 SQL 独立结论一致",
    view.candidate.sourceResearchRunId === expectedRunId,
    `服务写入=${String(view.candidate.sourceResearchRunId)} / 裸 SQL 期望=${String(expectedRunId)}`,
  );
  assert(
    "C1 sourceDatasetDivergenceReason 保持 NULL（本 STEP 不转正 ⇒ 不该有差异原因）",
    view.candidate.sourceDatasetDivergenceReason === null ||
      view.candidate.sourceDatasetDivergenceReason === undefined,
    String(view.candidate.sourceDatasetDivergenceReason),
  );
  assert(
    "C1 strategyDefinitionId 仍为 NULL（未转正）",
    view.candidate.strategyDefinitionId === null || view.candidate.strategyDefinitionId === undefined,
    String(view.candidate.strategyDefinitionId),
  );

  const trace = view.candidate.sourceTraceJson as Record<string, unknown>;
  assert(
    "C1 sourceTraceJson 快照类型正确",
    trace?.snapshotKind === "research_conclusion_evidence",
    String(trace?.snapshotKind),
  );
  assert(
    "C1 快照内 primaryAnalysis 与真实 evidence 一致",
    (trace?.primaryAnalysis as Record<string, unknown> | null)?.analysisId === primaryAnalysisId,
    `trace=${String((trace?.primaryAnalysis as Record<string, unknown> | null)?.analysisId)} / evidence=${String(primaryAnalysisId)}`,
  );

  // 裸 SQL 复核：候选行**物理存在**于真实库
  const [rawRows] = await conn.query(
    "SELECT id, status, experimentId, conclusionId, sourceDatasetVersionId, sourceResearchRunId, " +
      "strategyDefinitionId, sourceTraceJson FROM research_strategy_candidate WHERE id = ?",
    [candidateId],
  );
  const raw = (rawRows as Array<Record<string, unknown>>)[0];
  assert("C1 裸 SQL 复核：行存在", raw !== undefined, `id=${candidateId}`);
  if (raw) {
    assert(
      "C1 裸 SQL 复核：落库字段与领域一致",
      Number(raw.sourceDatasetVersionId) === target.datasetVersionId &&
        Number(raw.status === "DRAFT") === 1 &&
        raw.strategyDefinitionId === null,
      `status=${String(raw.status)} sourceDatasetVersionId=${String(raw.sourceDatasetVersionId)} strategyDefinitionId=${String(raw.strategyDefinitionId)}`,
    );
    assert(
      "C1 裸 SQL 复核：sourceTraceJson 是合法 JSON 且含 runResolution",
      typeof raw.sourceTraceJson === "string" &&
        (JSON.parse(raw.sourceTraceJson) as Record<string, unknown>).runResolution !== undefined,
      "ok",
    );
  }
} catch (err) {
  bad("C1 createFromConclusion", String(err));
}

// ---------------------------------------------------------------------------
// 4. C2~C4 负例（必须零写入）
// ---------------------------------------------------------------------------

console.log("\n=== 4. C2~C4 · 负例（必须零写入）===");
const candidateCountBeforeNegatives = Number(
  ((await conn.query("SELECT COUNT(*) AS n FROM research_strategy_candidate")) as Array<
    Array<{ n: number }>
  >)[0][0].n,
);

await expectError(
  "C2 Conclusion 不存在",
  service.createFromConclusion({ conclusionId: 999999999 }),
  STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_FOUND,
);

await expectError(
  "C3 重复登记（同结论 + 同名）被拒",
  service.createFromConclusion({ conclusionId: target.conclusionId, name: createdName }),
  STRATEGY_CANDIDATE_ERROR.CANDIDATE_ALREADY_EXISTS,
);

const supersededService = service;
const [supersededRows] = await conn.query(
  "SELECT id FROM research_conclusion WHERE status = 'SUPERSEDED' ORDER BY id LIMIT 1",
);
if ((supersededRows as unknown[]).length > 0) {
  const supersededId = (supersededRows as Array<{ id: number }>)[0]!.id;
  await expectError(
    "C3b Conclusion 已被取代（SUPERSEDED）被拒",
    supersededService.createFromConclusion({ conclusionId: supersededId }),
    STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_CANDIDATE_ELIGIBLE,
  );
} else {
  ok("C3b SUPERSEDED 负例", "真实库当前无 SUPERSEDED 结论 ⇒ 该分支仅由单测覆盖（如实登记）");
}

// 数据集端口负例（其余全真实）
const missingPort: DatasetVersionReadPort = { getVersionById: async () => undefined };
await expectError(
  "C4 研究来源 Dataset Version 不存在 → DATASET_VERSION_NOT_FOUND",
  createStrategyCandidateService({ repos, datasetVersions: missingPort }).createFromConclusion({
    conclusionId: target.conclusionId,
    name: `${NAME_PREFIX}dataset-not-found`,
  }),
  STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND,
);

const notReadyPort: DatasetVersionReadPort = {
  getVersionById: async (id) => ({
    datasetVersionId: id,
    label: target.datasetLabel,
    status: "BUILDING",
    datasetId: 120001,
  }),
};
await expectError(
  "C4 研究来源 Dataset Version 未 READY → DATASET_VERSION_NOT_READY",
  createStrategyCandidateService({ repos, datasetVersions: notReadyPort }).createFromConclusion({
    conclusionId: target.conclusionId,
    name: `${NAME_PREFIX}dataset-not-ready`,
  }),
  STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY,
);

await expectError(
  "C4 overrides 携带 datasetVersionId → INVALID_INPUT",
  service.createFromConclusion({
    conclusionId: target.conclusionId,
    name: `${NAME_PREFIX}override-dataset`,
    overrides: { datasetVersionId: target.datasetVersionId } as never,
  }),
  STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
);

const candidateCountAfterNegatives = Number(
  ((await conn.query("SELECT COUNT(*) AS n FROM research_strategy_candidate")) as Array<
    Array<{ n: number }>
  >)[0][0].n,
);
assert(
  "C4 负例全过程零新增行",
  candidateCountAfterNegatives === candidateCountBeforeNegatives,
  `${candidateCountBeforeNegatives} → ${candidateCountAfterNegatives}`,
);

// ---------------------------------------------------------------------------
// 5. C5 update（白名单 + 越界零影响）
// ---------------------------------------------------------------------------

console.log("\n=== 5. C5 · update（真实落库 + 越界拒绝）===");
if (candidateId > 0) {
  const updated = await service.update(candidateId, {
    name: `${NAME_PREFIX}已改名`,
    description: "006.2 真实库验收改写",
  });
  assert("C5 草图字段真实更新", updated.name === `${NAME_PREFIX}已改名`, updated.name);
  const [rawAfterUpdate] = await conn.query(
    "SELECT name, status, sourceDatasetVersionId, sourceResearchRunId FROM research_strategy_candidate WHERE id = ?",
    [candidateId],
  );
  const row = (rawAfterUpdate as Array<Record<string, unknown>>)[0]!;
  assert(
    "C5 裸 SQL 复核：来源快照与状态未被 update 触碰",
    Number(row.sourceDatasetVersionId) === target.datasetVersionId &&
      String(row.status) === "DRAFT" &&
      (row.sourceResearchRunId === null || Number(row.sourceResearchRunId) === expectedRunId),
    JSON.stringify(row),
  );

  await expectError(
    "C5 update 携带 status → 拒绝",
    service.update(candidateId, { status: "ACCEPTED" } as never),
    STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
  );
  await expectError(
    "C5 update 携带 sourceResearchRunId → 拒绝",
    service.update(candidateId, { sourceResearchRunId: 1 } as never),
    STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
  );
  const [rawAfterReject] = await conn.query(
    "SELECT status, sourceResearchRunId FROM research_strategy_candidate WHERE id = ?",
    [candidateId],
  );
  const row2 = (rawAfterReject as Array<Record<string, unknown>>)[0]!;
  assert(
    "C5 越界拒绝后行内容零变化",
    String(row2.status) === "DRAFT" &&
      (row2.sourceResearchRunId === null || Number(row2.sourceResearchRunId) === expectedRunId),
    JSON.stringify(row2),
  );
} else {
  bad("C5 update", "C1 未创建候选，跳过");
}

// ---------------------------------------------------------------------------
// 6. C6 transition（含 CONVERTED 拒绝）
// ---------------------------------------------------------------------------

console.log("\n=== 6. C6 · transition（真实落库 + CONVERTED 拒绝）===");
if (candidateId > 0) {
  const moved = await service.transition({ candidateId, to: "REVIEW" });
  assert("C6 DRAFT → REVIEW 真实落库", moved.status === "REVIEW", moved.status);
  const [rawReview] = await conn.query(
    "SELECT status FROM research_strategy_candidate WHERE id = ?",
    [candidateId],
  );
  assert(
    "C6 裸 SQL 复核 REVIEW",
    String((rawReview as Array<Record<string, unknown>>)[0]!.status) === "REVIEW",
    "ok",
  );

  await expectError(
    "C6 🔴 REVIEW → CONVERTED 拒绝（须走 promote）",
    service.transition({ candidateId, to: "CONVERTED" }),
    STRATEGY_CANDIDATE_ERROR.CONVERSION_REQUIRES_PROMOTE,
  );
  await expectError(
    "C6 非法迁移 DRAFT 目标（未开放）→ TRANSITION_INVALID",
    service.transition({ candidateId, to: "DRAFT" }),
    STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
  );
  await service.transition({ candidateId, to: "ACCEPTED" });
  await expectError(
    "C6 🔴 ACCEPTED → CONVERTED 仍拒绝",
    service.transition({ candidateId, to: "CONVERTED" }),
    STRATEGY_CANDIDATE_ERROR.CONVERSION_REQUIRES_PROMOTE,
  );
  const [rawAccepted] = await conn.query(
    "SELECT status, strategyDefinitionId FROM research_strategy_candidate WHERE id = ?",
    [candidateId],
  );
  const row = (rawAccepted as Array<Record<string, unknown>>)[0]!;
  assert(
    "C6 CONVERTED 被拒后仍为 ACCEPTED 且未挂 strategyDefinitionId",
    String(row.status) === "ACCEPTED" && row.strategyDefinitionId === null,
    JSON.stringify(row),
  );
} else {
  bad("C6 transition", "C1 未创建候选，跳过");
}

// ---------------------------------------------------------------------------
// 7. C7 runId 提不出来 ⇒ NULL（真实 conclusion + 真实落库，仅劫持 analyses 读取）
// ---------------------------------------------------------------------------

console.log("\n=== 7. C7 · Run 无法解析 ⇒ NULL（不伪造）===");
try {
  const nullRunService = createStrategyCandidateService({
    repos: noAnalysesRepos,
    datasetVersions: registryPort,
  });
  const view = await nullRunService.createFromConclusion({
    conclusionId: target.conclusionId,
    name: `${NAME_PREFIX}run-unresolvable`,
  });
  createdIds.push(view.candidate.id as number);
  assert(
    "C7 sourceResearchRunId = NULL",
    view.candidate.sourceResearchRunId === null ||
      view.candidate.sourceResearchRunId === undefined,
    String(view.candidate.sourceResearchRunId),
  );
  const [rawNull] = await conn.query(
    "SELECT sourceResearchRunId, sourceTraceJson FROM research_strategy_candidate WHERE id = ?",
    [view.candidate.id],
  );
  const row = (rawNull as Array<Record<string, unknown>>)[0]!;
  assert(
    "C7 裸 SQL 复核 NULL + 快照如实记录 missingAnalysisIds",
    row.sourceResearchRunId === null &&
      JSON.stringify((JSON.parse(String(row.sourceTraceJson)) as Record<string, unknown>).runResolution).includes(
        "missingAnalysisIds",
      ),
    JSON.stringify(row.sourceResearchRunId),
  );
} catch (err) {
  bad("C7 runId NULL 分支", String(err));
}

// ---------------------------------------------------------------------------
// 8. 清理 + 行数守恒 + Strategy 零写入
// ---------------------------------------------------------------------------

console.log("\n=== 8. 自建自清 + 行数守恒 ===");
for (const id of createdIds) {
  try {
    await repos.candidates.delete(id);
  } catch (err) {
    bad(`清理候选 #${id}`, String(err));
  }
}
const [leftRows] = await conn.query(
  `SELECT id FROM research_strategy_candidate WHERE name LIKE ? OR name LIKE ?`,
  [`${NAME_PREFIX}%`, "%VERIFY-0062%"],
);
const leftover = leftRows as Array<{ id: number }>;
assert("自建自清：无残留候选行", leftover.length === 0, JSON.stringify(leftover));

const after = await snapshot();
const diff: Array<{ table: string; before: number; after: number }> = [];
for (const t of ROWCOUNT_TABLES) {
  if (before[t] !== after[t]) diff.push({ table: t, before: before[t]!, after: after[t]! });
}
assert("行数守恒：全部 21 张表前后一致", diff.length === 0, diff.length === 0 ? "21/21" : JSON.stringify(diff));
assert(
  "strategy_versions 始终 0 行（§28：本 STEP 绝不写 Strategy）",
  before.strategy_versions === 0 && after.strategy_versions === 0,
  `${before.strategy_versions} → ${after.strategy_versions}`,
);
assert(
  "strategies / strategy_version_datasets / strategy_research_provenance 均 0 行",
  after.strategies === 0 &&
    after.strategy_version_datasets === 0 &&
    after.strategy_research_provenance === 0,
  JSON.stringify({
    strategies: after.strategies,
    datasets: after.strategy_version_datasets,
    provenance: after.strategy_research_provenance,
  }),
);
assert(
  "research_conclusion 行数不变（只读引用用户既有结论）",
  before.research_conclusion === after.research_conclusion,
  `${before.research_conclusion} → ${after.research_conclusion}`,
);

console.log("\n=== 汇总 ===");
console.log(`checks: ${checks.length}，pass: ${checks.filter((c) => c.ok).length}，fail: ${failures.length}`);
const report = {
  pass: failures.length === 0,
  checks: checks.length,
  failed: failures,
  before,
  after,
  coordinates: target,
  expectedRunIdFromRawSql: expectedRunId,
  checksDetail: checks,
};
console.log(JSON.stringify({ pass: report.pass, checks: report.checks, failed: report.failed }, null, 2));

await conn.end();
if (failures.length > 0) process.exit(1);
