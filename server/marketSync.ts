import { fetchMarketFactorSnapshot } from "./marketFactors";
import * as db from "./db";

/** 北京时间相对 UTC 的偏移（中国无夏令时，固定 +8 小时）。 */
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

/** 自动同步写入 market_data 的 note。
 * 必须包含「上交所/深交所公开两融汇总」——回测的 buildVerifiedMarketFactorMap 靠它识别可信来源。 */
const AUTO_SYNC_NOTE = "自动同步：Tushare daily（沪深成交额）+ 上交所/深交所公开两融汇总";

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

/** 在 YYYY-MM-DD 上加减天数（用 UTC 做纯日期算术，不经本地时区，避免跨时区偏移一天）。 */
export function shiftDateString(date: string, days: number): string {
  const parts = date.split("-").map((value) => Number.parseInt(value, 10));
  const base = Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!) + days * 86_400_000;
  const shifted = new Date(base);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * 补缺窗口（自然日，往回数）。稳态下窗口内只有「最新一个交易日」待补；
 * 长窗口的意义是「服务停机数天 / 数据源延迟多日」后能自愈，而不是每天真去扫 30 天。
 */
export const MARKET_SYNC_LOOKBACK_DAYS = 30;

/** 服务启动兜底补同步用的窗口（比定时任务小，避免每次热重启都去扫长历史）。 */
export const MARKET_SYNC_STARTUP_LOOKBACK_DAYS = 10;

/** 单轮连续取数失败上限：达到即判定数据源整体不可用并提前中止（省 Tushare 配额与对方站点压力）。 */
export const MARKET_SYNC_MAX_CONSECUTIVE_FAILURES = 3;

/** 相邻两个交易日取数之间的间隔（毫秒），与回填脚本保持一致的礼貌节流。 */
const MARKET_SYNC_INTER_DATE_DELAY_MS = 120;

/**
 * 自动同步时刻（北京时间）。
 *
 * 🔴 为什么不是「当天盘后」：实测上交所两融汇总文件 rzrqjygkYYYYMMDD.xls 的 Last-Modified
 * 恒为「T 日 23:40 UTC」= **T+1 日 07:40 北京时**（2026-09-09/10/11/14 四例一致），
 * 深交所同源文件在 T 日 21:00 仍只返回表头无数据行。
 * 而 market_data 的成交额与两融余额是同一条 NOT NULL 行、且禁止写占位值
 * ⇒ 合成行最早只能在 T+1 早晨写成功。原 16:00 / 17:30 的时刻**必然**取不到两融、
 * 整日不写库（这就是「成交额与两融余额不更新」的根因）。
 */
export const MARKET_SYNC_TIMES = [
  { hour: 8, minute: 30 },
  { hour: 12, minute: 30 },
];

export type MarketSyncFilledDate = { date: string; turnoverYi: number; marginBalanceYi: number };
export type MarketSyncFailure = { date: string; reason: string };

export type MarketSyncOutcome = {
  ok: boolean;
  /** 本次同步涉及的目标日：成功时 = 最新补齐日；无缺口时 = 最新已有数据日；否则 = 窗口内最后一个待补日。 */
  date: string;
  turnoverYi?: number;
  marginBalanceYi?: number;
  sources?: { turnover: string; marginBalance: string };
  /** 同步被跳过 / 未补齐的原因（数据源未发布、并发中）。 */
  skipped?: string;
  /** 本次同步完成的时间（ISO 8601）。 */
  at: string;
  /** 数据已是最新（窗口内无待补交易日）。 */
  upToDate?: boolean;
  /** 本次成功写入 market_data 的日期（升序）。 */
  filledDates?: string[];
  /** 本次尝试但数据源尚未发布 / 取数失败的日期与原因（**未写任何占位值**）。 */
  failedDates?: MarketSyncFailure[];
  /** 数据源整体不可用而提前中止时的原因。 */
  abortedReason?: string;
};

export type MarketDataGapStatus = {
  today: string;
  lookbackDays: number;
  /** market_data 全表最新日期；无数据为 null。 */
  latestDataDate: string | null;
  /** 窗口内待补的交易日（升序）。末位通常是「今日」——其两融要等次日早晨才发布，属预期而非故障。 */
  pendingDates: string[];
  /** 今日（北京时）是否已有 market_data 行。 */
  hasTodayData: boolean;
};

/**
 * 从交易日历中挑出 market_data 尚无数据、且日期 ≤ endDate 的交易日（升序）。
 *
 * 纯函数，只做集合差：**不猜数据源可用性** —— 末端「尚未发布」的日期仍会被列出，
 * 由取数环节如实失败并记录原因（而不是在这里静默跳过、让缺口无人知晓）。
 */
export function selectMissingTradingDates(
  tradingDates: readonly string[],
  existingDates: readonly string[],
  endDate: string,
): string[] {
  const present = new Set(existingDates);
  return tradingDates
    .filter((date) => date <= endDate)
    .filter((date) => !present.has(date))
    .sort((a, b) => a.localeCompare(b));
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// 并发锁：避免定时任务与手动触发同时跑，防止重复写库。
let syncing = false;

// 内存中记录最近一次同步结果，供前端「最近同步状态」查询（服务重启后清空，可接受）。
let lastSyncResult: MarketSyncOutcome | null = null;

export function getLastMarketSyncResult(): MarketSyncOutcome | null {
  return lastSyncResult;
}

/** 把失败明细压成一句人话（区分「今日尚未发布（预期）」与「多日缺口（异常）」）。 */
function describeFailures(today: string, failed: readonly MarketSyncFailure[]): string {
  const first = failed[0];
  if (failed.length === 1 && first && first.date === today) {
    return `今日（${today}）市场数据尚未发布：${first.reason}（交易所两融文件实测于次日 07:40 才生成）`;
  }
  return `${failed.length} 个交易日暂未取到：${failed.map((item) => item.date).join("、")}（首个原因：${first?.reason ?? "未知"}）`;
}

/** 查询当前缺口状态：最新数据日 + 窗口内待补交易日。 */
export async function getMarketDataGapStatus(
  now = new Date(),
  lookbackDays = MARKET_SYNC_LOOKBACK_DAYS,
): Promise<MarketDataGapStatus> {
  const today = getBeijingDateString(now);
  const startDate = shiftDateString(today, -lookbackDays);
  const [{ calendarDates, existingDates }, latestDataDate] = await Promise.all([
    db.getMarketDataGapInputs(startDate, today),
    db.getLatestMarketDataDate(),
  ]);
  return {
    today,
    lookbackDays,
    latestDataDate,
    pendingDates: selectMissingTradingDates(calendarDates, existingDates, today),
    hasTodayData: existingDates.includes(today),
  };
}

/**
 * 补齐窗口内所有缺失交易日的大盘数据（成交额 + 两融余额），一律写真实来源。
 *
 * 与旧实现的区别：目标日**不是「今天」**，而是「窗口内所有还没有数据的交易日」。
 * 任一来源不可用 ⇒ 该日如实记入 failedDates 并跳过，**绝不写占位值**；
 * 其余日期照常补齐（所以「今日两融尚未发布」不会拖累历史缺口）。
 * 按升序补齐（先补最旧的缺口）；连续失败达上限即判定数据源整体不可用并提前中止。
 */
export async function syncMarketDataGap(
  now = new Date(),
  lookbackDays = MARKET_SYNC_LOOKBACK_DAYS,
): Promise<MarketSyncOutcome> {
  const today = getBeijingDateString(now);

  if (syncing) {
    return {
      ok: false,
      date: today,
      skipped: "已有同步任务进行中，跳过本次",
      at: new Date().toISOString(),
    };
  }
  syncing = true;
  try {
    const startDate = shiftDateString(today, -lookbackDays);
    const { calendarDates, existingDates } = await db.getMarketDataGapInputs(startDate, today);
    const pendingDates = selectMissingTradingDates(calendarDates, existingDates, today);
    const latestExisting = existingDates.length > 0 ? existingDates[existingDates.length - 1]! : null;

    if (pendingDates.length === 0) {
      const upToDate: MarketSyncOutcome = {
        ok: true,
        upToDate: true,
        date: latestExisting ?? today,
        at: new Date().toISOString(),
        filledDates: [],
        failedDates: [],
      };
      lastSyncResult = upToDate;
      console.log(
        `[MarketSync] 已是最新，无需同步（窗口 ${startDate} ~ ${today}，最新数据日 ${latestExisting ?? "无"}）`,
      );
      return upToDate;
    }

    const filled: MarketSyncFilledDate[] = [];
    const failed: MarketSyncFailure[] = [];
    let abortedReason: string | undefined;
    let consecutiveFailures = 0;
    let isFirst = true;

    for (const date of pendingDates) {
      if (!isFirst) await delay(MARKET_SYNC_INTER_DATE_DELAY_MS);
      isFirst = false;
      try {
        const snapshot = await fetchMarketFactorSnapshot(date);
        await db.upsertMarketData({
          dataDate: date,
          turnover: String(snapshot.turnoverYi),
          marginBalance: String(snapshot.marginBalanceYi),
          note: AUTO_SYNC_NOTE,
        });
        filled.push({ date, turnoverYi: snapshot.turnoverYi, marginBalanceYi: snapshot.marginBalanceYi });
        consecutiveFailures = 0;
        console.log(
          `[MarketSync] 补齐 ${date}: turnover=${snapshot.turnoverYi}亿, marginBalance=${snapshot.marginBalanceYi}亿`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failed.push({ date, reason });
        consecutiveFailures += 1;
        console.warn(`[MarketSync] ${date} 暂不可用（不写占位值）：${reason}`);
        if (consecutiveFailures >= MARKET_SYNC_MAX_CONSECUTIVE_FAILURES) {
          abortedReason = `连续 ${consecutiveFailures} 个交易日取数失败，判定数据源整体不可用，提前中止本轮`;
          console.warn(`[MarketSync] ${abortedReason}`);
          break;
        }
      }
    }

    const newest = filled.length > 0 ? filled[filled.length - 1]! : null;
    const result: MarketSyncOutcome = {
      ok: filled.length > 0,
      upToDate: false,
      date: newest?.date ?? pendingDates[pendingDates.length - 1]!,
      turnoverYi: newest?.turnoverYi,
      marginBalanceYi: newest?.marginBalanceYi,
      sources: newest ? { turnover: "tushare_daily", marginBalance: "sse_szse_public" } : undefined,
      skipped: filled.length === 0 ? describeFailures(today, failed) : undefined,
      at: new Date().toISOString(),
      filledDates: filled.map((item) => item.date),
      failedDates: failed,
      abortedReason,
    };
    lastSyncResult = result;
    console.log(
      `[MarketSync] 本轮完成：补齐 ${filled.length} 天、未取到 ${failed.length} 天（待补 ${pendingDates.length} 天）`,
    );
    return result;
  } catch (error) {
    const skipped = error instanceof Error ? error.message : String(error);
    const result: MarketSyncOutcome = {
      ok: false,
      date: today,
      skipped,
      at: new Date().toISOString(),
    };
    lastSyncResult = result;
    console.warn(`[MarketSync] 本轮异常中止 ${result.date}: ${skipped}`);
    return result;
  } finally {
    syncing = false;
  }
}

/** 同步窗口内缺失的大盘数据（历史名保留：定时任务 / cron 回调 / 手动触发共用此入口）。 */
export async function syncMarketDataOnce(now = new Date()): Promise<MarketSyncOutcome> {
  return syncMarketDataGap(now);
}

/** 启动兜底：窗口内存在待补交易日则补同步一次；无缺口则返回 null。 */
export async function syncMarketDataIfMissing(now = new Date()): Promise<MarketSyncOutcome | null> {
  const status = await getMarketDataGapStatus(now, MARKET_SYNC_STARTUP_LOOKBACK_DAYS);
  if (status.pendingDates.length === 0) {
    console.log(
      `[MarketSync] 启动补同步检查：窗口内无待补交易日，跳过（最新数据日 ${status.latestDataDate ?? "无"}）`,
    );
    return null;
  }
  return syncMarketDataGap(now, MARKET_SYNC_STARTUP_LOOKBACK_DAYS);
}

/** 距离下一个北京时间 HH:mm 的毫秒数。 */
function msUntilNextBeijingTime(now: Date, hour: number, minute: number): number {
  const beijingNow = now.getTime() + BEIJING_OFFSET_MS;
  const beijingDayStart = Math.floor(beijingNow / 86_400_000) * 86_400_000;
  let target = beijingDayStart + hour * 3_600_000 + minute * 60_000;
  if (target <= beijingNow) target += 86_400_000;
  return target - beijingNow;
}

/**
 * 启动大盘数据自动同步调度器。
 * 无第三方 cron 依赖，服务自身用 setTimeout 精确计算到下一个触发时刻；
 * 非交易日不会命中交易日历、自然无事可做，无需额外交易日历判断。
 */
export function startMarketSyncScheduler(): void {
  const scheduleNext = () => {
    const now = new Date();
    const delays = MARKET_SYNC_TIMES.map((time) => msUntilNextBeijingTime(now, time.hour, time.minute));
    const delayMs = Math.min(...delays);
    setTimeout(() => {
      void syncMarketDataOnce().catch((error) => {
        console.error("[MarketSync] 调度任务异常:", error);
      });
      scheduleNext();
    }, delayMs);
  };
  scheduleNext();
  const label = MARKET_SYNC_TIMES.map((time) => `${time.hour}:${String(time.minute).padStart(2, "0")}`).join("、");
  console.log(`[MarketSync] 已启动自动同步调度（北京时间 ${label}，补齐窗口内所有缺失交易日）`);
}
