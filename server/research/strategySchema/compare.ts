/**
 * STEP 15 / C-15.1 — Strategy Schema + Versioning：结构化比较（纯函数、确定性）。
 *
 * §16 要求策略必须可「比较」，§17 要求版本化语义可判定。本模块提供：
 *   - compareStrategyDocuments：递归字段级 diff（added / removed / changed + 路径定位），
 *     供「两个策略是否等价 / 差异在哪」的结构化比较；
 *   - strategiesDeepEqual：基于 diff 的等价判定（供「比较」能力直接使用）；
 *   - classifyRequiredBumpKind：由 base → next 的内容差异判定所需的版本 bump 级别——
 *     rules / universe / datasetVersion / executionAssumptions / recipe / 参数 schema 本体变化
 *     → major；仅文本 / 参数 defaultValue 变化 → minor；完全一致 → none。
 *
 * 铁律：比较忽略 fingerprint（派生字段）与 version（由 bump 显式决定，不属于内容变化），
 * 其余字段逐一递归比较。禁止 NaN / Infinity（由上游构造保证）。
 */

import type { StrategyDocument } from "./types";
import type { StrategyVersionBump } from "./types";

/** 单条差异。 */
export interface StrategyDifference {
  /** 点分 / 下标定位路径（如 "entryRules[0].operator"）。 */
  readonly path: string;
  readonly kind: "changed" | "added" | "removed";
  /** kind=added / changed 时的新值。 */
  readonly right?: unknown;
  /** kind=removed / changed 时的旧值。 */
  readonly left?: unknown;
}

/** 结构化比较结果。 */
export interface StrategyComparisonResult {
  readonly equal: boolean;
  /** 差异清单（equal 时为空数组）。 */
  readonly differences: readonly StrategyDifference[];
}

/** 内容变化级别（clone 时用于 bump 语义闸门）。 */
export type StrategyContentChangeKind = "none" | "minor" | "major";

/** 参与内容 diff 时忽略的顶层字段（version 由 bump 显式决定；fingerprint 为派生摘要）。 */
const IGNORED_TOP_LEVEL_KEYS = new Set(["version", "fingerprint"]);

function isIgnoredKey(key: string, isTopLevel: boolean): boolean {
  return isTopLevel && IGNORED_TOP_LEVEL_KEYS.has(key);
}

function diffValue(left: unknown, right: unknown, path: string, topLevel: boolean, out: StrategyDifference[]): void {
  if (left === right) return;
  if (left === undefined) {
    out.push({ path, kind: "added", right });
    return;
  }
  if (right === undefined) {
    out.push({ path, kind: "removed", left });
    return;
  }
  const leftIsObject = left !== null && typeof left === "object";
  const rightIsObject = right !== null && typeof right === "object";
  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);
  if (leftIsArray !== rightIsArray || leftIsObject !== rightIsObject) {
    out.push({ path, kind: "changed", left, right });
    return;
  }
  if (!leftIsObject) {
    out.push({ path, kind: "changed", left, right });
    return;
  }
  if (leftIsArray) {
    const leftArr = left as unknown[];
    const rightArr = right as unknown[];
    const length = Math.max(leftArr.length, rightArr.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}[${index}]`;
      if (index >= leftArr.length) {
        out.push({ path: childPath, kind: "added", right: rightArr[index] });
      } else if (index >= rightArr.length) {
        out.push({ path: childPath, kind: "removed", left: leftArr[index] });
      } else {
        diffValue(leftArr[index], rightArr[index], childPath, false, out);
      }
    }
    return;
  }
  const leftObj = left as Record<string, unknown>;
  const rightObj = right as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(leftObj), ...Object.keys(rightObj)])).sort();
  for (const key of keys) {
    if (isIgnoredKey(key, topLevel)) continue;
    const childPath = path === "" ? key : `${path}.${key}`;
    diffValue(leftObj[key], rightObj[key], childPath, false, out);
  }
}

/**
 * 递归比较两个策略本体（忽略 version / fingerprint），返回字段级差异。
 * 可选字段缺省（undefined）与「不存在」等价；数组按位置比较，成员顺序差异会体现为差异。
 */
export function compareStrategyDocuments(left: StrategyDocument, right: StrategyDocument): StrategyComparisonResult {
  const differences: StrategyDifference[] = [];
  diffValue(left, right, "", true, differences);
  return { equal: differences.length === 0, differences };
}

/** 基于结构化比较的等价判定（供 §16「比较」能力；同策略不同版本 → 不等）。 */
export function strategiesDeepEqual(left: StrategyDocument, right: StrategyDocument): boolean {
  return compareStrategyDocuments(left, right).equal;
}

/** 变化级别的路径判定：结构字段（rules/universe/dataset/execution/recipe）与参数 schema 本体 → major。 */
function isMajorChangePath(path: string): boolean {
  const topLevelStructural = [
    "universe",
    "entryRules",
    "exitRules",
    "riskRules",
    "positionSizing",
    "datasetVersion",
    "executionAssumptions",
    "recipe",
    "strategyId",
  ];
  if (topLevelStructural.some((name) => path === name || path.startsWith(`${name}.`) || path.startsWith(`${name}[`))) {
    return true;
  }
  // 参数 schema：defaultValue / 参数 description 文本变化 → minor；增删参数 / name/type/约束变化 → major。
  if (path === "parameters" || path.startsWith("parameters.")) {
    if (/^parameters\.parameters\[\d+\]\.(defaultValue|description)$/.test(path)) return false;
    return true;
  }
  // 其余顶层（name / description / metadata）为文本性变化 → minor。
  return false;
}

/**
 * 由内容差异分类所需的版本 bump 级别：
 *   - 结构变化（rules / universe / datasetVersion / executionAssumptions / recipe / 参数 schema 本体）
 *     → major（破坏性 / 结构变化必须 major，见 §17 与 C-15.1 验收）；
 *   - 仅文本 / 参数 defaultValue 变化 → minor（参数变化至少 minor）；
 *   - 无内容差异 → none。
 * 与 version / fingerprint 无关（这两个字段不参与内容比较）。
 */
export function classifyRequiredBumpKind(base: StrategyDocument, next: StrategyDocument): StrategyContentChangeKind {
  const { differences } = compareStrategyDocuments(base, next);
  if (differences.length === 0) return "none";
  const hasMajor = differences.some((diff) => isMajorChangePath(diff.path));
  return hasMajor ? "major" : "minor";
}

/** bump 级别是否满足内容变化要求（用于 clone 版本语义闸门；major 对 minor 变化合法）。 */
export function bumpCoversChange(bump: StrategyVersionBump, required: StrategyContentChangeKind): boolean {
  if (required === "none") return true;
  if (required === "major") return bump === "major";
  return bump === "minor" || bump === "major";
}
