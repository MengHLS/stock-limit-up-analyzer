/**
 * RESEARCH-001 — 真实 DB 端到端验证（跑的是 `createDbResearchRepositories()` 本体，不是裸 SQL）。
 *
 * 验证目标（对应指令 §27 验收标准）：
 *   1. 引用完整性：dataset_version 不存在 → 明确失败（零 FK 下的应用层保证）；
 *   2. 10 类实体 CRUD 在真实 TiDB 上可用；
 *   3. 完整领域链路 DatasetVersion → Experiment → (Hypothesis|Run→Analysis→Result)
 *      → Conclusion → Candidate →(软引用)→ StrategyDefinition 可走通；
 *   4. 结构化列真的落成了结构化列（metricCode / metricValue / sampleCount 可 SQL 直查）；
 *   5. DB 层唯一约束（uq_research_run_experiment_run_no）真的生效（裸 SQL 重复插入应被拒绝）；
 *   6. 关系查询返回正确聚合。
 *
 * 运行：npx tsx scripts/verifyResearchCore.mts
 * 副作用：会在真实库写入并以**逆序清理**自己创建的行（不触碰任何既有数据）。
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { createDbResearchRepositories } from "../server/researchCore/repository/db";
import { RESEARCH_REFERENCE_ERROR } from "../server/researchCore/repository/errors";
import { groupedResults, scalarResult } from "../server/researchCore/results";

const DATASET_VERSION_ID = 390001; // 真实 READY 版本（v1）

let checks = 0;
const failures: string[] = [];
function check(ok: boolean, label: string, detail?: string): void {
  checks++;
  if (!ok) failures.push(`${label}${detail ? " :: " + detail : ""}`);
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
}

/** 递归收集错误链上的所有 message（drizzle 把驱动错误包在 `cause` 里）。 */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  while (cur !== null && cur !== undefined && depth < 6) {
    const msg = (cur as { message?: unknown }).message;
    if (typeof msg === "string") parts.push(msg);
    if (typeof (cur as { sqlMessage?: unknown }).sqlMessage === "string") {
      parts.push(String((cur as { sqlMessage: string }).sqlMessage));
    }
    cur = (cur as { cause?: unknown }).cause;
    depth++;
  }
  return parts.join(" | ");
}

async function main(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const repos = createDbResearchRepositories();

  const created = {
    experimentIds: [] as number[],
    hypothesisIds: [] as number[],
    runIds: [] as number[],
    analysisIds: [] as number[],
    conclusionIds: [] as number[],
    candidateIds: [] as number[],
    artifactIds: [] as number[],
  };

  try {
    // -----------------------------------------------------------------------
    // 1. 引用完整性（dataset_version 是外部表，零 FK 下必须应用层校验）
    // -----------------------------------------------------------------------
    console.log("\n[1] 引用完整性");
    let refErr: unknown = null;
    try {
      await repos.experiments.create({
        datasetVersionId: 99999999,
        name: "should-fail",
        researchType: "FEATURE",
      });
    } catch (e) {
      refErr = e;
    }
    check(
      (refErr as { code?: string })?.code === RESEARCH_REFERENCE_ERROR.DATASET_VERSION_NOT_FOUND,
      "dataset_version 不存在 → DATASET_VERSION_NOT_FOUND",
      String((refErr as Error)?.message ?? refErr),
    );

    // -----------------------------------------------------------------------
    // 2. Experiment
    // -----------------------------------------------------------------------
    console.log("\n[2] Experiment CRUD");
    const exp = await repos.experiments.create({
      datasetVersionId: DATASET_VERSION_ID,
      name: "R001-E2E 首板后换手率与 T+5 收益",
      description: "RESEARCH-001 端到端验证用实验（脚本自动清理）",
      researchType: "CONDITIONAL",
      config: { tags: ["e2e"], parameters: { note: "verifyResearchCore" } },
    });
    created.experimentIds.push(exp.id as number);
    check(exp.id !== undefined && exp.id > 0, "create 返回自增 id", String(exp.id));
    check(exp.status === "DRAFT", "默认 status = DRAFT", String(exp.status));
    check(exp.datasetVersionId === DATASET_VERSION_ID, "datasetVersionId 落库正确");

    const expRead = await repos.experiments.getById(exp.id as number);
    check(expRead?.name === exp.name, "getById 读回名称一致");
    check(
      (expRead?.config as { tags?: string[] })?.tags?.[0] === "e2e",
      "configJson 往返一致",
      JSON.stringify(expRead?.config),
    );

    const expUpd = await repos.experiments.update(exp.id as number, { status: "READY" });
    check(expUpd.status === "READY", "update status → READY");
    const listed = await repos.experiments.list({ datasetVersionId: DATASET_VERSION_ID });
    check(
      listed.some((e) => e.id === exp.id),
      "list({datasetVersionId}) 命中",
      `共 ${listed.length} 条`,
    );

    // -----------------------------------------------------------------------
    // 3. Hypothesis + Run
    // -----------------------------------------------------------------------
    console.log("\n[3] Hypothesis / Run CRUD");
    const hyp = await repos.hypotheses.create({
      experimentId: exp.id as number,
      name: "换手率区间优势",
      statement: "首板股票换手率 8%~15% 时，未来 5 日收益显著高于其他区间。",
      nullHypothesis: "换手率区间与 T+5 收益无关",
      alternativeHypothesis: "换手率区间与 T+5 收益相关",
    });
    created.hypothesisIds.push(hyp.id as number);
    check(hyp.status === "DRAFT", "Hypothesis 默认 DRAFT");

    const runNo = await repos.runs.nextRunNo(exp.id as number);
    check(runNo === 1, "nextRunNo 首次 = 1", String(runNo));
    const run = await repos.runs.create({
      experimentId: exp.id as number,
      runNo,
      status: "RUNNING",
      config: { analyses: ["QUANTILE"], excludeExtremeRegime: false },
      inputSnapshot: {
        datasetVersionId: DATASET_VERSION_ID,
        datasetCode: "first_limit_pullback",
        datasetVersionLabel: "v1",
        startDate: "2019-01-02",
        snapshotAt: new Date().toISOString(),
      },
      startedAt: new Date().toISOString(),
    });
    created.runIds.push(run.id as number);
    check(run.runNo === 1, "Run runNo = 1 落库");
    const snap = run.inputSnapshot as { datasetCode?: string };
    check(snap?.datasetCode === "first_limit_pullback", "inputSnapshotJson 往返一致", JSON.stringify(snap));

    const runUpd = await repos.runs.update(run.id as number, {
      status: "COMPLETED",
      sampleCount: 512,
      completedAt: new Date().toISOString(),
    });
    check(runUpd.status === "COMPLETED" && runUpd.sampleCount === 512, "Run 完成态 + sampleCount 落库");

    // 唯一约束（DB 层，非应用层）：裸 SQL 重复插入必须被拒绝
    let dupErr: unknown = null;
    try {
      await db.execute(sql`
        INSERT INTO research_run (experimentId, runNo, status) VALUES (${exp.id}, ${runNo}, 'PENDING')`);
    } catch (e) {
      dupErr = e;
    }
    check(
      dupErr !== null &&
        /Duplicate entry|uq_research_run_experiment_run_no/i.test(errorText(dupErr)),
      "DB 层 uq_research_run_experiment_run_no 生效（裸 SQL 重复插入被拒）",
      dupErr === null ? "(未报错)" : errorText(dupErr).slice(0, 200),
    );

    // -----------------------------------------------------------------------
    // 4. Analysis + Condition + Metric + Result
    // -----------------------------------------------------------------------
    console.log("\n[4] Analysis / Condition / Metric / Result CRUD");
    const analysis = await repos.analyses.create({
      runId: run.id as number,
      analysisType: "QUANTILE",
      name: "换手率分位收益",
      target: "return_5d",
      config: { quantileGroups: 10, horizons: [5], dimensionKey: "quantile" },
    });
    created.analysisIds.push(analysis.id as number);
    check(analysis.status === "PENDING", "Analysis 默认 PENDING");
    check((analysis.config as { quantileGroups?: number })?.quantileGroups === 10, "Analysis configJson 往返一致");

    const condRows = await repos.conditions.replaceForAnalysis(analysis.id as number, [
      { groupNo: 0, sortOrder: 0, fieldName: "market_strength", operator: ">", value: 0.6, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 0, sortOrder: 1, fieldName: "turnover", operator: ">=", value: 8, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 0, sortOrder: 2, fieldName: "turnover", operator: "<=", value: 15, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 1, sortOrder: 0, fieldName: "amount", operator: ">", value: 500_000_000, logicalOperator: "AND", groupLogicalOperator: "AND" },
    ]);
    check(condRows.length === 4, "Condition 批量写入 4 行", String(condRows.length));
    const condList = await repos.conditions.listByAnalysis(analysis.id as number);
    check(
      condList.map((c) => c.fieldName).join(",") === "market_strength,turnover,turnover,amount",
      "Condition 读回顺序 = (groupNo, sortOrder)",
      condList.map((c) => c.fieldName).join(","),
    );
    check(condList[1].value === 8 && condList[3].value === 500_000_000, "valueJson 往返一致（数值保型）");

    const metric = await repos.metrics.create({
      analysisId: analysis.id as number,
      metricCode: "MEAN_RETURN",
      metricName: "平均收益",
      displayOrder: 0,
    });
    check(metric.metricCode === "MEAN_RETURN", "Metric 定义落库");

    let metricDupErr: unknown = null;
    try {
      await repos.metrics.create({
        analysisId: analysis.id as number,
        metricCode: "MEAN_RETURN",
        metricName: "dup",
        displayOrder: 1,
      });
    } catch (e) {
      metricDupErr = e;
    }
    check(metricDupErr !== null, "Metric 重复定义被拒（(analysisId, metricCode) 唯一）");

    const resultRows = await repos.results.createMany([
      scalarResult({ analysisId: analysis.id as number, metricCode: "MEAN_RETURN", metricValue: 0.0283, sampleCount: 512 }),
      ...groupedResults({
        analysisId: analysis.id as number,
        metricCode: "MEAN_RETURN",
        dimensionKey: "quantile",
        groups: [
          { label: 1, metricValue: 0.012, sampleCount: 50 },
          { label: 4, metricValue: 0.041, sampleCount: 48 },
          { label: 5, metricValue: 0.038, sampleCount: 51 },
          { label: 6, metricValue: 0.045, sampleCount: 47 },
          { label: 10, metricValue: 0.056, sampleCount: 49 },
        ],
      }),
    ]);
    check(resultRows.length === 6, "Result 批量写入 6 行（1 单值 + 5 分组）", String(resultRows.length));

    // 结构化列实查（不是 JSON 一把梭）
    const rawResults = await db.execute(sql`
      SELECT resultType, metricCode, metricValue, sampleCount, dimensionJson
        FROM research_result WHERE analysisId = ${analysis.id}
        ORDER BY id`);
    const rows = rawResults[0] as unknown as Array<{
      resultType: string;
      metricCode: string;
      metricValue: number | null;
      sampleCount: number | null;
      dimensionJson: string | null;
    }>;
    check(rows.length === 6, "SQL 直查 research_result 命中 6 行", String(rows.length));
    check(rows[0].resultType === "SCALAR" && rows[0].metricValue !== null, "SCALAR 行 metricValue 结构化非空");
    check(
      rows.every((r) => r.metricCode === "MEAN_RETURN"),
      "metricCode 全部结构化落列（可 WHERE / ORDER BY）",
    );
    check(
      rows.slice(1).every((r) => r.dimensionJson !== null && JSON.parse(r.dimensionJson).quantile !== undefined),
      "分组行 dimensionJson 含 quantile 维度",
      rows[1]?.dimensionJson ?? "(null)",
    );

    await repos.analyses.update(analysis.id as number, {
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
    });

    // -----------------------------------------------------------------------
    // 5. Conclusion → Candidate → 转正
    // -----------------------------------------------------------------------
    console.log("\n[5] Conclusion / Candidate CRUD");
    const conclusion = await repos.conclusions.create({
      experimentId: exp.id as number,
      hypothesisId: hyp.id as number,
      conclusionType: "SUPPORTED",
      title: "换手率 8~15% 存在优势",
      conclusion: "首板股票换手率 8%~15% 时，未来 5 日收益存在显著优势。",
      evidence: [
        { kind: "QUANTILE", quantiles: [4, 5, 6], direction: "POSITIVE" },
        { kind: "YEAR_CONSISTENCY", consistent: true },
      ],
      confidence: 0.72,
      status: "FINAL",
    });
    created.conclusionIds.push(conclusion.id as number);
    check(conclusion.confidence === 0.72, "confidence 落库（主观置信度，非 p-value）");
    check(
      Array.isArray(conclusion.evidence) && (conclusion.evidence as unknown[]).length === 2,
      "evidenceJson 往返一致",
    );

    const candidate = await repos.candidates.create({
      experimentId: exp.id as number,
      conclusionId: conclusion.id as number,
      strategyDefinitionId: null,
      name: "首板换手率 8~15% T+5",
      description: "RESEARCH-001 端到端验证候选",
      entryRule: { event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" },
      filterRule: {
        groups: [
          {
            groupNo: 0,
            groupLogicalOperator: "AND",
            conditions: [
              { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: "BETWEEN", value: [8, 15], logicalOperator: "AND", groupLogicalOperator: "AND" },
            ],
          },
        ],
      },
      exitRule: { holdingDays: 5 },
      parameterSpace: { turnoverLow: { type: "number", min: 5, max: 12, step: 1 } },
    });
    created.candidateIds.push(candidate.id as number);
    check(candidate.strategyDefinitionId === null, "strategyDefinitionId = NULL 合法（未转正）");
    check((candidate.exitRule as { holdingDays?: number })?.holdingDays === 5, "exitRuleJson 往返一致");

    await repos.candidates.update(candidate.id as number, { status: "REVIEW" });
    await repos.candidates.update(candidate.id as number, { status: "ACCEPTED" });
    const converted = await repos.candidates.update(candidate.id as number, {
      status: "CONVERTED",
      strategyDefinitionId: "e2e-research-001-verify",
    });
    check(
      converted.status === "CONVERTED" && converted.strategyDefinitionId === "e2e-research-001-verify",
      "Candidate 转正（软引用 strategies.strategyId）",
    );

    let badTransition = false;
    try {
      await repos.candidates.update(candidate.id as number, { status: "DRAFT" });
    } catch {
      badTransition = true;
    }
    check(badTransition, "非法状态迁移被拒（CONVERTED → DRAFT）");

    // -----------------------------------------------------------------------
    // 6. Artifact
    // -----------------------------------------------------------------------
    console.log("\n[6] Artifact CRUD");
    const artifact = await repos.artifacts.create({
      experimentId: exp.id as number,
      runId: run.id as number,
      artifactType: "REPORT",
      uri: "file:///docs/research/RESEARCH-001-report.md",
      checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      metadata: { note: "e2e artifact" },
    });
    created.artifactIds.push(artifact.id as number);
    check(artifact.storageType === "FILE", "Artifact 默认 storageType = FILE");

    let scopeErr: unknown = null;
    try {
      await repos.artifacts.create({ artifactType: "OTHER", uri: "http://x" });
    } catch (e) {
      scopeErr = e;
    }
    check(
      (scopeErr as { code?: string })?.code === RESEARCH_REFERENCE_ERROR.ARTIFACT_SCOPE_REQUIRED,
      "Artifact 无 experimentId / runId 被拒",
    );

    // -----------------------------------------------------------------------
    // 7. 关系查询
    // -----------------------------------------------------------------------
    console.log("\n[7] 关系查询");
    const withRuns = await repos.relationships.getExperimentWithRuns(exp.id as number);
    check(withRuns?.runs.length === 1, "getExperimentWithRuns 返回 1 个 Run", String(withRuns?.runs.length));

    const runBundle = await repos.relationships.getRunWithAnalyses(run.id as number);
    check(runBundle?.analyses.length === 1, "getRunWithAnalyses 返回 1 个 Analysis");

    const bundle = await repos.relationships.getAnalysisBundle(analysis.id as number);
    check(bundle?.conditions.length === 4, "getAnalysisBundle conditions = 4", String(bundle?.conditions.length));
    check(bundle?.metrics.length === 1, "getAnalysisBundle metrics = 1");
    check(bundle?.results.length === 6, "getAnalysisBundle results = 6", String(bundle?.results.length));

    const conclusions = await repos.relationships.getExperimentConclusions(exp.id as number);
    check(conclusions.length === 1, "getExperimentConclusions = 1");
    const hypConclusions = await repos.relationships.getHypothesisConclusions(hyp.id as number);
    check(hypConclusions.length === 1, "getHypothesisConclusions = 1");
    const cands = await repos.relationships.getCandidatesByExperiment(exp.id as number);
    check(cands.length === 1, "getCandidatesByExperiment = 1");

    // 最终 Experiment 收敛
    await repos.experiments.update(exp.id as number, {
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
      sampleCount: 512,
    });
    await repos.hypotheses.update(hyp.id as number, { status: "SUPPORTED" });
    check(
      (await repos.experiments.getById(exp.id as number))?.status === "COMPLETED",
      "Experiment 最终态 = COMPLETED",
    );
  } finally {
    // -----------------------------------------------------------------------
    // 8. 逆序清理（只删本脚本创建的行）
    // -----------------------------------------------------------------------
    console.log("\n[8] 清理本次创建的数据");
    for (const id of created.artifactIds) await repos.artifacts.delete(id).catch(() => undefined);
    for (const id of created.candidateIds) await repos.candidates.delete(id).catch(() => undefined);
    for (const id of created.conclusionIds) await repos.conclusions.delete(id).catch(() => undefined);
    for (const id of created.analysisIds) {
      await repos.results.deleteByAnalysis(id).catch(() => undefined);
      await repos.conditions.deleteByAnalysis(id).catch(() => undefined);
      const ms = await repos.metrics.listByAnalysis(id).catch(() => []);
      for (const m of ms) if (m.id !== undefined) await repos.metrics.delete(m.id).catch(() => undefined);
      await repos.analyses.delete(id).catch(() => undefined);
    }
    for (const id of created.runIds) await repos.runs.delete(id).catch(() => undefined);
    for (const id of created.hypothesisIds) await repos.hypotheses.delete(id).catch(() => undefined);
    for (const id of created.experimentIds) await repos.experiments.delete(id).catch(() => undefined);

    const leftover = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM research_experiment WHERE name LIKE 'R001-E2E%') AS exp,
        (SELECT COUNT(*) FROM research_hypothesis WHERE name = '换手率区间优势') AS hyp`);
    const l = (leftover[0] as unknown as Array<{ exp: number; hyp: number }>)[0];
    check(Number(l.exp) === 0, "清理后无残留 Experiment", `exp=${l.exp}`);
    check(Number(l.hyp) === 0, "清理后无残留 Hypothesis", `hyp=${l.hyp}`);
  }

  console.log("");
  console.log(`RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} — 检查 ${checks} 项，失败 ${failures.length} 项`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verifyResearchCore 异常：", err);
  process.exit(1);
});
