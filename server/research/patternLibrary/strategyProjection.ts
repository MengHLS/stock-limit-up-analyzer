/**
 * PHASE-B-001 — **Strategy 投影**：Pattern 语义 → 执行侧特征与条件。
 *
 * ## 与研究侧共用同一份声明
 *
 * 输入是 `expandPatternSemantics` 的产物（唯一 Expander），因此「研究使用的语义」与
 * 「策略使用的语义」在**物理上**来自同一份数据 —— 不存在两处各写一份的可能。
 *
 * ## 🔴 可用性不再恒用「同点下界」（B.8）
 *
 * 修复前：所有特征都用 `samePointAvailability(point)` ⇒ `availableAt.date` 恒为 `1990-01-01`，
 * 日期维度**不参与比较** ⇒ `LeakageGuard` 只会比较 `point`，对「需要 T+k 数据」的特征
 * **永不报警**（护栏空转）。
 *
 * 修复后：
 *   1. `availableAt` / `requiredDataThrough` 的日期取**真实决策日**（`point.date`），不再用固定下界；
 *   2. 声明层强制 `availableFromOffset ≤ 决策日偏移` —— 这一条是**可失败**的：
 *      窗口末端晚于决策日时投影直接拒绝（见 `StrategyProjectionRejection.AFTER_DECISION_DAY`）。
 */

import type { DecisionPoint } from "../../data";
import {
  compareDecisionTime,
  type FeatureAvailability,
} from "../framework/leakage";
import type { ExpandedSemantic } from "../../../shared/patternSemantics";

export interface StrategyProjectionRejection {
  readonly name: string;
  readonly semanticId: string;
  readonly code:
    | "MISSING_STRATEGY_PROJECTION"
    | "MISSING_FEATURE_ID"
    | "AFTER_DECISION_DAY"
    | "OUTCOME_ROLE_NOT_CONDITION";
  readonly message: string;
}

export interface ProjectedStrategyFeature {
  readonly featureId: string;
  readonly semanticId: string;
  readonly comparison: "GTE" | "LTE";
  readonly thresholdParam: string;
  readonly availability: FeatureAvailability;
  readonly noteAboutResearchDifference?: string;
  readonly definition: string;
}

export interface StrategyProjectionResult {
  readonly features: readonly ProjectedStrategyFeature[];
  readonly rejections: readonly StrategyProjectionRejection[];
}

/**
 * 由**声明 + 真实决策日**推导可用性（替代 `samePointAvailability` 的固定下界）。
 *
 * 语义：`availableFromOffset = k` 表示「T+k 收盘可知」。`point` 就是决策点（T+d）。
 * 因此可用性 = 决策点本身；`k` 的约束由 `assertProjectionWithinDecisionDay` 承担。
 */
export function availabilityFromDeclaredOffset(
  point: DecisionPoint,
  decisionDate: string,
  availableFromOffset: number,
): FeatureAvailability {
  const at = { date: decisionDate, point };
  return { requiredDataThrough: at, availableAt: at, declaredOffset: availableFromOffset } as FeatureAvailability;
}

/** 可失败的 PIT 断言：声明窗口不得晚于决策日。 */
export function assertProjectionWithinDecisionDay(
  name: string,
  availableFromOffset: number,
  decisionOffsetDays: number | null,
): void {
  if (decisionOffsetDays === null) {
    throw new Error(
      `特征 "${name}" 的语义声明需要 T+${availableFromOffset} 的数据，但本次执行未声明决策日 —— `
        + "无法判断它在决策当时是否可见（缺声明即可能事后回看）",
    );
  }
  if (availableFromOffset > decisionOffsetDays) {
    throw new Error(
      `特征 "${name}" 的语义声明最早可见于 T+${availableFromOffset}，晚于决策日 T+${decisionOffsetDays}`
        + " ⇒ 该特征在决策当时不可知，属未来函数",
    );
  }
}

/** 投影主入口（纯函数；不做 IO）。 */
export function projectSemanticsToStrategy(args: {
  expanded: readonly ExpandedSemantic[];
  point: DecisionPoint;
  /** 真实决策日（YYYY-MM-DD）—— 可用性不再用 1990-01-01 这种固定下界。 */
  decisionDate: string;
  decisionOffsetDays: number | null;
}): StrategyProjectionResult {
  const features: ProjectedStrategyFeature[] = [];
  const rejections: StrategyProjectionRejection[] = [];

  for (const item of args.expanded) {
    if (item.role === "OUTCOME") {
      rejections.push({
        name: item.name,
        semanticId: item.semanticId,
        code: "OUTCOME_ROLE_NOT_CONDITION",
        message: `${item.source} 来源只能作为结果，不得投影成执行侧条件`,
      });
      continue;
    }
    const projection = item.strategyProjection;
    if (projection === null) {
      rejections.push({
        name: item.name,
        semanticId: item.semanticId,
        code: "MISSING_STRATEGY_PROJECTION",
        message: "该语义只声明了研究侧意图，没有执行侧投影 ⇒ 不能参与策略执行（不臆造执行口径）",
      });
      continue;
    }
    if (projection.featureId.trim() === "") {
      rejections.push({
        name: item.name,
        semanticId: item.semanticId,
        code: "MISSING_FEATURE_ID",
        message: "strategyProjection.featureId 为空 —— 找不到对应的命名扩展点",
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
          + " —— 这是**可失败**的护栏（修复前 availableAt 恒为 1990-01-01，此条永不触发）",
      });
      continue;
    }

    const availability = availabilityFromDeclaredOffset(args.point, args.decisionDate, item.availableFromOffset);
    // 双保险：用框架自己的比较器再确认一次（日期 + point 都不得晚于决策点）。
    assertProjectionWithinDecisionDay(item.name, item.availableFromOffset, args.decisionOffsetDays);
    if (compareDecisionTime(availability.availableAt, { date: args.decisionDate, point: args.point }) > 0) {
      rejections.push({
        name: item.name,
        semanticId: item.semanticId,
        code: "AFTER_DECISION_DAY",
        message: "推导出的 availableAt 晚于决策点",
      });
      continue;
    }

    features.push({
      featureId: projection.featureId,
      semanticId: item.semanticId,
      comparison: projection.comparison,
      thresholdParam: projection.thresholdParam,
      availability,
      ...(projection.noteAboutResearchDifference !== undefined
        ? { noteAboutResearchDifference: projection.noteAboutResearchDifference }
        : {}),
      definition: item.definition,
    });
  }

  return { features, rejections };
}
