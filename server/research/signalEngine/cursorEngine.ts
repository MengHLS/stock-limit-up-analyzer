import type { ResearchDatasetCursor } from "../framework/datasetCursor";
import type {
  ExperimentConfig,
  ResearchDataSource,
  StrategyContract,
  UniverseProvider,
} from "../framework/contract";
import type { DecisionTime } from "../framework/leakage";
import { LeakageGuard } from "../framework/leakage";
import { runResearchPipeline } from "../framework/pipeline";
import { DATASET_ROW_DOMAINS } from "../datasetAccess/bars";
import { evaluateCandidateRun } from "./evaluate";
import { computeCandidateEvaluationRunFingerprint } from "./serialize";
import {
  CANDIDATE_EVALUATION_RUN_RECORD_KIND,
  CANDIDATE_EVALUATION_RUN_RECORD_VERSION,
  type CandidateDayRecord,
  type CandidateEvaluationRun,
  type FeatureVersionRef,
  type Strategy13,
} from "./types";
import { assertValidStrategy13 } from "./validate";
import { CandidateEngineError, EmptyDecisionWindowError, MissingDatasetRowError } from "./engine";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

function frozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export interface CandidateCursorEngineInput {
  readonly cursor: ResearchDatasetCursor;
  readonly config: ExperimentConfig;
  readonly strategy: StrategyContract;
  readonly strategy13: Strategy13;
  /** 池化策略显式移池线；缺省时才回落到 config.parameters.minimumScore。 */
  readonly minimumScore?: number;
  /** 首次可评分相对日；此前（尤其 T0）不累计不可评分 streak。 */
  readonly scoreStartRelativeDay?: number;
}

/** 流式候选引擎：每个交易日只读取一个 slice，复用同一 runResearchPipeline。 */
export async function runCandidateEngineFromCursor(
  input: CandidateCursorEngineInput,
): Promise<CandidateEvaluationRun> {
  const { cursor, config, strategy, strategy13 } = input;
  assertValidStrategy13(strategy13);
  if (config.strategyId !== strategy.strategyId || config.strategyVersion !== strategy.strategyVersion) {
    throw new CandidateEngineError(
      "STRATEGY_IDENTITY_MISMATCH",
      `实验配置策略身份 (${config.strategyId}@${config.strategyVersion}) 与策略定义 (${strategy.strategyId}@${strategy.strategyVersion}) 不一致`,
    );
  }
  if (cursor.metadata.datasetVersion !== config.datasetVersion) {
    throw new CandidateEngineError(
      "DATASET_VERSION_MISMATCH",
      `流式游标数据集版本 ${cursor.metadata.datasetVersion} 与实验配置 ${config.datasetVersion} 不一致`,
    );
  }
  if (cursor.metadata.universeId !== config.universe.universeId) {
    throw new CandidateEngineError(
      "UNIVERSE_ID_MISMATCH",
      `流式游标 universeId=${cursor.metadata.universeId} 与实验配置 ${config.universe.universeId} 不一致`,
    );
  }
  if (
    config.dateRange.startDate < cursor.metadata.startDate
    || config.dateRange.endDate > cursor.metadata.endDate
  ) {
    throw new CandidateEngineError(
      "DATE_RANGE_OUT_OF_DATASET",
      `实验日期范围 [${config.dateRange.startDate}, ${config.dateRange.endDate}] 超出流式游标窗口 [${cursor.metadata.startDate}, ${cursor.metadata.endDate}]`,
    );
  }

  const decisionDates = cursor.tradingDates.filter(
    date => date >= config.dateRange.startDate && date <= config.dateRange.endDate,
  );
  if (decisionDates.length === 0) throw new EmptyDecisionWindowError(config.dateRange);

  const firstDecisionTime: DecisionTime = { date: decisionDates[0]!, point: strategy13.point };
  for (const feature of strategy13.features) {
    LeakageGuard.assertNoLookAhead(feature.featureId, feature.availability, firstDecisionTime);
  }

  const availableData: readonly string[] = [...DATASET_ROW_DOMAINS];
  const missingData = strategy.requiredData.filter(domain => !availableData.includes(domain));
  if (missingData.length > 0) {
    throw new CandidateEngineError(
      "REQUIRED_DATA_MISSING",
      `策略 ${strategy.strategyId} 所需数据域缺失：${missingData.join(", ")}`,
    );
  }

  const minimumScore =
    typeof input.minimumScore === "number" && Number.isFinite(input.minimumScore)
      ? input.minimumScore
      : typeof config.parameters.minimumScore === "number"
        && Number.isFinite(config.parameters.minimumScore)
        ? config.parameters.minimumScore
        : null;
  const dayRecords: CandidateDayRecord[] = [];
  for (const date of decisionDates) {
    const slice = await cursor.getDaySlice(date);
    if (!slice.isTradingDay) continue;
    const rowKeys = new Set(slice.rows.map(row => `${row.tradeDate}\u0000${row.securityId}`));
    for (const securityId of slice.members) {
      if (!rowKeys.has(`${date}\u0000${securityId}`)) {
        throw new MissingDatasetRowError(date, securityId);
      }
    }

    const barsBySecurity = slice.visibleBars.size > 0
      ? slice.visibleBars
      : new Map<string, readonly import("../../data").CanonicalMarketBar[]>();
    const universe: UniverseProvider = {
      universeId: cursor.metadata.universeId,
      getUniverse(asOfDate: string) {
        return asOfDate === date ? slice.members : [];
      },
    };
    const dataSource: ResearchDataSource = {
      availableData,
      getBars(securityId: string) {
        return barsBySecurity.get(securityId) ?? null;
      },
    };
    const result = runResearchPipeline({
      strategy,
      config,
      decisionTime: { date, point: strategy13.point },
      universe,
      featureProviders: strategy13.features,
      signalBuilder: strategy13.signalBuilder,
      rankingConfig: strategy13.rankingConfig,
      selectionConfig: strategy13.selectionConfig,
      dataSource,
    });

    const signalBySecurity = new Map(result.signals.map(signal => [signal.securityId, signal] as const));
    const keptSelected = minimumScore === null
      ? result.selected
      : result.selected.filter(candidate => {
          const signal = signalBySecurity.get(candidate.securityId);
          return signal !== undefined && signal.value >= minimumScore;
        });
    const keptIntents = minimumScore === null
      ? result.positionIntents
      : result.positionIntents.filter(intent => {
          const signal = signalBySecurity.get(intent.securityId);
          return signal !== undefined && signal.value >= minimumScore;
        });

    cursor.retainSecurityIds?.(
      [...new Set(keptIntents.map(intent => intent.securityId))],
    );

    if (cursor.applyDecisionOutcomes !== undefined && slice.decisionMembers !== undefined) {
      const scoreStartRelativeDay = input.scoreStartRelativeDay ?? 1;
      cursor.applyDecisionOutcomes(
        slice.decisionMembers
          .filter(member => member.relativeDay >= scoreStartRelativeDay)
          .map(member => {
            const signal = signalBySecurity.get(member.securityId);
            return {
              securityId: member.securityId,
              scored: signal !== undefined,
              removeFromPool:
                minimumScore !== null
                && signal !== undefined
                && signal.value < minimumScore,
            };
          }),
      );
    }

    dayRecords.push(
      deepFreeze<CandidateDayRecord>({
        date,
        universeMembers: result.universe,
        signalCount: signalBySecurity.size,
        dropped: result.dropped,
        selected: keptSelected,
        positionIntents: keptIntents,
      }),
    );
  }

  const evaluation = evaluateCandidateRun(dayRecords);
  const featureVersions: readonly FeatureVersionRef[] = Array.from(strategy13.features)
    .map(feature => ({ featureId: feature.featureId, version: feature.version }))
    .sort((left, right) => left.featureId.localeCompare(right.featureId));
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    recordKind: CANDIDATE_EVALUATION_RUN_RECORD_KIND,
    recordVersion: CANDIDATE_EVALUATION_RUN_RECORD_VERSION,
    datasetVersion: cursor.metadata.datasetVersion,
    builderVersion: cursor.metadata.builderVersion,
    rowSchemaVersion: cursor.metadata.rowSchemaVersion,
    datasetGate: cursor.metadata.gate,
    universeId: cursor.metadata.universeId,
    strategyId: strategy.strategyId,
    strategyVersion: strategy.strategyVersion,
    parameters: frozenClone(config.parameters),
    dateRange: { startDate: config.dateRange.startDate, endDate: config.dateRange.endDate },
    point: strategy13.point,
    featureVersions,
    rankingConfig: frozenClone(strategy13.rankingConfig),
    selectionConfig: frozenClone(strategy13.selectionConfig),
    days: dayRecords,
    evaluation,
    ...(strategy13.signalDescription !== undefined
      ? { signalDescription: strategy13.signalDescription }
      : {}),
  };
  return deepFreeze<CandidateEvaluationRun>({
    ...body,
    fingerprint: computeCandidateEvaluationRunFingerprint(body),
  });
}
