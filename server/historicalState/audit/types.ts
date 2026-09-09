/**
 * STEP 12.5 — PIT / 反泄漏抽样审计（C-12.5.2）：领域类型。
 *
 * 目标（ROADMAP §45.1 Exit）：抽样验证 asOf(T) 历史状态重建「无 look-ahead、无 survivorship
 * 泄漏」——把 C-12.5.1 的查询层（querySecurityHistoricalState）作为被测对象，用一套
 * 「独立于 reconstruct 语义」的朴素预言机（./oracle）逐样本交叉核验：
 *   - 身份 / 生命周期（master 时间界）：不依赖加载层；
 *   - 行业 PIT：仅 retrievedAt <= asOf 的归属可见（未来回填不得进入过去）；
 *   - 公司行为 PIT：仅 announcementDate <= asOf（且已生效）的事件可知；
 *   - 价格 / 流动性 / 市场状态：tradeDate 日级事实，日期/代码必须精确对齐；
 *   - 状态维度单调：asOf 增大知识只增不减（PIT 视角 ⊆ 全知视角）。
 *
 * 本文件只定义类型；不引入 DB 运行时依赖。审计范围刻意限定为「反泄漏 + survivorship」，
 * 不重复 C-12.5.1 已单测的纯语义，也不把策略/因子逻辑纳入。
 */

import type { CanonicalMarketBar } from "../../data/types";
import type { CorporateAction } from "../../corporateActions/types";
import type { IndexDailyBar, IndustryAssignment, LiquidityDaily } from "../../marketData/types";
import type { Security, SecurityIdentifier } from "../../security/types";
import type { SecurityStatusInterval } from "../../securityStatus/types";
import type { SecurityHistoricalState } from "../types";

/** 抽样桶（覆盖不同反泄漏边界场景）。 */
export type PitAuditBucket =
  /** 正常上市区间内的随机交易日（常规一致性抽样）。 */
  | "RANDOM_ACTIVE"
  /** master 退市日之后的交易日（survivorship：退市后必须 DELISTED / 不可交易）。 */
  | "DELISTED_AFTER"
  /** master 上市日之前的交易日（survivorship：上市前必须 NOT_YET_LISTED / 不可交易）。 */
  | "PRE_LISTING"
  /** 公司行为生效日边界（effectiveDate 已生效、announcementDate PIT 可知性）。 */
  | "CA_EFFECTIVE_BOUNDARY"
  /** 行业归属 retrievedAt 晚于 asOf 的边界（未来回填不得泄漏进过去）。 */
  | "INDUSTRY_PIT_BOUNDARY"
  /** 代码复用边界（同一 code 不同区间属不同 security 时的归属防串扰）。 */
  | "CODE_REUSE";

/** 单个抽样点。 */
export interface PitAuditSample {
  /** 稳定 id（bucket + security + date），供报告追溯与去重。 */
  sampleId: string;
  bucket: PitAuditBucket;
  /** 永久身份（sec_<uuid>）。 */
  securityId: string;
  /** 被查询交易日（YYYY-MM-DD，应为开市日）。 */
  tradeDate: string;
  /** point-in-time 信息截止点（研究口径 = tradeDate）。 */
  asOf: string;
}

/**
 * 独立事实（与被测对象同源 DB，但经「朴素预言机」独立判定；不调用
 * reconstruct / integration / getIndustryAt / resolveSecurityStatus）。
 * 由 ./db.ts 直接从 schema 表读取后经 ./mappers 纯映射得到。
 */
export interface PitAuditFacts {
  /** research_securities 主数据（时间界权威）。 */
  security: Security;
  /** 该 security 全部标识符历史（区间键）。 */
  identifiers: SecurityIdentifier[];
  /** 该 security 全部状态区间（复用 STEP 7.5 persistence 统一读取）。 */
  statusIntervals: SecurityStatusInterval[];
  /** tradeDate 生效代码对应的全部行业区间行（不限日期/retrievedAt，供 PIT 边界判定）。 */
  industryRows: IndustryAssignment[];
  /** tradeDate 生效代码对应的全部公司行为行（不限日期，供 announcement PIT 判定）。 */
  caRows: CorporateAction[];
  /** (code, tradeDate) 未复权日线 bar（与加载层同 SQL 口径）。 */
  priceBar: CanonicalMarketBar | null;
  /** (code, tradeDate) 流动性日线（同 SQL 口径）。 */
  liquidity: LiquidityDaily | null;
  /** tradeDate 核心指数日线（同 SQL 口径）。 */
  indexBars: IndexDailyBar[];
  /** 本审计请求的核心指数代码集合。 */
  coreIndexCodes: string[];
}

/** 单项检查结论（有则 FAIL，无则 PASS——汇总时按 checkId 计数）。 */
export interface PitCheckIssue {
  sampleId: string;
  bucket: PitAuditBucket;
  /** 稳定检查 code（程序化消费）。 */
  checkId: string;
  severity: "FAIL";
  message: string;
}

/** 单样本检查输出：issues（非空即有 FAIL）+ 行业 PIT 护栏是否被真实触发（供报告佐证）。 */
export interface PitSampleVerdict {
  issues: PitCheckIssue[];
  /** 存在「区间覆盖 tradeDate 但 retrievedAt > asOf」的行业行（PIT 护栏真实被触发）。 */
  industryPitGuardExercised: boolean;
}

/** 汇总报告。 */
export interface PitAuditSummary {
  capturedAt: string;
  options: {
    seed: number;
    /** 目标样本量（含衍生边界样本）。 */
    budget: number;
    coreIndexCodes: string[];
    calendarName: string;
    /** 数据就绪标记：true 时 gate 判定才具认证意义（A~H 全 DATA_READY）。 */
    dataReady: boolean;
  };
  samplesPlanned: number;
  /** 两腿查询（PIT + 全知）均成功的样本数（进入 checkers）。 */
  samplesQueried: number;
  /** 查询抛错 / 库不可用的样本（记录原因，不计 PASS/FAIL）。 */
  sampleErrors: Array<{ sampleId: string; bucket: PitAuditBucket; message: string }>;
  /** checkId → 通过/失败计数。 */
  checks: Record<string, { pass: number; fail: number }>;
  /** 全部失败明细（sampleId/checkId/message）。 */
  failures: PitCheckIssue[];
  /** 行业 PIT 护栏被触发的样本数（证据：历史行业回填未泄漏）。 */
  industryPitGuardExercised: number;
  /**
   * gate：
   *   - "FAIL"        存在 FAIL 项；
   *   - "PASS"        无 FAIL 且样本全部进入 checkers（在 dataReady=true 时构成 §45.1 VALIDATED 证据）；
   *   - "INCONCLUSIVE" 无 FAIL 但存在样本级错误/数据未就绪（不足以认证）。
   */
  gate: "PASS" | "FAIL" | "INCONCLUSIVE";
}

/** 审计运行选项。 */
export interface PitAuditOptions {
  /** 随机种子（确定性抽样，可复现）。 */
  seed?: number;
  /** 目标基础样本量（RANDOM_ACTIVE 等；边界桶有上限）。 */
  budget?: number;
  /** 核心指数代码集合（默认同查询层 DEFAULT_CORE_INDEX_CODES）。 */
  coreIndexCodes?: string[];
  /** 数据集是否已就绪（true 才允许 gate=PASS 作为认证证据）。 */
  dataReady?: boolean;
}

/** 供 checkers 判定生命周期归属所需的辅助判词。 */
export type LifecycleExpectation = "NOT_YET_LISTED" | "LISTED" | "DELISTED" | "UNKNOWN";

/** 供 checkers 使用的运行态状态对（PIT + 全知两腿）。 */
export interface PitStatePair {
  pit: SecurityHistoricalState;
  full: SecurityHistoricalState;
}
