/**
 * STEP 23 / C-23.1 — 模拟账户：PaperAccountRun 记录装配 + PnL 分解 + C-16.3 适配。
 *
 * 职责：
 *   - computePaperPnlBreakdown：从成交流 + 期末持仓推导 PnL 分解（确定性）；
 *   - assemblePaperAccountRun：装配不可变、带双声明指纹 + C-14.3 能力矩阵快照的
 *     paper run 总记录（订单流/成交流/持仓快照/现金账本/权益曲线/PnL 分解）；
 *   - toTradeQualityEvaluationInput：把 run 映射为 C-16.3 TradeQualityEvaluationInput
 *     （纯映射，不重算指标；trades 省略，因账户层不维护 STEP 8 Trade 生命周期，属 C-23.2）。
 *
 * PnL 恒等式（绝对值口径，自洽）：
 *   net = realizedPnL + unrealizedPnL = grossPnl − totalCostDrag；
 *   即 grossPnl = realizedPnL + unrealizedPnL + totalCostDrag，
 *   其中 totalCostDrag = Σ fill.cost.totalCostDrag（恒非负）。
 *
 * 铁律：纯函数、readonly 入参、无 IO/Date.now/Math.random；指纹由 serialize.ts 提供。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import type { EquityPoint } from "../../backtest/types";
import type { CostModelDeclaration } from "../costModel/types";
import {
  computeExecutionConstraintDeclarationFingerprint,
} from "../executionConstraints/serialize";
import { describeExecutionConstraintCoverage } from "../executionConstraints/map";
import type { ExecutionConstraintDeclaration } from "../executionConstraints/types";
import type { TradeQualityEvaluationInput } from "../tradeQualityMetrics/types";
import type {
  PaperAccountFill,
  PaperAccountOrder,
  PaperAccountPosition,
  PaperAccountPositionSnapshot,
  PaperAccountRun,
  PaperCashLedgerEntry,
  PaperPnlBreakdown,
} from "./types";
import {
  PAPER_ACCOUNT_RUN_KIND,
  PAPER_ACCOUNT_RUN_RECORD_VERSION,
} from "./types";
import { computePaperAccountRunFingerprint } from "./serialize";

/** 成本声明指纹（canonical JSON + sha256；对齐 C-14.3 声明指纹范式）。 */
export function computePaperCostDeclarationFingerprint(
  declaration: CostModelDeclaration
): string {
  return createHash("sha256")
    .update(canonicalStringify(declaration), "utf8")
    .digest("hex");
}

// ---------------------------------------------------------------------------
// PnL 分解
// ---------------------------------------------------------------------------

/**
 * 从成交流 + 期末持仓 + 累计已实现盈亏推导 PnL 分解。
 * slippage/marketImpact 保留有符号口径（对齐 C-14.2 FillCostBreakdown）；
 * totalCostDrag 恒非负（= Σ fill.cost.totalCostDrag）；
 * grossPnl 用绝对值口径满足恒等式（见文件头）。
 */
export function computePaperPnlBreakdown(
  fills: readonly PaperAccountFill[],
  positions: readonly PaperAccountPosition[],
  realizedPnL: number
): PaperPnlBreakdown {
  let totalFees = 0;
  let slippage = 0;
  let marketImpact = 0;
  let totalCostDrag = 0;
  for (const fill of fills) {
    totalFees += fill.cost.cashFees;
    slippage += fill.cost.slippage;
    marketImpact += fill.cost.marketImpact;
    totalCostDrag += fill.cost.totalCostDrag;
  }
  const unrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
  const grossPnl = realizedPnL + unrealizedPnL + totalCostDrag;
  return {
    realizedPnL,
    unrealizedPnL,
    grossPnl,
    totalFees,
    slippage,
    marketImpact,
    totalCostDrag,
  };
}

// ---------------------------------------------------------------------------
// PaperAccountRun 装配
// ---------------------------------------------------------------------------

export interface PaperAccountRunInput {
  readonly runId: string;
  readonly createdAt: string;
  readonly initialCapital: number;
  /** 成本模型声明（C-14.2），用于声明指纹与约束检查。 */
  readonly costDeclaration: CostModelDeclaration;
  /** 执行约束声明（C-14.3），用于声明指纹 + 能力矩阵快照。 */
  readonly executionDeclaration: ExecutionConstraintDeclaration;
  /** 订单流（按 tradeDate/createdAt 升序）。 */
  readonly orders: readonly PaperAccountOrder[];
  /** 成交流（按 timestamp 升序）。 */
  readonly fills: readonly PaperAccountFill[];
  /** 持仓快照序列（按 asOf 升序）。 */
  readonly positionSnapshots: readonly PaperAccountPositionSnapshot[];
  /** 现金账本（按 asOf/entryId 升序）。 */
  readonly cashLedger: readonly PaperCashLedgerEntry[];
  /** 权益曲线（复用 STEP 8 EquityPoint）。 */
  readonly equityCurve: readonly EquityPoint[];
  /** 期末持仓（PnL 分解用）。 */
  readonly finalPositions: readonly PaperAccountPosition[];
  /** 累计已实现盈亏（来自账户状态机）。 */
  readonly realizedPnL: number;
  /** 数据集/策略引用（可选）。 */
  readonly datasetVersion?: string;
  readonly strategyId?: string;
  readonly strategyVersion?: string;
}

/**
 * 装配不可变的 PaperAccountRun 总记录（纯函数）。
 * 深冻结由 serialize 的 fingerprint 复核保证内容一致性；本函数直接返回冻结对象。
 */
export function assemblePaperAccountRun(
  input: PaperAccountRunInput
): PaperAccountRun {
  const costDeclarationFingerprint = computePaperCostDeclarationFingerprint(
    input.costDeclaration
  );
  const executionDeclarationFingerprint =
    computeExecutionConstraintDeclarationFingerprint(input.executionDeclaration);
  const executionCoverage = describeExecutionConstraintCoverage(
    input.executionDeclaration
  );
  const pnlBreakdown = computePaperPnlBreakdown(
    input.fills,
    input.finalPositions,
    input.realizedPnL
  );

  const body: Omit<PaperAccountRun, "fingerprint"> = {
    recordKind: PAPER_ACCOUNT_RUN_KIND,
    recordVersion: PAPER_ACCOUNT_RUN_RECORD_VERSION,
    runId: input.runId,
    createdAt: input.createdAt,
    ...(input.datasetVersion !== undefined ? { datasetVersion: input.datasetVersion } : {}),
    ...(input.strategyId !== undefined ? { strategyId: input.strategyId } : {}),
    ...(input.strategyVersion !== undefined ? { strategyVersion: input.strategyVersion } : {}),
    initialCapital: input.initialCapital,
    costDeclarationFingerprint,
    executionDeclarationFingerprint,
    executionCoverage,
    orders: input.orders,
    fills: input.fills,
    positionSnapshots: input.positionSnapshots,
    cashLedger: input.cashLedger,
    equityCurve: input.equityCurve,
    pnlBreakdown,
  };

  const fingerprint = computePaperAccountRunFingerprint(body);
  return deepFreeze<PaperAccountRun>({ ...body, fingerprint });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// C-16.3 适配（纯映射，不重算指标）
// ---------------------------------------------------------------------------

/**
 * 把 PaperAccountRun 映射为 C-16.3 TradeQualityEvaluationInput。
 * 纯映射（不重算任何指标）。trades 省略：账户层（C-23.1）不维护 STEP 8 Trade
 * 生命周期（建仓→清仓配对属 C-23.2 PnL 结算），故 C-16.3 交易质量指标将得到
 * tradeQuality=null（未提供交易），月度/年度一致性照常由 equityCurve 评估。
 */
export function toTradeQualityEvaluationInput(
  run: PaperAccountRun,
  annualizationFactor?: number
): TradeQualityEvaluationInput {
  return {
    equityCurve: run.equityCurve,
    ...(annualizationFactor !== undefined ? { annualizationFactor } : {}),
  };
}
