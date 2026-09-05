import { advanceAllActivePaperTradingRuns } from "./db";
import type { PaperTradingSummary } from "./paperTrading";

/**
 * 前向纸面交易每日推进调度器（四-P1）。
 * 每日收盘后、日线行情与涨停记录就绪后，把全部 active 运行推进到最新交易日：
 * 开盘成交既有准备清单 → 收盘止盈止损出清 → 标记市值 → 生成下一交易日准备清单。
 * 无第三方 cron 依赖，服务自身用 setTimeout 精确计算到下一个触发时刻。
 */

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

let advancing = false;

export type PaperTradingAdvanceOutcome = {
  ok: boolean;
  /** 推进被跳过/失败的原因。 */
  skipped?: string;
  results?: Array<{ runId: number; label: string; summary: PaperTradingSummary | null }>;
  at: string;
};

/** 推进全部 active 运行到最新交易日；并发锁避免定时与手动触发重复执行。 */
export async function advancePaperTradingOnce(): Promise<PaperTradingAdvanceOutcome> {
  if (advancing) {
    return { ok: false, skipped: "已有推进任务进行中，跳过本次", at: new Date().toISOString() };
  }
  advancing = true;
  try {
    const results = await advanceAllActivePaperTradingRuns();
    console.log(`[PaperTrading] 推进 ${results.length} 条运行`);
    return { ok: true, results, at: new Date().toISOString() };
  } catch (error) {
    const skipped = error instanceof Error ? error.message : String(error);
    console.warn(`[PaperTrading] 推进失败: ${skipped}`);
    return { ok: false, skipped, at: new Date().toISOString() };
  } finally {
    advancing = false;
  }
}

/** 距离下一个北京时间 HH:mm 的毫秒数。 */
function msUntilNextBeijingTime(now: Date, hour: number, minute: number): number {
  const beijingNow = now.getTime() + BEIJING_OFFSET_MS;
  const beijingDayStart = Math.floor(beijingNow / 86_400_000) * 86_400_000;
  let target = beijingDayStart + hour * 3_600_000 + minute * 60_000;
  if (target <= beijingNow) target += 86_400_000;
  return target - beijingNow;
}

/** 盘后推进时刻（北京时间）：17:00 主推进，18:30 补漏重试。 */
const ADVANCE_TIMES = [
  { hour: 17, minute: 0 },
  { hour: 18, minute: 30 },
];

/** 启动前向纸面交易每日推进调度器。 */
export function startPaperTradingScheduler(): void {
  const scheduleNext = () => {
    const now = new Date();
    const delays = ADVANCE_TIMES.map((t) => msUntilNextBeijingTime(now, t.hour, t.minute));
    const delay = Math.min(...delays);
    setTimeout(() => {
      void advancePaperTradingOnce().catch((error) => {
        console.error("[PaperTrading] 调度任务异常:", error);
      });
      scheduleNext();
    }, delay);
  };
  scheduleNext();
  const label = ADVANCE_TIMES.map((t) => `${t.hour}:${String(t.minute).padStart(2, "0")}`).join("、");
  console.log(`[PaperTrading] 已启动前向纸面交易推进调度（北京时间 ${label}）`);
}
