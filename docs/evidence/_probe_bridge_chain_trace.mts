/**
 * 探针：**单链贯通追踪**（只读，真库）—— 从一条候选出发，把 13 级链路一次走完。
 *
 * 任务 §12 的交付证据：必须能在一张表里看到
 *   dataset_version → research_experiment → research_run → research_analysis → research_result
 *   → research_conclusion → research_strategy_candidate → strategy_research_provenance
 *   → strategies → strategy_versions → strategy_parameters → strategy_entry_rules
 *   → strategy_exit_rules → strategy_execution_rules → strategy_version_datasets
 *
 * 用法：`npx tsx docs/evidence/_probe_bridge_chain_trace.mts [candidateId]`
 *       （缺省 = 最后一条 `CONVERTED` 候选）
 *
 * 🔴 每一跳都必须**由真实列值驱动**（上一跳取到的 id 就是下一跳的 WHERE 条件），
 *    禁止各表各查一遍再「看起来对得上」。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);
const arg = process.argv[2];

const [candRows] = await conn.query(
  arg
    ? "SELECT id FROM research_strategy_candidate WHERE id = ?"
    : "SELECT id FROM research_strategy_candidate WHERE status = 'CONVERTED' ORDER BY id DESC LIMIT 1",
  arg ? [Number(arg)] : [],
);
const candidateId = (candRows as Array<{ id: number }>)[0]?.id;
if (!candidateId) {
  console.log("找不到候选");
  process.exit(1);
}

const lines: string[] = [];
function emit(label: string, value: Record<string, unknown> | null, extra = "") {
  lines.push(`  ${value === null ? "❌ 断链" : "✅"} ${label}: ${value === null ? "（无行）" : JSON.stringify(value)}${extra}`);
}

console.log(`===== 单链贯通追踪 · 起点 candidateId=${candidateId} =====\n`);

// 1) candidate（桥的锚）
const [c] = await conn.query(
  "SELECT id, name, status, experimentId, conclusionId, sourceResearchRunId, sourceDatasetVersionId, "
  + "sourceDatasetDivergenceReason, LENGTH(sourceTraceJson) traceLen, strategyDefinitionId "
  + "FROM research_strategy_candidate WHERE id = ?",
  [candidateId],
);
const cand = (c as Array<Record<string, unknown>>)[0] ?? null;
emit("7. research_strategy_candidate", cand);

// 2) 研究来源：conclusion → experiment → dataset_version
const [cc] = await conn.query(
  "SELECT id, experimentId, conclusionType, title, status, LENGTH(evidenceJson) evidenceLen "
  + "FROM research_conclusion WHERE id = ?",
  [cand?.conclusionId],
);
const concl = (cc as Array<Record<string, unknown>>)[0] ?? null;
emit("6. research_conclusion", concl);

const [ee] = await conn.query(
  "SELECT id, name, status, datasetVersionId FROM research_experiment WHERE id = ?",
  [concl?.experimentId],
);
const exp = (ee as Array<Record<string, unknown>>)[0] ?? null;
emit("2. research_experiment", exp);

const [dd] = await conn.query(
  "SELECT id, datasetId, version, status, startDate, endDate, totalEvents, totalRows FROM dataset_version WHERE id = ?",
  [cand?.sourceDatasetVersionId],
);
emit("1. dataset_version", (dd as Array<Record<string, unknown>>)[0] ?? null);

// 3) run（由候选的 sourceResearchRunId 驱动）
const [rr] = await conn.query(
  "SELECT id, experimentId, runNo, status, sampleCount FROM research_run WHERE id = ?",
  [cand?.sourceResearchRunId],
);
emit("3. research_run", (rr as Array<Record<string, unknown>>)[0] ?? null);

// 4) analysis（该 Run 的分析）+ 结论证据里的主分析
const [aa] = await conn.query(
  "SELECT id, runId, analysisType, name, target, status FROM research_analysis WHERE runId = ? ORDER BY id LIMIT 30",
  [cand?.sourceResearchRunId],
);
const analyses = aa as Array<Record<string, unknown>>;
lines.push(`  ✅ 4. research_analysis: 该 Run 共 ${analyses.length} 条（+ LIMIT 上限），前 3 条：${JSON.stringify(analyses.slice(0, 3))}`);

// 5) result（由 analysis 主键驱动，真外键式下钻）
const analysisIds = analyses.map((a) => Number(a.id));
if (analysisIds.length > 0) {
  const [rsRows] = await conn.query(
    "SELECT analysisId, COUNT(*) n, SUM(sampleCount) samples FROM research_result "
    + "WHERE analysisId IN (?) GROUP BY analysisId ORDER BY analysisId LIMIT 30",
    [analysisIds],
  );
  const rs = rsRows as Array<Record<string, unknown>>;
  lines.push(
    `  ✅ 5. research_result: 覆盖 ${rs.length} 个分析、合计 ${rs.reduce((s, r) => s + Number(r.n), 0)} 行`
    + `（前 3：${JSON.stringify(rs.slice(0, 3))}）`,
  );
}

// 6) provenance（由 strategies 反向驱动 —— 只有 promote 能写）
const strategyId = cand?.strategyDefinitionId == null ? null : String(cand.strategyDefinitionId);
const [pp] = await conn.query(
  "SELECT id, strategyVersionId, strategyId, origin, sourceCandidateId, sourceConclusionId, "
  + "sourceExperimentId, sourceResearchRunId, sourceDatasetVersionId, sourceDatasetLabel "
  + "FROM strategy_research_provenance WHERE strategyId = ?",
  [strategyId],
);
const prov = (pp as Array<Record<string, unknown>>)[0] ?? null;
emit("8. strategy_research_provenance", prov);

// 7) strategies → strategy_versions
const [ss] = await conn.query(
  "SELECT id, strategyId, name, status, latestVersion, currentVersionId FROM strategies WHERE strategyId = ?",
  [strategyId],
);
emit("9. strategies", (ss as Array<Record<string, unknown>>)[0] ?? null);

const [vv] = await conn.query(
  // ⚠️ `strategy_versions` 的主键就叫 `id`（没有 `strategyVersionId` 列）；
  //    投影表里的 `strategyVersionId` 正是指向它 —— 这正是本探针要验证的那一跳。
  "SELECT id, strategyId, version, status, datasetVersionId, datasetVersion, universeId, "
  + "LENGTH(strategyDocumentJson) docLen, fingerprint FROM strategy_versions WHERE id = ?",
  [prov?.strategyVersionId],
);
const ver = (vv as Array<Record<string, unknown>>)[0] ?? null;
emit("10. strategy_versions", ver);

const versionRowId = ver?.id ?? null;
if (versionRowId !== null) {
  // 8) 五张投影（全部由 versionRowId 驱动）
  const tables = [
    "strategy_parameters",
    "strategy_entry_rules",
    "strategy_exit_rules",
    "strategy_execution_rules",
    "strategy_version_datasets",
  ] as const;
  const labels = ["11. strategy_parameters", "12. strategy_entry_rules", "13. strategy_exit_rules", "14. strategy_execution_rules", "15. strategy_version_datasets"];
  for (let i = 0; i < tables.length; i += 1) {
    const t = tables[i];
    const [cnt] = await conn.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE strategyVersionId = ?`, [versionRowId]);
    const n = Number((cnt as Array<{ n: number }>)[0].n);
    lines.push(`  ${n > 0 ? "✅" : "❌ 空"} ${labels[i]}: ${n} 行`);
  }
  // 参数明细（验证 role / 搜索界 / 默认值）
  const [pr] = await conn.query(
    "SELECT code, dataType, parameterRole, defaultValueJson, `minValue`, `maxValue`, stepValue "
    + "FROM strategy_parameters WHERE strategyVersionId = ? ORDER BY ordinal",
    [versionRowId],
  );
  lines.push(`     参数明细：${JSON.stringify(pr)}`);
  // 出场规则明细（验证五种类型中的哪些被用上）
  const [er] = await conn.query(
    "SELECT ruleId, ruleType, triggerType, thresholdValue, thresholdUnit, parameterCode, priority FROM strategy_exit_rules "
    + "WHERE strategyVersionId = ? ORDER BY ordinal",
    [versionRowId],
  );
  lines.push(`     出场规则：${JSON.stringify(er)}`);
  // 入口规则明细
  const [en] = await conn.query(
    "SELECT ruleId, ruleType, eventType, windowStart, windowEnd, windowUnit, triggerType, conditionCount FROM strategy_entry_rules "
    + "WHERE strategyVersionId = ? ORDER BY priority",
    [versionRowId],
  );
  lines.push(`     入场规则：${JSON.stringify(en)}`);
  // 执行规则
  const [ex] = await conn.query(
    "SELECT signalTiming, executionTiming, priceType, quantityMethod, lotSize FROM strategy_execution_rules WHERE strategyVersionId = ?",
    [versionRowId],
  );
  lines.push(`     执行规则：${JSON.stringify(ex)}`);
  // 数据绑定
  const [ds] = await conn.query(
    "SELECT datasetId, datasetVersion, datasetVersionId, role, note FROM strategy_version_datasets WHERE strategyVersionId = ?",
    [versionRowId],
  );
  lines.push(`     数据绑定：${JSON.stringify(ds)}`);
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("❌")).length;
console.log(`\n== ${broken === 0 ? "CHAIN COMPLETE" : `CHAIN BROKEN(${broken})`} ==`);

await conn.end();
process.exit(broken === 0 ? 0 : 1);
