/**
 * STEP 10 — Leakage Protection 基础：决策时点与特征可用性时点的显式时序模型。
 *
 * 每一个 Feature 必须声明：
 *   - requiredDataThrough：该特征完整计算所需数据的最晚时点；
 *   - availableAt：该特征值「可被决策使用」的最早时点。
 *
 * 泄漏铁律：availableAt 或 requiredDataThrough 晚于 decisionTime，即构成未来函数，禁止使用。
 * 本模块只依赖 data 层的 DecisionPoint，不依赖任何策略 / 执行 / 网络 / 数据库。
 */

import type { DecisionPoint } from "../../data";

/** 决策/可用性时点：某个交易日的开盘或收盘时点。 */
export interface DecisionTime {
  /** 交易日（YYYY-MM-DD）。 */
  readonly date: string;
  /** 时点："open"（开盘后）| "close"（收盘后）。 */
  readonly point: DecisionPoint;
}

const POINT_ORDER: Record<DecisionPoint, number> = { open: 0, close: 1 };

/**
 * 比较两个时点：-1 早于 / 0 相等 / 1 晚于。
 * 同一天 open < close；不同日期按字符串日期升序。
 */
export function compareDecisionTime(left: DecisionTime, right: DecisionTime): -1 | 0 | 1 {
  if (left.date < right.date) return -1;
  if (left.date > right.date) return 1;
  const lp = POINT_ORDER[left.point];
  const rp = POINT_ORDER[right.point];
  if (lp < rp) return -1;
  if (lp > rp) return 1;
  return 0;
}

/** 特征可用性声明（泄漏保护必需）。 */
export interface FeatureAvailability {
  /** 特征完整计算所需数据的最晚时点。 */
  readonly requiredDataThrough: DecisionTime;
  /** 特征值可被决策使用的最早时点。 */
  readonly availableAt: DecisionTime;
}

/** 未来函数 / 前视错误。 */
export class LookAheadError extends Error {
  readonly code: "LOOK_AHEAD";
  readonly featureId: string;
  readonly decisionTime: DecisionTime;
  readonly violation: "availableAt" | "requiredDataThrough";

  constructor(featureId: string, decisionTime: DecisionTime, violation: "availableAt" | "requiredDataThrough", violatedAt: DecisionTime) {
    super(
      `特征 ${featureId} 存在未来函数：${violation} ${violatedAt.date}:${violatedAt.point} 晚于决策时点 ${decisionTime.date}:${decisionTime.point}`,
    );
    this.name = "LookAheadError";
    this.code = "LOOK_AHEAD";
    this.featureId = featureId;
    this.decisionTime = decisionTime;
    this.violation = violation;
  }
}

/** 泄漏守卫：在特征参与计算前校验其可用性时点不晚于决策时点。 */
export const LeakageGuard = {
  /** 若 availableAt 或 requiredDataThrough 晚于 decisionTime，抛 LookAheadError。 */
  assertNoLookAhead(featureId: string, availability: FeatureAvailability, decisionTime: DecisionTime): void {
    if (compareDecisionTime(availability.availableAt, decisionTime) > 0) {
      throw new LookAheadError(featureId, decisionTime, "availableAt", availability.availableAt);
    }
    if (compareDecisionTime(availability.requiredDataThrough, decisionTime) > 0) {
      throw new LookAheadError(featureId, decisionTime, "requiredDataThrough", availability.requiredDataThrough);
    }
  },
};
