/**
 * STEP 7.4 — 日期工具：全系统证券身份层统一使用 "YYYY-MM-DD" 字符串，
 * 其字典序即时间序（无需依赖 Date 对象），保证比较可确定性。
 */

/** 校验是否为 YYYY-MM-DD 形态的 ISO 日期字符串。 */
export function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 字典序比较两个 ISO 日期：负 = a 早于 b；0 = 相等；正 = a 晚于 b。 */
export function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ISO 日期加减 n 天（UTC 语义，避免本地时区偏移）。 */
export function addDays(iso: string, n: number): string {
  if (!isValidIsoDate(iso)) throw new Error(`无效日期：${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}
