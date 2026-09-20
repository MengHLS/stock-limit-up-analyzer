/**
 * PARAMETER-001 §12/§13 — 执行编排（复用既有 Backtest + Evaluation；Resume / Retry / Cache）。
 *
 * ## 执行链（**不新建任何一套回测 / 策略运行时 / 指标**）
 *
 * ```text
 * Parameter Combination
 *   → Strategy Version + Parameters（strategyDocument.parameterOverrides）
 *   → server/research/strategyEvaluation/backtestBridge.ts#createStrategyBacktestBridge
 *        （内部 → evaluateStrategyParameters → 真实闭环 data→research→strategy→backtest→evaluation）
 *   → ClosedLoopEvaluationRef（canonical metrics 唯一读数面）
 *   → 投影 & 落库（parameter_search_result）
 * ```
 *
 * 🔴 关键复用点：**桥自带「按区间缓存的数据集」**（`backtestBridge.ts` 的 `cache`）。
 *   第 1 个组合付数据集解析 / 构建的代价，后续 N-1 个组合复用同一份
 *   （`datasetSource` 如实变成 `injected`）。若绕过桥直调 `evaluateStrategyParameters`，
 *   就退化成「每个组合都重新解析数据集」—— 那是**性能事故**，不是「更干净」。
 *
 * ## Resume / Retry / Cache（规格 §13）
 *
 * | 能力  | 判据 | 落点 |
 * |-------|------|------|
 * | Resume | 本 Run 内组合 `status = SUCCEEDED` ⇒ **跳过**（不重算、不重写） | `combinations` 行 |
 * | Retry  | 指定 `parameterHash`；组合 `status = FAILED`（默认）⇒ 重跑该组合，`attemptCount + 1` | `retryParameterSearchCombination` |
 * | Cache  | 五要素逐字段相等（策略版本 / 数据集坐标 / parameterHash / 执行政策 / 评估配置指纹）且已有 `SUCCEEDED` ⇒ 复用 | `persistence#findReusableResult` |
 *
 * ## 取消语义（**如实**）
 *
 * 每个组合开始前**重读 Run 状态**：若已是 `CANCELLED` ⇒ 立即停止循环、
 * 把已落库的结果保留、剩余组合留在 `PENDING`。⇒ 取消是**可复现的断点**，
 * 之后再 `start` 即从断点续跑（这正是 Resume 的价值）。
 */

import {
  IMPLEMENTED_PARAMETER_SEARCH_METHODS,
  type ParameterSearchCombinationView,
  type ParameterSearchDomain,
  type ParameterSearchMetricsView,
  type ParameterSearchMethod,
  type ParameterSearchResultPage,
  type ParameterSearchResultSortField,
  type ParameterSearchResultView,
  type ParameterSearchRunStatus,
  type ParameterSearchRunView,
} from "../../../shared/parameterSearchContracts";
import { BACKTEST_EXECUTION_POLICY_VERSION } from "../../backtest/context";
import { ResearchValidationError } from "../experimentValidation";
import type { StrategyParameterProjectionRow } from "../strategySchema/projection";
import type { StrategyDocument } from "../strategySchema/types";
import type { ResearchParameterSet } from "../types";
import { buildParameterCombinations, computeCombinationSetFingerprint } from "./combination";
import {
  computeEvaluationConfigFingerprint,
  computeParameterHash,
  type ParameterSearchCacheKey,
} from "./parameterHash";
import {
  failLingeringCombinations,
  findReusableResult,
  getParameterSearchRunRow,
  insertParameterSearchCombinations,
  insertParameterSearchRun,
  listParameterSearchCombinationRows,
  listParameterSearchResultRows,
  listParameterSearchRunRows,
  recomputeRunCounters,
  updateParameterSearchCombinationStatus,
  updateParameterSearchRun,
  upsertParameterSearchResult,
  type ParameterSearchCombinationRow,
  type ParameterSearchResultRow,
  type ParameterSearchRunRow,
} from "./persistence";
import {
  applySearchDomainOverrides,
  deriveParameterSearchSpaceFromProjection,
  excludeUnreferencedDomains,
  describeParameterSearchDomain,
  serializeParameterSearchSpace,
  summarizeParameterSearchSpace,
  validateParameterSearchSpace,
  type ParameterSearchDeclaredParameter,
  type ParameterSearchSpaceSummary,
} from "./searchSpace";
import {
  buildParameterSearchResult,
  compareRequestedWithResolved,
  isMetricsFullyUnavailable,
} from "./searchResult";
import {
  assertSearchRunTransition,
  computeRunProgress,
  computeRunSpaceSnapshotFingerprint,
  generateParameterSearchRunId,
  parseParameterSearchRunStatus,
  serializeFixedCoordinates,
} from "./searchRun";
import { STRATEGY_EVALUATION_STAGE_IDS } from "../strategyEvaluation/evaluate";
import { createStrategyBacktestBridge } from "../strategyEvaluation/backtestBridge";

/** notes 上限（防长跑无界增长；超出保留最近 N 条）。 */
const MAX_RUN_NOTES = 200;

/** 结果列表默认返回上限（超出即 `truncated: true`，不静默丢弃）。 */
const DEFAULT_RESULT_LIMIT = 500;

/** 组合数上限（生成前强制；与既有预览口径一致的 64 是**端点**级限制，这里给留档留出更大空间）。 */
const DEFAULT_MAX_COMBINATIONS = 256;

// ---------------------------------------------------------------------------
// 评估配置（cache 判据之一，**单一定义**）
// ---------------------------------------------------------------------------

/** 评估配置快照（进 `evaluationConfigFingerprint`）。 */
export interface ParameterSearchEvaluationConfig {
  readonly port: "strategyEvaluation";
  readonly stageIds: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly datasetSourcePolicy: string | null;
}

/** 构造评估配置（唯一落点；窗口属于评估配置 —— 换窗口必须让 cache 失效）。 */
export function buildEvaluationConfig(input: {
  readonly startDate: string;
  readonly endDate: string;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly datasetSourcePolicy?: string;
}): ParameterSearchEvaluationConfig {
  return {
    port: "strategyEvaluation",
    stageIds: [...STRATEGY_EVALUATION_STAGE_IDS],
    startDate: input.startDate,
    endDate: input.endDate,
    datasetVersionId: input.datasetVersionId,
    datasetVersionLabel: input.datasetVersionLabel,
    datasetSourcePolicy: input.datasetSourcePolicy ?? null,
  };
}

// ---------------------------------------------------------------------------
// 创建
// ---------------------------------------------------------------------------

/** 创建 Search 的输入（上游坐标全部由调用方读库后传入；本层不做策略 / 数据集 IO）。 */
export interface CreateParameterSearchRunInput {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly searchMethod: ParameterSearchMethod;
  /** 策略参数投影（带 `parameterRole`；唯一权威分类来源）。 */
  readonly projectionParameters: readonly StrategyParameterProjectionRow[];
  /** 逐参数搜索域覆盖（可选；只允许覆盖 TUNABLE）。 */
  readonly domainOverrides?: readonly { readonly name: string; readonly domain: ParameterSearchDomain }[];
  /**
   * PARAMETER-002 — 策略**规则图实际引用**的参数 code 集合（唯一权威 =
   * `strategyCore/ruleGraph.ts#collectRuleParameterReferences`）。
   *
   * 提供即启用**死参数筛查**：声明为 TUNABLE 但规则图从未引用的参数会被排除出搜索空间
   * （搜索它只会得到逐字节相同的重复结果 + 白付 N 次回测）；若排除后无任何可搜索参数，
   * 创建请求**响亮拒绝**（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`）。
   * 缺省 ⇒ 不筛查（并在 Run notes 里如实标注「未筛查」）。
   */
  readonly referencedParameterCodes?: ReadonlySet<string>;
  /**
   * PARAMETER-002 §9（N-01）— 绑定数据集的**可用窗口**（**北京业务日**，`YYYY-MM-DD`）。
   *
   * 提供即启用**前置窗口校验**：要求
   *   `searchStart >= datasetStart` ∧ `searchEnd <= datasetEnd` ∧ `searchStart <= searchEnd`；
   * 越界即**创建时**响亮拒绝（`PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE`），
   * 避免「创建成功 → N 个组合全部因窗口越界失败 → 白付 N 次回测」（N-02 排查中实测 4/4、62 s）。
   * 缺省 ⇒ 不校验（调用方未提供窗口，例如 `datasetVersionId` 为空）。
   */
  readonly datasetWindow?: { readonly startDate: string; readonly endDate: string };
  readonly maxCombinations?: number;
  readonly datasetSourcePolicy?: string;
  /** 注入式时间戳（测试可确定性复现）。 */
  readonly createdAt?: string;
  /** 注入式 Run ID（测试可确定性复现）。 */
  readonly searchRunId?: string;
}

/** 创建结果（含派生摘要，便于 API 如实回报「派生了什么 / 排除了什么」）。 */
export interface CreateParameterSearchRunResult {
  readonly run: ParameterSearchRunView;
  readonly summary: ParameterSearchSpaceSummary;
  readonly derivationNotes: readonly string[];
  /** PARAMETER-002 — 是否做了死参数（规则图未引用）筛查。 */
  readonly referenceCheckApplied: boolean;
  /** PARAMETER-002 — 被排除的死参数 code（规则图未引用）。 */
  readonly unreferencedTunableCodes: readonly string[];
}

/**
 * PARAMETER-002 §9（N-01）— 前置窗口校验（纯函数，可单测）。
 *
 * 三条判据（全部为**日期字符串按 `YYYY-MM-DD` 字典序比较**，与业务日期口径一致）：
 *   ① `searchStart <= searchEnd`
 *   ② `searchStart >= datasetStart`
 *   ③ `searchEnd <= datasetEnd`
 *
 * 越界时错误信息**必须同时给出 requested window 与 dataset window** ——
 * 否则用户只知道「失败」，不知道该把窗口收窄到哪里。
 */
export function assertSearchWindowWithinDataset(input: {
  readonly startDate: string;
  readonly endDate: string;
  readonly datasetWindow: { readonly startDate: string; readonly endDate: string };
}): void {
  const requested = `${input.startDate}..${input.endDate}`;
  const range = `${input.datasetWindow.startDate}..${input.datasetWindow.endDate}`;
  if (input.startDate > input.endDate) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_WINDOW_INVALID",
        path: "startDate",
        message: `req 请求的搜索窗口起止倒挂：requested window = ${requested}（要求 start <= end）`,
      },
    ]);
  }
  if (input.startDate < input.datasetWindow.startDate || input.endDate > input.datasetWindow.endDate) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE",
        path: "startDate",
        message:
          `req 请求的搜索窗口超出绑定数据集可用窗口：requested window = ${requested}，`
          + `dataset window = ${range}（含两端，按北京业务日）。`
          + `越界会让每个组合在执行时以 SIM_RANGE_OUT_OF_DATASET 失败 —— 与其白付 N 次回测，`
          + `不如在创建时就拒绝；请把窗口收窄到数据集窗口内。`,
      },
    ]);
  }
}

/**
 * 创建 Search Run（**只落 Run + 组合计划**，不执行任何回测）。
 *
 * 幂等：同一 `searchRunId` 重复创建不会产生第二行（UNIQUE + `ON DUPLICATE KEY UPDATE`）。
 */
export async function createParameterSearchRun(
  input: CreateParameterSearchRunInput,
): Promise<CreateParameterSearchRunResult> {
  if (!(IMPLEMENTED_PARAMETER_SEARCH_METHODS as readonly string[]).includes(input.searchMethod)) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_METHOD_UNSUPPORTED",
        path: "searchMethod",
        message:
          `搜索方法 ${input.searchMethod} 已登记但本阶段未实现（当前仅支持 `
          + `${IMPLEMENTED_PARAMETER_SEARCH_METHODS.join(" / ")}）；`
          + `不会静默降级为 GRID_SEARCH。`,
      },
    ]);
  }

  // PARAMETER-002 §9（N-01）— 前置窗口校验（在派生 / 建组合 / 落库**之前**）
  if (input.datasetWindow !== undefined) {
    assertSearchWindowWithinDataset({
      startDate: input.startDate,
      endDate: input.endDate,
      datasetWindow: input.datasetWindow,
    });
  }

  const derivation = deriveParameterSearchSpaceFromProjection({
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    parameters: input.projectionParameters,
    ...(input.referencedParameterCodes === undefined
      ? {}
      : { referencedParameterCodes: input.referencedParameterCodes }),
  });

  let definition = derivation.definition;
  const notes = [...derivation.notes];
  if (input.domainOverrides !== undefined && input.domainOverrides.length > 0) {
    const overridden = applySearchDomainOverrides(definition, input.domainOverrides);
    if (overridden.issues.length > 0) throw new ResearchValidationError([...overridden.issues]);
    definition = overridden.definition;
  }

  /**
   * 🔴 PARAMETER-002 — 死参数剥离必须放在**覆盖之后**（顺序即纪律）。
   *
   * ① 若调用方给一个**死参数**（规则图未引用）赋了**会变化**的搜索域（ENUM / RANGE），
   *    那是在「假装搜索」⇒ **响亮拒绝**（比静默剥离更诚实：用户以为在搜，实际永远不会变）。
   *    赋 `FIXED`（单值）不在此列 —— 它只是「声明一个常量」，不冒充搜索维度，会被静默剥离。
   * ② 其余死参数一律从搜索空间剥离，防止覆盖把它们重新塞回（实测踩到）。
   */
  if (derivation.referenceCheckApplied && derivation.unreferencedTunableCodes.length > 0) {
    const dead = new Set(derivation.unreferencedTunableCodes);
    for (const override of input.domainOverrides ?? []) {
      if (!dead.has(override.name)) continue;
      if (override.domain.mode === "FIXED") continue;
      throw new ResearchValidationError([
        {
          code: "PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER",
          path: `parameterSearchSpace.${override.name}`,
          message:
            `参数 ${override.name} 被赋予了 ${override.domain.mode} 搜索域，但**策略规则图从未引用它**`
            + `⇒ 搜索它不会改变任何执行结果（每一组都会得到同一份结果）。`
            + `要么在策略文档里用「参数引用」把阈值指向它，要么用 FIXED 只声明一个常量值`
            + `（FIXED 不冒充搜索维度）。`,
        },
      ]);
    }
    definition = excludeUnreferencedDomains(definition, dead);
  }

  const declared: ParameterSearchDeclaredParameter[] = input.projectionParameters.map((row) => ({
    code: row.code,
    dataType: row.dataType,
    parameterRole: row.parameterRole,
  }));

  const validation = validateParameterSearchSpace(definition, declared);
  if (!validation.valid) throw new ResearchValidationError(validation.issues);

  const searchable = summarizeParameterSearchSpace(definition);
  if (searchable.searchable.length === 0) {
    /**
     * PARAMETER-002 — 两类「无可搜索参数」必须分开报，否则会误导排查方向：
     *   ① 文档**压根没有**可搜索参数（缺 min/max/step、种类不对等）；
     *   ② 文档声明了 TUNABLE 参数，但**规则图从未引用**它们（死参数）。
     * ② 是本次实测抓到的真实成因（`cand-360001@1.0.0`：声明 3 个、引用 0 个），
     * 其修法是「在文档里用参数引用指向参数」，与 ① 完全不同。
     */
    if (derivation.referenceCheckApplied && derivation.unreferencedTunableCodes.length > 0) {
      throw new ResearchValidationError([
        {
          code: "PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER",
          path: "parameterSpace",
          message:
            `${input.strategyId}@${input.strategyVersion} 声明了 `
            + `${String(derivation.unreferencedTunableCodes.length)} 个 TUNABLE 参数`
            + `（${derivation.unreferencedTunableCodes.join(" / ")}），但**策略规则图从未引用**任何一个`
            + `⇒ 搜索它们不会改变任何执行结果（只会得到 N 组逐字节相同的重复结果 + 白付 N 次回测），`
            + `因此拒绝创建这次搜索。修法：在策略文档里用「参数引用」把阈值指向参数`
            + `（例如 bar.volume LESS_THAN_OR_EQUAL max_volume_ratio），生成新版本后再搜索。`,
        },
      ]);
    }
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_NO_TUNABLE_PARAMETER",
        path: "parameterSpace",
        message:
          "参数空间内没有任何可搜索（TUNABLE）参数 —— "
          + `排除原因：${searchable.excluded.map((item) => `${item.name}（${item.reason}）`).join("；") || "（无声明参数）"}`,
      },
    ]);
  }

  const combinationSet = buildParameterCombinations(definition, {
    maxCombinations: input.maxCombinations ?? DEFAULT_MAX_COMBINATIONS,
    declared,
  });

  const evaluationConfig = buildEvaluationConfig({
    startDate: input.startDate,
    endDate: input.endDate,
    datasetVersionId: input.datasetVersionId,
    datasetVersionLabel: input.datasetVersionLabel,
    ...(input.datasetSourcePolicy === undefined
      ? {}
      : { datasetSourcePolicy: input.datasetSourcePolicy }),
  });
  const evaluationConfigFingerprint = computeEvaluationConfigFingerprint({ ...evaluationConfig });

  const searchRunId = input.searchRunId ?? generateParameterSearchRunId();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const parameterSpaceJson = serializeParameterSearchSpace(definition);
  const runNotes = [
    `参数空间派生自策略投影：可搜索 ${searchable.searchable.join(" / ") || "（无）"}；`
      + `固定 ${searchable.fixed.join(" / ") || "（无）"}；推导 ${searchable.derived.join(" / ") || "（无）"}。`,
    `组合数 ${String(combinationSet.combinationCount)}（搜索方法 ${input.searchMethod}）。`,
    ...notes,
  ];

  await insertParameterSearchRun({
    searchRunId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    datasetVersionId: input.datasetVersionId,
    datasetVersionLabel: input.datasetVersionLabel,
    startDate: input.startDate,
    endDate: input.endDate,
    searchMethod: input.searchMethod,
    status: "CREATED",
    parameterSpaceJson,
    parameterSpaceFingerprint: computeRunSpaceSnapshotFingerprint(parameterSpaceJson),
    fixedCoordinatesJson: serializeFixedCoordinates({
      strategyVersionId: `${input.strategyId}@${input.strategyVersion}`,
      datasetVersionId: input.datasetVersionId,
      datasetVersionLabel: input.datasetVersionLabel,
      startDate: input.startDate,
      endDate: input.endDate,
      executionPolicyVersion: BACKTEST_EXECUTION_POLICY_VERSION,
      evaluationConfigFingerprint,
    }),
    executionPolicyVersion: BACKTEST_EXECUTION_POLICY_VERSION,
    evaluationConfigFingerprint,
    combinationCount: combinationSet.combinationCount,
    combinationSetFingerprint: computeCombinationSetFingerprint(combinationSet.combinations),
    notesJson: JSON.stringify(runNotes.slice(-MAX_RUN_NOTES)),
    /**
     * PARAMETER-002 死参数筛查结论**随 Run 冻结**（ROBUSTNESS-001 §12 依赖它做继承）。
     * 明确区分「查过且没发现死参数」（`true` + 空数组）与「根本没查」（`false`）——
     * 否则下游无法判断自己读到的是「安全」还是「未知」。
     */
    referenceCheckApplied: derivation.referenceCheckApplied,
    unreferencedTunableCodesJson: JSON.stringify([...derivation.unreferencedTunableCodes]),
  });

  await insertParameterSearchCombinations(
    combinationSet.combinations.map((combination) => ({
      searchRunId,
      combinationIndex: combination.combinationIndex,
      parameterHash: combination.parameterHash,
      parametersJson: JSON.stringify(combination.parameters),
    })),
  );

  const row = await getParameterSearchRunRow(searchRunId);
  if (row === null) throw new Error(`创建后无法读回 Search Run ${searchRunId}（写入未生效）`);

  return {
    run: toRunView(row),
    summary: searchable,
    derivationNotes: notes,
    referenceCheckApplied: derivation.referenceCheckApplied,
    unreferencedTunableCodes: derivation.unreferencedTunableCodes,
  };
}

// ---------------------------------------------------------------------------
// 行 → 视图投影（唯一落点）
// ---------------------------------------------------------------------------

function parseJsonObject(text: string | null): ResearchParameterSet {
  if (text === null || text === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as ResearchParameterSet;
}

/** Run 行 → wire 视图。 */
export function toRunView(row: ParameterSearchRunRow): ParameterSearchRunView {
  const parameterSpace =
    row.parameterSpaceJson === "" || row.parameterSpaceJson === null
      ? // 列表查询刻意不取快照列（长文本）；此处如实给出**空壳**并在前端提示「以详情为准」，
        // 而不是伪造一份看起来完整的快照。
        null
      : (JSON.parse(row.parameterSpaceJson) as ParameterSearchRunView["parameterSpace"]);
  const notesRaw = row.notesJson === null ? null : (JSON.parse(row.notesJson) as unknown);
  const notes = Array.isArray(notesRaw) ? notesRaw.map((item) => String(item)) : [];
  const fixed = JSON.parse(row.fixedCoordinatesJson === "" ? "{}" : row.fixedCoordinatesJson) as Record<
    string,
    unknown
  >;
  return {
    searchRunId: row.searchRunId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    datasetVersionId: row.datasetVersionId,
    datasetVersionLabel: row.datasetVersionLabel,
    startDate: String(row.startDate),
    endDate: String(row.endDate),
    searchMethod: row.searchMethod as ParameterSearchMethod,
    status: parseParameterSearchRunStatus(row.status),
    parameterSpace:
      parameterSpace ??
      ({
        recordKind: "PARAMETER_SEARCH_SPACE",
        recordVersion: 1,
        strategyId: row.strategyId,
        strategyVersion: row.strategyVersion,
        parameters: [],
        notes: ["（列表查询不含参数空间快照；请打开详情读取）"],
      } as ParameterSearchRunView["parameterSpace"]),
    parameterSpaceFingerprint: row.parameterSpaceFingerprint,
    fixedCoordinates: fixed as ParameterSearchRunView["fixedCoordinates"],
    executionPolicyVersion: row.executionPolicyVersion,
    evaluationConfigFingerprint: row.evaluationConfigFingerprint,
    combinationCount: row.combinationCount,
    completedCount: row.completedCount,
    failedCount: row.failedCount,
    createdAt: toIsoString(row.createdAt),
    startedAt: row.startedAt === null ? null : toIsoString(row.startedAt),
    completedAt: row.completedAt === null ? null : toIsoString(row.completedAt),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    notes,
    /** PARAMETER-002 — 死参数筛查状态（历史行读到 `null` ⇒ 下游按未验证处理）。 */
    referenceCheckApplied: row.referenceCheckApplied ?? null,
    unreferencedTunableCodes:
      row.unreferencedTunableCodesJson === null || row.unreferencedTunableCodesJson === ""
        ? []
        : (JSON.parse(row.unreferencedTunableCodesJson) as string[]),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** 组合行 → 视图。 */
export function toCombinationView(row: ParameterSearchCombinationRow): ParameterSearchCombinationView {
  return {
    searchRunId: row.searchRunId,
    combinationIndex: row.combinationIndex,
    parameterHash: row.parameterHash,
    parameters: parseJsonObject(row.parametersJson),
    status: row.status as ParameterSearchCombinationView["status"],
    attemptCount: row.attemptCount,
    lastError: row.lastError,
  };
}

/** 结果行 → 视图（`evaluationJson` 解析失败时如实置 null，不抛错让整页挂掉）。 */
export function toResultView(row: ParameterSearchResultRow): ParameterSearchResultView {
  let evaluation: unknown = null;
  if (row.evaluationJson !== null && row.evaluationJson !== "") {
    try {
      evaluation = JSON.parse(row.evaluationJson);
    } catch {
      evaluation = null;
    }
  }
  let annualizationBasis: ParameterSearchResultView["annualizationBasis"] = null;
  if (row.annualizationBasisJson !== null && row.annualizationBasisJson !== "") {
    try {
      annualizationBasis = JSON.parse(row.annualizationBasisJson) as ParameterSearchResultView["annualizationBasis"];
    } catch {
      annualizationBasis = null;
    }
  }
  // FRONTEND-FINAL-001（P0-2）：从**既有**复现快照列回读「实际被消费的参数集」。
  // 🔴 P0-2 上线之前写入的行不含该键 ⇒ 如实置 null（推断成「与请求一致」会是伪造）。
  let resolvedParameterSet: ParameterSearchResultView["resolvedParameterSet"] = null;
  if (typeof row.reproductionJson === "string" && row.reproductionJson !== "") {
    try {
      const snapshot = JSON.parse(row.reproductionJson) as { resolvedParameterSet?: unknown };
      const candidate = snapshot.resolvedParameterSet;
      if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
        resolvedParameterSet = candidate as ParameterSearchResultView["resolvedParameterSet"];
      }
    } catch {
      resolvedParameterSet = null;
    }
  }
  const parameters = parseJsonObject(row.parametersJson);
  return {
    recordKind: "PARAMETER_SEARCH_RESULT",
    recordVersion: 1,
    searchRunId: row.searchRunId,
    combinationIndex: row.combinationIndex,
    parameterHash: row.parameterHash,
    parameters,
    status: row.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
    error: row.error,
    backtestFingerprint: row.backtestFingerprint,
    backtestRunId: row.backtestRunId,
    evaluationId: row.evaluationId,
    evaluationRunId: row.evaluationRunId,
    evaluation,
    metrics: {
      totalReturnPct: row.totalReturnPct,
      annualizedReturnPct: row.annualizedReturnPct,
      maxDrawdownPct: row.maxDrawdownPct,
      tradeCount: row.tradeCount,
      winRatePct: row.winRatePct,
      profitFactor: row.profitFactor,
    },
    metricsSource: row.metricsSource === "canonical" ? "canonical" : "evaluators",
    annualizationBasis,
    evaluationConfigFingerprint: null,
    resolvedParameterSet,
    parameterResolution: compareRequestedWithResolved(parameters, resolvedParameterSet),
    createdAt: toIsoString(row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// 执行（Resume / Retry / Cache）
// ---------------------------------------------------------------------------

/** 执行输入。 */
export interface ExecuteParameterSearchRunInput {
  /** 真实读出的策略文档（由调用方经 `DbStrategyRepository` 读取后传入 —— 本层不做策略 IO）。 */
  readonly document: StrategyDocument;
  readonly codeVersion: string;
  readonly maxCombinations?: number;
  /** 只执行这些组合（retry 用）。缺省 = 全部未终结组合。 */
  readonly onlyParameterHashes?: readonly string[];
  /** 是否把失败组合也纳入（retry 默认只重跑失败组合；resume 默认只跑 PENDING）。 */
  readonly includeFailed?: boolean;
}

/** 执行结果摘要（供 API 如实回报本次干了什么）。 */
export interface ExecuteParameterSearchRunOutcome {
  readonly run: ParameterSearchRunView;
  readonly evaluatedCount: number;
  readonly skippedCount: number;
  readonly reusedFromCacheCount: number;
  readonly failedCount: number;
  /** 可变数组（wire 契约是 `string[]`，避免只读数组跨 tRPC 边界不可赋值）。 */
  readonly notes: string[];
}

/**
 * 执行 / 续跑 Search Run。
 *
 * 行为（顺序即语义）：
 *   1. 状态迁移校验（`CREATED | FAILED | COMPLETED | CANCELLED → RUNNING`）；
 *   2. 把遗留的 `RUNNING` 组合收敛为 `FAILED`（上次进程被中断 ⇒ 不假装它还在跑）；
 *   3. 逐个组合：本 Run 已 `SUCCEEDED` ⇒ **Resume 跳过**；Cache 命中 ⇒ 复用；
 *      否则调桥评估 → 落结果；
 *   4. 每个组合前**重读 Run 状态**：`CANCELLED` ⇒ 停止循环（保留已落结果）；
 *   5. 收尾：由结果行重算计数 → `COMPLETED`（或全失败 ⇒ `FAILED`）。
 */
export async function executeParameterSearchRun(
  searchRunId: string,
  input: ExecuteParameterSearchRunInput,
): Promise<ExecuteParameterSearchRunOutcome> {
  const notes: string[] = [];
  const runRow = await getParameterSearchRunRow(searchRunId);
  if (runRow === null) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_RUN_NOT_FOUND",
        path: "searchRunId",
        message: `Search Run 不存在：${searchRunId}`,
      },
    ]);
  }

  const currentStatus = parseParameterSearchRunStatus(runRow.status);
  assertSearchRunTransition(currentStatus, "RUNNING");

  const definition = JSON.parse(runRow.parameterSpaceJson) as ParameterSearchRunView["parameterSpace"];
  const fixed = JSON.parse(runRow.fixedCoordinatesJson) as Record<string, unknown>;
  const evaluationConfigFingerprint = runRow.evaluationConfigFingerprint;
  const evaluationConfig = buildEvaluationConfig({
    startDate: String(runRow.startDate),
    endDate: String(runRow.endDate),
    datasetVersionId: runRow.datasetVersionId,
    datasetVersionLabel: runRow.datasetVersionLabel,
  });
  // 评估配置指纹必须与创建时一致，否则 cache 判据失去意义（响亮失败，不静默继续）
  const recomputedConfigFingerprint = computeEvaluationConfigFingerprint({ ...evaluationConfig });
  if (recomputedConfigFingerprint !== evaluationConfigFingerprint) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_EVALUATION_CONFIG_DRIFT",
        path: "evaluationConfigFingerprint",
        message:
          `评估配置指纹与创建时不一致（落库 ${evaluationConfigFingerprint}，重算 ${recomputedConfigFingerprint}）——`
          + `配置口径变了，拒绝拿旧 cache 判据继续跑。`,
      },
    ]);
  }

  const startedAt = runRow.startedAt === null ? new Date().toISOString() : toIsoString(runRow.startedAt);
  await updateParameterSearchRun(searchRunId, { status: "RUNNING", startedAt, errorCode: null, errorMessage: null });

  const lingering = await failLingeringCombinations(
    searchRunId,
    "组合在执行中被中断（进程重启 / 取消）：本次执行开始时收敛为 FAILED；可用 retry 单独重跑。",
  );
  if (lingering > 0) {
    notes.push(`收敛遗留 RUNNING 组合 ${String(lingering)} 个为 FAILED（不假装其仍在执行）。`);
  }

  const combinationRows = await listParameterSearchCombinationRows(searchRunId);
  const only = input.onlyParameterHashes === undefined ? null : new Set(input.onlyParameterHashes);
  const bridge = createStrategyBacktestBridge({
    document: input.document,
    codeVersion: input.codeVersion,
    defaultRange: { startDate: String(runRow.startDate), endDate: String(runRow.endDate) },
    createdAt: startedAt,
    ...(runRow.datasetVersionId === null ? {} : { datasetVersionId: runRow.datasetVersionId }),
  });

  let evaluatedCount = 0;
  let skippedCount = 0;
  let reusedFromCacheCount = 0;
  let failedThisPass = 0;

  for (const combination of combinationRows) {
    if (only !== null && !only.has(combination.parameterHash)) continue;

    // -- Resume：本 Run 已成功的组合一律跳过（不重算、不重写）--
    if (combination.status === "SUCCEEDED") {
      skippedCount += 1;
      continue;
    }
    if (combination.status === "FAILED" && input.includeFailed !== true) {
      skippedCount += 1;
      continue;
    }

    // -- 取消检查：每组合前重读 Run 状态（取消可复现地停在断点）--
    const fresh = await getParameterSearchRunRow(searchRunId);
    const freshStatus =
      fresh === null ? "CANCELLED" : parseParameterSearchRunStatus(fresh.status);
    if (freshStatus === "CANCELLED") {
      notes.push(`执行被取消：已评估 ${String(evaluatedCount)} 个组合后停止（剩余组合保持 PENDING）。`);
      break;
    }

    const parameters = parseJsonObject(combination.parametersJson);
    const parameterHash = computeParameterHash({
      strategyId: runRow.strategyId,
      strategyVersion: runRow.strategyVersion,
      parameters,
    });
    if (parameterHash !== combination.parameterHash) {
      // 组合的 hash 与参数不一致 = 落库行被外部篡改 / 生成器口径变过 ⇒ 响亮失败，不继续
      throw new ResearchValidationError([
        {
          code: "PARAMETER_SEARCH_COMBINATION_HASH_MISMATCH",
          path: `combination.${combination.parameterHash}`,
          message:
            `组合行参数重算 hash 与落库 hash 不一致（落库 ${combination.parameterHash}，重算 ${parameterHash}）`
            + `—— 参数空间或哈希口径已变，拒绝在错位的身份上继续执行。`,
        },
      ]);
    }

    await updateParameterSearchCombinationStatus({
      searchRunId,
      parameterHash,
      status: "RUNNING",
      lastError: null,
    });
    evaluatedCount += 1;

    const cacheKey: ParameterSearchCacheKey = {
      strategyId: runRow.strategyId,
      strategyVersion: runRow.strategyVersion,
      datasetVersionId: runRow.datasetVersionId,
      parameterHash,
      executionPolicyVersion: runRow.executionPolicyVersion,
      evaluationConfigFingerprint,
    };
    const cached = await findReusableResult({
      strategyId: cacheKey.strategyId,
      strategyVersion: cacheKey.strategyVersion,
      datasetVersionId: cacheKey.datasetVersionId,
      parameterHash: cacheKey.parameterHash,
      executionPolicyVersion: cacheKey.executionPolicyVersion,
      evaluationConfigFingerprint: cacheKey.evaluationConfigFingerprint,
      excludeSearchRunId: searchRunId,
    });

    if (cached !== null) {
      reusedFromCacheCount += 1;
      await upsertParameterSearchResult({
        searchRunId,
        combinationIndex: combination.combinationIndex,
        parameterHash,
        parametersJson: combination.parametersJson,
        status: cached.row.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
        error: cached.row.error,
        totalReturnPct: cached.row.totalReturnPct,
        annualizedReturnPct: cached.row.annualizedReturnPct,
        maxDrawdownPct: cached.row.maxDrawdownPct,
        tradeCount: cached.row.tradeCount,
        winRatePct: cached.row.winRatePct,
        profitFactor: cached.row.profitFactor,
        metricsSource: cached.row.metricsSource,
        annualizationBasisJson: cached.row.annualizationBasisJson,
        backtestFingerprint: cached.row.backtestFingerprint,
        backtestRunId: cached.row.backtestRunId,
        evaluationId: cached.row.evaluationId,
        evaluationRunId: cached.row.evaluationRunId,
        evaluationJson: cached.row.evaluationJson,
        reproductionJson: cached.row.reproductionJson,
      });
      await updateParameterSearchCombinationStatus({
        searchRunId,
        parameterHash,
        status: "SUCCEEDED",
        attemptIncrement: 1,
        lastError: null,
      });
      notes.push(`cache 命中：组合 #${String(combination.combinationIndex)} 复用自 Run ${cached.searchRunId}。`);
      await recomputeRunCounters(searchRunId);
      continue;
    }

    const sample = await bridge.evaluate(parameters);
    const result = buildParameterSearchResult({
      searchRunId,
      combinationIndex: combination.combinationIndex,
      parameterHash,
      parameters,
      evaluationConfigFingerprint,
      createdAt: new Date().toISOString(),
      evaluation: sample.evaluation,
      experimentId: sample.experimentId,
      evaluationRunId: sample.evaluationRunId,
      backtestFingerprint: sample.backtestFingerprint,
      error: sample.outcome.status === "failed" ? sample.outcome.error : null,
      // FRONTEND-FINAL-001（P0-2）：评估端口已算出的「实际被消费参数集」原样透出。
      // 失败路径为 null ⇒ 对照状态记 UNAVAILABLE（**不重跑策略去反推**）。
      resolvedParameterSet: sample.resolvedParameterSet,
    });

    await upsertParameterSearchResult({
      searchRunId,
      combinationIndex: result.combinationIndex,
      parameterHash,
      parametersJson: JSON.stringify(parameters),
      status: result.status,
      error: result.error,
      totalReturnPct: result.metrics.totalReturnPct,
      annualizedReturnPct: result.metrics.annualizedReturnPct,
      maxDrawdownPct: result.metrics.maxDrawdownPct,
      tradeCount: result.metrics.tradeCount,
      winRatePct: result.metrics.winRatePct,
      profitFactor: result.metrics.profitFactor,
      metricsSource: result.metricsSource,
      annualizationBasisJson:
        result.annualizationBasis === null ? null : JSON.stringify(result.annualizationBasis),
      backtestFingerprint: result.backtestFingerprint,
      backtestRunId: result.backtestRunId,
      evaluationId: result.evaluationId,
      evaluationRunId: result.evaluationRunId,
      evaluationJson: result.evaluation === null ? null : JSON.stringify(result.evaluation),
      reproductionJson: JSON.stringify({
        strategyVersionId: `${runRow.strategyId}@${runRow.strategyVersion}`,
        datasetVersionId: runRow.datasetVersionId,
        parameterHash,
        executionPolicyVersion: runRow.executionPolicyVersion,
        evaluationConfigFingerprint,
        // FRONTEND-FINAL-001（P0-2）：把「实际被消费的参数集」并入**既有**复现快照列。
        // 刻意复用 `reproductionJson` 而不新增列 —— 该列语义本就是「复现要素快照」，
        // 且新增列需要 migration（本项目 `db:push` / `drizzle-kit generate` 均禁用）。
        // 键名与 walk-forward / OOS 的 `resolvedParameterSetJson` 语义对齐（同一 canonical 名）。
        resolvedParameterSet: result.resolvedParameterSet,
      }),
    });

    await updateParameterSearchCombinationStatus({
      searchRunId,
      parameterHash,
      status: result.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
      attemptIncrement: 1,
      lastError: result.error,
    });
    if (result.status === "FAILED") {
      failedThisPass += 1;
      notes.push(
        `组合 #${String(combination.combinationIndex)} 评估失败：${result.error ?? "（无错误详情）"}`,
      );
    } else if (isMetricsFullyUnavailable(result.metrics)) {
      // 「评估成功」与「指标可用」是两件事：成功但六项全不可用时如实登记，绝不编造数值
      notes.push(
        `组合 #${String(combination.combinationIndex)} 评估成功但六项指标全不可用`
          + `（metricsSource=${result.metricsSource}）—— 如实登记，未编造数值。`,
      );
    }
    await recomputeRunCounters(searchRunId);
  }

  // -- 收尾：由结果行重算计数（唯一口径），再定终态 --
  const counters = await recomputeRunCounters(searchRunId);
  const finalRow = await getParameterSearchRunRow(searchRunId);
  const stillCancelled = finalRow !== null && finalRow.status === "CANCELLED";
  const total = runRow.combinationCount;
  let finalStatus: ParameterSearchRunStatus;
  if (stillCancelled) {
    finalStatus = "CANCELLED";
  } else if (total > 0 && counters.completedCount === 0) {
    finalStatus = "FAILED";
    notes.push(
      `全部 ${String(total)} 个组合均未评估成功 ⇒ 状态记 FAILED（不把「一个都没成」写成 COMPLETED）。`,
    );
  } else {
    finalStatus = "COMPLETED";
  }
  const completedAt = new Date().toISOString();
  assertSearchRunTransition(parseParameterSearchRunStatus(finalRow?.status ?? "RUNNING"), finalStatus);

  const progress = computeRunProgress({
    combinationCount: total,
    completedCount: counters.completedCount,
    failedCount: counters.failedCount,
  });
  const mergedNotes = [...(readNotes(runRow.notesJson) ?? []), ...notes].slice(-MAX_RUN_NOTES);
  await updateParameterSearchRun(searchRunId, {
    status: finalStatus,
    completedAt,
    notesJson: JSON.stringify(mergedNotes),
    errorCode:
      finalStatus === "FAILED" ? "PARAMETER_SEARCH_ALL_COMBINATIONS_FAILED" : null,
    errorMessage:
      finalStatus === "FAILED"
        ? `全部 ${String(total)} 个组合均未评估成功（失败 ${String(counters.failedCount)} 个）。`
        : null,
  });

  const updated = await getParameterSearchRunRow(searchRunId);
  if (updated === null) throw new Error(`执行后无法读回 Search Run ${searchRunId}`);
  notes.push(
    `进度：成功 ${String(progress.completedCount)} / 失败 ${String(progress.failedCount)} / 计划 ${String(progress.combinationCount)}`
      + `（${String(progress.progressPct)}%）。`,
  );

  return {
    run: toRunView(updated),
    evaluatedCount,
    skippedCount,
    reusedFromCacheCount,
    failedCount: failedThisPass,
    notes,
  };
}

function readNotes(json: string | null): string[] | null {
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Retry / Cancel / 读取
// ---------------------------------------------------------------------------

/** 重试单个组合（默认只允许 `FAILED`；`force` 才允许重跑 `SUCCEEDED` —— 那是**覆盖已有结果**，必须显式）。 */
export async function retryParameterSearchCombination(
  searchRunId: string,
  parameterHash: string,
  input: ExecuteParameterSearchRunInput & { readonly force?: boolean },
): Promise<ExecuteParameterSearchRunOutcome> {
  const combinationRows = await listParameterSearchCombinationRows(searchRunId);
  const target = combinationRows.find((row) => row.parameterHash === parameterHash);
  if (target === undefined) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_COMBINATION_NOT_FOUND",
        path: "parameterHash",
        message: `组合不存在于 Run ${searchRunId}：${parameterHash}`,
      },
    ]);
  }
  if (target.status === "SUCCEEDED" && input.force !== true) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_RETRY_ON_SUCCEEDED",
        path: "parameterHash",
        message:
          `组合 #${String(target.combinationIndex)} 已成功；重跑会**覆盖已有结果**，`
          + `需显式 force=true（默认拒绝，避免误覆盖已落档的成功产物）。`,
      },
    ]);
  }
  // 状态回到 PENDING，让主循环按「未终结」把它跑掉
  await updateParameterSearchCombinationStatus({
    searchRunId,
    parameterHash,
    status: "PENDING",
    lastError: null,
  });
  return executeParameterSearchRun(searchRunId, {
    document: input.document,
    codeVersion: input.codeVersion,
    ...(input.maxCombinations === undefined ? {} : { maxCombinations: input.maxCombinations }),
    onlyParameterHashes: [parameterHash],
    includeFailed: true,
  });
}

/** 取消 Run（对正在执行的循环生效：下一组合前重读状态即停）。 */
export async function cancelParameterSearchRun(searchRunId: string): Promise<ParameterSearchRunView> {
  const row = await getParameterSearchRunRow(searchRunId);
  if (row === null) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_RUN_NOT_FOUND",
        path: "searchRunId",
        message: `Search Run 不存在：${searchRunId}`,
      },
    ]);
  }
  const status = parseParameterSearchRunStatus(row.status);
  assertSearchRunTransition(status, "CANCELLED");
  if (status !== "CANCELLED") {
    await updateParameterSearchRun(searchRunId, { status: "CANCELLED", completedAt: new Date().toISOString() });
  }
  const updated = await getParameterSearchRunRow(searchRunId);
  if (updated === null) throw new Error(`取消后无法读回 Search Run ${searchRunId}`);
  return toRunView(updated);
}

/** 读取 Run 详情（含参数空间快照）。 */
export async function readParameterSearchRun(searchRunId: string): Promise<ParameterSearchRunView | null> {
  const row = await getParameterSearchRunRow(searchRunId);
  return row === null ? null : toRunView(row);
}

/** 列出 Run（列表页；不含快照长文本）。 */
export async function listParameterSearchRuns(options: {
  readonly limit: number;
  readonly offset?: number;
  readonly strategyId?: string;
}): Promise<ParameterSearchRunView[]> {
  const rows = await listParameterSearchRunRows(options);
  return rows.map(toRunView);
}

/** 列出组合（详情页进度用）。 */
export async function listParameterSearchCombinations(
  searchRunId: string,
): Promise<ParameterSearchCombinationView[]> {
  const rows = await listParameterSearchCombinationRows(searchRunId);
  return rows.map(toCombinationView);
}

/** 排序 / 过滤（规格 §11：只提供能力，**不产出「最佳参数」结论**）。 */
export interface ListResultsOptions {
  readonly sortBy?: ParameterSearchResultSortField;
  readonly sortDirection?: "ASC" | "DESC";
  readonly status?: "SUCCEEDED" | "FAILED";
  readonly minTradeCount?: number;
  readonly maxDrawdownPct?: number;
  readonly minTotalReturnPct?: number;
  readonly limit?: number;
  readonly offset?: number;
}

function compareNullable(left: number | null, right: number | null, direction: 1 | -1): number {
  // 不可用值恒排在「有值」之后（升序降序都一样）—— 避免 null 被当成 0 排到最前
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left === right ? 0 : left > right ? direction : -direction;
}

function sortValueOf(
  result: ParameterSearchResultView,
  field: ParameterSearchResultSortField,
): number | null {
  switch (field) {
    case "combinationIndex":
      return result.combinationIndex;
    case "totalReturnPct":
      return result.metrics.totalReturnPct;
    case "annualizedReturnPct":
      return result.metrics.annualizedReturnPct;
    case "maxDrawdownPct":
      return result.metrics.maxDrawdownPct;
    case "tradeCount":
      return result.metrics.tradeCount;
    case "winRatePct":
      return result.metrics.winRatePct;
    case "profitFactor":
      return result.metrics.profitFactor;
  }
}

/**
 * 读取结果列表（排序 / 过滤在**服务端**做，前端只负责呈现）。
 *
 * 默认按 `combinationIndex` 升序 —— **刻意不用收益排序**：默认视图不该暗示「第一个就是最优」。
 */
export async function listParameterSearchResults(
  searchRunId: string,
  options: ListResultsOptions = {},
): Promise<ParameterSearchResultPage> {
  const rows = await listParameterSearchResultRows(searchRunId);
  let results = rows.map(toResultView);

  if (options.status !== undefined) {
    results = results.filter((item) => item.status === options.status);
  }
  if (options.minTradeCount !== undefined) {
    results = results.filter(
      (item) => item.metrics.tradeCount !== null && item.metrics.tradeCount >= options.minTradeCount!,
    );
  }
  if (options.maxDrawdownPct !== undefined) {
    results = results.filter(
      (item) => item.metrics.maxDrawdownPct !== null && item.metrics.maxDrawdownPct <= options.maxDrawdownPct!,
    );
  }
  if (options.minTotalReturnPct !== undefined) {
    results = results.filter(
      (item) => item.metrics.totalReturnPct !== null && item.metrics.totalReturnPct >= options.minTotalReturnPct!,
    );
  }

  const sortBy = options.sortBy ?? "combinationIndex";
  const direction: 1 | -1 = options.sortDirection === "DESC" ? -1 : 1;
  results = [...results].sort((left, right) => {
    const primary = compareNullable(sortValueOf(left, sortBy), sortValueOf(right, sortBy), direction);
    if (primary !== 0) return primary;
    return left.combinationIndex - right.combinationIndex; // 破平：稳定
  });
  if (options.sortDirection === "DESC") {
    // compareNullable 已按 direction 处理数值；破平键保持升序（稳定且可解释）
  }

  const total = results.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT;
  const page = results.slice(offset, offset + limit);
  return {
    searchRunId,
    total,
    returned: page.length,
    truncated: offset + page.length < total,
    results: page,
  };
}

/** 六项指标全不可用的组合数（UI 一次性提示用）。 */
export function countFailedResults(page: ParameterSearchResultPage): number {
  return page.results.filter((item) => item.status === "FAILED").length;
}
