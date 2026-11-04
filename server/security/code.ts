/**
 * STEP 7.4 — 证券代码解析 / 交易所推断 / canonical 表示（唯一权威来源）。
 *
 * canonical 表示：`6位数字.交易所`，如 000001.SZ / 600000.SH / 920001.BJ。
 * 支持输入形态：600000 / 600000.SH / sh600000（大小写均可、可带空白）。
 */

import type { Exchange, SecurityCode } from "./types";

/**
 * 按 6 位数字代码前缀推断交易所后缀。
 *   - 6 开头 → SH（60/601/603/605 主板 + 688 科创板）
 *   - 0/3 开头 → SZ（000/001/002/003 + 300/301）
 *   - 92/4/8 开头 → BJ（北交所 920/43/83/87/88）
 * 无法识别 → 抛错（不静默猜测）。
 */
export function inferExchange(digits: string): Exchange {
  if (!/^\d{6}$/.test(digits)) throw new Error(`证券代码必须为 6 位数字：${digits}`);
  if (digits.startsWith("6")) return "SH";
  if (digits.startsWith("0") || digits.startsWith("3")) return "SZ";
  if (digits.startsWith("92") || digits.startsWith("4") || digits.startsWith("8")) return "BJ";
  throw new Error(`无法识别的股票代码前缀：${digits}`);
}

/** 判断输入是否合法 6 位数字代码。 */
export function isValidDigits(digits: string): boolean {
  return /^\d{6}$/.test(digits);
}

/**
 * 解析任意形态的证券代码为 { digits, exchange }。
 * 支持：600000 / 600000.SH / sh600000（去空白、去大小写差异）。
 * 显式带后缀时，若与 6 位前缀推断的交易所不一致则抛错（拒绝冲突）。
 */
export function parseSecurityCode(input: string): SecurityCode {
  const raw = input.trim().toUpperCase();

  let match = raw.match(/^(\d{6})\.(SH|SZ|BJ)$/);
  if (match) {
    const digits = match[1]!;
    const exchange = match[2] as Exchange;
    assertConsistent(digits, exchange);
    return { digits, exchange };
  }

  match = raw.match(/^(SH|SZ|BJ)(\d{6})$/);
  if (match) {
    const exchange = match[1] as Exchange;
    const digits = match[2]!;
    assertConsistent(digits, exchange);
    return { digits, exchange };
  }

  match = raw.match(/^(\d{6})$/);
  if (match) {
    const digits = match[1]!;
    return { digits, exchange: inferExchange(digits) };
  }

  throw new Error(`无法解析证券代码：${input}`);
}

/** 显式后缀与 6 位前缀推断不一致时抛错。 */
function assertConsistent(digits: string, exchange: Exchange): void {
  const inferred = inferExchange(digits);
  if (inferred !== exchange) {
    throw new Error(`证券代码 ${digits} 与交易所后缀 ${exchange} 不一致（应为 ${inferred}）`);
  }
}

/** canonical 字符串表示：`6位数字.交易所`。 */
export function canonicalCode(code: SecurityCode): string {
  return `${code.digits}.${code.exchange}`;
}

/**
 * 将任意输入规范化为 canonical 字符串（`6位数字.交易所`）。
 * 与历史 server/stockIdentity.normalizeStockCode 语义一致。
 */
export function normalizeSecurityCode(input: string): string {
  return canonicalCode(parseSecurityCode(input));
}

/** 拆分 canonical 字符串（如 "600000.SH" → {digits:"600000", exchange:"SH"}）。 */
export function splitCanonicalCode(canonical: string): SecurityCode {
  return parseSecurityCode(canonical);
}
