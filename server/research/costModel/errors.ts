/**
 * STEP 14 / C-14.2 — 成本模型：结构化错误（稳定 code，供程序化处理）。
 *
 * 校验层抛既有 research 层 ResearchValidationError（experimentValidation.ts，
 * 与 simulator / signalEngine 同一错误体系）；本文件只服务「市场冲击 / 成本分解」的
 * 计算域错误（输入非法、流动性缺失、参与率超界），错误码稳定非自由文本。
 */

/** 稳定错误码（供程序化处理，非自由文本）。 */
export type CostModel14ErrorCode =
  /** 订单成交额非法（非正 / 非有限）。 */
  | "IMPACT_NOTIONAL_INVALID"
  /** 参考流动性非法：缺省 / 非正 / 非有限（冲击启用时零流动性→响亮报错，绝不静默给 0）。 */
  | "IMPACT_LIQUIDITY_INVALID"
  /** 参与率超出模型声明允许上限（maxParticipation）：禁止外推，结构化拒绝。 */
  | "IMPACT_PARTICIPATION_EXCEEDS_LIMIT"
  /** 成本分解输入非法（价格 / 数量 / 声明不可用）。 */
  | "FILL_INPUT_INVALID";

/** C-14.2 计算域错误。 */
export class CostModel14Error extends Error {
  /** 稳定错误码。 */
  readonly code: CostModel14ErrorCode;

  constructor(code: CostModel14ErrorCode, message: string) {
    super(message);
    this.name = "CostModel14Error";
    this.code = code;
  }
}
