import { describe, expect, it } from "vitest";
import {
  computeTechnicalFactorValues,
  evaluateFactorEffectiveness,
} from "./technicalFactors";
import type { LeaderCandidateBacktestRow, LeaderCandidateDailyPrice } from "./leaderCandidates";

function price(overrides: Partial<LeaderCandidateDailyPrice> = {}): LeaderCandidateDailyPrice {
  return {
    openPrice: 10,
    closePrice: 11,
    highPrice: 11,
    lowPrice: 9.8,
    amount: 50_000,
    volume: 100_000,
    preClosePrice: 10,
    ...overrides,
  };
}

describe("computeTechnicalFactorValues", () => {
  it("换手率 = 成交额/流通市值（%）；量比 = 信号日成交额/前5日均值", () => {
    const context = {
      priceByStockDate: new Map<string, LeaderCandidateDailyPrice>([
        ["600001.SH::2026-08-18", price({ amount: 20_000 })],
        ["600001.SH::2026-08-19", price({ amount: 25_000 })],
        ["600001.SH::2026-08-20", price({ amount: 30_000 })],
      ]),
      tradingDates: ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"],
    };
    // 信号日 2026-08-21，前5个交易日（08-14..08-20）里只有 08-18/19/20 有数据，均值 = 25000
    const values = computeTechnicalFactorValues(
      "600001.SH",
      "2026-08-21",
      "50",
      price({ amount: 50_000, highPrice: 11, lowPrice: 9.8, openPrice: 10, closePrice: 11, preClosePrice: 10 }),
      context,
    );

    // 换手率 = 50000 / (50 * 1e5) * 100 = 1%
    expect(values.turnoverRate).toBeCloseTo(1, 4);
    // 量比 = 50000 / 25000 = 2
    expect(values.volumeRatio).toBeCloseTo(2, 4);
    // 振幅 = (11 - 9.8) / 10 * 100 = 12%
    expect(values.amplitude).toBeCloseTo(12, 4);
  });

  it("缺少流通市值时换手率为 null，但不影响其它因子", () => {
    const values = computeTechnicalFactorValues(
      "600001.SH",
      "2026-08-21",
      null,
      price({ amount: 50_000 }),
      { priceByStockDate: new Map(), tradingDates: [] },
    );
    expect(values.turnoverRate).toBeNull();
    expect(values.amplitude).toBeCloseTo(12, 4);
  });

  it("信号日为最早交易日时无量比（无前5日数据）", () => {
    const context = {
      priceByStockDate: new Map<string, LeaderCandidateDailyPrice>([
        ["600001.SH::2026-08-20", price({ amount: 50_000 })],
      ]),
      tradingDates: ["2026-08-20", "2026-08-21"],
    };
    const values = computeTechnicalFactorValues(
      "600001.SH",
      "2026-08-20",
      "50",
      price({ amount: 50_000 }),
      context,
    );
    expect(values.volumeRatio).toBeNull();
    expect(values.turnoverRate).toBeCloseTo(1, 4);
  });

  it("一字板（high≈low）振幅约 0", () => {
    const values = computeTechnicalFactorValues(
      "600001.SH",
      "2026-08-21",
      "50",
      price({ highPrice: 11, lowPrice: 11, openPrice: 11, closePrice: 11, preClosePrice: 10 }),
      { priceByStockDate: new Map(), tradingDates: [] },
    );
    expect(values.amplitude).toBeCloseTo(0, 4);
  });
});

function makeRow(overrides: Partial<LeaderCandidateBacktestRow> = {}): LeaderCandidateBacktestRow {
  return {
    stockCode: "600001.SH",
    stockName: "测试股",
    sector: "题材",
    boards: 2,
    score: 60,
    circulationValue: "50",
    marketCapScore: 12,
    date: "2026-08-18",
    nextDate: "2026-08-19",
    nextDayDate: "2026-08-19",
    secondDayDate: "2026-08-20",
    success: false,
    signalClosePrice: 10,
    nextOpenPrice: 10.5,
    nextClosePrice: 11,
    nextOpenPremium: 5,
    nextClosePremium: 10,
    secondDayOpenPrice: 11,
    secondDayClosePrice: 11.5,
    secondDayOpenPremium: 10,
    secondDayClosePremium: 15,
    tPlus1CloseToTPlus2CloseReturn: 4.55,
    tPlus1CloseToTPlus2CloseSuccess: true,
    ...overrides,
  };
}

describe("evaluateFactorEffectiveness", () => {
  it("完全正相关因子：meanIc 接近 1，分位分层单调递增", () => {
    const rows: LeaderCandidateBacktestRow[] = [];
    const dates = ["2026-08-18", "2026-08-19", "2026-08-20"];
    const factors = [1, 2, 3, 4];
    dates.forEach((date, dateIndex) => {
      factors.forEach((factor, factorIndex) => {
        rows.push(makeRow({
          stockCode: `60000${dateIndex}${factorIndex}.SH`,
          date,
          technicalFactors: { turnoverRate: factor, volumeRatio: null, amplitude: null },
          nextClosePremium: factor * 2,
        }));
      });
    });

    const report = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const ic = report.rankIc.find((item) => item.factorKey === "turnoverRate")!;
    expect(ic.meanIc).toBeCloseTo(1, 3);
    expect(ic.dailyIcCount).toBe(3);
    expect(ic.direction).toBe("positive");

    const quintile = report.quintiles.find((item) => item.factorKey === "turnoverRate")!;
    expect(quintile.monotonic).toBe(true);
    expect(quintile.monotonicDirection).toBe("increasing");
    expect(quintile.shape).toBe("monotonic_increasing");
    expect(quintile.spread!).toBeGreaterThan(0);
  });

  it("完全负相关因子：meanIc 接近 -1，分位分层单调递减", () => {
    const rows: LeaderCandidateBacktestRow[] = [];
    const factors = [1, 2, 3, 4, 5, 6];
    factors.forEach((factor, index) => {
      rows.push(makeRow({
        stockCode: `60001${index}.SH`,
        date: index < 3 ? "2026-08-18" : "2026-08-19",
        technicalFactors: { turnoverRate: factor, volumeRatio: null, amplitude: null },
        nextClosePremium: -factor,
      }));
    });

    const report = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const ic = report.rankIc.find((item) => item.factorKey === "turnoverRate")!;
    expect(ic.meanIc).toBeCloseTo(-1, 3);
    expect(ic.direction).toBe("negative");

    const quintile = report.quintiles.find((item) => item.factorKey === "turnoverRate")!;
    expect(quintile.monotonicDirection).toBe("decreasing");
    expect(quintile.shape).toBe("monotonic_decreasing");
  });

  it("因子缺失或收益缺失的样本被跳过，不参与评估", () => {
    const rows: LeaderCandidateBacktestRow[] = [
      makeRow({ stockCode: "600010.SH", date: "2026-08-18", technicalFactors: { turnoverRate: 1, volumeRatio: null, amplitude: null }, nextClosePremium: 2 }),
      makeRow({ stockCode: "600011.SH", date: "2026-08-18", technicalFactors: { turnoverRate: 2, volumeRatio: null, amplitude: null }, nextClosePremium: 4 }),
      makeRow({ stockCode: "600012.SH", date: "2026-08-18", technicalFactors: { turnoverRate: 3, volumeRatio: null, amplitude: null }, nextClosePremium: 6 }),
      // 缺失因子
      makeRow({ stockCode: "600013.SH", date: "2026-08-18", technicalFactors: { turnoverRate: null, volumeRatio: null, amplitude: null }, nextClosePremium: 8 }),
      // 缺失收益
      makeRow({ stockCode: "600014.SH", date: "2026-08-18", technicalFactors: { turnoverRate: 5, volumeRatio: null, amplitude: null }, nextClosePremium: null }),
    ];

    const report = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const ic = report.rankIc.find((item) => item.factorKey === "turnoverRate")!;
    expect(ic.sampleSize).toBe(3);
  });

  it("样本不足时不抛出，返回空 bucket 与 null 指标", () => {
    const rows: LeaderCandidateBacktestRow[] = [
      makeRow({ stockCode: "600010.SH", date: "2026-08-18", technicalFactors: { turnoverRate: 1, volumeRatio: null, amplitude: null }, nextClosePremium: 2 }),
    ];
    const report = evaluateFactorEffectiveness(rows, "nextClosePremium");
    expect(report.rankIc.length).toBe(7);
    expect(report.rankIc[0]!.meanIc).toBeNull();
    expect(report.quintiles[0]!.buckets).toEqual([]);
  });

  it("方向与分级：正相关强 IC 因子 direction=positive、strength=strong、p 值近 0", () => {
    const rows: LeaderCandidateBacktestRow[] = [];
    const dayForwards: Array<[string, number[]]> = [
      ["2026-08-18", [1, 2, 3, 4]],
      ["2026-08-19", [1, 3, 2, 4]],
      ["2026-08-20", [2, 1, 4, 3]],
    ];
    dayForwards.forEach(([date, forwards]) => {
      forwards.forEach((forward, index) => {
        rows.push(makeRow({
          stockCode: `60002${index}.SH`,
          date,
          technicalFactors: { turnoverRate: index + 1, volumeRatio: null, amplitude: null },
          nextClosePremium: forward,
        }));
      });
    });
    const report = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const ic = report.rankIc.find((item) => item.factorKey === "turnoverRate")!;
    expect(ic.direction).toBe("positive");
    expect(ic.strength).toBe("strong");
    expect(ic.effective).toBe(true);
    expect(ic.meanIc!).toBeGreaterThan(0.5);
    expect(ic.pValue!).toBeLessThan(0.05);
  });

  it("倒U型关系：中间组收益最高，shape=inverted_u", () => {
    const rows: LeaderCandidateBacktestRow[] = [];
    const forwardByFactor = (factor: number) => {
      if (factor <= 4) return 1;
      if (factor <= 8) return 3;
      if (factor <= 12) return 5;
      if (factor <= 16) return 3;
      return 1;
    };
    for (let factor = 1; factor <= 20; factor += 1) {
      rows.push(makeRow({
        stockCode: `60003${String(factor).padStart(2, "0")}.SH`,
        date: "2026-08-18",
        technicalFactors: { turnoverRate: factor, volumeRatio: null, amplitude: null },
        nextClosePremium: forwardByFactor(factor),
      }));
    }
    const report = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const quintile = report.quintiles.find((item) => item.factorKey === "turnoverRate")!;
    expect(quintile.shape).toBe("inverted_u");
    expect(quintile.buckets[2]!.averageForwardReturn!).toBeGreaterThan(quintile.buckets[0]!.averageForwardReturn!);
    expect(quintile.buckets[2]!.averageForwardReturn!).toBeGreaterThan(quintile.buckets[4]!.averageForwardReturn!);
  });

  it("年度/季度切片：跨年数据产出对应 bucket，且正相关因子 meanIc>0", () => {
    const rows: LeaderCandidateBacktestRow[] = [];
    const dates = ["2025-03-10", "2025-03-11", "2026-07-06", "2026-07-07"];
    dates.forEach((date, dateIndex) => {
      [1, 2, 3, 4].forEach((factor, factorIndex) => {
        rows.push(makeRow({
          stockCode: `60004${dateIndex}${factorIndex}.SH`,
          date,
          technicalFactors: { turnoverRate: factor, volumeRatio: null, amplitude: null },
          nextClosePremium: factor * 2,
        }));
      });
    });
    const report = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const yearly = report.yearlyIc.find((item) => item.factorKey === "turnoverRate")!;
    const yearlyBuckets = yearly.buckets.map((bucket) => bucket.bucket);
    expect(yearlyBuckets).toContain("2025");
    expect(yearlyBuckets).toContain("2026");
    const y2025 = yearly.buckets.find((bucket) => bucket.bucket === "2025")!;
    expect(y2025.meanIc!).toBeGreaterThan(0);

    const quarterly = report.quarterlyIc.find((item) => item.factorKey === "turnoverRate")!;
    const quarterBuckets = quarterly.buckets.map((bucket) => bucket.bucket);
    expect(quarterBuckets).toContain("2025Q1");
    expect(quarterBuckets).toContain("2026Q3");
  });

  it("预测衰减：T+1 正向、T+2 收盘反向，衰减曲线捕获方向反转", () => {
    const rows: LeaderCandidateBacktestRow[] = [];
    const dates = ["2026-08-18", "2026-08-19", "2026-08-20"];
    dates.forEach((date, dateIndex) => {
      [1, 2, 3, 4].forEach((factor, factorIndex) => {
        rows.push(makeRow({
          stockCode: `60005${dateIndex}${factorIndex}.SH`,
          date,
          technicalFactors: { turnoverRate: factor, volumeRatio: null, amplitude: null },
          nextOpenPremium: factor,
          nextClosePremium: factor * 2,
          tPlus1CloseToTPlus2CloseReturn: factor,
          secondDayClosePremium: -factor * 2,
        }));
      });
    });
    const report = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const decay = report.icDecay.find((item) => item.factorKey === "turnoverRate")!;
    expect(decay.points.length).toBe(4);
    expect(decay.points.map((point) => point.horizon)).toEqual(["T+1开盘", "T+1收盘", "T+1→T+2", "T+2收盘"]);
    const first = decay.points[0]!;
    const last = decay.points[decay.points.length - 1]!;
    expect(first.meanIc!).toBeGreaterThan(0);
    expect(last.meanIc!).toBeLessThan(0);
  });

  it("情绪阶段稳定性：阶段内输出 meanIc / icIr，多阶段方向一致", () => {
    const rows: LeaderCandidateBacktestRow[] = [];
    const dates = ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
    dates.forEach((date, dateIndex) => {
      [1, 2, 3, 4].forEach((factor, factorIndex) => {
        // 中间一天让 factor=4 的收益反转为 1，制造非完全单调的日截面，使阶段内 IC 序列有方差、ICIR 可计算。
        const forward = dateIndex === 1 && factor === 4 ? 1 : factor * 2;
        rows.push(makeRow({
          stockCode: `60006${dateIndex}${factorIndex}.SH`,
          date,
          phase: (dateIndex < 2 ? "上升发酵" : "修复上升") as LeaderCandidateBacktestRow["phase"],
          technicalFactors: { turnoverRate: factor, volumeRatio: null, amplitude: null },
          nextClosePremium: forward,
        }));
      });
    });
    const report = evaluateFactorEffectiveness(rows, "nextClosePremium");
    const phaseResult = report.phaseStability.find((item) => item.factorKey === "turnoverRate")!;
    const phaseEntry = phaseResult.phases.find((phase) => phase.phase === "上升发酵")!;
    expect(phaseEntry.meanIc!).toBeGreaterThan(0);
    expect(phaseEntry.sampleSize).toBe(8);
    expect(phaseEntry.icIr).not.toBeNull();
    expect(phaseResult.directionConsistent).toBe(true);
  });
});
