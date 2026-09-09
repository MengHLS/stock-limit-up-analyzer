/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化：消融变体生成器。
 *
 * 职责：给定成分目标清单 + 模式（+ 先验顺序）→ 生成有序消融变体集合。
 *   - variants[0] 恒为 base（remove 系 = 全模型；add 系 = 空模型）；
 *   - 变体是**引用式配方快照**（activeIds / removedIds / addedIds），不含策略本体；
 *   - 每个非 base 变体携带 `marginalTargetId` 指明其「边际归因目标」，供贡献计算定位。
 *
 * 顺序（order）纪律：CUMULATIVE_REMOVE / FORWARD_ADD 的顺序必须先于任何求值给定。
 * 本函数只做变体几何；求值在 assess.ts，贡献计算在 contribution.ts——三个文件都不存在
 * 「用 OOS 结果决定顺序」的路径（顺序先验注入或按 components 顺序缺省）。
 *
 * 铁律：纯函数、确定性、readonly；退化输入（空成分集 / 成分数 < 2 / id 空 / id 重复 /
 * kind 非法 / 顺序非全排列 / 未知模式）响亮抛错（ResearchValidationError），不静默修正。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import {
  ABLATION_COMPONENT_KINDS,
  ABLATION_MODE_META,
  ABLATION_MODES,
  type AblationMode,
  type AblationTarget,
  type AblationVariantSpec,
} from "./types";

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function assertFiniteString(value: unknown, code: string, path: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ResearchValidationError([issue(code, path, `${label} 必须是非空字符串`)]);
  }
  return value;
}

/** 校验成分目标清单（非空 / >= 2 / id 唯一非空 / kind 合法）。返回 [合法, 错误列表] 或不抛错。 */
export function validateAblationComponents(
  components: readonly AblationTarget[],
): readonly ResearchValidationIssue[] {
  const problems: ResearchValidationIssue[] = [];
  if (!Array.isArray(components)) {
    return [issue("ABL_COMPONENTS_INVALID", "components", "components 必须是数组")];
  }
  if (components.length === 0) {
    return [issue("ABL_COMPONENTS_EMPTY", "components", "消融成分清单不能为空")];
  }
  if (components.length < 2) {
    return [
      issue(
        "ABL_COMPONENTS_TOO_FEW",
        "components",
        `成分数 = ${components.length}（贡献归因需要 >= 2 个成分才有对照；单成分的价值评估请直接在策略层做 base-vs-empty 对照，不属于消融归因本模块）`,
      ),
    ];
  }
  const seen = new Set<string>();
  components.forEach((target, index) => {
    if (target === null || typeof target !== "object") {
      problems.push(issue("ABL_COMPONENT_INVALID", `components[${index}]`, "成分目标必须是对象"));
      return;
    }
    if (typeof target.targetId !== "string" || target.targetId.trim() === "") {
      problems.push(
        issue("ABL_COMPONENT_ID_INVALID", `components[${index}].targetId`, "targetId 必须是非空字符串"),
      );
      return;
    }
    if (seen.has(target.targetId)) {
      problems.push(
        issue(
          "ABL_COMPONENT_ID_DUPLICATE",
          `components[${index}].targetId`,
          `targetId=${target.targetId} 重复（同一 run 内必须唯一）`,
        ),
      );
      return;
    }
    seen.add(target.targetId);
    if (typeof target.kind !== "string" || !ABLATION_COMPONENT_KINDS.includes(target.kind as never)) {
      problems.push(
        issue("ABL_COMPONENT_KIND_INVALID", `components[${index}].kind`, `kind=${String(target.kind)} 非法`),
      );
    }
    if (typeof target.label !== "string" || target.label.trim() === "") {
      problems.push(
        issue("ABL_COMPONENT_LABEL_INVALID", `components[${index}].label`, "label 必须是非空字符串"),
      );
    }
  });
  return problems;
}

function componentIds(components: readonly AblationTarget[]): string[] {
  return components.map((target) => target.targetId);
}

/**
 * 解析顺序：模式需要顺序时返回有效 order（缺省 = components 顺序）；不需要时返回 null。
 * 退化：需要顺序但给定 order 非法（长度不符 / 含未知 id / 重复 / 缺漏）→ 抛错。
 */
export function resolveAblationOrder(
  mode: AblationMode,
  components: readonly AblationTarget[],
  order: readonly string[] | undefined,
): readonly string[] | null {
  const meta = ABLATION_MODE_META[mode];
  if (!meta.requiresOrder) return null;
  const fullIds = componentIds(components);
  if (order === undefined || order === null) {
    return fullIds;
  }
  if (!Array.isArray(order)) {
    throw new ResearchValidationError([issue("ABL_ORDER_INVALID", "order", "order 必须是数组")]);
  }
  if (order.length !== fullIds.length) {
    throw new ResearchValidationError([
      issue(
        "ABL_ORDER_LENGTH_INVALID",
        "order",
        `order 长度 = ${order.length}（期望 = 成分数 ${fullIds.length}，必须覆盖全部成分）`,
      ),
    ]);
  }
  const seen = new Set<string>();
  const problems: ResearchValidationIssue[] = [];
  order.forEach((id, index) => {
    if (typeof id !== "string" || id.trim() === "") {
      problems.push(issue("ABL_ORDER_EMPTY", `order[${index}]`, "order 元素必须是非空字符串"));
      return;
    }
    if (!fullIds.includes(id)) {
      problems.push(
        issue("ABL_ORDER_UNKNOWN_ID", `order[${index}]`, `order 含未知成分 id=${id}`),
      );
      return;
    }
    if (seen.has(id)) {
      problems.push(
        issue("ABL_ORDER_DUPLICATE", `order[${index}]`, `order 含重复 id=${id}`),
      );
      return;
    }
    seen.add(id);
  });
  if (problems.length > 0) throw new ResearchValidationError(problems);
  // 覆盖完整性的最后防线：无重复 + 长度一致 + 全部 id 已知 ⇒ 恰为全排列。
  return order;
}

/**
 * 生成消融变体（variants[0] = base）。
 *
 * 变体数：
 *   - REMOVE_SINGLE / LEAVE_ONE_OUT：1（base） + |components|；
 *   - CUMULATIVE_REMOVE / FORWARD_ADD：1（base） + |order|。
 * 非 base 变体均携带 marginalTargetId（该步的边际归因目标）。
 */
export function buildAblationVariants(input: {
  readonly mode: AblationMode;
  readonly components: readonly AblationTarget[];
  readonly order?: readonly string[];
}): readonly AblationVariantSpec[] {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ResearchValidationError([
      issue("ABL_BUILD_INPUT_INVALID", "input", "buildAblationVariants 输入必须是对象"),
    ]);
  }
  if (typeof input.mode !== "string" || !ABLATION_MODES.includes(input.mode as never)) {
    throw new ResearchValidationError([
      issue("ABL_MODE_INVALID", "mode", `mode=${String(input.mode)} 非法`),
    ]);
  }
  const componentProblems = validateAblationComponents(input.components);
  if (componentProblems.length > 0) {
    throw new ResearchValidationError([...componentProblems]);
  }
  const order = resolveAblationOrder(input.mode, input.components, input.order);
  const meta = ABLATION_MODE_META[input.mode];
  const components = input.components;
  const fullIds = componentIds(components);

  const labelById = new Map<string, string>(components.map((target) => [target.targetId, target.label]));
  const variants: AblationVariantSpec[] = [];

  // ---- base（variants[0]） ----
  const isAddFamily = input.mode === "FORWARD_ADD";
  variants.push({
    variantIndex: 0,
    mode: input.mode,
    isBase: true,
    code: isAddFamily ? "BASE_EMPTY" : "BASE_FULL",
    label: isAddFamily ? meta.baseDescription : meta.baseDescription,
    marginalTargetId: null,
    activeIds: isAddFamily ? [] : fullIds,
    removedIds: [],
    addedIds: [],
  });

  // ---- 非 base 变体 ----
  if (input.mode === "REMOVE_SINGLE" || input.mode === "LEAVE_ONE_OUT") {
    components.forEach((target, index) => {
      const removed = target.targetId;
      const variantIndex = index + 1;
      variants.push({
        variantIndex,
        mode: input.mode,
        isBase: false,
        code: `ABL_REMOVE_${removed}`,
        label: `剔除「${target.label}」（${removed}）`,
        marginalTargetId: removed,
        activeIds: fullIds.filter((id) => id !== removed),
        removedIds: [removed],
        addedIds: [],
      });
    });
    return variants;
  }

  if (input.mode === "CUMULATIVE_REMOVE" || input.mode === "FORWARD_ADD") {
    const ordered = order as readonly string[]; // 两个模式必 requiresOrder → resolveAblationOrder 已返回全排列
    ordered.forEach((removedOrAdded, index) => {
      const step = index + 1;
      const variantIndex = step;
      const prefix = ordered.slice(0, step);
      const active = input.mode === "FORWARD_ADD" ? prefix : fullIds.filter((id) => !prefix.includes(id));
      const label = labelById.get(prefix[prefix.length - 1]!) ?? prefix[prefix.length - 1]!;
      variants.push({
        variantIndex,
        mode: input.mode,
        isBase: false,
        code: input.mode === "FORWARD_ADD"
          ? `ABL_FWD_${step}_${removedOrAdded}`
          : `ABL_CUM_${step}_${removedOrAdded}`,
        label: input.mode === "FORWARD_ADD"
          ? `反向加回第 ${step} 步：加入「${label}」（${removedOrAdded}）`
          : `逐层去除第 ${step} 步：剔除「${label}」（${removedOrAdded}）`,
        marginalTargetId: removedOrAdded,
        activeIds: active,
        removedIds: input.mode === "FORWARD_ADD" ? [] : prefix,
        addedIds: input.mode === "FORWARD_ADD" ? [removedOrAdded] : [],
      });
    });
    return variants;
  }

  // 防御：类型层面不可达。
  throw new ResearchValidationError([
    issue("ABL_MODE_UNREACHABLE", "mode", `未知消融模式：${String(input.mode)}`),
  ]);
}
