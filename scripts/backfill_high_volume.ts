import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, upsertStockDailyPrices } from "../server/db";
import { fetchTushareDailyPricesByDate, isTushareRateLimitError } from "../server/tushare";
import {
  formatValidatedPriceQualityIssue,
  toValidatedStockDailyPriceUpserts,
  type ValidatedPriceQualityIssue,
} from "../server/stockPriceSync";

/**
 * 存量回填：为 stock_daily_prices 已有行补齐 highPrice、volume（其余字段幂等覆盖）。
 * 可断点续传：只处理仍有 highPrice 缺失的交易日；触发限频自动停止，可稍后重跑。
 *
 * 数据边界（STEP 5 P2-3）：回填同样是生产数据写入，必须复用生产数据质量入口
 *   toValidatedStockDailyPriceUpserts（toCanonicalBar → validateMarketBar → validated upsert），
 *   禁止在本脚本内重新实现 parseNumericPrice / validateMarketBar，
 *   禁止 String(null) / String(undefined) 之类的静默降级。
 * 行为：
 *   - source = null      → DB = null（不写 "null" / "undefined" 字面量）
 *   - 校验 INVALID       → 拒写并计数
 *   - 校验 WARNING       → 按既有生产 upsert 语义放行，并留痕
 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库");

  const datesResult = await db.execute(
    sql`SELECT DISTINCT tradeDate FROM stock_daily_prices WHERE highPrice IS NULL ORDER BY tradeDate`,
  );
  const dates = (datesResult[0] as Array<{ tradeDate: string }>).map((row) => row.tradeDate);
  console.log(`待回填 ${dates.length} 个交易日`);

  const CONCURRENCY = 2;
  let done = 0;
  let saved = 0;
  let rejected = 0;
  let rateLimited = false;
  const issueSamples: ValidatedPriceQualityIssue[] = [];

  for (let index = 0; index < dates.length && !rateLimited; index += CONCURRENCY) {
    const batch = dates.slice(index, index + CONCURRENCY);
    const results = await Promise.all(batch.map(async (tradeDate) => {
      try {
        const prices = await fetchTushareDailyPricesByDate(tradeDate);
        const codeResult = await db.execute(
          sql`SELECT DISTINCT stockCode FROM stock_daily_prices WHERE tradeDate = ${tradeDate}`,
        );
        const codeSet = new Set((codeResult[0] as Array<{ stockCode: string }>).map((row) => row.stockCode));
        // 唯一生产数据入口：Raw → Canonical → Validation → Validated Upsert。
        const validated = toValidatedStockDailyPriceUpserts(prices, codeSet);
        const count = await upsertStockDailyPrices(validated.rows);
        return {
          tradeDate,
          saved: count,
          rejected: validated.invalidCount + validated.unpersistableCount,
          qualityIssues: validated.qualityIssues,
          rateLimited: false,
        };
      } catch (error) {
        if (isTushareRateLimitError(error)) return { tradeDate, saved: 0, rejected: 0, qualityIssues: [] as ValidatedPriceQualityIssue[], rateLimited: true };
        console.warn(`跳过 ${tradeDate}：`, error instanceof Error ? error.message : String(error));
        return { tradeDate, saved: 0, rejected: 0, qualityIssues: [] as ValidatedPriceQualityIssue[], rateLimited: false };
      }
    }));

    for (const result of results) {
      done += 1;
      saved += result.saved;
      rejected += result.rejected;
      if (issueSamples.length < 50) issueSamples.push(...result.qualityIssues.slice(0, 5));
      if (result.rateLimited) rateLimited = true;
    }
    if (done % 10 === 0 || done === dates.length) console.log(`进度 ${done}/${dates.length}，累计写入 ${saved} 行，拒写 ${rejected} 行`);
  }

  if (issueSamples.length > 0) {
    console.log(`数据质量留痕（最多展示 50 条）：`);
    for (const issue of issueSamples.slice(0, 50)) console.log(`  ${formatValidatedPriceQualityIssue(issue)}`);
  }
  console.log(`完成：${done}/${dates.length} 个交易日，累计写入 ${saved} 行，拒写 ${rejected} 行${rateLimited ? "（触发限频，可重跑续传）" : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });
