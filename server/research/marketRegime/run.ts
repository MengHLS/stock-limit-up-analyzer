/**
 * STEP 22 / C-22.1 — Market Regime：运行编排（纯函数、确定性、无 IO）。
 *
 * 输入：日级市场事实序列（RegimeDayFacts[]，由调用方从 Research Dataset / 指数与
 * 横截面数据构建，见 facts.ts）；可选注入逐日表现样本用于归因。
 * 输出：MarketRegimeRun（逐日七维标签 + 复合状态 + unassessed 统计 + 指纹 + 可选归因）。
 *
 * 纪律：
 *   - regimeRunId / createdAt / datasetVersion 全部**调用方注入**（本模块不触
 *     Date.now / Math.random / IO）；
 *   - 序列必须先做「严格升序且无重复」校验（assertRegimeSeriesOrdered），
 *     否则回看窗语义（第 i 项 = 第 i 个交易日）不成立；
 *   - 逐日标签只由该日及之前的数据计算（dimensions.ts 全部分类器共用回看窗语义）；
 *   - 本模块**不跑回测**：表现样本由调用方注入，聚合口径见 attribution.ts。
 */

import { aggregateRegimeAttribution } from "./attribution";
import { computeRegimeDayTags } from "./composite";
import { resolveRegimeConfigSet } from "./config";
import { assertRegimeSeriesOrdered } from "./dates";
import { RegimeAnalysisError } from "./errors";
import {
  computeMarketRegimeRunFingerprint,
  computeRegimeTagSequenceFingerprint,
  computeRegimeUnassessedStats,
} from "./serialize";
import type {
  MarketRegimeRun,
  RegimeAttributionGroupBy,
  RegimeAttributionReport,
  RegimeConfigSet,
  RegimeCoverage,
  RegimeDayFacts,
  RegimeDayTags,
  RegimeDimensionId,
  RegimePerformanceSample,
} from "./types";

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

/** 一次 Market Regime 分析请求。 */
export interface MarketRegimeRunRequest {
  /** 运行 ID（调用方注入，保证确定性；建议 `REGIME-YYYYMMDD-XXXXXXXX`）。 */
  readonly regimeRunId: string;
  /** 日级市场事实序列（按 tradeDate 严格升序、无重复）。 */
  readonly series: readonly RegimeDayFacts[];
  /** 七维配置（缺省见 config.ts 文档化默认值）。 */
  readonly configs?: RegimeConfigSet;
  /** 绑定的 Research Dataset 版本（未绑定传 null，禁止省略冒充）。 */
  readonly datasetVersion?: string | null;
  /** 注入的逐日表现样本（未提供则 attribution=null）。 */
  readonly performanceSamples?: readonly RegimePerformanceSample[];
  /** 归因分组维度（默认 composite）。 */
  readonly attributionGroupBy?: RegimeAttributionGroupBy;
  /** 复合状态参与维度（默认全七维）。 */
  readonly compositeDimensions?: readonly RegimeDimensionId[];
  /** 是否产出复合状态（默认 true）。 */
  readonly enableComposite?: boolean;
  /** 创建时间（ISO-8601；调用方注入，非复现输入）。 */
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// 运行
// ---------------------------------------------------------------------------

/**
 * 执行 Market Regime 分析（纯函数）。
 *
 * 步骤：序列秩序校验 → 配置解析 → 逐交易日七维标签（回看窗 PIT）→ 复合状态 →
 * unassessed 统计 → 标签序列指纹 →（可选）表现归因 → 内容指纹。
 */
export function runMarketRegimeAnalysis(request: MarketRegimeRunRequest): MarketRegimeRun {
  if (typeof request.regimeRunId !== "string" || request.regimeRunId.trim().length === 0) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_PARAMETER",
      "marketRegime: regimeRunId 必须是非空字符串（调用方注入，禁止空值冒充身份）",
    );
  }
  if (typeof request.createdAt !== "string" || request.createdAt.trim().length === 0) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_PARAMETER",
      "marketRegime: createdAt 必须是非空 ISO 字符串（调用方注入，本模块禁止 Date.now）",
    );
  }
  if (!Array.isArray(request.series)) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_SERIES",
      "marketRegime: series 必须是数组（日级市场事实序列）",
    );
  }
  assertRegimeSeriesOrdered(request.series);

  const configs = resolveRegimeConfigSet(request.configs);
  const enableComposite = request.enableComposite ?? true;

  const tags: RegimeDayTags[] = request.series.map((day) =>
    computeRegimeDayTags(request.series, day.tradeDate, configs, {
      enableComposite,
      dimensions: request.compositeDimensions,
    }),
  );

  const coverage: RegimeCoverage =
    tags.length === 0
      ? { startDate: null, endDate: null, tradingDayCount: 0 }
      : {
          startDate: tags[0]!.tradeDate,
          endDate: tags[tags.length - 1]!.tradeDate,
          tradingDayCount: tags.length,
        };

  const unassessedStats = computeRegimeUnassessedStats(tags);
  const tagSequenceFingerprint = computeRegimeTagSequenceFingerprint(tags);

  let attribution: RegimeAttributionReport | null = null;
  if (request.performanceSamples !== undefined) {
    attribution = aggregateRegimeAttribution(request.performanceSamples, tags, {
      groupBy: request.attributionGroupBy,
    });
  }

  const body = {
    recordKind: "MARKET_REGIME_RUN" as const,
    recordVersion: 1 as const,
    regimeRunId: request.regimeRunId,
    datasetVersion: request.datasetVersion ?? null,
    benchmarkIndexCode: configs.benchmarkIndexCode,
    configs,
    coverage,
    tags,
    unassessedStats,
    tagSequenceFingerprint,
    attribution,
    createdAt: request.createdAt,
  };
  return { ...body, fingerprint: computeMarketRegimeRunFingerprint(body) };
}
