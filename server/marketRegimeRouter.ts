/**
 * FE-8 — Market Regime tRPC Router（C-22.1 引擎暴露层）。
 *
 * 暴露两个端点，供 `client/src/pages/RegimeReport.tsx` 接入：
 *   - `describe`（query）：返回七维名称 / 标签值域 / compositeKey 编码规则 /
 *     unassessed reasonCode 白名单，**逐字取自** `server/research/marketRegime`
 *     的真实枚举与常量（REGIME_DIMENSION_IDS / REGIME_DIMENSION_LABELS /
 *     REGIME_LABEL_SETS / REGIME_UNASSESSED_REASON_CODES /
 *     MARKET_REGIME_DEFAULT_BENCHMARK_INDEX_CODE），供前端图例 1:1 渲染，不复制第二份口径。
 *   - `run`（mutation）：接收可序列化参数（日期范围 / 基准指数 / 是否注入归因表现样本），
 *     服务端异步加载真实日级市场事实 → 调 `runMarketRegimeAnalysis` 纯函数引擎 →
 *     返回可序列化 `MarketRegimeRun`。
 *
 * facts 构建纪律（PIT + 诚实缺维，绝不编造）：
 *   - 每个标签只由「T 及之前」的日级事实计算；facts 的 asOf === tradeDate；
 *   - **数据源如实映射**（本 endpoint 只消费三类真实源）：
 *       · `index_daily`（基准指数收盘）→ trend / volatility / indexState（三维可评估）；
 *       · `limit_up_records`（涨停家数）→ 仅提供 limitUpCount 事实；
 *       · `getLeaderCandidateBacktest`（生产回测 realisticSimulation.equityCurve）
 *         → 逐日 returnPct（注入归因，可选）。
 *   - 项目当前**无**全市场横截面（上涨/下跌家数）、**无**涨跌停可判定分母
 *     （limitClassifiableCount）、**无**全市场成交额/换手率、**无**情绪数据源——
 *     故 breadth / limitUpEnv / liquidity / sentiment 四维在引擎语义下显式 unassessed
 *     （reasonCode 见引擎：REGIME_NO_CROSS_SECTION / REGIME_DATA_MISSING /
 *     REGIME_SENTIMENT_SOURCE_MISSING），**绝不拿涨停家数冒充宽度、绝不填零成交额**。
 *
 * 铁律：本层只做「传输 → 领域」边界投递；引擎抛出的结构化错误（RegimeAnalysisError）
 * 原样冒泡为 tRPC 错误，不吞异常、不返回「成功但没值」的假结果。
 */

import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { getDb, getLeaderCandidateBacktest } from "./db";
import { indexDaily, limitUpRecords } from "../drizzle/schema";
import {
  MARKET_REGIME_DEFAULT_BENCHMARK_INDEX_CODE,
  REGIME_DIMENSION_IDS,
  REGIME_DIMENSION_LABELS,
  REGIME_LABEL_SETS,
  REGIME_UNASSESSED_REASON_CODES,
  runMarketRegimeAnalysis,
} from "./research/marketRegime";
import type {
  RegimeDayFacts,
  RegimePerformanceSample,
} from "./research/marketRegime";

// ---------------------------------------------------------------------------
// 展示层中文映射（仅标注语义，不参与计算；文案逐字摘自 engine 类型/常量注释）
// ---------------------------------------------------------------------------

/** 各维标签值域的中文标注（engine 仅存机器码 up/down/...，中文见 types.ts 类型注释）。 */
const REGIME_LABEL_CN: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  trend: Object.freeze({ up: "上涨", down: "下跌", sideways: "震荡" }),
  volatility: Object.freeze({ low: "低", mid: "中", high: "高" }),
  liquidity: Object.freeze({ low: "低（缩量）", mid: "中（平量）", high: "高（放量）" }),
  breadth: Object.freeze({ broad: "普涨", mixed: "分化", narrow: "普跌" }),
  sentiment: Object.freeze({ risk_on: "亢奋", neutral: "中性", risk_off: "避险" }),
  indexState: Object.freeze({ above_ma: "均线上方", near_ma: "均线附近", below_ma: "均线下方" }),
  limitUpEnv: Object.freeze({ hot: "火热", normal: "常态", cold: "低迷" }),
});

/** unassessed reasonCode 的中文语义（逐字取自 types.ts REGIME_UNASSESSED_REASON_CODES 注释）。 */
const REGIME_UNASSESSED_REASON_CN: Readonly<Record<string, string>> = Object.freeze({
  [REGIME_UNASSESSED_REASON_CODES.INSUFFICIENT_HISTORY]: "回看窗交易日数不足（含 asOf 日之前无数据）",
  [REGIME_UNASSESSED_REASON_CODES.DATA_MISSING]: "维度所需数据缺失（基准收盘缺失 / 成交额缺失 / 横截面为空等）",
  [REGIME_UNASSESSED_REASON_CODES.SENTIMENT_SOURCE_MISSING]: "情绪数据源缺失（项目当前未回填情绪类数据；代理口径默认关闭）",
  [REGIME_UNASSESSED_REASON_CODES.BENCHMARK_MISSING]: "基准指数在窗口内无任何可用收盘价",
  [REGIME_UNASSESSED_REASON_CODES.NO_CROSS_SECTION]: "横截面样本数为 0（无法计算宽度 / 涨停环境等横截面统计量）",
});

// ---------------------------------------------------------------------------
// 输入 schema（内联；不改 shared/researchContracts.ts）
// ---------------------------------------------------------------------------

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD");

const runInputSchema = z.object({
  /** 覆盖区间起点（含）；缺省 = 最近 maxTradingDays 个交易日的首个。 */
  startDate: ISO_DATE.optional(),
  /** 覆盖区间终点（含）；缺省 = 基准指数最新交易日。 */
  endDate: ISO_DATE.optional(),
  /** 基准指数代码（趋势/波动/指数状态使用该指数收盘）；缺省 000300.SH。 */
  benchmarkIndexCode: z.string().min(1).optional(),
  /** 无显式区间时回看的最近交易日数（技术预览默认 120，使 60 日均线维有足够覆盖）。 */
  maxTradingDays: z.number().int().min(20).max(500).optional(),
  /** 是否注入生产回测权益曲线逐日收益做归因（默认 true；失败则归因置空，不编造）。 */
  includeAttribution: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// 数据加载（真实源 → 日级市场事实；PIT：只取当日及之前，facts.asOf === tradeDate）
// ---------------------------------------------------------------------------

/** 加载基准指数收盘（升序）。无显式区间时取最近 maxTradingDays 个交易日。 */
async function loadBenchmarkCloses(
  indexCode: string,
  opts: { startDate?: string; endDate?: string; maxTradingDays: number },
): Promise<Array<{ tradeDate: string; close: number }>> {
  const db = await getDb();
  if (!db) return [];

  const hasRange = opts.startDate !== undefined || opts.endDate !== undefined;
  const rows: Array<{ tradeDate: string; close: number | null }> = hasRange
    ? await (() => {
        const conditions = [eq(indexDaily.indexCode, indexCode)];
        if (opts.startDate) conditions.push(gte(indexDaily.tradeDate, opts.startDate));
        if (opts.endDate) conditions.push(lte(indexDaily.tradeDate, opts.endDate));
        return db
          .select({ tradeDate: indexDaily.tradeDate, close: indexDaily.close })
          .from(indexDaily)
          .where(and(...conditions))
          .orderBy(indexDaily.tradeDate);
      })()
    : (await db
        .select({ tradeDate: indexDaily.tradeDate, close: indexDaily.close })
        .from(indexDaily)
        .where(eq(indexDaily.indexCode, indexCode))
        .orderBy(desc(indexDaily.tradeDate))
        .limit(opts.maxTradingDays)
      ).reverse();

  return rows
    .filter(
      (row): row is { tradeDate: string; close: number } =>
        typeof row.close === "number" && Number.isFinite(row.close) && row.close > 0,
    )
    .map((row) => ({ tradeDate: row.tradeDate, close: row.close }));
}

/** 加载区间内逐日涨停家数（date → count）。limit_up_records 只含涨停记录，无跌停/横截面。 */
async function loadLimitUpCounts(
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const db = await getDb();
  if (!db) return new Map();

  const rows = await db
    .select({ date: limitUpRecords.limitUpDate, cnt: count() })
    .from(limitUpRecords)
    .where(and(gte(limitUpRecords.limitUpDate, startDate), lte(limitUpRecords.limitUpDate, endDate)))
    .groupBy(limitUpRecords.limitUpDate);

  return new Map(rows.map((row) => [row.date, Number(row.cnt)]));
}

/** 由生产回测权益曲线计算逐日策略收益 %（归因表现样本注入）。 */
async function loadAttributionSamples(
  startDate: string,
  endDate: string,
): Promise<RegimePerformanceSample[]> {
  const result = await getLeaderCandidateBacktest({ startDate, endDate });
  const curve = result.realisticSimulation?.equityCurve;
  if (!curve || curve.length < 2) return [];

  const samples: RegimePerformanceSample[] = [];
  for (let i = 1; i < curve.length; i += 1) {
    const prev = curve[i - 1]!.equity;
    const curr = curve[i]!.equity;
    if (
      typeof prev === "number" &&
      typeof curr === "number" &&
      Number.isFinite(prev) &&
      Number.isFinite(curr) &&
      prev > 0
    ) {
      samples.push({ tradeDate: curve[i]!.date, returnPct: (curr / prev - 1) * 100 });
    }
  }
  return samples;
}

/** 运行 ID（`REGIME-YYYYMMDD-XXXXXXXX`；调用方注入，引擎本身禁止 Date.now/Math.random）。 */
function makeRegimeRunId(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `REGIME-${ymd}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const marketRegimeRouter = router({
  /** 七维图例 + compositeKey 编码 + unassessed reasonCode（引擎常量 1:1，供前端图例）。 */
  describe: publicProcedure.query(() => ({
    benchmarkIndexCode: MARKET_REGIME_DEFAULT_BENCHMARK_INDEX_CODE,
    dimensions: REGIME_DIMENSION_IDS.map((id) => ({
      id,
      cn: REGIME_DIMENSION_LABELS[id],
      labels: REGIME_LABEL_SETS[id].map((code) => ({
        code,
        cn: REGIME_LABEL_CN[id]?.[code] ?? code,
      })),
    })),
    compositeKeyEncoding: {
      dimensionOrder: [...REGIME_DIMENSION_IDS],
      assessedPart: "<dim>=<label>",
      unassessedPart: "<dim>=NA:<reasonCode>",
      separator: "|",
    },
    unassessedReasonCodes: Object.values(REGIME_UNASSESSED_REASON_CODES).map((code) => ({
      code,
      cn: REGIME_UNASSESSED_REASON_CN[code] ?? code,
    })),
  })),

  /**
   * 执行一次 Market Regime 分析（真实数据 → facts → 纯函数引擎 → MarketRegimeRun）。
   * 引擎结构化错误（RegimeAnalysisError）原样冒泡为 tRPC 错误。
   */
  run: publicProcedure.input(runInputSchema).mutation(async ({ input }) => {
    if (input.startDate && input.endDate && input.startDate > input.endDate) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "起始日期不能晚于结束日期" });
    }

    const benchmarkIndexCode =
      input.benchmarkIndexCode ?? MARKET_REGIME_DEFAULT_BENCHMARK_INDEX_CODE;
    const maxTradingDays = input.maxTradingDays ?? 120;

    const closes = await loadBenchmarkCloses(benchmarkIndexCode, {
      startDate: input.startDate,
      endDate: input.endDate,
      maxTradingDays,
    });

    // 逐日事实：只填「真实可得」的字段；缺失维度保持 null/0（引擎显式 unassessed，不编造）。
    const limitUpByDate =
      closes.length > 0
        ? await loadLimitUpCounts(closes[0]!.tradeDate, closes[closes.length - 1]!.tradeDate)
        : new Map<string, number>();

    const series: RegimeDayFacts[] = closes.map(({ tradeDate, close }) => ({
      tradeDate,
      asOf: tradeDate,
      indexCloses: { [benchmarkIndexCode]: close },
      sampleSize: 0,
      advancingCount: 0,
      decliningCount: 0,
      unchangedCount: 0,
      limitUpCount: limitUpByDate.get(tradeDate) ?? 0,
      limitDownCount: 0,
      limitClassifiableCount: 0,
      totalAmount: null,
      meanTurnoverRate: null,
      sentiment: null,
    }));

    // 归因表现样本（可选注入；失败/无曲线 → attribution 置空，不编造表现数据）。
    let performanceSamples: RegimePerformanceSample[] | undefined;
    if (closes.length > 0 && (input.includeAttribution ?? true)) {
      try {
        performanceSamples = await loadAttributionSamples(
          closes[0]!.tradeDate,
          closes[closes.length - 1]!.tradeDate,
        );
      } catch (error) {
        console.warn("[marketRegime] 归因表现数据加载失败，attribution 置空：", error);
        performanceSamples = undefined;
      }
    }

    return runMarketRegimeAnalysis({
      regimeRunId: makeRegimeRunId(),
      series,
      configs: { benchmarkIndexCode },
      datasetVersion: null,
      performanceSamples,
      createdAt: new Date().toISOString(),
    });
  }),
});

export type MarketRegimeRouter = typeof marketRegimeRouter;
