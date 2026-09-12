/**
 * DATASET-003B 证据探针：涨停判定「未四舍五入阈值」在真实数据上的漏判规模。
 *
 * 现状（server/datasetRegistry/detection.isLimitUpClose）：
 *   close >= preClose * (1 + ratio)                ← 未四舍五入（原始浮点乘积）
 * 交易所口径：
 *   涨停价 = round(preClose * (1 + ratio), 2)      ← 四舍五入到分
 *
 * 判据（只统计「收盘价恰为涨停价」的封板样本，排除 ST/除权等杂音）：
 *   A = 行数满足 close == round(preClose*(1+ratio), 2)（该 ratio 下的合法封板收盘价）
 *   B ⊆ A 中当前实现判定为涨停的行数（close >= preClose*(1+ratio)）
 *   漏判 = A - B
 *
 * 附带统计「最高价触板但收盘未封」的样本，用于说明触板口径差异（不计入漏判）。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

function boardRatioOf(code) {
  const m = String(code).match(/^(\d+)/);
  const c = m ? m[1] : "";
  if (!c) return null;
  if (/^(300|301)/.test(c)) return 0.2;
  if (/^(688|689)/.test(c)) return 0.2;
  if (/^(920|43|83|87|88|4|8)/.test(c)) return 0.3;
  if (/^(60|000|001|002|003)/.test(c)) return 0.1;
  return null;
}

const EPS = 1e-9;

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const t0 = Date.now();
  const [rows] = await conn.query(
    `SELECT stockCode, tradeDate, closePrice, preClosePrice, highPrice
     FROM stock_daily_prices
     WHERE tradeDate >= '2025-01-01' AND tradeDate <= '2026-09-04'
     ORDER BY tradeDate DESC, stockCode
     LIMIT 300000`,
  );
  console.log(`fetched ${rows.length} rows in ${Date.now() - t0}ms`);

  let scanned = 0;
  let sealedLimitUp = 0; // A：收盘价恰为（该板块比例的）四舍五入涨停价
  let detectedByCurrentImpl = 0; // B
  let missed = 0; // A - B
  const sumByBoard = new Map();
  const samples = [];

  for (const r of rows) {
    const ratio = boardRatioOf(r.stockCode);
    if (ratio === null) continue;
    const pc = Number(r.preClosePrice);
    const cl = Number(r.closePrice);
    if (!Number.isFinite(pc) || !Number.isFinite(cl) || pc <= 0 || cl <= 0) continue;
    scanned += 1;

    const raw = pc * (1 + ratio);
    const rounded = Math.round(raw * 100) / 100;
    if (Math.abs(cl - rounded) > EPS) continue; // 非「恰为涨停价」→ 跳过（含 ST 5% 等杂音）

    sealedLimitUp += 1;
    const key = `${ratio}`;
    sumByBoard.set(key, (sumByBoard.get(key) ?? 0) + 1);

    if (cl >= raw - EPS) {
      detectedByCurrentImpl += 1;
    } else {
      missed += 1;
      if (samples.length < 10) {
        samples.push({
          code: r.stockCode,
          date: String(r.tradeDate).slice(0, 10),
          preClose: pc,
          close: cl,
          ratio,
          thresholdRaw: Number(raw.toFixed(10)),
          exchangeLimitPrice: rounded,
        });
      }
    }
  }

  console.log(JSON.stringify({
    scanned,
    sealedLimitUpCloses: sealedLimitUp,
    detectedByCurrentImpl,
    missedByCurrentImpl: missed,
    missedShare: sealedLimitUp > 0 ? `${((missed / sealedLimitUp) * 100).toFixed(2)}%` : "n/a",
    sealedLimitUpByRatio: Object.fromEntries(sumByBoard),
    samples,
  }, null, 2));

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
