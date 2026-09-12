/**
 * 一次性清理：取消残留 RUNNING 作业 + 删除 DATASET-003B 验证脚本遗留的临时版本/定义。
 * 全部走真实 service（级联清物理行 / 作业 / 配置行），不做裸 SQL 删除。
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { datasetDefinitions, datasetVersions } from "../drizzle/schema";
import {
  DatasetRegistryService,
  DbDatasetPhysicalStore,
  DbDatasetRegistry,
  createDefaultPluginRegistry,
} from "../server/datasetRegistry";

const db = await getDb();
if (!db) {
  console.error("数据库不可用");
  process.exit(1);
}

const registry = new DbDatasetRegistry();
const plugins = createDefaultPluginRegistry();
const service = new DatasetRegistryService(registry, {
  plugins,
  physicalStore: new DbDatasetPhysicalStore(),
});

const [def] = await db
  .select()
  .from(datasetDefinitions)
  .where(eq(datasetDefinitions.datasetCode, "first_limit_pullback"));
if (!def) {
  console.error("未找到 first_limit_pullback");
  process.exit(1);
}

const versions = await db.select().from(datasetVersions).where(eq(datasetVersions.datasetId, def.id!));
const temp = versions.filter((v) => v.version.startsWith("vfy003b-"));
console.log(`临时版本 ${temp.length} 个：${temp.map((v) => `${v.id}:${v.version}`).join(", ") || "（无）"}`);

for (const v of temp) {
  // 1) 先取消该版本下所有非终态作业，否则 deleteVersion 会被 VERSION_HAS_RUNNING_JOB 拒绝。
  const jobs = await registry.listJobs(v.id!);
  for (const j of jobs) {
    if (j.status === "RUNNING" || j.status === "PENDING") {
      try {
        await service.cancelJob(j.jobId);
        console.log(`  已取消作业 ${j.jobId}（原状态 ${j.status}）`);
      } catch (e) {
        console.log(`  取消作业 ${j.jobId} 失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  // 2) 删除版本（级联清物理行 / 作业 / 配置行）。
  try {
    const r = await service.deleteVersion(v.id!);
    console.log(
      `  已删除 id=${v.id} version=${v.version} purgedRows=${r.purgedRows} jobsDeleted=${r.jobsDeleted} configsDeleted=${r.configsDeleted}`,
    );
  } catch (e) {
    console.log(`  删除 id=${v.id} 失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

const tmpDefs = await db
  .select()
  .from(datasetDefinitions)
  .where(eq(datasetDefinitions.datasetCode, "vfy003b_tmp_holder"));
for (const d of tmpDefs) {
  const r = await service.deleteDefinition(d.id!);
  console.log(`  已删除临时定义 id=${d.id} configsDeleted=${r.configsDeleted} dropped=${r.droppedTables.length}`);
}

const after = await db.select().from(datasetVersions).where(eq(datasetVersions.datasetId, def.id!));
console.log(`清理后 first_limit_pullback 版本数：${after.length}（${after.map((v) => v.version).join(", ")}）`);
process.exit(0);
