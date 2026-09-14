/**
 * 端到端探针：成交明细「证券名称 + 代码」解析链路。
 *
 * 走网页同一条服务端路径（真实 tRPC caller → `researchRun.securityLabels` → 真库），
 * 用**真实留档回测结果**里的 securityId 集合验证：
 *
 *   A. 端点在真实数据上跑通、output 契约校验生效；
 *   B. 每个 `sec_<uuid>` 都能翻译成 canonical 代码（实测 251/251）；
 *   C. 名称覆盖率**如实**（名称源只收录涨停过的股票，缺口必须暴露为 null 而非假名）；
 *   D. 服务端返回的代码与 `parseSecurityCode` 权威解析**一致**（无自造格式）；
 *   E. 入参契约真的挡得住空数组 / 超限（不是摆设）。
 *
 * 只读：不写库、不删库。
 *
 * 用法：npx tsx docs/evidence/_probe_security_labels_e2e.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { appRouter } from "../../server/routers";
import { getDb } from "../../server/db";
import { loadSecurityLabels } from "../../server/closedLoopBacktestRun/securityLabels";
import { parseSecurityCode, canonicalCode } from "../../server/security/code";

const adminCtx = {
  user: { id: "probe", role: "admin" as const, openId: "probe", name: "probe" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never;

const caller = appRouter.createCaller(adminCtx);

let failures = 0;
const fail = (m: string): void => {
  failures += 1;
  console.log(`   🔴 ${m}`);
};
const ok = (m: string): void => console.log(`   ✅ ${m}`);
const eq = (label: string, actual: unknown, expected: unknown): void => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) ok(`${label} = ${JSON.stringify(actual)}`);
  else fail(`${label} 不符：实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
};

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

const out: Record<string, unknown> = {};

// ---------- 取真实留档结果里的 securityId 集合 ----------
const runs = unwrap(
  await db.execute(
    sql`SELECT id, runId, strategyId, tradeCount FROM closed_loop_backtest_run ORDER BY id`,
  ),
);
const tradeIds = new Set<string>();
let tradeTotal = 0;
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
  for (const t of sink) tradeIds.add(String(t.securityId));
  tradeTotal += sink.length;
}
const securityIds = [...tradeIds];

console.log("\n================ A. 真实 tRPC 端点 ================");
console.log(`   留档行 = ${runs.length}，成交笔数合计 = ${tradeTotal}，唯一 securityId = ${securityIds.length}`);
out.runCount = runs.length;
out.tradeTotal = tradeTotal;
out.uniqueSecurityId = securityIds.length;

if (securityIds.length === 0) {
  console.log("   （无留档成交数据，后续断言跳过）");
} else {
  const viaTrpc = (await caller.researchRun.securityLabels({ securityIds })) as Record<
    string,
    { securityId: string; code: string | null; name: string | null; exchange: string | null }
  >;
  ok(`端点返回条目数 = ${Object.keys(viaTrpc).length}`);
  eq("键数 == 入参去重数", Object.keys(viaTrpc).length, securityIds.length);

  // 契约校验生效 = 调用本身没抛错（output 被 zod 校验过）

  console.log("\n================ B. 身份 → 代码 ================");
  let withCode = 0;
  const codeMismatch: string[] = [];
  for (const id of securityIds) {
    const label = viaTrpc[id];
    if (!label) {
      fail(`缺少 id 的标签：${id}`);
      continue;
    }
    if (label.securityId !== id) fail(`标签 securityId 与键不一致：${id}`);
    if (label.code === null) continue;
    withCode += 1;
    // D. 与服务端权威解析一致（无自造格式）
    try {
      const parsed = parseSecurityCode(label.code);
      const canonical = canonicalCode(parsed);
      if (canonical !== label.code) codeMismatch.push(`${id} → ${label.code} vs ${canonical}`);
      if (label.exchange !== null && parsed.exchange !== label.exchange) {
        codeMismatch.push(`${id} 交易所不一致：${label.exchange} vs ${parsed.exchange}`);
      }
    } catch (error) {
      codeMismatch.push(`${id} → ${label.code} 无法被权威解析：${(error as Error).message}`);
    }
  }
  eq("能翻译成代码的 identity 数", withCode, securityIds.length);
  eq("代码格式/交易所冲突数", codeMismatch.length, 0);
  if (codeMismatch.length > 0) console.log(`      ${codeMismatch.slice(0, 5).join("\n      ")}`);
  out.withCode = withCode;

  console.log("\n================ C. 名称覆盖率（如实） ================");
  let withName = 0;
  const missing: string[] = [];
  const samples: string[] = [];
  for (const id of securityIds) {
    const label = viaTrpc[id];
    if (!label?.code) continue;
    if (label.name === null) {
      missing.push(label.code);
      continue;
    }
    withName += 1;
    if (samples.length < 8) samples.push(`${label.name} ${label.code}`);
  }
  console.log(`   有名称 = ${withName} / 有代码 = ${withCode}（覆盖率 ${((withName / Math.max(withCode, 1)) * 100).toFixed(1)}%）`);
  console.log(`   名称缺口（代码在、名称源未收录）= ${missing.length}`);
  for (const s of samples) console.log(`       ${s}`);
  out.withName = withName;
  out.nameMissCount = missing.length;
  out.nameSamples = samples;

  // 名称缺口必须与代码无关：缺名称的代码本身必须是合法代码（不是脏数据）
  let dirty = 0;
  for (const code of missing) {
    try {
      parseSecurityCode(code);
    } catch {
      dirty += 1;
    }
  }
  eq("名称缺口里的非法代码数（应为 0 ⇒ 缺口是数据收录问题，不是解析问题）", dirty, 0);

  console.log("\n================ 抽样核对（人工可读） ================");
  for (const id of securityIds.slice(0, 5)) {
    const l = viaTrpc[id];
    console.log(`   ${id}  →  ${l?.name ?? "—"} ${l?.code ?? "—"}`);
  }

  console.log("\n================ 同源核对（端点 vs 仓储直调） ================");
  const direct = await loadSecurityLabels(securityIds);
  eq("仓储直调条目数 == 端点条目数", direct.length, securityIds.length);
  let diff = 0;
  for (const label of direct) {
    const a = JSON.stringify(label);
    const b = JSON.stringify(viaTrpc[label.securityId]);
    if (a !== b) diff += 1;
  }
  eq("两侧逐条一致（零口径漂移）", diff, 0);
}

console.log("\n================ E. 入参契约真的挡得住 ================");
let rejectedEmpty = false;
try {
  await caller.researchRun.securityLabels({ securityIds: [] });
} catch {
  rejectedEmpty = true;
}
eq("空数组被拒（zod min(1)）", rejectedEmpty, true);

let rejectedOverflow = false;
try {
  await caller.researchRun.securityLabels({
    securityIds: Array.from({ length: 501 }, (_, i) => `sec_x${i}`),
  });
} catch {
  rejectedOverflow = true;
}
eq("501 个 id 被拒（zod max(500)）", rejectedOverflow, true);

console.log("\n================ 汇总 ================");
console.log(`   失败断言 = ${failures}`);
console.log(`   RESULT = ${failures === 0 ? "PASS" : "FAIL"}`);
out.failures = failures;
out.result = failures === 0 ? "PASS" : "FAIL";

writeFileSync(
  new URL("_probe_security_labels_e2e.json", import.meta.url),
  JSON.stringify(out, null, 2),
  "utf8",
);
console.log("[ok] 探针结束（未写库、未删库）");
process.exit(failures === 0 ? 0 : 1);
