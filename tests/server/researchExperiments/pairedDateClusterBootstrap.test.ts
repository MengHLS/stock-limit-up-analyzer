/**
 * `OBSERVATION-WINDOW-003` · **配对**日期聚类移动块 bootstrap 仪器测试。
 *
 * 覆盖新增的 `movingBlockBootstrapPairedRatioDifference` /
 * `movingBlockBootstrapPairedMeanDifference`：
 *   - 两臂共享**同一条**块索引抽样序列，分子/分母同步重采样；
 *   - 区间包含 `pointEstimate`（点估计取自**未抽样全量数据**，不是迭代均值）；
 *   - 同臂自比 ⇒ 点估计 0、区间跨越 0；
 *   - 确定性（同 seed 两次输出逐字段相同）；
 *   - `zeroDenominatorIterations` 单列计数（抽样块内无观测 ⇒ 跳过且不静默丢弃）；
 *   - `quantiles` 回写（缺省 95% 双侧 / 自定义 97.5% Bonferroni 更宽）；
 *   - 日历外观测计入 `ignoredObservationCount`，`clusterCount` 用两臂并集。
 *
 * 另加**回归守卫**：旧 `movingBlockBootstrapDifference` 对固定输入的输出数字冻结，
 * 且调用新函数**不会**改变旧函数的返回值（纯增量、无共享可变状态）。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOOTSTRAP_QUANTILES,
  movingBlockBootstrapDifference,
  movingBlockBootstrapPairedMeanDifference,
  movingBlockBootstrapPairedRatioDifference,
  type PairedClusterObservation,
} from "../../../research-experiments/shared/dateClusterBootstrap";

/** 97.5% 双侧（Bonferroni 两主臂口径），与既有 MVP 测试同式。 */
const CI_QUANTILES = { low: 0.0125, high: 0.9875 } as const;

/** 生成 `count` 个升序工作日（跳过周末），格式 YYYY-MM-DD。 */
function calendarOf(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(2021, 0, 4));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * 固定 fixture：240 个工作日的完整日历，两个臂**共用**这条日历。
 * A 在 `index % 3 !== 0` 的日子有观测，B 在 `index % 4 !== 0` 的日子有观测，
 * 两侧每天都有非零分母（mock 掉「无交易」的日子不会污染确定性断言）。
 */
function buildFixture(): {
  readonly calendar: string[];
  readonly arms: Record<string, PairedClusterObservation[]>;
} {
  const calendar = calendarOf(240);
  const armA: PairedClusterObservation[] = [];
  const armB: PairedClusterObservation[] = [];
  for (let index = 0; index < calendar.length; index += 1) {
    if (index % 3 !== 0) {
      armA.push({
        date: calendar[index]!,
        hits: 1 + (index % 2),
        completed: 4 + (index % 3),
        sumReturn: 0.02 + (index % 5) * 0.01,
      });
    }
    if (index % 4 !== 0) {
      armB.push({
        date: calendar[index]!,
        hits: 1,
        completed: 5 + (index % 2),
        sumReturn: 0.01 + (index % 7) * 0.005,
      });
    }
  }
  return { calendar, arms: { A: armA, B: armB } };
}

function sumHits(observations: readonly PairedClusterObservation[]): number {
  return observations.reduce((total, item) => total + item.hits, 0);
}

function sumCompleted(observations: readonly PairedClusterObservation[]): number {
  return observations.reduce((total, item) => total + item.completed, 0);
}

function sumReturn(observations: readonly PairedClusterObservation[]): number {
  return observations.reduce((total, item) => total + item.sumReturn, 0);
}

describe("配对日期聚类 bootstrap · 共同抽样", () => {
  it("两臂共享一条日历：区间包含全量点估计（比例型）", () => {
    const { calendar, arms } = buildFixture();
    const result = movingBlockBootstrapPairedRatioDifference({
      calendar,
      arms,
      compare: ["A", "B"],
    })!;

    expect(result).not.toBeNull();
    expect(result.calendarLength).toBe(calendar.length);
    expect(result.iterations).toBe(1_000);
    expect(result.blockLength).toBe(20);
    expect(result.low).toBeLessThan(result.high);
    expect(result.low).toBeLessThanOrEqual(result.pointEstimate);
    expect(result.high).toBeGreaterThanOrEqual(result.pointEstimate);

    // 点估计 = 全量（未抽样）数据的 hits/completed 之差，而不是迭代均值。
    const expected =
      sumHits(arms.A!) / sumCompleted(arms.A!) -
      sumHits(arms.B!) / sumCompleted(arms.B!);
    expect(result.pointEstimate).toBeCloseTo(expected, 12);
  });

  it("均值型（sumReturn / completed）区间同样包含全量点估计", () => {
    const { calendar, arms } = buildFixture();
    const result = movingBlockBootstrapPairedMeanDifference({
      calendar,
      arms,
      compare: ["A", "B"],
    })!;

    expect(result.low).toBeLessThan(result.high);
    expect(result.low).toBeLessThanOrEqual(result.pointEstimate);
    expect(result.high).toBeGreaterThanOrEqual(result.pointEstimate);

    const expected =
      sumReturn(arms.A!) / sumCompleted(arms.A!) -
      sumReturn(arms.B!) / sumCompleted(arms.B!);
    expect(result.pointEstimate).toBeCloseTo(expected, 12);
  });

  it("同一臂自比 ⇒ 点估计 0 且区间跨越 0", () => {
    const { calendar, arms } = buildFixture();
    const identical = {
      LEFT: arms.A!,
      RIGHT: arms.A!.map((item) => ({ ...item })),
    };

    for (const result of [
      movingBlockBootstrapPairedRatioDifference({
        calendar,
        arms: identical,
        compare: ["LEFT", "RIGHT"],
      }),
      movingBlockBootstrapPairedMeanDifference({
        calendar,
        arms: identical,
        compare: ["LEFT", "RIGHT"],
      }),
    ]) {
      expect(result).not.toBeNull();
      expect(result!.pointEstimate).toBe(0);
      expect(result!.low).toBeLessThanOrEqual(0);
      expect(result!.high).toBeGreaterThanOrEqual(0);
    }
  });

  it("确定性：同 seed 两次调用逐字段相同（换 seed 才变）", () => {
    const { calendar, arms } = buildFixture();
    const args = { calendar, arms, compare: ["A", "B"] as const };

    const first = movingBlockBootstrapPairedRatioDifference({
      ...args,
      seed: 42,
    });
    const second = movingBlockBootstrapPairedRatioDifference({
      ...args,
      seed: 42,
    });
    expect(second).toEqual(first);

    const meanFirst = movingBlockBootstrapPairedMeanDifference({
      ...args,
      seed: 42,
    });
    const meanSecond = movingBlockBootstrapPairedMeanDifference({
      ...args,
      seed: 42,
    });
    expect(meanSecond).toEqual(meanFirst);

    const otherSeed = movingBlockBootstrapPairedRatioDifference({
      ...args,
      seed: 43,
    })!;
    // 点估计不看 seed；区间必须不同（否则说明 seed 没进 PRNG）。
    expect(otherSeed.pointEstimate).toBe(first!.pointEstimate);
    expect([otherSeed.low, otherSeed.high]).not.toEqual([first!.low, first!.high]);
  });

  it("某臂在抽样块内无观测 ⇒ 计入 zeroDenominatorIterations 且不推入该轮", () => {
    const calendar = calendarOf(240);
    const wide: PairedClusterObservation[] = calendar.map((date) => ({
      date,
      hits: 1,
      completed: 3,
      sumReturn: 0.03,
    }));
    const single: PairedClusterObservation[] = [
      { date: calendar[10]!, hits: 2, completed: 4, sumReturn: 0.08 },
    ];

    const result = movingBlockBootstrapPairedRatioDifference({
      calendar,
      arms: { WIDE: wide, SINGLE: single },
      compare: ["WIDE", "SINGLE"],
      blockLength: 1,
    })!;

    expect(result).not.toBeNull();
    // blockLength=1 时每轮抽 240 个单索引；SINGLE 仅有一个观测日 ⇒ 约 37% 轮次被跳过。
    expect(result.zeroDenominatorIterations).toBeGreaterThan(0);
    expect(result.zeroDenominatorIterations).toBeLessThan(result.iterations);
    expect(result.blockLength).toBe(1);
  });

  it("quantiles 回写：缺省 95% 双侧，自定义 97.5% 双侧更宽", () => {
    const { calendar, arms } = buildFixture();
    const args = { calendar, arms, compare: ["A", "B"] as const };

    const implicit = movingBlockBootstrapPairedRatioDifference({ ...args })!;
    expect(implicit.quantiles).toEqual(DEFAULT_BOOTSTRAP_QUANTILES);
    expect(implicit.quantiles).toEqual({ low: 0.025, high: 0.975 });

    const explicit = movingBlockBootstrapPairedRatioDifference({
      ...args,
      quantiles: { low: 0.025, high: 0.975 },
    })!;
    expect(explicit).toEqual(implicit);

    const bonferroni = movingBlockBootstrapPairedRatioDifference({
      ...args,
      quantiles: CI_QUANTILES,
    })!;
    expect(bonferroni.quantiles).toEqual(CI_QUANTILES);
    expect(bonferroni.low).toBeLessThanOrEqual(implicit.low);
    expect(bonferroni.high).toBeGreaterThanOrEqual(implicit.high);

    const meanBonferroni = movingBlockBootstrapPairedMeanDifference({
      ...args,
      quantiles: CI_QUANTILES,
    })!;
    expect(meanBonferroni.quantiles).toEqual(CI_QUANTILES);
  });

  it("日历外观测计入 ignoredObservationCount；clusterCount = 两臂观测日并集", () => {
    const calendar = calendarOf(120);
    const result = movingBlockBootstrapPairedRatioDifference({
      calendar,
      arms: {
        A: [
          { date: calendar[0]!, hits: 1, completed: 2, sumReturn: 0.01 },
          { date: calendar[1]!, hits: 3, completed: 4, sumReturn: 0.04 },
          { date: "2019-01-02", hits: 9, completed: 9, sumReturn: 9 },
        ],
        B: [
          { date: calendar[5]!, hits: 1, completed: 2, sumReturn: 0.02 },
          { date: "2018-12-31", hits: 5, completed: 5, sumReturn: 5 },
        ],
      },
      compare: ["A", "B"],
      blockLength: 1,
    })!;

    expect(result.ignoredObservationCount).toBe(2);
    expect(result.clusterCount).toBe(3);
    expect(result.calendarLength).toBe(calendar.length);
  });

  it("前置条件不满足 ⇒ null（空日历 / 缺臂 / 全量分母为 0 / 有效迭代不足 50）", () => {
    const { calendar, arms } = buildFixture();

    expect(
      movingBlockBootstrapPairedRatioDifference({
        calendar: [],
        arms,
        compare: ["A", "B"],
      })
    ).toBeNull();

    expect(
      movingBlockBootstrapPairedRatioDifference({
        calendar,
        arms,
        compare: ["A", "MISSING"],
      })
    ).toBeNull();

    expect(
      movingBlockBootstrapPairedRatioDifference({
        calendar,
        arms: {
          A: arms.A!,
          B: [{ date: "2019-01-02", hits: 1, completed: 1, sumReturn: 0.1 }],
        },
        compare: ["A", "B"],
      })
    ).toBeNull();

    // blockLength=1 ⇒ 每轮只抽单索引；两臂各只有 1 个观测日 ⇒ 每轮「两臂都被抽到」
    // 的概率 ≈ (1 − 1/e)² ≈ 0.4，迭代下限被夹到 100 ⇒ 有效轮次 ≈ 40 < 50 ⇒ null。
    const wideCalendar = calendarOf(1_000);
    expect(
      movingBlockBootstrapPairedRatioDifference({
        calendar: wideCalendar,
        arms: {
          A: [{ date: wideCalendar[7]!, hits: 1, completed: 1, sumReturn: 0.01 }],
          B: [{ date: wideCalendar[500]!, hits: 1, completed: 1, sumReturn: 0.02 }],
        },
        compare: ["A", "B"],
        blockLength: 1,
        iterations: 100,
      })
    ).toBeNull();
  });
});

describe("回归守卫 · 旧 movingBlockBootstrapDifference 数字冻结", () => {
  const samples = Array.from({ length: 60 }, (_, index) => ({
    eventDate: `2024-01-${String((index % 28) + 1).padStart(2, "0")}`,
    value: Math.sin(index) * 0.1,
  }));
  const negative = samples.map((item) => ({ ...item, value: 0 }));

  it("固定输入 ⇒ 逐字段等于既有（未改动前的）输出", () => {
    expect(
      movingBlockBootstrapDifference({ positive: samples, negative })
    ).toEqual({
      low: -0.0005855682894457809,
      high: 0.006441172005377052,
      iterations: 1_000,
      blockLength: 20,
      clusterCount: 28,
      seed: 20_260_922,
    });
  });

  it("调用新配对函数不改变旧函数的返回值（无共享状态 / 纯增量）", () => {
    const before = movingBlockBootstrapDifference({
      positive: samples,
      negative,
    });

    const { calendar, arms } = buildFixture();
    movingBlockBootstrapPairedRatioDifference({ calendar, arms, compare: ["A", "B"] });
    movingBlockBootstrapPairedMeanDifference({ calendar, arms, compare: ["A", "B"] });

    const after = movingBlockBootstrapDifference({ positive: samples, negative });
    expect(after).toEqual(before);
  });
});
