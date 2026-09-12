/**
 * Research 工作台子组件 barrel（RESEARCH-002 前端）。
 */

export { CreateExperimentDialog } from "./CreateExperimentDialog";
export { CreateAnalysisDialog } from "./CreateAnalysisDialog";
export { AnalysisResultsView } from "./AnalysisResultsView";
export { ConclusionPanel } from "./ConclusionPanel";
export { RunEngineButton } from "./RunEngineButton";
export { RunIncrementalButton } from "./RunIncrementalButton";
export { RunExecutionBatches, skippedConclusionNotes } from "./RunExecutionBatches";
export { VariableCatalogCard } from "./VariableCatalogCard";

// 维护能力（RESEARCH-002 可维护性）：重命名 / 级联删除 / 改口径
export { ConfirmDeleteButton } from "./ConfirmDeleteButton";
export { ExperimentActions } from "./ExperimentActions";
export { AnalysisConditionEditor } from "./AnalysisConditionEditor";
export { ConditionGroupsEditor } from "./ConditionGroupsEditor";
export { CandidatesPanel } from "./CandidatesPanel";

// 表单纯函数（可单测；与 `datasetRegistry/datasetFilterForm` 同一约定）
export * from "./createExperimentForm";
export * as createAnalysisForm from "./createAnalysisForm";
export * as incrementalRunForm from "./incrementalRunForm";
export * as analysisBatchForm from "./analysisBatchForm";

// 批量建分析（RESEARCH-002C）：矩阵 / 标准套件 / 我的模板
export { BatchAnalysisDialog } from "./BatchAnalysisDialog";
