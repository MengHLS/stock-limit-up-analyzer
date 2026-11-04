/**
 * 探针：候选草图**全文**（只读，真库）。
 *
 * 与 `_diag_cand_sketch.mts` 的分工：后者只截前 700 字符；本探针逐列打印**完整 JSON**，
 * 用于两件事：
 *   ① 给「真实 E2E 验收」提供一份**已被证明可成功转正**的草图形状（避免自己编口径）；
 *   ② 审计时核对 `parameterSpace` 的键集合（type / min / max / step / defaultValue / allowedValues）。
 *
 * 用法：`npx tsx docs/evidence/_probe_candidate_sketch_full.mts [candidateId]`（缺省 = 最新一条）。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const arg = process.argv[2];
const conn = await createConnection(process.env.DATABASE_URL as string);

const cols = ["entryRuleJson", "filterRuleJson", "exitRuleJson", "riskRuleJson", "parameterSpaceJson"] as const;
const where = arg ? "id = ?" : "1 = 1";
const params = arg ? [Number(arg)] : [];
const [rows] = await conn.query(
  `SELECT id, name, status, ${cols.join(", ")} FROM research_strategy_candidate `
  + `WHERE ${where} ORDER BY id DESC LIMIT 1`,
  params,
);
const row = (rows as Array<Record<string, string | null>>)[0];
if (!row) {
  console.log("没有匹配的候选行");
} else {
  console.log(`candidate ${row.id} (${row.status}) : ${row.name}`);
  for (const col of cols) {
    console.log(`\n===== ${col} =====`);
    console.log(row[col] ?? "NULL");
  }
}

await conn.end();
process.exit(0);
