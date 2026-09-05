/**
 * STEP 6.1 — Research 层基础类型。
 *
 * 本层只描述「研究实验」的输入契约（参数 / 数据集 / 特征配置 / 回测配置），
 * 不实现任何交易 / 回测 / 持久化逻辑。所有类型必须可序列化、可复现、可验证。
 *
 * 边界铁律：
 *   - 这里是「研究实验描述」层，不是「生产交易语义」层；不得复制 engine/portfolio
 *     的成交 / 持仓语义，也不得复制 Production Strategy Contract 的评估逻辑。
 *   - 禁止 NaN / Infinity / 隐式类型转换进入本层任何对象。
 */

import type { CostModel } from "../engine/domain";

/** 研究参数值（可序列化原子值；null 仅对 nullable 参数合法，表示「显式不设值」）。 */
export type ResearchParameterValue = number | string | boolean | null;

/** 参数集合：参数名 → 值（键唯一）。 */
export type ResearchParameterSet = Record<string, ResearchParameterValue>;

/** 参数类型。 */
export type ResearchParameterType = "number" | "string" | "boolean";

/** 单个参数定义。 */
export interface ResearchParameterDefinition {
  name: string;
  type: ResearchParameterType;
  /** 是否必填：true 表示必须在参数集合中显式提供（即便值可为 null）。 */
  required: boolean;
  /** 未显式提供该参数时使用的默认值；可空（仅 nullable 参数允许）。 */
  defaultValue?: ResearchParameterValue;
  /** 该参数是否允许 null 值（如「分数阈值不设限 = null」）。默认 false。 */
  nullable?: boolean;
  /** 以下数值约束仅对 number 类型生效。 */
  min?: number;
  max?: number;
  step?: number;
  /** 可选值白名单，仅对 string 类型生效。 */
  allowedValues?: readonly string[];
  description?: string;
}

/** 参数 Schema。 */
export interface ResearchParameterSchema {
  parameters: ResearchParameterDefinition[];
}

/** 研究数据集描述。 */
export interface ResearchDatasetSpec {
  startDate: string;
  endDate: string;
  universe?: string;
  /**
   * 真实数据集版本。当前系统无数据集版本机制时必须保持 undefined，
   * 禁止伪造 "latest" / "deterministic" / "v1" 之类的虚假标识。
   */
  datasetVersion?: string;
}

/** 研究 Feature 配置。 */
export interface ResearchFeatureConfig {
  featureMode?: string;
  /**
   * 真实 Feature Registry 版本。STEP 7 建立真正 Feature Registry 前必须保持 undefined，
   * 禁止伪造版本号。
   */
  featureVersion?: string;
  requiredFeatures?: string[];
}

/**
 * 研究层回测配置（轻量 wrapper）。
 *
 * 只描述实验级回测口径，不重新实现回测逻辑；实际映射到生产 `engine/domain.ts#BacktestConfig`
 * 由后续 STEP 6.2（Research Run）完成。禁止在此处复刻第二套互相冲突的 BacktestConfig。
 */
export interface ResearchBacktestConfig {
  initialCapital: number;
  commissionRate?: number;
  slippageRate?: number;
  maxPositions?: number;
  lotSize?: number;
  /** 执行模型标识（如 "next-open"）；当前仅用于描述，不驱动实际成交。 */
  executionModel?: string;
  /**
   * 完整冻结的成本模型（生产 `engine/domain.ts#CostModel` 单一事实来源）。
   *
   * 默认值只在 Experiment 创建阶段解析并深拷贝进入 Snapshot；Research Run 运行时
   * 必须消费这里的冻结值，禁止重新读取当前 DEFAULT_COST_MODEL（防止未来默认成本
   * 模型漂移导致历史实验重跑结果不一致）。缺省时由 createExperiment / createExperimentSnapshot
   * 在创建阶段用当前 DEFAULT_COST_MODEL 补齐并冻结。
   */
  costModel?: CostModel;
}

/** 实验状态。 */
export type ResearchExperimentStatus = "created" | "running" | "completed" | "failed";

/** 核心实验对象：一次研究实验的完整输入 + 元数据 + 状态。 */
export interface ResearchExperiment {
  experimentId: string;

  strategyId: string;
  strategyVersion: string;

  /** 已解析（默认值已应用）的完整参数集合。 */
  parameterSet: ResearchParameterSet;

  dataset: ResearchDatasetSpec;

  featureConfig?: ResearchFeatureConfig;

  backtestConfig: ResearchBacktestConfig;

  createdAt: string;

  status: ResearchExperimentStatus;
}

/**
 * Canonical Experiment Snapshot：完整表达实验输入，不依赖当前默认参数 / Feature 默认配置 /
 * Strategy 默认配置。未来默认值改变后，历史快照仍能表达当时运行的配置。
 */
export interface ResearchExperimentSnapshot {
  experimentId: string;

  strategyId: string;
  strategyVersion: string;

  parameterSet: ResearchParameterSet;

  dataset: ResearchDatasetSpec;

  featureConfig?: ResearchFeatureConfig;

  backtestConfig: ResearchBacktestConfig;
}
