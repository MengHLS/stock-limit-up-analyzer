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

describe("mapDeclaredExitPolicy", () => {
  it("把首板回踩的止损/止盈/持有期映射为可执行政策", () => {
    expect(mapDeclaredExitPolicy([STOP, TAKE, TIME], {})).toEqual({
      stopLossRatio: 0.08,
      takeProfitRatio: 0.15,
      maxHoldingDays: 3,
    });
  });

  it("参数引用退出阈值时从已解析参数集取值", () => {
    expect(
      mapDeclaredExitPolicy(
        [{ ...STOP, threshold: undefined, parameter: "stopLoss" }],
        { stopLoss: 0.05 },
      ),
    ).toEqual({ stopLossRatio: 0.05, takeProfitRatio: null, maxHoldingDays: null });
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
});
