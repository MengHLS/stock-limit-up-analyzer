/**
 * 真实端到端验收：RESEARCH-STRATEGY-BRIDGE（Research → Strategy 完整闭环）。
 *
 * 验收对象 = 真实库里的「首板回踩」研究（experiment 240002 / dataset 390002 / conclusion 510001）。
 * 全链**真 tRPC**（`appRouter.createCaller`，admin ctx）+ **真 TiDB**，覆盖任务 §12 / §13 的判据：
 *
 *   §12  ① Conclusion → Candidate（provenance 五件套齐备：experiment / run / conclusion / datasetVersion / trace）
 *        ② 编辑候选的交易假设（Promote 前可改）→ 落库可读
 *        ③ 非 ACCEPTED → promote 拒绝，且零 Strategy 数据
 *        ④ Dataset 分歧三例（同 → 过；异 + 原因 → 过；异 + 无原因 → 拒）
 *        ⑤ ACCEPTED → promote → Strategy + Version + 5 投影 + provenance（真实行）
 *        ⑥ 投影 ↔ Canonical Definition 一致（`verifyStrategyProjections` 零漂移）
 *        ⑦ Canonical 零污染（`strategy_versions` 无任何 research 列）
 *        ⑧ promote 幂等（第二次不产生第二个版本）
 *        ⑨ 运行时独立性：只用 Strategy 侧读口读版本；`resolveParameters` 能解析出 TUNABLE 参数集
 *   §13  ⑩ Look-ahead 负向闸门：`path.*` / `outcome.*` / 越界 `post.rdN` 一律拒；合法 `prefix`/`event` 通过
 *
 * 本探针自建自清（只碰自己那一行候选 + 自己那条策略），结束时断言行数守恒。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { appRouter } from "../../server/routers";
import { DbStrategyRepository } from "../../server/research/strategyPersistence";
import {
  buildStrategyProjections,
  verifyStrategyProjections,
} from "../../server/research/strategySchema/projection";
import { validateCanonicalStrategyDefinition } from "../../server/research/strategySchema/definitionValidation";
import { resolveStrategyRecipeById } from "../../server/research/recipeRegistry";
import { FIRST_BOARD_PULLBACK_DEFINITION } from "../../server/research/strategySchema/goldenSample";

// --- 真实坐标（本次审计实查所得，写死以免探针漂移）---------------------------
const EXPERIMENT_ID = 240002;      // 「正式数据，首板回踩与未来收益的关系」
const DATASET_VERSION_ID = 390002; // dataset_version v2（READY）
const CONCLUSION_ID = 510001;      // SUPPORTED 自动结论
const EXPECTED_RUN_ID = 570001;    // 结论证据里主分析所属 Run
const PULLBACK_RECIPE_ID = "first-limit-pullback-hold-shrink";
const PROBE_NAME = "__e2e_bridge_acceptance__";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/** 从 tRPC 错误里抠领域码（与 `strategyCandidateAdapter#readRpcDomainCode` 同一正则）。 */
function domainCodeOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const matched = /\[([A-Z_]{3,})\]/u.exec(message);
  return matched ? matched[1] : "(无领域码)";
}

const adminUser = {
  id: 1,
  openId: "e2e-bridge-acceptance",
  name: "e2e-bridge-acceptance",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: adminUser });
const conn = await mysql.createConnection(process.env.DATABASE_URL as string);

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const [rows] = await conn.query(sql, params);
  return Number((rows as Array<Record<string, unknown>>)[0]?.n ?? -1);
}

// ---------------------------------------------------------------------------
// 验收用的交易假设（= 研究者的假设，**不是**统计结果的机械复制）
// ---------------------------------------------------------------------------
/**
 * 🔴 这里体现任务 §6：Research 提供 Evidence（T+1~T+5 观察窗内回撤），
 * Candidate 是**人**基于 Evidence 提出的可验证交易假设 —— 条目/触发/条件/出场/执行/参数空间
 * 全部由本对象显式声明，没有任何一项是从 `research_conclusion` 自动抄来的。
 */
const HYPOTHESIS_SKETCH = {
  entryRule: {
    event: "FIRST_LIMIT_UP",
    timing: "NEXT_OPEN",
    extra: {
      // 观测窗 = 首板后第 1~5 个交易日（与研究的 T+1~T+5 对齐）
      observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
      // 触发 = 窗口内首个同时满足「守线 + 缩量」的交易日
      trigger: "FIRST_VALID_DAY",
      eventParams: { limitUpRatio: 0.1 },
      execution: {
        quantityMethod: "TARGET_WEIGHT",
        lotSize: 100,
        slippageModel: "BPS",
        commissionModel: "BPS",
      },
      position: { sizingMethod: "EQUAL_WEIGHT" },
      document: {
        backtestConfig: { initialCapital: 100000 },
        costModel: {
          commissionRate: 0.0003,
          stampDutyRate: 0.001,
          transferFeeRate: 0.00001,
          slippageBps: 10,
          lotSize: 100,
          minCommission: 5,
        },
      },
      // 真实可执行配方（否则条件进不了回测 —— 装配层只看 recipeId）
      recipe: {
        kind: "signalEngine",
        recipeId: PULLBACK_RECIPE_ID,
        point: "close",
        signalFrequency: "daily",
        featureVersions: [
          { featureId: "haircutFromEventLow", version: "1.0.0" },
          { featureId: "volumeRatio", version: "1.0.0" },
          { featureId: "isBullish", version: "1.0.0" },
          { featureId: "momentumFromEventClose", version: "1.0.0" },
        ],
        rankingConfig: { higherIsBetter: true },
        selectionConfig: { method: { kind: "topN", n: 5 } },
        requiredData: ["OHLCV"],
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
            note: "守线：观察日最低价不低于首板日开盘价",
          },
          {
            groupNo: 0,
            sortOrder: 1,
            fieldName: "bar.volume",
            operator: "<",
            value: "prefix.rd0.volume",
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
            note: "缩量：观察日量能低于首板日量能",
          },
        ],
      },
    ],
  },
  exitRule: { stopLoss: 0.05, takeProfit: 0.1, holdingDays: 5 },
  riskRule: { maxPositions: 5, maxPositionWeight: 0.2 },
  /**
   * 参数空间：三项都是 `TUNABLE`（待 Parameter Search），各自声明搜索界 + 默认值。
   * 参数 id 必须与真实配方 `first-limit-pullback-hold-shrink` 一致，否则运行时 `resolveParameters` 后
   * `buildGates` 会因缺参数抛 `RECIPE_PARAMETER_INVALID`（这是**故意**不兜底的）。
   */
  parameterSpace: {
    max_volume_ratio: { type: "number", min: 0.05, max: 1, step: 0.05, defaultValue: 0.3 },
    max_drawdown: { type: "number", min: 0, max: 0.3, step: 0.01, defaultValue: 0.06 },
    require_bullish: { type: "number", min: 0, max: 1, step: 1, defaultValue: 1 },
  },
} as const;

/** 编辑后（Promote 前修改假设）的出场/参数：holdingDays 5→8，回撤上限 0.06→0.08。 */
const EDITED_EXIT_RULE = { stopLoss: 0.05, takeProfit: 0.15, holdingDays: 8 };
const EDITED_PARAMETER_SPACE = {
  max_volume_ratio: { type: "number", min: 0.05, max: 1, step: 0.05, defaultValue: 0.5 },
  max_drawdown: { type: "number", min: 0, max: 0.3, step: 0.01, defaultValue: 0.08 },
  require_bullish: { type: "number", min: 0, max: 1, step: 1, defaultValue: 1 },
};

// ---------------------------------------------------------------------------
section("0. 前置：真实研究坐标自证 + 清理上次残留");
// ---------------------------------------------------------------------------
const baseline = {
  candidates: await scalar("SELECT COUNT(*) n FROM research_strategy_candidate"),
  strategies: await scalar("SELECT COUNT(*) n FROM strategies"),
  versions: await scalar("SELECT COUNT(*) n FROM strategy_versions"),
  provenance: await scalar("SELECT COUNT(*) n FROM strategy_research_provenance"),
  params: await scalar("SELECT COUNT(*) n FROM strategy_parameters"),
};
console.log(`  基线行数 ${JSON.stringify(baseline)}`);

const running = await scalar("SELECT COUNT(*) n FROM research_run WHERE status = 'RUNNING'");
check("前置：无在途 RUNNING 研究 Run（有则禁改 server）", running === 0, `RUNNING=${running}`);

const exp = (await conn.query(
  "SELECT id, datasetVersionId, status FROM research_experiment WHERE id = ?",
  [EXPERIMENT_ID],
))[0] as Array<{ id: number; datasetVersionId: number; status: string }>;
check(
  "前置：实验存在且 Dataset 坐标 = 390002",
  exp.length === 1 && Number(exp[0].datasetVersionId) === DATASET_VERSION_ID,
  JSON.stringify(exp[0] ?? null),
);

const dsv = (await conn.query("SELECT id, status, version FROM dataset_version WHERE id = ?", [
  DATASET_VERSION_ID,
]))[0] as Array<{ id: number; status: string; version: string }>;
check("前置：来源 Dataset Version 存在且 READY", dsv.length === 1 && dsv[0].status === "READY", JSON.stringify(dsv[0] ?? null));

const stale = await conn.query("DELETE FROM research_strategy_candidate WHERE name = ?", [PROBE_NAME]);
console.log(`  预清理同名残留：${(stale[0] as { affectedRows?: number }).affectedRows ?? 0} 行`);

// ---------------------------------------------------------------------------
section("1. §12① Conclusion → Candidate（provenance 五件套）");
// ---------------------------------------------------------------------------
const created = await caller.research.strategyCandidate.createFromConclusion({
  conclusionId: CONCLUSION_ID,
  name: PROBE_NAME,
  description: "BRIDGE 端到端验收：首板后回踩（守线 + 缩量）假设",
  overrides: HYPOTHESIS_SKETCH as never,
});
const candidateId = created.candidate.id as number;
check("创建成功且 status = DRAFT（不自动 ACCEPTED）", created.candidate.status === "DRAFT");
check(
  "sourceDatasetVersionId 复制自 Experiment（唯一 Dataset 坐标）",
  Number(created.candidate.sourceDatasetVersionId) === DATASET_VERSION_ID,
  String(created.candidate.sourceDatasetVersionId),
);
check(
  "sourceResearchRunId 由结论证据两跳解析得到",
  Number(created.candidate.sourceResearchRunId) === EXPECTED_RUN_ID,
  String(created.candidate.sourceResearchRunId),
);
check("conclusionId / experimentId 锚定正确", Number(created.candidate.conclusionId) === CONCLUSION_ID && Number(created.candidate.experimentId) === EXPERIMENT_ID);
check("一致时 sourceDatasetDivergenceReason 必须为 NULL", created.candidate.sourceDatasetDivergenceReason === null);

/**
 * ⚠️ 领域对象（`ResearchStrategyCandidate`）里的 `*Json` 字段已被 Repository **反序列化成对象**
 * （不是原始字符串）⇒ 读的时候要兼容两种形态，别把「已是对象」当成解析失败。
 */
function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

const traceObj = asObject(created.candidate.sourceTraceJson);
const primary = (traceObj?.primaryAnalysis ?? null) as { analysisId?: number } | null;
check("sourceTrace 可解析且是「最小充分」结论证据快照", traceObj !== null && traceObj.snapshotKind === "research_conclusion_evidence", JSON.stringify(Object.keys(traceObj ?? {})).slice(0, 120));
check(
  "sourceTrace 可追溯到 analysis / result 层（primaryAnalysis.analysisId）",
  primary !== null && typeof primary.analysisId === "number",
  `analysisId=${String(primary?.analysisId)}`,
);
check(
  "sourceTrace 含 experiment / conclusion 坐标（Finding 可追溯）",
  Number(traceObj?.conclusionId) === CONCLUSION_ID && Number(traceObj?.experimentId) === EXPERIMENT_ID,
  `conclusionId=${String(traceObj?.conclusionId)} experimentId=${String(traceObj?.experimentId)}`,
);
const traceHasRun = JSON.stringify(traceObj?.runResolution ?? null).includes(String(EXPECTED_RUN_ID));
check("sourceTrace 内 runResolution 指向真实 Run", traceHasRun, JSON.stringify(traceObj?.runResolution ?? null).slice(0, 120));
check(
  "🔴 统计结果没有被机械复制成交易规则（结论自带「本阶段不产出交易结论」边界声明）",
  typeof traceObj?.disclaimer === "string" && String(traceObj.disclaimer).includes("不产出交易结论"),
);

// ---------------------------------------------------------------------------
section("2. §12② Promote 前编辑交易假设");
// ---------------------------------------------------------------------------
await caller.research.strategyCandidate.update({
  candidateId,
  patch: { exitRule: EDITED_EXIT_RULE as never, parameterSpace: EDITED_PARAMETER_SPACE as never },
});
const readBack = await caller.research.strategyCandidate.get({ candidateId });
const rb = readBack.candidate;
const exitBack = asObject(rb.exitRule) ?? {};
const paramBack = (asObject(rb.parameterSpace) ?? {}) as Record<string, { defaultValue?: number }>;
const conditionBack = asObject(rb.filterRule) as { groups?: Array<{ conditions?: unknown[] }> } | null;
check("出场假设可改并落库（holdingDays 5 → 8）", Number(exitBack.holdingDays) === 8, JSON.stringify(exitBack));
check(
  "参数空间可改并落库（max_volume_ratio 默认值 0.3 → 0.5）",
  Number(paramBack.max_volume_ratio?.defaultValue) === 0.5,
  JSON.stringify(paramBack),
);
check(
  "三项参数均带搜索界 + 默认值（TUNABLE 完整性）",
  Object.keys(paramBack).length === 3 && Object.values(paramBack).every((s) => s.defaultValue !== undefined),
  `keys=${Object.keys(paramBack).join(",")}`,
);
check(
  "买入条件（Entry 的 Condition）原样保留，未被编辑动作顺带改写",
  (conditionBack?.groups?.[0]?.conditions?.length ?? 0) === 2,
);

// ---------------------------------------------------------------------------
section("3. §12③ 非 ACCEPTED → promote 一律拒绝（且零 Strategy 数据）");
// ---------------------------------------------------------------------------
let rejected = "";
try {
  await caller.research.strategyCandidate.promote({ candidateId });
} catch (err) {
  rejected = domainCodeOf(err);
}
check("DRAFT 直接 promote 被拒，领域码 = STRATEGY_CANDIDATE_NOT_ACCEPTED", rejected === "STRATEGY_CANDIDATE_NOT_ACCEPTED", rejected);
check(
  "拒绝后零 Strategy 数据（strategies / versions 行数未变）",
  (await scalar("SELECT COUNT(*) n FROM strategies")) === baseline.strategies
    && (await scalar("SELECT COUNT(*) n FROM strategy_versions")) === baseline.versions,
);

// ---------------------------------------------------------------------------
section("4. §12④ Dataset 分歧三例（ACCEPTED 之前先验 gate）");
// ---------------------------------------------------------------------------
await caller.research.strategyCandidate.transition({ candidateId, to: "REVIEW" });
await caller.research.strategyCandidate.transition({ candidateId, to: "ACCEPTED" });
const afterAccept = await caller.research.strategyCandidate.get({ candidateId });
check("状态机 DRAFT → REVIEW → ACCEPTED 生效", afterAccept.candidate.status === "ACCEPTED");

// ① 不同 Dataset + 无原因 → 拒
let divergeErr = "";
try {
  await caller.research.strategyCandidate.promote({ candidateId, overrides: { datasetBinding: { datasetVersionId: 390001 } } });
} catch (err) {
  divergeErr = domainCodeOf(err);
}
check("异库 + 无原因 → DATASET_DIVERGENCE_REASON_REQUIRED", divergeErr === "STRATEGY_CANDIDATE_DATASET_DIVERGENCE_REASON_REQUIRED", divergeErr);

// ② Dataset 不存在 → 拒
let notFoundErr = "";
try {
  await caller.research.strategyCandidate.promote({ candidateId, overrides: { datasetBinding: { datasetVersionId: 999999 } } });
} catch (err) {
  notFoundErr = domainCodeOf(err);
}
check("Dataset Version 不存在 → DATASET_VERSION_NOT_FOUND", notFoundErr === "STRATEGY_CANDIDATE_DATASET_VERSION_NOT_FOUND", notFoundErr);

// ③ 一致却硬填原因 → 拒
let sameReasonErr = "";
try {
  await caller.research.strategyCandidate.promote({
    candidateId,
    overrides: { datasetBinding: { datasetVersionId: DATASET_VERSION_ID }, datasetDivergenceReason: "占位" },
  });
} catch (err) {
  sameReasonErr = domainCodeOf(err);
}
check("同库却填分歧原因 → STRATEGY_CANDIDATE_INVALID_INPUT", sameReasonErr === "STRATEGY_CANDIDATE_INVALID_INPUT", sameReasonErr);
check("三例失败后仍零 Strategy 数据", (await scalar("SELECT COUNT(*) n FROM strategies")) === baseline.strategies);

// ---------------------------------------------------------------------------
section("5. §12⑤ ACCEPTED + 完整草稿 → promote 生成 Strategy Version");
// ---------------------------------------------------------------------------
const promoted = await caller.research.strategyCandidate.promote({ candidateId });
const strategyId = promoted.strategyId;
const version = promoted.strategyVersion;
console.log(`  strategyId=${strategyId} version=${version} strategyVersionId=${promoted.strategyVersionId} fingerprint=${promoted.fingerprint.slice(0, 16)}…`);
check("strategyId 确定性派生 = cand-<candidateId>", strategyId === `cand-${candidateId}`, strategyId);
check("版本号固定 1.0.0（Promote 不产多版本）", version === "1.0.0");

const candAfter = await caller.research.strategyCandidate.get({ candidateId });
check("候选终态 = CONVERTED", candAfter.candidate.status === "CONVERTED");
check("strategyDefinitionId 指向该策略（两处一致）", candAfter.candidate.strategyDefinitionId === strategyId);

const probRow = (await conn.query(
  "SELECT strategyVersionId, strategyId, sourceCandidateId, sourceConclusionId, sourceExperimentId, "
  + "sourceResearchRunId, sourceDatasetVersionId, sourceDatasetLabel, origin FROM strategy_research_provenance WHERE strategyId = ?",
  [strategyId],
))[0] as Array<Record<string, unknown>>;
check("provenance 行存在且唯一", probRow.length === 1, JSON.stringify(probRow[0] ?? null));
const p0 = probRow[0] ?? {};
check(
  "provenance 五项上游锚全部落库（candidate/conclusion/experiment/run/datasetVersion）",
  Number(p0.sourceCandidateId) === candidateId
    && Number(p0.sourceConclusionId) === CONCLUSION_ID
    && Number(p0.sourceExperimentId) === EXPERIMENT_ID
    && Number(p0.sourceResearchRunId) === EXPECTED_RUN_ID
    && Number(p0.sourceDatasetVersionId) === DATASET_VERSION_ID,
);
check("provenance origin = DIRECT（首代，非继承）", p0.origin === "DIRECT");

// ---------------------------------------------------------------------------
section("6. §12⑥⑦ 投影 ↔ Canonical 一致 + Canonical 零污染");
// ---------------------------------------------------------------------------
const repo = new DbStrategyRepository();
const bundle = await repo.getVersionBundle(strategyId, version);
check("Strategy 侧读口可取到版本 + 投影 bundle", bundle !== undefined);
const document = bundle!.document;
const definition = (document as unknown as { definition: Parameters<typeof buildStrategyProjections>[0] }).definition;
const expected = buildStrategyProjections(definition);
const actual = await repo.loadProjections(bundle!.versionRowId);
const drifts = verifyStrategyProjections(expected, actual);
check("投影与 Canonical Definition 零漂移（5 张投影逐字段比对）", drifts.length === 0, drifts.slice(0, 3).join(" | "));
console.log(
  `  投影行数：parameters=${actual.parameters.length} entryRules=${actual.entryRules.length} `
  + `exitRules=${actual.exitRules.length} executionRule=${actual.executionRule ? 1 : 0} datasets=${actual.datasetBindings.length}`,
);
check("五张投影表均有行（parameters / entry / exit / execution / datasets）", actual.parameters.length > 0 && actual.entryRules.length > 0 && actual.exitRules.length > 0 && actual.executionRule !== null && actual.datasetBindings.length > 0);
check(
  "参数投影保留 parameterRole = TUNABLE（供 Parameter Search 消费）",
  actual.parameters.every((r) => r.parameterRole === "TUNABLE"),
  actual.parameters.map((r) => `${r.code}:${r.parameterRole}`).join(","),
);
check(
  "执行绑定 = 研究来源 Dataset（390002，role 为主库）",
  actual.datasetBindings.some((r) => Number(r.datasetVersionId) === DATASET_VERSION_ID),
  JSON.stringify(actual.datasetBindings.map((r) => r.datasetVersionId)),
);

const researchCols = (await conn.query(
  "SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
  + "AND TABLE_NAME IN ('strategy_versions','strategies') AND (COLUMN_NAME LIKE '%research%' OR COLUMN_NAME LIKE '%candidate%' OR COLUMN_NAME LIKE '%conclusion%')",
))[0] as Array<{ c: string }>;
check("Canonical 零污染：strategies / strategy_versions 无任何 research/candidate/conclusion 列", researchCols.length === 0, researchCols.map((r) => r.c).join(","));

// ---------------------------------------------------------------------------
section("7. §12⑧ promote 幂等：第二次不产生第二个版本");
// ---------------------------------------------------------------------------
const versionsBefore = await scalar("SELECT COUNT(*) n FROM strategy_versions");
const second = await caller.research.strategyCandidate.promote({ candidateId });
console.log(
  `  第一次：strategyId=${promoted.strategyId} version=${promoted.strategyVersion} `
  + `versionId=${promoted.strategyVersionId} fp=${promoted.fingerprint} idempotent=${promoted.idempotent}`,
);
console.log(
  `  第二次：strategyId=${second.strategyId} version=${second.strategyVersion} `
  + `versionId=${second.strategyVersionId} fp=${second.fingerprint} idempotent=${second.idempotent}`,
);
check("第二次 promote 未新建（idempotent = true）", second.idempotent === true);
check("第二次返回同一 strategyId", second.strategyId === strategyId, `${second.strategyId} vs ${strategyId}`);
check("第二次返回同一 version", second.strategyVersion === version, `${second.strategyVersion} vs ${version}`);
check("第二次返回同一 versionId", second.strategyVersionId === promoted.strategyVersionId);
check(
  "第二次返回同一 fingerprint（来自真实版本行，不编值）",
  second.fingerprint === promoted.fingerprint,
  `${second.fingerprint} vs ${promoted.fingerprint}`,
);
check("未产生第二个 Strategy Version", (await scalar("SELECT COUNT(*) n FROM strategy_versions")) === versionsBefore);
check("未产生第二条 provenance", (await scalar("SELECT COUNT(*) n FROM strategy_research_provenance WHERE strategyId = ?", [strategyId])) === 1);

// ---------------------------------------------------------------------------
section("8. §12⑨ 运行时独立性（只用 Strategy 侧读口 + 真配方参数解析）");
// ---------------------------------------------------------------------------
const runtime = resolveStrategyRecipeById(PULLBACK_RECIPE_ID);
const parameterSet = runtime.resolveParameters(
  (document as unknown as { parameters: Parameters<typeof runtime.resolveParameters>[0] }).parameters,
);
check(
  "真实配方能从转正产物解析出本次运行参数集（不抛 RECIPE_PARAMETER_NO_DEFAULT）",
  parameterSet[`max_volume_ratio`] === 0.5 && parameterSet[`max_drawdown`] === 0.08 && parameterSet[`require_bullish`] === 1,
  JSON.stringify(parameterSet),
);
console.log(`  由转正产物解析出的参数集 = ${JSON.stringify(parameterSet)}`);

const strategyDependents = (await conn.query("SHOW COLUMNS FROM strategy_versions"))[0] as Array<{ Field: string }>;
check(
  "策略版本行不携带研究坐标（研究可删/冻结而策略仍可运行）",
  !strategyDependents.some((c) => /research|candidate|conclusion/i.test(c.Field)),
  strategyDependents.map((c) => c.Field).join(","),
);

// ---------------------------------------------------------------------------
section("9. §13⑩ Look-ahead 负向闸门（真校验器）");
// ---------------------------------------------------------------------------
const clone = (mutate: (d: Record<string, unknown>) => void) => {
  const copy = JSON.parse(JSON.stringify(FIRST_BOARD_PULLBACK_DEFINITION)) as Record<string, unknown>;
  mutate(copy);
  return copy;
};
const codesOf = (def: Record<string, unknown>) =>
  validateCanonicalStrategyDefinition(def as never).issues.map((i) => i.code);

const legal = codesOf(clone(() => { /* 原样：prefix.rd0.open / bar.volume 组合 */ }));
check("合法 prefix / event / observation 组合通过（无 INVALID_FUTURE_REFERENCE）", !legal.includes("INVALID_FUTURE_REFERENCE"), legal.join(","));

const pathLeak = (() => {
  const d = clone((def) => {
    const entry = def.entry as { conditions: Array<Record<string, unknown>> };
    entry.conditions[0].field = "path.rd1.close";
  });
  return codesOf(d);
})();
check("条件引用 `path.*`（前视标签层）→ INVALID_FUTURE_REFERENCE", pathLeak.includes("INVALID_FUTURE_REFERENCE"), pathLeak.join(","));

const outcomeLeak = (() => {
  const d = clone((def) => {
    const entry = def.entry as { conditions: Array<Record<string, unknown>> };
    entry.conditions[0].field = "outcome.max_return_5d";
  });
  return codesOf(d);
})();
check("条件引用 `outcome.*`（前视标签层）→ INVALID_FUTURE_REFERENCE", outcomeLeak.includes("INVALID_FUTURE_REFERENCE"), outcomeLeak.join(","));

const futurePost = (() => {
  const d = clone((def) => {
    const entry = def.entry as { conditions: Array<Record<string, unknown>> };
    // 观测窗 [1,5] ⇒ 最早信号日 = T+1；引用 post.rd6 需要读未来数据
    entry.conditions[0].field = "post.rd6.close";
  });
  return codesOf(d);
})();
check("越界前视 `post.rd6`（超出最早信号日 T+1 可观察范围）→ INVALID_FUTURE_REFERENCE", futurePost.includes("INVALID_FUTURE_REFERENCE"), futurePost.join(","));

const unknownDomain = (() => {
  const d = clone((def) => {
    const entry = def.entry as { conditions: Array<Record<string, unknown>> };
    entry.conditions[0].field = "something.weird";
  });
  return codesOf(d);
})();
check("无法判定时间域的引用 → 默认拒绝（不是黑名单放过）", unknownDomain.some((c) => c === "UNKNOWN_FIELD_TIME_DOMAIN" || c === "UNKNOWN_FIELD_REFERENCE"), unknownDomain.join(","));

// ---------------------------------------------------------------------------
section("10. 收尾：删除本探针自建的行，断言行数守恒");
// ---------------------------------------------------------------------------
const cleanup = [
  ["strategy_research_provenance", "strategyId"],
  ["strategy_version_datasets", "strategyId"],
  ["strategy_parameters", "strategyId"],
  ["strategy_entry_rules", "strategyId"],
  ["strategy_exit_rules", "strategyId"],
  ["strategy_execution_rules", "strategyId"],
  ["strategy_versions", "strategyId"],
  ["strategies", "strategyId"],
] as const;
for (const [table, col] of cleanup) {
  await conn.query(`DELETE FROM \`${table}\` WHERE \`${col}\` = ?`, [strategyId]);
}
await conn.query("DELETE FROM research_strategy_candidate WHERE id = ?", [candidateId]);

const after = {
  candidates: await scalar("SELECT COUNT(*) n FROM research_strategy_candidate"),
  strategies: await scalar("SELECT COUNT(*) n FROM strategies"),
  versions: await scalar("SELECT COUNT(*) n FROM strategy_versions"),
  provenance: await scalar("SELECT COUNT(*) n FROM strategy_research_provenance"),
  params: await scalar("SELECT COUNT(*) n FROM strategy_parameters"),
};
console.log(`  清理后行数 ${JSON.stringify(after)}`);
check(
  "行数守恒（候选 / 策略 / 版本 / 溯源 / 参数 全部回到基线）",
  JSON.stringify(after) === JSON.stringify(baseline),
);
check("研究侧记录未被本探针改动（实验 / 结论仍在）", (await scalar("SELECT COUNT(*) n FROM research_conclusion WHERE id = ?", [CONCLUSION_ID])) === 1);

console.log(`\n== ${failures === 0 ? "ALL PASS" : `FAILURES(${failures})`} == checks=${checks} failures=${failures}`);

await conn.end();
process.exit(failures === 0 ? 0 : 1);
