/**
 * 通用策略创作槽协议 —— 服务端权威的槽注册、识别与应用传输形状。
 *
 * 本文件只定义协议类型，不承载具体策略语义。SELECTION / EXIT_POLICY / ENTRY_CONDITION
 * 以及 POSITION / COST / PARAMETER_SPACE 都通过这些类型接入。
 */
import type {
  StrategyPresetParameter,
  StrategyPresetParameterValue,
} from "./presetRegistry";

export const AUTHORING_SLOT_GROUPS = [
  "SELECTION",
  "EXIT_POLICY",
  "ENTRY_CONDITION",
  "POSITION",
  "COST",
] as const;

export type AuthoringSlotGroup = (typeof AUTHORING_SLOT_GROUPS)[number];

export type AuthoringSlotVisibility = "PRIMARY" | "MORE" | "RESEARCH";

export type AuthoringParameterValue = StrategyPresetParameterValue;
export type AuthoringParameters = Readonly<Record<string, AuthoringParameterValue>>;

/** 通用槽的输入载体。所有字段都原样透传，除非对应 handler 明确拥有并修改它。 */
export interface AuthoringTarget {
  readonly recipe: unknown | null;
  readonly definition: unknown;
  readonly executionAssumptions: unknown;
}

/** 一个槽的识别结果。`optionId = null` 表示本表单不识别，必须保持原样。 */
export interface AuthoringRecognitionItem {
  readonly group: AuthoringSlotGroup;
  readonly slotId: string;
  readonly optionId: string | null;
  readonly parameters: AuthoringParameters;
  readonly atDefaults: boolean;
  /** 入场槽拥有的 canonical condition id；不属于当前组的槽可省略。 */
  readonly managedConditionIds?: readonly string[];
  /** 本槽写入的路径提示，仅供前端展示归属，不参与拼装。 */
  readonly managedPaths?: readonly string[];
}

export interface AuthoringRecognitionResult {
  readonly slots: readonly AuthoringRecognitionItem[];
}

/** apply 永远返回完整片段；issues 非空时三个片段必须与输入 target 相同。 */
export interface AuthoringApplyResult extends AuthoringTarget {
  readonly issues: readonly string[];
}

export interface AuthoringSlotOptionSummary {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly parameters: readonly StrategyPresetParameter[];
}

export interface AuthoringSlotSummary {
  readonly slotId: string;
  readonly label: string;
  readonly question: string;
  readonly visibility: AuthoringSlotVisibility;
  readonly options: readonly AuthoringSlotOptionSummary[];
}

export interface AuthoringSlotGroupSummary {
  readonly group: AuthoringSlotGroup;
  readonly label: string;
  readonly slots: readonly AuthoringSlotSummary[];
}

/** 一个 group 的适配器；registry 只依赖此接口，不直接理解 exit / entry 语义。 */
export interface AuthoringSlotHandler {
  readonly group: AuthoringSlotGroup;
  readonly label: string;
  readonly summaries: readonly AuthoringSlotSummary[];
  readonly slotIds: readonly string[];

  recognize(target: AuthoringTarget): readonly AuthoringRecognitionItem[];

  apply(
    target: AuthoringTarget,
    slotId: string,
    optionId: string,
    parameters: AuthoringParameters,
  ): AuthoringApplyResult;
}