/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化（Factor Ablation / Perturbation / OOS Degradation）。
 * 统一出口。
 *
 * 交付内容：
 *   - types.ts          类型契约（AblationTarget / AblationMode + META / AblationVariantSpec /
 *                       AblationMetricsView / AblationAssessmentRun / 阈值 / 信号码 / reasonCode）；
 *   - variants.ts       消融变体生成器（四模式几何 + 顺序校验，variants[0] = base）；
 *   - contribution.ts   成分双轨贡献 + 稳定排序（显式非单点 argmax）+ OOS 退化信号候选；
 *   - assess.ts         主编排 assessAblationRun（IS 必跑 + OOS 可选只读 + 装配记录 + 指纹）；
 *   - serialize.ts      canonical 序列化 + sha256 指纹 + 结构校验 + round-trip 篡改拒绝；
 *   - adapt.ts          与 C-20.1（overfittingDetection）汇合适配（robustnessView 槽并列记录）；
 *   - discipline.ts     OOS 只读纪律审计（机器检查：两轨对齐 / 目标一致 / 顺序先验固定）；
 *   - run.ts            Run ID 生成 + 便捷入口 runAblationAssessment。
 *
 * 纯模块：无 DB / 无 IO / 无 Date.now / Math.random（ablationRunId / createdAt 注入式）；
 * 不可变、确定性。import 只读复用 researchDataset/version（canonicalStringify）、
 * C-18.1 robustness（漂移阈值常量）、C-20.1 overfittingDetection（type-only 视图形态）。
 *
 * 边界：
 *   - 不做参数数值 / 成本 / 滑点 / 执行扰动（C-18.1）；
 *   - 不做 PBO / 参数敏感性 / Overfitting 聚合判定本身（C-20.1）；
 *   - 不做交互显著性 / p 值 / 贝叶斯 / 自动剔除重训 / 上线结论（C-25.1）；
 *   - 不跑真实回测（evaluator 注入式）；OOS 只读、不参与任何消融/选择。
 */

export * from "./types";
export * from "./variants";
export * from "./contribution";
export * from "./assess";
export * from "./serialize";
export * from "./adapt";
export * from "./discipline";
export * from "./run";
