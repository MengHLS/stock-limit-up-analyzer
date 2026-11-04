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

// ---------------------------------------------------------------------------
// PARAMETER-001 — 持久化搜索层（**刻意不在本 barrel 里 re-export**）
// ---------------------------------------------------------------------------
//
// 新增模块（按依赖方向自底向上）：
//   searchSpace.ts    参数空间定义（FIXED/TUNABLE/DERIVED 分类 + 派生 + 校验 + 编译）
//   parameterHash.ts  稳定 parameterHash + cache 判据
//   combination.ts    笛卡尔积组合（复用 combinationGenerator）+ 去重
//   searchRun.ts      Run 状态机 + 进度 + FIXED 坐标
//   searchResult.ts   canonical metrics 只读投影（不重算）
//   persistence.ts    三表仓储（读写唯一落点）
//   executor.ts       编排：Resume / Retry / Cache + 复用评估端口
//
// 🔴 为什么不做 `export * from "./executor"`：
//   `executor.ts` 运行时 import `strategyEvaluation/backtestBridge`，
//   而后者所在子图会回到 `closedLoopWiring/executors`（它又 import 本 barrel）。
//   把执行层塞进 barrel ⇒ **运行时循环 import**（本项目已真实踩过「顶层互相 import ⇒
//   `tsc` 绿但运行时报 `X is not a function`」。）
//   ⇒ 消费方一律**按显式路径**引用（`./executor` / `./persistence`），
//     与本仓「桥只允许显式引用具体模块」的既有纪律一致。

