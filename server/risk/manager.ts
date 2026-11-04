/**
 * Risk Layer — RiskManager（风险决策组合器）。
 *
 * 组合多个 RiskPolicy，形成唯一 Risk Decision Pipeline：
 *   - 所有 Policy 都 APPROVE → APPROVE（approvedQuantity = requestedQuantity）。
 *   - 任一 Policy REJECT → REJECT（approvedQuantity = 0），合并所有违规记录。
 *   - 存在 RESIZE 且无 REJECT → RESIZE，最终数量 = min(requestedQuantity, 所有 RESIZE 上限)，
 *     向下取整到整手；不足一手则 REJECT。
 *
 * 组合器保证「某个 Policy 通过后，另一个 Policy 不会被绕过」：每个 Policy 都独立检查，
 * 最终数量取所有限制的严格最小值。
 */

import type { OrderIntent, RiskContext, RiskDecision, RiskManager, RiskPolicy, RiskViolation } from "./contract";
import type { BacktestConfig } from "../engine/domain";
import { CapacityPolicy, CashPolicy, LotSizePolicy, MaxPositionsPolicy } from "./policies";

/** 组合多个 RiskPolicy 为一个 RiskManager。 */
export function composeRiskManager(policies: readonly RiskPolicy[]): RiskManager {
  const list = [...policies];
  return {
    check(intent: OrderIntent, context: RiskContext): RiskDecision {
      const results: RiskDecision[] = [];
      for (const policy of list) {
        const result = policy.check(intent, context);
        results.push(result);
        // 遇到 REJECT 即可短路（后续 policy 的结果不再改变 REJECT 结论）。
        if (result.kind === "REJECT") break;
      }

      const rejections = results.filter((r) => r.kind === "REJECT");
      if (rejections.length > 0) {
        return {
          kind: "REJECT",
          approvedQuantity: 0,
          requestedQuantity: intent.requestedQuantity,
          violations: collectViolations(results),
        };
      }

      const resizes = results.filter((r) => r.kind === "RESIZE");
      if (resizes.length > 0) {
        const minApproved = Math.min(intent.requestedQuantity, ...resizes.map((r) => r.approvedQuantity));
        const lot = context.cost.lotSize > 0 ? Math.floor(context.cost.lotSize) : 1;
        const finalQuantity = Math.floor(minApproved / lot) * lot;
        if (finalQuantity < lot) {
          return {
            kind: "REJECT",
            approvedQuantity: 0,
            requestedQuantity: intent.requestedQuantity,
            violations: [
              ...collectViolations(results),
              { code: "INSUFFICIENT_LOT", message: `组合限制后不足以成交一手（${lot} 股）`, policy: "risk-manager" },
            ],
          };
        }
        return {
          kind: "RESIZE",
          approvedQuantity: finalQuantity,
          requestedQuantity: intent.requestedQuantity,
          violations: collectViolations(results),
        };
      }

      return { kind: "APPROVE", approvedQuantity: intent.requestedQuantity, requestedQuantity: intent.requestedQuantity, violations: [] };
    },
  };
}

/** 收集所有非 APPROVE 决策的违规记录（保持 Policy 顺序）。 */
function collectViolations(results: readonly RiskDecision[]): RiskViolation[] {
  const out: RiskViolation[] = [];
  for (const r of results) {
    for (const v of r.violations) out.push(v);
  }
  return out;
}

/**
 * 从 BacktestConfig 构建一套与之对齐的默认 RiskManager。
 * 约束集合与 Portfolio 会计兜底一致：整手 → 持仓数（含同 symbol 加仓拦截）→ 容量（maxPositionAmountRatio）→ 资金。
 * 供 runBacktestWithRisk 缺省注入，确保新引擎路径上风险控制统一、默认启用。
 */
export function buildDefaultRiskManager(config: BacktestConfig): RiskManager {
  return composeRiskManager([
    new LotSizePolicy(),
    new MaxPositionsPolicy(config.maxPositions),
    new CapacityPolicy(config.maxPositionAmountRatio),
    new CashPolicy(),
  ]);
}
