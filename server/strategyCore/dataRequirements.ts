/**
 * STRATEGY-ARCH-001 — DataRequirements（规格 §10）。
 *
 * 分工（这是规格第 2 条原则「Strategy 不绑定具体 Dataset」的落地）：
 *
 *   Strategy Core  **只声明**「我需要什么样的数据」
 *        ↓ checkDataCompatibility(requirements, capability)
 *   运行方（Backtest / Research / Paper）**决定**用哪个 Dataset Version
 *
 * 🔴 两条硬禁令（规格 §10 + §16）：
 *   1. Strategy Definition 内**禁止**出现 `datasetVersionId` / 物理表名 / 引擎表名
 *      ⇒ 由 `assertNoDatasetBindingInDefinition()` 提供**机器可查**的守卫（不是靠注释约束）；
 *   2. 数据集坐标只允许出现在 `StrategyRunSnapshot.datasetReference`（运行时快照，非 Definition）。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import {
  DATA_DOMAINS,
  DATA_FREQUENCIES,
  StrategyCoreError,
  validationIssue,
  type CoreValidationIssue,
  type DataDomain,
  type DataFrequency,
  type RelativeDay,
} from "./types";
import { collectRuleFieldReferences, collectRuleFeatureReferences, collectRuleWindows, type RuleNode } from "./ruleGraph";
import { fieldReferenceFeatureId } from "./fieldReference";
import type { FeatureRegistry } from "./featureRegistry";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 事件需求（策略要求数据集提供的事件形态）。 */
export interface EventRequirement {
  readonly eventType: string;
  /** 是否必需；false = 可选（数据集缺失时降级但不拒绝）。 */
  readonly required: boolean;
  /** 事件必须覆盖的最少事件数（缺省不限）。 */
  readonly minEvents?: number;
}

/** 数据需求（Strategy Core 的**唯一**数据面声明）。 */
export interface DataRequirements {
  readonly frequency: DataFrequency;
  /** 必需的原始列（如 `open/high/low/close/volume`）。 */
  readonly requiredFields: readonly string[];
  /** 事件日前需要的历史 bar 根数（后视）。 */
  readonly lookback: number;
  /** 事件日后需要的最大相对日（前视视界；必须 >= 所有 WINDOW 的 end）。 */
  readonly forwardHorizon: RelativeDay;
  /** 必需的特征（id + 版本）。 */
  readonly requiredFeatures: readonly { readonly featureId: string; readonly version: string }[];
  /** 必需的数据域。 */
  readonly requiredDomains: readonly DataDomain[];
  /** 事件需求。 */
  readonly eventRequirements: readonly EventRequirement[];
}

/** 运行方提供的「本数据集能力声明」（**由运行方如实填写**，Core 不猜）。 */
export interface DatasetCapabilityDescriptor {
  readonly frequency: DataFrequency;
  readonly availableFields: readonly string[];
  readonly availableDomains: readonly DataDomain[];
  readonly eventTypes: readonly string[];
  /** 数据集事件数（缺省 = 未知，不做 minEvents 校验）。 */
  readonly eventCount?: number;
  /** 数据集覆盖的最远相对日（缺省 = 未知，不做视界校验）。 */
  readonly maxRelativeDay?: RelativeDay;
  /** 可用历史 bar 根数（缺省 = 未知，不做 lookback 校验）。 */
  readonly availableHistory?: number;
}

/** 兼容性报告（**如实列出每一项**，不做「总体上没问题」的笼统结论）。 */
export interface DataCompatibilityReport {
  readonly compatible: boolean;
  readonly missingFields: readonly string[];
  readonly missingDomains: readonly string[];
  readonly missingEvents: readonly string[];
  readonly missingFeatures: readonly string[];
  readonly frequencyMismatch: { readonly required: DataFrequency; readonly available: DataFrequency } | null;
  readonly insufficientLookback: { readonly required: number; readonly available: number } | null;
  readonly insufficientHorizon: { readonly required: RelativeDay; readonly available: RelativeDay } | null;
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// 构造
// ---------------------------------------------------------------------------

/** RuleGraph 引用的原始列 → 是否属于「必需字段」。 */
const KNOWN_RAW_FIELDS = ["open", "high", "low", "close", "volume", "amount", "preClose"] as const;

/**
 * 从 RuleGraph **推导** `requiredFields` / `requiredFeatures`：
 * 只有真的被引用的字段/特征才进需求面（避免「声明了却无效」的反向问题：声明了用不上的需求）。
 */
export function deriveDataRequirementsFromRuleGraph(
  root: RuleNode,
  options: {
    readonly frequency?: DataFrequency;
    readonly lookback?: number;
    readonly forwardHorizon?: RelativeDay;
    readonly requiredDomains?: readonly DataDomain[];
    readonly eventRequirements?: readonly EventRequirement[];
    readonly featureRegistry?: FeatureRegistry;
  } = {},
): DataRequirements {
  const fields = collectRuleFieldReferences(root)
    .filter((field) => {
      // 只把「原始行情列」计入 requiredFields；`event.*` 属于事件面，`bar.<派生>` 属于特征面。
      const match = /^(?:prefix\.rd-?\d+|post\.rd\d+|bar)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(field);
      if (match === null) return false;
      return (KNOWN_RAW_FIELDS as readonly string[]).includes(match[1] as string);
    })
    .map((field) => (/([A-Za-z][A-Za-z0-9_]*)$/.exec(field) as RegExpExecArray)[1] as string);

  const featureIds = new Set<string>(collectRuleFeatureReferences(root));
  // 派生 bar 字段（`bar.volumeRatio`）在 core 里由特征承载 ⇒ 经**唯一桥接表**映射为特征 id。
  // ⚠️ 只映射「注册表里确实存在」的字段名 —— 否则 `bar.low` 会被误当成特征 `low`。
  for (const field of collectRuleFieldReferences(root)) {
    const bridged = fieldReferenceFeatureId(field);
    if (bridged !== null) featureIds.add(bridged);
  }

  const windows = collectRuleWindows(root);
  const windowHorizon = windows.reduce<RelativeDay>(
    (max, window) => Math.max(max, window.end),
    0,
  );

  const requiredFeatures = [...featureIds]
    .sort()
    .map((featureId) => {
      const definition = options.featureRegistry?.get(featureId) ?? null;
      return { featureId, version: definition === null ? "unregistered" : definition.version };
    });

  const lookbackFromFeatures = requiredFeatures.reduce((max, requirement) => {
    const definition = options.featureRegistry?.get(requirement.featureId) ?? null;
    return definition === null ? max : Math.max(max, definition.lookback);
  }, 1);

  return {
    frequency: options.frequency ?? "1D",
    requiredFields: [...new Set(fields)].sort(),
    lookback: Math.max(options.lookback ?? lookbackFromFeatures, lookbackFromFeatures),
    forwardHorizon: Math.max(options.forwardHorizon ?? windowHorizon, windowHorizon),
    requiredFeatures,
    requiredDomains: [...new Set(options.requiredDomains ?? (["OHLCV"] as readonly DataDomain[]))].sort() as readonly DataDomain[],
    eventRequirements: [...(options.eventRequirements ?? [])],
  };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export function validateDataRequirements(
  requirements: DataRequirements,
  path = "dataRequirements",
): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];
  if (!(DATA_FREQUENCIES as readonly string[]).includes(requirements.frequency)) {
    issues.push(validationIssue("DATA_REQUIREMENTS_UNSATISFIED", path + ".frequency", "未知频率 " + String(requirements.frequency)));
  }
  if (!Number.isInteger(requirements.lookback) || requirements.lookback < 0) {
    issues.push(validationIssue("DATA_REQUIREMENTS_UNSATISFIED", path + ".lookback", "lookback 必须是非负整数"));
  }
  if (!Number.isInteger(requirements.forwardHorizon) || requirements.forwardHorizon < 0) {
    issues.push(validationIssue("DATA_REQUIREMENTS_UNSATISFIED", path + ".forwardHorizon", "forwardHorizon 必须是非负整数"));
  }
  for (const domain of requirements.requiredDomains) {
    if (!(DATA_DOMAINS as readonly string[]).includes(domain)) {
      issues.push(validationIssue("DATA_REQUIREMENTS_UNSATISFIED", path + ".requiredDomains", "未知数据域 " + String(domain)));
    }
  }
  return issues;
}

/**
 * 兼容性检查（**逐项如实**，不返回笼统布尔就完事）。
 *
 * 未知的可用信息（`undefined`）**不**被当作通过，也不被当作失败 —— 而是记进 `notes`，
 * 让调用方知道「这一项没被验证」，避免把「没检查」读成「检查通过」。
 */
export function checkDataCompatibility(
  requirements: DataRequirements,
  capability: DatasetCapabilityDescriptor,
): DataCompatibilityReport {
  const notes: string[] = [];

  const availableFields = new Set(capability.availableFields);
  const missingFields = requirements.requiredFields.filter((field) => !availableFields.has(field)).sort();

  const availableDomains = new Set(capability.availableDomains);
  const missingDomains = requirements.requiredDomains.filter((domain) => !availableDomains.has(domain)).sort();

  const availableEvents = new Set(capability.eventTypes);
  const missingEvents: string[] = [];
  for (const requirement of requirements.eventRequirements) {
    if (!requirement.required) continue;
    if (availableEvents.has(requirement.eventType)) continue;
    missingEvents.push(requirement.eventType);
  }
  missingEvents.sort();

  const missingFeatures = requirements.requiredFeatures
    .filter((requirement) => requirement.version === "unregistered")
    .map((requirement) => requirement.featureId)
    .sort();

  const frequencyMismatch =
    requirements.frequency === capability.frequency
      ? null
      : { required: requirements.frequency, available: capability.frequency };

  let insufficientLookback: { required: number; available: number } | null = null;
  if (capability.availableHistory === undefined) {
    notes.push("数据集未声明可用历史 bar 根数 ⇒ lookback（需 " + String(requirements.lookback) + "）未被验证");
  } else if (capability.availableHistory < requirements.lookback) {
    insufficientLookback = { required: requirements.lookback, available: capability.availableHistory };
  }

  let insufficientHorizon: { required: RelativeDay; available: RelativeDay } | null = null;
  if (capability.maxRelativeDay === undefined) {
    notes.push("数据集未声明最远相对日 ⇒ forwardHorizon（需 T+" + String(requirements.forwardHorizon) + "）未被验证");
  } else if (capability.maxRelativeDay < requirements.forwardHorizon) {
    insufficientHorizon = { required: requirements.forwardHorizon, available: capability.maxRelativeDay };
  }

  if (capability.eventCount === undefined && requirements.eventRequirements.some((r) => r.minEvents !== undefined)) {
    notes.push("数据集未声明事件数 ⇒ minEvents 未被验证");
  } else {
    for (const requirement of requirements.eventRequirements) {
      if (requirement.minEvents === undefined) continue;
      if (!availableEvents.has(requirement.eventType)) continue;
      const available = capability.eventCount ?? 0;
      if (available < requirement.minEvents) {
        notes.push("事件 " + requirement.eventType + " 数量 " + String(available) + " 少于要求 " + String(requirement.minEvents));
      }
    }
  }

  const compatible =
    missingFields.length === 0 &&
    missingDomains.length === 0 &&
    missingEvents.length === 0 &&
    missingFeatures.length === 0 &&
    frequencyMismatch === null &&
    insufficientLookback === null &&
    insufficientHorizon === null;

  return {
    compatible,
    missingFields,
    missingDomains,
    missingEvents,
    missingFeatures,
    frequencyMismatch,
    insufficientLookback,
    insufficientHorizon,
    notes,
  };
}

/** 不兼容即抛（把报告里的**第一项**具体原因写进消息，方便定位）。 */
export function assertDataCompatible(report: DataCompatibilityReport): void {
  if (report.compatible) return;
  const reasons: string[] = [];
  if (report.frequencyMismatch !== null) {
    reasons.push("频率不符（需 " + report.frequencyMismatch.required + "，实际 " + report.frequencyMismatch.available + "）");
  }
  if (report.missingFields.length > 0) reasons.push("缺字段 " + report.missingFields.join("、"));
  if (report.missingDomains.length > 0) reasons.push("缺数据域 " + report.missingDomains.join("、"));
  if (report.missingEvents.length > 0) reasons.push("缺事件 " + report.missingEvents.join("、"));
  if (report.missingFeatures.length > 0) reasons.push("特征版本未登记 " + report.missingFeatures.join("、"));
  if (report.insufficientLookback !== null) {
    reasons.push("历史不足（需 " + String(report.insufficientLookback.required) + "，实际 " + String(report.insufficientLookback.available) + "）");
  }
  if (report.insufficientHorizon !== null) {
    reasons.push("视界不足（需 T+" + String(report.insufficientHorizon.required) + "，实际 T+" + String(report.insufficientHorizon.available) + "）");
  }
  throw new StrategyCoreError("DATA_REQUIREMENTS_UNSATISFIED", reasons.join("；"), { reasonCount: reasons.length });
}

// ---------------------------------------------------------------------------
// 「Dataset 不得进 Definition」守卫（规格 §10 的机器可查版本）
// ---------------------------------------------------------------------------

/** 禁止出现在 Definition 里的键名 / 片段（跨键递归扫描）。 */
export const FORBIDDEN_DEFINITION_KEYS = [
  "datasetVersionId",
  "datasetVersion",
  "datasetId",
  "datasetBinding",
  "rowsTableName",
  "databaseName",
  "tableName",
  "engineVersion",
  "codeVersion",
] as const;

/** 禁止出现在 Definition 里的字符串片段（表名 / 引擎名 / 库名）。 */
export const FORBIDDEN_DEFINITION_STRING_PATTERNS = [
  "ds_first_limit",
  "rd_rows_",
  "limit_up_records",
  "stock_daily_prices",
  "index_daily",
  "TiDB",
  "tidb",
] as const;

/**
 * 扫描任意对象，找出**违反 §10「Strategy 不绑定 Dataset」**的键名 / 字符串。
 * 返回全部命中（路径 + 命中内容）；空数组 = 通过。
 */
export function findDatasetBindingLeaks(value: unknown, path = "$"): readonly string[] {
  const hits: string[] = [];
  const walk = (node: unknown, at: string): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      for (const pattern of FORBIDDEN_DEFINITION_STRING_PATTERNS) {
        if (node.includes(pattern)) hits.push(at + " 含禁止片段 " + JSON.stringify(pattern));
      }
      return;
    }
    if (typeof node === "number" || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, at + "[" + String(index) + "]"));
      return;
    }
    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if ((FORBIDDEN_DEFINITION_KEYS as readonly string[]).includes(key)) {
          hits.push(at + "." + key + " 是禁止出现在 Definition 的 Dataset / 引擎坐标键");
        }
        walk(child, at + "." + key);
      }
    }
  };
  walk(value, path);
  return hits;
}

/** 断言 Definition 内不含 Dataset 绑定（违反即抛，不静默）。 */
export function assertNoDatasetBindingInDefinition(definition: unknown): void {
  const hits = findDatasetBindingLeaks(definition);
  if (hits.length === 0) return;
  throw new StrategyCoreError(
    "DATASET_BINDING_IN_DEFINITION_FORBIDDEN",
    "Strategy Definition 内出现 Dataset / 引擎绑定坐标（规格 §10 禁止）：" + hits.join(" | "),
    { hitCount: hits.length },
  );
}
