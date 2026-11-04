/**
 * COMPOSITE_FACTOR_EXPERIMENT_V1 —— **结果装配**（表 / 统计 / 产物 / 自有载荷）。
 *
 * ## 六段结果（与需求逐字对应）
 *
 * | 段 | 表 key | 说明 |
 * | --- | --- | --- |
 * | Overall | `cf_overall` | 全样本（不做任何选择）的等权组合指标 |
 * | TopN | `cf_topn` | 4 档 TopN × 2 日集的完整指标 |
 * | Benchmark | `cf_benchmark` | 配对基准（同日集池等权）+ 随机 N 的 Monte-Carlo 分位 |
 * | Excess | `cf_excess` | **主判据**：配对日度超额（组合 − 当日池） |
 * | TimeSlice | `cf_time_slice` | 按年 × 各档 |
 * | TradeDetails | `cf_trades_preview` + CSV 产物 | 逐笔明细（表里有界，全量走产物） |
 *
 * ## 为什么逐笔明细不进 `customPayload`
 *
 * 4 档 × 上千决策日 ≈ 数万笔；把它塞进结果信封会让「打开页面就要下载几 MB JSON」。
 * 因此走仓库既定分工：**表里放有界预览**（每档前 `TRADE_PREVIEW_LIMIT` 笔），
 * **全量落 CSV 产物**（`context.artifact`，gzip）。页面「产物」区可直接下载。
 */

import { gzipSync } from "node:zlib";
import { z } from "zod";
import type {
  ExperimentConfirmatoryGate,
  ExperimentProtocolContext,
  ExperimentResultPayload,
  ExperimentResultStatistic,
  ExperimentResultTable,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import type { TwelveFactorDerivation } from "../../first-board-pullback/twelve-factor-composite-study/derive";
import { dailySeriesCsvOf, type CompositeAnalysisResult } from "./analyse";
import { fnv1a32 } from "./hash";
import { BUCKET_CONTRACT_ID } from "./members";
import type { CompositeScoreSummary, ResolvedWeighting, ScoredSample } from "./scoring";
import { MIN_DECISION_DAY_COUNT } from "../singleFactor/metrics";
import {
  COMPOSITE_FACTOR_EXPERIMENT_TYPE,
  COMPOSITE_FACTOR_TEMPLATE_ID,
  COMPUTATION_VERSION,
  type CompositeMember,
  type CompositeTemplateSpec,
} from "./types";

export { COMPUTATION_VERSION };
/** 表里每档放多少笔逐笔预览。 */
export const TRADE_PREVIEW_LIMIT = 100;

/** 与既有 12F / Top-N 实验对照用的参照样本账（同一 Dataset v5）。 */
export const REFERENCE_CANDIDATE_COUNT = 73_003;
export const REFERENCE_ELIGIBLE_COUNT = 70_236;
export const REFERENCE_EXPERIMENT_ID =
  "first-board-pullback/twelve-factor-composite-study";

const verdictSchema = z.enum(["POSITIVE", "NEGATIVE", "INCONCLUSIVE", "INSUFFICIENT"]);
const nullableNumber = z.number().nullable();
const directionSchema = z.enum(["HIGH", "LOW"]);
const dayScopeSchema = z.enum(["OWN", "FIXED"]);

const metricsShape = {
  totalReturn: nullableNumber,
  grossTotalReturn: nullableNumber,
  meanTradeReturn: nullableNumber,
  medianTradeReturn: nullableNumber,
  winRate: nullableNumber,
  profitFactor: nullableNumber,
  maxDrawdown: nullableNumber,
  tradeCount: z.number().int().nonnegative(),
  benchmarkReturn: nullableNumber,
  excessReturn: nullableNumber,
  averageHoldingDays: nullableNumber,
  costBps: z.number(),
  slippageBpsPerSide: z.number(),
  costDrag: nullableNumber,
} as const;

const comboShape = {
  comboId: z.string().min(1),
  direction: z.literal("HIGH"),
  size: z.number().int().positive(),
  label: z.string().min(1),
  scope: dayScopeSchema,
  daysIncluded: z.number().int().nonnegative(),
  daysExcludedSmall: z.number().int().nonnegative(),
  metrics: z.object(metricsShape),
  excessMean: nullableNumber,
  excessCi95Low: nullableNumber,
  excessCi95High: nullableNumber,
  excessVerdict: verdictSchema,
  portfolioCi95Low: nullableNumber,
  portfolioCi95High: nullableNumber,
  portfolioVerdict: verdictSchema,
  dayWinRate: nullableNumber,
} as const;

/** 本实验自有结果（`result.customPayload`）的 zod 契约。 */
export const compositeFactorSchema = z.object({
  computationVersion: z.string().min(1),
  templateId: z.string().min(1),
  experimentType: z.literal(COMPOSITE_FACTOR_EXPERIMENT_TYPE),
  contractId: z.string().min(1),
  /**
   * 平台研究协议坐标（`OBSERVATION` / `HOLDOUT` / `EXPLORATORY`）。
   *
   * 🔴 `.nullish()`：本字段是本轮新增，**历史信封里没有** ⇒ 必须是可缺省，
   *    否则打开旧 Run 会 schema 校验失败（把「新增可追溯性」变成「旧结果打不开」）。
   */
  protocol: z
    .object({
      phase: z.enum(["EXPLORATORY", "OBSERVATION", "HOLDOUT"]),
      protocolId: z.string().nullable(),
      protocolVersion: z.string().nullable(),
      hypothesisCode: z.string().nullable(),
      protocolFingerprint: z.string().nullable(),
      evaluationWindow: z
        .object({ startDate: z.string().min(1), endDate: z.string().min(1) })
        .nullable(),
      /** 窗口是否真的由平台在取数层施加（= `evaluationWindow !== null`）。 */
      windowApplied: z.boolean(),
    })
    .nullish(),
  composition: z.object({
    memberCount: z.number().int().positive(),
    equalWeight: z.boolean(),
    weightSum: z.number(),
    /** 成员集合指纹（`code|direction|orientation|weight`），事后可证明「跑的是哪一套成员」。 */
    fingerprint: z.string().min(1),
    members: z.array(
      z.object({
        code: z.string().min(1),
        label: z.string().min(1),
        source: z.string().min(1),
        direction: directionSchema,
        orientation: z.number().int(),
        priorVerified: z.boolean(),
        weight: z.number(),
        contractFingerprint: z.string().min(1),
      })
    ),
    weightingDisclosure: z.string().min(1),
  }),
  normalization: z.object({
    method: z.enum(["BUCKET_POSITIONAL", "CROSS_SECTION_PERCENTILE"]),
    label: z.string().min(1),
    bucketContractId: z.string().min(1),
    bucketFingerprint: z.string().min(1),
    disclosure: z.string().min(1),
  }),
  ranking: z.object({
    key: z.string().min(1),
    direction: z.literal("HIGH"),
    topNSizes: z.array(z.number().int().positive()),
    dayScopes: z.array(dayScopeSchema),
    fixedDayMinSize: z.number().int().positive(),
    minDayCount: z.number().int().positive(),
    unit: z.string().min(1),
  }),
  coordinate: z.object({
    entryDay: z.number().int(),
    exitRelativeDay: z.number().int(),
    roundTripCostBps: z.number(),
    decisionOffsetDays: z.number().int(),
    informationCutoffRelativeDay: z.number().int(),
    observationRelativeDays: z.array(z.number().int()),
  }),
  sampleAccounting: z.object({
    candidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    excludedCount: z.number().int().nonnegative(),
    excludedByReason: z.record(z.string(), z.number().int().nonnegative()),
    completeCaseCount: z.number().int().nonnegative(),
    missingByMember: z.record(z.string(), z.number().int().nonnegative()),
    notes: z.array(z.string()),
  }),
  compositeScore: z.object({
    count: z.number().int().nonnegative(),
    min: nullableNumber,
    p5: nullableNumber,
    p50: nullableNumber,
    p95: nullableNumber,
    max: nullableNumber,
    mean: nullableNumber,
  }),
  overall: z.object({
    daysIncluded: z.number().int().nonnegative(),
    trades: z.number().int().nonnegative(),
    metrics: z.object(metricsShape),
  }),
  topn: z.array(z.object(comboShape)),
  excess: z.array(
    z.object({
      comboId: z.string().min(1),
      sizeLabel: z.string().min(1),
      scope: dayScopeSchema,
      daysIncluded: z.number().int().nonnegative(),
      excessMean: nullableNumber,
      excessCi95Low: nullableNumber,
      excessCi95High: nullableNumber,
      verdict: verdictSchema,
      dayWinRate: nullableNumber,
    })
  ),
  benchmark: z.array(
    z.object({
      comboId: z.string().min(1),
      sizeLabel: z.string().min(1),
      scope: dayScopeSchema,
      daysIncluded: z.number().int().nonnegative(),
      benchmarkMean: nullableNumber,
      benchmarkTotalReturn: nullableNumber,
      randomPercentile: nullableNumber,
      randomP50: nullableNumber,
      impliedPValue: nullableNumber,
      simulations: z.number().int().positive(),
    })
  ),
  timeSlice: z.array(
    z.object({
      year: z.number().int(),
      comboId: z.string().min(1),
      sizeLabel: z.string().min(1),
      daysIncluded: z.number().int().nonnegative(),
      portfolioMean: nullableNumber,
      benchmarkMean: nullableNumber,
      excessMean: nullableNumber,
      excessCi95Low: nullableNumber,
      excessCi95High: nullableNumber,
      verdict: verdictSchema,
    })
  ),
  dayDiagnostics: z.object({
    daysTotal: z.number().int().nonnegative(),
    daysAtLeast3: z.number().int().nonnegative(),
    daysAtLeast5: z.number().int().nonnegative(),
    daysAtLeast10: z.number().int().nonnegative(),
    daysAtLeast20: z.number().int().nonnegative(),
    daySizeP50: nullableNumber,
    daySizeMean: nullableNumber,
    daySizeMax: nullableNumber,
  }),
  trades: z.object({
    previewLimit: z.number().int().positive(),
    index: z.array(
      z.object({
        comboId: z.string().min(1),
        sizeLabel: z.string().min(1),
        scope: dayScopeSchema,
        tradeCount: z.number().int().nonnegative(),
        previewRows: z.number().int().nonnegative(),
      })
    ),
    artifactNames: z.array(z.string().min(1)),
  }),
  referenceCheck: z.object({
    referenceExperimentId: z.string().min(1),
    /** 全窗口锚点是否**适用于**本 Run（带评估窗口时为 false，锚点不适用）。 */
    referenceComparable: z.boolean().nullish(),
    referenceNote: z.string().nullish(),
    referenceCandidateCount: z.number().int(),
    actualCandidateCount: z.number().int(),
    matchesCandidateCount: z.boolean(),
    referenceEligibleCount: z.number().int(),
    actualEligibleCount: z.number().int(),
    matchesEligibleCount: z.boolean(),
  }),
  /** 带判定的结果行数（多重比较披露用，逐表 `len(rows)` 求和）。 */
  verdictRowCount: z.number().int().nonnegative(),
  /** 本 Run 是否施加了平台评估窗口（便于不回读 protocol 也能筛）。 */
  windowApplied: z.boolean().nullish(),
  disclosures: z.array(z.string().min(1)),
});

export type CompositeFactorPayload = z.infer<typeof compositeFactorSchema>;

function tableColumn(
  key: string,
  label: string,
  digits: number | null = null
): { key: string; label: string; digits?: number; align?: "LEFT" | "RIGHT" } {
  return digits === null
    ? { key, label, align: "LEFT" }
    : { key, label, digits, align: "RIGHT" };
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const TRADE_COLUMNS = [
  "comboId",
  "scope",
  "rank",
  "poolSize",
  "stockCode",
  "eventId",
  "compositeScore",
  "signalDate",
  "entryDate",
  "entryPrice",
  "exitDate",
  "exitPrice",
  "exitRelativeDay",
  "holdingDays",
  "grossReturn",
  "cost",
  "costBps",
  "netReturn",
] as const;

export interface AssembleCompositeFactorArgs {
  readonly context: ExperimentRunContext;
  readonly spec: CompositeTemplateSpec;
  readonly members: readonly CompositeMember[];
  readonly weighting: ResolvedWeighting;
  readonly scored: readonly ScoredSample[];
  readonly compositeSummary: CompositeScoreSummary;
  readonly missingByMember: Record<string, number>;
  readonly derivation: TwelveFactorDerivation;
  readonly analysis: CompositeAnalysisResult;
  readonly coordinate: {
    entryDay: number;
    exitRelativeDay: number;
    roundTripCostBps: number;
    decisionOffsetDays: number;
    informationCutoffRelativeDay: number;
    observationRelativeDays: readonly number[];
  };
  readonly rankedKey: string;
  readonly normalizationLabel: string;
  readonly normalizationDisclosure: string;
  readonly bucketFingerprint: string;
  /**
   * 平台研究协议（`EXPLORATORY` Run 为 `null`）。
   *
   * ⚠️ 声明为**可选**：`undefined` 与 `null` 语义相同（都表示 EXPLORATORY），
   * 直接构造入参的单测可以不传。若不接受 `undefined`，`buildConfirmatoryGate`
   * 会在 `undefined.phase` 上抛 TypeError（2026-09-25 实测踩过）。
   */
  readonly protocol?: ExperimentProtocolContext | null;
}

export function assembleCompositeFactorResult(
  args: AssembleCompositeFactorArgs
): ExperimentResultPayload {
  const eligibleCount = args.scored.length;
  const completeCaseCount = args.derivation.samples.length;
  const excludedByReason: Record<string, number> = {
    ...args.derivation.excludedByReason,
  };
  const excludedCount = args.derivation.candidateCount - eligibleCount;
  const explained = Object.values(excludedByReason).reduce(
    (sum, value) => sum + value,
    0
  );
  if (excludedCount - explained > 0) {
    // 派生阶段没解释掉的差额 = 「合成分不可评估」的那一批（逐成员登记在 missingByMember）。
    excludedByReason.MISSING_COMPOSITE_MEMBER = excludedCount - explained;
  }
  const reasonSum = Object.values(excludedByReason).reduce(
    (sum, value) => sum + value,
    0
  );
  if (reasonSum !== excludedCount) {
    throw new Error(
      `样本账不守恒：excludedByReason 合计 ${reasonSum} ≠ candidate − eligible ${excludedCount}`
    );
  }

  const compositionFingerprint = `fnv1a32:${fnv1a32(
    args.members
      .map(
        member =>
          `${member.code}|${member.direction}|${member.orientation}|${args.weighting.weights.get(member.code)}`
      )
      .join(";")
  )
    .toString(16)
    .padStart(8, "0")}`;

  const phase = args.protocol?.phase ?? "EXPLORATORY";
  const evaluationWindow = args.protocol?.evaluationWindow ?? null;
  const windowApplied = evaluationWindow !== null;
  const gate = buildConfirmatoryGate({
    protocol: args.protocol,
    excessRows: args.analysis.excessRows,
    sampleCount: eligibleCount,
  });
  const gateChecks = gate === null ? [] : gate.checks;

  const artifactNames = writeTradesAndSeries(args);
  const eventDateByEventId = new Map(
    args.scored.map(item => [item.sample.eventId, item.sample.eventDate])
  );

  const topn = args.analysis.evaluations.map(evaluation => ({
    comboId: evaluation.comboId,
    direction: "HIGH" as const,
    size: evaluation.size as number,
    label: evaluation.sizeLabel,
    scope: evaluation.scope,
    daysIncluded: evaluation.result.daysIncluded,
    daysExcludedSmall: evaluation.result.daysExcludedSmall,
    metrics: evaluation.result.metrics,
    excessMean: evaluation.excessMean,
    excessCi95Low: evaluation.result.excessCi95Low,
    excessCi95High: evaluation.result.excessCi95High,
    excessVerdict: evaluation.result.excessVerdict,
    portfolioCi95Low: evaluation.result.portfolioCi95Low,
    portfolioCi95High: evaluation.result.portfolioCi95High,
    portfolioVerdict: evaluation.result.portfolioVerdict,
    dayWinRate: evaluation.result.dayWinRate,
  }));

  const verdictRowCount =
    topn.length + args.analysis.excessRows.length + args.analysis.timeSlices.length + 1;

  const disclosures: string[] = [
    "🔴 持仓重叠：持有期 T+6 开盘 → T+10 收盘（5 个交易日），相邻决策日的持仓**互相重叠** ⇒ 「日度序列」不是独立观测。置信区间用日期聚类 Moving-Block Bootstrap（block = 20 交易日）吸收这一点，但**不得**把 N 个决策日当作 N 个独立实验。",
    "🔴 等权口径：组合日收益 = 当日 Top-N 的**等权**平均；主指标 = 各日组合收益的**等权**平均（每个决策日一单位资金）。复利只用于「累计收益 / 最大回撤」的定义，不是实盘资金曲线。",
    "🔴 基准 = 当日池：配对基准是同一天**全部可排名样本**的等权均值。随机抽 N 个的**期望**恒等于该值 ⇒ 「正超额」等价于「平均意义上优于随机抽签」，**不是**跑赢指数。",
    "⚠️ 日集口径：`OWN` 下各档只纳入「当日可用样本 ≥ 该档 N」的日子 ⇒ **不同 N 的日集不同**，跨 N 的深度比较必须读 `FIXED`（统一门槛 = 最大档 N）。",
    "⚠️ 决策日 = 首板日 T（决策发生在 T+5 收盘）。同一天可能有多个首板事件，因此「每天挑前 N 名」就是「在每个 T 的横截面按合成分排序取头部」。",
    "⚠️ 方向来自 FROZEN-BUCKET-CONTRACT-001 的方向表，**不在组合里重估**（`assertMemberDirections` 强制）；其中 3 个因子的方向属「先验未验证」，合计占 3/12 权重。",
    `⚠️ 标准化方法：${args.normalizationLabel}。方法一旦更换即等于更换排序键，结果不可与旧 Run 混引。`,
    "⚠️ Bootstrap 种子为**稳定哈希**（`hash.ts`，按 `契约|档位|日集|用途` 计算）⇒ 与既有 Top-N 实验的游标式种子不同，**CI 端点不会逐位相同**；但点估计（组合均值 / 基准均值 / 超额均值 / 笔数 / 胜率 / 日胜率）与种子无关，可与既有实验逐位对拍。",
    `⚠️ 多重比较：本次共 ${verdictRowCount} 个带判定的行，α=0.05 下假阳性期望 ≈ ${(verdictRowCount * 0.05).toFixed(1)} ⇒ 所有结论只能声明为**探索性**。`,
    phase === "EXPLORATORY"
      ? "⚠️ 本 Run 是 EXPLORATORY：因子定义、桶边界与方向都取自同一批已读数据（v2~v5），**不是 OOS**；本实验不构成「策略有效」的证据。"
      : `🔴 本 Run 是平台协议 Run（${phase}，协议指纹 ${args.protocol?.protocolFingerprint ?? "—"}），` +
        `评估窗口 [${evaluationWindow?.startDate ?? "—"}..${evaluationWindow?.endDate ?? "—"}]。` +
        "窗口由**取数层**施加（`datasetPort` 的 `fromDate/toDate`），实验内不做二次过滤 ⇒ 窗口内事件集合与全窗口 Run 的同名统计**不可逐格对拍**。",
    "🔴 组合分是加权和，三条已知缺陷在本版依然存在：① 因子互相掩蔽；② 分数区间被压缩；③ 阈值卡在合成分上时改动无法归因 ⇒ 本版只做描述性统计，不做任何归因。",
  ];

  const customPayload: CompositeFactorPayload = {
    computationVersion: COMPUTATION_VERSION,
    templateId: COMPOSITE_FACTOR_TEMPLATE_ID,
    experimentType: COMPOSITE_FACTOR_EXPERIMENT_TYPE,
    contractId: args.spec.contractId,
    composition: {
      memberCount: args.members.length,
      equalWeight: args.weighting.spec.mode === "EQUAL",
      weightSum: [...args.weighting.weights.values()].reduce(
        (sum, value) => sum + value,
        0
      ),
      fingerprint: compositionFingerprint,
      members: args.members.map(member => ({
        code: member.code,
        label: member.label,
        source: member.source,
        direction: member.direction,
        orientation: member.orientation,
        priorVerified: member.priorVerified,
        weight: args.weighting.weights.get(member.code) ?? 0,
        contractFingerprint: member.contractFingerprint,
      })),
      weightingDisclosure: args.weighting.disclosure,
    },
    normalization: {
      method: args.spec.normalization,
      label: args.normalizationLabel,
      bucketContractId: BUCKET_CONTRACT_ID,
      bucketFingerprint: args.bucketFingerprint,
      disclosure: args.normalizationDisclosure,
    },
    ranking: {
      key: args.rankedKey,
      direction: "HIGH",
      topNSizes: [...args.spec.topNSizes],
      dayScopes: [...args.spec.dayScopes],
      fixedDayMinSize: Math.max(...args.spec.topNSizes),
      minDayCount: MIN_DECISION_DAY_COUNT,
      unit: "决策日 = 首板日 T（信息截止 T+5 收盘）",
    },
    coordinate: {
      entryDay: args.coordinate.entryDay,
      exitRelativeDay: args.coordinate.exitRelativeDay,
      roundTripCostBps: args.coordinate.roundTripCostBps,
      decisionOffsetDays: args.coordinate.decisionOffsetDays,
      informationCutoffRelativeDay: args.coordinate.informationCutoffRelativeDay,
      observationRelativeDays: [...args.coordinate.observationRelativeDays],
    },
    protocol: {
      phase,
      protocolId: args.protocol?.protocolId ?? null,
      protocolVersion: args.protocol?.protocolVersion ?? null,
      hypothesisCode: args.protocol?.hypothesisCode ?? null,
      protocolFingerprint: args.protocol?.protocolFingerprint ?? null,
      evaluationWindow:
        evaluationWindow === null
          ? null
          : { startDate: evaluationWindow.startDate, endDate: evaluationWindow.endDate },
      windowApplied,
    },
    windowApplied,
    sampleAccounting: {
      candidateCount: args.derivation.candidateCount,
      eligibleCount,
      excludedCount,
      excludedByReason,
      completeCaseCount,
      missingByMember: args.missingByMember,
      notes: [
        windowApplied
          ? `🔴 本 Run 带**平台评估窗口** [${evaluationWindow!.startDate}..${evaluationWindow!.endDate}]` +
            `（阶段 ${phase}）⇒ 事件由**取数层**过滤，candidateCount 只统计窗口内事件；` +
            "全库事件数与未扫描数记为不可得（null），**不谎报**全库账。此 Run 的候选数**不应**与全窗口 Run 对拍。"
          : "入池条件与 12F / Top-N / 单因子三个实验**逐字相同**（同一份 derive.ts）⇒ 候选数 / 剔除原因应逐项一致。",
        `严格收盘涨停 ${args.derivation.exactLimitUpCloseCount}；重复 eventId ${args.derivation.duplicateEventIdCount}；横向截面 peer ${args.derivation.crossSectionPeerCount}；前置窗口缺失 ${args.derivation.prefixWindowMissingCount}。`,
        `12 因子完备用例 ${completeCaseCount} 条；合成分可评估 ${eligibleCount} 条；不可评估 ${completeCaseCount - eligibleCount} 条。`,
      ],
    },
    compositeScore: { ...args.compositeSummary },
    overall: { ...args.analysis.overall },
    topn,
    excess: args.analysis.excessRows.map(row => ({ ...row })),
    benchmark: args.analysis.benchmarkRows.map(row => ({ ...row })),
    timeSlice: args.analysis.timeSlices.map(row => ({ ...row })),
    dayDiagnostics: { ...args.analysis.dayDiagnostics },
    trades: {
      previewLimit: TRADE_PREVIEW_LIMIT,
      index: args.analysis.evaluations.map(evaluation => ({
        comboId: evaluation.comboId,
        sizeLabel: evaluation.sizeLabel,
        scope: evaluation.scope,
        tradeCount: evaluation.result.trades.length,
        previewRows:
          evaluation.scope === "OWN"
            ? Math.min(TRADE_PREVIEW_LIMIT, evaluation.result.trades.length)
            : 0,
      })),
      artifactNames: [...artifactNames],
    },
    referenceCheck: {
      referenceExperimentId: REFERENCE_EXPERIMENT_ID,
      referenceCandidateCount: REFERENCE_CANDIDATE_COUNT,
      actualCandidateCount: args.derivation.candidateCount,
      matchesCandidateCount:
        args.derivation.candidateCount === REFERENCE_CANDIDATE_COUNT,
      referenceEligibleCount: REFERENCE_ELIGIBLE_COUNT,
      actualEligibleCount: eligibleCount,
      matchesEligibleCount: eligibleCount === REFERENCE_ELIGIBLE_COUNT,
      referenceComparable: !windowApplied,
      referenceNote: windowApplied
        ? `本 Run 带评估窗口 [${evaluationWindow!.startDate}..${evaluationWindow!.endDate}] ⇒ ` +
          `全窗口锚点 ${REFERENCE_CANDIDATE_COUNT} / ${REFERENCE_ELIGIBLE_COUNT} **不适用**，` +
          "matchesCandidateCount / matchesEligibleCount 预期为 false（这不是失败，是口径不可比）。"
        : null,
    },
    verdictRowCount,
    disclosures,
  };

  // 🔴 协议 Run 必须产出 confirmatoryGate（否则平台以 EXPERIMENT_CONFIRMATORY_GATE_INVALID 拒绝）。
  //    EXPLORATORY 则**不得**产出（`validateConfirmatoryGate` 会抛）。
  const gatePayload =
    gate === null ? {} : { confirmatoryGate: gate };

  const tables: ExperimentResultTable[] = [
    {
      key: "cf_composition",
      title: "成员与权重（组合的完整定义）",
      description:
        "每个成员的方向来自 FROZEN-BUCKET-CONTRACT-001 的方向表，本模板不重估方向；权重为本次运行生效值（已归一化到 Σ=1）。",
      columns: [
        tableColumn("code", "成员 code"),
        tableColumn("label", "成员"),
        tableColumn("direction", "方向"),
        tableColumn("orientation", "契约 orientation"),
        tableColumn("priorVerified", "方向置信"),
        tableColumn("weight", "权重"),
        tableColumn("source", "出处实验"),
        tableColumn("contractFingerprint", "成员契约指纹"),
      ],
      rows: customPayload.composition.members.map(member => ({ ...member })),
    },
    {
      key: "cf_overall",
      title: "Overall · 全样本等权（不做任何选择）",
      description:
        "全部入池样本、每个决策日等权。它是「什么也不挑」的参考线；与各档 TopN 的差异才是「取头部」的效果。",
      columns: [
        tableColumn("daysIncluded", "决策日数"),
        tableColumn("trades", "样本笔数"),
        tableColumn("meanTradeReturn", "逐笔均值", 6),
        tableColumn("winRate", "胜率", 6),
        tableColumn("totalReturn", "累计净收益（复利）", 6),
        tableColumn("maxDrawdown", "最大回撤", 6),
        tableColumn("benchmarkReturn", "基准累计", 6),
        tableColumn("costDrag", "成本拖累", 6),
      ],
      rows: [
        {
          daysIncluded: customPayload.overall.daysIncluded,
          trades: customPayload.overall.trades,
          meanTradeReturn: customPayload.overall.metrics.meanTradeReturn,
          winRate: customPayload.overall.metrics.winRate,
          totalReturn: customPayload.overall.metrics.totalReturn,
          maxDrawdown: customPayload.overall.metrics.maxDrawdown,
          benchmarkReturn: customPayload.overall.metrics.benchmarkReturn,
          costDrag: customPayload.overall.metrics.costDrag,
        },
      ],
    },
    {
      key: "cf_topn",
      title: "TopN · 各档组合指标（4 档 × 2 日集）",
      description:
        "等权口径下「逐笔均值」与「组合日收益均值」同值。日集 OWN = 当日可用样本 ≥ 该档 N；FIXED = 当日可用样本 ≥ 最大档 N（跨 N 可比）。",
      columns: [
        tableColumn("sizeLabel", "档位"),
        tableColumn("scope", "日集"),
        tableColumn("daysIncluded", "纳入日数"),
        tableColumn("daysExcludedSmall", "样本不足排除日"),
        tableColumn("tradeCount", "选出笔数"),
        tableColumn("meanTradeReturn", "逐笔均值", 6),
        tableColumn("winRate", "胜率", 6),
        tableColumn("totalReturn", "累计净收益", 6),
        tableColumn("maxDrawdown", "最大回撤", 6),
        tableColumn("profitFactor", "盈亏比", 6),
        tableColumn("averageHoldingDays", "平均持有日", 3),
        tableColumn("portfolioVerdict", "绝对判定"),
      ],
      rows: topn.map(row => ({
        sizeLabel: row.label,
        scope: row.scope,
        daysIncluded: row.daysIncluded,
        daysExcludedSmall: row.daysExcludedSmall,
        tradeCount: row.metrics.tradeCount,
        meanTradeReturn: row.metrics.meanTradeReturn,
        winRate: row.metrics.winRate,
        totalReturn: row.metrics.totalReturn,
        maxDrawdown: row.metrics.maxDrawdown,
        profitFactor: row.metrics.profitFactor,
        averageHoldingDays: row.metrics.averageHoldingDays,
        portfolioVerdict: row.portfolioVerdict,
      })),
    },
    {
      key: "cf_excess",
      title: "Excess · 配对日度超额（主判据）",
      description:
        "excess = 当日 TopN 等权净收益 − 当日全池等权净收益（同日、同成本、同坐标，配对）。verdict：CI 下界 > 0 ⇒ POSITIVE，上界 < 0 ⇒ NEGATIVE，跨 0 ⇒ INCONCLUSIVE，日数 < 100 ⇒ INSUFFICIENT。",
      columns: [
        tableColumn("sizeLabel", "档位"),
        tableColumn("scope", "日集"),
        tableColumn("daysIncluded", "纳入日数"),
        tableColumn("excessMean", "超额(日均)", 6),
        tableColumn("excessCi95Low", "CI95 下", 6),
        tableColumn("excessCi95High", "CI95 上", 6),
        tableColumn("verdict", "判定"),
        tableColumn("dayWinRate", "日胜率", 6),
      ],
      rows: customPayload.excess.map(row => ({ ...row })),
    },
    {
      key: "cf_benchmark",
      title: "Benchmark · 当日池等权 + 随机 N 分布",
      description:
        "benchmarkMean = 与该档同日集的当日池等权日均净收益；randomPercentile = 该档组合日均落在「随机抽同样多只」1 000 次分布中的分位（越低越差）。",
      columns: [
        tableColumn("sizeLabel", "档位"),
        tableColumn("scope", "日集"),
        tableColumn("daysIncluded", "日数"),
        tableColumn("benchmarkMean", "当日池日均", 6),
        tableColumn("benchmarkTotalReturn", "当日池累计", 6),
        tableColumn("randomP50", "随机 P50", 6),
        tableColumn("randomPercentile", "观测分位", 4),
        tableColumn("impliedPValue", "单侧 p", 4),
      ],
      rows: customPayload.benchmark.map(row => ({ ...row })),
    },
    {
      key: "cf_time_slice",
      title: "TimeSlice · 按年（OWN 日集）",
      description:
        "逐年复核超额是否由某一年单独贡献。⚠️ 单个年份的日数通常远小于判定门槛 ⇒ 年度判定多为 INSUFFICIENT，本表用于**形状**判断而非显著性。",
      columns: [
        tableColumn("year", "年"),
        tableColumn("sizeLabel", "档位"),
        tableColumn("daysIncluded", "日数"),
        tableColumn("portfolioMean", "组合日均", 6),
        tableColumn("benchmarkMean", "当日池日均", 6),
        tableColumn("excessMean", "超额(日均)", 6),
        tableColumn("excessCi95Low", "CI95 下", 6),
        tableColumn("excessCi95High", "CI95 上", 6),
        tableColumn("verdict", "判定"),
      ],
      rows: customPayload.timeSlice.map(row => ({ ...row })),
    },
    {
      key: "cf_day_size",
      title: "决策日样本量诊断",
      description: "「每天能挑前几名」的可操作空间：当日可用样本数的日数分布。",
      columns: [tableColumn("metric", "指标"), tableColumn("value", "值", 3)],
      rows: [
        { metric: "决策日总数", value: customPayload.dayDiagnostics.daysTotal },
        { metric: "当日样本 ≥ 3 的日数", value: customPayload.dayDiagnostics.daysAtLeast3 },
        { metric: "当日样本 ≥ 5 的日数", value: customPayload.dayDiagnostics.daysAtLeast5 },
        { metric: "当日样本 ≥ 10 的日数", value: customPayload.dayDiagnostics.daysAtLeast10 },
        { metric: "当日样本 ≥ 20 的日数", value: customPayload.dayDiagnostics.daysAtLeast20 },
        { metric: "当日样本中位", value: customPayload.dayDiagnostics.daySizeP50 },
        { metric: "当日样本均值", value: customPayload.dayDiagnostics.daySizeMean },
        { metric: "当日样本最大", value: customPayload.dayDiagnostics.daySizeMax },
      ],
    },
    {
      key: "cf_trades_preview",
      title: `TradeDetails · 逐笔预览（每档前 ${TRADE_PREVIEW_LIMIT} 笔，OWN 日集）`,
      description:
        "全量逐笔在本次 Run 的 CSV 产物里（页面「产物」区可下载）。rank = 该笔在当日横截面的名次（1 = 合成分最高）；poolSize = 当日可排名样本数。",
      columns: [
        tableColumn("sizeLabel", "档位"),
        tableColumn("rank", "当日名次"),
        tableColumn("poolSize", "当日池"),
        tableColumn("stockCode", "代码"),
        tableColumn("eventDate", "首板日 T"),
        tableColumn("entryDate", "入场日"),
        tableColumn("exitDate", "退出日"),
        tableColumn("compositeScore", "合成分", 6),
        tableColumn("holdingDays", "持有日"),
        tableColumn("grossReturn", "毛收益", 6),
        tableColumn("netReturn", "净收益", 6),
      ],
      rows: buildTradePreview(args, eventDateByEventId),
    },
    ...(gateChecks.length === 0
      ? []
      : [
          {
            key: "cf_confirmatory_gate",
            title: "确认性冻结判定（平台协议）",
            description:
              "OBSERVATION 只检查「窗口已施加 + 样本足够」，用于放行 Holdout；" +
              "HOLDOUT 按预先冻结的通过条件逐项判定。⚠️ 条件 3（优于 12F-EQ 同档）需要跨 Run 对照，" +
              "本表**无法自足**判定，标注为 INSUFFICIENT，由结论文档层给出。",
            columns: [
              tableColumn("code", "检查"),
              tableColumn("label", "说明"),
              tableColumn("status", "状态"),
              tableColumn("value", "值", 4),
              tableColumn("threshold", "阈值", 4),
              tableColumn("note", "备注"),
            ],
            rows: gateChecks.map(check => ({
              code: check.code,
              label: check.label,
              status: check.status,
              value: check.value ?? null,
              threshold: check.threshold ?? null,
              note: check.note ?? null,
            })),
          },
        ]),
  ];

  const topnOwn = topn.filter(row => row.scope === "OWN");
  const statistics: ExperimentResultStatistic[] = [
    {
      code: "decision_day_count",
      label: "决策日总数",
      value: customPayload.dayDiagnostics.daysTotal,
      unit: "日",
      digits: 0,
    },
    {
      code: "composite_score_p50",
      label: "合成分中位",
      value: customPayload.compositeScore.p50,
      unit: "ratio",
      digits: 6,
      note: `取值范围 [${customPayload.compositeScore.min}, ${customPayload.compositeScore.max}]（合成分是加权和，∈ (0,1)）。`,
    },
    ...topnOwn.map(
      (row): ExperimentResultStatistic => ({
        code: `excess_${row.comboId.toLowerCase()}`,
        label: `${row.label} 配对日度超额（OWN 日集，主判据）`,
        value: row.excessMean,
        unit: "ratio",
        digits: 6,
        sampleCount: row.daysIncluded,
        note: `判定 ${row.excessVerdict}；CI95 [${row.excessCi95Low}, ${row.excessCi95High}]；日胜率 ${row.dayWinRate}`,
      })
    ),
  ];

  return {
    sampleSummary: {
      candidateCount: args.derivation.candidateCount,
      eligibleCount,
      excludedCount,
      excludedByReason,
      notes: [
        "本实验与 first-board-pullback/twelve-factor-composite-study 及其 Top-N 实验共用同一份样本派生（derive.ts）⇒ 候选数 / 入池数 / 剔除原因应逐项相同。",
        `12 因子完备用例 ${completeCaseCount} 条；合成分可评估 ${eligibleCount} 条；不可评估 ${completeCaseCount - eligibleCount} 条（逐成员登记在 missingByMember）。`,
        `带判定的结果行 ${verdictRowCount} 行（多重比较披露见 customPayload.disclosures）。`,
      ],
    },
    ...gatePayload,
    tables,
    statistics,
    customPayload,
  };
}

/**
 * 组装确认性 Gate（**只有** `OBSERVATION` / `HOLDOUT` 才有）。
 *
 * ## 为什么条件 3 只能标 INSUFFICIENT
 *
 * 任务书 §4.3 的通过条件 3 = 「N3 / N5 / N10 中至少 2 档超额均值高于 12F-EQ 同档」。
 * `12F-EQ` 是**另一个实验**、**另一个 Run**，而 `ExperimentRunContext` 里没有任何跨 Run 读口
 * （只有本 Run 的 descriptor / protocol / parameters / dataset）。
 * ⇒ 在 `run()` 内**不可能**诚实地判定条件 3。
 *
 * 两种造假方式都排除：① 把条件 3 当作 PASS（假通过）；② 把 12F-EQ 的数字硬编码成常量（写死一个会漂移的锚点）。
 * 因此这里如实地把它标为 `INSUFFICIENT`，并在 Gate summary 与结论文档里都写明「Gate 只覆盖自足条件」。
 *
 * ⚠️ 由此产生的一条**使用纪律**：本实验的 Gate = PASS **不等于**任务书 §4.3 全部通过；
 *    策略转正路径（`strategyBridge`）只看 Gate，因此不得据 Gate PASS 单独宣称「通过验证」。
 */
function buildConfirmatoryGate(args: {
  readonly protocol?: ExperimentProtocolContext | null;
  readonly excessRows: readonly { comboId: string; scope: string; daysIncluded: number; excessMean: number | null; verdict: string }[];
  readonly sampleCount: number;
}): ExperimentConfirmatoryGate | null {
  const protocol = args.protocol ?? null;
  if (protocol === null || protocol.phase === "EXPLORATORY") return null;
  if (protocol.protocolFingerprint === null) {
    throw new Error("确认性 Run 缺少 protocolFingerprint（平台契约不允许）");
  }
  const window = protocol.evaluationWindow;
  const fixed = args.excessRows.filter(row => row.scope === "FIXED");
  const fixedDays = fixed.length === 0 ? 0 : Math.min(...fixed.map(row => row.daysIncluded));
  const checks: ExperimentConfirmatoryGate["checks"][number][] = [
    {
      code: "evaluation_window_applied",
      label: "评估窗口由平台在取数层施加",
      status: window === null ? "FAIL" : "PASS",
      value: null,
      threshold: null,
      note:
        window === null
          ? "协议 Run 却没有评估窗口（不应发生）"
          : `${protocol.phase} 窗口 [${window.startDate}..${window.endDate}]`,
    },
    {
      code: "fixed_day_sample_sufficiency",
      label: "FIXED 日集纳入日数不少于判定门槛",
      status: fixedDays >= MIN_DECISION_DAY_COUNT ? "PASS" : "INSUFFICIENT",
      value: fixedDays,
      threshold: MIN_DECISION_DAY_COUNT,
      note: `FIXED 日集四档纳入日数的最小值；门槛 = ${MIN_DECISION_DAY_COUNT}`,
    },
  ];

  if (protocol.phase === "OBSERVATION") {
    const ready = checks.every(check => check.status === "PASS");
    return {
      status: ready ? "OBSERVATION_READY" : "INSUFFICIENT",
      protocolFingerprint: protocol.protocolFingerprint,
      sampleCount: args.sampleCount,
      checks,
      summary: ready
        ? `Observation 段（窗口 [${window?.startDate}..${window?.endDate}]）准备就绪：` +
          "窗口已由取数层施加、FIXED 日集样本足够 ⇒ 可进入 Holdout。"
        : "Observation 段样本不足，当前不能进入 Holdout。",
    };
  }

  const headIds = ["N3", "N5", "N10"];
  const posIds = fixed.filter(row => row.verdict === "POSITIVE").map(row => row.comboId);
  const headPosIds = posIds.filter(id => headIds.includes(id));
  const headPosCount = headPosIds.length;
  const condition1 = posIds.length >= 3 && fixed.length === 4;
  const condition2 = headPosIds.includes("N3") || headPosIds.includes("N5");
  checks.push(
    {
      code: "condition_1_pos_at_least_3_of_4",
      label: "§4.3 条件 1：FIXED 日集四档中至少 3 档 POSITIVE",
      status: fixed.length === 4 ? (posIds.length >= 3 ? "PASS" : "FAIL") : "INSUFFICIENT",
      value: posIds.length,
      threshold: 3,
      note: `POSITIVE 档位：${posIds.join(" / ") || "（无）"}`,
    },
    {
      code: "condition_2_n3_or_n5_positive",
      label: "§4.3 条件 2：N3 或 N5 至少一档 POSITIVE",
      status: condition2 ? "PASS" : "FAIL",
      value: headPosCount,
      threshold: 1,
      note: `N3/N5/N10 中 POSITIVE 的档位：${headPosIds.join(" / ") || "（无）"}`,
    },
    {
      code: "condition_3_beats_12f_equal_weight",
      label: "§4.3 条件 3：N3 / N5 / N10 中至少 2 档优于 12F-EQ 同档",
      status: "INSUFFICIENT",
      value: null,
      threshold: 2,
      note:
        "需要跨 Run 读取 12F-EQ 的同档超额，而 run() 无跨 Run 读口 ⇒ 本 Gate **不判定**，" +
        "由结论文档层对照后给出。**Gate = PASS 不等于 §4.3 全部通过。**",
    },
  );
  const insufficient = checks.some(check => check.status === "INSUFFICIENT");
  const status = insufficient
    ? "INSUFFICIENT"
    : condition1 && condition2
      ? "PASS"
      : "FAIL";
  return {
    status,
    protocolFingerprint: protocol.protocolFingerprint,
    sampleCount: args.sampleCount,
    checks,
    summary:
      status === "PASS"
        ? "Holdout 自足条件（窗口已施加 + 样本足够 + §4.3 条件 1/2）全部通过；" +
          "⚠️ 条件 3（优于 12F-EQ 同档）需跨 Run 对照，见结论文档。"
        : status === "FAIL"
          ? "Holdout 样本充足，但 §4.3 条件 1 或条件 2 未通过。"
          : "Holdout 样本不足或存在无法自足判定的条件（条件 3），不能作出确认性判定。",
  };
}

function buildTradePreview(
  args: AssembleCompositeFactorArgs,
  eventDateByEventId: ReadonlyMap<string, string>
): Record<string, string | number | boolean | null>[] {
  const rows: Record<string, string | number | boolean | null>[] = [];
  for (const evaluation of args.analysis.evaluations) {
    if (evaluation.scope !== "OWN") continue;
    for (const trade of evaluation.result.trades.slice(0, TRADE_PREVIEW_LIMIT)) {
      rows.push({
        sizeLabel: evaluation.sizeLabel,
        rank: trade.rank,
        poolSize: trade.poolSize,
        stockCode: trade.stockCode,
        eventDate: eventDateByEventId.get(trade.eventId) ?? null,
        entryDate: trade.entryDate,
        exitDate: trade.exitDate,
        compositeScore: trade.factorValue,
        holdingDays: trade.holdingDays,
        grossReturn: trade.grossReturn,
        netReturn: trade.netReturn,
      });
    }
  }
  return rows;
}

/**
 * 写 CSV 产物（gzip）：每档 OWN 的**全量逐笔**与**日度序列**。
 *
 * 逐笔是「交易明细」需求的完整载体；日度序列用于离线画净值 / 回撤。
 */
function writeTradesAndSeries(
  args: AssembleCompositeFactorArgs
): readonly string[] {
  const names: string[] = [];
  for (const evaluation of args.analysis.evaluations) {
    if (evaluation.scope !== "OWN") continue;
    const suffix = `${evaluation.comboId.toLowerCase()}-own`;

    const tradeLines = [TRADE_COLUMNS.join(",") + "\n"];
    for (const trade of evaluation.result.trades) {
      tradeLines.push(
        [
          evaluation.comboId,
          evaluation.scope,
          trade.rank,
          trade.poolSize,
          csvCell(trade.stockCode),
          trade.eventId,
          trade.factorValue,
          trade.signalDate,
          trade.entryDate,
          trade.entryPrice,
          trade.exitDate,
          trade.exitPrice,
          trade.exitRelativeDay,
          trade.holdingDays,
          trade.grossReturn,
          trade.cost,
          trade.costBps,
          trade.netReturn,
        ].join(",") + "\n"
      );
    }
    const tradeName = `composite/trades-${suffix}.csv.gz`;
    args.context.artifact({
      name: tradeName,
      role: "table",
      body: new Uint8Array(
        gzipSync(Buffer.from(tradeLines.join(""), "utf8"), { level: 6 })
      ),
      contentType: "application/gzip",
      label: `${evaluation.sizeLabel} 逐笔明细（OWN 日集）`,
      description:
        "全量逐笔：名次 / 当日池 / 入场退出日期与价格 / 毛净收益 / 成本；与结果信封的 tradeCount 一致。",
    });
    names.push(tradeName);

    const seriesName = `composite/daily-${suffix}.csv.gz`;
    args.context.artifact({
      name: seriesName,
      role: "table",
      body: new Uint8Array(
        gzipSync(
          Buffer.from(
            dailySeriesCsvOf(evaluation.netDaily, "portfolio_net_return"),
            "utf8"
          ),
          { level: 6 }
        )
      ),
      contentType: "application/gzip",
      label: `${evaluation.sizeLabel} 日度组合净收益（OWN 日集）`,
      description: "event_date, portfolio_net_return —— 离线画净值 / 回撤用。",
    });
    names.push(seriesName);
  }
  return names;
}
