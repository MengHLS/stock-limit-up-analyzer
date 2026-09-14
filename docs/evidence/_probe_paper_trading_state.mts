/**
 * 只读探查：前向纸面交易（/paper-trading 页「推进」按钮）的运行状态。
 *
 * 目的：判定「推进」为什么不做事 —— 是「无 active 运行」「已推进到最新」「行情覆盖不足」
 * 还是「state 读不回来」。只读、不改库、不写任何状态。
 *
 * 用法：npx tsx docs/evidence/_probe_paper_trading_state.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

function unwrap<T>(res: unknown): T[] {
  if (Array.isArray(res)) return (Array.isArray(res[0]) ? res[0] : res) as T[];
  return [];
}

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }, null, 2));
  process.exit(1);
}

const runs = unwrap<Record<string, unknown>>(
  await db.execute(sql`
    select id, label, strategyKey, status, lastProcessedDate, initialCapital,
           length(stateJson) as stateJsonLen, createdAt, updatedAt
    from paper_trading_runs
    order by id asc
  `),
);

const limitUpRange = unwrap<Record<string, unknown>>(
  await db.execute(sql`select min(limitUpDate) as minD, max(limitUpDate) as maxD, count(*) as c from limit_up_records`),
);

const priceRange = unwrap<Record<string, unknown>>(
  await db.execute(sql`select min(tradeDate) as minD, max(tradeDate) as maxD, count(*) as c from stock_daily_prices`),
);

const recentTradeDates = unwrap<Record<string, unknown>>(
  await db.execute(sql`
    select tradeDate, count(*) as c from stock_daily_prices
    where tradeDate >= (select date_sub(max(tradeDate), interval 12 day) from stock_daily_prices)
    group by tradeDate order by tradeDate desc
  `),
);

// 逐条解析 stateJson 的规模（不读全量价格，只读这一列文本）
const perRun: Array<Record<string, unknown>> = [];
for (const r of runs) {
  const id = Number(r["id"]);
  const stateRows = unwrap<Record<string, unknown>>(
    await db.execute(sql`select stateJson from paper_trading_runs where id = ${id}`),
  );
  const raw = (stateRows[0]?.["stateJson"] ?? null) as string | null;
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      parseError = String(e);
    }
  }
  perRun.push({
    ...r,
    parseError,
    state: parsed === null
      ? null
      : {
          cash: parsed["cash"] ?? null,
          positions: Array.isArray(parsed["positions"]) ? (parsed["positions"] as unknown[]).length : null,
          pendingBuys: Array.isArray(parsed["pendingBuys"]) ? (parsed["pendingBuys"] as unknown[]).length : null,
          orders: Array.isArray(parsed["orders"]) ? (parsed["orders"] as unknown[]).length : null,
          equityCurve: Array.isArray(parsed["equityCurve"]) ? (parsed["equityCurve"] as unknown[]).length : null,
          lastProcessedDate: parsed["lastProcessedDate"] ?? null,
          pendingBuyFirst: Array.isArray(parsed["pendingBuys"]) && (parsed["pendingBuys"] as unknown[]).length > 0
            ? ((parsed["pendingBuys"] as Record<string, unknown>[])[0]["signalDate"] ?? null)
            : null,
        },
  });
}

console.log(JSON.stringify({ limitUpRange, priceRange, recentTradeDates, runs: perRun }, null, 2));
process.exit(0);
