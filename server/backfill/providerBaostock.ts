/**
 * STEP 7.3 扩展 — BaoStock MarketDataProvider（全市场日线回填）。
 *
 * 背景：BaoStock 免费接口没有「全市场单日」端点，只能逐票调用 `query_history_k_data_plus`。
 * 本 provider 因此「逐票取数」并把结果按 tradeDate 分桶，对 BackfillScheduler 暴露标准的
 * 「按交易日取全市场」接口：
 *
 *   1) 逐票（每次一个 login 驻留会话请求）拉 [startDate, endDate] 的日线原始行；
 *   2) 单位换算：股→手、元→千元（units.ts#convertBaostockDailyUnits，与 stock_daily_prices 口径一致）；
 *   3) 按 tradeDate 分桶缓存；`fetchDailyByTradeDate(date)` 从缓存返回该日全市场行。
 *
 * 复用既有 STEP 7.3 基础设施：
 *   - `rateLimiter`（IntervalRateLimiter）逐票请求间隔；
 *   - `retry`（withRetry）逐票瞬态重试（BaoStock 高峰期「网络接收错误」频发，退避 3s/6s/12s/24s/48s）；
 *   - scheduler 侧 `checkpoint` / `runDailyPipeline` / `persistInBatches`（写库阶段幂等续跑）。
 *
 * 断点续跑分两层：
 *   - 逐票取数：结果按「一股一行 JSONL」落 progressFilePath，重启时跳过同区间已完成股票；
 *   - 写库：由 BackfillScheduler 的 per-day checkpoint 负责（仅持久化成功后标 SUCCESS）。
 *
 * 与 `fetchBaostockStockDaily`（server/marketData/providers/baostock.ts）的关系：
 * 该函数只产出 `LiquidityDaily`（turn/amount/volume），**不含 OHLC / preClose**，无法满足
 * `stock_daily_prices` 的 NOT NULL 价格列 ⇒ 本 provider 复用同一 probe（session 模式）与同一
 * `baostock-daily` 单位口径，但取「原始日线行」。OHLC/preClose 缺失属 provider 能力事实，不作为静默 0 修复。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MarketDataProvider, ProviderDailyResult, RawDailyBar } from "./types";
import type { RateLimiter } from "./rateLimiter";
import { IntervalRateLimiter } from "./rateLimiter";
import { withRetry, type RetryPolicy } from "./retry";
import { computeRawHash } from "./provider";
import { convertBaostockDailyUnits } from "./units";

export const BAOSTOCK_PROVIDER_NAME = "baostock";
export const BAOSTOCK_ENDPOINT = "baostock:query_history_k_data_plus";
export const BAOSTOCK_SCHEMA_VERSION = "baostock-daily-v1";

/** 默认逐票请求间隔（ms）：贴近 BaoStock 免费接口 ~1.4 req/s 的单账号硬限速。 */
export const DEFAULT_BAOSTOCK_REQUEST_INTERVAL_MS = 350;

/** BaoStock 逐票重试策略：瞬态「网络接收错误」按经验退避，避免短间隔加剧服务端雪崩。 */
/** 连续失败 N 只后冷却，避免对已抖动的服务端持续轰炸。 */
export const DEFAULT_COOLDOWN_AFTER_FAILURES = 5;

/** 默认冷却时长（ms）。 */
export const DEFAULT_COOLDOWN_MS = 30_000;

export const BAOSTOCK_RETRY_POLICY: RetryPolicy = {
  transientDelaysMs: [3_000, 6_000, 12_000, 24_000, 48_000],
  rateLimitBackoffMs: 60_000,
  maxRateLimitRetries: 1,
};

/** BaoStock `stock_daily` bridge 返回的原始行（数值为字符串，单位为 股 / 元 / %）。 */
export interface BaoStockDailyRow {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  /** 除权前收价（bridge `preclose`）；老版本 bridge 可能缺失。 */
  preClose?: string;
  volume: string;
  amount: string;
  turn?: string;
  tradestatus?: string;
  isST?: string;
}

/** 逐票原始日线取数形状（生产用驻留会话实现；测试注入 fake，绕过网络）。 */
export type BaoStockStockDailyFetcher = (
  baostockCode: string,
  startDate: string,
  endDate: string,
) => Promise<BaoStockDailyRow[]>;

export interface BaoStockProviderLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** "600000.SH" → "sh.600000"（BaoStock 代码）。 */
export function toBaostockCode(securityCode: string): string {
  const match = /^(\d{6})\.(SH|SZ|BJ)$/.exec(securityCode.trim().toUpperCase());
  if (!match) throw new Error(`无法转 BaoStock 代码：${securityCode}`);
  return `${match[2]!.toLowerCase()}.${match[1]!}`;
}

/** 严格解析 provider 字符串数值（空串/null → null；非有限 → null，不静默填零）。 */
function toNum(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * BaoStock 原始日线行 → provider-neutral RawDailyBar。
 * volume/amount 归一到 `stock_daily_prices` 口径（手 / 千元），单位显式声明为 hands / thousand-cny，
 * 后续 canonical 层再按声明还原为 shares / CNY。
 */
export function baostockRowToRawBar(row: BaoStockDailyRow, securityCode: string): RawDailyBar {
  const { volume, amount } = convertBaostockDailyUnits({
    volume: toNum(row.volume),
    amount: toNum(row.amount),
  });
  return {
    securityCode,
    tradeDate: row.date,
    open: toNum(row.open),
    high: toNum(row.high),
    low: toNum(row.low),
    close: toNum(row.close),
    preClose: toNum(row.preClose),
    volume,
    amount,
    volumeUnit: "hands",
    amountUnit: "thousand-cny",
  };
}

export interface BaoStockProviderOptions {
  /** 全市场 universe（规范化代码，如 "600000.SH"）。 */
  securityCodes: readonly string[];
  /** 取数区间（含端点）。 */
  startDate: string;
  endDate: string;
  /** 逐票原始日线取数（生产用驻留会话 fetcher；测试注入 fake）。 */
  fetchStockDaily: BaoStockStockDailyFetcher;
  /** 逐票请求间隔限速（默认 IntervalRateLimiter 350ms）。 */
  rateLimiter?: RateLimiter;
  /** 逐票重试策略（默认 BAOSTOCK_RETRY_POLICY）。 */
  retryPolicy?: RetryPolicy;
  /** 逐票取数进度落盘（JSONL）；null = 不落盘（测试/短任务）。 */
  progressFilePath?: string | null;
  /** 单只股票重试耗尽后是否中断整段（默认 false：跳过并记录，由覆盖率/日志暴露）。 */
  abortOnStockFailure?: boolean;
  /** 连续失败多少只后触发冷却（默认 5；0 = 关闭冷却）。 */
  cooldownAfterFailures?: number;
  /** 冷却时长 ms（默认 30000）：BaoStock 高峰抖动时避免持续轰炸加剧雪崩。 */
  cooldownMs?: number;
  /** 睡眠实现（测试注入，避免真实等待冷却）。 */
  sleep?: (ms: number) => Promise<void>;
  logger?: BaoStockProviderLogger;
  now?: () => Date;
}

const consoleLogger: BaoStockProviderLogger = {
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
};

/** 进度行（断点续跑）：区间不匹配的历史进度会被忽略，绝不跨区间复用。 */
interface BaoStockProgressEntry {
  securityCode: string;
  from: string;
  to: string;
  rows: BaoStockDailyRow[];
}

/**
 * BaoStock 全市场日线 provider。
 * `fetchDailyByTradeDate` 首次调用时按需预取整段区间（逐票），之后全部命中内存缓存。
 */
export class BaoStockMarketDataProvider implements MarketDataProvider {
  readonly name = BAOSTOCK_PROVIDER_NAME;

  private readonly options: BaoStockProviderOptions;
  private readonly logger: BaoStockProviderLogger;
  private readonly rateLimiter: RateLimiter;
  private readonly retryPolicy: RetryPolicy;
  private readonly retrievedAt: string;
  private readonly cooldownAfterFailures: number;
  private readonly cooldownMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly rowsByDate = new Map<string, RawDailyBar[]>();
  private readonly completedCodes = new Set<string>();
  private readonly failedCodes: string[] = [];

  private loadPromise: Promise<void> | null = null;
  private loaded = false;

  constructor(options: BaoStockProviderOptions) {
    this.options = options;
    this.logger = options.logger ?? consoleLogger;
    this.rateLimiter = options.rateLimiter ?? new IntervalRateLimiter(DEFAULT_BAOSTOCK_REQUEST_INTERVAL_MS);
    this.retryPolicy = options.retryPolicy ?? BAOSTOCK_RETRY_POLICY;
    this.retrievedAt = (options.now?.() ?? new Date()).toISOString();
    this.cooldownAfterFailures = options.cooldownAfterFailures ?? DEFAULT_COOLDOWN_AFTER_FAILURES;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** 从进度文件恢复的 + 本次完成的股票代码。 */
  getCompletedSecurityCodes(): ReadonlySet<string> {
    return this.completedCodes;
  }

  /** 重试耗尽后仍失败的股票代码（供 CLI 汇报，便于下一轮重试）。 */
  getFailedSecurityCodes(): readonly string[] {
    return this.failedCodes;
  }

  /** 显式预取整段区间（可选：`fetchDailyByTradeDate` 会按需触发同一逻辑）。 */
  async warmup(): Promise<void> {
    await this.ensureLoaded();
  }

  async fetchDailyByTradeDate(tradeDate: string): Promise<ProviderDailyResult> {
    await this.ensureLoaded();
    const rows = this.rowsByDate.get(tradeDate) ?? [];
    return {
      provider: this.name,
      endpoint: BAOSTOCK_ENDPOINT,
      tradeDate,
      retrievedAt: this.retrievedAt,
      schemaVersion: BAOSTOCK_SCHEMA_VERSION,
      rows,
      rawHash: computeRawHash(rows),
      success: true,
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) this.loadPromise = this.loadAll();
    await this.loadPromise;
  }

  private async loadAll(): Promise<void> {
    this.loadProgress();
    const pending = this.options.securityCodes.filter((code) => !this.completedCodes.has(code));
    this.logger.info(
      `[BAOSTOCK] range=${this.options.startDate}~${this.options.endDate} universe=${this.options.securityCodes.length} ` +
        `cached=${this.completedCodes.size} pending=${pending.length}`,
    );

    let processed = 0;
    let consecutiveFailures = 0;
    for (const securityCode of pending) {
      await this.rateLimiter.wait();
      const rows = await this.fetchOne(securityCode);
      processed += 1;
      if (rows === null) {
        consecutiveFailures += 1;
        if (this.cooldownAfterFailures > 0 && consecutiveFailures >= this.cooldownAfterFailures) {
          this.logger.warn(
            `[BAOSTOCK] 连续失败 ${consecutiveFailures} 只，冷却 ${Math.round(this.cooldownMs / 1000)}s（避免加剧服务端雪崩）`,
          );
          await this.sleep(this.cooldownMs);
          consecutiveFailures = 0;
        }
        continue;
      }
      consecutiveFailures = 0;
      this.ingest(securityCode, rows);
      this.persistProgress(securityCode, rows);
      if (pending.length > 0 && (processed % 200 === 0 || processed === pending.length)) {
        this.logger.info(
          `[BAOSTOCK] progress ${processed}/${pending.length} last=${securityCode} cachedDates=${this.rowsByDate.size} failed=${this.failedCodes.length}`,
        );
      }
    }

    if (this.failedCodes.length > 0) {
      this.logger.warn(
        `[BAOSTOCK] ${this.failedCodes.length} 只股票逐票取数失败（已在覆盖率与日志中暴露）：` +
          this.failedCodes.slice(0, 20).join(",") +
          (this.failedCodes.length > 20 ? ",…" : ""),
      );
    }
    this.loaded = true;
  }

  private async fetchOne(securityCode: string): Promise<BaoStockDailyRow[] | null> {
    const outcome = await withRetry(
      () => this.options.fetchStockDaily(toBaostockCode(securityCode), this.options.startDate, this.options.endDate),
      { policy: this.retryPolicy },
    );
    if (outcome.ok) return outcome.value;
    this.failedCodes.push(securityCode);
    this.logger.warn(
      `[BAOSTOCK] securityCode=${securityCode} 取数失败 attempts=${outcome.attempts} code=${outcome.error.code} ${outcome.error.message}`,
    );
    if (this.options.abortOnStockFailure) throw outcome.error;
    return null;
  }

  /** 把一只股票的行并入按日期分桶的缓存（幂等：同一代码只并入一次）。 */
  private ingest(securityCode: string, rows: BaoStockDailyRow[]): void {
    if (this.completedCodes.has(securityCode)) return;
    for (const row of rows) {
      const bar = baostockRowToRawBar(row, securityCode);
      const bucket = this.rowsByDate.get(bar.tradeDate);
      if (bucket) bucket.push(bar);
      else this.rowsByDate.set(bar.tradeDate, [bar]);
    }
    this.completedCodes.add(securityCode);
  }

  private loadProgress(): void {
    const path = this.options.progressFilePath;
    if (!path || !existsSync(path)) return;
    const lines = readFileSync(path, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as Partial<BaoStockProgressEntry>;
        if (!entry.securityCode || !Array.isArray(entry.rows)) continue;
        if (entry.from !== this.options.startDate || entry.to !== this.options.endDate) continue;
        this.ingest(entry.securityCode, entry.rows);
      } catch {
        // 损坏行忽略：对应股票会被重新取数（幂等 upsert 保证重复写入无副作用）。
      }
    }
  }

  private persistProgress(securityCode: string, rows: BaoStockDailyRow[]): void {
    const path = this.options.progressFilePath;
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    const entry: BaoStockProgressEntry = {
      securityCode,
      from: this.options.startDate,
      to: this.options.endDate,
      rows,
    };
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}