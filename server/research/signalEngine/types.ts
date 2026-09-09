/**
 * STEP 13 / C-13.2 — Signal 与 Candidate 框架：类型契约（不可变、可序列化、可审计）。
 *
 * 背景：STEP 10 framework 提供「单 decisionTime 横截面」流水线（runResearchPipeline），
 * C-13.1 datasetAccess 把 ResearchDataset 适配为 framework 的 Universe/DataSource。
 * 本目录（signalEngine）是把二者接通的多日编排薄层：逐 tradeDate 驱动 pipeline，并把
 * 逐日 SelectedCandidate/PositionIntent 聚合成一份带完整追溯字段的运行记录。
 *
 * 数据链路（本目录全部类型参与）：
 *
 *   CandidateDayRecord（单决策日横截面产物）
 *     → CandidateRunEvaluation（候选层确定性统计评价）
 *     → CandidateEvaluationRun（一次多日运行的不可变总记录，可序列化、可复现）
 *
 * Evaluation 语义界定（重要）：
 *   - 此处 Evaluation 是「候选集合本身的确定性记录性统计」（候选数量 / 横截面分布 /
 *     入选稳定性 / 信号方向分布 / 入选值分布），输入只有候选产物，不含成交/持仓/价格收益；
 *   - 完整收益回测交易模拟属 C-14.1，本目录禁止实现；evaluationService（STEP 6.4，
 *     Production Backtest Core 编排、异步、含 executedAt 时间戳）与之语义不同，本层不复用。
 *
 * 铁律：全部字段 readonly；可 JSON 序列化（见 serialize.ts）；禁止 NaN / Infinity /
 * Date.now / Math.random；构造确定性（字段序稳定，排序确定性）。
 */

import type { DecisionPoint } from "../../data";
import type {
  DroppedSecurity,
  FeatureProvider,
  PositionIntent,
  RankingConfig,
  SelectedCandidate,
  SelectionConfig,
} from "../framework/contract";
import type { SignalBuilder } from "../framework/signal";
import type { ResearchParameterSet } from "../types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化/反序列化判别，防止类型混淆）。 */
export const CANDIDATE_EVALUATION_RUN_RECORD_KIND = "CANDIDATE_EVALUATION_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const CANDIDATE_EVALUATION_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 输入配置（Strategy13）
// ---------------------------------------------------------------------------

/**
 * C-13.2 最小策略风格配置（Strategy13）。
 *
 * 刻意不复用 STEP 10 StrategyContract 作为本引擎的「策略」载体：StrategyContract 表达
 * 策略身份 / 参数 schema / 所需数据域 / 频率，而本引擎在此之上补充决策时点与
 * Feature→Signal→Ranking→Selection 的可执行配方。调用方仍需同时提供完整
 * StrategyContract + ExperimentConfig（引擎逐日喂给 runResearchPipeline，身份与
 * universeId / datasetVersion 一致性校验全部复用既有实现，不另造轮子）。
 */
export interface Strategy13 {
  /** 决策时点：整个 run 在每个交易日均固定为 open 或 close。 */
  readonly point: DecisionPoint;
  /**
   * 特征提供器集合（全 run 复用同一组实例，featureId 唯一）。
   * availability 为静态绝对时点：必须覆盖整个决策窗口（即不晚于最早决策时点），
   * 引擎运行前会做泄漏预检（复用 framework LeakageGuard），不满足即 FAIL FAST。
   */
  readonly features: readonly FeatureProvider[];
  /** 信号构造器（每个决策日对每个特征齐备的证券调用一次）。 */
  readonly signalBuilder: SignalBuilder;
  /** 横截面排序配置（供 runResearchPipeline，直接转发）。 */
  readonly rankingConfig: RankingConfig;
  /** 候选选择配置（供 runResearchPipeline，直接转发）。 */
  readonly selectionConfig: SelectionConfig;
  /** 人类可读的信号描述（仅审计用途，不参与计算；可缺省）。 */
  readonly signalDescription?: string;
}

// ---------------------------------------------------------------------------
// 单决策日产物
// ---------------------------------------------------------------------------

/** 单个决策日的候选产物（不可变；由引擎从 ResearchPipelineResult 摘要而来）。 */
export interface CandidateDayRecord {
  /** 决策日（YYYY-MM-DD）。 */
  readonly date: string;
  /** 当日 as-of universe 成员（顺序随 dataset 决议，确定性）。 */
  readonly universeMembers: readonly string[];
  /** 当日产出信号的证券数（横截面，剔除不计入）。 */
  readonly signalCount: number;
  /** 被剔除证券及原因（NO_BARS / INSUFFICIENT_FEATURES，保持 pipeline 语义）。 */
  readonly dropped: readonly DroppedSecurity[];
  /** 当日选中候选（rank 升序 + securityId 破平）。 */
  readonly selected: readonly SelectedCandidate[];
  /** 当日仓位意图（研究产物，不构成交易；等权由 pipeline 计算）。 */
  readonly positionIntents: readonly PositionIntent[];
}

// ---------------------------------------------------------------------------
// 候选层统计评价
// ---------------------------------------------------------------------------

/** 单证券入选稳定性统计。 */
export interface SecuritySelectionStat {
  readonly securityId: string;
  /** 被选中的决策日数。 */
  readonly selectionDays: number;
  /** 入选天数 / 决策日数（0~1；决策日数为 0 时恒为 0）。 */
  readonly selectionFrequency: number;
}

/** 选中信号的横截面方向分布。 */
export interface DirectionCounts {
  readonly long: number;
  readonly short: number;
  readonly neutral: number;
}

/**
 * 候选层的确定性统计评价（Evaluation 语义界定见文件头）。
 * 只统计「候选集合本身」，不涉及任何价格收益 / 成交模拟。
 */
export interface CandidateRunEvaluation {
  /** 决策日数（= days.length）。 */
  readonly decisionDayCount: number;
  /** 全部决策日（升序）。 */
  readonly dates: readonly string[];
  /** 累计候选名额（Σ 每日 selected 数）。 */
  readonly totalSelectedSlots: number;
  /** 每日候选数均值。 */
  readonly meanSelectedPerDay: number;
  /** 每日候选数最小值。 */
  readonly minSelectedPerDay: number;
  /** 每日候选数最大值。 */
  readonly maxSelectedPerDay: number;
  /** 跨日去重的 universe 成员（升序；横截面规模基准）。 */
  readonly distinctUniverseSecurities: readonly string[];
  /** 跨日至少入选一次的证券（升序）。 */
  readonly distinctSelectedSecurities: readonly string[];
  /** distinctSelected / distinctUniverse × 100（0~100；分母为 0 时记 0）。 */
  readonly universeCoveragePct: number;
  /** 入选稳定性：逐证券入选天数与频率（按 securityId 升序）。 */
  readonly selectionStats: readonly SecuritySelectionStat[];
  /** 每个决策日都入选的证券（升序；入选稳定性的极端情形）。 */
  readonly alwaysSelectedSecurities: readonly string[];
  /** 选中信号方向分布（横截面，按 PositionIntent.direction 累计）。 */
  readonly selectedDirectionCounts: DirectionCounts;
  /** 入选候选 value（= 信号值）的横截面均值。 */
  readonly meanSelectedValue: number;
  /** 入选候选 value 最小值。 */
  readonly minSelectedValue: number;
  /** 入选候选 value 最大值。 */
  readonly maxSelectedValue: number;
}

// ---------------------------------------------------------------------------
// 多日运行总记录
// ---------------------------------------------------------------------------

/** 特征审计引用（featureId → version）。 */
export interface FeatureVersionRef {
  readonly featureId: string;
  readonly version: string;
}

/**
 * 一次 Feature→Signal→Candidate→Evaluation 多日运行的不可变总记录。
 *
 * 可审计字段：datasetVersion / builderVersion / rowSchemaVersion / universeId /
 * strategyId@strategyVersion / parameters / dateRange / point / featureVersions /
 * rankingConfig / selectionConfig，外加 fingerprint（内容指纹，供完整性校验）。
 */
export interface CandidateEvaluationRun {
  readonly recordKind: typeof CANDIDATE_EVALUATION_RUN_RECORD_KIND;
  readonly recordVersion: typeof CANDIDATE_EVALUATION_RUN_RECORD_VERSION;
  /** 数据集内容指纹（= config.datasetVersion，运行期冻结）。 */
  readonly datasetVersion: string;
  /** 数据集构建器版本（追溯用；来自 datasetAccess 句柄）。 */
  readonly builderVersion: string;
  /** 行投影 schema 版本（追溯用；来自 datasetAccess 句柄）。 */
  readonly rowSchemaVersion: string;
  /** 数据集 gate（记录 dataset 质量，供消费方把关）。 */
  readonly datasetGate: string;
  /** framework UniverseProvider 的 universeId（= research-dataset:<datasetVersion>）。 */
  readonly universeId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 实验参数集（键值序 = 输入对象键序，构造期深拷贝冻结）。 */
  readonly parameters: Readonly<ResearchParameterSet>;
  /** 实验配置的日期窗口（闭区间；与 config.dateRange 一致）。 */
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  /** 决策时点（全 run 固定）。 */
  readonly point: DecisionPoint;
  /** 人类可读信号描述（审计用，不参与计算；可缺省）。 */
  readonly signalDescription?: string;
  /** 特征清单（按 featureId 升序；信号值来源的版本追溯）。 */
  readonly featureVersions: readonly FeatureVersionRef[];
  /** 排序配置快照（冻结副本；审计用）。 */
  readonly rankingConfig: Readonly<RankingConfig>;
  /** 选择配置快照（冻结副本；审计用）。 */
  readonly selectionConfig: Readonly<SelectionConfig>;
  /** 逐决策日产物（按日期升序，确定性）。 */
  readonly days: readonly CandidateDayRecord[];
  /** 候选层统计评价。 */
  readonly evaluation: CandidateRunEvaluation;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的确定性 JSON 摘要。 */
  readonly fingerprint: string;
}
