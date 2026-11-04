/**
 * 首板股票池策略 — 池成员身份与逐日面板投影。
 *
 * 与事件窗投影的边界非常明确：
 *   - 事件窗：同一证券的多个首板事件各自形成独立窗口，成员只在该窗口的 rd 区间内成立；
 *   - 池化：首板事件日入池，此后按**日历日**逐日存在，直到成员失效。
 *
 * 本模块是纯函数，不做 IO。调用方负责从 Dataset Registry 拉取事件与行情。
 */

import type { FirstLimitPoolPolicy } from "../strategyCore/types";
import type { FirstLimitPullbackEvent, FirstLimitPullbackRawBar } from "../datasetRegistry/types";
import type { ResearchDatasetRow, UniverseDayResult, UniverseDefinition } from "../researchDataset/types";
import { RegistryDatasetBridgeError } from "./bridgeError";

/** 池成员账面身份（同一证券的多个首板事件必须由 poolMemberId 隔离）。 */
export interface PoolMemberRecord {
  readonly poolMemberId: string;
  readonly eventId: string;
  readonly canonicalSecurityId: string;
  /** 面板内身份：canonical + pool member 事件作用域。 */
  readonly panelSecurityId: string;
  readonly symbol: string;
  readonly admittedAt: string;
  /** 池龄上限对应的最后有效交易日；null = 数据不足以判定。 */
  readonly expiresAt: string | null;
  /** 实际失效日；null = 所有数据均在池龄上限内且未触发失效。 */
  readonly removedAt: string | null;
  readonly removalReason:
    | "AGE_CAP"
    | "SCORE_UNAVAILABLE"
    | "ELIGIBILITY_BROKEN"
    | null;
  readonly admittedRelativeDay: 0;
  readonly stageAtAdmission: "EARLY_OHLC" | "FULL_3F" | "ROLLING_3F";
}

export interface PoolProjection {
  readonly rows: ResearchDatasetRow[];
  readonly members: readonly PoolMemberRecord[];
  readonly universeDefinition: UniverseDefinition;
  readonly stats: {
    readonly memberCount: number;
    readonly maxMembersPerDay: number;
    readonly rowCount: number;
    readonly projectedRelativeDayMax: number;
    readonly candidateCount: number;
  };
}

/**
 * 池成员逐日硬资格判定（仅使用面板行已携带的 PIT 信息）。
 *
 * 这里的 false 表示“成员当天失效”：不再出现在当日 universe，也不再产生新买意图。
 * 评分本身不可用不会立刻移除，而是累计 scoreInvalidationDays 后失效。
 */
function isHardEligibilityBroken(row: ResearchDatasetRow): boolean {
  if (!row.eligible) return true;
  if (row.st === "ST" || row.st === "*ST") return true;
  if (
    row.knowledge.tradability === "UNKNOWN"
    && row.liquidityVolume !== null
    && row.liquidityVolume <= 0
  ) {
    return true;
  }
  return false;
}

function isScoreAvailable(row: ResearchDatasetRow): boolean {
  return (
    row.open !== null
    && row.high !== null
    && row.low !== null
    && row.close !== null
    && row.close > 0
  );
}

export interface PoolMemberBudgets {
  readonly maxMembersPerDay?: number;
  readonly maxPanelRows?: number;
}

/**
 * 池成员面板身份。
 *
 * 不能复用事件窗的 `::event:` 前缀：两者语义不同（事件窗按窗口存在，池成员按入池后逐日存在），
 * 一旦混用，同一证券的池成员与事件窗行会在数据集键域里互相冒充。
 */
export function poolMemberIdOf(eventId: string): string {
  return `pool:${eventId}`;
}

export function poolPanelSecurityId(canonicalSecurityId: string, eventId: string): string {
  return `${canonicalSecurityId}::pool:${eventId}`;
}

/**
 * 投影池化逐日面板。
 *
 * 预算规则（全部响亮失败，绝不裁剪）：
 *   - `poolAgeCapTradingDays` 超过数据可提供的 post 最大相对日 ⇒ `POOL_AGE_CAP_EXCEEDED`；
 *   - 任一交易日成员数超过 `maxMembersPerDay` ⇒ `POOL_MEMBER_BUDGET_EXCEEDED`；
 *   - 总行数超过 `maxPanelRows` ⇒ `POOL_PANEL_ROW_BUDGET_EXCEEDED`；
 *   - 同一 `(tradeDate, panelSecurityId)` 重复 ⇒ `POOL_MEMBER_IDENTITY_NOT_UNIQUE`。
 */
export function buildPoolProjection(input: {
  readonly events: readonly FirstLimitPullbackEvent[];
  readonly prefixBars: readonly FirstLimitPullbackRawBar[];
  readonly postBars: readonly FirstLimitPullbackRawBar[];
  readonly securityIds: ReadonlyMap<string, string>;
  readonly policy: FirstLimitPoolPolicy;
  readonly postMaxRelativeDay: number;
  readonly budgets?: PoolMemberBudgets;
}): PoolProjection {
  const { events, prefixBars, postBars, securityIds, policy, postMaxRelativeDay, budgets } = input;

  if (policy.poolAgeCapTradingDays > postMaxRelativeDay) {
    throw new RegistryDatasetBridgeError(
      "POOL_AGE_CAP_EXCEEDED",
      `池化直读：策略声明池龄上限 ${policy.poolAgeCapTradingDays} 个交易日，` +
        `但数据集 post 最大相对日仅 ${postMaxRelativeDay}（还需覆盖最后一日的次日执行行情）。` +
        `不静默夹取池龄、不静默改用事件窗投影。`,
    );
  }

  const prefixByEvent = new Map<string, Map<number, FirstLimitPullbackRawBar>>();
  for (const bar of prefixBars) {
    let map = prefixByEvent.get(bar.eventId);
    if (map === undefined) {
      map = new Map();
      prefixByEvent.set(bar.eventId, map);
    }
    map.set(bar.relativeDay, bar);
  }
  const postByEvent = new Map<string, Map<number, FirstLimitPullbackRawBar>>();
  for (const bar of postBars) {
    let map = postByEvent.get(bar.eventId);
    if (map === undefined) {
      map = new Map();
      postByEvent.set(bar.eventId, map);
    }
    map.set(bar.relativeDay, bar);
  }

  const members: PoolMemberRecord[] = [];
  const rows: ResearchDatasetRow[] = [];
  const seenRowKeys = new Set<string>();
  const membersByDate = new Map<string, Set<string>>();
  let candidateCount = 0;
  let projectedRelativeDayMax = 0;

  /** 决策日最后一根：rd = cap-1；其后一根 rd=cap 仅用于执行，不进入决策 universe。 */
  const decisionMaxRelativeDay = Math.min(policy.poolAgeCapTradingDays - 1, postMaxRelativeDay);
  const rowMaxRelativeDay = Math.min(policy.poolAgeCapTradingDays, postMaxRelativeDay);

  for (const event of events) {
    const canonicalSecurityId = securityIds.get(event.eventId);
    if (canonicalSecurityId === undefined) {
      throw new RegistryDatasetBridgeError(
        "REGISTRY_SECURITY_IDENTITY_UNRESOLVED",
        `池化直读：事件 ${event.eventId} 未提供 canonical securityId（调用方必须先跑 resolveSecurityIdsByEvent）。`,
      );
    }

    const memberId = poolMemberIdOf(event.eventId);
    const panelSecurityId = poolPanelSecurityId(canonicalSecurityId, event.eventId);
    const prefix = prefixByEvent.get(event.eventId) ?? new Map();
    const post = postByEvent.get(event.eventId) ?? new Map();
    const barsByRelativeDay = new Map<number, FirstLimitPullbackRawBar>();
    for (const [rd, bar] of prefix) barsByRelativeDay.set(rd, bar);
    for (const [rd, bar] of post) barsByRelativeDay.set(rd, bar);

    const sortedBars = [...barsByRelativeDay.entries()]
      .filter(([relativeDay]) => relativeDay >= 0 && relativeDay <= rowMaxRelativeDay)
      .sort((a, b) => a[0] - b[0]);
    const dtCandidates = sortedBars
      .filter(([relativeDay]) => relativeDay <= decisionMaxRelativeDay)
      .map(([, bar]) => bar.tradeDate);
    const expiresAt = dtCandidates.length > 0 ? dtCandidates[dtCandidates.length - 1]! : null;
    let removalReason: PoolMemberRecord["removalReason"] = null;
    let removedAt: string | null = null;
    let unavailableStreak = 0;

    for (const [relativeDay, bar] of sortedBars) {
      const isExecutionOnly = relativeDay > decisionMaxRelativeDay;
      const isAgeCapDay = relativeDay === decisionMaxRelativeDay;
      const previousClose =
        relativeDay === 0
          ? (event.previousClose ?? null)
          : (() => {
              const previous = barsByRelativeDay.get(relativeDay - 1);
              return previous?.close ?? null;
            })();

      const row: ResearchDatasetRow = {
        tradeDate: bar.tradeDate,
        asOf: bar.tradeDate,
        securityId: panelSecurityId,
        code: event.symbol,
        securityType: "UNKNOWN",
        exchange: exchangeFromSymbol(event.symbol),
        lifecycleVerdict: "UNKNOWN",
        eligible: true,
        exclusionReason: null,
        st: "UNKNOWN",
        industryCode: event.industryCode ?? null,
        industryName: null,
        turnoverRate: relativeDay === 0 ? finiteOrNull(event.turnover) : null,
        circulationMarketCap: relativeDay === 0 ? finiteOrNull(event.floatMarketCap) : null,
        totalMarketCap: relativeDay === 0 ? finiteOrNull(event.marketCap) : null,
        liquidityAmount: bar.amount ?? null,
        liquidityVolume: bar.volume ?? null,
        open: bar.open ?? null,
        high: bar.high ?? null,
        low: bar.low ?? null,
        close: bar.close ?? null,
        preClose: previousClose,
        volume: bar.volume ?? null,
        amount: bar.amount ?? null,
        corporateActionsEffectiveCount: 0,
        corporateActionsKnownCount: 0,
        indexClose: {},
        knowledge: {
          policy: "PIT",
          listing: "UNKNOWN",
          delisting: "UNKNOWN",
          tradability: "UNKNOWN",
          industry: event.industryCode !== null && event.industryCode !== undefined ? "KNOWN" : "UNKNOWN",
          liquidity: relativeDay === 0 && event.turnover !== null && event.turnover !== undefined ? "KNOWN" : "UNKNOWN",
          price: bar.close !== null ? "KNOWN" : "UNKNOWN",
          corporateActions: "UNKNOWN",
          marketState: "UNKNOWN",
        },
      };

      if (!isExecutionOnly && isHardEligibilityBroken(row)) {
        removalReason = "ELIGIBILITY_BROKEN";
        removedAt = bar.tradeDate;
        break;
      }

      if (!isExecutionOnly && isScoreAvailable(row)) {
        unavailableStreak = 0;
      } else if (!isExecutionOnly) {
        unavailableStreak += 1;
        if (unavailableStreak >= policy.scoreInvalidationDays) {
          removalReason = "SCORE_UNAVAILABLE";
          removedAt = bar.tradeDate;
          break;
        }
      }

      candidateCount += 1;
      projectedRelativeDayMax = Math.max(projectedRelativeDayMax, relativeDay);

      const rowKey = `${row.tradeDate}\u0000${row.securityId}`;
      if (seenRowKeys.has(rowKey)) {
        throw new RegistryDatasetBridgeError(
          "POOL_MEMBER_IDENTITY_NOT_UNIQUE",
          `池化直读：同一 (tradeDate, poolMemberId) 出现重复行 ${row.tradeDate} / ${panelSecurityId}。`,
        );
      }
      seenRowKeys.add(rowKey);
      rows.push(row);

      if (!isExecutionOnly) {
        let membersOnDate = membersByDate.get(row.tradeDate);
        if (membersOnDate === undefined) {
          membersOnDate = new Set();
          membersByDate.set(row.tradeDate, membersOnDate);
        }
        membersOnDate.add(panelSecurityId);
      }

      if (budgets?.maxPanelRows !== undefined && rows.length > budgets.maxPanelRows) {
        throw new RegistryDatasetBridgeError(
          "POOL_PANEL_ROW_BUDGET_EXCEEDED",
          `池化直读：面板行数 ${rows.length} 超过声明预算 ${budgets.maxPanelRows}。`,
        );
      }

      if (isExecutionOnly) break;
      if (isAgeCapDay) {
        removalReason = "AGE_CAP";
        const nextBar = sortedBars.find(([rd]) => rd > relativeDay);
        removedAt = nextBar?.[1].tradeDate ?? null;
      }
    }

    members.push({
      poolMemberId: memberId,
      eventId: event.eventId,
      canonicalSecurityId,
      panelSecurityId,
      symbol: event.symbol,
      admittedAt: event.tradeDate,
      expiresAt,
      removedAt,
      removalReason,
      admittedRelativeDay: 0,
      stageAtAdmission: policy.scorePolicy === "ROLLING_THREE_FACTOR" ? "ROLLING_3F" : "EARLY_OHLC",
    });
  }

  const maxMembersPerDay = Math.max(0, ...[...membersByDate.values()].map((set) => set.size));
  if (budgets?.maxMembersPerDay !== undefined && maxMembersPerDay > budgets.maxMembersPerDay) {
    throw new RegistryDatasetBridgeError(
      "POOL_MEMBER_BUDGET_EXCEEDED",
      `池化直读：单日池成员数 ${maxMembersPerDay} 超过声明预算 ${budgets.maxMembersPerDay}。`,
    );
  }

  rows.sort((a, b) =>
    a.tradeDate < b.tradeDate
      ? -1
      : a.tradeDate > b.tradeDate
        ? 1
        : a.securityId < b.securityId
          ? -1
          : a.securityId > b.securityId
            ? 1
            : 0,
  );

  const universeDefinition = buildPoolUniverseDefinition(rows, membersByDate);

  return {
    rows,
    members,
    universeDefinition,
    stats: {
      memberCount: members.length,
      maxMembersPerDay,
      rowCount: rows.length,
      projectedRelativeDayMax,
      candidateCount,
    },
  };
}

function buildPoolUniverseDefinition(
  rows: readonly ResearchDatasetRow[],
  membersByDate: ReadonlyMap<string, ReadonlySet<string>>,
): UniverseDefinition {
  const dates = new Set(rows.map((row) => row.tradeDate));
  const days: UniverseDayResult[] = [...dates]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((tradeDate) => ({
      tradeDate,
      isTradingDay: true,
      members: [...(membersByDate.get(tradeDate) ?? new Set<string>())].sort(),
      excludedByReason: {},
    }));
  return {
    rule:
      "首板股票池直读：成员 = 首板事件入池后、尚未触及池龄/失效规则的池成员；" +
      "池成员按日历日逐日存在，同一证券的多个首板事件由 poolMemberId 隔离。",
    asOfDescription: "逐日 PIT（asOf = tradeDate）",
    days,
  };
}

function exchangeFromSymbol(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  return dot >= 0 ? symbol.slice(dot + 1).toUpperCase() : "UNKNOWN";
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
