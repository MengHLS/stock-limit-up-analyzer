/**
 * RESEARCH-006.4.1（Phase A）— 真实 TiDB 上的 `Conclusion → Candidate` 前端闭环验收（**自建自清**）。
 *
 * 为什么这样验收（本机 `agent-browser` 不可用、仓库无 jsdom）：
 *   前端组件**不可能**用渲染测试证明「点了按钮会发生什么」。等价且更强的证据是：
 *   走**与组件完全相同的 tRPC procedure 与入参形状**（`appRouter.createCaller`），
 *   在真实库上跑一遍，再用**裸 SQL 独立复核**。
 *
 * 覆盖（006.4.1 §17 的 Phase A 部分 + §16 的 Conclusion/Candidate UI 行为）：
 *   1. 前端调用的端点集合（5 个候选端点，转正入口唯一叫 promote）；
 *   2. `createFromConclusion`：组件只发 `{conclusionId, name?}`，其余由后端登记（实验 / 来源 Dataset / 证据快照）；
 *   3. `get`：详情页唯一数据源，来源三方 + label + sourceMissing 全部可解析；
 *   4. 重复登记 → CONFLICT，并验证**前端错误映射**产出的用户文案（模拟 HTTP 传输形态）；
 *   5. `update`：白名单草图真的落库；越界字段（status）/ 空补丁被拒且**零副作用**；
 *   6. `listCandidates`：候选列表页数据源能看到新候选；
 *   7. `transition`：DRAFT → REVIEW → ACCEPTED 落库；非法迁移被拒；
 *      **`CONVERTED` 经 transition 被专属码拒绝，且状态不变**（转正只能走 promote）；
 *   8. 全链**零 Strategy 写入**（Phase A 不碰 strategies / strategy_versions / 投影 / 溯源）；
 *   9. 自建自清 + 逐表行数守恒。
 *
 * 纪律：
 *   - 只读既有 Conclusion / Experiment / Dataset（**不造**研究上游数据），只 INSERT / DELETE 本脚本创建的候选行；
 *   - 找不到「状态可登记 ∧ 来源 Dataset 为 READY」的既有结论 ⇒ 直接 FAIL 退出，绝不伪造坐标；
 *   - 结尾 `process.exit(...)`（drizzle 连接池会拖住 event loop）。
 *
 * 用法：npx tsx scripts/verifyConclusionToCandidateFlow.mts
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { appRouter } from "../server/routers";
import { candidateErrorDiagnostic } from "../client/src/adapters/strategyCandidateAdapter";

const NAME_PREFIX = "[VERIFY-00641] ";

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

/** Phase A 明确**不该写**的表（Strategy 侧）。 */
const STRATEGY_SIDE_TABLES = [
  "strategies",
  "strategy_versions",
  "strategy_version_datasets",
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_research_provenance",
];

/**
 * 本流程**可能触及**的表 ⇒ 必须逐表守恒。
 * （候选写入只可能落在 `research_strategy_candidate`；其余为「绝不能被碰到」的邻接表。）
 */
const STRICT_CONSERVED_TABLES = [
  "research_experiment",
  "research_conclusion",
  "research_strategy_candidate",
  ...STRATEGY_SIDE_TABLES,
  "dataset_version",
  "dataset_definition",
];

/**
 * 并行会话会写、而**本脚本从不写**的表 ⇒ 只如实记录差值。
 * 本工作区常有另一条研究链路在跑（建 Run / 建分析 / 写结果），把它算成本次失败是误判。
 */
const OBSERVED_ONLY_TABLES = ["research_run", "research_analysis", "research_result"];

const ROWCOUNT_TABLES = [...STRICT_CONSERVED_TABLES, ...OBSERVED_ONLY_TABLES];

async function snapshot(tables: readonly string[] = ROWCOUNT_TABLES): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
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
function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` —— ${detail}`}`);
}

function section(title: string): void {
  console.log(`\n### ${title}`);
}

/** tRPC 语义 code（BAD_REQUEST / CONFLICT / ...）。 */
function trpcCodeOf(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/** 领域错误码在 cause 链上（tRPC 会包一层）。 */
function domainCodeOf(err: unknown): string | null {
  let cur: unknown = err;
  for (let i = 0; i < 8 && cur !== null && cur !== undefined; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("STRATEGY_CANDIDATE_")) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

console.log("=".repeat(78));
console.log("RESEARCH-006.4.1 · Phase A 真实 TiDB 验收：Conclusion → Candidate（前端闭环）");
console.log("=".repeat(78));

const before = await snapshot();
const strategyBefore = await snapshot(STRATEGY_SIDE_TABLES);

const [runningRows] = await conn.query(
  "SELECT COUNT(*) AS n FROM research_run WHERE status IN ('RUNNING','PENDING')",
);
const runningCount = Number((runningRows as Array<{ n: number }>)[0].n);
if (runningCount > 0) {
  console.log(`\n⚠️  库中有 ${runningCount} 个在途 Run（RUNNING/PENDING）—— 本脚本只读，不会打断它们。`);
}

// ---------------------------------------------------------------------------
// 0. 只读选取「可登记的既有结论」（不造研究上游数据）
// ---------------------------------------------------------------------------

section("0. 只读选取既有 Conclusion（状态可登记 ∧ 来源 Dataset 为 READY）");
const [conclusionRows] = await conn.query(
  `SELECT c.id AS conclusionId, c.experimentId, c.title, c.status AS conclusionStatus,
          e.datasetVersionId, v.status AS datasetStatus, v.version AS datasetLabel
     FROM research_conclusion c
     JOIN research_experiment e ON e.id = c.experimentId
     JOIN dataset_version v ON v.id = e.datasetVersionId
    WHERE c.status IN ('DRAFT','FINAL')
      AND v.status = 'READY'
    ORDER BY c.id DESC
    LIMIT 1`,
);
const target = (conclusionRows as Array<{
  conclusionId: number;
  experimentId: number;
  title: string;
  conclusionStatus: string;
  datasetVersionId: number;
  datasetStatus: string;
  datasetLabel: string;
}>)[0];

if (!target) {
  console.error(
    "✗ 库中找不到「状态为 DRAFT/FINAL 且来源 Dataset 为 READY」的既有结论 —— "
      + "本脚本不创建研究上游数据，也绝不伪造坐标。请先跑通研究链路后再验收。",
  );
  await conn.end();
  process.exit(2);
}
console.log(
  `  选取 Conclusion #${target.conclusionId}（${target.conclusionStatus}）·`
    + ` Experiment #${target.experimentId} · Dataset ${target.datasetVersionId}（${target.datasetLabel} / READY）`,
);

const [existCands] = await conn.query(
  "SELECT COUNT(*) AS n FROM research_strategy_candidate WHERE conclusionId = ?",
  [target.conclusionId],
);
console.log(`  该结论下既有候选：${Number((existCands as Array<{ n: number }>)[0].n)} 个（不会动它们）`);

// ---------------------------------------------------------------------------
// 1. 真实 tRPC caller（与组件完全同一条链路）
// ---------------------------------------------------------------------------

section("1. 端点集合（前端真实可调用的候选端点）");
const PROCEDURES = Object.keys(appRouter._def.procedures);
const candidateProcedures = PROCEDURES.filter((p) => p.startsWith("research.strategyCandidate."));
check(
  "候选端点恰好 5 个",
  candidateProcedures.length === 5,
  candidateProcedures.map((p) => p.replace("research.strategyCandidate.", "")).join(" / "),
);
for (const name of ["get", "createFromConclusion", "update", "transition", "promote"]) {
  check(`端点存在：${name}`, candidateProcedures.includes(`research.strategyCandidate.${name}`));
}
check(
  "无第二个「转换 / 克隆 / 发布 / 继承」端点",
  candidateProcedures.filter((p) => /convert|publish|inherit|clone|materialize|draft/i.test(p)).length === 0,
);

const adminUser = {
  id: 1,
  openId: "verify-00641",
  name: "verify-00641",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: adminUser });

// ---------------------------------------------------------------------------
// 2 ~ 8. 全链
// ---------------------------------------------------------------------------

const createdCandidateIds: number[] = [];
let candidateId = 0;
let uniqueName = "";
let uniqueName2 = "";

try {
  // ---- 2. Conclusion → Candidate（组件只发 conclusionId + 可选 name）----
  section("2. createFromConclusion（结论页「创建策略候选」的唯一路径）");
  uniqueName = `${NAME_PREFIX}${target.conclusionId} · ${Date.now()}`;
  uniqueName2 = `${NAME_PREFIX}${target.conclusionId} · B · ${Date.now()}`;

  const created = await caller.research.strategyCandidate.createFromConclusion({
    conclusionId: target.conclusionId,
    name: uniqueName,
  });
  candidateId = created.candidate.id as number;
  createdCandidateIds.push(candidateId);
  check("候选已创建并返回 id", Number.isInteger(candidateId) && candidateId > 0, `id=${candidateId}`);
  check("初始状态 = DRAFT（代码从不传 status）", created.candidate.status === "DRAFT", created.candidate.status);
  check(
    "conclusionId / experimentId 由后端登记（前端从不提交）",
    created.candidate.conclusionId === target.conclusionId && created.candidate.experimentId === target.experimentId,
  );
  check(
    "sourceDatasetVersionId 从 experiment 复制（唯一坐标 dataset_version.id）",
    created.candidate.sourceDatasetVersionId === target.datasetVersionId,
    `sourceDatasetVersionId=${String(created.candidate.sourceDatasetVersionId)}`,
  );
  check(
    "sourceTraceJson 是证据快照（非空）",
    created.candidate.sourceTraceJson !== null && created.candidate.sourceTraceJson !== undefined,
  );
  check(
    "草图五项初始为空（不伪造策略定义）",
    created.candidate.entryRule == null
      && created.candidate.filterRule == null
      && created.candidate.exitRule == null
      && created.candidate.riskRule == null
      && created.candidate.parameterSpace == null,
  );

  // ---- 3. get（详情页唯一数据源）----
  section("3. strategyCandidate.get（候选详情页唯一数据源）");
  const view = await caller.research.strategyCandidate.get({ candidateId });
  check("experiment 摘要可解析", view.experiment?.id === target.experimentId);
  check("conclusion 摘要可解析", view.conclusion?.id === target.conclusionId, view.conclusion?.title);
  check(
    "来源 Dataset label 来自 Registry（显示用，不是坐标）",
    view.dataset?.datasetVersionId === target.datasetVersionId && view.dataset?.label === target.datasetLabel,
    `label=${String(view.dataset?.label)}`,
  );
  check("sourceMissing 为空（来源三方都在）", view.sourceMissing.length === 0, view.sourceMissing.join(","));

  // ---- 4. 重复登记 + 前端错误文案 ----
  section("4. 重复登记 → CONFLICT（同一结论下候选名唯一）");
  let dupTrpcCode: string | null = null;
  let dupMsg = "";
  try {
    await caller.research.strategyCandidate.createFromConclusion({
      conclusionId: target.conclusionId,
      name: uniqueName,
    });
    check("重复登记被拒绝", false, "竟然成功了");
  } catch (e) {
    dupTrpcCode = trpcCodeOf(e);
    dupMsg = e instanceof Error ? e.message : String(e);
    check("重复登记被拒绝（CONFLICT）", dupTrpcCode === "CONFLICT", `${String(dupTrpcCode)}：${dupMsg}`);
  }
  // 模拟 HTTP 传输形态（tRPC httpBatchLink 把语义 code 放进 data.code）
  const dupDiagnostic = candidateErrorDiagnostic(
    { message: dupMsg, data: { code: dupTrpcCode } },
    "CREATE_FROM_CONCLUSION",
  );
  check(
    "前端把 CONFLICT 映射成可执行文案（含后端原文）",
    dupDiagnostic.title.includes("登记策略候选失败")
      && dupDiagnostic.explanation.includes("换一个候选名")
      && dupDiagnostic.explanation.includes("服务端说明"),
    dupDiagnostic.title,
  );
  const [dupRows] = await conn.query(
    "SELECT COUNT(*) AS n FROM research_strategy_candidate WHERE conclusionId = ? AND name = ?",
    [target.conclusionId, uniqueName],
  );
  check("重复登记**零新增行**", Number((dupRows as Array<{ n: number }>)[0].n) === 1);

  // ---- 5. update：白名单草图 ----
  section("5. update（白名单草图真的落库）");
  await caller.research.strategyCandidate.update({
    candidateId,
    patch: {
      description: "验收用描述",
      entryRule: { when: "first_board" },
      riskRule: { maxBoards: 3 },
      parameterSpace: { holdDays: [1, 2] },
    },
  });
  const [sketchRows] = await conn.query(
    "SELECT name, description, entryRuleJson, filterRuleJson, riskRuleJson, parameterSpaceJson, status "
      + "FROM research_strategy_candidate WHERE id = ?",
    [candidateId],
  );
  const sketch = (sketchRows as Array<Record<string, string | null>>)[0]!;
  check("裸 SQL：entryRule 已落库", JSON.stringify(JSON.parse(String(sketch.entryRuleJson))) === JSON.stringify({ when: "first_board" }));
  check("裸 SQL：未提交的 filterRule 仍为 NULL", sketch.filterRuleJson === null, String(sketch.filterRuleJson));
  check("裸 SQL：riskRule 已落库", String(sketch.riskRuleJson).includes("maxBoards"));
  check("裸 SQL：status 未被 update 改动", sketch.status === "DRAFT", String(sketch.status));
  check("裸 SQL：name 未被 update 改动", sketch.name === uniqueName, String(sketch.name));

  // ---- 6. update 越界 ----
  section("6. update 越界与空补丁（闭集白名单 / 不返回假成功）");
  let forbiddenCode: string | null = null;
  try {
    await caller.research.strategyCandidate.update({
      candidateId,
      // 越界：status 只能由状态机 / promote 写入
      patch: { status: "CONVERTED" } as never,
    });
    check("越界字段被拒", false, "竟然成功了");
  } catch (e) {
    forbiddenCode = trpcCodeOf(e);
    check("越界字段（status）在传输层被拒（BAD_REQUEST）", forbiddenCode === "BAD_REQUEST", String(forbiddenCode));
  }
  let emptyCode: string | null = null;
  try {
    await caller.research.strategyCandidate.update({ candidateId, patch: {} });
    check("空补丁被拒", false, "竟然成功了");
  } catch (e) {
    emptyCode = trpcCodeOf(e);
    check("空补丁被拒（BAD_REQUEST）", emptyCode === "BAD_REQUEST", String(emptyCode));
  }
  const [afterForbidden] = await conn.query(
    "SELECT status, description FROM research_strategy_candidate WHERE id = ?",
    [candidateId],
  );
  const forbiddenRow = (afterForbidden as Array<{ status: string; description: string | null }>)[0]!;
  check(
    "越界 / 空补丁请求**零副作用**",
    forbiddenRow.status === "DRAFT" && forbiddenRow.description === "验收用描述",
    `status=${forbiddenRow.status}`,
  );

  // ---- 7. 列表端点（候选列表页数据源）----
  section("7. researchEngine.listCandidates（候选列表页数据源）");
  const list = await caller.researchEngine.listCandidates({ experimentId: target.experimentId });
  check(
    "列表能看到刚登记的候选",
    list.some((c) => c.id === candidateId),
    `实验 #${target.experimentId} 下 ${list.length} 个候选`,
  );

  // ---- 8. 状态流转 ----
  section("8. transition（状态机：DRAFT → REVIEW → ACCEPTED）");
  await caller.research.strategyCandidate.transition({ candidateId, to: "REVIEW" });
  const [reviewRows] = await conn.query("SELECT status FROM research_strategy_candidate WHERE id = ?", [candidateId]);
  check("裸 SQL：已到 REVIEW", (reviewRows as Array<{ status: string }>)[0]?.status === "REVIEW");

  await caller.research.strategyCandidate.transition({ candidateId, to: "ACCEPTED" });
  const [acceptedRows] = await conn.query("SELECT status FROM research_strategy_candidate WHERE id = ?", [candidateId]);
  check("裸 SQL：已到 ACCEPTED", (acceptedRows as Array<{ status: string }>)[0]?.status === "ACCEPTED");

  let illegalCode: string | null = null;
  try {
    // ACCEPTED 只能到 CONVERTED / ARCHIVED ⇒ REJECTED 属非法迁移
    await caller.research.strategyCandidate.transition({ candidateId, to: "REJECTED" });
    check("非法迁移被拒", false, "竟然成功了");
  } catch (e) {
    illegalCode = trpcCodeOf(e);
    check("非法迁移 ACCEPTED → REJECTED 被拒（CONFLICT）", illegalCode === "CONFLICT", String(illegalCode));
  }

  section("9. transition 进入 CONVERTED 必须被拒（转正只能走 promote）");
  let convTrpcCode: string | null = null;
  let convDomainCode: string | null = null;
  let convMsg = "";
  try {
    await caller.research.strategyCandidate.transition({ candidateId, to: "CONVERTED" });
    check("transition → CONVERTED 被拒", false, "竟然成功了");
  } catch (e) {
    convTrpcCode = trpcCodeOf(e);
    convDomainCode = domainCodeOf(e);
    convMsg = e instanceof Error ? e.message : String(e);
    check("tRPC code = CONFLICT", convTrpcCode === "CONFLICT", String(convTrpcCode));
    check(
      "拒绝理由指向 promote()（架构裁定，不是普通非法迁移）",
      convMsg.includes("promote()"),
      convMsg.slice(0, 120),
    );
    // 实测发现（写入实施报告）：`toTrpcError` 只透传 message，**不带 cause**
    // ⇒ 领域错误码不跨 tRPC 边界；前端只能依赖 tRPC 语义 code + message。
    // 这正是 `strategyCandidateAdapter#candidateErrorDiagnostic` 按 tRPC code 映射的原因。
    console.log(
      `  ℹ 领域错误码在调用方不可见（cause 未透传）：domainCode=${String(convDomainCode)}；`
        + "前端映射只能按 tRPC code + message 做 —— 该观察已记入 Phase A 实施报告。",
    );
  }
  const [stillAccepted] = await conn.query("SELECT status, strategyDefinitionId FROM research_strategy_candidate WHERE id = ?", [candidateId]);
  const stillRow = (stillAccepted as Array<{ status: string; strategyDefinitionId: string | null }>)[0]!;
  check(
    "被拒后状态不变 ∧ 未挂 strategyDefinitionId（不伪造「已转正」）",
    stillRow.status === "ACCEPTED" && stillRow.strategyDefinitionId === null,
    `status=${stillRow.status}, strategyDefinitionId=${String(stillRow.strategyDefinitionId)}`,
  );

  // ---- 10. 同一结论下允许「不同名」的第二份候选 + 归档路径 ----
  section("10. 同一结论的第二份候选（不同名）+ DRAFT → ARCHIVED");
  const second = await caller.research.strategyCandidate.createFromConclusion({
    conclusionId: target.conclusionId,
    name: uniqueName2,
  });
  const candidateId2 = second.candidate.id as number;
  createdCandidateIds.push(candidateId2);
  check("第二份候选创建成功（同名才拒，不同名允许）", candidateId2 > 0 && candidateId2 !== candidateId, `id=${candidateId2}`);
  await caller.research.strategyCandidate.transition({ candidateId: candidateId2, to: "ARCHIVED" });
  const [archivedRows] = await conn.query("SELECT status FROM research_strategy_candidate WHERE id = ?", [candidateId2]);
  check("裸 SQL：DRAFT → ARCHIVED 生效", (archivedRows as Array<{ status: string }>)[0]?.status === "ARCHIVED");

  // ---- 11. 零 Strategy 写入 ----
  section("11. Phase A **零 Strategy 写入**（研究 → 策略的写路径此刻仍未接通）");
  const strategyAfter = await snapshot(STRATEGY_SIDE_TABLES);
  let strategyUntouched = true;
  for (const t of STRATEGY_SIDE_TABLES) {
    const same = strategyBefore[t] === strategyAfter[t];
    if (!same) strategyUntouched = false;
    console.log(`  ${same ? "✓" : "✗"} ${t}: ${strategyBefore[t]} → ${strategyAfter[t]}`);
  }
  check("策略侧 8 张表零变化", strategyUntouched);
} catch (err) {
  console.error(`\n✗✗ 验收过程中抛出异常：${String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  checks.push({ name: "全链执行完成", ok: false, detail: String(err) });
}

// ---------------------------------------------------------------------------
// 12. 自建自清
// ---------------------------------------------------------------------------

section("12. 自建自清（只删除本脚本创建的候选行）");
for (const cid of createdCandidateIds) {
  await conn.query("DELETE FROM research_strategy_candidate WHERE id = ?", [cid]);
}
console.log(`  ✓ 已删除候选 ${createdCandidateIds.join(", ") || "(无)"}（既有候选未受影响）`);
const leftovers = await conn.query(
  "SELECT COUNT(*) AS n FROM research_strategy_candidate WHERE name LIKE ?",
  [`${NAME_PREFIX}%`],
);
check("无残留自建候选", Number((leftovers[0] as Array<{ n: number }>)[0].n) === 0);

// ---------------------------------------------------------------------------
// 13. 行数守恒
// ---------------------------------------------------------------------------

section("13. 行数守恒（前后逐表比对）");
const after = await snapshot();
let conserved = true;
for (const t of STRICT_CONSERVED_TABLES) {
  const same = before[t] === after[t];
  if (!same) conserved = false;
  console.log(`  ${same ? "✓" : "✗"} ${t}: ${before[t]} → ${after[t]}`);
}
check("本流程**可能触及**的全部表行数守恒", conserved);

// 本工作区常有并行会话在跑研究链路（写 research_run / research_analysis / research_result）。
// 本脚本**从不写**这三张表 ⇒ 只如实记录差值，不把它算作本次验收的失败。
let concurrentWrites = false;
for (const t of OBSERVED_ONLY_TABLES) {
  const delta = after[t]! - before[t]!;
  if (delta !== 0) concurrentWrites = true;
  console.log(`  ℹ ${t}: ${before[t]} → ${after[t]}（Δ${delta > 0 ? "+" : ""}${delta}，本脚本不写该表）`);
}
if (concurrentWrites) {
  console.log("  ⚠️ 检测到并行会话写入（非本脚本）—— 已排除在守恒判定之外，并在此如实登记。");
}
check(
  "本脚本创建的行全部清除（无残留候选 / 无 Strategy 侧写入）",
  Number((leftovers[0] as Array<{ n: number }>)[0].n) === 0
    && STRATEGY_SIDE_TABLES.every((t) => before[t] === after[t]),
);

// ---------------------------------------------------------------------------
// 14. 汇总
// ---------------------------------------------------------------------------

const failed = checks.filter((c) => !c.ok);
console.log("\n" + "=".repeat(78));
console.log(`验收结果：${failed.length === 0 ? "PASS" : "FAIL"}（${checks.length} 项，失败 ${failed.length} 项）`);
for (const c of failed) console.log(`  ✗ ${c.name}${c.detail === undefined ? "" : ` —— ${c.detail}`}`);
console.log("=".repeat(78));
console.log(JSON.stringify({ tests: checks.length, failed: failed.length, pass: failed.length === 0 }, null, 2));

await conn.end();
// 真实 DB 断言会经 getDb() 建起连接池，池会拖住 event loop ⇒ 显式收尾。
process.exit(failed.length > 0 ? 1 : 0);
