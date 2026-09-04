import "dotenv/config";
import { inferStockSuspensionWindows } from "../server/stockPriceSync";
import { getStockSuspensionWindows } from "../server/db";

const DELISTED_STOCKS = ["000004.SZ"];
const START = "2025-01-01";
const END = "2026-09-04";

async function main() {
  console.log("对退市股票跑停牌/退市推断：", DELISTED_STOCKS.join(", "));
  const results = await inferStockSuspensionWindows(DELISTED_STOCKS, START, END);
  for (const r of results) {
    console.log(`\n[${r.stockCode}] tradedDates=${r.tradedDates} invalidCode=${r.invalidCode ?? false} trailing=${r.trailing ?? false}`);
    for (const w of r.windows) {
      console.log(`  窗口 ${w.startDate} ~ ${w.endDate}（${w.tradingDayCount} 个交易日）`);
    }
  }

  console.log("\n=== 落库后的停牌窗口 ===");
  const windows = await getStockSuspensionWindows(DELISTED_STOCKS);
  for (const w of windows) {
    console.log(`${w.stockCode} ${w.startDate} ~ ${w.endDate} [${w.source}] ${w.note ?? ""}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
