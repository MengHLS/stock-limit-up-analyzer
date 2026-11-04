/**
 * STEP 18 / C-18.2 — 随机化鲁棒性测试（Monte Carlo / Bootstrap / Trade Order
 * Randomization）统一出口。
 *
 * 交付内容：
 *   - types.ts        类型契约（StochasticMethod / Specimen / 分布推断 / 结论 / Run /
 *                     配置 / 缺省口径常量）+ 方法学警告表 STOCHASTIC_METHOD_CAVEATS；
 *   - prng.ts         seedable PRNG（mulberry32 目录内自实现）+ 有放回/无放回抽样核；
 *   - sampling.ts     MC/Bootstrap 共用的有放回样本生成 + Trade Order 置换样本生成；
 *   - monteCarlo.ts   MC 口径（dailyReturn / tradeReturn 源解析 + 样本生成）；
 *   - bootstrap.ts    Bootstrap 样本 + **描述性显著性**（非假设检验承诺）；
 *   - tradeOrder.ts   成交顺序随机化样本 + 总收益顺序不变性守卫；
 *   - statistics.ts   路径统计（复利总收益 / MaxDD / Sharpe，复用 shared/quant-stats）
 *                     + 序列与绩效标量校验；
 *   - distribution.ts 分位摘要 / 百分位置信区间 / 基准百分位 / 尾部概率；
 *   - verdict.ts      结论判定（阈值复用 C-18.1 resolveRobustnessThresholds，import 只读）+ 解读文本；
 *   - serialize.ts    canonical 序列化 + sha256 指纹 + round-trip 复核；
 *   - run.ts          编排入口 runStochasticRobustness + 三方法便捷入口 + runId 生成。
 *
 * 与 C-18.1 的关系：只 import 其 `drift`/阈值语义与类型（只读），**不修改**其任何
 * 既有文件；`RobustnessAxis` 联合类型的并入由协调者统一处理。
 *
 * 纯模块：无 DB / 无 IO / 无 Date.now / Math.random（createdAt / stochasticRunId 注入）；
 * 不可变、确定性。
 */

export * from "./types";
export * from "./prng";
export * from "./sampling";
export * from "./monteCarlo";
export * from "./bootstrap";
export * from "./tradeOrder";
export * from "./statistics";
export * from "./distribution";
export * from "./verdict";
export * from "./serialize";
export * from "./run";
