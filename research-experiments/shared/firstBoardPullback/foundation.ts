import type {
  ExperimentResultChart,
  ExperimentResultPayload,
  ExperimentResultTable,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import { FoundationPanelCsvWriter } from "./artifacts";
import { resolveFoundationCost } from "./cost";
import { FoundationCurveAccumulator } from "./curves";
import { loadNormalizedFoundationEvents } from "./dataset";
import { buildPanelRowsForEvent } from "./panel";
import {
  FIRST_BOARD_ENTRY_MODES,
  FIRST_BOARD_PULLBACK_CORE_DATASET_VERSION_LABEL,
  FOUNDATION_SAMPLE_SETS,
  type FirstBoardEntryMode,
  type FoundationAccountingRow,
  type FoundationBuildOutput,
  type FoundationCostConfig,
  type FoundationGroup,
  type FoundationGroupAssigner,
  type FoundationLineageRow,
} from "./types";

export interface FoundationBuildOptions {
  cost?: Partial<FoundationCostConfig>;
  groupByEvent?: FoundationGroupAssigner;
  pullbackTriggerBps?: number;
  eventIds?: readonly string[];
}

function assertCoreDatasetV5(context: ExperimentRunContext): void {
  if (
    context.dataset.facts.datasetVersionLabel !==
    FIRST_BOARD_PULLBACK_CORE_DATASET_VERSION_LABEL
  ) {
    throw new Error(
      `公共首板回撤底座要求 Dataset version=${FIRST_BOARD_PULLBACK_CORE_DATASET_VERSION_LABEL}，` +
        `当前是 ${context.dataset.facts.datasetVersionLabel}`
    );
  }
}

function defaultGroups(): readonly FoundationGroup[] {
  return [{ code: "ALL", label: "全部样本" }];
}

interface HorizonAccounting {
  fullSampleCount: number;
  commonSampleCount: number;
  rightCensoredCount: number;
  missingBarCount: number;
  suspendedCount: number;
  unfillableCount: number;
}

function accountingKey(
  entryMode: FirstBoardEntryMode,
  holdingDay: number
): string {
  return `${entryMode}|${holdingDay}`;
}

export async function buildFirstBoardPullbackFoundation(
  context: ExperimentRunContext,
  options: FoundationBuildOptions = {}
): Promise<FoundationBuildOutput> {
  assertCoreDatasetV5(context);
  const cost = resolveFoundationCost(options.cost);
  const loaded = await loadNormalizedFoundationEvents(
    context,
    options.eventIds
  );
  const accumulator = new FoundationCurveAccumulator();
  const panelWriter = new FoundationPanelCsvWriter();
  const groupByEvent = options.groupByEvent ?? defaultGroups;
  const accounting = new Map<FirstBoardEntryMode, FoundationAccountingRow>();
  const horizonAccounting = new Map<string, HorizonAccounting>();

  for (const entryMode of FIRST_BOARD_ENTRY_MODES) {
    accounting.set(entryMode, {
      entry_mode: entryMode,
      eligible_event_count: 0,
      full_sample_event_count: 0,
      common_sample_event_count: 0,
      right_censored_event_count: 0,
      missing_path_event_count: 0,
      suspended_event_count: 0,
      entry_unavailable_event_count: 0,
      unfillable_exit_event_count: 0,
    });
  }

  for (const event of loaded.events) {
    const groups = groupByEvent(event);
    accumulator.registerGroups(groups);
    for (const entryMode of FIRST_BOARD_ENTRY_MODES) {
      const result = buildPanelRowsForEvent(event, entryMode, cost, {
        pullbackTriggerBps: options.pullbackTriggerBps,
      });
      const row = accounting.get(entryMode)!;
      if (result.entryUnavailable) {
        row.entry_unavailable_event_count += 1;
        continue;
      }
      row.eligible_event_count += 1;
      if (result.fullSample) row.full_sample_event_count += 1;
      if (result.commonSample) row.common_sample_event_count += 1;
      if (result.rightCensored) row.right_censored_event_count += 1;
      if (result.missingPath) row.missing_path_event_count += 1;
      if (result.suspended) row.suspended_event_count += 1;
      if (result.unfillableExit) row.unfillable_exit_event_count += 1;
      accumulator.addRows(result.rows, groups);
      panelWriter.addRows(result.rows);
      for (const panelRow of result.rows) {
        const key = accountingKey(entryMode, panelRow.holding_day);
        const bucket = horizonAccounting.get(key) ?? {
          fullSampleCount: 0,
          commonSampleCount: 0,
          rightCensoredCount: 0,
          missingBarCount: 0,
          suspendedCount: 0,
          unfillableCount: 0,
        };
        bucket.fullSampleCount += 1;
        if (panelRow.common_sample_flag) bucket.commonSampleCount += 1;
        if (panelRow.right_censored) {
          bucket.rightCensoredCount += 1;
          bucket.unfillableCount += 1;
        }
        if (panelRow.missing_bar) bucket.missingBarCount += 1;
        if (panelRow.suspended) bucket.suspendedCount += 1;
        horizonAccounting.set(key, bucket);
      }
    }
  }

  const { curveRows, bootstrapRows } = accumulator.finalize();
  const accountingRows = [...accounting.values()];
  const artifactNames = panelWriter.flush(context);

  const lineage: FoundationLineageRow = {
    dataset_code: context.dataset.facts.datasetCode,
    dataset_version_id: context.dataset.facts.datasetVersionId,
    dataset_version_label: context.dataset.facts.datasetVersionLabel,
    experiment_id: context.descriptor.id,
    experiment_version: context.descriptor.version,
    code_digest: context.codeDigest,
    research_phase: context.protocol?.phase ?? "EXPLORATORY",
    protocol_fingerprint: context.protocol?.protocolFingerprint ?? null,
    sample_scope_note:
      "v5 为已读数据复核，不是 OOS；所有曲线按实际持有日对齐，不选择最佳退出日。",
  };

  const tables: ExperimentResultTable[] = [
    {
      key: "foundation_v5_lineage",
      title: "公共底座坐标",
      description: "结论必须与本表绑定的 Dataset、Experiment 与 code digest 一起读取。",
      columns: [
        { key: "dataset_version_label", label: "Dataset 版本", align: "LEFT" },
        { key: "experiment_id", label: "实验", align: "LEFT" },
        { key: "experiment_version", label: "实验版本", align: "LEFT" },
        { key: "code_digest", label: "代码摘要", align: "LEFT" },
        { key: "research_phase", label: "研究阶段", align: "LEFT" },
      ],
      rows: [lineage],
    },
    {
      key: "foundation_sample_accounting",
      title: "公共底座样本账",
      description:
        "按入场方式列出 eligible、commonSample、右删失、缺 bar、停牌和不可成交数量。",
      columns: [
        { key: "entry_mode", label: "入场方式", align: "LEFT" },
        { key: "eligible_event_count", label: "可入场", align: "RIGHT" },
        { key: "full_sample_event_count", label: "fullSample", align: "RIGHT" },
        {
          key: "common_sample_event_count",
          label: "commonSample",
          align: "RIGHT",
        },
        {
          key: "right_censored_event_count",
          label: "右删失",
          align: "RIGHT",
        },
        {
          key: "missing_path_event_count",
          label: "缺 bar",
          align: "RIGHT",
        },
        { key: "suspended_event_count", label: "停牌", align: "RIGHT" },
        {
          key: "entry_unavailable_event_count",
          label: "入场不可用",
          align: "RIGHT",
        },
        {
          key: "unfillable_exit_event_count",
          label: "退出不可成交",
          align: "RIGHT",
        },
      ],
      rows: accountingRows,
    },
    {
      key: "foundation_horizon_sample_accounting",
      title: "逐持有日样本与右删失",
      description:
        "每个入场方式 × holdingDay 的全样本、commonSample、缺 bar、停牌与不可成交数量。",
      columns: [
        { key: "entry_mode", label: "入场方式", align: "LEFT" },
        { key: "holding_day", label: "持有日", align: "RIGHT" },
        { key: "full_sample_count", label: "fullSample", align: "RIGHT" },
        { key: "common_sample_count", label: "commonSample", align: "RIGHT" },
        { key: "right_censored_count", label: "右删失", align: "RIGHT" },
        { key: "missing_bar_count", label: "缺 bar", align: "RIGHT" },
        { key: "suspended_count", label: "停牌", align: "RIGHT" },
        { key: "unfillable_count", label: "不可成交", align: "RIGHT" },
      ],
      rows: [...horizonAccounting.entries()].map(([key, bucket]) => {
        const [entryMode, holdingDay] = key.split("|");
        return {
          entry_mode: entryMode!,
          holding_day: Number(holdingDay),
          full_sample_count: bucket.fullSampleCount,
          common_sample_count: bucket.commonSampleCount,
          right_censored_count: bucket.rightCensoredCount,
          missing_bar_count: bucket.missingBarCount,
          suspended_count: bucket.suspendedCount,
          unfillable_count: bucket.unfillableCount,
        };
      }),
    },
    {
      key: "foundation_entry_aligned_curve",
      title: "公共逐日净收益曲线",
      description:
        "按实际入场日对齐的 holdingDay 曲线；fullSample 与 commonSample 分开，不选择最佳退出日。",
      columns: [
        { key: "group_label", label: "分组", align: "LEFT" },
        { key: "entry_mode", label: "入场方式", align: "LEFT" },
        { key: "sample_set", label: "样本口径", align: "LEFT" },
        { key: "holding_day", label: "持有日", align: "RIGHT" },
        { key: "sample_count", label: "样本", align: "RIGHT" },
        { key: "event_date_count", label: "事件日数", align: "RIGHT" },
        {
          key: "mean_net_return",
          label: "平均净收益",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "mean_ideal_net_return",
          label: "理想净收益",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "mean_execution_shortfall",
          label: "执行损失",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "trimmed_mean_net_return",
          label: "去最高5%均值",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "median_net_return",
          label: "中位",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "win_rate_net",
          label: "胜率",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "p5_net_return",
          label: "P5",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "p95_net_return",
          label: "P95",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "mean_mfe",
          label: "平均MFE",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "mean_mae",
          label: "平均MAE",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
      ],
      rows: curveRows,
    },
    {
      key: "foundation_anchor_bootstrap",
      title: "公共底座锚点 Bootstrap",
      description:
        "固定锚点持有日的日期聚类 Bootstrap；只用于不确定性，不用于挑最佳持有日。",
      columns: [
        { key: "group_label", label: "分组", align: "LEFT" },
        { key: "entry_mode", label: "入场方式", align: "LEFT" },
        { key: "sample_set", label: "样本口径", align: "LEFT" },
        { key: "holding_day", label: "持有日", align: "RIGHT" },
        {
          key: "mean_net_return",
          label: "平均净收益",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "bootstrap_ci95_low",
          label: "CI95下界",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        {
          key: "bootstrap_ci95_high",
          label: "CI95上界",
          unit: "比例",
          digits: 6,
          align: "RIGHT",
        },
        { key: "bootstrap_cluster_count", label: "聚类数", align: "RIGHT" },
      ],
      rows: bootstrapRows,
    },
  ];

  const charts: ExperimentResultChart[] = FIRST_BOARD_ENTRY_MODES.map(
    entryMode => ({
      key: `foundation-common-curve-${entryMode}`,
      title: `${entryMode} · commonSample 中位净收益`,
      description: "按实际持有日对齐；不选择收益最高的退出日。",
      kind: "LINE" as const,
      xLabel: "持有第 N 日",
      yLabel: "中位净收益",
      unit: "比例",
      series: [
        {
          key: `${entryMode}-common`,
          label: "commonSample",
          points: curveRows
            .filter(
              row =>
                row.entry_mode === entryMode &&
                row.sample_set === "COMMON" &&
                row.group_code === "ALL"
            )
            .map(row => ({
              x: String(row.holding_day),
              y: row.median_net_return,
            })),
        },
      ],
    })
  );

  return {
    accounting: accountingRows,
    curveRows,
    bootstrapRows,
    lineage,
    artifactNames,
    tables,
    charts,
  };
}

export function mergeFoundationIntoPayload(
  payload: ExperimentResultPayload,
  foundation: FoundationBuildOutput,
  options: {
    groupByEvent?: FoundationGroupAssigner;
  } = {}
): ExperimentResultPayload {
  void options;
  return {
    ...payload,
    tables: [...(payload.tables ?? []), ...foundation.tables],
    charts: [...(payload.charts ?? []), ...foundation.charts],
  };
}
