/**
 * STEP 7.3 — Daily Pipeline 测试（Raw → Canonical → Validate → Persistable）。
 */

import { describe, expect, it } from "vitest";
import { runDailyPipeline } from "./pipeline";
import type { ProviderDailyResult, RawDailyBar } from "./types";

function raw(overrides: Partial<RawDailyBar> = {}): RawDailyBar {
  return {
    securityCode: "600001.SH",
    tradeDate: "2026-09-04",
    open: 10,
    high: 10.5,
    low: 9.9,
    close: 10.2,
    preClose: 10,
    volume: 1234,
    amount: 5678,
    volumeUnit: "hands",
    amountUnit: "thousand-cny",
    ...overrides,
  };
}

function result(rows: RawDailyBar[]): ProviderDailyResult {
  return {
    provider: "mock",
    endpoint: "mock:daily",
    tradeDate: "2026-09-04",
    retrievedAt: new Date().toISOString(),
    schemaVersion: "daily-v1",
    rows,
    rawHash: null,
    success: true,
  };
}

describe("runDailyPipeline", () => {
  it("合法行 → persistRows（raw 单位 手/千元）", () => {
    const p = runDailyPipeline(result([raw()]));
    expect(p.persistRows).toHaveLength(1);
    expect(p.invalidCount).toBe(0);
    expect(p.unpersistableCount).toBe(0);
    // 表存 raw 单位（不转换）
    expect(p.persistRows[0].volume).toBe("1234");
    expect(p.persistRows[0].amount).toBe("5678");
  });

  it("INVALID 行（OHLC 矛盾）→ 拒写并计数", () => {
    const p = runDailyPipeline(result([raw({ low: 11, high: 10 })]));
    expect(p.persistRows).toHaveLength(0);
    expect(p.invalidCount).toBe(1);
  });

  it("负 volume → INVALID 拒写", () => {
    const p = runDailyPipeline(result([raw({ volume: -1 })]));
    expect(p.invalidCount).toBe(1);
  });

  it("缺 close → UNPERSISTABLE 计数", () => {
    const p = runDailyPipeline(result([raw({ close: null })]));
    expect(p.unpersistableCount).toBe(1);
    expect(p.persistRows).toHaveLength(0);
  });

  it("WARNING 行（缺失 amount）→ 仍写入 + warningCount", () => {
    const p = runDailyPipeline(result([raw({ amount: null })]));
    expect(p.persistRows).toHaveLength(1);
    expect(p.warningCount).toBe(1);
  });

  it("混合行：合法 + INVALID + 缺价格 → 各自计数", () => {
    const p = runDailyPipeline(result([raw(), raw({ low: 11, high: 10 }), raw({ open: null })]));
    expect(p.persistRows).toHaveLength(1);
    expect(p.invalidCount).toBe(1);
    expect(p.unpersistableCount).toBe(1);
  });
});
