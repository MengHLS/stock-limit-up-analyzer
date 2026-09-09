/**
 * STEP 14 / C-14.2 — 成本模型：市场冲击显式模型（确定性纯函数）。
 *
 * 缺口背景（实查确认）：STEP 8 只有「价差型滑点」——engine/execution#
 * amountAdjustedSlippageBps 按参考成交额做**离散分层**加成（<1 亿 +20bp 等），
 * 它不是订单量 vs 流动性的连续函数，也不随订单规模变化（同一档内订单翻倍冲击不变），
 * 即 ROADMAP §15 的 market impact 在既有实现中显式缺位。本文件补齐。
 *
 * 模型公式（文档化；A 股日频数据的成交额比例近似，平方根律 / AMIHUD 风格）：
 *
 *   参与率      p = orderNotional（元） / turnover（元）
 *               其中 turnover = referenceAmountKqian（千元）× 1000
 *   冲击基点    impactBps = min(maxBps, coefficient × p^exponent)
 *   冲击金额    由调用方按 grossAmount × impactBps / 10^4 折算（见 compute.ts）
 *
 * 性质与边界行为：
 *   - 亚线性（默认 exponent = 0.5）：流动性充足（p → 0+）冲击 → 0+；流动性稀缺
 *     （p 大）冲击单调上升；模型关闭（enabled = false）→ 经声明的 0（非流动性缺失）。
 *   - FAIL LOUD（不静默给 0）：市场冲击启用时，流动性缺省 / 非正 / 非有限
 *     （referenceAmountKqian ≤ 0 / null / NaN）→ 抛 CostModel14Error
 *     （IMPACT_LIQUIDITY_INVALID）；参与率 p > maxParticipation（订单量超过流动性
 *     覆盖域，禁止外推）→ 抛 IMPACT_PARTICIPATION_EXCEEDS_LIMIT。
 *   - 流动性读数须为「成交时点之前已可知」的数据（对齐 simulator：决策日成交额，
 *     千元，绝不传成交日全天数据，避免未来函数）。
 *
 * 确定性：无 IO / Date.now / Math.random；同输入恒同输出。
 */

import { CostModel14Error } from "./errors";
import type { MarketImpactEstimate, MarketImpactParams } from "./types";

/** 千元 → 元 的换算系数（amount 千元语义与 server/data/types 一致）。 */
const KQIAN_TO_YUAN = 1000;

/**
 * 参与率（p = 订单成交额 / 参考流动性成交额）。
 *
 * @param orderNotionalYuan 订单成交额（元，> 0 有限）。
 * @param referenceAmountKqian 参考成交额（千元，> 0 有限）。
 * @throws CostModel14Error IMPACT_NOTIONAL_INVALID / IMPACT_LIQUIDITY_INVALID。
 */
export function participationFromTurnover(
  orderNotionalYuan: number,
  referenceAmountKqian: number
): number {
  if (!Number.isFinite(orderNotionalYuan) || orderNotionalYuan <= 0) {
    throw new CostModel14Error(
      "IMPACT_NOTIONAL_INVALID",
      `市场冲击：订单成交额必须为正有限数字，收到 ${String(orderNotionalYuan)}`
    );
  }
  if (
    !Number.isFinite(referenceAmountKqian) ||
    referenceAmountKqian <= 0
  ) {
    throw new CostModel14Error(
      "IMPACT_LIQUIDITY_INVALID",
      `市场冲击：参考成交额必须为正有限数字（千元），收到 ${String(referenceAmountKqian)}` +
        `——冲击启用时流动性缺失绝不静默给 0，须提供成交时点前已知的流动性读数`
    );
  }
  return orderNotionalYuan / (referenceAmountKqian * KQIAN_TO_YUAN);
}

/**
 * 冲击基点公式（纯函数，不含域检查；域检查见 estimateMarketImpact）。
 *
 * @param params 市场冲击参数。
 * @param participation 参与率 p（须已确认在模型域内：(0, maxParticipation]）。
 * @returns min(maxBps, coefficient × p^exponent)，恒 ≥ 0 且 ≤ maxBps。
 */
export function impactBpsForParticipation(
  params: MarketImpactParams,
  participation: number
): number {
  const raw = params.coefficient * Math.pow(participation, params.exponent);
  return Math.min(params.maxBps, raw);
}

/**
 * 市场冲击估计入口（确定性纯函数）。
 *
 * 输入：
 *   - orderNotionalYuan：订单成交额（元）；
 *   - referenceAmountKqian：参考成交额（千元），成交时点前已知；模型启用时必填；
 *   - params：市场冲击参数。
 *
 * 行为：
 *   - params.enabled = false → 返回 { impactBps: 0, participation: null }
 *     （**经声明的关闭**，不读取流动性，不伪造参与率读数）；
 *   - enabled = true → 计算参与率并校验域：
 *       流动性缺省/非正/非有限 → IMPACT_LIQUIDITY_INVALID（响亮报错）；
 *       参与率超 maxParticipation → IMPACT_PARTICIPATION_EXCEEDS_LIMIT（结构化拒绝）；
 *       域内 → { impactBps, participation }。
 */
export function estimateMarketImpact(input: {
  readonly orderNotionalYuan: number;
  readonly referenceAmountKqian: number | null;
  readonly params: MarketImpactParams;
}): MarketImpactEstimate {
  const { orderNotionalYuan, referenceAmountKqian, params } = input;
  if (!params.enabled) {
    return { impactBps: 0, participation: null };
  }
  // 启用时必须提供流动性读数（FAIL LOUD，不静默给 0）。
  if (referenceAmountKqian === null) {
    throw new CostModel14Error(
      "IMPACT_LIQUIDITY_INVALID",
      "市场冲击启用但未提供参考成交额（referenceAmountKqian = null）；" +
        "冲击按订单量/流动性建模，缺少流动性读数时无法估计，绝不静默给 0"
    );
  }
  const participation = participationFromTurnover(
    orderNotionalYuan,
    referenceAmountKqian
  );
  if (participation > params.maxParticipation) {
    throw new CostModel14Error(
      "IMPACT_PARTICIPATION_EXCEEDS_LIMIT",
      `市场冲击：参与率 ${participation.toFixed(6)} 超过模型允许上限 ` +
        `${params.maxParticipation}（订单量超出参考流动性覆盖域，禁止外推）`
    );
  }
  return {
    impactBps: impactBpsForParticipation(params, participation),
    participation,
  };
}
