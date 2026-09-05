/**
 * STEP 6.1 — Strategy Research Contract。
 *
 * 研究层策略定义：它不是对 Production Strategy Contract 的替换，而是
 *
 *   Production Strategy Contract + Research Metadata → Research Strategy Definition
 *
 * 即：研究定义只描述「生产策略」的自描述元数据（身份、所需数据、参数空间、决策时点），
 * 不含任何评分 / 信号 / 成交逻辑。研究层绝不能绕过 Production Strategy Contract 直接
 * 制造交易订单。
 */

import type { DecisionPoint } from "../data";
import type { ResearchParameterSchema } from "./types";

/** 研究层策略定义（元数据 + 参数 schema）。 */
export interface ResearchStrategyDefinition {
  strategyId: string;
  version: string;
  name: string;
  description?: string;

  /** 策略所需的特征（feature id）。 */
  requiredFeatures: string[];
  /** 策略所需的受控数据视图能力（与 Production StrategyMetadata.requiredData 对齐）。 */
  requiredData: string[];

  /** 决策时点（复用 Canonical Data 层的 DecisionPoint）。 */
  decisionPoint: DecisionPoint;

  parameterSchema: ResearchParameterSchema;

  metadata?: {
    author?: string;
    tags?: string[];
  };
}
