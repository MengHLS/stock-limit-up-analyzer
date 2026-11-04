/**
 * 通用 AuthoringSlot 编辑器共享的参数 / 预设 DTO。
 *
 * 这些类型原本与已删除的旧预设编辑器组件放在一起；旧组件删除后，
 * 仍由通用槽编辑器与 EXIT_POLICY 起点行消费的类型迁移到这里，避免保留业务组件。
 */
export type PresetParameterValue = number | boolean | string;

export interface PresetParameter {
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly valueType: "number" | "boolean" | "string";
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly allowedValues?: readonly string[];
  /** 枚举取值的中文标签（值不变，只换显示）。 */
  readonly optionLabels?: Readonly<Record<string, string>>;
  readonly required: boolean;
  readonly defaultValue: PresetParameterValue;
}

export interface PresetSummary {
  readonly presetId: string;
  readonly slot: string;
  /** 技术标识（只进技术细节）。 */
  readonly label: string;
  readonly description: string;
  /** 规则式中文名（下拉显示）。 */
  readonly displayName: string;
  /** 更长的口径说明（只作 tooltip，不作正文）。 */
  readonly summary: string;
  readonly status: "REGISTERED" | "EXPERIMENTAL" | "DEPRECATED";
  readonly version: string;
  readonly sourceRef: string;
  readonly advancedOnly: boolean;
  readonly parameters: readonly PresetParameter[];
}

export interface PresetSelection {
  /** 该预设自己的槽位（例：退出政策可以来自 EXIT_POLICY 组合预设，也可以来自 EXIT_BASE 基座）。 */
  readonly slot: string;
  readonly presetId: string;
  readonly parameters: Readonly<Record<string, PresetParameterValue>>;
}

/** EXIT_POLICY 起点行 materializePreset 的 DTO；字段与共享契约保持一致。 */
export interface PresetMaterializeResult {
  readonly slot: string;
  readonly presetId: string;
  readonly payload: unknown;
  readonly resolvedParameters: Readonly<Record<string, PresetParameterValue>>;
  readonly fingerprint: string;
  readonly issues: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}
