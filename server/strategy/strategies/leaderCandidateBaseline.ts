/**
 * 已迁移策略 #1：龙头候选「原始评分」策略（baseline）。
 *
 * 业务规则：对信号日可见的、已评分的龙头候选池，按原始综合评分降序排序，
 * 可选用最低分阈值过滤，输出前 N 个「买入意图」信号（BUY Signal）。
 *
 * 迁移说明：
 *  - 这是五策略（baseline / riskPenalty / hardFilter / qualityBlend / qualityGate）
 *    中依赖最少、逻辑最清晰的一套，作为 Strategy Contract 的首个真实迁移目标。
 *  - 评分本身（boardScore/sectorScore/timeScore/turnoverScore/marketCapScore 合成）
 *    属于「Data Provider」职责，仍由既有 leaderCandidates.buildLeaderCandidatesForDate
 *    完成；本策略只负责「排序 + 阈值过滤 + 产出意图」，不再重复评分。
 *  - 行为对照：与旧 buildLeaderCandidateStrategyPortfolioSnapshot 中 baseline 的
 *    `strategyScore = candidate.score` + 降序排序完全一致；唯一增量是在分数/连板/题材/
 *    封板时间全部相同的极少数平局场景下，追加 stockCode 作为最终稳定平局键（确定性改进，
 *    避免依赖数组顺序），详见本文件策略元数据与迁移报告。
 */

import { emptyDecision, type Strategy, type StrategyConfig, type StrategyContext, type StrategyDecision, type StrategyFeatureInput, type StrategySignal } from "../contract";
import type { FeatureSnapshot, FeatureSnapshotBundle } from "../../features/snapshot";

/**
 * 退出策略模式（Step 5 / G3 P3-T1）。
 *   - "hold-while-selected"（默认）：持仓股票若已不在当日候选池（经过 minScore /
 *     featureMode 过滤，但不受 maxSignals 截断影响），则产生 SELL 退出信号——对齐
 *     research simulator planDecisionDay 的「持有到不再入选」语义（龙头不再是龙头即退出）；
 *     无候选日视为信息不足，不强制清仓。
 *   - "none"：不产生任何 SELL 信号（保持旧 BUY-only buy-and-hold 语义，供对照研究）。
 */
export type LeaderCandidateExitMode = "hold-while-selected" | "none";

/**
 * 策略配置（可序列化、可复现）。
 * 扩展（Step 5）：featureMode 让策略真实消费 Feature Layer——
 *   - "off"：不读取 context.features，行为与旧版完全一致；
 *   - "limit-up-confirm"：候选除满足评分外，还须被价格库快照确认「信号日收盘涨停」
 *     （limitUpHit READY 且 = 1，ST 按 5% 规则）。未被确认的候选不进入输出。
 * 扩展（G3 P3-T1）：exitMode 让策略产生退出信号（SELL），使生产引擎具备逐笔退出能力，
 * 不再「持有到期末按市价估值」导致胜率/回撤失真。
 */
export interface LeaderCandidateBaselineConfig extends StrategyConfig {
  /** 最低候选评分阈值；null 表示不过滤。 */
  minScore: number | null;
  /** 策略自身最多输出的买入意图数量（与组合 maxPositions 相互独立）。 */
  maxSignals: number;
  /** 特征消费模式（默认 "off"，保持旧语义）。 */
  featureMode: "off" | "limit-up-confirm";
  /** 退出策略模式（默认 "hold-while-selected"）。 */
  exitMode: LeaderCandidateExitMode;
}

/** 单个已评分候选（信号日可见字段）。 */
export interface LeaderCandidateScore {
  stockCode: string;
  stockName: string;
  sector: string;
  boards: number;
  sectorCount: number;
  score: number;
  riskScore: number;
  riskTier: "低风险" | "中风险" | "高风险";
  limitUpTime: string | null;
}

/** 受控数据视图：信号日的已评分候选池。 */
export interface LeaderCandidateDataView {
  signalDate: string;
  candidates: LeaderCandidateScore[];
}

export const LEADER_CANDIDATE_BASELINE_DEFAULT_CONFIG: LeaderCandidateBaselineConfig = {
  minScore: null,
  maxSignals: 5,
  featureMode: "off",
  exitMode: "hold-while-selected",
};

const toNonNegativeInt = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? Math.floor(value) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

/**
 * 平局时使用的稳定排序比较器：评分降序 → 连板降序 → 题材家数降序 →
 * 封板时间升序（缺失视为最晚）→ 代码升序。前四项与既有实现一致，末项为确定性兜底。
 */
function rankDescending(left: LeaderCandidateScore, right: LeaderCandidateScore): number {
  return (
    right.score - left.score
    || right.boards - left.boards
    || right.sectorCount - left.sectorCount
    || (left.limitUpTime ?? "99:99:99").localeCompare(right.limitUpTime ?? "99:99:99")
    || left.stockCode.localeCompare(right.stockCode)
  );
}

function toBuySignal(candidate: LeaderCandidateScore, signalTime: string): StrategySignal {
  return {
    symbol: candidate.stockCode,
    signalTime,
    action: "BUY",
    score: candidate.score,
    confidence: Math.max(0, Math.min(1, candidate.score / 100)),
    reason: `原始评分 ${candidate.score} 分 · ${candidate.boards}板 · ${candidate.sector} ${candidate.sectorCount}只涨停`,
    metadata: {
      stockName: candidate.stockName,
      sector: candidate.sector,
      boards: candidate.boards,
      sectorCount: candidate.sectorCount,
      riskTier: candidate.riskTier,
    },
  };
}

// ---------------------------------------------------------------------------
// 退出策略（G3 P3-T1）
// ---------------------------------------------------------------------------

function toSellSignal(symbol: string, signalTime: string): StrategySignal {
  return {
    symbol,
    signalTime,
    action: "SELL",
    reason: `退出（hold-while-selected）：持仓 ${symbol} 已不在当日涨停候选池`,
  };
}

/**
 * hold-while-selected 退出信号（纯函数、确定性、PIT 安全）。
 *
 * 语义（对齐 research simulator planDecisionDay 的「持有到不再入选」）：
 *   - desired = 经过 minScore / featureMode 过滤后的候选池（**不受 maxSignals 截断影响**——
 *     退出判断看「是否仍是龙头候选」，而非「是否挤进前 N 名」）；
 *   - 持仓中不在 desired 的证券 → SELL（按 symbol 升序确定性排序）；
 *   - 无持仓直接返回空（不产生噪声信号）。
 *
 * 注意：无候选日（candidates.length === 0）由 evaluate 提前返回 emptyDecision，
 * 不调用本函数——即「信息不足不强制清仓」，避免市场无涨停日误判为全线退出。
 */
function buildHoldWhileSelectedExitSignals(
  openPositionSymbols: readonly string[],
  filteredCandidates: readonly LeaderCandidateScore[],
  signalTime: string,
): StrategySignal[] {
  if (openPositionSymbols.length === 0) return [];
  const desired = new Set(filteredCandidates.map((candidate) => candidate.stockCode));
  return openPositionSymbols
    .filter((symbol) => !desired.has(symbol))
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map((symbol) => toSellSignal(symbol, signalTime));
}

// ---------------------------------------------------------------------------
// Feature Layer 消费（Step 5）
// ---------------------------------------------------------------------------

/** 从特征输入中取出指定 symbol 的快照（兼容单标快照与多标 bundle）。 */
function featureSnapshotOf(features: StrategyFeatureInput, symbol: string): FeatureSnapshot | undefined {
  if ("bySymbol" in features) {
    const bundle = features as FeatureSnapshotBundle;
    return bundle.bySymbol.get(symbol);
  }
  return features.symbol === symbol ? features : undefined;
}

/**
 * 候选是否被价格库快照确认「信号日收盘涨停」：
 *   - 必须存在该 symbol、且 asOf（decisionDate == signalTime, decisionPoint == "close"）完全一致；
 *   - limitUpHit 必须 READY 且 value === 1（涨停按 boardRules 权威，ST 5% / 主板 10%）。
 * 不满足（快照缺失 / asOf 不一致 / 数据不足 / 未涨停）→ false：不进入输出。
 */
function isCandidateLimitUpConfirmed(features: StrategyFeatureInput, signalTime: string, candidate: LeaderCandidateScore): boolean {
  const snapshot = featureSnapshotOf(features, candidate.stockCode);
  if (!snapshot) return false;
  if (snapshot.asOf.decisionDate !== signalTime || snapshot.asOf.decisionPoint !== "close") return false;
  const hit = snapshot.features.limitUpHit;
  return hit !== undefined && hit.status === "READY" && hit.value === 1;
}

export const leaderCandidateBaselineStrategy: Strategy<LeaderCandidateBaselineConfig, LeaderCandidateDataView> = {
  metadata: {
    id: "leader-candidate-baseline",
    name: "龙头候选原始评分",
    version: "1.0.0",
    description: "按信号日可见的原始综合评分降序排序龙头候选，输出前 N 个买入意图；纯多头、非日内；退出策略 hold-while-selected（持仓不再入选候选池即卖出）。",
    category: "打板龙头候选",
    requiredData: ["leaderCandidateDataView"],
    supportsLong: true,
    supportsShort: false,
    supportsIntraday: false,
  },

  defaultConfig: LEADER_CANDIDATE_BASELINE_DEFAULT_CONFIG,

  normalizeConfig(raw = {}) {
    const minScoreRaw = raw.minScore;
    const minScore = minScoreRaw === null || minScoreRaw === undefined
      ? this.defaultConfig.minScore
      : (typeof minScoreRaw === "number" && Number.isFinite(minScoreRaw) ? minScoreRaw : null);
    const maxSignals = raw.maxSignals === undefined
      ? this.defaultConfig.maxSignals
      : toNonNegativeInt(raw.maxSignals, this.defaultConfig.maxSignals);
    const featureMode = raw.featureMode === "limit-up-confirm"
      ? "limit-up-confirm" as const
      : "off" as const;
    const exitMode = raw.exitMode === "none"
      ? "none" as const
      : "hold-while-selected" as const;
    return { minScore, maxSignals, featureMode, exitMode };
  },

  evaluate(context: StrategyContext<LeaderCandidateBaselineConfig, LeaderCandidateDataView>): StrategyDecision {
    const { signalTime, data, config, features, portfolio } = context;
    const candidates = data.candidates ?? [];
    // 无候选日：信息不足，不产生任何信号（含不强制清仓），对齐 planDecisionDay 语义。
    if (candidates.length === 0) {
      return emptyDecision(this.metadata.version, true);
    }

    const featureGateEnabled = config.featureMode === "limit-up-confirm";
    if (featureGateEnabled && !features) {
      // 策略被显式配置为需要 Feature 确认，但调用方未提供同 asOf 特征输入：
      // 明确报告数据不足，绝不静默降级为「未过滤」输出。
      return emptyDecision(this.metadata.version, true);
    }

    const minScoreFiltered = config.minScore === null
      ? candidates
      : candidates.filter((candidate) => candidate.score >= config.minScore!);

    // Step 5：Feature 真实影响决策——候选必须被价格库快照确认信号日收盘涨停。
    const filtered = featureGateEnabled
      ? minScoreFiltered.filter((candidate) => isCandidateLimitUpConfirmed(features!, signalTime, candidate))
      : minScoreFiltered;

    // G3 P3-T1 退出信号：持仓不在「过滤后候选池」→ SELL（sell 在前、buy 在后）。
    const sellSignals = config.exitMode === "hold-while-selected"
      ? buildHoldWhileSelectedExitSignals(portfolio.openPositionSymbols, filtered, signalTime)
      : [];

    const buySignals = filtered
      .slice()
      .sort(rankDescending)
      .slice(0, config.maxSignals)
      .map((candidate) => toBuySignal(candidate, signalTime));

    return { signals: [...sellSignals, ...buySignals], strategyVersion: this.metadata.version, insufficientData: false };
  },
};
