/** 复核：research_strategy_candidate 行数（连查 3 轮，排除单次读取异常） */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL);
for (let i = 1; i <= 3; i++) {
  const [a] = await conn.query("SELECT COUNT(*) AS c FROM research_strategy_candidate");
  const [b] = await conn.query(
    "SELECT status, COUNT(*) AS c FROM research_strategy_candidate GROUP BY status",
  );
  const [d] = await conn.query("SELECT DATABASE() AS db, @@port AS port, @@hostname AS host");
  console.log(`第${i}轮 COUNT=${JSON.stringify(a)} GROUPBY=${JSON.stringify(b)} ctx=${JSON.stringify(d)}`);
}
await conn.end();
process.exit(0);
