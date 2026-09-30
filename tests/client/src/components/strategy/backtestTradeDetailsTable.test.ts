/**
 * 成交明细的「按年分组 + 分页 + 交易详情」契约。
 *
 * 本机没有 jsdom，因此这里既验证抽出的纯函数行为，也扫真实源码钉住：
 *   ① 详细行情只走只读的 `researchRun.stockDailySeries`，绝不重新运行回测；
 *   ② 弹窗仍复用既有 StockKlineDialog（不另写一套 K 线）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  groupBacktestTradesByYear,
  pnlToneClass,
  tradeEntryAmount,
  tradePositionPct,
  type BacktestTradeRow,
} from "@/components/strategy/ClosedLoopRunResultPanel";
import { appRouter } from "../../../../../server/routers";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const PANEL = readFileSync(
  path.join(
    ROOT,
    "client",
    "src",
    "components",
    "strategy",
    "ClosedLoopRunResultPanel.tsx"
  ),
  "utf8"
);
const DIALOG = readFileSync(
  path.join(
    ROOT,
    "client",
    "src",
    "components",
    "strategy",
    "StockKlineDialog.tsx"
  ),
  "utf8"
);
const LABEL_HOOK = readFileSync(
  path.join(ROOT, "client", "src", "hooks", "useSecurityLabels.ts"),
  "utf8"
);
const MAIN = readFileSync(path.join(ROOT, "client", "src", "main.tsx"), "utf8");

function trade(overrides: {
  securityId: string;
  entryTime: string;
}): BacktestTradeRow {
  return {
    securityId: overrides.securityId,
    code: null,
    name: null,
    entryTime: overrides.entryTime,
    exitTime: null,
    entryPrice: 10,
    exitPrice: null,
    quantity: 100,
    netPnl: null,
    returnPct: null,
    holdingPeriod: null,
    exitReason: null,
    openAtEnd: true,
    fees: null,
    score: null,
  };
}

describe("groupBacktestTradesByYear", () => {
  it("按买入年份倒序分组，同一年内保持原有交易顺序", () => {
    const first2025 = trade({ securityId: "sec-a", entryTime: "2025-03-01" });
    const second2025 = trade({ securityId: "sec-b", entryTime: "2025-08-01" });
    const latest2026 = trade({ securityId: "sec-c", entryTime: "2026-01-05" });

    const grouped = groupBacktestTradesByYear([
      first2025,
      latest2026,
      second2025,
    ]);

    expect(grouped.map(([year]) => year)).toEqual(["2026", "2025"]);
    expect(grouped[0][1]).toEqual([latest2026]);
    expect(grouped[1][1]).toEqual([first2025, second2025]);
  });
});

describe("pnlToneClass（A 股涨红跌绿）", () => {
  it("正值红、负值绿、0 与 null 中性", () => {
    expect(pnlToneClass(120)).toBe("text-red-600");
    expect(pnlToneClass(-1)).toBe("text-emerald-600");
    expect(pnlToneClass(0)).toBe("text-muted-foreground");
    expect(pnlToneClass(null)).toBe("text-muted-foreground");
    expect(pnlToneClass(Number.NaN)).toBe("text-muted-foreground");
  });
});

describe("买入金额与仓位百分比", () => {
  it("买入金额 = 买入价 × 股数，缺分量即 null", () => {
    expect(tradeEntryAmount({ entryPrice: 12.5, quantity: 800 })).toBe(10_000);
    expect(tradeEntryAmount({ entryPrice: null, quantity: 800 })).toBeNull();
    expect(tradeEntryAmount({ entryPrice: 12.5, quantity: null })).toBeNull();
  });

  it("仓位百分比 = 买入金额 ÷ 买入当日权益 × 100，缺当日权益或非正时 null", () => {
    const trade = {
      entryTime: "2025-01-02",
      entryPrice: 10,
      quantity: 1_000,
    };
    const equityByDate = new Map([
      ["2025-01-02", 100_000],
      ["2025-02-03", 40_000],
    ]);
    expect(tradePositionPct(trade, equityByDate)).toBeCloseTo(10);
    expect(
      tradePositionPct({ ...trade, entryTime: "2025-02-03" }, equityByDate)
    ).toBeCloseTo(25);
    expect(tradePositionPct(trade, null)).toBeNull();
    expect(tradePositionPct(trade, new Map([["2025-01-02", 0]]))).toBeNull();
    expect(
      tradePositionPct({ ...trade, entryTime: "2025-01-03" }, equityByDate)
    ).toBeNull();
  });
});

describe("成交明细源码契约", () => {
  const PROCEDURES = Object.keys(
    (appRouter as any)._def.procedures
  ) as string[];

  it("按年分组改为横向筛选格（每格带该年笔数）并接入分页控件", () => {
    expect(PANEL).toContain("groupBacktestTradesByYear");
    expect(PANEL).toContain("YearFilterChip");
    expect(PANEL).toContain("PaginationBar");
    expect(PANEL).toMatch(/pageSizeOptions=\{\[10, 20, 50, 100\]\}/);
    expect(PANEL).toContain("{year} 年");
    // 横向筛选：年份从新到旧排成一行，每格展示该年成交笔数，选中态由 aria-pressed 标记。
    expect(PANEL).toContain("aria-pressed={active}");
    expect(PANEL).toMatch(/count=\{trades\.length\}/);
    expect(PANEL).toContain("全部");
    expect(PANEL).toContain("交易详情");
  });

  it("年份筛选驱动同一张表，而非每年各渲染一张表（竖排）", () => {
    expect(PANEL).toContain("visibleTrades");
    expect(PANEL).toMatch(/<TradeTableSection\b/);
    // 旧的「一年一段、纵向堆叠」实现必须已被移除。
    expect(PANEL).not.toContain("TradeYearSection");
    expect(PANEL).not.toMatch(
      /years\.map\(\(\[year, trades\]\) => \(\s*<TradeTableSection/
    );
  });

  it("每笔交易按钮打开既有 StockKlineDialog", () => {
    expect(PANEL).toMatch(/<\s*StockKlineDialog\b/);
    expect(PANEL).toContain("type StockKlineTradeTarget");
    expect(PANEL).toMatch(/open=\{detailOpen\}/);
    expect(PANEL).toMatch(/onOpenChange=\{setDetailOpen\}/);
  });

  it("日线只走只读查询端点，且端点真实挂载", () => {
    expect(DIALOG).toMatch(
      /trpc\s*\.\s*researchRun\s*\.\s*stockDailySeries\s*\.\s*useQuery/
    );
    expect(DIALOG).not.toMatch(/useMutation/);
    expect(PROCEDURES).toContain("researchRun.stockDailySeries");
  });

  it("K 线弹窗同时展示 MA5、MA10、MA20 和成交量", () => {
    expect(DIALOG).toContain('name="MA5"');
    expect(DIALOG).toContain('name="MA10"');
    expect(DIALOG).toContain('name="MA20"');
    expect(DIALOG).toContain("成交量");
    expect(DIALOG).toContain("BarChart");
  });

  it("净盈亏与收益率按红赚绿亏着色", () => {
    expect(PANEL).toMatch(/pnlToneClass\(trade\.netPnl\)/);
    expect(PANEL).toMatch(/pnlToneClass\(trade\.returnPct\)/);
    expect(PANEL).toContain(
      'return v > 0 ? "text-red-600" : "text-emerald-600"'
    );
  });

  it("新增买入金额与仓位百分比两列，分母取买入当日权益", () => {
    expect(PANEL).toContain("买入金额");
    expect(PANEL).toContain("仓位百分比");
    expect(PANEL).toMatch(/tradeEntryAmount\(trade\)/);
    expect(PANEL).toMatch(/tradePositionPct\(trade, equityByDate\)/);
    expect(PANEL).toMatch(/equityByDate=\{equityByDate\}/);
    expect(PANEL).toContain("backtest.equityCurve");
    expect(PANEL).not.toMatch(/tradePositionPct\(trade, initialCapital\)/);
  });

  it("证券标签分批查全，不再截断到前 80 个 identity", () => {
    expect(LABEL_HOOK).not.toContain("MAX_IDS = 80");
    expect(LABEL_HOOK).toContain("LABEL_QUERY_CHUNK_SIZE");
    expect(LABEL_HOOK).toContain("chunkIds");
    expect(LABEL_HOOK).toMatch(/researchRun\.securityLabels/);
    // 每片一个官方 useQuery，分片结果汇进外部 store 供表格读取。
    expect(LABEL_HOOK).toContain("SecurityLabelChunks");
    expect(LABEL_HOOK).toMatch(/researchRun\.securityLabels\.useQuery/);
    // 临时调试钩子必须清干净。
    expect(LABEL_HOOK).not.toContain("__labelDbg");
  });

  it("证券标签查询走 POST 批处理，identity 不再挤进 URL", () => {
    // Node 的请求行上限（16KB）会先于业务逻辑拒绝超长 GET URL，表现为
    // `Input is too big for a single dispatch` —— 必须绕开 query string。
    expect(PANEL).toContain("SecurityLabelChunks");
    expect(MAIN).toContain("splitLink");
    expect(MAIN).toMatch(/op\.path === "researchRun\.securityLabels"/);
    expect(MAIN).toContain('methodOverride: "POST"');
  });
});
