/**
 * PHASE-B-001 — **Research 投影**：Pattern 语义 → 研究侧观察日变量。
 *
 * ## 职责边界
 *
 * 只做「声明 → `ObservationVariableDefinition`」的**纯投影**：不注册、不执行、不读时钟。
 * 注册由 `ResearchVariableCatalog` 承担（见 `variables.ts` 的 `patternSemantics` 注入点），
 * 计算由既有的 `resolve(observationSources)` 承担 —— **不新增第二套取值实现**。
 *
 * ## 两道可用性闸门（B.6：unknown / invalid 一律 reject）
 *
 * 1. **数据集视界**：`availableFromOffset > postRelativeDayRange.max` ⇒ 该数据集根本没有这些观察日
 *    ⇒ 拒绝（不静默 null）。
 * 2. **决策日**：`availableFromOffset > decisionOffsetDays` ⇒ 在判定日当时还看不到 ⇒ 拒绝。
 *    这是 R1 建立的判定日契约在本阶段的复用（**不另建第三套可用性机制**）。
 */

import type {
  ObservationVariableDefinition,
  ObservationSources,
} from "./variables";
import type { ExpandedSemantic } from "../../shared/patternSemantics";

export interface ResearchProjectionRejection {
  readonly name: string;
  readonly semanticId: string;
  readonly code: "OUT_OF_DATASET_RANGE" | "AFTER_DECISION_DAY" | "OUTCOME_ROLE_NOT_CONDITION";
  readonly message: string;
}

export interface ResearchProjectionResult {
  readonly definitions: readonly ObservationVariableDefinition[];
  readonly rejections: readonly ResearchProjectionRejection[];
}

/** 取窗口内某字段的聚合值（与 Core 观察日变量同一套取值规则：缺值不臆造）。 */
function pickAggregated(
  sources: ObservationSources,
  item: ExpandedSemantic,
): number | null {
  const values: number[] = [];
  for (let d = 1; d <= item.windowDays; d += 1) {
    const bar = sources.postBars.get(d);
    if (bar === undefined) continue;
    const raw = (bar as unknown as Record<string, unknown>)[item.field];
    if (typeof raw === "number" && Number.isFinite(raw)) values.push(raw);
  }
  if (values.length === 0) return null;
  switch (item.aggregation) {
    case "MIN":
      return Math.min(...values);
    case "MAX":
      return Math.max(...values);
    case "SUM":
      return values.reduce((s, v) => s + v, 0);
    case "COUNT":
      return values.length;
    case "AVG":
      return values.reduce((s, v) => s + v, 0) / values.length;
    default:
      // 单点取值（无聚合）：窗口末端那一根
      return values[values.length - 1] ?? null;
  }
}

/**
 * 把展开后的语义投影成研究侧**观察日变量定义**。
 *
 * `decisionOffsetDays` 为 `null` ⇒ 判定日未声明：此时 R1 的护栏会在条件校验期拒绝一切观察日
 * 条件，故这里仍然照常投影（保持投影是纯函数），把「能不能用」留给唯一那道护栏判定。
 */
export function projectSemanticsToResearch(args: {
  expanded: readonly ExpandedSemantic[];
  postRelativeDayRange: { min: number; max: number } | null;
  decisionOffsetDays: number | null;
}): ResearchProjectionResult {
  const definitions: ObservationVariableDefinition[] = [];
  const rejections: ResearchProjectionRejection[] = [];
  const maxPost = args.postRelativeDayRange === null ? 0 : args.postRelativeDayRange.max;

  for (const item of args.expanded) {
    if (item.role === "OUTCOME") {
      rejections.push({
        name: item.name,
        semanticId: item.semanticId,
        code: "OUTCOME_ROLE_NOT_CONDITION",
        message: `${item.source} 来源只能作为结果（目标变量），不得投影成研究条件`,
      });
      continue;
    }
    if (item.availableFromOffset > maxPost) {
      rejections.push({
        name: item.name,
        semanticId: item.semanticId,
        code: "OUT_OF_DATASET_RANGE",
        message: `声明需要 T+${item.availableFromOffset}，而该 Dataset 的 post 只覆盖到 T+${maxPost}`,
      });
      continue;
    }
    if (args.decisionOffsetDays !== null && item.availableFromOffset > args.decisionOffsetDays) {
      rejections.push({
        name: item.name,
        semanticId: item.semanticId,
        code: "AFTER_DECISION_DAY",
        message:
          `声明最早可见于 T+${item.availableFromOffset}，晚于决策日 T+${args.decisionOffsetDays}`
          + " ⇒ 在判定当时看不到，用它当条件是 PIT 违规",
      });
      continue;
    }

    definitions.push({
      name: item.name,
      role: "OBSERVATION",
      label: item.label,
      definition: item.definition,
      availableFromOffset: item.availableFromOffset,
      postRelativeDays: Array.from({ length: item.windowDays }, (_, i) => i + 1),
      resolve: (sources) => pickAggregated(sources, item),
    });
  }

  return { definitions, rejections };
}
