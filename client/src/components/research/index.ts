/**
 * 「研究 → 策略候选」前端子组件 barrel（RESEARCH-EXPERIMENT-003 裁剪）。
 *
 * 旧 Research 工作台（Experiment → Run → 分析 → 结果 → 结论）的组件随整条旧体系删除，
 * 这里只保留**仍被使用**的两簇：
 *   1. Strategy Candidate 桥的 UI（候选草图编辑 / 状态流转 / 转正 / 溯源只读）；
 *   2. 策略编辑器复用的**草图词表与草图画布**（`components/strategy/**` 直接依赖它们，
 *      它们是「规则条件的字段引用词表」，与旧 Analysis 无耦合）。
 */

// —— Strategy Candidate 桥（研究 → 策略）——
export { CandidateLifecycleActions } from "./CandidateLifecycleActions";
export { CandidateSketchCard } from "./CandidateSketchCard";
export { CandidateSketchFields } from "./CandidateSketchFields";
export { EditCandidateDialog } from "./EditCandidateDialog";
export { PromoteCandidateDialog } from "./PromoteCandidateDialog";
export { StrategyResearchProvenancePanel } from "./StrategyResearchProvenancePanel";

// —— 维护能力 ——
export { ConfirmDeleteButton } from "./ConfirmDeleteButton";

// —— 表单纯函数（可单测；与 `datasetRegistry/datasetFilterForm` 同一约定）——
export * as createAnalysisForm from "./createAnalysisForm";
export * as candidateForm from "./candidateForm";
export * as candidateSketchForm from "./candidateSketchForm";
export * as candidateSketchVocabulary from "./candidateSketchVocabulary";
export * as candidateSketchCostPreset from "./candidateSketchCostPreset";
export * as promoteForm from "./promoteForm";
