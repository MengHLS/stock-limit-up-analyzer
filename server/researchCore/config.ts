/**
 * RESEARCH-001 — Research 配置类型（Experiment / Run / Analysis 的 config 与执行快照）。
 *
 * 边界：
 *   - 这些类型是**开放扩展性质的配置**，落长期 `longtext` JSON（research_experiment.configJson /
 *     research_run.configJson / research_run.inputSnapshotJson / research_analysis.configJson）；
 *   - **禁止**把需要查询 / 排序 / 过滤 / 聚合的字段放进来 —— 那些必须是结构化列；
 *   - 本文件不做统计、不做回测、不读 Dataset。
 */

import type { ResearchAnalysisType, ResearchType } from "./types";

/** 可序列化配置原子值。 */
export type ResearchConfigValue = string | number | boolean | null;

/** 实验级配置（`research_experiment.configJson`）。 */
export interface ResearchExperimentConfig {
  /** 实验级自由参数（键唯一）。 */
  parameters?: Record<string, ResearchConfigValue>;
  /** 时间范围覆盖；缺省 = 使用 Dataset Version 的全区间。 */
  dateRange?: {
    startDate?: string;
    endDate?: string;
  };
  /** 新建 Analysis 时继承的默认配置。 */
  analysisDefaults?: Partial<ResearchAnalysisConfig>;
  /** 归类标签。 */
  tags?: string[];
  notes?: string;
}

/**
 * 分析配置（`research_analysis.configJson`）。
 * 这里只声明「分析要怎么算」的参数；**具体统计实现属 Research Engine**。
 */
export interface ResearchAnalysisConfig {
  /** 分组数（QUANTILE / DISTRIBUTION 分析）。 */
  quantileGroups?: number;
  /** 结果视界（交易日；与 Dataset `outcome.horizon` 对齐）。 */
  horizons?: number[];
  /** 最小样本数门槛；低于该值的结果应被标记为不可用（由 Engine 执行）。 */
  minSampleCount?: number;
  /**
   * 目标变量名（如 `future_return_5d`）。RESEARCH-002 起 = Research Engine 变量目录中的
   * **结果变量名**（OUTCOME），禁止填特征变量（Engine 会抛 VARIABLE_ROLE_VIOLATION）。
   */
  targetField?: string;
  /**
   * 特征变量名（RESEARCH-002 新增；QUANTILE / CONDITIONAL 的分组或过滤依据）。
   * 必须是变量目录中的**特征变量**（PIT 安全）。
   */
  featureField?: string;
  /**
   * 参与分析的特征 / 结果变量名清单（RESEARCH-002 新增；DESCRIPTIVE 用）。
   * 每个名字都会经变量目录做**角色校验**，用反即报错。
   */
  variables?: string[];
  /**
   * STABILITY 的分组来源（RESEARCH-002 新增；`year` / `month` / `quarter` / `board` /
   * `market` / `industry` / `regime`）。缺省 `year`。
   */
  stabilityDimension?: string;
  /** 分组维度键（写入 `research_result.dimensionJson` 的键名，如 `quantile` / `year` / `regime`）。 */
  dimensionKey?: string;
  /** 多重比较校正方法（SIGNIFICANCE 分析用）。 */
  multipleTestingCorrection?: "NONE" | "BONFERRONI" | "BENJAMINI_HOCHBERG";
  // ---- RESEARCH-004 · SEGMENT_RELATION（分段 / 两窗关系）----
  /**
   * 窗 A（分组窗）的**相对日闭区间** `[a, b]`，`1 ≤ a < b ≤ path 最大相对日`。
   * 窗 A 的统计量作**分组键**（分档），窗 B 的统计量作**结果**。
   */
  windowA?: [number, number];
  /** 窗 B（结果窗）的相对日闭区间 `[c, d]`，`1 ≤ c < d ≤ path 最大相对日`。 */
  windowB?: [number, number];
  /**
   * 窗 A / 窗 B 的统计口径。
   *
   * 注意：窗 A 的统计量是**锚点落在 a 日**的量（`close(a)` 为基准），因此它虽然能在
   * `a` 日收盘被观测到，却**不是** T 日的 PIT 安全特征 —— 角色仍是 OUTCOME。
   * 本分析回答的是**统计关系**（同一样本的两个时段如何共变），不产出 T 日可交易信号。
   */
  windowAStat?: SegmentStatKind;
  windowBStat?: SegmentStatKind;
  /** 窗 A 的分档数（≥ 2；口径与 QUANTILE 的 `quantileGroups` 相同，切点用线性插值分位）。 */
  windowBands?: number;
  /** 开放扩展（键唯一）。 */
  extra?: Record<string, ResearchConfigValue>;
}

/**
 * 分段窗统计口径（与 `researchEngine/variables.ts` 的 `segment_*` 变量族一一对应）。
 *
 * 全部以**窗起点日收盘** `close(a)` 为基准，窗内取 `relativeDay ∈ [a+1, b]`：
 *   - `return`         末值口径：`close(b) / close(a) − 1`
 *   - `max_return`     路径最大有利偏移：`max(high) / close(a) − 1`
 *   - `min_return`     路径最大不利偏移：`min(low) / close(a) − 1`
 *   - `max_drawdown`   区间最大跌幅：`min(close) / close(a) − 1`（**负值**）
 */
export const SEGMENT_STAT_KINDS = ["return", "max_return", "min_return", "max_drawdown"] as const;
export type SegmentStatKind = (typeof SEGMENT_STAT_KINDS)[number];

/** 分段窗默认分档数（与 QUANTILE 的默认 10 不同：两窗样本被配对剪裁后通常更少）。 */
export const DEFAULT_WINDOW_BANDS = 5;

/**
 * Run 执行入参（`research_run.configJson`）——申请态。
 */
export interface ResearchRunConfig {
  /** 本次执行的时间子区间；缺省 = Dataset Version 全区间。 */
  dateRange?: {
    startDate?: string;
    endDate?: string;
  };
  /** 本次执行要跑的分析类型（顺序即执行顺序）。 */
  analyses?: ResearchAnalysisType[];
  /** 本次执行是否排除极端行情（由 Engine 解释具体口径）。 */
  excludeExtremeRegime?: boolean;
  /** 随机种子（需要重采样的分析用；保证可复现）。 */
  randomSeed?: number;
  /** 开放扩展。 */
  extra?: Record<string, ResearchConfigValue>;
}

/**
 * Run **执行快照**（`research_run.inputSnapshotJson`）—— 落定态。
 *
 * 与 `ResearchRunConfig` 的区别：这是**实际执行时真实使用的**完整输入，
 * 含解析后的 Dataset Version 绑定与配置指纹。**事后不得修改**（不可变）。
 */
export interface ResearchInputSnapshot {
  /** 实际使用的 Dataset Version（必须与 Experiment 一致）。 */
  datasetVersionId: number;
  /** 冗余：Dataset 逻辑代码（便于人读追溯）。 */
  datasetCode?: string;
  /** 冗余：Dataset 版本号标签。 */
  datasetVersionLabel?: string;
  /** 实际使用的起止日期（含）。 */
  startDate?: string;
  endDate?: string;
  /** 实际生效的 run 配置（解析默认值后的完整形态）。 */
  runConfig?: ResearchRunConfig;
  /** 实际生效的实验类型。 */
  researchType?: ResearchType;
  /** 快照生成时间（ISO 8601）。 */
  snapshotAt?: string;
}

// ---------------------------------------------------------------------------
// 默认值解析（纯函数，无副作用）
// ---------------------------------------------------------------------------

/** 解析 Experiment 配置：补齐可推导的默认值。 */
export function resolveExperimentConfig(input?: ResearchExperimentConfig | null): ResearchExperimentConfig {
  const cfg = input ?? {};
  return {
    parameters: cfg.parameters ?? {},
    dateRange: cfg.dateRange,
    analysisDefaults: cfg.analysisDefaults,
    tags: cfg.tags ?? [],
    notes: cfg.notes,
  };
}

/** 解析后的分析配置（默认值必已补齐；Engine 直接消费，无需再判 undefined）。 */
export type ResolvedAnalysisConfig = Omit<
  ResearchAnalysisConfig,
  "quantileGroups" | "horizons" | "minSampleCount" | "multipleTestingCorrection" | "windowBands" | "extra"
> & {
  quantileGroups: number;
  horizons: number[];
  minSampleCount: number;
  multipleTestingCorrection: "NONE" | "BONFERRONI" | "BENJAMINI_HOCHBERG";
  windowBands: number;
  extra: Record<string, ResearchConfigValue>;
};

/** 解析 Analysis 配置：`analysisDefaults` 在前、显式配置覆盖在后。 */
export function resolveAnalysisConfig(
  defaults?: Partial<ResearchAnalysisConfig> | null,
  explicit?: Partial<ResearchAnalysisConfig> | null,
): ResolvedAnalysisConfig {
  return {
    quantileGroups: explicit?.quantileGroups ?? defaults?.quantileGroups ?? 10,
    horizons: explicit?.horizons ?? defaults?.horizons ?? [1, 3, 5],
    minSampleCount: explicit?.minSampleCount ?? defaults?.minSampleCount ?? 30,
    targetField: explicit?.targetField ?? defaults?.targetField,
    featureField: explicit?.featureField ?? defaults?.featureField,
    variables: explicit?.variables ?? defaults?.variables,
    stabilityDimension: explicit?.stabilityDimension ?? defaults?.stabilityDimension,
    dimensionKey: explicit?.dimensionKey ?? defaults?.dimensionKey,
    multipleTestingCorrection:
      explicit?.multipleTestingCorrection ?? defaults?.multipleTestingCorrection ?? "NONE",
    // ---- RESEARCH-004 · 分段（两窗）关系 ----
    // ⚠️ 窗参数**不给默认值**：默认一个「看起来合理」的窗等于替用户选题，
    //    缺窗时应当由配置校验显式报 `INVALID_ANALYSIS_CONFIG`，而不是静默跑一个别的窗。
    windowA: explicit?.windowA ?? defaults?.windowA,
    windowB: explicit?.windowB ?? defaults?.windowB,
    windowAStat: explicit?.windowAStat ?? defaults?.windowAStat,
    windowBStat: explicit?.windowBStat ?? defaults?.windowBStat,
    windowBands: explicit?.windowBands ?? defaults?.windowBands ?? DEFAULT_WINDOW_BANDS,
    extra: { ...(defaults?.extra ?? {}), ...(explicit?.extra ?? {}) },
  };
}
