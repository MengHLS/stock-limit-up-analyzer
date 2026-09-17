/**
 * RESEARCH-CHAIN-HEALTH-001 —— 研究链体检（**只读**，STEP 0-3）。
 *
 * 要回答的问题（一句话）：**「这个实验的研究链，断在哪一环？」**
 *
 * 起因：用户实报「分析研究模块过于复杂，导致无法从分析中人工得出结论」——
 * 复杂本身不是病，**看不见断在哪一环**才是。本模块把 7 张表按 `experimentId`
 * 一次数清，并把「空环 / 未终态」显式列成 `gaps`，让用户与 WorkBuddy 都能定位，
 * 不必再去翻数据库或猜「是没跑、还是跑了但全被拒」。
 *
 * ⚠️ 例外登记（本项目唯一一处「不经 Repository 契约的只读聚合」）：
 *   原因：契约没有 count 能力，而体检要跨 7 张表计数；逐表 `list()` 全量再 `.length`
 *   会把 `research_result`（数千行）整表拉进内存。
 *   边界：**只做计数与状态分组，不含任何领域判定** —— 判定一律在
 *   planner / engine / aggregate，本模块不得生长出第二套口径。
 *
 * 零副作用：只读，不写任何行（任意时刻可安全调用）。
 *
 * 锚点列（2026-09-17 实查 information_schema，非推断）：
 *   research_question.experimentId / research_plan.experimentId / research_hypothesis.experimentId
 *   research_run.experimentId / research_analysis.runId / research_result.analysisId
 *   research_finding.experimentId / research_conclusion.experimentId
 *   research_strategy_candidate.experimentId
 */

import { sql } from "drizzle-orm";
import { getDb } from "./db";

/** 研究链七个环节的计数。 */
export interface ResearchChainHealthCounts {
  questions: number;
  plans: number;
  hypotheses: number;
  runs: number;
  analyses: number;
  results: number;
  findings: number;
  conclusions: number;
  candidates: number;
}

export interface ResearchChainExperimentSummary {
  id: number;
  name: string;
  status: string;
  researchType: string;
  datasetVersionId: number;
  sampleCount: number | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ResearchChainLatestRun {
  id: number;
  runNo: number;
  status: string;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ResearchChainHealth {
  experimentId: number;
  /** 实验不存在时为 null（调用方据此提示「实验不存在」，不伪造空链）。 */
  experiment: ResearchChainExperimentSummary | null;
  counts: ResearchChainHealthCounts;
  /** Run 状态分布（如 `{ COMPLETED: 9, FAILED: 1 }`）。 */
  runByStatus: Record<string, number>;
  /** Analysis 状态分布。 */
  analysisByStatus: Record<string, number>;
  /** 最近一次 Run（按 id 降序，含失败原因），无 Run 时为 null。 */
  latestRun: ResearchChainLatestRun | null;
  /** 断环清单（人读；空数组 = 七环齐全且有结果）。 */
  gaps: string[];
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/** 分组计数结果（`[{status, c}]`）→ 字典。 */
function toStatusMap(rows: Array<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const status = String(r["status"] ?? "UNKNOWN");
    out[status] = num(r["c"]);
  }
  return out;
}

/**
 * 体检一个实验的研究链。**只读**，零副作用。
 *
 * `gaps` 的判定只依赖「计数是否为 0」与「是否存在未终态」，不引入新阈值，
 * 因此不会与 planner / engine 的既有判定产生分歧。
 */
export async function describeResearchChainHealth(
  experimentId: number,
): Promise<ResearchChainHealth> {
  const db = await getDb();
  if (!db) {
    throw new Error("数据库不可用：无法体检研究链（getDb() 返回 undefined）。");
  }

  const exec = async (statement: unknown): Promise<Array<Record<string, unknown>>> => {
    const res = await db.execute(statement as never);
    const first = (res as unknown as unknown[])[0];
    return Array.isArray(first) ? (first as Array<Record<string, unknown>>) : [];
  };

  const experimentRows = await exec(sql`
    select id, name, status, researchType, datasetVersionId, sampleCount, createdAt, startedAt, completedAt
    from research_experiment where id = ${experimentId} limit 1`);

  if (experimentRows.length === 0) {
    return {
      experimentId,
      experiment: null,
      counts: {
        questions: 0,
        plans: 0,
        hypotheses: 0,
        runs: 0,
        analyses: 0,
        results: 0,
        findings: 0,
        conclusions: 0,
        candidates: 0,
      },
      runByStatus: {},
      analysisByStatus: {},
      latestRun: null,
      gaps: [`实验 ${experimentId} 不存在（research_experiment 无此行）`],
    };
  }

  const e = experimentRows[0]!;

  const countRows = await exec(sql`
    select
      (select count(*) from research_question where experimentId = ${experimentId}) as questions,
      (select count(*) from research_plan where experimentId = ${experimentId}) as plans,
      (select count(*) from research_hypothesis where experimentId = ${experimentId}) as hypotheses,
      (select count(*) from research_run where experimentId = ${experimentId}) as runs,
      (select count(*) from research_analysis a
         join research_run r on r.id = a.runId
         where r.experimentId = ${experimentId}) as analyses,
      (select count(*) from research_result x
         join research_analysis a on a.id = x.analysisId
         join research_run r on r.id = a.runId
         where r.experimentId = ${experimentId}) as results,
      (select count(*) from research_finding where experimentId = ${experimentId}) as findings,
      (select count(*) from research_conclusion where experimentId = ${experimentId}) as conclusions,
      (select count(*) from research_strategy_candidate where experimentId = ${experimentId}) as candidates`);

  const c = countRows[0] ?? {};
  const counts: ResearchChainHealthCounts = {
    questions: num(c["questions"]),
    plans: num(c["plans"]),
    hypotheses: num(c["hypotheses"]),
    runs: num(c["runs"]),
    analyses: num(c["analyses"]),
    results: num(c["results"]),
    findings: num(c["findings"]),
    conclusions: num(c["conclusions"]),
    candidates: num(c["candidates"]),
  };

  const runByStatus = toStatusMap(
    await exec(sql`select status, count(*) as c from research_run where experimentId = ${experimentId} group by status`),
  );
  const analysisByStatus = toStatusMap(
    await exec(sql`
      select a.status as status, count(*) as c
      from research_analysis a join research_run r on r.id = a.runId
      where r.experimentId = ${experimentId}
      group by a.status`),
  );

  const latestRunRows = await exec(sql`
    select id, runNo, status, createdAt, startedAt, completedAt, errorCode, errorMessage
    from research_run where experimentId = ${experimentId} order by id desc limit 1`);
  const lr = latestRunRows[0];
  const latestRun: ResearchChainLatestRun | null = lr
    ? {
        id: num(lr["id"]),
        runNo: num(lr["runNo"]),
        status: String(lr["status"] ?? "UNKNOWN"),
        createdAt: str(lr["createdAt"]),
        startedAt: str(lr["startedAt"]),
        completedAt: str(lr["completedAt"]),
        errorCode: str(lr["errorCode"]),
        errorMessage: str(lr["errorMessage"]),
      }
    : null;

  // ---- 断环判定（只依赖计数与终态性，不引入新阈值）----
  const gaps: string[] = [];
  const nonTerminalAnalyses =
    (analysisByStatus["PENDING"] ?? 0) + (analysisByStatus["RUNNING"] ?? 0);

  if (counts.questions === 0) gaps.push("① 提问：该实验尚无研究问题（research_question）");
  if (counts.plans === 0) gaps.push("② 计划：尚无研究计划（research_plan）");
  if (counts.hypotheses === 0) gaps.push("③ 假设：尚无假设（research_hypothesis）");
  if (counts.analyses === 0) gaps.push("④ 分析：尚无分析（research_analysis）");
  if (counts.analyses > 0 && counts.results === 0) {
    gaps.push(
      `⑤ 结果：有 ${counts.analyses} 条分析但**零结果行**（research_result）⇒ 从未真正产出结果`,
    );
  }
  if (counts.results > 0 && counts.findings === 0) {
    gaps.push(`⑥ 发现：有 ${counts.results} 行结果但**零 Finding** ⇒ 未识别出可复述的发现`);
  }
  if (counts.findings > 0 && counts.conclusions === 0) {
    gaps.push(`⑦ 结论：有 ${counts.findings} 条发现但零结论（research_conclusion）`);
  }
  if (counts.conclusions > 0 && counts.candidates === 0) {
    gaps.push(`⑧ 候选：有 ${counts.conclusions} 条结论但尚未创建策略候选（research_strategy_candidate）`);
  }
  if (nonTerminalAnalyses > 0) {
    gaps.push(
      `⚠️ 未终态分析 ${nonTerminalAnalyses} 条（PENDING/RUNNING）⇒ 会污染状态计数，` +
        `由 reclaimOrphanResearchWork 收敛（父 Run 终态的为孤儿；父 Run 从未执行的草稿一律保留）`,
    );
  }
  if (latestRun && latestRun.status === "FAILED" && latestRun.errorCode) {
    gaps.push(`⚠️ 最近一次 Run 失败：${latestRun.errorCode} — ${latestRun.errorMessage ?? "（无说明）"}`);
  }

  return {
    experimentId,
    experiment: {
      id: num(e["id"]),
      name: String(e["name"] ?? ""),
      status: String(e["status"] ?? "UNKNOWN"),
      researchType: String(e["researchType"] ?? "UNKNOWN"),
      datasetVersionId: num(e["datasetVersionId"]),
      sampleCount: e["sampleCount"] === null || e["sampleCount"] === undefined ? null : num(e["sampleCount"]),
      createdAt: str(e["createdAt"]),
      startedAt: str(e["startedAt"]),
      completedAt: str(e["completedAt"]),
    },
    counts,
    runByStatus,
    analysisByStatus,
    latestRun,
    gaps,
  };
}
