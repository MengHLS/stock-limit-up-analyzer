/**
 * STEP 13 / C-13.2 — Signal 与 Candidate 框架：多日候选引擎（engine）。
 *
 * 把 STEP 10 单日 pipeline 接到 ResearchDataset 上、逐 tradeDate 驱动，并把逐日
 * SelectedCandidate / PositionIntent 聚合成可审计的 CandidateEvaluationRun。
 *
 * 数据流（每个决策日一次 runResearchPipeline，沿用其泄漏守卫/缺数据 FAIL FAST）：
 *
 *   createDatasetSession（版本/窗口/universeId 一致性）
 *     → 决策日序列（dataset universeDays ∩ config.dateRange，交易日升序）
 *     → 引擎预检（①行齐全：universe 成员当日必有行；②特征泄漏：availability 不得晚于
 *       最早决策时点；③requiredData 覆盖）
 *     → 逐日 runResearchPipeline → CandidateDayRecord[]
 *     → evaluateCandidateRun → CandidateRunEvaluation
 *     → CandidateEvaluationRun（不可变 + fingerprint）
 *
 * 边界铁律：
 *   - 只新增编排逻辑；特征计算 / 排序 / 选择 / 泄漏守卫全部复用 framework，不复制不重写；
 *   - Evaluation 是候选层确定性统计（见 types.ts 文件头），不是收益回测（C-14.1 范围）；
 *   - 确定性：决策日序列来自 dataset（已排序），无 Date.now / Math.random / IO；
 *   - FAIL FAST：universe 成员当日缺行、datasetVersion 不一致、特征未来函数、requiredData
 *     缺失，一律抛错，绝不静默跳过 / 回填 / 以部分数据冒充全窗口。
 */

import type { ResearchDataset } from "../../researchDataset/types";
import { createDatasetSession } from "../datasetAccess/session";
import type { ExperimentConfig, ResearchPipelineResult, StrategyContract } from "../framework/contract";
import type { DecisionTime } from "../framework/leakage";
import { LeakageGuard } from "../framework/leakage";
import { runResearchPipeline } from "../framework/pipeline";
import { evaluateCandidateRun } from "./evaluate";
import { computeCandidateEvaluationRunFingerprint } from "./serialize";
import type {
  CandidateDayRecord,
  CandidateEvaluationRun,
  FeatureVersionRef,
  Strategy13,
} from "./types";
import { CANDIDATE_EVALUATION_RUN_RECORD_KIND, CANDIDATE_EVALUATION_RUN_RECORD_VERSION } from "./types";
import { assertValidStrategy13 } from "./validate";

// ---------------------------------------------------------------------------
// 引擎错误（code 稳定，供程序化处理）
// ---------------------------------------------------------------------------

/** 引擎通用错误。 */
export class CandidateEngineError extends Error {
  /** 稳定错误码（非自由文本）。 */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CandidateEngineError";
    this.code = code;
  }
}

/** universe 成员在决策日缺行：逐日 PIT 面板不变量破坏。 */
export class MissingDatasetRowError extends CandidateEngineError {
  readonly tradeDate: string;
  readonly securityId: string;

  constructor(tradeDate: string, securityId: string) {
    super(
      "MISSING_DATASET_ROW",
      `候选引擎：数据集缺行（${tradeDate}, ${securityId}）——universe 决议将其列为当日成员，` +
        `但 rows 切片无该行；逐日 PIT 面板必须逐行齐全，禁止以历史/未来行静默替代`,
    );
    this.tradeDate = tradeDate;
    this.securityId = securityId;
  }
}

/** 请求窗口内无任何交易日。 */
export class EmptyDecisionWindowError extends CandidateEngineError {
  constructor(dateRange: { startDate: string; endDate: string }) {
    super(
      "EMPTY_DECISION_WINDOW",
      `候选引擎：请求窗口 [${dateRange.startDate}, ${dateRange.endDate}] 内无交易日，无法驱动任何决策`,
    );
  }
}

// ---------------------------------------------------------------------------
// 深冻结（引擎产物不可变）
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** 深拷贝并冻结一份可序列化配置快照（不冻结调用方入参）。 */
function frozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

// ---------------------------------------------------------------------------
// 输入 / 实现
// ---------------------------------------------------------------------------

/** 候选引擎输入。 */
export interface CandidateEngineInput {
  /** 已构建的 ResearchDataset（只读；绑定期即校验 PIT/排序不变量）。 */
  readonly dataset: ResearchDataset;
  /** 完整实验配置（datasetVersion / universe / dateRange / 参数集，喂给 datasetAccess 与 pipeline）。 */
  readonly config: ExperimentConfig;
  /** 完整策略契约（身份必须与 config.strategyId@strategyVersion 一致）。 */
  readonly strategy: StrategyContract;
  /** C-13.2 最小策略配方（决策时点 + 特征 + 信号 + 排序 + 选择）。 */
  readonly strategy13: Strategy13;
}

/**
 * 运行多日候选引擎，产出不可变、可审计的 CandidateEvaluationRun。
 *
 * 每个决策日执行一次 runResearchPipeline（单 decisionTime 横截面），保证确定性；
 * 多日由本引擎逐日驱动（decisionTime.date = 该交易日，point = strategy13.point）。
 */
export function runCandidateEngine(input: CandidateEngineInput): CandidateEvaluationRun {
  const { dataset, config, strategy, strategy13 } = input;

  // 1. 配方校验（特征集合/排序/选择/时点；非法即抛 ResearchValidationError）。
  assertValidStrategy13(strategy13);

  // 2. 策略身份一致性（与 pipeline 相同的校验，提前到引擎层以便清晰定位）。
  if (config.strategyId !== strategy.strategyId || config.strategyVersion !== strategy.strategyVersion) {
    throw new CandidateEngineError(
      "STRATEGY_IDENTITY_MISMATCH",
      `实验配置策略身份 (${config.strategyId}@${config.strategyVersion}) 与策略定义 (${strategy.strategyId}@${strategy.strategyVersion}) 不一致`,
    );
  }

  // 3. dataset ↔ config 一致性（版本 / universeId / 窗口越界），并产出 universe + dataSource。
  const session = createDatasetSession(dataset, config);

  // 4. 决策日序列：dataset universeDays 决议中，落在 config.dateRange（闭区间）内的交易日，升序。
  const decisionDates: string[] = [];
  for (const day of session.handle.universeDays) {
    if (day.tradeDate < config.dateRange.startDate) continue;
    if (day.tradeDate > config.dateRange.endDate) break; // universeDays 升序，越过即止。
    if (day.isTradingDay) decisionDates.push(day.tradeDate);
  }
  if (decisionDates.length === 0) {
    throw new EmptyDecisionWindowError(config.dateRange);
  }

  // 5. 引擎预检（全部 FAIL FAST，不做任何静默降级）。

  // 5a. 行齐全：每个决策日的每个 universe 成员都必须有当日行。
  const rowsDateSet = new Set<string>();
  const rowsKeySet = new Set<string>();
  for (const row of session.rows) {
    rowsDateSet.add(row.tradeDate);
    rowsKeySet.add(`${row.tradeDate}\u0000${row.securityId}`);
  }
  for (const date of decisionDates) {
    if (!rowsDateSet.has(date)) {
      throw new CandidateEngineError(
        "DECISION_DAY_NO_ROWS",
        `候选引擎：决策日 ${date} 为交易日但日期切片内无任何行，数据集在该日缺失（禁止以部分数据运行）`,
      );
    }
    for (const securityId of session.universe.getUniverse(date)) {
      if (!rowsKeySet.has(`${date}\u0000${securityId}`)) {
        throw new MissingDatasetRowError(date, securityId);
      }
    }
  }

  // 5b. 特征泄漏预检：availability 是静态绝对时点，须覆盖整个决策窗口（不晚于最早决策时点）。
  //     决策日升序且 point 固定，最早决策时点即最严格约束；逐日 pipeline 仍会二次把关。
  const firstDecisionTime: DecisionTime = { date: decisionDates[0]!, point: strategy13.point };
  for (const feature of strategy13.features) {
    LeakageGuard.assertNoLookAhead(feature.featureId, feature.availability, firstDecisionTime);
  }

  // 5c. requiredData 覆盖：策略所需数据域必须由 dataset 宽行结构背书（与 pipeline 语义一致，
  //     提前到引擎层以便在逐日循环前失败）。
  const available = new Set(session.dataSource.availableData);
  const missingData = strategy.requiredData.filter((domain) => !available.has(domain));
  if (missingData.length > 0) {
    throw new CandidateEngineError(
      "REQUIRED_DATA_MISSING",
      `策略 ${strategy.strategyId} 所需数据域缺失：${missingData.join(", ")}（数据源仅提供 ${Array.from(available).join(", ") || "无"}）`,
    );
  }

  // 6. 逐决策日驱动单日 pipeline，聚合成 CandidateDayRecord（升序，确定性）。
  const dayRecords: CandidateDayRecord[] = [];
  for (const date of decisionDates) {
    const decisionTime: DecisionTime = { date, point: strategy13.point };
    const result: ResearchPipelineResult = runResearchPipeline({
      strategy,
      config,
      decisionTime,
      universe: session.universe,
      featureProviders: strategy13.features,
      signalBuilder: strategy13.signalBuilder,
      rankingConfig: strategy13.rankingConfig,
      selectionConfig: strategy13.selectionConfig,
      dataSource: session.dataSource,
    });
    dayRecords.push(
      deepFreeze<CandidateDayRecord>({
        date: decisionTime.date,
        universeMembers: result.universe,
        signalCount: result.signals.length,
        dropped: result.dropped,
        selected: result.selected,
        positionIntents: result.positionIntents,
      }),
    );
  }

  // 7. 候选层统计评价（纯函数，确定性）。
  const evaluation = evaluateCandidateRun(dayRecords);

  // 8. 审计元数据装配（featureVersions 按 featureId 升序；配置/参数取冻结副本）。
  const featureVersions: readonly FeatureVersionRef[] = Array.from(strategy13.features)
    .map((feature) => ({ featureId: feature.featureId, version: feature.version }))
    .sort((left, right) => left.featureId.localeCompare(right.featureId));

  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    recordKind: CANDIDATE_EVALUATION_RUN_RECORD_KIND,
    recordVersion: CANDIDATE_EVALUATION_RUN_RECORD_VERSION,
    datasetVersion: session.handle.datasetVersion,
    builderVersion: session.handle.builderVersion,
    rowSchemaVersion: session.handle.rowSchemaVersion,
    datasetGate: session.handle.gate,
    universeId: session.handle.universeId,
    strategyId: strategy.strategyId,
    strategyVersion: strategy.strategyVersion,
    parameters: frozenClone(config.parameters),
    dateRange: { startDate: config.dateRange.startDate, endDate: config.dateRange.endDate },
    point: strategy13.point,
    featureVersions,
    rankingConfig: frozenClone(strategy13.rankingConfig),
    selectionConfig: frozenClone(strategy13.selectionConfig),
    days: dayRecords,
    evaluation,
    ...(strategy13.signalDescription !== undefined ? { signalDescription: strategy13.signalDescription } : {}),
  };

  // 9. 内容指纹 + 整体不可变。
  const fingerprint = computeCandidateEvaluationRunFingerprint(body);
  return deepFreeze<CandidateEvaluationRun>({ ...body, fingerprint });
}
