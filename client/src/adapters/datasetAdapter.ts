/**
 * datasetAdapter — Dataset Builder 配置的 Frontend Adapter（任务 §17）。
 *
 * 把「构建配置表单状态」规范化并转换为后端 `researchDataset.build` 的入参。
 * 护栏（≤40 交易日 / ≤1000 股）在此处收敛为**展示/传输护栏**，权威语义仍由后端
 * `RESEARCH_DATASET_RPC_DEFAULTS` 兜底。
 */

import type {
  ResearchDatasetBuildInput,
  BoardCategoryValue,
  TDayConditionValue,
  PullbackTargetTypeValue,
  PullbackScreenConditionInput,
} from "@shared/researchContracts";

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
  /** 选中板块（全选 4 大板块 = 不过滤，wire 层映射为 []）。 */
  boards: BoardCategoryValue[];
  /** 排除 ST / *ST。 */
  excludeSt: boolean;
  /** T 日条件（默认首板）。 */
  tDayCondition: TDayConditionValue;
  /** 首板回踩筛选；null = 不做回踩筛选（仅当 tDayCondition=firstBoard 时生效）。 */
  pullback: {
    targetTypes: PullbackTargetTypeValue[];
    tolerancePercent: number;
    observationWindowDays: number;
  } | null;
}

/** FE 可勾选的板块（不含 unknown，后端 unknown 仅在过滤激活时被排除）。 */
export const SELECTABLE_BOARDS: BoardCategoryValue[] = [
  "main",
  "chinext",
  "star",
  "bse",
];

/** 板块展示名。 */
export const BOARD_LABELS: Record<BoardCategoryValue, string> = {
  main: "主板",
  chinext: "创业板",
  star: "科创板",
  bse: "北交所",
  unknown: "其他",
};

/** T 日条件展示名。 */
export const TDAY_CONDITION_LABELS: Record<TDayConditionValue, string> = {
  none: "不限",
  limitUp: "涨停",
  firstBoard: "首板",
  consecutiveBoard: "连板",
};

/** 回踩目标位可选集。 */
export const SELECTABLE_PULLBACK_TARGETS: PullbackTargetTypeValue[] = [
  "limitPrice",
  "t0Open",
  "t0Low",
  "ma5",
];

/** 回踩目标位展示名。 */
export const PULLBACK_TARGET_LABELS: Record<PullbackTargetTypeValue, string> = {
  limitPrice: "涨停价",
  t0Open: "T0 开盘",
  t0Low: "T0 最低",
  ma5: "5 日均线",
};

/** FE 选中板块 → wire：全选 4 大板块 = 不过滤（空数组）；否则只传选中子集。 */
function boardsToWire(boards: BoardCategoryValue[]): BoardCategoryValue[] {
  const set = new Set(boards);
  const isAll = SELECTABLE_BOARDS.every((b) => set.has(b));
  return isAll ? [] : boards.filter((b) => SELECTABLE_BOARDS.includes(b));
}

/** 回踩配置 → wire（null = 不启用，不传 pullback）。 */
function pullbackToWire(
  pullback: DatasetConfigViewModel["pullback"],
): PullbackScreenConditionInput | undefined {
  if (!pullback) return undefined;
  return {
    targetTypes: [...pullback.targetTypes],
    tolerancePercent: pullback.tolerancePercent,
    observationWindowDays: pullback.observationWindowDays,
  };
}

/** 配置 → universe 过滤层 wire 形态。 */
export function configToUniverseFilter(config: DatasetConfigViewModel): {
  boards: BoardCategoryValue[];
  excludeSt: boolean;
  tDayCondition: TDayConditionValue;
  pullback?: PullbackScreenConditionInput;
} {
  const pullback = pullbackToWire(config.pullback);
  return {
    boards: boardsToWire(config.boards),
    excludeSt: config.excludeSt,
    tDayCondition: config.tDayCondition,
    ...(pullback ? { pullback } : {}),
  };
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
    boards: [...SELECTABLE_BOARDS],
    excludeSt: false,
    tDayCondition: "firstBoard",
    pullback: null,
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
    universeFilter: configToUniverseFilter(config),
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

/** 表单状态 → 预览入参（预览用更高解析上限，展示全窗口诚实摘要）。 */
export function configToPreviewInput(
  config: DatasetConfigViewModel
): ResearchDatasetBuildInput {
  return {
    name: config.name.trim(),
    startDate: config.startDate,
    endDate: config.endDate,
    asOfPerTradeDate: config.asOfPerTradeDate,
    ...(config.asOfPerTradeDate ? {} : { asOf: config.asOf || null }),
    maxTradingDays: 250,
    dataReady: config.dataReady,
    universeFilter: configToUniverseFilter(config),
  };
}
