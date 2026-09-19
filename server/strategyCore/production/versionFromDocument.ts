/**
 * STRATEGY-ARCH-002 — 生产链路 → Core `StrategyVersion`（**唯一构造入口**）。
 *
 * 职责边界（一句话）：把**已经落库的那份策略文档**机械翻译成 Core 版本对象，
 * 并把翻译过程中**没能进 Core 的东西**如实登记出来。
 *
 * 🔴 三条纪律：
 *   ① **不做业务判断** —— 事件类型 / 阈值只从文档里**读**，不推断、不补默认；
 *   ② **不抛错掩盖缺文档** —— 文档没有 `definition` 段（存量 `limit-up-baseline` 两份就是
 *      这种）时返回 `{ok:false, reason}`，由调用方决定回落 legacy 并**如实标记**；
 *   ③ **Dataset 绑定分离** —— `definition.datasets` 由适配器单独返回，进 RunSnapshot，
 *      不进 Definition（Core 有守卫会拒）。
 *
 * 纯模块：无 IO / 无 Date.now（`createdAt` 由调用方注入）/ 无 Math.random。
 */

import type { StrategyDocument } from "../../research/strategySchema/types";
import type { StrategyDefinition as LegacyStrategyDefinition } from "../../research/strategySchema/definition";
import { fromLegacyStrategyDefinition, type LegacyAdaptationResult } from "../adapters/legacyDefinition";
import { createStrategyVersion, type StrategyVersion } from "../version";

export interface CoreVersionFromDocumentInput {
  readonly document: StrategyDocument;
  /** 注入式时间戳（ISO-8601）—— 「哪一版」由调用方决定，本模块不取系统时间。 */
  readonly createdAt: string;
  /** 版本元数据（缺省取文档的 name / description）。 */
  readonly author?: string;
}

export type CoreVersionFromDocumentResult =
  | {
      readonly ok: true;
      readonly version: StrategyVersion;
      readonly adaptation: LegacyAdaptationResult;
      /** 文档声明的事件类型（**仅读**；`null` = 文档没声明事件）。 */
      readonly eventType: string | null;
      /** 文档声明的涨停阈值（**仅读**；`null` = 未声明 ⇒ 运行期不做涨停校验）。 */
      readonly limitUpRatio: number | null;
      readonly notes: readonly string[];
    }
  | {
      readonly ok: false;
      /** 稳定原因码（供装配层如实标记回落）。 */
      readonly reason: "NO_LEGACY_DEFINITION" | "CORE_VERSION_BUILD_FAILED";
      readonly detail: string;
    };

/** 读取文档里的 legacy `StrategyDefinition` 段（**必须是对象**）。 */
export function readLegacyDefinition(document: StrategyDocument): LegacyStrategyDefinition | null {
  const raw = (document as unknown as { definition?: unknown }).definition;
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as LegacyStrategyDefinition;
}

/** 顶层 `positionSizing.kind`（文档级）→ legacy `sizingMethod` 词表。 */
const KEBAB_SIZING_TO_LEGACY: Readonly<Record<string, string>> = Object.freeze({
  "equal-weight": "EQUAL_WEIGHT",
  "fixed-amount": "FIXED_AMOUNT",
  "fixed-ratio": "FIXED_RATIO",
  "risk-based": "RISK_BASED",
});

/**
 * 把落库文档补全为**完整**的 legacy `StrategyDefinition`。
 *
 * 🔴 为什么必须补（STRATEGY-ARCH-002 实测阻塞项）：库里**真实的**文档里
 * `definition` 段只有 `{datasets, entry, execution, exit, parameters}` ——
 * **没有 `position`、也没有 `risk`**（仓位与风险写在文档顶层
 * `positionSizing` / `riskRules`）。适配器按 `StrategyDefinition` 的必填面读
 * `legacy.position.sizingMethod` ⇒ 对**每一份真实文档**都会 TypeError。
 *
 * 补全的取值只来自**同一份文档的顶层字段**（不是猜）：`positionSizing.kind` / `maxPositions`；
 * `riskRules` 为空 ⇒ `risk` 段留空（其字段全部可选）。补了什么**逐条写进 notes**。
 */
function normalizeLegacyDefinition(
  document: StrategyDocument,
  legacy: LegacyStrategyDefinition,
  notes: string[],
): { readonly ok: true; readonly definition: LegacyStrategyDefinition } | { readonly ok: false; readonly detail: string } {
  const raw = legacy as unknown as Record<string, unknown>;
  const filled: Record<string, unknown> = { ...raw };

  if (filled.position === undefined || filled.position === null) {
    const sizing = (document as unknown as { positionSizing?: { kind?: unknown; maxPositions?: unknown } })
      .positionSizing;
    const kind = typeof sizing?.kind === "string" ? sizing.kind : null;
    const mapped = kind === null ? undefined : KEBAB_SIZING_TO_LEGACY[kind];
    if (mapped === undefined) {
      return {
        ok: false,
        detail:
          "文档 definition 段缺 position，且顶层 positionSizing.kind=" + JSON.stringify(kind) +
          " 不是已登记的仓位方法（" + Object.keys(KEBAB_SIZING_TO_LEGACY).join("、") + "）—— 拒绝猜。",
      };
    }
    const maxPositions =
      typeof sizing?.maxPositions === "number" && Number.isFinite(sizing.maxPositions) && sizing.maxPositions >= 1
        ? sizing.maxPositions
        : 1;
    filled.position = { sizingMethod: mapped, maxPositions };
    notes.push(
      "legacy definition 段缺 `position` ⇒ 由文档顶层 `positionSizing` 补全：" +
        mapped + " / maxPositions=" + String(maxPositions),
    );
  }

  if (filled.risk === undefined || filled.risk === null) {
    filled.risk = {};
    const riskRules = (document as unknown as { riskRules?: unknown }).riskRules;
    const count = Array.isArray(riskRules) ? riskRules.length : 0;
    notes.push("legacy definition 段缺 `risk` ⇒ 补为空段（文档顶层 riskRules 条数=" + String(count) + "）");
  }

  if (filled.execution === undefined || filled.execution === null) {
    return { ok: false, detail: "文档缺 execution 段（无法确定信号 / 执行时点）—— 拒绝猜默认值。" };
  }

  return { ok: true, definition: filled as unknown as LegacyStrategyDefinition };
}

/** 由文档构造 Core 版本（唯一入口）。 */
export function coreVersionFromDocument(
  input: CoreVersionFromDocumentInput,
): CoreVersionFromDocumentResult {
  const normalizeNotes: string[] = [];
  const legacyRaw = readLegacyDefinition(input.document);
  if (legacyRaw === null) {    return {
      ok: false,
      reason: "NO_LEGACY_DEFINITION",
      detail:
        "策略文档 " + input.document.strategyId + "@" + input.document.version +
        " 没有 definition 段（legacy StrategyDefinition 编码）—— 无法翻译为 Core 定义。" +
        "拒绝凭空构造一份：那会让 Core 跑一个文档里不存在的策略。",
    };
  }
  const normalized = normalizeLegacyDefinition(input.document, legacyRaw, normalizeNotes);
  if (!normalized.ok) {
    return { ok: false, reason: "NO_LEGACY_DEFINITION", detail: normalized.detail };
  }

  let adaptation: LegacyAdaptationResult;
  try {
    adaptation = fromLegacyStrategyDefinition(normalized.definition);
  } catch (error) {
    return {
      ok: false,
      reason: "CORE_VERSION_BUILD_FAILED",
      detail: error instanceof Error ? error.name + ": " + error.message : String(error),
    };
  }

  let version: StrategyVersion;
  try {
    version = createStrategyVersion({
      strategyId: input.document.strategyId,
      version: input.document.version,
      definition: adaptation.definition,
      metadata: {
        name: input.document.name,
        ...(input.document.description !== undefined ? { description: input.document.description } : {}),
        ...(input.author !== undefined ? { author: input.author } : {}),
        notes:
          "由 legacy 策略文档翻译（STRATEGY-ARCH-002 production adapter）；" +
          "Dataset 绑定 " + String(adaptation.datasetBinding.length) + " 条已分离至 RunSnapshot",
      },
      createdAt: input.createdAt,
      status: "PUBLISHED",
    });
  } catch (error) {
    return {
      ok: false,
      reason: "CORE_VERSION_BUILD_FAILED",
      detail: error instanceof Error ? error.name + ": " + error.message : String(error),
    };
  }

  const legacy = normalized.definition;
  const eventType = legacy.entry?.event?.type === undefined ? null : String(legacy.entry.event.type);
  const rawRatio = (legacy.entry?.event?.params ?? {})["limitUpRatio"];
  const limitUpRatio = typeof rawRatio === "number" && Number.isFinite(rawRatio) ? rawRatio : null;

  return {
    ok: true,
    version,
    adaptation,
    eventType,
    limitUpRatio,
    notes: [
      ...normalizeNotes,
      ...adaptation.notes,
      eventType === null
        ? "文档未声明事件类型 ⇒ Core 定义里没有 EVENT 节点（纯条件策略）"
        : "文档声明事件类型 " + eventType + "；事件判定器由生产层按数据集事件源注入",
    ],
  };
}
