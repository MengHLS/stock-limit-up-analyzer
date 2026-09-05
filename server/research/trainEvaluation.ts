/**
 * STEP 6.5-FIX-1 — Train Evaluation + Candidate Eligibility。
 *
 * 目的：让 Train 从「dead range」变成 WFO 中真实参与候选形成 / 预筛选的数据阶段，
 * 同时严格保持 Validation 的 Selection Authority 与 OOS 的完全隔离。
 *
 * 语义（§六/§七，最小、非任意）：
 *   - Train Evaluation 只做「候选在 Train 区间是否可计算、选择指标是否有效」的判定；
 *   - Train 可以淘汰「明显不合格候选」（Train 回测失败 / 选择指标为 null·NaN·Infinity），
 *     但**不能**据此宣布最终 Winner；
 *   - 复用既有 `selectionMetric`（与 Validation 选择同一指标），不发明任意 train score /
 *     魔法阈值（§七：无明确 train threshold 时不得自行创造）；
 *   - Validation 仍是唯一 Selection Authority（§十四）。
 *
 * 本模块只做「结果建模 + eligibility 筛选」的纯逻辑，不实现任何回测 / 交易；Train 的
 * 实际计算由 `ResearchEvaluationService.evaluateTrain` 走 `ResearchBacktestExecutor` →
 * Production Backtest Core 完成。
 */

import type { PerformanceMetrics } from "../engine/domain";
import { ResearchValidationError } from "./experimentValidation";
import type { ResearchParameterSet } from "./types";
import { isSelectableMetric, type SelectionMetric } from "./validationSelection";

/**
 * 单个候选在 Train 区域的运行结果（候选生命周期中的 Train 阶段，§十二）。
 *
 * 与 `ValidationCandidateResult` 结构对齐，但语义不同：Train 结果只参与 eligibility，
 * 不参与最终 Winner 选择。
 */
export interface TrainCandidateResult {
  experimentId: string;
  parameterSet: ResearchParameterSet;
  status: "succeeded" | "failed";
  /** 成功时的绩效指标（复用引擎 PerformanceMetrics）。 */
  metrics?: PerformanceMetrics;
  /** 失败时的错误信息（§二十四：绝不静默当作 metric = 0）。 */
  error?: string;
}

/** 单个候选的 Train eligibility 判定（用于审计）。 */
export interface TrainEligibilityEntry {
  experimentId: string;
  eligible: boolean;
  reason: string;
}

/** Train eligibility 汇总结果。 */
export interface TrainEligibility {
  /** 通过 eligibility 的候选 experimentId（保持输入顺序，确定性）。 */
  eligibleExperimentIds: string[];
  /** 全部候选的逐项判定（含淘汰原因，用于追溯）。 */
  entries: TrainEligibilityEntry[];
}

/** 从候选 metrics 解析选择指标的有限数值；null / NaN / Infinity → null（视为 invalid）。 */
function resolveMetricValue(metrics: PerformanceMetrics | undefined, metric: SelectionMetric): number | null {
  const raw = metrics?.[metric];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Train eligibility 筛选（纯函数、确定性）。
 *
 * 规则（最小语义，§六/§七）：
 *   - eligible：Train 评估 `succeeded` 且 `selectionMetric` 为有限数字；
 *   - ineligible：Train 失败，或 `selectionMetric` 为 null / NaN / Infinity。
 *
 * 淘汰原因写进 entries.reason（§二十四：Train 出错 → 明确 invalid/failed，不吞成 metric=0）。
 * eligibleExperimentIds 保持输入顺序，不依赖 Map 插入序 / 数据库返回序（§二十六）。
 */
export function filterEligibleTrainCandidates(
  results: readonly TrainCandidateResult[],
  selectionMetric: SelectionMetric,
): TrainEligibility {
  if (!isSelectableMetric(selectionMetric)) {
    throw new ResearchValidationError([
      { code: "TRAIN_SELECTION_METRIC_INVALID", path: "selectionMetric", message: `非法选择指标：${String(selectionMetric)}` },
    ]);
  }
  if (!Array.isArray(results)) {
    throw new ResearchValidationError([
      { code: "TRAIN_RESULTS_INVALID", path: "results", message: "Train 结果必须是数组" },
    ]);
  }

  const eligibleExperimentIds: string[] = [];
  const entries: TrainEligibilityEntry[] = [];

  for (const result of results) {
    if (result.status === "succeeded" && resolveMetricValue(result.metrics, selectionMetric) !== null) {
      eligibleExperimentIds.push(result.experimentId);
      entries.push({ experimentId: result.experimentId, eligible: true, reason: "train metric valid" });
    } else if (result.status === "failed") {
      entries.push({
        experimentId: result.experimentId,
        eligible: false,
        reason: result.error ? `train failed: ${result.error}` : "train failed",
      });
    } else {
      entries.push({
        experimentId: result.experimentId,
        eligible: false,
        reason: `train metric ${selectionMetric} invalid (null/NaN/Infinity)`,
      });
    }
  }

  return { eligibleExperimentIds, entries };
}
