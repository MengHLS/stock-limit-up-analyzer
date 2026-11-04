/**
 * SCOPE-002 §2.3 A2 —— 空白 canonical 草稿骨架（纯函数、无 IO）。
 *
 * 🔴 为什么必须由**服务端**下发：`client/**` 不得 import `server/**` 的运行时值（`AGENTS.md` §6-10），
 *    所以"空白定义长什么样"只能由服务端给出，前端绝不自行拼一份（否则又是第二套语义）。
 *
 * ⚠️ 诚实声明：本函数产出的**不是**一份通过校验的 `StrategyDocument`，而是一份
 *    **结构齐全、取值待填**的草稿零件（`draft`）。原因是 canonical 校验要求必填项
 *    （event / observationWindow / trigger / position / execution / datasets），
 *    一份"完全空"的定义**必然**过不了校验。真正的闸门在 A4 `previewDocument` 与
 *    A5 `saveDraft` —— 那里会如实列出还差什么，而不是在这里替用户编造默认语义。
 */
import type { CostModel } from "../../engine/domain";
import { DEFAULT_COST_MODEL } from "../../engine/execution";
import type { StrategyDefinitionInput } from "../strategySchema/definition";
import type { StrategyUniverse } from "../strategySchema/types";

/** 数据集绑定三元组（由调用方从 Dataset Registry 只读解析后传入）。 */
export interface StrategyAuthoringDatasetBinding {
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly datasetVersionId: number;
}

export interface StrategyAuthoringBlankParts {
  readonly identity: {
    readonly strategyId: string;
    readonly version: string;
    readonly name: string;
    readonly description: string;
    /** ✅ 裁定 Q4：`saveDraft` 要求必填，草稿阶段先留 `null`。 */
    readonly strategyType: null;
  };
  /** 结构齐全、取值待填的 canonical 骨架。 */
  readonly definition: StrategyDefinitionInput;
  readonly executionAssumptions: {
    readonly backtestConfig: { readonly initialCapital: number; readonly maxPositions: number };
    readonly costModel: CostModel;
    readonly executionModel: string;
  };
  readonly universe: StrategyUniverse;
  /** 待选（RECIPE 槽位）。 */
  readonly recipe: null;
}

export interface StrategyAuthoringBlank {
  readonly parts: StrategyAuthoringBlankParts;
  readonly requiredSections: readonly { readonly key: string; readonly label: string; readonly description: string }[];
  readonly notes: readonly string[];
}

/** 平台默认执行假设（可被前端编辑；这里只是起点，不是"研究结论"）。 */
export const AUTHORING_DEFAULT_INITIAL_CAPITAL = 1_000_000;
export const AUTHORING_DEFAULT_MAX_POSITIONS = 5;

const REQUIRED_SECTIONS = [
  { key: "identity", label: "身份与坐标", description: "strategyId / version / name / strategyType / Dataset Version" },
  { key: "what", label: "买什么", description: "事件类型（entry.event）" },
  { key: "when", label: "什么时候买", description: "观察窗口 + 触发时点" },
  { key: "recipe", label: "信号配方", description: "RECIPE 预设（缺它回测会落到 DEFAULT 配方）" },
  { key: "exit", label: "怎么卖", description: "EXIT_POLICY 预设（可留空 = 持有到期末）" },
  { key: "sizing", label: "买多少 · 最多持几只", description: "仓位方式与最大持仓" },
  { key: "cost", label: "成本与资金", description: "成交时点 / 价格类型 / 费率 / 初始资金" },
] as const;

const NOTES = [
  "这是**待填**草稿，不是已校验的策略文档；保存前必须通过 previewDocument / saveDraft。",
  "成本模型使用平台默认 DEFAULT_COST_MODEL（server/engine/execution.ts）；可在「成本与资金」段修改。",
  "执行时点默认 T_CLOSE 出信号 → T+1 开盘成交（项目 T+1 模型），可修改。",
  "本稿为**无证据开发草稿**：不写 strategy_research_provenance；正式提升仍必须走研究候选转正。",
] as const;

/**
 * 生成空白草稿零件。
 *
 * 传入 `datasetBinding` 时顺带写入 `definition.datasets` 的 PRIMARY 绑定与 `universe`；
 * 不传时 `datasets` 为空、`universe` 为空占位 —— 由前端在选择 Dataset Version 后再补。
 */
export function buildStrategyAuthoringBlank(input: {
  readonly datasetBinding?: StrategyAuthoringDatasetBinding;
} = {}): StrategyAuthoringBlank {
  const binding = input.datasetBinding;
  const definition: StrategyDefinitionInput = {
    schemaVersion: "1.0",
    datasets: binding === undefined
      ? []
      : [{
          role: "PRIMARY",
          datasetId: binding.datasetId,
          datasetVersion: binding.datasetVersion,
          datasetVersionId: binding.datasetVersionId,
        }],
    entry: {
      event: { type: "", params: {} },
      observationWindow: { start: 0, end: 0, unit: "TRADING_DAY" },
      trigger: { type: "" },
      conditions: [],
    },
    exit: { rules: [] },
    position: {
      sizingMethod: "FIXED_RATIO",
      positionRatio: 0.2,
      maxPositions: AUTHORING_DEFAULT_MAX_POSITIONS,
    },
    risk: {},
    execution: {
      signalTiming: "T_CLOSE",
      executionTiming: "T_PLUS_1_OPEN",
      priceType: "OPEN",
      quantityMethod: "TARGET_WEIGHT",
      lotSize: 100,
      commissionModel: "BPS",
      slippageModel: "BPS",
    },
    parameters: [],
  } as unknown as StrategyDefinitionInput;

  return {
    parts: {
      identity: { strategyId: "", version: "1.0.0", name: "", description: "", strategyType: null },
      definition,
      executionAssumptions: {
        backtestConfig: { initialCapital: AUTHORING_DEFAULT_INITIAL_CAPITAL, maxPositions: AUTHORING_DEFAULT_MAX_POSITIONS },
        costModel: { ...DEFAULT_COST_MODEL },
        executionModel: "NEXT_OPEN",
      },
      universe: binding === undefined ? { universeId: "" } : { universeId: `research-dataset:${binding.datasetVersion}` },
      recipe: null,
    },
    requiredSections: REQUIRED_SECTIONS.map(section => ({ ...section })),
    notes: [...NOTES],
  };
}