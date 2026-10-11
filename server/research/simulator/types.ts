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
import type { CorporateActionResolverLike } from "../../corporateActions/resolver";
import type {
  ResearchTrailingPolicyDefinition,
  StrongHoldAfterExtendedExitPolicy,
} from "../trailingPolicy";
import type { StopPolicyDefinition } from "../stopPolicy";
import type {
  RunnerHoldingBridgePolicyDefinition,
  RunnerRecoveryPathExitPolicyDefinition,
  SustainedCloseDeclineReversalExitPolicyDefinition,
} from "../exitPolicyCommon";

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
 * 候选退出政策。
 *
 * - `HOLD_WHILE_SELECTED`（缺省）：持仓不在当日候选集合时卖出，保留历史行为；
 * - `DISABLED`：候选评分不参与卖出，持仓只由止损/止盈/时间退出等显式规则结束。
 */
export type CandidateExitPolicy = "HOLD_WHILE_SELECTED" | "DISABLED";

/** 盈利回撤止盈的检查时点。 */
export type TrailingTakeProfitTrigger = "INTRADAY" | "ON_CLOSE";

/**
 * 意图未转成订单的稳定原因码（供程序化处理，非自由文本）。
 * 每种码配一条中文 explanation，写入记录，绝不静默丢弃意图。
 */
export type PlanSkipCode =
  /** 决策日是模拟窗口最后交易日，无下一交易日可执行（卖出/买入均顺延失败）。 */
  | "NO_NEXT_TRADING_DAY"
  /** 并发持仓已达上限（maxPositions），新候选无空位。 */
  | "MAX_POSITIONS_REACHED"
  /** 单日新建仓已达上限（maxDailyBuys），后续候选顺延/放弃。 */
  | "MAX_DAILY_BUYS_REACHED"
  /** T+1：可卖份额为 0（当日/此前买入仍冻结），卖出顺延至后续决策日再评估。 */
  | "FROZEN_EXIT_DEFERRED"
  /** 现金预算不足一手（含费用估算后不足 lotSize）。 */
  | "BUDGET_BELOW_MIN_LOT"
  /** 方向策略为 longOnly，short/neutral 候选不可交易（不建仓）。 */
  | "NON_LONG_DIRECTION"
  /** BACKTEST-002（B-02）：策略声明的仓位口径给出的目标资金为 0 ⇒ 不建仓。 */
  | "POSITION_SIZING_ZERO_BUDGET"
  /** BACKTEST-002（B-05）：执行日成交量为 0（或缺失）⇒ 不可成交。 */
  | "ZERO_VOLUME"
  /** 再入场策略：同一底层代码已有在仓成员且达到并发上限 ⇒ 不建仓。 */
  | "CONCURRENT_CODE_POSITION_LIMIT"
  /** 再入场策略：同一底层代码仍在冷却窗口内 ⇒ 不建仓。 */
  | "REENTRY_COOLDOWN_ACTIVE"
  /** 再入场策略：该池成员身份累计买入次数已达上限 ⇒ 不建仓。 */
  | "MEMBER_ENTRY_LIMIT_REACHED"
  /**
   * MARKET-REGIME-001 市场状态闸门：决策日处于被排除的市场状态 ⇒ 当日**不新建仓**。
   * 只约束新建仓；退出与已持仓不受影响。命中者写进 skipped，绝不静默丢弃。
   */
  | "MARKET_REGIME_BLOCKED";

/**
 * 再入场策略阻断原因码（`planDecisionDay` 的 `reentryBlocked` 值域）。
 *
 * 与 `PlanSkipCode` 新增的三个码同值：阻断在引擎里按"已成交事实"计算，
 * 由计划层原样写进 `skipped`，保证「不静默丢弃意图」。
 */
export type ReentryBlockCode =
  | "CONCURRENT_CODE_POSITION_LIMIT"
  | "REENTRY_COOLDOWN_ACTIVE"
  | "MEMBER_ENTRY_LIMIT_REACHED";

/**
 * 再入场策略声明（可选；缺省 = 既有行为，逐字节不变）。
 *
 * 只约束**新建仓**，不影响退出与已持仓；判定顺序固定为
 * 并发上限 → 代码冷却 → 成员限次，命中即不建仓并记录 skip。
 */
export interface ReentryPolicy {
  /** 同一底层代码出场后 K 个交易日内不得再买（含出场当日）。null/缺省 = 不限制。 */
  readonly securityCooldownTradingDays?: number | null;
  /** 同一 panelSecurityId（池成员身份）累计买入次数上限；1 = 一次性成员。null/缺省 = 不限制。 */
  readonly maxEntriesPerMember?: number | null;
  /** 同一底层代码同时最多允许的在仓成员数。null/缺省 = 不限制。 */
  readonly maxConcurrentOpenPerCode?: number | null;
}

// ---------------------------------------------------------------------------
// EXEC-ELIGIBILITY-001（FIX-005 / F1）— **可选**执行资格闸门
// ---------------------------------------------------------------------------

/**
 * 执行资格检查入参（引擎在**真实成交时点**装配，纯数据）。
 *
 * 🔴 `executionDate` 是引擎本日真正要执行该买单的交易日（不是「计划成交日」）；
 *    `plannedDate` 是意图产生的决策日。两者分开记录 ⇒ 「计划 vs 实际」可审计。
 */
export interface ExecutionEligibilityCheckInput {
  readonly securityId: string;
  /** 计划（决策 / 确认）日：`YYYY-MM-DD`。 */
  readonly plannedDate: string;
  /** 实际检查 / 成交日：`YYYY-MM-DD`。 */
  readonly executionDate: string;
  readonly side: Side;
}

/**
 * 执行资格判决。
 *
 * 🔴 **只有 `allowed === true` 且 `status === "NORMAL"` 才可能成交**；引擎还会把
 *    `status !== "NORMAL"` 一律按拒绝处理（失败关闭），不信任调用方的 `allowed`。
 */
export interface ExecutionEligibilityDecision {
  /** 是否放行（`false` ⇒ 拒单，不扣现金、不建仓、不计成功次数）。 */
  readonly allowed: boolean;
  /** 判决状态标签；约定 `"NORMAL"` 是**唯一**放行值（其余一律拒绝）。 */
  readonly status: string;
  /** 稳定原因码（自由文本但从闭集取值，如 `VERIFIED_NORMAL` / `VERIFIED_ST` / `NO_STATUS_FACT`）。 */
  readonly reason: string;
  /** 证据来源身份（provider）。 */
  readonly providerId: string;
  /** 资格政策版本（注入方声明；逐笔审计带上它）。 */
  readonly policyVersion: string;
  /** 证据指纹（可追溯到具体公告 / 采集批次）；无证据时 `null`。 */
  readonly evidenceFingerprint: string | null;
  /** 实际检查时刻（`YYYY-MM-DDTHH:mm:ss`，当地）。 */
  readonly checkedAt: string;
  /** 计划检查时刻 / 日期（供「计划 vs 实际」对照）；缺省 `null`。 */
  readonly plannedCheckDate: string | null;
}

/**
 * **可选**执行资格闸门（默认缺省 ⇒ 引擎行为逐字节不变）。
 *
 * 🔴 纯撮合层**不反向依赖**任何研究侧模块：本接口只声明形状，由调用方（研究装配层）
 *    注入实现；研究层负责经平台数据服务取证据。本层**不直连数据库**。
 */
export interface ExecutionEligibilityGate {
  /** 闸门身份（进入配置快照与逐笔审计）。 */
  readonly gateId: string;
  /** 政策版本（进入配置快照与逐笔审计）。 */
  readonly policyVersion: string;
  /**
   * 判定某笔**买入**订单能否在 `executionDate` 执行。
   *
   * 🔴 无结论必须返回 `allowed: false`（失败关闭），**不得**用 `NORMAL` 兜底。
   * 🔴 只对买入生效；卖出与已持仓退出**不经过**本闸门。
   */
  decideBuy(input: ExecutionEligibilityCheckInput): ExecutionEligibilityDecision;
}

/**
 * 逐笔执行资格审计（**仅当声明了 `executionEligibilityGate` 时存在**）。
 *
 * 🔴 记录的是**实际**检查事实（引擎在成交时点调用闸门的返回值），不是事后推断；
 *    未声明闸门时该字段**不出现** ⇒ 既有 Run 记录逐字节不变。
 */
export interface ExecutionEligibilityAuditEntry {
  readonly orderId: string;
  readonly securityId: string;
  readonly side: Side;
  /** 意图产生的决策日。 */
  readonly plannedDate: string;
  /** 真实检查 / 成交日。 */
  readonly executionDate: string;
  /** 闸门返回的**真实**状态标签（`UNKNOWN` 原样保留，**绝不**改写成 `NORMAL`）。 */
  readonly status: string;
  readonly reason: string;
  readonly providerId: string;
  readonly policyVersion: string;
  readonly gateId: string;
  readonly evidenceFingerprint: string | null;
  readonly checkedAt: string;
  readonly plannedCheckDate: string | null;
  /** 该笔最终是否真实成交（`REJECTED` 含被本闸门或其后的撮合约束拒绝）。 */
  readonly outcome: "FILLED" | "REJECTED";
}

// ---------------------------------------------------------------------------
// EXEC-ELIGIBILITY-LIGHT-001（RECOVERY-LIGHT-ST-007 §4）— **可选** UNKNOWN 处理声明
// ---------------------------------------------------------------------------

/**
 * 未核验状态（`UNKNOWN`）的处理政策（**闭集**）。
 *
 * 🔴 **缺省 = `REJECT`** ⇒ 未声明时引擎行为与既有实现**逐字节相同**（既有 Run 记录与指纹不变）。
 * 🔴 `ALLOW_WHEN_DECISION_ALLOWS` **只**放行 `status === "UNKNOWN"` **且** `allowed === true` 的判决；
 *    `status === "ST"` **永远拒绝**，即使闸门错误地返回 `allowed = true`。
 * 🔴 本声明**不**放宽 `NORMAL` 的定义：只有显式声明它的本轮政策才可能用到它。
 */
export const EXECUTION_ELIGIBILITY_UNKNOWN_POLICIES = [
  "REJECT",
  "ALLOW_WHEN_DECISION_ALLOWS",
] as const;
export type ExecutionEligibilityUnknownPolicy =
  (typeof EXECUTION_ELIGIBILITY_UNKNOWN_POLICIES)[number];

/** 缺省未知处理政策（**必须**是 `REJECT`：失败关闭）。 */
export const DEFAULT_EXECUTION_ELIGIBILITY_UNKNOWN_POLICY: ExecutionEligibilityUnknownPolicy = "REJECT";

/**
 * 某状态标签在给定未知处理政策下能否**真实成交**。
 *
 * 🔴 这是**唯一**的放行判据（引擎收尾断言与记录校验共用），避免三处各写一遍。
 */
export function executionEligibilityStatusAllowed(
  status: string,
  unknownPolicy: ExecutionEligibilityUnknownPolicy,
): boolean {
  if (status === "NORMAL") return true;
  return status === "UNKNOWN" && unknownPolicy === "ALLOW_WHEN_DECISION_ALLOWS";
}

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
  /** 单日最多新建仓数；null/缺省 = 不限。 */
  readonly maxDailyBuys?: number | null;
  /** 方向策略（缺省 longOnly）。 */
  readonly directionPolicy?: DirectionPolicy;
  /** 候选退出政策；缺省 = HOLD_WHILE_SELECTED（保持既有策略行为）。 */
  readonly candidateExitPolicy?: CandidateExitPolicy;
  /**
   * 再入场策略（可选）。缺省 = 不限制，既有策略执行路径逐字节不变。
   *
   * 只在**新建仓**时生效；由 `simulator/engine` 按已成交事实计算 blocked 集合，
   * 再交给 `planDecisionDay` 写成 skipped（绝不静默丢弃）。
   */
  readonly reentryPolicy?: ReentryPolicy;
  /**
   * EXEC-ELIGIBILITY-001（FIX-005 / F1）— **可选**执行资格闸门。
   *
   * 缺省 / `null` = 未启用 ⇒ 既有执行路径**逐字节不变**（含 001/002/003 与正式策略）。
   * 声明后：每笔**买入**订单在**真实成交时点**（执行日的订单处理阶段，早于报价、
   * 现金 / 持仓 / 成本 / 成交计数更新）先要求 `decideBuy(...)` 放行；
   * `status !== "NORMAL"` 或 `allowed !== true` 一律**拒单**（`UNKNOWN` 的例外见
   * `executionEligibilityUnknownPolicy`，**缺省仍拒绝**）。卖出与已持仓退出不受影响。
   *
   * 🔴 闸门实现由**调用方注入**（研究装配层）；本层不 import 研究侧模块、不直连数据库。
   */
  readonly executionEligibilityGate?: ExecutionEligibilityGate | null;
  /**
   * EXEC-ELIGIBILITY-LIGHT-001（`RECOVERY-LIGHT-ST-007` §4）— **可选**未核验状态处理声明。
   *
   * 缺省 / `null` ⇒ `REJECT`：`status !== "NORMAL"` 一律拒单（= 既有行为，**逐字节不变**）。
   * 只有**显式**声明 `ALLOW_WHEN_DECISION_ALLOWS`（并同时声明 `executionEligibilityGate`）时，
   * `status === "UNKNOWN"` **且** `allowed === true` 的买入判决才被放行。
   *
   * 🔴 `status === "ST"` **始终**拒单，即使闸门返回 `allowed = true`。
   * 🔴 声明后逐笔审计**保留真实 `UNKNOWN`**（不改写为 `NORMAL`）。
   * 🔴 本字段是「本轮显式政策」的落点，**不是**把 UNKNOWN 当成 NORMAL 的开关。
   */
  readonly executionEligibilityUnknownPolicy?: ExecutionEligibilityUnknownPolicy | null;
  /**
   * MARKET-REGIME-001 市场状态闸门（可选）。缺省 / null = 不限制，既有执行路径逐字节不变。
   *
   * 语义：`blockedDecisionDates` 命中的决策日**不新建仓**（已有持仓与退出路径完全不受影响）；
   * 命中者写进 skipped（code=MARKET_REGIME_BLOCKED），绝不静默丢弃。
   */
  readonly marketRegimeGate?: {
    /** 被排除的决策日（YYYY-MM-DD）。 */
    readonly blockedDecisionDates: readonly string[];
    /** 人类可读标签（仅审计用途）。 */
    readonly label?: string;
  } | null;
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
   * BACKTEST-002（B-02）— 策略声明的**仓位口径**（透传给 `planDecisionDay`）。
   *
   * 缺省 = 等权现金预算（= 改造前行为）。声明 `fixed-fraction` / `equity-fraction` / `fixed-amount` 时
   * **真正收窄**每笔订单的成交预算 —— 这是「参数搜索改仓位参数、结果才会变」的前提。
   */
  readonly positionSizing?: {
    readonly sizingMethod:
      | "EQUAL_WEIGHT"
      | "FIXED_FRACTION"
      | "EQUITY_FRACTION"
      | "RANK_WEIGHTED"
      | "FIXED_AMOUNT"
      | "FIXED_RATIO"
      | "RISK_BASED"
      | "SCORE_TIERED_EQUITY_FRACTION";
    readonly fraction: number | null;
    readonly fixedAmount: number | null;
    readonly tiers?: readonly { readonly minScore: number; readonly fraction: number }[];
    readonly rankTiers?: readonly { readonly maxRank: number; readonly fraction: number }[];
  };
  /**
   * 策略声明的退出政策。
   *
   * 语义在 C-14.1 中固定为：
   * - STOP_LOSS / TAKE_PROFIT：盘中触发，按触发价卖出全部可卖份额；
   * - TRAILING_TAKE_PROFIT：按持仓期最高收盘价计算回撤。`INTRADAY` 当日触发卖出；
   *   `ON_CLOSE` 收盘触发后下一交易日开盘卖出；
   * - TIME_EXIT：持有满 N 个交易日后的收盘触发，下一交易日开盘卖出。
   */
  readonly exitPolicy?: {
    readonly stopLossRatio: number | null;
    readonly takeProfitRatio: number | null;
    readonly maxHoldingDays: number | null;
    /** 盈利回撤止盈启动阈值（相对建仓价）；0 = 峰值一进入盈利即启动。 */
    readonly trailingTakeProfitActivationRatio?: number | null;
    /** 自持仓期最高收盘价回撤达到该比例时止盈；null = 未声明。 */
    readonly trailingTakeProfitDrawdownRatio?: number | null;
    /** 盈利回撤止盈检查时点；缺省 = ON_CLOSE（兼容既有策略）。 */
    readonly trailingTakeProfitTrigger?: TrailingTakeProfitTrigger | null;
    /**
     * Advanced research-only trailing policy. Mutually exclusive with the
     * fixed trailingTakeProfitDrawdownRatio path.
     */
    readonly advancedTrailingPolicy?: ResearchTrailingPolicyDefinition | null;
    /** 统一止损策略；缺省 = 旧 stopLossRatio 路径。 */
    readonly advancedStopPolicy?: StopPolicyDefinition | null;
    /**
     * 实验性时间退出延长：到 `atHoldingDays` 收盘时，若仍满足强势条件，
     * 则延长到 `extendToHoldingDays`；否则按原 maxHoldingDays 退出。
     */
    readonly strongHold?: {
      readonly atHoldingDays: number;
      readonly minReturnRatio: number;
      readonly requireAboveMa5: boolean;
      readonly requireAboveMa10: boolean;
      readonly extendToHoldingDays: number;
      readonly afterExtendedHold?: StrongHoldAfterExtendedExitPolicy;
      /** 到 extendToHoldingDays 时卖出的仓位比例；缺省 = 不减仓。 */
      readonly scaleOutRatio?: number | null;
      /** runner 最迟产生退出信号的持有日。 */
      readonly runnerExitAtHoldingDays?: number | null;
      /** 组合中允许同时存在的趋势 runner 数量上限。 */
      readonly maxConcurrentRunners?: number | null;
      /** 新候选评分超过最弱 runner 入仓评分的最小差值。 */
      readonly replacementScoreMargin?: number | null;
    } | null;
    /**
     * STRATEGY-EXIT-VALIDATION-010：固定 Runner 恢复/持续弱路径退出。
     * 该策略只由显式研究策略声明，缺省 / null 时既有执行路径不变。
     */
    readonly recoveryPath?: RunnerRecoveryPathExitPolicyDefinition | null;
    /** STRATEGY-HOLDING-BRIDGE-001：研究专用单变量持有桥。 */
    readonly runnerBridge?: RunnerHoldingBridgePolicyDefinition | null;
    /** CLC2-PORTFOLIO-001：研究专用「持续连续收低 → 反转确认退出」路径。 */
    readonly clc2ReversalPath?: SustainedCloseDeclineReversalExitPolicyDefinition | null;
  };
  /**
   * BACKTEST-002（B-05）— 成交量为 0 时的执行政策。
   *
   * `REJECT`（缺省，保守）= 执行日 `volume` 为 0 / 缺失 / 非有限 ⇒ **不可成交**（拒单）；
   * `IGNORE` = 不看成交量（= 改造前行为，仅显式声明时使用）。
   */
  readonly zeroVolumePolicy?: "REJECT" | "IGNORE";
  /**
   * 板块覆盖（securityId → board），用于涨跌停幅度解析；
   * 缺省按 main ±10% 处理（与 dataset 行不含 board 的口径一致）。
   */
  readonly securityBoards?: Readonly<Record<string, SecurityBoard>>;
  /**
   * 公司行为解析器（装配期从 corporate_actions 读取并按 securityId 建索引）。
   * 提供后在每日撮合前对持仓应用分红、送转、配股、拆合股。
   */
  readonly corporateActionResolver?: CorporateActionResolverLike;
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
  /** null = 不限单日新建仓数。 */
  readonly maxDailyBuys: number | null;
  readonly directionPolicy: DirectionPolicy;
  readonly candidateExitPolicy: CandidateExitPolicy;
  /** 再入场策略快照（null = 未声明；声明时进入结果记录与指纹）。 */
  readonly reentryPolicy: ReentryPolicy | null;
  /**
   * 执行资格闸门的**可序列化身份**（缺省字段**不出现** ⇒ 未启用时快照逐字节不变）。
   *
   * 🔴 这里**只**放身份（函数不入 JSON）；逐笔判决在 `executionEligibilityAudit`。
   * 🔴 `unknownPolicy` **只在显式声明 `executionEligibilityUnknownPolicy` 时出现** ⇒
   *    未声明 UNKNOWN 政策的既有快照与冻结指纹**逐字节不变**（既有断言是精确对象相等）。
   */
  readonly executionEligibility?: {
    readonly gateId: string;
    readonly policyVersion: string;
    readonly unknownPolicy?: ExecutionEligibilityUnknownPolicy;
  };
  /** 市场状态闸门快照（null = 未声明；声明时进入结果记录与指纹）。 */
  readonly marketRegimeGate: {
    readonly blockedDecisionDates: readonly string[];
    readonly label: string | null;
  } | null;
  readonly executionRules: {
    readonly blockLimitUpBuy: boolean;
    readonly blockLimitDownSell: boolean;
  };
  readonly allowPartialFill: boolean;
  /** 策略退出政策快照（null = 未声明）。 */
  readonly exitPolicy: {
    readonly stopLossRatio: number | null;
    readonly takeProfitRatio: number | null;
    readonly maxHoldingDays: number | null;
    readonly trailingTakeProfitActivationRatio: number | null;
    readonly trailingTakeProfitDrawdownRatio: number | null;
    readonly trailingTakeProfitTrigger: TrailingTakeProfitTrigger | null;
    readonly advancedTrailingPolicy: ResearchTrailingPolicyDefinition | null;
    readonly advancedStopPolicy: StopPolicyDefinition | null;
    readonly strongHold: {
      readonly atHoldingDays: number;
      readonly minReturnRatio: number;
      readonly requireAboveMa5: boolean;
      readonly requireAboveMa10: boolean;
      readonly extendToHoldingDays: number;
      readonly afterExtendedHold: StrongHoldAfterExtendedExitPolicy;
      readonly scaleOutRatio: number | null;
      readonly runnerExitAtHoldingDays: number | null;
      readonly maxConcurrentRunners: number | null;
      readonly replacementScoreMargin: number | null;
    } | null;
    /** Runner 恢复/持续弱路径退出快照（null = 未声明）。 */
    readonly recoveryPath: RunnerRecoveryPathExitPolicyDefinition | null;
    /** Runner 持有桥快照（null = 未声明）。 */
    readonly runnerBridge: RunnerHoldingBridgePolicyDefinition | null;
    /** CLC2 反转路径快照（null = 未声明）。 */
    readonly clc2ReversalPath: SustainedCloseDeclineReversalExitPolicyDefinition | null;
  };
  /** 是否启用 T+1（STEP 8 默认 true）。 */
  readonly tPlus1: boolean;
  /** 一手股数（= cost.lotSize，STEP 8 成交约束使用）。 */
  readonly lotSize: number;
  /** 决策时点（模拟固定为 close：决策日收盘后可见当日整根 bar）。 */
  readonly decisionPoint: "close";
  /** 进出场模型摘要（本版本实现语义，声明性常量）。 */
  readonly entryExitModel:
    | "HOLD_WHILE_SELECTED_LONG_ONLY_CASH_BUDGET"
    | "EXIT_RULES_LONG_ONLY_CASH_BUDGET";
  /** 公司行为口径：本次运行是否已接入真实分红送转事件。 */
  readonly corporateActions: "APPLIED" | "NOT_APPLIED";
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
  /**
   * EXEC-ELIGIBILITY-001（FIX-005 / F1）— 逐笔执行资格审计。
   *
   * 🔴 **仅当 `simConfig.executionEligibilityGate` 声明时存在**：未声明时该字段
   *    完全不出现 ⇒ 既有 Run 记录（及其指纹）逐字节不变。
   * 🔴 每一笔 `outcome === "FILLED"` 的买入都必然 `status === "NORMAL"`：
   *    引擎在成交前断言，违反即**整轮抛错**（不允许「写个 false 继续报收益」）。
   */
  readonly executionEligibilityAudit?: readonly ExecutionEligibilityAuditEntry[];
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
