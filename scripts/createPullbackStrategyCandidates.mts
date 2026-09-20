/**
 * 四组「守线 + 缩量」策略候选 → 转正 → 产出带 `recipe` 的策略文档。
 *
 * 用户指令（2026-09-13）：「把 Research 中发现的有效条件，正式转化成 Strategy Candidate，
 * 并进入 Backtest。尤其优先验证 ① 守线+缩量≤30% ② 守线+缩量≤50%+红盘 ③ 不同 T+N 买入时点
 * ④ 不同回撤深度」；裁定「四组一起做成参数化配方」。
 *
 * 本脚本**只做前两步**（建候选 + promote），回测在后续脚本。四组共用同一配方
 * `first-limit-pullback-hold-shrink`，**差异全部落在 `parameterSpace.defaultValue` 与
 * `entryRule.extra.execution`**（这正是「参数化配方」的含义）。
 *
 * 纪律：
 *   - 走**真实 Service**（`createFromConclusion` / `promote`），**不直接写 strategy_* 表**；
 *   - 草稿的 `filterRule` 与研究侧 #540001~#540013 的**真实条件口径逐字对齐**（见文件内对照表）；
 *   - `parameterSpace` **必须**给 `defaultValue`（否则运行时 `RECIPE_PARAMETER_NO_DEFAULT`）
 *     且数值参数**必须**同时给 `min`/`max`（草稿角色恒 `TUNABLE` ⇒ 否则 `PROMOTE_SKETCH_INCOMPLETE`）；
 *   - 幂等：同名候选已存在则跳过登记（按 `name` 前缀匹配）；promote 本身幂等。
 *
 * 用法：npx tsx scripts/createPullbackStrategyCandidates.mts
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { createDbResearchRepositories } from "../server/research/candidateRepository";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { RegistryDatasetVersionReadPort } from "../server/research/strategyCandidate/datasetVersionPort";
import { createStrategyPromotionPort } from "../server/research/strategyCandidate/strategyPromotionPort";
import { DbStrategyResearchProvenanceRepository } from "../server/research/strategyCandidate/provenance";
import {
  createStrategyCandidateService,
  type StrategyCandidateService,
} from "../server/research/strategyCandidate/service";
import { composeCodeVersion } from "../server/research/experimentLineage/codeVersion";
import { PULLBACK_PARAMETER_IDS } from "../server/research/recipeRegistry";

const NAME_PREFIX = "[CAND-4GROUPS] ";

// ---------------------------------------------------------------------------
// 连接（裸 SQL 只用于「查来源结论 / 复核结果」，不写业务表）
// ---------------------------------------------------------------------------

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)![1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});

// ---------------------------------------------------------------------------
// 四组定义
// ---------------------------------------------------------------------------

/** 成本模型（与既有候选 #270001 逐字一致，来自其 `entryRule.extra.document.costModel`）。 */
const COST_MODEL = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
} as const;

const INITIAL_CAPITAL = 100_000;

/** 「守线 + 缩量」条件组（研究侧真实口径：`pullback_holds_event_low_{k}d == 1` + 量能比阈值）。 */
function filterRuleOf(maxVolumeRatio: number) {
  return {
    groups: [
      {
        groupNo: 0,
        groupLogicalOperator: "AND",
        conditions: [
          {
            groupNo: 0,
            sortOrder: 0,
            // 🔴 研究侧 `pullback_holds_event_low_3d == 1` 的策略侧等价写法。
            // 语义差已知（G1）：研究侧是「窗口内累积未破位」，策略侧单条只能表达「当日未破位」。
            fieldName: "bar.low",
            operator: ">=",
            value: "prefix.rd0.open",
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
            note: "守线：观察日未破首板日开盘价",
          },
          {
            groupNo: 0,
            sortOrder: 1,
            // 🔴 缩量必须用**比值口径**（`min_volume` 是绝对股数，与常量比较恒为假）。
            fieldName: "bar.volume",
            operator: "<=",
            value: `prefix.rd0.volume * ${maxVolumeRatio}`,
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
            note: `缩量：观察日量能 ≤ 首板日的 ${maxVolumeRatio * 100}%`,
          },
        ],
      },
    ],
  };
}

interface VariantSpec {
  readonly suffix: string;
  readonly note: string;
  readonly maxVolumeRatio: number;
  readonly maxDrawdown: number;
  readonly requireBullish: number;
  /**
   * 🔴 ③「不同 T+N 买入时点」的权威杠杆是 `entryRule.timing`，不是
   * `entryRule.extra.execution.*` —— 后者只读 `quantityMethod`/`lotSize`/`slippageModel`/
   * `commissionModel`/`executionConstraints`（见 `definitionBuild.ts:537-559`），
   * 且 `signalTiming`/`executionTiming`/`priceType` **由 `ENTRY_TIMING_TO_EXECUTION` 映射表
   * 从 `timing` 派生**（`NEXT_OPEN` → T+1 开盘 / `NEXT_CLOSE` → T+1 收盘）。
   *
   * ⚠️ **`SAME_CLOSE`（T 日收盘同时出信号并成交）被校验器硬拒**（`SIGNAL_EXECUTION_TIMING_CONFLICT`）
   * ⇒ 可行集只有这两个；`T_PLUS_2_OPEN` 在 `ENTRY_TIMING_TO_EXECUTION` 里无对应取值 ⇒ 也表达不了。
   */
  readonly timing: "NEXT_OPEN" | "NEXT_CLOSE";
  /** 仓位口径（`extra.position.sizingMethod`），用于审计展示。 */
  readonly sizingMethod: "EQUAL_WEIGHT" | "FIXED_RATIO";
}

/**
 * 四组 + 其内部子变体。
 *
 * 🔴 全部共用同一 `recipeId`；差异只在参数与执行时点 —— 这是「参数化配方」的落点。
 * ③「不同 T+N 买入时点」与 ④「不同回撤深度」各拆成 3 个变体（同一配方、不同参数值）。
 */
const VARIANTS: readonly VariantSpec[] = [
  // ---- ① 守线 + 缩量 ≤30%（Run#570001 #540007：n=705、+21.20%、胜率 76.88%）----
  {
    suffix: "① 守线+极致缩量≤30% · T+3观察 · T+1开盘买",
    note: "对应研究分析 #540007（n=705 / 5日均值 +21.20% / 差值 +19.68% / t=22.31 / 胜率 76.88%）",
    maxVolumeRatio: 0.3, maxDrawdown: 0.02, requireBullish: 0,
    timing: "NEXT_OPEN", sizingMethod: "EQUAL_WEIGHT",
  },
  // ---- ② 守线 + 缩量 ≤50% + 红盘（红盘 = 当日 K 线为阳，用户裁定口径）----
  {
    suffix: "② 守线+缩量≤50%+红盘 · T+3观察 · T+1开盘买",
    note: "守线 + 缩量≤50%（#540006：+7.16%）叠加用户口径「红盘」（当日 close > open，变量 pullback_last_is_bullish_3d）",
    maxVolumeRatio: 0.5, maxDrawdown: 0.02, requireBullish: 1,
    timing: "NEXT_OPEN", sizingMethod: "EQUAL_WEIGHT",
  },
  // ---- ③ 不同 T+N 买入时点（条件固定 = ①，只改 entryRule.timing）----
  /**
   * 🔴 **③ 只有两个可表达时点，不是三个**（2026-09-13 实测）：`SAME_CLOSE`
   * （T 日收盘同时出信号并成交）被既有校验器**硬拒** ——
   * `SIGNAL_EXECUTION_TIMING_CONFLICT`：「signalTiming=T_CLOSE 时禁止 executionTiming=T_CLOSE：
   * 同一 bar 收盘同时出信号并成交在本项目 T+1 模型下不可实现，且等价于使用该 bar 收盘信息成交」。
   * 这不是配置问题而是**架构约束**（T+1 模型），故 ③ 的可行集 = {T+1 开盘, T+1 收盘}。
   * （`T_PLUS_2_OPEN` 在本仓库 `ENTRY_TIMING_TO_EXECUTION` 里**没有对应 timing 取值** ⇒ 也表达不了。）
   */
  {
    suffix: "③-a 买入时点=T+1开盘 · 守线+缩量≤30%",
    note: "③ 买入时点矩阵：NEXT_OPEN ⇒ T_PLUS_1_OPEN / OPEN（A 股 T+1 最常用口径，与 ① 同）",
    maxVolumeRatio: 0.3, maxDrawdown: 0.02, requireBullish: 0,
    timing: "NEXT_OPEN", sizingMethod: "EQUAL_WEIGHT",
  },
  {
    suffix: "③-b 买入时点=T+1收盘 · 守线+缩量≤30%",
    note: "③ 买入时点矩阵：NEXT_CLOSE ⇒ T_PLUS_1_CLOSE / CLOSE（多等一个交易日、按收盘价成交）",
    maxVolumeRatio: 0.3, maxDrawdown: 0.02, requireBullish: 0,
    timing: "NEXT_CLOSE", sizingMethod: "EQUAL_WEIGHT",
  },
  // ---- ④ 不同回撤深度（条件固定 = ① 的缩量≤30%，只改守线阈值）----
  {
    suffix: "④-a 回撤深度≤2%（浅回踩） · 守线+缩量≤30%",
    note: "④ 回撤深度矩阵：允许跌破首板日开盘价 2% 以内（= ① 的守线阈值口径）",
    maxVolumeRatio: 0.3, maxDrawdown: 0.02, requireBullish: 0,
    timing: "NEXT_OPEN", sizingMethod: "EQUAL_WEIGHT",
  },
  {
    suffix: "④-b 回撤深度≤5%（标准回踩） · 守线+缩量≤30%",
    note: "④ 回撤深度矩阵：允许跌破 5% 以内（更宽）",
    maxVolumeRatio: 0.3, maxDrawdown: 0.05, requireBullish: 0,
    timing: "NEXT_OPEN", sizingMethod: "EQUAL_WEIGHT",
  },
  {
    suffix: "④-c 回撤深度≤10%（深回踩） · 守线+缩量≤30%",
    note: "④ 回撤深度矩阵：允许跌破 10% 以内（最宽）",
    maxVolumeRatio: 0.3, maxDrawdown: 0.1, requireBullish: 0,
    timing: "NEXT_OPEN", sizingMethod: "EQUAL_WEIGHT",
  },
];

/** `parameterSpace`：3 个门槛参数（含 `defaultValue` + `min`/`max`，TUNABLE 完整性要求）。 */
function parameterSpaceOf(v: VariantSpec) {
  return {
    [PULLBACK_PARAMETER_IDS.maxVolumeRatio]: {
      type: "number", min: 0.05, max: 1, step: 0.05, defaultValue: v.maxVolumeRatio,
    },
    [PULLBACK_PARAMETER_IDS.maxDrawdown]: {
      type: "number", min: 0, max: 0.3, step: 0.01, defaultValue: v.maxDrawdown,
    },
    [PULLBACK_PARAMETER_IDS.requireBullish]: {
      type: "number", min: 0, max: 1, step: 1, defaultValue: v.requireBullish,
    },
  };
}

/** 配方引用（可序列化面；与 `recipeRegistry.ts` 的注册实例逐字段对齐）。 */
const RECIPE = {
  kind: "signalEngine" as const,
  recipeId: "first-limit-pullback-hold-shrink",
  point: "close" as const,
  signalFrequency: "daily" as const,
  featureVersions: [
    { featureId: "haircutFromEventLow", version: "1.0.0" },
    { featureId: "volumeRatio", version: "1.0.0" },
    { featureId: "isBullish", version: "1.0.0" },
    { featureId: "momentumFromEventClose", version: "1.0.0" },
  ],
  rankingConfig: { higherIsBetter: true },
  selectionConfig: { method: { kind: "topN" as const, n: 5 } },
  requiredData: ["OHLCV"],
};

function entryRuleOf(v: VariantSpec) {
  return {
    event: "FIRST_LIMIT_UP",
    /**
     * 🔴 ③ 的杠杆就在这一行：`timing` 经 `ENTRY_TIMING_TO_EXECUTION` 一对一派生出
     * `signalTiming`/`executionTiming`/`priceType`（`definition.ts:745-747`）。
     * **不要**在 `extra.execution` 里重复写这三项 —— 那里根本不被读取。
     */
    timing: v.timing,
    extra: {
      observationWindow: { start: 1, end: 3, unit: "TRADING_DAY" },
      trigger: "NEXT_TRADING_DAY",
      eventParams: { limitUpRatio: 0.1 },
      execution: {
        quantityMethod: "TARGET_WEIGHT",
        lotSize: 100,
        slippageModel: "BPS",
        commissionModel: "BPS",
      },
      position: { sizingMethod: v.sizingMethod },
      document: {
        backtestConfig: { initialCapital: INITIAL_CAPITAL },
        costModel: { ...COST_MODEL },
      },
      recipe: {
        ...RECIPE,
        featureVersions: RECIPE.featureVersions.map((f) => ({ ...f })),
        rankingConfig: { ...RECIPE.rankingConfig },
        selectionConfig: { method: { kind: "topN" as const, n: RECIPE.selectionConfig.method.n } },
        requiredData: [...RECIPE.requiredData],
      },
    },
  };
}

/** 去掉 `undefined` 值（`entryRule.extra` 是闭集，未定义键会 `PROMOTE_SKETCH_INVALID`）。 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      out[k] = stripUndefined(val);
    }
    return out as unknown as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// 主流程
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

const service: StrategyCandidateService = createStrategyCandidateService({
  repos: createDbResearchRepositories(),
  datasetVersions: new RegistryDatasetVersionReadPort(),
  strategies: createStrategyPromotionPort({ codeVersion: resolveCodeVersion() }),
  provenance: new DbStrategyResearchProvenanceRepository(),
});

// ---- 来源结论：优先用 SUPPORTED 的 #510001；不存在则退 REJECTED 的 #480001 ----
const [conclusionRows] = await conn.query(
  "SELECT id, title, status, conclusionType FROM research_conclusion "
  + "WHERE id IN (510001, 480001, 270001) ORDER BY FIELD(id, 510001, 480001, 270001)",
);
const conclusion = (conclusionRows as Array<{ id: number; title: string; status: string; conclusionType: string }>)[0];
if (conclusion === undefined) {
  throw new Error("找不到可用来源结论（期望 #510001 / #480001 / #270001 之一）");
}
console.log(`来源结论：#${conclusion.id} [${conclusion.conclusionType}/${conclusion.status}] ${conclusion.title}`);

const [existingRows] = await conn.query(
  "SELECT id, name FROM research_strategy_candidate WHERE name LIKE ? ORDER BY id",
  [`${NAME_PREFIX}%`],
);
const existingByName = new Map<string, number>();
for (const r of existingRows as Array<{ id: number; name: string }>) existingByName.set(r.name, r.id);

console.log(`\n已存在的本前缀候选：${existingByName.size} 条\n`);

const results: Array<{ id: number; name: string; strategyId: string; versionId: number; idempotent: boolean }> = [];

for (const [index, v] of VARIANTS.entries()) {
  const name = `${NAME_PREFIX}${v.suffix}`;
  let candidateId = existingByName.get(name);

  if (candidateId === undefined) {
    const view = await service.createFromConclusion({
      conclusionId: conclusion.id,
      name,
      description: `${v.note}\n\n（本候选由 scripts/createPullbackStrategyCandidates.mts 按用户 2026-09-13 指令生成；`
        + `配方 = first-limit-pullback-hold-shrink，参数 max_volume_ratio=${v.maxVolumeRatio} / `
        + `max_drawdown=${v.maxDrawdown} / require_bullish=${v.requireBullish}）`,
      overrides: {
        entryRule: stripUndefined(entryRuleOf(v)),
        filterRule: stripUndefined(filterRuleOf(v.maxVolumeRatio)),
        exitRule: { stopLoss: 0.05, holdingDays: 5 },
        riskRule: { maxPositions: 5, maxPositionWeight: 0.2 },
        parameterSpace: stripUndefined(parameterSpaceOf(v)),
      },
    });
    candidateId = view.candidate.id;
    console.log(`[${index + 1}/${VARIANTS.length}] 登记候选 #${candidateId} —— ${name}`);
  } else {
    console.log(`[${index + 1}/${VARIANTS.length}] 候选已存在 #${candidateId} —— ${name}`);
  }

  // 状态机：DRAFT → REVIEW → ACCEPTED（promote 要求 ACCEPTED）
  const current = await service.get(candidateId);
  const status = current.candidate.status;
  if (status !== "ACCEPTED" && status !== "CONVERTED") {
    const path = status === "DRAFT" ? ["REVIEW", "ACCEPTED"] : status === "REVIEW" ? ["ACCEPTED"] : [];
    for (const to of path) {
      await service.transition({ candidateId, to });
      console.log(`     状态迁移 → ${to}`);
    }
  }

  const promoted = await service.promote({ candidateId });
  console.log(
    `     promote ⇒ strategyId=${promoted.strategyId} versionId=${promoted.strategyVersionId} `
    + `version=${promoted.strategyVersion} idempotent=${promoted.idempotent}`,
  );
  results.push({
    id: candidateId, name, strategyId: promoted.strategyId,
    versionId: promoted.strategyVersionId, idempotent: promoted.idempotent,
  });
}

console.log("\n===== 汇总 =====");
for (const r of results) {
  console.log(`#${r.id} | ${r.strategyId} | versionId=${r.versionId} | idempotent=${r.idempotent} | ${r.name}`);
}

await conn.end();
process.exit(0);
