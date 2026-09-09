/**
 * STEP 14 / C-14.3 — 执行与约束模型：与 C-14.1 simulator 的装配映射层。
 *
 * 目标：把声明（ExecutionConstraintDeclaration）翻译为 C-14.1 直接消费的
 * SimulationConfig（import 只读复用 simulator，不自造执行内核），并给出
 * 「逐约束轴可执行性」的能力矩阵与显式 blocker。
 *
 * 可执行性子集（映射进 simConfig 的字段，全部经 C-14.1 validateSimulationConfig
 * 复核后放行）：
 *   - capital.initialCapital              → simConfig.initialCapital
 *   - positions.maxPositionCount          → simConfig.maxPositions（plan 层拦截超限候选）
 *   - lot.lotSize                         → cost.lotSize（写回外部 CostModel 的手数字段；
 *                                           成本其余五字段属 C-14.2 边界，经外部入参注入）
 *   - restrictions.blockLimitUpBuy/…Sell  → simConfig.executionRules.*（STEP 8 开盘涨跌停拦截）
 *   - timing.executionModel               → simConfig.executionModel（NEXT_OPEN/NEXT_CLOSE/VWAP_PROXY）
 *   - timing.allowPartialFill             → simConfig.allowPartialFill
 *   - marketClaims.directionPolicy        → simConfig.directionPolicy（longOnly）
 *   - marketClaims.boards                 → simConfig.securityBoards（涨跌停幅度解析）
 *   - marketClaims.tPlus1/decisionPoint/suspensionMode/corporateActions
 *                                          → 引擎硬编码语义；映射层复核声明字面量一致即放行
 *
 * 声明但 C-14.1 链不可执行（**映射 blocker，绝不静默丢弃**，研究要跑必须先把这些
 * 轴设为 null/空，或在未来引擎补上对应闸门）：
 *   - perSecurityEquityCap：simulator plan 按「当日候选权重 × 可用现金」分预算，
 *     无逐仓市值/权益上限闸门；
 *   - totalEquityCap：同上，无总仓位市值闸门；
 *   - buyBanned/sellBanned：候选意图一旦入选即进计划层，无标的级过滤点
 *     （规则式拦截已由 blockLimitUpBuy/blockLimitDownSell 覆盖）；
 *   - timing.executionModel = LIMIT_PRICE：C-14.1 plan/engine 只发市价单
 *     （orderType=market、requestedPrice=null），LIMIT_PRICE 在无委托价时回退
 *     NEXT_OPEN 语义 → 声明真限价即伪造，故拦截（未来订单约束层提供每单委托价后解除）。
 *
 * 铁律：纯函数、确定性、无 IO；入参声明先 assert 校验（声明非法即抛，属编程错误）；
 * 产出 simConfig 再经 simulator validateSimulationConfig 复核（成本接缝处的非法值
 * 也会被兜住），双重保证「映射出来的一定是 C-14.1 敢收的配置」。
 */

import type { CostModel } from "../../engine/domain";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import { validateSimulationConfig } from "../simulator/validate";
import type { SimulationConfig } from "../simulator/types";
import { assertValidExecutionConstraintDeclaration } from "./validate";
import type { ExecutionConstraintDeclaration } from "./types";

// ---------------------------------------------------------------------------
// 约束轴能力矩阵（可执行性声明）
// ---------------------------------------------------------------------------

/** 约束轴在 C-14.1 链的落地状态。 */
export type ConstraintEnforcementState = "ENFORCED" | "NOT_DECLARED" | "DECLARED_ONLY";

/** 单个约束轴的覆盖条目（供能力矩阵/审计/报告）。 */
export interface ConstraintCoverageItem {
  /** 稳定轴标识（供程序化引用）。 */
  readonly key: string;
  /** 中文标签。 */
  readonly label: string;
  /** C-14.1 链落地状态：ENFORCED=已执行；DECLARED_ONLY=声明但链不可执行；NOT_DECLARED=未设约束。 */
  readonly enforcement: ConstraintEnforcementState;
  /** 执行点 / 为何不可执行（人类可读）。 */
  readonly detail: string;
}

function axis(
  key: string,
  label: string,
  enforcement: ConstraintEnforcementState,
  detail: string
): ConstraintCoverageItem {
  return { key, label, enforcement, detail };
}

/** 描述一份声明在 C-14.1 链的逐轴可执行性（纯函数；不修改入参）。 */
export function describeExecutionConstraintCoverage(
  declaration: ExecutionConstraintDeclaration
): readonly ConstraintCoverageItem[] {
  const p = declaration.positions;
  const r = declaration.restrictions;
  const t = declaration.timing;
  const claims = declaration.marketClaims;
  const boardCount = Object.keys(claims.boards).length;
  return [
    axis(
      "capital.initialCapital",
      "初始资金",
      "ENFORCED",
      "simConfig.initialCapital（Portfolio 起始现金）"
    ),
    axis(
      "positions.maxPositionCount",
      "并发持仓数上限",
      "ENFORCED",
      "simConfig.maxPositions（plan 层按空位拦截超限候选，MAX_POSITIONS_REACHED）"
    ),
    axis(
      "positions.perSecurityEquityCap",
      "单标的权益占比上限",
      p.perSecurityEquityCap === null ? "NOT_DECLARED" : "DECLARED_ONLY",
      "C-14.1 plan 按权重×现金分预算、无逐仓市值/权益闸门，声明后无法执行"
    ),
    axis(
      "positions.totalEquityCap",
      "总持仓权益占比上限",
      p.totalEquityCap === null ? "NOT_DECLARED" : "DECLARED_ONLY",
      "C-14.1 无总仓位市值闸门，声明后无法执行"
    ),
    axis(
      "lot.lotSize",
      "一手股数",
      "ENFORCED",
      "映射写回 simConfig.cost.lotSize（plan 估量与 Portfolio 整手约束同源）"
    ),
    axis(
      "restrictions.blockLimitUpBuy",
      "开盘涨停禁买",
      "ENFORCED",
      "simConfig.executionRules.blockLimitUpBuy（STEP 8 报价层 LIMIT_UP 拒绝）"
    ),
    axis(
      "restrictions.blockLimitDownSell",
      "开盘跌停禁卖",
      "ENFORCED",
      "simConfig.executionRules.blockLimitDownSell（STEP 8 报价层 LIMIT_DOWN 拒绝）"
    ),
    axis(
      "restrictions.buyBanned",
      "禁买标的集",
      r.buyBanned.length === 0 ? "NOT_DECLARED" : "DECLARED_ONLY",
      "C-14.1 无标的级候选过滤点，非空声明无法执行"
    ),
    axis(
      "restrictions.sellBanned",
      "禁卖标的集",
      r.sellBanned.length === 0 ? "NOT_DECLARED" : "DECLARED_ONLY",
      "C-14.1 无标的级退出过滤点，非空声明无法执行"
    ),
    axis(
      "timing.executionModel",
      "成交时机",
      t.executionModel === "LIMIT_PRICE" ? "DECLARED_ONLY" : "ENFORCED",
      t.executionModel === "LIMIT_PRICE"
        ? "C-14.1 只发市价单（无每单委托价），LIMIT_PRICE 回退 NEXT_OPEN 语义，无法执行"
        : "simConfig.executionModel（NEXT_OPEN/NEXT_CLOSE/VWAP_PROXY 由 STEP 8 工厂构造）"
    ),
    axis(
      "timing.allowPartialFill",
      "允许部分成交",
      "ENFORCED",
      "simConfig.allowPartialFill（Portfolio 部分成交裁决）"
    ),
    axis(
      "marketClaims.directionPolicy",
      "方向策略",
      "ENFORCED",
      "simConfig.directionPolicy=longOnly（引擎硬编码一致）"
    ),
    axis(
      "marketClaims.boards",
      "板块覆盖（涨跌停幅度）",
      "ENFORCED",
      boardCount === 0
        ? "simConfig.securityBoards 缺省按 main ±10% 处理（声明=空覆盖，一致）"
        : "simConfig.securityBoards（按 securityId 解析 ±10/20/30%）"
    ),
    axis(
      "marketClaims.tPlus1",
      "T+1 交易制度",
      "ENFORCED",
      "引擎固定采用 DEFAULT_MARKET_RULES.tPlus1=true，声明字面量一致即放行"
    ),
    axis(
      "marketClaims.decisionPoint",
      "决策时点",
      "ENFORCED",
      "引擎要求来源候选 point=close（决策日收盘 → 次一交易日执行）"
    ),
    axis(
      "marketClaims.suspensionMode",
      "停牌口径",
      "ENFORCED",
      "执行日无行情行 → SUSPENDED 整单拒绝（engine 显式路径）"
    ),
    axis(
      "marketClaims.corporateActions",
      "公司行为口径",
      "ENFORCED",
      "研究链不应用公司行为（NOT_APPLIED，与引擎快照一致）"
    ),
  ];
}

// ---------------------------------------------------------------------------
// 映射结果
// ---------------------------------------------------------------------------

export interface ExecutionConstraintMappingResult {
  /** 无 blocker 且 simConfig 通过 C-14.1 校验时为 true。 */
  readonly ok: boolean;
  /** ok=true 时非空：可直接交给 runTradeSimulation 的 SimulationConfig。 */
  readonly simConfig?: SimulationConfig;
  /** blocker / 复核 issue（ok=false 时非空）。 */
  readonly issues: readonly ResearchValidationIssue[];
  /** 信息性说明（如声明手数与外部 CostModel 手数不一致时的写回）。 */
  readonly notes: readonly string[];
  /** 逐约束轴能力矩阵。 */
  readonly coverage: readonly ConstraintCoverageItem[];
}

function blocker(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

export interface ExecutionConstraintMappingOptions {
  /** 透传给 simConfig.dateRange（可选；缺省由 runTradeSimulation 取来源候选窗口）。 */
  readonly dateRange?: { readonly startDate: string; readonly endDate: string };
}

/**
 * 把声明映射为 C-14.1 SimulationConfig。
 *
 * @param declaration 执行与约束声明（先 assert 校验，非法即抛）
 * @param costModel   外部 CostModel 六字段（C-14.2 边界注入；lotSize 由本层声明覆盖写回）
 * @param options     可选 dateRange 透传
 * @returns ok=false + issues 表示存在不可执行声明（blocker）；ok=true 时 simConfig 可直用
 */
export function mapExecutionConstraintDeclaration(
  declaration: ExecutionConstraintDeclaration,
  costModel: CostModel,
  options: ExecutionConstraintMappingOptions = {}
): ExecutionConstraintMappingResult {
  // 声明非法属编程错误 → 抛（与 validate.assert* 体系一致）。
  assertValidExecutionConstraintDeclaration(declaration);

  const issues: ResearchValidationIssue[] = [];
  const notes: string[] = [];

  // 1. 不可执行轴的 blocker（绝不静默丢弃）。
  const p = declaration.positions;
  const r = declaration.restrictions;
  if (p.perSecurityEquityCap !== null) {
    issues.push(
      blocker(
        "EXMAP_UNENFORCEABLE_PER_SECURITY_EQUITY_CAP",
        "declaration.positions.perSecurityEquityCap",
        "单标的仓位占比上限在 C-14.1 链无法执行（plan 按权重×现金分预算、无逐仓市值闸门），" +
          "如需真实施行须等引擎补闸门；请先置 null 或改用 maxPositionCount"
      )
    );
  }
  if (p.totalEquityCap !== null) {
    issues.push(
      blocker(
        "EXMAP_UNENFORCEABLE_TOTAL_EQUITY_CAP",
        "declaration.positions.totalEquityCap",
        "总仓位占比上限在 C-14.1 链无法执行（无总仓位市值闸门），请先置 null"
      )
    );
  }
  if (r.buyBanned.length > 0) {
    issues.push(
      blocker(
        "EXMAP_UNENFORCEABLE_BUY_BANNED",
        "declaration.restrictions.buyBanned",
        "禁买标的集在 C-14.1 链无法执行（候选意图无标的级过滤点）；规则式拦截请用 blockLimitUpBuy"
      )
    );
  }
  if (r.sellBanned.length > 0) {
    issues.push(
      blocker(
        "EXMAP_UNENFORCEABLE_SELL_BANNED",
        "declaration.restrictions.sellBanned",
        "禁卖标的集在 C-14.1 链无法执行；规则式拦截请用 blockLimitDownSell"
      )
    );
  }
  if (declaration.timing.executionModel === "LIMIT_PRICE") {
    issues.push(
      blocker(
        "EXMAP_UNENFORCEABLE_EXECUTION_MODEL_LIMIT_PRICE",
        "declaration.timing.executionModel",
        "LIMIT_PRICE 在 C-14.1 链无法执行（plan/engine 只发市价单，无每单委托价，" +
          "限价引擎对市价单回退 NEXT_OPEN 语义，声明真限价即伪造）；请换 NEXT_OPEN/NEXT_CLOSE/VWAP_PROXY"
      )
    );
  }

  const coverage = describeExecutionConstraintCoverage(declaration);

  // 2. 手数写回（本层拥有 lot 轴；成本其余字段来自外部 CostModel）。
  const declaredLot = declaration.lot.lotSize;
  const cost: CostModel = { ...costModel, lotSize: declaredLot };
  if (costModel.lotSize !== declaredLot) {
    notes.push(
      `声明手数 lotSize=${declaredLot} 覆盖外部 CostModel.lotSize=${costModel.lotSize}（映射写回 cost.lotSize）`
    );
  }

  // 3. 装配 simConfig。
  const boards = declaration.marketClaims.boards;
  const simConfig: SimulationConfig = {
    ...(declaration.label !== undefined
      ? { name: declaration.label }
      : {}),
    ...(options.dateRange !== undefined ? { dateRange: options.dateRange } : {}),
    initialCapital: declaration.capital.initialCapital,
    cost,
    executionModel: declaration.timing.executionModel,
    maxPositions: declaration.positions.maxPositionCount,
    directionPolicy: declaration.marketClaims.directionPolicy,
    executionRules: {
      blockLimitUpBuy: declaration.restrictions.blockLimitUpBuy,
      blockLimitDownSell: declaration.restrictions.blockLimitDownSell,
    },
    allowPartialFill: declaration.timing.allowPartialFill,
    ...(Object.keys(boards).length > 0 ? { securityBoards: { ...boards } } : {}),
  };

  // 4. C-14.1 侧复核（兜住成本接缝/形状问题；非法 cost 也在此暴露，不静默）。
  const simValidation = validateSimulationConfig(simConfig);
  if (!simValidation.valid) {
    issues.push(...simValidation.issues);
  }

  if (issues.length > 0) {
    return { ok: false, issues, notes, coverage };
  }
  return { ok: true, simConfig, issues: [], notes, coverage };
}

/** 映射成功返回 simConfig；存在 blocker/复核失败即抛 ResearchValidationError。 */
export function assertMapExecutionConstraintDeclaration(
  declaration: ExecutionConstraintDeclaration,
  costModel: CostModel,
  options?: ExecutionConstraintMappingOptions
): SimulationConfig {
  const mapping = mapExecutionConstraintDeclaration(declaration, costModel, options);
  if (!mapping.ok || mapping.simConfig === undefined) {
    throw new ResearchValidationError(mapping.issues as ResearchValidationIssue[]);
  }
  return mapping.simConfig;
}
