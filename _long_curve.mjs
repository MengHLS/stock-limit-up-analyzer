import { readFileSync } from "node:fs";
import { createConnection } from "mysql2/promise";
const env = readFileSync("./.env", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const conn = await createConnection(url);
const pts = [];
const snap = async (tag) => {
  const [r] = await conn.query(
    `SELECT (SELECT COUNT(DISTINCT securityCode) FROM liquidity_daily) ec,
            (SELECT COUNT(*) FROM liquidity_daily) er
     FROM dual`
  );
  const row = r[0];
  const ts = Date.now();
  pts.push({ tag, ts, ec: row.ec, er: row.er });
  console.log(tag.padEnd(4), `ec=${row.ec} er=${row.er}`, new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" }));
};
await snap("s0");
// 每 30s 采样一次，共 8 段 ≈ 4 分钟
for (let i = 1; i <= 8; i++) {
  await new Promise((r) => setTimeout(r, 30000));
  await snap(`s${i}`);
}
console.log("--- 分段速率 (股/min) ---");
for (let i = 1; i < pts.length; i++) {
  const dEc = pts[i].ec - pts[i - 1].ec;
  const dEr = pts[i].er - pts[i - 1].er;
  const dtMin = (pts[i].ts - pts[i - 1].ts) / 60000;
  console.log(`${pts[i - 1].tag}->${pts[i].tag}: ${(dEc / dtMin).toFixed(1)} 股/min, ${Math.round(dEr / dtMin)} 行/min`);
}
await conn.end();
