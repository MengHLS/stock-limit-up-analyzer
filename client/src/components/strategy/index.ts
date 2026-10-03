/**
 * 策略子组件 barrel。
 */

export { StrategyHeader, type LoadedTarget, type VersionOption } from "./StrategyHeader";
export { StrategyFamilyPanel } from "./StrategyFamilyPanel";
export { StrategyBasicInfo } from "./StrategyBasicInfo";
export { RuleEditor } from "./RuleEditor";
export { PositionSizingEditor } from "./PositionSizingEditor";
export { RunConfigPanel, type RunConfigViewModel } from "./RunConfigPanel";
export { ClosedLoopRunResultPanel } from "./ClosedLoopRunResultPanel";
export { StrategyVersionPanel } from "./StrategyVersionPanel";
// FLOW-001 §3 ⑤→⑥ 交接缺口：策略版本的验证台账（只读汇总）
export { StrategyValidationStatus } from "./StrategyValidationStatus";
export { StrategyAdvancedTools } from "./StrategyAdvancedTools";
/**
 * Canonical 定义编辑器（与研究草图同一套交互）。
 *
 * `StrategyJsonEditor` 已随「JSON 高级模式」一起移除：那条路让用户直接编辑 wire 文档，
 * 绕过了 `validateCanonicalStrategyDefinition` 之外的一切约束，并制造出
 * 「JSON 里改了、页面上没改」的第二种真相。规则编辑现在只有一条路 —— `definition`。
 */
export { DefinitionFields } from "./DefinitionFields";
/** SCOPE-002 S7 —— 策略详情的「最终评估 / 模拟盘」通用 Tab（按版本坐标查留档）。 */
export {
  StrategyFinalEvaluationTab,
  StrategyPaperTradingTab,
  type StrategyVersionCoordinatesProps,
} from "./StrategyVersionArtifactsTabs";

/** SCOPE-002 §3.4 —— 通用「预设 + 参数」编辑器（词表来自 strategyDomain.authoring.getVocabulary）。 */
/** P1 —— 策略定义的「当前组合状态」（信任层：一致 / 变体 / 未验证）。 */
export {
  DefinitionTrustStatus,
  type DefinitionTrustChangedParam,
  type DefinitionTrustKind,
} from "./DefinitionTrustStatus";
/** P1 —— 七段归位到五个任务块（纯分组常量，供概览与测试共用）。 */
export { DEFINITION_BLOCKS, type DefinitionProgressPresetSegment } from "./DefinitionProgressOverview";

export {
  PresetEditor,
  type PresetMaterializeResult,
  type PresetParameter,
  type PresetParameterValue,
  type PresetSelection,
  type PresetSummary,
} from "./PresetEditor";
