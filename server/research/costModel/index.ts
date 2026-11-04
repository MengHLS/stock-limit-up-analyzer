/**
 * STEP 14 / C-14.2 — 成本模型（研究链路成本声明层）：统一出口。
 *
 * 增量（相对 STEP 8 backtest/cost.ts 只读复用的能力）：
 *   - 市场冲击显式模型：impact.ts（订单量 vs 流动性，平方根律参与率近似）；
 *   - 成本声明 schema：types + defaults + validate（结构化、可序列化、可校验，
 *     含 A 股现行税率默认值）；
 *   - 单笔成本分解审计：compute.ts（commission / stamp / transfer / slippage /
 *     impact 五维分解，与 STEP 8 原子函数逐字段一致）；
 *   - engine CostModel 双向映射：mappers.ts（simulator 配置面消费入口）；
 *   - 序列化 round-trip：serialize.ts。
 *
 * 约束：纯函数/类型；readonly；确定性；无 IO / Date.now / Math.random。
 */

export {
  A_SHARE_DEFAULT_COST_DECLARATION,
  DEFAULT_COMMISSION_RATE,
  DEFAULT_MARKET_IMPACT_PARAMS,
  DEFAULT_MIN_COMMISSION,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_STAMP_DUTY_RATE,
  DEFAULT_TRANSFER_FEE_RATE,
} from "./defaults";
export { CostModel14Error, type CostModel14ErrorCode } from "./errors";
export {
  estimateMarketImpact,
  impactBpsForParticipation,
  participationFromTurnover,
} from "./impact";
export { fromEngineCostModel, toEngineCostModel } from "./mappers";
export { computeFillCostBreakdown } from "./compute";
export {
  assertValidCostModelDeclaration,
  COMMISSION_RATE_MAX,
  LOT_SIZE_MAX,
  MIN_COMMISSION_MAX,
  SLIPPAGE_BPS_MAX,
  STAMP_DUTY_RATE_MAX,
  TRANSFER_FEE_RATE_MAX,
  validateCostModelDeclaration,
} from "./validate";
export {
  deserializeCostModelDeclaration,
  serializeCostModelDeclaration,
} from "./serialize";
export type {
  CostModelDeclaration,
  FillCostBreakdown,
  FillCostInput,
  MarketImpactEstimate,
  MarketImpactParams,
} from "./types";
