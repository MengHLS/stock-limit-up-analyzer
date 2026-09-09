/**
 * STEP 15 / C-15.1 — Strategy Schema + Versioning：语义版本操作（纯函数、确定性）。
 *
 * §17 版本语义（与 ROADMAP 示例 V1.0 / V1.1 / V2.0 兼容的量化形态）：
 *   - 版本号采用严格 major.minor.patch（禁止前导零）；
 *   - 破坏性 / 结构变化（rules / universe / dataset version / execution assumptions /
 *     参数 schema 本体变化）→ major bump（V1.0 → V2.0）；
 *   - 参数变化（defaultValue 变化、文本性描述变化）→ 至少 minor bump（V1.0 → V1.1）；
 *   - 微小修正 / 纯文档拼写 → patch bump；
 *   - 版本不可变：任何变更必须产出新版本号，禁止原地覆写。
 *
 * 铁律：纯模块，无 DB / 无 Date.now / 无 IO；失败响亮。
 */

import {
  STRATEGY_VERSION_FORMAT_RE,
  type StrategyVersionBump,
} from "./types";

/** 结构化的策略版本。 */
export interface StrategyVersionTuple {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** 各 bump 级别的次序（patch=0 < minor=1 < major=2；用于「至少 minor」判定）。 */
const BUMP_RANK: Readonly<Record<StrategyVersionBump, number>> = {
  patch: 0,
  minor: 1,
  major: 2,
};

/** bump 是否达到要求（bump 级别 >= required 级别；major 对 minor 变化合法，反之非法）。 */
export function isBumpAtLeast(bump: StrategyVersionBump, required: StrategyVersionBump): boolean {
  return BUMP_RANK[bump] >= BUMP_RANK[required];
}

/** 解析版本号字符串 → 结构化三元组；非法格式响亮抛错。 */
export function parseStrategyVersion(version: string): StrategyVersionTuple {
  if (!STRATEGY_VERSION_FORMAT_RE.test(version)) {
    throw new Error(
      `策略版本号非法（${version}）：必须是 major.minor.patch 三段非负整数且禁止前导零（如 1.0.0）`,
    );
  }
  const [major, minor, patch] = version.split(".");
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/** 结构化三元组 → 规范字符串。 */
export function formatStrategyVersion(tuple: StrategyVersionTuple): string {
  return `${tuple.major}.${tuple.minor}.${tuple.patch}`;
}

/** 比较两个版本号：返回负数/零/正数（a < b → 负数，a === b → 0，a > b → 正数）。 */
export function compareStrategyVersions(left: string, right: string): number {
  const a = parseStrategyVersion(left);
  const b = parseStrategyVersion(right);
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * 按给定级别递增版本号，返回新版本字符串（纯函数，不修改入参）。
 *   bump("1.0.0","patch") → "1.0.1"；bump("1.0.0","minor") → "1.1.0"；
 *   bump("1.0.0","major") → "2.0.0"（minor/patch 清零）。
 */
export function bumpStrategyVersion(version: string, bump: StrategyVersionBump): string {
  const tuple = parseStrategyVersion(version);
  switch (bump) {
    case "patch":
      return formatStrategyVersion({ major: tuple.major, minor: tuple.minor, patch: tuple.patch + 1 });
    case "minor":
      return formatStrategyVersion({ major: tuple.major, minor: tuple.minor + 1, patch: 0 });
    case "major":
      return formatStrategyVersion({ major: tuple.major + 1, minor: 0, patch: 0 });
  }
}
