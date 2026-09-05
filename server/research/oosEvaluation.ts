/**
 * STEP 6.4 — OOS 隔离评估（最终、隔离的策略评估）。
 *
 * 职责：把「已冻结候选」在 OOS 区间上的一次评估结果组织成 immutable、可追溯的
 * OosEvaluationResult，并强制执行以下隔离铁律（§19 / §26 / §32）：
 *
 *   - OOS 只能消费 `FrozenOosCandidate`（不能接受 `ParameterSpace`，不能回退参数）；
 *   - OOS 结果一旦产生即 immutable，不能被 Validation Selection 覆盖；
 *   - OOS 不允许回写 Validation Selection / 修改 Experiment Snapshot / 修改 selected parameters；
 *   - OOS 结果必须完整可追溯：OOS → Frozen Candidate → Validation 结果 → Snapshot → Strategy Version。
 *
 * 本模块只做「结果建模 + 组装 + 冻结」的纯逻辑，不实现任何回测 / 交易。
 */

import { ResearchValidationError } from "./experimentValidation";
import type { PerformanceMetrics } from "../engine/domain";
import type { ResearchDatasetRange } from "./datasetSplit";
import type { FrozenOosCandidate } from "./validationSelection";

/** OOS 结果状态。 */
export type OosEvaluationStatus = "succeeded" | "failed";

/**
 * OOS 隔离评估结果（immutable）。
 *
 * 可追溯链：OosEvaluationResult → frozenCandidate → validationFingerprint /
 * snapshot（含 strategyVersion + 冻结 costModel）→ 最终 OOS metrics。
 */
export interface OosEvaluationResult {
  /** 冻结候选（含完整 snapshot：策略版本 + 冻结成本模型 + 回测/特征配置）。 */
  frozenCandidate: FrozenOosCandidate;
  /** 数据集切分 fingerprint（与候选的 validationFingerprint 一致，标识同一切分）。 */
  datasetSplitFingerprint: string;
  /** OOS 日期区间。 */
  oosRange: ResearchDatasetRange;
  /** 最终状态。 */
  status: OosEvaluationStatus;
  /** 成功时的绩效指标（复用引擎 PerformanceMetrics）。 */
  metrics?: PerformanceMetrics;
  /** 失败时的错误信息。 */
  error?: string;
  /** 执行时间（元数据；测试可注入）。 */
  executedAt?: string;
}

/** 组装 OOS 结果的输入。 */
export interface OosEvaluationInput {
  candidate: FrozenOosCandidate;
  datasetSplitFingerprint: string;
  oosRange: ResearchDatasetRange;
  status: OosEvaluationStatus;
  metrics?: PerformanceMetrics;
  error?: string;
  executedAt?: string;
}

function isValidRange(range: ResearchDatasetRange): boolean {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return !!range
    && typeof range.start === "string" && re.test(range.start)
    && typeof range.end === "string" && re.test(range.end)
    && range.start <= range.end;
}

/**
 * 组装并冻结 OOS 结果（纯函数）。
 *
 * 校验：
 *   - candidate 已冻结（snapshot 完整、validationFingerprint 非空）；
 *   - datasetSplitFingerprint 与候选的 validationFingerprint 一致（标识同一切分，禁止换切分）；
 *   - oosRange 合法；
 *   - succeeded 时 metrics 存在且有限；failed 时 error 非空。
 * 返回全新深拷贝（mutation isolation：外部修改不影响输入候选 / snapshot）。
 */
export function buildOosEvaluationResult(input: OosEvaluationInput): OosEvaluationResult {
  const { candidate } = input;
  if (!candidate || typeof candidate !== "object" || typeof candidate.snapshot !== "object") {
    throw new ResearchValidationError([
      { code: "OOS_CANDIDATE_NOT_FROZEN", path: "candidate", message: "OOS 只能消费已冻结候选（FrozenOosCandidate，含完整 snapshot）" },
    ]);
  }
  if (typeof candidate.validationFingerprint !== "string" || candidate.validationFingerprint.trim() === "") {
    throw new ResearchValidationError([
      { code: "OOS_CANDIDATE_FP_EMPTY", path: "candidate.validationFingerprint", message: "冻结候选缺少 validationFingerprint" },
    ]);
  }
  if (input.datasetSplitFingerprint !== candidate.validationFingerprint) {
    throw new ResearchValidationError([
      {
        code: "OOS_SPLIT_FP_MISMATCH",
        path: "datasetSplitFingerprint",
        message: `OOS 切分指纹(${input.datasetSplitFingerprint}) 与候选 validationFingerprint(${candidate.validationFingerprint}) 不一致`,
      },
    ]);
  }
  if (!isValidRange(input.oosRange)) {
    throw new ResearchValidationError([
      { code: "OOS_RANGE_INVALID", path: "oosRange", message: "oosRange 必须是合法的 YYYY-MM-DD 闭区间" },
    ]);
  }
  if (input.status !== "succeeded" && input.status !== "failed") {
    throw new ResearchValidationError([
      { code: "OOS_STATUS_INVALID", path: "status", message: `非法 OOS 状态：${String(input.status)}` },
    ]);
  }

  if (input.status === "succeeded") {
    if (!input.metrics || typeof input.metrics !== "object") {
      throw new ResearchValidationError([
        { code: "OOS_METRICS_MISSING", path: "metrics", message: "succeeded 的 OOS 结果必须携带 metrics" },
      ]);
    }
    for (const [key, value] of Object.entries(input.metrics)) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new ResearchValidationError([
          { code: "OOS_METRICS_NOT_FINITE", path: `metrics.${key}`, message: `OOS 指标 ${key} 必须是有限数字或 null（禁止 NaN/Infinity）` },
        ]);
      }
    }
  } else if (typeof input.error !== "string" || input.error.trim() === "") {
    throw new ResearchValidationError([
      { code: "OOS_ERROR_MISSING", path: "error", message: "failed 的 OOS 结果必须携带 error" },
    ]);
  }

  return {
    frozenCandidate: structuredClone(candidate),
    datasetSplitFingerprint: input.datasetSplitFingerprint,
    oosRange: structuredClone(input.oosRange),
    status: input.status,
    metrics: input.metrics === undefined ? undefined : structuredClone(input.metrics),
    error: input.error,
    executedAt: input.executedAt,
  };
}
