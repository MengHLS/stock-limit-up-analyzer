/**
 * strategyListAdapter — 策略列表卡片聚合测试。
 *
 * 重点是「不伪造」：
 *   - 每张卡片只挂自己 strategyId 的回测留档（不串号）；
 *   - 最近一次按 createdAt 倒序取第一条（不按 id / 不按输入顺序）；
 *   - 缺失的资金 / 成交数如实为 null，由展示层渲染「—」，不补 0；
 *   - 已删除策略的历史留档不生成卡片。
 */

import { describe, expect, it } from "vitest";
import {
  buildStrategyCards,
  summarizeStrategyCards,
  formatMoney,
  formatCount,
} from "../../../../client/src/adapters/strategyListAdapter";

function strategy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    strategyId: "limit-up-baseline",
    name: "涨停候选基线",
    latestVersion: "1.0.0",
    status: "Active",
    description: "基线",
    strategyType: "BASELINE",
    currentVersionId: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    ...overrides,
  };
}

function archive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    strategyId: "limit-up-baseline",
    strategyVersion: "1.0.0",
    runId: "run-1",
    createdAt: "2026-09-03T00:00:00.000Z",
    startDate: "2025-01-01",
    endDate: "2025-06-30",
    status: "ALL_EXECUTED",
    initialCapital: 100000,
    finalEquity: 123456,
    tradeCount: 42,
    ...overrides,
  };
}

describe("buildStrategyCards", () => {
  it("按 strategyId 精确挂靠留档，最近一次按 createdAt 倒序", () => {
    const cards = buildStrategyCards(
      [strategy(), strategy({ strategyId: "other", name: "另一策略", strategyType: null })],
      [
        archive({ id: 1, createdAt: "2026-09-03T00:00:00.000Z", finalEquity: 111 }),
        archive({ id: 2, createdAt: "2026-09-05T00:00:00.000Z", finalEquity: 222 }),
        archive({ id: 3, strategyId: "other", createdAt: "2026-09-04T00:00:00.000Z", finalEquity: 333 }),
      ],
    );

    expect(cards).toHaveLength(2);
    const baseline = cards.find(card => card.strategyId === "limit-up-baseline");
    const other = cards.find(card => card.strategyId === "other");

    expect(baseline?.backtestCount).toBe(2);
    expect(baseline?.latestBacktest?.archiveId).toBe(2);
    expect(baseline?.latestBacktest?.finalEquity).toBe(222);
    expect(other?.backtestCount).toBe(1);
    expect(other?.latestBacktest?.archiveId).toBe(3);
  });

  it("没有留档 → latestBacktest=null 且计数为 0；缺失字段保持 null", () => {
    const cards = buildStrategyCards(
      [strategy()],
      [archive({ initialCapital: null, finalEquity: null, tradeCount: null })],
    );
    expect(cards[0].latestBacktest?.initialCapital).toBeNull();
    expect(cards[0].latestBacktest?.finalEquity).toBeNull();
    expect(cards[0].latestBacktest?.tradeCount).toBeNull();
    expect(formatMoney(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");

    const noArchive = buildStrategyCards([strategy({ strategyId: "no-archive" })], []);
    expect(noArchive[0].backtestCount).toBe(0);
    expect(noArchive[0].latestBacktest).toBeNull();
  });

  it("已删除策略的历史留档不生成卡片", () => {
    const cards = buildStrategyCards([strategy()], [archive({ strategyId: "deleted-strategy" })]);
    expect(cards).toHaveLength(1);
    expect(cards[0].backtestCount).toBe(0);
  });

  it("卡片按 updatedAt 倒序；未知状态 / 类型如实透传", () => {
    const cards = buildStrategyCards(
      [
        strategy({ strategyId: "old", updatedAt: "2026-09-01T00:00:00.000Z" }),
        strategy({
          strategyId: "new",
          updatedAt: "2026-09-09T00:00:00.000Z",
          strategyType: "FUTURE_TYPE",
          status: "Frozen",
        }),
      ],
      [],
    );
    expect(cards.map(card => card.strategyId)).toEqual(["new", "old"]);
    expect(cards[0].strategyType).toBe("FUTURE_TYPE");
    expect(cards[0].status).toBe("Frozen");
  });
});

describe("summarizeStrategyCards", () => {
  it("汇总计数只反映真实数据：有留档 / 已分类", () => {
    const cards = buildStrategyCards(
      [strategy(), strategy({ strategyId: "b", strategyType: null }), strategy({ strategyId: "c", strategyType: "MANUAL" })],
      [
        archive({ createdAt: "2026-09-03T00:00:00.000Z" }),
        archive({ id: 9, strategyId: "c", createdAt: "2026-09-08T00:00:00.000Z" }),
      ],
    );
    const summary = summarizeStrategyCards(cards);
    expect(summary.totalStrategies).toBe(3);
    expect(summary.withBacktest).toBe(2);
    expect(summary.typedStrategies).toBe(2);
    expect(summary.latestBacktestAt).toBe("2026-09-08T00:00:00.000Z");
  });
});
