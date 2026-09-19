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
 *   1. **不新增第二套读取实现**：`ds_*` 五表的读取全部走 `server/datasetRegistry` 既有只读接口
 *      （`DatasetRegistryRepository` + `DatasetDataReader`），本文件**不写 `ds_*` SQL、不直连
 *      `ds_*` 物理表**。
 *      **唯一例外（2026-09-14 显式登记，非静默）**：身份桥接需要读研究域小表
 *      `research_security_identifier_history`（5,552 行），因为 `ds_*` 只有代码域 `symbol`、
 *      没有 canonical 身份列，而 registry 的读取接口没有「代码 → 身份」方法。
 *      该读取（`loadPrimaryIdentifiers`）**复用**既有映射 `identifierRowToSecurityIdentifier`、
 *      **复用**既有解析 `engineKeyBridge#resolveSecurityIdByEngineKey`（判定逻辑零新增），
 *      与 `closedLoopBacktestRun/securityLabels.ts` 同口径（同一张表、同一映射器）。
 *   2. **不猜不造**：`gate` 取自 `dataset_version.status`（READY → PASS，其余 → FAIL/
 *      INCONCLUSIVE 并如实记录原因）；缺行、缺窗口、缺身份一律**抛错**，绝不填零冒充。
 *   3. **内容即版本**：`datasetVersion` 由 `computeDatasetVersion(request, universeDefinition,
 *      rows)` 对**本次实际投影出的内容**重算 —— 与 `bindResearchDataset` 的强校验自洽
 *      （`assertDatasetVersionConsistent` 要求 `experimentConfig.datasetVersion` 与之相等，
 *      故装配层必须把「同一个对象」同时喂给 experimentConfig 与 inputs，见 assemble.ts）。
 *
 * 已知边界（诚实登记，不掩盖）：
 *   - `ds_*` 行是**事件级窗口**（relativeDay ∈ [-pre, +post]）。本桥按策略声明的观察窗口
 *     （`definition.entry.observationWindow`）把 **rd=0（首板日，特征基准）**
 *     ＋ **rd ∈ [1, end+1]（观察日 + 次日执行日）** 投影为逐日面板：
 *       · **决策日资格 = rd ∈ [start, end]**（候选只在这些日产生；rd=0 不进决策日，
 *         否则首板日当天 bars 只有一根、特征必然退化）；
 *       · **面板最多到 rd=end+1** —— 那是撮合的最小充分条件（订单在决策日下一交易日执行）。
 *     `prefix` 的 rd<0（特征窗口）**仍不进 rows**：它们既不构成决策日、也不是执行日，
 *     并入只会让同一证券/日期出现 rd=-20..-1 的重复候选（违反 `(tradeDate, securityId)` 唯一键）。
 *   - 🔴 **窗口末持仓**：观察窗口末决策建仓的持仓，在数据集内没有「下一决策日」⇒ 以
 *     `openAtEnd` 收尾（期末按最后可得收盘价估值）。这是「数据集只覆盖事件窗口」的固有边界。
 *   - 🔴 **观察日的换手/市值为 null**：`ds_*_post` 的 DDL 只承载原始日线
 *     （结构性 PIT 防线，`plugins.ts#rawBarCreateSql`），event 级富集列不可外推到观察日
 *     （外推 = 编数据）。本桥据此如实记 `knowledge.liquidity = UNKNOWN`。
 *   - 本桥只投影 OHLCV + `event` 中的时点属性；`st` / `industryName` /
 *     `lifecycleVerdict` 等 Registry 未落库的列，一律按**「未知」**忠实表达
 *     （`UNKNOWN` / null），不猜测、不填默认值。
 *   - 🔴 **身份键域（2026-09-14 修正）**：`securityId` 是 canonical `sec_<uuid>`（经
 *     Identifier History 桥接），`code` 才是 `event.symbol`。旧实现把代码同时写进两个字段，
 *     在直读成为默认路径后会让成交明细/留档的键域与重建路径分叉（名称全部退化为「—」）。
 *     详见 `resolveSecurityIdsByEvent` 上方注释。
 */

import { eq } from "drizzle-orm";
import { researchSecurityIdentifierHistory } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  DbDatasetDataReader,
  type DatasetDataReader,
  type DatasetRawBarRole,
} from "../datasetRegistry/query";
import { DbDatasetRegistry } from "../datasetRegistry/db";
import { defaultConcurrency, mapWithConcurrency } from "../datasetRegistry/concurrency";import type {
  DatasetDefinition,
  DatasetVersion,
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../datasetRegistry/types";
import { identifierRowToSecurityIdentifier } from "../historicalState/mappers";
import { withReadRetry } from "../researchEngine/readRetry";
import { canonicalCode, parseSecurityCode } from "../security/code";
import { resolveSecurityIdByEngineKey } from "../security/engineKeyBridge";
import type { SecurityIdentifier } from "../security/types";
import { computeDatasetVersion } from "../researchDataset/version";
// PARAMETER-001-PRE — 性能剖析（默认关闭；`PARAM_PROFILE=1` 才生效）。
import { perfCount, perfRun, perfRunAsync } from "../observability";
import { normalizeResearchDatasetRequest } from "../researchDataset/validate";
import { derivePolicySet } from "../researchDataset/policy";
import type {
  BoardCategory,
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

/**
 * 直读行数护栏（超过即拒绝直读，避免把百万行一次性拉进内存；调用方据错误码回落重建）。
 *
 * 🔴 2026-09-14 由 200,000 提高到 400,000：投影窗口从「仅 rd=0」扩到「rd ∈ [0, observationEnd+1]」后，
 * 390002（23,978 事件 / `post` rd≤20）的**逐日面板**实测为 354,544 行（见
 * `docs/evidence/_probe_bridge_window_cost.mts`）。若仍卡 20 万，`observationWindow.end ≥ 6`
 * 的策略会被护栏挡回重建 —— 那等于本次修复对它无效。400,000 覆盖 `end = 20` 的最坏情形
 * （post 表本身上限 rd=20），而**行数**才是内存成本的真正计量单位（原先误按事件数计量）。
 *
 * 计量对象 = 投影出的 `rows.length`（不是事件数）。
 */
export const REGISTRY_BRIDGE_MAX_ROWS = 400_000;

/**
 * `ds_*_post.relativeDay` 的结构上限（== 表内可用的最远观察日）。
 *
 * 依据：`plugins.ts#rawBarCreateSql` 生成的 post 表只承载 rd ≥ 1 的原始日线，390002 实测
 * rd ∈ [1, 20]（`docs/evidence/_probe_dataset_window_coverage.mts`）。策略声明的观察窗口
 * 若超出该上限，本桥**响亮拒绝**（`REGISTRY_OBSERVATION_WINDOW_INVALID`），不静默夹取。
 */
export const DATASET_POST_MAX_RELATIVE_DAY = 20;

/** 策略声明的观察窗口（相对事件日的**交易日**偏移；`start = 1` 即 T+1）。 */
export interface ObservationWindowSpec {
  readonly start: number;
  readonly end: number;
}

/**
 * 解析策略文档里的 `definition.entry.observationWindow`（🔴 唯一权威来源，禁自行编窗口）。
 *
 * 三种结果，互不混淆：
 *   - **未声明**（undefined / null / 非对象）⇒ 返回 `null` ⇒ 调用方按「该策略未声明观察窗口，
 *     无法确定需要投影多少 T+N 行情」拒绝直读并回落重建（**不猜窗口**）；
 *   - **声明了但非法**（unit ≠ TRADING_DAY / 非整数 / start < 1 / end < start / end > post 上限）
 *     ⇒ 抛 `REGISTRY_OBSERVATION_WINDOW_INVALID`（响亮；调用方据错误码回落并如实写入原因）；
 *   - **合法** ⇒ 返回 `{start, end}`。
 */
export function resolveObservationWindow(raw: unknown): ObservationWindowSpec | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_OBSERVATION_WINDOW_INVALID",
      `直读桥：策略文档的 definition.entry.observationWindow 不是对象（实为 ${JSON.stringify(raw)}）。`,
    );
  }
  const record = raw as Record<string, unknown>;
  const { start, end, unit } = record;
  if (
    unit !== "TRADING_DAY" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    (start as number) < 1 ||
    (end as number) < (start as number) ||
    (end as number) > DATASET_POST_MAX_RELATIVE_DAY
  ) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_OBSERVATION_WINDOW_INVALID",
      `直读桥：策略文档的 observationWindow = ${JSON.stringify(raw)} 非法` +
        `（要求 unit=TRADING_DAY、1 ≤ start ≤ end ≤ ${DATASET_POST_MAX_RELATIVE_DAY}）。` +
        `不静默夹取：窗口决定投影多少 T+N 行情，夹取会让「数据面」与「策略声明」不一致。`,
    );
  }
  return { start: start as number, end: end as number };
}

/** `dataset_version.status` → ResearchDatasetGate（唯一口径，不另行判定）。 */
function gateFromVersionStatus(status: DatasetVersion["status"]): ResearchDatasetGate {
  return status === "READY" ? "PASS" : "FAIL";
}

// ---------------------------------------------------------------------------
// 投影：ds_* 行 → ResearchDatasetRow
// ---------------------------------------------------------------------------

/**
 * `ds_*` 的 `symbol` → `ResearchDatasetRow` 的 **两个**字段（🔴 2026-09-14 修正）。
 *
 * **旧实现（错的）**：直接把 `event.symbol` 同时写进 `securityId` 与 `code`，并在注释里断言
 * 「`ds_*` 的 symbol 与 ResearchDatasetRow 的 securityId 键域一致」。**该断言是错的**：
 *   - `researchDataset/types.ts#ResearchDatasetRow`：`securityId: string` 是**身份**，
 *     `code: string | null` 才是「该日生效完整代码（如 600000.SH）」—— 两个不同字段；
 *   - canonical 身份 = `sec_<uuid>`（`drizzle/schema.ts#researchSecurities` 注释
 *     「永久身份（系统分配，如 sec_<uuid>）」）；
 *   - 重建路径（`researchDataset/db.ts#loadSecurities` 读 `research_securities`）产出的
 *     `row.securityId` **就是** `sec_<uuid>`；`datasetRegistry` 的 `ds_*` 三张表只有 `symbol`。
 *
 * 为什么以前没暴露：`executionBarsAvailable` 恒 false ⇒ 直读桥从不真被使用（恒回落重建）。
 * 2026-09-14 直读成为默认路径后，该赋值立即把「成交明细 securityId」变成**代码域**，
 * 而留档/展示层（`closedLoopBacktestRun/securityLabels.ts`、前端 `useSecurityLabels`）
 * 一律按 canonical 域解析 ⇒ 名称全部退化为「—」，且留档里新旧运行键域不一致。
 *
 * ⇒ 本桥改为经 **Identifier History 显式桥接**（复用既有单一实现
 * `server/security/engineKeyBridge.ts#resolveSecurityIdByEngineKey`，asOf-aware、PIT-safe、
 * 歧义即拒），输出 canonical `securityId`，`code` 仍是 `event.symbol`。
 *
 * 实库取证（`docs/evidence/_probe_symbol_identity_coverage.mts`，390002）：
 *   2,967 个 distinct symbol **100%** 能在其事件日解析到唯一 `sec_<uuid>`；
 *   `research_security_identifier_history` 仅 5,552 行（全 primary），可一次载入内存。
 */
function exchangeFromSymbol(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  return dot >= 0 ? symbol.slice(dot + 1).toUpperCase() : "UNKNOWN";
}

/**
 * 载入 primary 标识全量（5,552 行）用于 symbol → canonical identity 桥接。
 *
 * 为什么一次载全而不是 `WHERE (exchange, code) IN (...)`：表**极小**（实测 5,552 行 / 1.1s），
 * 而 2,967 个 symbol 分批 IN 反而引入批大小/顺序等可变口径。映射复用既有
 * `identifierRowToSecurityIdentifier`（`historicalState/mappers.ts`），不另写一套。
 */
async function loadPrimaryIdentifiers(): Promise<readonly SecurityIdentifier[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(researchSecurityIdentifierHistory)
    .where(eq(researchSecurityIdentifierHistory.identifierType, "primary"));
  return rows.map(identifierRowToSecurityIdentifier);
}

/**
 * 事件 → canonical `securityId`（`sec_<uuid>`），asOf = **该事件自己的 tradeDate**。
 *
 * 🔴 必须逐事件按自己的日期解析，不能「一 symbol 解一次」：code reuse（同一代码在不同
 * 历史区间归属不同证券）下，同一 symbol 的早/晚事件本就属于不同 identity。
 * 解析失败（无生效区间 / 多行歧义）**响亮抛错**——绝不退回用代码冒充身份。
 */
export function resolveSecurityIdsByEvent(
  events: readonly FirstLimitPullbackEvent[],
  identifiers: readonly SecurityIdentifier[],
): Map<string, string> {
  // 按 engineKey（`6位.交易所`）预索引，把 `resolveSecurityIdByEngineKey` 的线性过滤
  // 从 O(全量) 降到 O(该代码的分段数)；判定语义完全复用该函数本身（不另写判定）。
  const byEngineKey = new Map<string, SecurityIdentifier[]>();
  for (const identifier of identifiers) {
    let engineKey: string;
    try {
      engineKey = canonicalCode({ digits: identifier.code, exchange: identifier.exchange });
    } catch {
      continue; // 代码非法行不参与桥接（与 securityLabels 同口径：宁可 null，不产错代码）
    }
    const list = byEngineKey.get(engineKey);
    if (list === undefined) byEngineKey.set(engineKey, [identifier]);
    else list.push(identifier);
  }

  const resolved = new Map<string, string>();
  for (const event of events) {
    let engineKey: string;
    try {
      engineKey = canonicalCode(parseSecurityCode(event.symbol));
    } catch {
      throw new RegistryDatasetBridgeError(
        "REGISTRY_SECURITY_IDENTITY_UNRESOLVED",
        `直读桥：事件 ${event.eventId} 的 symbol=${JSON.stringify(event.symbol)} 不是合法完整代码，` +
          `无法桥接到 canonical securityId（回落重建并如实记录）。`,
      );
    }
    const segments = byEngineKey.get(engineKey);
    const lookup =
      segments === undefined
        ? ({ ok: false, reason: "NO_IDENTIFIER" } as const)
        : resolveSecurityIdByEngineKey(segments, engineKey, event.tradeDate);
    if (!lookup.ok) {
      throw new RegistryDatasetBridgeError(
        "REGISTRY_SECURITY_IDENTITY_UNRESOLVED",
        `直读桥：事件 ${event.eventId}（symbol=${event.symbol}）在 ${event.tradeDate} ` +
          `无法解析到唯一 canonical securityId（${lookup.reason}${
            lookup.reason === "AMBIGUOUS" ? ` / matches=${lookup.matches}` : ""
          }）。` +
          `🔴 不退回用代码冒充身份（那会让留档/成交明细键域与重建路径不一致）⇒ 回落重建并如实记录。`,
      );
    }
    resolved.set(event.eventId, lookup.securityId);
  }
  return resolved;
}

/**
 * 单条（事件 + 该事件某一相对日的行情）→ 宽行。
 *
 * 2026-09-14 泛化：不再固定 rd=0。`tradeDate` 必须是**该相对日的真实交易日**
 * （rd=0 → 事件日；rd=k≥1 → 事件日之后第 k 个交易日，取自 `ds_*_post.tradeDate`），
 * `preClose` 由「同一事件上一相对日的收盘价」链式给出（rd=0 用 `event.previousClose`）。
 * 🔴 禁止用 `event.tradeDate` 冒充 rd≥1 行的日期 —— 那会把未来行情伪装成决策日行情
 * （`asOf === tradeDate` 的 PIT 不变量会同时被破坏）。
 *
 * `securityId` 由调用方传入（canonical `sec_<uuid>`，见 `resolveSecurityIdsByEvent`）；
 * `code` 才是 `event.symbol`。**两者不可互换**。
 */
function projectEventRow(
  event: FirstLimitPullbackEvent,
  securityId: string,
  bar: FirstLimitPullbackRawBar | undefined,
  tradeDate: string,
  preClose: number | null,
  isEventDay: boolean,
): ResearchDatasetRow {
  return {
    tradeDate,
    // 逐日 PIT：asOf === tradeDate（bindResearchDataset 强校验此项）。
    asOf: tradeDate,
    securityId,
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

    // -- liquidity：**只有首板日（rd=0）行有值** —— turnover / 市值来自 `event` 表的富集列，
    //    而 `ds_*_post` 的 DDL 只承载原始日线（结构性 PIT 防线，见 plugins.ts#rawBarCreateSql）。
    //    ⇒ rd≥1 行一律 null（把首板日的换手率/市值盖到观察日上就是编数据）。--
    turnoverRate: liquidityOf(event, bar, isEventDay, "turnover"),
    circulationMarketCap: liquidityOf(event, bar, isEventDay, "floatMarketCap"),
    totalMarketCap: liquidityOf(event, bar, isEventDay, "marketCap"),
    liquidityAmount: bar?.amount ?? null,
    liquidityVolume: bar?.volume ?? null,

    // -- price（未复权 raw）：该相对日的 OHLCV，直拷（null 透传，禁止填零）。--
    open: bar?.open ?? null,
    high: bar?.high ?? null,
    low: bar?.low ?? null,
    close: bar?.close ?? null,
    preClose,
    volume: bar?.volume ?? null,
    amount: bar?.amount ?? null,

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
      liquidity: isEventDay && event.turnover !== null && event.turnover !== undefined ? "KNOWN" : "UNKNOWN",
      price: bar !== undefined && bar.close !== null ? "KNOWN" : "UNKNOWN",
      corporateActions: "UNKNOWN",
      marketState: "UNKNOWN",
    },
  };
}

/** 首板日（rd=0）才提供 event 级富集列；观察日如实 null（不拿首板日数值冒充观察日）。 */
function liquidityOf(
  event: FirstLimitPullbackEvent,
  bar: FirstLimitPullbackRawBar | undefined,
  isEventDay: boolean,
  field: "turnover" | "marketCap" | "floatMarketCap",
): number | null {
  if (!isEventDay) return null;
  const value = event[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// 投影：事件窗口 → 逐日面板（2026-09-14 起；撮合可行性的来源）
// ---------------------------------------------------------------------------

/**
 * **严格**合并列：同一 `(symbol, tradeDate)` 的多行必须完全一致，否则响亮抛错。
 * 这些是行身份本身（同一根 K 线的行情必须唯一）。
 */
type StrictPriceField = "open" | "high" | "low" | "close" | "volume" | "amount";

/**
 * 同一 `(symbol, tradeDate)` 的多行中取该严格列：**取有值者；两个不同非空值 ⇒ 响亮抛错**。
 *
 * 为什么不「随便取一个」：同一根 K 线的行情必须唯一；若真出现不一致，那说明 `ds_*` 内部
 * 自相矛盾，此时静默取舍就是把矛盾掩盖成「看起来正常的数据」。
 */
function pickMergedPrice(group: readonly WindowRow[], field: StrictPriceField): number | null {
  const values = new Set<number>();
  for (const item of group) {
    const value = item.row[field];
    if (typeof value === "number" && Number.isFinite(value)) values.add(value);
  }
  if (values.size > 1) {
    const head = group[0]!;
    throw new RegistryDatasetBridgeError(
      "REGISTRY_WINDOW_ROW_CONFLICT",
      `直读桥：(${head.tradeDate}, ${head.row.code ?? head.securityId}) 被多个事件窗口覆盖，但 ${field} 取值不一致` +
        `（${[...values].sort((a, b) => a - b).join(" / ")}）。同一根 K 线的行情必须唯一，此处拒绝编造取舍。`,
    );
  }
  return values.size === 1 ? [...values][0]! : null;
}

/**
 * `preClose` 合并（**派生列，不参与严格冲突判定**）。
 *
 * 口径：rd=0 行的前收 = `event.previousClose`（事件表）；rd≥1 行的前收 = 同事件 `rd-1` 行的 `close`。
 * 两个来源在真实数据上可能不一致（2026-09-14 实测 390002：**15 / 112,920 键 = 0.0133%**，
 * 详见 `docs/evidence/_probe_preclose_source_mismatch.mts`；样例 `601236.SH@2024-10-11`
 * 事件表 8.33 vs 行情链 8.38）。
 *
 * 🔴 处理原则：**前收不是行的身份**（行的身份 = 该交易日的 OHLCV），故不因它中止整个直读；
 * 但**也不编造**：确定性取「基准行（rd 最小者）」的值，基准行为 null 时取首个非空值，
 * 并把不一致键数**如实**写进 `stats` / `gateNotes`（对照「不静默、不掩盖」）。
 */
function pickMergedPreClose(group: readonly WindowRow[]): number | null {
  const base = group[0]!.row.preClose;
  if (typeof base === "number" && Number.isFinite(base)) return base;
  for (const item of group) {
    const value = item.row.preClose;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** 该键的多个来源是否给出**不一致**的前收（用于如实登记，不用于取舍）。 */
function hasPreCloseMismatch(group: readonly WindowRow[]): boolean {
  const values = new Set<number>();
  for (const item of group) {
    const value = item.row.preClose;
    if (typeof value === "number" && Number.isFinite(value)) values.add(value);
  }
  return values.size > 1;
}

/** 投影出的单行 + 它在**所属事件**里的相对日（相对日只用于「决策日资格」，不进 row）。 */
interface WindowRow {
  readonly eventId: string;
  readonly relativeDay: number;
  /** canonical 身份（`sec_<uuid>`）—— 去重键与成员键都用它，**不用**代码（code reuse 下同码不同身份）。 */
  readonly securityId: string;
  readonly tradeDate: string;
  readonly row: ResearchDatasetRow;
}

/** 事件窗口 → 逐日面板的投影结果。 */
export interface WindowProjection {
  /** 已按 `(tradeDate, securityId)` 升序去重的宽行（`bindResearchDataset` 强校验此序与唯一性）。 */
  readonly rows: ResearchDatasetRow[];
  /**
   * 「决策日资格」键集 = `<tradeDate>\u0000<symbol>`，取自 rd ∈ `[window.start, window.end]`
   * 的**原始**相对日 —— 注意**不是**去重后行的相对日：同一 `(symbol, tradeDate)` 可能由一个
   * 事件以 rd=2 覆盖、由另一事件以 rd=9 覆盖，只要**任一**事件给出 rd ∈ 观察窗口，该日
   * 就具备决策日资格（`ds_*` 是事件级窗口，同一根 K 线被多窗口覆盖是结构性事实）。
   */
  readonly memberKeys: ReadonlySet<string>;
  /** 去重前的候选行数（= 事件数 + post 行数，含重复覆盖）。 */
  readonly candidateCount: number;
  /**
   * 多个来源给出**不一致前收**的键数（如实登记的数据质量信号）。
   * 🔴 前收是派生列、不参与严格冲突判定（见 `pickMergedPreClose`）。
   */
  readonly preCloseMismatchKeys: number;
  /** 发生「同 (symbol, tradeDate) 多行合并」的键数。 */
  readonly mergedKeys: number;
}

function keyOf(tradeDate: string, securityId: string): string {
  return `${tradeDate}\u0000${securityId}`;
}

/**
 * 把事件的相对日窗口投影为 `ResearchDatasetRow` 逐日面板。
 *
 * 口径（🔴 改这里前必读）：
 *   1. **哪些行进面板**：rd = 0（首板日，来自 `prefix`，充当「特征基准 bars[0]」）
 *      ＋ rd ∈ [1, `window.end + 1`]（来自 `post`，观察日 + **次日执行日**）。
 *      `window.end + 1` 是撮合的最小充分条件：交易模拟在**决策日的下一交易日**执行订单
 *      （`simulator/engine.ts` 第 9(c) 步），决策日最大为 `window.end`。
 *   2. **哪些日具备决策日资格**：rd ∈ [window.start, window.end]（= 策略声明的
 *      `definition.entry.observationWindow`，实库为 `{start:1, end:3}`）。
 *      🔴 **rd=0 不进决策日**：首板日当天只有 bars=[rd0]，特征必然退化为
 *      `volumeRatio=1 / haircut=intraday`，放它进决策集会凭空造出「打板式」候选。
 *      同时这也让 `pullbackFeatures` 的文档口径（`bars[0]` = 首板日、序列末根 = 决策日）
 *      从「近似」变成**精确成立**。
 *   3. **去重**：`(symbol, tradeDate)` 必须唯一（同一根 K 线可能被多个事件窗口覆盖）。
 *      数值列按「取有值者、冲突即响亮抛错」合并（实库 390002 实测 102,727 个重复组
 *      `close` 极差合计 = 0 ⇒ 完全一致、无损）。
 *   4. **event 级富集列**（turnover / 市值）**只在 rd=0 行有值**：`ds_*_post` 的 DDL 只承载
 *      原始日线（结构性 PIT 防线，见 `plugins.ts#rawBarCreateSql`），把首板日的换手率/
 *      市值盖到观察日上就是**编数据** ⇒ rd≥1 行一律 null 并如实记 `knowledge.liquidity = UNKNOWN`。
 */
export function buildWindowRows(
  events: readonly FirstLimitPullbackEvent[],
  zeroBars: readonly FirstLimitPullbackRawBar[],
  postBars: readonly FirstLimitPullbackRawBar[],
  window: ObservationWindowSpec,
  /** eventId → canonical `sec_<uuid>`（见 `resolveSecurityIdsByEvent`）。缺键即抛，绝不退回代码。 */
  securityIds: ReadonlyMap<string, string>,
): WindowProjection {
  const zeroByEvent = new Map(zeroBars.map((bar) => [bar.eventId, bar]));
  const postByEvent = new Map<string, FirstLimitPullbackRawBar[]>();
  for (const bar of postBars) {
    const list = postByEvent.get(bar.eventId);
    if (list === undefined) postByEvent.set(bar.eventId, [bar]);
    else list.push(bar);
  }

  const candidates: WindowRow[] = [];
  const memberKeys = new Set<string>();

  for (const event of events) {
    const securityId = securityIds.get(event.eventId);
    if (securityId === undefined) {
      throw new RegistryDatasetBridgeError(
        "REGISTRY_SECURITY_IDENTITY_UNRESOLVED",
        `直读桥：事件 ${event.eventId} 未提供 canonical securityId（调用方必须先跑 ` +
          `resolveSecurityIdsByEvent）。🔴 不用代码冒充身份。`,
      );
    }
    // 该事件的相对日序列（rd 升序）：rd=0 来自 prefix，rd≥1 来自 post。
    const seq: FirstLimitPullbackRawBar[] = [];
    const zero = zeroByEvent.get(event.eventId);
    if (zero !== undefined) seq.push(zero);
    const post = postByEvent.get(event.eventId);
    if (post !== undefined) {
      post.sort((a, b) => a.relativeDay - b.relativeDay);
      for (const bar of post) seq.push(bar);
    }

    for (let index = 0; index < seq.length; index += 1) {
      const bar = seq[index]!;
      const tradeDate = bar.tradeDate;
      // 🔴 前收按**相对日**取（`rd - 1`），不是「数组里上一行」：若中间某个相对日行缺失，
      // 上一行是更早的一天，拿它当「上一交易日收盘」就是错的 ⇒ 缺失时如实 null。
      const isEventDay = bar.relativeDay === 0;
      const previousClose = isEventDay
        ? (event.previousClose ?? null)
        : (() => {
            const previous = seq.find((item) => item.relativeDay === bar.relativeDay - 1);
            return previous !== undefined && typeof previous.close === "number" && Number.isFinite(previous.close)
              ? previous.close
              : null;
          })();
      const row = projectEventRow(event, securityId, bar, tradeDate, previousClose, isEventDay);

      candidates.push({ eventId: event.eventId, relativeDay: bar.relativeDay, securityId, tradeDate, row });
      if (bar.relativeDay >= window.start && bar.relativeDay <= window.end) {
        memberKeys.add(keyOf(tradeDate, securityId));
      }
    }
  }

  // --- 去重：同一 (securityId, tradeDate) 的多行必须数值一致，否则响亮抛错 ---
  const byKey = new Map<string, WindowRow[]>();
  for (const candidate of candidates) {
    const key = keyOf(candidate.tradeDate, candidate.securityId);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [candidate]);
    else list.push(candidate);
  }

  const rows: ResearchDatasetRow[] = [];
  let mergedKeys = 0;
  let preCloseMismatchKeys = 0;
  for (const key of [...byKey.keys()].sort()) {
    const group = byKey.get(key)!;
    if (group.length === 1) {
      rows.push(group[0]!.row);
      continue;
    }
    mergedKeys += 1;
    // 基准行 = 排序后第一条（确定性）：优先 rd 小者，再按 eventId。
    group.sort((a, b) =>
      a.relativeDay !== b.relativeDay
        ? a.relativeDay - b.relativeDay
        : a.eventId < b.eventId
          ? -1
          : a.eventId > b.eventId
            ? 1
            : 0,
    );
    if (hasPreCloseMismatch(group)) preCloseMismatchKeys += 1;
    const base = group[0]!.row;
    rows.push({
      ...base,
      open: pickMergedPrice(group, "open"),
      high: pickMergedPrice(group, "high"),
      low: pickMergedPrice(group, "low"),
      close: pickMergedPrice(group, "close"),
      volume: pickMergedPrice(group, "volume"),
      amount: pickMergedPrice(group, "amount"),
      preClose: pickMergedPreClose(group),
    });
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

  return { rows, memberKeys, candidateCount: candidates.length, mergedKeys, preCloseMismatchKeys };
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
 * 批量读取事件的行情行（每批 EVENT_ID_BATCH_SIZE 个 eventId，**有界并发**）。
 *
 * 2026-09-14 由「只读 prefix rd=0」泛化为「按角色 + 相对日集合读」——因为**撮合需要执行日行情**，
 * 而 `post`（rd≥1）里本来就有（390002 实测 471,816 行 / OHLCV 完整）。
 *
 * 并发理由（实测）：23,978 事件 ÷ 1000 = 24 批，跨境 RTT ≈ 208ms ⇒ 纯串行 40s+。
 * 用既有 `mapWithConcurrency`（与构建链同一原语）叠起来后，墙钟 ≈ 串行的 1/(并发数)。
 * 结果按批序写入数组，与并发完成顺序无关（确定性）。
 */
async function readEventBars(
  reader: DatasetDataReader,
  datasetVersionId: number,
  eventIds: readonly string[],
  role: DatasetRawBarRole,
  relativeDays: readonly number[],
): Promise<FirstLimitPullbackRawBar[]> {
  const batches: string[][] = [];
  for (let i = 0; i < eventIds.length; i += EVENT_ID_BATCH_SIZE) {
    batches.push(eventIds.slice(i, i + EVENT_ID_BATCH_SIZE));
  }
  const results = await mapWithConcurrency(
    batches,
    (batch) =>
      batch.length === 0
        ? Promise.resolve<FirstLimitPullbackRawBar[]>([])
        : reader.loadRawBarsBatch(role, {
            datasetVersionId,
            eventIds: batch,
            relativeDays: [...relativeDays],
          }),
    RAW_BAR_READ_CONCURRENCY,
  );
  perfCount(`dataset.bar_read.${role}.batches`, batches.length);
  perfCount(`dataset.bar_read.${role}.concurrency`, RAW_BAR_READ_CONCURRENCY);
  const all: FirstLimitPullbackRawBar[] = [];
  for (const bars of results) for (const bar of bars) all.push(bar);
  return all;
}

// ---------------------------------------------------------------------------
// universe 约束继承（回落重建**不得**扩大证券范围）
// ---------------------------------------------------------------------------

/**
 * 数据集 universe 约束（从已绑定数据集继承，供回落重建使用）。
 * `boards` 空 = 不过滤（全板块含 unknown），与 `dataset_build_config_board`
 * 「空 = 不过滤」语义一致。
 */
export interface DatasetUniverseConstraint {
  readonly boards: BoardCategory[];
  readonly excludeSt: boolean;
  /** 取值来源（进审计说明）：`none` = 该数据集未声明约束。 */
  readonly source: "build-config" | "version-universe-definition" | "none";
}

/**
 * 🔴 可作为过滤白名单的板块取值。
 *
 * 不含 `unknown`：`classifyBoard` 对无法归类的代码返回 `unknown`，若把 `unknown`
 * 放进白名单就等于「放行一切无法识别的标的」—— 那不是窄化，是放宽。
 */
const SELECTABLE_BOARDS: readonly string[] = ["main", "chinext", "star", "bse"];

/**
 * universe 约束解析错误（元数据损坏 / DB 不可用）。
 *
 * 🔴 **刻意不是** `RegistryDatasetBridgeError`：后者是「可预期的『不该直读』」信号，
 * `assemble.ts#resolveDataset` 会据此**回落重建**。若约束解析失败也走那条路，就会在
 * 「约束读不出来」时**静默换成全市场**——正是本模块要堵的漏洞。故独立成类，直接冒泡。
 */
export class UniverseConstraintError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "UniverseConstraintError";
    this.code = code;
  }
}

/** 校验并去重板块取值；非法值**响亮抛错**（静默丢弃 = 悄悄放宽运行时范围）。 */
function assertSelectableBoards(raw: readonly unknown[], where: string): BoardCategory[] {
  const out: BoardCategory[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !SELECTABLE_BOARDS.includes(value)) {
      throw new UniverseConstraintError(
        "REGISTRY_UNIVERSE_CONSTRAINT_INVALID",
        `直读桥：${where} 含非法板块取值 ${JSON.stringify(value)}` +
          `（合法 = ${SELECTABLE_BOARDS.join("/")}）。` +
          `不静默丢弃：丢弃会**放宽**本次运行的证券范围，让回测跑在数据集之外的标的上。`,
      );
    }
    const board = value as BoardCategory;
    if (!out.includes(board)) out.push(board);
  }
  return out;
}

/**
 * 纯函数：按「权威优先」挑出 universe 约束。
 *
 * 优先级：`dataset_build_config`（生成参数，权威）> `dataset_version.universeDefinitionJson`
 * （版本自述）> 无约束。**不猜**：形状不符时一律视为「未声明」，绝不从字符串里抠板块。
 */
export function pickUniverseConstraint(
  buildConfig: { readonly boards: readonly string[]; readonly excludeSt: boolean } | null,
  versionUniverseDefinition: unknown,
): DatasetUniverseConstraint {
  if (buildConfig !== null) {
    return {
      boards: assertSelectableBoards(buildConfig.boards, "dataset_build_config_board"),
      excludeSt: buildConfig.excludeSt === true,
      source: "build-config",
    };
  }
  if (
    typeof versionUniverseDefinition === "object" &&
    versionUniverseDefinition !== null &&
    !Array.isArray(versionUniverseDefinition)
  ) {
    const record = versionUniverseDefinition as Record<string, unknown>;
    if (Array.isArray(record.boards)) {
      return {
        boards: assertSelectableBoards(
          record.boards,
          "dataset_version.universeDefinitionJson.boards",
        ),
        excludeSt: record.excludeSt === true,
        source: "version-universe-definition",
      };
    }
  }
  return { boards: [], excludeSt: false, source: "none" };
}

/**
 * 读取某已绑定数据集的 universe 约束（只读；走 Registry 既有只读接口）。
 *
 * 🔴 为什么需要：运行时的「直读不可撮合 ⇒ 回落 `buildResearchDataset` 重建」是一条
 * **以全市场证券池为默认**的路径。若不继承绑定数据集的板块/ST 约束，重建产物就会**扩大**
 * 证券范围（实测：绑定 `dataset_version.id=390002` 声明 `boards:["main"]`，回落重建却产出
 * `datasetSecurityCount=5146` 的全市场面板，成交明细里出现 300/301/688 标的）。
 *
 * `dataset_version` 不存在时返回 `none`（真正的原因由直读路径先行抛出，此处不掩盖）。
 */
export async function readDatasetUniverseConstraint(
  datasetVersionId: number,
): Promise<DatasetUniverseConstraint> {
  const db = await getDb();
  if (!db) {
    throw new UniverseConstraintError(
      "REGISTRY_UNIVERSE_CONSTRAINT_DB_UNAVAILABLE",
      "直读桥：数据库不可用（getDb()=null），无法读取数据集的 universe 约束（不静默按全市场重建）。",
    );
  }
  const registry = new DbDatasetRegistry();
  const [version, buildConfig] = await Promise.all([
    withReadRetry("registry.getVersionById", () => registry.getVersionById(datasetVersionId)),
    withReadRetry("registry.getBuildConfig", () => registry.getBuildConfig(datasetVersionId)),
  ]);
  if (version === undefined) {
    return { boards: [], excludeSt: false, source: "none" };
  }
  return pickUniverseConstraint(buildConfig ?? null, version.universeDefinition);
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 直读请求（调用方只给「已绑定坐标 + 策略声明的观察窗口」，其余一切由 Registry 事实决定）。 */
export interface BuildDatasetFromRegistryRequest {
  /** `dataset_version.id`（唯一坐标）。 */
  readonly datasetVersionId: number;
  /** 数据集名称（仅描述，不进版本指纹）。 */
  readonly name: string;
  /**
   * 🔴 策略声明的观察窗口（`definition.entry.observationWindow`，经 `resolveObservationWindow`
   * 校验后传入）。它决定：
   *   - 投影哪些行情进面板（rd=0 + rd ∈ [1, end+1]）⇒ **撮合可行性的来源**；
   *   - 哪些交易日具备「决策日资格」（rd ∈ [start, end]）⇒ 候选产生的位置。
   *
   * **未声明 / null ⇒ 本桥拒绝直读**（`REGISTRY_OBSERVATION_WINDOW_UNDECLARED`）：
   * 窗口是策略语义，桥无权代猜。
   */
  readonly observationWindow?: ObservationWindowSpec | null;
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
   * **2026-09-14 起由「恒 false」改为按真实投影判定**：面板现在含 rd ∈ [1, end+1]，
   * 而决策日最大 rd=`end`，交易模拟在**决策日的下一交易日**执行订单
   * （`simulator/engine.ts` 第 9(c) 步按执行日 `dayBars.get(securityId)` 取价）
   * ⇒ 执行日（rd ≤ end+1）**必有行** ⇒ `true`。
   *
   * 历史（为什么以前恒 false，证据 `docs/evidence/_probe_backtest_zero_trades.mts`）：
   * 旧投影只取 `prefix` 的 rd=0，任何证券在其事件日之外都没有行 ⇒
   * `registry` 路径 **59 单 → 59 单 SUSPENDED → 0 成交**，而 `rebuild` 同窗口
   * **133 笔成交 / 期末 112,169（+12.17%）** ⇒ 旧桥据此契约让调用方回落重建。
   *
   * ⇒ 调用方（`assemble.ts#resolveDataset`）**仅在 `false` 时**回落 `buildResearchDataset`。
   */
  readonly executionBarsAvailable: boolean;
  /** 直读实况（供装配摘要如实展示「从已落库数据集读了什么」）。 */
  readonly stats: {
    readonly eventCount: number;
    readonly rowCount: number;
    readonly prefixBarsRead: number;
    /** 本次读取的 post 行数（去重前）。 */
    readonly postBarsRead: number;
    /** 经 Identifier History 桥接出的 canonical `sec_<uuid>` 数（= 事件数）。 */
    readonly resolvedIdentityCount: number;
    /** 被多个事件窗口共同覆盖、发生合并的 (证券, 交易日) 键数。 */
    readonly mergedKeys: number;
    /** 多个来源给出**不一致前收**的键数（数据质量信号；前收是派生列，不参与严格冲突判定）。 */
    readonly preCloseMismatchKeys: number;
    /** 去重前的候选行数（事件数 + post 行数）。 */
    readonly candidateCount: number;
    /** 本次使用的观察窗口（来自策略声明）。 */
    readonly observationWindow: { readonly start: number; readonly end: number };
    /** 投影到的最远相对日（= 观察窗口末 + 1，即执行日）。 */
    readonly projectedRelativeDayMax: number;
    readonly versionStatus: string;
    readonly datasetCode: string;
    readonly versionLabel: string;
  };
}

/**
 * 从 Dataset Registry 直读已落库 `ds_*` 数据集，投影为 `ResearchDataset`。
 *
 * 失败响亮（全部抛 `RegistryDatasetBridgeError`，附稳定错误码）：
 *   - `REGISTRY_DB_UNAVAILABLE` —— `getDb()` 为 null；
 *   - `REGISTRY_VERSION_NOT_FOUND` —— `dataset_version.id` 不存在；
 *   - `REGISTRY_VERSION_NOT_READY` —— 行存在但 status ≠ READY；
 *   - `REGISTRY_DEFINITION_MISSING` —— 版本所属 dataset_definition 缺失；
 *   - `REGISTRY_DATASET_CODE_UNSUPPORTED` —— datasetCode ≠ `first_limit_pullback`
 *     （本桥只实现首板回踩体系；其他体系不冒充支持）；
 *   - `REGISTRY_OBSERVATION_WINDOW_UNDECLARED` —— 策略未声明 `definition.entry.observationWindow`
 *     （本桥不猜窗口）；
 *   - `REGISTRY_OBSERVATION_WINDOW_INVALID` —— 窗口结构非法（非 TRADING_DAY / 非整数 / end 超 post 上限）；
 *   - `REGISTRY_EMPTY_VERSION` —— 版本无任何 event 行（空数据集不冒充可跑）；
 *   - `REGISTRY_POST_WINDOW_MISSING` / `REGISTRY_POST_WINDOW_TOO_SHORT` —— post 无行 /
 *     观察窗口要求超出该版本 post 的真实相对日上限（**不静默夹取窗口**）；
 *   - `REGISTRY_SECURITY_IDENTITY_UNRESOLVED` —— 事件 symbol 无法在其 tradeDate 解析到唯一
 *     canonical `sec_<uuid>`（无生效区间 / 歧义）。**不退回用代码冒充身份**；
 *   - `REGISTRY_WINDOW_ROW_CONFLICT` —— 同一 `(securityId, tradeDate)` 的多个事件来源给出
 *     不一致的**严格列**（OHLCV/量额）；
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
  const version = await perfRunAsync("dataset.version_and_definition", () =>
    withReadRetry("registry.getVersionById", () => registry.getVersionById(request.datasetVersionId)),
  );
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

  const definition = await perfRunAsync("dataset.definition_read", () =>
    withReadRetry("registry.getDefinitionById", () => registry.getDefinitionById(version.datasetId)),
  );
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

  // -- 2. 观察窗口：🔴 必须由**策略声明**给出，本桥不猜 --
  const window = request.observationWindow;
  if (window === null || window === undefined) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_OBSERVATION_WINDOW_UNDECLARED",
      `直读桥：策略未声明 definition.entry.observationWindow ⇒ 无法确定需要投影多少 T+N 观察/执行行情。` +
        `本桥不猜窗口（猜错会让「数据面」与策略声明不一致），由调用方回落重建并如实记录原因。`,
    );
  }

  // -- 3. 事件（分页读全）--
  const events = await perfRunAsync("dataset.events_page", () =>
    withReadRetry("registry.listEvents", () => readAllEvents(reader, request.datasetVersionId)),
  );
  if (events.length === 0) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_EMPTY_VERSION",
      `直读桥：dataset_version.id=${request.datasetVersionId} 无任何事件行（空数据集不可冒充可跑）。`,
    );
  }

  // -- 4. 该版本 post 的真实相对日范围（决定「观察窗口 + 执行日」能不能被满足）--
  const postRange = await perfRunAsync("dataset.post_range", () =>
    withReadRetry("registry.getPostRelativeDayRange", () =>
      reader.getPostRelativeDayRange(request.datasetVersionId),
    ),
  );
  if (postRange === null) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_POST_WINDOW_MISSING",
      `直读桥：dataset_version.id=${request.datasetVersionId} 的 post 表无任何行 ⇒ 无 T+N 观察/执行行情，` +
        `无法支撑撮合（回落重建并如实记录）。`,
    );
  }
  /** 需要投影的最远相对日 = 观察窗口末 + 1（决策日下一交易日执行）。 */
  const neededMaxRelativeDay = window.end + 1;
  if (neededMaxRelativeDay > postRange.max) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_POST_WINDOW_TOO_SHORT",
      `直读桥：策略声明的观察窗口 end=${window.end} 需要 post rd ≤ ${neededMaxRelativeDay}，` +
        `但 dataset_version.id=${request.datasetVersionId} 的 post 最大 rd=${postRange.max}。` +
        `🔴 不静默夹取窗口（夹取 = 把策略声明悄悄改窄）⇒ 回落重建，由调用方如实记录原因。`,
    );
  }

  // -- 5. 身份桥接：symbol（代码域）→ canonical securityId（`sec_<uuid>`）--
  //     🔴 必须先解析身份，再投影行 —— 行里的 securityId 是**身份**、code 才是代码；
  //     解析失败（无生效区间 / 多行歧义）响亮抛错，不退回代码冒充身份。
  const identifiers = await perfRunAsync("dataset.identity_bridge.read_identifiers", () =>
    withReadRetry("registry.loadPrimaryIdentifiers", () => loadPrimaryIdentifiers()),
  );
  const securityIds = perfRun("dataset.identity_bridge.resolve", () =>
    resolveSecurityIdsByEvent(events, identifiers),
  );

  // -- 6. 行情行：prefix rd=0（首板日，充当特征基准 bars[0]）+ post rd ∈ [1, end+1]（观察日 + 次日执行日）--
  const eventIds = events.map((e) => e.eventId);
  const postRelativeDays = Array.from({ length: neededMaxRelativeDay }, (_, i) => i + 1);
  const [dayZeroBars, postBars] = await perfRunAsync("dataset.bar_read", () =>
    withReadRetry("registry.loadRawBarsBatch", () =>
      Promise.all([
        perfRunAsync("dataset.bar_read.prefix", () =>
          readEventBars(reader, request.datasetVersionId, eventIds, "prefix", [0]),
        ),
        perfRunAsync("dataset.bar_read.post", () =>
          readEventBars(reader, request.datasetVersionId, eventIds, "post", postRelativeDays),
        ),
      ]),
    ),
  );

  // -- 7. 投影为逐日面板（去重 + 决策日资格）--
  const projection = perfRun("dataset.projection", () =>
    buildWindowRows(events, dayZeroBars, postBars, window, securityIds),
  );
  perfCount("dataset.events", events.length);
  perfCount("dataset.rows_raw", projection.candidateCount);
  perfCount("dataset.rows_deduped", projection.rows.length);
  perfCount("dataset.bars_prefix", dayZeroBars.length);
  perfCount("dataset.bars_post", postBars.length);
  const rows = projection.rows;
  if (rows.length > REGISTRY_BRIDGE_MAX_ROWS) {
    throw new RegistryDatasetBridgeError(
      "REGISTRY_ROW_BUDGET_EXCEEDED",
      `直读桥：dataset_version.id=${request.datasetVersionId} 投影出 ${rows.length} 行，` +
        `超直读护栏 ${REGISTRY_BRIDGE_MAX_ROWS}（调用方应回落重建）。`,
    );
  }

  // -- 8. universe / snapshot / policy（按真实投影内容重建，不臆造）--
  const startDate = version.startDate ?? rows[0]!.tradeDate;
  const endDate = version.endDate ?? rows[rows.length - 1]!.tradeDate;
  const normalizedRequest: NormalizedResearchDatasetRequest = normalizeResearchDatasetRequest({
    name: request.name,
    startDate,
    endDate,
    asOfPerTradeDate: true,
  });

  const universeDefinition = perfRun("dataset.universe_build", () =>
    buildUniverseDefinitionFromRows(rows, projection.memberKeys),
  );
  const dataSnapshot = perfRun("dataset.data_snapshot", () =>
    buildDataSnapshotFromRegistry(
      normalizedRequest,
      version,
      definition,
      rows,
      window,
      neededMaxRelativeDay,
    ),
  );
  perfCount("dataset.universe_days", universeDefinition.days.length);
  const datasetVersion = perfRun("dataset.version_fingerprint", () =>
    computeDatasetVersion(normalizedRequest, universeDefinition, rows),
  );
  const policySet = perfRun("dataset.policy_set", () => derivePolicySet(normalizedRequest, dataSnapshot));

  const dataReady = request.dataReady ?? false;
  const gate = dataReady ? gateFromVersionStatus(version.status) : "INCONCLUSIVE";
  const gateNotes: string[] = [
    `数据来源=Dataset Registry 直读（dataset_version.id=${request.datasetVersionId} / ` +
      `${definition.datasetCode}@${version.version} / status=${version.status}）`,
    `观察窗口投影：策略声明 rd ∈ [${window.start}, ${window.end}] ⇒ 面板含 rd=0（首板日，特征基准）` +
      `+ rd ∈ [1, ${neededMaxRelativeDay}]（观察日 + 次日执行日）；**决策日资格 = rd ∈ [${window.start}, ${window.end}]**。`,
    `OBSERVATION_DAY_LIQUIDITY_UNKNOWN：post（rd≥1）行的 turnover / marketCap / floatMarketCap 为 NULL —— ` +
      `ds_*_post 的 DDL 只承载原始日线（结构性 PIT 防线，见 plugins.ts#rawBarCreateSql），` +
      `把首板日数值盖到观察日上就是编数据。本投影如实记 knowledge.liquidity = UNKNOWN。`,
    `WINDOW_TAIL_OPEN_POSITION：观察窗口末（rd=${window.end}）决策建仓的持仓在数据集内没有` +
      `「下一决策日」，会以 openAtEnd 收尾（期末按最后可得收盘价估值）—— 这是「数据集只覆盖事件窗口」` +
      `的固有边界，不是撮合失败。`,
  ];
  if (projection.mergedKeys > 0) {
    gateNotes.push(
      `事件窗口重叠：${projection.mergedKeys} 个 (证券, 交易日) 键被多个事件窗口共同覆盖，` +
        `按「严格列（open/high/low/close/volume/amount）必须完全一致、不一致即抛 REGISTRY_WINDOW_ROW_CONFLICT」` +
        `+「基准行（rd 最小者）优先」合并；实库 390002 实测 OHLCV 数值完全一致、无损。`,
    );
  }
  if (projection.preCloseMismatchKeys > 0) {
    gateNotes.push(
      `PRECLOSE_SOURCE_MISMATCH：${projection.preCloseMismatchKeys} 个 (证券, 交易日) 键的多个来源给出` +
        `**不一致的 previousClose**（同一交易日既是某事件的 rd=0、又是另一事件的 rd≥1，两处前收基准不同）。` +
        `前收不是行的身份（行的身份 = 该交易日 OHLCV），故不因它中止直读；但**也不编造** —— ` +
        `确定性取基准行（rd 最小）的值并在此如实登记。实库 390002 实测 15 / 112,920 键 = 0.0133%。`,
    );
  }
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
    // 已投影 rd ∈ [1, end+1] ⇒ 决策日（最大 rd=end）的下一交易日（rd ≤ end+1）必有行 ⇒ 可撮合。
    executionBarsAvailable: postBars.length > 0,
    stats: {
      eventCount: events.length,
      rowCount: rows.length,
      prefixBarsRead: dayZeroBars.length,
      postBarsRead: postBars.length,
      /** 经 Identifier History 桥接出的 canonical identity 数（= 事件数；解析失败会先抛错）。 */
      resolvedIdentityCount: securityIds.size,
      mergedKeys: projection.mergedKeys,
      preCloseMismatchKeys: projection.preCloseMismatchKeys,
      candidateCount: projection.candidateCount,
      observationWindow: { start: window.start, end: window.end },
      projectedRelativeDayMax: neededMaxRelativeDay,
      versionStatus: version.status,
      datasetCode: definition.datasetCode,
      versionLabel: version.version,
    },
  };
}

/**
 * 由真实行投影 universe：**天 = 面板里出现过的所有交易日**（含仅供执行的 rd=end+1 日），
 * **成员 = 具备「决策日资格」的证券**（rd ∈ 策略声明的观察窗口，见 `WindowProjection.memberKeys`）。
 *
 * 🔴 这两件事**刻意不同**：成员决定「哪天允许产生候选」（策略语义），天决定「模拟推进到哪天」
 * （估值 / 执行边界）。若把成员也放开到 rd=end+1，就会把策略声明悄悄放宽一天 —— 反之若
 * 把天裁到只含成员日，收盘估值与执行都无处落。
 */
function buildUniverseDefinitionFromRows(
  rows: readonly ResearchDatasetRow[],
  memberKeys: ReadonlySet<string>,
): UniverseDefinition {
  const dates = new Set<string>();
  const membersByDate = new Map<string, Set<string>>();
  for (const row of rows) {
    dates.add(row.tradeDate);
    if (!memberKeys.has(`${row.tradeDate}\u0000${row.securityId}`)) continue;
    let set = membersByDate.get(row.tradeDate);
    if (set === undefined) {
      set = new Set<string>();
      membersByDate.set(row.tradeDate, set);
    }
    set.add(row.securityId);
  }
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
      "Dataset Registry 直读：成员 = 该交易日处在**策略声明的观察窗口**内（rd ∈ observationWindow）的" +
      "首板回踩事件池证券；事件日当天（rd=0）与仅供执行的 rd=end+1 日不具备决策日资格（成员为空）",
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
  window: ObservationWindowSpec,
  projectedRelativeDayMax: number,
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
      note:
        `来自 ds_first_limit_pullback_prefix（rd=0，首板日 = 特征基准 bars[0]）` +
        `+ ds_first_limit_pullback_post（rd ∈ [1, ${projectedRelativeDayMax}]，观察日 + 次日执行日）。`,
    },
    {
      domain: "E Liquidity",
      rowsLoaded: withLiquidity,
      securitiesCovered: securities.size,
      datesCovered: dates.size,
      datesExpected: dates.size,
      note:
        `仅**首板日行**携带（来自 ds_first_limit_pullback_event 的 turnover / marketCap / floatMarketCap 富集列）；` +
        `观察日（rd ≥ ${Math.max(window.start, 1)}）行如实为 null —— ds_*_post 只承载原始日线，不承载换手/市值。`,
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
