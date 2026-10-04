/**
 * ③ 仓位 / ④ 成本与成交 —— **FIELD_PATCH 预设**落到 `DefinitionDrafts` 的唯一实现。
 *
 * ## 为什么需要这一层（而不是让预设直接产出 canonical 片段）
 *
 * 这两个块在定义里**没有独立载体**：它们是 `definition.position.*` /
 * `definition.execution.*` 与文档级 `executionAssumptions.*` 的若干字段。
 * 所以预设产出的是一张**字段补丁**，本模块负责把它**填进草稿**——
 * 与用户手动在表单里逐格输入产生的效果逐字相同。
 *
 * ## 三条纪律
 *
 * 1. 🔴 **只覆盖补丁声明过的键**；`original` 一律原样保留（只改文本字段，绝不重建
 *    `original`）—— 否则会静默丢掉表单不编辑的既有键。
 * 2. 🔴 **`maxPositions` 双写**：预设只在 `/position/maxPositions` 声明一次（C-2 单一编辑点），
 *    落到草稿时镜像进 `cost.maxPositions`（= `executionAssumptions.backtestConfig.maxPositions`）。
 *    依据：FE-PLAN-003 §5.4「来源收敛」，两处零冲突。
 * 3. 🔴 **不做语义推断**：数值一律 `String()` 写进文本字段；是否成立由既有的
 *    `validateDefinitionDrafts` / 服务端校验器判。
 */
import type { DefinitionDrafts, PositionDraft } from "./definitionDraft";

/** 补丁值：与 `StrategyPresetParameterValue` 同形（number / boolean / string）。 */
export type DefinitionFieldPatchValue = number | boolean | string;

/** `{ 段名: { 字段名: 值 } }`，段名 = `DefinitionDrafts` 的键。 */
export type DefinitionFieldPatch = Readonly<
  Record<string, Readonly<Record<string, DefinitionFieldPatchValue>>>
>;

/** 文本字段一律走这里：数值 `0.2` → `"0.2"`（不做四舍五入，不添单位）。 */
function text(value: DefinitionFieldPatchValue): string {
  return typeof value === "string" ? value : String(value);
}

function hasKeys(record: Readonly<Record<string, unknown>> | undefined): boolean {
  return record !== undefined && Object.keys(record).length > 0;
}

/** `position` 段允许被补丁覆盖的文本键（与 `PositionDraft` 对齐）。 */
const POSITION_PATCH_KEYS = [
  "sizingMethod",
  "maxPositions",
  "positionRatio",
  "fixedAmount",
] as const;

/** `execution` 段允许被补丁覆盖的文本键（与 `ExecutionDraft` 对齐）。 */
const EXECUTION_PATCH_KEYS = [
  "signalTiming",
  "executionTiming",
  "priceType",
  "quantityMethod",
  "lotSize",
] as const;

/** `cost` 段允许被补丁覆盖的文本键（与 `CostDraft` 对齐）。 */
const COST_PATCH_KEYS = [
  "initialCapital",
  "commissionRate",
  "stampDutyRate",
  "transferFeeRate",
  "slippageBps",
  "lotSize",
  "minCommission",
] as const;

/**
 * 把补丁填进草稿。**纯函数**：不改入参，返回新草稿。
 *
 * 未知段名 / 未知键一律**忽略**（不猜、不报错）：预设是我们自己发的；
 * 真正需要拦的语义问题走既有校验器，而不是在这里静默扩面。
 */
export function applyDefinitionFieldPatch(
  drafts: DefinitionDrafts,
  patch: DefinitionFieldPatch,
): DefinitionDrafts {
  const next: DefinitionDrafts = { ...drafts };

  // ---- ③ 仓位 ----
  const positionPatch = patch.position;
  if (hasKeys(positionPatch)) {
    const position: PositionDraft = { ...drafts.position };
    for (const key of POSITION_PATCH_KEYS) {
      const value = positionPatch[key];
      if (value !== undefined) position[key] = text(value);
    }
    next.position = position;
    /**
     * 🔴 双写：预设只声明一次 `maxPositions`，这里镜像到文档级回测配置。
     *    只在**补丁确实声明了**它时才镜像 —— 免得调一次别的参数把用户手填的值冲掉。
     */
    if (positionPatch.maxPositions !== undefined) {
      next.cost = { ...drafts.cost, maxPositions: position.maxPositions };
    }
  }

  // ---- ④ 成本与成交 ----
  const costPatch = patch.cost;
  if (hasKeys(costPatch)) {
    const cost = { ...(next.cost ?? drafts.cost) };
    for (const key of COST_PATCH_KEYS) {
      const value = costPatch[key];
      if (value !== undefined) cost[key] = text(value);
    }
    next.cost = cost;
  }

  const executionPatch = patch.execution;
  if (hasKeys(executionPatch)) {
    const execution = { ...drafts.execution };
    for (const key of EXECUTION_PATCH_KEYS) {
      const value = executionPatch[key];
      if (value !== undefined) execution[key] = text(value);
    }
    next.execution = execution;
  }

  return next;
}

/**
 * 这张补丁"碰过"哪些草稿字段 —— 信任层用它把"选了哪个方案"翻译成人话。
 * 返回形如 `position.sizingMethod` 的点号路径（稳定顺序，供断言）。
 */
export function describeDefinitionFieldPatch(patch: DefinitionFieldPatch): string[] {
  const out: string[] = [];
  for (const segment of ["position", "cost", "execution"] as const) {
    const values = patch[segment];
    if (!hasKeys(values)) continue;
    for (const key of Object.keys(values).sort()) out.push(`${segment}.${key}`);
  }
  return out;
}
