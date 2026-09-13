import "dotenv/config";
import { createConnection } from "mysql2/promise";
const conn = await createConnection(process.env.DATABASE_URL as string);
const [v] = await conn.query("SELECT id, strategyId, version FROM strategy_versions WHERE strategyId = 'cand-360003'");
console.log("strategy_versions for cand-360003:", JSON.stringify(v));
const [p] = await conn.query("SELECT id, strategyId, sourceCandidateId FROM strategy_research_provenance WHERE sourceCandidateId = 360003");
console.log("provenance for 360003:", JSON.stringify(p));
await conn.end();
process.exit(0);
