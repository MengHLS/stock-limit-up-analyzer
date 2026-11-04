/**
 * Task 18 —— 端到端验证：新转正策略的**回测真的消费「守线 + 缩量」而非「涨跌幅取前 N 名」**。
 *
 * 三层断言（由外到内，逐层更接近真执行）：
 *   A. **装配面**：`assembleRunWorkbenchInputs` 对每个 variant 必须解析到
 *      `assembly.recipeSource === "strategy-document"`（而非 `explicit-request` 兜底）、
 *      `assembly.recipeId === "first-limit-pullback-hold-shrink"`、
 *      `assembly.recipeFeatureIds` = 4 个回踩特征（而非只有 `pctChange`）；
 *   B. **参数面**：`inputs.experimentConfig.parameters` 必须逐字等于文档里的 `defaultValue`
 *      （① 缩量 0.3 / ② 缩量 0.5 且 require_bullish 1 / ④-c max_drawdown 0.1）；
 *   C. **信号面（核心）**：用装配出的 `strategy13` 对**真实数据集**逐日跑信号，
 *      抽样断言「被放行的证券满足 `volumeRatio ≤ maxVolumeRatio` ∧ `haircut ≤ maxDrawdown`
 *      （∧ `isBullish ≥ 1` 若要求）」，并统计有多少「当日 pctChange 前 5 名」被新配方拒之门外
 *      —— 若配方没生效（跑的还是旧配方），这个集合会完全不同。
 *
 * 只读：不写任何表。
 *
 * 用法：npx tsx docs/evidence/_probe_backtest_consumes_recipe.mts
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { assembleRunWorkbenchInputs } from "../../server/runWorkbenchAssembly/assemble";
import { createDatasetSession } from "../../server/research/datasetAccess/session";
import { runCandidateEngine } from "../../server/research/signalEngine/engine";
import { visibleBars } from "../../server/data";
import type { StrategyDocument } from "../../server/research/strategySchema/types";
import {
  DEFAULT_STRATEGY_RECIPE_ID,
  PULLBACK_FEATURE_IDS,
  resolveStrategyRecipeById,
} from "../../server/research/recipeRegistry";
import {
  computeHaircutFromEventLow,
  computeIsBullish,
  computeVolumeRatio,
  eventBaselineOf,
} from "../../server/research/recipeFeatures/pullbackFeatures";

interface Variant {
  readonly strategyId: string;
  readonly versionId: number;
  readonly label: string;
  readonly maxVolumeRatio: number;
  readonly maxDrawdown: number;
  readonly requireBullish: number;
}

const VARIANTS: readonly Variant[] = [
  { strategyId: "cand-360001", versionId: 420001, label: "① 守线+缩量≤30%", maxVolumeRatio: 0.3, maxDrawdown: 0.02, requireBullish: 0 },
  { strategyId: "cand-360002", versionId: 420002, label: "② 守线+缩量≤50%+红盘", maxVolumeRatio: 0.5, maxDrawdown: 0.02, requireBullish: 1 },
  { strategyId: "cand-360005", versionId: 420004, label: "③-b 买入=T+1收盘", maxVolumeRatio: 0.3, maxDrawdown: 0.02, requireBullish: 0 },
  { strategyId: "cand-360008", versionId: 420007, label: "④-c 回撤≤10%", maxVolumeRatio: 0.3, maxDrawdown: 0.1, requireBullish: 0 },
];

/**
 * 决策窗口。
 *
 * 🔴 2026-09-13 实测教训：`WINDOW` **必须落在数据集窗口内**，否则
 * `createDatasetSession` 会抛「实验日期范围超出数据集窗口」——
 * 装配面（A/B）不校验这一点，只有真正驱动引擎（C）才会暴露。
 *
 * 实测：数据集 390002（`dataset_version`）窗口 = `2024-09-01 → 2026-09-01`
 * （库内存 UTC 墙钟 `2024-08-31T16:00Z`，即东八区 2024-09-01 00:00）。
 * 故此处取窗口内一个季度，既保证 A/B 装配与 C 引擎都能跑，又控制运行时。
 */
const WINDOW = { startDate: "2025-01-02", endDate: "2025-03-31" };
const EXPECTED_FEATURES = [
  PULLBACK_FEATURE_IDS.haircut,
  PULLBACK_FEATURE_IDS.volumeRatio,
  PULLBACK_FEATURE_IDS.isBullish,
  PULLBACK_FEATURE_IDS.momentum,
].sort();

const conn = await createConnection(process.env.DATABASE_URL as string);

async function loadDocument(strategyId: string): Promise<StrategyDocument> {
  const [rows] = await conn.query(
    "SELECT strategyDocumentJson FROM strategy_versions WHERE strategyId = ? ORDER BY id DESC LIMIT 1",
    [strategyId],
  );
  const row = (rows as Array<{ strategyDocumentJson: unknown }>)[0];
  if (row === undefined) throw new Error(`找不到 ${strategyId} 的文档`);
  const raw = row.strategyDocumentJson;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as StrategyDocument;
}

let failures = 0;
const fail = (msg: string): void => { failures += 1; console.log(`   🔴 ${msg}`); };

// ---------------------------------------------------------------------------
// A + B：装配面 / 参数面
// ---------------------------------------------------------------------------

console.log("=========== A. 装配面断言 ===========");
let firstAssembled: Awaited<ReturnType<typeof assembleRunWorkbenchInputs>> | null = null;

for (const v of VARIANTS) {
  const document = await loadDocument(v.strategyId);
  const versionId = document.definition?.datasets?.[0]?.datasetVersionId;
  const result = await assembleRunWorkbenchInputs({
    strategyId: v.strategyId,
    strategyVersion: document.version,
    startDate: WINDOW.startDate,
    endDate: WINDOW.endDate,
    createdAt: new Date().toISOString(),
    codeVersion: "probe",
    strategyDocument: document,
    ...(versionId === undefined ? {} : { datasetVersionId: versionId }),
    maxSecuritiesPerDay: 80,
  });
  if (firstAssembled === null) firstAssembled = result;

  const a = result.assembly;
  console.log(`\n${v.label} (${v.strategyId}@${a.strategyVersion})`);
  console.log(`   recipeSource=${a.recipeSource}  recipeId=${a.recipeId}  datasetSource=${a.datasetSource}`);
  console.log(`   recipeFeatureIds=[${[...a.recipeFeatureIds].sort().join(", ")}]`);
  console.log(`   parameters=${JSON.stringify(result.inputs.experimentConfig?.parameters ?? {})}`);
  console.log(`   dataset: ${a.datasetRowCount} 行 / ${a.datasetSecretCount} 只`);

  if (a.recipeSource !== "strategy-document") {
    fail(`recipeSource 应为 strategy-document（实际 ${a.recipeSource}）⇒ 文档 recipe 未被消费`);
  }
  if (a.recipeId !== "first-limit-pullback-hold-shrink") {
    fail(`recipeId 应为 first-limit-pullback-hold-shrink（实际 ${a.recipeId}）`);
  }
  const produced = [...a.recipeFeatureIds].sort();
  if (produced.join(",") !== EXPECTED_FEATURES.join(",")) {
    fail(`recipeFeatureIds 应为 [${EXPECTED_FEATURES.join(", ")}]（实际 [${produced.join(", ")}]）`);
  }
  if (produced.includes("pctChange")) {
    fail("recipeFeatureIds 含 pctChange ⇒ 仍在跑旧配方（涨跌幅择优）");
  }
  const params = (result.inputs.experimentConfig?.parameters ?? {}) as Record<string, number>;
  if (params["max_volume_ratio"] !== v.maxVolumeRatio) {
    fail(`max_volume_ratio 应为 ${v.maxVolumeRatio}（实际 ${String(params["max_volume_ratio"])}）`);
  }
  if (params["max_drawdown"] !== v.maxDrawdown) {
    fail(`max_drawdown 应为 ${v.maxDrawdown}（实际 ${String(params["max_drawdown"])}）`);
  }
  if (params["require_bullish"] !== v.requireBullish) {
    fail(`require_bullish 应为 ${v.requireBullish}（实际 ${String(params["require_bullish"])}）`);
  }
}

// ---------------------------------------------------------------------------
// C：信号面 —— 用真实引擎跑出候选，核对 gate 真生效
// ---------------------------------------------------------------------------
//
// ⚠️ 口径纠正（2026-09-13）：`ResearchDataset.rows[]` 是**扁平 OHLCV 行**，没有 `bars` 字段。
// bars 只在访问层由 `createDatasetDataSource` 按 securityId 分组后生成（且是**全窗口** bars），
// 再由 pipeline 的 `visibleBars(rawBars, date, point)` 做 as-of 切片。
// 因此「手搓 bars 复算」是错的口径 —— 必须走**真实引擎**（`runCandidateEngine`），
// 它内部就是 createDatasetSession → 逐决策日 runResearchPipeline，与回测同一条代码路径。

console.log("\n=========== C. 信号面断言（真实引擎跑候选 + gate 复核）===========");

/** 从装配结果里抽出引擎三入参（缺任一即不可继续）。 */
function engineInputsOf(assembled: NonNullable<typeof firstAssembled>) {
  const { experimentConfig, strategyContract, strategy13 } = assembled.inputs;
  if (experimentConfig === undefined || strategyContract === undefined || strategy13 === undefined) {
    throw new Error("装配结果缺 experimentConfig / strategyContract / strategy13，无法驱动引擎");
  }
  return { config: experimentConfig, strategy: strategyContract, strategy13 };
}

/** 选择配置的人话摘要（审计展示用）。 */
function describeSelection(selectionConfig: { readonly method: { readonly kind: string; readonly n?: number } }): string {
  const m = selectionConfig.method;
  return m.kind === "topN" ? `topN=${String(m.n)}` : m.kind;
}

if (firstAssembled === null) {
  fail("首个装配失败，无法继续");
} else {
  // ---- C1. 用「文档配方的 strategy13」跑真实引擎 ----
  const docInputs = engineInputsOf(firstAssembled);
  const docRun = runCandidateEngine({
    dataset: firstAssembled.dataset,
    config: docInputs.config,
    strategy: docInputs.strategy,
    strategy13: docInputs.strategy13,
  });
  console.log(
    `\n文档配方 run：决策日 ${docRun.evaluation.decisionDayCount} 天 / ` +
      `累计名额 ${docRun.evaluation.totalSelectedSlots} / 去重入选 ${docRun.evaluation.distinctSelectedSecurities.length} 只 / ` +
      `去重 universe ${docRun.evaluation.distinctUniverseSecurities.length} 只`,
  );
  let droppedInsufficient = 0;
  let droppedNoBars = 0;
  for (const day of docRun.days) {
    for (const d of day.dropped) {
      if (d.reason === "INSUFFICIENT_FEATURES") droppedInsufficient += 1;
      else if (d.reason === "NO_BARS") droppedNoBars += 1;
    }
  }
  console.log(`累计剔除：INSUFFICIENT_FEATURES=${droppedInsufficient}  NO_BARS=${droppedNoBars}`);
  if (docRun.evaluation.totalSelectedSlots === 0) {
    fail("文档配方 0 名额 ⇒ 该配方在本窗口跑不出任何候选（gate 过严或数据缺）");
  }
  if (droppedInsufficient === 0) {
    fail("INSUFFICIENT_FEATURES = 0 ⇒ gate 从未剔除任何证券，硬门槛形同虚设");
  }

  // ---- C2. 逐入选证券复核 gate：入选 ⇒ 门前置条件必须成立 ----
  // 用 `dataSource` 的**全窗口 bars** + `visibleBars` 复算（与 pipeline 同口径）。
  const session = createDatasetSession(firstAssembled.dataset, docInputs.config);
  const params = (docInputs.config.parameters ?? {}) as Record<string, number>;
  const maxVolumeRatio = params["max_volume_ratio"];
  const maxDrawdown = params["max_drawdown"];
  const requireBullish = params["require_bullish"];
  console.log(`\n复核门槛：max_volume_ratio=${maxVolumeRatio}  max_drawdown=${maxDrawdown}  require_bullish=${requireBullish}`);

  let checked = 0;
  let violations = 0;
  let recomputeMissing = 0;
  for (const day of docRun.days) {
    for (const sel of day.selected) {
      const raw = session.dataSource.getBars(sel.securityId);
      if (raw === null) { recomputeMissing += 1; continue; }
      const bars = visibleBars(raw, day.date, docInputs.strategy13.point);
      const baseline = eventBaselineOf(bars);
      if (baseline === null) { recomputeMissing += 1; continue; }
      const haircut = computeHaircutFromEventLow(bars, baseline);
      const volumeRatio = computeVolumeRatio(bars, baseline);
      const isBullish = computeIsBullish(bars);
      if (haircut === null || volumeRatio === null || isBullish === null) { recomputeMissing += 1; continue; }
      checked += 1;
      const okHaircut = maxDrawdown === undefined || haircut <= maxDrawdown;
      const okVolume = maxVolumeRatio === undefined || volumeRatio <= maxVolumeRatio;
      const okBull = requireBullish === undefined || requireBullish < 1 || isBullish >= 1;
      if (!okHaircut || !okVolume || !okBull) {
        violations += 1;
        if (violations <= 5) {
          console.log(
            `   🔴 入选但未过门槛：${day.date} ${sel.securityId} ` +
              `haircut=${haircut.toFixed(4)}(≤${String(maxDrawdown)}) volumeRatio=${volumeRatio.toFixed(4)}(≤${String(maxVolumeRatio)}) isBullish=${isBullish}`,
          );
        }
      }
    }
  }
  console.log(`复核入选 ${checked} 个样本：违反门槛 ${violations}；无法复算 ${recomputeMissing}`);
  if (checked === 0) {
    fail("复核样本为 0 ⇒ 无法验证 gate（数据链路可能断裂）");
  }
  if (violations > 0) {
    fail(`有 ${violations} 个入选样本未通过门槛 ⇒ 回测跑的**不是**文档声明的 gate 条件`);
  }

  // ---- C3. 反事实：同一数据集，新配方 vs 旧兜底配方，选中集合必须不同 ----
  const oldRuntime = resolveStrategyRecipeById(DEFAULT_STRATEGY_RECIPE_ID);
  const oldParams = oldRuntime.resolveParameters({ parameters: [] });
  const oldStrategy: typeof docInputs.strategy = { ...docInputs.strategy };
  const oldRun = runCandidateEngine({
    dataset: firstAssembled.dataset,
    config: {
      ...docInputs.config,
      parameters: oldParams,
    },
    strategy: oldStrategy,
    strategy13: {
      point: oldRuntime.point,
      features: oldRuntime.features,
      signalBuilder: oldRuntime.buildSignalBuilder(oldParams),
      rankingConfig: oldRuntime.rankingConfig,
      selectionConfig: oldRuntime.selectionConfig,
      ...(oldRuntime.signalDescription !== undefined ? { signalDescription: oldRuntime.signalDescription } : {}),
    },
  });
  const newSet = new Set(docRun.evaluation.distinctSelectedSecurities);
  const oldSet = new Set(oldRun.evaluation.distinctSelectedSecurities);
  let overlap = 0;
  for (const s of newSet) if (oldSet.has(s)) overlap += 1;
  console.log(
    `\n新配方入选 ${newSet.size} 只 / 旧配方入选 ${oldSet.size} 只 / 交集 ${overlap} 只`,
  );
  console.log(`新配方（文档）selection：${describeSelection(docRun.selectionConfig)}`);
  console.log(`旧配方（兜底）selection：${describeSelection(oldRun.selectionConfig)}`);
  console.log(`新配方 features=[${docInputs.strategy13.features.map(f => f.featureId).join(", ")}]`);
  console.log(`旧配方 features=[${oldRuntime.features.map(f => f.featureId).join(", ")}]`);
  if (oldRuntime.recipeId === "first-limit-pullback-hold-shrink") {
    fail("新旧配方 recipeId 相同 ⇒ 装配层不可能区分");
  }
  if (newSet.size === oldSet.size && overlap === newSet.size) {
    fail("新旧配方选中集合完全相同 ⇒ 无法证明文档配方真的生效（可能在跑旧兜底）");
  }
}

console.log(`\n=========== 结论 ===========`);
console.log(failures === 0 ? "✅ 全部断言通过：回测消费的是「守线+缩量」配方，且参数逐字来自策略文档。" : `🔴 ${failures} 条断言失败（见上）。`);

await conn.end();
process.exit(failures === 0 ? 0 : 1);
