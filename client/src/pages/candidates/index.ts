/**
 * 候选页面 barrel（RESEARCH-EXPERIMENT-003）。
 *
 * 旧 `CandidateList`（跨实验候选列表）随旧 Research 前端删除 —— 它读的是
 * `researchEngine.listCandidates`（旧 Research API）。候选**详情**页（研究草图的
 * 编辑 / 状态流转 / 转正）是 Strategy Candidate 桥的唯一前端入口，故保留并迁到本目录。
 */

export { default as StrategyCandidateDetail } from "./StrategyCandidateDetail";
