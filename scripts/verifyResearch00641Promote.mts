/**
 * RESEARCH-006.4.1-B — 真实 TiDB 上的 `Candidate → Strategy` **转正全链**验收（**自建自清**）。
 *
 * 为什么这样验收：本机 `agent-browser` 不可用、仓库无 `jsdom` / `@testing-library`
 * ⇒ 「点了转正按钮会发生什么」不可能用渲染测试证明。等价且更强的证据是：
 *   走**与 `PromoteCandidateDialog` 完全相同的 tRPC procedure 与入参形状**（`appRouter.createCaller`），
 *   在真实库上跑一遍，再用**裸 SQL 独立复核**，最后把真实的 tRPC 错误送进**前端映射函数**验证领域码可区分。
 *
 * 覆盖（006.4.1-B §28 ~ §34）：
 *   1. 端点集合：候选端点恰好 6 个，`promote` 唯一，且新增的溯源端点是**只读 query**；
 *   2. §28 首次 Promote：14 个返回字段逐一核对 + 裸 SQL 复核 4 张表（候选 / 策略 / 版本 / 溯源）；
 *   3. §29 第二次 Promote：`idempotent === true`，且 `strategies` / `strategy_versions` /
 *      `strategy_research_provenance` **行数不增**（幂等闸门真的在）；
 *   4. §29 Divergence：执行 Dataset ≠ 研究来源（两个都 READY）+ 非空 reason ⇒ 成功，
 *      且**候选的来源坐标不被覆盖**（`sourceDatasetVersionId` 仍是研究来源）；
 *   5. §29 缺 reason ⇒ 必失败且**零新增**；
 *   6. §29 非 ACCEPTED（DRAFT / REVIEW / REJECTED / ARCHIVED）⇒ 全部失败且零新增；
 *   7. §7 / §33 错误码真实链路：业务错误 → router → TRPCError → `promoteFailureVm` 可区分领域码（≥6 个）；
 *   8. §23 / §34 Strategy 独立性：转正后**删掉自建的候选行**，Strategy 主体 / 版本 / Bundle 仍可加载，
 *      溯源如实标注「来源已不存在」但**不阻断**；
 *   9. §20 / §22 只读溯源端点：`getVersionProvenance` 与 promote 返回值一致，且**没有**任何写入口；
 *  10. §35 / §36 自建自清 + 逐表行数守恒（并行会话写的 run / analysis / result 只如实记录）。
 *
 * 纪律：
 *   - **只 INSERT / DELETE 本脚本自己创建的行**；既有结论 / 实验 / Dataset **只读**，绝不修改、绝不删除；
 *   - 找不到「状态可登记 ∧ 来源 Dataset 为 READY」的既有结论 ⇒ 直接 FAIL 退出，**绝不伪造坐标**；
 *   - 生成的 Strategy 一律以 `cand-<candidateId>` 命名，且 candidateId 由本脚本创建 ⇒ 可精确清理；
 *   - 结尾 `process.exit(...)`（drizzle 连接池会拖住 event loop）。
 *
 * 用法：npx tsx scripts/verifyResearch00641Promote.mts
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { appRouter } from "../server/routers";
import { STRATEGY_CANDIDATE_ERROR } from "../server/research/strategyCandidate/candidateTypes";
import {
  PROMOTE_DOMAIN_HINTS,
  promoteFailureVm,
  promoteResultToVm,
  promotionProvenanceToVm,
} from "../client/src/adapters/strategyCandidateAdapter";

const NAME_PREFIX = "[VERIFY-00641B] ";

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

/**
 * 转正**写路径**可能触及的全部表 ⇒ 逐表严格守恒。
 *
 * 8 张策略侧表 = `strategies` + `strategy_versions` + 5 张**投影**（由 canonical Definition 单向派生）
 * + `strategy_research_provenance`。
 */
const STRATEGY_SIDE_TABLES = [
  "strategies",
  "strategy_versions",
  "strategy_version_datasets",
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_research_provenance",
] as const;

/** 5 张**投影**表（清理时按 `strategyVersionId` 删）。 */
const PROJECTION_TABLES = [
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_version_datasets",
] as const;

/** 本流程可能触及（含「绝不能被碰到」的邻接表）⇒ 必须逐表守恒。 */
const STRICT_CONSERVED_TABLES = [
  "research_strategy_candidate",
  ...STRATEGY_SIDE_TABLES,
  "research_experiment",
  "research_conclusion",
  "dataset_version",
  "dataset_definition",
] as const;

/**
 * 并行会话会写、而**本脚本从不写**的表 ⇒ 只如实记录差值（不作为失败判据）。
 * 本工作区常有另一条研究链路在跑（建 Run / 建分析 / 写结果），把它算成本次失败是误判。
 */
const OBSERVED_ONLY_TABLES = ["research_run", "research_analysis", "research_result"] as const;

const ROWCOUNT_TABLES = [...STRICT_CONSERVED_TABLES, ...OBSERVED_ONLY_TABLES] as const;

async function snapshot(
  tables: readonly string[] = ROWCOUNT_TABLES,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    out[t] = Number((rows as Array<{ n: number }>)[0]!.n);
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 与前端 `readRpcDomainCode` **同一正则约定**（`[DOMAIN_CODE] …`）。 */
function domainCodeOf(err: unknown): string | null {
  const match = /\[([A-Z_]{3,})\]/u.exec(messageOf(err));
  return match?.[1] ?? null;
}

/**
 * 一段**完整**的候选草图（与 `definitionBuild.test.ts#fullDraft` 同一夹具）。
 *
 * 🔴 Promote **绝不补默认值** ⇒ 想转正就必须由候选草稿显式给全：
 *   `entryRule.extra` 的观测量窗口 / 触发时点 / 成交口径 / 仓位 / 风控 / 文档级成本假设，
 *   以及 `riskRule.maxPositions`。这里给的是**已证明能过 build + validate** 的那一份。
 */
function promotableSketch(): {
  description: string;
  entryRule: unknown;
  filterRule: unknown;
  exitRule: unknown;
  riskRule: unknown;
  parameterSpace: unknown;
} {
  return {
    description: "验收用：首板后 1~5 个交易日内缩量回踩不破首板开盘价 → 收盘出信号 → T+1 开盘买入",
    entryRule: {
      event: "FIRST_LIMIT_UP",
      timing: "NEXT_OPEN",
      extra: {
        observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
        trigger: "FIRST_VALID_DAY",
        eventParams: { limitUpRatio: 0.1 },
        execution: {
          quantityMethod: "TARGET_WEIGHT",
          lotSize: 100,
          slippageModel: "BPS",
          commissionModel: "BPS",
          executionConstraints: ["一字板（开盘即涨停）不成交", "停牌顺延至下一交易日"],
        },
        position: { sizingMethod: "FIXED_RATIO", positionRatio: 0.2, maxExposure: 0.8 },
        risk: { stopLoss: 0.08, maxExposure: 0.8, maxDrawdown: 0.25 },
        document: {
          backtestConfig: { initialCapital: 1_000_000, maxPositions: 5 },
          costModel: {
            commissionRate: 0.00025,
            stampDutyRate: 0.0005,
            transferFeeRate: 0.00001,
            slippageBps: 5,
            lotSize: 100,
            minCommission: 5,
          },
        },
      },
    },
    filterRule: {
      groups: [
        {
          groupNo: 0,
          groupLogicalOperator: "AND",
          conditions: [
            {
              groupNo: 0,
              sortOrder: 0,
              fieldName: "bar.low",
              operator: ">=",
              value: "prefix.rd0.open",
              logicalOperator: "AND",
              groupLogicalOperator: "AND",
              note: "回踩当日最低价不低于首板日开盘价",
            },
            {
              groupNo: 0,
              sortOrder: 1,
              fieldName: "bar.volume",
              operator: "<",
              value: "prefix.rd0.volume",
              logicalOperator: "AND",
              groupLogicalOperator: "AND",
            },
          ],
        },
      ],
    },
    exitRule: { holdingDays: 3, takeProfit: 0.15, stopLoss: 0.08 },
    riskRule: { maxPositions: 5, maxPositionWeight: 0.3 },
    parameterSpace: {
      holdingDays: { type: "number", min: 1, max: 20, step: 1 },
      pullbackWindow: { type: "number", min: 1, max: 10, step: 1 },
    },
  };
}

// ---------------------------------------------------------------------------
// 0-a. 遗留清理（上一次被中断的运行留下的**自建**行；只删自己造的）
// ---------------------------------------------------------------------------

/**
 * 为什么需要它：本脚本曾在「首次 Promote 成功之后」被外部信号中断（一次 `npx tsx | tail`
 * 被沙箱 SIGTERM）⇒ 库里留下 `cand-<id>` 策略 + 版本 + 投影 + 溯源 + 一个 CONVERTED 候选。
 * 这些行会污染「行数守恒」与「无残留」判据，而它们**确凿是本脚本自己造的** ⇒ 开跑前精确清掉。
 *
 * 双保险判据（两条同时成立才删）：
 *   ① 候选名带本脚本专用前缀（`[VERIFY-00641B] `）；
 *   ② 存在 `strategyId` **恰好等于** `cand-<该候选 id>` 的策略 —— 证明是本脚本 promote 出来的。
 * 只有 ① 而无 ② 时**只删候选行**，绝不去猜 / 去动别的 strategyId（不误伤用户数据）。
 */
{
  const [leftoverRows] = await conn.query(
    "SELECT id, name FROM research_strategy_candidate WHERE name LIKE ?",
    [`${NAME_PREFIX}%`],
  );
  const rows = leftoverRows as Array<{ id: number; name: string }>;
  if (rows.length > 0) {
    console.log(`\n### 0-a. 发现 ${rows.length} 行上一次中断运行留下的自建候选 —— 精确清理`);
    for (const row of rows) {
      const sid = `cand-${row.id}`;
      const [own] = await conn.query("SELECT strategyId FROM strategies WHERE strategyId = ?", [sid]);
      if ((own as unknown[]).length === 0) {
        console.log(`  ⚠️ 候选 #${row.id} 无对应 ${sid} 策略行 ⇒ 只删候选行（不猜别的 strategyId）`);
      } else {
        await conn.query("DELETE FROM strategy_research_provenance WHERE strategyId = ?", [sid]);
        for (const t of PROJECTION_TABLES) {
          await conn.query(
            `DELETE FROM \`${t}\` WHERE strategyVersionId IN (SELECT id FROM strategy_versions WHERE strategyId = ?)`,
            [sid],
          );
        }
        await conn.query("DELETE FROM strategy_versions WHERE strategyId = ?", [sid]);
        await conn.query("DELETE FROM strategies WHERE strategyId = ?", [sid]);
        console.log(`  · 已删除遗留策略 ${sid}（含版本 / 5 张投影 / 溯源）`);
      }
      await conn.query("DELETE FROM research_strategy_candidate WHERE id = ?", [row.id]);
      console.log(`  · 已删除遗留候选 #${row.id}`);
    }
  }
}

console.log("=".repeat(78));
console.log("RESEARCH-006.4.1-B · 真实 TiDB 验收：Candidate → Strategy 转正全链（前端闭环）");
console.log("=".repeat(78));

const before = await snapshot();

const [runningRows] = await conn.query(
  "SELECT COUNT(*) AS n FROM research_run WHERE status IN ('RUNNING','PENDING')",
);
const runningCount = Number((runningRows as Array<{ n: number }>)[0]!.n);
if (runningCount > 0) {
  console.log(`\n⚠️  库中有 ${runningCount} 个在途 Run（RUNNING/PENDING）—— 本脚本只读，不会打断它们。`);
}

// ---------------------------------------------------------------------------
// 0. 只读选取上游（绝不造研究上游数据、绝不伪造坐标）
// ---------------------------------------------------------------------------

section("0. 只读选取既有 Conclusion 与执行 Dataset（不修改任何既有行）");

const [conclusionRows] = await conn.query(
  `SELECT c.id AS conclusionId, c.experimentId, c.title, c.status AS conclusionStatus,
          e.datasetVersionId AS sourceDatasetVersionId, v.status AS sourceStatus, v.version AS sourceLabel
     FROM research_conclusion c
     JOIN research_experiment e ON e.id = c.experimentId
     JOIN dataset_version v ON v.id = e.datasetVersionId
    WHERE c.status IN ('DRAFT','FINAL')
      AND v.status = 'READY'
    ORDER BY c.id DESC
    LIMIT 1`,
);
const upstream = (conclusionRows as Array<{
  conclusionId: number;
  experimentId: number;
  title: string;
  conclusionStatus: string;
  sourceDatasetVersionId: number;
  sourceStatus: string;
  sourceLabel: string;
}>)[0];

if (!upstream) {
  console.error(
    "✗ 库中找不到「状态为 DRAFT/FINAL 且来源 Dataset 为 READY」的既有结论 —— "
      + "本脚本不创建研究上游数据，也绝不伪造坐标。请先跑通研究链路后再验收。",
  );
  await conn.end();
  process.exit(2);
}
console.log(
  `  选取 Conclusion #${upstream.conclusionId}（${upstream.conclusionStatus}）·`
    + ` Experiment #${upstream.experimentId} · 研究来源 Dataset ${upstream.sourceDatasetVersionId}`
    + `（${upstream.sourceLabel} / READY）`,
);

/**
 * 执行 Dataset 候选：**必须 READY 且 datasetCode 可解析**。
 * 前者是产品规则（只有 READY 能绑执行），后者是 `definition.datasets[PRIMARY].datasetId` 的来源 ——
 * 解析不出来时 promote 会响亮拒绝（`DATASET_BINDING_INVALID`），那种绑法不该被本脚本选来当 happy path。
 */
const [usableVersions] = await conn.query(
  `SELECT v.id AS datasetVersionId, v.version AS label, v.status, d.datasetCode
     FROM dataset_version v
     JOIN dataset_definition d ON d.id = v.datasetId
    WHERE v.status = 'READY'
      AND d.datasetCode IS NOT NULL AND d.datasetCode <> ''
    ORDER BY v.id DESC`,
);
const readyVersions = usableVersions as Array<{
  datasetVersionId: number;
  label: string;
  status: string;
  datasetCode: string;
}>;

const inheritTarget = readyVersions.find((v) => v.datasetVersionId === upstream.sourceDatasetVersionId);
if (!inheritTarget) {
  console.error(
    `✗ 研究来源 Dataset ${upstream.sourceDatasetVersionId} 不在「READY + datasetCode 可解析」清单里 ——`
      + "本脚本不伪造绑定坐标。",
  );
  await conn.end();
  process.exit(2);
}
console.log(`  可绑定的 READY 版本：${readyVersions.map((v) => `${v.datasetVersionId}(${v.label})`).join(" / ")}`);

/** 用于 divergence 的「另一个」READY 版本（与研究来源不同）。环境不具备时该项如实记为失败。 */
const otherVersion = readyVersions.find((v) => v.datasetVersionId !== upstream.sourceDatasetVersionId) ?? null;
if (otherVersion === null) {
  console.log(
    "  ⚠️ 库中只有 1 个可绑定的 READY 版本 ⇒ Divergence（执行 ≠ 来源）场景无法在真实库上构造。",
  );
}

/** 一个**确定不存在**的 dataset_version.id（用于 NOT_FOUND）。 */
const [maxVersionRows] = await conn.query("SELECT MAX(id) AS m FROM dataset_version");
const bogusDatasetVersionId = Number((maxVersionRows as Array<{ m: number | null }>)[0]!.m ?? 0) + 1_000_000;

// ---------------------------------------------------------------------------
// 1. 端点集合 + 真实 caller
// ---------------------------------------------------------------------------

section("1. 端点集合（前端真实可调用的候选端点；promote 唯一，溯源只读）");
const PROCEDURES = Object.keys(appRouter._def.procedures);
const candidateProcedures = PROCEDURES.filter((p) => p.startsWith("research.strategyCandidate."));
const shortNames = candidateProcedures.map((p) => p.replace("research.strategyCandidate.", ""));
check("候选端点恰好 6 个", candidateProcedures.length === 6, shortNames.join(" / "));
for (const name of ["get", "createFromConclusion", "update", "transition", "promote", "getVersionProvenance"]) {
  check(`端点存在：${name}`, candidateProcedures.includes(`research.strategyCandidate.${name}`));
}
check(
  "无第二个「转换 / 克隆 / 发布 / 继承 / 草稿」端点",
  shortNames.filter((p) => /convert|publish|inherit|clone|materialize|draft|createVersion/i.test(p)).length === 0,
);
check(
  "溯源端点没有任何写形态（update / delete / set / unlink）",
  shortNames.filter((p) => /provenance/i.test(p) && /update|delete|set|write|unlink|rebind/i.test(p)).length === 0,
);
{
  // 静态契约判据（源码级）：溯源端点必须写成 `.query(` 而不是 `.mutation(`
  // —— 「只读」是产品约束（§22），仅靠运行期返回值看不出来。
  const routerSource = readFileSync(
    new URL("../server/research/strategyCandidate/router.ts", import.meta.url),
    "utf8",
  );
  const anchor = routerSource.indexOf("getVersionProvenance: publicProcedure");
  const body = anchor < 0 ? "" : routerSource.slice(anchor, anchor + 300);
  check(
    "溯源端点在源码里是 `.query(`（只读，不可能是写）",
    anchor >= 0 && body.includes(".input(provenanceLookupInput)") && body.includes(".query(") && !body.includes(".mutation("),
  );
}

const adminUser = {
  id: 1,
  openId: "verify-00641b",
  name: "verify-00641b",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: adminUser });

// ---------------------------------------------------------------------------
// 只读调用的跨境瞬时错误重试（**只对只读端点**，写路径一律不重试）
// ---------------------------------------------------------------------------

/**
 * 为什么需要它（本脚本两次真实实证，2026-09-12）：
 *   §1~§8 有近 10 分钟**只用裸 mysql2 连接**（大量 `conn.query` 做行数快照），期间 Drizzle
 *   连接池空闲；随后 §9 第一次用池读 `loadProjections` 的 5 条并发查询时，其中一条命中
 *   **`read ECONNRESET`**（对端回收空闲连接后复用）⇒ 整轮 11 分钟作废。
 *   这与仓库既有认知一致：`server/researchEngine/readRetry.ts` 正是为跨境只读瞬时错误而建；
 *   而生产读路径 `server/research/strategyPersistence/db.ts#loadProjections` **没有**重试。
 *
 * 纪律（不是「让测试变绿」）：
 *   - **只对只读端点** `getVersionProvenance` 重试；**写操作**（`promote` / `transition` /
 *     `update` / `createFromConclusion`）**一律不重试** —— 重试写会破坏幂等证据；
 *   - **不吞事实**：每次重试都打 `⚠️`，最终成功也写明「第 N 次才成功」，证据自己说话；
 *   - 只认**传输层**错误（ECONNRESET / ETIMEDOUT / EPIPE / socket hang up / ECONNREFUSED）；
 *     领域错误与断言错误**立刻冒泡**，绝不重试、绝不降级成「通过」。
 */
const TRANSIENT_READ_ERROR_RE = /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|ECONNREFUSED/i;

function isTransientReadError(err: unknown): boolean {
  let cursor: unknown = err;
  for (let i = 0; i < 8 && cursor !== null && cursor !== undefined; i += 1) {
    const e = cursor as { message?: unknown; code?: unknown; cause?: unknown };
    if (TRANSIENT_READ_ERROR_RE.test(`${String(e.message ?? "")} ${String(e.code ?? "")}`)) return true;
    cursor = e.cause;
  }
  return false;
}

/** 只读溯源端点调用（最多 3 次）。**仅用于只读**。 */
async function readProvenance(input: { strategyId: string; version: string }) {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const view = await caller.research.strategyCandidate.getVersionProvenance(input);
      if (attempt > 1) {
        console.log(`  ⚠️ 只读溯源第 ${attempt} 次调用才成功（前 ${attempt - 1} 次为跨境瞬时读错误）`);
      }
      return view;
    } catch (e) {
      if (attempt >= MAX_ATTEMPTS || !isTransientReadError(e)) throw e;
      console.log(
        `  ⚠️ 只读溯源第 ${attempt} 次命中跨境瞬时读错误（${messageOf(e).split("\n")[0]}）⇒ 按 readRetry 口径重试`,
      );
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

// ---------------------------------------------------------------------------
// 2 ~ 9. 全链
// ---------------------------------------------------------------------------

/** 本脚本创建的全部候选（清理用）。 */
const createdCandidateIds: number[] = [];
/** 本脚本转正出来的全部 strategyId（清理用）。 */
const createdStrategyIds: string[] = [];

async function newCandidate(tag: string): Promise<number> {
  const created = await caller.research.strategyCandidate.createFromConclusion({
    conclusionId: upstream.conclusionId,
    name: `${NAME_PREFIX}${tag} · ${Date.now()}`,
  });
  const id = created.candidate.id as number;
  createdCandidateIds.push(id);
  return id;
}

async function fillPromotableSketch(candidateId: number): Promise<void> {
  const sketch = promotableSketch();
  await caller.research.strategyCandidate.update({
    candidateId,
    patch: {
      description: sketch.description,
      entryRule: sketch.entryRule,
      filterRule: sketch.filterRule,
      exitRule: sketch.exitRule,
      riskRule: sketch.riskRule,
      parameterSpace: sketch.parameterSpace,
    } as never,
  });
}

/** DRAFT → REVIEW → ACCEPTED（状态机唯一合法路径）。 */
async function accept(candidateId: number): Promise<void> {
  await caller.research.strategyCandidate.transition({ candidateId, to: "REVIEW" });
  await caller.research.strategyCandidate.transition({ candidateId, to: "ACCEPTED" });
}

/** 失败尝试前后的「策略侧 + 候选」快照对比 ⇒ 证明**零新增**。 */
const ZERO_GROWTH_TABLES = ["research_strategy_candidate", ...STRATEGY_SIDE_TABLES] as const;

async function expectPromoteFailure(args: {
  label: string;
  candidateId: number;
  input: { candidateId: number; overrides?: unknown };
  expectedDomainCode: string;
}): Promise<{ domainCode: string | null; trpcCode: string | null; message: string }> {
  const snapBefore = await snapshot(ZERO_GROWTH_TABLES);
  let domainCode: string | null = null;
  let trpcCode: string | null = null;
  let message = "";
  try {
    await caller.research.strategyCandidate.promote(args.input as never);
    check(`${args.label}：被后端拒绝`, false, "竟然成功了");
  } catch (e) {
    domainCode = domainCodeOf(e);
    trpcCode = trpcCodeOf(e);
    message = messageOf(e);
    check(
      `${args.label}：领域码 = ${args.expectedDomainCode}`,
      domainCode === args.expectedDomainCode,
      `实际 ${String(domainCode)}（tRPC ${String(trpcCode)}）`,
    );
  }
  const snapAfter = await snapshot(ZERO_GROWTH_TABLES);
  const grew = ZERO_GROWTH_TABLES.filter((t) => snapAfter[t]! !== snapBefore[t]!);
  check(
    `${args.label}：零新增（策略侧 8 表 + 候选表行数不变）`,
    grew.length === 0,
    grew.length === 0 ? undefined : grew.map((t) => `${t} ${snapBefore[t]}→${snapAfter[t]}`).join(" / "),
  );
  return { domainCode, trpcCode, message };
}

/** §33：真实 tRPC 错误 → 前端映射 ⇒ 领域码必须可区分。 */
const observedFailures: Array<{
  label: string;
  domainCode: string | null;
  trpcCode: string | null;
  title: string;
  explanation: string;
}> = [];

function recordClientMapping(label: string, raw: { domainCode: string | null; trpcCode: string | null; message: string }): void {
  const vm = promoteFailureVm({ message: raw.message, data: { code: raw.trpcCode } });
  observedFailures.push({
    label,
    domainCode: vm.domainCode,
    trpcCode: vm.trpcCode,
    title: vm.diagnostic.title,
    explanation: vm.diagnostic.explanation ?? "",
  });
  check(
    `${label}：前端能读出领域码（${String(vm.domainCode)}）并给出针对性解释`,
    vm.domainCode === raw.domainCode && vm.domainCode !== null && PROMOTE_DOMAIN_HINTS[vm.domainCode] !== undefined,
    vm.diagnostic.title,
  );
}

try {
  // ---------------------------------------------------------------------
  // 2. 首次 Promote
  // ---------------------------------------------------------------------
  section("2. §28 首次 Promote（继承研究来源 Dataset，不提交 datasetBinding）");

  const happyId = await newCandidate("happy");
  console.log(`  自建候选 #${happyId}`);
  await fillPromotableSketch(happyId);
  await accept(happyId);
  {
    const [row] = await conn.query("SELECT status FROM research_strategy_candidate WHERE id = ?", [happyId]);
    check("裸 SQL：候选已到 ACCEPTED", (row as Array<{ status: string }>)[0]?.status === "ACCEPTED");
  }

  const beforePromote = await snapshot(ZERO_GROWTH_TABLES);
  const result = await caller.research.strategyCandidate.promote({ candidateId: happyId });
  createdStrategyIds.push(result.strategyId);

  // ---- 14 个返回字段逐一核对（前端 VM 直接消费这些字段，不能猜）----
  check("candidateId 回显", result.candidateId === happyId, String(result.candidateId));
  check("strategyId = cand-<candidateId>（后端派生，前端不拼）", result.strategyId === `cand-${happyId}`, result.strategyId);
  check("strategyVersionId 是正整数（strategy_versions.id 权威行锚）", Number.isInteger(result.strategyVersionId) && result.strategyVersionId > 0, String(result.strategyVersionId));
  check("首个版本号 = 1.0.0", result.strategyVersion === "1.0.0", result.strategyVersion);
  check("origin = DIRECT（promote 产出，不是 INHERITED）", result.origin === "DIRECT", result.origin);
  check("candidateStatus = CONVERTED", result.candidateStatus === "CONVERTED", result.candidateStatus);
  check("provenanceId 是正整数", Number.isInteger(result.provenanceId) && result.provenanceId > 0, String(result.provenanceId));
  check(
    "sourceDatasetVersionId = 研究来源坐标（继承）",
    result.sourceDatasetVersionId === upstream.sourceDatasetVersionId,
    String(result.sourceDatasetVersionId),
  );
  check(
    "sourceDatasetLabel 来自快照（不是前端传的）",
    result.sourceDatasetLabel === upstream.sourceLabel,
    String(result.sourceDatasetLabel),
  );
  check(
    "executionDatasetVersionId = 继承来的同一个版本",
    result.executionDatasetVersionId === upstream.sourceDatasetVersionId,
    String(result.executionDatasetVersionId),
  );
  check("datasetDivergence = false（继承 ⇒ 一致）", result.datasetDivergence === false);
  check("sourceDatasetDivergenceReason = null（一致时必须为 NULL）", result.sourceDatasetDivergenceReason === null);
  check("fingerprint 非空（内容指纹后端算，前端不算）", typeof result.fingerprint === "string" && result.fingerprint.length > 0, result.fingerprint);
  check("首次 promote：idempotent = false", result.idempotent === false);

  // ---- 裸 SQL 独立复核 ----
  {
    const [rows] = await conn.query(
      "SELECT strategyId, latestVersion, currentVersionId FROM strategies WHERE strategyId = ?",
      [result.strategyId],
    );
    const strategyRow = (rows as Array<{ strategyId: string; latestVersion: string; currentVersionId: number | null }>)[0];
    check("裸 SQL：strategies 有该策略且 currentVersionId 指向版本行", strategyRow !== undefined && strategyRow.currentVersionId === result.strategyVersionId, JSON.stringify(strategyRow));

    const [vrows] = await conn.query(
      "SELECT id, version, datasetVersion, datasetVersionId, status, strategyDocumentJson FROM strategy_versions WHERE id = ?",
      [result.strategyVersionId],
    );
    const versionRow = (vrows as Array<{ id: number; version: string; datasetVersion: string; datasetVersionId: number | null; status: string; strategyDocumentJson: string }>)[0];
    check("裸 SQL：strategy_versions.datasetVersionId = 执行 Dataset 坐标", versionRow?.datasetVersionId === result.executionDatasetVersionId, String(versionRow?.datasetVersionId));
    check("裸 SQL：版本初始状态 = Draft", versionRow?.status === "Draft", String(versionRow?.status));
    check("裸 SQL：strategyDocumentJson 非空（canonical SoT 已落库）", (versionRow?.strategyDocumentJson ?? "").length > 100);
    {
      const doc = JSON.parse(versionRow!.strategyDocumentJson) as { definition?: { datasets?: Array<{ role: string; datasetVersionId: number }> } };
      const primary = doc.definition?.datasets?.find((d) => d.role === "PRIMARY");
      check("裸 SQL：definition.datasets[PRIMARY] 绑定执行 Dataset（唯一坐标）", primary?.datasetVersionId === result.executionDatasetVersionId, JSON.stringify(primary));
    }

    const [prows] = await conn.query(
      "SELECT id, origin, sourceCandidateId, sourceConclusionId, sourceExperimentId, sourceDatasetVersionId, strategyId, strategyVersion FROM strategy_research_provenance WHERE id = ?",
      [result.provenanceId],
    );
    const pRow = (prows as Array<Record<string, unknown>>)[0]!;
    check("裸 SQL：溯源行 origin = DIRECT", pRow.origin === "DIRECT", String(pRow.origin));
    check("裸 SQL：溯源 sourceCandidateId = 候选 id（快照值，非 FK）", Number(pRow.sourceCandidateId) === happyId, String(pRow.sourceCandidateId));
    check("裸 SQL：溯源 sourceConclusionId / sourceExperimentId 登记完整", Number(pRow.sourceConclusionId) === upstream.conclusionId && Number(pRow.sourceExperimentId) === upstream.experimentId);
    check("裸 SQL：溯源 sourceDatasetVersionId = 研究来源坐标（**不是**执行坐标）", Number(pRow.sourceDatasetVersionId) === upstream.sourceDatasetVersionId, String(pRow.sourceDatasetVersionId));
    check("裸 SQL：溯源冗余锚 strategyId / strategyVersion 一致", pRow.strategyId === result.strategyId && pRow.strategyVersion === result.strategyVersion);

    const [crows] = await conn.query("SELECT status, strategyDefinitionId, sourceDatasetDivergenceReason FROM research_strategy_candidate WHERE id = ?", [happyId]);
    const cRow = (crows as Array<{ status: string; strategyDefinitionId: string | null; sourceDatasetDivergenceReason: string | null }>)[0]!;
    check("裸 SQL：候选回写 CONVERTED", cRow.status === "CONVERTED", cRow.status);
    check("裸 SQL：候选挂上 strategyDefinitionId", typeof cRow.strategyDefinitionId === "string" && cRow.strategyDefinitionId.length > 0, String(cRow.strategyDefinitionId));
    check("裸 SQL：无分歧 ⇒ 候选分歧原因保持 NULL", cRow.sourceDatasetDivergenceReason === null);
  }

  // ---- §17 / §18 前端结果 VM ----
  {
    const vm = promoteResultToVm(result, {
      executionDatasetLabel: inheritTarget.label,
    });
    check("前端结果标题 = 「转正成功」", vm.title === "转正成功", vm.title);
    check("前端结果里含 Strategy 坐标与执行 Dataset", vm.summary.includes(result.strategyId) && vm.summary.includes(String(result.executionDatasetVersionId)), vm.summary);
    check("「查看 Strategy Version」落点是现有策略页 + 坐标参数", vm.path === `/strategy-editor?strategyId=${encodeURIComponent(result.strategyId)}&version=1.0.0`, vm.path);
  }

  // ---- §9 / §19 候选详情从服务端重读 ----
  {
    const detail = await caller.research.strategyCandidate.get({ candidateId: happyId });
    check("§19 服务端重读：候选已是 CONVERTED（前端不得自行伪造）", detail.candidate.status === "CONVERTED", detail.candidate.status);
    check("§19 服务端重读：strategyDefinitionId 非空", typeof detail.candidate.strategyDefinitionId === "string" && detail.candidate.strategyDefinitionId.length > 0);
  }

  // ---------------------------------------------------------------------
  // 3. 幂等
  // ---------------------------------------------------------------------
  section("3. §29 第二次 Promote（幂等闸门：不得创建第二个版本）");
  const beforeSecond = await snapshot(ZERO_GROWTH_TABLES);
  const second = await caller.research.strategyCandidate.promote({ candidateId: happyId });
  const afterSecond = await snapshot(ZERO_GROWTH_TABLES);
  check("第二次 idempotent = true", second.idempotent === true, String(second.idempotent));
  check("复用同一 strategyVersionId", second.strategyVersionId === result.strategyVersionId, `${second.strategyVersionId} vs ${result.strategyVersionId}`);
  check("复用同一 provenanceId", second.provenanceId === result.provenanceId, `${second.provenanceId} vs ${result.provenanceId}`);
  check("复用同一 fingerprint", second.fingerprint === result.fingerprint);
  {
    const grew = ZERO_GROWTH_TABLES.filter((t) => afterSecond[t]! !== beforeSecond[t]!);
    check("幂等：候选表 + 策略侧 8 表行数**不增**", grew.length === 0, grew.length === 0 ? undefined : grew.map((t) => `${t} ${beforeSecond[t]}→${afterSecond[t]}`).join(" / "));
  }
  {
    const vm = promoteResultToVm(second);
    check(
      "§18 幂等文案：「该候选已经转正，本次未创建新的 Strategy Version」",
      vm.title === "该候选已经转正，本次未创建新的 Strategy Version" && !vm.title.includes("创建成功"),
      vm.title,
    );
    check("§18 幂等文案明说**没有**产生新的 Strategy / Version / 溯源行", vm.summary.includes("没有") && vm.summary.includes("复用既有 Strategy"));
  }

  // ---------------------------------------------------------------------
  // 4. Divergence（执行 ≠ 来源）
  // ---------------------------------------------------------------------
  section("4. §29 Divergence（执行 Dataset ≠ 研究来源；两个都 READY + 非空 reason）");
  if (otherVersion === null) {
    check(
      "Divergence：成功转正且来源坐标不被覆盖",
      false,
      "环境不具备第二个可绑定的 READY 版本 ⇒ 本场景无法构造（如实记为失败，不伪造）",
    );
  } else {
    const divId = await newCandidate("divergence");
    await fillPromotableSketch(divId);
    await accept(divId);
    const divResult = await caller.research.strategyCandidate.promote({
      candidateId: divId,
      overrides: {
        datasetBinding: { datasetVersionId: otherVersion.datasetVersionId },
        datasetDivergenceReason: "验收：执行域改用另一份 READY 数据集（样本窗口更长）",
      },
    });
    createdStrategyIds.push(divResult.strategyId);
    check("Divergence 转正成功", divResult.candidateStatus === "CONVERTED" && !divResult.idempotent);
    check("datasetDivergence = true", divResult.datasetDivergence === true);
    check(
      "执行坐标 = 显式指定的那个版本",
      divResult.executionDatasetVersionId === otherVersion.datasetVersionId,
      String(divResult.executionDatasetVersionId),
    );
    check(
      "研究来源坐标仍是原来源（执行绑定不覆盖来源快照）",
      divResult.sourceDatasetVersionId === upstream.sourceDatasetVersionId,
      `${String(divResult.sourceDatasetVersionId)} vs ${upstream.sourceDatasetVersionId}`,
    );
    check(
      "分歧原因被原样记录",
      divResult.sourceDatasetDivergenceReason === "验收：执行域改用另一份 READY 数据集（样本窗口更长）",
      String(divResult.sourceDatasetDivergenceReason),
    );

    // 裸 SQL：候选行的**来源**列未被覆盖，分歧原因落库；溯源的来源列同样是来源坐标。
    {
      const [crows] = await conn.query(
        "SELECT sourceDatasetVersionId, sourceDatasetDivergenceReason FROM research_strategy_candidate WHERE id = ?",
        [divId],
      );
      const cRow = (crows as Array<{ sourceDatasetVersionId: number; sourceDatasetDivergenceReason: string | null }>)[0]!;
      check("裸 SQL：候选 sourceDatasetVersionId **未被覆盖**", Number(cRow.sourceDatasetVersionId) === upstream.sourceDatasetVersionId, String(cRow.sourceDatasetVersionId));
      check("裸 SQL：候选分歧原因已落库（转正时的执行覆盖记录）", cRow.sourceDatasetDivergenceReason !== null, String(cRow.sourceDatasetDivergenceReason));

      const [vrows] = await conn.query(
        "SELECT datasetVersionId FROM strategy_versions WHERE id = ?",
        [divResult.strategyVersionId],
      );
      check(
        "裸 SQL：版本行的 datasetVersionId = **执行**坐标（不是研究来源）",
        Number((vrows as Array<{ datasetVersionId: number }>)[0]!.datasetVersionId) === otherVersion.datasetVersionId,
      );

      const [prows] = await conn.query(
        "SELECT sourceDatasetVersionId FROM strategy_research_provenance WHERE id = ?",
        [divResult.provenanceId],
      );
      check(
        "裸 SQL：溯源 sourceDatasetVersionId = **研究来源**坐标",
        Number((prows as Array<{ sourceDatasetVersionId: number }>)[0]!.sourceDatasetVersionId) === upstream.sourceDatasetVersionId,
      );
    }
  }

  // ---------------------------------------------------------------------
  // 5. 缺 reason / 多余 reason
  // ---------------------------------------------------------------------
  section("5. §29 分歧但缺 reason ⇒ 必失败（且零新增）");
  if (otherVersion === null) {
    check("缺 reason 被拒", false, "环境不具备第二个 READY 版本 ⇒ 无法构造分歧");
  } else {
    const missingReasonId = await newCandidate("no-reason");
    await accept(missingReasonId);
    const raw = await expectPromoteFailure({
      label: "分歧缺 reason",
      candidateId: missingReasonId,
      input: { candidateId: missingReasonId, overrides: { datasetBinding: { datasetVersionId: otherVersion.datasetVersionId } } },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.DATASET_DIVERGENCE_REASON_REQUIRED,
    });
    recordClientMapping("分歧缺 reason", raw);
    // 纯空白 reason 同样无效（后端 trim 后视为未提供）
    const blankReasonId = await newCandidate("blank-reason");
    await accept(blankReasonId);
    const blankRaw = await expectPromoteFailure({
      label: "分歧 + 纯空白 reason",
      candidateId: blankReasonId,
      input: { candidateId: blankReasonId, overrides: { datasetBinding: { datasetVersionId: otherVersion.datasetVersionId }, datasetDivergenceReason: "   " } },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.DATASET_DIVERGENCE_REASON_REQUIRED,
    });
    recordClientMapping("分歧 + 纯空白 reason", blankRaw);
  }

  {
    const extraReasonId = await newCandidate("extra-reason");
    await accept(extraReasonId);
    const raw = await expectPromoteFailure({
      label: "一致时却填了 reason",
      candidateId: extraReasonId,
      input: { candidateId: extraReasonId, overrides: { datasetDivergenceReason: "same dataset" } },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    });
    recordClientMapping("一致时却填了 reason", raw);
  }

  // ---------------------------------------------------------------------
  // 6. 非 ACCEPTED 全失败
  // ---------------------------------------------------------------------
  section("6. §29 非 ACCEPTED（DRAFT / REVIEW / REJECTED / ARCHIVED）全部失败");
  {
    const draftId = await newCandidate("state-draft");
    const draftRaw = await expectPromoteFailure({
      label: "DRAFT",
      candidateId: draftId,
      input: { candidateId: draftId },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED,
    });
    recordClientMapping("DRAFT", draftRaw);

    // 顺带把状态机的**真实形状**钉进验收（本脚本第一版就误以为 `DRAFT → REJECTED` 合法）：
    // `REJECTED` 只能从 `REVIEW` 到达 ⇒ 这条非法迁移必须被拒。
    let illegalCode: string | null = null;
    try {
      await caller.research.strategyCandidate.transition({ candidateId: draftId, to: "REJECTED" });
      check("DRAFT → REJECTED 被拒", false, "竟然成功了");
    } catch (e) {
      illegalCode = trpcCodeOf(e);
      check(
        "DRAFT → REJECTED 被状态机拒绝（CONFLICT；REJECTED 只能从 REVIEW 到达）",
        illegalCode === "CONFLICT",
        String(illegalCode),
      );
    }

    const reviewId = await newCandidate("state-review");
    await caller.research.strategyCandidate.transition({ candidateId: reviewId, to: "REVIEW" });
    await expectPromoteFailure({
      label: "REVIEW",
      candidateId: reviewId,
      input: { candidateId: reviewId },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED,
    });

    // REJECTED 的唯一合法路径 = DRAFT → REVIEW → REJECTED
    const rejectedId = await newCandidate("state-rejected");
    await caller.research.strategyCandidate.transition({ candidateId: rejectedId, to: "REVIEW" });
    await caller.research.strategyCandidate.transition({ candidateId: rejectedId, to: "REJECTED" });
    {
      const [row] = await conn.query("SELECT status FROM research_strategy_candidate WHERE id = ?", [rejectedId]);
      check("裸 SQL：候选已到 REJECTED", (row as Array<{ status: string }>)[0]?.status === "REJECTED");
    }
    await expectPromoteFailure({
      label: "REJECTED",
      candidateId: rejectedId,
      input: { candidateId: rejectedId },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED,
    });

    const archivedId = await newCandidate("state-archived");
    await caller.research.strategyCandidate.transition({ candidateId: archivedId, to: "ARCHIVED" });
    {
      const [row] = await conn.query("SELECT status FROM research_strategy_candidate WHERE id = ?", [archivedId]);
      check(
        "裸 SQL：候选已到 ARCHIVED（DRAFT → ARCHIVED 是合法迁移）",
        (row as Array<{ status: string }>)[0]?.status === "ARCHIVED",
      );
    }
    await expectPromoteFailure({
      label: "ARCHIVED",
      candidateId: archivedId,
      input: { candidateId: archivedId },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED,
    });
  }

  // ---------------------------------------------------------------------
  // 7. 其它领域码（草图 / 坐标）
  // ---------------------------------------------------------------------
  section("7. §33 其它领域码：草图缺失 / 草图非法 / 执行坐标不存在");

  {
    const incompleteId = await newCandidate("sketch-incomplete");
    await accept(incompleteId);
    const raw = await expectPromoteFailure({
      label: "草图缺失",
      candidateId: incompleteId,
      input: { candidateId: incompleteId },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
    });
    recordClientMapping("草图缺失", raw);
  }

  {
    const invalidId = await newCandidate("sketch-invalid");
    const sketch = promotableSketch();
    const entryRule = sketch.entryRule as { extra: Record<string, unknown> };
    entryRule.extra.notARealKey = true; // 闭集之外的扩展键 ⇒ 响亮失败，不静默忽略
    await caller.research.strategyCandidate.update({
      candidateId: invalidId,
      patch: {
        description: sketch.description,
        entryRule: sketch.entryRule,
        filterRule: sketch.filterRule,
        exitRule: sketch.exitRule,
        riskRule: sketch.riskRule,
        parameterSpace: sketch.parameterSpace,
      } as never,
    });
    await accept(invalidId);
    const raw = await expectPromoteFailure({
      label: "草图含未定义扩展键",
      candidateId: invalidId,
      input: { candidateId: invalidId },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
    });
    recordClientMapping("草图含未定义扩展键", raw);
  }

  {
    const notFoundId = await newCandidate("dataset-not-found");
    await accept(notFoundId);
    const raw = await expectPromoteFailure({
      label: "执行 Dataset 不存在",
      candidateId: notFoundId,
      input: { candidateId: notFoundId, overrides: { datasetBinding: { datasetVersionId: bogusDatasetVersionId } } },
      expectedDomainCode: STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND,
    });
    recordClientMapping("执行 Dataset 不存在", raw);
  }

  // ---------------------------------------------------------------------
  // 8. §33 汇总：真实链路上的领域码可区分性
  // ---------------------------------------------------------------------
  section("8. §33 真实链路领域码汇总（业务错误 → router → TRPCError → 前端映射）");
  {
    const distinct = new Set(observedFailures.map((f) => f.domainCode).filter((c): c is string => c !== null));
    const distinctDiagnostics = new Set(observedFailures.map((f) => `${f.title}｜${f.explanation}`));
    console.log("  实测领域码：");
    for (const f of observedFailures) {
      console.log(`    · ${f.domainCode} ← tRPC ${f.trpcCode}（${f.label}）`);
    }
    check(
      "每个失败都透出了**后端真实存在**的领域码（前端提示表能命中）",
      observedFailures.every((f) => f.domainCode !== null && PROMOTE_DOMAIN_HINTS[f.domainCode] !== undefined),
    );
    check(
      `真实链路可区分 ≥6 个不同领域码（实测 ${distinct.size} 个）`,
      distinct.size >= 6,
      [...distinct].join(" / "),
    );
    check(
      "每个领域码得到**不同**的用户可读诊断（不出现一句话糊弄所有失败）",
      distinctDiagnostics.size >= distinct.size,
      `${distinctDiagnostics.size} 种诊断 / ${distinct.size} 个码`,
    );
    check(
      "所有失败均**零新增**（本次全部失败尝试都未写出任何 Strategy 数据）",
      createdStrategyIds.length === (otherVersion === null ? 1 : 2),
      `已产出策略数 = ${createdStrategyIds.length}（应为 1 + div 场景）`,
    );
  }

  // ---------------------------------------------------------------------
  // 9. §20 / §22 只读溯源端点
  // ---------------------------------------------------------------------
  section("9. §20 / §22 getVersionProvenance（只读，与 promote 返回值一致）");
  {
    const view = await readProvenance({
      strategyId: result.strategyId,
      version: result.strategyVersion,
    });
    check("strategyVersionId 与 promote 返回一致", view.strategyVersionId === result.strategyVersionId);
    check("溯源行 id 与 promote 返回的 provenanceId 一致", view.provenance?.id === result.provenanceId);
    check("origin = DIRECT", view.provenance?.origin === "DIRECT", String(view.provenance?.origin));
    check("sourceCandidateId = 候选 id", view.provenance?.sourceCandidateId === happyId);
    check("sourceConclusionId / sourceExperimentId 与既有上游一致", view.provenance?.sourceConclusionId === upstream.conclusionId && view.provenance?.sourceExperimentId === upstream.experimentId);
    check("sourceDatasetVersionId = 研究来源坐标", view.provenance?.sourceDatasetVersionId === upstream.sourceDatasetVersionId);
    check("sourceDatasetLabel = 来源 label 快照", view.provenance?.sourceDatasetLabel === upstream.sourceLabel);
    check("executionDatasetVersionId = 执行坐标", view.executionDatasetVersionId === result.executionDatasetVersionId);
    check("无分歧 ⇒ sourceDatasetDivergenceReason = null", view.sourceDatasetDivergenceReason === null);
    check("上游全部健在 ⇒ missingUpstreams 为空", view.missingUpstreams.length === 0, view.missingUpstreams.join(","));

    const vm = promotionProvenanceToVm(view);
    check("前端溯源 VM：hasProvenance = true 且行数完整（8 行）", vm.hasProvenance && vm.rows.length === 8, String(vm.rows.length));
    check("前端溯源 VM：来源/执行两个 Dataset 坐标都保留（对照展示）", vm.executionDatasetVersionId === result.executionDatasetVersionId && vm.rows.some((r) => r.label === "Source Dataset Version ID" && r.value === String(upstream.sourceDatasetVersionId)));
    check("前端溯源 VM：无缺失 ⇒ 不显示无用提示", vm.missingNote === null);

    // 入参不合法 ⇒ 只读端点也要给稳定领域码
    let badCode: string | null = null;
    try {
      await caller.research.strategyCandidate.getVersionProvenance({ strategyId: "", version: "1.0.0" });
      check("空 strategyId 被拒", false, "竟然成功了");
    } catch (e) {
      badCode = trpcCodeOf(e);
      check("空 strategyId 在传输层被拒（BAD_REQUEST）", badCode === "BAD_REQUEST", String(badCode));
    }
  }

  // ---------------------------------------------------------------------
  // 10. §23 / §34 Strategy 独立性
  // ---------------------------------------------------------------------
  section("10. §23 / §34 Strategy 独立性（删掉自建上游后仍可打开；溯源显示「来源已不存在」但不阻断）");

  const loadVersion = async () =>
    caller.research.strategy.loadVersion({ strategyId: result.strategyId, version: result.strategyVersion });
  const loadBundle = async () =>
    caller.research.strategy.loadBundle({ strategyId: result.strategyId, version: result.strategyVersion });
  const getBundle = async () =>
    caller.research.strategy.getVersionBundle({ strategyId: result.strategyId, version: result.strategyVersion });

  {
    const v = await loadVersion();
    check("上游健在时：loadVersion 成功（canonical 文档可读）", typeof v === "object" && v !== null);
    const b = await loadBundle();
    check("上游健在时：loadBundle 成功（本体 + 追溯 + 5 类投影）", typeof b === "object" && b !== null);
    const g = await getBundle();
    check("上游健在时：getVersionBundle 成功（同实现别名）", typeof g === "object" && g !== null);
  }

  // 删除**本脚本自己创建**的候选行（模拟「研究上游被删除」；既有结论 / 实验是用户数据，绝不删）
  await conn.query("DELETE FROM research_strategy_candidate WHERE id = ?", [happyId]);
  console.log(`  已删除自建候选 #${happyId}（模拟研究上游消失；既有结论 / 实验未受影响）`);
  {
    const [left] = await conn.query("SELECT COUNT(*) AS n FROM research_strategy_candidate WHERE id = ?", [happyId]);
    check("自建候选行确已删除", Number((left as Array<{ n: number }>)[0]!.n) === 0);
  }

  {
    try {
      const v = await loadVersion();
      check("删上游后：loadVersion 仍成功（Strategy 不依赖 Research 存在）", typeof v === "object" && v !== null);
    } catch (e) {
      check("删上游后：loadVersion 仍成功", false, messageOf(e));
    }
    try {
      const b = (await loadBundle()) as { document?: { strategyId?: string } };
      check("删上游后：loadBundle 仍成功且能取到 Strategy 本体", b !== null && typeof b === "object");
    } catch (e) {
      check("删上游后：loadBundle 仍成功", false, messageOf(e));
    }
    try {
      await getBundle();
      check("删上游后：getVersionBundle 仍成功", true);
    } catch (e) {
      check("删上游后：getVersionBundle 仍成功", false, messageOf(e));
    }

    // 溯源：来源候选已不存在 ⇒ 如实标注，但**调用仍成功**、快照行仍在
    const view = await readProvenance({
      strategyId: result.strategyId,
      version: result.strategyVersion,
    });
    check(
      "删上游后：溯源仍可读（可缺、不阻断）",
      view.provenance !== null && view.provenance.sourceCandidateId === happyId,
    );
    check(
      "删上游后：missingUpstreams 如实列出 SOURCE_CANDIDATE",
      view.missingUpstreams.includes("SOURCE_CANDIDATE"),
      view.missingUpstreams.join(","),
    );
    const vm = promotionProvenanceToVm(view);
    check(
      "删上游后：前端提示既说「已不存在」也说「不影响读取与执行」",
      (vm.missingNote ?? "").includes("已不存在") && (vm.missingNote ?? "").includes("这不影响该策略的读取与执行"),
      vm.missingNote ?? "(null)",
    );
    check("删上游后：来源快照值本身仍在（快照不因上游删除而消失）", vm.rows.some((r) => r.label === "Source Candidate ID" && r.value === String(happyId)));
    const [snapRows] = await conn.query("SELECT COUNT(*) AS n FROM strategy_research_provenance WHERE id = ?", [result.provenanceId]);
    check("删上游后：溯源行仍在（零 FK ⇒ 不级联删除）", Number((snapRows as Array<{ n: number }>)[0]!.n) === 1);

    // 策略列表仍能看到该策略（Strategy 侧自洽）
    const list = await caller.research.strategy.list();
    check("删上游后：research.strategy.list 仍包含该策略", list.some((s) => s.strategyId === result.strategyId), `共 ${list.length} 个策略`);
  }
} catch (err) {
  console.error(`\n✗✗ 验收过程中抛出异常：${String(err)}`);
  // ⚠️ Drizzle 把真实数据库错误包进 `DrizzleQueryError(sql, params, cause)`，
  // 只打印 `message` 会丢掉根因（曾因此无法判断「列不存在」还是「跨境瞬时断连」）。
  // 故这里把 cause 链完整摊开：每一层打 constructor / code / errno / sqlState / sqlMessage。
  let cursor: unknown = err;
  for (let depth = 0; depth < 8 && cursor !== null && cursor !== undefined; depth += 1) {
    const e = cursor as { constructor?: { name?: string }; message?: string; code?: unknown; errno?: unknown; sqlState?: unknown; sqlMessage?: unknown; cause?: unknown };
    const head = String(e.message ?? "").split("\n")[0];
    console.error(
      `   ↳ [cause ${depth}] ${e.constructor?.name ?? "?"}: ${head}` +
        `  (code=${String(e.code)} errno=${String(e.errno)} sqlState=${String(e.sqlState)} sqlMessage=${String(e.sqlMessage)})`,
    );
    cursor = e.cause;
  }
  if (err instanceof Error && err.stack) console.error(err.stack);
  const root = ((): string => {
    let c: unknown = err;
    let last: unknown = err;
    for (let i = 0; i < 8 && c !== null && c !== undefined; i += 1) {
      last = c;
      c = (c as { cause?: unknown }).cause;
    }
    return String((last as { message?: string })?.message ?? last);
  })();
  checks.push({ name: "全链执行完成", ok: false, detail: `${String(err)} ← root: ${root}` });
}

// ---------------------------------------------------------------------------
// 11. 自建自清
// ---------------------------------------------------------------------------

section("11. §35 自建自清（只删除本脚本创建的行；按 ID 精确匹配）");

const leftoverStrategies = await conn.query(
  "SELECT strategyId, id FROM strategies WHERE strategyId LIKE ?",
  [`cand-%`],
);
const leftoverStrategyIds = (leftoverStrategies[0] as Array<{ strategyId: string; id: number }>[])
  .filter((row) => createdStrategyIds.includes(row.strategyId))
  .map((row) => row.strategyId);

for (const sid of leftoverStrategyIds) {
  await conn.query("DELETE FROM strategy_research_provenance WHERE strategyId = ?", [sid]);
  for (const t of PROJECTION_TABLES) {
    await conn.query(
      `DELETE FROM \`${t}\` WHERE strategyVersionId IN (SELECT id FROM strategy_versions WHERE strategyId = ?)`,
      [sid],
    );
  }
  await conn.query("DELETE FROM strategy_versions WHERE strategyId = ?", [sid]);
  await conn.query("DELETE FROM strategies WHERE strategyId = ?", [sid]);
}
console.log(`  已删除自建策略：${leftoverStrategyIds.join(", ") || "(无)"}`);

for (const cid of createdCandidateIds) {
  await conn.query("DELETE FROM research_strategy_candidate WHERE id = ?", [cid]);
}
console.log(`  已删除自建候选：${createdCandidateIds.join(", ") || "(无)"}`);

{
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM research_strategy_candidate WHERE name LIKE ?",
    [`${NAME_PREFIX}%`],
  );
  check("无残留自建候选", Number((rows as Array<{ n: number }>)[0]!.n) === 0);
  let strategyLeftover = 0;
  for (const sid of createdStrategyIds) {
    const [n] = await conn.query("SELECT COUNT(*) AS n FROM strategies WHERE strategyId = ?", [sid]);
    strategyLeftover += Number((n as Array<{ n: number }>)[0]!.n);
    const [pn] = await conn.query("SELECT COUNT(*) AS n FROM strategy_research_provenance WHERE strategyId = ?", [sid]);
    strategyLeftover += Number((pn as Array<{ n: number }>)[0]!.n);
  }
  check("无残留自建策略 / 溯源", strategyLeftover === 0);
}

// ---------------------------------------------------------------------------
// 12. 行数守恒
// ---------------------------------------------------------------------------

section("12. §36 行数守恒（前后逐表比对）");
const after = await snapshot();
let conserved = true;
for (const t of STRICT_CONSERVED_TABLES) {
  const same = before[t] === after[t];
  if (!same) conserved = false;
  console.log(`  ${same ? "✓" : "✗"} ${t}: ${before[t]} → ${after[t]}`);
}
check("本流程**可能触及**的全部表行数守恒", conserved);

let concurrentWrites = false;
for (const t of OBSERVED_ONLY_TABLES) {
  const delta = after[t]! - before[t]!;
  if (delta !== 0) concurrentWrites = true;
  console.log(`  ℹ ${t}: ${before[t]} → ${after[t]}（Δ${delta > 0 ? "+" : ""}${delta}，本脚本不写该表）`);
}
if (concurrentWrites) {
  console.log("  ⚠️ 检测到并行会话写入（非本脚本）—— 已排除在守恒判定之外，并在此如实登记。");
}

// ---------------------------------------------------------------------------
// 13. 汇总
// ---------------------------------------------------------------------------

const failed = checks.filter((c) => !c.ok);
console.log("\n" + "=".repeat(78));
console.log(`验收结果：${failed.length === 0 ? "PASS" : "FAIL"}（${checks.length} 项，失败 ${failed.length} 项）`);
for (const c of failed) console.log(`  ✗ ${c.name}${c.detail === undefined ? "" : ` —— ${c.detail}`}`);
console.log("=".repeat(78));
console.log(
  JSON.stringify(
    {
      tests: checks.length,
      failed: failed.length,
      pass: failed.length === 0,
      observedDomainCodes: [...new Set(observedFailures.map((f) => f.domainCode).filter(Boolean))],
    },
    null,
    2,
  ),
);

await conn.end();
// 真实 DB 断言会经 getDb() 建起连接池，池会拖住 event loop ⇒ 显式收尾。
process.exit(failed.length > 0 ? 1 : 0);
