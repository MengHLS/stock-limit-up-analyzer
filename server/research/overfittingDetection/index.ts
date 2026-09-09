/**
 * STEP 20 / C-20.1 — 过拟合检测（第一批）：PBO + 参数敏感性 + 判定聚合。统一出口。
 *
 * 交付内容：
 *   - types.ts            类型契约（OfdPboResult / ParameterSensitivityResult /
 *                         OverfittingAssessmentRun / 常量 / reasonCode / 阈值 / 评估契约）；
 *   - pbo.ts              CSCV 划分 + 倒置统计 + 零分布 + 分位 CI + 判定结论 + 指纹；
 *   - parameterSensitivity.ts 复用 C-18.1 generateParameterPerturbationVariants +
 *                         注入式评估器 + 漂移判定 + 敏感度度量 + 判定结论 + 指纹；
 *   - assess.ts           OverfittingAssessmentRun 聚合判定（PBO + PS + 可选 RobustnessView）；
 *   - serialize.ts        canonical 序列化 + sha256 指纹 + 结构校验 + round-trip 篡改拒绝；
 *   - run.ts              主编排入口 runOverfittingDetection + Run ID 生成；
 *
 * 纯模块：无 DB / 无 IO / 无 Date.now / Math.random（createdAt / assessmentRunId 注入式）；
 * 不可变、确定性。import 只读复用 C-18.1 扰动器 / 阈值常量与 C-19.2 OOS 标量；
 * 不 import STEP 6.5 pbo.ts / overfittingAssessment.ts / parameterStability.ts（域隔离）。
 *
 * 边界：
 *   - 不做 Factor Ablation / Perturbation Test / OOS Degradation（明确留 C-20.2）；
 *   - 不下「策略能否上线」结论（属 C-21 / C-25）；
 *   - 不跑真实回测（evaluator 注入式）。
 */

export * from "./types";
export * from "./pbo";
export * from "./parameterSensitivity";
export * from "./assess";
export * from "./serialize";
export * from "./run";
