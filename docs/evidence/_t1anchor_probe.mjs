/**
 * 证据探针：T-1 锚点验证中「前一日未涨停」的 4 个样本，是否因为我脚本用了错误的涨停比例
 * （未考虑 PIT ST 的 5% 口径）而误报。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const SAMPLES = [
  ["000615.SZ", "2023-12-29"],
  ["000669.SZ", "2023-12-29"],
  ["002309.SZ", "2023-12-29"],
];

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  for (const [code, date] of SAMPLES) {
    const [bars] = await conn.query(
      "SELECT stockCode, tradeDate, closePrice, preClosePrice, highPrice FROM stock_daily_prices WHERE stockCode=? AND tradeDate=?",
      [code, date],
    );
    const bar = bars[0];
    // 身份 → PIT ST 状态
    const [ids] = await conn.query(
      "SELECT securityId, exchange, securityCode, effectiveFrom, effectiveTo FROM research_security_identifier_history WHERE exchange=? AND securityCode=? ORDER BY effectiveFrom",
      [code.split(".")[1], code.split(".")[0]],
    );
    let st = "UNKNOWN";
    const detail = [];
    for (const id of ids) {
      const [sts] = await conn.query(
        "SELECT statusType, statusValue, effectiveFrom, effectiveTo FROM research_security_status_history WHERE securityId=? AND statusType='ST' AND effectiveFrom<=? AND (effectiveTo IS NULL OR effectiveTo>=?)",
        [id.securityId, date, date],
      );
      for (const s of sts) detail.push(s);
      if (sts.length > 0) st = sts[0].statusValue;
    }
    const pc = bar ? Number(bar.preClosePrice) : NaN;
    const cl = bar ? Number(bar.closePrice) : NaN;
    const r10 = Math.round(pc * 1.1 * 100) / 100;
    const r05 = Math.round(pc * 1.05 * 100) / 100;
    const r20 = Math.round(pc * 1.2 * 100) / 100;
    console.log(JSON.stringify({
      code, date,
      bar: bar ? { close: cl, preClose: pc, high: Number(bar.highPrice) } : null,
      pitSt: st,
      stIntervals: detail,
      limitIf10pct: r10, limitIf5pct: r05, limitIf20pct: r20,
      isLimitUpIf10: cl >= r10, isLimitUpIf5: cl >= r05, isLimitUpIf20: cl >= r20,
      identifiers: ids.map((i) => ({ securityId: i.securityId, from: i.effectiveFrom, to: i.effectiveTo })),
    }, null, 2));
  }
  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
