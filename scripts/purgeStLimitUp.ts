/**
 * 一次性数据清理：删除 limit_up_records 中「涨停当日处于 ST 状态」的主板记录。
 *
 * 判定口径（与审计一致）：
 *   - 仅主板（60/000/001/002/003；创业板/科创板 ST 涨跌幅 20% 非本清理目标）
 *   - 当日 PIT 处于 research_security_status_history ST 区间（经 identifier history 关联）
 *
 * 流程（安全）：
 *   1) 先导出待删记录全字段备份到 scripts/backup/limit_up_st_records_<ts>.json
 *   2) 生成同内容的可回滚 SQL（INSERT 语句）到 scripts/backup/limit_up_st_records_<ts>.sql
 *   3) dry-run（默认）只统计；--apply 才真正删除
 *   4) 删除后输出残留校验（应恒为 0）
 *
 * 用法：
 *   npx tsx scripts/purgeStLimitUp.ts              # dry-run 统计
 *   npx tsx scripts/purgeStLimitUp.ts --apply      # 正式删除（先自动备份）
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const db = await getDb();
if (!db) { console.error("no db"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = join(process.cwd(), "scripts", "backup");

const SELECT_TARGETS = sql.raw(`
  SELECT r.id, r.stockCode, r.stockName, r.limitUpDate, r.limitUpTime,
         r.boardCount, r.circulationValue, r.turnover, r.sector, r.keywords,
         r.createdBy, r.createdAt, r.updatedAt
  FROM limit_up_records r
  JOIN research_security_identifier_history i
    ON i.securityCode = SUBSTRING_INDEX(r.stockCode, '.', 1)
   AND i.exchange = SUBSTRING_INDEX(r.stockCode, '.', -1)
   AND i.identifierType = 'primary'
  WHERE r.stockCode REGEXP '^(60|000|001|002|003)'
    AND EXISTS (
      SELECT 1 FROM research_security_status_history h
      WHERE h.securityId = i.securityId AND h.statusType = 'ST'
        AND h.effectiveFrom <= r.limitUpDate
        AND (h.effectiveTo IS NULL OR h.effectiveTo >= r.limitUpDate)
    )
`);

// 1) 读取目标
const res = await db.execute(SELECT_TARGETS);
const rows: any[] = ((res as any)?.[0] ?? res) ?? [];
console.log(`[1/5] 待删记录数（dry-run=${!APPLY}）: ${rows.length}`);

const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(BACKUP_DIR, { recursive: true });

// 2) JSON 全字段备份
const jsonPath = join(BACKUP_DIR, `limit_up_st_records_${ts}.json`);
writeFileSync(jsonPath, JSON.stringify(rows, null, 2), "utf8");
console.log(`[2/5] JSON 备份: ${jsonPath}`);

// 3) 可回滚 SQL 备份
const esc = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  const s = String(v).replace(/\\/g, "\\\\").replace(/'/g, "''");
  return `'${s}'`;
};
const sqlLines = rows.map((r) =>
  `INSERT INTO limit_up_records (id, stockCode, stockName, limitUpDate, limitUpTime, boardCount, circulationValue, turnover, sector, keywords, createdBy, createdAt, updatedAt) VALUES (${r.id}, ${esc(r.stockCode)}, ${esc(r.stockName)}, ${esc(r.limitUpDate)}, ${esc(r.limitUpTime)}, ${esc(r.boardCount)}, ${esc(r.circulationValue)}, ${esc(r.turnover)}, ${esc(r.sector)}, ${esc(r.keywords)}, ${r.createdBy ?? "NULL"}, ${esc(r.createdAt)}, ${esc(r.updatedAt)});`
);
const sqlPath = join(BACKUP_DIR, `limit_up_st_records_${ts}.sql`);
writeFileSync(sqlPath, sqlLines.join("\n"), "utf8");
console.log(`[3/5] SQL 回滚备份: ${sqlPath}（${sqlLines.length} 条 INSERT）`);

if (!APPLY) {
  console.log("[4/5] DRY-RUN：未执行删除。加 --apply 正式删除。");
  process.exit(0);
}

// 4) 执行删除（分 id 区间，避免超大批量单语句）
const ids = rows.map((r) => r.id);
const CHUNK = 2000;
let deleted = 0;
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = ids.slice(i, i + CHUNK);
  const del = await db.execute(sql.raw(
    `DELETE FROM limit_up_records WHERE id IN (${chunk.join(",")})`,
  ));
  deleted += Number((del as any)?.[0]?.affectedRows ?? 0);
  console.log(`    删除 chunk ${i / CHUNK + 1}: 累计 ${deleted}`);
}
console.log(`[4/5] 已删除: ${deleted}`);

// 5) 残留校验
const left = await db.execute(sql.raw(`
  SELECT COUNT(*) AS c
  FROM limit_up_records r
  JOIN research_security_identifier_history i
    ON i.securityCode = SUBSTRING_INDEX(r.stockCode, '.', 1)
   AND i.exchange = SUBSTRING_INDEX(r.stockCode, '.', -1)
   AND i.identifierType = 'primary'
  WHERE r.stockCode REGEXP '^(60|000|001|002|003)'
    AND EXISTS (
      SELECT 1 FROM research_security_status_history h
      WHERE h.securityId = i.securityId AND h.statusType = 'ST'
        AND h.effectiveFrom <= r.limitUpDate
        AND (h.effectiveTo IS NULL OR h.effectiveTo >= r.limitUpDate)
    )
`));
const remain = Number((left as any)?.[0]?.[0]?.c ?? 0);
console.log(`[5/5] 残留校验（应为 0）: ${remain}`);

process.exit(0);
