/**
 * STEP 12 WORK D — 全市场回填纯函数层测试。
 *
 * 覆盖：
 *   1. daily_adjust_factor 行解析（5 列，与 query_adjust_factor 同构）
 *   2. 全市场批处理聚合 + 跨日去重（幂等）
 *   3. 事件股票去重推导 + 分块
 * 纯函数，不发网络、不写库。
 */

import { describe, expect, it } from "vitest";
import {
  accumulateAdjustmentFactors,
  chunk,
  distinctEventCodes,
} from "./fullMarket";
import { parseBaoStockAdjustFactors } from "./provider";

const RETRIEVED = "2026-09-06T00:00:00.000Z";

// query_daily_adjust_factor 真实返回的 5 列形状（code, dividOperateDate, fore, back, adjustFactor）
const DAILY_ROWS: (string | number)[][] = [
  ["sz.000019", "2024-06-19", "0.959080", "4.571213", "4.571213"],
  ["sz.000025", "2024-06-19", "0.986710", "1.966179", "1.966179"],
  ["sh.600519", "2024-06-19", "0.950000", "5.000000", "5.000000"],
];

describe("daily_adjust_factor 解析（全市场逐日返回）", () => {
  it("5 列行复用 parseBaoStockAdjustFactors 正确解析 fore/back，忽略第 5 列", () => {
    const { factors, skipped } = parseBaoStockAdjustFactors(DAILY_ROWS, {
      retrievedAt: RETRIEVED,
    });
    expect(skipped).toBe(0);
    expect(factors).toHaveLength(3);
    expect(factors[0]!.securityCode).toBe("000019.SZ");
    expect(factors[0]!.effectiveDate).toBe("2024-06-19");
    expect(factors[0]!.foreFactor).toBeCloseTo(0.95908, 6);
    expect(factors[0]!.backFactor).toBeCloseTo(4.571213, 6);
    // 5 列中的第 5 列 adjustFactor 不影响解析结果
    expect(factors[2]!.foreFactor).toBeCloseTo(0.95, 6);
    expect(factors[2]!.backFactor).toBeCloseTo(5.0, 6);
  });
});

describe("全市场批处理聚合（跨日合并 + 去重，幂等）", () => {
  it("跨多个交易日的行合并后按 (code, effectiveDate) 去重，duplicates 计数", () => {
    const rows = [
      ...DAILY_ROWS,
      // 同日重复行（模拟幂等重跑）
      ["sz.000019", "2024-06-19", "0.959080", "4.571213", "4.571213"],
      // 另一交易日
      ["sh.600519", "2024-07-01", "0.900000", "5.555556", "5.555556"],
    ];
    const { factors, skipped, duplicates } = accumulateAdjustmentFactors(rows, {
      retrievedAt: RETRIEVED,
    });
    expect(skipped).toBe(0);
    expect(duplicates).toBe(1);
    expect(factors).toHaveLength(4); // 3 + 1（重复的 000019 被去重）
    const keys = factors.map((f) => `${f.securityCode}|${f.effectiveDate}`);
    expect(new Set(keys).size).toBe(keys.length); // 无重复键
  });

  it("幂等：同一输入重复聚合，结果完全一致（第二次无新增重复）", () => {
    const rows = [
      ...DAILY_ROWS,
      ["sz.000019", "2024-06-19", "0.959080", "4.571213", "4.571213"],
    ];
    const first = accumulateAdjustmentFactors(rows, { retrievedAt: RETRIEVED });
    const second = accumulateAdjustmentFactors(rows, { retrievedAt: RETRIEVED });
    expect(first.duplicates).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(JSON.stringify(first.factors)).toBe(JSON.stringify(second.factors));
  });

  it("非法行（缺日期/因子非正）计 skipped，不产出因子", () => {
    const { factors, skipped } = accumulateAdjustmentFactors(
      [
        ...DAILY_ROWS,
        ["sz.000001", "", "1.0", "1.0", "1.0"],
        ["sz.000002", "2024-06-19", "0", "1.0", "1.0"],
      ],
      { retrievedAt: RETRIEVED }
    );
    expect(factors).toHaveLength(3);
    expect(skipped).toBe(2);
  });
});

describe("事件股票推导与分块", () => {
  it("distinctEventCodes 从因子推导去重升序的股票代码", () => {
    const { factors } = accumulateAdjustmentFactors(
      [
        ...DAILY_ROWS,
        ["sz.000019", "2024-06-20", "0.959080", "4.571213", "4.571213"],
      ],
      { retrievedAt: RETRIEVED }
    );
    expect(distinctEventCodes(factors)).toEqual([
      "000019.SZ",
      "000025.SZ",
      "600519.SH",
    ]);
  });

  it("chunk 按固定大小分块且不丢元素", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
