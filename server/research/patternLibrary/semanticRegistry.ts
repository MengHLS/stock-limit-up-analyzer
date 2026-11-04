/**
 * PHASE-B-001 — Pattern 受控语义的**注册表**（唯一 SoT + 不可变）。
 *
 * ## 为什么需要一层注册表
 *
 * 语义声明的消费者有两侧（研究投影 / 策略投影）。如果两侧各自去读 `patterns/*.ts` 并各自
 * 展开，就形成了**双写 Semantic SoT** —— 正是 B.5 明禁的东西。本模块让「收集 → 校验 →
 * 展开 → 冻结」只发生一次，两侧只读同一份产物。
 *
 * ## 三条硬保证
 *
 * 1. **唯一性**：`patternId + version` 唯一（重复注册即响亮拒绝）；`semanticId` 全局唯一
 *    （否则变量名冲突、两侧无法一一对应）。
 * 2. **不可变**：产物深冻结；运行期 mutate 会抛 `TypeError`（严格模式）。禁止
 *    「同一 Pattern → 不同语义」。
 * 3. **响亮拒绝**：任何声明问题在**注册期**就抛 `PatternSemanticsError`，绝不留到执行期
 *    —— 到那时「声明的可用性」已经被用来放过条件了。
 */

import { createHash } from "node:crypto";
import {
  expandPatternSemantics,
  type ExpandedSemantic,
  type PatternSemanticDeclaration,
  type SemanticIssue,
} from "../../../shared/patternSemantics";
import { ALL_TRADING_PATTERNS } from "./patterns";
import type { TradingPatternSpec } from "./types";

/** 已注册的 Pattern 语义（冻结产物）。 */
export interface PatternSemanticEntry {
  readonly patternId: string;
  readonly version: string;
  readonly declarations: readonly PatternSemanticDeclaration[];
  /** 展开结果 —— **两侧投影的唯一输入**。 */
  readonly expanded: readonly ExpandedSemantic[];
  /** 声明内容的 sha256（可对照、可追溯；version 之外的机械密码）。 */
  readonly fingerprint: string;
}

export class PatternSemanticsError extends Error {
  constructor(
    readonly code:
      | "SEMANTIC_REDEFINITION"
      | "SEMANTIC_ID_COLLISION"
      | "INVALID_SEMANTIC_DECLARATION"
      | "MISSING_SEMANTICS_VERSION",
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "PatternSemanticsError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/** 稳定序列化（键序固定）—— 保证 fingerprint 与声明书写顺序无关、只与内容有关。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * 从 Pattern 清单构建语义条目（纯函数；注册期一次算完）。
 *
 * 抛错即「响亮拒绝」：声明有问题就不该有任何一份可用的语义注册表。
 */
export function buildPatternSemanticEntries(
  patterns: readonly TradingPatternSpec[],
): PatternSemanticEntry[] {
  const entries: PatternSemanticEntry[] = [];
  const byKey = new Map<string, PatternSemanticEntry>();
  const bySemanticId = new Map<string, string>();
  const issues: SemanticIssue[] = [];

  for (const pattern of patterns) {
    const section = pattern.semantics;
    if (section === null || section === undefined) continue;
    if (typeof section.version !== "string" || section.version.trim() === "") {
      throw new PatternSemanticsError(
        "MISSING_SEMANTICS_VERSION",
        `Pattern "${pattern.patternId}" 声明了 semantics 却没有 version —— `
          + "version 与 patternId 组成唯一键，缺了它「同一 Pattern 是否被改过语义」无法判定",
        { patternId: pattern.patternId },
      );
    }
    const key = `${pattern.patternId}@${section.version}`;
    if (byKey.has(key)) {
      throw new PatternSemanticsError(
        "SEMANTIC_REDEFINITION",
        `Pattern "${key}" 的语义被重复注册 —— 同一 patternId + version 的语义必须唯一且稳定`,
        { key },
      );
    }

    const { expanded, issues: localIssues } = expandPatternSemantics(section.declarations);
    if (localIssues.length > 0) {
      issues.push(...localIssues);
      continue;
    }

    for (const item of expanded) {
      const owner = bySemanticId.get(item.semanticId);
      if (owner !== undefined && owner !== key) {
        throw new PatternSemanticsError(
          "SEMANTIC_ID_COLLISION",
          `semanticId "${item.semanticId}" 被两个 Pattern 声明（${owner} 与 ${key}）—— `
            + "变量名会冲突，两侧投影无法一一对应",
          { semanticId: item.semanticId, owners: [owner, key] },
        );
      }
      bySemanticId.set(item.semanticId, key);
    }

    const entry: PatternSemanticEntry = {
      patternId: pattern.patternId,
      version: section.version,
      declarations: section.declarations,
      expanded,
      fingerprint: createHash("sha256").update(canonical(section.declarations), "utf8").digest("hex"),
    };
    const frozen = deepFreeze(entry);
    byKey.set(key, frozen);
    entries.push(frozen);
  }

  if (issues.length > 0) {
    throw new PatternSemanticsError(
      "INVALID_SEMANTIC_DECLARATION",
      `语义声明不合法（${issues.length} 项）：\n`
        + issues.map((i) => `  - [${i.code}] ${i.message}`).join("\n"),
      { issues },
    );
  }

  return entries.sort((a, b) => (a.patternId < b.patternId ? -1 : a.patternId > b.patternId ? 1 : 0));
}

let cache: readonly PatternSemanticEntry[] | null = null;

/** 全部已注册语义（进程内缓存；**冻结只读**）。 */
export function listPatternSemantics(): readonly PatternSemanticEntry[] {
  if (cache === null) {
    cache = deepFreeze(buildPatternSemanticEntries(ALL_TRADING_PATTERNS));
  }
  return cache;
}

/** 按 `patternId`（可再限定 `version`）取语义条目。 */
export function findPatternSemantics(
  patternId: string,
  version?: string,
): PatternSemanticEntry | undefined {
  return listPatternSemantics().find(
    (e) => e.patternId === patternId && (version === undefined || e.version === version),
  );
}

/** 全部展开结果（两侧投影的共同输入；顺序稳定）。 */
export function listExpandedPatternSemantics(): readonly ExpandedSemantic[] {
  return listPatternSemantics().flatMap((e) => e.expanded);
}

/** 变量名 → 声明的可用性偏移（研究侧护栏用；找不到 ⇒ null）。 */
export function semanticAvailableFromOffset(name: string): number | null {
  const hit = listExpandedPatternSemantics().find((e) => e.name === name);
  return hit === undefined ? null : hit.availableFromOffset;
}

/** 仅供测试：清空进程内缓存。 */
export function resetPatternSemanticsCache(): void {
  cache = null;
}
