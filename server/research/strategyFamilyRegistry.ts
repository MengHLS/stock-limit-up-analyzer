import type { StrategyDocument, StrategyDocumentInput, StrategyType } from "./strategySchema/types";
import { createStrategyDocument } from "./strategySchema/map";
import { buildThreeFactorTopNStrategyDocument } from "./patternLibrary/threeFactorTopNStrategy";
import { buildThreeFactorTopNFamilyArmInput } from "./patternLibrary/threeFactorTopNFamilies";
import {
  FIRST_LIMIT_POOL_DAILY_SCORE_FAMILY_ID,
  FIRST_LIMIT_POOL_DEFAULT_AGE_CAP_TRADING_DAYS,
  FIRST_LIMIT_POOL_DEFAULT_MAX_OBSERVATION_AMPLITUDE,
  FIRST_LIMIT_POOL_DEFAULT_MINIMUM_SCORE,
  buildFirstLimitPoolDailyScoreDocument,
} from "./patternLibrary/firstLimitPoolDailyScore";

export type StrategyFamilyParameterValue = number | boolean | string;

export interface StrategyFamilyParameterDefinition {
  readonly name: string;
  readonly label: string;
  readonly type: "number" | "boolean" | "string";
  readonly defaultValue: StrategyFamilyParameterValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly description: string;
}

export interface StrategyFamilyDefinition {
  readonly familyId: string;
  readonly label: string;
  readonly strategyType: StrategyType;
  readonly baseStrategyId: string;
  readonly baseVersion: string;
  readonly baseArmId: string;
  readonly parameters: readonly StrategyFamilyParameterDefinition[];
}

export interface MaterializeStrategyFamilyInput {
  readonly familyId: string;
  readonly strategyId: string;
  readonly version: string;
  readonly name: string;
  readonly description?: string;
  readonly datasetVersionId: number;
  readonly datasetLabel: string;
  readonly parameters: Readonly<Record<string, StrategyFamilyParameterValue>>;
}

export const THREE_FACTOR_EVENT_FAMILY_ID = "3f-topn-event-window";
export const ROLLING_POOL_FAMILY_ID = FIRST_LIMIT_POOL_DAILY_SCORE_FAMILY_ID;

const THREE_FACTOR_EVENT_PARAMETERS: readonly StrategyFamilyParameterDefinition[] = [
  { name: "topN", label: "TopN", type: "number", defaultValue: 3, min: 1, max: 10, step: 1, description: "每日横截面选择数量" },
  { name: "maxPositions", label: "最大持仓", type: "number", defaultValue: 5, min: 1, max: 50, step: 1, description: "组合最多同时持有数量" },
  { name: "maxDailyBuys", label: "每日最多买入", type: "number", defaultValue: 2, min: 1, max: 20, step: 1, description: "单日最多新开仓数量" },
  { name: "maxMaxAmplitude", label: "最大振幅上限", type: "number", defaultValue: 0.14, min: 0.01, max: 0.99, step: 0.01, description: "观察窗最大振幅门槛" },
];

const ROLLING_POOL_PARAMETERS: readonly StrategyFamilyParameterDefinition[] = [
  { name: "topN", label: "TopN", type: "number", defaultValue: 3, min: 1, max: 10, step: 1, description: "每个有效决策日按滚动 3F 分选择数量" },
  { name: "maxPositions", label: "最大持仓", type: "number", defaultValue: 5, min: 1, max: 50, step: 1, description: "组合最多同时持有数量" },
  { name: "maxDailyBuys", label: "每日最多买入", type: "number", defaultValue: 2, min: 1, max: 20, step: 1, description: "单日最多新开仓数量" },
  { name: "poolAgeCapTradingDays", label: "池龄上限", type: "number", defaultValue: FIRST_LIMIT_POOL_DEFAULT_AGE_CAP_TRADING_DAYS, min: 1, max: 120, step: 1, description: "首板事件入池后的最大有效交易日数" },
  { name: "minimumScore", label: "最低分/移池线", type: "number", defaultValue: FIRST_LIMIT_POOL_DEFAULT_MINIMUM_SCORE, min: 0, max: 1, step: 0.01, description: "低于该分立即移出股票池" },
  { name: "maxObservationAmplitude", label: "滚动振幅上限", type: "number", defaultValue: FIRST_LIMIT_POOL_DEFAULT_MAX_OBSERVATION_AMPLITUDE, min: 0.01, max: 0.99, step: 0.01, description: "T+1..当日滚动最大振幅上限" },
  { name: "scoreInvalidationDays", label: "连续缺分失效", type: "number", defaultValue: 3, min: 1, max: 20, step: 1, description: "连续不可评分多少日后移池" },
];

export const STRATEGY_FAMILIES: readonly StrategyFamilyDefinition[] = [
  {
    familyId: THREE_FACTOR_EVENT_FAMILY_ID,
    label: "3F TopN 事件窗",
    strategyType: "THREE_FACTOR_TOPN",
    baseStrategyId: "first-limit-pullback-3f-top3",
    baseVersion: "1.62.1",
    baseArmId: "c6-b4-14-best-combination/c6b4-14",
    parameters: THREE_FACTOR_EVENT_PARAMETERS,
  },
  {
    familyId: ROLLING_POOL_FAMILY_ID,
    label: "首板股票池 · 滚动 3F",
    strategyType: "FIRST_LIMIT_POOL_ROLLING_3F",
    baseStrategyId: "first-limit-pullback-3f-top3",
    baseVersion: "1.62.1",
    baseArmId: "c6-b4-14-best-combination/c6b4-14",
    parameters: ROLLING_POOL_PARAMETERS,
  },
] as const;

const FAMILY_BY_ID = new Map(STRATEGY_FAMILIES.map(item => [item.familyId, item] as const));

export function resolveStrategyFamily(familyId: string): StrategyFamilyDefinition | null {
  return FAMILY_BY_ID.get(familyId) ?? null;
}

function numberParameter(
  family: StrategyFamilyDefinition,
  parameters: Readonly<Record<string, StrategyFamilyParameterValue>>,
  name: string,
): number {
  const definition = family.parameters.find(item => item.name === name);
  const raw = parameters[name] ?? definition?.defaultValue;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`策略族 ${family.familyId} 参数 ${name} 必须是有限数字。`);
  }
  if (definition?.min !== undefined && raw < definition.min) {
    throw new Error(`策略族 ${family.familyId} 参数 ${name} 不得小于 ${definition.min}。`);
  }
  if (definition?.max !== undefined && raw > definition.max) {
    throw new Error(`策略族 ${family.familyId} 参数 ${name} 不得大于 ${definition.max}。`);
  }
  return raw;
}

function assertKnownParameters(
  family: StrategyFamilyDefinition,
  parameters: Readonly<Record<string, StrategyFamilyParameterValue>>,
): void {
  const known = new Set(family.parameters.map(item => item.name));
  for (const name of Object.keys(parameters)) {
    if (!known.has(name)) throw new Error(`策略族 ${family.familyId} 不认识参数 ${name}。`);
  }
}

export function materializeStrategyFamily(input: MaterializeStrategyFamilyInput): StrategyDocument {
  const family = resolveStrategyFamily(input.familyId);
  if (family === null) throw new Error(`未知策略族：${input.familyId}`);
  assertKnownParameters(family, input.parameters);
  if (input.strategyId.trim() === "") throw new Error("strategyId 不能为空");
  if (input.version.trim() === "") throw new Error("version 不能为空");

  const topN = numberParameter(family, input.parameters, "topN");
  const maxPositions = numberParameter(family, input.parameters, "maxPositions");
  const maxDailyBuys = numberParameter(family, input.parameters, "maxDailyBuys");

  if (family.familyId === THREE_FACTOR_EVENT_FAMILY_ID) {
    const maxMaxAmplitude = numberParameter(family, input.parameters, "maxMaxAmplitude");
    const baseInput = buildThreeFactorTopNFamilyArmInput(
      "c6-b4-14-best-combination",
      "c6b4-14",
      {
        topN,
        datasetVersionId: input.datasetVersionId,
        datasetLabel: input.datasetLabel,
      },
    );
    const document = buildThreeFactorTopNStrategyDocument({
      ...baseInput,
      strategyVersion: input.version,
      maxPositions,
      maxDailyBuys,
      entryRiskFilter: {
        ...(baseInput.entryRiskFilter ?? {}),
        maxMaxAmplitude,
      },
    });
    return createStrategyDocument({
      ...document,
      strategyId: input.strategyId,
      version: input.version,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      strategyType: family.strategyType,
    } as unknown as StrategyDocumentInput);
  }

  const document = buildFirstLimitPoolDailyScoreDocument({
    datasetVersionId: input.datasetVersionId,
    datasetLabel: input.datasetLabel,
    topN,
    maxPositions,
    maxDailyBuys,
    poolAgeCapTradingDays: numberParameter(family, input.parameters, "poolAgeCapTradingDays"),
    minimumScore: numberParameter(family, input.parameters, "minimumScore"),
    maxObservationAmplitude: numberParameter(family, input.parameters, "maxObservationAmplitude"),
    scoreInvalidationDays: numberParameter(family, input.parameters, "scoreInvalidationDays"),
  });
  return createStrategyDocument({
    ...document,
    strategyId: input.strategyId,
    version: input.version,
    name: input.name,
    ...(input.description !== undefined ? { description: input.description } : {}),
    strategyType: family.strategyType,
  } as unknown as StrategyDocumentInput);
}
