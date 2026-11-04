/**
 * OOS-001 §8 — 策略定义指纹（**唯一落点**；创建时冻结 · 执行时复核）。
 *
 * ## 为什么需要它
 *
 * 规格 §8 要求：OOS 必须使用 **Search Run 对应的冻结 StrategyVersion**，
 * 不得自动使用 `latest strategy version`，并记录 `strategyVersionId` 与
 * `strategyVersionFingerprint / definition fingerprint`（如果现有系统已有）。
 *
 * 现有系统**已有**：`server/strategyCore/fingerprint.ts#computeDefinitionFingerprint`
 * 对 `StrategyCoreDefinition` 求 sha256（`FINGERPRINT_SCOPES` 划定了参与指纹的面）。
 *
 * ⇒ 本文件把它包成「文档 → 指纹」这一步，供**创建**与**执行**两处调用**同一实现**
 *   （两处各写一遍必然漂移；漂移的后果是「明明换了定义却复核通过」）。
 *
 * 🔴 「不可变」不能只是承诺：`strategy_versions` 的不可变性由
 *   `updateVersionDefinition()` 恒抛 `VERSION_IMMUTABLE` 保证，但那是**同进程内**的保证。
 *   跨进程 / 被外部脚本改写时，只有**指纹复核**才看得出来 ⇒ 本层把它做成可检测的事实
 *   （`OOS_STRATEGY_DEFINITION_DRIFT`）。
 *
 * ⚠️ 本函数**只读**文档，不触 DB、不落库、不修改任何东西。
 */

import { computeDefinitionFingerprint } from "../../strategyCore/fingerprint";
import { coreVersionFromDocument } from "../../strategyCore/production/versionFromDocument";
import type { StrategyDocument } from "../strategySchema/types";

/** 指纹解析结果（`fingerprint === null` 时 `note` 必须说明原因 —— 不静默）。 */
export interface DefinitionFingerprintResult {
  readonly fingerprint: string | null;
  readonly note: string;
}

/**
 * 从策略文档解析定义指纹。
 *
 * 与 PARAMETER-002 的 `referencedParameterCodesOf` 同一姿态：**Core 定义不可构造时
 * 返回 `null` 并如实说明**，绝不编一个指纹出来（假的指纹比没有指纹危险得多 ——
 * 它会让复核**恒通过**）。
 */
export function definitionFingerprintOfDocument(
  document: StrategyDocument,
): DefinitionFingerprintResult {
  const core = coreVersionFromDocument({ document, createdAt: new Date().toISOString() });
  if (!core.ok) {
    return {
      fingerprint: null,
      note:
        `未冻结策略定义指纹：Core 定义不可构造（${core.reason}）⇒ 本次 OOS 无法把`
        + "「策略版本未被改写」做成可检测的事实，执行时也不会做指纹复核。",
    };
  }
  return {
    fingerprint: computeDefinitionFingerprint(core.version.definition),
    note:
      `策略定义指纹已冻结（strategyCore/fingerprint#computeDefinitionFingerprint）：${computeDefinitionFingerprint(core.version.definition)}。`,
  };
}

/**
 * 执行时复核指纹。
 *
 * `frozen === null` ⇒ 创建时就没冻结（如实跳过复核并返回说明，**不假装复核过**）。
 * `current === null` ⇒ 当前文档构造不出 Core 定义 ⇒ 无法复核 ⇒ 如实说明（不静默通过）。
 */
export function verifyDefinitionFingerprint(input: {
  readonly frozen: string | null;
  readonly current: string | null;
}): { readonly ok: boolean; readonly note: string } {
  if (input.frozen === null) {
    return {
      ok: true,
      note: "创建时未冻结策略定义指纹 ⇒ 本次执行**不做**指纹复核（如实登记，不假装复核过）。",
    };
  }
  if (input.current === null) {
    return {
      ok: true,
      note:
        `已冻结指纹 ${input.frozen}，但当前文档构造不出 Core 定义 ⇒ 无法复核 ⇒ `
        + "本次执行按「未复核」处理（如实登记）。",
    };
  }
  if (input.frozen !== input.current) {
    return {
      ok: false,
      note:
        `策略定义指纹漂移：冻结 ${input.frozen}，当前 ${input.current}`
        + "（规格 §16 T1：OOS 必须使用 Search Snapshot 对应的那份策略版本）。",
    };
  }
  return { ok: true, note: `策略定义指纹复核通过（${input.frozen}）。` };
}
