import { describe, expect, it } from "vitest";
import {
  bucketOfLimitUpTime,
  buildOpenExpectationTable,
  classifyOpenExpectation,
  summarizeOpenExpectationTiers,
  timeToMinutes,
  type OpenExpectationTable,
} from "./openExpectation";

const fixedTable: OpenExpectationTable = {
  early: { center: 3, lower: 1, upper: 4 },
  morning: { center: 2.5, lower: 1, upper: 4 },
  afternoon: { center: 1, lower: -1, upper: 3 },
  late: { center: 0, lower: 0, upper: 2 },
  unknown: { center: 1, lower: -2, upper: 4 },
};

describe("timeToMinutes / bucketOfLimitUpTime", () => {
  it("解析 HH:mm:ss 为分钟并正确归档封板档位", () => {
    expect(timeToMinutes("09:25:00")).toBe(565);
    expect(timeToMinutes("11:30:00")).toBe(690);
    expect(timeToMinutes("14:59:59")).toBe(899);
    expect(timeToMinutes(null)).toBeNull();
    expect(timeToMinutes("bad")).toBeNull();
    expect(bucketOfLimitUpTime("09:35:00")).toBe("early");
    expect(bucketOfLimitUpTime("10:00:00")).toBe("morning");
    expect(bucketOfLimitUpTime("10:30:00")).toBe("morning");
    expect(bucketOfLimitUpTime("11:30:00")).toBe("unknown"); // 午间休市不应出现
    expect(bucketOfLimitUpTime("13:05:00")).toBe("afternoon");
    expect(bucketOfLimitUpTime("13:59:59")).toBe("afternoon");
    expect(bucketOfLimitUpTime("14:00:00")).toBe("late");
    expect(bucketOfLimitUpTime("14:57:00")).toBe("late");
    expect(bucketOfLimitUpTime(null)).toBe("unknown");
  });
});

describe("classifyOpenExpectation", () => {
  it("按分档期望区间区分超预期/符合预期/不及预期", () => {
    expect(classifyOpenExpectation("early", 4.5, fixedTable)).toBe("exceeds");
    expect(classifyOpenExpectation("early", 1, fixedTable)).toBe("meets");
    expect(classifyOpenExpectation("early", 0.8, fixedTable)).toBe("misses");
    expect(classifyOpenExpectation("morning", 2.5, fixedTable)).toBe("meets");
    expect(classifyOpenExpectation("late", -1, fixedTable)).toBe("misses");
    // 同一实际开盘溢价在不同档位结论不同 → 验证按封板时间分档，而非全局固定阈值
    expect(classifyOpenExpectation("late", 1.5, fixedTable)).toBe("meets");
    expect(classifyOpenExpectation("early", 1.5, fixedTable)).toBe("meets");
  });
});

describe("buildOpenExpectationTable", () => {
  it("按样本分位数构建期望中心与上下界", () => {
    const samples = Array.from({ length: 100 }, (_, index) => {
      const bucket = index % 4 === 0 ? "early" : index % 4 === 1 ? "morning" : index % 4 === 2 ? "afternoon" : "late";
      // early: 集中 3~5；morning: 集中 -2~2；afternoon: -4~0；late: -5~-1
      const base = bucket === "early" ? 4 : bucket === "morning" ? 0 : bucket === "afternoon" ? -2 : -3;
      const spread = bucket === "early" ? 2 : bucket === "morning" ? 4 : 4;
      return { bucket, openPremium: base + (index % 25) * (spread / 24) - spread / 2 };
    });
    const table = buildOpenExpectationTable(samples, { minSample: 10 });
    expect(table.early.center).toBeGreaterThan(table.morning.center);
    expect(table.morning.center).toBeGreaterThan(table.late.center);
    expect(table.early.lower).toBeLessThan(table.early.upper);
    expect(table.late.calibrationSampleSize).toBe(25);
    expect(table.unknown.calibrationSampleSize).toBe(100);
  });

  it("样本不足的档位用全样本分布回退带宽", () => {
    const samples = Array.from({ length: 60 }, (_, index) => ({
      bucket: index < 10 ? "early" : "late",
      openPremium: index < 10 ? 4 + index * 0.1 : -1 + (index % 10) * 0.1,
    }));
    const table = buildOpenExpectationTable(samples, { minSample: 30 });
    expect(table.early.lower).toBeGreaterThan(-100); // 存在有限值（全样本回退）
    expect(Number.isFinite(table.early.lower)).toBe(true);
    expect(Number.isFinite(table.morning.center)).toBe(true); // 空档也给出兜底 center
  });
});

describe("summarizeOpenExpectationTiers", () => {
  it("分档输出候选/放弃/买入/已出清/平均收益/胜率", () => {
    const summary = summarizeOpenExpectationTiers([
      { tier: "exceeds", status: "filled", netReturn: 5, closed: true },
      { tier: "exceeds", status: "filled", netReturn: -1, closed: true },
      { tier: "exceeds", status: "filled", netReturn: null, closed: false },
      { tier: "meets", status: "skipped", netReturn: null, closed: false },
      { tier: "misses", status: "skipped", netReturn: null, closed: false },
    ]);
    const exceeds = summary.find((item) => item.tier === "exceeds")!;
    expect(exceeds).toMatchObject({ candidateCount: 3, skippedCount: 0, filledCount: 3, completedCount: 2 });
    expect(exceeds.averageNetReturn).toBe(2);
    expect(exceeds.winRate).toBe(50);
    expect(summary.find((item) => item.tier === "misses")).toMatchObject({ candidateCount: 1, skippedCount: 1, filledCount: 0 });
  });
});
