/**
 * Strategy Contract —— 统一策略契约。
 *
 * 本层定义「策略」的形态约束：策略是一个纯函数，从受控的 Context（历史市场信息 +
 * 只读组合快照 + 配置）推导出确定性的策略决策（Signal），不触碰执行、资金、持仓、
 * 数据库、网络、UI 或任何模块级可变状态。
 *
 * 数据流（自上而下）：
 *
 *   Data Provider ──▶ Strategy Context ──▶ Strategy.evaluate ──▶ StrategyDecision
 *                                                                      │
 *                                                              (Signal 意图)
 *                                                                      ▼
 *                                                             Backtest Core
 *                                                        （Order → Fill → Portfolio）
 *
 * 未来函数防护（架构级）：Strategy 只能通过 `context.signalTime` 与 `context.data`
 * 读取「当前时点及以前」已经可获得的信息。禁止策略访问全量未来行情、数据库未来日期、
 * 全局缓存、singleton 或隐式时间变量。
 *
 * 本层不 import 任何 execution / portfolio 可变 API / db / 网络实现。
 */

import type { FeatureSnapshot, FeatureSnapshotBundle } from "../features/snapshot";

/**
 * 策略可消费的特征输入：
 *   - 单标快照 FeatureSnapshot（仅决策单只标的的策略）；
 *   - 多标集合 FeatureSnapshotBundle（同一 asOf 下按 symbol 组织的快照，供龙头候选等
 *     多标的策略逐候选取用）。
 */
export type StrategyFeatureInput = FeatureSnapshot | FeatureSnapshotBundle;

/** 策略参数基类。所有策略配置必须可序列化、可复现、可记录。 */
export interface StrategyConfig {
  readonly [key: string]: unknown;
}

/** 策略动作。策略只表达「意图」，不决定成交价格/数量/费用。 */
export type StrategyAction = "BUY" | "SELL" | "HOLD";

/** 统一策略信号（意图）。不等于 Order，更不等于 Fill。 */
export interface StrategySignal {
  /** 标的代码（如 600001.SH）。 */
  symbol: string;
  /** 信号产生时点（YYYY-MM-DD）。策略只能使用 <= 该时点的信息。 */
  signalTime: string;
  action: StrategyAction;
  /** 可选评分，用于排序或仓位分配意图，不参与成交本身。 */
  score?: number;
  /** 可选置信度（0~1）。 */
  confidence?: number;
  /** 可选解释性标签。 */
  reason?: string | null;
  /** 可选结构化元数据（可序列化）。 */
  metadata?: Record<string, string | number | boolean | null>;
}

/** 策略决策：一组信号 + 版本 + 数据充分性标记。 */
export interface StrategyDecision {
  /** 本次决策产出的信号（可能为空）。 */
  signals: StrategySignal[];
  /** 产出本决策的策略版本，便于回测复现。 */
  strategyVersion: string;
  /** 输入数据不足以可靠决策时为 true（策略仍可返回空信号或降级信号）。 */
  insufficientData: boolean;
}

/** 只读组合快照。策略可读，但不得修改，也不得调用 buy/sell。 */
export interface ReadonlyPortfolioContext {
  readonly cash: number;
  readonly equity: number;
  readonly openPositionCount: number;
  /** 当前持仓标的集合（只读）。 */
  readonly openPositionSymbols: readonly string[];
}

/** 受控策略输入上下文。data 的具体类型由各策略自行窄化。 */
export interface StrategyContext<C extends StrategyConfig = StrategyConfig, D = unknown> {
  /** 当前信号时点。 */
  signalTime: string;
  /** 受控数据视图（由上层 Data Provider 准备，策略不得自行查询 DB/网络）。 */
  data: D;
  /** 只读组合快照。 */
  portfolio: ReadonlyPortfolioContext;
  /** 已规范化（normalizeConfig 之后）的策略配置。 */
  config: C;
  /**
   * 可选 Feature 输入（Step 5）：统一数据管道在 signalTime 计算的、与该信号日严格同 asOf
   * 的特征快照（单标或多标 bundle）。策略需要基础指标（SMA/Return/Volatility/涨停等）时
   * 必须从这里读取，禁止自行 bars.slice / 重复实现 MA/Return/Volatility。
   * 不提供时为 undefined（兼容未接入 Feature Pipeline 的调用方）。
   */
  features?: StrategyFeatureInput;
}

/** 策略自描述元数据。用于自动生成策略列表/详情/回测任务/排行榜。 */
export interface StrategyMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  /** 策略所需的受控数据视图能力（供 Data Provider 校验）。 */
  requiredData: readonly string[];
  supportsLong: boolean;
  supportsShort: boolean;
  supportsIntraday: boolean;
}

/** 策略定义：元数据 + 默认配置 + 配置规范化 + 核心评估。 */
export interface Strategy<C extends StrategyConfig = StrategyConfig, D = unknown> {
  readonly metadata: StrategyMetadata;
  readonly defaultConfig: C;
  /** 规范化/校验外部配置，缺失字段回填默认值。必须是纯函数、可复现。 */
  normalizeConfig(raw?: Partial<C>): C;
  /** 核心：从受控上下文产生确定性决策。必须是纯函数（无副作用、无随机、无 IO）。 */
  evaluate(context: StrategyContext<C, D>): StrategyDecision;
}

/**
 * Registry 边界的统一上界类型。具体策略以窄化的 config/data 类型实现，
 * 注册后按本类型统一存取；调用方通过 Registry.evaluate 规范化配置后再评估。
 * （此处 data 上界为 unknown，是 registry 与具体策略之间的合法边界，非业务逻辑 any。）
 */
export type AnyStrategy = Strategy<StrategyConfig, unknown>;

/** 构造空决策的便捷工厂（避免各策略重复手写）。 */
export function emptyDecision(strategyVersion: string, insufficientData = false): StrategyDecision {
  return { signals: [], strategyVersion, insufficientData };
}
