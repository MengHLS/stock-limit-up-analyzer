/**
 * STEP 22 / C-22.1 — Market Regime：日期纯函数（无 Date 对象、无时区依赖）。
 *
 * 与 performanceMetrics/analyze.ts 同哲学：自然日换算用**儒略日序号**（proleptic
 * Gregorian，Howard Hinnant 算法），键提取用**字符串切片**，全程不构造 Date 对象，
 * 避免不同运行时/时区的日期解析差异破坏确定性。
 *
 * 本文件只被 marketRegime 内部使用（导出仅供测试与下游复用）；不做任何 IO。
 */

import { RegimeAnalysisError } from "./errors";

/** YYYY-MM-DD 形态校验（确定性，无 Date 对象）。 */
export const REGIME_ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 校验 YYYY-MM-DD 字符串形态（不含日历合法性深度校验：月/日范围做基本检查）。
 * 非法 → 抛 RegimeAnalysisError（FAIL FAST，绝不静默）。
 */
export function assertRegimeIsoDate(value: string, label: string): void {
  if (typeof value !== "string" || !REGIME_ISO_DATE_RE.test(value)) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_DATE",
      `marketRegime: ${label} 非法（${String(value)}），必须为 YYYY-MM-DD 字符串`,
    );
  }
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_DATE",
      `marketRegime: ${label} 月份越界（${value}）`,
    );
  }
  if (day < 1 || day > 31) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_DATE",
      `marketRegime: ${label} 日越界（${value}）`,
    );
  }
}

/**
 * 公历日期 → 儒略日序号（proleptic Gregorian，Howard Hinnant 算法）。
 * 输入必须是已通过 assertRegimeIsoDate 的 YYYY-MM-DD。
 */
export function regimeDateOrdinal(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const m = (month + 9) % 12;
  const y = year - Math.floor(m / 10);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = Math.floor((153 * m + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe;
}

/** 两个 YYYY-MM-DD 的先后比较（升序语义：a < b 返回负数）。 */
export function regimeCompareDate(a: string, b: string): number {
  if (a === b) return 0;
  return regimeDateOrdinal(a) - regimeDateOrdinal(b);
}

/** 自然日差（天）：after − before（可为负）。 */
export function regimeCalendarDaysBetween(before: string, after: string): number {
  return regimeDateOrdinal(after) - regimeDateOrdinal(before);
}

/** YYYY-MM-DD → 月键（YYYY-MM，纯字符串切片；日期须已校验形态）。 */
export function regimeMonthKeyOf(date: string): string {
  assertRegimeIsoDate(date, "regimeMonthKeyOf 入参");
  return date.slice(0, 7);
}

/** YYYY-MM-DD → 年键（YYYY，纯字符串切片）。 */
export function regimeYearKeyOf(date: string): string {
  assertRegimeIsoDate(date, "regimeYearKeyOf 入参");
  return date.slice(0, 4);
}

/**
 * 校验日级事实序列：按 tradeDate 严格升序且无重复（regime 计算依赖「序列第 i 项
 * = 第 i 个交易日」这一秩序语义；乱序会让回看窗取到错误的日期集合）。
 */
export function assertRegimeSeriesOrdered(series: readonly { readonly tradeDate: string }[]): void {
  for (let i = 0; i < series.length; i += 1) {
    const current = series[i]!.tradeDate;
    assertRegimeIsoDate(current, `series[${i}].tradeDate`);
    if (i === 0) continue;
    const previous = series[i - 1]!.tradeDate;
    if (regimeCompareDate(previous, current) >= 0) {
      throw new RegimeAnalysisError(
        "REGIME_SERIES_NOT_ORDERED",
        `marketRegime: 日级事实序列必须按 tradeDate 严格升序且无重复，` +
          `但 series[${i - 1}].tradeDate=${previous} >= series[${i}].tradeDate=${current}`,
      );
    }
  }
}

/**
 * PIT 守卫：断言窗口内所有事实的可获得时点不晚于 asOf（未来信息不得进入过去）。
 * 违反 → 抛错（FAIL FAST，绝不静默裁剪）。
 */
export function assertRegimeWindowPit(
  window: readonly { readonly tradeDate: string; readonly asOf: string }[],
  asOf: string,
): void {
  for (const facts of window) {
    if (regimeCompareDate(facts.tradeDate, asOf) > 0) {
      throw new RegimeAnalysisError(
        "REGIME_LOOKAHEAD_VIOLATION",
        `marketRegime: 回看窗含未来数据（tradeDate=${facts.tradeDate} > asOf=${asOf}），` +
          `违反 PIT 铁律；窗口必须只含 asOf 及之前的交易日`,
      );
    }
    if (facts.asOf !== facts.tradeDate) {
      throw new RegimeAnalysisError(
        "REGIME_ASOF_INVARIANT_VIOLATION",
        `marketRegime: 日级事实 asOf=${facts.asOf} != tradeDate=${facts.tradeDate}，` +
          `逐日 PIT 快照要求 asOf === tradeDate（冻结快照面板禁止喂给 regime 计算）`,
      );
    }
  }
}
