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

// RESEARCH-006.4.1 — Research → Strategy 候选（结论 → 候选 → 状态流转）
export { CreateCandidateDialog } from "./CreateCandidateDialog";
export { CandidateLifecycleActions } from "./CandidateLifecycleActions";
export { CandidateSketchCard } from "./CandidateSketchCard";
export { CandidateSketchFields } from "./CandidateSketchFields";
export { EditCandidateDialog } from "./EditCandidateDialog";

// RESEARCH-006.4.1-B — Candidate → Strategy 转正（promote）与 Research Provenance 只读切面
export { PromoteCandidateDialog } from "./PromoteCandidateDialog";
export { StrategyResearchProvenancePanel } from "./StrategyResearchProvenancePanel";

// 表单纯函数（可单测；与 `datasetRegistry/datasetFilterForm` 同一约定）
export * from "./createExperimentForm";
export * as createAnalysisForm from "./createAnalysisForm";
export * as incrementalRunForm from "./incrementalRunForm";
export * as analysisBatchForm from "./analysisBatchForm";
export * as candidateForm from "./candidateForm";
export * as candidateSketchForm from "./candidateSketchForm";
export * as candidateSketchVocabulary from "./candidateSketchVocabulary";
export * as candidateSketchCostPreset from "./candidateSketchCostPreset";
export * as promoteForm from "./promoteForm";

// 矩阵视图（把「决策日 × 回撤桶」等批量分析拼回一张表；纯函数 + 组件）
export { ResearchMatrixView } from "./ResearchMatrixView";
export * as researchMatrix from "./researchMatrix";

// 批量建分析（RESEARCH-002C）：矩阵 / 标准套件 / 我的模板
export { BatchAnalysisDialog } from "./BatchAnalysisDialog";
