/**
 * STEP 14 / C-14.3 — 执行与约束模型统一出口。
 *
 * 交付内容：
 *   - types.ts      组合式声明类型（ExecutionConstraintDeclaration）+ 值域常量；
 *   - factory.ts    构造工厂（默认值 + 禁买禁卖列表升序去重规范化）；
 *   - validate.ts   声明校验（资金/持仓上限一致性/手数/买卖限制/成交时机值域/
 *                   marketClaims 字面量守卫 → 结构化 issue）；assert* 抛 ResearchValidationError；
 *   - serialize.ts  canonical JSON 序列化 + sha256 fingerprint + round-trip 复核；
 *   - map.ts        逐约束轴可执行性矩阵（describeExecutionConstraintCoverage）+
 *                   映射到 C-14.1 SimulationConfig（map/assertMap），不可执行轴显式 blocker。
 *
 * 纯模块：无 DB / 无 Date.now / 无 Math.random / 无 IO；不可变、确定性。
 * 边界：只读复用 STEP 8（execution/marketRules/types）与 C-14.1（simulator）既有实现，
 * 不自造执行内核；成本模型六字段属 C-14.2 边界（映射时经外部 CostModel 注入）；
 * 成交时机值域 = STEP 8 ExecutionModelId（不发明新时机）；regime 不建模（C-22.1）。
 * 注意：本目录独立自持 index；research/index.ts 属既有文件未改动，如需并入统一出口由协调者决定。
 */

export * from "./types";
export * from "./factory";
export * from "./validate";
export * from "./serialize";
export * from "./map";
