import { describe, it, expect } from "vitest";
import {
  MARKET_SYNC_LOOKBACK_DAYS,
  MARKET_SYNC_TIMES,
  getBeijingDateString,
  selectMissingTradingDates,
  shiftDateString,
} from "../../server/marketSync";

describe("大盘数据同步：日期算术", () => {
  it("shiftDateString 按自然日加减，跨月跨年正确", () => {
    expect(shiftDateString("2026-09-15", -20)).toBe("2026-08-26");
    expect(shiftDateString("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDateString("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateString("2026-09-15", 0)).toBe("2026-09-15");
    expect(shiftDateString("2026-09-15", 1)).toBe("2026-09-16");
  });

  it("getBeijingDateString 用北京时判定日历日（库中时间戳存 UTC，+8 才是北京时）", () => {
    // UTC 16:30 = 北京次日 00:30 ⇒ 必须落到次日，否则「今天」会整体错一天
    expect(getBeijingDateString(new Date("2026-09-15T16:30:00Z"))).toBe("2026-09-16");
    // UTC 15:30 = 北京当日 23:30 ⇒ 仍是当日
    expect(getBeijingDateString(new Date("2026-09-15T15:30:00Z"))).toBe("2026-09-15");
  });
});

describe("大盘数据同步：selectMissingTradingDates", () => {
  it("剔除已有数据的日期，结果升序", () => {
    const calendar = ["2026-09-10", "2026-09-09", "2026-09-11", "2026-09-14"];
    const existing = ["2026-09-09", "2026-09-11"];
    expect(selectMissingTradingDates(calendar, existing, "2026-09-14")).toEqual([
      "2026-09-10",
      "2026-09-14",
    ]);
  });

  it("列出晚于 endDate 之外的全部缺口（不猜数据源可用性：末端未发布日仍列入）", () => {
    const calendar = ["2026-09-14", "2026-09-15", "2026-09-16"];
    expect(selectMissingTradingDates(calendar, ["2026-09-14"], "2026-09-15")).toEqual(["2026-09-15"]);
  });

  it("已有数据为空时返回整个日历", () => {
    expect(selectMissingTradingDates(["2026-09-14", "2026-09-15"], [], "2026-09-15")).toEqual([
      "2026-09-14",
      "2026-09-15",
    ]);
  });

  it("日历与已有数据都为空时返回空数组（空态不伪造）", () => {
    expect(selectMissingTradingDates([], [], "2026-09-15")).toEqual([]);
  });

  it("已有数据含日历外日期不影响结果，且不改动入参", () => {
    const calendar = ["2026-09-14"];
    const existing = ["2026-09-13"];
    expect(selectMissingTradingDates(calendar, existing, "2026-09-15")).toEqual(["2026-09-14"]);
    expect(calendar).toEqual(["2026-09-14"]);
    expect(existing).toEqual(["2026-09-13"]);
  });

  it("endDate 早于全部日期时返回空数组", () => {
    expect(selectMissingTradingDates(["2026-09-14"], [], "2026-09-01")).toEqual([]);
  });
});

describe("大盘数据同步：调度时刻（防回归）", () => {
  it("所有同步时刻都不早于北京时间 08:00", () => {
    // 上交所两融汇总文件 rzrqjygkYYYYMMDD.xls 的 Last-Modified 实测恒为 T+1 日 07:40 北京时；
    // 早于该时刻的同步必然取不到两融，整条 NOT NULL 行写不进去（原 16:00/17:30 即为此失效）。
    for (const time of MARKET_SYNC_TIMES) {
      expect(time.hour * 60 + time.minute).toBeGreaterThanOrEqual(8 * 60);
    }
  });

  it("至少包含一个主同步与一个重试时刻", () => {
    expect(MARKET_SYNC_TIMES.length).toBeGreaterThanOrEqual(2);
  });

  it("补缺窗口足以覆盖「服务停机数天」", () => {
    expect(MARKET_SYNC_LOOKBACK_DAYS).toBeGreaterThanOrEqual(10);
  });
});
