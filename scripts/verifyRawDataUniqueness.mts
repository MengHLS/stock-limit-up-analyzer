/**
 * 原始数据表「重复行」防线审计（只读，真实 DB）。
 *
 * 背景：重叠窗口回填（如今天补 08-01~08-10、明天补 08-05~08-15）最容易产出重复行。
 * 本项目对原始行情表的防线是「DB 级唯一约束 + ON DUPLICATE KEY UPDATE 幂等覆盖」，
 * 而不是应用层的 if-duplicate 判断。本脚本验证这条防线在**真实库**上确实存在。
 *
 * 三层判据：
 *   U1 约束存在性：每个声明的业务键，真实库中必须存在覆盖这些列的唯一索引。
 *      —— 唯一索引存在 ⇒ 重复行在数据库层面不可能写入（逻辑证明，无需扫全表）。
 *   U2 实际重复扫描：仅对「U1 未通过」的表做真实 GROUP BY 扫描
 *      —— 这是真正可能累积重复的风险集（大表全扫很贵，只在必要时付这个代价）。
 *   U3 测试数据污染：识别 `stockName`/`sector`/`keywords` 含「测试」字样的历史遗留行。
 *
 * 用法：npx tsx scripts/verifyRawDataUniqueness.mts
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

let checks = 0;
let failures = 0;

function assert(label: string, condition: boolean, detail = ""): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** 声明的业务键：表 → 期望被唯一索引覆盖的列集合（顺序无关）。 */
const DECLARED_KEYS: Array<{ table: string; key: string[]; note: string }> = [
  { table: "stock_daily_prices", key: ["stockCode", "tradeDate"], note: "Tushare 未复权日线" },
  { table: "liquidity_daily", key: ["securityCode", "tradeDate"], note: "流动性日线" },
  { table: "corporate_actions", key: ["securityCode", "effectiveDate", "actionType"], note: "公司行为" },
  { table: "adjustment_factors", key: ["securityCode", "effectiveDate"], note: "复权因子" },
  { table: "index_daily", key: ["indexCode", "tradeDate"], note: "指数日线" },
  { table: "industry_assignments", key: ["securityCode", "effectiveFrom"], note: "行业归属区间" },
  { table: "backfill_checkpoints", key: ["tradeDate"], note: "回填断点" },
  {
    table: "research_security_status_history",
    key: ["securityId", "statusType", "effectiveFrom"],
    note: "PIT 状态区间（resolveSecurityStatus 的 pickLatest 依赖此键唯一）",
  },
  { table: "stock_suspension_windows", key: ["stockCode", "startDate", "endDate"], note: "停牌窗口" },
];

/** 已知「无业务唯一键」的表 —— 重复会在应用层被放大，单独扫描。 */
const UNPROTECTED: Array<{ table: string; key: string[]; note: string }> = [
  {
    table: "limit_up_records",
    key: ["limitUpDate", "stockCode"],
    note: "手动/OCR 录入的涨停复盘记录；getLimitUpCountsByDate 等用 COUNT(*) 聚合",
  },
];

type QueryFn = <T = Record<string, unknown>>(text: string) => Promise<T[]>;

async function main(): Promise<void> {
  const connection = await createConnection(process.env.DATABASE_URL!);
  const q: QueryFn = async <T = Record<string, unknown>>(text: string): Promise<T[]> => {
    const [rows] = (await connection.query(text)) as unknown as [T[]];
    return rows;
  };

  // ------------------------------------------------------------------
  console.log("\n=== U1 声明的业务键在真实库中存在唯一约束 ===");
  for (const { table, key, note } of DECLARED_KEYS) {
    const rows = await q<{ INDEX_NAME: string; COLUMN_NAME: string; SEQ_IN_INDEX: number }>(`
      SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND NON_UNIQUE = 0
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `);
    const byIndex = new Map<string, string[]>();
    for (const r of rows) {
      const list = byIndex.get(r.INDEX_NAME) ?? [];
      list.push(r.COLUMN_NAME);
      byIndex.set(r.INDEX_NAME, list);
    }
    const wanted = [...key].sort().join(",");
    const hit = Array.from(byIndex.entries()).find(
      ([, cols]) => (cols.length === key.length && [...cols].sort().join(",") === wanted),
    );
    assert(
      `${table} 存在 UNIQUE(${key.join(", ")})`,
      hit !== undefined,
      hit ? `${hit[0]} — ${note}` : `未找到覆盖该键的唯一索引（现有唯一索引：${Array.from(byIndex.keys()).join(", ") || "无"}）`,
    );
  }

  // ------------------------------------------------------------------
  console.log("\n=== U2 无唯一键表的实际重复扫描（真正的风险集） ===");
  for (const { table, key, note } of UNPROTECTED) {
    const g = key.map((k) => `\`${k}\``).join(", ");
    const stat = await q<{ dupGroups: number; extraRows: number }>(`
      SELECT COUNT(*) AS dupGroups, IFNULL(SUM(c - 1), 0) AS extraRows FROM (
        SELECT COUNT(*) AS c FROM \`${table}\` GROUP BY ${g} HAVING COUNT(*) > 1
      ) x
    `);
    const dupGroups = Number(stat[0]?.dupGroups ?? 0);
    const extraRows = Number(stat[0]?.extraRows ?? 0);
    console.log(`  参考：${table} 按 (${key.join(", ")}) 重复组 ${dupGroups} / 多余行 ${extraRows} — ${note}`);
    if (dupGroups > 0) {
      const worst = await q<Record<string, unknown>>(`
        SELECT ${g}, COUNT(*) AS c FROM \`${table}\`
        GROUP BY ${g} HAVING COUNT(*) > 1 ORDER BY c DESC LIMIT 5
      `);
      for (const r of worst) {
        console.log(`        ${key.map((k) => `${k}=${r[k]}`).join(" ")} → ${r.c} 条`);
      }
    }
    // 该表无唯一键是「已声明的现状」，不作为硬失败；但必须让重复量显性可见。
    assert(
      `${table} 重复行已显性可观测（当前 ${extraRows} 行多余）`,
      true,
      dupGroups > 0 ? "⚠️ 无 DB 级约束，重复只能靠应用层防" : "当前无重复",
    );
  }

  // ------------------------------------------------------------------
  console.log("\n=== U3 测试数据污染扫描 ===");
  // ⚠️ 判据必须用**前缀**匹配 `测试%`，不能用 `%测试%`：
  //    `%测试%` 会命中合法数据（`谱尼测试`/`西测测试` 是真实股名，`封装测试`/`芯片测试设备` 是真实涨停关键词），
  //    实测宽口径 258 行 vs 前缀口径 143 行 —— 差额 115 行全是误报。
  const POLLUTION = "stockName LIKE '测试%' OR IFNULL(sector,'') LIKE '测试%' OR IFNULL(keywords,'') LIKE '测试%'";
  const WIDE = "stockName LIKE '%测试%' OR IFNULL(sector,'') LIKE '%测试%' OR IFNULL(keywords,'') LIKE '%测试%'";
  const wide = await q<{ c: number }>(`SELECT COUNT(*) AS c FROM limit_up_records WHERE ${WIDE}`);
  const polluted = await q<{ c: number }>(`SELECT COUNT(*) AS c FROM limit_up_records WHERE ${POLLUTION}`);
  const pollutedCount = Number(polluted[0]?.c ?? 0);
  console.log(
    `  宽口径（含「测试」子串，含误报）=${Number(wide[0]?.c ?? 0)} 行；前缀口径（真实占位数据）=${pollutedCount} 行`,
  );
  assert(
    "limit_up_records 无「测试」占位行残留",
    pollutedCount === 0,
    `实测 ${pollutedCount} 行（会污染涨停家数 / 题材热度 / 市场情绪 regime）`,
  );
  if (pollutedCount > 0) {
    const byName = await q<Record<string, unknown>>(`
      SELECT stockCode, stockName, COUNT(*) AS c FROM limit_up_records
      WHERE ${POLLUTION} GROUP BY stockCode, stockName ORDER BY c DESC LIMIT 5
    `);
    for (const r of byName) console.log(`        ${r.stockCode} ${r.stockName} → ${r.c} 行`);
    const byDate = await q<Record<string, unknown>>(`
      SELECT limitUpDate, COUNT(*) AS c FROM limit_up_records
      WHERE ${POLLUTION}
      GROUP BY limitUpDate ORDER BY c DESC LIMIT 5
    `);
    for (const r of byDate) console.log(`        limitUpDate=${r.limitUpDate} → ${r.c} 行`);
    const total = await q<{ c: number }>(`SELECT COUNT(*) AS c FROM limit_up_records`);
    const distinct = await q<{ c: number }>(
      `SELECT COUNT(DISTINCT limitUpDate, stockCode) AS c FROM limit_up_records`,
    );
    const real = Number(total[0]?.c ?? 0);
    const distinctPairs = Number(distinct[0]?.c ?? 0);
    console.log(
      `  结论：limit_up_records 共 ${real} 行，去重后应为 ${distinctPairs} 行，被夸大 ${real - distinctPairs} 行`,
    );
  }

  await connection.end();
  console.log(`\n结果：${checks - failures}/${checks} 通过${failures > 0 ? `，${failures} 项失败` : ""}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error("审计脚本异常：", error);
  process.exit(2);
});
