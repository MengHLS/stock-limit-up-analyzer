/**
 * RESEARCH-FINDING-001 B4 —— Finding Engine 统一出口。
 *
 * 分层（严格单向）：
 *   findingEngine（编排 + 落库）
 *     → findingDetector（§6–§11 四类检测）
 *        → resultView                  （Result 行 → 有序序列，纯解析）
 *        → findingStabilityAnalyzer    （§11 稳定性）
 *        → metrics（**唯一**统计实现，复用 shared/quant-stats）
 *     → findingScorer（§14 研究评分：研究优先级，**不是**策略评分）
 *     → findingInteractionAnalyzer（§12 条件组合；无 Result 支撑只产未验证假设）
 *
 * 反模式检查（本模块**不含**）：
 *   - 无 Dataset 读取（不 import datasetReader，不查任何 `dataset_*`）；
 *   - 无第二套统计实现（均值 / 相关 / 一致性一律走 metrics + shared/quant-stats）；
 *   - 无 LLM 参与（探测器是确定性函数，任务书 §4）；
 *   - 不写 `strategies` / `strategy_versions`（Finding ≠ 策略，任务书 §26）。
 */

export * from "./types";
export * from "./resultView";
export * from "./findingStabilityAnalyzer";
export * from "./findingScorer";
export * from "./findingDetector";
export * from "./findingInteractionAnalyzer";
export * from "./findingEngine";
