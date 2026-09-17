/**
 * 只读探针：单独验证 `DbStrategyRepository.getVersion` 能否读到策略文档。
 *
 * 背景：`paramSearchRouter` 的策略评估路径靠它读文档；上一轮探针在 `tsx` 下报
 * `Failed query: select ... from strategy_versions where (...)`，但同一环境里
 * `db.execute(sql\`...\`)` 直连是好的 ⇒ 必须分清是「瞬时连接问题」还是「该函数本身有问题」。
 */
import "dotenv/config";
import { DbStrategyRepository } from "../../server/research/strategyPersistence/db";

const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };

const repo = new DbStrategyRepository();

// 1. getVersion
try {
  const record = await repo.getVersion("cand-360001", "1.0.0");
  out["getVersion"] = {
    ok: true,
    found: record !== undefined && record !== null,
    strategyId: record?.strategy?.strategyId ?? null,
    version: record?.strategy?.version ?? null,
    hasParameters: (record?.strategy?.parameters?.parameters ?? []).length,
    datasetVersionId:
      record?.strategy?.definition?.datasets?.[0]?.datasetVersionId ?? null,
  };
} catch (error) {
  out["getVersion"] = {
    ok: false,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
}

// 2. 对照：listVersions（另一条查询路径）
try {
  const list = await repo.listVersions("cand-360001");
  out["listVersions"] = { ok: true, count: list.length, sample: list[0]?.version ?? null };
} catch (error) {
  out["listVersions"] = {
    ok: false,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);
