/**
 * COMPOSITE_FACTOR_EXPERIMENT_V1 —— **成员解析器**（Member Resolver）。
 *
 * ## 职责
 *
 * 把「成员声明」（`{ code, direction }`）解析成可计算的成员（`CompositeMember`）：
 * 取值函数、桶位分函数、契约指纹全部**从既有唯一真源适配**，本文件**不新增因子定义**。
 *
 * 两个上游（都是 import，不是复制）：
 *
 * | 需要的东西 | 唯一真源 |
 * | --- | --- |
 * | 因子目录项（label / source / orientation / priorVerified / buckets / `valueOf`） | `shared/singleFactor/factorResolver.ts`（它自己又适配 `FROZEN-BUCKET-CONTRACT-001`） |
 * | 桶位分 `(idx+0.5)/k` 与 `bucketOf` | `twelve-factor-composite-study/result.ts`（FROZEN-BUCKET-CONTRACT-001 的唯一落地处） |
 *
 * ## 方向的两处硬校验
 *
 * 1. `assertMemberDirections()`：成员的 `direction` 必须与冻结契约的 `orientation` 一致
 *    （`+1 ⇔ HIGH`、`-1 ⇔ LOW`）。不一致 = 有人手改方向 ⇒ 响亮失败，
 *    因为「按单因子实验确定的方向」正是本阶段的方向来源。
 * 2. `assertMembersUsable()`：成员 code 不重复；`BUCKET_POSITIONAL` 下每个成员都必须有桶词表。
 *    后者把「拿着没有冻结桶的新因子去跑桶位分标准化」从**静默算错**变成**启动即失败**。
 */

import {
  BUCKET_CONTRACT_ID,
  TWELVE_FACTOR_DEFINITIONS,
  bucketPositionalScoreOf,
  type FactorDefinition,
  type TwelveFactorCode,
} from "../../first-board-pullback/twelve-factor-composite-study/result";
import {
  SINGLE_FACTOR_CATALOG,
  factorContractFingerprintOf,
} from "../singleFactor/factorResolver";
import {
  FACTOR_DIRECTIONS,
  type CompositeMember,
  type CompositeMemberSpec,
  type FactorDirection,
  type NormalizationMethod,
} from "./types";

/** 冻结 12 因子定义的按 code 索引（只读；仅为取出 `bucketOf` 所需的 code 字面量）。 */
const FROZEN_DEFINITION_BY_CODE: ReadonlyMap<string, FactorDefinition> = new Map(
  TWELVE_FACTOR_DEFINITIONS.map(
    (definition): [string, FactorDefinition] => [definition.code, definition]
  )
);

/** 取冻结定义；不在 12 因子内即失败（用于把 `string` 安全收窄成 `TwelveFactorCode`）。 */
export function requireFrozenFactorDefinition(code: string): FactorDefinition {
  const definition = FROZEN_DEFINITION_BY_CODE.get(code);
  if (!definition) {
    throw new Error(
      `因子 ${code} 不在 FROZEN-BUCKET-CONTRACT-001 的 12 因子内；` +
        `可用：${[...FROZEN_DEFINITION_BY_CODE.keys()].join(", ")}`
    );
  }
  return definition;
}

function directionOfOrientation(orientation: 1 | -1): FactorDirection {
  return orientation === 1 ? "HIGH" : "LOW";
}

/**
 * 12 个冻结因子的成员目录（**适配器**，不是复制品）。
 *
 * `direction` 一律由契约 `orientation` 推出 ⇒ 「方向来源」这件事在代码里只有一条路径，
 * 不存在「同一边界两处方向」的可能。
 */
export const FROZEN_TWELVE_FACTOR_MEMBERS: readonly CompositeMember[] =
  SINGLE_FACTOR_CATALOG.map((entry): CompositeMember => {
    const definition = requireFrozenFactorDefinition(entry.code);
    return {
      code: entry.code,
      label: entry.label,
      source: entry.source,
      direction: directionOfOrientation(entry.orientation),
      orientation: entry.orientation,
      priorVerified: entry.priorVerified,
      buckets: entry.buckets,
      contractFingerprint: factorContractFingerprintOf(entry),
      valueOf: entry.valueOf,
      bucketScoreOf: value => bucketPositionalScoreOf(definition.code, value),
    };
  });

/** 模板默认可用的成员目录。 */
export const COMPOSITE_MEMBER_CATALOG: readonly CompositeMember[] =
  FROZEN_TWELVE_FACTOR_MEMBERS;

const CATALOG_BY_CODE: ReadonlyMap<string, CompositeMember> = new Map(
  COMPOSITE_MEMBER_CATALOG.map(
    (member): [string, CompositeMember] => [member.code, member]
  )
);

export const COMPOSITE_MEMBER_CATALOG_CODES: readonly string[] = [
  ...CATALOG_BY_CODE.keys(),
];

/** 解析一个成员声明；未登记即响亮失败。 */
export function resolveCompositeMember(spec: CompositeMemberSpec): CompositeMember {
  const member = CATALOG_BY_CODE.get(spec.code);
  if (!member) {
    throw new Error(
      `未登记的成员 code：${spec.code}。可用成员：${COMPOSITE_MEMBER_CATALOG_CODES.join(", ")}`
    );
  }
  return member;
}

/**
 * 方向一致性校验（硬）。
 *
 * 🔴 允许的两种写法只有一种结果：`direction` 必须等于由 `orientation` 推出的方向。
 *    想换方向就必须换因子（或新开契约），**不允许**在组合里把方向掰过来 ——
 *    那会让「按单因子实验确定的方向」这句话失效，且失败是静默的（只是分数反了）。
 */
export function assertMemberDirections(members: readonly CompositeMember[]): void {
  const problems: string[] = [];
  for (const member of members) {
    const expected = directionOfOrientation(member.orientation);
    if (member.direction !== expected) {
      problems.push(
        `${member.code}: direction=${member.direction} 与契约 orientation=${member.orientation}` +
          `（应为 ${expected}）不一致`
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `COMPOSITE_FACTOR 成员方向与冻结契约不一致（方向不允许在组合里重估）：\n- ${problems.join("\n- ")}`
    );
  }
}

/** 成员集合可用性校验（硬）：不重复；`BUCKET_POSITIONAL` 下必须有桶词表。 */
export function assertMembersUsable(
  members: readonly CompositeMember[],
  normalization: NormalizationMethod
): void {
  if (members.length === 0) {
    throw new Error("COMPOSITE_FACTOR 至少需要一个成员（空组合没有可排序的键）");
  }
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const member of members) {
    if (seen.has(member.code)) problems.push(`成员重复：${member.code}`);
    seen.add(member.code);
    if (!FACTOR_DIRECTIONS.includes(member.direction)) {
      problems.push(`${member.code}: 非法方向 ${String(member.direction)}`);
    }
    if (normalization === "BUCKET_POSITIONAL" && member.bucketScoreOf === null) {
      problems.push(
        `${member.code}: 标准化方法 BUCKET_POSITIONAL 需要冻结桶词表，但该成员没有`
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`COMPOSITE_FACTOR 成员集合不可用：\n- ${problems.join("\n- ")}`);
  }
}

/**
 * 成员集合的**桶词表 + 方向**指纹（FNV-1a 32 位）。
 *
 * 覆盖 `code | orientation | priorVerified | buckets`（按 code 排序 ⇒ 与成员书写顺序无关）。
 * 作用与 12F 的 `bucketFingerprintOf()` 相同：事后可证明「本次 Run 读到的桶边界与方向和契约一致」。
 * 它与单因子引擎的 `factorContractFingerprintOf` 覆盖同样的字段、只是范围从「一个因子」扩到「一组成员」。
 */
export function compositionBucketFingerprint(
  members: readonly CompositeMember[]
): string {
  const canonical = [...members]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map(
      member =>
        `${member.code}|${member.orientation}|${member.priorVerified ? 1 : 0}|` +
        `${member.buckets.join(",")}`
    )
    .join(";");
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/** 把 code 收窄成 `TwelveFactorCode`（供需要该类型的下游使用）。 */
export function frozenCodeOf(code: string): TwelveFactorCode {
  return requireFrozenFactorDefinition(code).code;
}

export { BUCKET_CONTRACT_ID };
