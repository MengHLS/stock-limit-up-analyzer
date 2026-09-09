/**
 * datasetAdapter — Dataset Builder 配置的 Frontend Adapter（任务 §17）。
 *
 * 把「构建配置表单状态」规范化并转换为后端 `researchDataset.build` 的入参。
 * 护栏（≤40 交易日 / ≤1000 股）在此处收敛为**展示/传输护栏**，权威语义仍由后端
 * `RESEARCH_DATASET_RPC_DEFAULTS` 兜底。
 */

import type { ResearchDatasetBuildInput } from "@shared/researchContracts";

export interface DatasetConfigViewModel {
  name: string;
  startDate: string;
  endDate: string;
  /** 逐日 PIT（asOf = tradeDate）。 */
  asOfPerTradeDate: boolean;
  /** 固定 asOf（仅 asOfPerTradeDate=false）。 */
  asOf: string;
  maxTradingDays: number;
  maxSecuritiesPerDay: number;
  /** 数据链已就绪（A~H 全 DATA_READY）。 */
  dataReady: boolean;
}

export const DATASET_CONFIG_LIMITS = {
  maxTradingDaysMin: 1,
  maxTradingDaysMax: 40,
  maxSecuritiesMin: 1,
  maxSecuritiesMax: 1000,
} as const;

export function defaultDatasetConfig(): DatasetConfigViewModel {
  return {
    name: "ds-smoke",
    startDate: "2026-08-31",
    endDate: "2026-09-04",
    asOfPerTradeDate: true,
    asOf: "2026-09-04",
    maxTradingDays: 5,
    maxSecuritiesPerDay: 50,
    dataReady: false,
  };
}

/** 表单状态 → 后端构建入参（含护栏 clamp）。 */
export function configToBuildInput(
  config: DatasetConfigViewModel
): ResearchDatasetBuildInput {
  const clamp = (v: number, min: number, max: number) =>
    Math.min(Math.max(v, min), max);
  return {
    name: config.name.trim(),
    startDate: config.startDate,
    endDate: config.endDate,
    asOfPerTradeDate: config.asOfPerTradeDate,
    ...(config.asOfPerTradeDate ? {} : { asOf: config.asOf || null }),
    maxTradingDays: clamp(
      config.maxTradingDays,
      DATASET_CONFIG_LIMITS.maxTradingDaysMin,
      DATASET_CONFIG_LIMITS.maxTradingDaysMax
    ),
    maxSecuritiesPerDay: clamp(
      config.maxSecuritiesPerDay,
      DATASET_CONFIG_LIMITS.maxSecuritiesMin,
      DATASET_CONFIG_LIMITS.maxSecuritiesMax
    ),
    dataReady: config.dataReady,
  };
}

/** 表单校验（仅传输形态校验；语义/区间合法性由后端权威校验）。 */
export function validateDatasetConfig(config: DatasetConfigViewModel): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!config.name.trim()) errors.push("数据集名称必填");
  if (!config.startDate || !config.endDate) errors.push("起止日期必填");
  if (config.startDate > config.endDate)
    errors.push("起始日期不得晚于结束日期");
  if (!config.asOfPerTradeDate && !config.asOf)
    errors.push("固定 asOf 模式需提供 asOf 日期");
  return { valid: errors.length === 0, errors };
}
