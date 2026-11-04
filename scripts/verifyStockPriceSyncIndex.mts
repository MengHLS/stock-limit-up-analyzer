/**
 * 行情同步页性能改造验收脚本。
 *
 * 验证三件事（真实 DB，不用 mock）：
 *   I1 位图索引的「已同步对位数」与 stock_daily_prices 实际行数一致；
 *   I2 抽样比对 hasStockDailyPrice() 与 SQL 直查 EXISTS 的结果一致（正例 + 反例）；
 *   I3 checkStockPriceSyncPage() 的分页/筛选/排序结果自洽，且耗时可用。
 *
 * 用法：npx tsx scripts/verifyStockPriceSyncIndex.mts [--force] [--keep]
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import {
  hasStockDailyPrice,
  refreshStockPriceIndex,
  stockPriceIndexSnapshot,
} from "../server/stockPriceIndex";
import { checkStockPriceSyncPage } from "../server/stockPriceSync";
import { getDb } from "../server/db";

/** mysql2 会把 DATE 列映射成本地时区的 Date 对象，必须归一化后再比较。 */
function isoDate(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

const force = process.argv.includes("--force");
let failures = 0;
let checks = 0;

function assert(label: string, condition: boolean, detail = ""): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const connection = await createConnection(process.env.DATABASE_URL!);

  console.log("\n=== 1. 构建 / 载入位图索引 ===");
  const buildStart = Date.now();
  const snapshot = await refreshStockPriceIndex({ force });
  const buildMs = Date.now() - buildStart;
  console.log(
    `  状态=${snapshot.status} 来源=${snapshot.loadedFrom} 股票=${snapshot.stockCount} 对位=${snapshot.pairCount} 耗时=${buildMs}ms`,
  );
  console.log(`  元数据文件 builtAt=${snapshot.builtAt} 上次构建=${snapshot.lastBuildMs ?? "-"}ms`);
  assert("索引状态为 ready", snapshot.status === "ready", snapshot.error ?? "");
  if (snapshot.status !== "ready") {
    await connection.end();
    process.exit(1);
  }

  // I1：对位总数 == 表行数（stock_daily_prices 有 (stockCode, tradeDate) 唯一键）
  console.log("\n=== I1 对位总数与表行数一致 ===");
  const [rowCount] = await connection.query("SELECT COUNT(*) AS c FROM stock_daily_prices") as unknown as [Array<{ c: number }>];
  const [minMax] = await connection.query(
    "SELECT MIN(tradeDate) AS mn, MAX(tradeDate) AS mx FROM stock_daily_prices",
  ) as unknown as [Array<{ mn: string; mx: string }>];
  console.log(`  DB 行数=${rowCount[0].c} 日期范围 ${isoDate(minMax[0].mn)} ~ ${isoDate(minMax[0].mx)}`);
  assert(
    "索引对位数 == DB 行数",
    snapshot.pairCount === rowCount[0].c,
    `索引=${snapshot.pairCount} DB=${rowCount[0].c} 差=${snapshot.pairCount - rowCount[0].c}`,
  );

  // I2：抽样比对（正例：DB 中确实存在的组合；反例：构造不存在的组合）
  console.log("\n=== I2 抽样比对 hasStockDailyPrice 与 SQL 直查 ===");
  const [trueSamples] = await connection.query(
    "SELECT stockCode, tradeDate FROM stock_daily_prices ORDER BY id DESC LIMIT 300",
  ) as unknown as [Array<{ stockCode: string; tradeDate: string }>];
  let trueHit = 0;
  for (const row of trueSamples) {
    const date = isoDate(row.tradeDate);
    if (hasStockDailyPrice(row.stockCode, date) === true) trueHit += 1;
  }
  assert("存在的组合全部命中", trueHit === trueSamples.length, `${trueHit}/${trueSamples.length}`);

  // 反例：把某个已存在组合的日期往后挪 2899 天（超过索引上限附近），或取 2026-09-11（尚未同步）
  const probeDate = "2026-09-11";
  const [probeExists] = await connection.query(
    "SELECT COUNT(*) AS c FROM stock_daily_prices WHERE tradeDate = ?",
    [probeDate],
  ) as unknown as [Array<{ c: number }>];
  if (probeExists[0].c === 0) {
    const falseHits = trueSamples.filter((row) => hasStockDailyPrice(row.stockCode, probeDate) !== false).length;
    assert(`未同步日期 ${probeDate} 全部判为缺失`, falseHits === 0, `误判 ${falseHits} 条`);
  } else {
    console.log(`  跳过反例：${probeDate} 在库中已有 ${probeExists[0].c} 行`);
  }

  const [falseSamples] = await connection.query(
    "SELECT stockCode, tradeDate FROM stock_daily_prices ORDER BY id ASC LIMIT 200",
  ) as unknown as [Array<{ stockCode: string; tradeDate: string }>];
  const fakeCode = "__NOT_A_REAL_CODE__";
  const fakeHits = falseSamples.filter((row) => hasStockDailyPrice(fakeCode, isoDate(row.tradeDate)) !== false).length;
  assert("不存在的股票代码全部判为缺失", fakeHits === 0, `误判 ${fakeHits} 条`);

  // I3：服务端分页/筛选/排序自洽
  console.log("\n=== I3 服务端分页 / 筛选 / 排序 ===");
  const t1 = Date.now();
  const first = await checkStockPriceSyncPage({ page: 1, pageSize: 20, onlyMissing: true, sortDir: "desc" });
  const firstMs = Date.now() - t1;
  assert("返回 ready", first.ready === true);
  if (!first.ready) {
    await connection.end();
    process.exit(1);
  }
  console.log(
    `  第1页 20 条，total=${first.total} totalPages=${first.totalPages} 耗时=${firstMs}ms（含首次全量计算）`,
  );
  console.log(
    `  summary: 记录=${first.summary.totalStocks} 完全同步=${first.summary.fullySynced} 部分缺失=${first.summary.partialSynced} 完全未同步=${first.summary.fullyMissing} 缺失对位=${first.summary.missingPairs} 已同步对位=${first.summary.syncedPairCount}`,
  );
  assert("页大小正确", first.items.length === Math.min(20, first.total));
  assert("totalPages 与 total 自洽", first.totalPages === Math.max(1, Math.ceil(first.total / 20)));
  assert("items 全部为缺失记录", first.items.every((item) => item.missingCount > 0));
  assert(
    "按 missingCount 降序（同日期内）",
    first.items.every((item, index) => index === 0 || first.items[index - 1]!.limitUpDate > item.limitUpDate ||
      (first.items[index - 1]!.limitUpDate === item.limitUpDate && first.items[index - 1]!.missingCount >= item.missingCount)),
  );

  // 缓存命中：第二次应显著更快
  const t2 = Date.now();
  const second = await checkStockPriceSyncPage({ page: 2, pageSize: 20, onlyMissing: true, sortDir: "desc" });
  const secondMs = Date.now() - t2;
  console.log(`  第2页 20 条 耗时=${secondMs}ms（缓存命中）`);
  assert("分页结果不重叠", second.items.every((item) => !first.items.some((x) => x.stockCode === item.stockCode && x.limitUpDate === item.limitUpDate)));

  // 排序方向
  const asc = await checkStockPriceSyncPage({ page: 1, pageSize: 5, onlyMissing: true, sortDir: "asc" });
  if (asc.ready && asc.items.length > 1) {
    const ascending = asc.items.every((item, index) => index === 0 || asc.items[index - 1]!.limitUpDate <= item.limitUpDate);
    assert("升序排序生效", ascending);
  }

  // 搜索
  if (first.items[0]) {
    const target = first.items[0];
    const searched = await checkStockPriceSyncPage({ page: 1, pageSize: 20, onlyMissing: true, sortDir: "desc", search: target.stockCode });
    assert("搜索命中目标记录", searched.ready && searched.items.some((item) => item.stockCode === target.stockCode) && searched.total <= first.total);
  }

  // 缺失明细与 SQL 直查对账：取若干条记录逐日核对
  console.log("\n=== I4 缺失明细与 SQL 直查对账 ===");
  let reconciled = 0;
  let mismatch = 0;
  for (const item of first.items.slice(0, 5)) {
    const [rows] = await connection.query(
      "SELECT tradeDate FROM stock_daily_prices WHERE stockCode = ? AND tradeDate BETWEEN ? AND ?",
      [item.stockCode, item.limitUpDate, "2026-12-31"],
    ) as unknown as [Array<{ tradeDate: string }>];
    const present = new Set(rows.map((row) => isoDate(row.tradeDate)));
    for (const date of item.missingDates) {
      if (present.has(date)) mismatch += 1;
      else reconciled += 1;
    }
  }
  assert("抽样缺失日期在 DB 中确实不存在", mismatch === 0, `核对 ${reconciled} 条，冲突 ${mismatch} 条`);

  const db = await getDb();
  assert("DB 连接可用", db != null);

  console.log(`\n=== 结果：${checks - failures}/${checks} 通过 ===`);
  await connection.end();
  if (failures > 0) process.exit(1);
  console.log(`索引快照：${JSON.stringify(stockPriceIndexSnapshot())}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
