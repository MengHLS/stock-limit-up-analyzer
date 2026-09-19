/**
 * ROBUSTNESS-001 — Search-Result Robustness Analysis 统一出口。
 *
 * ## 交付内容
 *
 * | 文件 | 职责 |
 * | --- | --- |
 * | `types.ts`        | 领域类型（Run / Result / 邻域 / 稳定性 / 敏感性 / 矩阵 / 汇总） |
 * | `canonical.ts`    | canonical 序列化 + sha256 指纹 + 有限数守卫（**复用**既有 `canonicalStringify`） |
 * | `domainValues.ts` | 冻结搜索域 → **有序取值序列**（决定「相邻」的含义） |
 * | `neighborhood.ts` | 邻域构造 · 稳定性判定 · 离散度 · 敏感性（纯函数） |
 * | `matrix.ts`       | 多参数二维稳定性矩阵（缺失格 `MISSING`，不补值） |
 * | `gate.ts`         | 输入 Validity Gate（§10）+ 参数引用状态继承（§12）+ 汇总累加 |
 * | `analysis.ts`     | 分析编排（纯函数；**零 Backtest 调用 / 零指标重算**） |
 * | `run.ts`          | 状态机（**复用** PS 唯一权威迁移表）· ID · 口径解析 · 进度 |
 * | `persistence.ts`  | 三表读写（唯一落点；`parameter_search_*` 只读） |
 * | `executor.ts`     | create / start / cancel / read / list / results |
 *
 * ## 与既有鲁棒性域的关系（**并列，不互相取代**）
 *
 * - `server/research/robustness/**`（C-18.1）：四轴**扰动重估** —— 需要注入式 evaluator ⇒ **重跑**；
 * - `server/research/stochasticRobustness/**`（C-18.2）：随机化**重估** —— 同样重跑；
 * - 本目录（ROBUSTNESS-001）：**冻结 Search Result 上的稳定性分析** —— **零重跑**。
 *
 * 三者同属 manifest 的 `robustness:` 域，但输入与执行语义不同，因此是**并列兄弟模块**
 * （与 `stochasticRobustness` 和 `robustness` 的既有关系一致）。本目录**未改动**上述两者任何一行。
 *
 * 🔴 本目录不含、也不会出现：Backtest 调用、canonical metrics 重算、策略文档读取、
 *   `Date.now` / `Math.random`（纯层）、以及任何「最佳 / 最优 / 推荐」型结论。
 */

export * from "./types";
export * from "./canonical";
export * from "./domainValues";
export * from "./neighborhood";
export * from "./matrix";
export * from "./gate";
export * from "./analysis";
export * from "./run";
export * from "./persistence";
export * from "./executor";
