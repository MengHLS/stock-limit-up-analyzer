/**
 * STEP 10 — Strategy Research Framework 流水线。
 *
 * 数据流（确定性、无副作用、无未来数据）：
 *
 *   Universe(as-of) → Features(泄漏守卫 + 计算) → Signal → Ranking(横截面)
 *     → Selection(config-driven) → Position Intent
 *
 * 边界铁律：
 *   - 只产出研究结果（候选 + 意图权重），绝不产出 Order/Fill，绝不修改 Portfolio；
 *   - 缺数据 FAIL FAST：策略所需数据域不在数据源内 → 抛错，禁止 silent fallback；
 *   - 特征存在未来函数（availableAt / requiredDataThrough > decisionTime）→ 抛 LookAheadError；
 *   - 每次运行只处理一个 decisionTime 的横截面；多日期研究由调用方逐日调用（保证确定性）。
 */

import { visibleBars } from "../../data";
import type { CanonicalMarketBar } from "../../data";
import type {
  DroppedSecurity,
  ExperimentConfig,
  FeatureProvider,
  PositionIntent,
  RankInput,
  ResearchDataSource,
  ResearchPipelineResult,
  ResearchSecurityData,
  ResearchSignal,
  RankingConfig,
  SelectedCandidate,
  SelectionConfig,
  StrategyContract,
  UniverseProvider,
} from "./contract";
import type { DecisionTime } from "./leakage";
import { LeakageGuard } from "./leakage";
import { rankSignals } from "./ranking";
import { selectCandidates } from "./selection";
import type { SignalBuilder } from "./signal";
import { assertValidExperimentConfig, assertValidStrategyContract } from "./validation";

/** 研究流水线输入。 */
export interface ResearchPipelineInput {
  readonly strategy: StrategyContract;
  readonly config: ExperimentConfig;
  readonly decisionTime: DecisionTime;
  readonly universe: UniverseProvider;
  readonly featureProviders: readonly FeatureProvider[];
  readonly signalBuilder: SignalBuilder;
  readonly rankingConfig: RankingConfig;
  readonly selectionConfig: SelectionConfig;
  readonly dataSource: ResearchDataSource;
}

/** 运行一次研究流水线（单 decisionTime 横截面）。 */
export function runResearchPipeline(input: ResearchPipelineInput): ResearchPipelineResult {
  const {
    strategy,
    config,
    decisionTime,
    universe,
    featureProviders,
    signalBuilder,
    rankingConfig,
    selectionConfig,
    dataSource,
  } = input;

  // 1. 契约与身份一致性校验。
  assertValidExperimentConfig(config);
  assertValidStrategyContract(strategy);
  if (config.strategyId !== strategy.strategyId || config.strategyVersion !== strategy.strategyVersion) {
    throw new Error(
      `实验配置策略身份 (${config.strategyId}@${config.strategyVersion}) 与策略定义 (${strategy.strategyId}@${strategy.strategyVersion}) 不一致`,
    );
  }
  if (decisionTime.date < config.dateRange.startDate || decisionTime.date > config.dateRange.endDate) {
    throw new Error(`决策时点 ${decisionTime.date} 超出实验日期范围 [${config.dateRange.startDate}, ${config.dateRange.endDate}]`);
  }
  if (config.universe.universeId !== universe.universeId) {
    throw new Error(`实验配置 universeId (${config.universe.universeId}) 与 UniverseProvider (${universe.universeId}) 不一致`);
  }

  // 2. Data Dependency：FAIL FAST（缺数据域即抛错，禁止 silent fallback）。
  const available = new Set(dataSource.availableData);
  const missingData = strategy.requiredData.filter((domain) => !available.has(domain));
  if (missingData.length > 0) {
    throw new Error(
      `策略 ${strategy.strategyId} 所需数据域缺失：${missingData.join(", ")}（数据源仅提供 ${Array.from(available).join(", ") || "无"}）`,
    );
  }

  // 3. Universe（as-of）。
  const members = universe.getUniverse(decisionTime.date);

  // 4. 逐证券：泄漏守卫 + 特征计算 + 信号。
  const signals: ResearchSignal[] = [];
  const dropped: DroppedSecurity[] = [];
  for (const securityId of members) {
    const rawBars = dataSource.getBars(securityId);
    if (rawBars === null) {
      dropped.push({ securityId, reason: "NO_BARS" });
      continue;
    }
    const bars: readonly CanonicalMarketBar[] = visibleBars(rawBars, decisionTime.date, decisionTime.point);
    const data: ResearchSecurityData = { symbol: securityId, bars };

    const features: Record<string, number | null> = {};
    for (const provider of featureProviders) {
      LeakageGuard.assertNoLookAhead(provider.featureId, provider.availability, decisionTime);
      features[provider.featureId] = provider.compute({ securityId, decisionTime, data });
    }

    const signal = signalBuilder({ securityId, date: decisionTime.date, features });
    if (signal === null) {
      dropped.push({ securityId, reason: "INSUFFICIENT_FEATURES" });
      continue;
    }
    signals.push(signal);
  }

  // 5. 横截面排序。
  const rankInput: RankInput[] = signals.map((signal) => ({ securityId: signal.securityId, value: signal.value }));
  const ranked = rankSignals(rankInput, rankingConfig);

  // 6. 选择。
  const selected: SelectedCandidate[] = selectCandidates(ranked, selectionConfig);

  // 7. 仓位意图（等权，仅供研究）。
  const signalBySecurity = new Map(signals.map((signal) => [signal.securityId, signal]));
  const positionIntents: PositionIntent[] = selected.map((candidate) => {
    const signal = signalBySecurity.get(candidate.securityId);
    const weight = selected.length > 0 ? 1 / selected.length : 0;
    return {
      securityId: candidate.securityId,
      direction: signal?.direction ?? "long",
      rank: candidate.rank,
      percentile: candidate.percentile,
      weight,
      signalValue: candidate.value,
      confidence: signal?.confidence ?? null,
    };
  });

  return {
    decisionTime,
    universe: members,
    signals,
    ranked,
    selected,
    positionIntents,
    dropped,
  };
}
