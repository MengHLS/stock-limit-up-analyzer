/**
 * RESEARCH-006.3 — 真实 TiDB 上的 `Candidate → Strategy Promote` 全链验收（**自建自清**）。
 *
 * 目的（006.3 §42 ~ §45）：
 *   1. 走**完整真实链路**：登记候选（Conclusion）→ 填草稿 → `REVIEW` → `ACCEPTED` →
 *      `promote()` → Strategy + Strategy Version + canonical definition + Dataset Binding +
 *      provenance + 候选 `CONVERTED`，全部落**真实库**；
 *   2. 用**裸 SQL 独立复核**（不拿 Service 自己的返回值当证据）；
 *   3. **行数证明**：第一次 promote 相关表各 +1，第二次 promote **全都不再增加**（幂等）；
 *   4. 证明零越界：`strategy_versions` 只由 promote 路径产生，`research_strategy_candidate`
 *      的 `status` 只能经状态机 + promote 走到 `CONVERTED`。
 *
 * 纪律：
 *   - 只 INSERT / DELETE **本脚本自己创建**的行（实验名带 `[VERIFY-0063]` 前缀，按 id 精确删除）；
 *   - Dataset 侧**只读**（`dataset_version` / `dataset_definition` 仅 SELECT，绝不创建 / 绝不补）；
 *   - 找不到 READY 且可解出 `datasetCode` 的 `dataset_version` ⇒ **直接 FAIL 退出**，不伪造坐标；
 *   - 若库中有在途 Run（`RUNNING` / `PENDING`）会**显著告警**（本脚本只读它们，不会打断）。
 *
 * 用法：npx tsx scripts/verifyStrategyCandidatePromote.mts
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { createDbResearchRepositories } from "../server/researchCore/repository/db";
import type { ResearchRepositories } from "../server/researchCore/repository/contract";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { RegistryDatasetVersionReadPort } from "../server/research/strategyCandidate/datasetVersionPort";
import { createStrategyPromotionPort } from "../server/research/strategyCandidate/strategyPromotionPort";
import { DbStrategyResearchProvenanceRepository } from "../server/research/strategyCandidate/provenance";
import {
  createStrategyCandidateService,
  type StrategyCandidateService,
} from "../server/research/strategyCandidate/service";
import { composeCodeVersion } from "../server/research/experimentLineage/codeVersion";

const NAME_PREFIX = "[VERIFY-0063] ";

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
  "research_run",
  "research_analysis",
  "research_conclusion",
  "research_strategy_candidate",
  "strategies",
  "strategy_versions",
  "strategy_version_datasets",
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_research_provenance",
  "dataset_version",
  "dataset_definition",
];

async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ROWCOUNT_TABLES) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    out[t] = Number((rows as Array<{ n: number }>)[0].n);
  }
  return out;
}

async function countWhere(table: string, where: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params);
  return Number((rows as Array<{ n: number }>)[0].n);
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

// ---------------------------------------------------------------------------
// 0. 前置：既有数据只读体检
// ---------------------------------------------------------------------------

console.log("=".repeat(78));
console.log("RESEARCH-006.3 · 真实 TiDB 验收：Candidate → Strategy Promote");
console.log("=".repeat(78));

const before = await snapshot();

const [runningRows] = await conn.query(
  "SELECT COUNT(*) AS n FROM research_run WHERE status IN ('RUNNING','PENDING')",
);
const runningCount = Number((runningRows as Array<{ n: number }>)[0].n);
if (runningCount > 0) {
  console.log(
    `\n⚠️  库中有 ${runningCount} 个在途 Run（RUNNING/PENDING）—— 本脚本只读，不会打断它们。`,
  );
}

section("0. 只读选取执行 Dataset（唯一坐标 dataset_version.id）");
const [dsRows] = await conn.query(
  `SELECT v.id AS datasetVersionId, v.datasetId, v.version AS label, v.status,
          d.datasetCode AS datasetCode
     FROM dataset_version v
     JOIN dataset_definition d ON d.id = v.datasetId
    WHERE v.status = 'READY'
    ORDER BY v.id DESC
    LIMIT 2`,
);
const datasetRows = dsRows as Array<{
  datasetVersionId: number;
  datasetId: number;
  label: string;
  status: string;
  datasetCode: string;
}>;
if (datasetRows.length === 0) {
  console.error(
    "✗ 库中找不到 status='READY' 且能解出 datasetCode 的 dataset_version —— "
      + "无法验证执行绑定（本脚本不创建 Dataset，绝不伪造坐标）。",
  );
  process.exit(2);
}
const primaryDataset = datasetRows[0];
const secondaryDataset = datasetRows.find(
  (r) => r.datasetVersionId !== primaryDataset.datasetVersionId
    && r.datasetCode === primaryDataset.datasetCode,
);
console.log(
  `  执行 Dataset 坐标：id=${primaryDataset.datasetVersionId}`
    + `（${primaryDataset.datasetCode} @ ${primaryDataset.label}，${primaryDataset.status}）`,
);
// 同 Dataset 的第二份 READY 版本（用于验证「研究 ≠ 执行」的分歧路径；没有就跳过，不算失败）
console.log(
  secondaryDataset === undefined
    ? "  （同 Dataset 无第二份 READY 版本 ⇒ divergence 路径本次不跑真实库，已由单测覆盖）"
    : `  另一份同 Dataset 版本：id=${secondaryDataset.datasetVersionId}（${secondaryDataset.label}）`,
);

// ---------------------------------------------------------------------------
// 1. 自建研究侧（Experiment → Conclusion）
// ---------------------------------------------------------------------------

section("1. 自建研究侧登记录（自带 [VERIFY-0063] 标记，结束时精确删除）");
const repos: ResearchRepositories = createDbResearchRepositories();
const experiment = await repos.experiments.create({
  datasetVersionId: primaryDataset.datasetVersionId,
  name: `${NAME_PREFIX}首板回踩（Promote 全链验收）`,
  researchType: "EVENT_STUDY",
  status: "COMPLETED",
});
const experimentId = experiment.id as number;
const conclusion = await repos.conclusions.create({
  experimentId,
  conclusionType: "SUPPORTED",
  title: `${NAME_PREFIX}首板回踩不破首板开盘价`,
  conclusion: "回踩不破组与跌破组在 future_return_20d 上存在方向性差异。",
  confidence: 0.8,
});
const conclusionId = conclusion.id as number;
console.log(`  experimentId=${experimentId} conclusionId=${conclusionId}`);

// ---------------------------------------------------------------------------
// 2. 装配真实 Service（与 researchRouter 同口径注入 codeVersion）
// ---------------------------------------------------------------------------

function resolveCodeVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return composeCodeVersion({
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      git: { commitShortHash: null, dirty: null },
    });
  } catch {
    return "unknown";
  }
}

const CODE_VERSION = resolveCodeVersion();
const strategyRepo = new DbStrategyRepository();
const provenanceRepo = new DbStrategyResearchProvenanceRepository();
const service: StrategyCandidateService = createStrategyCandidateService({
  repos,
  datasetVersions: new RegistryDatasetVersionReadPort(),
  strategies: createStrategyPromotionPort({ codeVersion: CODE_VERSION }),
  provenance: provenanceRepo,
});

/** 完整可转正的草稿（Research 侧字段；promote 不从 overrides 接受定义，见 006.3 §4）。 */
function draft() {
  return {
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
          executionConstraints: ["一字板（开盘即涨停）不成交"],
        },
        position: { sizingMethod: "FIXED_RATIO", positionRatio: 0.2, maxExposure: 0.8 },
        risk: { stopLoss: 0.08, maxDrawdown: 0.25 },
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
            },
          ],
        },
      ],
    },
    exitRule: { holdingDays: 3, takeProfit: 0.15, stopLoss: 0.08 },
    riskRule: { maxPositions: 5, maxPositionWeight: 0.3 },
    parameterSpace: { holdingDays: { type: "number", min: 1, max: 20, step: 1 } },
  } as never;
}

const createdStrategyIds: string[] = [];
/** 本脚本创建过的候选 id（含 divergence 分支），收尾时逐个精确删除。 */
const extraCandidateIds: number[] = [];
let candidateId = 0;

try {
  // -------------------------------------------------------------------------
  // 3. 登记 → 填草稿 → REVIEW → ACCEPTED（promote 的前置三态）
  // -------------------------------------------------------------------------
  section("2. 登记候选并推到 ACCEPTED（promote 的状态门槛）");
  const view = await service.createFromConclusion({ conclusionId });
  candidateId = view.candidate.id as number;
  check("候选已登记（DRAFT）", view.candidate.status === "DRAFT", `candidateId=${candidateId}`);
  check(
    "研究来源坐标复制自 Experiment（唯一 Dataset 坐标）",
    view.candidate.sourceDatasetVersionId === primaryDataset.datasetVersionId,
    `sourceDatasetVersionId=${String(view.candidate.sourceDatasetVersionId)}`,
  );

  await service.update(candidateId, draft());
  await service.transition({ candidateId, to: "REVIEW" });
  const accepted = await service.transition({ candidateId, to: "ACCEPTED" });
  check("状态到达 ACCEPTED", accepted.status === "ACCEPTED", `status=${accepted.status}`);

  const [candBeforePromote] = await conn.query(
    "SELECT status, strategyDefinitionId FROM research_strategy_candidate WHERE id = ?",
    [candidateId],
  );
  const beforeRow = (candBeforePromote as Array<{ status: string; strategyDefinitionId: string | null }>)[0];
  check(
    "裸 SQL：转正前 status=ACCEPTED 且未挂 strategyDefinitionId",
    beforeRow?.status === "ACCEPTED" && beforeRow?.strategyDefinitionId === null,
    `status=${beforeRow?.status} strategyDefinitionId=${String(beforeRow?.strategyDefinitionId)}`,
  );

  // -------------------------------------------------------------------------
  // 4. 第一次 promote —— 全链
  // -------------------------------------------------------------------------
  section("3. 第一次 promote：Strategy + Version + Definition + Binding + Provenance + CONVERTED");
  const first = await service.promote({ candidateId });
  createdStrategyIds.push(first.strategyId);
  console.log("  promote 返回：");
  console.log(
    JSON.stringify(
      {
        candidateId: first.candidateId,
        strategyId: first.strategyId,
        strategyVersionId: first.strategyVersionId,
        strategyVersion: first.strategyVersion,
        provenanceId: first.provenanceId,
        sourceDatasetVersionId: first.sourceDatasetVersionId,
        executionDatasetVersionId: first.executionDatasetVersionId,
        datasetDivergence: first.datasetDivergence,
        origin: first.origin,
        fingerprint: first.fingerprint,
        idempotent: first.idempotent,
      },
      null,
      2,
    )
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );

  check("origin = DIRECT（本 STEP 只做 DIRECT，无 INHERITED）", first.origin === "DIRECT");
  check("初始版本号 = 1.0.0", first.strategyVersion === "1.0.0");
  check("idempotent=false（本次是真写入）", first.idempotent === false);
  check(
    "缺省继承：执行绑定 = 研究来源坐标",
    first.executionDatasetVersionId === first.sourceDatasetVersionId,
    `${String(first.executionDatasetVersionId)} == ${String(first.sourceDatasetVersionId)}`,
  );
  check("缺省继承：divergence=false 且原因为 NULL", first.datasetDivergence === false && first.sourceDatasetDivergenceReason === null);

  // ---- 裸 SQL 独立复核（不用 Service 的返回值当证据）----
  section("4. 裸 SQL 独立复核（绕过应用层）");
  const [verRows] = await conn.query(
    `SELECT id, strategyId, version, fingerprint, status, datasetVersion, datasetVersionId, universeId, codeVersion,
            JSON_EXTRACT(strategyDocumentJson, '$.definition.entry.event.type') AS eventType,
            JSON_EXTRACT(strategyDocumentJson, '$.definition.execution.executionTiming') AS execTiming,
            JSON_EXTRACT(strategyDocumentJson, '$.definition.exit.rules[0].type') AS exitRule0
       FROM strategy_versions WHERE strategyId = ?`,
    [first.strategyId],
  );
  const versionRows = verRows as Array<Record<string, unknown>>;
  check("strategy_versions 恰好 1 行", versionRows.length === 1, `rows=${versionRows.length}`);
  const vrow = versionRows[0];
  check("版本 id 与 promote 返回一致", Number(vrow?.id) === first.strategyVersionId, `id=${String(vrow?.id)}`);
  check("指纹与 promote 返回一致", String(vrow?.fingerprint) === first.fingerprint);
  check(
    "canonical definition 落库（event / executionTiming / 首条出场规则均可从 JSON 直接读出）",
    vrow?.eventType === "FIRST_LIMIT_UP"
      && vrow?.execTiming === "T_PLUS_1_OPEN"
      && vrow?.exitRule0 === "STOP_LOSS",
    `event=${String(vrow?.eventType)} execTiming=${String(vrow?.execTiming)} exit0=${String(vrow?.exitRule0)}`,
  );
  check(
    "doc 级 Dataset 坐标 = 执行绑定坐标",
    Number(vrow?.datasetVersionId) === first.executionDatasetVersionId,
    `${String(vrow?.datasetVersionId)} == ${String(first.executionDatasetVersionId)}`,
  );
  check("版本初始状态 = Draft（C-21.1 genesis 白名单）", vrow?.status === "Draft", `status=${String(vrow?.status)}`);
  check(
    "universeId = research-dataset:<label>（与 Dataset 派生口径一致）",
    String(vrow?.universeId) === `research-dataset:${primaryDataset.label}`,
    String(vrow?.universeId),
  );

  const bindingRows = await countWhere(
    "strategy_version_datasets",
    "strategyVersionId = ?",
    [first.strategyVersionId],
  );
  check("strategy_version_datasets 有 1 条 PRIMARY 绑定（由 definition 单向派生）", bindingRows >= 1, `rows=${bindingRows}`);

  const [provRows] = await conn.query(
    `SELECT id, strategyVersionId, strategyId, strategyVersion, sourceCandidateId, sourceConclusionId,
            sourceExperimentId, sourceResearchRunId, sourceDatasetVersionId, sourceDatasetLabel, origin
       FROM strategy_research_provenance WHERE sourceCandidateId = ?`,
    [candidateId],
  );
  const provRow = (provRows as Array<Record<string, unknown>>)[0];
  check("provenance 恰好 1 行（sourceCandidateId 唯一闸门）", (provRows as unknown[]).length === 1);
  check("provenance.id 与 promote 返回一致", Number(provRow?.id) === first.provenanceId);
  check("provenance.strategyVersionId = 本次版本行 id", Number(provRow?.strategyVersionId) === first.strategyVersionId);
  check(
    "provenance 四个来源锚齐全（candidate / conclusion / experiment / datasetVersion）",
    Number(provRow?.sourceCandidateId) === candidateId
      && Number(provRow?.sourceConclusionId) === conclusionId
      && Number(provRow?.sourceExperimentId) === experimentId
      && Number(provRow?.sourceDatasetVersionId) === primaryDataset.datasetVersionId,
  );
  check("provenance.origin = DIRECT", provRow?.origin === "DIRECT", String(provRow?.origin));

  const [candAfterRows] = await conn.query(
    "SELECT status, strategyDefinitionId, sourceDatasetDivergenceReason FROM research_strategy_candidate WHERE id = ?",
    [candidateId],
  );
  const candAfter = (candAfterRows as Array<{
    status: string;
    strategyDefinitionId: string | null;
    sourceDatasetDivergenceReason: string | null;
  }>)[0];
  check("裸 SQL：候选 status=CONVERTED", candAfter?.status === "CONVERTED", `status=${candAfter?.status}`);
  check(
    "裸 SQL：strategyDefinitionId 指向本次策略",
    candAfter?.strategyDefinitionId === first.strategyId,
    String(candAfter?.strategyDefinitionId),
  );
  check(
    "裸 SQL：无 divergence 时原因为 NULL（不许填占位文本）",
    candAfter?.sourceDatasetDivergenceReason === null,
  );

  // -------------------------------------------------------------------------
  // 5. 行数证明 + 第二次 promote（幂等）
  // -------------------------------------------------------------------------
  section("5. 行数证明：第一次 +1，第二次**全都不再增加**");
  const afterFirst = {
    strategies: await countWhere("strategies", "strategyId = ?", [first.strategyId]),
    strategy_versions: await countWhere("strategy_versions", "strategyId = ?", [first.strategyId]),
    strategy_version_datasets: await countWhere("strategy_version_datasets", "strategyId = ?", [first.strategyId]),
    strategy_parameters: await countWhere("strategy_parameters", "strategyId = ?", [first.strategyId]),
    strategy_entry_rules: await countWhere("strategy_entry_rules", "strategyId = ?", [first.strategyId]),
    strategy_exit_rules: await countWhere("strategy_exit_rules", "strategyId = ?", [first.strategyId]),
    strategy_execution_rules: await countWhere("strategy_execution_rules", "strategyId = ?", [first.strategyId]),
    strategy_research_provenance: await countWhere("strategy_research_provenance", "strategyId = ?", [first.strategyId]),
  };
  console.log("  第一次 promote 后（按 strategyId 计数）：");
  for (const [k, v] of Object.entries(afterFirst)) console.log(`    ${k} = ${v}`);
  check("strategies = 1", afterFirst.strategies === 1, String(afterFirst.strategies));
  check("strategy_versions = 1", afterFirst.strategy_versions === 1, String(afterFirst.strategy_versions));
  check(
    "五类投影里至少 dataset binding / parameters / entry / exit / execution 有行",
    afterFirst.strategy_version_datasets >= 1
      && afterFirst.strategy_parameters >= 1
      && afterFirst.strategy_entry_rules >= 1
      && afterFirst.strategy_exit_rules >= 1
      && afterFirst.strategy_execution_rules >= 1,
  );
  check("provenance = 1", afterFirst.strategy_research_provenance === 1, String(afterFirst.strategy_research_provenance));

  const second = await service.promote({ candidateId });
  const afterSecond = {
    strategy_versions: await countWhere("strategy_versions", "strategyId = ?", [first.strategyId]),
    strategy_version_datasets: await countWhere("strategy_version_datasets", "strategyId = ?", [first.strategyId]),
    strategy_research_provenance: await countWhere("strategy_research_provenance", "strategyId = ?", [first.strategyId]),
  };
  check("第二次 promote 标记 idempotent=true", second.idempotent === true);
  check("第二次仍返回同一 strategyVersionId", second.strategyVersionId === first.strategyVersionId);
  check("第二次仍返回同一 provenanceId", second.provenanceId === first.provenanceId);
  const noGrowth = Object.entries(afterSecond).every(
    ([k, v]) => v === afterFirst[k as keyof typeof afterFirst],
  );
  console.log("  第二次 promote 后：");
  for (const [k, v] of Object.entries(afterSecond)) {
    console.log(`    ${k} = ${v}（第一次 ${afterFirst[k as keyof typeof afterFirst]}）`);
  }
  check("第二次 promote **没有**产生任何新行", noGrowth);

  // -------------------------------------------------------------------------
  // 6. 可选：同 Dataset 的第二份 READY 版本 → divergence 真实库路径
  // -------------------------------------------------------------------------
  section("6. divergence 路径（研究来源 ≠ 执行绑定）");
  if (secondaryDataset === undefined) {
    console.log("  SKIP：同 Dataset 无第二份 READY 版本（单测已覆盖该分支）");
  } else {
    // ⚠️ 同一 Conclusion 下的候选名必须唯一（既有不变量）⇒ 第二份候选显式改名。
    const view2 = await service.createFromConclusion({
      conclusionId,
      name: `${NAME_PREFIX}首板回踩（研究 v2 / 执行 v3 的 divergence 用例）`,
    });
    const candidateId2 = view2.candidate.id as number;
    await service.update(candidateId2, draft());
    await service.transition({ candidateId: candidateId2, to: "REVIEW" });
    await service.transition({ candidateId: candidateId2, to: "ACCEPTED" });

    const reason = "研究在旧版本上验证机制，执行改用同 Dataset 的更新版本（更长窗口）";
    const div = await service.promote({
      candidateId: candidateId2,
      overrides: {
        datasetBinding: { datasetVersionId: secondaryDataset.datasetVersionId },
        datasetDivergenceReason: reason,
      },
    });
    createdStrategyIds.push(div.strategyId);
    check("divergence=true", div.datasetDivergence === true);
    check(
      "执行绑定 = 指定版本，来源坐标保持原样",
      div.executionDatasetVersionId === secondaryDataset.datasetVersionId
        && div.sourceDatasetVersionId === primaryDataset.datasetVersionId,
    );
    const [divCandRows] = await conn.query(
      "SELECT status, sourceDatasetDivergenceReason FROM research_strategy_candidate WHERE id = ?",
      [candidateId2],
    );
    const divCand = (divCandRows as Array<{ status: string; sourceDatasetDivergenceReason: string | null }>)[0];
    check("裸 SQL：原因已按人可读文本落列", divCand?.sourceDatasetDivergenceReason === reason, String(divCand?.sourceDatasetDivergenceReason));
    check("裸 SQL：候选 status=CONVERTED", divCand?.status === "CONVERTED", String(divCand?.status));
    const [divProv] = await conn.query(
      "SELECT sourceDatasetVersionId, origin FROM strategy_research_provenance WHERE sourceCandidateId = ?",
      [candidateId2],
    );
    const divProvRow = (divProv as Array<{ sourceDatasetVersionId: number; origin: string }>)[0];
    check(
      "provenance 记的是**研究来源**坐标（不是执行绑定）",
      Number(divProvRow?.sourceDatasetVersionId) === primaryDataset.datasetVersionId,
      `sourceDatasetVersionId=${String(divProvRow?.sourceDatasetVersionId)}`,
    );
    check("divergence 行 origin = DIRECT", divProvRow?.origin === "DIRECT");
    // 记录第二个 candidate，便于清理
    extraCandidateIds.push(candidateId2);
  }
} catch (err) {
  console.error(`\n✗✗ 验收过程中抛出异常：${String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  checks.push({ name: "全链执行完成", ok: false, detail: String(err) });
}

// ---------------------------------------------------------------------------
// 7. 自建自清
// ---------------------------------------------------------------------------

section("7. 自建自清（精确按 id / strategyId 删除本脚本创建的行）");
{
  const [provCandidateRows] = await conn.query(
    "SELECT DISTINCT sourceCandidateId FROM strategy_research_provenance WHERE strategyId LIKE 'cand-%' "
      + "AND sourceCandidateId IN (SELECT id FROM research_strategy_candidate WHERE conclusionId = ?)",
    [conclusionId],
  );
  for (const r of provCandidateRows as Array<{ sourceCandidateId: number }>) {
    if (!extraCandidateIds.includes(Number(r.sourceCandidateId))) extraCandidateIds.push(Number(r.sourceCandidateId));
  }
  if (candidateId > 0 && !extraCandidateIds.includes(candidateId)) extraCandidateIds.push(candidateId);

  for (const sid of createdStrategyIds) {
    await conn.query("DELETE FROM strategy_research_provenance WHERE strategyId = ?", [sid]);
    for (const t of [
      "strategy_version_datasets",
      "strategy_parameters",
      "strategy_entry_rules",
      "strategy_exit_rules",
      "strategy_execution_rules",
      "strategy_versions",
      "strategies",
    ]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE strategyId = ?`, [sid]);
    }
    console.log(`  ✓ 已删除策略 ${sid}（含溯源与 5 类投影）`);
  }
  for (const cid of extraCandidateIds) {
    await conn.query("DELETE FROM research_strategy_candidate WHERE id = ?", [cid]);
  }
  console.log(`  ✓ 已删除候选 ${extraCandidateIds.join(", ") || "(无)"}`);
  await conn.query("DELETE FROM research_conclusion WHERE id = ?", [conclusionId]);
  await conn.query("DELETE FROM research_experiment WHERE id = ?", [experimentId]);
  console.log(`  ✓ 已删除 conclusion ${conclusionId} / experiment ${experimentId}`);
}

// ---------------------------------------------------------------------------
// 8. 行数守恒
// ---------------------------------------------------------------------------

section("8. 行数守恒（前后逐表比对）");
const after = await snapshot();
let conserved = true;
for (const t of ROWCOUNT_TABLES) {
  const same = before[t] === after[t];
  if (!same) conserved = false;
  console.log(`  ${same ? "✓" : "✗"} ${t}: ${before[t]} → ${after[t]}`);
}
check("全部相关表行数守恒", conserved);

const leftovers = await countWhere(
  "research_experiment",
  "name LIKE ?",
  [`${NAME_PREFIX}%`],
);
check("无残留的自建实验行", leftovers === 0, `leftovers=${leftovers}`);

// ---------------------------------------------------------------------------
// 9. 汇总
// ---------------------------------------------------------------------------

const failed = checks.filter((c) => !c.ok);
console.log("\n" + "=".repeat(78));
console.log(`验收结果：${failed.length === 0 ? "PASS" : "FAIL"}（${checks.length} 项，失败 ${failed.length} 项）`);
for (const c of failed) console.log(`  ✗ ${c.name}${c.detail === undefined ? "" : ` —— ${c.detail}`}`);
console.log("=".repeat(78));
console.log(JSON.stringify({ tests: checks.length, failed: failed.length, pass: failed.length === 0 }, null, 2));

await conn.end();
// 真实 DB 断言可能已让 getDb() 建起连接池，池会拖住 event loop ⇒ 显式收尾。
process.exit(failed.length > 0 ? 1 : 0);
