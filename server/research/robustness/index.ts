/**
 * STEP 18 / C-18.1 — 鲁棒性测试（研究链路扰动重估）统一出口。
 *
 * 交付内容：
 *   - types.ts                 类型契约（RobustnessAxis / PerturbationItem /
 *                              RobustnessSample / RobustnessRun / 阈值 / 结论）；
 *   - costStress.ts            扰动器①/②：Cost Stress（佣金/印花税/过户费/冲击强度）
 *                              与 Slippage Stress（滑点倍率 ±档，独立轴）；
 *   - parameterPerturbation.ts 扰动器③：策略参数 ±%/±档 局部邻域（对齐 C-17.1
 *                              ResearchParameterSet 形态，独立邻域采样哲学见文件头）；
 *   - executionPerturbation.ts 扰动器④：成交时机/部分成交档/并发持仓（ENFORCED 轴）；
 *   - drift.ts                 漂移判定（收益双向 + 回撤恶化方向超阈值 → 敏感）+ 轴级结论；
 *   - evaluate.ts              编排器 runRobustnessStress（注入式 evaluator，不跑回测）；
 *   - serialize.ts             canonical 序列化 + sha256 fingerprint + round-trip 复核。
 *
 * 纯模块：无 DB / 无 IO / 无 Date.now / Math.random（createdAt / robustnessRunId 注入）；
 * 不可变、确定性；导入只读复用 C-14.2/C-14.3/C-16.1 的类型与校验。
 * Monte Carlo / Bootstrap / Trade Order Randomization 属 C-18.2（扩展 RobustnessAxis 即可），
 * regime 扰动属 C-22.1；本模块不预埋空轴。
 * 注意：本目录独立自持 index；research/index.ts 属既有文件未改动（如需并入统一出口
 * 由协调者决定，与 C-17.1 相同补丁方式）。
 */

export * from "./types";
export * from "./costStress";
export * from "./parameterPerturbation";
export * from "./executionPerturbation";
export * from "./drift";
export * from "./serialize";
export * from "./evaluate";
