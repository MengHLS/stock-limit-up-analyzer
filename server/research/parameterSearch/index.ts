/**
 * STEP 17 / C-17.1 — Grid / Random Parameter Search 统一出口。
 *
 * 交付内容：
 *   - types.ts     SearchRun / Candidate Strategy / 评估契约 / 稳定区口径 类型权威源；
 *   - prng.ts      确定性 seedable PRNG（mulberry32 + Floyd 无放回抽样）；
 *   - sampler.ts   Grid（桥接 STEP 6.3 combinationGenerator）+ Random（seedable 确定性采样）；
 *   - metrics.ts   绩效标量校验 + C-16.1 performanceMetrics 只读桥；
 *   - region.ts    稳定参数区判定（§19：聚合好点、拒绝高收益坏点、坏点率门）；
 *   - candidate.ts 候选策略产出（kind = "candidate"，非 production / final）；
 *   - serialize.ts canonical 序列化 + fingerprint + round-trip 复核；
 *   - run.ts       编排入口 runParameterSearch / runGridSearch / runRandomSearch。
 *
 * 纯模块：无 DB / 无 IO / 无 Math.random（random 仅 seedable PRNG）；不可变、确定性。
 * Rolling Optimization 属 C-17.2、PBO / 过拟合正式判定属既有 overfittingAssessment，
 * 本模块不做；优化产出止于候选策略，不推广生产。
 */

export * from "./types";
export * from "./prng";
export * from "./sampler";
export * from "./metrics";
export * from "./region";
export * from "./candidate";
export * from "./serialize";
export * from "./run";
