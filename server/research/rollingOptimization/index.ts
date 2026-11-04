/**
 * STEP 17 / C-17.2 — Rolling Optimization 统一出口。
 *
 * 交付内容：
 *   - types.ts      RollingOptimizationRun / 跨窗候选 / 窗口配置 / 一致性口径 / 请求类型权威源；
 *   - windows.ts    滚动窗口生成（交易日锚定，纯函数；不足窗结构化报错）+ 配置解析；
 *   - stability.ts  跨窗参数一致性判定（§19：合格区交集语义，显式非 argmax）；
 *   - candidate.ts  跨窗汇总候选策略产出（kind = "candidate"，非 production / final）；
 *   - serialize.ts  canonical 序列化 + fingerprint + round-trip 复核（含嵌套 SearchRun 校验）；
 *   - run.ts        编排入口 runRollingOptimization（复用 C-17.1 runParameterSearch 逐窗搜索）。
 *
 * 纯模块：无 DB / 无 IO / 无 Math.random（random 仅用 seedable 派生种子）；不可变、确定性。
 * 与 C-19.1 边界：本模块不做 Train/Validation/OOS 三段 WFO 划分与「先选参→冻结→样本外评测」
 * 链路（那属 C-19.1/C-19.2）；优化产物止于跨窗候选，不推广生产。
 */

export * from "./types";
export * from "./windows";
export * from "./stability";
export * from "./candidate";
export * from "./serialize";
export * from "./run";
