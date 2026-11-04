/**
 * 只读诊断：留档运行到底用了哪个数据集、以及它是「直读」还是「回落重建」。
 *
 * 用户反馈：数据集不含非主板股票，但成交明细出现 300 / 688。
 * 前一个探针已排除「代码翻译张冠李戴」（每 id 恰一条 primary 行）。
 * 本探针对准**数据集范围**：读 assembly.datasetSourceNote（权威解释）+ dataset_version
 * 的构建板块配置（dataset_build_config_board：空 = 全板块）。
 *
 * 用法：npx tsx docs/evidence/_probe_dataset_board_scope.mts
 * 不写库、不删库。
 */
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  closedLoopBacktestRun,
  datasetBuildConfigBoards,
  datasetBuildConfigs,
  datasetDefinitions,
  datasetVersions,
  strategyVersions,
} from "../../drizzle/schema";

const db = await getDb();
if (!db) {
  console.log("数据库不可用");
  process.exit(1);
}

const rows = await db
  .select({
    id: closedLoopBacktestRun.id,
    runId: closedLoopBacktestRun.runId,
    strategyId: closedLoopBacktestRun.strategyId,
    strategyVersion: closedLoopBacktestRun.strategyVersion,
    datasetVersion: closedLoopBacktestRun.datasetVersion,
    datasetVersionId: closedLoopBacktestRun.datasetVersionId,
    datasetSource: closedLoopBacktestRun.datasetSource,
    recipeId: closedLoopBacktestRun.recipeId,
    resultJson: closedLoopBacktestRun.resultJson,
  })
  .from(closedLoopBacktestRun)
  .orderBy(closedLoopBacktestRun.id);

console.log(`留档行数 = ${rows.length}`);
const allDbvIds = new Set<number>();

for (const row of rows) {
  console.log("\n" + "=".repeat(78));
  console.log(`id=${row.id} strat=${row.strategyId}@${row.strategyVersion}`);
  console.log(
    `recorded: datasetVersion=${row.datasetVersion} datasetVersionId=${row.datasetVersionId} source=${row.datasetSource}`,
  );
  if (row.datasetVersionId !== null) allDbvIds.add(row.datasetVersionId);

  if (row.resultJson === null) continue;
  const parsed = JSON.parse(row.resultJson);
  const asm = parsed.assembly ?? {};
  console.log("\n--- assembly（权威自述） ---");
  for (const k of [
    "datasetVersion",
    "datasetVersionId",
    "datasetSource",
    "datasetSourceNote",
    "datasetRowCount",
    "datasetSecurityCount",
    "datasetGate",
    "recipeId",
    "recipeSource",
  ]) {
    if (k in asm) {
      const v = asm[k];
      console.log(`  ${k} = ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }
  if (asm.selectionSummary !== undefined) {
    console.log("  selectionSummary =", JSON.stringify(asm.selectionSummary).slice(0, 500));
  }
  const dv = asm.datasetVersion;
  if (typeof dv === "string") {
    const numeric = /^\d+$/.test(dv);
    console.log(`  assembly.datasetVersion 是纯数字? ${numeric}`);
  }
}

// --- 查这些 datasetVersionId 在 registry 里的真实身份与板块配置 ---
const ids = Array.from(allDbvIds);
console.log("\n" + "=".repeat(78));
console.log(`留档涉及 datasetVersionId = ${JSON.stringify(ids)}`);

if (ids.length > 0) {
  const vs = await db
    .select()
    .from(datasetVersions)
    .where(inArray(datasetVersions.id, ids));
  console.log(`\ndataset_version 命中 = ${vs.length}`);
  for (const v of vs) {
    const def = (
      await db.select().from(datasetDefinitions).where(eq(datasetDefinitions.id, v.datasetId))
    )[0];
    console.log(
      `\n  id=${v.id} datasetId=${v.datasetId}(${def?.datasetCode ?? "?"}/${def?.name ?? "?"}) version=${v.version} status=${v.status} ${v.startDate}~${v.endDate} totalRows=${v.totalRows} totalEvents=${v.totalEvents}`,
    );
    console.log(`  universeDefinitionJson = ${(v.universeDefinitionJson ?? "null").slice(0, 300)}`);
    console.log(`  filterDefinitionJson = ${(v.filterDefinitionJson ?? "null").slice(0, 300)}`);

    const cfg = (
      await db.select().from(datasetBuildConfigs).where(eq(datasetBuildConfigs.datasetVersionId, v.id))
    )[0];
    if (!cfg) {
      console.log("  dataset_build_config = 无（该版本未登记构建配置）");
    } else {
      console.log(
        `  build_config: excludeSt=${cfg.excludeSt} preWindow=${cfg.preWindowDays} postWindow=${cfg.postWindowDays}`,
      );
      const boards = await db
        .select()
        .from(datasetBuildConfigBoards)
        .where(eq(datasetBuildConfigBoards.configId, cfg.id));
      console.log(
        `  board 过滤 = ${
          boards.length === 0
            ? "空 ⇒ 不过滤（全板块含 unknown）"
            : boards.map(b => b.board).join(",")
        }`,
      );
    }
  }
}

// --- 策略文档里声明的数据集绑定 ---
const strategyKeys = Array.from(
  new Set(rows.map(r => `${r.strategyId}@${r.strategyVersion}`)),
);
console.log("\n" + "=".repeat(78));
console.log(`策略文档 = ${JSON.stringify(strategyKeys)}`);
for (const r of rows) {
  const sv = (
    await db
      .select()
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, r.strategyId))
  ).find(x => `${x.strategyId}@${x.strategyVersion}` === `${r.strategyId}@${r.strategyVersion}`);
  if (!sv) {
    console.log(`  ${r.strategyId}@${r.strategyVersion} → strategy_versions 未命中`);
    continue;
  }
  let doc: any;
  try {
    doc = JSON.parse(sv.strategyDocumentJson);
  } catch {
    console.log(`  ${r.strategyId} 文档解析失败`);
    continue;
  }
  const def = doc.definition ?? {};
  console.log(`\n  ${r.strategyId}@${r.strategyVersion} name=${doc.name}`);
  console.log(`    definition.datasets = ${JSON.stringify(def.datasets ?? null).slice(0, 400)}`);
  console.log(`    definition.universe = ${JSON.stringify(def.universe ?? null).slice(0, 400)}`);
  console.log(
    `    definition.baseInfo/数据集坐标 = ${JSON.stringify(def.baseInfo ?? def.base ?? null).slice(0, 300)}`,
  );
}

process.exit(0);
