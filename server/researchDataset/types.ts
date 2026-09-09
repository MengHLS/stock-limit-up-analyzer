/**
 * STEP 12.6 — Research Dataset Certification：领域类型（唯一权威来源）。
 *
 * 目标（ROADMAP §12 / §45.2 / C-12.6.1）：把 Canonical Data（A~G）+ Historical State
 * （STEP 12.5，server/historicalState）组装为「Research Dataset」——Signal / Backtest /
 * Optimization / Evaluation / WFA / OOS 的标准输入，禁止策略直接拼接多张原始表。
 *
 * 本文件只定义类型与校验，不承载 IO / 策略 / 因子 / 回测逻辑。
 *
 * 设计要点（与 C-12.5.1/12.5.2 一致的反泄漏纪律）：
 *   - 行粒度 = (tradeDate, securityId)。dataset 行 = SecurityHistoricalState 的扁平化
 *     「标准输入」投影（宽行），只含研究所需字段，不含 audit/调试专用内部结构。
 *   - universe_definition = 每一交易日 resolveHistoricalUniverse（STEP 11 canonical，
 *     PIT asOf + calendar T+1）决议出的可交易成员集合 + 排除统计；禁止在此层发明新语义。
 *   - data_snapshot = 真实 DB 加载事实（各域行数 / 证券数 / 日期覆盖 / 缺失与重复统计），
 *     诚实记录 C/D/E/G 未全量时的部分覆盖，绝不冒充 FULL。
 *   - dataset_version = 由请求 + 内容指纹派生的确定性版本（见 version.ts），内容变化则版本变化。
 *
 * 状态纪律：C-12.6.1 编码链只到 CODE_READY；DATA_READY / VALIDATED 由 G1（A~H 全
 * DATA_READY）与 §0.2 汇合后按 gate 判定，禁止越级。
 */

import type { CanonicalMarketBar } from "../data/types";
import type { Security, SecurityIdentifier } from "../security/types";
import type { SecurityStatusInterval } from "../securityStatus/types";
import type {
  IndustryAssignment,
  IndexDailyBar,
  IndexMasterEntry,
  LiquidityDaily,
} from "../marketData/types";
import type { CorporateAction } from "../corporateActions/types";
import type { ResearchDatasetPolicy } from "./policy";

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

/**
 * Research Dataset 构建请求（纯数据、只读）。
 *
 * @remarks 研究口径必须显式选择 asOf 策略：
 *   - `asOfPerTradeDate = true`（推荐，默认）：每行 asOf = 该 tradeDate（逐日 PIT，
 *     每个交易日只用当日可知信息，杜绝 look-ahead）；universe 同日 PIT。
 *   - `asOfPerTradeDate = false`：全窗口固定 asOf（需显式给 asOf），用于「冻结快照」类
 *     数据集（如只用 2026-09-04 已知信息评估整段历史）。未给 asOf 且为 false 时校验报错。
 */
export interface ResearchDatasetRequest {
  /** 数据集名称（如 "universe-tradable-daily"）。仅描述，不进版本指纹。 */
  name: string;
  /** 起止日期（YYYY-MM-DD，含）。 */
  startDate: string;
  endDate: string;
  /** 逐日 PIT（默认 true）；false 时须显式提供 asOf。 */
  asOfPerTradeDate?: boolean;
  /** 固定 asOf（仅 asOfPerTradeDate=false 时使用）。 */
  asOf?: string | null;
  /** 市场状态核心指数代码集合（默认 4 大基准）。 */
  coreIndexCodes?: string[];
  /** universe 过滤层（板块 / ST / T 日条件）；省略 = 全量可交易池。 */
  universeFilter?: UniverseFilter;
}

/**
 * 市场板块类别（与 server/data/boardRules classifyBoard 输出一致）。
 * main=主板（60/000/001/002/003）、chinext=创业板（300/301）、star=科创板（688/689）、
 * bse=北交所（920/43/83/87/88/4/8）、unknown=无法归类。
 */
export type BoardCategory = "main" | "chinext" | "star" | "bse" | "unknown";

/** T 日条件（T 日信号过滤口径，纯信号筛选，不改变 eligibility 判定）。 */
export type TDayCondition = "none" | "limitUp" | "firstBoard" | "consecutiveBoard";

/** 回踩目标位类型（可多选）。 */
export const PULLBACK_TARGET_TYPES = ["limitPrice", "t0Open", "t0Low", "ma5"] as const;
export type PullbackTargetType = (typeof PULLBACK_TARGET_TYPES)[number];

/**
 * 回踩筛选条件（在「首板」事件 T0 之上，对 T+1~T+N 观察窗口做「触及且不破」判定）。
 * 纯信号窄化，不改变 eligibility 判定；量化语义（目标位价格 / 触及 / 跌破）由后端权威判定。
 */
export interface PullbackScreenCondition {
  /** 回踩目标位（可多选，任一命中即视为回踩）。 */
  targetTypes: PullbackTargetType[];
  /** 触及容差（%）：最低价允许落在 [目标位, 目标位×(1+容差)]。 */
  tolerancePercent: number;
  /** 观察窗口交易日数 N（T+1 ~ T+N）。 */
  observationWindowDays: number;
}

/**
 * 数据集 universe 过滤层（在 STEP 11 可交易决议之上叠加的可选窄化）。
 * 只承载「保留/排除」声明，量化语义（板块归类 / ST / 涨停 / 回踩）一律由后端权威判定，
 * 前端仅传选择，不实现、不重算。
 */
export interface UniverseFilter {
  /** 仅保留这些板块；空数组 = 不过滤（全板块含 unknown）。 */
  boards?: BoardCategory[];
  /** 排除 ST / *ST（PIT st 维度，不依赖股票名称）。 */
  excludeSt?: boolean;
  /** T 日条件（默认 none = 不做信号筛选）。 */
  tDayCondition?: TDayCondition;
  /** 首板回踩条件（默认 null = 不做回踩筛选；仅当 tDayCondition=firstBoard 时生效）。 */
  pullback?: PullbackScreenCondition | null;
}

/** 已规范化（默认值已应用）的 universe 过滤层。 */
export interface NormalizedUniverseFilter {
  boards: BoardCategory[];
  excludeSt: boolean;
  tDayCondition: TDayCondition;
  pullback: PullbackScreenCondition | null;
}

/** 已规范化（默认值已应用）的请求。 */
export interface NormalizedResearchDatasetRequest extends ResearchDatasetRequest {
  asOfPerTradeDate: boolean;
  asOf: string | null;
  coreIndexCodes: string[];
  universeFilter: NormalizedUniverseFilter;
}

/** 请求校验错误（确定性列表）。 */
export interface ResearchDatasetRequestIssue {
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// 输入（供 DB 层一次性全量加载后喂给纯函数）
// ---------------------------------------------------------------------------

/**
 * Research Dataset 构建所需的静态输入（纯数据、只读；调用方从 DB 一次性加载）。
 * 与 HistoricalStateInput 的区别：universe 决议需要全市场 securities/identifiers/status，
 * 而单标的 asOf 状态重建复用 reconstruct 语义（identity/lifecycle/tradability 一致）。
 */
export interface ResearchDatasetInput {
  /** 全市场证券主数据（身份）。 */
  securities: readonly Security[];
  /** 全市场标识符历史。 */
  identifiers: readonly SecurityIdentifier[];
  /** 全市场历史状态区间。 */
  statusIntervals: readonly SecurityStatusInterval[];
  /** 行业区间（code 键；可空=域未加载）。 */
  industryAssignments?: readonly IndustryAssignment[];
  /** 公司行为事件集（code 键；可空=域未加载）。 */
  corporateActions?: readonly CorporateAction[];
  /** 核心指数身份（供名称解析）。 */
  indexMaster?: readonly IndexMasterEntry[];
}

/** 某交易日全市场 code 键日级事实（price/liquidity/index 一次查询拉全市场）。 */
export interface DateFacts {
  tradeDate: string;
  /** code（完整代码，如 600000.SH）→ 日线 bar。 */
  priceByCode: ReadonlyMap<string, CanonicalMarketBar>;
  /** code → 流动性日线。 */
  liquidityByCode: ReadonlyMap<string, LiquidityDaily>;
  /** 当日核心指数日线。 */
  indexBars: readonly IndexDailyBar[];
}

// ---------------------------------------------------------------------------
// Universe Definition
// ---------------------------------------------------------------------------

/** 单交易日 universe 决议结果（成员 + 排除统计）。 */
export interface UniverseDayResult {
  tradeDate: string;
  isTradingDay: boolean;
  /** 可交易成员 securityId（确定性排序：exchange → code → securityId）。 */
  members: readonly string[];
  /** 排除统计（reason → 数量），按 reason code 升序。 */
  excludedByReason: Readonly<Record<string, number>>;
}

/** Research Dataset 的 universe_definition（规则 + 逐日结果）。 */
export interface UniverseDefinition {
  /** 规则描述（人类可读 + 稳定 code）。 */
  rule: string;
  /** PIT 口径描述。 */
  asOfDescription: string;
  /** 逐日结果（按 tradeDate 升序）。 */
  days: readonly UniverseDayResult[];
}

// ---------------------------------------------------------------------------
// Dataset Row（标准输入宽行）
// ---------------------------------------------------------------------------

/**
 * Research Dataset 标准行：(tradeDate, securityId) 扁平化投影。
 * 数值/单位与 canonical 一致（price 元、volume 手、amount 千元、turnover %、marketCap 元）；
 * 缺失 = null，禁止填零/伪造。corporateActions 只带 PIT 可知事件的轻量摘要 + 键列表。
 */
export interface ResearchDatasetRow {
  tradeDate: string;
  /** 该行实际使用的 asOf（逐日 PIT 时 = tradeDate）。 */
  asOf: string;
  securityId: string;
  /** 该日生效完整代码（如 600000.SH）；无生效标识符为 null。 */
  code: string | null;

  // -- identity / lifecycle（Q1~Q3）--
  securityType: string;
  exchange: string;
  lifecycleVerdict: "LISTED" | "NOT_YET_LISTED" | "DELISTED" | "UNKNOWN";

  // -- tradability（Q5）--
  eligible: boolean;
  /** eligible=false 时的稳定剔除原因；eligible=true 为 null。 */
  exclusionReason: string | null;
  st: "NORMAL" | "ST" | "*ST" | "UNKNOWN";

  // -- industry（Q4）--
  industryCode: string | null;
  industryName: string | null;

  // -- liquidity（Q6）--
  turnoverRate: number | null;
  circulationMarketCap: number | null;
  totalMarketCap: number | null;
  liquidityAmount: number | null;
  liquidityVolume: number | null;

  // -- price（Q7，未复权 raw）--
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  preClose: number | null;
  volume: number | null;
  amount: number | null;

  // -- corporate actions（Q8，PIT 已知摘要）--
  corporateActionsEffectiveCount: number;
  corporateActionsKnownCount: number;

  // -- market state（Q9）--
  /** 当日核心指数涨跌相关（close 值，按 indexCode 升序）。 */
  indexClose: Readonly<Record<string, number>>;

  // -- knowledge（Q10）--
  knowledge: {
    policy: "PIT" | "FULL_KNOWLEDGE";
    listing: "KNOWN" | "UNKNOWN";
    delisting: "KNOWN" | "UNKNOWN";
    tradability: "KNOWN" | "UNKNOWN";
    industry: "KNOWN" | "UNKNOWN";
    liquidity: "KNOWN" | "UNKNOWN";
    price: "KNOWN" | "UNKNOWN";
    corporateActions: "KNOWN" | "UNKNOWN";
    marketState: "KNOWN" | "UNKNOWN";
  };
}

// ---------------------------------------------------------------------------
// Data Snapshot
// ---------------------------------------------------------------------------

/** 单个数据域的加载事实。 */
export interface DomainSnapshot {
  /** 域标签（A OHLCV / B Master / C Status / D CA / E Liquidity / F Index / G Industry）。 */
  domain: string;
  /** 该请求窗口内实际加载行数。 */
  rowsLoaded: number;
  /** 窗口内 distinct 证券数（code 键域以 code 计）。 */
  securitiesCovered: number;
  /** 窗口内 distinct 交易日数。 */
  datesCovered: number;
  /** 期望交易日数（请求窗口 ∩ 日历）。 */
  datesExpected: number;
  /** 说明（诚实记录部分覆盖 / FULL）。 */
  note: string;
}

/** Research Dataset 的 data_snapshot（真实加载事实，非声明）。 */
export interface DataSnapshot {
  capturedAt: string;
  request: NormalizedResearchDatasetRequest;
  calendarName: string;
  calendarFirstDate: string;
  calendarLastDate: string;
  /** 请求窗口实际交易天数。 */
  tradingDays: number;
  /** 逐域快照（按 A~G 顺序）。 */
  domains: readonly DomainSnapshot[];
  /** 任何域存在「日期覆盖缺口」或证券数为 0 的标记（供 gate 用）。 */
  coverageGaps: string[];
}

// ---------------------------------------------------------------------------
// Artifact / Gate
// ---------------------------------------------------------------------------

/** 构建 gate：FAIL（有失败）/ PASS（无失败 + dataReady=true + 无覆盖缺口）/ INCONCLUSIVE。 */
export type ResearchDatasetGate = "FAIL" | "PASS" | "INCONCLUSIVE";

/** Research Dataset 完整产出物。 */
export interface ResearchDataset {
  datasetVersion: string;
  universeDefinition: UniverseDefinition;
  /** §12 策略元数据集（9 类，确定性顺序）——与 dataset_version/data_snapshot 绑定的
   *  机器可读口径声明（PIT/survivorship/corporate-action/adjustment/industry/liquidity/
   *  universe-membership/calendar-trading-days/knowledge），见 ./policy.ts 与 ./policyValidate.ts。 */
  policySet: readonly ResearchDatasetPolicy[];
  dataSnapshot: DataSnapshot;
  /** 标准行（按 tradeDate → securityId 确定性排序）。 */
  rows: readonly ResearchDatasetRow[];
  gate: ResearchDatasetGate;
  /** gate 说明（INCONCLUSIVE/FAIL 原因）。 */
  gateNotes: readonly string[];
}

/** 构建选项。 */
export interface BuildResearchDatasetOptions {
  /** 声明数据链已就绪（A~H 全 DATA_READY）；无覆盖缺口时 gate 才可 PASS。 */
  dataReady?: boolean;
  /** 单交易日最大处理证券数护栏（避免 smoke 误触发全量）；默认不限。 */
  maxSecuritiesPerDay?: number;
  /** 最大交易日数护栏；默认不限。 */
  maxTradingDays?: number;
}

/** ResearchDatasetInput 的面向 DB 加载变体（dailyFactsByDate 由 db.ts 填充）。 */
export type ResearchDatasetInputWithoutFacts = Omit<ResearchDatasetInput, "dailyFactsByDate">;

// ---------------------------------------------------------------------------
// 行投影辅助常量
// ---------------------------------------------------------------------------

/** 构建器版本（dataset_version 指纹的一部分，随 schema 语义变更升级）。 */
export const RESEARCH_DATASET_BUILDER_VERSION = "1.0.0";

/** 行投影 schema 版本（研究行字段变更时递增，防止同 content 不同 schema 混用版本）。 */
export const RESEARCH_DATASET_ROW_SCHEMA_VERSION = "1";

/**
 * 行价格字段的权威基准常量：open/high/low/close/preClose 均为 stock_daily_prices
 * 未复权 raw（canonical bar adjustment 恒为 "raw"）。schema 层面禁止把 raw 当 adjusted 宣称；
 * adjustment policy 声明（policy.ts）必须与此一致（policyValidate ADJUSTMENT_BASIS_MISMATCH）。
 */
export const RESEARCH_DATASET_PRICE_BASIS = "raw" as const;
