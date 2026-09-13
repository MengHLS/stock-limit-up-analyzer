import "dotenv/config";
import { getDb } from "../../server/db";
import { researchRuns } from "../../drizzle/schema";
import { sql } from "drizzle-orm";
const db = await getDb();
if (!db) { console.log("DB 不可用"); process.exit(0); }
const rows = await db.select({ status: researchRuns.status, c: sql<number>`count(*)` }).from(researchRuns).groupBy(researchRuns.status);
console.log(JSON.stringify(rows));
process.exit(0);
