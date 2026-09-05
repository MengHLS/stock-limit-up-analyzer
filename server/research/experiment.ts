/**
 * STEP 6.1 — Experiment 构造 / Snapshot 提取。
 *
 *   createExperiment          → 校验 + 应用参数默认值 → 组装完整 ResearchExperiment（status=created）
 *   createExperimentSnapshot  → 校验并构造完整实验快照（纯函数，确定性）
 *   toExperimentSnapshot      → 从既有实验提取 canonical 快照（纯函数，不依赖当前默认值）
 *   resolveParameterSet       → 输入参数 + schema → 应用默认值后的完整参数集
 *
 * Snapshot 铁律：快照必须完整表达实验输入，未来默认参数 / Strategy 默认配置 / Feature 默认
 * 配置 / Backtest 默认配置改变后，历史快照仍能表达当时运行的配置。
 */

import { DEFAULT_COST_MODEL } from "../engine/execution";
import type { CostModel } from "../engine/domain";
import { normalizeStrategyKey } from "./experimentIdentity";
import {
  assertValidResearchExperiment,
  assertValidExperimentSnapshot,
  ResearchValidationError,
  validateParameterSchema,
  validateParameterSet,
} from "./experimentValidation";
import type { ResearchStrategyDefinition } from "./strategyContract";
import type {
  ResearchBacktestConfig,
  ResearchDatasetSpec,
  ResearchExperiment,
  ResearchExperimentSnapshot,
  ResearchFeatureConfig,
  ResearchParameterSchema,
  ResearchParameterSet,
} from "./types";

/** 构造实验的输入（除 createdAt 外必填；参数集为「已解析前」的原始输入）。 */
export interface CreateExperimentInput {
  experimentId: string;
  strategyId: string;
  strategyVersion: string;
  parameterSet: ResearchParameterSet;
  dataset: ResearchDatasetSpec;
  featureConfig?: ResearchFeatureConfig;
  backtestConfig: ResearchBacktestConfig;
  createdAt?: string;
}

/** 直接构造快照的输入（与实验快照字段一一对应）。 */
export interface CreateExperimentSnapshotInput {
  experimentId: string;
  strategyId: string;
  strategyVersion: string;
  parameterSet: ResearchParameterSet;
  dataset: ResearchDatasetSpec;
  featureConfig?: ResearchFeatureConfig;
  backtestConfig: ResearchBacktestConfig;
}

/**
 * 把「实验级回测配置」解析为完整 CostModel（创建阶段一次性解析，运行时绝不重读）。
 *
 * 语义（STEP 6.2-FIX-1）：
 *   - 若调用方显式提供 costModel，直接采用（深拷贝，不合并默认值——不完整即由校验层拒绝）；
 *   - 否则由「旧字段 commissionRate / slippageRate / lotSize + 当前 DEFAULT_COST_MODEL」补齐，
 *     与既有 engineAdapter 的历史映射口径完全一致（slippageRate 比例 → slippageBps 基点 ×10000）。
 *
 * 返回值恒为独立副本（structuredClone），避免 Snapshot 持有对 DEFAULT_COST_MODEL 的共享引用。
 */
function resolveCostModel(config: ResearchBacktestConfig): CostModel {
  if (config.costModel !== undefined) {
    return structuredClone(config.costModel);
  }
  const slippageBps = config.slippageRate === undefined
    ? DEFAULT_COST_MODEL.slippageBps
    : config.slippageRate * 10_000;
  return {
    commissionRate: config.commissionRate ?? DEFAULT_COST_MODEL.commissionRate,
    stampDutyRate: DEFAULT_COST_MODEL.stampDutyRate,
    transferFeeRate: DEFAULT_COST_MODEL.transferFeeRate,
    slippageBps,
    lotSize: config.lotSize ?? DEFAULT_COST_MODEL.lotSize,
    minCommission: DEFAULT_COST_MODEL.minCommission,
  };
}

/** 冻结回测配置：解析 costModel（创建阶段）并深拷贝，返回独立副本。 */
function freezeBacktestConfig(config: ResearchBacktestConfig): ResearchBacktestConfig {
  return {
    ...structuredClone(config),
    costModel: resolveCostModel(config),
  };
}

/**
 * 输入参数 + schema → 应用默认值后的完整参数集。
 * 任一参数问题（必填缺失 / 未知参数 / 类型或取值非法）直接抛 ResearchValidationError。
 */
export function resolveParameterSet(input: ResearchParameterSet, schema: ResearchParameterSchema): ResearchParameterSet {
  const resolved: ResearchParameterSet = {};

  for (const def of schema.parameters) {
    if (def.name in input) {
      resolved[def.name] = input[def.name]!;
    } else if (def.required) {
      throw new ResearchValidationError([
        { code: "REQUIRED_PARAM_MISSING", path: "parameterSet", message: `必填参数缺失：${def.name}` },
      ]);
    } else if (def.defaultValue !== undefined) {
      resolved[def.name] = def.defaultValue;
    }
  }

  for (const name of Object.keys(input)) {
    if (!schema.parameters.some((param) => param.name === name)) {
      throw new ResearchValidationError([
        { code: "UNKNOWN_PARAM", path: `parameterSet.${name}`, message: `参数 ${name} 未在 schema 中定义` },
      ]);
    }
  }

  // 终检：schema 自身 + 解析后参数集全部合法（含 defaultValue 自洽）。
  const schemaResult = validateParameterSchema(schema);
  if (!schemaResult.valid) throw new ResearchValidationError(schemaResult.issues);
  const setResult = validateParameterSet(resolved, schema);
  if (!setResult.valid) throw new ResearchValidationError(setResult.issues);

  return resolved;
}

/**
 * 从输入构造完整实验（status=created，createdAt 缺省取当前时间——属于实验元数据）。
 * 参数集会先经 resolveParameterSet 应用默认值；策略身份必须与定义一致。
 */
export function createExperiment(input: CreateExperimentInput, strategyDefinition: ResearchStrategyDefinition): ResearchExperiment {
  if (input.strategyId !== strategyDefinition.strategyId || input.strategyVersion !== strategyDefinition.version) {
    throw new Error(
      `策略身份不匹配：实验声明 ${normalizeStrategyKey(input.strategyId, input.strategyVersion)}，`
      + `定义实际为 ${normalizeStrategyKey(strategyDefinition.strategyId, strategyDefinition.version)}`,
    );
  }

  const parameterSet = resolveParameterSet(input.parameterSet, strategyDefinition.parameterSchema);

  const experiment: ResearchExperiment = {
    experimentId: input.experimentId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    parameterSet,
    dataset: structuredClone(input.dataset),
    featureConfig: input.featureConfig === undefined ? undefined : structuredClone(input.featureConfig),
    backtestConfig: freezeBacktestConfig(input.backtestConfig),
    createdAt: input.createdAt ?? new Date().toISOString(),
    status: "created",
  };

  assertValidResearchExperiment(experiment, strategyDefinition.parameterSchema);
  return experiment;
}

/** 直接构造并校验实验快照（纯函数、确定性）。 */
export function createExperimentSnapshot(input: CreateExperimentSnapshotInput, parameterSchema?: ResearchParameterSchema): ResearchExperimentSnapshot {
  const snapshot: ResearchExperimentSnapshot = {
    experimentId: input.experimentId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    parameterSet: structuredClone(input.parameterSet),
    dataset: structuredClone(input.dataset),
    featureConfig: input.featureConfig === undefined ? undefined : structuredClone(input.featureConfig),
    backtestConfig: freezeBacktestConfig(input.backtestConfig),
  };
  assertValidExperimentSnapshot(snapshot, parameterSchema);
  return snapshot;
}

/** 从既有实验提取 canonical 快照（返回独立副本，不受原实验后续变更影响）。 */
export function toExperimentSnapshot(experiment: ResearchExperiment): ResearchExperimentSnapshot {
  return {
    experimentId: experiment.experimentId,
    strategyId: experiment.strategyId,
    strategyVersion: experiment.strategyVersion,
    parameterSet: structuredClone(experiment.parameterSet),
    dataset: structuredClone(experiment.dataset),
    featureConfig: experiment.featureConfig === undefined ? undefined : structuredClone(experiment.featureConfig),
    backtestConfig: structuredClone(experiment.backtestConfig),
  };
}
