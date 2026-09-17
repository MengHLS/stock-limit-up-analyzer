/**
 * 只读探针：STEP B 落点③ 的接线件 —— **同步**「参数集 → 绩效标量」评估器。
 *
 * 验四件事：
 *   1. 🔴 `evaluator(parameterSet)` 返回的**不是 Promise**（闭环执行器与搜索器都要求同步）；
 *   2. 与 async 版 `evaluateStrategyParameters` 在**同一组参数**下给出**同一个标量**（同源，不是第二套口径）；
 *   3. 换一组覆写 ⇒ 标量**真的不同**（参数进了回测）；
 *   4. 非法覆写（未知键）⇒ 结构化 `{status:"failed"}`（**不抛错**、也**不静默忽略**）。
 *
 * 只读库 + 只调纯装配/评估路径，**不写任何表**。
 * 用法：./node_modules/.bin/tsx docs/evidence/_probe_step_b_sync_evaluator.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { evaluateStrategyParameters } from "../../server/research/strategyEvaluation";
import { createStrategyParameterEvaluator } from "../../server/research/strategyEvaluation";
import type { StrategyDocument } from "../../server/research/strategySchema/types";
import type { ResearchParameterSet } from "../../server/research/types";

const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };
const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }, null, 2));
  process.exit(1);
}

const rows = await db.execute(sql`select id, strategyDocumentJson from strategy_versions order by id`);
const list = (rows as unknown as [Array<Record<string, unknown>>])[0] ?? [];
let picked: { id: number; doc: StrategyDocument } | null = null;
for (const r of list) {
  let doc: StrategyDocument;
  try {
    doc = JSON.parse(String(r["strategyDocumentJson"])) as StrategyDocument;
  } catch {
    continue;
  }
  if (doc.recipe !== undefined && doc.recipe !== null && (doc.parameters?.parameters?.length ?? 0) > 0) {
    picked = { id: Number(r["id"]), doc };
    break;
  }
}
if (picked === null) {
  console.log(JSON.stringify({ error: "无可取证文档" }, null, 2));
  process.exit(1);
}
const { doc } = picked;

const dvRows = await db.execute(
  sql`select id, endDate from dataset_version where status = 'READY' order by id desc limit 1`,
);
const dvList = (dvRows as unknown as [Array<Record<string, unknown>>])[0] ?? [];
const dsId = Number(dvList[0]?.["id"]);
const dsEnd = String(dvList[0]?.["endDate"]);
function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const dateRange = { startDate: shiftDays(dsEnd, -10), endDate: dsEnd };
const createdAt = new Date().toISOString();

out["picked"] = { docId: picked.id, strategyId: doc.strategyId, datasetVersionId: dsId, dateRange };

// ---- baseline：async 版（同时借它拿到 dataset 供复用）----
const base = await evaluateStrategyParameters({
  strategyDocument: doc,
  dateRange,
  createdAt,
  codeVersion: "probe-sync-evaluator",
  datasetVersionId: dsId,
  datasetSourcePolicy: "prefer-registry",
  dataReady: true,
  maxTradingDays: 30,
  maxSecuritiesPerDay: 200,
});
out["asyncBaseline"] = {
  parameterSet: base.parameterSet,
  datasetSource: base.datasetSource,
  totalReturnPct: base.evaluation.performance?.totalReturnPct ?? null,
  maxDrawdownPct: base.evaluation.performance?.maxDrawdownPct ?? null,
  tradeCount: base.evaluation.tradeQuality?.completedTradeCount ?? null,
};

// ---- 构造同步评估器 ----
const evaluator = createStrategyParameterEvaluator({
  dataset: base.dataset,
  document: doc,
  dateRange,
  createdAt,
  codeVersion: "probe-sync-evaluator",
  runIdPrefix: "PARAM-EVAL-PROBE",
});

// 取证 1+2：同一组参数（= 文档默认）⇒ 必须与 async 基线同标量，且返回值不是 Promise
const same: ResearchParameterSet = { ...(base.parameterSet as ResearchParameterSet) };
const r1 = evaluator(same);
out["syncCall"] = {
  isPromise: typeof (r1 as unknown as { then?: unknown }).then === "function",
  status: (r1 as { status?: string }).status,
  metrics: (r1 as { metrics?: unknown }).metrics ?? null,
  error: (r1 as { error?: string }).error ?? null,
};
const m1 = (r1 as { metrics?: { totalReturnPct: number } }).metrics;
out["matchesAsyncBaseline"] =
  m1 !== undefined &&
  base.evaluation.performance !== null &&
  m1.totalReturnPct === base.evaluation.performance.totalReturnPct;

// 取证 3：换一组覆写 ⇒ 标量必须不同
const r2 = evaluator({ max_drawdown: 0.05, max_volume_ratio: 0.75, require_bullish: 1 });
out["overrideCall"] = {
  status: (r2 as { status?: string }).status,
  metrics: (r2 as { metrics?: unknown }).metrics ?? null,
  error: (r2 as { error?: string }).error ?? null,
  differsFromBaseline: (r2 as { metrics?: { totalReturnPct: number } }).metrics?.totalReturnPct !== m1?.totalReturnPct,
};

// 取证 4：未知覆写键 ⇒ 结构化失败（不抛错）
let threw = false;
let r3: unknown = null;
try {
  r3 = evaluator({ definitely_not_declared_xyz: 1 });
} catch {
  threw = true;
}
out["unknownKeyCall"] = {
  threw,
  status: (r3 as { status?: string } | null)?.status ?? null,
  errorhead: ((r3 as { error?: string } | null)?.error ?? "").slice(0, 200),
};

console.log(JSON.stringify(out, null, 2));
process.exit(0);
