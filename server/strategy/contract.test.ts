/**
 * Strategy Contract 单元测试。
 *
 * 覆盖：契约形态、BUY/SELL/HOLD 信号、数据不足、配置规范化、确定性、
 * 只读组合上下文、架构依赖边界（策略层不得依赖 execution/portfolio 可变 API/db/网络）。
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emptyDecision,
  type ReadonlyPortfolioContext,
  type Strategy,
  type StrategyAction,
  type StrategyConfig,
} from "./contract";

interface FixtureConfig extends StrategyConfig {
  threshold: number;
}
interface FixtureData {
  prices: number[];
}

const fixtureStrategy: Strategy<FixtureConfig, FixtureData> = {
  metadata: {
    id: "fixture-reversion",
    name: "fixture",
    version: "1.0.0",
    description: "测试用阈值策略",
    category: "test",
    requiredData: ["prices"],
    supportsLong: true,
    supportsShort: true,
    supportsIntraday: false,
  },
  defaultConfig: { threshold: 1 },
  normalizeConfig(raw = {}) {
    const threshold = typeof raw.threshold === "number" && Number.isFinite(raw.threshold)
      ? raw.threshold
      : this.defaultConfig.threshold;
    return { threshold };
  },
  evaluate({ signalTime, data, config }) {
    const last = data.prices.at(-1);
    if (last === undefined) return emptyDecision(this.metadata.version, true);
    const action: StrategyAction = last > config.threshold ? "BUY" : last < -config.threshold ? "SELL" : "HOLD";
    return {
      signals: [{ symbol: "TEST.SH", signalTime, action, score: last, confidence: Math.min(1, Math.abs(last) / 10) }],
      strategyVersion: this.metadata.version,
      insufficientData: false,
    };
  },
};

const portfolio = (): ReadonlyPortfolioContext => ({
  cash: 100000,
  equity: 100000,
  openPositionCount: 0,
  openPositionSymbols: [],
});

describe("Strategy Contract 契约形态", () => {
  it("策略定义具备 metadata/defaultConfig/normalizeConfig/evaluate，并可被评估", () => {
    expect(fixtureStrategy.metadata.id).toBe("fixture-reversion");
    expect(typeof fixtureStrategy.normalizeConfig).toBe("function");
    expect(typeof fixtureStrategy.evaluate).toBe("function");
    const decision = fixtureStrategy.evaluate({
      signalTime: "2026-08-18",
      data: { prices: [1, 2] },
      portfolio: portfolio(),
      config: fixtureStrategy.defaultConfig,
    });
    expect(decision.strategyVersion).toBe("1.0.0");
  });

  it("BUY 信号：价格上穿阈值产生 BUY", () => {
    const decision = fixtureStrategy.evaluate({
      signalTime: "T", data: { prices: [2] }, portfolio: portfolio(), config: { threshold: 1 },
    });
    expect(decision.signals).toHaveLength(1);
    expect(decision.signals[0]!.action).toBe("BUY");
  });

  it("SELL 信号：价格跌破负阈值产生 SELL", () => {
    const decision = fixtureStrategy.evaluate({
      signalTime: "T", data: { prices: [-2] }, portfolio: portfolio(), config: { threshold: 1 },
    });
    expect(decision.signals[0]!.action).toBe("SELL");
  });

  it("HOLD 信号：价格在阈值区间内产生 HOLD", () => {
    const decision = fixtureStrategy.evaluate({
      signalTime: "T", data: { prices: [0] }, portfolio: portfolio(), config: { threshold: 1 },
    });
    expect(decision.signals[0]!.action).toBe("HOLD");
  });

  it("数据不足：空价格序列返回 insufficientData=true 且无信号", () => {
    const decision = fixtureStrategy.evaluate({
      signalTime: "T", data: { prices: [] }, portfolio: portfolio(), config: { threshold: 1 },
    });
    expect(decision.insufficientData).toBe(true);
    expect(decision.signals).toHaveLength(0);
  });
});

describe("Strategy Config 配置规范化", () => {
  it("缺失字段回填默认值", () => {
    const normalized = fixtureStrategy.normalizeConfig({});
    expect(normalized).toEqual({ threshold: 1 });
  });

  it("合法字段保留，非法字段回退默认", () => {
    expect(fixtureStrategy.normalizeConfig({ threshold: 5 })).toEqual({ threshold: 5 });
    expect(fixtureStrategy.normalizeConfig({ threshold: Number.NaN })).toEqual({ threshold: 1 });
  });
});

describe("确定性", () => {
  it("相同输入两次评估结果深度相等", () => {
    const make = () => fixtureStrategy.evaluate({
      signalTime: "T", data: { prices: [1, 2, 3] }, portfolio: portfolio(), config: { threshold: 1 },
    });
    expect(make()).toEqual(make());
  });
});

describe("只读组合上下文", () => {
  it("策略不得修改组合快照", () => {
    const snapshot = portfolio();
    const frozen = Object.freeze({ ...snapshot, openPositionSymbols: Object.freeze([...snapshot.openPositionSymbols]) });
    const before = JSON.stringify(frozen);
    fixtureStrategy.evaluate({
      signalTime: "T", data: { prices: [2] }, portfolio: frozen, config: { threshold: 1 },
    });
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe("架构依赖边界", () => {
  const forbidden = [
    "../engine/execution", "./execution",
    "../engine/portfolio", "./portfolio",
    "../db", "./db", "mysql2", "drizzle",
    "../tushare", "./tushare", "axios",
    "node:http", "node:https", "fetch(",
    "Math.random", "Date.now",
  ];

  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("契约层不依赖执行/组合可变 API/数据库/网络", () => {
    for (const source of ["contract.ts", "registry.ts", "strategies/leaderCandidateBaseline.ts"]) {
      const text = read(`./${source}`);
      for (const token of forbidden) {
        expect(text, `${source} 不应包含 "${token}"`).not.toContain(token);
      }
    }
  });
});
