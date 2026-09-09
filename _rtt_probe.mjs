import { readFileSync } from "node:fs";
import { createConnection } from "mysql2/promise";
const env = readFileSync("./.env", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const conn = await createConnection(url);
// 10 次串行简单 COUNT 测公网往返 RTT
const times = [];
for (let i = 0; i < 10; i++) {
  const t0 = Date.now();
  await conn.query("SELECT COUNT(*) FROM liquidity_daily");
  times.push(Date.now() - t0);
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log("10 次串行 COUNT 往返耗时(ms):", times.join(","));
console.log("中位数:", times[5], " 平均:", avg.toFixed(0));
await conn.end();
