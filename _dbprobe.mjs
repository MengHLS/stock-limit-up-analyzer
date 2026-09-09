import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const t0 = Date.now();
  const conn = await createConnection(process.env.DATABASE_URL);
  const t1 = Date.now();
  console.log(`connect: ${t1 - t0}ms`);
  const [rows] = await conn.query("SELECT COUNT(*) AS c FROM limit_up_records");
  console.log(`limit_up_records COUNT: ${rows[0].c} (${Date.now() - t1}ms)`);
  const [p] = await conn.query("SELECT COUNT(*) AS c FROM stock_daily_prices");
  console.log(`stock_daily_prices COUNT: ${p[0].c} (${Date.now() - t1}ms)`);
  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
