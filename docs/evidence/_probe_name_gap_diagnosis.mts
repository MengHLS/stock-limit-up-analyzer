/**
 * 诊断探针：为什么 93 个成交代码在名称源（`limit_up_records`）里找不到名称。
 *
 * 目的：区分两种可能，结论必须落在证据上：
 *   ① 这些股票**确实没有被收录**进涨停记录（复盘录入口径不全）⇒ 数据现实，如实报告；
 *   ② 收录了但**键匹配不上**（格式/交易所差异）⇒ 是我的实现 bug，必须修。
 *
 * 判据：拿这些代码去 `limit_up_records` 精确查一次；再拿它们去
 * `ds_first_limit_pullback_event.symbol`（首板回踩数据集，理论上是「首板涨停股」池）
 * 对照 —— 若数据集有、涨停记录没有，说明两套数据源口径不一致。
 *
 * 只读：不写库、不删库。
 *
 * 用法：npx tsx docs/evidence/_probe_name_gap_diagnosis.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { loadSecurityLabels } from "../../server/closedLoopBacktestRun/securityLabels";

const db = await getDb();
if (!db) {
  console.log("数据库不可用");
  process.exit(1);
}

type Row = Record<string, unknown>;
function unwrap(rows: unknown): Row[] {
  if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0])) return rows[0] as Row[];
  return (rows ?? []) as Row[];
}

type TradeShape = Record<string, unknown>;
function collectTrades(node: unknown, sink: TradeShape[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTrades(item, sink);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.securityId === "string" && typeof obj.entryTime === "string") {
      sink.push(obj);
      return;
    }
    for (const value of Object.values(obj)) collectTrades(value, sink);
  }
}

// 1) 取留档成交的 securityId
const runs = unwrap(await db.execute(sql`SELECT id FROM closed_loop_backtest_run ORDER BY id`));
const ids = new Set<string>();
for (const run of runs) {
  const rows = unwrap(
    await db.execute(sql`SELECT resultJson FROM closed_loop_backtest_run WHERE id = ${Number(run.id)} LIMIT 1`),
  );
  const raw = rows[0]?.resultJson;
  if (typeof raw !== "string") continue;
  const sink: TradeShape[] = [];
  try {
    collectTrades(JSON.parse(raw), sink);
  } catch {
    continue;
  }
  for (const t of sink) ids.add(String(t.securityId));
}

const labels = await loadSecurityLabels([...ids]);
const missing = labels.filter(l => l.code !== null && l.name === null).map(l => l.code!);
console.log(`\n缺名称的代码 = ${missing.length} / 有代码 ${labels.filter(l => l.code).length}`);

// 2) 精确查 limit_up_records
const inLimitUp = new Set<string>();
for (let i = 0; i < missing.length; i += 200) {
  const chunk = missing.slice(i, i + 200);
  const rows = unwrap(
    await db.execute(
      sql`SELECT DISTINCT stockCode FROM limit_up_records WHERE stockCode IN (${sql.join(
        chunk.map(c => sql`${c}`),
        sql`, `,
      )})`,
    ),
  );
  for (const r of rows) inLimitUp.add(String(r.stockCode));
}
console.log(`其中 limit_up_records 里**确实存在**的 = ${inLimitUp.size}  ⇒ ${inLimitUp.size === 0 ? "无键匹配问题（是收录口径问题）" : "存在键匹配问题（需修实现）"}`);
if (inLimitUp.size > 0) console.log(`   例：${[...inLimitUp].slice(0, 10).join(", ")}`);

// 3) 对照首板回踩数据集的 symbol 池
const inDataset = new Set<string>();
for (let i = 0; i < missing.length; i += 200) {
  const chunk = missing.slice(i, i + 200);
  const rows = unwrap(
    await db.execute(
      sql`SELECT DISTINCT symbol FROM ds_first_limit_pullback_event WHERE symbol IN (${sql.join(
        chunk.map(c => sql`${c}`),
        sql`, `,
      )})`,
    ),
  );
  for (const r of rows) inDataset.add(String(r.symbol));
}
console.log(`其中出现在首板回踩数据集事件的 = ${inDataset.size}`);

// 4) 前缀分布：看是哪一类板缺名称
function boardOf(code: string): string {
  const d = code.slice(0, 3);
  if (d.startsWith("688")) return "科创板 688";
  if (d.startsWith("300") || d.startsWith("301")) return "创业板 300/301";
  if (d.startsWith("60")) return "沪主板 60x";
  if (d.startsWith("00")) return "深主板 00x";
  if (d.startsWith("8") || d.startsWith("4") || d.startsWith("92")) return "北交所";
  return `其他 ${d}`;
}
const missingByBoard = new Map<string, number>();
for (const c of missing) missingByBoard.set(boardOf(c), (missingByBoard.get(boardOf(c)) ?? 0) + 1);
const allCodes = labels.filter(l => l.code).map(l => l.code!);
const allByBoard = new Map<string, number>();
for (const c of allCodes) allByBoard.set(boardOf(c), (allByBoard.get(boardOf(c)) ?? 0) + 1);

console.log("\n板块分布（缺失 / 总数）：");
for (const board of [...allByBoard.keys()].sort()) {
  const total = allByBoard.get(board) ?? 0;
  const miss = missingByBoard.get(board) ?? 0;
  console.log(`   ${board.padEnd(16)} ${String(miss).padStart(3)} / ${String(total).padStart(3)}`);
}

// 5) limit_up_records 自身覆盖了哪些板块（判断它是不是全市场口径）
const luBoards = unwrap(
  await db.execute(
    sql`SELECT LEFT(stockCode, 3) AS p, COUNT(DISTINCT stockCode) AS c
        FROM limit_up_records GROUP BY LEFT(stockCode, 3) ORDER BY c DESC LIMIT 20`,
  ),
);
console.log("\nlimit_up_records 的代码前缀分布（Top 20）：");
for (const r of luBoards) console.log(`   ${r.p} → ${r.c}`);

console.log("\n[ok] 诊断结束");
process.exit(0);
