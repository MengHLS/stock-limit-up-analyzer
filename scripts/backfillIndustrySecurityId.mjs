// P1-T3 — Industry `securityId` 关联回填（真实数据写操作，幂等）。
// 把 industry_assignments.securityId 从 NULL 回填为永久身份 sec_<uuid>，
// 通过 securityCode(带后缀 "600000.SH") → research_security_identifier_history(6 位代码 + exchange)
// 的 join 桥接（identifierType='primary'）。
//
// 实查事实（2026-09-09）：identifier_history 仅 primary 类型 5552 行一一对应；
// join 全命中 5212/5212，且无任何 code 映射到多个 securityId（无历史代码复用歧义）。
// 故本回填是确定性映射，零歧义。
//
// 幂等：WHERE securityId IS NULL，重跑 null_cnt=0 → affectedRows=0，不产生重复。
// 用法：node scripts/backfillIndustrySecurityId.mjs [--dry-run]
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 20000,
});
async function q(sql) { const [r] = await conn.query(sql); return r; }
const n = (v) => Number(v);

const stat = async (label) => {
  const r = (await q("SELECT COUNT(*) total, SUM(securityId IS NULL) null_cnt, SUM(securityId IS NOT NULL) notnull_cnt FROM industry_assignments"))[0];
  const s = { total: n(r.total), null: n(r.null_cnt), notnull: n(r.notnull_cnt) };
  console.log(`${label}: ${JSON.stringify(s)}`);
  return s;
};

const before = await stat("回填前");

if (before.null === 0) {
  console.log("已无 NULL securityId，跳过回填（幂等）。");
  await conn.end();
  process.exit(0);
}

// 回填前校验：确认映射无歧义（一个 code 不应映射到多个 securityId）
const ambiguous = (await q(`
  SELECT COUNT(*) c FROM (
    SELECT SUBSTRING_INDEX(ia.securityCode,'.',1) code, UPPER(SUBSTRING_INDEX(ia.securityCode,'.',-1)) ex, COUNT(DISTINCT ih.securityId) cnt
    FROM industry_assignments ia
    JOIN research_security_identifier_history ih
      ON SUBSTRING_INDEX(ia.securityCode,'.',1) = ih.securityCode
     AND UPPER(SUBSTRING_INDEX(ia.securityCode,'.',-1)) = ih.exchange
     AND ih.identifierType = 'primary'
    WHERE ia.securityId IS NULL
    GROUP BY code, ex HAVING cnt > 1
  ) x
`))[0];
const ambiguousCount = n(ambiguous.c);
if (ambiguousCount > 0) {
  console.error(`[阻断] 发现 ${ambiguousCount} 个 code 映射到多个 securityId，回填存在歧义，中止。`);
  await conn.end();
  process.exit(1);
}
console.log(`歧义校验通过：0 个 code 多映射。`);

const updateSql = `
  UPDATE industry_assignments ia
  JOIN research_security_identifier_history ih
    ON SUBSTRING_INDEX(ia.securityCode,'.',1) = ih.securityCode
   AND UPPER(SUBSTRING_INDEX(ia.securityCode,'.',-1)) = ih.exchange
   AND ih.identifierType = 'primary'
  SET ia.securityId = ih.securityId
  WHERE ia.securityId IS NULL
`;

if (dryRun) {
  console.log("[dry-run] 将执行：\n" + updateSql);
  await conn.end();
  process.exit(0);
}

const [res] = await conn.query(updateSql);
console.log(`UPDATE affectedRows = ${res.affectedRows}`);

const after = await stat("回填后");

// 一致性校验：industry.securityId 都能在 securities 找到（无孤儿引用）
const orphan = (await q(`
  SELECT COUNT(*) c FROM industry_assignments ia
  LEFT JOIN research_securities s ON ia.securityId = s.securityId
  WHERE ia.securityId IS NOT NULL AND s.securityId IS NULL
`))[0];
console.log(`孤儿 securityId（industry 有但 securities 无）= ${n(orphan.c)}`);

const ok = after.null === 0 && n(orphan.c) === 0;
console.log(`\n结果：${ok ? "PASS — securityId 已全部关联，无孤儿引用" : "FAIL — 仍有 NULL 或孤儿引用"}`);
await conn.end();
process.exit(ok ? 0 : 1);
