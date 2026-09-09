/**
 * STEP 14 / C-14.1 — 交易模拟核心：类型契约（不可变、可序列化、可审计）。
 *
 * 背景：C-13.2（signalEngine）产出 CandidateEvaluationRun —— 逐决策日 PositionIntent /
 * SelectedCandidate 聚合，**不含成交/持仓/权益**（Evaluation 语义界定为候选层确定性统计）。
 * C-16.1（收益/风险/回撤指标）将消费本目录产出的 EquityPoint / Trade 风格记录流。
 * 本目录（simulator）是「候选 → 交易模拟」的多日编排薄层：
 *
 *   候选意图（PositionIntent，决策日收盘后已知）
 *     → 次日（T+1）执行模型报价（默认 NEXT_OPEN，读 T+1 开盘价）
 *     → Portfolio（T+1 冻结/可卖、整手、现金、持仓上限，复用 STEP 8 原子能力）
 *     → Trade[] / EquityPoint[] / AuditTrail 风格可审计结果记录
 *
 * 边界铁律：
 *   - 复用 STEP 8 backtest 的类型与纯函数（portfolio / position / execution / cost /
 *     marketRules / audit），**只读不修改**；不实现新成本/滑点模型（C-14.2 专项）、
 *     不实现执行/约束模型本体（C-14.3 专项）、不实现收益指标（C-16.1 专属）、
 *     不实现 regime（C-22.1）。本目录只做编排 + 记录。
 *   - 确定性：无 Date.now / Math.random / IO；排序稳定；结果记录 sha256 指纹防篡改
 *     （风格对齐 signalEngine / experimentLineage）。
 *   - FAIL FAST：缺 (tradeDate, securityId) 行、datasetVersion 不一致、来源记录指纹
 *     不匹配、窗口为空等一律结构化抛错，绝不静默回填/跳过。
 *   - 结果记录不可变、可 JSON 序列化、带追溯字段（datasetVersion / dateRange /
 *     策略身份 / 执行假设摘要）。
 */

import type { CostModel } from "../../engine/domain";
import type {
  AuditTrail,
  CostSummary,
  EquityPoint,
  ExecutionModelId,
  ExecutionStats,
  Position,
  Side,
  Trade,
} from "../../backtest/types";
import type { ResearchDataset } from "../../researchDataset/types";
import type { ResearchParameterSet } from "../types";
import type { CandidateEvaluationRun } from "../signalEngine/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化/反序列化判别，防止类型混淆）。 */
export const TRADE_SIMULATION_RUN_RECORD_KIND = "TRADE_SIMULATION_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const TRADE_SIMULATION_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 板块（涨跌停幅度解析用；数据行不含 board，允许调用方显式覆盖）
// ---------------------------------------------------------------------------

/** 证券板块枚举（对齐 backtest Security.board）。 */
export type SecurityBoard = "main" | "gem" | "star" | "bse";

// ---------------------------------------------------------------------------
// 方向策略与执行假设
// ---------------------------------------------------------------------------

/** 方向策略：当前仅支持 longOnly（A 股无做空；short/neutral 候选不可交易）。 */
export type DirectionPolicy = "longOnly";

/**
 * 意图未转成订单的稳定原因码（供程序化处理，非自由文本）。
 * 每种码配一条中文 explanation，写入记录，绝不静默丢弃意图。
 */
export type PlanSkipCode =
  /** 决策日是模拟窗口最后交易日，无下一交易日可执行（卖出/买入均顺延失败）。 */
  | "NO_NEXT_TRADING_DAY"
  /** 并发持仓已达上限（maxPositions），新候选无空位。 */
  | "MAX_POSITIONS_REACHED"
  /** T+1：可卖份额为 0（当日/此前买入仍冻结），卖出顺延至后续决策日再评估。 */
  | "FROZEN_EXIT_DEFERRED"
  /** 现金预算不足一手（含费用估算后不足 lotSize）。 */
  | "BUDGET_BELOW_MIN_LOT"
  /** 方向策略为 longOnly，short/neutral 候选不可交易（不建仓）。 */
  | "NON_LONG_DIRECTION";

/** 被计划层跳过（未下单）的意图条目。 */
export interface SkippedIntentEntry {
  /** 决策日（YYYY-MM-DD）。 */
  readonly date: string;
  readonly securityId: string;
  /** 本意图本应触发的方向（buy/sell）。 */
  readonly side: Side;
  readonly code: PlanSkipCode;
  /** 中文解释（审计用途，不参与计算）。 */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// 模拟输入配置
// ---------------------------------------------------------------------------

/**
 * 交易模拟执行配置（C-14.1 输入）。
 *
 * 执行假设全部显式化、进入结果快照，保证可复现：
 *   - 决策在候选日收盘后（sourceRun.point 必须为 close）；
 *   - 订单最早可执行时点 = 下一交易日（T+1），成交价由所选执行模型决定
 *     （默认 NEXT_OPEN 读下一交易日开盘价，**不是信号日收盘价**）；
 *   - 涨跌停/停牌由 STEP 8 ExecutionModel + 本配置 executionRules 裁决。
 */
export interface SimulationConfig {
  /** 可选标识/备注（仅审计用途，不参与计算）。 */
  readonly name?: string;
  /**
   * 模拟交易日窗口（闭区间，YYYY-MM-DD）；缺省 = 来源候选记录的 dateRange。
   * 允许在来源记录结束后最多延伸到数据集窗口内，以容纳「最后决策日订单在次日成交」。
   */
  readonly dateRange?: { readonly startDate: string; readonly endDate: string };
  /** 初始资金（元，>0）。 */
  readonly initialCapital: number;
  /** 成本模型（复用 engine/domain CostModel 六字段；含 lotSize 一手股数）。 */
  readonly cost: CostModel;
  /** 执行模型（缺省 NEXT_OPEN）。 */
  readonly executionModel?: ExecutionModelId;
  /** 并发持仓上限；null/缺省 = 不限。 */
  readonly maxPositions?: number | null;
  /** 方向策略（缺省 longOnly）。 */
  readonly directionPolicy?: DirectionPolicy;
  /** 涨跌停拦截开关（缺省 false，对齐 STEP 8 DEFAULT_EXECUTION_RULES）。 */
  readonly executionRules?: {
    /** 开盘触及涨停时拒绝买入。 */
    readonly blockLimitUpBuy?: boolean;
    /** 开盘触及跌停时拒绝卖出。 */
    readonly blockLimitDownSell?: boolean;
  };
  /** 是否允许部分成交（缺省 false：全额成交或整单拒绝）。 */
  readonly allowPartialFill?: boolean;
  /**
   * 板块覆盖（securityId → board），用于涨跌停幅度解析；
   * 缺省按 main ±10% 处理（与 dataset 行不含 board 的口径一致）。
   */
  readonly securityBoards?: Readonly<Record<string, SecurityBoard>>;
}

/** 执行配置快照（冻结，进入结果记录；剔除函数，全部可序列化）。 */
export interface SimulationConfigSnapshot {
  /** 可选标识/备注。 */
  readonly name?: string;
  /** 实际模拟窗口（闭区间）。 */
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly initialCapital: number;
  /** 成本模型六字段。 */
  readonly cost: CostModel;
  readonly executionModel: ExecutionModelId;
  /** null = 不限并发持仓。 */
  readonly maxPositions: number | null;
  readonly directionPolicy: DirectionPolicy;
  readonly executionRules: {
    readonly blockLimitUpBuy: boolean;
    readonly blockLimitDownSell: boolean;
  };
  readonly allowPartialFill: boolean;
  /** 是否启用 T+1（STEP 8 默认 true）。 */
  readonly tPlus1: boolean;
  /** 一手股数（= cost.lotSize，STEP 8 成交约束使用）。 */
  readonly lotSize: number;
  /** 决策时点（模拟固定为 close：决策日收盘后可见当日整根 bar）。 */
  readonly decisionPoint: "close";
  /** 进出场模型摘要（本版本实现语义，声明性常量）。 */
  readonly entryExitModel: "HOLD_WHILE_SELECTED_LONG_ONLY_CASH_BUDGET";
  /** 公司行为口径：研究链暂不应用（价格收益含除权跳空）。 */
  readonly corporateActions: "NOT_APPLIED";
}

// ---------------------------------------------------------------------------
// 多日交易模拟结果总记录
// ---------------------------------------------------------------------------

/**
 * 一次「候选 → 交易模拟」的不可变总记录（C-16.1 的消费入口）。
 *
 * 可审计追溯：datasetVersion / builderVersion / rowSchemaVersion / universeId /
 * strategyId@strategyVersion / parameters / 来源候选记录指纹（sourceFingerprint）/
 * 决策窗口 / 模拟窗口 / 执行假设快照（config），外加 fingerprint（内容指纹防篡改）。
 */
export interface TradeSimulationRun {
  readonly recordKind: typeof TRADE_SIMULATION_RUN_RECORD_KIND;
  readonly recordVersion: typeof TRADE_SIMULATION_RUN_RECORD_VERSION;

  // -- 数据集追溯 --
  readonly datasetVersion: string;
  readonly builderVersion: string;
  readonly rowSchemaVersion: string;
  readonly datasetGate: string;
  readonly universeId: string;

  // -- 策略追溯 --
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 实验参数集（冻结副本；= 来源候选记录参数）。 */
  readonly parameters: Readonly<ResearchParameterSet>;

  // -- 来源候选记录绑定 --
  /** 来源 CandidateEvaluationRun 的内容指纹（sha256）。 */
  readonly sourceFingerprint: string;
  /** 来源候选记录决策窗口（闭区间）。 */
  readonly decisionDateRange: {
    readonly startDate: string;
    readonly endDate: string;
  };
  /** 落在模拟窗口内、实际参与决策的候选决策日数。 */
  readonly decisionDayCount: number;

  // -- 模拟窗口与结果 --
  /** 实际模拟交易日窗口（闭区间，含纯成交/估值日）。 */
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly initialCapital: number;
  readonly finalEquity: number;
  /** 执行假设快照（冻结副本）。 */
  readonly config: SimulationConfigSnapshot;

  // -- 结果流（C-16.1 消费）--
  /** 逐模拟交易日收盘权益点（升序）。 */
  readonly equityCurve: readonly EquityPoint[];
  /** 全部交易生命周期（已清仓 + 期末仍持仓 openAtEnd）。 */
  readonly trades: readonly Trade[];
  /** 期末持仓。 */
  readonly positions: readonly Position[];
  /** 成本汇总（STEP 8 口径）。 */
  readonly costs: CostSummary;
  /** 订单/成交/拒绝执行统计。 */
  readonly executionStats: ExecutionStats;
  /** 被计划层跳过（未下单）的意图（决策日 → 原因），保证不静默。 */
  readonly skipped: readonly SkippedIntentEntry[];
  /** 审计追踪（逐订单/成交/持仓「为什么」）。 */
  readonly audit: AuditTrail;

  /** 内容指纹（sha256 十六进制）：除本字段外全部字段的确定性 JSON 摘要。 */
  readonly fingerprint: string;
}

/** 交易模拟输入。 */
export interface TradeSimulationInput {
  /** 已构建的 ResearchDataset（只读；bind 期校验 PIT/排序不变量）。 */
  readonly dataset: ResearchDataset;
  /** 来源候选运行记录（C-13.2 产物，datasetVersion 必须与 dataset 一致）。 */
  readonly sourceRun: CandidateEvaluationRun;
  /** 交易模拟执行配置。 */
  readonly simConfig: SimulationConfig;
}
