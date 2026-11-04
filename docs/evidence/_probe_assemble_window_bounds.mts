/**
 * 实证：`dateRange` 终点超出「已绑定数据集窗口」时，装配层与下游各给出什么。
 *
 * 判据来源（静态已确认）：
 *   · `assemble.ts:481/496` —— `experimentConfig.dateRange` / `simulationConfig.dateRange`
 *     直接用 `request.startDate/endDate`，**装配层不校验**；
 *   · `assemble.ts:267-277` —— 绑定了 `datasetVersionId` 且直读成功 ⇒ 用直读数据集；
 *   · `datasetFromRegistry.ts:1046-1047` —— 直读产物的窗口取
 *     `version.startDate / version.endDate`（= 数据集**声明**窗口，与用户区间无关）；
 *   · `session.ts:52-57` / `simulator/engine.ts:303-312` —— 两处 FAIL FAST 断言。
 *
 * 本探针跑**两个对照用例**（同一个策略、同一份文档，只改 endDate）：
 *   A. endDate = 2026-09-15（窗口外）⇒ 预期装配成功、`createDatasetSession` 抛错；
 *   B. endDate = 2026-09-01（窗口末）⇒ 预期两者都通过。
 * 从而把「装配层不管、下游才管」这条分界**实测**出来。
 *
 * 只读：不写库、不发外部请求（每次直读 390002 投影约 11 万行，约 11s）。
 * 用法：npx tsx docs/evidence/_probe_assemble_window_bounds.mts [strategyId]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { assembleRunWorkbenchInputs } from "../../server/runWorkbenchAssembly/assemble";
import { createDatasetSession } from "../../server/research/datasetAccess/session";

const RANGE_START = "2025-09-01";
const PROBE_STRATEGY_ID = process.argv[2] ?? "cand-360001";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const res = (await db.execute(sql.raw(
  `select strategyId, version, datasetVersionId, strategyDocumentJson
   from strategy_versions where strategyId = '${PROBE_STRATEGY_ID}' order by id desc limit 1`,
))) as unknown as [Record<string, unknown>[]];
const row = (res[0] ?? [])[0];
if (!row) {
  console.log(`未找到策略 ${PROBE_STRATEGY_ID}`);
  process.exit(1);
}
const doc = JSON.parse(String(row.strategyDocumentJson)) as any;

console.log("=== 实证：装配层是否校验「dateRange ⊆ 数据集窗口」 ===");
console.log(`策略       : ${String(row.strategyId)}@${String(row.version)}`);
console.log(`文档绑定   : datasetVersionId=${String(row.datasetVersionId)}`);
console.log(`观察窗口   : ${JSON.stringify(doc?.definition?.entry?.observationWindow ?? null)}`);

async function runCase(endDate: string): Promise<void> {
  console.log(`\n─── 用例 endDate=${endDate} ───`);
  const t0 = Date.now();
  let assembled: Awaited<ReturnType<typeof assembleRunWorkbenchInputs>>;
  try {
    assembled = await assembleRunWorkbenchInputs({
      strategyId: doc.strategyId,
      strategyVersion: doc.version,
      startDate: RANGE_START,
      endDate,
      createdAt: new Date().toISOString(),
      codeVersion: "probe-window-bounds",
      strategyDocument: doc,
      ...(row.datasetVersionId !== null && row.datasetVersionId !== undefined
        ? { datasetVersionId: Number(row.datasetVersionId) }
        : {}),
    } as any);
  } catch (error) {
    console.log(`装配抛错（${((Date.now() - t0) / 1000).toFixed(1)}s）: ${String((error as Error).message).slice(0, 300)}`);
    return;
  }

  const snap = (assembled.dataset as any)?.dataSnapshot?.request ?? null;
  console.log(`装配结果   : ${((Date.now() - t0) / 1000).toFixed(1)}s  source=${assembled.assembly.datasetSource}  rows=${assembled.assembly.datasetRowCount}`);
  console.log(`直读窗口   : [${snap?.startDate ?? "?"}, ${snap?.endDate ?? "?"}]`);
  console.log(`请求窗口   : [${assembled.assembly.dateRange.startDate}, ${assembled.assembly.dateRange.endDate}]`);

  try {
    createDatasetSession(assembled.dataset, assembled.inputs.experimentConfig);
    console.log("会话层     : ✅ 通过（未越界）");
  } catch (error) {
    console.log(`会话层     : ❌ 抛错 ⇒ ${String((error as Error).message).slice(0, 240)}`);
  }
}

await runCase("2026-09-15");
await runCase("2026-09-01");

console.log("\n=== 完成（只读） ===");
process.exit(0);
