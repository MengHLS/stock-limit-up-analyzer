/**
 * WALK-FORWARD-001 — Run / Fold 编排执行器（规格 §5 / §6 / §11 / §12 / §16）。
 *
 * ## 这个文件是「编排层」，不是引擎
 *
 * 它**不做**任何策略求值、回测、指标计算、参数搜索 —— 那些各自有唯一权威
 * （`strategyCore/**` / `backtest/**` / `parameterSearch/**` / `oosValidation/**`）。
 * 它只负责把「多个时间窗口」串成一条可审计的流水线：
 *
 * ```text
 * 创建：planWalkForwardFolds → assertFoldsWithinDatasetRange → 冻结排程/策略/数据集/策略身份
 *      → 落 1 行 Run + N 行 Fold（WINDOW_CREATED）
 * 执行：逐 Fold 串行 —— SEARCH_RUNNING → runFoldSearch → 泄漏守卫
 *      → SEARCH_COMPLETED → selectFoldCandidate（冻结候选）→ CANDIDATE_FROZEN
 *      → OOS_RUNNING → runFoldOos → 泄漏守卫 → OOS_COMPLETED
 *      → 汇总（只做描述性统计）→ Run 终态
 * ```
 *
 * ## 🔴 三条硬纪律
 *
 * 1. **Fold 串行**：`assertFoldExecutionOrder` 保证「要跑第 i 个 Fold 时，比它早的全部已终态」。
 *    交错执行会让「哪个搜索读了哪段数据」的审计结论失效（规格 §11）。
 * 2. **每 Fold 独立搜索**：`assertIndependentFoldSearches` 拒绝「同一 Search Run 被两个 Fold 复用」
 *    —— 那正是「先跑一次全局搜索、再切成多个 OOS Fold」的形态（规格 §11 明禁）。
 * 3. **失败不伪造**：任一 Fold 抛错 ⇒ 该 Fold `FAILED` 且**立即停止**（后续 Fold 保持
 *    `WINDOW_CREATED`，如实登记「从未执行」）；Run 变 `FAILED` 但**照样**落一份汇总
 *    （只为已经走完的 Fold 做描述性统计，缺席原因写进 notes）。
 *
 * ## 🔴 确定性（规格 §16）
 *
 * 「同 `strategyFingerprint` + 同 `datasetVersionId` + 同 `windowSchedule` + 同 `selectionPolicy`
 * ⇒ 稳定 schedule fingerprint / fold 坐标」的落地方式：
 *   - 排程由 `planWalkForwardFolds`（纯函数）从**冻结的** config + tradeDates 重建；
 *   - 执行开始时把重建结果与冻结的 `schedule.windows` **逐端点比对**，不一致即
 *     `WALK_FORWARD_FOLD_WINDOW_MODIFIED`（规格 §10 FAIL LOUDLY，不自动修复）；
 *   - 所有 Fold 行 / 组合行读取都带**显式 ORDER BY**（`listWalkForwardFoldRows` 按 foldIndex，
 *     组合行要求组合根按 combinationIndex 升序并二次断言）。
 */

import type {
  WalkForwardRunDetailView,
  WalkForwardCreateResultView,
  WalkForwardExecuteOutcomeView,
  WalkForwardFoldView,
  WalkForwardRunView,
  CreateWalkForwardValidationInput,
  ListWalkForwardRunsInput,
  WalkForwardRunStatus,
  WalkForwardFoldOutcome,
} from "../../../shared/walkForwardContracts";
import {
  WALK_FORWARD_VALIDATION_FOLD_RECORD_KIND,
  WALK_FORWARD_VALIDATION_RECORD_VERSION,
  WALK_FORWARD_VALIDATION_RUN_RECORD_KIND,
  WALK_FORWARD_FOLD_OUTCOMES,
} from "../../../shared/walkForwardContracts";
import { IMPLEMENTED_PARAMETER_SEARCH_METHODS } from "../../../shared/parameterSearchContracts";
import { ResearchValidationError } from "../experimentValidation";
import { isParameterSearchRunStatus } from "../parameterSearch/searchRun";
import { buildWalkForwardAggregate } from "./aggregate";
import {
  assertDatasetVersionUnchanged,
  assertStrategyFingerprintUnchanged,
  buildFoldExecutionFingerprint,
} from "./freeze";
import {
  assertFoldLeakageGuard,
  assertIndependentFoldSearches,
  describeFoldLeakageGuard,
} from "./leakage";
import {
  assertFoldExecutionOrder,
  assertWalkForwardRunCanExecute,
  assertWalkForwardRunTransition,
  canExecuteWalkForwardRun,
  parseWalkForwardFoldStatus,
} from "./lifecycle";
import {
  getWalkForwardFoldRow,
  getWalkForwardRunRow,
  insertWalkForwardFold,
  insertWalkForwardRun,
  listWalkForwardFoldRows,
  listWalkForwardRunRows,
  parseWalkForwardJson,
  parseWalkForwardJsonOrNull,
  resetWalkForwardFoldForExecution,
  stringifyWalkForwardJson,
  updateWalkForwardFold,
  updateWalkForwardRun,
  walkForwardFoldTimestamps,
  walkForwardRunTimestamps,
  type WalkForwardFoldRow,
  type WalkForwardRunRow,
} from "./persistence";
import {
  assertCreateRequestConsistent,
  computeWalkForwardValidationRunFingerprint,
  generateWalkForwardValidationRunId,
} from "./run";
import { describeSelectionPolicy, selectFoldCandidate } from "./selection";
import {
  DEFAULT_WALK_FORWARD_RUN_LIST_LIMIT,
  MAX_WALK_FORWARD_FOLD_NOTES,
  MAX_WALK_FORWARD_RUN_NOTES,
  WALK_FORWARD_ENGINE_VERSION,
  WALK_FORWARD_METRICS_VERSION,
  type WalkForwardAggregate,
  type WalkForwardExecutionHooks,
  type WalkForwardFoldSchedule,
  type WalkForwardFoldStatus,
  type WalkForwardScheduleSnapshot,
  type WalkForwardSelectionPolicy,
} from "./types";
import {
  assertFoldsWithinDatasetRange,
  buildWalkForwardScheduleSnapshot,
  describeWalkForwardMetricsCaliber,
  describeWalkForwardSchedule,
  planWalkForwardFolds,
} from "./windowSchedule";

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 截断说明列表（防 notes 无限增长；截断本身也如实记一条）。 */
function clampNotes(notes: readonly string[], max: number): string[] {
  const list = notes.filter((note) => note.trim() !== "");
  if (list.length <= max) return list;
  return [
    ...list.slice(0, max - 1),
    `…（另有 ${String(list.length - max + 1)} 条说明因条数上限已省略）`,
  ];
}

/** 把抛出的任意错误压成「领域码 + 说明」（`ResearchValidationError` 取首条 issue）。 */
function describeError(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof ResearchValidationError) {
    const first = error.issues[0];
    return {
      code: first === undefined ? "WALK_FORWARD_VALIDATION_FAILED" : first.code,
      message: error.message,
    };
  }
  if (error instanceof Error) {
    return { code: error.name || "WALK_FORWARD_EXECUTION_FAILED", message: error.message };
  }
  return { code: "WALK_FORWARD_EXECUTION_FAILED", message: String(error) };
}

/** 解析 Fold 结果语义（非法值响亮报错，不默认成 PENDING）。 */
function parseWalkForwardFoldOutcome(value: unknown, label: string): WalkForwardFoldOutcome {
  if (
    typeof value === "string"
    && (WALK_FORWARD_FOLD_OUTCOMES as readonly string[]).includes(value)
  ) {
    return value as WalkForwardFoldOutcome;
  }
  throw new ResearchValidationError([
    {
      code: "WALK_FORWARD_FOLD_OUTCOME_INVALID",
      path: `${label}.outcome`,
      message:
        `非法的 Fold 结果语义：${String(value)}；合法取值：${WALK_FORWARD_FOLD_OUTCOMES.join(" / ")}`,
    },
  ]);
}

/** 解析 Run 状态（复用 PS 的唯一判断，非法值响亮报错）。 */
function parseWalkForwardRunStatus(value: unknown, label: string): WalkForwardRunStatus {
  if (!isParameterSearchRunStatus(value)) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_RUN_STATUS_INVALID",
        path: `${label}.status`,
        message: `非法的 Run 状态：${String(value)}（唯一词表 = PARAMETER_SEARCH_RUN_STATUSES）`,
      },
    ]);
  }
  return value;
}

/** Run 行 ⇒ 视图。 */
export function toWalkForwardRunView(row: WalkForwardRunRow): WalkForwardRunView {
  const status = parseWalkForwardRunStatus(row.status, row.walkForwardRunId);
  const stamps = walkForwardRunTimestamps(row);
  return {
    recordKind: WALK_FORWARD_VALIDATION_RUN_RECORD_KIND,
    recordVersion: WALK_FORWARD_VALIDATION_RECORD_VERSION,
    walkForwardRunId: row.walkForwardRunId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    strategyVersionId: row.strategyVersionId,
    strategyFingerprint: row.strategyFingerprint ?? null,
    datasetVersionId: row.datasetVersionId ?? null,
    datasetVersionLabel: row.datasetVersionLabel ?? null,
    schedule: parseWalkForwardJson<WalkForwardScheduleSnapshot>(
      row.scheduleJson,
      `${row.walkForwardRunId}.scheduleJson`,
    ),
    selectionPolicy: parseWalkForwardJson<WalkForwardSelectionPolicy>(
      row.selectionPolicyJson,
      `${row.walkForwardRunId}.selectionPolicyJson`,
    ),
    searchMethod: row.searchMethod,
    maxCombinationsPerFold: row.maxCombinationsPerFold ?? null,
    totalFoldCount: row.totalFoldCount,
    completedFoldCount: row.completedFoldCount,
    failedFoldCount: row.failedFoldCount,
    currentFoldIndex: row.currentFoldIndex ?? null,
    metricsVersion: row.metricsVersion,
    engineVersion: row.engineVersion,
    status,
    runFingerprint: row.runFingerprint,
    canExecute: canExecuteWalkForwardRun(status),
    aggregate: parseWalkForwardJsonOrNull<WalkForwardAggregate>(
      row.aggregateJson,
      `${row.walkForwardRunId}.aggregateJson`,
    ),
    notes: parseWalkForwardJsonOrNull<string[]>(row.notesJson, `${row.walkForwardRunId}.notesJson`) ?? [],
    createdAt: stamps.createdAt,
    startedAt: stamps.startedAt,
    completedAt: stamps.completedAt,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
  };
}

/** Fold 行 ⇒ 视图。 */
export function toWalkForwardFoldView(row: WalkForwardFoldRow): WalkForwardFoldView {
  const label = `${row.walkForwardRunId}/folds[${String(row.foldIndex)}]`;
  const stamps = walkForwardFoldTimestamps(row);
  const searchWindow =
    row.searchStartDate !== null && row.searchEndDate !== null
      ? { startDate: row.searchStartDate, endDate: row.searchEndDate }
      : null;
  const oosWindow =
    row.oosWindowStartDate !== null && row.oosWindowEndDate !== null
      ? { startDate: row.oosWindowStartDate, endDate: row.oosWindowEndDate }
      : null;
  return {
    recordKind: WALK_FORWARD_VALIDATION_FOLD_RECORD_KIND,
    recordVersion: WALK_FORWARD_VALIDATION_RECORD_VERSION,
    walkForwardRunId: row.walkForwardRunId,
    foldIndex: row.foldIndex,
    isStart: row.isStart,
    isEnd: row.isEnd,
    oosStart: row.oosStart,
    oosEnd: row.oosEnd,
    sourceSearchRunId: row.sourceSearchRunId ?? null,
    searchWindow,
    sourceCombinationIndex: row.sourceCombinationIndex ?? null,
    parameterHash: row.parameterHash ?? null,
    resolvedParameterSet: parseWalkForwardJsonOrNull<Record<string, string | number | boolean | null>>(
      row.resolvedParameterSetJson,
      `${label}.resolvedParameterSetJson`,
    ),
    strategyVersionId: row.strategyVersionId,
    strategyFingerprint: row.strategyFingerprint ?? null,
    datasetVersionId: row.datasetVersionId ?? null,
    oosRunId: row.oosRunId ?? null,
    oosWindow,
    status: parseWalkForwardFoldStatus(row.status, label),
    outcome: parseWalkForwardFoldOutcome(row.outcome, label),
    isMetrics: parseWalkForwardJsonOrNull<WalkForwardFoldView["isMetrics"]>(
      row.isMetricsJson,
      `${label}.isMetricsJson`,
    ),
    isMetricsSource: row.isMetricsSource ?? null,
    oosMetrics: parseWalkForwardJsonOrNull<WalkForwardFoldView["oosMetrics"]>(
      row.oosMetricsJson,
      `${label}.oosMetricsJson`,
    ),
    oosMetricsSource: row.oosMetricsSource ?? null,
    comparison: parseWalkForwardJsonOrNull<WalkForwardFoldView["comparison"]>(
      row.comparisonJson,
      `${label}.comparisonJson`,
    ),
    oosBacktestFingerprint: row.oosBacktestFingerprint ?? null,
    executionFingerprint: row.executionFingerprint,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    notes: parseWalkForwardJsonOrNull<string[]>(row.notesJson, `${label}.notesJson`) ?? [],
    createdAt: stamps.createdAt,
    completedAt: stamps.completedAt,
  };
}

// ---------------------------------------------------------------------------
// 创建
// ---------------------------------------------------------------------------

/**
 * 创建入参：`request` 是前端契约，其余是**由组合根读回的权威坐标**
 * （策略版本身份与定义指纹、数据集坐标与可用窗口、交易日序列）。
 *
 * 🔴 交易日序列必须来自 `index_daily`（交易日历唯一来源）；本域不做日历 IO，
 *   因此刻意要求调用方显式传入，而不是在域内偷偷查一张日历表。
 */
export interface CreateWalkForwardRunInput {
  readonly request: CreateWalkForwardValidationInput;
  readonly strategyVersionId: string;
  readonly strategyFingerprint: string | null;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  /** 交易日序列（升序、无重复；`YYYY-MM-DD` 北京业务日）。 */
  readonly tradeDates: readonly string[];
  /** 绑定数据集的可用窗口（含两端）；null = 无坐标（越界判据跳过，不猜）。 */
  readonly datasetWindow: { readonly startDate: string; readonly endDate: string } | null;
  readonly runId?: string;
  readonly now?: Date;
}

/**
 * 创建 Walk-Forward Run —— **只冻结，不执行**（规格 §6 Step A + §10）。
 *
 * 全程无策略 IO、无搜索、无回测：只把「排程 + 身份 + 选择策略」落成两表 N+1 行。
 * 任何几何不可行 / 越界 / 接口自相矛盾都在这里**响亮失败**，绝不留下半条 Run。
 */
export async function createWalkForwardRun(
  input: CreateWalkForwardRunInput,
): Promise<WalkForwardCreateResultView> {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const runId = input.runId ?? generateWalkForwardValidationRunId(now);
  const config = input.request.windowConfig;

  assertCreateRequestConsistent({
    windowConfig: config,
    selectionPolicy: input.request.selectionPolicy,
  });

  // 取样区间投影：只让落在 [startDate, endDate] 内的交易日参与排程（含两端）。
  const windowTradeDates = input.tradeDates.filter(
    (date) => date >= config.startDate && date <= config.endDate,
  );
  const droppedDates = input.tradeDates.length - windowTradeDates.length;

  const folds = planWalkForwardFolds({ config, tradeDates: windowTradeDates });
  assertFoldsWithinDatasetRange({ folds, datasetWindow: input.datasetWindow });

  const schedule = buildWalkForwardScheduleSnapshot({ config, tradeDates: windowTradeDates, folds });
  const searchMethod = input.request.searchMethod ?? IMPLEMENTED_PARAMETER_SEARCH_METHODS[0]!;
  const maxCombinationsPerFold = input.request.maxCombinationsPerFold ?? null;
  const metricsVersion = input.request.metricsVersion ?? WALK_FORWARD_METRICS_VERSION;

  const runFingerprint = computeWalkForwardValidationRunFingerprint({
    walkForwardRunId: runId,
    strategyVersionId: input.strategyVersionId,
    strategyFingerprint: input.strategyFingerprint,
    datasetVersionId: input.datasetVersionId,
    datasetVersionLabel: input.datasetVersionLabel,
    schedule,
    selectionPolicy: input.request.selectionPolicy,
    searchMethod,
    maxCombinationsPerFold,
    totalFoldCount: folds.length,
    metricsVersion,
    engineVersion: WALK_FORWARD_ENGINE_VERSION,
  });

  const runNotes = clampNotes(
    [
      describeWalkForwardSchedule({ config, folds }),
      describeSelectionPolicy(input.request.selectionPolicy),
      describeWalkForwardMetricsCaliber(),
      "本 Run 只冻结排程与身份，**尚未执行**；执行前会复核策略指纹与数据集坐标是否仍与冻结值一致。",
      droppedDates > 0
        ? `⚠️ 有 ${String(droppedDates)} 个交易日落在取样区间 ${config.startDate}..${config.endDate} 之外，`
          + "已从排程输入中剔除（取样区间语义；被剔除的日期不参与任何 Fold）。"
        : "",
    ],
    MAX_WALK_FORWARD_RUN_NOTES,
  );

  await insertWalkForwardRun({
    walkForwardRunId: runId,
    strategyId: input.request.strategyId,
    strategyVersion: input.request.strategyVersion,
    strategyVersionId: input.strategyVersionId,
    strategyFingerprint: input.strategyFingerprint,
    datasetVersionId: input.datasetVersionId,
    datasetVersionLabel: input.datasetVersionLabel,
    scheduleJson: stringifyWalkForwardJson(schedule, `${runId}.schedule`),
    scheduleFingerprint: schedule.scheduleFingerprint,
    selectionPolicyJson: stringifyWalkForwardJson(
      input.request.selectionPolicy,
      `${runId}.selectionPolicy`,
    ),
    searchMethod,
    maxCombinationsPerFold,
    totalFoldCount: folds.length,
    metricsVersion,
    engineVersion: WALK_FORWARD_ENGINE_VERSION,
    status: "CREATED",
    runFingerprint,
    notesJson: stringifyWalkForwardJson(runNotes, `${runId}.notes`),
    createdAt,
  });

  for (const fold of folds) {
    const executionFingerprint = buildFoldExecutionFingerprint({
      foldIndex: fold.foldIndex,
      isStart: fold.isStart,
      isEnd: fold.isEnd,
      oosStart: fold.oosStart,
      oosEnd: fold.oosEnd,
      strategyVersionId: input.strategyVersionId,
      strategyFingerprint: input.strategyFingerprint,
      datasetVersionId: input.datasetVersionId,
      sourceSearchRunId: null,
      parameterHash: null,
      oosRunId: null,
    });
    await insertWalkForwardFold({
      walkForwardRunId: runId,
      foldIndex: fold.foldIndex,
      isStart: fold.isStart,
      isEnd: fold.isEnd,
      oosStart: fold.oosStart,
      oosEnd: fold.oosEnd,
      strategyVersionId: input.strategyVersionId,
      strategyFingerprint: input.strategyFingerprint,
      datasetVersionId: input.datasetVersionId,
      executionFingerprint,
      status: "WINDOW_CREATED",
      outcome: "PENDING",
      notesJson: stringifyWalkForwardJson(
        [describeFoldLeakageGuard(fold)],
        `${runId}/folds[${String(fold.foldIndex)}].notes`,
      ),
      createdAt,
    });
  }

  const runRow = await getWalkForwardRunRow(runId);
  if (runRow === null) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_RUN_NOT_PERSISTED",
        path: runId,
        message: `Run ${runId} 写入后回读为空 ⇒ 拒绝返回未落库的成功回执。`,
      },
    ]);
  }
  const foldViews = (await listWalkForwardFoldRows(runId)).map(toWalkForwardFoldView);
  return { run: toWalkForwardRunView(runRow), folds: foldViews, notes: runNotes };
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

export interface StartWalkForwardRunInput {
  readonly walkForwardRunId: string;
  readonly hooks: WalkForwardExecutionHooks;
  readonly now?: Date;
}

/**
 * 用「冻结的 config + tradeDates」重建 Fold 排程，并**逐端点复核**它与创建时冻结的
 * `schedule.windows` 是否仍逐字相等（规格 §10：漂移即 FAIL LOUDLY，不自动修复）。
 *
 * 为什么不直接读库里的端点：泄漏守卫需要**交易日集合**（`isTradeDates` / `oosTradeDates`），
 * 而库里只存四端点。重建是纯函数且确定性，再由本函数把结果钉回冻结值 ——
 * 一旦两者不一致，说明实现或输入被改过，必须停下。
 */
function rebuildFrozenFolds(run: WalkForwardRunView): readonly WalkForwardFoldSchedule[] {
  const folds = planWalkForwardFolds({
    config: run.schedule.config,
    tradeDates: run.schedule.tradeDates,
  });
  const issues: { code: string; path: string; message: string }[] = [];
  for (const fold of folds) {
    const stored = run.schedule.windows[fold.foldIndex];
    if (stored === undefined) {
      issues.push({
        code: "WALK_FORWARD_FOLD_WINDOW_MISSING",
        path: `folds[${String(fold.foldIndex)}]`,
        message: `冻结排程里缺少 Fold ${String(fold.foldIndex)} 的窗口记录。`,
      });
      continue;
    }
    const drifted =
      stored.isStart !== fold.isStart
      || stored.isEnd !== fold.isEnd
      || stored.oosStart !== fold.oosStart
      || stored.oosEnd !== fold.oosEnd;
    if (drifted) {
      issues.push({
        code: "WALK_FORWARD_FOLD_WINDOW_MODIFIED",
        path: `folds[${String(fold.foldIndex)}]`,
        message:
          `重算窗口与冻结窗口不一致（领域码同 freeze.ts#assertFoldWindowUnchanged）：`
          + `冻结 IS ${stored.isStart}..${stored.isEnd} / OOS ${stored.oosStart}..${stored.oosEnd}；`
          + `重算 IS ${fold.isStart}..${fold.isEnd} / OOS ${fold.oosStart}..${fold.oosEnd}。`
          + "拒绝执行（规格 §10：不自动修复）。",
      });
    }
  }
  if (issues.length > 0) throw new ResearchValidationError(issues);
  return folds;
}

/** 由 OOS 回执判定 Fold 结果语义（零指标判定：只看「跑没跑成」与「有没有成交」）。 */
function resolveFoldOutcome(handle: {
  readonly oosRunStatus: string;
  readonly oosMetrics: WalkForwardFoldView["oosMetrics"];
}): WalkForwardFoldOutcome {
  if (handle.oosRunStatus !== "COMPLETED") {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_OOS_RUN_NOT_COMPLETED",
        path: "oosRunStatus",
        message:
          `样本外 Run 未以 COMPLETED 收尾（实际 ${handle.oosRunStatus}）⇒ 视为该 Fold 失败；`
          + "不得把未完成的读数当作结果。",
      },
    ]);
  }
  const tradeCount = handle.oosMetrics?.tradeCount ?? null;
  return tradeCount === 0 ? "INSUFFICIENT_TRADING_ACTIVITY" : "SUCCEEDED";
}

/**
 * 执行 Walk-Forward Run（逐 Fold **串行**）。
 *
 * 幂等语义（规格 §12 / §17.11）：
 *   - `COMPLETED` ⇒ 立刻返回 `executed=false`（不重跑、不重算、不重汇总）；
 *   - `RUNNING` ⇒ **响亮拒绝**（`WALK_FORWARD_RUN_NOT_EXECUTABLE`）；
 *   - `CREATED` / `FAILED` / `CANCELLED` ⇒ 可执行；开跑前把整批 Fold 行显式重置。
 *
 * 协作式取消：每个 Fold 边界会回读 Run 状态，若已是 `CANCELLED` 则停止推进
 * （已在途的那一个 Fold 会走完，不再启动后续 Fold）—— 审计轨迹因此始终单调向前。
 */
export async function startWalkForwardRun(
  input: StartWalkForwardRunInput,
): Promise<WalkForwardExecuteOutcomeView> {
  const now = input.now ?? new Date();
  const row = await getWalkForwardRunRow(input.walkForwardRunId);
  if (row === null) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_RUN_NOT_FOUND",
        path: input.walkForwardRunId,
        message: `Walk-Forward Run 不存在：${input.walkForwardRunId}`,
      },
    ]);
  }
  const run = toWalkForwardRunView(row);

  if (run.status === "COMPLETED") {
    const folds = (await listWalkForwardFoldRows(run.walkForwardRunId)).map(toWalkForwardFoldView);
    return {
      run,
      executed: false,
      folds,
      notes: ["该 Run 已是 COMPLETED ⇒ 幂等返回（不重跑、不重算，规格 §12 / §17.11）。"],
    };
  }
  assertWalkForwardRunCanExecute(run.status);

  const planned = rebuildFrozenFolds(run);

  assertWalkForwardRunTransition(run.status, "RUNNING");
  await updateWalkForwardRun(run.walkForwardRunId, {
    status: "RUNNING",
    currentFoldIndex: 0,
    startedAt: now.toISOString(),
    completedAt: null,
    errorCode: null,
    errorMessage: null,
  });

  const runNotes: string[] = [];
  if (run.status === "FAILED" || run.status === "CANCELLED") {
    runNotes.push(
      `本次为**重执行**（原状态 ${run.status}）：全部 ${String(planned.length)} 个 Fold 行已显式重置回 `
      + "WINDOW_CREATED —— 因为 Fold 的 FAILED / OOS_COMPLETED 是终态，不允许单 Fold 回头。"
      + "几何端点与执行指纹**未变**（窗口冻结不因重执行而改变）。",
    );
  }

  // ---- 执行前漂移复核（规格 §10 FAIL LOUDLY） ----
  const current = await input.hooks.readCurrentContext();
  assertStrategyFingerprintUnchanged({
    label: `run(${run.walkForwardRunId})`,
    frozen: run.strategyFingerprint,
    current: current.strategyFingerprint,
  });
  assertDatasetVersionUnchanged({
    label: `run(${run.walkForwardRunId})`,
    frozen: run.datasetVersionId,
    current: current.datasetVersionId,
  });

  // 开跑前把整批 Fold 行重置（首次执行时等价于无操作，重执行时是唯一入口）
  for (const fold of planned) {
    await resetWalkForwardFoldForExecution(run.walkForwardRunId, fold.foldIndex);
  }
  const statuses: WalkForwardFoldStatus[] = planned.map(() => "WINDOW_CREATED");

  let completedFoldCount = 0;
  let failedFoldCount = 0;
  let failedFoldIndex: number | null = null;
  let cancelled = false;

  for (const fold of planned) {
    const label = `folds[${String(fold.foldIndex)}]`;

    // 协作式取消：每个 Fold 边界回读一次 Run 状态
    const live = await getWalkForwardRunRow(run.walkForwardRunId);
    if (live !== null && live.status === "CANCELLED") {
      cancelled = true;
      runNotes.push(
        `✅ 收到取消信号（Run 状态已被置为 CANCELLED）⇒ 在第 ${String(fold.foldIndex)} 个 Fold 之前停止推进。`
        + `Fold ${String(fold.foldIndex)} 及其后共 ${String(planned.length - fold.foldIndex)} 个 Fold **从未执行**`
        + "（保持 WINDOW_CREATED，没有被伪造成任何读数）。",
      );
      break;
    }

    assertFoldExecutionOrder({ foldIndex: fold.foldIndex, statuses: [...statuses] });

    try {
      // ---- Step A/B：该 Fold 的 IS 窗口搜索（每 Fold 独立搜索，规格 §11） ----
      await updateWalkForwardRun(run.walkForwardRunId, { currentFoldIndex: fold.foldIndex });
      await updateWalkForwardFold(run.walkForwardRunId, fold.foldIndex, { status: "SEARCH_RUNNING" });
      statuses[fold.foldIndex] = "SEARCH_RUNNING";

      const searchHandle = await input.hooks.runFoldSearch({
        walkForwardRunId: run.walkForwardRunId,
        foldIndex: fold.foldIndex,
        strategyId: run.strategyId,
        strategyVersion: run.strategyVersion,
        isWindow: { startDate: fold.isStart, endDate: fold.isEnd },
        isTradeDates: fold.searchTradeDates,
        maxCombinations: run.maxCombinationsPerFold,
      });

      // 泄漏守卫（搜索侧）：窗口 ⊆ IS、实际交易日 ⊆ IS 交易日、不与更晚 Fold 相交
      assertFoldLeakageGuard({
        fold,
        searchRunWindow: searchHandle.searchWindow,
        searchTradeDates: searchHandle.searchTradeDates,
        oosRunWindow: null,
        datasetWindow: current.datasetWindow,
        allFolds: planned,
      });

      await updateWalkForwardFold(run.walkForwardRunId, fold.foldIndex, {
        status: "SEARCH_COMPLETED",
        sourceSearchRunId: searchHandle.searchRunId,
        searchStartDate: searchHandle.searchWindow.startDate,
        searchEndDate: searchHandle.searchWindow.endDate,
        // IS 读数**不在这里**：此刻还不知道选中哪个组合（见 Step C）。
        notesJson: stringifyWalkForwardJson(
          clampNotes([describeFoldLeakageGuard(fold), ...searchHandle.notes], MAX_WALK_FORWARD_FOLD_NOTES),
          `${label}.notes`,
        ),
      });
      statuses[fold.foldIndex] = "SEARCH_COMPLETED";

      // ---- Step C：候选冻结（显式策略 + hash 重算复核，规格 §7 / §10） ----
      const selection = selectFoldCandidate({
        foldIndex: fold.foldIndex,
        searchRunId: searchHandle.searchRunId,
        policy: run.selectionPolicy,
        combinations: searchHandle.combinations,
        results: searchHandle.results,
        strategyId: run.strategyId,
        strategyVersion: run.strategyVersion,
      });
      // 候选的 IS 读数：从**该 Fold 自己的**结果行按 hash 取（不是调用方给的值）
      const selectedResult = searchHandle.results.find(
        (item) => item.parameterHash === selection.parameterHash,
      );
      if (selectedResult === undefined) {
        throw new ResearchValidationError([
          {
            code: "WALK_FORWARD_CANDIDATE_RESULT_MISSING",
            path: `${label}.results`,
            message:
              `候选 ${selection.parameterHash} 已通过选择策略，却在该 Fold 的结果行里找不到`
              + " ⇒ IS 读数无从而来；拒绝写半条 Fold 行（不编造 IS 读数）。",
          },
        ]);
      }
      await updateWalkForwardFold(run.walkForwardRunId, fold.foldIndex, {
        status: "CANDIDATE_FROZEN",
        sourceCombinationIndex: selection.combinationIndex,
        parameterHash: selection.parameterHash,
        resolvedParameterSetJson: stringifyWalkForwardJson(
          selection.parameters,
          `${label}.resolvedParameterSet`,
        ),
        isMetricsJson: stringifyWalkForwardJson(selectedResult.metrics, `${label}.isMetrics`),
        isMetricsSource: selectedResult.metricsSource,
        notesJson: stringifyWalkForwardJson(
          clampNotes([describeFoldLeakageGuard(fold), selection.note], MAX_WALK_FORWARD_FOLD_NOTES),
          `${label}.notes`,
        ),
      });
      statuses[fold.foldIndex] = "CANDIDATE_FROZEN";

      // ---- Step D：OOS 真重跑（窗口紧邻且不重叠，规格 §11） ----
      await updateWalkForwardFold(run.walkForwardRunId, fold.foldIndex, { status: "OOS_RUNNING" });
      statuses[fold.foldIndex] = "OOS_RUNNING";

      const oosHandle = await input.hooks.runFoldOos({
        walkForwardRunId: run.walkForwardRunId,
        foldIndex: fold.foldIndex,
        strategyId: run.strategyId,
        strategyVersion: run.strategyVersion,
        sourceSearchRunId: searchHandle.searchRunId,
        parameterHash: selection.parameterHash,
        oosWindow: { startDate: fold.oosStart, endDate: fold.oosEnd },
      });

      // 泄漏守卫（样本外侧）：OOS Run 窗口必须与排程**逐字相等**
      assertFoldLeakageGuard({
        fold,
        searchRunWindow: searchHandle.searchWindow,
        searchTradeDates: searchHandle.searchTradeDates,
        oosRunWindow: oosHandle.oosWindow,
        datasetWindow: current.datasetWindow,
        allFolds: planned,
      });

      const outcome = resolveFoldOutcome(oosHandle);
      await updateWalkForwardFold(run.walkForwardRunId, fold.foldIndex, {
        status: "OOS_COMPLETED",
        outcome,
        oosRunId: oosHandle.oosRunId,
        oosWindowStartDate: oosHandle.oosWindow.startDate,
        oosWindowEndDate: oosHandle.oosWindow.endDate,
        oosMetricsJson: stringifyWalkForwardJson(oosHandle.oosMetrics, `${label}.oosMetrics`),
        oosMetricsSource: oosHandle.oosMetricsSource,
        comparisonJson: stringifyWalkForwardJson(oosHandle.comparison, `${label}.comparison`),
        oosBacktestFingerprint: oosHandle.oosBacktestFingerprint,
        completedAt: now.toISOString(),
        notesJson: stringifyWalkForwardJson(
          clampNotes(
            [
              describeFoldLeakageGuard(fold),
              outcome === "INSUFFICIENT_TRADING_ACTIVITY"
                ? "样本外 0 笔成交（如实读数；本域不据此判定好坏，也不淘汰）。"
                : "",
              ...oosHandle.notes,
            ],
            MAX_WALK_FORWARD_FOLD_NOTES,
          ),
          `${label}.notes`,
        ),
      });
      statuses[fold.foldIndex] = "OOS_COMPLETED";
      completedFoldCount += 1;
    } catch (error) {
      const described = describeError(error);
      failedFoldCount += 1;
      failedFoldIndex = fold.foldIndex;
      statuses[fold.foldIndex] = "FAILED";
      await updateWalkForwardFold(run.walkForwardRunId, fold.foldIndex, {
        status: "FAILED",
        outcome: "FAILED",
        errorCode: described.code,
        errorMessage: described.message,
        completedAt: now.toISOString(),
      });
      runNotes.push(
        `❌ Fold ${String(fold.foldIndex)} 失败（${described.code}）⇒ 停止推进；`
        + `其后 ${String(planned.length - fold.foldIndex - 1)} 个 Fold **从未执行**`
        + "（保持 WINDOW_CREATED，没有被伪造成任何读数）。失败原因："
        + described.message,
      );
      break;
    }
  }

  // ---- Step E：独立搜索复核 + 汇总（只做描述性统计） ----
  const finalRows = await listWalkForwardFoldRows(run.walkForwardRunId);
  const finalFolds = finalRows.map(toWalkForwardFoldView);

  assertIndependentFoldSearches({
    entries: finalFolds.map((fold) => ({
      foldIndex: fold.foldIndex,
      searchRunId: fold.sourceSearchRunId,
      searchWindow: fold.searchWindow,
    })),
  });

  const aggregate = buildWalkForwardAggregate({
    walkForwardRunId: run.walkForwardRunId,
    folds: finalFolds,
  });
  runNotes.push(...aggregate.notes);

  const status: WalkForwardRunStatus = cancelled
    ? "CANCELLED"
    : failedFoldCount > 0
      ? "FAILED"
      : "COMPLETED";
  assertWalkForwardRunTransition("RUNNING", status);

  const firstFailure = finalFolds.find((fold) => fold.status === "FAILED");
  await updateWalkForwardRun(run.walkForwardRunId, {
    status,
    completedFoldCount,
    failedFoldCount,
    currentFoldIndex: status === "COMPLETED" ? null : failedFoldIndex,
    aggregateJson: stringifyWalkForwardJson(aggregate, `${run.walkForwardRunId}.aggregate`),
    notesJson: stringifyWalkForwardJson(
      clampNotes(
        [describeWalkForwardMetricsCaliber(), ...runNotes],
        MAX_WALK_FORWARD_RUN_NOTES,
      ),
      `${run.walkForwardRunId}.notes`,
    ),
    completedAt: now.toISOString(),
    errorCode: status === "FAILED" ? firstFailure?.errorCode ?? "WALK_FORWARD_FOLD_FAILED" : null,
    errorMessage: status === "FAILED" ? firstFailure?.errorMessage ?? null : null,
  });

  const finalRow = await getWalkForwardRunRow(run.walkForwardRunId);
  if (finalRow === null) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_RUN_NOT_PERSISTED",
        path: run.walkForwardRunId,
        message: "执行收尾后回读 Run 行为空 ⇒ 拒绝返回未落库的执行回执。",
      },
    ]);
  }

  return {
    run: toWalkForwardRunView(finalRow),
    executed: true,
    folds: (await listWalkForwardFoldRows(run.walkForwardRunId)).map(toWalkForwardFoldView),
    notes: runNotes,
  };
}

// ---------------------------------------------------------------------------
// 取消
// ---------------------------------------------------------------------------

/**
 * 取消一个 Run（**协作式**）。
 *
 * 🔴 `COMPLETED` **不可取消**（已经跑完的东西取消是篡改历史语义）；
 *   `RUNNING` 可取消，但生效点是**下一个 Fold 边界**（本域执行是一个进程内的串行循环，
 *   无法从外部打断已经发出的一次搜索 / 回测）—— 这个限制如实写进返回说明，
 *   而不是假装「立即停了」。
 */
export async function cancelWalkForwardRun(input: {
  readonly walkForwardRunId: string;
}): Promise<{ readonly run: WalkForwardRunView; readonly notes: readonly string[] }> {
  const row = await getWalkForwardRunRow(input.walkForwardRunId);
  if (row === null) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_RUN_NOT_FOUND",
        path: input.walkForwardRunId,
        message: `Walk-Forward Run 不存在：${input.walkForwardRunId}`,
      },
    ]);
  }
  const run = toWalkForwardRunView(row);
  if (run.status === "COMPLETED") {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_RUN_NOT_CANCELLABLE",
        path: "status",
        message:
          "已 COMPLETED 的 Walk-Forward Run 不可取消：它的 Fold 读数已经产出，"
          + "把状态改成 CANCELLED 会让留档与事实不符（规格 §9：不得改语义）。",
      },
    ]);
  }
  if (run.status === "CANCELLED") {
    return { run, notes: ["该 Run 已是 CANCELLED ⇒ 幂等返回。"] };
  }
  assertWalkForwardRunTransition(run.status, "CANCELLED");
  await updateWalkForwardRun(run.walkForwardRunId, {
    status: "CANCELLED",
    completedAt: new Date().toISOString(),
  });
  const updated = await getWalkForwardRunRow(run.walkForwardRunId);
  return {
    run: toWalkForwardRunView(updated ?? row),
    notes: [
      run.status === "RUNNING"
        ? "取消信号已置位；因为执行是**进程内串行循环**，它会**在当前 Fold 走完后**的下一个 Fold 边界生效，"
          + "不会打断已经在途的那一次搜索 / 回测。"
        : "Run 未在执行中 ⇒ 直接置为 CANCELLED。",
    ],
  };
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

/** 读取 Run 详情（Run + 全部 Fold；不存在 ⇒ null）。 */
export async function readWalkForwardRunDetail(
  walkForwardRunId: string,
): Promise<WalkForwardRunDetailView | null> {
  const row = await getWalkForwardRunRow(walkForwardRunId);
  if (row === null) return null;
  const folds = (await listWalkForwardFoldRows(walkForwardRunId)).map(toWalkForwardFoldView);
  return { run: toWalkForwardRunView(row), folds };
}

/** 读取单个 Fold（不存在 ⇒ null）。 */
export async function readWalkForwardFold(input: {
  readonly walkForwardRunId: string;
  readonly foldIndex: number;
}): Promise<WalkForwardFoldView | null> {
  const row = await getWalkForwardFoldRow(input.walkForwardRunId, input.foldIndex);
  return row === null ? null : toWalkForwardFoldView(row);
}

/** 列出 Run（按创建时间倒序；`strategyId` 可选过滤）。 */
export async function listWalkForwardRuns(
  input: ListWalkForwardRunsInput,
): Promise<readonly WalkForwardRunView[]> {
  const rows = await listWalkForwardRunRows({
    limit: input.limit ?? DEFAULT_WALK_FORWARD_RUN_LIST_LIMIT,
    offset: input.offset ?? 0,
    strategyId: input.strategyId,
  });
  return rows.map(toWalkForwardRunView);
}
