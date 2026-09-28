import { describe, expect, it } from "vitest";
import type { ExitRuleDefinition } from "../../../server/research/strategySchema/definition";
import { mapDeclaredExitPolicy } from "../../../server/runWorkbenchAssembly/exitPolicy";

const STOP: ExitRuleDefinition = {
  id: "exit-stop-loss",
  type: "STOP_LOSS",
  trigger: "INTRADAY",
  threshold: 0.08,
  thresholdUnit: "RATIO",
  priority: 1,
  enabled: true,
};
const TAKE: ExitRuleDefinition = {
  id: "exit-take-profit",
  type: "TAKE_PROFIT",
  trigger: "INTRADAY",
  threshold: 15,
  thresholdUnit: "PERCENT",
  priority: 2,
  enabled: true,
};
const TIME: ExitRuleDefinition = {
  id: "exit-time-exit",
  type: "TIME_EXIT",
  trigger: "ON_CLOSE",
  threshold: 3,
  thresholdUnit: "TRADING_DAY",
  priority: 3,
  enabled: true,
};

const TRAILING: ExitRuleDefinition = {
  id: "exit-trailing-take-profit",
  type: "TRAILING_TAKE_PROFIT",
  trigger: "ON_CLOSE",
  threshold: 5,
  thresholdUnit: "PERCENT",
  priority: 4,
  enabled: true,
};

describe("mapDeclaredExitPolicy", () => {
  it("把首板回踩的止损/止盈/持有期映射为可执行政策", () => {
    expect(mapDeclaredExitPolicy([STOP, TAKE, TIME], {})).toEqual({
      stopLossRatio: 0.08,
      takeProfitRatio: 0.15,
      maxHoldingDays: 3,
      trailingTakeProfitActivationRatio: null,
      trailingTakeProfitDrawdownRatio: null,
      trailingTakeProfitTrigger: null,
      advancedTrailingPolicy: null,
      advancedStopPolicy: null,
      strongHold: null,
    });
  });

  it("把收盘盈利回撤止盈映射为峰值盈利后回撤 5%", () => {
    expect(mapDeclaredExitPolicy([TRAILING], {})).toEqual({
      stopLossRatio: null,
      takeProfitRatio: null,
      maxHoldingDays: null,
      trailingTakeProfitActivationRatio: 0,
      trailingTakeProfitDrawdownRatio: 0.05,
      trailingTakeProfitTrigger: "ON_CLOSE",
      advancedTrailingPolicy: null,
      advancedStopPolicy: null,
      strongHold: null,
    });
  });

  it("把盘中盈利回撤止盈映射为 INTRADAY", () => {
    expect(
      mapDeclaredExitPolicy([{ ...TRAILING, trigger: "INTRADAY" }], {}),
    ).toEqual({
      stopLossRatio: null,
      takeProfitRatio: null,
      maxHoldingDays: null,
      trailingTakeProfitActivationRatio: 0,
      trailingTakeProfitDrawdownRatio: 0.05,
      trailingTakeProfitTrigger: "INTRADAY",
      advancedTrailingPolicy: null,
      advancedStopPolicy: null,
      strongHold: null,
    });
  });

  it("参数引用退出阈值时从已解析参数集取值", () => {
    expect(
      mapDeclaredExitPolicy(
        [{ ...STOP, threshold: undefined, parameter: "stopLoss" }],
        { stopLoss: 0.05 },
      ),
    ).toEqual({
      stopLossRatio: 0.05,
      takeProfitRatio: null,
      maxHoldingDays: null,
      trailingTakeProfitActivationRatio: null,
      trailingTakeProfitDrawdownRatio: null,
      trailingTakeProfitTrigger: null,
      advancedTrailingPolicy: null,
      advancedStopPolicy: null,
      strongHold: null,
    });
  });

  it("带 condition 的阈值退出不能静默降级", () => {
    expect(() =>
      mapDeclaredExitPolicy(
        [
          {
            ...STOP,
            condition: {
              field: "bar.close",
              operator: "LESS_THAN_OR_EQUAL",
              value: 9,
              valueType: "CONSTANT",
              enabled: true,
            },
          },
        ],
        {},
      ),
    ).toThrow(/不能降级/);
  });

  it("高级移动止盈映射到 advancedTrailingPolicy", () => {
    expect(
      mapDeclaredExitPolicy(
        [{
          id: "exit-trailing-take-profit",
          type: "TRAILING_TAKE_PROFIT",
          trigger: "ON_CLOSE",
          trailingPolicy: {
            kind: "ATR_CHANDELIER",
            atrWindow: 10,
            atrMultiplier: 2.5,
            activationRatio: 0,
          },
          priority: 2,
          enabled: true,
        }],
        {},
      ),
    ).toMatchObject({
      trailingTakeProfitDrawdownRatio: null,
      trailingTakeProfitTrigger: "ON_CLOSE",
      advancedTrailingPolicy: {
        kind: "ATR_CHANDELIER",
        atrWindow: 10,
        atrMultiplier: 2.5,
        activationRatio: 0,
      },
    });
  });

  it("统一固定盘中止损回落到旧 stopLossRatio 路径", () => {
    const mapped = mapDeclaredExitPolicy(
      [{
        id: "exit-unified-policy",
        type: "STOP_LOSS",
        trigger: "ON_CLOSE",
        policy: {
          stop: {
            anchor: { kind: "FIXED_PERCENT", stopRatio: 0.06 },
            confirmation: "INTRADAY",
          },
          takeProfit: null,
          timeExit: null,
          strongHold: null,
          capitalRecycle: null,
        },
        priority: 0,
        enabled: true,
      }],
      {},
    );
    expect(mapped?.stopLossRatio).toBe(0.06);
    expect(mapped?.advancedStopPolicy).toBeNull();
  });
});
