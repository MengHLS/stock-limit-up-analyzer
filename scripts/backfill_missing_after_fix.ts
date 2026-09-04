import "dotenv/config";
import { checkStockPriceSync, syncCandidateDailyPricesForDate } from "../server/stockPriceSync";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // 找出所有缺失记录（去重股票+信号日）
  const before = await checkStockPriceSync(10);
  const missing = before.items.filter((i) => i.missingCount > 0);
  console.log(`=== 回填前：${missing.length} 条记录缺失，共 ${before.summary.missingPairs} 个缺失对 ===`);

  const unique = new Map<string, { stockCode: string; limitUpDate: string }>();
  for (const it of missing) {
    unique.set(`${it.stockCode}::${it.limitUpDate}`, { stockCode: it.stockCode, limitUpDate: it.limitUpDate });
  }
  const targets = Array.from(unique.values());
  console.log(`去重后 ${targets.length} 条待同步`);

  let done = 0;
  for (const t of targets) {
    try {
      const res = await syncCandidateDailyPricesForDate(t.limitUpDate, 10, [t.stockCode]);
      done += 1;
      console.log(`[${done}/${targets.length}] ${t.stockCode} ${t.limitUpDate}: 同步 ${res.savedPriceRows} 行, 缺 ${res.missingPricePairs}, 限频=${res.rateLimited ?? false}`);
      if (res.rateLimited) {
        console.log("  遇限频，等待 60s...");
        await sleep(60_000);
      }
    } catch (e) {
      console.log(`[${done}/${targets.length}] ${t.stockCode} ${t.limitUpDate}: 失败 ${(e as Error).message}`);
    }
    await sleep(1_200); // 轻微节流，避免触发限频
  }

  const after = await checkStockPriceSync(10);
  console.log(`\n=== 回填后：缺失记录 ${after.items.filter((i) => i.missingCount > 0).length} 条，缺失对 ${after.summary.missingPairs} 个 ===`);
  const remaining = after.items.filter((i) => i.missingCount > 0);
  for (const it of remaining) {
    console.log(`  仍缺: ${it.stockCode} ${it.stockName} 信号日${it.limitUpDate}: ${it.missingDates.join(",")}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
