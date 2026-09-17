/**
 * 只读探针：STEP B 落点② —— `paramSearchRouter` 是否**真的**跑在策略文档上。
 *
 * 验三件事（都是「不跑就不知道」的）：
 *   1. 🔴 入参齐备（策略身份 + 决策窗口）时，评估标量是否**真的**来自策略评估端口
 *      （`evaluationSource === "strategy-document"`）、参数空间是否**真的**改为文档派生；
 *   2. 全组合数远超上限时，是否**按计划评估数**判据拦住并给出正确出路（而非按全组合误拦 random）；
 *   3. 结果里的标量是否与配置一致（样本数 = budget、参数集真的带文档参数名）。
 *
 * ⚠️ 本探针会调用真实闭环评估（每次数秒）⇒ budget 设小；**不写任何表**。
 * 用法：./node_modules/.bin/tsx docs/evidence/_probe_step_b_param_search_strategy.mts
 */
import "dotenv/config";
import { paramSearchRouter } from "../../server/paramSearchRouter";

const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };
const caller = paramSearchRouter.createCaller({} as never);

const WINDOW = { startDate: "2026-08-22", endDate: "2026-09-01" };

/** 摘要化一次 run 结果（只取判定需要的字段）。 */
function summarizeRun(result: Record<string, unknown>): Record<string, unknown> {
  const run = result as {
    searchRunId?: string;
    sampleCount?: number;
    combinationCount?: number;
    evaluatedSamples?: readonly { parameterSet?: Record<string, unknown>; outcome?: { status?: string; metrics?: unknown; error?: string } }[];
    candidates?: readonly unknown[];
    region?: { verdict?: string };
    evaluationSource?: string;
    evaluationNote?: string;
    effectiveParameterSpace?: { parameters?: readonly { name?: string }[] };
  };
  const samples = run.evaluatedSamples ?? [];
  const firstSucceeded = samples.find(s => s.outcome?.status === "succeeded");
  return {
    searchRunId: run.searchRunId ?? null,
    evaluationSource: run.evaluationSource ?? null,
    evaluationNote: run.evaluationNote ?? null,
    effectiveParameterNames: (run.effectiveParameterSpace?.parameters ?? []).map(p => p.name ?? null),
    sampleCount: run.sampleCount ?? null,
    combinationCount: run.combinationCount ?? null,
    candidateCount: (run.candidates ?? []).length,
    regionVerdict: run.region?.verdict ?? null,
    evaluatedSampleCount: samples.length,
    /** 自描述：样本的结构长什么样（避免我按错误字段名做统计）。 */
    evaluatedSampleKeys: samples.length > 0 ? Object.keys(samples[0] as object) : null,
    firstSampleRaw: samples.length > 0 ? (samples[0] as unknown) : null,
    succeededSampleCount: samples.filter(s => s.outcome?.status === "succeeded").length,
    failedSampleCount: samples.filter(s => s.outcome?.status === "failed").length,
    firstSucceededMetrics: firstSucceeded?.outcome?.metrics ?? null,
    firstFailedError: samples.find(s => s.outcome?.status === "failed")?.outcome?.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// 用例 1：策略评估路径（random + 小 budget）
// ---------------------------------------------------------------------------
{
  const started = Date.now();
  try {
    const result = (await caller.run({
      method: "random",
      seed: 17,
      budget: 2,
      strategyId: "cand-360001",
      strategyVersion: "1.0.0",
      ...WINDOW,
      parameterSpace: { parameters: [] },
      analysis: {},
    } as never)) as unknown as Record<string, unknown>;
    out["strategyPath"] = { ok: true, elapsedMs: Date.now() - started, ...summarizeRun(result) };
  } catch (error) {
    out["strategyPath"] = {
      ok: false,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// 用例 2：全组合 1240 > 策略评估上限 16 ⇒ 必须**按计划评估数**拦
//   （grid ⇒ 计划 = 全组合 ⇒ 拦；并给出「改用 random」的出路）
// ---------------------------------------------------------------------------
{
  try {
    const result = (await caller.run({
      method: "grid",
      strategyId: "cand-360001",
      strategyVersion: "1.0.0",
      ...WINDOW,
      parameterSpace: { parameters: [] },
      analysis: {},
    } as never)) as unknown as Record<string, unknown>;
    out["gridOverLimit"] = { threw: false, ...summarizeRun(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    out["gridOverLimit"] = {
      threw: true,
      message,
      /** 是否点到「策略评估上限 16」与「改用 random」两条关键信息。 */
      mentionsStrategyLimit: message.includes("策略评估上限 16"),
      mentionsRandomWorkaround: message.includes("method=random"),
      mentionsFullCombination: message.includes("参数空间全组合 1240"),
    };
  }
}

// ---------------------------------------------------------------------------
// 用例 3：random 在**同一超限空间**下不应被拦（计划 = min(budget, 全组合) = budget）
//   —— 与用例 1 互为对照（用例 1 已用 random 通过 ⇒ 这里只记录结论）
// ---------------------------------------------------------------------------
{
  const strategyPath = out["strategyPath"] as { ok?: boolean; sampleCount?: number | null } | undefined;
  out["randomNotBlockedByFullCombinationCount"] = {
    passed: strategyPath?.ok === true,
    sampleCountEqualsBudget: strategyPath?.sampleCount === 2,
    note: "用例 1 用 random+budget=2 在 1240 全组合空间上通过 ⇒ 上限判据确实按计划评估数而非全组合数。",
  };
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);
