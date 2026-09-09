/**
 * G1 补全 — TRADING 状态维度回填（P2-T1 前置阻塞修复）。
 *
 * 背景（AUDIT/实查结论）：research_security_status_history 仅回填了 SUSPENSION(9532) + ST(841)，
 * 缺少 TRADING 维度记录。而 resolveHistoricalUniverse 把 TRADING 视为「正向确认维度」
 * （UNKNOWN/缺失 → 拒绝，见 server/security/historicalUniverse.ts evaluateHistoricalEligibility），
 * 导致 buildResearchDataset 的 universe 决议全空（members=0、rows=0）。
 *
 * 修复：从 research_securities 的权威生命周期（listedDate ~ delistedDate）派生 TRADING 区间
 *   （statusValue="TRADING"），符合原设计（TRADING 正向确认），不修改 universe 决议语义。
 *   SUSPENSION/ST 维度已独立存在，停牌/退市由各自 gate 显式阻断，无需在本回填中扣除。
 *
 * 幂等：按 (securityId, statusType='TRADING') 去重，已存在则跳过；重复执行 affectedRows=0。
 * 用法：
 *   node scripts/backfillTradingStatus.mjs            # dry-run：只报告缺失数量
 *   node scripts/backfillTradingStatus.mjs --apply    # 实际写入
 */

import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const u = new URL(url);
const apply = process.argv.includes("--apply");

const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 20000,
});

const [securities] = await conn.query(
  "SELECT securityId, listedDate, delistedDate FROM research_securities WHERE listedDate IS NOT NULL",
);
const [existing] = await conn.query(
  "SELECT DISTINCT securityId FROM research_security_status_history WHERE statusType = 'TRADING'",
);
const existingIds = new Set(existing.map((r) => r.securityId));

// mysql2 将 TiDB date 列读为本地时区 Date 对象；用本地时间方法格式化，避免 UTC 偏移。
const fmtDate = (d) => {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const missing = securities
  .filter((s) => !existingIds.has(s.securityId))
  .map((s) => ({ securityId: s.securityId, listedDate: fmtDate(s.listedDate), delistedDate: fmtDate(s.delistedDate) }));

console.log("securities 总数（listedDate 非空）:", securities.length);
console.log("已有 TRADING 记录的 securityId:", existingIds.size);
console.log("缺失 TRADING 记录:", missing.length);
console.log("模式:", apply ? "APPLY（实际写入）" : "DRY-RUN（只报告）");

if (!apply) {
  console.log("提示：加 --apply 实际写入。");
  await conn.end();
  process.exit(0);
}

if (missing.length === 0) {
  console.log("无缺失，跳过。");
  await conn.end();
  process.exit(0);
}

// 批量插入（每批 500）
const BATCH = 500;
let inserted = 0;
for (let i = 0; i < missing.length; i += BATCH) {
  const batch = missing.slice(i, i + BATCH);
  const values = batch.map((s) => {
    const from = s.listedDate;
    const to = s.delistedDate ? `'${s.delistedDate}'` : "NULL";
    return `('${s.securityId}', 'TRADING', 'TRADING', '${from}', ${to}, 'derived-from-securities', NOW(), 'high', 'IMMEDIATE')`;
  });
  await conn.query(
    `INSERT INTO research_security_status_history
       (securityId, statusType, statusValue, effectiveFrom, effectiveTo, source, retrievedAt, confidence, availability)
     VALUES ${values.join(",")}`,
  );
  inserted += batch.length;
}

console.log("已插入 TRADING 记录:", inserted);
await conn.end();
process.exit(0);
