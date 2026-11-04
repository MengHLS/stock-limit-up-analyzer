/**
 * 独立研究实验页面 barrel（RESEARCH-EXPERIMENT-001 / 004）。
 *
 * - `ResearchExperimentList`       `/research-experiments`（有哪些实验、最近跑得怎样）
 * - `ResearchExperimentDetail`     `/research-experiments/:group/:key`（跑一次、看结果）
 * - `ResearchExperimentRunDetail`  `/research-experiments/:group/:key/runs/:runId`
 *   （RESEARCH-EXPERIMENT-004：**只凭 runId** 打开的持久化历史 Run）
 *
 * 🔴 路由参数一律在组件内 `useParams()` 取 —— 本仓库禁止给页面组件传自定义 props
 * 再挂到 wouter 的 `component={}`（与 `RouteComponentProps` 冲突，`TS2322`）。
 */

export { default as ResearchExperimentList } from "./ExperimentList";
export { default as ResearchExperimentDetail } from "./ExperimentDetail";
export { default as ResearchExperimentRunDetail } from "./RunDetail";
export { GenericExperimentResult } from "./GenericResultView";
