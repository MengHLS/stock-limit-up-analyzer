/**
 * `client/src/lib/fullCycleRiskBlocks.ts` 行为锁。
 *
 * 本模块是「回测总览 → 全周期五策略收益对比」折线图下方收益/回撤区块的唯一派生入口，
 * 因此这里锁三类**静默失效**：
 *   ① **不新造回撤口径** —— 最大回撤 / 回撤持续时间 / 收复回撤所用时间必须原样搬运服务端值，
 *      一旦有人在这里"顺手重算"，就会与「策略对比」六层评价出现两套数。
 *   ② **收益两项的恒等变形** —— 以初始资金为基准，最大收益取曲线最高点、当前收益取期末权益；
 *      并列最高点必须取**最早**（否则同一份数据两次渲染可能给出不同日期）。
 *   ③ **降级纪律** —— 初始资金非正 / 无有效权益点时一律返回空，由展示层回显「样本不足」，
 *      不得用 0 或上一笔权益兜底（这正是纸面交易里"静默永不出清"那类事故的同型风险）。
 */

import { describe, expect, it } from "vitest";

import {
  buildFullCycleRiskBlocks,
  summarizeEquityCurveReturns,
  type FullCycleRiskBlockInput,
} from "@/lib/fullCycleRiskBlocks";

const curve = (...points: Array<[string, number]>) => points.map(([date, equity]) => ({ date, equity }));

describe("summarizeEquityCurveReturns", () => {
  it("1) 最大收益取曲线最高点、当前收益取期末权益（均以初始资金为基准）", () => {
    const summary = summarizeEquityCurveReturns(curve(
      ["2024-01-02", 100000],
      ["2024-01-03", 118000],
      ["2024-01-04", 96000],
      ["2024-01-05", 121500],
      ["2024-01-08", 105000],
    ), 100000);

    expect(summary.maxReturnPercent).toBe(21.5);
    expect(summary.maxReturnDate).toBe("2024-01-05");
    expect(summary.currentReturnPercent).toBe(5);
    expect(summary.currentDate).toBe("2024-01-08");
    expect(summary.pointCount).toBe(5);
  });

  it("2) 并列最高点取最早出现的一次（渲染稳定，不随遍历顺序漂移）", () => {
    const summary = summarizeEquityCurveReturns(curve(
      ["2024-02-01", 100000],
      ["2024-02-02", 110000],
      ["2024-02-05", 110000],
      ["2024-02-06", 90000],
    ), 100000);

    expect(summary.maxReturnPercent).toBe(10);
    expect(summary.maxReturnDate).toBe("2024-02-02");
    expect(summary.currentReturnPercent).toBe(-10);
  });

  it("3) 百分数保留两位小数，不做额外四舍五入", () => {
    const summary = summarizeEquityCurveReturns(curve(
      ["2024-03-01", 100000],
      ["2024-03-04", 100333],
    ), 100000);

    expect(summary.maxReturnPercent).toBe(0.33);
    expect(summary.currentReturnPercent).toBe(0.33);
  });

  it("4) 剔除非有限值与非正权益点：它们既不参与取峰，也不被当成期末点", () => {
    const summary = summarizeEquityCurveReturns([
      { date: "2024-04-01", equity: 100000 },
      { date: "2024-04-02", equity: Number.NaN },
      { date: "2024-04-03", equity: 0 },
      { date: "2024-04-04", equity: 130000 },
      { date: "2024-04-05", equity: -5000 },
    ], 100000);

    expect(summary.pointCount).toBe(2);
    expect(summary.maxReturnDate).toBe("2024-04-04");
    expect(summary.currentDate).toBe("2024-04-04");
    expect(summary.currentReturnPercent).toBe(30);
  });

  it("5) 初始资金非正或曲线为空时返回全空（不得兜底成 0）", () => {
    const zeroCapital = summarizeEquityCurveReturns(curve(["2024-05-06", 100000]), 0);
    const negativeCapital = summarizeEquityCurveReturns(curve(["2024-05-06", 100000]), -1);
    const emptyCurve = summarizeEquityCurveReturns([], 100000);
    const allInvalid = summarizeEquityCurveReturns(curve(["2024-05-06", 0]), 100000);

    for (const summary of [zeroCapital, negativeCapital, emptyCurve, allInvalid]) {
      expect(summary).toEqual({
        maxReturnPercent: null,
        maxReturnDate: null,
        currentReturnPercent: null,
        currentDate: null,
        pointCount: 0,
      });
    }
  });
});

describe("buildFullCycleRiskBlocks", () => {
  const inputs: FullCycleRiskBlockInput[] = [
    {
      key: "baseline",
      label: "原始评分基准",
      color: "#64748b",
      maxDrawdownPercent: 12.34,
      maxDrawdownDurationTradingDays: 21,
      longestRecoveryTradingDays: 34,
      initialCapital: 100000,
      equityCurve: curve(["2024-01-02", 100000], ["2024-01-03", 95000], ["2024-01-04", 120000]),
    },
    {
      key: "riskPenalty",
      label: "风险扣分策略",
      color: "#d946ef",
      maxDrawdownPercent: 9.87,
      maxDrawdownDurationTradingDays: null,
      longestRecoveryTradingDays: null,
      initialCapital: 100000,
      equityCurve: curve(["2024-01-02", 100000], ["2024-01-03", 88000]),
    },
  ];

  it("6) 回撤三项原样搬运服务端值，不在此重算", () => {
    const blocks = buildFullCycleRiskBlocks(inputs);

    expect(blocks[0]!.maxDrawdownPercent).toBe(12.34);
    expect(blocks[0]!.maxDrawdownDurationTradingDays).toBe(21);
    expect(blocks[0]!.longestRecoveryTradingDays).toBe(34);
    expect(blocks[1]!.maxDrawdownDurationTradingDays).toBeNull();
    expect(blocks[1]!.longestRecoveryTradingDays).toBeNull();
  });

  it("7) 保持传入顺序、回填收益派生值，且不把整条权益曲线带进渲染数据", () => {
    const blocks = buildFullCycleRiskBlocks(inputs);

    expect(blocks.map((block) => block.key)).toEqual(["baseline", "riskPenalty"]);
    expect(blocks[0]!).toMatchObject({
      label: "原始评分基准",
      color: "#64748b",
      maxReturnPercent: 20,
      maxReturnDate: "2024-01-04",
      currentReturnPercent: 20,
      currentDate: "2024-01-04",
      pointCount: 3,
    });
    expect(blocks[1]!.currentReturnPercent).toBe(-12);
    for (const block of blocks) expect("equityCurve" in block).toBe(false);
  });

  it("8) 空输入返回空数组（页面据此不渲染该区块）", () => {
    expect(buildFullCycleRiskBlocks([])).toEqual([]);
  });
});
