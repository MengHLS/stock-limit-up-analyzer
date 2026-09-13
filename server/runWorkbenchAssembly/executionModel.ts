/**
 * 运行工作台装配层 — 执行模型归一化。
 *
 * 存在两个白名单（**不是重复定义，是两个真实域**）：
 *   - `STRATEGY_EXECUTION_MODEL_IDS`（`strategySchema/types.ts`）：策略**文档**层面 5 值，
 *     含 legacy 小写 `"next-open"`（研究链路历史写法）；
 *   - `ExecutionModelId`（`backtest/types.ts`）：**回测引擎**层面 4 值，全大写。
 *
 * `StrategyBacktestConfig` / `StrategyExecutionAssumptions.executionModel` 声明的是前者，
 * `SimulationConfig.executionModel` 吃的是后者 ⇒ 中间必须有且只有一处映射。
 * 本模块就是那唯一一处（禁止在调用点各自 `toUpperCase()`，那会把 `VWAP_PROXY` 之类
 * 拼错也一并「洗白」成合法值）。
 */

import type { ExecutionModelId } from "../backtest/types";
import { LoopRunAssemblyError } from "./assemble";

/** 文档层执行模型写法 → 引擎层规范值。未列出的写法一律响亮抛错（不猜测、不 toUpperCase）。 */
const EXECUTION_MODEL_ALIASES: Readonly<Record<string, ExecutionModelId>> = {
  NEXT_OPEN: "NEXT_OPEN",
  NEXT_CLOSE: "NEXT_CLOSE",
  VWAP_PROXY: "VWAP_PROXY",
  LIMIT_PRICE: "LIMIT_PRICE",
  // 研究链路 legacy 小写写法（engineAdapter.ts 亦只认这一种）
  "next-open": "NEXT_OPEN",
};

/**
 * 把策略文档里的 `executionModel` 归一化为回测引擎的 `ExecutionModelId`。
 *
 * 缺失/未知一律抛 `LOOP_RUN_ASSEMBLY_UNKNOWN_EXECUTION_MODEL` —— 因为执行模型直接决定
 * 成交价口径（NEXT_OPEN 读次日开盘、NEXT_CLOSE 读次日收盘），猜错等于回测结论失真。
 */
export function normalizeStrategyExecutionModel(raw: string): ExecutionModelId {
  const mapped = EXECUTION_MODEL_ALIASES[raw];
  if (mapped === undefined) {
    throw new LoopRunAssemblyError(
      "LOOP_RUN_ASSEMBLY_UNKNOWN_EXECUTION_MODEL",
      `装配层：策略文档的 executionModel=\`${raw}\` 不在已知映射内（已知：${Object.keys(EXECUTION_MODEL_ALIASES).join("、")}）。` +
        `无法确定成交价口径，拒绝装配。`,
    );
  }
  return mapped;
}
