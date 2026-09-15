import { describe, expect, it } from "vitest";
import {
  INDEX_SYNC_DEFAULT_CODES,
  INDEX_SYNC_DEFAULT_START,
  MAX_RUN_DURATION_MS,
  addDays,
  describeIndexSyncProviders,
  diffDays,
  planIndexSync,
  resolveIndexSyncWindow,
} from "../../server/marketData/indexSync";
import { CORE_INDEX_IDENTITY } from "../../server/marketData/indexes";

const START = "2019-01-01";
const END = "2026-09-15";

describe("planIndexSync —— 智能增量（省配额的核心）", () => {
  it("本地无数据时按请求区间全量拉取", () => {
    const plan = planIndexSync({ rowCount: 0, firstDate: null, lastDate: null }, START, END);
    expect(plan.action).toBe("full");
    expect(plan.range).toEqual({ startDate: START, endDate: END });
  });

  it("首尾都在容差内时跳过：0 请求 = 0 配额消耗", () => {
    const plan = planIndexSync(
      { rowCount: 1869, firstDate: "2019-01-02", lastDate: "2026-09-14" },
      START,
      END,
    );
    expect(plan.action).toBe("skip");
    expect(plan.range).toBeNull();
    expect(plan.reason).toContain("已对齐");
  });

  it("仅末端落后时只补 [末日+1, end]，绝不整段重拉", () => {
    const plan = planIndexSync(
      { rowCount: 1800, firstDate: "2019-01-02", lastDate: "2026-08-01" },
      START,
      END,
    );
    expect(plan.action).toBe("incremental");
    expect(plan.range).toEqual({ startDate: "2026-08-02", endDate: END });
  });

  it("首部缺失时退回全区间（中部/首部缺口无法靠末端补齐）", () => {
    const plan = planIndexSync(
      { rowCount: 900, firstDate: "2023-06-01", lastDate: "2026-09-14" },
      START,
      END,
    );
    expect(plan.action).toBe("full");
    expect(plan.range).toEqual({ startDate: START, endDate: END });
    expect(plan.reason).toContain("首部缺失");
  });

  it("force 时忽略已有覆盖、按整段重取（换源修数用）", () => {
    const plan = planIndexSync(
      { rowCount: 1869, firstDate: "2019-01-02", lastDate: "2026-09-14" },
      START,
      END,
      true,
    );
    expect(plan.action).toBe("full");
    expect(plan.range).toEqual({ startDate: START, endDate: END });
    expect(plan.reason).toContain("强制重拉");
  });

  it("给出行情末端参照时，落后 1 个交易日必须判为增量而非齐平（纸面交易空转的现场）", () => {
    const plan = planIndexSync(
      { rowCount: 1869, firstDate: "2019-01-02", lastDate: "2026-09-14" },
      START,
      END,
      false,
      { referenceDate: "2026-09-15" },
    );
    expect(plan.action).toBe("incremental");
    expect(plan.range).toEqual({ startDate: "2026-09-15", endDate: END });
    expect(plan.reason).toContain("早于应有末日");
  });

  it("给出参照且末日不早于参照时跳过", () => {
    const plan = planIndexSync(
      { rowCount: 1869, firstDate: "2019-01-02", lastDate: "2026-09-15" },
      START,
      END,
      false,
      { referenceDate: "2026-09-15" },
    );
    expect(plan.action).toBe("skip");
    expect(plan.range).toBeNull();
  });

  it("参照晚于请求终点时以请求终点为准（自定义历史区间不被未来参照放宽）", () => {
    const plan = planIndexSync(
      { rowCount: 100, firstDate: "2019-01-02", lastDate: "2021-03-31" },
      "2019-01-01",
      "2021-03-31",
      false,
      { referenceDate: "2026-09-15" },
    );
    expect(plan.action).toBe("skip");
  });

  it("端点落在长假/周末时不被误判为落后（容差 30 天）", () => {
    // 2026-08-20 距 END（2026-09-15）为 26 天，仍在容差内 ⇒ 跳过
    const tolerant = planIndexSync(
      { rowCount: 100, firstDate: "2019-01-02", lastDate: "2026-08-20" },
      START,
      END,
    );
    expect(tolerant.action).toBe("skip");
    // 31 天超出容差 ⇒ 判为落后，转增量
    const beyond = planIndexSync(
      { rowCount: 100, firstDate: "2019-01-02", lastDate: "2026-08-15" },
      START,
      END,
    );
    expect(beyond.action).toBe("incremental");
    expect(beyond.range?.startDate).toBe("2026-08-16");
  });

  it("起始日晚于结束日时抛错（不静默拉空区间）", () => {
    expect(() =>
      planIndexSync({ rowCount: 0, firstDate: null, lastDate: null }, END, START),
    ).toThrow();
  });
});

describe("resolveIndexSyncWindow —— 窗口解析", () => {
  it("默认起点固定 2019-01-01、终点对齐行情末端", () => {
    const window = resolveIndexSyncWindow({ marketLastDate: "2026-09-15" });
    expect(window).toEqual({ startDate: INDEX_SYNC_DEFAULT_START, endDate: "2026-09-15" });
  });

  it("无行情末端时退回「今天」（now 可注入）", () => {
    const window = resolveIndexSyncWindow({ marketLastDate: null, now: new Date(2026, 8, 15) });
    expect(window.endDate).toBe("2026-09-15");
  });

  it("显式区间优先于默认值与行情末端", () => {
    const window = resolveIndexSyncWindow({
      marketLastDate: "2026-09-15",
      startDate: "2021-03-01",
      endDate: "2021-03-31",
    });
    expect(window).toEqual({ startDate: "2021-03-01", endDate: "2021-03-31" });
  });

  it("起点晚于终点时抛错", () => {
    expect(() => resolveIndexSyncWindow({ startDate: END, endDate: START })).toThrow();
  });
});

describe("describeIndexSyncProviders —— 按环境暴露可用性与代价", () => {
  it("provider 顺序稳定且 sina 恒可用", () => {
    const providers = describeIndexSyncProviders({});
    expect(providers.map((item) => item.name)).toEqual(["tushare", "sina", "baostock"]);
    expect(providers.find((item) => item.name === "sina")?.available).toBe(true);
  });

  it("没有 TUSHARE_TOKEN 时 tushare 判为不可用（避免点下去才报错）", () => {
    expect(describeIndexSyncProviders({}).find((item) => item.name === "tushare")?.available).toBe(false);
    expect(describeIndexSyncProviders({ TUSHARE_TOKEN: "x" }).find((item) => item.name === "tushare")?.available).toBe(true);
  });

  it("tushare 请求间隔为 65 秒（规避 1 次/分钟限频）", () => {
    const info = describeIndexSyncProviders({ TUSHARE_TOKEN: "x" }).find((item) => item.name === "tushare");
    expect(info?.intervalMs).toBe(65_000);
    expect(info?.note).toContain("配额");
  });

  it("baostock 未配 MARKETDATA_PYTHON 时不可用且给出原因", () => {
    const missing = describeIndexSyncProviders({}).find((item) => item.name === "baostock");
    expect(missing?.available).toBe(false);
    expect(missing?.note).toContain("MARKETDATA_PYTHON");

    const configured = describeIndexSyncProviders({ MARKETDATA_PYTHON: "/usr/bin/python3" }).find(
      (item) => item.name === "baostock",
    );
    expect(configured?.available).toBe(true);
  });
});

describe("日期工具", () => {
  it("addDays 跨月/跨年/闰年正确", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("diffDays 返回带符号自然日差", () => {
    expect(diffDays("2026-09-14", "2026-09-15")).toBe(1);
    expect(diffDays("2026-09-15", "2026-09-14")).toBe(-1);
    expect(diffDays("2026-09-15", "2026-09-15")).toBe(0);
  });

  it("非法日期直接抛错", () => {
    expect(() => addDays("2026/09/15", 1)).toThrow();
    expect(() => diffDays("oops", "2026-09-15")).toThrow();
  });
});

describe("常量", () => {
  it("默认同步 4 只核心指数，且每只都在身份参考表内", () => {
    expect(INDEX_SYNC_DEFAULT_CODES).toEqual(["000001.SH", "399001.SZ", "000300.SH", "000905.SH"]);
    for (const code of INDEX_SYNC_DEFAULT_CODES) {
      expect(CORE_INDEX_IDENTITY[code], code).toBeDefined();
    }
  });

  it("单次同步时间预算小于 Node 默认 requestTimeout(300s)", () => {
    expect(MAX_RUN_DURATION_MS).toBeLessThan(300_000);
    expect(MAX_RUN_DURATION_MS).toBeGreaterThan(0);
  });
});
