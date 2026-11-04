/**
 * STRATEGY-ARCH-001 — StrategyVersion 不可变语义（规格 §4 / §23.7）。
 *
 * ```
 * Strategy          策略身份（strategyId + 名称/描述）
 * StrategyVersion   不可变版本（strategyId + version + Definition + fingerprint + metadata）
 * ```
 *
 * 🔴 三条硬约束（都能被测试直接验证）：
 *   1. `StrategyVersion` **创建后深冻结** —— 进程内也无法原地改；
 *   2. **不存在修改已发布版本的 API** —— `updateVersionDefinition()` 永远抛
 *      `VERSION_IMMUTABLE`（它的存在就是为了让「没有这条路径」这件事可断言）；
 *   3. 改内容只能走 `applyDefinitionChange()` ⇒ 产出**新版本**（semver bump），
 *      指纹相同则返回 `unchanged`（幂等，不产生空版本）。
 *
 * semver 解析 / 比较 / bump **复用**既有唯一实现
 * （`server/research/strategySchema/version.ts`），不另写一套。
 *
 * 纯模块：无 IO / 无 Date.now（时间一律由调用方注入）/ 无 Math.random。
 */

import {
  STRATEGY_VERSION_STATUSES,
  StrategyCoreError,
  type StrategyVersionStatus,
} from "./types";
import { bumpStrategyVersion, parseStrategyVersion } from "../research/strategySchema/version";
import type { StrategyCoreDefinition } from "./definition";
import { computeDefinitionFingerprint, definitionsBehaviorallyEqual } from "./fingerprint";

// ---------------------------------------------------------------------------
// 身份与版本
// ---------------------------------------------------------------------------

/** 策略身份（长期存在；一个身份可拥有多个版本）。 */
export interface StrategyIdentity {
  readonly strategyId: string;
  readonly name: string;
  readonly description?: string;
}

/** 版本元数据（**不进指纹**：改名字不产生新行为）。 */
export interface StrategyVersionMetadata {
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
  readonly notes?: string;
}

/** 不可变策略版本。 */
export interface StrategyVersion {
  readonly strategyId: string;
  readonly version: string;
  readonly status: StrategyVersionStatus;
  readonly definition: StrategyCoreDefinition;
  /** 定义指纹（覆盖行为面；见 fingerprint.ts）。 */
  readonly fingerprint: string;
  readonly metadata: StrategyVersionMetadata;
  /** 父版本 id（`strategyId@version`）；首版为 null。 */
  readonly parentVersionId: string | null;
  /** 创建时间（ISO-8601；由调用方注入，**不由本模块取系统时间**）。 */
  readonly createdAt: string;
}

/** 版本 id（跨模块稳定引用）。 */
export function versionIdOf(version: Pick<StrategyVersion, "strategyId" | "version">): string {
  return version.strategyId + "@" + version.version;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// ---------------------------------------------------------------------------
// 构造
// ---------------------------------------------------------------------------

function freezeVersion(version: StrategyVersion): StrategyVersion {
  return Object.freeze(version);
}

function normalizeMetadata(metadata: StrategyVersionMetadata): StrategyVersionMetadata {
  return {
    name: metadata.name,
    ...(metadata.description === undefined ? {} : { description: metadata.description }),
    ...(metadata.author === undefined ? {} : { author: metadata.author }),
    ...(metadata.tags === undefined ? {} : { tags: [...metadata.tags].sort() }),
    ...(metadata.notes === undefined ? {} : { notes: metadata.notes }),
  };
}

export interface CreateStrategyVersionInput {
  readonly strategyId: string;
  readonly version: string;
  readonly definition: StrategyCoreDefinition;
  readonly metadata: StrategyVersionMetadata;
  readonly createdAt: string;
  readonly parentVersionId?: string | null;
  readonly status?: StrategyVersionStatus;
}

/**
 * 创建版本（唯一入口）。
 *
 * 校验：strategyId 非空 / version 严格 semver / createdAt 为 ISO-8601 / status 属闭集。
 * 指纹**由本函数计算**（不接受调用方传入 —— 指纹与定义不一致是无法复现的根源）。
 */
export function createStrategyVersion(input: CreateStrategyVersionInput): StrategyVersion {
  if (input.strategyId.trim() === "") {
    throw new StrategyCoreError("VERSION_NOT_FOUND", "strategyId 不能为空");
  }
  if (!SEMVER_RE.test(input.version)) {
    throw new StrategyCoreError(
      "CORE_DEFINITION_INVALID",
      "版本号必须是严格 major.minor.patch，实际 " + input.version,
    );
  }
  if (typeof input.createdAt !== "string" || input.createdAt.trim() === "") {
    throw new StrategyCoreError("CORE_DEFINITION_INVALID", "createdAt 必须由调用方显式注入（ISO-8601）");
  }
  const status = input.status ?? "DRAFT";
  if (!(STRATEGY_VERSION_STATUSES as readonly string[]).includes(status)) {
    throw new StrategyCoreError("VERSION_NOT_FOUND", "未知版本状态 " + String(status));
  }
  if (input.metadata.name.trim() === "") {
    throw new StrategyCoreError("CORE_DEFINITION_INVALID", "版本 name 不能为空");
  }
  return freezeVersion({
    strategyId: input.strategyId,
    version: input.version,
    status,
    definition: input.definition,
    fingerprint: computeDefinitionFingerprint(input.definition),
    metadata: normalizeMetadata(input.metadata),
    parentVersionId: input.parentVersionId ?? null,
    createdAt: input.createdAt,
  });
}

// ---------------------------------------------------------------------------
// 状态迁移（状态可变；内容**永不可变**）
// ---------------------------------------------------------------------------

function transitionStatus(version: StrategyVersion, next: StrategyVersionStatus): StrategyVersion {
  if (version.status === next) return version;
  if (version.status === "DEPRECATED") {
    throw new StrategyCoreError("VERSION_IMMUTABLE", "已退役（DEPRECATED）的版本不可复活：" + versionIdOf(version), {
      version: versionIdOf(version),
    });
  }
  if (next === "DRAFT" && version.status === "PUBLISHED") {
    throw new StrategyCoreError(
      "VERSION_IMMUTABLE",
      "已发布（PUBLISHED）的版本不可退回草稿：" + versionIdOf(version) + "（需要改内容请新建版本）",
      { version: versionIdOf(version) },
    );
  }
  return freezeVersion({ ...version, status: next });
}

/** 发布（DRAFT → PUBLISHED）。 */
export function publishStrategyVersion(version: StrategyVersion): StrategyVersion {
  return transitionStatus(version, "PUBLISHED");
}

/** 退役（任意非退役 → DEPRECATED，终态）。 */
export function deprecateStrategyVersion(version: StrategyVersion): StrategyVersion {
  return transitionStatus(version, "DEPRECATED");
}

// ---------------------------------------------------------------------------
// 不可变性的可断言表达
// ---------------------------------------------------------------------------

/**
 * 🔴 **永远抛错**：本 Core **不提供**修改已存在版本内容的路径（规格 §4 / §23.7）。
 *
 * 它存在本身就是判据：测试可以直接断言「调用它必抛 `VERSION_IMMUTABLE`」，
 * 从而把「没有第二条改内容的路径」变成一条**可执行的**约束，而不是一句注释。
 */
export function updateVersionDefinition(
  version: StrategyVersion,
  _nextDefinition: StrategyCoreDefinition,
): never {
  throw new StrategyCoreError(
    "VERSION_IMMUTABLE",
    "Strategy Core 不提供「修改已存在版本」的入口：" +
      versionIdOf(version) +
      "。改内容请用 applyDefinitionChange() 生成新版本（不可变版本是复现性的前提）。",
    { version: versionIdOf(version), fingerprint: version.fingerprint },
  );
}

/** 断言对象确实被冻结（供测试与运行期自检）。 */
export function assertVersionFrozen(version: StrategyVersion): void {
  if (!Object.isFrozen(version) || !Object.isFrozen(version.definition)) {
    throw new StrategyCoreError("VERSION_IMMUTABLE", "版本对象未被冻结：" + versionIdOf(version));
  }
}

// ---------------------------------------------------------------------------
// 变更 → 新版本
// ---------------------------------------------------------------------------

export type VersionBumpKind = "patch" | "minor" | "major";

export interface ApplyDefinitionChangeInput {
  readonly nextDefinition: StrategyCoreDefinition;
  readonly bump: VersionBumpKind;
  readonly createdAt: string;
  readonly metadata?: StrategyVersionMetadata;
  readonly notes?: string;
}

export type ApplyDefinitionChangeResult =
  | { readonly kind: "unchanged"; readonly version: StrategyVersion; readonly reason: string }
  | { readonly kind: "new-version"; readonly version: StrategyVersion; readonly from: string; readonly to: string };

/**
 * 应用定义变更：**产出新版本**（绝不原地改）。
 *
 * 判据（规格 §23.7 / §23.8）：
 *   - 新定义指纹与当前相同 ⇒ `kind: "unchanged"`（幂等，不产生空版本）；
 *   - 指纹不同 ⇒ 新版本 = `bumpStrategyVersion(current.version, bump)`，
 *     `parentVersionId` 指向当前版本，status 回到 `DRAFT`（新版本必须重新发布）。
 */
export function applyDefinitionChange(
  current: StrategyVersion,
  input: ApplyDefinitionChangeInput,
): ApplyDefinitionChangeResult {
  if (definitionsBehaviorallyEqual(current.definition, input.nextDefinition)) {
    return {
      kind: "unchanged",
      version: current,
      reason: "新定义与当前版本指纹相同（行为等价）⇒ 不产生新版本",
    };
  }
  const nextVersionNumber = bumpStrategyVersion(current.version, input.bump);
  const next = createStrategyVersion({
    strategyId: current.strategyId,
    version: nextVersionNumber,
    definition: input.nextDefinition,
    metadata:
      input.metadata ??
      ({
        name: current.metadata.name,
        ...(current.metadata.description === undefined ? {} : { description: current.metadata.description }),
        ...(current.metadata.author === undefined ? {} : { author: current.metadata.author }),
        ...(current.metadata.tags === undefined ? {} : { tags: current.metadata.tags }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      } as StrategyVersionMetadata),
    createdAt: input.createdAt,
    parentVersionId: versionIdOf(current),
    status: "DRAFT",
  });
  return { kind: "new-version", version: next, from: current.version, to: nextVersionNumber };
}

/** 版本号合法性（供调用方前置校验，避免构造后才发现）。 */
export function assertVersionNumber(version: string): void {
  parseStrategyVersion(version);
}
