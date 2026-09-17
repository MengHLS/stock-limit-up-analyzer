/**
 * 只读探针：STEP B 落点① —— 「策略回测评估端口」的真实行为取证。
 *
 * 验五件事（都是「不跑就不知道」的）：
 *   1. 端口能否在**真实策略文档**上跑通（走闭环前 5 阶段，而非手写 dataset→engine→simulator→evaluate）；
 *   2. `datasetSource` 第 1 次是否如实（`registry` / `rebuild`）—— 不伪装；
 *   3. 🔴 **注入数据集复用后，标量是否逐位不变**（= 复用无损；若变，说明注入路径改变了口径）；
 *      同时 `datasetSource` 必须如实变成 `injected`；
 *   4. 🔴 **参数覆写是否真的改变绩效标量**（P0-2 核心判据）；
 *   5. 负例：覆写一个文档**没声明**的参数 ⇒ 必须抛 `RECIPE_PARAMETER_UNKNOWN`（不接受静默忽略）。
 *
 * 本探针只读库（select）+ 只调纯装配 / 评估路径，**不写任何表**。
 * 用法：./node_modules/.bin/tsx docs/evidence/_probe_step_b_evaluation_port.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { evaluateStrategyParameters } from "../../server/research/strategyEvaluation";
import type { StrategyDocument } from "../../server/research/strategySchema/types";
import type { ResearchParameterSet } from "../../server/research/types";

const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }, null, 2));
  process.exit(1);
}

/** 取一份「带 recipe 且有参数 schema」的真实文档（= 参数搜索的真实标的）。 */
const rows = await db.execute(
  sql`select id, strategyId, version, strategyDocumentJson from strategy_versions order by id`,
);
const list = (rows as unknown as [Array<Record<string, unknown>>])[0] ?? [];

let picked: { id: number; doc: StrategyDocument } | null = null;
for (const r of list) {
  let doc: StrategyDocument;
  try {
    doc = JSON.parse(String(r["strategyDocumentJson"])) as StrategyDocument;
  } catch {
    continue;
  }
  const params = doc.parameters?.parameters ?? [];
  if (doc.recipe !== undefined && doc.recipe !== null && params.length > 0) {
    picked = { id: Number(r["id"]), doc };
    break;
  }
}
if (picked === null) {
  console.log(JSON.stringify({ error: "库里没有「带 recipe 且有参数」的策略文档，无法取证" }, null, 2));
  process.exit(1);
}
const { id: docId, doc } = picked;

out["pickedDocument"] = {
  id: docId,
  strategyId: doc.strategyId,
  version: doc.version,
  recipeId: (doc.recipe as { recipeId?: string } | undefined)?.recipeId ?? null,
  parameters: (doc.parameters?.parameters ?? []).map(p => ({
    name: p.name,
    type: p.type,
    defaultValue: p.defaultValue ?? null,
    hasDefault: p.defaultValue !== undefined,
  })),
};

function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * 🔴 必须用**已落库且 READY** 的数据集。
 *
 * 首次取证用的是「重建的 5 交易日 / 30 只小数据集」，闭环 `data` 阶段直接报
 * `CL_DATASET_GATE_NOT_PASS`（gate = INCONCLUSIVE，§45.2 数据链就绪认证未达成）——
 * 那是**正确行为**，不是评估端口的缺陷 ⇒ 取证标的不该是它。
 */
const dvRows = await db.execute(
  sql`select id, datasetId, version, status, startDate, endDate, totalEvents, totalRows
      from dataset_version where status = 'READY' order by id desc limit 5`,
);
const dvList = (dvRows as unknown as [Array<Record<string, unknown>>])[0] ?? [];
out["readyDatasets"] = dvList.map(r => ({
  id: Number(r["id"]),
  version: r["version"],
  startDate: r["startDate"],
  endDate: r["endDate"],
  totalEvents: r["totalEvents"] === null ? null : Number(r["totalEvents"]),
  totalRows: r["totalRows"] === null ? null : Number(r["totalRows"]),
}));
const chosen = dvList[0];
if (chosen === undefined) {
  console.log(JSON.stringify({ ...out, error: "库里没有 status=READY 的数据集，无法取证" }, null, 2));
  process.exit(1);
}
const dsEnd = String(chosen["endDate"]);
const dateRange = { startDate: shiftDays(dsEnd, -10), endDate: dsEnd };
out["probeWindow"] = { ...dateRange, fromDatasetVersionId: Number(chosen["id"]), datasetEnd: dsEnd };
out["observationWindowDeclaration"] = doc.definition?.entry?.observationWindow ?? null;

function summarize(result: Awaited<ReturnType<typeof evaluateStrategyParameters>>): Record<string, unknown> {
  return {
    experimentId: result.experimentId,
    runId: result.runId,
    parameterSet: result.parameterSet,
    datasetVersion: result.datasetVersion,
    datasetSource: result.datasetSource,
    datasetRowCount: result.datasetRowCount,
    backtestFingerprint: result.backtestFingerprint,
    performance: result.evaluation.performance,
    riskAdjusted: result.evaluation.riskAdjusted,
    tradeQuality: result.evaluation.tradeQuality,
    evaluatorsCovered: result.evaluation.evaluatorsCovered,
    stages: result.stages,
  };
}

const BASE = {
  strategyDocument: doc,
  dateRange,
  createdAt: new Date().toISOString(),
  codeVersion: "probe-step-b-evaluation-port",
  datasetVersionId: Number(chosen["id"]),
  datasetSourcePolicy: "prefer-registry" as const,
  /**
   * 🔴 **必须显式声明**：`runPitAudit` 的 `dataReady` **缺省 `false`**（`runAudit.ts:74`），
   * 而 `gate === "PASS"` 的判据是 `hasFail=false && sampleErrors=0 && samplesQueried>0 && dataReady`
   * （`runAudit.ts:145-149`）⇒ **不传它就永远拿不到 `PASS`**，闭环 `data` 阶段会以
   * `CL_DATASET_GATE_NOT_PASS` 阻塞。
   * ⇒ 这不是闭环缺陷，是**调用方必须声明「本数据集已通过就绪认证」**。
   */
  dataReady: true,
  maxTradingDays: 30,
  maxSecuritiesPerDay: 200,
};

// ---- 取证 1：第 1 次评估（不注入 ⇒ 自行解析数据集） ----
let first: Awaited<ReturnType<typeof evaluateStrategyParameters>> | null = null;
try {
  first = await evaluateStrategyParameters({ ...BASE });
  out["firstRun"] = summarize(first);
} catch (error) {
  out["firstRun"] = {
    ok: false,
    errorName: error instanceof Error ? error.name : String(error),
    errorCode: (error as { code?: string }).code ?? null,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

// ---- 取证 2/3：注入同一份数据集再跑 ⇒ 标量必须逐位不变，来源必须变 injected ----
if (first !== null) {
  try {
    const reuse = await evaluateStrategyParameters({ ...BASE, dataset: first.dataset });
    const s = summarize(reuse);
    out["reuseRun"] = {
      ...s,
      scalarIdenticalToFirst:
        s.backtestFingerprint === first.backtestFingerprint &&
        JSON.stringify(s.performance) === JSON.stringify(first.evaluation.performance) &&
        JSON.stringify(s.riskAdjusted) === JSON.stringify(first.evaluation.riskAdjusted) &&
        JSON.stringify(s.tradeQuality) === JSON.stringify(first.evaluation.tradeQuality),
      backtestFingerprintSame: s.backtestFingerprint === first.backtestFingerprint,
      datasetSourceChangedToInjected: s.datasetSource === "injected",
      performanceSame:
        JSON.stringify(reuse.evaluation.performance) === JSON.stringify(first.evaluation.performance),
      riskAdjustedSame:
        JSON.stringify(reuse.evaluation.riskAdjusted) === JSON.stringify(first.evaluation.riskAdjusted),
      tradeQualitySame:
        JSON.stringify(reuse.evaluation.tradeQuality) === JSON.stringify(first.evaluation.tradeQuality),
    };
    out["firstDatasetSource"] = first.datasetSource;
  } catch (error) {
    out["reuseRun"] = {
      ok: false,
      errorName: error instanceof Error ? error.name : String(error),
      errorCode: (error as { code?: string }).code ?? null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---- 取证 4：参数覆写是否真的改变标量 ----
if (first !== null) {
  const numeric = (doc.parameters?.parameters ?? []).filter(
    p => p.type === "number" && typeof p.defaultValue === "number",
  );
  if (numeric.length === 0) {
    out["overrideRun"] = { skipped: "该文档没有数值参数，无法构造覆写对照" };
  } else {
    // 🔴 覆写值必须落在 schema 的 `[min, max]` 内 —— 首次取证直接用 `defaultValue * 10`，
    //    `max_volume_ratio` 当场被 `[VALUE_ABOVE_MAX] 参数 max_volume_ratio = 3 大于 max 1` 拒绝。
    //    那是**参数校验在正确工作**，不是缺陷；这里改为按 min/max 夹取一个「同向但不同值」的覆写。
    const overrides: ResearchParameterSet = {};
    for (const p of numeric) {
      const dv = p.defaultValue as number;
      const lo = typeof p.min === "number" ? p.min : undefined;
      const hi = typeof p.max === "number" ? p.max : undefined;
      let v = dv > 0 ? dv * 2.5 : hi !== undefined && hi >= 1 ? 1 : dv + 1;
      if (lo !== undefined) v = Math.max(lo, v);
      if (hi !== undefined) v = Math.min(hi, v);
      overrides[p.name] = v;
    }
    try {
      const loosened = await evaluateStrategyParameters({
        ...BASE,
        dataset: first.dataset,
        parameterOverrides: overrides,
      });
      out["overrideRun"] = {
        overrides,
        ...summarize(loosened),
        performanceChanged:
          JSON.stringify(loosened.evaluation.performance) !== JSON.stringify(first.evaluation.performance),
        tradeQualityChanged:
          JSON.stringify(loosened.evaluation.tradeQuality) !== JSON.stringify(first.evaluation.tradeQuality),
        backtestFingerprintChanged: loosened.backtestFingerprint !== first.backtestFingerprint,
        experimentIdChanged: loosened.experimentId !== first.experimentId,
      };
    } catch (error) {
      out["overrideRun"] = {
        overrides,
        ok: false,
        errorName: error instanceof Error ? error.name : String(error),
        errorCode: (error as { code?: string }).code ?? null,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ---- 取证 5：负例 —— 未声明的参数必须响亮拒绝 ----
try {
  if (first !== null) {
    await evaluateStrategyParameters({
      ...BASE,
      dataset: first.dataset,
      parameterOverrides: { definitely_not_declared_xyz: 1 },
    });
    out["negativeCase"] = { threw: false, note: "🔴 未抛错 —— 未知覆写参数被静默忽略了" };
  }
} catch (error) {
  out["negativeCase"] = {
    threw: true,
    errorName: error instanceof Error ? error.name : String(error),
    errorCode: (error as { code?: string }).code ?? null,
    errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 400),
  };
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);
