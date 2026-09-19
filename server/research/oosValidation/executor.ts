/**
 * OOS-001 §4/§5/§6/§9/§10/§12/§14 — 编排层（create / start / cancel / read / list / result）。
 *
 * ## 本层做三件事，且**只**做这三件事
 *
 * 1. **读源**：经 `parameterSearch/persistence.ts` 的**既有**读函数读源 Search Run / 组合 / 结果
 *    （不新写一套 SQL —— 那会造成「同一张表两套读取口径」），对它们**只读**；
 * 2. **冻结**：把源 Run 的窗口 / 参数空间快照 / FIXED 坐标 / 被选组合的参数**原样继承**并写死
 *    （规格 §5：OOS 不允许搜索新参数、不允许用当前策略版本重新解释历史搜索）；
 * 3. **真跑**：用**冻结参数**在与 Search 窗口**不重叠**的 OOS 窗口上**真正重跑 Backtest**
 *    （经 `strategyEvaluation/backtestBridge.ts` 这一唯一入口 ⇒ 内部是完整闭环），
 *    再从 `ClosedLoopEvaluationRef#canonicalMetrics` **读**（不是算）指标。
 *
 * 🔴 三处「唯一权威」被复用在且仅在以下位置：
 *   | 能力 | 落点 |
 *   | --- | --- |
 *   | 回测执行 | `createStrategyBacktestBridge` |
 *   | 指标投影 | `parameterSearch/searchResult.ts#projectCanonicalMetrics`（全仓唯一 canonical 读数投影） |
 *   | IS 冻结副本投影 | `parameterSearch/executor.ts#toResultView`（全仓唯一结果行投影） |
 *
 * ⇒ 本层**不重算任何指标**（规格 §9 末句）。
 *
 * ## 从 `parameterSearch/executor.ts` 只取一件事
 *
 * 本层 `import { toResultView }` —— 那是全仓**唯一**的「结果行 → 视图」投影，
 * IS 基线必须用它读（自己再写一份必然漂移）。除此之外**不取任何**会创建 / 执行 /
 * 重试搜索的导出（`createParameterSearchRun` / `executeParameterSearchRun` /
 * `retryParameterSearchCombination` / `cancelParameterSearchRun`）——
 * 那等于「再来一次参数搜索」，规格 §5 明禁。
 * 该白名单由 `tests/.../oosValidationBoundary.test.ts` 钉成结构事实。
 *
 * ## 为什么 `start` 需要调用方传策略文档
 *
 * 与 `parameterSearch/executor.ts` 同一姿态：**本层不做策略 IO**。
 * 路由层（tRPC）读库拿到文档与 `codeVersion` 后传入 ⇒ 领域层保持对 IO 的零假设，
 * 也因此能在测试里用真实文档 / 夹具文档做纯编排验证。
 */

import {
  OOS_VALIDATION_RECORD_VERSION,
  OOS_VALIDATION_RESULT_RECORD_KIND,
  OOS_VALIDATION_RUN_RECORD_KIND,
  type OosComparisonView,
  type OosMetricsView,
  type OosValidationResultView,
  type OosValidationRunView,
} from "../../../shared/oosValidationContracts";
import { BACKTEST_EXECUTION_POLICY_VERSION } from "../../backtest/context";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError } from "../experimentValidation";
import {
  getParameterSearchRunRow,
  listParameterSearchCombinationRows,
  listParameterSearchResultRows,
  readDatasetVersionWindow,
  type ParameterSearchCombinationRow,
  type ParameterSearchResultRow,
  type ParameterSearchRunRow,
} from "../parameterSearch/persistence";
import { toResultView } from "../parameterSearch/executor";
import { projectCanonicalMetrics } from "../parameterSearch/searchResult";
import { createStrategyBacktestBridge } from "../strategyEvaluation/backtestBridge";
import type { StrategyDocument } from "../strategySchema/types";
import type { ResearchParameterValue } from "../types";
import { buildOosComparison } from "./comparison";
import { verifyDefinitionFingerprint } from "./definitionFingerprint";
import { assertFrozenParameterSetUnchanged, freezeCandidate } from "./freeze";
import { assertIsMetricsCanonical, assertOosSourceGate } from "./gate";
import {
  getOosValidationResultRow,
  getOosValidationRunRow,
  insertOosValidationRun,
  listOosValidationResultRows,
  listOosValidationRunRows,
  oosRunTimestamps,
  updateOosValidationRun,
  upsertOosValidationResult,
  type OosValidationResultRow,
  type OosValidationRunRow,
} from "./persistence";
import {
  assertOosRunCanExecute,
  assertOosRunTransition,
  computeOosResultFingerprint,
  computeOosRunFingerprint,
  generateOosValidationRunId,
  parseOosRunStatus,
} from "./run";
import {
  DEFAULT_OOS_RUN_LIST_LIMIT,
  EMPTY_OOS_METRICS,
  OOS_ENGINE_VERSION,
  OOS_METRICS_VERSION,
} from "./types";
import { assertOosWindowIsolated } from "./window";

/** notes 上限（防长跑无界增长；超出保留最近 N 条）。 */
const MAX_OOS_NOTES = 200;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/**
 * JSON 文本 → 标量记录（`fixedCoordinatesJson` / `resolvedParameterSetJson` 共用）。
 *
 * 🔴 **为什么这里不 `try/catch` 也不丢弃非标量值**：
 *   冻结快照是本模块自己用 `canonicalStringify` 写进去的，出现「解析不了」或
 *   「值不是标量」都意味着**不变式已破**。此刻若静默退化成 `{}` 或丢掉那个键，
 *   后续回测就会拿**少了参数**的参数集去跑 —— 那正是规格 §5 明禁的
 *   「参数冻结被悄悄破坏」，而且会伪装成一次「成功的 OOS Run」。
 *   ⇒ 一律抛领域码，让调用方看到响亮失败。
 */
function parseRecord(text: string | null): Record<string, ResearchParameterValue> {
  if (text === null || text === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ResearchValidationError([
      {
        code: "OOS_FROZEN_SNAPSHOT_MALFORMED",
        path: "frozenSnapshotJson",
        message:
          "冻结快照不是 JSON 对象，无法安全还原参数集"
          + "（拒绝把不可解析的快照降级为空参数集）。",
      },
    ]);
  }
  const out: Record<string, ResearchParameterValue> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    throw new ResearchValidationError([
      {
        code: "OOS_FROZEN_SNAPSHOT_MALFORMED",
        path: `frozenSnapshotJson.${key}`,
        message:
          `冻结快照的参数 ${key} 不是标量值`
          + "（参数冻结要求逐键精确还原，拒绝静默丢弃该键）。",
      },
    ]);
  }
  return out;
}

function readNotes(json: string | null): string[] {
  if (json === null || json === "") return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function safeJsonParse<T>(text: string | null): T | null {
  if (text === null || text === "") return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 行 → 视图投影（唯一落点）
// ---------------------------------------------------------------------------

/** Run 行 → wire 视图。 */
export function toOosRunView(row: OosValidationRunRow): OosValidationRunView {
  const times = oosRunTimestamps(row);
  return {
    recordKind: OOS_VALIDATION_RUN_RECORD_KIND,
    recordVersion: OOS_VALIDATION_RECORD_VERSION,
    oosRunId: row.oosRunId,
    sourceSearchRunId: row.sourceSearchRunId,
    sourceCombinationIndex: row.sourceCombinationIndex,
    sourceParameterHash: row.sourceParameterHash,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    strategyVersionId: row.strategyVersionId,
    strategyDefinitionFingerprint: row.strategyDefinitionFingerprint,
    datasetVersionId: row.datasetVersionId,
    datasetVersionLabel: row.datasetVersionLabel,
    searchWindow: { startDate: String(row.searchStartDate), endDate: String(row.searchEndDate) },
    oosWindow: { startDate: String(row.oosStartDate), endDate: String(row.oosEndDate) },
    searchSnapshotFingerprint: row.searchSnapshotFingerprint,
    fixedCoordinates: parseRecord(row.fixedCoordinatesJson),
    executionPolicyVersion: row.executionPolicyVersion,
    evaluationConfigFingerprint: row.evaluationConfigFingerprint,
    resolvedParameterSet: parseRecord(row.resolvedParameterSetJson),
    metricsVersion: row.metricsVersion,
    engineVersion: row.engineVersion,
    status: parseOosRunStatus(row.status),
    runFingerprint: row.runFingerprint,
    createdAt: times.createdAt,
    startedAt: times.startedAt,
    completedAt: times.completedAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    notes: readNotes(row.notesJson),
  };
}

/** 结果行 → wire 视图。 */
export function toOosResultView(row: OosValidationResultRow): OosValidationResultView {
  const isMetrics: OosMetricsView = {
    totalReturnPct: row.isTotalReturnPct,
    annualizedReturnPct: row.isAnnualizedReturnPct,
    maxDrawdownPct: row.isMaxDrawdownPct,
    tradeCount: row.isTradeCount,
    winRatePct: row.isWinRatePct,
    profitFactor: row.isProfitFactor,
  };
  const oosMetrics: OosMetricsView = {
    totalReturnPct: row.oosTotalReturnPct,
    annualizedReturnPct: row.oosAnnualizedReturnPct,
    maxDrawdownPct: row.oosMaxDrawdownPct,
    tradeCount: row.oosTradeCount,
    winRatePct: row.oosWinRatePct,
    profitFactor: row.oosProfitFactor,
  };
  const comparison =
    safeJsonParse<OosComparisonView>(row.comparisonJson)
    ?? buildOosComparison({ is: isMetrics, oos: oosMetrics, isAvailable: false });
  return {
    recordKind: OOS_VALIDATION_RESULT_RECORD_KIND,
    recordVersion: OOS_VALIDATION_RECORD_VERSION,
    oosRunId: row.oosRunId,
    sourceSearchRunId: row.sourceSearchRunId,
    sourceCombinationIndex: row.sourceCombinationIndex,
    sourceParameterHash: row.sourceParameterHash,
    strategyVersionId: row.strategyVersionId,
    datasetVersionId: row.datasetVersionId,
    resolvedParameterSet: parseRecord(row.resolvedParameterSetJson),
    oosWindow: { startDate: String(row.oosStartDate), endDate: String(row.oosEndDate) },
    searchWindow: { startDate: String(row.searchStartDate), endDate: String(row.searchEndDate) },
    isMetrics,
    isMetricsSource: row.isMetricsSource === "canonical" ? "canonical" : "evaluators",
    oosMetrics,
    oosMetricsSource: row.oosMetricsSource === "canonical" ? "canonical" : "evaluators",
    comparison,
    status: row.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
    error: row.error,
    backtestFingerprint: row.backtestFingerprint,
    evaluationId: row.evaluationId,
    evaluationRunId: row.evaluationRunId,
    executionPolicyVersion: row.executionPolicyVersion,
    metricsVersion: row.metricsVersion,
    engineVersion: row.engineVersion,
    annualizationBasis: safeJsonParse(row.oosAnnualizationBasisJson),
    fingerprint: row.fingerprint,
    notes: readNotes(row.notesJson),
    createdAt: toIso(row.createdAt) ?? "",
  };
}

// ---------------------------------------------------------------------------
// 源上下文（只读）
// ---------------------------------------------------------------------------

/** 读出的源上下文（本层只读；不做任何写操作）。 */
interface OosSourceContext {
  readonly runRow: ParameterSearchRunRow;
  readonly combinations: readonly ParameterSearchCombinationRow[];
  readonly results: readonly ParameterSearchResultRow[];
}

async function readSourceContext(searchRunId: string): Promise<OosSourceContext | null> {
  const runRow = await getParameterSearchRunRow(searchRunId);
  if (runRow === null) return null;
  const [combinations, results] = await Promise.all([
    listParameterSearchCombinationRows(searchRunId),
    listParameterSearchResultRows(searchRunId),
  ]);
  return { runRow, combinations, results };
}

// ---------------------------------------------------------------------------
// 创建（只冻结配置，**不执行**）
// ---------------------------------------------------------------------------

/** 创建输入（参数值**不由调用方提供** —— 唯一指定方式是 `parameterHash`）。 */
export interface CreateOosValidationRunInput {
  readonly sourceSearchRunId: string;
  readonly parameterHash: string;
  readonly oosWindow: { readonly startDate: string; readonly endDate: string };
  /**
   * 策略定义指纹（由调用方经 `definitionFingerprintOfDocument` 算出；`null` = 构造不出 Core 定义）。
   * 本层不自行读取策略文档（保持对策略 IO 的零假设）。
   */
  readonly strategyDefinitionFingerprint: string | null;
  /** 指纹解析的如实说明（进 Run notes）。 */
  readonly definitionFingerprintNote: string;
  /** 指标版本自述覆盖（缺省 = `OOS_METRICS_VERSION`）。 */
  readonly metricsVersion?: string;
  readonly oosRunId?: string;
  readonly createdAt?: string;
}

/** 创建结果（含冻结了什么、窗口隔离判定的结论）。 */
export interface CreateOosValidationRunResult {
  readonly run: OosValidationRunView;
  readonly notes: readonly string[];
}

/**
 * 创建 OOS Run。
 *
 * 判定顺序（顺序即语义；任一步不满足都**响亮拒绝**且**不落任何行**）：
 *   ① 源 Run 存在                              ⇒ `OOS_SOURCE_RUN_NOT_FOUND`
 *   ② 源 Run 门禁（COMPLETED / 有组合 / 有结果 / 不串线）⇒ `OOS_SOURCE_*`
 *   ③ 窗口隔离（形态 / 顺序 / 不重叠 / 在数据集内）    ⇒ `OOS_WINDOW_*`
 *   ④ 冻结候选（组合存在 / hash 一致 / 有成功结果）    ⇒ `OOS_SOURCE_COMBINATION_*`
 *   ⑤ IS 读数 canonical                        ⇒ `OOS_SOURCE_METRICS_NOT_CANONICAL`
 */
export async function createOosValidationRun(
  input: CreateOosValidationRunInput,
): Promise<CreateOosValidationRunResult> {
  const source = await readSourceContext(input.sourceSearchRunId);
  if (source === null) {
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_RUN_NOT_FOUND",
        path: "sourceSearchRunId",
        message: `源 Parameter Search Run 不存在：${input.sourceSearchRunId}`,
      },
    ]);
  }

  assertOosSourceGate({
    searchRunId: input.sourceSearchRunId,
    sourceStatus: source.runRow.status,
    combinationCount: source.combinations.length,
    resultCount: source.results.length,
    observedSearchRunIds: [
      ...source.combinations.map((row) => row.searchRunId),
      ...source.results.map((row) => row.searchRunId),
    ],
  });

  const searchWindow = {
    startDate: String(source.runRow.startDate),
    endDate: String(source.runRow.endDate),
  };
  const datasetWindow =
    source.runRow.datasetVersionId === null
      ? null
      : await readDatasetVersionWindow(source.runRow.datasetVersionId);
  const isolation = assertOosWindowIsolated({
    searchWindow,
    oosWindow: input.oosWindow,
    datasetWindow,
  });

  const candidate = freezeCandidate({
    searchRunId: input.sourceSearchRunId,
    strategyId: source.runRow.strategyId,
    strategyVersion: source.runRow.strategyVersion,
    parameterHash: input.parameterHash,
    combinations: source.combinations,
    results: source.results,
  });

  const isResultRow = source.results.find((row) => row.parameterHash === candidate.parameterHash);
  if (isResultRow === undefined) {
    // freezeCandidate 已保证成功结果存在；此处仅作类型收窄（防御性，不改变判定）。
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_RESULT_MISSING",
        path: "parameterHash",
        message: `组合 ${candidate.parameterHash} 的源结果行在读取后被改动，拒绝继续。`,
      },
    ]);
  }
  assertIsMetricsCanonical({
    searchRunId: input.sourceSearchRunId,
    parameterHash: candidate.parameterHash,
    metricsSource: isResultRow.metricsSource,
  });

  const oosRunId = input.oosRunId ?? generateOosValidationRunId(new Date());
  const createdAt = input.createdAt ?? new Date().toISOString();
  const resolvedParameterSetJson = canonicalStringify(candidate.parameters);
  const strategyVersionId = `${source.runRow.strategyId}@${source.runRow.strategyVersion}`;
  const metricsVersion = input.metricsVersion ?? OOS_METRICS_VERSION;

  const notes = [
    `冻结来源：源 Search Run ${input.sourceSearchRunId} 的组合 #${String(candidate.combinationIndex)}`
      + `（parameterHash = ${candidate.parameterHash}）；参数值从源组合行读出并**重算 hash 复核** —`
      + `接口层不接收参数值（规格 §5：OOS 不允许调参）。`,
    isolation.note,
    `IS 基线来源：源结果行（metricsSource = ${isResultRow.metricsSource}）；`
      + `**不从当前策略版本重新推导**（规格 §5）。`,
    `冻结策略身份：${strategyVersionId}；指标版本自述 ${metricsVersion}；引擎自述 ${OOS_ENGINE_VERSION}。`,
    input.definitionFingerprintNote,
  ];

  const runFingerprint = computeOosRunFingerprint({
    oosRunId,
    sourceSearchRunId: input.sourceSearchRunId,
    sourceParameterHash: candidate.parameterHash,
    strategyVersionId,
    strategyDefinitionFingerprint: input.strategyDefinitionFingerprint,
    datasetVersionId: source.runRow.datasetVersionId,
    searchWindow,
    oosWindow: input.oosWindow,
    searchSnapshotFingerprint: source.runRow.parameterSpaceFingerprint,
    resolvedParameterSetJson,
    executionPolicyVersion: source.runRow.executionPolicyVersion,
    evaluationConfigFingerprint: source.runRow.evaluationConfigFingerprint,
    metricsVersion,
    engineVersion: OOS_ENGINE_VERSION,
  });

  await insertOosValidationRun({
    oosRunId,
    sourceSearchRunId: input.sourceSearchRunId,
    sourceParameterHash: candidate.parameterHash,
    sourceCombinationIndex: candidate.combinationIndex,
    strategyId: source.runRow.strategyId,
    strategyVersion: source.runRow.strategyVersion,
    strategyVersionId,
    strategyDefinitionFingerprint: input.strategyDefinitionFingerprint,
    datasetVersionId: source.runRow.datasetVersionId,
    datasetVersionLabel: source.runRow.datasetVersionLabel,
    searchStartDate: searchWindow.startDate,
    searchEndDate: searchWindow.endDate,
    oosStartDate: input.oosWindow.startDate,
    oosEndDate: input.oosWindow.endDate,
    // 源 Run 的参数空间快照 + FIXED 坐标**原样继承**（不重新解释）
    searchSnapshotJson: source.runRow.parameterSpaceJson,
    searchSnapshotFingerprint: source.runRow.parameterSpaceFingerprint,
    fixedCoordinatesJson: source.runRow.fixedCoordinatesJson,
    executionPolicyVersion: source.runRow.executionPolicyVersion,
    evaluationConfigFingerprint: source.runRow.evaluationConfigFingerprint,
    resolvedParameterSetJson,
    metricsVersion,
    engineVersion: OOS_ENGINE_VERSION,
    status: "CREATED",
    runFingerprint,
    notesJson: JSON.stringify(notes.slice(-MAX_OOS_NOTES)),
    createdAt,
  });

  const row = await getOosValidationRunRow(oosRunId);
  if (row === null) throw new Error(`创建后无法读回 OOS Run ${oosRunId}（写入未生效）`);
  return { run: toOosRunView(row), notes };
}

// ---------------------------------------------------------------------------
// 执行（真跑 Backtest + 真算指标）
// ---------------------------------------------------------------------------

/** 执行输入（策略文档由调用方读库后传入 —— 本层不做策略 IO）。 */
export interface StartOosValidationRunInput {
  readonly document: StrategyDocument;
  readonly codeVersion: string;
  /** 当前文档的定义指纹（调用方经 `definitionFingerprintOfDocument` 算出）。 */
  readonly currentDefinitionFingerprint: string | null;
  readonly createdAt?: string;
}

/** 执行回执（`executed = false` = 已 COMPLETED 且未重跑；幂等重放语义）。 */
export interface StartOosValidationRunOutcome {
  readonly run: OosValidationRunView;
  readonly executed: boolean;
  readonly result: OosValidationResultView | null;
  readonly notes: readonly string[];
}

/**
 * 执行 OOS 验证（**真正重跑 Backtest、真正重算指标**；规格 §9）。
 *
 * 🔴 不做的事（规格 §5 / §11）：
 *   - 不搜索 / 不调整参数（只用 Run 上冻结的那一份）；
 *   - 不修改源 `parameter_search_*` 任何一行（本层根本没有那样的写入口）；
 *   - 不复制源结果的指标到 OOS 侧。
 */
export async function startOosValidationRun(
  oosRunId: string,
  input: StartOosValidationRunInput,
): Promise<StartOosValidationRunOutcome> {
  const notes: string[] = [];
  const runRow = await getOosValidationRunRow(oosRunId);
  if (runRow === null) {
    throw new ResearchValidationError([
      {
        code: "OOS_RUN_NOT_FOUND",
        path: "oosRunId",
        message: `OOS Run 不存在：${oosRunId}`,
      },
    ]);
  }

  const status = parseOosRunStatus(runRow.status);

  // -- 幂等：已 COMPLETED ⇒ 直接回既有结果，不重跑（规格 §12）--
  if (status === "COMPLETED") {
    const existing = await getOosValidationResultRow(oosRunId);
    notes.push("OOS Run 已 COMPLETED ⇒ 幂等返回既有结果，未重新执行（规格 §12）。");
    return {
      run: toOosRunView(runRow),
      executed: false,
      result: existing === null ? null : toOosResultView(existing),
      notes,
    };
  }
  assertOosRunCanExecute(status);
  assertOosRunTransition(status, "RUNNING");

  // -- 策略身份必须与冻结的一致（不得换成 latest）--
  const expectedVersionId = `${runRow.strategyId}@${runRow.strategyVersion}`;
  const actualVersionId = `${input.document.strategyId}@${input.document.version}`;
  if (actualVersionId !== expectedVersionId) {
    throw new ResearchValidationError([
      {
        code: "OOS_STRATEGY_VERSION_MISMATCH",
        path: "strategyVersionId",
        message:
          `OOS Run 冻结的策略身份是 ${expectedVersionId}，但传入的文档是 ${actualVersionId}`
          + "（规格 §8：不得自动使用最新策略版本）。",
      },
    ]);
  }

  const fingerprintCheck = verifyDefinitionFingerprint({
    frozen: runRow.strategyDefinitionFingerprint,
    current: input.currentDefinitionFingerprint,
  });
  notes.push(fingerprintCheck.note);
  if (!fingerprintCheck.ok) {
    const failedAt = new Date().toISOString();
    await updateOosValidationRun(oosRunId, {
      status: "FAILED",
      completedAt: failedAt,
      errorCode: "OOS_STRATEGY_DEFINITION_DRIFT",
      errorMessage: fingerprintCheck.note,
      notesJson: JSON.stringify([...readNotes(runRow.notesJson), ...notes].slice(-MAX_OOS_NOTES)),
    });
    throw new ResearchValidationError([
      {
        code: "OOS_STRATEGY_DEFINITION_DRIFT",
        path: "strategyDefinitionFingerprint",
        message: fingerprintCheck.note,
      },
    ]);
  }

  // -- 复核冻结参数集（防创建后被并发改写）--
  const source = await readSourceContext(runRow.sourceSearchRunId);
  const combinationRow = source?.combinations.find(
    (row) => row.parameterHash === runRow.sourceParameterHash,
  );
  if (combinationRow === undefined) {
    const failedAt = new Date().toISOString();
    const message =
      `源组合行已不存在（Run ${runRow.sourceSearchRunId}，parameterHash ${runRow.sourceParameterHash}）`
      + "⇒ 冻结参数集无法复核，拒绝执行（不回读当前策略版本补全，规格 §5）。";
    await updateOosValidationRun(oosRunId, {
      status: "FAILED",
      completedAt: failedAt,
      errorCode: "OOS_SOURCE_COMBINATION_NOT_FOUND",
      errorMessage: message,
      notesJson: JSON.stringify([...readNotes(runRow.notesJson), ...notes].slice(-MAX_OOS_NOTES)),
    });
    throw new ResearchValidationError([
      { code: "OOS_SOURCE_COMBINATION_NOT_FOUND", path: "parameterHash", message },
    ]);
  }
  assertFrozenParameterSetUnchanged({
    frozenFromRunRow: parseRecord(runRow.resolvedParameterSetJson),
    frozenFromCombinationRow: parseRecord(combinationRow.parametersJson),
  });
  const frozenParameters = parseRecord(runRow.resolvedParameterSetJson);

  // -- 进入 RUNNING（同态重放：已在 RUNNING 会被 assertOosRunCanExecute 拦下，这里只写 CREATED/FAILED/CANCELLED → RUNNING）--
  const startedAt = runRow.startedAt === null ? new Date().toISOString() : toIso(runRow.startedAt)!;
  await updateOosValidationRun(oosRunId, {
    status: "RUNNING",
    startedAt,
    errorCode: null,
    errorMessage: null,
  });

  // -- IS 基线（源结果行的**冻结副本**投影；全仓唯一投影 = toResultView）--
  const isResultRow = source?.results.find(
    (row) => row.parameterHash === runRow.sourceParameterHash,
  );
  const isView = isResultRow === undefined ? null : toResultView(isResultRow);
  const isMetrics: OosMetricsView = isView?.metrics ?? { ...EMPTY_OOS_METRICS };
  const isAvailable =
    isResultRow !== undefined && isResultRow.status === "SUCCEEDED";

  const oosWindow = {
    startDate: String(runRow.oosStartDate),
    endDate: String(runRow.oosEndDate),
  };
  const createdAt = input.createdAt ?? startedAt;

  let oosMetrics: OosMetricsView = { ...EMPTY_OOS_METRICS };
  let oosMetricsSource: "canonical" | "evaluators" = "evaluators";
  let annualizationBasis: { type: "TRADING_DAYS"; daysPerYear: number } | null = null;
  let backtestFingerprint: string | null = null;
  let evaluationId: string | null = null;
  let evaluationRunId: string | null = null;
  let error: string | null = null;

  try {
    /**
     * 🔴 唯一入口：桥内部走完整闭环（data → research → strategy → backtest → evaluation）。
     *   区间 = OOS 窗口（与 Search 窗口不重叠 —— 已在创建时断言过）。
     */
    const bridge = createStrategyBacktestBridge({
      document: input.document,
      codeVersion: input.codeVersion,
      defaultRange: oosWindow,
      createdAt,
      ...(runRow.datasetVersionId === null ? {} : { datasetVersionId: runRow.datasetVersionId }),
    });
    const sample = await bridge.evaluate(frozenParameters);
    const projection = projectCanonicalMetrics(sample.evaluation);
    oosMetrics = projection.metrics;
    oosMetricsSource = projection.metricsSource;
    annualizationBasis = projection.annualizationBasis;
    backtestFingerprint = sample.backtestFingerprint;
    evaluationId = sample.experimentId;
    evaluationRunId = sample.evaluationRunId;
    error = sample.evaluation === null
      ? (sample.outcome.status === "failed" ? sample.outcome.error : "评估未产出可用的 evaluation 引用")
      : null;
    notes.push(
      `OOS 回测已真实执行：window = ${oosWindow.startDate}..${oosWindow.endDate}，`
      + `backtestFingerprint = ${backtestFingerprint ?? "（无）"}，`
      + `metricsSource = ${oosMetricsSource}（指标为本次重跑读数，**非**复制源结果）。`,
    );
  } catch (executionError) {
    error =
      executionError instanceof Error
        ? `${executionError.name}: ${executionError.message}`
        : String(executionError);
    notes.push(`OOS 回测执行抛错：${error}（如实登记为 FAILED，不编造指标）。`);
  }

  const succeeded = error === null;
  const comparison = buildOosComparison({ is: isMetrics, oos: oosMetrics, isAvailable });
  const resultNotes = [...notes, ...comparison.notes];
  const oosRunIdForResult = oosRunId;

  const resultRecordForFingerprint = {
    oosRunId: oosRunIdForResult,
    sourceSearchRunId: runRow.sourceSearchRunId,
    sourceParameterHash: runRow.sourceParameterHash,
    sourceCombinationIndex: runRow.sourceCombinationIndex,
    strategyVersionId: runRow.strategyVersionId,
    datasetVersionId: runRow.datasetVersionId,
    resolvedParameterSetJson: canonicalStringify(frozenParameters),
    oosWindow,
    isMetrics,
    isMetricsSource: isView?.metricsSource ?? "evaluators",
    oosMetrics,
    oosMetricsSource,
    status: succeeded ? "SUCCEEDED" : "FAILED",
    error,
    backtestFingerprint,
    executionPolicyVersion: BACKTEST_EXECUTION_POLICY_VERSION,
    metricsVersion: runRow.metricsVersion,
    engineVersion: runRow.engineVersion,
  };
  const resultFingerprint = computeOosResultFingerprint(resultRecordForFingerprint);

  await upsertOosValidationResult({
    oosRunId: oosRunIdForResult,
    sourceSearchRunId: runRow.sourceSearchRunId,
    sourceParameterHash: runRow.sourceParameterHash,
    sourceCombinationIndex: runRow.sourceCombinationIndex,
    strategyVersionId: runRow.strategyVersionId,
    datasetVersionId: runRow.datasetVersionId,
    resolvedParameterSetJson: canonicalStringify(frozenParameters),
    searchStartDate: String(runRow.searchStartDate),
    searchEndDate: String(runRow.searchEndDate),
    oosStartDate: oosWindow.startDate,
    oosEndDate: oosWindow.endDate,
    isTotalReturnPct: isMetrics.totalReturnPct,
    isAnnualizedReturnPct: isMetrics.annualizedReturnPct,
    isMaxDrawdownPct: isMetrics.maxDrawdownPct,
    isTradeCount: isMetrics.tradeCount,
    isWinRatePct: isMetrics.winRatePct,
    isProfitFactor: isMetrics.profitFactor,
    isMetricsSource: isView?.metricsSource ?? "evaluators",
    isAnnualizationBasisJson:
      isView?.annualizationBasis === null || isView?.annualizationBasis === undefined
        ? null
        : JSON.stringify(isView.annualizationBasis),
    oosTotalReturnPct: oosMetrics.totalReturnPct,
    oosAnnualizedReturnPct: oosMetrics.annualizedReturnPct,
    oosMaxDrawdownPct: oosMetrics.maxDrawdownPct,
    oosTradeCount: oosMetrics.tradeCount,
    oosWinRatePct: oosMetrics.winRatePct,
    oosProfitFactor: oosMetrics.profitFactor,
    oosMetricsSource,
    oosAnnualizationBasisJson: annualizationBasis === null ? null : JSON.stringify(annualizationBasis),
    comparisonJson: JSON.stringify(comparison),
    status: succeeded ? "SUCCEEDED" : "FAILED",
    error,
    backtestFingerprint,
    evaluationId,
    evaluationRunId,
    executionPolicyVersion: BACKTEST_EXECUTION_POLICY_VERSION,
    metricsVersion: runRow.metricsVersion,
    engineVersion: runRow.engineVersion,
    fingerprint: resultFingerprint,
    notesJson: JSON.stringify(resultNotes.slice(-MAX_OOS_NOTES)),
  });

  const completedAt = new Date().toISOString();
  const finalStatus = succeeded ? "COMPLETED" : "FAILED";
  assertOosRunTransition("RUNNING", finalStatus);
  await updateOosValidationRun(oosRunId, {
    status: finalStatus,
    completedAt,
    errorCode: succeeded ? null : "OOS_EXECUTION_FAILED",
    errorMessage: succeeded ? null : error,
    notesJson: JSON.stringify([...readNotes(runRow.notesJson), ...resultNotes].slice(-MAX_OOS_NOTES)),
  });

  const updatedRun = await getOosValidationRunRow(oosRunId);
  if (updatedRun === null) throw new Error(`执行后无法读回 OOS Run ${oosRunId}`);
  const resultRow = await getOosValidationResultRow(oosRunId);

  return {
    run: toOosRunView(updatedRun),
    executed: true,
    result: resultRow === null ? null : toOosResultView(resultRow),
    notes: resultNotes,
  };
}

// ---------------------------------------------------------------------------
// 取消 / 读取 / 列表
// ---------------------------------------------------------------------------

/** 取消 Run（同态重放幂等；`COMPLETED` 不可取消 —— 它已经是终态且有产物）。 */
export async function cancelOosValidationRun(oosRunId: string): Promise<OosValidationRunView> {
  const row = await getOosValidationRunRow(oosRunId);
  if (row === null) {
    throw new ResearchValidationError([
      { code: "OOS_RUN_NOT_FOUND", path: "oosRunId", message: `OOS Run 不存在：${oosRunId}` },
    ]);
  }
  const status = parseOosRunStatus(row.status);
  assertOosRunTransition(status, "CANCELLED");
  if (status !== "CANCELLED") {
    await updateOosValidationRun(oosRunId, {
      status: "CANCELLED",
      completedAt: new Date().toISOString(),
    });
  }
  const updated = await getOosValidationRunRow(oosRunId);
  if (updated === null) throw new Error(`取消后无法读回 OOS Run ${oosRunId}`);
  return toOosRunView(updated);
}

/** 读取 Run 详情。 */
export async function readOosValidationRun(
  oosRunId: string,
): Promise<OosValidationRunView | null> {
  const row = await getOosValidationRunRow(oosRunId);
  return row === null ? null : toOosRunView(row);
}

/** 读取结果（不存在 ⇒ null；`CREATED` 状态的正常形态）。 */
export async function readOosValidationResult(
  oosRunId: string,
): Promise<OosValidationResultView | null> {
  const row = await getOosValidationResultRow(oosRunId);
  return row === null ? null : toOosResultView(row);
}

/** 列出 Run（列表页；`limit` 缺省 50）。 */
export async function listOosValidationRuns(options: {
  readonly limit?: number;
  readonly offset?: number;
  readonly sourceSearchRunId?: string;
}): Promise<OosValidationRunView[]> {
  const rows = await listOosValidationRunRows({
    limit: options.limit ?? DEFAULT_OOS_RUN_LIST_LIMIT,
    ...(options.offset === undefined ? {} : { offset: options.offset }),
    ...(options.sourceSearchRunId === undefined
      ? {}
      : { sourceSearchRunId: options.sourceSearchRunId }),
  });
  return rows.map(toOosRunView);
}

/** 列出某 Run 的全部结果行（1 Run = 1 候选 ⇒ 0 或 1 行；数组形态便于未来扩展）。 */
export async function listOosValidationResults(
  oosRunId: string,
): Promise<OosValidationResultView[]> {
  const rows = await listOosValidationResultRows(oosRunId);
  return rows.map(toOosResultView);
}
