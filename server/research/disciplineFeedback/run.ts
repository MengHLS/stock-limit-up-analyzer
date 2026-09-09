/**
 * STEP 24 / C-24.2 — 纪律反馈分析主编排（buildDisciplineFeedbackRun）。
 *
 * 职责：把四类聚合（①违规原因 / ②重复错误 / ③执行质量排序 / ④易错环境）装配为一份
 * DisciplineFeedbackRun 不可变记录：输入账本指纹 + 汇总计数 + 覆盖区间 + 四类报告 +
 * 机器可读模式清单 + 描述性结论（stable/patternsFound/inconclusive + reasonCode）。
 *
 * 诚实边界：
 *   - 只消费已落账事实；draft（annotation=null）不入违规/原因统计（单列 count）；
 *   - 空账本 / 全 draft / 单 entry / 覆盖不完整 → 显式 inconclusive + reasonCode；
 *   - 模式清单只列「候选模式」（重复 / 高密度环境 / 最差执行候选），全部描述性供人审，
 *     不下处方式「必须改什么」结论；
 *   - 环境标签由调用方注入，本模块不自行计算 regime。
 *
 * 铁律：纯函数、readonly、无 IO；时间戳/runId 注入；指纹 = canonical sha256（除自身外全字段）。
 */

import type { TradeJournalEntry } from "../tradeJournal/types";
import type { JournalEnvironmentAssignment } from "./types";
import { DFA_ENV_UNLABELED_KEY } from "./types";
import { DISCIPLINE_FEEDBACK_RUN_KIND, DISCIPLINE_FEEDBACK_RUN_RECORD_VERSION } from "./types";
import type {
  BuildDisciplineFeedbackRunInput,
  DisciplineFeedbackConclusion,
  DisciplineFeedbackPattern,
  DisciplineFeedbackRun,
  DisciplineFeedbackSummary,
} from "./types";
import { DFA_REASON_CODES } from "./types";
import { DFA_ERROR_CODES, DisciplineFeedbackError } from "./errors";
import { assertFiniteRecord, resolveFeedbackEntries, sha256Digest } from "./common";
import { normalizeJournalEnvironmentAssignments } from "./environments";
import { aggregateViolationCauses } from "./causes";
import { detectRepeatMistakes } from "./repeat";
import { rankExecutionQuality } from "./executionQuality";
import { identifyErrorProneEnvironments } from "./environments";

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// ---------------------------------------------------------------------------
// 汇总计数
// ---------------------------------------------------------------------------

function buildSummary(entries: readonly TradeJournalEntry[]): DisciplineFeedbackSummary {
  let annotationCount = 0;
  let violationDeclaredCount = 0;
  const decisionDates: string[] = [];
  for (const entry of entries) {
    decisionDates.push(entry.decisionDate);
    if (entry.annotation === null) continue;
    annotationCount += 1;
    const rv = entry.annotation.ruleViolation;
    if (rv !== null && rv.declared === true) violationDeclaredCount += 1;
  }
  const sortedDates = [...decisionDates].sort();
  return {
    analyzedEntryCount: entries.length,
    unannotatedEntryCount: entries.length - annotationCount,
    annotationCount,
    violationDeclaredCount,
    noViolationDeclaredCount: annotationCount - violationDeclaredCount,
    coverageStartDate: sortedDates[0] ?? null,
    coverageEndDate: sortedDates[sortedDates.length - 1] ?? null,
  };
}

// ---------------------------------------------------------------------------
// 候选模式清单（全部描述性，供 C-25.1 / 人工消费）
// ---------------------------------------------------------------------------

function buildPatterns(
  runParts: {
    summary: DisciplineFeedbackSummary;
    repeatPatterns: readonly { groupKey: string; reasonCode: string; occurrenceCount: number }[];
    environmentRows: readonly {
      environmentKey: string;
      taggedEntryCount: number;
      violationCount: number;
      insufficientSamples: boolean;
    }[];
    executionRankedFirst: readonly {
      strategyKey: string;
      entryCount: number;
      primaryMetricValue: number | null;
    }[];
  }
): readonly DisciplineFeedbackPattern[] {
  const patterns: DisciplineFeedbackPattern[] = [];

  // ② 同因重复错误（出现次数即证据量）
  for (const pattern of runParts.repeatPatterns) {
    patterns.push({
      kind: "repeatMistake",
      key: `repeatMistake|${pattern.groupKey}`,
      label: `重复错误：${pattern.reasonCode}（${pattern.groupKey}）`,
      evidenceCount: pattern.occurrenceCount,
      qualifier:
        "同因重复出现的描述性候选（供人工复核），不代表已形成习惯；不下纠正结论。",
    });
  }

  // ④ 高密度易错环境（≥2 笔违规且样本充足；ENV_UNLABELED 不当作「环境发现」）
  for (const row of runParts.environmentRows) {
    if (row.violationCount < 2 || row.insufficientSamples) continue;
    if (row.environmentKey === DFA_ENV_UNLABELED_KEY) continue;
    patterns.push({
      kind: "errorProneEnvironment",
      key: `errorProneEnvironment|${row.environmentKey}`,
      label: `易错环境候选：${row.environmentKey}`,
      evidenceCount: row.violationCount,
      qualifier: `该环境标签下 ${row.violationCount}/${row.taggedEntryCount} 笔声明违规（描述性密度，不做因果推断）。`,
    });
  }

  // ③ 最差执行候选（仅排序首位的 RANKED 组；候选供人审）
  const top = runParts.executionRankedFirst[0];
  if (top !== undefined) {
    patterns.push({
      kind: "worstExecutionCandidate",
      key: `worstExecutionCandidate|${top.strategyKey}`,
      label: `最差执行候选：${top.strategyKey}`,
      evidenceCount: top.entryCount,
      qualifier:
        "按主指标排序居首的执行偏差候选（描述性）；需人工复核是否构成纪律问题，非结论。",
    });
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 结论判定（描述性）
// ---------------------------------------------------------------------------

function buildConclusion(
  parts: {
    summary: DisciplineFeedbackSummary;
    hasRepeatPatterns: boolean;
  }
): DisciplineFeedbackConclusion {
  const { summary, hasRepeatPatterns } = parts;
  const { analyzedEntryCount, annotationCount, violationDeclaredCount } = summary;

  if (analyzedEntryCount === 0) {
    return {
      verdict: "inconclusive",
      reasonCode: DFA_REASON_CODES.NO_ENTRIES,
      reason: "输入账本为空：无任何日志条目可聚合。",
    };
  }
  if (annotationCount === 0) {
    return {
      verdict: "inconclusive",
      reasonCode: DFA_REASON_CODES.NO_ANNOTATIONS,
      reason: "全部为待标注 draft（annotation=null）：无人工标注可做纪律聚合。",
    };
  }
  if (analyzedEntryCount < 2) {
    return {
      verdict: "inconclusive",
      reasonCode: DFA_REASON_CODES.SINGLE_ENTRY,
      reason: "仅 1 笔日志：跨交易聚合与重复/密度判定样本不足。",
    };
  }
  if (hasRepeatPatterns) {
    return {
      verdict: "patternsFound",
      reasonCode: DFA_REASON_CODES.REPEAT_MISTAKES_FOUND,
      reason: "检出同因重复错误候选序列（详见 repeatMistakes.patterns），供人工复核。",
    };
  }
  if (violationDeclaredCount >= 2) {
    return {
      verdict: "patternsFound",
      reasonCode: DFA_REASON_CODES.VIOLATIONS_PRESENT_NO_REPEAT,
      reason: `存在 ${violationDeclaredCount} 笔已声明规则违反但未达同因重复阈值：` +
        "违规原因统计已产出，供人工复核。",
    };
  }
  if (violationDeclaredCount === 1) {
    return {
      verdict: "inconclusive",
      reasonCode: DFA_REASON_CODES.ISOLATED_VIOLATION,
      reason: "仅 1 笔孤立违规声明：不足以判定形成重复模式。",
    };
  }
  // violationDeclaredCount === 0
  if (annotationCount < analyzedEntryCount) {
    return {
      verdict: "inconclusive",
      reasonCode: DFA_REASON_CODES.PARTIAL_ANNOTATION_COVERAGE,
      reason:
        `标注覆盖不完整（${annotationCount}/${analyzedEntryCount} 笔已复盘）：` +
        "纪律评估只能基于已标注子集，暂不下 stable 判定。",
    };
  }
  return {
    verdict: "stable",
    reasonCode: DFA_REASON_CODES.NO_VIOLATIONS_DECLARED,
    reason: `覆盖内 ${analyzedEntryCount} 笔已全部人工复盘且均未声明规则违反。`,
  };
}

// ---------------------------------------------------------------------------
// 主编排
// ---------------------------------------------------------------------------

/** 装配一次纪律反馈分析记录（不可变 + 指纹）。 */
export function buildDisciplineFeedbackRun(
  input: BuildDisciplineFeedbackRunInput
): DisciplineFeedbackRun {
  // ---- 身份与时间戳注入校验 ----
  if (input === null || typeof input !== "object") {
    throw new DisciplineFeedbackError(DFA_ERROR_CODES.INPUT_INVALID, "buildDisciplineFeedbackRun 入参必须是对象");
  }
  if (typeof input.runId !== "string" || input.runId.trim() === "") {
    throw new DisciplineFeedbackError(DFA_ERROR_CODES.RUN_ID_MISSING, "runId 必须是非空注入式字符串");
  }
  if (typeof input.createdAt !== "string" || !ISO_DATETIME_RE.test(input.createdAt)) {
    throw new DisciplineFeedbackError(
      DFA_ERROR_CODES.CREATED_AT_INVALID,
      `createdAt（${String(input.createdAt)}）必须是 ISO-8601 UTC（YYYY-MM-DDTHH:mm:ssZ）`
    );
  }

  // ---- 归并分析集合（latest-per-journal + 校验 + 输入指纹） ----
  const { resolved, rawCount } = resolveFeedbackEntries(input.entries);
  const analyzedEntries = [...resolved]; // 已按 journalId 字典序
  const inputLedgerFingerprint = sha256Digest(analyzedEntries);

  // ---- 四类聚合 ----
  const violationCauses = aggregateViolationCauses(
    analyzedEntries,
    input.options?.violationCauses
  );
  const repeatMistakes = detectRepeatMistakes(analyzedEntries, input.options?.repeatMistakes);
  const executionQuality = rankExecutionQuality(
    analyzedEntries,
    input.options?.executionQuality
  );

  // 环境挂接归一化（记录内保存归一化清单以便复核）+ ④ 聚合
  const journalIds = new Set(analyzedEntries.map((e) => e.journalId));
  const { normalized: environmentAssignments } = normalizeJournalEnvironmentAssignments(
    input.environmentAssignments,
    journalIds
  );
  const errorProneEnvironments = identifyErrorProneEnvironments(
    analyzedEntries,
    input.options?.errorProneEnvironments,
    environmentAssignments
  );

  // ---- 汇总 / 模式清单 / 结论 ----
  const summary = buildSummary(analyzedEntries);
  const patterns = buildPatterns({
    summary,
    repeatPatterns: repeatMistakes.patterns.map((p) => ({
      groupKey: p.groupKey,
      reasonCode: p.reasonCode,
      occurrenceCount: p.occurrenceCount,
    })),
    environmentRows: errorProneEnvironments.rows.map((r) => ({
      environmentKey: r.environmentKey,
      taggedEntryCount: r.taggedEntryCount,
      violationCount: r.violationCount,
      insufficientSamples: r.insufficientSamples,
    })),
    executionRankedFirst: executionQuality.rows
      .filter((r) => r.status === "RANKED")
      .map((r) => ({
        strategyKey: r.strategyKey,
        entryCount: r.entryCount,
        primaryMetricValue: r.primaryMetricValue,
      })),
  });
  const conclusion = buildConclusion({ summary, hasRepeatPatterns: repeatMistakes.patterns.length > 0 });

  // ---- 装配 + 指纹 ----
  const body: Omit<DisciplineFeedbackRun, "fingerprint"> = {
    recordKind: DISCIPLINE_FEEDBACK_RUN_KIND,
    recordVersion: DISCIPLINE_FEEDBACK_RUN_RECORD_VERSION,
    runId: input.runId,
    createdAt: input.createdAt,
    inputLedgerFingerprint,
    rawEntryCount: rawCount,
    summary,
    violationCauses,
    repeatMistakes,
    executionQuality,
    errorProneEnvironments,
    environmentAssignments,
    patterns,
    conclusion,
  };
  assertFiniteRecord(body, "run");
  const fingerprint = sha256Digest(body);
  return { ...body, fingerprint };
}
