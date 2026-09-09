import { describe, it, expect } from "vitest";
import {
  inferBaostockStatusIntervals,
  inferStIntervals,
  inferSuspensionIntervals,
  mergeConsecutiveRuns,
  type BaostockDailyStatusPoint,
} from "./baostockStatus";

const SECURITY_ID = "sec_11111111-2222-4333-8444-555555555555";
const RETRIEVED_AT = "2026-09-06T10:00:00.000Z";

function point(date: string, tradestatus: number | null, isST: number | null): BaostockDailyStatusPoint {
  return { date, tradestatus, isST };
}

describe("mergeConsecutiveRuns（连续段合并）", () => {
  it("单个连续段 → 一个区间", () => {
    const runs = mergeConsecutiveRuns(
      [point("2020-01-06", 0, 0), point("2020-01-07", 0, 0), point("2020-01-08", 0, 0)],
      (p) => p.tradestatus === 0,
    );
    expect(runs).toEqual([{ from: "2020-01-06", to: "2020-01-08" }]);
  });

  it("多段被交易日隔开 → 多个区间", () => {
    const points = [
      point("2020-01-06", 0, 0),
      point("2020-01-07", 0, 0),
      point("2020-01-08", 1, 0),
      point("2020-01-09", 0, 0),
    ];
    const runs = mergeConsecutiveRuns(points, (p) => p.tradestatus === 0);
    expect(runs).toEqual([
      { from: "2020-01-06", to: "2020-01-07" },
      { from: "2020-01-09", to: "2020-01-09" },
    ]);
  });

  it("边界：首/末行命中", () => {
    const points = [point("2020-01-06", 0, 0), point("2020-01-07", 1, 0), point("2020-01-08", 0, 0)];
    const runs = mergeConsecutiveRuns(points, (p) => p.tradestatus === 0);
    expect(runs).toEqual([
      { from: "2020-01-06", to: "2020-01-06" },
      { from: "2020-01-08", to: "2020-01-08" },
    ]);
  });

  it("null 字段不命中", () => {
    const runs = mergeConsecutiveRuns([point("2020-01-06", null, 0), point("2020-01-07", 0, 0)], (p) => p.tradestatus === 0);
    expect(runs).toEqual([{ from: "2020-01-07", to: "2020-01-07" }]);
  });
});

describe("inferSuspensionIntervals（停牌区间）", () => {
  it("连续停牌段合并为 SUSPENSION/SUSPENDED 区间，标注 medium/UNKNOWN/baostock-daily", () => {
    const points = [
      point("2016-09-14", 0, 0),
      point("2016-09-19", 0, 0),
      point("2016-09-20", 1, 0),
      point("2020-11-05", 0, 0),
    ];
    const intervals = inferSuspensionIntervals(SECURITY_ID, points, RETRIEVED_AT);
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toMatchObject({
      securityId: SECURITY_ID,
      statusType: "SUSPENSION",
      statusValue: "SUSPENDED",
      effectiveFrom: "2016-09-14",
      effectiveTo: "2016-09-19",
      source: "baostock-daily",
      retrievedAt: RETRIEVED_AT,
      confidence: "medium",
      availability: "UNKNOWN",
    });
    expect(intervals[1]).toMatchObject({ effectiveFrom: "2020-11-05", effectiveTo: "2020-11-05" });
  });

  it("无停牌日 → 空区间", () => {
    expect(inferSuspensionIntervals(SECURITY_ID, [point("2020-01-06", 1, 0)], RETRIEVED_AT)).toEqual([]);
  });
});

describe("inferStIntervals（ST 区间）", () => {
  it("连续 isST=1 段合并为 ST/ST 区间", () => {
    const points = [
      point("2020-04-29", 1, 1),
      point("2020-04-30", 1, 1),
      point("2020-05-06", 1, 1),
      point("2020-05-07", 1, 0),
    ];
    const intervals = inferStIntervals(SECURITY_ID, points, RETRIEVED_AT);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({
      statusType: "ST",
      statusValue: "ST",
      effectiveFrom: "2020-04-29",
      effectiveTo: "2020-05-06",
      confidence: "medium",
    });
  });

  it("isST 为二进制，不产生 *ST（诚实不做越级推断）", () => {
    const intervals = inferStIntervals(SECURITY_ID, [point("2020-04-29", 1, 1)], RETRIEVED_AT);
    for (const interval of intervals) {
      expect(interval.statusValue).toBe("ST");
    }
  });
});

describe("inferBaostockStatusIntervals（合并入口）", () => {
  it("停牌 + ST 同时存在时两维度都产出", () => {
    const points = [
      point("2021-05-28", 0, 1),
      point("2021-05-31", 0, 1),
      point("2021-06-01", 1, 0),
    ];
    const intervals = inferBaostockStatusIntervals(SECURITY_ID, points, RETRIEVED_AT);
    expect(intervals).toHaveLength(2);
    const types = intervals.map((i) => i.statusType).sort();
    expect(types).toEqual(["ST", "SUSPENSION"]);
  });

  it("空输入 → 空", () => {
    expect(inferBaostockStatusIntervals(SECURITY_ID, [], RETRIEVED_AT)).toEqual([]);
  });
});
