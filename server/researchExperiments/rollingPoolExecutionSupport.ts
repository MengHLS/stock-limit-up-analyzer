/**
 * `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` —— 实验侧**服务支持**（唯一实现）。
 *
 * 本模块只做两件**服务侧才能做**的事，其余（池投影 / 观察分 / 触发 / 排序 / 账户）全在实验侧纯函数里：
 *   1. **真实证券身份**：Dataset 端口的 `symbol` 是**代码不是身份**（契约明文禁止当身份用），
 *      这里复用既有 `loadPrimaryIdentifiers()` + `resolveSecurityIdsByEvent()`（**不新增第二套解析**）；
 *   2. **把实验投影的行"封"成一个合法 `ResearchDataset`**：`datasetVersion` 必须**内容寻址**
 *      （`computeDatasetVersionStreaming`）、`policySet` 必须**派生**（`derivePolicySet`）——
 *      这两者都是服务侧纯函数，实验侧不得自行拼一个假版本号（否则破坏不变量 I-2）。
 *
 * 🔴 本模块**不**：读行情（行情由 Dataset 端口提供）、构造候选、排名、撮合、算指标、
 *    新建引擎 / 指标出口 / 策略语义。
 */
import {
  loadPrimaryIdentifiers,
  resolveSecurityIdsByEvent,
} from "../runWorkbenchAssembly/datasetIdentityProvider";
import { normalizeResearchDatasetRequest } from "../researchDataset/validate";
import { computeDatasetVersionStreaming } from "../researchDataset/version";
import { derivePolicySet } from "../researchDataset/policy";
import type {
  DataSnapshot,
  DomainSnapshot,
  ResearchDataset,
  ResearchDatasetRequest,
  ResearchDatasetRow,
  UniverseDayResult,
  UniverseDefinition,
} from "../researchDataset/types";
import type { FirstLimitPullbackEvent } from "../datasetRegistry/types";

// ---------------------------------------------------------------------------
// 1. 真实证券身份
// ---------------------------------------------------------------------------

/** 最小事件面（实验侧从 Dataset 端口拿到的东西）。 */
export interface RollingPoolIdentityEvent {
  readonly eventId: string;
  readonly symbol: string;
  readonly tradeDate: string;
}

export interface RollingPoolIdentityResult {
  /** `eventId → canonical securityId`（`sec_<uuid>`）。 */
  readonly securityIdByEventId: ReadonlyMap<string, string>;
  /** 身份历史行数（审计用）。 */
  readonly identifierRowCount: number;
  /** 无法解析的事件（**响亮报告**，不静默按代码兜底）。 */
  readonly unresolvedEventIds: readonly string[];
}

/**
 * 逐事件按其**自身 tradeDate** 解析 canonical `sec_<uuid>`。
 *
 * 🔴 复用既有唯一实现 `resolveSecurityIdsByEvent`（内部按 canonicalCode 建索引 + PIT asOf 判定），
 *    解析歧义 / 无法解析时**不回落为 code**，而是记入 `unresolvedEventIds` 并由调用方响亮处理。
 */
export async function resolveRollingPoolSecurityIds(
  events: readonly RollingPoolIdentityEvent[],
): Promise<RollingPoolIdentityResult> {
  const identifiers = await loadPrimaryIdentifiers();
  const resolved = resolveSecurityIdsByEvent(
    events as unknown as readonly FirstLimitPullbackEvent[],
    identifiers,
  );
  const securityIdByEventId = new Map<string, string>();
  const unresolvedEventIds: string[] = [];
  for (const event of events) {
    const securityId = resolved.get(event.eventId);
    if (typeof securityId === "string" && securityId.length > 0) {
      securityIdByEventId.set(event.eventId, securityId);
    } else {
      unresolvedEventIds.push(event.eventId);
    }
  }
  return {
    securityIdByEventId,
    identifierRowCount: identifiers.length,
    unresolvedEventIds,
  };
}

// ---------------------------------------------------------------------------
// 2. 把投影行封成合法 ResearchDataset
// ---------------------------------------------------------------------------

/** 封数据集时的最小行面（实验侧只需要提供这些；其余身份/流动性域如实记 UNKNOWN）。 */
export interface RollingPoolExecutionRowInput {
  readonly tradeDate: string;
  readonly securityId: string;
  readonly code: string;
  readonly exchange: string;
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly close: number | null;
  readonly preClose: number | null;
  readonly volume: number | null;
  readonly amount: number | null;
  /** 该行 bar 是否真实存在（false ⇒ `eligible=false` + `exclusionReason`）。 */
  readonly barPresent: boolean;
  readonly suspended: boolean;
}

export interface SealRollingPoolExecutionDatasetInput {
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly datasetVersionId: number;
  readonly rows: readonly RollingPoolExecutionRowInput[];
  /** 交易日序列（升序、去重）；必须覆盖模拟窗口。 */
  readonly tradingDates: readonly string[];
}

function toRow(input: RollingPoolExecutionRowInput): ResearchDatasetRow {
  const tradable = input.barPresent && !input.suspended;
  return {
    tradeDate: input.tradeDate,
    // 🔴 PIT 不变量：逐行 asOf 必须等于 tradeDate（`assertRowPitInvariant`）。
    asOf: input.tradeDate,
    securityId: input.securityId,
    code: input.code,
    securityType: "STOCK",
    exchange: input.exchange,
    lifecycleVerdict: "LISTED",
    eligible: tradable,
    exclusionReason: tradable ? null : input.suspended ? "SUSPENDED" : "NO_BAR",
    // 逐日 ST 事实不在 Dataset 端口内 ⇒ 如实记 UNKNOWN，**不声称**已实现每日非 ST 控制。
    st: "UNKNOWN",
    industryCode: null,
    industryName: null,
    turnoverRate: null,
    circulationMarketCap: null,
    totalMarketCap: null,
    liquidityAmount: null,
    liquidityVolume: null,
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    preClose: input.preClose,
    volume: input.volume,
    amount: input.amount,
    corporateActionsEffectiveCount: 0,
    corporateActionsKnownCount: 0,
    indexClose: {},
    knowledge: {
      policy: "PIT",
      listing: "KNOWN",
      delisting: "UNKNOWN",
      tradability: "KNOWN",
      industry: "UNKNOWN",
      liquidity: "UNKNOWN",
      price: "KNOWN",
      corporateActions: "UNKNOWN",
      marketState: "UNKNOWN",
    },
  };
}

/**
 * 内容寻址地封出一个 `ResearchDataset`。
 *
 * 不变量（`bindResearchDataset` 会逐条校验）：
 *   - 行按 `(tradeDate, securityId)` 严格升序且唯一；
 *   - 每行 `asOf === tradeDate`；
 *   - `universeDefinition.days` 按 `tradeDate` 严格升序且唯一；
 *   - `dataSnapshot.request.startDate/endDate` 有效且有序（= 模拟窗口上界）。
 */
export function sealRollingPoolExecutionDataset(
  input: SealRollingPoolExecutionDatasetInput,
): ResearchDataset {
  const rawRows = input.rows.map(toRow);
  rawRows.sort((left, right) => (
    left.tradeDate === right.tradeDate
      ? left.securityId.localeCompare(right.securityId)
      : left.tradeDate.localeCompare(right.tradeDate)
  ));
  // 去重（同一 (tradeDate, securityId) 只保留第一行，确定性）——`assertRowsSortedAndUnique` 要求唯一。
  const rows: ResearchDatasetRow[] = [];
  const seen = new Set<string>();
  for (const row of rawRows) {
    const key = `${row.tradeDate}\u0000${row.securityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  const tradingDates = [...new Set(input.tradingDates)].sort();
  const datesWithRows = new Set(rows.map((row) => row.tradeDate));
  /**
   * 🔴 性能计划项 4「单次按日期索引代替重复过滤」（`RECOVERY-LIGHT-ST-007` TASK B）。
   *
   * 旧写法 `tradingDates.map((d) => ({ members: rows.filter((row) => row.tradeDate === d)… }))`
   * 是 O(交易日数 × 行数)：本实验实测约 490 日 × 52,790 行 ≈ 2,600 万次字符串比较，
   * 纯属重复扫描。`rows` 此时**已按 `(tradeDate, securityId)` 升序**（见上方 sort），
   * 因此一次遍历建索引即可得到**逐行相同**的视图：同一日期组内成员保持
   * 「按 `securityId` 升序、且每个 `securityId` 只出现一次」——与 `filter` 的结果逐项一致。
   *
   * 封数据集指纹（`computeDatasetVersionStreaming(request, universeDefinition, rows)`）
   * 与排序规则**都不变**；这里只把「重复过滤」换成「一次索引」。
   */
  const securityIdsByDate = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = securityIdsByDate.get(row.tradeDate);
    if (bucket === undefined) {
      securityIdsByDate.set(row.tradeDate, [row.securityId]);
    } else {
      bucket.push(row.securityId);
    }
  }
  const universeDays: UniverseDayResult[] = tradingDates.map((tradeDate) => ({
    tradeDate,
    isTradingDay: true,
    // 复制一份：`members` 是封数据集校验会触碰的可变数组，不把索引里的数组直接交出去。
    members: [...(securityIdsByDate.get(tradeDate) ?? [])],
    excludedByReason: {},
  }));

  const request = normalizeResearchDatasetRequest({
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    asOfPerTradeDate: true,
  } satisfies ResearchDatasetRequest);

  const universeDefinition: UniverseDefinition = {
    rule:
      "首板滚动池早期入场实验的**紧凑执行投影**：只保留候选 run 意图涉及的"
      + "事件作用域证券（`<canonical>::event:<code>@<date>`）与其执行/退出 bars。",
    asOfDescription: "逐日 PIT（asOf = tradeDate）",
    days: universeDays,
  };

  const domain: DomainSnapshot = {
    domain: "A",
    rowsLoaded: rows.length,
    securitiesCovered: new Set(rows.map((row) => row.securityId)).size,
    datesCovered: datesWithRows.size,
    datesExpected: tradingDates.length,
    note: "紧凑执行投影（仅意图涉及证券）；行情源自 Dataset 端口。",
  };
  const dataSnapshot: DataSnapshot = {
    capturedAt: new Date().toISOString(),
    request,
    calendarName: "compact-execution-projection",
    calendarFirstDate: tradingDates[0] ?? input.startDate,
    calendarLastDate: tradingDates[tradingDates.length - 1] ?? input.endDate,
    tradingDays: tradingDates.length,
    domains: [domain],
    coverageGaps: [],
  };

  return {
    datasetVersion: computeDatasetVersionStreaming(request, universeDefinition, rows),
    universeDefinition,
    policySet: derivePolicySet(request, dataSnapshot),
    dataSnapshot,
    rows,
    gate: "PASS",
    gateNotes: [
      `datasetVersionId=${input.datasetVersionId}（仅追溯用；本投影的内容寻址版本见 datasetVersion）`,
      `rows=${rows.length}`,
    ],
  };
}
