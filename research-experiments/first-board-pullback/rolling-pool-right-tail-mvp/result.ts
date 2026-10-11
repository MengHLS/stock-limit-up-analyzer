/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` · 结果结构与组装。
 *
 * | 文件 | 回答的问题 |
 * | --- | --- |
 * | `experiment.ts` | 研究什么、怎么算（元数据 + 取数 + 投影 + 统计） |
 * | `result.ts` | 结果长什么样（自有 schema + 表格 / 统计 / 图表怎么组装） |
 *
 * 🔴 schema 与组装函数**必须同文件**：口径与产物放在一起，schema 就不可能和真实产物漂移。
 * 🔴 页面今天实际渲染的是 `GenericExperimentResult`（信封），所以关键数字必须进
 *    `tables` / `statistics` / `charts`，不能只放在 `customPayload` 里。
 */

import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import {
  ARM_LABELS,
  COST_PRIMARY_ROUND_TRIP_BPS,
  COST_SENSITIVITY_ROUND_TRIP_BPS,
  MAIN_WINDOW,
  PRE_RETURN10_PREFIX_DAYS,
  REJECTION_REASON_LABELS,
  RANDOM_DRAW_COUNT,
  RANDOM_SEED_BASE,
  RESEARCH_VERDICTS,
  ROLLING_POOL_COMPUTATION_VERSION,
  SELECTABLE_AGE_LOWER_BOUND,
  SIGNAL_LABEL_LABELS,
  TOP_K,
  WATCH_MAX_AGE,
  WATCH_MIN_AGE,
  type ArmId,
  type EventAccounting,
  type OpportunitySegment,
  type ResearchVerdict,
} from "@experiments/shared/rollingPoolRightTail/types";
import type {
  DifferenceInterval,
  PairedField,
  YearSlice,
} from "@experiments/shared/rollingPoolRightTail/stats";

export const COMPUTATION_VERSION = ROLLING_POOL_COMPUTATION_VERSION;

/** 事件级剔除原因说明（会随结果下发，供页面翻译；键必须在 `EventAccounting` 里出现）。 */
export const EVENT_EXCLUSION_LABELS = {
  NOT_FIRST_LIMIT: "权威 firstBoard 事实不成立（今日涨停且前一交易日非涨停）",
  NOT_MAIN_BOARD: "非沪深主板（构建期已限定 main；此处为二次防护）",
  DUPLICATE_EVENT_ID: "同一 eventId 在事件表里重复",
  EVENT_OUTSIDE_POOL_WINDOW: "事件日距主研究窗口过远，窗口内不可能进入 rd1..40 观察池",
  NEVER_IN_WATCH_POOL: "在窗口内没有任何 rd1..40 的交易日 ⇒ 从未进入观察池",
} as const;

export const EXCLUSION_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ...EVENT_EXCLUSION_LABELS,
});

/** 一条臂的汇总（进信封与自有结构）。 */
export interface ArmSummary {
  readonly arm: ArmId;
  readonly label: string;
  readonly decisionDayCount: number;
  readonly signalCount: number;
  readonly uniqueSymbolCount: number;
  readonly noFillCount: number;
  readonly rightCensoredCount: number;
  readonly unexitedMtmCount: number;
  readonly executableCount: number;
  readonly meanNet20: number | null;
  readonly medianNet20: number | null;
  readonly winRate: number | null;
  readonly loss10Rate: number | null;
  readonly q05: number | null;
  readonly tail20Rate: number | null;
  readonly tail50Rate: number | null;
  readonly tail100Rate: number | null;
  readonly meanNet50: number | null;
  readonly tail20Rate50: number | null;
  readonly pathTail20Rate: number | null;
  readonly noFillRate: number | null;
  readonly repeatedSignalRate: number | null;
  /** 配对差（臂 − Random）区间，键 = 指标名。 */
  readonly differences: Readonly<Record<string, DifferenceInterval>>;
  readonly yearly: readonly YearSlice[];
  readonly opportunitySegmentCount: number;
  readonly opportunitySegmentsWithTailHit: number;
}

export interface ArmVerdict {
  readonly arm: ArmId;
  readonly verdict: ResearchVerdict;
  readonly reasons: readonly string[];
  readonly rightTailEvidence: boolean;
  readonly riskTradeoff: boolean;
}

/** 组装结果所需的一切（由 `experiment.ts` 产出）。 */
export interface RollingPoolComputeOutput {
  readonly accounting: EventAccounting;
  readonly anchorSwitchCount: number;
  readonly decisionDateCount: number;
  readonly dailyLedgerRowCount: number;
  readonly calibrationNote: string;
  readonly coverageNotes: readonly string[];
  readonly arms: readonly ArmSummary[];
  readonly verdicts: readonly ArmVerdict[];
  readonly segments: readonly OpportunitySegment[];
  readonly pairingFields: readonly PairedField[];
  /** 随结果下发的规模统计（用于「是否能形成可参与的机会」一节）。 */
  readonly poolSizeByDate: { readonly min: number; readonly median: number; readonly max: number };
  readonly ageHistogram: readonly { readonly age: number; readonly count: number }[];
  readonly repeatSignalNote: string;
}

/** 本实验自有结果结构。 */
export const rollingPoolCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  exclusionReasonLabels: z.record(z.string(), z.string()),
  rejectionReasonLabels: z.record(z.string(), z.string()),
  signalLabelLabels: z.record(z.string(), z.string()),
  frozenConfig: z.object({
    datasetVersionId: z.number().int().positive(),
    datasetVersionLabel: z.string().min(1),
    mainWindowStart: z.string().min(1),
    mainWindowEnd: z.string().min(1),
    watchMinAge: z.number().int(),
    watchMaxAge: z.number().int(),
    selectableAgeLowerBound: z.number().int(),
    topK: z.number().int(),
    randomDrawCount: z.number().int(),
    randomSeedBase: z.number().int(),
    roundTripCostBpsPrimary: z.number(),
    roundTripCostBpsSensitivity: z.number(),
    preReturn10PrefixDays: z.array(z.number().int()),
  }),
  contractGaps: z.array(z.string().min(1)),
  arms: z.array(
    z.object({
      arm: z.enum(["R", "M", "RANDOM"]),
      label: z.string(),
      decisionDayCount: z.number().int().nonnegative(),
      signalCount: z.number().int().nonnegative(),
      noFillCount: z.number().int().nonnegative(),
      rightCensoredCount: z.number().int().nonnegative(),
      unexitedMtmCount: z.number().int().nonnegative(),
      tail20Rate: z.number().nullable(),
      pathTail20Rate: z.number().nullable(),
      opportunitySegmentCount: z.number().int().nonnegative(),
      opportunitySegmentsWithTailHit: z.number().int().nonnegative(),
    }),
  ),
  verdicts: z.array(
    z.object({
      arm: z.enum(["R", "M", "RANDOM"]),
      verdict: z.enum(RESEARCH_VERDICTS),
      reasons: z.array(z.string()),
    }),
  ),
});

export type RollingPoolCustomPayload = z.infer<typeof rollingPoolCustomPayloadSchema>;

const CONTRACT_GAPS = [
  "`decisionOffsetDays` 是**单标量** ⇒ 逐日变化的决策坐标只能表达为内存投影；本实验声明 40（资格判定的**上界**），不是逐日精确坐标。",
  "`observation(rd)` 无 eventId / 日期参数 ⇒ 逐日池只能从「整层 rd」投影；`freezeSelection` 一次性，冻结集 = 候选宇宙而非逐日成员。",
  "逐日 ST / 上市龄不在 Dataset 端口内 ⇒ 事件日非 ST 由构建期 `excludeSt=1` 保证；逐日 ST 记 `UNKNOWN`，**未实现每日非ST控制**（不伪造）。",
  `权威 \`maxAmp5\` 的决策时点下界 = rd${SELECTABLE_AGE_LOWER_BOUND} ⇒ 与规格「可选候选 rd5..40」的交集 = rd${SELECTABLE_AGE_LOWER_BOUND}..${WATCH_MAX_AGE}；rd5..${SELECTABLE_AGE_LOWER_BOUND - 1} 仍留观察账。`,
];

function pct(value: number | null): number | null {
  return value === null ? null : value * 100;
}

const INTERVAL_COLUMNS = [
  { key: "pointEstimate", label: "点估计", digits: 6 },
  { key: "low", label: "97.5%下界", digits: 6 },
  { key: "high", label: "97.5%上界", digits: 6 },
  { key: "dayCount", label: "决策日数", digits: 0 },
  { key: "blockLength", label: "block", digits: 0 },
] as const;

/** 组装最终结果（表格 / 统计 / 图表 / 自有结构 + 如实样本账）。 */
export function assembleRollingPoolResult(args: {
  readonly output: RollingPoolComputeOutput;
  readonly datasetVersionId: number;
  readonly datasetVersionLabel: string;
}): ExperimentResultPayload {
  const { output, datasetVersionId, datasetVersionLabel } = args;
  const { accounting } = output;
  const excludedCount = accounting.scannedEventCount - accounting.eligibleEventCount;

  const customPayload: RollingPoolCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    rejectionReasonLabels: { ...REJECTION_REASON_LABELS },
    signalLabelLabels: { ...SIGNAL_LABEL_LABELS },
    frozenConfig: {
      datasetVersionId,
      datasetVersionLabel,
      mainWindowStart: MAIN_WINDOW.startDate,
      mainWindowEnd: MAIN_WINDOW.endDate,
      watchMinAge: WATCH_MIN_AGE,
      watchMaxAge: WATCH_MAX_AGE,
      selectableAgeLowerBound: SELECTABLE_AGE_LOWER_BOUND,
      topK: TOP_K,
      randomDrawCount: RANDOM_DRAW_COUNT,
      randomSeedBase: RANDOM_SEED_BASE,
      roundTripCostBpsPrimary: COST_PRIMARY_ROUND_TRIP_BPS,
      roundTripCostBpsSensitivity: COST_SENSITIVITY_ROUND_TRIP_BPS,
      preReturn10PrefixDays: [...PRE_RETURN10_PREFIX_DAYS],
    },
    contractGaps: CONTRACT_GAPS,
    arms: output.arms.map((arm) => ({
      arm: arm.arm,
      label: arm.label,
      decisionDayCount: arm.decisionDayCount,
      signalCount: arm.signalCount,
      noFillCount: arm.noFillCount,
      rightCensoredCount: arm.rightCensoredCount,
      unexitedMtmCount: arm.unexitedMtmCount,
      tail20Rate: arm.tail20Rate,
      pathTail20Rate: arm.pathTail20Rate,
      opportunitySegmentCount: arm.opportunitySegmentCount,
      opportunitySegmentsWithTailHit: arm.opportunitySegmentsWithTailHit,
    })),
    verdicts: output.verdicts.map((item) => ({
      arm: item.arm,
      verdict: item.verdict,
      reasons: [...item.reasons],
    })),
  };

  const armTable = {
    key: "rolling-pool-arm-summary",
    title: "三臂同面板：右尾与代价（20bps 主口径 / 50bps 敏感性）",
    description:
      "R/M 与同日同池 Random 的并列读数。尾部与均值**必须同时读**：尾识别力与经济代价不是同一件事。",
    columns: [
      { key: "arm", label: "臂", align: "LEFT" as const },
      { key: "decisionDayCount", label: "决策日", align: "RIGHT" as const },
      { key: "signalCount", label: "信号数", align: "RIGHT" as const },
      { key: "tail20RatePct", label: "≥+20% 概率", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail20Rate50Pct", label: "≥+20% @50bps", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail50RatePct", label: "≥+50%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "tail100RatePct", label: "≥+100%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "pathTail20RatePct", label: "+20% 路径机会", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "meanNet20Pct", label: "净均值", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "medianNet20Pct", label: "净中位", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "winRatePct", label: "胜率", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "loss10RatePct", label: "≤−10%", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "q05Pct", label: "Q05", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "noFillRatePct", label: "NO_FILL", unit: "%", digits: 4, align: "RIGHT" as const },
    ],
    rows: output.arms.map((arm) => ({
      arm: arm.label,
      decisionDayCount: arm.decisionDayCount,
      signalCount: arm.signalCount,
      tail20RatePct: pct(arm.tail20Rate),
      tail20Rate50Pct: pct(arm.tail20Rate50),
      tail50RatePct: pct(arm.tail50Rate),
      tail100RatePct: pct(arm.tail100Rate),
      pathTail20RatePct: pct(arm.pathTail20Rate),
      meanNet20Pct: pct(arm.meanNet20),
      medianNet20Pct: pct(arm.medianNet20),
      winRatePct: pct(arm.winRate),
      loss10RatePct: pct(arm.loss10Rate),
      q05Pct: pct(arm.q05),
      noFillRatePct: pct(arm.noFillRate),
    })),
  };

  const differenceTable = {
    key: "rolling-pool-paired-differences",
    title: "逐日配对差（臂 − 同日 Random）· Bonferroni 97.5% 双侧区间",
    description:
      "每天先配对求差，再对日序列做日期移动块 bootstrap（block20 主 / block40 敏感性，1000 次，固定种子）。差值不跨 0 才算稳。",
    columns: [
      { key: "arm", label: "臂", align: "LEFT" as const },
      { key: "field", label: "指标", align: "LEFT" as const },
      { key: "block", label: "block", align: "RIGHT" as const },
      ...INTERVAL_COLUMNS.map((column) => ({
        key: column.key,
        label: column.label,
        digits: column.digits,
        align: "RIGHT" as const,
      })),
    ],
    rows: output.arms.flatMap((arm) =>
      output.pairingFields.flatMap((field) =>
        [20, 40].flatMap((block) => {
          const interval = arm.differences[`${field}|${block}`];
          if (interval === undefined) return [];
          return [{
            arm: arm.arm,
            field,
            block,
            pointEstimate: interval.pointEstimate,
            low: interval.low,
            high: interval.high,
            dayCount: interval.dayCount,
            blockLength: interval.blockLength,
          }];
        }),
      ),
    ),
  };

  const yearlyTable = {
    key: "rolling-pool-yearly",
    title: "年度片段（2024 / 2025）· 主右尾判据点估计必须同向",
    columns: [
      { key: "arm", label: "臂", align: "LEFT" as const },
      { key: "year", label: "年", align: "RIGHT" as const },
      { key: "dayCount", label: "决策日", align: "RIGHT" as const },
      { key: "signalCount", label: "信号数", align: "RIGHT" as const },
      { key: "armPointEstimate", label: "臂 ≥+20%", digits: 6, align: "RIGHT" as const },
      { key: "randomPointEstimate", label: "Random ≥+20%", digits: 6, align: "RIGHT" as const },
      { key: "difference", label: "差值", digits: 6, align: "RIGHT" as const },
    ],
    rows: output.arms.flatMap((arm) =>
      arm.yearly.map((slice) => ({
        arm: arm.arm,
        year: slice.year,
        dayCount: slice.dayCount,
        signalCount: slice.signalCount,
        armPointEstimate: slice.armPointEstimate,
        randomPointEstimate: slice.randomPointEstimate,
        difference: slice.difference,
      })),
    ),
  };

  const verdictTable = {
    key: "rolling-pool-verdict",
    title: "研究判定（事前收口规则；**不是**投资资格）",
    columns: [
      { key: "arm", label: "臂", align: "LEFT" as const },
      { key: "verdict", label: "判定", align: "LEFT" as const },
      { key: "rightTailEvidence", label: "右尾证据", align: "LEFT" as const },
      { key: "riskTradeoff", label: "风险权衡", align: "LEFT" as const },
      { key: "reasons", label: "理由", align: "LEFT" as const },
    ],
    rows: output.verdicts.map((item) => ({
      arm: item.arm,
      verdict: item.verdict,
      rightTailEvidence: item.rightTailEvidence ? "是" : "否",
      riskTradeoff: item.riskTradeoff ? "是" : "否",
      reasons: item.reasons.join("；"),
    })),
  };

  const coverageTable = {
    key: "rolling-pool-coverage",
    title: "覆盖 / 成交 / 退出 / 重复信号（是否能形成可参与的机会）",
    columns: [
      { key: "arm", label: "臂", align: "LEFT" as const },
      { key: "signalCount", label: "信号数", align: "RIGHT" as const },
      { key: "executableCount", label: "可成交", align: "RIGHT" as const },
      { key: "noFillCount", label: "NO_FILL", align: "RIGHT" as const },
      { key: "unexitedMtmCount", label: "未退出(MTM)", align: "RIGHT" as const },
      { key: "rightCensoredCount", label: "右删失", align: "RIGHT" as const },
      { key: "uniqueSymbolCount", label: "唯一股票", align: "RIGHT" as const },
      { key: "repeatedSignalRatePct", label: "重复信号", unit: "%", digits: 4, align: "RIGHT" as const },
      { key: "opportunitySegmentCount", label: "唯一机会段", align: "RIGHT" as const },
      { key: "segmentsWithTailHit", label: "含右尾命中段", align: "RIGHT" as const },
    ],
    rows: output.arms.map((arm) => ({
      arm: arm.arm,
      signalCount: arm.signalCount,
      executableCount: arm.executableCount,
      noFillCount: arm.noFillCount,
      unexitedMtmCount: arm.unexitedMtmCount,
      rightCensoredCount: arm.rightCensoredCount,
      uniqueSymbolCount: arm.uniqueSymbolCount,
      repeatedSignalRatePct: pct(arm.repeatedSignalRate),
      opportunitySegmentCount: arm.opportunitySegmentCount,
      segmentsWithTailHit: arm.opportunitySegmentsWithTailHit,
    })),
  };

  const ageHistogramTable = {
    key: "rolling-pool-age-histogram",
    title: "每日池的事件年龄分布（rd1..40）",
    columns: [
      { key: "age", label: "事件年龄 rd", align: "RIGHT" as const },
      { key: "count", label: "成员日数", align: "RIGHT" as const },
      { key: "sharePct", label: "占比", unit: "%", digits: 2, align: "RIGHT" as const },
    ],
    rows: (() => {
      const total = output.ageHistogram.reduce((sum, item) => sum + item.count, 0);
      return output.ageHistogram.map((item) => ({
        age: item.age,
        count: item.count,
        sharePct: total === 0 ? null : (item.count / total) * 100,
      }));
    })(),
  };

  return {
    // 🔴 账必须平：eligible + excluded === candidate，且 Σ excludedByReason === excluded。
    sampleSummary: {
      candidateCount: accounting.scannedEventCount,
      eligibleCount: accounting.eligibleEventCount,
      excludedCount,
      excludedByReason: { ...accounting.excludedByReason },
      notes: [
        `样本单位 = 一个权威首板事件。扫描量 = ${accounting.scannedEventCount}；数据集声明 ${accounting.datasetDeclaredEventCount ?? "未知"}；未扫描 ${accounting.unscannedEventCount}。`,
        `每日面板 = ${output.dailyLedgerRowCount} 行（股票级；每日同一 symbol 恰一行）；决策日 ${output.decisionDateCount} 天；锚点切换 ${output.anchorSwitchCount} 次。`,
        `主研究窗口 ${MAIN_WINDOW.startDate} ~ ${MAIN_WINDOW.endDate}；留池 rd${WATCH_MIN_AGE}..${WATCH_MAX_AGE}；TopK ≤ ${TOP_K}（人数不足**不补齐**）。`,
        `两主臂与 Random 共用「两因子均可评估」的当日池；逐日 ST 事实不可得 ⇒ 记为 UNAVAILABLE（见 contractGaps）。`,
        ...output.coverageNotes,
        output.calibrationNote,
        output.repeatSignalNote,
      ],
    },
    tables: [
      armTable,
      differenceTable,
      yearlyTable,
      verdictTable,
      coverageTable,
      ageHistogramTable,
    ],
    statistics: [
      {
        code: "rolling_pool_decision_days",
        label: "决策日数",
        value: output.decisionDateCount,
        unit: "个交易日",
        digits: 0,
      },
      {
        code: "rolling_pool_daily_ledger_rows",
        label: "每日股票级账行数",
        value: output.dailyLedgerRowCount,
        unit: "行",
        digits: 0,
      },
      {
        code: "rolling_pool_anchor_switches",
        label: "锚点切换次数",
        value: output.anchorSwitchCount,
        unit: "次",
        digits: 0,
      },
      {
        code: "rolling_pool_pool_size_min",
        label: "每日可评估池大小 · 最小",
        value: output.poolSizeByDate.min,
        unit: "只",
        digits: 0,
      },
      {
        code: "rolling_pool_pool_size_median",
        label: "每日可评估池大小 · 中位",
        value: output.poolSizeByDate.median,
        unit: "只",
        digits: 1,
      },
      {
        code: "rolling_pool_pool_size_max",
        label: "每日可评估池大小 · 最大",
        value: output.poolSizeByDate.max,
        unit: "只",
        digits: 0,
      },
    ],
    charts: [
      {
        key: "rolling-pool-tail20-comparison",
        title: "≥+20%（20 日固定持有，20bps）概率：R / M / Random 对照",
        kind: "BAR" as const,
        xLabel: "臂",
        yLabel: "概率",
        unit: "比例",
        series: [
          {
            key: "tail20",
            label: "≥+20% 概率",
            points: output.arms.map((arm) => ({ x: arm.arm, y: arm.tail20Rate })),
          },
        ],
      },
      {
        key: "rolling-pool-path-tail20",
        title: "+20% 路径机会率（辅助指标，**不是可实现收益**）",
        kind: "BAR" as const,
        xLabel: "臂",
        yLabel: "路径机会率",
        unit: "比例",
        series: [
          {
            key: "pathTail20",
            label: "+20% 路径机会率",
            points: output.arms.map((arm) => ({ x: arm.arm, y: arm.pathTail20Rate })),
          },
        ],
      },
    ],
    customPayload,
  };
}

export { ARM_LABELS };
