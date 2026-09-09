/**
 * STEP 13 / C-13.3 — Experiment Lineage：构造 / 映射（纯函数）。
 *
 * 职责：
 *   - createExperimentLineageRecord：给定 §28 全字段输入 → 组装不可变记录（计算 fingerprint、
 *     结构校验、深冻结）。缺省 ref（kind="missing"）在结构层合法，齐备性由 validator 默认档把关；
 *   - experimentToLineageRecord / snapshotToLineageRecord：把既有 ResearchExperiment / Snapshot
 *     兼容映射为谱系记录（compatibility mapping）——把 dataset 里的 datasetVersion/universe 显式化；
 *     code_version 由入口注入（本模块不猜）；regime 未评估时填结构化 unassessed 占位 + reason；
 *   - mountRunOutcome：把一次 succeeded 运行的 metrics/result 挂载为 outcome（不可覆盖，产生新记录）。
 *
 * 映射纪律（宁可显式 missing 也不猜）：
 *   - 载体（dataset.datasetVersion / backtestConfig.costModel 等）解析不到真实值时 → missing 标记；
 *   - 载体已给值 + context 又注入不同值 → 响亮抛错（不一致即失败，禁止静默忽略其一）；
 *   - context 只用于「载体缺省时显式注入」的补齐，绝不用于覆盖载体已有的事实。
 *
 * 铁律：纯模块，无 DB / 无 Date.now / 无 Math.random / 无 IO。
 */

import type { CostModel } from "../../engine/domain";
import type {
  ResearchBacktestConfig,
  ResearchDatasetSpec,
  ResearchExperiment,
  ResearchExperimentSnapshot,
  ResearchParameterSet,
} from "../types";
import type { ResearchRun } from "../run";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError } from "../experimentValidation";
import { validateExperimentLineageRecord } from "./validate";
import { computeExperimentLineageFingerprint } from "./serialize";
import {
  DEFAULT_REGIME_UNASSESSED_REASON,
  EXPERIMENT_LINEAGE_RECORD_KIND,
  EXPERIMENT_LINEAGE_RECORD_VERSION,
  REGIME_UNASSESSED_REASON_CODE,
  LINEAGE_MISSING_CODES,
  type ExperimentLineageCostModelRef,
  type ExperimentLineageDateRange,
  type ExperimentLineageMissing,
  type ExperimentLineageOutcome,
  type ExperimentLineageRecord,
  type ExperimentLineageRegime,
  type ExperimentLineageSlippageRef,
  type ExperimentLineageStringRef,
} from "./types";

// ---------------------------------------------------------------------------
// Mapping Context
// ---------------------------------------------------------------------------

/**
 * 映射上下文：只承载「载体缺省时由调用方显式补齐」的事实。
 *
 * 补齐项与语义：
 *   - codeVersion       ：入口用 composeCodeVersion(packageVersion, git) 解析出的代码版本
 *                         （缺省 → dataset/code 等记为 missing，validator 齐备性检查会报缺）；
 *   - datasetVersion    ：experiment.dataset.datasetVersion 缺省时注入实际消费的数据集版本（rd-…）；
 *   - universeVersion   ：universe 决议无独立载体；若运行消费了 research-dataset 派生 universe，
 *                         显式注入 universeVersion=datasetVersion（= deriveDatasetUniverseId 的
 *                         内容指纹语义）；否则保持缺省 → missing；
 *   - executionModel    ：backtestConfig.executionModel 缺省时注入实际执行模型（当前引擎仅 next-open）；
 *   - costModel         ：backtestConfig.costModel 缺省时注入创建期冻结的成本模型；
 *   - regime            ：显式 regime 评估（C-22.1 前不建议使用）；缺省 → unassessed 占位；
 *   - regimeUnassessedReason：占位原因覆盖（缺省用 DEFAULT_REGIME_UNASSESSED_REASON）；
 *   - createdAt         ：仅 snapshotToLineageRecord 需要（Snapshot 不含 createdAt）。
 */
export interface ExperimentLineageMappingContext {
  readonly codeVersion?: string;
  readonly datasetVersion?: string;
  readonly universeVersion?: string;
  readonly executionModel?: string;
  readonly costModel?: CostModel;
  readonly regime?: ExperimentLineageRegime;
  readonly regimeUnassessedReason?: string;
  readonly createdAt?: string;
}

// ---------------------------------------------------------------------------
// Ref 解析 helpers（全部走「显式 missing」纪律）
// ---------------------------------------------------------------------------

function resolvedString(value: string): ExperimentLineageStringRef {
  return { kind: "resolved", value };
}

function missing(code: string, reason: string): ExperimentLineageMissing {
  return { kind: "missing", code, reason };
}

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function resolveDatasetVersion(spec: ResearchDatasetSpec, ctx: ExperimentLineageMappingContext): ExperimentLineageStringRef {
  const primary = spec.datasetVersion;
  const injected = ctx.datasetVersion;
  if (hasValue(primary)) {
    if (hasValue(injected) && injected !== primary) {
      throw new Error(
        `谱系映射：dataset.datasetVersion（${primary}）与注入 context.datasetVersion（${injected}）不一致；` +
          "context 只允许在载体缺省时补齐，禁止与载体事实冲突",
      );
    }
    return resolvedString(primary);
  }
  if (hasValue(injected)) return resolvedString(injected);
  return missing(
    LINEAGE_MISSING_CODES.DATASET_VERSION_UNRESOLVED,
    "ResearchDatasetSpec.datasetVersion 未提供且 context 未注入 datasetVersion（数据集未经 C-12.6.1 内容版本化；禁止在谱系中猜版本）",
  );
}

function resolveUniverseVersion(ctx: ExperimentLineageMappingContext): ExperimentLineageStringRef {
  if (hasValue(ctx.universeVersion)) return resolvedString(ctx.universeVersion);
  return missing(
    LINEAGE_MISSING_CODES.UNIVERSE_VERSION_UNRESOLVED,
    "universe 决议当前无独立版本载体（universe_definition 绑定在 Research Dataset 内容指纹内，universeId=research-dataset:<datasetVersion>）；" +
      "运行若消费 research-dataset 派生 universe，请显式注入 universeVersion=datasetVersion，禁止本层猜测",
  );
}

function resolveCodeVersion(ctx: ExperimentLineageMappingContext): ExperimentLineageStringRef {
  if (hasValue(ctx.codeVersion)) return resolvedString(ctx.codeVersion);
  return missing(
    LINEAGE_MISSING_CODES.CODE_VERSION_UNRESOLVED,
    "context 未注入 codeVersion（应在入口用 composeCodeVersion(packageVersion, gitHead, dirty) 解析后注入；纯模块禁止自行读 package.json / git）",
  );
}

function resolveCostModel(config: ResearchBacktestConfig, ctx: ExperimentLineageMappingContext): ExperimentLineageCostModelRef {
  const primary = config.costModel;
  const injected = ctx.costModel;
  if (primary !== undefined && injected !== undefined && canonicalStringify(primary) !== canonicalStringify(injected)) {
    throw new Error(
      "谱系映射：backtestConfig.costModel 与注入 context.costModel 不一致；context 只允许在载体缺省时补齐，禁止与载体事实冲突",
    );
  }
  if (primary !== undefined) return { kind: "frozen", model: structuredClone(primary) };
  if (injected !== undefined) return { kind: "frozen", model: structuredClone(injected) };
  return missing(
    LINEAGE_MISSING_CODES.COST_MODEL_UNRESOLVED,
    "backtestConfig.costModel 未冻结（无法复现运行成本口径）且 context 未注入 costModel；" +
      "当前默认成本模型会随时间漂移，禁止在谱系中按当前默认值补猜",
  );
}

function resolveSlippageModel(costModelRef: ExperimentLineageCostModelRef): ExperimentLineageSlippageRef {
  if (costModelRef.kind === "frozen") {
    return { kind: "resolved", model: "fixed-bps", slippageBps: costModelRef.model.slippageBps };
  }
  return missing(
    LINEAGE_MISSING_CODES.SLIPPAGE_MODEL_UNRESOLVED,
    "当前引擎唯一滑点实现 = 冻结 CostModel.slippageBps（固定基点）；costModel 未冻结故滑点口径不可解析",
  );
}

function resolveExecutionModel(config: ResearchBacktestConfig, ctx: ExperimentLineageMappingContext): ExperimentLineageStringRef {
  const primary = config.executionModel;
  const injected = ctx.executionModel;
  if (hasValue(primary)) {
    if (hasValue(injected) && injected !== primary) {
      throw new Error(
        `谱系映射：backtestConfig.executionModel（${primary}）与注入 context.executionModel（${injected}）不一致；` +
          "context 只允许在载体缺省时补齐",
      );
    }
    return resolvedString(primary);
  }
  if (hasValue(injected)) return resolvedString(injected);
  return missing(
    LINEAGE_MISSING_CODES.EXECUTION_MODEL_UNRESOLVED,
    "backtestConfig.executionModel 未冻结（当前生产引擎仅实现 next-open，但快照未记录该口径）；运行前应显式注入 executionModel",
  );
}

function resolveRegime(ctx: ExperimentLineageMappingContext): ExperimentLineageRegime {
  if (ctx.regime !== undefined) return ctx.regime;
  const reason = ctx.regimeUnassessedReason ?? DEFAULT_REGIME_UNASSESSED_REASON;
  return { kind: "unassessed", reasonCode: REGIME_UNASSESSED_REASON_CODE, reason };
}

// ---------------------------------------------------------------------------
// 组装 / 挂载
// ---------------------------------------------------------------------------

/** createExperimentLineageRecord 的输入（recordKind/recordVersion/fingerprint 由组装层固定）。 */
export type ExperimentLineageRecordInput = Omit<
  ExperimentLineageRecord,
  "fingerprint" | "recordKind" | "recordVersion"
>;

/** 深冻结（复制入参后冻结，绝不冻结调用方共享对象）。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * 组装 §28 全字段谱系记录（不可变）。
 * 先深拷贝输入（绝不冻结 / 共享调用方对象），算 fingerprint，再做结构校验
 * （requireResolvedRefs=false：missing 缺省在结构层合法、只拦形态/格式/一致性错误），
 * 最后深冻结。校验失败响亮抛 ResearchValidationError。
 */
export function createExperimentLineageRecord(input: ExperimentLineageRecordInput): ExperimentLineageRecord {
  const parameterSet: ResearchParameterSet = structuredClone(input.parameterSet);
  const dateRange: ExperimentLineageDateRange = { startDate: input.dateRange.startDate, endDate: input.dateRange.endDate };
  const body = {
    recordKind: EXPERIMENT_LINEAGE_RECORD_KIND,
    recordVersion: EXPERIMENT_LINEAGE_RECORD_VERSION,
    ...input,
    parameterSet,
    dateRange,
  };
  // 先整体深拷贝再冻结：把「复制 + 不可变」两个动作与调用方入参彻底隔离。
  const clone = structuredClone(body);
  const fingerprint = computeExperimentLineageFingerprint(clone);
  const record: ExperimentLineageRecord = { ...clone, fingerprint };
  const validation = validateExperimentLineageRecord(record, { requireResolvedRefs: false });
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  return deepFreeze(record);
}

// ---------------------------------------------------------------------------
// 兼容映射：ResearchExperiment / ResearchExperimentSnapshot → LineageRecord
// ---------------------------------------------------------------------------

/** 抽取 ResearchExperiment / Snapshot 共有的输入底座。 */
function extractBase(
  input: Pick<ResearchExperiment, "experimentId" | "strategyId" | "strategyVersion" | "parameterSet" | "dataset" | "backtestConfig">,
  ctx: ExperimentLineageMappingContext,
): Omit<ExperimentLineageRecordInput, "createdAt" | "outcome"> {
  const datasetVersion = resolveDatasetVersion(input.dataset, ctx);
  const costModel = resolveCostModel(input.backtestConfig, ctx);
  return {
    experimentId: input.experimentId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    datasetVersion,
    universeVersion: resolveUniverseVersion(ctx),
    parameterSet: input.parameterSet,
    dateRange: { startDate: input.dataset.startDate, endDate: input.dataset.endDate },
    costModel,
    slippageModel: resolveSlippageModel(costModel),
    executionModel: resolveExecutionModel(input.backtestConfig, ctx),
    regime: resolveRegime(ctx),
    codeVersion: resolveCodeVersion(ctx),
  };
}

/**
 * 既有实验 → §28 谱系记录（兼容映射；createdAt 取 experiment.createdAt）。
 * dataset / costModel / executionModel 载体缺省时按上文映射纪律显式 missing 或注入补齐。
 */
export function experimentToLineageRecord(
  experiment: ResearchExperiment,
  ctx: ExperimentLineageMappingContext,
): ExperimentLineageRecord {
  const base = extractBase(experiment, ctx);
  return createExperimentLineageRecord({ ...base, outcome: null, createdAt: experiment.createdAt });
}

/**
 * 既有实验快照 → §28 谱系记录。
 * Snapshot 不含 createdAt（freeze 输入无生命周期），必须由 context.createdAt 注入，否则响亮抛错。
 */
export function snapshotToLineageRecord(
  snapshot: ResearchExperimentSnapshot,
  ctx: ExperimentLineageMappingContext,
): ExperimentLineageRecord {
  if (!hasValue(ctx.createdAt)) {
    throw new Error(
      "快照映射为谱系记录需要 context.createdAt（ResearchExperimentSnapshot 不含 createdAt；请注入实验创建时间）",
    );
  }
  const base = extractBase(snapshot, ctx);
  return createExperimentLineageRecord({ ...base, outcome: null, createdAt: ctx.createdAt! });
}

/**
 * 把一次 succeeded 运行的 metrics/result 挂载到谱系记录（返回新记录，原记录不可变）。
 * 一次记录至多挂载一个 outcome；换 Run 请基于输入重新映射。禁止挂载非本实验 / 非 succeeded / result 为 null 的 Run。
 */
export function mountRunOutcome(record: ExperimentLineageRecord, run: ResearchRun): ExperimentLineageRecord {
  if (record.outcome !== null) {
    throw new Error(`谱系记录已挂载运行结果 runId=${record.outcome.runId}，禁止覆盖（换 Run 请重新映射生成新记录）`);
  }
  if (run.experimentId !== record.experimentId) {
    throw new Error(
      `Run（${run.runId}）属于实验 ${run.experimentId}，与谱系记录实验 ${record.experimentId} 不一致，禁止挂载`,
    );
  }
  if (run.status !== "succeeded") {
    throw new Error(`只有 succeeded 运行才产出 metrics/result；Run ${run.runId} 状态为 ${run.status}，禁止挂载`);
  }
  if (run.result === null) {
    throw new Error(`Run ${run.runId} 状态为 succeeded 但 result 为 null（数据损坏），禁止挂载`);
  }
  const outcome: ExperimentLineageOutcome = {
    runId: run.runId,
    status: run.status,
    metrics: structuredClone(run.result.performance),
    result: structuredClone(run.result),
    recordedAt: run.finishedAt ?? run.createdAt,
  };
  const {
    fingerprint: _ignoredFingerprint,
    outcome: _ignoredOutcome,
    recordKind: _ignoredRecordKind,
    recordVersion: _ignoredRecordVersion,
    ...rest
  } = record;
  return createExperimentLineageRecord({ ...rest, outcome });
}
