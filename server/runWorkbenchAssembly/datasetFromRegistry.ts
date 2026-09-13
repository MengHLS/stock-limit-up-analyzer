/**
 * 运行工作台装配层 — **已落库数据集直读桥**（`ds_*` 首板回踩体系 → `ResearchDataset`）。
 *
 * 解决的问题（2026-09-13 实查，证据见 docs/evidence/_probe_ds_rows.mts 与
 * docs/evidence/_probe_strategy_dataset_binding.mts）：
 *   `assembleRunWorkbenchInputs` 此前**无条件**调用 `buildResearchDataset(窗口=前端填的日期)`，
 *   即运行时从零重算 —— 完全无视「策略文档已绑定 `datasetVersionId=390002`」这一事实，
 *   也无视 `ds_*` 五表里**已经落库的 1,543,082 行**（其中 `prefix` 含 503,538 行 OHLCV）。
 *   后果：分钟级等待（涨停候选全窗扫描 ≈129s 为主成本）+ 跨境链路抖动 + 产物可能与
 *   「已认证的 READY 版本」漂移。
 *
 * 本模块提供**优先直读**路径：给定 `datasetVersionId`，从 Dataset Registry 的真实只读
 * 接口（`getVersionById` / `getDefinitionById` / `DatasetDataReader`）把已落库的行投影为
 * `ResearchDataset`，使运行工作台直接消费被策略绑定的那份数据，而不是另构一份。
 *
 * 三条纪律（与 `assemble.ts` 完全一致，不得偏离）：
 *   1. **不新增第二套读取实现**：所有读取都走 `server/datasetRegistry` 既有只读接口
 *      （`DatasetRegistryRepository` + `DatasetDataReader`），本文件不写 SQL、不直连物理表。
 *   2. **不猜不造**：`gate` 取自 `dataset_version.status`（READY → PASS，其余 → FAIL/
 *      INCONCLUSIVE 并如实记录原因）；缺行、缺窗口、缺身份一律**抛错**，绝不填零冒充。
 *   3. **内容即版本**：`datasetVersion` 由 `computeDatasetVersion(request, universeDefinition,
 *      rows)` 对**本次实际投影出的内容**重算 —— 与 `bindResearchDataset` 的强校验自洽
 *      （`assertDatasetVersionConsistent` 要求 `experimentConfig.datasetVersion` 与之相等，
 *      故装配层必须把「同一个对象」同时喂给 experimentConfig 与 inputs，见 assemble.ts）。
 *
 * 已知边界（诚实登记，不掩盖）：
 *   - `ds_*` 行是**事件级窗口**（relativeDay ∈ [-pre, +post]），与 `ResearchDataset` 的
 *     **逐日全市场面板**形状不同。本桥按 (tradeDate, symbol) 投影 prefix(rd≤0) 段为宽行；
 *     `post`(rd≥1) 段**不进入 rows**（它们是未来信息，逐日 PIT 面板禁止混入）。
 *     ⇒ 语义上等价于「T+N 观察窗口不可见」的窄面板，**不足以支撑需要 post 窗口的回测撮合**。
 *     若策略/配方要求 post 窗口，本桥会在 gateNotes 中明确标注 `POST_WINDOW_NOT_PROJECTED`，
 *     由调用方决定是否回落 `buildResearchDataset`。**调用方的机器可读判据 = 返回值
 *     `executionBarsAvailable === false`** —— 2026-09-13 起 `assemble.ts#resolveDataset`
 *     会据此自动回落（此前无此判据，界面「运行策略」实测恒 0 成交，见该字段注释）。
 *   - 本桥只投影 `prefix` 中的 OHLCV + `event` 中的时点属性；`st` / `industryName` /
 *     `lifecycleVerdict` 等 Registry 未落库的列，一律按**「未知」**忠实表达
 *     （`UNKNOWN` / null），不猜测、不填默认值。
 */

import { getDb } from "../db";
import {
  DbDatasetDataReader,
  type DatasetDataReader,
} from "../datasetRegistry/query";
import { DbDatasetRegistry } from "../datasetRegistry/db";
import { defaultConcurrency, mapWithConcurrency } from "../datasetRegistry/concurrency";import type {
  DatasetDefinition,
  DatasetVersion,
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../datasetRegistry/types";
import { withReadRetry } from "../researchEngine/readRetry";
import { computeDatasetVersion } from "../researchDataset/version";
import { normalizeResearchDatasetRequest } from "../researchDataset/validate";
import { derivePolicySet } from "../researchDataset/policy";
import type {
  DataSnapshot,
  DomainSnapshot,
  NormalizedResearchDatasetRequest,
  ResearchDataset,
  ResearchDatasetGate,
  ResearchDatasetRequest,
  ResearchDatasetRow,
  UniverseDayResult,
  UniverseDefinition,
} from "../researchDataset/types";

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/** 直读桥错误（消息必须能直接指向「缺哪个版本 / 去改哪里」）。 */
export class RegistryDatasetBridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RegistryDatasetBridgeError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/**
 * 单页读取批大小（跨境链路下不宜过大，避免单次响应体过大）。
 *
 * 实测（docs/evidence/_probe_registry_direct_breakdown.mts，390002 / 23,978 事件）：
 *   limit=2000 → 12 页 / 8.8s；limit=5000 → 5 页 / 5.3s；limit=10000 → 3 页 / 7.9s。
 * 5000 最优（页数少且单页未过重）；10000 反而回退（单次响应体过大 + 跨境 RTT 摊薄的边际递减）。
 */
const EVENT_PAGE_LIMIT = 5000;
/**
 * 单批 eventId 数量（批量读 prefix）。
 *
 * 实测（同上）：batch=1000 conc=16 → 1.4s；batch=400 conc=16 → 2.0s；
 * batch=2000 conc=16 → 1.6s。1000 最优（每批 SQL 规模与并发数乘积落在平台期）。
 */
const EVENT_ID_BATCH_SIZE = 1000;
/**
 * 批量读并发度：用**连接池上限**而不是工具默认 8。
 *
 * 依据：本桥的批读是**完全独立**的只读语句（无共享状态），实测 conc 8→16 有 1.5~2.4× 收益
 * （batch=1000: 2.2s → 1.4s），且不挤占其他路径（此时没有别的查询在飞）。
 */
const RAW_BAR_READ_CONCURRENCY = resolvePoolSizeForBridge();

function resolvePoolSizeForBridge(): number {
  const raw = Number(process.env.DB_POOL_SIZE);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(Math.floor(raw), 64);
  return 16;
}

/** 直读行数护栏（超过即拒绝直读，避免把百万行一次性拉进内存；调用方据错误码回落重建）。 */
export const REGISTRY_BRIDGE_MAX_ROWS = 200_000;

/** `dataset_version.status` → ResearchDatasetGate（唯一口径，不另行判定）。 */
function gateFromVersionStatus(status: DatasetVersion["status"]): ResearchDatasetGate {
  return status === "READY" ? "PASS" : "FAIL";
}

// ---------------------------------------------------------------------------
// 投影：ds_* 行 → ResearchDatasetRow
// ---------------------------------------------------------------------------

/**
 * `ds_*` 身份 → `ResearchDatasetRow.securityId`。
 *
 * `ds_*` 的 `symbol` 就是「交易所完整代码」（如 `603123.SH`），与 ResearchDatasetRow 的
 * `securityId` 键域一致（见 `datasetAccess/bars.ts` 的 `bar.symbol = row.securityId` 约定）。
 * `code` 同值（当日生效代码 = 该 symbol）；`exchange` 由后缀派生。
 */
function exchangeFromSymbol(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  return dot >= 0 ? symbol.slice(dot + 1).toUpperCase() : "UNKNOWN";
}

/**
 * 单条 (event, prefix rd=0 行) → 宽行。
 *
 * 只有 `relativeDay = 0`（= 事件日 t）的行才是「该事件的当日行情」；rd<0 是特征窗口，
 * 属于「过去」，不构成独立决策日行（否则同一证券/日期会出现 rd=-20..-1 的重复行，
 * 违反 (tradeDate, securityId) 唯一键）。
 *
 * 因此投影口径：**每事件恰产出一行**（tradeDate = event.tradeDate，OHLCV 取 prefix 的
 * rd=0 行）。这是「事件面板」的确定性定义，与「逐日全市场面板」语义不同 —— 但它是
 * `ds_*` 数据在 `ResearchDatasetRow` 形状下唯一不丢信息的表达。
 */
function projectEventRow(
  event: FirstLimitPullbackEvent,
  dayZeroBar: FirstLimitPullbackRawBar | undefined,
): ResearchDatasetRow {
  const preClose = event.previousClose ?? null;
  return {
    tradeDate: event.tradeDate,
    // 逐日 PIT：asOf === tradeDate（bindResearchDataset 强校验此项）。
    asOf: event.tradeDate,
    securityId: event.symbol,
    code: event.symbol,

    // -- identity / lifecycle：Registry 未落库 ⇒ 忠实「未知」，不猜。--
    securityType: "UNKNOWN",
    exchange: exchangeFromSymbol(event.symbol),
    lifecycleVerdict: "UNKNOWN",

    // -- tradability：事件表天然只含「已涨停且被收录」的标；eligibility 判定不在 ds_* 职责域。--
    eligible: true,
    exclusionReason: null,
    st: "UNKNOWN",

    // -- industry：ds_* 只有 code（无名称）；industryCode 直拷，name 未知。--
    industryCode: event.industryCode ?? null,
    industryName: null,

    // -- liquidity：event 上的 turnover / marketCap / floatMarketCap 来自 liquidity_daily 富集。--
    turnoverRate: event.turnover ?? null,
    circulationMarketCap: event.floatMarketCap ?? null,
    totalMarketCap: event.marketCap ?? null,
    liquidityAmount: dayZeroBar?.amount ?? null,
    liquidityVolume: dayZeroBar?.volume ?? null,

    // -- price（未复权 raw）：rd=0 行的 OHLCV，直拷（null 透传，禁止填零）。--
    open: dayZeroBar?.open ?? null,
    high: dayZeroBar?.high ?? null,
    low: dayZeroBar?.low ?? null,
    close: dayZeroBar?.close ?? null,
    preClose,
    volume: dayZeroBar?.volume ?? null,
    amount: dayZeroBar?.amount ?? null,

    // -- corporate actions：ds_* 不承载，如实 0（= 本投影未携带，而非「确定无事件」）。
    corporateActionsEffectiveCount: 0,
    corporateActionsKnownCount: 0,

    // -- market state：ds_* 不承载指数，如实空对象。--
    indexClose: {},

    // -- knowledge：逐项声明本投影的可知性（不掩盖已知缺失）。--
    knowledge: {
      policy: "PIT",
      listing: "UNKNOWN",
      delisting: "UNKNOWN",
      tradability: "UNKNOWN",
      industry: event.industryCode !== null && event.industryCode !== undefined ? "KNOWN" : "UNKNOWN",
      liquidity: event.turnover !== null && event.turnover !== undefined ? "KNOWN" : "UNKNOWN",
      price: dayZeroBar !== undefined && dayZeroBar.close !== null ? "KNOWN" : "UNKNOWN",
      corporateActions: "UNKNOWN",
      marketState: "UNKNOWN",
    },
  };
}

// ---------------------------------------------------------------------------
// 读取编排
// ---------------------------------------------------------------------------

/** 分页读取全部 event（keyset，按 tradeDate → eventId 升序）。 */
async function readAllEvents(
  reader: DatasetDataReader,
  datasetVersionId: number,
): Promise<FirstLimitPullbackEvent[]> {
  const all: FirstLimitPullbackEvent[] = [];
  let cursor: { tradeDate: string; eventId: string } | null = null;
  for (;;) {
    const page: { items: FirstLimitPullbackEvent[]; nextCursor: string | null } = await reader.listEventsPage({
      datasetVersionId,
      ...(cursor !== null ? { cursor } : {}),
      limit: EVENT_PAGE_LIMIT,
    });
    all.push(...page.items);
    if (page.nextCursor === null || page.items.length === 0) break;
    const last = page.items[page.items.length - 1]!;
    cursor = { tradeDate: last.tradeDate, eventId: last.eventId };
  }
  return all;
}

/**
 * 批量读取事件的 rd=0 行情行（每批 EVENT_ID_BATCH_SIZE 个 eventId，**有界并发**）。
 *
 * 只取 `relativeDay = 0`：本投影只需要「事件日当天行情」；特征窗口（rd<0）与未来窗口
 * （rd>0）分别属「过去」与「未来」，都不构成决策日行。
 *
 * 并发理由（实测）：23,978 事件 ÷ 400 = 60 批，跨境 RTT ≈ 208ms ⇒ 纯串行 40s+。
 * 用既有 `mapWithConcurrency`（与构建链同一原语）叠起来后，墙钟 ≈ 串行的 1/(并发数)。
 * 结果按批序写入 Map，与并发完成顺序无关（确定性）。
 */
async function readEventDayBars(
  reader: DatasetDataReader,
  datasetVersionId: number,
  eventIds: readonly string[],
): Promise<Map<string, FirstLimitPullbackRawBar>> {
  const batches: string[][] = [];
  for (let i = 0; i < eventIds.length; i += EVENT_ID_BATCH_SIZE) {
    batches.push(eventIds.slice(i, i + EVENT_ID_BATCH_SIZE));
  }
  const byEventId = new Map<string, FirstLimitPullbackRawBar>();
  const results = await mapWithConcurrency(
    batches,
    (batch) =>
      batch.length === 0
        ? Promise.resolve<FirstLimitPullbackRawBar[]>([])
        : reader.loadRawBarsBatch("prefix", {
            datasetVersionId,
            eventIds: batch,
            relativeDays: [0],
          }),
    RAW_BAR_READ_CONCURRENCY,
  );
  for (const bars of results) {
    for (const bar of bars) byEventId.set(bar.eventId, bar);
  }
  return byEventId;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 直读请求（调用方只给「已绑定坐标」，其余一切由 Registry 事实决定）。 */
export interface BuildDatasetFromRegistryRequest {
  /** `dataset_version.id`（唯一坐标）。 */
  readonly datasetVersionId: number;
  /** 数据集名称（仅描述，不进版本指纹）。 */
  readonly name: string;
  /** dataReady 声明（与 `buildResearchDataset` 同口径：缺省 false = 冒烟）。 */
  readonly dataReady?: boolean;
}

/** 直读结果。 */
export interface BuildDatasetFromRegistryResult {
  readonly dataset: ResearchDataset;
  readonly version: DatasetVersion;
  readonly definition: DatasetDefinition;
  /**
   * 🔴 本投影是否携带「**执行日行情**」（= 撮合阶段能不能成交）。
   *
   * 恒为 `false`（2026-09-13 明示）：本桥只投影 `prefix` 的 `rd=0`（事件日当天行情），
   * `post`（rd≥1）段**不进 rows** ⇒ 任何证券在其**事件日之外**都没有行，而交易模拟在
   * **决策日的下一交易日**执行订单（`simulator/engine.ts` 第 9(c) 步按
   * `dayBars.get(securityId)` 取执行日 bar）⇒ 执行日无行时一律按 `SUSPENDED` 拒单。
   *
   * 实测（`docs/evidence/_probe_backtest_zero_trades.mts`，390002 / 2025-01-02~03-31）：
   * `registry` 路径 **59 单 → 59 单 SUSPENDED → 0 成交 → 权益曲线恒平**；
   * 同策略同窗口走 `rebuild` 则 **133 笔成交 / 期末 112,169（+12.17%）**。
   *
   * ⇒ 调用方（`assemble.ts#resolveDataset`）**必须**据此回落 `buildResearchDataset`，
   * 否则「界面运行策略」会静默产出全 0 结果。
   */
  readonly executionBarsAvailable: boolean;
  /** 直读实况（供装配摘要如实展示「从已落库数据集读了什么」）。 */
  readonly stats: {
    readonly eventCount: number;
    readonly rowCount: number;
    readonly prefixBarsRead: number;
    readonly versionStatus: string;
    readonly datasetCode: string;
    readonly versionLabel: string;
  };
}

/**
 * 从 Dataset Registry 直读已落库 `ds_*` 数据集，投影为 `ResearchDataset`。
 *
 * 失败响亮（全部抛 `RegistryDatasetBridgeError`，附稳定错误码）：
 *   - `REGISTRY_VERSION_NOT_FOUND` —— `dataset_version.id` 不存在；
 *   - `REGISTRY_VERSION_NOT_READY` —— 行存在但 status ≠ READY；
 *   - `REGISTRY_DEFINITION_MISSING` —— 版本所属 dataset_definition 缺失；
 *   - `REGISTRY_DATASET_CODE_UNSUPPORTED` —— datasetCode ≠ `first_limit_pullback`
 *     （本桥只实现首板回踩体系；其他体系不冒充支持）；
 *   - `REGISTRY_EMPTY_VERSION` —— 版本无任何 event 行（空数据集不冒充可跑）；
 *   - `REGISTRY_ROW_BUDGET_EXCEEDED` —— 行数超 `REGISTRY_BRIDGE_MAX_ROWS`（调用方应回落重建）。
 */
export async function buildResearchDatasetFromRegistry(
  request: BuildDatasetFromRegistryRequest,
): Promise<BuildDatasetFromRegistryResult> {
  const db = await getDb();
  if (!db) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_DB_UNAVAILABLE",
      "直读桥：数据库不可用（getDb()=null），无法读取已落库数据集。",
    );
  }

  const registry = new DbDatasetRegistry();
  const reader = new DbDatasetDataReader();

  // -- 1. 版本事实（存在 + READY）--
  const version = await withReadRetry("registry.getVersionById", () => registry.getVersionById(request.datasetVersionId));
  if (version === undefined) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_VERSION_NOT_FOUND",
      `直读桥：dataset_version.id=${request.datasetVersionId} 不存在（策略绑定指向了不存在的版本）。`,
    );
  }
  if (version.status !== "READY") {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_VERSION_NOT_READY",
      `直读桥：dataset_version.id=${request.datasetVersionId} 当前 status=${version.status}，只有 READY 可用于运行。`,
    );
  }

  const definition = await withReadRetry("registry.getDefinitionById", () => registry.getDefinitionById(version.datasetId));
  if (definition === undefined) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_DEFINITION_MISSING",
      `直读桥：dataset_version.id=${request.datasetVersionId} 所属 dataset_definition.id=${version.datasetId} 不存在。`,
    );
  }
  if (definition.datasetCode !== "first_limit_pullback") {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_DATASET_CODE_UNSUPPORTED",
      `直读桥：datasetCode=${JSON.stringify(definition.datasetCode)} 尚不支持直读（本桥只实现 first_limit_pullback 首板回踩体系）。`,
    );
  }

  // -- 2. 事件（分页读全）--
  const events = await withReadRetry("registry.listEvents", () => readAllEvents(reader, request.datasetVersionId));
  if (events.length === 0) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_EMPTY_VERSION",
      `直读桥：dataset_version.id=${request.datasetVersionId} 无任何事件行（空数据集不可冒充可跑）。`,
    );
  }
  if (events.length > REGISTRY_BRIDGE_MAX_ROWS) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_ROW_BUDGET_EXCEEDED",
      `直读桥：dataset_version.id=${request.datasetVersionId} 事件数 ${events.length} 超直读护栏 ${REGISTRY_BRIDGE_MAX_ROWS}。`,
    );
  }

  // -- 3. rd=0 行情行（按 eventId 批量读）--
  const eventIds = events.map((e) => e.eventId);
  const dayZeroBars = await withReadRetry("registry.loadRawBarsBatch", () =>
    readEventDayBars(reader, request.datasetVersionId, eventIds),
  );

  // -- 4. 投影为宽行 + 确定性排序（tradeDate → securityId，bind 强校验此序）--
  const rows: ResearchDatasetRow[] = events.map((event) =>
    projectEventRow(event, dayZeroBars.get(event.eventId)),
  );
  rows.sort((a, b) =>
    a.tradeDate < b.tradeDate ? -1
      : a.tradeDate > b.tradeDate ? 1
        : a.securityId < b.securityId ? -1
          : a.securityId > b.securityId ? 1
            : 0,
  );

  // 唯一键自检（bind 会抛，但此处早失败能给出更指向性的错误）。
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1]!;
    const curr = rows[i]!;
    if (prev.tradeDate === curr.tradeDate && prev.securityId === curr.securityId) {
      throw new RegistryDatasetBridgeError(
        "REGISTRY_DUPLICATE_ROW",
        `直读桥：投影出重复行 (${curr.tradeDate}, ${curr.securityId})；ds_* 事件表违反「同证券同事件日唯一」假设。`,
      );
    }
  }

  // -- 5. universe / snapshot / policy（按真实投影内容重建，不臆造）--
  const startDate = version.startDate ?? rows[0]!.tradeDate;
  const endDate = version.endDate ?? rows[rows.length - 1]!.tradeDate;
  const normalizedRequest: NormalizedResearchDatasetRequest = normalizeResearchDatasetRequest({
    name: request.name,
    startDate,
    endDate,
    asOfPerTradeDate: true,
  });

  const universeDefinition = buildUniverseDefinitionFromRows(rows);
  const dataSnapshot = buildDataSnapshotFromRegistry(normalizedRequest, version, definition, rows);
  const datasetVersion = computeDatasetVersion(normalizedRequest, universeDefinition, rows);
  const policySet = derivePolicySet(normalizedRequest, dataSnapshot);

  const dataReady = request.dataReady ?? false;
  const gate = dataReady ? gateFromVersionStatus(version.status) : "INCONCLUSIVE";
  const gateNotes: string[] = [
    `数据来源=Dataset Registry 直读（dataset_version.id=${request.datasetVersionId} / ` +
      `${definition.datasetCode}@${version.version} / status=${version.status}）`,
    "POST_WINDOW_NOT_PROJECTED：ds_* 的 post（rd≥1）为未来信息，未并入逐日 PIT 面板；" +
      "需要 T+N 窗口撮合的策略应改用 buildResearchDataset 重建路径。",
  ];
  if (!dataReady) {
    gateNotes.push("dataReady=false：直读成功但未声明数据链就绪，仅冒烟口径（gate 恒 INCONCLUSIVE）。");
  }

  return {
    dataset: {
      datasetVersion,
      universeDefinition,
      policySet,
      dataSnapshot,
      rows,
      gate,
      gateNotes,
    },
    version,
    definition,
    // post 未投影 ⇒ 执行日无行情，撮合必拒（见字段注释与 `_probe_backtest_zero_trades.mts`）。
    executionBarsAvailable: false,
    stats: {
      eventCount: events.length,
      rowCount: rows.length,
      prefixBarsRead: dayZeroBars.size,
      versionStatus: version.status,
      datasetCode: definition.datasetCode,
      versionLabel: version.version,
    },
  };
}

/** 由真实行投影 universe：逐交易日成员 = 当日在场证券（升序去重）。 */
function buildUniverseDefinitionFromRows(rows: readonly ResearchDatasetRow[]): UniverseDefinition {
  const membersByDate = new Map<string, Set<string>>();
  for (const row of rows) {
    let set = membersByDate.get(row.tradeDate);
    if (set === undefined) {
      set = new Set<string>();
      membersByDate.set(row.tradeDate, set);
    }
    set.add(row.securityId);
  }
  const days: UniverseDayResult[] = [...membersByDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([tradeDate, set]) => ({
      tradeDate,
      isTradingDay: true,
      members: [...set].sort(),
      excludedByReason: {},
    }));
  return {
    rule: "Dataset Registry 直读：成员 = 该交易日 ds_first_limit_pullback_event 在场证券（首板回踩事件池）",
    asOfDescription: "逐日 PIT（asOf = tradeDate）",
    days,
  };
}

/** 由 Registry 事实 + 真实投影行数构建 data_snapshot（数字全部来自本投影，不是声明）。 */
function buildDataSnapshotFromRegistry(
  request: NormalizedResearchDatasetRequest,
  version: DatasetVersion,
  definition: DatasetDefinition,
  rows: readonly ResearchDatasetRow[],
): DataSnapshot {
  const dates = new Set(rows.map((r) => r.tradeDate));
  const securities = new Set(rows.map((r) => r.securityId));
  const withPrice = rows.filter((r) => r.close !== null).length;
  const withLiquidity = rows.filter((r) => r.turnoverRate !== null).length;

  const domains: DomainSnapshot[] = [
    {
      domain: "A OHLCV",
      rowsLoaded: withPrice,
      securitiesCovered: securities.size,
      datesCovered: dates.size,
      datesExpected: dates.size,
      note: "来自 ds_first_limit_pullback_prefix（relativeDay=0）；仅投影 rd=0 行。",
    },
    {
      domain: "E Liquidity",
      rowsLoaded: withLiquidity,
      securitiesCovered: securities.size,
      datesCovered: dates.size,
      datesExpected: dates.size,
      note: "来自 ds_first_limit_pullback_event 的 liquidity 富集列（turnover / marketCap / floatMarketCap）。",
    },
  ];

  return {
    capturedAt: new Date().toISOString(),
    request,
    calendarName: `dataset-version:${String(version.id ?? request.name)}`,
    calendarFirstDate: rows[0]?.tradeDate ?? request.startDate,
    calendarLastDate: rows[rows.length - 1]?.tradeDate ?? request.endDate,
    tradingDays: dates.size,
    domains,
    coverageGaps: [],
  };
}
