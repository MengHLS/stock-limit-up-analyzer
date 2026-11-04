/**
 * STEP 25 / C-25.1 — Closed Loop：阶段规格表 + 拓扑校验（纯函数、FAIL FAST）。
 *
 * 每个阶段一个 StageSpec（id/描述/输入契约 kind/输出契约 kind/gate 要求/依赖模块清单）。
 * 依赖规则：阶段链 = CLOSED_LOOP_STAGE_IDS 的 canonical 保序子集；逆序 / 跳段回跳 /
 * 重复 / 未知 / 空集一律响亮抛错（ClosedLoopError，CL_STAGES_* 稳定码）。
 */

import { ClosedLoopError, CLOSED_LOOP_ERROR_CODES } from "./errors";
import {
  CLOSED_LOOP_STAGE_CONSUMED_KIND,
  CLOSED_LOOP_STAGE_IDS,
  CLOSED_LOOP_STAGE_PRODUCED_KIND,
  closedLoopStageIndex,
  isClosedLoopStageId,
  type ClosedLoopHandoffKind,
  type ClosedLoopStageId,
  type ClosedLoopStageSelection,
} from "./types";

/** 单阶段规格（契约声明；编排器按此做输入/输出契约校验）。 */
export interface ClosedLoopStageSpec {
  readonly stageId: ClosedLoopStageId;
  /** canonical 序号（0-based）。 */
  readonly index: number;
  /** 人类可读名称。 */
  readonly name: string;
  /** 职责描述。 */
  readonly description: string;
  /** 输入交接 kind（canonical 前驱产出；data = null）。 */
  readonly consumesKind: ClosedLoopHandoffKind | null;
  /** 输出交接 kind。 */
  readonly producesKind: ClosedLoopHandoffKind;
  /** 消费 datasetSummary 的阶段要求 gate === PASS（当前仅 research 直接消费数据交接）。 */
  readonly requiresDatasetGatePass: boolean;
  /** 对接的研究模块清单（人类可读；真实接线在 VALIDATED 阶段）。 */
  readonly moduleBindings: readonly string[];
  /** 该阶段是否允许无 runner 合法推进（data 阶段 runner 缺失 = CL_DATA_NOT_INJECTED）。 */
  readonly runnerMissingReasonCode: ClosedLoopRunnerMissingReason;
}

/** 缺 runner 时的 reasonCode 选择（data 特判，其余统一 CL_RUNNER_NOT_INJECTED）。 */
export type ClosedLoopRunnerMissingReason = "CL_RUNNER_NOT_INJECTED" | "CL_DATA_NOT_INJECTED";

function spec(
  stageId: ClosedLoopStageId,
  name: string,
  description: string,
  moduleBindings: readonly string[],
  runnerMissingReasonCode: ClosedLoopRunnerMissingReason,
): ClosedLoopStageSpec {
  const index = closedLoopStageIndex(stageId);
  return {
    stageId,
    index,
    name,
    description,
    consumesKind: CLOSED_LOOP_STAGE_CONSUMED_KIND[stageId],
    producesKind: CLOSED_LOOP_STAGE_PRODUCED_KIND[stageId],
    requiresDatasetGatePass: CLOSED_LOOP_STAGE_CONSUMED_KIND[stageId] === "datasetSummary",
    moduleBindings,
    runnerMissingReasonCode,
  };
}

/** §27 全链阶段规格表（canonical 顺序；编排器的唯一权威）。 */
export const CLOSED_LOOP_STAGE_SPECS: readonly ClosedLoopStageSpec[] = [
  spec(
    "data",
    "Data",
    "真实历史数据 → Research Dataset（§12 域；gate PASS 判定；真实接线 = C-12.6 builder + datasetAccess）",
    ["researchDataset", "datasetAccess"],
    "CL_DATA_NOT_INJECTED",
  ),
  spec(
    "research",
    "Research",
    "Research 引擎：数据集逐日驱动 STEP 10 pipeline → Candidate 评估（真实接线 = C-13.2 signalEngine）",
    ["datasetAccess", "signalEngine"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "strategy",
    "Strategy",
    "主观模式 → 程序化规则（StrategyDocument 规则壳；真实接线 = C-15.1 strategySchema）",
    ["strategySchema"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "backtest",
    "Backtest",
    "候选 → 多日交易模拟（T+1/PIT；真实接线 = C-14.1 simulator，消费 C-14.2/14.3）",
    ["simulator", "costModel", "executionConstraints"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "evaluation",
    "Evaluation",
    "回测产出 → 收益/风险/交易质量指标（真实接线 = C-16.1/16.2/16.3）",
    ["performanceMetrics", "riskAdjustedMetrics", "tradeQualityMetrics"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "optimization",
    "Optimization",
    "参数搜索 / 滚动优化（稳定参数区，显式非 argmax；真实接线 = C-17.1/17.2）",
    ["parameterSearch", "rollingOptimization"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "robustness",
    "Robustness",
    "四轴扰动重估 + 随机化稳健性（真实接线 = C-18.1 robustness + C-18.2 stochasticRobustness）",
    ["robustness", "stochasticRobustness"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "oos",
    "OOS",
    "Walk-Forward / OOS 隔离记录与归档（IS/OOS 严禁串扰；真实接线 = C-19.1/19.2）",
    ["walkForwardRun", "oosIsolation"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "overfitting",
    "Overfitting",
    "PBO / 参数敏感性 / 因子消融 / OOS 退化（真实接线 = C-20.1 overfittingDetection + C-20.2 factorAblation）",
    ["overfittingDetection", "factorAblation"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "regime",
    "Regime",
    "七维市场状态标签 + 归因（真实接线 = C-22.1 marketRegime）",
    ["marketRegime"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "paper",
    "Paper Trading",
    "信号 → 订单 → 成交 → PnL 模拟盘（真实接线 = C-23.2 signalToPnl + C-23.1 paperAccount）",
    ["signalToPnl", "paperAccount"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "review",
    "Review",
    "交易复盘：plan vs actual 核对 + 日志账本（真实接线 = C-24.1 tradeJournal）",
    ["tradeJournal"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "discipline",
    "Discipline",
    "纪律反馈：违规统计/重复错误/最差执行/易错环境（真实接线 = C-24.2 disciplineFeedback）",
    ["disciplineFeedback"],
    "CL_RUNNER_NOT_INJECTED",
  ),
  spec(
    "finalize",
    "Finalize",
    "生命周期整合 + 全链摘要（复用 C-21.1 applyLifecycleTransition；evidence 门槛 gate）",
    ["lifecycle"],
    "CL_RUNNER_NOT_INJECTED",
  ),
];

/** stageId → spec 索引（非法值抛错，防静默）。 */
export function closedLoopStageSpec(stageId: ClosedLoopStageId): ClosedLoopStageSpec {
  const found = CLOSED_LOOP_STAGE_SPECS.find((s) => s.stageId === stageId);
  if (found === undefined) {
    throw new ClosedLoopError(
      CLOSED_LOOP_ERROR_CODES.CL_STAGES_UNKNOWN,
      `closedLoop: 未知阶段 ${String(stageId)}`,
    );
  }
  return found;
}

/** stageId → spec 表（供查表；与 CLOSED_LOOP_STAGE_SPECS 同一底层数组）。 */
export function buildClosedLoopStageSpecMap(): Readonly<Record<ClosedLoopStageId, ClosedLoopStageSpec>> {
  const map = {} as Record<ClosedLoopStageId, ClosedLoopStageSpec>;
  for (const s of CLOSED_LOOP_STAGE_SPECS) {
    map[s.stageId] = s;
  }
  return map;
}

/** canonical 相邻前驱（data 前驱 = null）。 */
export function closedLoopPredecessorOf(stageId: ClosedLoopStageId): ClosedLoopStageId | null {
  const index = closedLoopStageIndex(stageId);
  return index <= 0 ? null : CLOSED_LOOP_STAGE_IDS[index - 1]!;
}

/**
 * 解析阶段选择：
 *   - undefined → canonical 全链（14 阶段）；
 *   - 空数组 / 含重复 / 含未知 / 逆序（非 canonical 保序子集）→ 响亮抛错。
 * 返回去重保序数组（规范副本）。
 */
export function resolveClosedLoopStageSelection(
  stageIds: ClosedLoopStageSelection | undefined,
): readonly ClosedLoopStageId[] {
  if (stageIds === undefined || stageIds === null) {
    return [...CLOSED_LOOP_STAGE_IDS];
  }
  if (!Array.isArray(stageIds) || stageIds.length === 0) {
    throw new ClosedLoopError(
      CLOSED_LOOP_ERROR_CODES.CL_STAGES_EMPTY,
      "closedLoop: 空阶段集非法（无法编排）；需至少一个合法阶段或省略以使用 canonical 全链",
    );
  }
  const seen = new Set<string>();
  let lastIndex = -1;
  for (const id of stageIds) {
    if (!isClosedLoopStageId(id)) {
      throw new ClosedLoopError(
        CLOSED_LOOP_ERROR_CODES.CL_STAGES_UNKNOWN,
        `closedLoop: 阶段选择含未知阶段 ${JSON.stringify(id)}；合法阶段 = ${CLOSED_LOOP_STAGE_IDS.join(" / ")}`,
      );
    }
    if (seen.has(id)) {
      throw new ClosedLoopError(
        CLOSED_LOOP_ERROR_CODES.CL_STAGES_DUPLICATE,
        `closedLoop: 阶段选择含重复阶段 ${id}（每一阶段至多出现一次）`,
      );
    }
    seen.add(id);
    const index = closedLoopStageIndex(id);
    if (index <= lastIndex) {
      throw new ClosedLoopError(
        CLOSED_LOOP_ERROR_CODES.CL_STAGES_ORDER_VIOLATION,
        `closedLoop: 阶段选择违反 canonical 拓扑顺序（§27 全链顺序非法）；"${id}" 相对前一阶段逆序或回跳`,
      );
    }
    lastIndex = index;
  }
  return [...stageIds];
}

/** 断言选择的阶段集非空且保序（供编排器复用；抛 ClosedLoopError）。 */
export function assertClosedLoopStageSelectionValid(stageIds: readonly ClosedLoopStageId[]): void {
  resolveClosedLoopStageSelection(stageIds);
}
