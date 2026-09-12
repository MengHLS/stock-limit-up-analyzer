/**
 * RESEARCH-002 前端工作台 — API 契约核对（真实 TiDB，只读）。
 *
 * 目的：工作台页面渲染所依赖的每个字段，都在**真实数据**上验证一次。
 * 单测用的是内存夹具，能证明逻辑正确；这里证明「页面接上真库后不会白屏」。
 *
 * 只读，不建任何 research_* 行，不需要清理。
 *
 * 用法：npx tsx scripts/checkResearchWorkbenchApi.mts [--version=390001]
 */

import "dotenv/config";
import { researchEngineRouter } from "../server/researchEngineRouter";

const argv = process.argv.slice(2);
const versionArg = argv.find((a) => a.startsWith("--version="));
const DATASET_VERSION_ID = versionArg ? Number(versionArg.slice("--version=".length)) : 390001;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ❌ ${label}${detail === undefined ? "" : ` — 实际：${JSON.stringify(detail)}`}`);
  }
}

function section(title: string): void {
  console.log(`\n[${title}]`);
}

async function main(): Promise<void> {
  console.log(`RESEARCH-002 工作台 API 契约核对（Dataset Version ${DATASET_VERSION_ID}，只读）`);
  const caller = researchEngineRouter.createCaller({ req: {} as never, res: {} as never, user: null });

  // ---- 1. 变量目录（CreateAnalysisDialog / VariableCatalogCard 的数据源）----
  section("listVariables — 变量目录");
  const vars = await caller.listVariables({ datasetVersionId: DATASET_VERSION_ID });
  console.log(`  datasetVersion = ${JSON.stringify(vars.datasetVersion)}`);

  check("返回 datasetVersion 上下文", vars.datasetVersion !== undefined && vars.datasetVersion !== null);
  check("datasetVersion.versionLabel 是字符串", typeof vars.datasetVersion.versionLabel === "string", vars.datasetVersion.versionLabel);
  check("datasetVersion.datasetName 是字符串", typeof vars.datasetVersion.datasetName === "string", vars.datasetVersion.datasetName);
  check("datasetVersion.status 为 READY", vars.datasetVersion.status === "READY", vars.datasetVersion.status);
  check(
    "datasetVersion.totalEvents 为有限数（工作台要显示事件数）",
    typeof vars.datasetVersion.totalEvents === "number" && Number.isFinite(vars.datasetVersion.totalEvents),
    vars.datasetVersion.totalEvents,
  );
  check(
    "datasetVersion.pathRelativeDayRange 形如 {min,max}",
    !!vars.datasetVersion.pathRelativeDayRange &&
      typeof vars.datasetVersion.pathRelativeDayRange.min === "number" &&
      typeof vars.datasetVersion.pathRelativeDayRange.max === "number",
    vars.datasetVersion.pathRelativeDayRange,
  );
  check("datasetVersion.horizons 为非空数组", Array.isArray(vars.datasetVersion.horizons) && vars.datasetVersion.horizons.length > 0, vars.datasetVersion.horizons);

  check("features 含 turnover（验收案例特征）", vars.features.includes("turnover"));
  check("features 含 market_cap（上游全 NULL 但变量必须存在）", vars.features.includes("market_cap"));
  check("outcomes 含 future_return_5d（验收案例目标）", vars.outcomes.includes("future_return_5d"));

  // 视界陷阱：future_return_* 来自 path(1..20)，max_return_* / is_breakout_* 只来自 outcome({5,10,20})
  const pathMax = vars.datasetVersion.pathRelativeDayRange?.max ?? 0;
  const pathMin = vars.datasetVersion.pathRelativeDayRange?.min ?? 0;
  const pathHorizons = Array.from({ length: pathMax - pathMin + 1 }, (_, i) => pathMin + i);
  const missingFuture = pathHorizons.filter((h) => !vars.outcomes.includes(`future_return_${h}d`));
  check(
    `future_return_{h}d 覆盖 path 全部相对日 ${pathMin}~${pathMax}`,
    missingFuture.length === 0,
    missingFuture,
  );
  const outcomeOnlyHorizons = vars.datasetVersion.horizons;
  const inventedAggregates = ["max_return", "max_drawdown", "is_breakout", "days_to_breakout"].flatMap((kind) =>
    pathHorizons
      .filter((h) => !outcomeOnlyHorizons.includes(h))
      .filter((h) => vars.outcomes.includes(`${kind}_${h}d`))
      .map((h) => `${kind}_${h}d`),
  );
  check(
    "聚合类结果变量**没有**为 outcome 未覆盖的视界发明（不虚构）",
    inventedAggregates.length === 0,
    inventedAggregates,
  );
  check(
    "聚合类结果变量在 outcome 覆盖的视界上确实存在",
    outcomeOnlyHorizons.every((h) => vars.outcomes.includes(`max_return_${h}d`)),
    outcomeOnlyHorizons,
  );

  check("dimensions 含 year/month/quarter/board/market/industry", ["year", "month", "quarter", "board", "market", "industry"].every((d) => vars.dimensions.includes(d)), vars.dimensions);
  check(
    "unavailableDimensions 显式列出 regime 并给出原因（不是悄悄消失）",
    vars.unavailableDimensions.some((u) => u.key === "regime" && typeof u.reason === "string" && u.reason.length > 0),
    vars.unavailableDimensions,
  );
  check("特征列表按名字稳定排序", JSON.stringify(vars.features) === JSON.stringify([...vars.features].sort()));
  check("结果变量列表按名字稳定排序", JSON.stringify(vars.outcomes) === JSON.stringify([...vars.outcomes].sort()));

  // ---- 2. 结论策略（ConclusionPanel 顶部口径条）----
  section("getConclusionPolicy — 阈值口径");
  const policy = await caller.getConclusionPolicy();
  console.log(`  policy = ${JSON.stringify(policy)}`);
  check("alpha 为有限数", Number.isFinite(policy.alpha));
  check("materialityAbs 为有限数", Number.isFinite(policy.materialityAbs));
  check("minSampleCount 为正整数", Number.isInteger(policy.minSampleCount) && policy.minSampleCount > 0);
  check("stabilityMinConsistentRatio ∈ [0,1]", policy.stabilityMinConsistentRatio >= 0 && policy.stabilityMinConsistentRatio <= 1);
  check("strongSampleMultiple ≥ 1", policy.strongSampleMultiple >= 1);

  // ---- 3. 实验列表（ResearchList 数据源）----
  section("listExperiments — 实验列表");
  const experiments = await caller.listExperiments({});
  console.log(`  实验数 = ${experiments.length}`);
  check("返回数组", Array.isArray(experiments));
  if (experiments.length > 0) {
    const e = experiments[0]!;
    check("每条实验含 id/datasetVersionId/name/status/researchType", typeof e.id === "number" && typeof e.datasetVersionId === "number" && typeof e.name === "string" && typeof e.status === "string" && typeof e.researchType === "string");
  }

  // ---- 4. 不存在的版本必须 NOT_FOUND（而不是返回空目录让页面显示「无变量」）----
  section("错误语义");
  let notFoundCode = "";
  try {
    await caller.listVariables({ datasetVersionId: 999_999_999 });
  } catch (e) {
    notFoundCode = (e as { code?: string }).code ?? "";
  }
  check("不存在的 Dataset Version → NOT_FOUND", notFoundCode === "NOT_FOUND", notFoundCode);

  console.log(`\n${failed === 0 ? "✅ PASS" : "❌ FAIL"} — 检查 ${passed + failed} 项，失败 ${failed} 项`);
  if (failed > 0) {
    console.log("失败项：");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("契约核对异常：", e);
  process.exit(1);
});
