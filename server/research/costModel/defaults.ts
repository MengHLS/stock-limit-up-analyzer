/**
 * STEP 14 / C-14.2 — 成本模型：A 股研究默认声明与费率常量。
 *
 * 费率口径（对齐现行 A 股规费/惯例；测试以官方示例值断言，见 defaults.test 断言）：
 *   - 佣金：双边，**券商可谈**，惯例区间约 万1.5 ~ 万3，本声明默认 万2.5（0.00025），
 *     监管上限 3‰ 见 validate.ts 的 COMMISSION_RATE_MAX；
 *   - 印花税：**仅卖出**，现行 0.05%（0.0005），法定，双边买入不收；
 *   - 过户费：双边，现行 0.001%（0.00001，即成交额十万分之一），法定；
 *   - 基础滑点：价差型（不含市场冲击），默认 10bp，对齐 engine/execution 默认
 *     （engine 侧另有按参考成交额的分层加成，见 amountAdjustedSlippageBps）；
 *   - 一手 100 股、最低佣金 5 元（对齐 engine DEFAULT_COST_MODEL）。
 *
 * 市场冲击默认标定（默认值 = 研究参考校准，非高精度估计；详见 impact.ts 公式注释）：
 *   冲击（bp）= min(maxBps, coefficient × p^0.5)；coefficient = 40 表示「订单吃下
 *   参考日全量成交额（p = 100%）」时约 40bp 的冲击幅度；p = 1% ≈ 4bp、p = 10% ≈ 13bp。
 *
 * 铁律：常量全部 Object.freeze（深层），无时间/随机源，可 JSON 序列化 round-trip。
 */

import type { CostModelDeclaration, MarketImpactParams } from "./types";

/** 默认佣金费率（双边，万 2.5；券商可谈）。 */
export const DEFAULT_COMMISSION_RATE = 0.00025;

/** 现行印花税率（仅卖出，0.05%）。 */
export const DEFAULT_STAMP_DUTY_RATE = 0.0005;

/** 现行过户费率（双边，0.001% = 成交额十万分之一）。 */
export const DEFAULT_TRANSFER_FEE_RATE = 0.00001;

/** 默认基础滑点（基点；价差型，不含市场冲击）。 */
export const DEFAULT_SLIPPAGE_BPS = 10;

/** 默认一手股数（A 股整手）。 */
export const DEFAULT_LOT_SIZE = 100;

/** 默认最低佣金（元）。 */
export const DEFAULT_MIN_COMMISSION = 5;

/** 默认市场冲击参数（见文件头校准说明）。 */
export const DEFAULT_MARKET_IMPACT_PARAMS: Readonly<MarketImpactParams> =
  Object.freeze({
    enabled: true,
    coefficient: 40,
    exponent: 0.5,
    maxBps: 200,
    maxParticipation: 1,
  });

/** 深层冻结（默认声明不可变）。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * A 股默认成本模型声明（研究链推荐起点）。
 * 各费率与文件头口径一一对应；经 validate.ts 校验合法。
 */
export const A_SHARE_DEFAULT_COST_DECLARATION: Readonly<CostModelDeclaration> =
  deepFreeze({
    name: "A_SHARE_DEFAULT",
    commissionRate: DEFAULT_COMMISSION_RATE,
    stampDutyRate: DEFAULT_STAMP_DUTY_RATE,
    transferFeeRate: DEFAULT_TRANSFER_FEE_RATE,
    slippageBps: DEFAULT_SLIPPAGE_BPS,
    lotSize: DEFAULT_LOT_SIZE,
    minCommission: DEFAULT_MIN_COMMISSION,
    marketImpact: { ...DEFAULT_MARKET_IMPACT_PARAMS },
  });
