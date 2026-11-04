/**
 * ⑤ 可调参数 —— **派生视图**（FE-PLAN-003 §8 P3 / C-1）。
 *
 * ## 这个模块解决什么
 *
 * ⑤ 不是配置块，而是"上面四块里，哪些值允许被搜索"的**投影**：
 *
 *   - **候选从哪来**：①–④ 已选方案各自暴露的参数（`vocabulary.presets[].parameters`）。
 *     所以本模块**不含任何参数清单字面量** —— 加一个预设参数，候选自动多一条。
 *   - **写去哪**：`definition.parameters[]` 的一行（`parameterRole = TUNABLE`）。
 *     仍然只有一份真相（草稿），⑤ 不新建第二处定义 ⇒ C-1。
 *
 * ## 🔴 死参数防火墙（本模块存在的真正理由）
 *
 * `TUNABLE` **只有被规则图引用**才会真正参与搜索：
 * `server/research/parameterSearch/executor.ts` 会对"声明了 TUNABLE 但规则图从未引用"
 * 的参数响亮拒绝（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`），真实库里已经踩过
 * （`cand-360001@1.0.0`：声明 3 个、引用 0 个）。
 *
 * 而**预设参数**（`anchor.stopRatio` / `positionRatio` / `slippageBps` …）住在 policy /
 * 文档级配置里，**不在规则图里** ⇒ 直接把它们声明成 TUNABLE 就是批量生产死参数。
 * 所以候选一律带 `referenced` 标记：**没被引用的一律不可勾选**（UI 禁用 + 说明原因），
 * 而不是让用户勾完再去参数搜索页面吃一次拒绝。
 */
import {
  emptyParameterRow,
  type DefinitionDrafts,
  type ParameterRowDraft,
} from "./definitionDraft";

/** 候选来源：哪一块 / 哪个方案 / 方案的哪个参数。 */
export interface SearchParameterCandidate {
  /** 写进 `parameters[].code` 的 canonical code（取自预设参数，不另起名）。 */
  readonly code: string;
  /** 中文名（预设参数的 label，本身就能说明白）。 */
  readonly label: string;
  readonly dataType: "number" | "string" | "boolean";
  /** 预设声明的范围（直接抄，不改口径）。 */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly allowedValues?: readonly string[];
  /** 该参数在当前方案下的取值（作为 `defaultValue`）。 */
  readonly currentValue: number | boolean | string;
  /** 来自哪一块（1..4）+ 哪个方案的中文名 —— 只作展示，不参与计算。 */
  readonly blockLabel: string;
  readonly presetDisplayName: string;
  /** 规则图是否真的引用了它（**唯一可勾选条件**）。 */
  readonly referenced: boolean;
  /** 草稿里是否已经有这个 code 的行（"同一参数不得两处定义"）。 */
  readonly alreadyDeclared: boolean;
}

/** 预设参数的**最小形状**（只读词汇表给什么就吃什么，不 import 服务端类型）。 */
export interface PresetParameterLike {
  readonly code: string;
  readonly label: string;
  readonly valueType: "number" | "boolean" | "string";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly allowedValues?: readonly string[];
  readonly defaultValue: number | boolean | string;
}

/** 一个已选方案（①–④ 之一）暴露的参数清单。 */
export interface SelectedPresetParameters {
  readonly blockLabel: string;
  readonly presetDisplayName: string;
  readonly parameters: readonly PresetParameterLike[];
}

/**
 * 规则图实际引用的参数 code 集合。
 *
 * 口径与 `strategyCore/ruleGraph.ts#collectRuleParameterReferences` **一致**：
 *   - 条件的 `valueType === "PARAMETER_REFERENCE"` ⇒ 右值就是 code；
 *   - 出场规则的 `parameter`（本次表单不编辑，但从 `original` 读）⇒ 也是 code。
 *
 * 故意**不**在这里做表达式解析：客户端只认这两种**声明式**引用
 * （`value` 里写算术式的情况由服务端判定；前端不猜，宁可判"没引用"而禁用）。
 */
export function referencedParameterCodes(drafts: DefinitionDrafts): ReadonlySet<string> {
  const out = new Set<string>();
  for (const row of drafts.conditions) {
    if (row.valueType !== "PARAMETER_REFERENCE") continue;
    const code = row.value.trim();
    if (code !== "") out.add(code);
  }
  for (const rule of drafts.exitRules) {
    const parameter = rule.original?.parameter;
    if (typeof parameter === "string" && parameter.trim() !== "") out.add(parameter.trim());
  }
  return out;
}

/** 草稿里已声明的 code（判"同一参数不得两处定义"）。 */
export function declaredParameterCodes(drafts: DefinitionDrafts): ReadonlySet<string> {
  return new Set(drafts.parameters.map(row => row.code.trim()).filter(code => code !== ""));
}

/**
 * 派生候选清单：`已选方案 × 它们的参数`，逐个标注"是否可搜 / 是否已声明"。
 *
 * 同一 code 被多个方案暴露时**只保留一条**（先出现的赢，顺序 = 调用方给的块顺序），
 * 免得同一参数在清单里出现两次、用户以为要勾两次。
 */
export function deriveSearchParameterCandidates(
  drafts: DefinitionDrafts,
  selected: readonly SelectedPresetParameters[],
): readonly SearchParameterCandidate[] {
  const referenced = referencedParameterCodes(drafts);
  const declared = declaredParameterCodes(drafts);
  const seen = new Set<string>();
  const out: SearchParameterCandidate[] = [];
  for (const preset of selected) {
    for (const parameter of preset.parameters) {
      const code = parameter.code.trim();
      if (code === "" || seen.has(code)) continue;
      seen.add(code);
      out.push({
        code,
        label: parameter.label,
        dataType: parameter.valueType,
        min: parameter.min,
        max: parameter.max,
        step: parameter.step,
        allowedValues: parameter.allowedValues,
        currentValue: parameter.defaultValue,
        blockLabel: preset.blockLabel,
        presetDisplayName: preset.presetDisplayName,
        referenced: referenced.has(code),
        alreadyDeclared: declared.has(code),
      });
    }
  }
  return out;
}

/** 候选 → `parameters[]` 的一行（**唯一**的字段映射实现）。 */
export function candidateToParameterRow(candidate: SearchParameterCandidate): ParameterRowDraft {
  return {
    ...emptyParameterRow(),
    code: candidate.code,
    name: candidate.label,
    dataType: candidate.dataType,
    parameterRole: "TUNABLE",
    required: false,
    hasDefaultValue: true,
    defaultValue: String(candidate.currentValue),
    min: candidate.min === undefined ? "" : String(candidate.min),
    max: candidate.max === undefined ? "" : String(candidate.max),
    step: candidate.step === undefined ? "" : String(candidate.step),
    allowedValuesText: (candidate.allowedValues ?? []).join(","),
  };
}

/** 勾选 / 取消勾选的结果类型（`REJECTED_*` 是**响亮**拒绝，不是静默无事发生）。 */
export type ToggleSearchParameterResult =
  | { readonly kind: "APPLIED"; readonly drafts: DefinitionDrafts }
  | { readonly kind: "REJECTED_UNREFERENCED"; readonly drafts: DefinitionDrafts };

/**
 * 勾选/取消一个候选。
 *
 * - 取消：按 code 删掉对应的行（**只删这一行**，别的行一字不动）。
 * - 勾选且**已有同 code 的行** ⇒ **原样不动**（幂等）。
 *   🔴 这里刻意**不**重写那一行：既有行可能是从真实版本载入的，带着本表单不编辑的键
 *   （`original.unit` / `original.description` / `derivedFrom` …）。用「候选的最小形状」覆盖它
 *   会当场丢键 —— 那是本仓最忌讳的静默丢数据。
 * - 勾选且没有 ⇒ 追加一行。
 * - 🔴 未被子规则图引用的候选**不允许勾选** ⇒ 返回 `REJECTED_UNREFERENCED`
 *   （UI 必须据此把按钮禁用并说明原因；这里再兜一道，防止别处绕过）。
 */
export function toggleSearchParameter(
  drafts: DefinitionDrafts,
  candidate: SearchParameterCandidate,
  checked: boolean,
): ToggleSearchParameterResult {
  const code = candidate.code.trim();
  const withoutRow = drafts.parameters.filter(row => row.code.trim() !== code);
  if (!checked) return { kind: "APPLIED", drafts: { ...drafts, parameters: withoutRow } };
  if (!candidate.referenced) return { kind: "REJECTED_UNREFERENCED", drafts };
  /** 已有同 code 的行 ⇒ 幂等返回（**绝不**用候选的最小形状覆盖它，否则会丢 original 里的键）。 */
  if (withoutRow.length !== drafts.parameters.length) return { kind: "APPLIED", drafts };
  return {
    kind: "APPLIED",
    drafts: { ...drafts, parameters: [...withoutRow, candidateToParameterRow(candidate)] },
  };
}

/** 候选在界面上的一句话状态（**不是**解释段落，是状态标签）。 */
export function candidateStatusLabel(candidate: SearchParameterCandidate): string {
  if (candidate.alreadyDeclared) return "已在搜索空间";
  if (!candidate.referenced) return "未被规则引用，不可搜索";
  return "可加入搜索";
}
