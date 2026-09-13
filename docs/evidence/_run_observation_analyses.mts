/**
 * 触发 Run #570001 的**整轮执行**（等价于页面上的「运行引擎」按钮）。
 *
 * 为什么写脚本而不是点页面：本次要在无人值守下拿到 13 条观察日分析的结果，
 * 且必须与 tRPC 路径**走同一个引擎实例构造**（`createDbResearchRepositories` +
 * `RegistryResearchDatasetReader` + `DbDatasetRegistry`），
 * 否则「脚本能跑、页面不能跑」的偏差无人发现。
 *
 * ⚠️ 这是**分钟级**操作：样本装配的主成本在 post 通道（T+1..T+20 全窗口）。
 *    13 条分析共享同一批样本（`unionRequirementOf` 取并集），**只装配一次**。
 *
 * 运行：`npx tsx docs/evidence/_run_observation_analyses.mts`
 */

import dotenv from "dotenv";
dotenv.config();

const RUN_ID = Number(process.env.OBS_RUN_ID ?? 570001);
const EXPERIMENT_ID = Number(process.env.OBS_EXPERIMENT_ID ?? 240002);

const { createDbResearchRepositories } = await import("../../server/researchCore/repository/index.ts");
const { RegistryResearchDatasetReader } = await import("../../server/researchEngine/datasetReader.ts");
const { ResearchEngine } = await import("../../server/researchEngine/engine.ts");
const { DbDatasetRegistry } = await import("../../server/datasetRegistry/db.ts");

const repos = createDbResearchRepositories();
const reader = new RegistryResearchDatasetReader({ registryRepo: new DbDatasetRegistry() });
const engine = new ResearchEngine({ repos, reader });

console.log(`执行 Run #${RUN_ID}（experiment #${EXPERIMENT_ID}）…`);
const t0 = Date.now();
try {
  const result = await engine.run({ experimentId: EXPERIMENT_ID, runId: RUN_ID });
  console.log(`\n✅ 完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(result, null, 2).slice(0, 5000));
} catch (e) {
  console.error(`\n❌ 失败，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.error(e);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
