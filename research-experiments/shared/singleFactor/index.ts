/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— 通用基础总出口。
 *
 * ## 11 个通用基础单元与文件的对应
 *
 * | 需求里的单元 | 文件 | 说明 |
 * | --- | --- | --- |
 * | Dataset / Universe Resolver | `universe.ts` | 复用 `deriveTwelveFactorSamples`（样本口径唯一实现） |
 * | PIT Data Access | `pitAccess.ts` | 相对日→交易日映射 + `rd > 5` 的结构级拒绝 |
 * | Factor Resolver | `factorResolver.ts` | 12 个冻结因子的**适配器**目录（零改动），可扩新因子 |
 * | Cross-sectional Ranker | `ranker.ts` | 按决策日横截面 + HIGH/LOW 排序（确定性 tie-break） |
 * | TopN Selector | `ranker.ts#selectTopN` | 池不足 N 整天不纳入，不允许「凑合」 |
 * | Entry / Exit Engine | `entryExit.ts` | T+6 开盘 / T+10 收盘（顺延），并与公共底座逐笔对拍 |
 * | Position / Cost Engine | `positionCost.ts` | 等权 + 往返 20 bps（复用公共成本模型） |
 * | Benchmark Calculator | `benchmark.ts` | 当日候选池等权 |
 * | Metrics Calculator | `metrics.ts` | 11 个核心指标 + Bootstrap + 三态判定 |
 * | Time-slice Analyzer | `timeSlice.ts` | 决策日自然年切片（每片重算同一套口径） |
 * | Structured Result Writer | `resultWriter.ts` | 10 张表 + statistics + charts + CSV 产物 + schema |
 *
 * 🔴 **本 barrel 只供服务端（实验 `run()` / 测试）使用**：`resultWriter.ts` 依赖
 * `node:zlib`，被前端 `page.tsx` 引到会直接打包失败。页面一律 `import type` 取类型。
 */

export * from "./benchmark";
export * from "./coordinate";
export * from "./entryExit";
export * from "./factorResolver";
export * from "./metrics";
export * from "./pitAccess";
export * from "./positionCost";
export * from "./ranker";
export * from "./resultWriter";
export * from "./timeSlice";
export * from "./types";
export * from "./universe";
