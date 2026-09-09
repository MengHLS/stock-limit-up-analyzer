import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

/** WORK B（BaoStock 全量）验证：两张表行数 / 退市股 / securityId 一致性 / code reuse。 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库");

  const q = async (raw: string) => (await db.execute(sql.raw(raw)))[0] as Array<Record<string, unknown>>;

  const total = await q("SELECT COUNT(*) c FROM research_securities");
  const idh = await q("SELECT COUNT(*) c FROM research_security_identifier_history");
  const distinct = await q("SELECT COUNT(DISTINCT securityId) c FROM research_securities");
  const byStatus = await q("SELECT status, COUNT(*) c FROM research_securities GROUP BY status");
  const byExchange = await q("SELECT exchange, COUNT(*) c FROM research_securities GROUP BY exchange");
  const delisted = await q("SELECT COUNT(*) c FROM research_securities WHERE status = 'delisted'");
  const reuse = await q(
    "SELECT exchange, securityCode, COUNT(DISTINCT securityId) n FROM research_security_identifier_history GROUP BY exchange, securityCode HAVING n > 1",
  );
  const anchor = await q(
    "SELECT s.securityId, s.status, s.listedDate, s.delistedDate FROM research_securities s JOIN research_security_identifier_history i ON i.securityId = s.securityId WHERE i.exchange = 'SZ' AND i.securityCode = '000001'",
  );
  const delSamples = await q(
    "SELECT s.exchange, i.securityCode, i.effectiveFrom, s.delistedDate FROM research_securities s JOIN research_security_identifier_history i ON i.securityId = s.securityId WHERE s.status = 'delisted' ORDER BY s.delistedDate DESC LIMIT 8",
  );

  const num = (v: unknown) => Number(v ?? 0);

  console.log("=== BaoStock 全量回填 SQL 验证 ===");
  console.log(`research_securities 行数            = ${num(total[0]?.c)}`);
  console.log(`research_security_identifier_history = ${num(idh[0]?.c)}`);
  console.log(`distinct securityId                  = ${num(distinct[0]?.c)}`);
  console.log(`status 分布:`);
  for (const row of byStatus) console.log(`    ${String(row.status)} = ${num(row.c)}`);
  console.log(`exchange 分布:`);
  for (const row of byExchange) console.log(`    ${String(row.exchange)} = ${num(row.c)}`);
  console.log(`退市股数（status=delisted）          = ${num(delisted[0]?.c)}`);
  console.log(`code reuse（同 code 多 securityId）组数 = ${reuse.length}`);
  console.log(`锚点 000001.SZ:`);
  for (const row of anchor) console.log(`    ${JSON.stringify(row)}`);
  console.log(`退市股抽查（按退市日倒序）:`);
  for (const row of delSamples) {
    console.log(`    ${String(row.exchange)} ${String(row.securityCode)} listed=${String(row.effectiveFrom)} delisted=${String(row.delistedDate)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("验证失败：", e);
    process.exit(1);
  });
