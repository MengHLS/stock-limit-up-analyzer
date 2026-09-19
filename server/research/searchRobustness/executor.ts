/**
 * ROBUSTNESS-001 §10 / §13 / §14 / §16 — 编排层（create / start / cancel / read / list / results）。
 *
 * ## 一句话：本层做三件事，且**只**做这三件事
 *
 * 1. **读源**：经 `parameterSearch/persistence.ts` 的**既有**读函数读源 Run / 组合 / 结果
 *    （不新写一套 SQL —— 那会造成「同一张表两套读取口径」）；
 * 2. **冻结**：把源 Run 的参数空间快照 + FIXED 坐标**原样继承**进本 Run（规格 §9：
 *    不从当前 Strategy Version 重新解释历史搜索）；
 * 3. **落档**：把纯函数产出的判定结果写三表（规格 §13/§14/§15）。
 *
 * 🔴 本层**不调用** Backtest、**不调用** 评估端口、**不重算**任何 canonical metrics。
 *   执行链在 `analysis.ts`（纯函数）里，只消费已读出的行（规格 §2 / §21 A/B）。
 */

import {
  parameterSearchSpaceDefinitionSchema,
  type ParameterSearchRunStatus,
} from "../../../shared/parameterSearchContracts";
import type {
  RobustnessCombinationStatusView,
  RobustnessDispersionView,
  RobustnessMatrixView,
  RobustnessNeighborView,
  RobustnessParameterSensitivityVerdictView,
  RobustnessParameterSensitivityView,
  SearchRobustnessParameterAnalysisView,
  SearchRobustnessResultView,
  SearchRobustnessRunView,
  SearchRobustnessSummaryView,
} from "../../../shared/searchRobustnessContracts";
import { ResearchValidationError } from "../experimentValidation";
import {
  getParameterSearchRunRow,
  listParameterSearchCombinationRows,
  listParameterSearchResultRows,
  type ParameterSearchCombinationRow,
  type ParameterSearchResultRow,
  type ParameterSearchRunRow,
} from "../parameterSearch/persistence";
import {
  assertRobustnessGate,
  resolveParameterReferenceStatus,
  RobustnessSummaryAccumulator,
} from "./gate";
import {
  getSearchRobustnessRunRow,
  insertSearchRobustnessRun,
  listSearchRobustnessParameterAnalysisRows,
  listSearchRobustnessResultRows,
  listSearchRobustnessRunRows,
  robustnessRunTimestamps,
  serializeAnalysisConfig,
  summaryToColumns,
  updateSearchRobustnessRun,
  upsertSearchRobustnessParameterAnalyses,
  upsertSearchRobustnessResults,
  type SearchRobustnessParameterAnalysisRow,
  type SearchRobustnessResultRow,
  type SearchRobustnessRunRow,
} from "./persistence";
import { analyzeSearchRobustness } from "./analysis";
import {
  assertRobustnessRunTransition,
  computeSearchRobustnessRunFingerprint,
  emptyRobustnessSummary,
  generateSearchRobustnessRunId,
  parseRobustnessRunStatus,
  resolveRobustnessAnalysisConfig,
} from "./run";
import {
  SEARCH_ROBUSTNESS_RUN_RECORD_KIND,
  SEARCH_ROBUSTNESS_RUN_RECORD_VERSION,
  type RobustnessAnalysisConfig,
  type RobustnessMatrix,
  type RobustnessParameterValue,
  type RobustnessSourceCombination,
  type RobustnessSourceResult,
  type SearchRobustnessParameterAnalysis,
  type SearchRobustnessResult,
  type SearchRobustnessRun,
  type SearchRobustnessSummary,
} from "./types";

// ---------------------------------------------------------------------------
// JSON 小工具（读库列 → 值；坏值**响亮抛错**，不静默成空）
// ---------------------------------------------------------------------------

function parseJsonObject(text: string | null, path: string): Record<string, RobustnessParameterValue> {
  if (text === null || text === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_ROW_JSON_INVALID",
        path,
        message: `列内容不是合法 JSON：${(error as Error).message}`,
      },
    ]);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ResearchValidationError([
      { code: "ROBUSTNESS_ROW_JSON_INVALID", path, message: "列内容不是 JSON 对象。" },
    ]);
  }
  return parsed as Record<string, RobustnessParameterValue>;
}

function parseJsonArray<T>(text: string | null, path: string): T[] {
  if (text === null || text === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_ROW_JSON_INVALID",
        path,
        message: `列内容不是合法 JSON：${(error as Error).message}`,
      },
    ]);
  }
  if (!Array.isArray(parsed)) {
    throw new ResearchValidationError([
      { code: "ROBUSTNESS_ROW_JSON_INVALID", path, message: "列内容不是 JSON 数组。" },
    ]);
  }
  return parsed as T[];
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

// ---------------------------------------------------------------------------
// 源读取（经既有读函数；带 gate）
// ---------------------------------------------------------------------------

/** 读源（含 gate 校验；**只读**，对 `parameter_search_*` 无任何写入）。 */
async function loadSource(searchRunId: string): Promise<{
  readonly runRow: ParameterSearchRunRow;
  readonly combinationRows: readonly ParameterSearchCombinationRow[];
  readonly resultRows: readonly ParameterSearchResultRow[];
}> {
  const runRow = await getParameterSearchRunRow(searchRunId);
  if (runRow === null) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_SEARCH_RUN_NOT_FOUND",
        path: "sourceSearchRunId",
        message:
          `源 Search Run 不存在：${searchRunId}。`
          + "稳健性分析只消费已存在的 Parameter Search Run，不隐式创建。",
      },
    ]);
  }
  const combinationRows = await listParameterSearchCombinationRows(searchRunId);
  const resultRows = await listParameterSearchResultRows(searchRunId);

  assertRobustnessGate({
    searchRunId,
    sourceStatus: runRow.status,
    combinationCount: combinationRows.length,
    resultCount: resultRows.length,
    metricsSources: resultRows.map((row) => row.metricsSource),
    observedSearchRunIds: [
      ...combinationRows.map((row) => row.searchRunId),
      ...resultRows.map((row) => row.searchRunId),
    ],
  });

  return { runRow, combinationRows, resultRows };
}

/** 源组合行 → 分析输入。 */
function toSourceCombination(row: ParameterSearchCombinationRow): RobustnessSourceCombination {
  return {
    parameterHash: row.parameterHash,
    combinationIndex: row.combinationIndex,
    parameters: parseJsonObject(row.parametersJson, "parameter_search_combination.parametersJson"),
  };
}

/** 源结果行 → 分析输入（指标**原样读取**，零派生）。 */
function toSourceResult(row: ParameterSearchResultRow): RobustnessSourceResult {
  return {
    parameterHash: row.parameterHash,
    status: row.status,
    error: row.error,
    metricsSource: row.metricsSource,
    metrics: {
      totalReturnPct: row.totalReturnPct,
      annualizedReturnPct: row.annualizedReturnPct,
      maxDrawdownPct: row.maxDrawdownPct,
      tradeCount: row.tradeCount,
      winRatePct: row.winRatePct,
      profitFactor: row.profitFactor,
    },
  };
}

/** 解析源 Run 的冻结参数空间快照（损坏即抛，不静默给空壳）。 */
function parseFrozenSnapshot(text: string): SearchRobustnessRun["searchSnapshot"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_SNAPSHOT_INVALID",
        path: "searchSnapshotJson",
        message: `源 Search Run 的参数空间快照不是合法 JSON：${(error as Error).message}`,
      },
    ]);
  }
  const result = parameterSearchSpaceDefinitionSchema.safeParse(parsed);
  if (!result.success) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_SNAPSHOT_INVALID",
        path: "searchSnapshotJson",
        message:
          "源 Search Run 的参数空间快照结构不合法（拒绝在残缺快照上做邻域分析）："
          + result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；"),
      },
    ]);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// 视图投影（行 → wire 视图；唯一落点）
// ---------------------------------------------------------------------------

function emptySnapshotPlaceholder(row: SearchRobustnessRunRow): SearchRobustnessRun["searchSnapshot"] {
  return {
    recordKind: "PARAMETER_SEARCH_SPACE",
    recordVersion: 1,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    parameters: [],
    notes: ["（列表查询不含冻结快照；请打开详情读取）"],
  };
}

/** Run 行 → 视图（列表 / 详情共用；列表行不含长文本快照与口径）。 */
export function toSearchRobustnessRunView(row: SearchRobustnessRunRow): SearchRobustnessRunView {
  const summary = parseSummary(row.summaryJson, row);
  const codes = parseJsonArray<string>(row.sourceUnreferencedCodesJson, "sourceUnreferencedCodesJson");
  const snapshot =
    row.searchSnapshotJson === "" || row.searchSnapshotJson === null
      ? emptySnapshotPlaceholder(row)
      : parseFrozenSnapshot(row.searchSnapshotJson);
  const timestamps = robustnessRunTimestamps(row);
  return {
    robustnessRunId: row.robustnessRunId,
    sourceSearchRunId: row.sourceSearchRunId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    datasetVersionId: row.datasetVersionId,
    datasetVersionLabel: row.datasetVersionLabel,
    startDate: String(row.startDate),
    endDate: String(row.endDate),
    searchMethod: row.searchMethod,
    searchSnapshot: snapshot,
    searchSnapshotFingerprint: row.searchSnapshotFingerprint,
    fixedCoordinates: parseJsonObject(row.fixedCoordinatesJson, "fixedCoordinatesJson"),
    executionPolicyVersion: row.executionPolicyVersion,
    evaluationConfigFingerprint: row.evaluationConfigFingerprint,
    sourceReferenceCheckApplied: row.sourceReferenceCheckApplied,
    sourceUnreferencedTunableCodes: codes,
    analysisConfig: resolveRobustnessAnalysisConfig(
      parseJsonObject(row.analysisConfigJson, "analysisConfigJson"),
    ),
    status: parseRobustnessRunStatus(row.status),
    summary,
    createdAt: timestamps.createdAt,
    startedAt: timestamps.startedAt,
    completedAt: timestamps.completedAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    notes: parseJsonArray<string>(row.notesJson, "notesJson"),
  };
}

/** 汇总回读：优先用 `summaryJson`；缺失（老行 / 列表未取）则由计数列重建并**标注未知项**。 */
function parseSummary(
  json: string | null,
  row: SearchRobustnessRunRow,
): SearchRobustnessSummary {
  if (json !== null && json !== "") {
    const parsed = JSON.parse(json) as Partial<SearchRobustnessSummary>;
    const reference = resolveParameterReferenceStatus({
      referenceCheckApplied: row.sourceReferenceCheckApplied,
      unreferencedTunableCodes: parseJsonArray<string>(
        row.sourceUnreferencedCodesJson,
        "sourceUnreferencedCodesJson",
      ),
    });
    return {
      sourceCombinationCount: Number(parsed.sourceCombinationCount ?? 0),
      analyzedCombinationCount: Number(parsed.analyzedCombinationCount ?? row.analyzedCount ?? 0),
      stableCount: Number(parsed.stableCount ?? row.stableCount ?? 0),
      unstableCount: Number(parsed.unstableCount ?? row.unstableCount ?? 0),
      insufficientTradingActivityCount: Number(parsed.insufficientTradingActivityCount ?? 0),
      insufficientNeighborhoodCount: Number(parsed.insufficientNeighborhoodCount ?? 0),
      sourceResultUnavailableCount: Number(parsed.sourceResultUnavailableCount ?? 0),
      neighborhoodIncompleteCount: Number(parsed.neighborhoodIncompleteCount ?? row.neighborhoodIncompleteCount ?? 0),
      parameterReferenceUnverified: !reference.verified,
      parameterReferenceNote: reference.note,
    };
  }
  return emptyRobustnessSummary(0, resolveParameterReferenceStatus({
    referenceCheckApplied: row.sourceReferenceCheckApplied,
    unreferencedTunableCodes: parseJsonArray<string>(
      row.sourceUnreferencedCodesJson,
      "sourceUnreferencedCodesJson",
    ),
  }));
}

/** 单组合结果行 → 视图。 */
export function toSearchRobustnessResultView(
  row: SearchRobustnessResultRow,
): SearchRobustnessResultView {
  return {
    robustnessRunId: row.robustnessRunId,
    sourceSearchRunId: row.sourceSearchRunId,
    parameterHash: row.parameterHash,
    combinationIndex: row.combinationIndex,
    parameters: parseJsonObject(row.parametersJson, "search_robustness_result.parametersJson"),
    metrics: {
      totalReturnPct: row.totalReturnPct,
      annualizedReturnPct: row.annualizedReturnPct,
      maxDrawdownPct: row.maxDrawdownPct,
      tradeCount: row.tradeCount,
      winRatePct: row.winRatePct,
      profitFactor: row.profitFactor,
    },
    metricsSource: row.metricsSource,
    status: row.status as RobustnessCombinationStatusView,
    stable: row.stable,
    stabilityRatio: row.stabilityRatio,
    stableNeighborCount: row.stableNeighborCount,
    validNeighborCount: row.validNeighborCount,
    expectedNeighborCount: row.expectedNeighborCount,
    presentNeighborCount: row.presentNeighborCount,
    neighborhoodIncomplete: row.neighborhoodIncomplete,
    statusReason: row.statusReason,
    neighbors: parseJsonArray<RobustnessNeighborView>(row.neighborsJson, "neighborsJson"),
    dispersion: parseJsonArray<RobustnessDispersionView>(row.dispersionJson, "dispersionJson"),
    sensitivity: parseJsonArray<RobustnessParameterSensitivityView>(
      row.sensitivityJson,
      "sensitivityJson",
    ),
    fingerprint: row.fingerprint,
  };
}

/** 单参数分析行 → 视图。 */
export function toSearchRobustnessParameterAnalysisView(
  row: SearchRobustnessParameterAnalysisRow,
): SearchRobustnessParameterAnalysisView {
  return {
    robustnessRunId: row.robustnessRunId,
    sourceSearchRunId: row.sourceSearchRunId,
    parameterName: row.parameterName,
    domainMode: row.domainMode,
    domainValueCount: row.domainValueCount,
    numeric: row.numeric,
    analyzedValueCount: row.analyzedValueCount,
    stableCombinationCount: row.stableCombinationCount,
    unstableCombinationCount: row.unstableCombinationCount,
    sensitivity: JSON.parse(row.sensitivityJson) as RobustnessParameterSensitivityView,
    valueDispersion: JSON.parse(row.valueDispersionJson) as RobustnessDispersionView[],
    verdict: row.verdict as RobustnessParameterSensitivityVerdictView,
    fingerprint: row.fingerprint,
  };
}

/** Run 视图形态（唯一权威 = `shared/searchRobustnessContracts.ts#SearchRobustnessRunView`）。 */
export type SearchRobustnessRunViewShape = SearchRobustnessRunView;

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

/** 创建输入。 */
export interface CreateSearchRobustnessRunInput {
  readonly sourceSearchRunId: string;
  readonly analysisConfig?: RobustnessAnalysisConfig;
  /** Run ID 缺省自动生成（注入则确定性，测试用）。 */
  readonly robustnessRunId?: string;
  /** 创建时间缺省当前时刻（注入则确定性，测试用）。 */
  readonly createdAt?: string;
}

/** 创建结果。 */
export interface CreateSearchRobustnessRunResult {
  readonly run: SearchRobustnessRunViewShape;
  readonly notes: readonly string[];
}

/**
 * 创建 Robustness Run（**只做 gate + 冻结快照 + 落 Run 行，不跑分析**）。
 *
 * 拆分的意义：用户可以**先看清**「将要分析哪个 Search Run、口径是什么、参数引用是否已验证」，
 * 再决定是否 start（与 PARAMETER-001 的 createSearch / startSearch 同构）。
 */
export async function createSearchRobustnessRun(
  input: CreateSearchRobustnessRunInput,
): Promise<CreateSearchRobustnessRunResult> {
  const source = await loadSource(input.sourceSearchRunId);
  const runRow = source.runRow;
  const config = resolveRobustnessAnalysisConfig(input.analysisConfig);
  const reference = resolveParameterReferenceStatus({
    referenceCheckApplied: runRow.referenceCheckApplied,
    unreferencedTunableCodes: parseJsonArray<string>(
      runRow.unreferencedTunableCodesJson,
      "unreferencedTunableCodesJson",
    ),
  });

  const snapshotJson = runRow.parameterSpaceJson;
  const snapshot = parseFrozenSnapshot(snapshotJson);
  const robustnessRunId =
    input.robustnessRunId ?? generateSearchRobustnessRunId(new Date(), Math.random().toString(16).slice(2, 10));

  const notes: string[] = [];
  notes.push(
    `源 Search Run ${runRow.searchRunId}：状态 ${runRow.status}，组合 ${String(source.combinationRows.length)} 个，`
      + `结果 ${String(source.resultRows.length)} 行（全部 canonical ✅）。`,
  );
  notes.push(
    `冻结快照：参数空间指纹 ${runRow.parameterSpaceFingerprint.slice(0, 12)}…`
      + `（原样继承，不从当前 Strategy Version 重新解释）。`,
  );
  notes.push(`判定口径已持久化：${JSON.stringify(config)}。`);
  notes.push(reference.note);

  await insertSearchRobustnessRun({
    robustnessRunId,
    sourceSearchRunId: runRow.searchRunId,
    strategyId: runRow.strategyId,
    strategyVersion: runRow.strategyVersion,
    datasetVersionId: runRow.datasetVersionId,
    datasetVersionLabel: runRow.datasetVersionLabel,
    startDate: String(runRow.startDate),
    endDate: String(runRow.endDate),
    searchMethod: runRow.searchMethod,
    searchSnapshotJson: snapshotJson,
    searchSnapshotFingerprint: runRow.parameterSpaceFingerprint,
    fixedCoordinatesJson: runRow.fixedCoordinatesJson,
    executionPolicyVersion: runRow.executionPolicyVersion,
    evaluationConfigFingerprint: runRow.evaluationConfigFingerprint,
    sourceReferenceCheckApplied: runRow.referenceCheckApplied,
    sourceUnreferencedCodesJson: runRow.unreferencedTunableCodesJson,
    analysisConfigJson: serializeAnalysisConfig(config),
    status: "CREATED",
  });
  await updateSearchRobustnessRun(robustnessRunId, { notesJson: JSON.stringify(notes) });

  const created = await getSearchRobustnessRunRow(robustnessRunId);
  if (created === null) {
    throw new Error(`Robustness Run 创建后读回失败（${robustnessRunId}）；拒绝返回未落库的对象。`);
  }
  void snapshot;
  return { run: toSearchRobustnessRunView(created), notes };
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

/** 执行输入。 */
export interface StartSearchRobustnessRunInput {
  readonly robustnessRunId: string;
}

/** 执行结果。 */
export interface StartSearchRobustnessRunResult {
  readonly run: SearchRobustnessRunViewShape;
  readonly resultCount: number;
  readonly parameterCount: number;
  readonly notes: readonly string[];
}

/**
 * 执行分析（**唯一会写 Result / ParameterAnalysis 的入口**）。
 *
 * 失败路径**必须收敛**：状态置 `FAILED` + 领域码 + 消息，然后**原样抛**（不吞异常）。
 */
export async function startSearchRobustnessRun(
  input: StartSearchRobustnessRunInput,
): Promise<StartSearchRobustnessRunResult> {
  const existing = await getSearchRobustnessRunRow(input.robustnessRunId);
  if (existing === null) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_RUN_NOT_FOUND",
        path: "robustnessRunId",
        message: `Robustness Run 不存在：${input.robustnessRunId}`,
      },
    ]);
  }
  const from = parseRobustnessRunStatus(existing.status);
  assertRobustnessRunTransition(from, "RUNNING");

  const startedAt = existing.startedAt === null ? new Date().toISOString() : toIsoString(existing.startedAt);
  await updateSearchRobustnessRun(input.robustnessRunId, {
    status: "RUNNING",
    startedAt,
    errorCode: null,
    errorMessage: null,
  });

  try {
    // 源在 start 时刻**重新读一次并重新过 gate**：期间若有人 retry 了源搜索，状态会不再是
    // COMPLETED ⇒ 这里会响亮拒绝，而不是拿「半新半旧」的网格出结论。
    const source = await loadSource(existing.sourceSearchRunId);

    const config = resolveRobustnessAnalysisConfig(
      parseJsonObject(existing.analysisConfigJson, "analysisConfigJson"),
    );
    const snapshot = parseFrozenSnapshot(existing.searchSnapshotJson);
    const reference = resolveParameterReferenceStatus({
      referenceCheckApplied: existing.sourceReferenceCheckApplied,
      unreferencedTunableCodes: parseJsonArray<string>(
        existing.sourceUnreferencedCodesJson,
        "sourceUnreferencedCodesJson",
      ),
    });

    const outcome = analyzeSearchRobustness({
      robustnessRunId: input.robustnessRunId,
      sourceSearchRunId: existing.sourceSearchRunId,
      searchSnapshot: snapshot,
      combinations: source.combinationRows.map(toSourceCombination),
      results: source.resultRows.map(toSourceResult),
      config,
    });

    await upsertSearchRobustnessResults(outcome.results);
    await upsertSearchRobustnessParameterAnalyses(outcome.parameterAnalyses);

    const summary: SearchRobustnessSummary = {
      ...outcome.summary,
      sourceCombinationCount: source.combinationRows.length,
      parameterReferenceUnverified: !reference.verified,
      parameterReferenceNote: reference.note,
    };
    const notes = [...outcome.notes, reference.note];

    await updateSearchRobustnessRun(input.robustnessRunId, {
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
      summaryJson: JSON.stringify(summary),
      notesJson: JSON.stringify(notes),
      ...summaryToColumns(summary),
    });

    const done = await getSearchRobustnessRunRow(input.robustnessRunId);
    if (done === null) {
      throw new Error(`Robustness Run 完成后读回失败（${input.robustnessRunId}）。`);
    }
    return {
      run: toSearchRobustnessRunView(done),
      resultCount: outcome.results.length,
      parameterCount: outcome.parameterAnalyses.length,
      notes,
    };
  } catch (error) {
    await updateSearchRobustnessRun(input.robustnessRunId, {
      status: "FAILED",
      completedAt: new Date().toISOString(),
      errorCode: error instanceof ResearchValidationError ? error.issues[0]?.code ?? "ROBUSTNESS_ANALYSIS_FAILED" : "ROBUSTNESS_ANALYSIS_FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// cancel / read / list
// ---------------------------------------------------------------------------

/** 取消（只允许从 CREATED / RUNNING 出发；同态幂等）。 */
export async function cancelSearchRobustnessRun(
  robustnessRunId: string,
): Promise<SearchRobustnessRunViewShape> {
  const row = await getSearchRobustnessRunRow(robustnessRunId);
  if (row === null) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_RUN_NOT_FOUND",
        path: "robustnessRunId",
        message: `Robustness Run 不存在：${robustnessRunId}`,
      },
    ]);
  }
  const from = parseRobustnessRunStatus(row.status);
  assertRobustnessRunTransition(from, "CANCELLED");
  await updateSearchRobustnessRun(robustnessRunId, {
    status: "CANCELLED",
    completedAt: row.completedAt === null ? new Date().toISOString() : toIsoString(row.completedAt),
  });
  const updated = await getSearchRobustnessRunRow(robustnessRunId);
  if (updated === null) throw new Error(`Robustness Run 取消后读回失败（${robustnessRunId}）。`);
  return toSearchRobustnessRunView(updated);
}

/** 读单个 Run（不存在返回 null；由 router 决定是否 404）。 */
export async function readSearchRobustnessRun(
  robustnessRunId: string,
): Promise<SearchRobustnessRunViewShape | null> {
  const row = await getSearchRobustnessRunRow(robustnessRunId);
  return row === null ? null : toSearchRobustnessRunView(row);
}

/** 列表。 */
export async function listSearchRobustnessRuns(options: {
  readonly limit: number;
  readonly offset?: number;
  readonly sourceSearchRunId?: string;
}): Promise<SearchRobustnessRunViewShape[]> {
  const rows = await listSearchRobustnessRunRows(options);
  return rows.map(toSearchRobustnessRunView);
}

/** 读单参数分析（详情页）。 */
export async function listSearchRobustnessParameterAnalyses(robustnessRunId: string) {
  const rows = await listSearchRobustnessParameterAnalysisRows(robustnessRunId);
  return rows.map(toSearchRobustnessParameterAnalysisView);
}

/** 读结果（服务端排序 / 过滤；**只做描述性排序，不产出推荐**）。 */
export async function listSearchRobustnessResults(
  robustnessRunId: string,
  options: {
    readonly sortBy?: string;
    readonly sortDirection?: "ASC" | "DESC";
    readonly status?: string;
    readonly neighborhoodIncompleteOnly?: boolean;
    readonly minTradeCount?: number;
    readonly limit?: number;
    readonly offset?: number;
  },
): Promise<{
  readonly robustnessRunId: string;
  readonly total: number;
  readonly returned: number;
  readonly truncated: boolean;
  readonly results: ReturnType<typeof toSearchRobustnessResultView>[];
}> {
  const rows = await listSearchRobustnessResultRows(robustnessRunId, { includeDetail: false });
  let filtered = rows.map(toSearchRobustnessResultView);
  if (options.status !== undefined) {
    filtered = filtered.filter((row) => row.status === options.status);
  }
  if (options.neighborhoodIncompleteOnly === true) {
    filtered = filtered.filter((row) => row.neighborhoodIncomplete);
  }
  if (options.minTradeCount !== undefined) {
    filtered = filtered.filter((row) => (row.metrics.tradeCount ?? -1) >= (options.minTradeCount as number));
  }

  const sortBy = options.sortBy ?? "combinationIndex";
  const direction = options.sortDirection ?? "ASC";
  const sorted = [...filtered].sort((left, right) => {
    const a = sortValue(left, sortBy);
    const b = sortValue(right, sortBy);
    if (a === b) return left.combinationIndex - right.combinationIndex;
    // 🔴 `null` 不参与「高低」比较：恒排在后面（`null` = 不可用，不是「最小」）。
    if (a === null) return 1;
    if (b === null) return -1;
    return direction === "ASC" ? a - b : b - a;
  });

  const total = sorted.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? total;
  const page = sorted.slice(offset, offset + limit);
  return {
    robustnessRunId,
    total,
    returned: page.length,
    truncated: offset + page.length < total,
    results: page,
  };
}

/** 排序取值（`null` 表示不可用）。 */
function sortValue(row: ReturnType<typeof toSearchRobustnessResultView>, field: string): number | null {
  switch (field) {
    case "combinationIndex":
      return row.combinationIndex;
    case "totalReturnPct":
      return row.metrics.totalReturnPct;
    case "annualizedReturnPct":
      return row.metrics.annualizedReturnPct;
    case "maxDrawdownPct":
      return row.metrics.maxDrawdownPct;
    case "tradeCount":
      return row.metrics.tradeCount;
    case "winRatePct":
      return row.metrics.winRatePct;
    case "profitFactor":
      return row.metrics.profitFactor;
    case "stabilityRatio":
      return row.stabilityRatio;
    default:
      return null;
  }
}

/** 空矩阵（`CREATED` 状态详情页如实展示「尚未分析」）。 */
export function emptyMatrix(): RobustnessMatrix {
  return {
    rowAxis: { parameter: "(尚未分析)", domainMode: "(尚未分析)", values: [] },
    columnAxis: { parameter: "(尚未分析)", domainMode: "(尚未分析)", values: [] },
    cells: [],
    parameterCount: 0,
    omittedParameters: [],
  };
}
