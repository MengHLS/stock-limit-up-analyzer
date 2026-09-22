/**
 * StrategyDocument 的阈值型退出规则 → 交易模拟可执行退出政策。
 *
 * 只接受当前实现能精确兑现的语义：
 * - STOP_LOSS / TAKE_PROFIT: INTRADAY
 * - TIME_EXIT: ON_CLOSE
 *
 * 带附加 condition 的规则不能压缩成单一阈值，必须走 exitRuleGraph；本层拒绝静默降级。
 */

import type { ExitRuleDefinition } from "../research/strategySchema/definition";
import type { ResearchParameterSet } from "../research/types";
import type { SimulationConfig } from "../research/simulator/types";
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
): ExitPolicy | undefined {
  const enabled = (rules ?? []).filter((rule) => rule.enabled).sort((a, b) => a.priority - b.priority);
  const policy: {
    stopLossRatio: number | null;
    takeProfitRatio: number | null;
    maxHoldingDays: number | null;
  } = {
    stopLossRatio: null,
    takeProfitRatio: null,
    maxHoldingDays: null,
  };

  for (const rule of enabled) {
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

  return policy.stopLossRatio === null &&
    policy.takeProfitRatio === null &&
    policy.maxHoldingDays === null
    ? undefined
    : policy;
}
