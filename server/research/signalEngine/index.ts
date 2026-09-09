/**
 * STEP 13 / C-13.2 — Signal 与 Candidate 框架统一出口。
 *
 * Feature(STEP10)→Signal(STEP10)→Candidate→Evaluation 的多日驱动编排薄层：
 *   - runCandidateEngine：逐 tradeDate 驱动单日 pipeline，产出可审计 CandidateEvaluationRun；
 *   - 记录类型 / 校验 / 序列化 / 候选层统计评价。
 * 只做编排；不实现 Feature 库本体（后续）、不实现收益回测（C-14.1）。
 */

export * from "./types";
export * from "./validate";
export * from "./evaluate";
export * from "./serialize";
export * from "./engine";
