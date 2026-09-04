import { fetchMarketFactorSnapshot } from "./marketFactors";
import * as db from "./db";

/** 北京时间相对 UTC 的偏移（中国无夏令时，固定 +8 小时）。 */
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

/** 返回北京时间当日字符串 YYYY-MM-DD。 */
export function getBeijingDateString(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

export type MarketSyncOutcome = {
  ok: boolean;
  date: string;
  turnoverYi?: number;
  marginBalanceYi?: number;
  sources?: { turnover: string; marginBalance: string };
  /** 同步被跳过/失败的原因（数据源不可用、非交易日、并发中）。 */
  skipped?: string;
  /** 本次同步完成的时间（ISO 8601）。 */
  at: string;
};

// 并发锁：避免定时任务与手动触发同时跑，防止重复写库。
let syncing = false;

// 内存中记录最近一次同步结果，供前端「最近同步状态」查询（服务重启后清空，可接受）。
let lastSyncResult: MarketSyncOutcome | null = null;

export function getLastMarketSyncResult(): MarketSyncOutcome | null {
  return lastSyncResult;
}

/**
 * 同步「今天」的沪深成交额与两融余额并写入 market_data。
 * 数据源均来自可追溯的真实来源（Tushare daily + 上交所/深交所公开两融汇总），
 * 任一来源不可用时抛错并跳过，绝不写入占位值。
 */
export async function syncMarketDataOnce(now = new Date()): Promise<MarketSyncOutcome> {
  if (syncing) {
    return {
      ok: false,
      date: getBeijingDateString(now),
      skipped: "已有同步任务进行中，跳过本次",
      at: new Date().toISOString(),
    };
  }
  syncing = true;
  try {
    const todayStr = getBeijingDateString(now);
    const snapshot = await fetchMarketFactorSnapshot(todayStr);
    await db.upsertMarketData({
      dataDate: todayStr,
      turnover: String(snapshot.turnoverYi),
      marginBalance: String(snapshot.marginBalanceYi),
      // note 必须包含「上交所/深交所公开两融汇总」，回测的 buildVerifiedMarketFactorMap 靠它识别可信来源。
      note: "自动同步：Tushare daily（沪深成交额）+ 上交所/深交所公开两融汇总",
    });
    const result: MarketSyncOutcome = {
      ok: true,
      date: todayStr,
      turnoverYi: snapshot.turnoverYi,
      marginBalanceYi: snapshot.marginBalanceYi,
      sources: { turnover: snapshot.sources.turnover, marginBalance: snapshot.sources.marginBalance },
      at: new Date().toISOString(),
    };
    lastSyncResult = result;
    console.log(
      `[MarketSync] 自动同步成功 ${todayStr}: turnover=${snapshot.turnoverYi}亿, marginBalance=${snapshot.marginBalanceYi}亿`
    );
    return result;
  } catch (error) {
    const skipped = error instanceof Error ? error.message : String(error);
    const result: MarketSyncOutcome = {
      ok: false,
      date: getBeijingDateString(now),
      skipped,
      at: new Date().toISOString(),
    };
    lastSyncResult = result;
    console.warn(`[MarketSync] 自动同步跳过 ${result.date}: ${skipped}`);
    return result;
  } finally {
    syncing = false;
  }
}

/** 若今日（北京时间）尚无大盘数据则补同步一次；已有则跳过。用于服务启动后的兜底。 */
export async function syncMarketDataIfMissing(now = new Date()): Promise<MarketSyncOutcome | null> {
  const todayStr = getBeijingDateString(now);
  const existing = await db.getMarketDataByDate(todayStr);
  if (existing) {
    console.log(`[MarketSync] 今日 ${todayStr} 已有大盘数据，跳过启动补同步`);
    return null;
  }
  return syncMarketDataOnce(now);
}

/** 距离下一个北京时间 HH:mm 的毫秒数。 */
function msUntilNextBeijingTime(now: Date, hour: number, minute: number): number {
  const beijingNow = now.getTime() + BEIJING_OFFSET_MS;
  const beijingDayStart = Math.floor(beijingNow / 86_400_000) * 86_400_000;
  let target = beijingDayStart + hour * 3_600_000 + minute * 60_000;
  if (target <= beijingNow) target += 86_400_000;
  return target - beijingNow;
}

/** 盘后同步时刻（北京时间）：16:00 主同步，17:30 补漏重试。 */
const SYNC_TIMES = [
  { hour: 16, minute: 0 },
  { hour: 17, minute: 30 },
];

/**
 * 启动大盘数据盘后自动同步调度器。
 * 无第三方 cron 依赖，服务自身用 setTimeout 精确计算到下一个触发时刻。
 * 非交易日（周末/节假日）数据源不可用会自然失败并被记录，无需额外交易日历。
 */
export function startMarketSyncScheduler(): void {
  const scheduleNext = () => {
    const now = new Date();
    const delays = SYNC_TIMES.map((t) => msUntilNextBeijingTime(now, t.hour, t.minute));
    const delay = Math.min(...delays);
    setTimeout(() => {
      void syncMarketDataOnce().catch((error) => {
        console.error("[MarketSync] 调度任务异常:", error);
      });
      scheduleNext();
    }, delay);
  };
  scheduleNext();
  const label = SYNC_TIMES.map((t) => `${t.hour}:${String(t.minute).padStart(2, "0")}`).join("、");
  console.log(`[MarketSync] 已启动盘后自动同步调度（北京时间 ${label}）`);
}
