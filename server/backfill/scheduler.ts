/**
 * STEP 7.3 — Backfill Scheduler。
 *
 * 输入 startDate/endDate，顺序执行（第一版 concurrency=1，禁止并发轰炸 provider）：
 *   1. 获取 canonical trading calendar
 *   2. 找出目标交易日
 *   3. 查询 checkpoint 找出未完成日期（断点续传）
 *   4. 按日期顺序：rateLimit.wait → fetch → canonicalize → validate → persist → checkpoint
 * 一致性铁律：只有数据持久化成功后才标记 SUCCESS。
 */

import type {
  BackfillCheckpoint,
  BackfillConfig,
  BackfillManifest,
  CheckpointStore,
  MarketDataProvider,
  TradingCalendarProvider,
} from "./types";
import type { RateLimiter } from "./rateLimiter";
import { extractTradingDates } from "./tradingCalendar";
import { createManifest, finalizeManifest } from "./manifest";
import { createPendingCheckpoint, toFinalCheckpoint, toRunningCheckpoint } from "./checkpoint";
import { withRetry } from "./retry";
import { persistInBatches, type UpsertFn } from "./persistence";
import { runDailyPipeline } from "./pipeline";
import { isSuspiciousCoverage, median } from "./coverage";

export interface BackfillLogger {
  info(message: string): void;
  warn(message: string): void;
}

const consoleLogger: BackfillLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

export interface BackfillSchedulerDeps {
  provider: MarketDataProvider;
  calendarProvider: TradingCalendarProvider;
  checkpointStore: CheckpointStore;
  rateLimiter: RateLimiter;
  upsertFn: UpsertFn;
  config: BackfillConfig;
  logger?: BackfillLogger;
  /** 重试退避睡眠（可注入，测试用假时钟，避免真实等待 60s）。 */
  sleep?: (ms: number) => Promise<void>;
}

export interface BackfillRunResult {
  manifest: BackfillManifest;
  /** 是否因配额/限频耗尽而提前停止。 */
  quotaStopped: boolean;
  /** 本次实际处理的交易日数。 */
  processedDates: number;
  /** 累计写入 stock-day 行数。 */
  totalRows: number;
}

/** 已完成的 checkpoint 状态（续传时跳过）。 */
const DONE_STATUSES = new Set(["SUCCESS", "SUSPICIOUS"]);

export class BackfillScheduler {
  private readonly deps: BackfillSchedulerDeps;
  private readonly logger: BackfillLogger;

  constructor(deps: BackfillSchedulerDeps) {
    this.deps = deps;
    this.logger = deps.logger ?? consoleLogger;
  }

  /** 计算目标交易日（calendar ∩ [startDate, endDate]）。 */
  async resolveTargetDates(startDate: string, endDate: string): Promise<string[]> {
    const calendar = await this.deps.calendarProvider.fetchTradingCalendar(startDate, endDate);
    return extractTradingDates(calendar).filter((date) => date >= startDate && date <= endDate);
  }

  async run(startDate: string, endDate: string): Promise<BackfillRunResult> {
    const { provider, checkpointStore, rateLimiter, upsertFn, config } = this.deps;
    const tradingDates = await this.resolveTargetDates(startDate, endDate);
    const checkpoints = await checkpointStore.list(startDate, endDate);
    const checkpointByDate = new Map(checkpoints.map((cp) => [cp.tradeDate, cp]));
    const pendingDates = tradingDates.filter((date) => !DONE_STATUSES.has(checkpointByDate.get(date)?.status ?? ""));

    const manifest = createManifest({
      startDate,
      endDate,
      provider: provider.name,
      targetTradingDates: tradingDates.length,
      config,
    });

    let totalRows = 0;
    let quotaStopped = false;
    let processedDates = 0;

    const processedRowCounts: number[] = [];

    for (const tradeDate of pendingDates) {
      await rateLimiter.wait();
      const previous = checkpointByDate.get(tradeDate) ?? null;
      await checkpointStore.set(toRunningCheckpoint(previous, tradeDate));
      const startedAt = Date.now();

      // fetch + retry（transient 重试 / 限频 60s 一次 / 配额停止）
      const fetchOutcome = await withRetry(() => provider.fetchDailyByTradeDate(tradeDate), {
        sleep: this.deps.sleep,
      });
      if (!fetchOutcome.ok) {
        if (fetchOutcome.quotaStopped) {
          await checkpointStore.set(toFinalCheckpoint(tradeDate, "QUOTA_STOPPED", fetchOutcome.attempts, {
            errorCode: fetchOutcome.error.code,
            errorMessage: fetchOutcome.error.message,
          }));
          this.logger.warn(`[BACKFILL] date=${tradeDate} provider=${provider.name} status=QUOTA_STOPPED`);
          quotaStopped = true;
          break;
        }
        await checkpointStore.set(toFinalCheckpoint(tradeDate, "FAILED", fetchOutcome.attempts, {
          errorCode: fetchOutcome.error.code,
          errorMessage: fetchOutcome.error.message,
        }));
        this.logger.warn(`[BACKFILL] date=${tradeDate} provider=${provider.name} status=FAILED error=${fetchOutcome.error.code}`);
        continue;
      }

      const result = fetchOutcome.value;
      const pipeline = runDailyPipeline(result, { tradingDates: new Set(tradingDates) });

      // 数据持久化成功后才可标记 SUCCESS。
      try {
        const persistResult = await persistInBatches(pipeline.persistRows, upsertFn, config.batchSize);
        totalRows += persistResult.written;
        processedRowCounts.push(pipeline.persistRows.length);

        // 覆盖率可疑检测（相对已处理日期中位数）。
        const baseline = median(processedRowCounts) ?? 0;
        const suspicious = baseline > 0 && isSuspiciousCoverage(pipeline.persistRows.length, baseline, config.suspiciousCoverageRatio);
        const finalStatus = suspicious ? "SUSPICIOUS" : "SUCCESS";

        await checkpointStore.set(toFinalCheckpoint(tradeDate, finalStatus, fetchOutcome.attempts, {
          rowCount: pipeline.persistRows.length,
          receivedRows: result.rows.length,
        }));

        const durationMs = Date.now() - startedAt;
        this.logger.info(
          `[BACKFILL] date=${tradeDate} provider=${provider.name} status=${finalStatus} rows=${pipeline.persistRows.length} received=${result.rows.length} invalid=${pipeline.invalidCount} durationMs=${durationMs} attempt=${fetchOutcome.attempts}`,
        );
        if (suspicious) {
          this.logger.warn(`[BACKFILL] date=${tradeDate} status=SUSPICIOUS rows=${pipeline.persistRows.length} < ${config.suspiciousCoverageRatio * 100}% baseline=${baseline}`);
        }
      } catch (persistError) {
        await checkpointStore.set(toFinalCheckpoint(tradeDate, "FAILED", fetchOutcome.attempts, {
          errorCode: "PERSISTENCE_ERROR",
          errorMessage: persistError instanceof Error ? persistError.message : String(persistError),
        }));
        this.logger.warn(`[BACKFILL] date=${tradeDate} provider=${provider.name} status=FAILED error=PERSISTENCE_ERROR`);
        continue;
      }

      processedDates += 1;
    }

    const finalCheckpoints = await checkpointStore.list(startDate, endDate);
    const counts = {
      completedTradingDates: finalCheckpoints.filter((cp) => cp.status === "SUCCESS").length,
      failedTradingDates: finalCheckpoints.filter((cp) => cp.status === "FAILED").length,
      suspiciousTradingDates: finalCheckpoints.filter((cp) => cp.status === "SUSPICIOUS").length,
      quotaStoppedTradingDates: finalCheckpoints.filter((cp) => cp.status === "QUOTA_STOPPED").length,
      totalRows,
    };

    return {
      manifest: finalizeManifest(manifest, counts),
      quotaStopped,
      processedDates,
      totalRows,
    };
  }
}

/** 已导出供单测复用：创建 PENDING checkpoint（避免 scheduler 内部直接依赖）。 */
export { createPendingCheckpoint };
export type { BackfillCheckpoint };
