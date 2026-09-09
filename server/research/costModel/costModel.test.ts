/**
 * STEP 14 / C-14.2 — 成本模型测试（纯函数单测，无 DB / 无 IO）。
 *
 * 覆盖（对应任务验收清单）：
 *   ① 佣金/印花税/过户费与官方费率数值一致（官方示例值断言）+ 最低佣金地板；
 *   ② 市场冲击：流动性充足 → 接近 0、流动性稀缺 → 冲击上升、确定性、边界拒绝；
 *   ③ schema 校验：负费率 / 超界 / NaN / 未知字段 / 非整一手 / 冲击参数不一致 → issue；
 *   ④ 声明序列化 round-trip（含篡改拒绝、NaN 拒绝）；
 *   ⑤ 与 STEP 8 cost 函数组合的单笔成本分解逐字段正确；
 *   ⑥ 声明 → engine CostModel mapper 可被 simulator SimulationConfig 配置面消费。
 */

import { describe, expect, it } from "vitest";
import { computeTradeCost, slippageAmount } from "../../backtest/cost";
import { ResearchValidationError } from "../experimentValidation";
import {
  A_SHARE_DEFAULT_COST_DECLARATION,
  assertValidCostModelDeclaration,
  computeFillCostBreakdown,
  CostModel14Error,
  DEFAULT_COMMISSION_RATE,
  DEFAULT_MARKET_IMPACT_PARAMS,
  DEFAULT_MIN_COMMISSION,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_STAMP_DUTY_RATE,
  DEFAULT_TRANSFER_FEE_RATE,
  deserializeCostModelDeclaration,
  estimateMarketImpact,
  fromEngineCostModel,
  impactBpsForParticipation,
  participationFromTurnover,
  serializeCostModelDeclaration,
  toEngineCostModel,
  validateCostModelDeclaration,
  type CostModelDeclaration,
} from "./index";
import { DEFAULT_LOT_SIZE } from "./defaults";
import type { SimulationConfig } from "../simulator/types";

/** 默认声明可变副本（validate 接受 unknown，便于构造畸形样本）。 */
function copyDecl(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(A_SHARE_DEFAULT_COST_DECLARATION)) as Record<string, unknown>;
}

describe("① 默认费率对齐官方口径 + STEP 8 金额一致（官方示例值）", () => {
  it("默认费率常量精确等于现行 A 股口径", () => {
    expect(DEFAULT_COMMISSION_RATE).toBe(0.00025); // 佣金万 2.5（券商可谈）
    expect(DEFAULT_STAMP_DUTY_RATE).toBe(0.0005); // 印花税卖出 0.05%
    expect(DEFAULT_TRANSFER_FEE_RATE).toBe(0.00001); // 过户费双边 0.001%
    expect(DEFAULT_SLIPPAGE_BPS).toBe(10);
    expect(DEFAULT_LOT_SIZE).toBe(100);
    expect(DEFAULT_MIN_COMMISSION).toBe(5);
  });

  it("声明默认值与常量一致且冻结（不可变默认）", () => {
    const d = A_SHARE_DEFAULT_COST_DECLARATION;
    expect(d.commissionRate).toBe(DEFAULT_COMMISSION_RATE);
    expect(d.stampDutyRate).toBe(DEFAULT_STAMP_DUTY_RATE);
    expect(d.transferFeeRate).toBe(DEFAULT_TRANSFER_FEE_RATE);
    expect(d.lotSize).toBe(DEFAULT_LOT_SIZE);
    expect(d.marketImpact.enabled).toBe(true);
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.marketImpact)).toBe(true);
  });

  it("官方示例金额：1,000,000 元成交，佣金 250 / 印花税卖出 500 / 过户费 10（按默认费率）", () => {
    const engine = toEngineCostModel(A_SHARE_DEFAULT_COST_DECLARATION);
    const gross = 1_000_000; // 元（整数精确）
    // 买入：佣金 0.00025×1e6 = 250；印花税不收；过户费 0.00001×1e6 = 10。
    const buy = computeTradeCost("buy", gross, engine);
    expect(buy.commission).toBe(250);
    expect(buy.stampDuty).toBe(0);
    expect(buy.transferFee).toBe(10);
    expect(buy.total).toBe(260);
    // 卖出：佣金 250 + 印花税 0.0005×1e6 = 500 + 过户费 10。
    const sell = computeTradeCost("sell", gross, engine);
    expect(sell.commission).toBe(250);
    expect(sell.stampDuty).toBe(500);
    expect(sell.transferFee).toBe(10);
    expect(sell.total).toBe(760);
  });

  it("最低佣金地板：小额成交佣金 = 5 元，不被费率击穿", () => {
    const engine = toEngineCostModel(A_SHARE_DEFAULT_COST_DECLARATION);
    const buy = computeTradeCost("buy", 10_000, engine); // 0.00025×1e4 = 2.5 < 5
    expect(buy.commission).toBe(DEFAULT_MIN_COMMISSION);
    expect(buy.stampDuty).toBe(0);
  });
});

describe("② 市场冲击模型（参与率平方根律）", () => {
  it("流动性充足 → 冲击接近 0；流动性稀缺 → 冲击上升（同一订单规模）", () => {
    const order = 100_000; // 元
    const liquid = estimateMarketImpact({
      orderNotionalYuan: order,
      referenceAmountKqian: 1_000_000, // 10 亿元 → p = 1e-4
      params: DEFAULT_MARKET_IMPACT_PARAMS,
    });
    const scarce = estimateMarketImpact({
      orderNotionalYuan: order,
      referenceAmountKqian: 10_000, // 1 亿元 → p = 0.01
      params: DEFAULT_MARKET_IMPACT_PARAMS,
    });
    expect(liquid.impactBps).toBeCloseTo(0.4, 8); // 40 × √1e-4 = 0.4bp
    expect(scarce.impactBps).toBeCloseTo(4, 8); // 40 × √0.01 = 4bp
    expect(scarce.impactBps).toBeGreaterThan(liquid.impactBps);
    expect(scarce.participation).toBeCloseTo(0.01, 10);
    // 参与率越高冲击越大：p = 0.25 → 20bp，p = 1.0 → 40bp（= coefficient）。
    const p25 = estimateMarketImpact({
      orderNotionalYuan: 250_000,
      referenceAmountKqian: 1_000,
      params: DEFAULT_MARKET_IMPACT_PARAMS,
    });
    const p100 = estimateMarketImpact({
      orderNotionalYuan: 1_000_000,
      referenceAmountKqian: 1_000,
      params: DEFAULT_MARKET_IMPACT_PARAMS,
    });
    expect(p25.impactBps).toBeCloseTo(20, 6);
    expect(p100.impactBps).toBeCloseTo(DEFAULT_MARKET_IMPACT_PARAMS.coefficient, 6);
    expect(p100.participation).toBeCloseTo(1, 10);
  });

  it("亚线性：订单翻 4 倍冲击不足 4 倍（平方根律）", () => {
    const base = impactBpsForParticipation(DEFAULT_MARKET_IMPACT_PARAMS, 0.25);
    const quadruple = impactBpsForParticipation(DEFAULT_MARKET_IMPACT_PARAMS, 1);
    expect(base).toBeCloseTo(20, 6);
    expect(quadruple).toBeCloseTo(40, 6);
    expect(quadruple).toBeLessThan(base * 4); // 40 < 80
  });

  it("确定性：同输入恒同输出", () => {
    const input = {
      orderNotionalYuan: 100_000,
      referenceAmountKqian: 10_000,
      params: DEFAULT_MARKET_IMPACT_PARAMS,
    };
    expect(estimateMarketImpact(input)).toEqual(estimateMarketImpact(input));
    expect(impactBpsForParticipation(DEFAULT_MARKET_IMPACT_PARAMS, 0.1)).toBe(
      impactBpsForParticipation(DEFAULT_MARKET_IMPACT_PARAMS, 0.1)
    );
  });

  it("enabled = false → 经声明关闭返回 0 / participation null（无需流动性，不伪造读数）", () => {
    const off = { ...DEFAULT_MARKET_IMPACT_PARAMS, enabled: false };
    const result = estimateMarketImpact({
      orderNotionalYuan: 1_000_000,
      referenceAmountKqian: null,
      params: off,
    });
    expect(result).toEqual({ impactBps: 0, participation: null });
  });

  it("零/缺失流动性 → 响亮报错（绝不静默给 0）", () => {
    expect(() =>
      estimateMarketImpact({
        orderNotionalYuan: 100,
        referenceAmountKqian: null,
        params: DEFAULT_MARKET_IMPACT_PARAMS,
      })
    ).toThrowError(/流动性/);
    expect(() =>
      participationFromTurnover(100, 0)
    ).toThrowError(CostModel14Error);
    try {
      participationFromTurnover(100, 0);
    } catch (error) {
      expect(error).toBeInstanceOf(CostModel14Error);
      expect((error as CostModel14Error).code).toBe("IMPACT_LIQUIDITY_INVALID");
    }
  });

  it("订单成交额非正 → IMPACT_NOTIONAL_INVALID；参与率超上限 → 结构化拒绝", () => {
    expect(() => participationFromTurnover(0, 1_000)).toThrowError(
      CostModel14Error
    );
    expect(() => participationFromTurnover(-1, 1_000)).toThrowError(
      CostModel14Error
    );
    const big = estimateMarketImpact.bind(null, {
      orderNotionalYuan: 2_000_000,
      referenceAmountKqian: 1_000, // 流动性 1e6 元 < 订单 2e6 元 → p = 2 > 1
      params: DEFAULT_MARKET_IMPACT_PARAMS,
    });
    try {
      big();
    } catch (error) {
      expect(error).toBeInstanceOf(CostModel14Error);
      expect((error as CostModel14Error).code).toBe(
        "IMPACT_PARTICIPATION_EXCEEDS_LIMIT"
      );
    }
  });

  it("自定义 maxParticipation（0.5）内放行、越界拒绝", () => {
    const capped = { ...DEFAULT_MARKET_IMPACT_PARAMS, maxParticipation: 0.5 };
    const within = estimateMarketImpact({
      orderNotionalYuan: 250_000,
      referenceAmountKqian: 1_000, // p = 0.25
      params: capped,
    });
    expect(within.participation).toBeCloseTo(0.25, 8);
    expect(within.impactBps).toBeGreaterThan(0);
    expect(() =>
      estimateMarketImpact({
        orderNotionalYuan: 600_000, // p = 0.6 > 0.5
        referenceAmountKqian: 1_000,
        params: capped,
      })
    ).toThrowError(/参与率/);
  });
});

describe("③ schema 校验（结构化 issue）", () => {
  it("默认声明校验通过", () => {
    const result = validateCostModelDeclaration(
      A_SHARE_DEFAULT_COST_DECLARATION
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("负费率 → 报负费率/超界 issue", () => {
    const bad = copyDecl();
    bad.commissionRate = -0.001;
    const result = validateCostModelDeclaration(bad);
    expect(result.valid).toBe(false);
    expect(result.issues.map(i => i.code)).toContain("CM14_RATE_NEGATIVE");
    expect(result.issues.map(i => i.path)).toContain(
      "declaration.commissionRate"
    );
  });

  it("超界费率 → OUT_OF_RANGE（佣金 > 3‰、滑点 > 1000bp、过户费 > 1‰）", () => {
    const over = copyDecl();
    over.commissionRate = 0.0031;
    expect(validateCostModelDeclaration(over).valid).toBe(false);
    const overSlip = copyDecl();
    overSlip.slippageBps = 1001;
    const slipIssues = validateCostModelDeclaration(overSlip).issues.map(
      i => i.code
    );
    expect(slipIssues).toContain("CM14_OUT_OF_RANGE");
  });

  it("NaN / Infinity / 字符串数字 → NOT_FINITE；缺字段 → FIELD_MISSING", () => {
    const nan = copyDecl();
    nan.stampDutyRate = Number.NaN;
    expect(
      validateCostModelDeclaration(nan).issues.map(i => i.code)
    ).toContain("CM14_NOT_FINITE");

    const inf = copyDecl();
    inf.minCommission = Number.POSITIVE_INFINITY;
    expect(
      validateCostModelDeclaration(inf).issues.map(i => i.code)
    ).toContain("CM14_NOT_FINITE");

    const str = copyDecl();
    str.transferFeeRate = "0.001";
    expect(
      validateCostModelDeclaration(str).issues.map(i => i.code)
    ).toContain("CM14_NOT_FINITE");

    const missing = copyDecl();
    delete missing.name;
    expect(
      validateCostModelDeclaration(missing).issues.map(i => i.code)
    ).toContain("CM14_FIELD_MISSING");
  });

  it("一手股数非正整数 / 未知字段 → issue", () => {
    const lot = copyDecl();
    lot.lotSize = 100.5;
    expect(
      validateCostModelDeclaration(lot).issues.map(i => i.code)
    ).toContain("CM14_NOT_INTEGER");
    const zero = copyDecl();
    zero.lotSize = 0;
    expect(
      validateCostModelDeclaration(zero).issues.map(i => i.code)
    ).toContain("CM14_OUT_OF_RANGE");

    const unknown = copyDecl();
    unknown.foo = 1;
    expect(
      validateCostModelDeclaration(unknown).issues.map(i => i.code)
    ).toContain("CM14_UNKNOWN_FIELD");
  });

  it("市场冲击参数非法：非对象 / 指数超界 / 系数 0 / maxBps < coefficient", () => {
    const noImpact = copyDecl();
    delete noImpact.marketImpact;
    expect(
      validateCostModelDeclaration(noImpact).issues.map(i => i.code)
    ).toContain("CM14_IMPACT_INVALID");

    const exponent = copyDecl();
    (exponent.marketImpact as Record<string, unknown>).exponent = 3;
    expect(
      validateCostModelDeclaration(exponent).issues.map(i => i.code)
    ).toContain("CM14_OUT_OF_RANGE");

    const zeroCoef = copyDecl();
    (zeroCoef.marketImpact as Record<string, unknown>).coefficient = 0;
    expect(
      validateCostModelDeclaration(zeroCoef).issues.map(i => i.code)
    ).toContain("CM14_IMPACT_COEFFICIENT_NONPOSITIVE");

    const inconsistent = copyDecl();
    const impact = inconsistent.marketImpact as Record<string, unknown>;
    impact.maxBps = 10;
    impact.coefficient = 40;
    expect(
      validateCostModelDeclaration(inconsistent).issues.map(i => i.code)
    ).toContain("CM14_IMPACT_BOUNDS_INCONSISTENT");

    const unknownImpact = copyDecl();
    (unknownImpact.marketImpact as Record<string, unknown>).lambda = 1;
    expect(
      validateCostModelDeclaration(unknownImpact).issues.map(i => i.code)
    ).toContain("CM14_UNKNOWN_FIELD");
  });

  it("上界合法值（佣金 3‰、印花 3‰、滑点 1000bp、一手 1 股、最低佣金 0）不报错", () => {
    const edge = copyDecl();
    edge.commissionRate = 0.003;
    edge.stampDutyRate = 0.003;
    edge.slippageBps = 1000;
    edge.lotSize = 1;
    edge.minCommission = 0;
    expect(validateCostModelDeclaration(edge).valid).toBe(true);
  });

  it("assert* 非法即抛 ResearchValidationError（issue 聚合）", () => {
    const bad = copyDecl();
    bad.commissionRate = -0.1;
    expect(() =>
      assertValidCostModelDeclaration(bad as unknown as CostModelDeclaration)
    ).toThrowError(ResearchValidationError);
  });
});

describe("④ 序列化 round-trip", () => {
  it("serialize → deserialize 语义一致（字段无损）", () => {
    const json = serializeCostModelDeclaration(
      A_SHARE_DEFAULT_COST_DECLARATION
    );
    const parsed = deserializeCostModelDeclaration(json);
    expect(parsed).toEqual(A_SHARE_DEFAULT_COST_DECLARATION);
  });

  it("确定性：同声明必同串", () => {
    expect(
      serializeCostModelDeclaration(A_SHARE_DEFAULT_COST_DECLARATION)
    ).toBe(serializeCostModelDeclaration(A_SHARE_DEFAULT_COST_DECLARATION));
  });

  it("篡改费率 → deserialize 拒绝（类型边界不后退）", () => {
    const tampered = { ...A_SHARE_DEFAULT_COST_DECLARATION, commissionRate: 0.02 };
    const json = JSON.stringify(tampered);
    expect(() => deserializeCostModelDeclaration(json)).toThrowError(
      ResearchValidationError
    );
  });

  it("NaN 值 → serialize 拒绝（严格 replacer，不静默转 null）", () => {
    expect(() =>
      serializeCostModelDeclaration({
        ...A_SHARE_DEFAULT_COST_DECLARATION,
        stampDutyRate: Number.NaN,
      })
    ).toThrowError(/非有限数字/);
  });
});

describe("⑤ 与 STEP 8 cost 函数组合的单笔成本分解", () => {
  const decl = A_SHARE_DEFAULT_COST_DECLARATION;
  const engine = toEngineCostModel(decl);
  const refKqian = 200_000; // 决策日成交额 2 亿元（成交时点前已知）

  it("买入分解：现金费用/滑点与 STEP 8 原子函数逐字段一致，冲击上浮", () => {
    const price = 10.2;
    const basePrice = 10;
    const quantity = 1000;
    const b = computeFillCostBreakdown({
      side: "buy",
      price,
      basePrice,
      quantity,
      referenceAmountKqian: refKqian,
      declaration: decl,
    });
    const gross = price * quantity;
    const step8 = computeTradeCost("buy", gross, engine);

    // 现金费用与 STEP 8 完全一致（同一 gross 基数）。
    expect(b.commission).toBe(step8.commission);
    expect(b.stampDuty).toBe(step8.stampDuty);
    expect(b.transferFee).toBe(step8.transferFee);
    expect(b.otherFees).toBe(step8.otherFees);
    expect(b.cashFees).toBe(step8.total);
    expect(b.stampDuty).toBe(0); // 买入不收印花税
    // 滑点 = STEP 8 slippageAmount（正：多付）。
    expect(b.slippage).toBe(slippageAmount(price, basePrice, quantity));
    expect(b.slippage).toBeGreaterThan(0);
    expect(b.slippageBps).toBeCloseTo(
      (Math.abs(slippageAmount(price, basePrice, quantity)) / (basePrice * quantity)) * 10_000,
      6
    );
    // 市场冲击：buy 上浮为正，金额 = gross × impactBps / 1e4。
    expect(b.impactApplied).toBe(true);
    expect(b.marketImpact).toBeGreaterThan(0);
    expect(b.impactBps).toBeGreaterThan(0);
    expect(b.marketImpact).toBeCloseTo((gross * b.impactBps) / 10_000, 9);
    // 总摩擦 = |滑点| + 现金费用 + |冲击|。
    expect(b.totalCostDrag).toBeCloseTo(
      Math.abs(b.slippage) + b.cashFees + Math.abs(b.marketImpact),
      9
    );
    // baseNotional 与 grossAmount 审计回显。
    expect(b.baseNotional).toBeCloseTo(basePrice * quantity, 9);
    expect(b.grossAmount).toBeCloseTo(gross, 9);
    expect(b.referenceAmountKqian).toBe(refKqian);
  });

  it("卖出分解：印花税计收、滑点/冲击为负（少收口径，对齐 STEP 8 符号）", () => {
    const price = 9.8;
    const basePrice = 10;
    const quantity = 1000;
    const b = computeFillCostBreakdown({
      side: "sell",
      price,
      basePrice,
      quantity,
      referenceAmountKqian: refKqian,
      declaration: decl,
    });
    const gross = price * quantity;
    const step8 = computeTradeCost("sell", gross, engine);
    expect(b.commission).toBe(step8.commission);
    expect(b.stampDuty).toBe(step8.stampDuty);
    expect(b.stampDuty).toBeGreaterThan(0); // 卖出收印花税
    expect(b.transferFee).toBe(step8.transferFee);
    expect(b.cashFees).toBe(step8.total);
    expect(b.slippage).toBe(slippageAmount(price, basePrice, quantity));
    expect(b.slippage).toBeLessThan(0); // sell 滑点为负
    expect(b.marketImpact).toBeLessThan(0); // 冲击符号与滑点一致
    expect(Math.abs(b.marketImpact)).toBeCloseTo(
      (gross * b.impactBps) / 10_000,
      9
    );
    expect(b.totalCostDrag).toBeCloseTo(
      Math.abs(b.slippage) + b.cashFees + Math.abs(b.marketImpact),
      9
    );
  });

  it("冲击关闭：无需流动性、不抛错，显式 0 + impactApplied=false", () => {
    const off: CostModelDeclaration = {
      ...decl,
      marketImpact: { ...DEFAULT_MARKET_IMPACT_PARAMS, enabled: false },
    };
    const b = computeFillCostBreakdown({
      side: "buy",
      price: 10.2,
      basePrice: 10,
      quantity: 1000,
      referenceAmountKqian: null,
      declaration: off,
    });
    expect(b.impactApplied).toBe(false);
    expect(b.impactBps).toBe(0);
    expect(b.participation).toBeNull();
    expect(b.marketImpact).toBe(0);
    expect(b.cashFees).toBeGreaterThan(0); // 现金费用照常
  });

  it("冲击启用而流动性缺失 → 响亮抛错（不静默给 0）", () => {
    expect(() =>
      computeFillCostBreakdown({
        side: "buy",
        price: 10.2,
        basePrice: 10,
        quantity: 1000,
        referenceAmountKqian: null,
        declaration: decl,
      })
    ).toThrowError(/参考成交额/);
    expect(() =>
      computeFillCostBreakdown({
        side: "buy",
        price: 10.2,
        basePrice: 10,
        quantity: 1000,
        referenceAmountKqian: 0,
        declaration: decl,
      })
    ).toThrowError(CostModel14Error);
  });

  it("成交价/数量非法 → FILL_INPUT_INVALID", () => {
    const base = {
      side: "buy" as const,
      basePrice: 10,
      quantity: 1000,
      referenceAmountKqian: refKqian,
      declaration: decl,
    };
    expect(() =>
      computeFillCostBreakdown({ ...base, price: 0 })
    ).toThrowError(/price/);
    expect(() =>
      computeFillCostBreakdown({ ...base, price: 10, quantity: -5 })
    ).toThrowError(/quantity/);
  });

  it("确定性：同成交两次分解完全相等", () => {
    const input = {
      side: "buy" as const,
      price: 10.2,
      basePrice: 10,
      quantity: 1000,
      referenceAmountKqian: refKqian,
      declaration: decl,
    };
    expect(computeFillCostBreakdown(input)).toEqual(
      computeFillCostBreakdown(input)
    );
  });
});

describe("⑥ mapper：声明 ↔ engine CostModel（simulator 配置面可消费）", () => {
  it("toEngineCostModel 六字段投影正确", () => {
    const engineModel = toEngineCostModel(A_SHARE_DEFAULT_COST_DECLARATION);
    expect(engineModel).toEqual({
      commissionRate: 0.00025,
      stampDutyRate: 0.0005,
      transferFeeRate: 0.00001,
      slippageBps: 10,
      lotSize: 100,
      minCommission: 5,
    });
  });

  it("映射结果可直接进入 simulator SimulationConfig.cost（类型即消费面）", () => {
    const engineModel = toEngineCostModel(A_SHARE_DEFAULT_COST_DECLARATION);
    const simConfig: SimulationConfig = {
      initialCapital: 1_000_000,
      cost: engineModel,
    };
    expect(simConfig.cost).toBe(engineModel);
    expect(simConfig.cost.lotSize).toBe(100);
  });

  it("round-trip：toEngine → fromEngine（同名同冲击）恢复原声明", () => {
    const decl = A_SHARE_DEFAULT_COST_DECLARATION;
    const restored = fromEngineCostModel(
      toEngineCostModel(decl),
      decl.marketImpact,
      decl.name
    );
    expect(restored).toEqual(decl);
  });

  it("engine CostModel 投影不回写冲击（engine 无此字段，声明侧保留）", () => {
    const decl = A_SHARE_DEFAULT_COST_DECLARATION;
    const engineModel = toEngineCostModel(decl);
    expect(engineModel).not.toHaveProperty("marketImpact");
    expect(decl.marketImpact.enabled).toBe(true); // 冲击仍在声明层
  });

  it("fromEngineCostModel 不改动入参（engine 模型只读）", () => {
    const engineModel = toEngineCostModel(A_SHARE_DEFAULT_COST_DECLARATION);
    const snapshot = JSON.stringify(engineModel);
    fromEngineCostModel(engineModel, DEFAULT_MARKET_IMPACT_PARAMS);
    expect(JSON.stringify(engineModel)).toBe(snapshot);
  });
});
