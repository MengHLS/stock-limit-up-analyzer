/**
 * STEP 11 / Work E — Trading Calendar Canonicalization 测试。
 *
 * 覆盖：普通交易日 / 周末 / 节假日 / 连续休市 / 跨年 / 春节 / 国庆 / T+1 /
 *       multiple trading days / empty calendar / missing calendar / determinism。
 *
 * 假期日期采用上交所《2026 年部分节假日休市安排》（上证公告〔2025〕45 号）：
 *   元旦 1/1–1/3；春节 2/15–2/23；清明节 4/4–4/6；劳动节 5/1–5/5；
 *   端午节 6/19–6/21；中秋节 9/25–9/27；国庆节 10/1–10/7（周末另休）。
 */

import { describe, expect, it } from "vitest";
import {
  buildNextTradingDayMap,
  buildPreviousTradingDayMap,
  buildTradingCalendar,
  isTradingDayIn,
} from "./tradingCalendar";
import { statusKnowledgeDate } from "../securityStatus/pointInTime";
import type { SecurityStatusInterval } from "../securityStatus/types";

/** 测试 fixture：枚举 [start, end] 内工作日并剔除节假日区间（UTC，确定性）。 */
function enumerateTradingDates(start: string, end: string, holidays: [string, string][] = []): string[] {
  const out: string[] = [];
  const inHoliday = (d: string) => holidays.some(([a, b]) => d >= a && d <= b);
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  for (let t = s; t <= e; t += 86_400_000) {
    const dt = new Date(t);
    const day = dt.getUTCDay();
    if (day === 0 || day === 6) continue;
    const iso = dt.toISOString().slice(0, 10);
    if (inHoliday(iso)) continue;
    out.push(iso);
  }
  return out;
}

describe("isTradingDay", () => {
  const cal = buildTradingCalendar(enumerateTradingDates("2026-09-01", "2026-09-30"));

  it("普通交易日为 true", () => {
    expect(cal.isTradingDay("2026-09-07")).toBe(true); // 周一
    expect(cal.isTradingDay("2026-09-30")).toBe(true); // 周三
  });

  it("周末为 false", () => {
    expect(cal.isTradingDay("2026-09-05")).toBe(false); // 周六
    expect(cal.isTradingDay("2026-09-06")).toBe(false); // 周日
  });

  it("isTradingDayIn 纯函数一致", () => {
    const dates = ["2026-09-07", "2026-09-08"];
    expect(isTradingDayIn(dates, "2026-09-07")).toBe(true);
    expect(isTradingDayIn(dates, "2026-09-09")).toBe(false);
  });
});

describe("nextTradingDay / previousTradingDay", () => {
  it("普通交易日：周一 → 周二", () => {
    const cal = buildTradingCalendar(["2026-09-07", "2026-09-08", "2026-09-09"]);
    expect(cal.nextTradingDay("2026-09-07")).toBe("2026-09-08");
    expect(cal.previousTradingDay("2026-09-08")).toBe("2026-09-07");
  });

  it("周末：周五 → 下周一（不得跳周六）", () => {
    const cal = buildTradingCalendar(enumerateTradingDates("2026-09-01", "2026-09-15"));
    expect(cal.nextTradingDay("2026-09-04")).toBe("2026-09-07");
  });

  it("上一交易日跨周末：周一 → 上周五", () => {
    const cal = buildTradingCalendar(enumerateTradingDates("2026-09-01", "2026-09-15"));
    expect(cal.previousTradingDay("2026-09-07")).toBe("2026-09-04");
  });

  it("非交易日输入按其后/前最近交易日定位（clamp）", () => {
    const cal = buildTradingCalendar(enumerateTradingDates("2026-09-01", "2026-09-15"));
    expect(cal.nextTradingDay("2026-09-05")).toBe("2026-09-07"); // 周六 → 下周一
    expect(cal.previousTradingDay("2026-09-06")).toBe("2026-09-04"); // 周日 → 上周五
  });

  it("连续休市（春节）：周五 → 节后首个交易日", () => {
    const cal = buildTradingCalendar(enumerateTradingDates("2026-02-01", "2026-03-01", [["2026-02-15", "2026-02-23"]]));
    expect(cal.isTradingDay("2026-02-13")).toBe(true);
    expect(cal.isTradingDay("2026-02-17")).toBe(false);
    expect(cal.nextTradingDay("2026-02-13")).toBe("2026-02-24");
    expect(cal.previousTradingDay("2026-02-24")).toBe("2026-02-13");
  });

  it("连续休市（国庆）：周三 → 节后首个交易日", () => {
    const cal = buildTradingCalendar(enumerateTradingDates("2026-09-20", "2026-10-15", [["2026-10-01", "2026-10-07"]]));
    expect(cal.isTradingDay("2026-09-30")).toBe(true);
    expect(cal.isTradingDay("2026-10-05")).toBe(false);
    expect(cal.nextTradingDay("2026-09-30")).toBe("2026-10-08");
    expect(cal.previousTradingDay("2026-10-08")).toBe("2026-09-30");
  });

  it("跨年 + 元旦连续休市：12/31 → 1/5", () => {
    const cal = buildTradingCalendar(enumerateTradingDates("2025-12-20", "2026-01-10", [["2026-01-01", "2026-01-03"]]));
    expect(cal.isTradingDay("2025-12-31")).toBe(true);
    expect(cal.isTradingDay("2026-01-01")).toBe(false);
    expect(cal.nextTradingDay("2025-12-31")).toBe("2026-01-05");
    expect(cal.previousTradingDay("2026-01-05")).toBe("2025-12-31");
  });

  it("末位/首位边界返回 null", () => {
    const cal = buildTradingCalendar(["2026-09-07", "2026-09-08"]);
    expect(cal.nextTradingDay("2026-09-08")).toBe(null);
    expect(cal.previousTradingDay("2026-09-07")).toBe(null);
  });
});

describe("addTradingDays（multiple trading days）", () => {
  const cal = buildTradingCalendar(enumerateTradingDates("2026-09-01", "2026-09-30"));

  it("T+1 / T+2 / T+3 跨周末正确", () => {
    expect(cal.addTradingDays("2026-09-04", 1)).toBe("2026-09-07"); // 周五 → 周一
    expect(cal.addTradingDays("2026-09-04", 2)).toBe("2026-09-08");
    expect(cal.addTradingDays("2026-09-04", 3)).toBe("2026-09-09");
  });

  it("n=0 返回自身（交易日）", () => {
    expect(cal.addTradingDays("2026-09-07", 0)).toBe("2026-09-07");
  });

  it("负偏移（向前）", () => {
    expect(cal.addTradingDays("2026-09-07", -1)).toBe("2026-09-04");
  });

  it("越界返回 null", () => {
    expect(cal.addTradingDays("2026-09-30", 1)).toBe(null);
    expect(cal.addTradingDays("2026-09-01", -1)).toBe(null);
  });

  it("非交易日返回 null（missing calendar date）", () => {
    expect(cal.addTradingDays("2026-09-05", 1)).toBe(null);
  });

  it("非法偏移量 fail-fast", () => {
    expect(() => cal.addTradingDays("2026-09-07", 1.5)).toThrow(/整数/);
  });
});

describe("tradingDaysBetween / tradingDayCount", () => {
  const cal = buildTradingCalendar(enumerateTradingDates("2026-09-01", "2026-09-30"));

  it("闭区间包含两端点", () => {
    expect(cal.tradingDaysBetween("2026-09-07", "2026-09-11")).toEqual([
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
    ]);
  });

  it("跨周末区间正确计数", () => {
    expect(cal.tradingDayCount("2026-09-04", "2026-09-08")).toBe(3); // 周五、周一、周二
    expect(cal.tradingDaysBetween("2026-09-04", "2026-09-08")).toEqual([
      "2026-09-04", "2026-09-07", "2026-09-08",
    ]);
  });

  it("from > to 返回空", () => {
    expect(cal.tradingDaysBetween("2026-09-08", "2026-09-07")).toEqual([]);
    expect(cal.tradingDayCount("2026-09-08", "2026-09-07")).toBe(0);
  });

  it("端点不在日历内也能按区间过滤", () => {
    expect(cal.tradingDaysBetween("2026-09-05", "2026-09-06")).toEqual([]); // 周末无交易日
  });
});

describe("clamp helpers", () => {
  const cal = buildTradingCalendar(enumerateTradingDates("2026-09-01", "2026-09-30"));

  it("firstTradingDayOnOrAfter / lastTradingDayOnOrBefore", () => {
    expect(cal.firstTradingDayOnOrAfter("2026-09-05")).toBe("2026-09-07"); // 周六 → 下周一
    expect(cal.lastTradingDayOnOrBefore("2026-09-06")).toBe("2026-09-04"); // 周日 → 上周五
    expect(cal.firstTradingDayOnOrAfter("2026-09-07")).toBe("2026-09-07"); // 交易日 → 自身
    expect(cal.lastTradingDayOnOrBefore("2026-09-07")).toBe("2026-09-07");
  });

  it("边界返回 null", () => {
    expect(cal.firstTradingDayOnOrAfter("2026-10-01")).toBe(null); // 超出日历末尾
    expect(cal.lastTradingDayOnOrBefore("2026-08-31")).toBe(null); // 早于日历起点
  });
});

describe("empty calendar / missing calendar", () => {
  it("空日历：查询均安全返回空语义", () => {
    const cal = buildTradingCalendar([]);
    expect(cal.tradingDays).toEqual([]);
    expect(cal.isTradingDay("2026-09-07")).toBe(false);
    expect(cal.nextTradingDay("2026-09-07")).toBe(null);
    expect(cal.previousTradingDay("2026-09-07")).toBe(null);
    expect(cal.addTradingDays("2026-09-07", 1)).toBe(null);
    expect(cal.tradingDaysBetween("2026-09-01", "2026-09-30")).toEqual([]);
    expect(cal.tradingDayCount("2026-09-01", "2026-09-30")).toBe(0);
    expect(cal.firstTradingDayOnOrAfter("2026-09-07")).toBe(null);
    expect(cal.lastTradingDayOnOrBefore("2026-09-07")).toBe(null);
  });

  it("日期不在日历内（missing）：addTradingDays 返回 null，next/previous clamp", () => {
    const cal = buildTradingCalendar(["2026-09-07", "2026-09-08"]);
    expect(cal.isTradingDay("2026-09-09")).toBe(false);
    expect(cal.addTradingDays("2026-09-09", 1)).toBe(null);
    expect(cal.nextTradingDay("2026-09-09")).toBe(null); // 无更晚交易日
    expect(cal.previousTradingDay("2026-09-09")).toBe("2026-09-08"); // clamp 到前一日
  });
});

describe("邻接映射纯函数", () => {
  const dates = ["2026-09-04", "2026-09-07", "2026-09-08"];

  it("buildNextTradingDayMap / buildPreviousTradingDayMap", () => {
    expect(buildNextTradingDayMap(dates)).toEqual(new Map([
      ["2026-09-04", "2026-09-07"],
      ["2026-09-07", "2026-09-08"],
    ]));
    expect(buildPreviousTradingDayMap(dates)).toEqual(new Map([
      ["2026-09-07", "2026-09-04"],
      ["2026-09-08", "2026-09-07"],
    ]));
  });
});

describe("determinism（确定性）", () => {
  const source = enumerateTradingDates("2026-09-01", "2026-09-30");

  it("相同输入构造的两个实例查询结果一致", () => {
    const a = buildTradingCalendar(source);
    const b = buildTradingCalendar([...source]);
    expect(a.tradingDays).toEqual(b.tradingDays);
    for (const d of a.tradingDays) {
      expect(b.nextTradingDay(d)).toBe(a.nextTradingDay(d));
      expect(b.previousTradingDay(d)).toBe(a.previousTradingDay(d));
    }
  });

  it("重复调用结果稳定", () => {
    const cal = buildTradingCalendar(source);
    for (let i = 0; i < 3; i += 1) {
      expect(cal.nextTradingDay("2026-09-04")).toBe("2026-09-07");
      expect(cal.addTradingDays("2026-09-04", 2)).toBe("2026-09-08");
    }
  });

  it("构造对输入数组去重 + 升序归一（无序/重复输入也确定）", () => {
    const cal = buildTradingCalendar(["2026-09-08", "2026-09-07", "2026-09-08", "2026-09-07"]);
    expect(cal.tradingDays).toEqual(["2026-09-07", "2026-09-08"]);
  });
});

describe("T_PLUS_1 集成（securityStatus pointInTime 用 nextTradingDay）", () => {
  const cal = buildTradingCalendar(enumerateTradingDates("2025-12-20", "2026-01-10", [["2026-01-01", "2026-01-03"]]));

  function interval(effectiveFrom: string): SecurityStatusInterval {
    return {
      securityId: "sec_test",
      statusType: "ST",
      statusValue: "ST",
      effectiveFrom,
      effectiveTo: null,
      source: "test",
      retrievedAt: null,
      confidence: "high",
      availability: "T_PLUS_1",
    };
  }

  it("T+1 用下一交易日，跨年+元旦不跳周末/节假日", () => {
    // 2025-12-31（周三，交易日）→ T+1 = 2026-01-05（周一），跳过元旦 1/1–1/4。
    expect(statusKnowledgeDate(interval("2025-12-31"), cal)).toBe("2026-01-05");
    // 2026-01-05（周一）→ 2026-01-06（周二）。
    expect(statusKnowledgeDate(interval("2026-01-05"), cal)).toBe("2026-01-06");
  });

  it("无 calendar 注入时 fail-safe 返回 null（不退回自然日）", () => {
    expect(statusKnowledgeDate(interval("2025-12-31"))).toBeNull();
  });
});
