/**
 * STRATEGY-003 — **首板回踩 Golden Sample**（SPEC §25）。
 *
 * 用途：证明新 Domain Model **真的能表达本项目目标策略**，而不是「数据库字段齐了」：
 *   Event          FIRST_LIMIT_UP（首板）
 *   Observation    T+1 ~ T+5（交易日）
 *   Condition      回踩当日 low ≥ 首板日开盘价（`prefix.rd0.open`）
 *                  且回踩当日缩量（`bar.volume` < `prefix.rd0.volume`）
 *   Trigger        FIRST_VALID_DAY（窗口内第一个满足条件的交易日收盘出信号）
 *   Signal         T 日收盘（signalTiming = T_CLOSE）
 *   Execution      T+1 开盘（executionTiming = T_PLUS_1_OPEN）
 *   Parameters     pullbackWindow / holdingDays / positionRatio / stopLoss / takeProfit（TUNABLE）
 *                  limitUpThreshold（FIXED）
 *
 * ⚠️ 定位声明：这是**测试 / 验证用 fixture**，不是生产策略：
 *   - 它**不注册**到任何策略注册表（`server/strategy/registry.ts` 与本文件无关）；
 *   - 它**不参与**任何回测 / 研究链路；
 *   - `server/research/strategySchema/index.ts` **不导出**本模块（避免被误当作 public API 或内置策略）。
 *   它只被单测与 `scripts/verifyStrategyDomainModel.mts` 以显式路径引用。
 *
 * 字段命名严格对齐本项目 Dataset 的真实语义（`server/datasetRegistry/naming.ts:11-16`）：
 *   - `event` 层**不含逐日行情**，T 日 OHLCV 在 `prefix.relativeDay = 0` ⇒ 首板日开盘价写作
 *     `prefix.rd0.open`，**不是** `event.open`；
 *   - `path` / `outcome` 层是「前视，仅打标签」⇒ 本 sample **不引用**它们。
 */

import type { StrategyDocumentFromDefinitionInput } from "./map";
import type { StrategyDefinitionInput } from "./definition";

/** 与既有 strategySchema 测试一致的 rd-… 内容寻址数据集版本（首板回踩事件窗口数据集）。 */
export const FIRST_BOARD_PULLBACK_DATASET_VERSION = "rd-1.0.0-1-cffc2a0e66efbf0b";

/** Golden Sample：Canonical StrategyDefinition。 */
export const FIRST_BOARD_PULLBACK_DEFINITION: StrategyDefinitionInput = {
  schemaVersion: "1.0",
  entry: {
    event: {
      type: "FIRST_LIMIT_UP",
      params: { limitUpRatio: 0.1 },
      description: "首板涨停（窗口内首次涨停，非连续板）",
    },
    observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
    conditions: [
      {
        id: "pullback-not-break-event-open",
        field: "bar.low",
        operator: "GREATER_THAN_OR_EQUAL",
        value: "prefix.rd0.open",
        valueType: "FIELD_REFERENCE",
        description: "回踩当日最低价不低于首板日开盘价（不破首板实体下沿）",
        enabled: true,
      },
      {
        id: "pullback-volume-shrink",
        field: "bar.volume",
        operator: "LESS_THAN",
        value: "prefix.rd0.volume",
        valueType: "FIELD_REFERENCE",
        description: "回踩当日成交量小于首板日成交量（缩量回踩）",
        enabled: true,
      },
    ],
    trigger: {
      type: "FIRST_VALID_DAY",
      description: "观察窗口内第一个同时满足全部条件的交易日，于其收盘产生买入信号",
    },
  },
  exit: {
    rules: [
      {
        id: "holding-days",
        type: "TIME_EXIT",
        trigger: "ON_CLOSE",
        parameter: "holdingDays",
        thresholdUnit: "TRADING_DAY",
        priority: 1,
        enabled: true,
        description: "入场后持有 holdingDays 个交易日，到期收盘退出",
      },
      {
        id: "stop-loss",
        type: "STOP_LOSS",
        trigger: "INTRADAY",
        parameter: "stopLoss",
        thresholdUnit: "RATIO",
        priority: 2,
        enabled: true,
        description: "盘中止损：相对成本价回撤达到 stopLoss 立即退出",
      },
      {
        id: "take-profit",
        type: "TAKE_PROFIT",
        trigger: "ON_CLOSE",
        parameter: "takeProfit",
        thresholdUnit: "RATIO",
        priority: 3,
        enabled: true,
        description: "收盘止盈：相对成本价涨幅达到 takeProfit 退出",
      },
    ],
  },
  position: {
    sizingMethod: "FIXED_RATIO",
    parameter: "positionRatio",
    maxPositions: 5,
    maxExposure: 0.8,
    maxSinglePosition: 0.3,
  },
  risk: {
    maxPositions: 5,
    maxExposure: 0.8,
    maxSinglePosition: 0.3,
    stopLoss: 0.08,
  },
  execution: {
    signalTiming: "T_CLOSE",
    executionTiming: "T_PLUS_1_OPEN",
    priceType: "OPEN",
    quantityMethod: "TARGET_WEIGHT",
    lotSize: 100,
    slippageModel: "BPS",
    commissionModel: "BPS",
    executionConstraints: ["一字板（开盘即涨停）不成交", "停牌顺延至下一交易日"],
  },
  parameters: [
    {
      code: "pullbackWindow",
      name: "回踩观察窗口",
      dataType: "number",
      parameterRole: "TUNABLE",
      defaultValue: 5,
      min: 1,
      max: 10,
      step: 1,
      unit: "TRADING_DAY",
      required: true,
      description: "首板后观察回踩的交易日数（与 entry.observationWindow.end 对应）",
    },
    {
      code: "holdingDays",
      name: "持有交易日数",
      dataType: "number",
      parameterRole: "TUNABLE",
      defaultValue: 3,
      min: 1,
      max: 20,
      step: 1,
      unit: "TRADING_DAY",
      required: true,
    },
    {
      code: "positionRatio",
      name: "单仓资金比例",
      dataType: "number",
      parameterRole: "TUNABLE",
      defaultValue: 0.2,
      min: 0.05,
      max: 0.5,
      step: 0.05,
      unit: "RATIO",
      required: true,
    },
    {
      code: "stopLoss",
      name: "止损比例",
      dataType: "number",
      parameterRole: "TUNABLE",
      defaultValue: 0.08,
      min: 0.02,
      max: 0.15,
      step: 0.01,
      unit: "RATIO",
      required: true,
    },
    {
      code: "takeProfit",
      name: "止盈比例",
      dataType: "number",
      parameterRole: "TUNABLE",
      defaultValue: 0.15,
      min: 0.05,
      max: 0.4,
      step: 0.05,
      unit: "RATIO",
      required: true,
    },
    {
      code: "limitUpThreshold",
      name: "涨停判定阈值",
      dataType: "number",
      parameterRole: "FIXED",
      defaultValue: 0.1,
      unit: "RATIO",
      required: true,
      description: "FIXED：由交易所规则决定，不进参数搜索空间",
    },
  ],
  datasets: [
    {
      datasetId: "ds_first_limit_pullback",
      datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION,
      role: "PRIMARY",
      note: "首板回踩事件窗口数据集（默认绑定；Strategy 不锁死只能用它）",
    },
  ],
};

/** Golden Sample：完整文档组装输入（含不可从 Definition 派生的项）。 */
export const FIRST_BOARD_PULLBACK_DOCUMENT_INPUT: StrategyDocumentFromDefinitionInput = {
  strategyId: "first-board-pullback",
  version: "1.0.0",
  name: "首板回踩",
  description: "首板涨停后 1~5 个交易日内缩量回踩不破首板开盘价 → 收盘出信号 → T+1 开盘买入",
  universe: { universeId: `research-dataset:${FIRST_BOARD_PULLBACK_DATASET_VERSION}` },
  definition: FIRST_BOARD_PULLBACK_DEFINITION,
  executionAssumptions: {
    backtestConfig: { initialCapital: 1_000_000, maxPositions: 5 },
    costModel: {
      commissionRate: 0.00025,
      stampDutyRate: 0.0005,
      transferFeeRate: 0.00001,
      slippageBps: 5,
      lotSize: 100,
      minCommission: 5,
    },
  },
  metadata: { author: "STRATEGY-003 golden sample", tags: ["limit-up", "pullback", "golden-sample"] },
};
