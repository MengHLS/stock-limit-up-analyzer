/**
 * 策略子组件 barrel。
 */

export { StrategyHeader, type LoadedTarget, type VersionOption } from "./StrategyHeader";
export { StrategyBasicInfo } from "./StrategyBasicInfo";
export { RuleEditor } from "./RuleEditor";
export { PositionSizingEditor } from "./PositionSizingEditor";
export { RunConfigPanel, type RunConfigViewModel } from "./RunConfigPanel";
export { ClosedLoopRunResultPanel } from "./ClosedLoopRunResultPanel";
export { StrategyVersionPanel } from "./StrategyVersionPanel";
export { StrategyAdvancedTools } from "./StrategyAdvancedTools";
/**
 * Canonical 定义编辑器（与研究草图同一套交互）。
 *
 * `StrategyJsonEditor` 已随「JSON 高级模式」一起移除：那条路让用户直接编辑 wire 文档，
 * 绕过了 `validateCanonicalStrategyDefinition` 之外的一切约束，并制造出
 * 「JSON 里改了、页面上没改」的第二种真相。规则编辑现在只有一条路 —— `definition`。
 */
export { DefinitionFields } from "./DefinitionFields";
