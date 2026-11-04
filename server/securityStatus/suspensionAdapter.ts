/**
 * STEP 7.5 — 停牌窗口适配器。
 *
 * 现有 stock_suspension_windows（155 行 / 101 只）是「partial inference」
 * （source=tushare-daily-infer，由日线缺口反推），不能假设完整。
 * 本适配器把它转换为统一 SUSPENSION/SUSPENDED 状态区间。
 *
 * 依赖注入：code → security_id 由 STEP 7.4 的 resolver 提供（本模块不实现身份解析）。
 * 无法解析 code 的窗口【跳过并上报】，绝不把 stock_code 冒充 security_id。
 */

import type { SecurityStatusInterval } from "./types";

/** 停牌窗口（来自 stock_suspension_windows）形状。 */
export interface SuspensionWindow {
  stockCode: string;
  startDate: string;
  endDate: string;
  source: "tushare-daily-infer" | "manual" | string;
  note?: string | null;
}

/** code → security_id 解析器（由 STEP 7.4 的 resolver 注入）。 */
export type SecurityIdResolver = (stockCode: string, asOfDate: string) => string | null;

/** 停牌窗口 → 状态区间 的转换结果。 */
export interface SuspensionConversionResult {
  intervals: SecurityStatusInterval[];
  /** 无法解析为 security_id 的 stockCode（供审计；这些窗口未写入任何状态）。 */
  unresolvedStockCodes: string[];
}

/**
 * 将停牌窗口转换为 SUSPENSION/SUSPENDED 状态区间。
 * 置信度：manual → high；tushare-daily-infer（日线反推）→ medium。
 * availability=UNKNOWN（日线反推的发布时间未知，不擅自假设 T+1）。
 */
export function suspensionWindowsToStatusIntervals(
  windows: readonly SuspensionWindow[],
  resolveSecurityId: SecurityIdResolver,
): SuspensionConversionResult {
  const intervals: SecurityStatusInterval[] = [];
  const unresolvedStockCodes: string[] = [];

  for (const window of windows) {
    const securityId = resolveSecurityId(window.stockCode, window.startDate);
    if (securityId === null) {
      unresolvedStockCodes.push(window.stockCode);
      continue;
    }
    intervals.push({
      securityId,
      statusType: "SUSPENSION",
      statusValue: "SUSPENDED",
      effectiveFrom: window.startDate,
      effectiveTo: window.endDate,
      source: window.source,
      retrievedAt: null,
      confidence: window.source === "manual" ? "high" : "medium",
      availability: "UNKNOWN",
    });
  }

  return { intervals, unresolvedStockCodes };
}
