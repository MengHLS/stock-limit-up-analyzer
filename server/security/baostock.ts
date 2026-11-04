/**
 * STEP 12 WORK B — BaoStock stock_basic Provider（免费、无配额）。
 *
 * 用 BaoStock `query_stock_basic` 替代受 40203 限频的 Tushare `stock_basic`，
 * 全量回填 A 股证券主数据（含退市股，anti-survivorship-bias）。
 *
 * 与 Tushare 源的关键差异：
 *   - BaoStock code 形态为 `sh.600000` / `sz.000001` / `bj.920001`（前缀 + 点 + 6 位）。
 *   - `type=1` 才是股票（2 指数 / 4 基金 / 5 债，均不落库）。
 *   - `outDate` 非空 = 退市（退市日）；`ipoDate` = 上市日（均已是 YYYY-MM-DD）。
 *   - 无 namechange 接口：名称历史 / 退市后代码复用（code reuse）无法从本数据源取得，
 *     属 CONDITIONAL GAP（详见报告），不伪造。
 *
 * BaoStock `query_stock_basic` 实测不稳定：单次登录仅第一次查询有效（后续返回 0 行），
 * 且跨会话偶发截断（返回 2000/4000/8000 行而非全量 8940 行）。因此 fetch 采用
 * 「多尝试 + 按 code 去重并集」策略，并在拿到完整快照后提前停止。
 */

import { runPythonScript } from "../marketData/providers/pythonBridge";
import type { ProviderSecurityRecord, SecurityMasterProvider } from "./provider";
import type { Exchange } from "./types";

/** BaoStock `stock_basic` 原始行（与 scripts/providers/baostock_probe.py 输出一致）。 */
export interface BaoStockRawRow {
  /** 完整代码，如 "sh.600000"。 */
  code: string;
  /** 证券名称。 */
  name: string;
  /** 上市日期，YYYY-MM-DD；空串 = 未知。 */
  ipoDate: string;
  /** 退市日期，YYYY-MM-DD；空串 = 未退市。 */
  outDate: string;
  /** 证券类型："1"股票 "2"指数 "4"基金 "5"债。 */
  type: string;
  /** 状态："1"上市 "0"退市。 */
  status: string;
}

/** BaoStock code 前缀 → 项目统一交易所。 */
export function mapBaoStockExchange(prefix: string): Exchange | null {
  switch (prefix.toLowerCase()) {
    case "sh":
      return "SH";
    case "sz":
      return "SZ";
    case "bj":
      return "BJ";
    default:
      return null;
  }
}

/** 解析单个 BaoStock code（如 "sh.600000"）为 { exchange, digits }；非法返回 null。 */
export function parseBaoStockCode(code: string): { exchange: Exchange; digits: string } | null {
  const match = /^(sh|sz|bj)\.(\d{6})$/i.exec(code.trim());
  if (!match) return null;
  const exchange = mapBaoStockExchange(match[1]!);
  if (!exchange) return null;
  return { exchange, digits: match[2]! };
}

/**
 * 解析 BaoStock stock_basic 原始行为归一化的 ProviderSecurityRecord[]。
 * 只落 type=1 股票（含退市股）；指数/基金/债忽略；code 无法解析的行跳过。
 * 纯函数、无 IO，供单测与离线回放复用。
 */
export function parseBaoStockStockBasic(rawRows: readonly BaoStockRawRow[]): ProviderSecurityRecord[] {
  const records: ProviderSecurityRecord[] = [];
  for (const row of rawRows) {
    if (row.type !== "1") continue;
    const parsed = parseBaoStockCode(row.code);
    if (!parsed) continue;

    const listedDate = row.ipoDate?.trim() || null;
    const delistedDate = row.outDate?.trim() || null;
    records.push({
      exchange: parsed.exchange,
      code: parsed.digits,
      name: row.name?.trim() ?? "",
      securityType: "stock",
      listedDate,
      delistedDate,
      status: delistedDate ? "delisted" : "listed",
      source: "baostock_stock_basic",
    });
  }
  return records;
}

/** 一次 `query_stock_basic` 完整快照的判定阈值（实测全量 8940 行）。 */
const FULL_TOTAL_THRESHOLD = 8900;
const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_DELAY_MS = 3000;

/** 拉取统计（供 CLI 输出 Requested/Received/Failed）。 */
export interface BaoStockFetchStats {
  attempts: number;
  /** 多尝试按 code 去重后的原始行数。 */
  rawRows: number;
  /** 失败的尝试次数。 */
  failures: number;
  /** 是否拿到了完整快照（某次尝试达到阈值）。 */
  complete: boolean;
}

export interface BaoStockFetchResult {
  records: ProviderSecurityRecord[];
  stats: BaoStockFetchStats;
  /** 多尝试按 code 去重后的原始行（供离线 dump / 复现）。 */
  rawRows: BaoStockRawRow[];
}

/** BaoStock stock_basic Provider（多尝试 + 去重并集，对抗后端不稳定）。 */
export class BaoStockStockBasicProvider implements SecurityMasterProvider {
  readonly name = "baostock-stock-basic";
  private readonly maxAttempts: number;
  private readonly fullThreshold: number;
  private readonly pythonEnvVar: string;
  private readonly delayMs: number;

  constructor(options?: { maxAttempts?: number; fullThreshold?: number; pythonEnvVar?: string; delayMs?: number }) {
    this.maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.fullThreshold = options?.fullThreshold ?? FULL_TOTAL_THRESHOLD;
    this.pythonEnvVar = options?.pythonEnvVar ?? "MARKETDATA_PYTHON";
    this.delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
  }

  /** 单次拉取原始行（可能因 BaoStock 后端不稳定而截断）。 */
  async fetchRaw(): Promise<BaoStockRawRow[]> {
    const stdout = await runPythonScript("baostock_probe.py", ["stock_basic"], this.pythonEnvVar);
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) throw new Error("BaoStock stock_basic 返回非 JSON 数组");
    return parsed as BaoStockRawRow[];
  }

  /** 多尝试拉取并对抗截断；返回归一化记录 + 统计。 */
  async fetch(): Promise<BaoStockFetchResult> {
    const union = new Map<string, BaoStockRawRow>();
    let attempts = 0;
    let failures = 0;
    let complete = false;

    for (let i = 0; i < this.maxAttempts; i += 1) {
      attempts += 1;
      let rows: BaoStockRawRow[];
      try {
        rows = await this.fetchRaw();
      } catch (error) {
        failures += 1;
        console.warn(`[baostock] 第 ${attempts} 次拉取失败：${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const row of rows) union.set(row.code, row);
      if (rows.length >= this.fullThreshold) {
        complete = true;
        break;
      }
      if (i + 1 < this.maxAttempts && this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
    }

    const rawRows = Array.from(union.values());
    return {
      records: parseBaoStockStockBasic(rawRows),
      stats: { attempts, rawRows: rawRows.length, failures, complete },
      rawRows,
    };
  }

  /** 接口兼容：仅返回归一化记录。 */
  async fetchSecurityMaster(): Promise<ProviderSecurityRecord[]> {
    return (await this.fetch()).records;
  }
}
