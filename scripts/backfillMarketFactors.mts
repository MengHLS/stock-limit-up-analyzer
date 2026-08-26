import { getDistinctDates, upsertMarketData } from "../server/db";
import { fetchMarketFactorSnapshot } from "../server/marketFactors";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const concurrency = 2;

async function runPool<T>(items: T[], work: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await work(item);
    }
  });
  await Promise.all(workers);
}

const requestedDates = process.env.MARKET_FACTOR_DATES?.split(",").map((date) => date.trim()).filter(Boolean);
const dates = (requestedDates && requestedDates.length > 0 ? requestedDates : await getDistinctDates()).sort();
let completed = 0;
const failures: Array<{ date: string; error: string }> = [];

await runPool(dates, async (date) => {
  try {
    const snapshot = await fetchMarketFactorSnapshot(date);
    await upsertMarketData({
      dataDate: date,
      turnover: String(snapshot.turnoverYi),
      marginBalance: String(snapshot.marginBalanceYi),
      note: "真实来源：Tushare daily（沪深成交额）+ 上交所/深交所公开两融汇总",
    });
    completed += 1;
    console.log(`[market-backfill] ${date} turnover=${snapshot.turnoverYi} margin=${snapshot.marginBalanceYi}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ date, error: message });
    console.error(`[market-backfill] ${date} failed: ${message}`);
  }
  await delay(120);
});

console.log(JSON.stringify({ requested: dates.length, completed, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
