/**
 * 端到端复验（**真 tRPC** + **真 TiDB**）— BRIDGE-CONDITION-EXPRESSION-001 修正后
 * 「声明（entry.conditions）↔ 执行（配方门槛）」的对齐。
 *
 * 本探针自建自清（只碰自己那两条候选 + 自己那条策略），覆盖：
 *
 *   §1 修正写法（派生字段 + 参数引用）**能**转正：
 *        `bar.volumeRatio <= max_volume_ratio` / `bar.haircutFromEventLow <= max_drawdown`
 *        / `bar.isBullish >= require_bullish`
 *      ⇒ 断言 `definition.entry.conditions` 逐条 `valueType = PARAMETER_REFERENCE`，
 *        且字段名（去 `bar.`）与**运行时配方**的 `features[].featureId` **同名**、
 *        引用值 ∈ `resolveParameters(...)` 解析出的参数键 —— 这就是「声明 ↔ 执行」对齐。
 *
 *   §2 投影零漂移（`verifyStrategyProjections`）+ 参数投影 TUNABLE + 运行时参数集可解析。
 *
 *   §3 负向：把右值改回历史写法 `"prefix.rd0.volume * 0.3"` ⇒ promote **响亮拒绝**
 *      `STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID`，且**零 Strategy 数据**（行数守恒）。
 *
 * 退出码：有失败 ⇒ 1，否则 0。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { appRouter } from "../../server/routers";
import { DbStrategyRepository } from "../../server/research/strategyPersistence";
import {
  buildStrategyProjections,
  verifyStrategyProjections,
} from "../../server/research/strategySchema/projection";
import {
  PULLBACK_FEATURE_IDS,
  PULLBACK_PARAMETER_IDS,
  resolveStrategyRecipeById,
} from "../../server/research/recipeRegistry";

// --- 真实坐标（与 `_e2e_research_strategy_bridge.mts` 同源，写死以免探针漂移）---
const EXPERIMENT_ID = 240002;
const DATASET_VERSION_ID = 390002;
const CONCLUSION_ID = 510001;
const PULLBACK_RECIPE_ID = "first-limit-pullback-hold-shrink";
const PROBE_NAME_ALIGNED = "__e2e_cond_expr_aligned__";
const PROBE_NAME_ARITHMETIC = "__e2e_cond_expr_arithmetic__";

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
function domainCodeOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const matched = /\[([A-Z_]{3,})\]/u.exec(message);
  return matched ? matched[1] : "(无领域码)";
}

const adminUser = {
  id: 1,
  openId: "e2e-cond-expr",
  name: "e2e-cond-expr",
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

const FEATURE_IDS: readonly string[] = Object.values(PULLBACK_FEATURE_IDS);
const PARAMETER_IDS: readonly string[] = Object.values(PULLBACK_PARAMETER_IDS);

// ---------------------------------------------------------------------------
// 共用脚手架（与真库那条「首板回踩」假设同源；含真配方，见 §0 说明）
// ---------------------------------------------------------------------------
function buildSketch(filterRule: unknown) {
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
        recipe: {
          kind: "signalEngine",
          recipeId: PULLBACK_RECIPE_ID,
          point: "close",
          signalFrequency: "daily",
          featureVersions: FEATURE_IDS.map((featureId) => ({ featureId, version: "1.0.0" })),
          rankingConfig: { higherIsBetter: true },
          selectionConfig: { method: { kind: "topN", n: 5 } },
          requiredData: ["OHLCV"],
        },
      },
    },
    filterRule,
    exitRule: { stopLoss: 0.05, takeProfit: 0.1, holdingDays: 5 },
    riskRule: { maxPositions: 5, maxPositionWeight: 0.2 },
    parameterSpace: {
      max_volume_ratio: { type: "number", min: 0.05, max: 1, step: 0.05, defaultValue: 0.3 },
      max_drawdown: { type: "number", min: 0, max: 0.3, step: 0.01, defaultValue: 0.06 },
      require_bullish: { type: "number", min: 0, max: 1, step: 1, defaultValue: 1 },
    },
  };
}

/** 修正写法：右值 = **语义键指向的配方参数 id**（参数引用），字段 = **派生字段**（与配方门槛同名）。 */
const ALIGNED_FILTER_RULE = {
  groups: [
    {
      groupNo: 0,
      groupLogicalOperator: "AND",
      conditions: [
        {
          groupNo: 0,
          sortOrder: 0,
          fieldName: `bar.${PULLBACK_FEATURE_IDS.haircut}`,
          operator: "<=",
          value: PULLBACK_PARAMETER_IDS.maxDrawdown,
          logicalOperator: "AND",
          groupLogicalOperator: "AND",
          note: "守线：回撤深度不超阈值（派生字段，与配方门槛同名同义）",
        },
        {
          groupNo: 0,
          sortOrder: 1,
          fieldName: `bar.${PULLBACK_FEATURE_IDS.volumeRatio}`,
          operator: "<=",
          value: PULLBACK_PARAMETER_IDS.maxVolumeRatio,
          logicalOperator: "AND",
          groupLogicalOperator: "AND",
          note: "缩量：量能比不超阈值",
        },
        {
          groupNo: 0,
          sortOrder: 2,
          fieldName: `bar.${PULLBACK_FEATURE_IDS.isBullish}`,
          operator: ">=",
          value: PULLBACK_PARAMETER_IDS.requireBullish,
          logicalOperator: "AND",
          groupLogicalOperator: "AND",
          note: "红盘：当日阳线",
        },
      ],
    },
  ],
};

/** 历史写法（**必须被拒**）：算术表达式被静默降级成字符串常量的那一条。 */
const ARITHMETIC_FILTER_RULE = {
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
          note: "守线（原始列写法，合法）",
        },
        {
          groupNo: 0,
          sortOrder: 1,
          fieldName: "bar.volume",
          operator: "<=",
          value: "prefix.rd0.volume * 0.3",
          logicalOperator: "AND",
          groupLogicalOperator: "AND",
          note: "缩量 30%（历史写法：算术表达式，修正后被响亮拒绝）",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
section("0. 前置：真坐标自证 + 清理同名残留");
// ---------------------------------------------------------------------------
const baseline = {
  candidates: await scalar("SELECT COUNT(*) n FROM research_strategy_candidate"),
  strategies: await scalar("SELECT COUNT(*) n FROM strategies"),
  versions: await scalar("SELECT COUNT(*) n FROM strategy_versions"),
  provenance: await scalar("SELECT COUNT(*) n FROM strategy_research_provenance"),
  params: await scalar("SELECT COUNT(*) n FROM strategy_parameters"),
};
console.log(`  基线行数 ${JSON.stringify(baseline)}`);

const exp = (await conn.query(
  "SELECT id, datasetVersionId FROM research_experiment WHERE id = ?",
  [EXPERIMENT_ID],
))[0] as Array<{ id: number; datasetVersionId: number }>;
check(
  "前置：实验存在且 Dataset 坐标 = 390002",
  exp.length === 1 && Number(exp[0].datasetVersionId) === DATASET_VERSION_ID,
  JSON.stringify(exp[0] ?? null),
);

const stale = await conn.query(
  "DELETE FROM research_strategy_candidate WHERE name IN (?, ?)",
  [PROBE_NAME_ALIGNED, PROBE_NAME_ARITHMETIC],
);
console.log(`  预清理同名残留：${(stale[0] as { affectedRows?: number }).affectedRows ?? 0} 行`);

// ---------------------------------------------------------------------------
section("1. 修正写法（派生字段 + 参数引用）→ 转正 → 声明 ↔ 执行对齐");
// ---------------------------------------------------------------------------
const created = await caller.research.strategyCandidate.createFromConclusion({
  conclusionId: CONCLUSION_ID,
  name: PROBE_NAME_ALIGNED,
  description: "BRIDGE-CONDITION-EXPRESSION-001 复验：派生字段 + 参数引用写法",
  overrides: buildSketch(ALIGNED_FILTER_RULE) as never,
});
const alignedCandidateId = created.candidate.id as number;
check("创建成功且 status = DRAFT", created.candidate.status === "DRAFT", String(created.candidate.status));

await caller.research.strategyCandidate.transition({ candidateId: alignedCandidateId, to: "REVIEW" });
await caller.research.strategyCandidate.transition({ candidateId: alignedCandidateId, to: "ACCEPTED" });
const accepted = await caller.research.strategyCandidate.get({ candidateId: alignedCandidateId });
check("状态机 DRAFT → REVIEW → ACCEPTED", accepted.candidate.status === "ACCEPTED", String(accepted.candidate.status));

const promoted = await caller.research.strategyCandidate.promote({ candidateId: alignedCandidateId });
console.log(`  strategyId=${promoted.strategyId} version=${promoted.strategyVersion} versionId=${promoted.strategyVersionId}`);
check("promote 成功（修正写法不再被拒）", typeof promoted.strategyVersionId === "number" && promoted.strategyVersionId > 0);
check("strategyId 确定性派生 = cand-<candidateId>", promoted.strategyId === `cand-${alignedCandidateId}`, promoted.strategyId);

const repo = new DbStrategyRepository();
const bundle = await repo.getVersionBundle(promoted.strategyId, promoted.strategyVersion);
check("Strategy 侧读口可取到版本 bundle", bundle !== undefined);
const document = bundle!.document as unknown as {
  definition: Parameters<typeof buildStrategyProjections>[0];
  parameters: Parameters<
    ReturnType<typeof resolveStrategyRecipeById>["resolveParameters"]
  >[0];
};
const definition = document.definition;
const conditions = (definition as unknown as {
  entry: { conditions: Array<{ field: string; operator: string; value: unknown; valueType: string }> };
}).entry.conditions;

check("entry.conditions 落库 3 条（与草稿条件数一致）", conditions.length === 3, `实际 ${conditions.length}`);

const runtime = resolveStrategyRecipeById(PULLBACK_RECIPE_ID);
const runtimeFeatureIds = runtime.features.map((feature) => feature.featureId);
const parameterSet = runtime.resolveParameters(document.parameters);
const runtimeParameterKeys = Object.keys(parameterSet);

/** 逐条断言：`bar.<x>` 的 `<x>` 必须与**运行时配方**的 featureId 同名，右值必须是可解析参数。 */
const EXPECTED_PAIRS: readonly { featureId: string; parameterId: string }[] = [
  { featureId: PULLBACK_FEATURE_IDS.haircut, parameterId: PULLBACK_PARAMETER_IDS.maxDrawdown },
  { featureId: PULLBACK_FEATURE_IDS.volumeRatio, parameterId: PULLBACK_PARAMETER_IDS.maxVolumeRatio },
  { featureId: PULLBACK_FEATURE_IDS.isBullish, parameterId: PULLBACK_PARAMETER_IDS.requireBullish },
];

EXPECTED_PAIRS.forEach((pair, index) => {
  const condition = conditions[index];
  const actualField = typeof condition?.field === "string" ? condition.field : "";
  const actualValueType = condition?.valueType;
  const actualValue = condition?.value;
  check(
    `#${index} 声明字段 = bar.${pair.featureId}（与运行时 featureId 同名 ⇒ 声明 = 执行）`,
    actualField === `bar.${pair.featureId}` && runtimeFeatureIds.includes(pair.featureId),
    `field=${actualField} runtimeFeatures=${runtimeFeatureIds.join("/")}`,
  );
  check(
    `#${index} valueType = PARAMETER_REFERENCE（不再降级成 CONSTANT）`,
    actualValueType === "PARAMETER_REFERENCE",
    `valueType=${String(actualValueType)}`,
  );
  check(
    `#${index} 右值 = ${pair.parameterId}（∈ 配方参数表 ∩ 运行时可解析键）`,
    actualValue === pair.parameterId
      && PARAMETER_IDS.includes(pair.parameterId)
      && runtimeParameterKeys.includes(pair.parameterId),
    `value=${JSON.stringify(actualValue)} runtimeParams=${runtimeParameterKeys.join("/")}`,
  );
});

check(
  "🔴 语义对齐：声明 bar.volumeRatio ↔ 参数 max_volume_ratio —— 与配方门槛 volumeRatio <= max_volume_ratio 同名同义",
  conditions.some((c) => c.field === "bar.volumeRatio" && c.value === "max_volume_ratio" && c.valueType === "PARAMETER_REFERENCE"),
);
check(
  "运行时参数集可解析出三参数（不抛 RECIPE_PARAMETER_NO_DEFAULT）",
  parameterSet[PULLBACK_PARAMETER_IDS.maxVolumeRatio] === 0.3
    && parameterSet[PULLBACK_PARAMETER_IDS.maxDrawdown] === 0.06
    && parameterSet[PULLBACK_PARAMETER_IDS.requireBullish] === 1,
  JSON.stringify(parameterSet),
);

// ---------------------------------------------------------------------------
section("2. 投影 ↔ Canonical 零漂移 + 参数投影 TUNABLE");
// ---------------------------------------------------------------------------
const expected = buildStrategyProjections(definition);
const actual = await repo.loadProjections(bundle!.versionRowId);
const drifts = verifyStrategyProjections(expected, actual);
check("投影与 Canonical Definition 零漂移（5 张投影逐字段比对）", drifts.length === 0, drifts.slice(0, 3).join(" | "));
console.log(
  `  投影行数：parameters=${actual.parameters.length} entryRules=${actual.entryRules.length} `
  + `exitRules=${actual.exitRules.length} executionRule=${actual.executionRule ? 1 : 0} datasets=${actual.datasetBindings.length}`,
);
check(
  "参数投影保留 parameterRole = TUNABLE（供 Parameter Search 消费）",
  actual.parameters.length === 3 && actual.parameters.every((row) => row.parameterRole === "TUNABLE"),
  actual.parameters.map((row) => `${row.code}:${row.parameterRole}`).join(","),
);
check(
  "执行绑定 = 研究来源 Dataset（390002）",
  actual.datasetBindings.some((row) => Number(row.datasetVersionId) === DATASET_VERSION_ID),
  JSON.stringify(actual.datasetBindings.map((row) => row.datasetVersionId)),
);

// ---------------------------------------------------------------------------
section("3. 负向：历史写法（算术右值）→ 响亮拒绝 + 零 Strategy 数据");
// ---------------------------------------------------------------------------
const strategiesBefore = await scalar("SELECT COUNT(*) n FROM strategies");
const versionsBefore = await scalar("SELECT COUNT(*) n FROM strategy_versions");

const badCreated = await caller.research.strategyCandidate.createFromConclusion({
  conclusionId: CONCLUSION_ID,
  name: PROBE_NAME_ARITHMETIC,
  description: "BRIDGE-CONDITION-EXPRESSION-001 复验：历史算术右值写法（应被拒）",
  overrides: buildSketch(ARITHMETIC_FILTER_RULE) as never,
});
const badCandidateId = badCreated.candidate.id as number;
await caller.research.strategyCandidate.transition({ candidateId: badCandidateId, to: "REVIEW" });
await caller.research.strategyCandidate.transition({ candidateId: badCandidateId, to: "ACCEPTED" });

let badCode = "";
let badMessage = "";
try {
  await caller.research.strategyCandidate.promote({ candidateId: badCandidateId });
} catch (err) {
  badCode = domainCodeOf(err);
  badMessage = err instanceof Error ? err.message : String(err);
}
check(
  "算术右值 promote 被拒，领域码 = STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID",
  badCode === "STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID",
  badCode,
);
check(
  "错误信息点名路径 + 给出改写方向（派生字段 / 参数引用），不是静默降级",
  badMessage.includes("filterRule.groups[0].conditions[1].value")
    && badMessage.includes("bar.volumeRatio")
    && badMessage.includes("max_volume_ratio"),
  badMessage.replace(/\s+/gu, " ").slice(0, 200),
);
check(
  "拒绝后零 Strategy 数据（strategies / strategy_versions 行数未变）",
  (await scalar("SELECT COUNT(*) n FROM strategies")) === strategiesBefore
    && (await scalar("SELECT COUNT(*) n FROM strategy_versions")) === versionsBefore,
);
const badAfter = await caller.research.strategyCandidate.get({ candidateId: badCandidateId });
check("被拒候选保持 ACCEPTED（不产生任何 Strategy 数据，也不回退状态）", badAfter.candidate.status === "ACCEPTED", badAfter.candidate.status);

// ---------------------------------------------------------------------------
section("4. 收尾：删除本探针自建的行，断言行数守恒");
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
for (const [table, column] of cleanup) {
  await conn.query(`DELETE FROM \`${table}\` WHERE \`${column}\` = ?`, [promoted.strategyId]);
}
await conn.query("DELETE FROM research_strategy_candidate WHERE id IN (?, ?)", [alignedCandidateId, badCandidateId]);

const after = {
  candidates: await scalar("SELECT COUNT(*) n FROM research_strategy_candidate"),
  strategies: await scalar("SELECT COUNT(*) n FROM strategies"),
  versions: await scalar("SELECT COUNT(*) n FROM strategy_versions"),
  provenance: await scalar("SELECT COUNT(*) n FROM strategy_research_provenance"),
  params: await scalar("SELECT COUNT(*) n FROM strategy_parameters"),
};
console.log(`  清理后行数 ${JSON.stringify(after)}`);
check("行数守恒（候选 / 策略 / 版本 / 溯源 / 参数 全部回到基线）", JSON.stringify(after) === JSON.stringify(baseline));
check("研究侧记录未被本探针改动（结论仍在）", (await scalar("SELECT COUNT(*) n FROM research_conclusion WHERE id = ?", [CONCLUSION_ID])) === 1);

console.log(`\n== ${failures === 0 ? "ALL PASS" : `FAILURES(${failures})`} == checks=${checks} failures=${failures}`);
await conn.end();
process.exit(failures === 0 ? 0 : 1);
