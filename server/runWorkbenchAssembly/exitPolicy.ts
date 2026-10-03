/**
 * StrategyDocument 的阈值型退出规则 → 交易模拟可执行退出政策。
 *
 * 只接受当前实现能精确兑现的语义：
 * - STOP_LOSS / TAKE_PROFIT: INTRADAY
 * - TRAILING_TAKE_PROFIT: INTRADAY / ON_CLOSE
 * - TIME_EXIT: ON_CLOSE
 *
 * 带附加 condition 的规则不能压缩成单一阈值，必须走 exitRuleGraph；本层拒绝静默降级。
 */

import type { ExitRuleDefinition } from "../research/strategySchema/definition";
import type { ResearchParameterSet } from "../research/types";
import type { SimulationConfig } from "../research/simulator/types";
import type { StrongHoldAfterExtendedExitPolicy } from "../research/trailingPolicy";
import { LoopRunAssemblyError } from "./errors";

type ExitPolicy = NonNullable<SimulationConfig["exitPolicy"]>;

function thresholdOf(rule: ExitRuleDefinition, parameters: ResearchParameterSet): number {
  if (rule.condition !== undefined && rule.condition !== null) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
      `退出规则 ${rule.id ?? rule.type} 带附加 condition，不能降级为简单阈值退出；必须由可执行 exitRuleGraph 表达。`,
    );
  }
  if (rule.parameter !== undefined) {
    const value = parameters[rule.parameter];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new LoopRunAssemblyError(
        "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
        `退出规则 ${rule.id ?? rule.type} 引用参数 "${rule.parameter}"，但运行时没有有效数值。`,
      );
    }
    return value;
  }
  if (typeof rule.threshold !== "number" || !Number.isFinite(rule.threshold)) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
      `退出规则 ${rule.id ?? rule.type} 缺少有限 threshold。`,
    );
  }
  return rule.threshold;
}

function ratioOf(rule: ExitRuleDefinition, parameters: ResearchParameterSet): number {
  const threshold = thresholdOf(rule, parameters);
  if (rule.thresholdUnit === "RATIO") return threshold;
  if (rule.thresholdUnit === "PERCENT") return threshold / 100;
  throw new LoopRunAssemblyError(
    "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
    `退出规则 ${rule.id ?? rule.type} 的比例阈值单位是 ${String(rule.thresholdUnit)}，只支持 RATIO / PERCENT。`,
  );
}

function tradingDaysOf(rule: ExitRuleDefinition, parameters: ResearchParameterSet): number {
  const threshold = thresholdOf(rule, parameters);
  if (rule.thresholdUnit !== "TRADING_DAY" || !Number.isInteger(threshold) || threshold <= 0) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
      `TIME_EXIT 规则 ${rule.id ?? rule.type} 必须使用正整数 TRADING_DAY 阈值。`,
    );
  }
  return threshold;
}

export function mapDeclaredExitPolicy(
  rules: readonly ExitRuleDefinition[] | undefined,
  parameters: ResearchParameterSet,
  strongHold?:
    | {
        readonly atHoldingDays: number;
        readonly minReturnRatio: number;
        readonly requireAboveMa5: boolean;
        readonly requireAboveMa10: boolean;
        readonly extendToHoldingDays: number;
        readonly afterExtendedHold?: StrongHoldAfterExtendedExitPolicy;
        readonly scaleOutRatio?: number | null;
        readonly runnerExitAtHoldingDays?: number | null;
        readonly maxConcurrentRunners?: number | null;
        readonly replacementScoreMargin?: number | null;
      }
    | null,
): ExitPolicy | undefined {
  const enabled = (rules ?? []).filter((rule) => rule.enabled).sort((a, b) => a.priority - b.priority);
  const policy: {
    stopLossRatio: number | null;
    takeProfitRatio: number | null;
    maxHoldingDays: number | null;
    trailingTakeProfitActivationRatio: number | null;
    trailingTakeProfitDrawdownRatio: number | null;
    trailingTakeProfitTrigger: ExitPolicy["trailingTakeProfitTrigger"];
    advancedTrailingPolicy: ExitPolicy["advancedTrailingPolicy"];
    advancedStopPolicy: ExitPolicy["advancedStopPolicy"];
    strongHold: ExitPolicy["strongHold"];
    recoveryPath: ExitPolicy["recoveryPath"];
  } = {
    stopLossRatio: null,
    takeProfitRatio: null,
    maxHoldingDays: null,
    trailingTakeProfitActivationRatio: null,
    trailingTakeProfitDrawdownRatio: null,
    trailingTakeProfitTrigger: null,
    advancedTrailingPolicy: null,
    advancedStopPolicy: null,
    strongHold: null,
    recoveryPath: null,
  };
  let unifiedPolicyApplied = false;
  /**
   * STRATEGY-HOLDING-BRIDGE-001：统一 policy 里的 runnerBridge 必须原样透传，否则语义丢失。
   * 仅在草稿**显式声明**时写出该键 —— 未声明时返回对象形状与既有行为逐字段一致（零回归）。
   */
  let unifiedRunnerBridge: ExitPolicy["runnerBridge"] | undefined;

  for (const rule of enabled) {
    if (rule.policy !== undefined && rule.policy !== null) {
      if (unifiedPolicyApplied) {
        throw new LoopRunAssemblyError(
          "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
          "同一策略存在多条统一 policy 规则，无法无损映射。",
        );
      }
      unifiedPolicyApplied = true;
      const unifiedStop = rule.policy.stop;
      const legacyFixedIntraday =
        unifiedStop.anchor.kind === "FIXED_PERCENT"
        && unifiedStop.confirmation === "INTRADAY"
        && (
          unifiedStop.disasterStopRatio === undefined
          || unifiedStop.disasterStopRatio === null
        )
        && (unifiedStop.escalation === undefined || unifiedStop.escalation === null)
        && (unifiedStop.schedule === undefined || unifiedStop.schedule === null)
        && (unifiedStop.reduction === undefined || unifiedStop.reduction === null)
        && (unifiedStop.contexts === undefined || unifiedStop.contexts === null);
      if (legacyFixedIntraday) {
        policy.stopLossRatio = unifiedStop.anchor.stopRatio;
        policy.advancedStopPolicy = null;
      } else {
        policy.advancedStopPolicy = { ...unifiedStop };
      }
      policy.advancedTrailingPolicy = rule.policy.takeProfit === null
        ? null
        : { ...rule.policy.takeProfit };
      policy.maxHoldingDays = rule.policy.timeExit?.holdingDays ?? null;
      policy.strongHold = rule.policy.strongHold === null
        ? null
        : {
            ...rule.policy.strongHold,
            afterExtendedHold:
              rule.policy.strongHold.afterExtendedHold ?? "TIME_EXIT",
          };
      policy.recoveryPath = rule.policy.recoveryPath ?? null;
      // 只有草稿**显式声明**该键时才透传，避免把「缺省」变成裸 null 而改变既有输出形状。
      if (Object.prototype.hasOwnProperty.call(rule.policy, "runnerBridge")) {
        unifiedRunnerBridge = rule.policy.runnerBridge ?? null;
      }
      continue;
    }
    switch (rule.type) {
      case "STOP_LOSS":
        if (rule.trigger !== "INTRADAY") {
          throw new LoopRunAssemblyError(
            "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
            `STOP_LOSS 当前只支持 INTRADAY，实际 ${rule.trigger}。`,
          );
        }
        if (policy.stopLossRatio !== null) {
          throw new LoopRunAssemblyError(
            "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
            "同一策略存在多条启用的 STOP_LOSS 规则，无法无损映射为单一阈值。",
          );
        }
        policy.stopLossRatio = ratioOf(rule, parameters);
        break;
      case "TAKE_PROFIT":
        if (rule.trigger !== "INTRADAY") {
          throw new LoopRunAssemblyError(
            "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
            `TAKE_PROFIT 当前只支持 INTRADAY，实际 ${rule.trigger}。`,
          );
        }
        if (policy.takeProfitRatio !== null) {
          throw new LoopRunAssemblyError(
            "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
            "同一策略存在多条启用的 TAKE_PROFIT 规则，无法无损映射为单一阈值。",
          );
        }
        policy.takeProfitRatio = ratioOf(rule, parameters);
        break;
      case "TRAILING_TAKE_PROFIT":
        if (
          rule.trailingPolicy !== undefined
          && rule.trailingPolicy !== null
          && rule.trigger !== "ON_CLOSE"
        ) {
          throw new LoopRunAssemblyError(
            "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
            `高级 TRAILING_TAKE_PROFIT 当前只支持 ON_CLOSE，实际 ${rule.trigger}。`,
          );
        }
        if (
          rule.trailingPolicy === undefined
          && rule.trigger !== "ON_CLOSE"
          && rule.trigger !== "INTRADAY"
        ) {
          throw new LoopRunAssemblyError(
            "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
            `TRAILING_TAKE_PROFIT 当前只支持 INTRADAY / ON_CLOSE，实际 ${rule.trigger}。`,
          );
        }
        if (policy.trailingTakeProfitDrawdownRatio !== null) {
          throw new LoopRunAssemblyError(
            "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
            "同一策略存在多条启用的 TRAILING_TAKE_PROFIT 规则，无法无损映射为单一阈值。",
          );
        }
        if (rule.trailingPolicy !== undefined && rule.trailingPolicy !== null) {
          policy.advancedTrailingPolicy = { ...rule.trailingPolicy };
          policy.trailingTakeProfitTrigger = "ON_CLOSE";
        } else {
          policy.trailingTakeProfitActivationRatio = 0;
          policy.trailingTakeProfitDrawdownRatio = ratioOf(rule, parameters);
          policy.trailingTakeProfitTrigger =
            rule.trigger as ExitPolicy["trailingTakeProfitTrigger"];
        }
        break;
      case "TIME_EXIT":
        if (rule.trigger !== "ON_CLOSE") {
          throw new LoopRunAssemblyError(
            "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
            `TIME_EXIT 当前只支持 ON_CLOSE，实际 ${rule.trigger}。`,
          );
        }
        if (policy.maxHoldingDays !== null) {
          throw new LoopRunAssemblyError(
            "LOOP_RUN_ASSEMBLY_EXIT_POLICY_UNSUPPORTED",
            "同一策略存在多条启用的 TIME_EXIT 规则，无法无损映射为单一阈值。",
          );
        }
        policy.maxHoldingDays = tradingDaysOf(rule, parameters);
        break;
      case "SIGNAL_EXIT":
      case "FORCED_EXIT":
        break;
      default:
        break;
    }
  }

  if (strongHold !== undefined && strongHold !== null) {
    policy.strongHold = { ...strongHold };
  }

  if (unifiedRunnerBridge !== undefined) {
    (policy as { runnerBridge?: ExitPolicy["runnerBridge"] }).runnerBridge = unifiedRunnerBridge;
  }

  return policy.stopLossRatio === null &&
    policy.takeProfitRatio === null &&
    policy.maxHoldingDays === null &&
    policy.trailingTakeProfitDrawdownRatio === null &&
    policy.advancedTrailingPolicy === null &&
    policy.advancedStopPolicy === null &&
    policy.strongHold === null &&
    policy.recoveryPath === null &&
    unifiedRunnerBridge === undefined
    ? undefined
    : policy;
}



