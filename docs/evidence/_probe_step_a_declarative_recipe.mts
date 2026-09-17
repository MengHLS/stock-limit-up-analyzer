/**
 * 只读探针：STEP A 验收取证 —— 声明式条件真的成为回测信号了吗？
 *
 * 三个问题（都是「产物看起来正常但结论可能错」的那类）：
 *   1. 库里的真实文档（`strategy_versions`）在装配层走的是哪条配方路径？
 *      ⇒ 看 `assembly.recipeSource` / `assembly.recipeId`，不是看代码注释。
 *   2. 走的是 `strategy-declarative-conditions` 时，编译出来的门槛**语义对不对**？
 *      ⇒ 用合成 features 试判定，反推「守线 + 缩量」是否成立。
 *   3. 反例：把一条**无法映射**的条件塞进文档 ⇒ 必须**响亮抛错**，绝不回落默认配方。
 *
 * 本探针只读库（`select`），只调装配层的纯装配路径；**不写任何表**。
 * 用法：./node_modules/.bin/tsx docs/evidence/_probe_step_a_declarative_recipe.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { assembleRunWorkbenchInputs } from "../../server/runWorkbenchAssembly/assemble";
import { compileConditionRecipe } from "../../server/research/conditionSignal";
import { PULLBACK_FEATURE_IDS } from "../../server/research/recipeRegistry";
import type { StrategyDocument } from "../../server/research/strategySchema/types";

const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }, null, 2));
  process.exit(1);
}

/** 取库里的真实文档（按 `strategy_versions.id`）。 */
async function loadDocument(id: number): Promise<StrategyDocument | null> {
  const rows = await db.execute(
    sql`select strategyDocumentJson from strategy_versions where id = ${id} limit 1`,
  );
  const list = (rows as unknown as [Array<Record<string, unknown>>])[0] ?? [];
  const raw = list[0]?.["strategyDocumentJson"];
  if (typeof raw !== "string") return null;
  return JSON.parse(raw) as StrategyDocument;
}

/** 数据集窗口：取库里有价的最近 10 个自然日，保证重建路径拿得到样本。 */
const maxDateRows = await db.execute(sql`select max(tradeDate) as d from stock_daily_prices`);
const maxDateList = (maxDateRows as unknown as [Array<Record<string, unknown>>])[0] ?? [];
const latestTradeDate = String(maxDateList[0]?.["d"] ?? "");
out["latestTradeDate"] = latestTradeDate;

function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const windowEnd = latestTradeDate;
const windowStart = shiftDays(latestTradeDate, -10);
out["probeWindow"] = { startDate: windowStart, endDate: windowEnd };

/**
 * 用一组合成 features 试判定「门槛是否放行」。
 * `momentumFromEventClose` 必须给值 —— 它是排序特征，缺失时构造器恒返回 null。
 */
function probeSignal(
  runtime: ReturnType<typeof compileConditionRecipe>,
  features: Record<string, number | null>,
): boolean {
  const build = runtime.buildSignalBuilder({});
  const signal = build({
    securityId: "sec_probe",
    date: "2026-01-05",
    features: { [PULLBACK_FEATURE_IDS.momentum]: 0.1, ...features },
  });
  return signal !== null;
}

/** 对一份文档直接编译（绕开装配层）并反推门槛语义。 */
function inspectCompilation(document: StrategyDocument): Record<string, unknown> {
  const conditions = document.definition?.entry.conditions ?? [];
  try {
    const runtime = compileConditionRecipe({
      strategyId: document.strategyId,
      strategyVersion: document.version,
      conditions,
      parameters: document.parameters,
    });
    return {
      compiled: true,
      recipeId: runtime.recipeId,
      signalDescription: runtime.signalDescription,
      featureIds: runtime.features.map((feature) => feature.featureId).sort(),
      // 反推门槛：守线通过（haircut<0）+ 缩量（volumeRatio<1）应放行；
      // 任一项翻转必须剔除。若「跌破开盘价」也放行，说明方向编译反了。
      probes: {
        守线且缩量: probeSignal(runtime, {
          [PULLBACK_FEATURE_IDS.haircut]: -0.01,
          [PULLBACK_FEATURE_IDS.volumeRatio]: 0.8,
        }),
        跌破开盘价: probeSignal(runtime, {
          [PULLBACK_FEATURE_IDS.haircut]: 0.02,
          [PULLBACK_FEATURE_IDS.volumeRatio]: 0.8,
        }),
        放量: probeSignal(runtime, {
          [PULLBACK_FEATURE_IDS.haircut]: -0.01,
          [PULLBACK_FEATURE_IDS.volumeRatio]: 1.5,
        }),
      },
    };
  } catch (error) {
    return {
      compiled: false,
      errorName: error instanceof Error ? error.name : String(error),
      errorCode: (error as { code?: string }).code ?? null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// 取证 1：库里所有缺 recipe 但有条件的文档 ⇒ 直编 + 装配路由
// ---------------------------------------------------------------------------

const rows = await db.execute(
  sql`select id, strategyId, version, strategyDocumentJson from strategy_versions order by id`,
);
const list = (rows as unknown as [Array<Record<string, unknown>>])[0] ?? [];

const docs = list
  .map((r) => {
    let doc: StrategyDocument | null = null;
    try {
      doc = JSON.parse(String(r["strategyDocumentJson"])) as StrategyDocument;
    } catch {
      doc = null;
    }
    return { id: Number(r["id"]), doc };
  })
  .filter((item): item is { id: number; doc: StrategyDocument } => item.doc !== null);

const noRecipeWithConditions = docs.filter(
  (item) =>
    (item.doc.recipe === undefined || item.doc.recipe === null) &&
    (item.doc.definition?.entry.conditions?.length ?? 0) > 0,
);
out["noRecipeWithConditionsIds"] = noRecipeWithConditions.map((item) => ({
  id: item.id,
  strategyId: item.doc.strategyId,
  conditionCount: item.doc.definition?.entry.conditions?.length ?? 0,
}));

out["directCompilation"] = noRecipeWithConditions.map((item) => ({
  id: item.id,
  strategyId: item.doc.strategyId,
  ...inspectCompilation(item.doc),
}));

// ---------------------------------------------------------------------------
// 取证 2：装配路由（走 assembleRunWorkbenchInputs 的真实路径）
// ---------------------------------------------------------------------------

const assemblyProbes: Array<Record<string, unknown>> = [];
for (const item of noRecipeWithConditions.slice(0, 2)) {
  const doc = item.doc;
  try {
    const result = await assembleRunWorkbenchInputs({
      strategyId: doc.strategyId,
      strategyVersion: doc.version,
      startDate: windowStart,
      endDate: windowEnd,
      createdAt: new Date().toISOString(),
      codeVersion: "probe-step-a",
      strategyDocument: doc,
      ...(doc.datasetVersionId !== undefined ? { datasetVersionId: doc.datasetVersionId } : {}),
      datasetSourcePolicy: "rebuild",
      maxTradingDays: 5,
      maxSecuritiesPerDay: 30,
    });
    assemblyProbes.push({
      id: item.id,
      strategyId: doc.strategyId,
      ok: true,
      recipeId: result.assembly.recipeId,
      recipeSource: result.assembly.recipeSource,
      recipeFeatureIds: [...result.assembly.recipeFeatureIds].sort(),
      selectionSummary: result.assembly.selectionSummary,
      datasetSource: result.assembly.datasetSource,
      datasetRowCount: result.assembly.datasetRowCount,
      datasetSecurityCount: result.assembly.datasetSecretCount,
      signalDescription: (result.inputs.strategy13 as { signalDescription?: string }).signalDescription ?? null,
    });
  } catch (error) {
    assemblyProbes.push({
      id: item.id,
      strategyId: doc.strategyId,
      ok: false,
      errorName: error instanceof Error ? error.name : String(error),
      errorCode: (error as { code?: string }).code ?? null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
out["assemblyProbes"] = assemblyProbes;

// ---------------------------------------------------------------------------
// 取证 3：反例 —— 注入一条不可映射的条件，必须响亮抛错（不回落默认配方）
// ---------------------------------------------------------------------------

const base = noRecipeWithConditions[0]?.doc;
if (base !== undefined) {
  const brokenDoc: StrategyDocument = {
    ...base,
    definition:
      base.definition === undefined
        ? undefined
        : {
            ...base.definition,
            entry: {
              ...base.definition.entry,
              conditions: [
                ...base.definition.entry.conditions,
                {
                  field: "event.limitUpPrice",
                  operator: "GREATER_THAN",
                  value: 9999,
                  valueType: "CONSTANT",
                  enabled: true,
                },
              ],
            },
          },
  };
  try {
    await assembleRunWorkbenchInputs({
      strategyId: brokenDoc.strategyId,
      strategyVersion: brokenDoc.version,
      startDate: windowStart,
      endDate: windowEnd,
      createdAt: new Date().toISOString(),
      codeVersion: "probe-step-a-negative",
      strategyDocument: brokenDoc,
      datasetSourcePolicy: "rebuild",
      maxTradingDays: 3,
      maxSecuritiesPerDay: 10,
    });
    out["negativeCase"] = { threw: false, note: "🔴 未抛错 —— 说明不可映射的条件被静默吞掉了" };
  } catch (error) {
    out["negativeCase"] = {
      threw: true,
      errorName: error instanceof Error ? error.name : String(error),
      errorCode: (error as { code?: string }).code ?? null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);
