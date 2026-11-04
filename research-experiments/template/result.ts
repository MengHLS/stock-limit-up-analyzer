/**
 * 模板实验 · 结果结构定义与组装（与 `experiment.ts` 搭档）。
 *
 * | 文件 | 回答的问题 |
 * | --- | --- |
 * | `experiment.ts` | 研究什么、怎么算（元数据 + 取数 + 计算） |
 * | `result.ts` | 结果长什么样（自有 schema + 表格 / 统计 / 图表怎么组装） |
 *
 * 🔴 `customPayloadSchema` 与它的组装函数**必须放在同一文件**：
 * 口径与产物放在一起，schema 就不可能和真实产物漂移。
 */

import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";

/**
 * 计算口径版本 —— 改任何一处计算都要升它。
 * 它同时进 `descriptor.version` 与 `customPayload.computationVersion`（后者是 `z.literal`），
 * 只改一处 ⇒ `resultSchema` 立刻校验失败。
 */
export const COMPUTATION_VERSION = "1.0.0";

/** 剔除原因闭集（键 = 机器可读码，值 = 人读说明；会随结果下发，供页面翻译）。 */
export const EXCLUSION_REASON_LABELS = {
  SAMPLE_LIMIT: "超出 sampleLimit 上限（本次未纳入统计）",
} as const;

export type ExclusionReasonCode = keyof typeof EXCLUSION_REASON_LABELS;

/** 一个分组。 */
export interface GroupCount {
  key: string;
  count: number;
}

/** 本实验自有结果结构。 */
export const templateCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  groupBy: z.string().min(1),
  exclusionReasonLabels: z.record(z.string(), z.string()),
  groups: z.array(z.object({ key: z.string(), count: z.number().int().nonnegative() })),
});

export type TemplateCustomPayload = z.infer<typeof templateCustomPayloadSchema>;

/** 组装最终结果（表格 / 统计 / 图表 / 自有结构 + 如实样本账）。 */
export function assembleTemplateResult(args: {
  groupBy: string;
  groups: readonly GroupCount[];
  candidateCount: number;
  eligibleCount: number;
  excludedByReason: Record<string, number>;
  usedEventCount: number;
  withPriceCount: number;
  datasetEventCount: number | null;
}): ExperimentResultPayload {
  const {
    groupBy,
    groups,
    candidateCount,
    eligibleCount,
    excludedByReason,
    usedEventCount,
    withPriceCount,
    datasetEventCount,
  } = args;
  const excludedCount = candidateCount - eligibleCount;
  const total = groups.reduce((sum, group) => sum + group.count, 0);

  const customPayload: TemplateCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    groupBy,
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    groups: groups.map((group) => ({ key: group.key, count: group.count })),
  };

  return {
    // 🔴 账必须平：eligible + excluded === candidate，且 Σ excludedByReason === excluded。
    sampleSummary: {
      candidateCount,
      eligibleCount,
      excludedCount,
      excludedByReason,
      notes: [
        `分组维度 = ${groupBy}；分组键按字典序排列（不按数量排序 = 不做隐式评级）。`,
        "样本单位 = 一个首板事件。",
      ],
    },
    tables: [
      {
        key: "group-count",
        title: `按 ${groupBy} 分组的事件数`,
        columns: [
          { key: "key", label: groupBy, align: "LEFT" as const },
          { key: "count", label: "事件数", align: "RIGHT" as const },
          { key: "share", label: "占比", unit: "%", digits: 2, align: "RIGHT" as const },
        ],
        rows: groups.map((group) => ({
          key: group.key,
          count: group.count,
          share: total === 0 ? null : (group.count / total) * 100,
        })),
      },
    ],
    statistics: [
      {
        code: "candidate_event_count",
        label: "候选事件数",
        value: candidateCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "used_event_count",
        label: "本次纳入统计的事件数",
        value: usedEventCount,
        unit: "个",
        digits: 0,
        sampleCount: usedEventCount,
      },
      {
        code: "group_count",
        label: "分组数",
        value: groups.length,
        unit: "个",
        digits: 0,
      },
      {
        code: "with_event_day_close_count",
        label: "有首板日收盘价的事件数",
        value: withPriceCount,
        unit: "个",
        digits: 0,
        note: datasetEventCount === null ? "数据集未声明总事件数" : `数据集声明事件数 ${datasetEventCount}`,
      },
    ],
    charts: [
      {
        key: "group-count",
        title: `按 ${groupBy} 分组的事件数`,
        kind: "BAR" as const,
        xLabel: groupBy,
        yLabel: "事件数",
        series: [
          {
            key: "group-count",
            label: "事件数",
            points: groups.map((group) => ({ x: group.key, y: group.count })),
          },
        ],
      },
    ],
    customPayload,
  };
}
