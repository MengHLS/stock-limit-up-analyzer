/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management 统一出口。
 *
 * 交付内容（C-21.1）：
 *   - types.ts        §23 八态权威类型 + LifecycleTransition（审计链节）+ StrategyLifecycleRecord
 *                     （策略版本生命周期壳）+ evidence 引用判别联合；
 *   - transition.ts   §23 合法迁移表（白名单制：相邻前进 / 前驱回退 + Production→Research
 *                     异常回退 / 任意→Retired 退役）+ 边分类（advance/rollback/retire）；
 *   - gates.ts        证据门槛：evidence 引用格式 + §23 四要素必填 + 档位阈值
 *                     （→Validated 需 datasetGate PASS 或 metrics PASS；→Production 需
 *                     datasetGate PASS；Paper→Approved 需 approval/metrics PASS）；
 *   - serialize.ts    canonical round-trip + 单跳链式 hash + record 指纹 + 篡改复核；
 *   - validate.ts     记录结构/语义校验（seq 连续、genesis 首跳、链衔接、status=末跳 to）；
 *   - map.ts          createStrategyLifecycleRecord / createLifecycleFromVersionRecord
 *                     （绑定 C-15.1 StrategyVersionRecord）/ applyLifecycleTransition
 *                     （唯一状态变更入口：同步校验 + append，fail fast）；
 *   - ledger.ts       （可选）in-memory 生命周期账本，示范「状态变更唯一入口」；
 *   - conceptMap.ts   生命周期 8 态 vs §7 任务 7 态的概念映射与守卫断言（禁止概念污染）。
 *
 * 纯模块：无 DB / 无 Date.now / 无 Math.random / 无 IO；不可变、可序列化、确定性。
 * 范围克制：不做 DB 持久化表；不做真实 gate 执行（evidence 引用注入，本任务只校验格式
 * 与必填性）；不实现生产执行 / regime / 优化等其它 STEP。
 * 命名纪律：全部符号带 LIFECYCLE / STRATEGY_LIFECYCLE 域前缀，防 future research/index.ts
 * 聚合时与既有 status.ts / 各目录导出撞名（TS2308）。本目录不改动任何既有文件。
 */

export * from "./types";
export * from "./transition";
export * from "./gates";
export * from "./serialize";
export * from "./validate";
export * from "./map";
export * from "./ledger";
export * from "./conceptMap";
