/**
 * STEP 14 / C-14.2 — 成本模型（研究链路成本声明层）：类型契约。
 *
 * 背景与定位（协调者判断的增量确认，实查后成立）：
 *   - STEP 8 backtest/cost.ts 已实现「给定 engine CostModel 算单笔现金费用/滑点金额」
 *     的原子纯函数（commissionFee / stampDutyFee / transferFee / computeTradeCost /
 *     slippageAmount），本目录**只读复用**这些原子函数，绝不重写、不复制（铁律）。
 *   - STEP 8 / simulator（C-14.1）只消费 engine/domain#CostModel 六字段（费率 + 滑点 +
 *     最低佣金 + 一手股数），**没有市场冲击（market impact）建模**：其滑点是
 *     「参考成交额分层的价差型滑点」（engine/execution#amountAdjustedSlippageBps），
 *     冲击（订单量 vs 流动性的函数）显式缺位 —— 这是 ROADMAP §15 明确要求而既有实现
 *     未覆盖的增量（见本目录 impact.ts）。
 *   - 本目录交付四块增量：① 市场冲击显式模型（确定性纯函数）；② 成本模型声明 schema
 *     （结构化、可校验、可序列化，含 A 股现行税率默认值）；③ 单笔成交成本分解审计记录
 *     （commission / stamp / transfer / slippage / impact 分解）；④ 与 engine
 *     CostModel 的双向映射（mapper），使声明可被 simulator 配置面（SimulationConfig.cost）
 *     消费。
 *   - 不做：回测编排、执行时机（C-14.3 专项）、收益指标（C-16.1 专项）。
 *
 * 铁律：纯类型/纯函数、readonly、确定性、无 IO / Date.now / Math.random；
 * 全部数值可 JSON 序列化（禁止 NaN/Infinity/undefined 字段）。
 */

import type { Side } from "../../backtest/types";

// ---------------------------------------------------------------------------
// 市场冲击子模型（Market Impact）
// ---------------------------------------------------------------------------

/**
 * 市场冲击参数（嵌入成本声明，结构化、可校验、可序列化）。
 *
 * 模型语义见 impact.ts：参与率 p = 订单成交额 / 参考成交额（同一流动性口径，千元），
 * impactBps = min(maxBps, coefficient × p^exponent)，且 p ≤ maxParticipation。
 * p 超出 maxParticipation → 结构化抛错（市场冲击不可信时绝不静默给 0）。
 */
export interface MarketImpactParams {
  /** 是否启用冲击模型；false = 明确不建模（经声明的 0，区别于流动性缺失的拒绝）。 */
  readonly enabled: boolean;
  /** 标定系数（基点，p = 100% 参与时的冲击幅度）；须 > 0。 */
  readonly coefficient: number;
  /** 参与率指数（默认 0.5 平方根律，亚线性）；须 ∈ (0, 2]。 */
  readonly exponent: number;
  /** 单笔冲击上限（基点）；须 > 0 且 ≥ coefficient（保证在 p ∈ (0,1] 内不静默截断）。 */
  readonly maxBps: number;
  /** 参与率上限（∈ (0, 1]）；超过即结构化拒绝，禁止外推。 */
  readonly maxParticipation: number;
}

// ---------------------------------------------------------------------------
// 成本模型声明（Cost Model Declaration）
// ---------------------------------------------------------------------------

/**
 * 研究链路成本模型一等声明（A 股研究默认值见 defaults.ts）。
 *
 * 与 engine/domain#CostModel 的关系：本声明是「上游声明层」——包含 engine 六字段
 * （佣金/印花税/过户费/基础滑点/一手股数/最低佣金，映射见 mappers.ts）+ 市场冲击子模型
 * （engine 无此字段，故 mapper 只映射六字段，冲击留在研究侧消费）。
 *
 * 全部字段可 JSON 序列化；结构合法性由 validate.ts 校验（负费率/超界/未知字段 → issue）。
 */
export interface CostModelDeclaration {
  /** 声明标识（审计用途，非空；不参与计算）。 */
  readonly name: string;
  /** 佣金费率（双边；A 股可谈，监管上限 3‰，默认万 2.5）。 */
  readonly commissionRate: number;
  /** 印花税（仅卖出；现行 0.05% = 0.0005，法定）。 */
  readonly stampDutyRate: number;
  /** 过户费（双边；现行 0.001% = 0.00001，法定）。 */
  readonly transferFeeRate: number;
  /** 基础滑点（基点，1bp = 0.01%；买入上浮/卖出下浮；价差型，不含市场冲击）。 */
  readonly slippageBps: number;
  /** 一手股数（A 股 100）。 */
  readonly lotSize: number;
  /** 最低佣金（元）。 */
  readonly minCommission: number;
  /** 市场冲击子模型（本声明对 STEP 8 的增量）。 */
  readonly marketImpact: MarketImpactParams;
}

// ---------------------------------------------------------------------------
// 市场冲击估计（审计输出）
// ---------------------------------------------------------------------------

/** 单笔市场冲击估计结果（audit：回显参与率与生效基点）。 */
export interface MarketImpactEstimate {
  /**
   * 生效冲击基点（正值标度；模型关闭时恒 0）。
   * 计算公式：impactBps = min(maxBps, coefficient × p^exponent)，p ∈ (0, maxParticipation]。
   */
  readonly impactBps: number;
  /**
   * 参与率 p = 订单成交额（元） / 参考成交额（千元 × 1000）；
   * 模型关闭（enabled = false）时无参与率 → null（不伪造流动性读数）。
   */
  readonly participation: number | null;
}

// ---------------------------------------------------------------------------
// 单笔成交成本分解（审计记录）
// ---------------------------------------------------------------------------

/**
 * 单笔成交的成本分解输入（全部在成交时点已知，含 no-lookahead 约束）。
 *
 * @param referenceAmountKqian 参考成交额（千元，与数据域 amount 同单位）。必须是
 *   「成交时点之前已可知」的流动性读数（对齐 simulator：决策日成交额，绝不传成交日
 *   全天成交额）；市场冲击启用时缺省/非正 → 结构化抛错（不静默给 0）。
 */
export interface FillCostInput {
  /** 成交方向。 */
  readonly side: Side;
  /** 实际成交价（元/股，含滑点；由执行模型给出）。 */
  readonly price: number;
  /** 无滑点基准价（元/股；NEXT_OPEN = 开盘价）。 */
  readonly basePrice: number;
  /** 成交数量（股）。 */
  readonly quantity: number;
  /** 参考成交额（千元）；市场冲击关闭时可为 null。 */
  readonly referenceAmountKqian: number | null;
  /** 成本模型声明（须先经 assertValidCostModelDeclaration）。 */
  readonly declaration: CostModelDeclaration;
}

/**
 * 单笔成交成本分解（审计记录，不可变）。
 *
 * 符号口径（对齐 STEP 8 backtest/cost#slippageAmount，防止研究/回测两套符号漂移）：
 *   - commission / stampDuty / transferFee / otherFees / cashFees：恒非负（现金费用）；
 *   - slippage：**沿用 STEP 8 有符号口径**（buy ≥ 0 表示相对基准多付；sell ≤ 0 表示
 *     相对基准少收）——直接等于 slippageAmount(price, basePrice, quantity)；
 *   - marketImpact：与 slippage 同符号约定（buy ≥ 0 / sell ≤ 0）；
 *   - totalCostDrag：相对 baseNotional 的总摩擦成本（恒非负）= |slippage| + cashFees +
 *     |marketImpact|，语义 = 无摩擦基准成交额与实际成交净现金流的差 + 现金费用。
 */
export interface FillCostBreakdown {
  /** 成交方向。 */
  readonly side: Side;
  /** 无滑点基准成交额（元）= basePrice × quantity。 */
  readonly baseNotional: number;
  /** 实际成交额（元）= price × quantity（含滑点；STEP 8 现金费用的计税基数）。 */
  readonly grossAmount: number;
  /** 佣金（= STEP 8 computeTradeCost.commission）。 */
  readonly commission: number;
  /** 印花税（仅卖出；= STEP 8 computeTradeCost.stampDuty）。 */
  readonly stampDuty: number;
  /** 过户费（双边；= STEP 8 computeTradeCost.transferFee）。 */
  readonly transferFee: number;
  /** 其它费用（预留；= STEP 8 computeTradeCost.otherFees）。 */
  readonly otherFees: number;
  /** 现金费用合计 = 上四项之和（= STEP 8 computeTradeCost.total）。 */
  readonly cashFees: number;
  /** 滑点金额（有符号，= STEP 8 slippageAmount）。 */
  readonly slippage: number;
  /** 生效滑点（基点，正标度）= |slippage| / baseNotional × 10^4。 */
  readonly slippageBps: number;
  /** 市场冲击金额（有符号：buy ≥ 0 / sell ≤ 0）。 */
  readonly marketImpact: number;
  /** 生效冲击基点（正标度；冲击关闭时恒 0）。 */
  readonly impactBps: number;
  /** 冲击是否实际建模（= declaration.marketImpact.enabled）。 */
  readonly impactApplied: boolean;
  /** 参与率（冲击关闭时为 null）。 */
  readonly participation: number | null;
  /** 参考成交额回显（千元，审计用）。 */
  readonly referenceAmountKqian: number | null;
  /** 相对 baseNotional 的总摩擦成本（恒非负）。 */
  readonly totalCostDrag: number;
}
