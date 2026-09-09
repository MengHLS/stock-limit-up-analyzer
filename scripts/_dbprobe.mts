import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

async function main() {
  const db = await getDb();
  if (!db) {
    log("no db");
    return;
  }
  const r1 = await db.execute(sql.raw(`SELECT MIN(tradeDate) AS mn, MAX(tradeDate) AS mx FROM index_daily`));
  log("index_daily: " + JSON.stringify(r1[0]));
  const r2 = await db.execute(sql.raw(`SELECT MIN(tradeDate) AS mn, MAX(tradeDate) AS mx FROM stock_daily_prices`));
  log("stock_daily_prices: " + JSON.stringify(r2[0]));
  const r3 = await db.execute(sql.raw(`SELECT MIN(tradeDate) AS mn, MAX(tradeDate) AS mx FROM liquidity_daily`));
  log("liquidity_daily: " + JSON.stringify(r3[0]));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stdout.write("ERR " + String(e).slice(0, 300) + "\n");
    process.exit(1);
  });
