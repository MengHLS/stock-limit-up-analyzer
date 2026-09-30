import type { CanonicalMarketBar } from "../data";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../datasetRegistry/types";
import type {
  ResearchDatasetCursor,
  ResearchDatasetCursorDay,
  ResearchDatasetCursorDecisionOutcome,
} from "../research/framework/datasetCursor";
import {
  RESEARCH_DATASET_BUILDER_VERSION,
  RESEARCH_DATASET_ROW_SCHEMA_VERSION,
  type ResearchDatasetGate,
  type ResearchDatasetRow,
} from "../researchDataset/types";
import { deriveDatasetUniverseId } from "../research/datasetAccess/handle";

export interface PooledDaySlice extends ResearchDatasetCursorDay {
  readonly isTradingDay: true;
  /** 当日具备决策资格的活跃成员。 */
  readonly decisionMembers: readonly {
    readonly securityId: string;
    readonly poolMemberId: string;
    readonly eventId: string;
    readonly panelSecurityId: string;
    readonly symbol: string;
    readonly relativeDay: number;
    readonly visibleBars: readonly CanonicalMarketBar[];
  }[];
  /** 决策时可见的逐成员 bar 序列。 */
  readonly visibleBars: ReadonlyMap<string, readonly CanonicalMarketBar[]>;
  readonly activeMemberCount: number;
  readonly retiredMemberCount: number;
}

export interface PooledDatasetCursorReader {
  listTradingDates(startDate: string, endDate: string): Promise<readonly string[]>;
  listEvents(startDate: string, endDate: string): Promise<readonly FirstLimitPullbackEvent[]>;
  loadPrefixBars(eventIds: readonly string[]): Promise<readonly FirstLimitPullbackRawBar[]>;
  loadPostBars(
    eventIds: readonly string[],
    relativeDays: readonly number[],
  ): Promise<readonly FirstLimitPullbackRawBar[]>;
}

export interface PooledDatasetCursorOptions {
  readonly reader: PooledDatasetCursorReader;
  readonly identityByEventId: ReadonlyMap<string, string>;
  readonly datasetVersion: string;
  readonly datasetGate: ResearchDatasetGate;
  readonly startDate: string;
  readonly endDate: string;
  readonly poolAgeCapTradingDays: number;
  /** 首次可评分相对日；默认 1（T0 仅入池，不参与缺失评分淘汰）。 */
  readonly scoreStartRelativeDay?: number;
  readonly scoreInvalidationDays: number;
  readonly exitTailTradingDays: number;
  /** 单日活跃成员硬预算；超限响亮失败，绝不静默裁剪。 */
  readonly maxActiveMembersPerDay?: number;
}

export interface PooledDatasetCursor extends ResearchDatasetCursor {
  next(): Promise<IteratorResult<PooledDaySlice>>;
}

interface ActivePoolMember {
  readonly event: FirstLimitPullbackEvent;
  readonly poolMemberId: string;
  readonly panelSecurityId: string;
  readonly barsByDate: Map<string, FirstLimitPullbackRawBar>;
  readonly barsByRelativeDay: Map<number, FirstLimitPullbackRawBar>;
  decisionRemoved: boolean;
  retired: boolean;
  unavailableStreak: number;
}

function poolMemberId(eventId: string): string {
  return `pool:${eventId}`;
}

function panelSecurityId(canonicalSecurityId: string, eventId: string): string {
  return `${canonicalSecurityId}::pool:${eventId}`;
}

function exchangeFromSymbol(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  return dot >= 0 ? symbol.slice(dot + 1).toUpperCase() : "UNKNOWN";
}

function toCanonicalBar(
  bar: FirstLimitPullbackRawBar,
  preClose: number | null,
): CanonicalMarketBar {
  return {
    symbol: bar.symbol,
    timestamp: bar.tradeDate,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    preClose,
    volume: bar.volume,
    amount: bar.amount,
    turnoverRate: null,
    adjustment: "raw",
  } as CanonicalMarketBar;
}

function toResearchDatasetRow(
  member: ActivePoolMember,
  bar: FirstLimitPullbackRawBar,
  previousClose: number | null,
): ResearchDatasetRow {
  const event = member.event;
  const isAdmissionDay = bar.relativeDay === 0;
  return {
    tradeDate: bar.tradeDate,
    asOf: bar.tradeDate,
    securityId: member.panelSecurityId,
    code: event.symbol,
    securityType: "UNKNOWN",
    exchange: exchangeFromSymbol(event.symbol),
    lifecycleVerdict: "UNKNOWN",
    eligible: true,
    exclusionReason: null,
    st: "UNKNOWN",
    industryCode: event.industryCode ?? null,
    industryName: null,
    turnoverRate: isAdmissionDay ? event.turnover ?? null : null,
    circulationMarketCap: isAdmissionDay ? event.floatMarketCap ?? null : null,
    totalMarketCap: isAdmissionDay ? event.marketCap ?? null : null,
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
      liquidity: isAdmissionDay && event.turnover !== null && event.turnover !== undefined ? "KNOWN" : "UNKNOWN",
      price: bar.close !== null ? "KNOWN" : "UNKNOWN",
      corporateActions: "UNKNOWN",
      marketState: "UNKNOWN",
    },
  };
}

function previousCloseOf(
  member: ActivePoolMember,
  relativeDay: number,
  event: FirstLimitPullbackEvent,
): number | null {
  if (relativeDay === 0) return event.previousClose ?? null;
  return member.barsByRelativeDay.get(relativeDay - 1)?.close ?? null;
}

function hasInvalidBar(member: ActivePoolMember, bar: FirstLimitPullbackRawBar): boolean {
  if (bar.volume !== null && bar.volume !== undefined && bar.volume <= 0) return true;
  return bar.open === null && bar.high === null && bar.low === null && bar.close === null;
}

/**
 * 创建一个按交易日推进的池化游标。
 *
 * 事件仅在其首板日批量载入；每个成员的一生 bars 在入池时加载，随后保留到决策移池后
 * `exitTailTradingDays` 个交易日，用于让已持仓继续执行原有退出政策。日切片生成完毕后，
 * 过期成员从状态中删除，因此峰值内存与“活跃 + 退出尾部成员数”相关，而与历史事件总数无关。
 */
export async function createPooledDatasetCursor(
  options: PooledDatasetCursorOptions,
): Promise<PooledDatasetCursor> {
  if (options.poolAgeCapTradingDays < 1) throw new Error("poolAgeCapTradingDays 必须 >= 1");
  const tradingDates = await options.reader.listTradingDates(options.startDate, options.endDate);
  const events = [...await options.reader.listEvents(options.startDate, options.endDate)]
    .sort((left, right) =>
      left.tradeDate === right.tradeDate
        ? left.eventId.localeCompare(right.eventId)
        : left.tradeDate.localeCompare(right.tradeDate),
    );
  const eventsByDate = new Map<string, FirstLimitPullbackEvent[]>();
  for (const event of events) {
    const list = eventsByDate.get(event.tradeDate) ?? [];
    list.push(event);
    eventsByDate.set(event.tradeDate, list);
  }

  const active = new Map<string, ActivePoolMember>();
  const activeByPanelSecurityId = new Map<string, ActivePoolMember>();
  const retiredAtByMember = new Map<string, number>();
  const scoreStartRelativeDay = options.scoreStartRelativeDay ?? 1;
  const postRelativeDays = Array.from(
    { length: options.poolAgeCapTradingDays + options.exitTailTradingDays },
    (_, index) => index + 1,
  );
  let index = 0;
  let lastRequestedDate: string | null = null;
  let barsRead = 0;
  let admittedMemberCount = 0;
  let removedByMinimumScoreCount = 0;
  let peakActiveMemberCount = 0;
  const retainedMemberIds = new Set<string>();
  const retainedRows: ResearchDatasetRow[] = [];
  const retainedRowKeys = new Set<string>();

  function recordRetainedRow(row: ResearchDatasetRow): void {
    if (!retainedMemberIds.has(row.securityId)) return;
    const key = `${row.tradeDate}\u0000${row.securityId}`;
    if (retainedRowKeys.has(key)) return;
    retainedRowKeys.add(key);
    retainedRows.push(row);
  }

  function retainSecurityIds(securityIds: readonly string[]): void {
    for (const securityId of securityIds) retainedMemberIds.add(securityId);
    const currentDate = index > 0 ? tradingDates[index - 1] : null;
    if (currentDate === null) return;
    for (const securityId of retainedMemberIds) {
      const member = activeByPanelSecurityId.get(securityId);
      if (member === undefined) continue;
      const bar = member.barsByDate.get(currentDate);
      if (bar === undefined) continue;
      recordRetainedRow(
        toResearchDatasetRow(
          member,
          bar,
          previousCloseOf(member, bar.relativeDay, member.event),
        ),
      );
    }
  }

  async function next(): Promise<IteratorResult<PooledDaySlice>> {
    if (index >= tradingDates.length) return { done: true, value: undefined };
    const tradeDate = tradingDates[index++]!;
    lastRequestedDate = tradeDate;
    const admitting = eventsByDate.get(tradeDate) ?? [];
    if (admitting.length > 0) {
      const eventIds = admitting.map(event => event.eventId);
      const [prefixBars, postBars] = await Promise.all([
        options.reader.loadPrefixBars(eventIds),
        options.reader.loadPostBars(eventIds, postRelativeDays),
      ]);
      barsRead += prefixBars.length + postBars.length;
      const prefixByEvent = new Map(prefixBars.map(bar => [bar.eventId, bar] as const));
      const postByEvent = new Map<string, FirstLimitPullbackRawBar[]>();
      for (const bar of postBars) {
        const list = postByEvent.get(bar.eventId) ?? [];
        list.push(bar);
        postByEvent.set(bar.eventId, list);
      }
      for (const event of admitting) {
        const canonical = options.identityByEventId.get(event.eventId);
        if (canonical === undefined) {
          throw new Error(`池化游标：事件 ${event.eventId} 缺少 canonical securityId`);
        }
        const barsByDate = new Map<string, FirstLimitPullbackRawBar>();
        const barsByRelativeDay = new Map<number, FirstLimitPullbackRawBar>();
        const prefix = prefixByEvent.get(event.eventId);
        if (prefix !== undefined) {
          barsByDate.set(prefix.tradeDate, prefix);
          barsByRelativeDay.set(prefix.relativeDay, prefix);
        }
        for (const bar of postByEvent.get(event.eventId) ?? []) {
          barsByDate.set(bar.tradeDate, bar);
          barsByRelativeDay.set(bar.relativeDay, bar);
        }
        const memberId = poolMemberId(event.eventId);
        const member: ActivePoolMember = {
          event,
          poolMemberId: memberId,
          panelSecurityId: panelSecurityId(canonical, event.eventId),
          barsByDate,
          barsByRelativeDay,
          decisionRemoved: false,
          retired: false,
          unavailableStreak: 0,
        };
        active.set(memberId, member);
        activeByPanelSecurityId.set(member.panelSecurityId, member);
        admittedMemberCount += 1;
      }
    }

    const decisionMembers: PooledDaySlice["decisionMembers"][number][] = [];
    const executionBars = new Map<string, CanonicalMarketBar>();
    const rows: ResearchDatasetRow[] = [];
    const members = new Set<string>();
    for (const member of active.values()) {
      if (member.retired) {
        const retiredAt = retiredAtByMember.get(member.poolMemberId);
        if (
          retiredAt !== undefined
          && index - 1 - retiredAt > options.exitTailTradingDays
          && !retainedMemberIds.has(member.panelSecurityId)
        ) {
          active.delete(member.poolMemberId);
          activeByPanelSecurityId.delete(member.panelSecurityId);
          retiredAtByMember.delete(member.poolMemberId);
          continue;
        }
      }
      const bar = member.barsByDate.get(tradeDate);
      if (bar === undefined) continue;
      const relativeDay = bar.relativeDay;
      const preClose = previousCloseOf(member, relativeDay, member.event);
      executionBars.set(member.panelSecurityId, toCanonicalBar(bar, preClose));
      const researchRow = toResearchDatasetRow(member, bar, preClose);
      rows.push(researchRow);
      recordRetainedRow(researchRow);

      if (member.retired) continue;

      if (relativeDay >= scoreStartRelativeDay) {
        if (hasInvalidBar(member, bar)) {
          member.unavailableStreak += 1;
        } else {
          member.unavailableStreak = 0;
        }
      }

      const decisionEligible =
        relativeDay >= 0
        && relativeDay <= options.poolAgeCapTradingDays - 1
        && member.unavailableStreak < options.scoreInvalidationDays;
      if (decisionEligible) {
        const visibleBars = [...member.barsByRelativeDay.entries()]
          .filter(([day]) => day <= relativeDay)
          .sort((left, right) => left[0] - right[0])
          .map(([, raw]) => toCanonicalBar(raw, previousCloseOf(member, raw.relativeDay, member.event)));
        decisionMembers.push({
          securityId: member.panelSecurityId,
          poolMemberId: member.poolMemberId,
          eventId: member.event.eventId,
          panelSecurityId: member.panelSecurityId,
          symbol: member.event.symbol,
          relativeDay,
          visibleBars,
        });
        members.add(member.panelSecurityId);
      }

      const ageCapReached = relativeDay >= options.poolAgeCapTradingDays - 1;
      const invalidated = member.unavailableStreak >= options.scoreInvalidationDays;
      if (ageCapReached || invalidated) {
        member.retired = true;
        retiredAtByMember.set(member.poolMemberId, index - 1);
      }
    }

    if (
      options.maxActiveMembersPerDay !== undefined
      && decisionMembers.length > options.maxActiveMembersPerDay
    ) {
      throw new Error(
        `POOL_MEMBER_BUDGET_EXCEEDED: 池化游标单日活跃成员 ${decisionMembers.length} `
        + `超过预算 ${options.maxActiveMembersPerDay}（日期 ${tradeDate}）。`,
      );
    }
    peakActiveMemberCount = Math.max(peakActiveMemberCount, active.size);
    decisionMembers.sort((left, right) => left.panelSecurityId.localeCompare(right.panelSecurityId));
    rows.sort((left, right) => left.securityId.localeCompare(right.securityId));
    const visibleBars = new Map(
      decisionMembers.map(member => [member.panelSecurityId, member.visibleBars] as const),
    );
    return {
      done: false,
      value: {
        tradeDate,
        isTradingDay: true,
        decisionMembers,
        executionBars,
        visibleBars,
        rows,
        members: [...members].sort(),
        activeMemberCount: decisionMembers.length,
        retiredMemberCount: retiredAtByMember.size,
      },
    };
  }

  async function getDaySlice(tradeDate: string): Promise<ResearchDatasetCursorDay> {
    if (lastRequestedDate !== null && tradeDate < lastRequestedDate) {
      throw new Error(
        `池化游标只支持顺序读取：请求 ${tradeDate} 早于已消费的 ${lastRequestedDate}。`,
      );
    }
    for (;;) {
      const item = await next();
      if (item.done) {
        return {
          tradeDate,
          isTradingDay: false,
          rows: [],
          members: [],
          executionBars: new Map(),
          visibleBars: new Map(),
        };
      }
      if (item.value.tradeDate === tradeDate) return item.value;
    }
  }

  async function restart(): Promise<void> {
    index = 0;
    lastRequestedDate = null;
    active.clear();
    activeByPanelSecurityId.clear();
    retiredAtByMember.clear();
    barsRead = 0;
    admittedMemberCount = 0;
    removedByMinimumScoreCount = 0;
    peakActiveMemberCount = 0;
  }

  function applyDecisionOutcomes(
    outcomes: readonly ResearchDatasetCursorDecisionOutcome[],
  ): void {
    if (outcomes.length === 0) return;
    const currentDate = index > 0 ? tradingDates[index - 1] : null;
    for (const outcome of outcomes) {
      const member = activeByPanelSecurityId.get(outcome.securityId);
      if (member === undefined || member.retired) continue;
      if (outcome.removeFromPool) {
        member.decisionRemoved = true;
        member.retired = true;
        removedByMinimumScoreCount += 1;
        retiredAtByMember.set(member.poolMemberId, Math.max(0, index - 1));
        continue;
      }
      if (!outcome.scored) {
        const currentBar = currentDate === null ? undefined : member.barsByDate.get(currentDate);
        // next() 已对 invalid bar 记过一次；这里只补记“bar 有效但特征不可评分”。
        if (currentBar === undefined || !hasInvalidBar(member, currentBar)) {
          member.unavailableStreak += 1;
          if (member.unavailableStreak >= options.scoreInvalidationDays) {
            member.retired = true;
            retiredAtByMember.set(member.poolMemberId, Math.max(0, index - 1));
          }
        }
        continue;
      }
      member.unavailableStreak = 0;
    }
  }

  return {
    metadata: {
      datasetVersion: options.datasetVersion,
      builderVersion: RESEARCH_DATASET_BUILDER_VERSION,
      rowSchemaVersion: RESEARCH_DATASET_ROW_SCHEMA_VERSION,
      universeId: deriveDatasetUniverseId(options.datasetVersion),
      startDate: options.startDate,
      endDate: options.endDate,
      rowCount: null,
      universeDayCount: tradingDates.length,
      gate: options.datasetGate,
    },
    tradingDates,
    next,
    getDaySlice,
    restart,
    applyDecisionOutcomes,
    retainSecurityIds,
    takeRetainedRows: () => retainedRows.slice(),
    stats: () => ({
      barsRead,
      admittedMemberCount,
      retiredMemberCount: retiredAtByMember.size,
      removedByMinimumScoreCount,
      peakActiveMemberCount,
    }),
    async close(): Promise<void> {},
  };
}
