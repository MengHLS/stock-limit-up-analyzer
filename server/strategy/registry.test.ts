/**
 * Strategy Registry 单元测试。
 *
 * 覆盖：注册/查询/列表、重复 id 报错、未知 id 报错、便捷评估（规范化配置）。
 */

import { describe, expect, it } from "vitest";
import { emptyDecision, type Strategy, type StrategyConfig, type StrategyContext, type StrategyDecision } from "./contract";
import { StrategyRegistry } from "./registry";

interface TestConfig extends StrategyConfig {
  label: string;
}
interface TestData {
  value: number;
}

function makeStrategy(id: string): Strategy<TestConfig, TestData> {
  return {
    metadata: {
      id, name: `策略-${id}`, version: "1.0.0", description: "test", category: "test",
      requiredData: ["value"], supportsLong: true, supportsShort: false, supportsIntraday: false,
    },
    defaultConfig: { label: "default" },
    normalizeConfig(raw = {}) {
      return { label: typeof raw.label === "string" ? raw.label : this.defaultConfig.label };
    },
    evaluate(context: StrategyContext<TestConfig, TestData>): StrategyDecision {
      return { signals: [], strategyVersion: this.metadata.version, insufficientData: context.data.value < 0 };
    },
  };
}

const portfolio = { cash: 0, equity: 0, openPositionCount: 0, openPositionSymbols: [] as readonly string[] };

describe("StrategyRegistry", () => {
  it("register 后可按 id get 并列出元数据", () => {
    const registry = new StrategyRegistry();
    registry.register(makeStrategy("alpha"));
    registry.register(makeStrategy("beta"));
    expect(registry.has("alpha")).toBe(true);
    expect(registry.get("alpha").metadata.name).toBe("策略-alpha");
    expect(registry.list().map((m) => m.id)).toEqual(["alpha", "beta"]);
  });

  it("重复注册相同 id 抛错", () => {
    const registry = new StrategyRegistry();
    registry.register(makeStrategy("dup"));
    expect(() => registry.register(makeStrategy("dup"))).toThrow(/已注册/);
  });

  it("查询未知 id 抛错", () => {
    const registry = new StrategyRegistry();
    expect(() => registry.get("unknown")).toThrow(/未注册/);
    expect(registry.has("unknown")).toBe(false);
  });

  it("evaluate 规范化配置后评估，并透传数据充分性", () => {
    const registry = new StrategyRegistry();
    registry.register(makeStrategy("alpha"));
    const decision = registry.evaluate("alpha", "T", { value: -1 }, portfolio);
    expect(decision.strategyVersion).toBe("1.0.0");
    expect(decision.insufficientData).toBe(true);
  });

  it("list 返回按 id 排序且是元数据副本", () => {
    const registry = new StrategyRegistry();
    registry.register(makeStrategy("b"));
    registry.register(makeStrategy("a"));
    const listed = registry.list();
    expect(listed.map((m) => m.id)).toEqual(["a", "b"]);
    listed[0]!.name = "篡改";
    expect(registry.list()[0]!.name).not.toBe("篡改");
  });

  it("emptyDecision 工厂返回空决策", () => {
    expect(emptyDecision("1.0.0", true)).toEqual({ signals: [], strategyVersion: "1.0.0", insufficientData: true });
  });
});
