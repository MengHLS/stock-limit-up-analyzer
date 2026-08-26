import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tushare", () => ({
  fetchTushareDailyPricesByDate: vi.fn(),
}));

import { fetchTwoMarketTurnoverYi, parseMarginWorkbookYi, parseStoredMarketYi } from "./marketFactors";
import { fetchTushareDailyPricesByDate } from "./tushare";

const mockedFetchDaily = vi.mocked(fetchTushareDailyPricesByDate);

function workbookBuffer(headers: string[], values: unknown[]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, values]);
  XLSX.utils.book_append_sheet(workbook, sheet, "数据");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("marketFactors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("仅汇总沪深证券的Tushare日线amount，并将千元转换为亿元", async () => {
    mockedFetchDaily.mockResolvedValue([
      { stockCode: "600000.SH", amount: 100_000 },
      { stockCode: "000001.SZ", amount: 250_000 },
      { stockCode: "430047.BJ", amount: 900_000 },
    ] as Awaited<ReturnType<typeof fetchTushareDailyPricesByDate>>);

    await expect(fetchTwoMarketTurnoverYi("2026-03-04")).resolves.toBe(3.5);
  });

  it("解析交易所工作簿中的逗号金额，并将元转换为亿元", () => {
    const balance = parseMarginWorkbookYi(
      workbookBuffer(["日期", "融资融券余额(元)"], ["2026-03-04", "1,291,063,567,769"]),
      "融资融券余额(元)",
      "深交所两融汇总",
    );

    expect(balance).toBe(12910.64);
  });

  it("对缺少目标字段或无效金额的工作簿明确报错", () => {
    expect(() => parseMarginWorkbookYi(workbookBuffer(["日期", "余额"], ["2026-03-04", "100"]), "融资融券余额(元)", "深交所两融汇总"))
      .toThrow("返回缺少字段");
    expect(() => parseMarginWorkbookYi(workbookBuffer(["日期", "融资融券余额(元)"], ["2026-03-04", "无数据"]), "融资融券余额(元)", "深交所两融汇总"))
      .toThrow("市场数据字段无效");
  });

  it("仅将已有market_data中的正数值解析为亿元，拒绝占位或空值", () => {
    expect(parseStoredMarketYi("23,655.04亿")).toBe(23655.04);
    expect(parseStoredMarketYi("0亿")).toBeNull();
    expect(parseStoredMarketYi("待补齐")).toBeNull();
    expect(parseStoredMarketYi(null)).toBeNull();
  });
});
