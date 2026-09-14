/**
 * 只读诊断：留档的成交明细里 `sec_<uuid>` → 代码的翻译是否**正确**。
 *
 * 用户反馈：数据集里没有非主板股票，但成交明细展示出 300 / 688 开头的代码。
 * 本探针要分清两种截然不同的成因：
 *   (A) 翻译张冠李戴（同一 securityId 在 identifier history 有多条 primary 行 / 未按有效期过滤）
 *   (B) 数据集本身真的含 300 / 688（那是数据/策略坐标问题，不是翻译问题）
 *
 * 用法：npx tsx docs/evidence/_probe_trade_code_correctness.mts
 * 不写库、不删库。
 */
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  closedLoopBacktestRun,
  researchSecurityIdentifierHistory,
} from "../../drizzle/schema";
import { normalizeSecurityCode } from "../../server/security/code";

const db = await getDb();
if (!db) {
  console.log("数据库不可用");
  process.exit(1);
}

const codesOf = (cs: string[]) => {
  const acc = new Map<string, number>();
  for (const c of cs) {
    const p = c.slice(0, 3);
    acc.set(p, (acc.get(p) ?? 0) + 1);
  }
  return Array.from(acc.entries()).sort((a, b) => b[1] - a[1]);
};

const rows = await db
  .select({
    id: closedLoopBacktestRun.id,
    runId: closedLoopBacktestRun.runId,
    strategyId: closedLoopBacktestRun.strategyId,
    datasetVersion: closedLoopBacktestRun.datasetVersion,
    datasetVersionId: closedLoopBacktestRun.datasetVersionId,
    datasetSource: closedLoopBacktestRun.datasetSource,
    resultJson: closedLoopBacktestRun.resultJson,
  })
  .from(closedLoopBacktestRun)
  .orderBy(closedLoopBacktestRun.id);

console.log(`留档行数 = ${rows.length}`);

for (const row of rows) {
  console.log("\n" + "=".repeat(78));
  console.log(`id=${row.id} runId=${row.runId} strat=${row.strategyId}`);
  console.log(
    `datasetVersion=${row.datasetVersion} datasetVersionId=${row.datasetVersionId} source=${row.datasetSource}`,
  );
  if (row.resultJson === null) {
    console.log("resultJson = NULL（无完整明细）");
    continue;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(row.resultJson);
  } catch (e) {
    console.log("resultJson 解析失败：", (e as Error).message);
    continue;
  }

  // --- assembly / 数据集坐标 ---
  const asm = parsed.assembly ?? null;
  if (asm === null) {
    console.log("assembly = null");
  } else {
    console.log("assembly keys =", Object.keys(asm).join(", "));
    for (const k of [
      "datasetVersionId",
      "datasetVersion",
      "dataSource",
      "source",
      "rowCount",
      "securityCount",
      "startDate",
      "endDate",
      "universeId",
      "mode",
    ]) {
      if (k in asm) {
        const v = (asm as any)[k];
        console.log(`  assembly.${k} =`, typeof v === "object" ? JSON.stringify(v) : v);
      }
    }
  }

  // --- universe / 选股范围 ---
  for (const key of ["universe", "stockPool", "pool"]) {
    if (parsed[key] !== undefined) {
      console.log(`  top.${key} =`, JSON.stringify(parsed[key]).slice(0, 400));
    }
  }

  const stages: any[] = Array.isArray(parsed.stages) ? parsed.stages : [];
  const bt = stages.find(s => s.stageId === "backtest");
  const trades: any[] = bt?.output?.trades ?? [];
  console.log(`stages=${stages.length} trades=${trades.length}`);
  if (trades.length === 0) continue;

  const ids = Array.from(new Set(trades.map(t => String(t.securityId))));

  // --- 关键：取这些 id 的**全部** primary 行（不过滤、不限第一条） ---
  const idRows = await db
    .select({
      securityId: researchSecurityIdentifierHistory.securityId,
      exchange: researchSecurityIdentifierHistory.exchange,
      code: researchSecurityIdentifierHistory.securityCode,
      identifierType: researchSecurityIdentifierHistory.identifierType,
      effectiveFrom: researchSecurityIdentifierHistory.effectiveFrom,
      effectiveTo: researchSecurityIdentifierHistory.effectiveTo,
    })
    .from(researchSecurityIdentifierHistory)
    .where(inArray(researchSecurityIdentifierHistory.securityId, ids));

  const allRows = idRows.filter(r => r.identifierType === "primary");
  console.log(`trades 涉及 distinct securityId = ${ids.length}`);
  console.log(`其中在 identifier history 有 primary 行的行数 = ${allRows.length}`);

  const perId = new Map<string, typeof allRows>();
  for (const r of allRows) {
    const arr = perId.get(r.securityId) ?? [];
    arr.push(r);
    perId.set(r.securityId, arr);
  }
  const multi = Array.from(perId.entries()).filter(([, v]) => v.length > 1);
  console.log(`同一 securityId 有多条 primary 行的数量 = ${multi.length}`);
  for (const [sid, v] of multi.slice(0, 8)) {
    console.log(
      `  MULTI ${sid} =>`,
      v.map(x => `${x.code}.${x.exchange}[${x.effectiveFrom}~${x.effectiveTo ?? "今"}]`).join(" | "),
    );
  }

  // --- 我的实现口径：取第一条，看前缀分布 ---
  const mine = new Map<string, string>();
  for (const r of allRows) {
    if (mine.has(r.securityId)) continue;
    try {
      mine.set(r.securityId, normalizeSecurityCode(`${r.code}.${r.exchange}`));
    } catch {
      /* skip */
    }
  }
  const mineCodes = Array.from(mine.values());
  console.log("\n[当前实现口径] 代码前缀分布：");
  for (const [p, n] of codesOf(mineCodes)) console.log(`  ${p}xxx : ${n}`);

  // --- 若按「与回测窗口重叠的 effective 行」解析，前缀分布是否不同？ ---
  const startDate = String(parsed?.dateRange?.startDate ?? row.datasetVersion ?? "");
  const endDate = String(parsed?.dateRange?.endDate ?? "");
  console.log(`\n回测窗口 = ${startDate} ~ ${endDate}`);
  const picked = new Map<string, string>();
  for (const r of allRows) {
    if (picked.has(r.securityId)) continue;
    picked.set(r.securityId, `${r.code}.${r.exchange}`);
  }
  const pickedCodes = Array.from(picked.values()).map(c => {
    try {
      return normalizeSecurityCode(c);
    } catch {
      return "INVALID";
    }
  });
  console.log("[按 effectiveFrom 最早] 前缀分布：");
  for (const [p, n] of codesOf(pickedCodes)) console.log(`  ${p}xxx : ${n}`);

  // --- 抽样前 12 笔 ---
  console.log("\n前 12 笔：");
  for (const t of trades.slice(0, 12)) {
    const r = perId.get(String(t.securityId))?.[0];
    console.log(
      `  ${t.securityId} => ${r ? `${r.code}.${r.exchange}` : "无 primary 行"} | entry=${t.entryTime}`,
    );
  }
}

process.exit(0);
