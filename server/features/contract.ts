/**
 * STEP 5 — Feature / Factor Contract。
 *
 * Feature 是纯函数计算单元：
 *   - 输入：经过 asOf 过滤的历史市场数据（MarketBarSeries）+ 明确的 asOf/decision 语义；
 *   - 输出：FeatureResult（value + status + 数据充分性）。
 *
 * 铁律：
 *   - 只读入参，不修改原始数据；
 *   - 不访问 DB / Network / Portfolio / 时间函数 / 随机数；
 *   - 相同输入（data + config + asOf）必得相同输出；
 *   - 数据不足 → INSUFFICIENT_DATA；数据非法 → INVALID_DATA；绝不静默降级为 READY。
 */

import type { DecisionPoint, MarketBarSeries } from "../data";

/** 特征结果状态。 */
export type FeatureStatus = "READY" | "INSUFFICIENT_DATA" | "INVALID_DATA";

/** 特征计算结果。 */
export interface FeatureResult {
  value: number | null;
  status: FeatureStatus;
  /** 该特征完整计算所需的最少可见 bar 数。 */
  requiredBars: number;
  /** 实际可见（已按 asOf 过滤）的 bar 数。 */
  availableBars: number;
  /** 可选解释（如 INVALID_DATA 原因）。 */
  note?: string | null;
}

/** 特征计算上下文：series 已经由上层按 decisionDate/point 过滤，只含当时可见数据。 */
export interface FeatureContext {
  symbol: string;
  /** 股票名称（可选，用于 ST 5% 涨停判定；缺失时按非 ST 主板规则）。 */
  stockName?: string | null;
  series: MarketBarSeries;
  decisionDate: string;
  decisionPoint: DecisionPoint;
}

/** 数值型参数（feature 实例通过 create(params) 生成，如 period）。 */
export type FeatureParams = Readonly<Record<string, number>>;

/** 特征元数据（注册中心 list() 的输出）。 */
export interface FeatureMetadata {
  id: string;
  version: string;
  description: string;
  /** 该特征消费的 canonical bar 字段（"close"/"amount"/...）。 */
  inputFields: readonly string[];
  /** 数据可用性要求：需要完整收盘数据的为 "close"。 */
  availability: DecisionPoint;
}

/** 可计算的特征实例（由工厂 + 参数构建；无副作用、纯函数）。 */
export interface FeatureInstance {
  readonly metadata: FeatureMetadata;
  readonly params: FeatureParams;
  /** 当前参数下计算所需的最少 bar 数。 */
  readonly requiredBars: number;
  calculate(ctx: FeatureContext): FeatureResult;
}

/** 特征工厂：注册中心管理的最小单元；create(params) 产出可计算实例。 */
export interface FeatureFactory {
  readonly metadata: FeatureMetadata;
  /** 未显式传参时使用的默认参数。 */
  readonly defaultParams: FeatureParams;
  create(params?: Partial<FeatureParams>): FeatureInstance;
}
