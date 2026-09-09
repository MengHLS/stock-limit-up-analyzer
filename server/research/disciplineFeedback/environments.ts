/**
 * STEP 24 / C-24.2 — ④ 易错环境识别（identifyErrorProneEnvironments）。
 *
 * 把每笔日志挂接**调用方注入**的 regime/环境标签（本模块不自己算 regime，regime 由
 * C-22.1 等上游经 environmentAssignments 提供），对每个环境标签聚合：
 *   违规密度（违规声明笔数 / 该环境标签交易数）与平均 severity。
 *
 * 诚实边界：
 *   - 环境标签属于「该笔交易发生的环境事实」，跟随 journalId（跨修订稳定）；
 *   - 无环境标签的 entry 显式归入 ENV_UNLABELED 桶（对齐 tradeJournal 显式缺省码哲学），
 *     不编造环境；
 *   - 一笔 entry 可命中多个环境标签 → 计入其命中的每个桶（口径在 note 中声明）；
 *   - 单桶样本 < minSamples → 标 insufficientSamples（仍展示，不隐藏、不强行解读）；
 *   - 本报告为描述性密度排序，不下「环境 X 导致违规」因果结论。
 *
 * 铁律：纯函数、readonly、先排序后输出；assignment 指向未知 journalId / 空键 / 重复挂接
 * → 响亮抛错（FAIL FAST），绝不静默丢弃。
 */

import type { JournalRuleViolationSeverity, TradeJournalEntry } from "../tradeJournal/types";
import type { JournalEnvironmentAssignment } from "./types";
import { DFA_ENV_UNLABELED_KEY } from "./types";
import { DFA_ERROR_CODES, DisciplineFeedbackError } from "./errors";
import type {
  EnvironmentAnalysisConfig,
  EnvironmentAnalysisConfigInput,
  EnvironmentViolationDensityRow,
  ErrorProneEnvironmentReport,
} from "./types";
import { DFA_SEVERITY_INDEX } from "./types";
import { resolveFeedbackEntries, stableMean, stablePercent } from "./common";

/** ④ 默认值（唯一权威来源）。 */
export const DFA_DEFAULT_ENVIRONMENT_MIN_SAMPLES = 3 as const;

/** 解析④ 配置。 */
export function resolveEnvironmentAnalysisConfig(
  config?: EnvironmentAnalysisConfigInput
): EnvironmentAnalysisConfig {
  const minSamples = config?.minSamples ?? DFA_DEFAULT_ENVIRONMENT_MIN_SAMPLES;
  if (!Number.isInteger(minSamples) || minSamples < 1) {
    throw new DisciplineFeedbackError(
      DFA_ERROR_CODES.CONFIG_INVALID,
      `minSamples（${String(minSamples)}）必须是 ≥1 的整数`
    );
  }
  return { minSamples };
}

/** 归一化环境挂接清单（校验 + 去重排序；未知 journalId/空键/重复挂接响亮抛错）。 */
export function normalizeJournalEnvironmentAssignments(
  assignments: readonly JournalEnvironmentAssignment[] | null | undefined,
  journalIds: ReadonlySet<string>
): { readonly normalized: readonly JournalEnvironmentAssignment[]; readonly matchedCount: number } {
  if (assignments === null || assignments === undefined || assignments.length === 0) {
    return { normalized: [], matchedCount: 0 };
  }
  const map = new Map<string, string[]>();
  for (const assignment of assignments) {
    if (assignment === null || typeof assignment !== "object") {
      throw new DisciplineFeedbackError(
        DFA_ERROR_CODES.ASSIGNMENT_INVALID,
        "environmentAssignments 元素必须是对象"
      );
    }
    if (typeof assignment.journalId !== "string" || assignment.journalId.trim() === "") {
      throw new DisciplineFeedbackError(
        DFA_ERROR_CODES.ASSIGNMENT_INVALID,
        "environmentAssignments：journalId 必须是非空字符串"
      );
    }
    if (!journalIds.has(assignment.journalId)) {
      throw new DisciplineFeedbackError(
        DFA_ERROR_CODES.ASSIGNMENT_UNKNOWN_JOURNAL,
        `environmentAssignments：journalId=${assignment.journalId} 不在分析 entry 集合中（挂接目标必须是被分析的账本日志）`
      );
    }
    if (!Array.isArray(assignment.environmentKeys) || assignment.environmentKeys.length === 0) {
      throw new DisciplineFeedbackError(
        DFA_ERROR_CODES.ASSIGNMENT_INVALID,
        `environmentAssignments[journalId=${assignment.journalId}]：environmentKeys 必须是非空数组`
      );
    }
    const keys = Array.from(new Set(assignment.environmentKeys.map((k) => k.trim())));
    if (keys.some((k) => k === "")) {
      throw new DisciplineFeedbackError(
        DFA_ERROR_CODES.ASSIGNMENT_INVALID,
        `environmentAssignments[journalId=${assignment.journalId}]：environmentKeys 含空白键`
      );
    }
    keys.sort((a, b) => a.localeCompare(b));
    if (map.has(assignment.journalId)) {
      throw new DisciplineFeedbackError(
        DFA_ERROR_CODES.ASSIGNMENT_INVALID,
        `environmentAssignments：journalId=${assignment.journalId} 被重复挂接（同笔交易只允许一条挂接记录）`
      );
    }
    map.set(assignment.journalId, keys);
  }
  const normalized = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([journalId, keys]) => ({ journalId, environmentKeys: keys }));
  return { normalized, matchedCount: normalized.length };
}

/** ④ 易错环境识别（确定性输出）。 */
export function identifyErrorProneEnvironments(
  entries: readonly TradeJournalEntry[],
  config?: EnvironmentAnalysisConfigInput,
  assignments?: readonly JournalEnvironmentAssignment[] | null
): ErrorProneEnvironmentReport {
  const resolvedConfig = resolveEnvironmentAnalysisConfig(config);
  const { resolved } = resolveFeedbackEntries(entries);
  const journalIds = new Set(resolved.map((e) => e.journalId));
  const { map: envByJournal, matchedCount } = (() => {
    const { normalized, matchedCount } = normalizeJournalEnvironmentAssignments(assignments, journalIds);
    const map = new Map<string, readonly string[]>();
    for (const assignment of normalized) map.set(assignment.journalId, assignment.environmentKeys);
    return { map, matchedCount };
  })();

  interface Bucket {
    envKey: string;
    tagged: number;
    violations: number;
    severityValues: number[];
    severityUnassigned: number;
    severityCount: { MINOR: number; MAJOR: number; CRITICAL: number };
  }
  const bucketMap = new Map<string, Bucket>();
  const ensureBucket = (envKey: string): Bucket => {
    const existing = bucketMap.get(envKey);
    if (existing !== undefined) return existing;
    const bucket: Bucket = {
      envKey,
      tagged: 0,
      violations: 0,
      severityValues: [],
      severityUnassigned: 0,
      severityCount: { MINOR: 0, MAJOR: 0, CRITICAL: 0 },
    };
    bucketMap.set(envKey, bucket);
    return bucket;
  };

  let labeledEntryCount = 0;
  let unlabeledEntryCount = 0;
  for (const entry of resolved) {
    const keys = envByJournal.get(entry.journalId);
    if (keys === undefined || keys.length === 0) {
      unlabeledEntryCount += 1;
      const bucket = ensureBucket(DFA_ENV_UNLABELED_KEY);
      bucket.tagged += 1;
      countViolation(entry, bucket);
      continue;
    }
    labeledEntryCount += 1;
    for (const key of keys) {
      const bucket = ensureBucket(key);
      bucket.tagged += 1;
      countViolation(entry, bucket);
    }
  }

  const rows: EnvironmentViolationDensityRow[] = Array.from(bucketMap.values())
    .sort((a, b) => a.envKey.localeCompare(b.envKey))
    .map((bucket) => {
      const density = stablePercent(bucket.violations, bucket.tagged) ?? 0;
      const meanSeverity = stableMean(bucket.severityValues);
      return {
        environmentKey: bucket.envKey,
        taggedEntryCount: bucket.tagged,
        violationCount: bucket.violations,
        violationDensityPct: density,
        meanSeverity,
        severityDistribution: bucket.severityCount,
        severityUnassignedCount: bucket.severityUnassigned,
        insufficientSamples: bucket.tagged < resolvedConfig.minSamples,
      };
    })
    .sort(
      (a, b) =>
        b.violationDensityPct - a.violationDensityPct || a.environmentKey.localeCompare(b.environmentKey)
    );

  const note =
    `环境标签由调用方注入（regime/板块/时段等），本模块不自行计算 regime；` +
    `一笔 entry 命中多个标签时分别计入各桶（violationDensityPct = 违规笔数 / 桶内交易数）；` +
    `无标签 entry 显式归 ${DFA_ENV_UNLABELED_KEY} 不编造环境；单桶样本 < minSamples(${resolvedConfig.minSamples}) ` +
    `标 insufficientSamples 不隐藏。密度为描述性排序，不做因果推断。`;

  return {
    config: resolvedConfig,
    matchedAssignmentCount: matchedCount,
    labeledEntryCount,
    unlabeledEntryCount,
    rows,
    note,
  };
}

/** 把违规统计计入桶（ruleViolation.declared=true 才计；severity null 显式计缺省）。 */
function countViolation(entry: TradeJournalEntry, bucket: {
  violations: number;
  severityValues: number[];
  severityUnassigned: number;
  severityCount: { MINOR: number; MAJOR: number; CRITICAL: number };
}): void {
  const rv = entry.annotation?.ruleViolation ?? null;
  if (rv === null || rv.declared !== true) return;
  bucket.violations += 1;
  if (rv.severity === null) {
    bucket.severityUnassigned += 1;
    return;
  }
  const severity: JournalRuleViolationSeverity = rv.severity;
  bucket.severityValues.push(DFA_SEVERITY_INDEX[severity]);
  bucket.severityCount[severity] += 1;
}
