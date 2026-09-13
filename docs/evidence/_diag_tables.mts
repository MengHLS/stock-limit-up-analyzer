/** 诊断：列出与本任务相关的真实表名 + 结论结果表结构（只读）。 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);
const [t] = await conn.query("SHOW TABLES");
const names = (t as Array<Record<string, unknown>>)
  .map(x => Object.values(x)[0])
  .filter((n): n is string => typeof n === "string");
console.log("全部表数:", names.length);
console.log("--- 匹配 research|analysis|conclusion|bucket ---");
console.log(names.filter(n => /research|analysis|conclusion|bucket|segment/i.test(n)).join("\n"));
await conn.end();
process.exit(0);
