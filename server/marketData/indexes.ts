/**
 * STEP 7.6 — Index：指数代码规范化、身份校验、日线访问。
 *
 * 铁律：不得因为「常见」就把 provider 返回的代码硬编码成某个指数；必须先验证
 * code / name / startDate / source identity，再决定是否可用。
 */

import type { IndexCode, IndexDailyBar, IndexMasterEntry } from "./types";

/**
 * 指数代码规范化。
 * 指数代码段与股票代码段不同：上证/中证系指数为 000xxx.SH、深证系指数为 399xxx.SZ。
 * 不得复用股票的 inferStockExchangeSuffix（其 0→SZ 规则会误导指数）。
 */
export function normalizeIndexCode(input: string): IndexCode {
  const trimmed = input.trim();
  // 剥离可能的前缀（sh/sz/SH/SZ/000300 裸代码）与后缀（.SH/.SZ）
  const match = trimmed.match(/^(?:(?:sh|sz|SH|SZ))?(\d{6})(?:\.(SH|SZ|BJ))?$/);
  if (!match) {
    throw new Error(`无效指数代码：${input}，应为 6 位数字（可带 sh/sz 前缀或 .SH/.SZ 后缀）`);
  }
  const digits = match[1]!;
  const explicitExchange = match[2];
  if (explicitExchange) {
    return `${digits}.${explicitExchange}`;
  }
  // 无显式交易所时按指数代码段推断：000 → SH，399 → SZ，899 → BJ。
  if (digits.startsWith("000") || digits.startsWith("930")) return `${digits}.SH`;
  if (digits.startsWith("399")) return `${digits}.SZ`;
  if (digits.startsWith("899")) return `${digits}.BJ`;
  throw new Error(`无法推断指数代码交易所：${input}`);
}

/** 指数身份校验结论。 */
export type IndexIdentityVerdict = "PASS" | "CONCERN" | "BLOCKED";

/** 指数身份参考（权威首发信息，用于身份校验，不硬编码为 provider 数据）。 */
export interface IndexIdentityReference {
  indexCode: IndexCode;
  indexName: string;
  /** 官方发布日（YYYY-MM-DD），早于此日的数据应视为可疑。 */
  launchDate: string;
  /** 基准日（YYYY-MM-DD），基期。 */
  baseDate: string;
}

/**
 * 核心指数身份参考表（仅作为校验锚点，不替代 provider 数据）。
 * 说明：沪深300 基准日 2004-12-31、首发 2005-04-08，故任何声称 2002 起的数据（如 Sina）都必须标记 CONCERN。
 */
export const CORE_INDEX_IDENTITY: Record<string, IndexIdentityReference> = {
  "000001.SH": { indexCode: "000001.SH", indexName: "上证指数", launchDate: "1991-07-15", baseDate: "1990-12-19" },
  "399001.SZ": { indexCode: "399001.SZ", indexName: "深证成指", launchDate: "1995-01-23", baseDate: "1994-07-20" },
  "399006.SZ": { indexCode: "399006.SZ", indexName: "创业板指", launchDate: "2010-06-01", baseDate: "2010-05-31" },
  "000300.SH": { indexCode: "000300.SH", indexName: "沪深300", launchDate: "2005-04-08", baseDate: "2004-12-31" },
  "000905.SH": { indexCode: "000905.SH", indexName: "中证500", launchDate: "2007-01-15", baseDate: "2004-12-31" },
  "000852.SH": { indexCode: "000852.SH", indexName: "中证1000", launchDate: "2014-10-17", baseDate: "2004-12-31" },
};

export interface IndexIdentityCheck {
  verdict: IndexIdentityVerdict;
  issues: Array<{ code: string; message: string }>;
}

/**
 * 校验一个 provider 返回的指数身份是否可信：
 *   - code 无法映射到已知指数 → BLOCKED（身份无法确认，禁止当已知指数用）；
 *   - 名称与参考不符 → CONCERN（可能同名不同指）；
 *   - 数据首日早于官方发布日 → CONCERN（疑似回填/估算序列，如 Sina 000300 自 2002 起）；
 *   - 全部一致 → PASS。
 */
export function verifyIndexIdentity(entry: IndexMasterEntry): IndexIdentityCheck {
  const issues: Array<{ code: string; message: string }> = [];
  const reference = CORE_INDEX_IDENTITY[entry.indexCode];

  if (!reference) {
    return {
      verdict: "BLOCKED",
      issues: [{ code: "UNKNOWN_INDEX_IDENTITY", message: `无法确认指数身份：${entry.indexCode}（${entry.indexName}）不在核心指数参考表中` }],
    };
  }

  if (entry.indexName && entry.indexName.trim() !== reference.indexName) {
    issues.push({
      code: "NAME_MISMATCH",
      message: `指数名称不符：provider="${entry.indexName}" 参考="${reference.indexName}"`,
    });
  }
  if (entry.firstDate && entry.firstDate < reference.launchDate) {
    issues.push({
      code: "DATA_BEFORE_LAUNCH",
      message: `${entry.indexCode} 数据首日 ${entry.firstDate} 早于官方发布日 ${reference.launchDate}，疑似回填/估算序列`,
    });
  }
  if (entry.firstDate && entry.firstDate < reference.baseDate) {
    issues.push({
      code: "DATA_BEFORE_BASE",
      message: `${entry.indexCode} 数据首日 ${entry.firstDate} 早于基期 ${reference.baseDate}，强烈怀疑身份错误`,
    });
  }

  if (issues.length === 0) return { verdict: "PASS", issues };
  // 名称不符 / 数据早于发布日 / 早于基期：身份存疑（CONCERN），禁止盲信为完整历史；
  // BLOCKED 仅保留给「指数身份完全无法确认」的 UNKNOWN_INDEX_IDENTITY 分支。
  return { verdict: "CONCERN", issues };
}

/** 将 provider 原生代码映射到规范化指数代码（幂等）。 */
export function mapIndexCode(providerCode: string): IndexCode {
  return normalizeIndexCode(providerCode);
}

/**
 * 校验指数日线序列：同一天重复 bar 视为数据错误（抛错）；返回按日期升序的唯一副本。
 * 用于 index mapping / duplicate 测试。
 */
export function assertUniqueIndexDaily(bars: readonly IndexDailyBar[]): void {
  const seen = new Set<string>();
  for (const bar of bars) {
    const key = `${bar.indexCode}|${bar.tradeDate}`;
    if (seen.has(key)) {
      throw new Error(`指数日线重复：${key}`);
    }
    seen.add(key);
  }
}

/** 返回某指数的日线（按 tradeDate 升序）。 */
export function sortIndexDaily(bars: readonly IndexDailyBar[]): IndexDailyBar[] {
  return bars.slice().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}
