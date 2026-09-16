import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.log(JSON.stringify({ dbAvailable: false })); process.exit(1); }

async function rows<T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db!.execute(q)) as unknown as [T[]];
  return r[0] ?? [];
}

// 找所有含 pullback 的分析（跨所有 Run）
const analyses = await rows(
  sql`select a.id, a.runId, a.analysisType, a.name, a.target, a.status, a.configJson
      from research_analysis a
      where a.name like '%回踩%' or a.name like '%pullback%' or a.name like '%回撤%' or a.name like '%破%'
      order by a.id desc limit 80`
);
console.log(JSON.stringify({ pullbackAnalyses: analyses }, null, 2));
