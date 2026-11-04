/**
 * STEP 12.5 — PIT / 反泄漏抽样审计：编排器。
 *
 * 流程：载入真实交易日历 → 确定性抽样（基础桶 + 边界衍生桶）→ 每个样本两腿查询
 * （asOf=tradeDate 的 PIT 口径 + asOf=null 全知口径）→ 朴素预言机 checkers → 汇总报告。
 *
 * gate 语义（与 §0.2 一致，诚实不越级）：
 *   - 存在 FAIL → "FAIL"；
 *   - 无 FAIL 且无样本级错误、且调用方声明 dataReady=true → "PASS"
 *     （dataReady=true 且 A~H 全 DATA_READY 时，报告构成 ROADMAP §45.1 的抽样 PIT 验证证据）；
 *   - 其余 → "INCONCLUSIVE"（数据未就绪 / 库不可用 / 样本级错误，不足以认证）。
 */

import {
  DEFAULT_CORE_INDEX_CODES,
  querySecurityHistoricalState,
} from "../db";
import type { TradingCalendar } from "../../security/tradingCalendar";
import { CHECK_IDS, runSampleChecks } from "./checkers";
import {
  buildBaseSamples,
  deriveBoundarySamples,
  fetchFacts,
  loadAuditTradingCalendar,
} from "./db";
import type { PitAuditFacts } from "./types";
import type { PitAuditOptions, PitAuditSample, PitAuditSummary, PitSampleVerdict } from "./types";

/** 单个样本的运行结果。 */
interface SampleRun {
  sample: PitAuditSample;
  error?: string;
  facts?: PitAuditFacts;
  verdict?: PitSampleVerdict;
}

/** 对单个样本执行两腿查询 + checkers。 */
async function runSample(
  sample: PitAuditSample,
  coreIndexCodes: string[],
  calendar: TradingCalendar,
): Promise<SampleRun> {
  const facts = await fetchFacts(sample, coreIndexCodes);
  if (!facts) {
    return { sample, error: "独立事实不可用（security 不存在或 DB 不可用）" };
  }
  try {
    const pit = await querySecurityHistoricalState(sample.securityId, sample.tradeDate, {
      asOf: sample.asOf,
      calendar,
      coreIndexCodes,
    });
    const full = await querySecurityHistoricalState(sample.securityId, sample.tradeDate, {
      asOf: null,
      calendar,
      coreIndexCodes,
    });
    if (pit === null || full === null) {
      return { sample, facts, error: "查询返回 null（security 不存在或 DB 不可用）" };
    }
    const verdict = runSampleChecks(sample, facts, { pit, full });
    return { sample, facts, verdict };
  } catch (error) {
    return { sample, facts, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 运行一次抽样 PIT / 反泄漏审计（确定性；seed 相同输出相同）。
 */
export async function runPitAudit(options: PitAuditOptions = {}): Promise<PitAuditSummary> {
  const seed = options.seed ?? 20260906;
  const budget = options.budget ?? 24;
  const dataReady = options.dataReady ?? false;
  const coreIndexCodes = options.coreIndexCodes ?? [...DEFAULT_CORE_INDEX_CODES];
  const capturedAt = new Date().toISOString();

  const calendar = await loadAuditTradingCalendar();
  if (calendar === null) {
    return {
      capturedAt,
      options: { seed, budget, coreIndexCodes, calendarName: "n/a", dataReady },
      samplesPlanned: 0,
      samplesQueried: 0,
      sampleErrors: [],
      checks: {},
      failures: [],
      industryPitGuardExercised: 0,
      gate: "INCONCLUSIVE",
    };
  }

  const base = await buildBaseSamples(calendar, { seed, budget });
  const planned = new Map<string, PitAuditSample>(base.map((sample) => [sample.sampleId, sample]));

  const runs: SampleRun[] = [];
  // 第一遍：基础样本（RANDOM_ACTIVE 的独立事实同时用于派生边界样本）。
  const randomFacts = new Map<string, PitAuditFacts>();
  for (const sample of base) {
    const run = await runSample(sample, coreIndexCodes, calendar);
    runs.push(run);
    if (sample.bucket === "RANDOM_ACTIVE" && run.facts !== undefined && run.error === undefined) {
      randomFacts.set(sample.sampleId, run.facts);
    }
  }

  // 派生边界样本：由 RANDOM_ACTIVE 事实派生 CA / 行业 PIT 边界。
  for (const facts of Array.from(randomFacts.values())) {
    for (const derived of deriveBoundarySamples(facts, calendar)) {
      if (planned.has(derived.sampleId)) continue;
      planned.set(derived.sampleId, derived);
      runs.push(await runSample(derived, coreIndexCodes, calendar));
    }
  }

  // 汇总。
  const failures: PitAuditSummary["failures"] = [];
  const checks: Record<string, { pass: number; fail: number }> = {};
  for (const checkId of CHECK_IDS) checks[checkId] = { pass: 0, fail: 0 };
  const sampleErrors: PitAuditSummary["sampleErrors"] = [];
  let samplesQueried = 0;
  let industryPitGuardExercised = 0;

  for (const run of runs) {
    if (run.error !== undefined) {
      sampleErrors.push({ sampleId: run.sample.sampleId, bucket: run.sample.bucket, message: run.error });
      continue;
    }
    if (run.verdict === undefined) continue;
    samplesQueried += 1;
    if (run.verdict.industryPitGuardExercised) industryPitGuardExercised += 1;
    const seen = new Set<string>();
    for (const issue of run.verdict.issues) {
      failures.push(issue);
      seen.add(issue.checkId);
      const entry = checks[issue.checkId];
      if (entry) entry.fail += 1;
    }
  }
  for (const checkId of CHECK_IDS) {
    checks[checkId]!.pass = samplesQueried - checks[checkId]!.fail;
  }

  const hasFail = failures.length > 0;
  const gate: PitAuditSummary["gate"] = hasFail
    ? "FAIL"
    : sampleErrors.length === 0 && samplesQueried > 0 && dataReady
      ? "PASS"
      : "INCONCLUSIVE";

  return {
    capturedAt,
    options: { seed, budget, coreIndexCodes, calendarName: calendar.name, dataReady },
    samplesPlanned: planned.size,
    samplesQueried,
    sampleErrors,
    checks,
    failures,
    industryPitGuardExercised,
    gate,
  };
}
