// RESEARCH-006.1 — 前状态只读审计探针（真实 TiDB）。
// 只做 SELECT / information_schema，不写任何数据。
import mysql from "mysql2/promise";
import { readFileSync, writeFileSync } from "node:fs";

const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const u = new URL(url);

const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});

const out = [];
const P = (s) => { out.push(s); console.log(s); };

async function tables() {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
  );
  return rows.map((r) => r.TABLE_NAME);
}

async function columns(t) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY " +
      "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [t],
  );
  return rows;
}

async function indexes(t) {
  const [rows] = await conn.query(
    "SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols " +
      "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? " +
      "GROUP BY INDEX_NAME, NON_UNIQUE ORDER BY INDEX_NAME",
    [t],
  );
  return rows;
}

async function fks(t) {
  const [rows] = await conn.query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
    [t],
  );
  return rows.map((r) => r.CONSTRAINT_NAME);
}

async function count(t) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
  return Number(rows[0].n);
}

const all = await tables();
P(`# RESEARCH-006.1 前状态审计（真实 TiDB）`);
P("");
P(`## 1. 全库表总数\n\n${all.length}\n`);

const researchTables = all.filter((t) => t.startsWith("research_"));
const candidateTables = all.filter((t) => t.startsWith("research_strategy") || t.includes("candidate"));
P(`## 2. research_* 表（${researchTables.length} 张）`);
P("");
P("| 表 | 行数 | 列数 |");
P("| --- | ---: | ---: |");
for (const t of researchTables) {
  P(`| ${t} | ${await count(t)} | ${(await columns(t)).length} |`);
}
P("");

P(`## 3. research_strategy_candidate 真实列`);
P("");
P("| 列 | 类型 | NULL | KEY |");
P("| --- | --- | --- | --- |");
for (const c of await columns("research_strategy_candidate")) {
  P(`| ${c.COLUMN_NAME} | ${c.COLUMN_TYPE} | ${c.IS_NULLABLE} | ${c.COLUMN_KEY} |`);
}
P("");
const ci = await indexes("research_strategy_candidate");
P(`索引（${ci.length}）：` + ci.map((i) => `${i.INDEX_NAME}(${i.cols})${i.NON_UNIQUE ? "" : " UNIQUE"}`).join(", "));
P("FK：" + JSON.stringify(await fks("research_strategy_candidate")));
P("");

P(`## 4. strategy_research_provenance 是否存在`);
P("");
const hasProv = all.includes("strategy_research_provenance");
P(`存在 = **${hasProv}**`);
P("");

P(`## 5. strategy_* / dataset_* 行数`);
P("");
const others = all.filter((t) => t.startsWith("strategy_") || t.startsWith("dataset_") || t.startsWith("ds_"));
P("| 表 | 行数 |");
P("| --- | ---: |");
for (const t of others) P(`| ${t} | ${await count(t)} |`);
P("");

P(`## 6. 全库 FK 计数`);
P("");
let fkTotal = 0;
for (const t of all) fkTotal += (await fks(t)).length;
P(`全库 FK 总数 = **${fkTotal}**`);

writeFileSync(new URL("./_r0061_probe_result.md", import.meta.url), out.join("\n") + "\n");

await conn.end();
