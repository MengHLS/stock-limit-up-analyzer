/**
 * REENTRY-001 — 再入场策略（securityCooldownTradingDays / maxEntriesPerMember /
 * maxConcurrentOpenPerCode）的**唯一实现**（纯函数，无 IO，确定性）。
 *
 * 定位：回答「这条候选今天的**新建仓**该不该被拦下」，只依据**已成交事实**：
 *   - 已平仓交易的 `exitTime`（= 卖出成交执行日）；
 *   - 全部交易的 `securityId`（买入次数 = 该身份的历史成交笔数）；
 *   - 当前在仓 securityId（并发上限）。
 *
 * 与退出无关：被阻断的候选仍算当日 desired，不改变候选退出判定（见 plan.ts）。
 *
 * 判定顺序（固定，先命中先返回）：
 *   ① maxConcurrentOpenPerCode → CONCURRENT_CODE_POSITION_LIMIT
 *   ② securityCooldownTradingDays → REENTRY_COOLDOWN_ACTIVE
 *   ③ maxEntriesPerMember → MEMBER_ENTRY_LIMIT_REACHED
 */

import type { ReentryBlockCode, ReentryPolicy } from "./types";
import { panelCodeOf } from "../panelIdentity";

/**
 * 底层证券代码解析 —— 唯一实现在 `research/panelIdentity`（本模块只转出，便于同层引用）。
 */
export { panelCodeOf } from "../panelIdentity";

/** 计算阻断所需的最小成交事实面（与 `Trade` 结构兼容）。 */
export interface ReentryTradeFact {
  readonly securityId: string;
  readonly exitTime: string | null;
  readonly openAtEnd: boolean;
}

export interface ReentryBlockerInput {
  /** 策略声明的再入场策略；undefined / 全 null = 不限制（返回恒 undefined 的 blocker）。 */
  readonly policy: ReentryPolicy | undefined;
  /** 决策日（YYYY-MM-DD）。 */
  readonly decisionDate: string;
  /** 交易日 → 升序序号（运行时交易日历；冷却按**交易日**计数）。 */
  readonly tradingDayIndex: ReadonlyMap<string, number>;
  /** 当前在仓 securityId（引擎传入，确定性顺序无关）。 */
  readonly openSecurityIds: readonly string[];
  /** 全部成交事实（已平仓 + 期末未平仓）。 */
  readonly trades: readonly ReentryTradeFact[];
}

/** 候选身份 → 阻断码；未阻断返回 undefined。 */
export type ReentryBlocker = (securityId: string) => ReentryBlockCode | undefined;

const NO_POLICY_BLOCKER: ReentryBlocker = () => undefined;

function positiveIntOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * 构造当日阻断器。
 *
 * 说明：`openSecurityIds` 采用**保守口径** —— 只要决策时点仍在仓就计入并发，
 * 包括当日已被标记强制退出（其卖出与新建仓同在次一交易日执行，同日换手由冷窗口约束表达）。
 */
export function createReentryBlocker(input: ReentryBlockerInput): ReentryBlocker {
  const policy = input.policy;
  if (policy === undefined || policy === null) return NO_POLICY_BLOCKER;

  const cooldown = positiveIntOrNull(policy.securityCooldownTradingDays);
  const maxEntries = positiveIntOrNull(policy.maxEntriesPerMember);
  const maxOpenPerCode = positiveIntOrNull(policy.maxConcurrentOpenPerCode);
  if (cooldown === null && maxEntries === null && maxOpenPerCode === null) {
    return NO_POLICY_BLOCKER;
  }

  const decisionIndex = input.tradingDayIndex.get(input.decisionDate) ?? null;

  /** 底层代码 → 最近一次卖出成交的交易日序号。 */
  const lastExitIndexByCode = new Map<string, number>();
  /** panelSecurityId → 历史买入（成交）次数。 */
  const entryCountBySecurity = new Map<string, number>();
  for (const trade of input.trades) {
    if (trade.openAtEnd || trade.exitTime === null) continue;
    const exitIndex = input.tradingDayIndex.get(trade.exitTime);
    if (exitIndex !== undefined) {
      const code = panelCodeOf(trade.securityId);
      const previous = lastExitIndexByCode.get(code);
      if (previous === undefined || exitIndex > previous) {
        lastExitIndexByCode.set(code, exitIndex);
      }
    }
  }
  for (const trade of input.trades) {
    entryCountBySecurity.set(
      trade.securityId,
      (entryCountBySecurity.get(trade.securityId) ?? 0) + 1,
    );
  }

  const openCountByCode = new Map<string, number>();
  for (const securityId of input.openSecurityIds) {
    const code = panelCodeOf(securityId);
    openCountByCode.set(code, (openCountByCode.get(code) ?? 0) + 1);
  }

  return (securityId: string): ReentryBlockCode | undefined => {
    const code = panelCodeOf(securityId);
    if (maxOpenPerCode !== null && (openCountByCode.get(code) ?? 0) >= maxOpenPerCode) {
      return "CONCURRENT_CODE_POSITION_LIMIT";
    }
    if (cooldown !== null && decisionIndex !== null) {
      const lastExit = lastExitIndexByCode.get(code);
      if (
        lastExit !== undefined
        && decisionIndex >= lastExit
        && decisionIndex - lastExit <= cooldown
      ) {
        return "REENTRY_COOLDOWN_ACTIVE";
      }
    }
    if (maxEntries !== null && (entryCountBySecurity.get(securityId) ?? 0) >= maxEntries) {
      return "MEMBER_ENTRY_LIMIT_REACHED";
    }
    return undefined;
  };
}
