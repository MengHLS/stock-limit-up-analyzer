/** 改 server 前的在途 Run 安全检查（只读）。 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.log("DB 不可用"); process.exit(1); }

const r = await db.execute(sql`select \`id\`, \`status\`, \`startedAt\`, \`datasetId\` from \`research_runs\` order by \`id\` desc limit 8`);
console.log("最近 8 个 research_runs：");
for (const x of (r[0] as any[])) console.log("  ", JSON.stringify(x));

const cnt = await db.execute(sql`select \`status\`, count(*) as n from \`research_runs\` group by \`status\``);
console.log("\n按状态汇总：");
for (const x of (cnt[0] as any[])) console.log("  ", JSON.stringify(x));

const running = await db.execute(sql`select count(*) as n from \`research_runs\` where \`status\` = 'RUNNING'`);
console.log("\n在途 RUNNING 数 =", (running[0] as any[])[0].n);

process.exit(0);
