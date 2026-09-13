import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const m = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL);
const c = await mysql.createConnection({
  host: m[3], port: Number(m[4]), user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]), database: m[5], ssl: { rejectUnauthorized: false },
});
const [r] = await c.query(`SELECT datasetVersionId, COUNT(*) n FROM ds_first_limit_pullback_event GROUP BY datasetVersionId ORDER BY n DESC`);
console.log("event per version:", JSON.stringify(r));
const [p] = await c.query(`SELECT datasetVersionId, COUNT(*) n FROM ds_first_limit_pullback_post GROUP BY datasetVersionId ORDER BY n DESC`);
console.log("post per version:", JSON.stringify(p));
const [pv] = await c.query(`SELECT datasetVersionId, COUNT(*) n FROM ds_first_limit_pullback_prefix GROUP BY datasetVersionId ORDER BY n DESC`);
console.log("prefix per version:", JSON.stringify(pv));
const [rd] = await c.query(`SELECT relativeDay, COUNT(*) n FROM ds_first_limit_pullback_post GROUP BY relativeDay ORDER BY relativeDay`);
console.log("post rd coverage:", JSON.stringify(rd));
await c.end();
