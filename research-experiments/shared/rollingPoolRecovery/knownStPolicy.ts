/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` §4 —— **轻量 ST 资格政策**（显式政策变体）。
 *
 * ## 这个模块回答什么
 *
 * 「按**本轮显式选择的资格政策**，某只股票在某个检查日的某个 ST 标签读数下，
 *  **能否进入排序候选**、**能否在真实成交前被放行**，以及**审计状态记什么**？」
 *
 * ## 🔴 本轮性质：`EXPLORATORY / KNOWN_ST_ONLY`
 *
 * 用户已明确授权：**UNKNOWN 可参与，仅排除已有记录中的 ST**。这**不是**严格 PIT 研究：
 * 历史标签的 `availability` 全为 `UNKNOWN`、可获知时间全缺（`RESULT-…-ST-DATA-READINESS-006` §2）。
 * 因此**缺省仍是原严格政策**，本政策必须**显式**选择，且结论**不得**升级为 PIT / OOS / 实盘验证。
 *
 * ## 行为表（**逐字实现**，目标 §4）
 *
 * | 读取结果 | 确认日收盘 | 真实买入前 | 审计状态 |
 * |---|---|---|---|
 * | 已有历史记录明确标记该时点为 ST / *ST | **不进入排序候选** | **拒单** | `ST`（保留来源与证据指纹） |
 * | 有明确正常记录 | 可以参与 | 可以执行 | `NORMAL` |
 * | 无记录、身份无法解析或证据不能判断 | 可以参与 | 可以执行 | **`UNKNOWN`，且注明"本轮允许未知"** |
 *
 * ## 🔴 三条不可协商的纪律
 *
 * 1. **`UNKNOWN` 绝不改写成 `NORMAL`**。它是**独立三态**，审计与产物一律原样保留。
 * 2. **`ST` 恒拒绝**，即使某个判决错误地返回 `allowed = true`（与严格模式同一失败关闭）。
 * 3. **缺席 ≠ 正常记录**：本模块**没有**任何「没有 ST 行 ⇒ NORMAL」的分支 ——
 *    缺席得到的是 `UNKNOWN`（**仅因本轮显式政策**才允许参与），并且**必须有** `reason` 归因。
 *
 * ## 🔴 与严格契约的关系
 *
 * `stGate.ts#evaluateStGate` 的严格契约 **`1.1.0` 保持不变**（只认可核验 `NORMAL`）。
 * 本模块是**另一个有版本的资格决策**（`recovery-known-st-only/1.0.0`），
 * **不**修改、**不**放宽、**不**替换严格契约；两者并存且缺省为严格。
 *
 * ## 🔴 身份缺口的准确含义
 *
 * 上表的身份缺口指 **ST 来源映射**缺口（symbol → 该日期的证券身份解析不到）。
 * **真正的交易证券身份、价格与订单坐标仍须满足原执行约束**：
 * 不得凭空生成 `securityId`，也**不得**把交易身份无法解析视为可成交。
 * 本模块的 `UNKNOWN` 只在「ST 标签来源」这一维度上表达「无法判断」。
 *
 * ## 纯函数
 *
 * 本文件无 IO、无 DB、无 `Date.now`、无 `Math.random`；标签索引由**服务侧**实现并注入。
 */

import { ST_EXECUTION_ELIGIBILITY_POLICY_VERSION } from "./stGate";

// ---------------------------------------------------------------------------
// 一、政策标识与缺省
// ---------------------------------------------------------------------------

/** 资格政策 id（**闭集**；缺省 = 严格）。 */
export const ST_ELIGIBILITY_POLICY_IDS = [
  "STRICT_VERIFIED_NORMAL_ONLY",
  "KNOWN_ST_ONLY_EXPLORATORY",
] as const;
export type StEligibilityPolicyId = (typeof ST_ELIGIBILITY_POLICY_IDS)[number];

/** 缺省政策 id = **原严格政策**（只认可核验 `NORMAL`）。 */
export const STRICT_ELIGIBILITY_POLICY_ID: StEligibilityPolicyId = "STRICT_VERIFIED_NORMAL_ONLY";
/** 本轮授权的探索性政策 id。 */
export const KNOWN_ST_ONLY_ELIGIBILITY_POLICY_ID: StEligibilityPolicyId = "KNOWN_ST_ONLY_EXPLORATORY";

/** 严格政策版本（= 既有 `recovery-st-execution-eligibility/1.0.0`，**逐字不变**）。 */
export const STRICT_ELIGIBILITY_POLICY_VERSION = ST_EXECUTION_ELIGIBILITY_POLICY_VERSION;
/** 🔴 本轮新政策版本（**与严格政策是两个不同的身份**，不共用冻结配置）。 */
export const KNOWN_ST_ONLY_POLICY_VERSION = "recovery-known-st-only/1.0.0";

/** 实验 / 工具参数坐标（`descriptor.parameters` 与 CLI 共用同一组字面量）。 */
export const ST_POLICY_PARAMETER_CODE = "stPolicy";
/** 缺省参数值 —— **必须**是严格。 */
export const ST_POLICY_DEFAULT_VALUE = "strict";
/** 允许的参数值（**闭集**；非法值必须响亮失败，不得静默回落到严格或宽松）。 */
export const ST_POLICY_PARAMETER_VALUES = ["strict", "known-st-only"] as const;
export type StPolicyParameterValue = (typeof ST_POLICY_PARAMETER_VALUES)[number];

/** 政策解析结果（进入冻结配置与全部产物）。 */
export interface StEligibilityPolicy {
  readonly id: StEligibilityPolicyId;
  readonly version: string;
  /** 参数面取值（`strict` / `known-st-only`）。 */
  readonly parameterValue: StPolicyParameterValue;
  /** `true` ⇒ 探索性 KNOWN_ST_ONLY：UNKNOWN 可参与。 */
  readonly knownStOnly: boolean;
  /** `true` ⇒ **不是**严格 PIT 研究（必须在报告与产物里显式声明）。 */
  readonly exploratory: boolean;
  /** `true` ⇒ 严格模式：只认可核验 `NORMAL`（= 004 行为，缺省）。 */
  readonly strictDefault: boolean;
  readonly label: string;
}

const STRICT_POLICY: StEligibilityPolicy = Object.freeze({
  id: STRICT_ELIGIBILITY_POLICY_ID,
  version: STRICT_ELIGIBILITY_POLICY_VERSION,
  parameterValue: "strict",
  knownStOnly: false,
  exploratory: false,
  strictDefault: true,
  label: "严格（缺省）：只认可 PIT 可核验的 NORMAL；ST / UNKNOWN 一律拒绝",
});

const KNOWN_ST_ONLY_POLICY: StEligibilityPolicy = Object.freeze({
  id: KNOWN_ST_ONLY_ELIGIBILITY_POLICY_ID,
  version: KNOWN_ST_ONLY_POLICY_VERSION,
  parameterValue: "known-st-only",
  knownStOnly: true,
  exploratory: true,
  strictDefault: false,
  label:
    "探索性（本轮授权）：UNKNOWN 可参与，仅排除已有历史记录中的 ST；"
    + "**不是**严格 PIT 研究，结论不得升级为 PIT / OOS / 实盘验证",
});

export const ST_ELIGIBILITY_POLICIES: Readonly<Record<StEligibilityPolicyId, StEligibilityPolicy>> =
  Object.freeze({
    [STRICT_ELIGIBILITY_POLICY_ID]: STRICT_POLICY,
    [KNOWN_ST_ONLY_ELIGIBILITY_POLICY_ID]: KNOWN_ST_ONLY_POLICY,
  });

/**
 * 参数值 ⇒ 政策。
 *
 * 🔴 **缺省即严格**：`undefined` / `null` / `"strict"` 都得到严格政策。
 * 🔴 非法值**抛错**（不静默回落到严格，也不静默放宽）—— 「打错的参数被静默忽略」正是本轮要避免的。
 */
export function resolveStEligibilityPolicy(raw: unknown): StEligibilityPolicy {
  if (raw === undefined || raw === null) return STRICT_POLICY;
  if (typeof raw !== "string" || !(ST_POLICY_PARAMETER_VALUES as readonly string[]).includes(raw)) {
    throw new Error(
      `RECOVERY-LIGHT-ST-007：未知 ST 资格政策 ${JSON.stringify(raw)}；`
      + `允许值只有 [${ST_POLICY_PARAMETER_VALUES.join(", ")}]（缺省 = ${ST_POLICY_DEFAULT_VALUE}）。`
      + "拒绝静默回落到严格或宽松。",
    );
  }
  return raw === "known-st-only" ? KNOWN_ST_ONLY_POLICY : STRICT_POLICY;
}

// ---------------------------------------------------------------------------
// 二、标签读数（研究侧端口；实现由服务侧经桥接注入）
// ---------------------------------------------------------------------------

/** 标签类别（三态，**闭集**）。 */
export const KNOWN_ST_LABEL_KINDS = ["KNOWN_ST", "EXPLICIT_NORMAL", "UNKNOWN"] as const;
export type KnownStLabelKind = (typeof KNOWN_ST_LABEL_KINDS)[number];

/**
 * 标签归因原因（**只增不改**）。
 *
 * 🔴 每个 `UNKNOWN` 都必须能说出「为什么不知道」；「不知道」不是一个可以省略的原因。
 */
export const KNOWN_ST_LABEL_REASONS = [
  /** 已有历史区间覆盖该检查日且状态为 ST / *ST。 */
  "KNOWN_ST_INTERVAL_COVERS_CHECK_DATE",
  /** 有明确正常记录且覆盖该检查日。 */
  "EXPLICIT_NORMAL_INTERVAL_COVERS_CHECK_DATE",
  /** 该 (symbol, 检查日) 在来源里**没有任何**区间覆盖（absent ≠ NORMAL）。 */
  "NO_STATUS_FACT",
  /** symbol → 该日期的证券身份解析不到（ST 来源映射缺口）。 */
  "IDENTITY_UNRESOLVED",
  /** symbol → 该日期的证券身份解析到**多个**不同身份（歧义）。 */
  "IDENTITY_AMBIGUOUS",
  /** 身份解析输入本身非法（如 symbol 不是合法完整代码）。 */
  "IDENTITY_UNPARSEABLE",
  /** 检查日本身不是合法日历日。 */
  "INVALID_CHECK_DATE",
  /** 来源行的时间写法不可识别或不是合法日历日 ⇒ **不得**靠字典序恰好落在区间内而放行。 */
  "INVALID_INTERVAL_TIME_FORMAT",
  /** 同一天有多个**互相矛盾**的区间（既 ST 又 NORMAL，或区间边界无法判断）⇒ 不可判断。 */
  "CONFLICTING_INTERVALS_UNDECIDABLE",
  /** 来源行的状态取值不在本政策的可识别集合内 ⇒ **不得**猜测成 ST 或 NORMAL。 */
  "UNRECOGNIZED_STATUS_VALUE",
] as const;
export type KnownStLabelReason = (typeof KNOWN_ST_LABEL_REASONS)[number];

/** 命中的来源区间事实（**照抄**来源，不派生、不改造）。 */
export interface KnownStLabelFact {
  /** ST 来源里的维度取值（如 `ST` / `*ST`）。 */
  readonly statusValue: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly source: string;
  /** 来源声明的 confidence（`high`/`medium`/`low`）——**原样保留**，本轮不升级。 */
  readonly confidence: string;
  /** 来源声明的 availability（`IMMEDIATE`/`T_PLUS_1`/`UNKNOWN`）——**原样保留**，不修改。 */
  readonly availability: string;
  /** 来源行的采集时间（**不是**公告时间；本轮**不**把它当可获知时间）。 */
  readonly retrievedAt: string | null;
  /** 证据指纹（对该行判决相关字段的确定性摘要）。 */
  readonly evidenceFingerprint: string;
}

/** 一次标签读数。 */
export interface KnownStLabelObservation {
  readonly symbol: string;
  readonly checkDate: string;
  readonly kind: KnownStLabelKind;
  readonly reason: KnownStLabelReason;
  /** 解析到的证券身份（解析不到 ⇒ `null`；**绝不**凭空生成）。 */
  readonly securityId: string | null;
  readonly fact: KnownStLabelFact | null;
}

/**
 * 标签索引端口（**只读**）。
 *
 * 🔴 实现方**不得**在无记录时返回 NORMAL，**不得**伪造 `availableAsOf`，
 *    **不得**修改 `availability` / `confidence`，**不得**把缺席派生成 NORMAL。
 * 🔴 实现方在服务侧（`server/**`）经桥接注入；研究侧只消费本接口。
 */
export interface KnownStLabelIndexPort {
  /** 来源标识。 */
  readonly sourceId: string;
  /** 来源指纹（同一份来源两次读取应得到同一指纹）。 */
  readonly sourceFingerprint: string;
  /** 读到的来源行数（**真实计数**，不是估计）。 */
  readonly rowCount: number;
  /** 读到的来源证券数。 */
  readonly securityCount: number;
  /** 身份映射行数。 */
  readonly identifierRowCount: number;
  /** 来源行按 `availability` 的分布（如实保留，用于说明「本轮没有 PIT 可知性」）。 */
  readonly availabilityCounts: Readonly<Record<string, number>>;
  /** 来源行按 `confidence` 的分布。 */
  readonly confidenceCounts: Readonly<Record<string, number>>;
  /** 来源里显式 NORMAL 行的行数（当前实测 = 0 ⇒ 缺席**不能**推出 NORMAL）。 */
  readonly explicitNormalRowCount: number;
  /** 该索引实际读过的来源表名（留档）。 */
  readonly tablesRead: readonly string[];
  lookup(input: { readonly symbol: string; readonly checkDate: string }): KnownStLabelObservation;
}

// ---------------------------------------------------------------------------
// 三、资格判决（策略本体）
// ---------------------------------------------------------------------------

/** 审计状态（**三态，闭集**）：与严格闸门的三态同名，但语义由政策决定。 */
export const ST_ELIGIBILITY_STATUSES = ["NORMAL", "ST", "UNKNOWN"] as const;
export type StEligibilityStatus = (typeof ST_ELIGIBILITY_STATUSES)[number];

/** 资格判决（可直接进审计产物）。 */
export interface StEligibilityDecision {
  readonly policyId: StEligibilityPolicyId;
  readonly policyVersion: string;
  readonly exploratory: boolean;
  /** 🔴 真实状态，**绝不**把 UNKNOWN 改写为 NORMAL。 */
  readonly status: StEligibilityStatus;
  /** 是否进入排序候选（确认日收盘时点的判决）。 */
  readonly participatesInRanking: boolean;
  /** 真实成交前是否放行。 */
  readonly allowedToExecute: boolean;
  /** 稳定原因码。 */
  readonly reason: string;
  /** 人读说明；`UNKNOWN` 放行时必须显式注明「本轮允许未知」。 */
  readonly note: string;
  readonly observation: KnownStLabelObservation;
}

/** `UNKNOWN` 被放行时的**唯一**措辞（审计与报告共用同一句）。 */
export const UNKNOWN_ALLOWED_THIS_ROUND_NOTE =
  "UNKNOWN（无记录 / 身份无法解析 / 证据不能判断）—— **本轮显式政策允许未知参与**；"
  + "这不是已验证的 NORMAL，也不是严格 PIT 结论。";

/**
 * **轻量政策本体**：`KNOWN_ST_ONLY_EXPLORATORY` 的资格判决。
 *
 * 🔴 行为表（目标 §4）在这里**逐字**实现：
 *   - 已知 ST 区间覆盖 ⇒ `status = "ST"`、不参与、不放行；
 *   - 明确正常记录覆盖 ⇒ `status = "NORMAL"`、参与、放行；
 *   - 其它（无记录 / 身份无法解析 / 证据不能判断）⇒ `status = "UNKNOWN"`、**参与**、**放行**。
 */
export function decideKnownStOnlyEligibility(args: {
  readonly index: KnownStLabelIndexPort;
  readonly symbol: string;
  readonly checkDate: string;
}): StEligibilityDecision {
  const observation = args.index.lookup({ symbol: args.symbol, checkDate: args.checkDate });
  const base = {
    policyId: KNOWN_ST_ONLY_ELIGIBILITY_POLICY_ID,
    policyVersion: KNOWN_ST_ONLY_POLICY_VERSION,
    exploratory: true,
    observation,
  } as const;

  if (observation.kind === "KNOWN_ST") {
    return {
      ...base,
      status: "ST",
      participatesInRanking: false,
      allowedToExecute: false,
      reason: "KNOWN_ST_RECORD_EXCLUDED",
      note:
        "已有历史记录明确标记该时点为 ST/*ST ⇒ **不进入排序候选、成交前拒单**"
        + "（保留来源、生效区间与证据指纹；**不自动递补第 4 名**）。",
    };
  }
  if (observation.kind === "EXPLICIT_NORMAL") {
    return {
      ...base,
      status: "NORMAL",
      participatesInRanking: true,
      allowedToExecute: true,
      reason: "EXPLICIT_NORMAL_RECORD",
      note: "有明确正常记录 ⇒ 可以参与、可以执行（审计状态 `NORMAL`）。",
    };
  }
  return {
    ...base,
    status: "UNKNOWN",
    participatesInRanking: true,
    allowedToExecute: true,
    reason: `UNKNOWN_ALLOWED_THIS_ROUND:${observation.reason}`,
    note: UNKNOWN_ALLOWED_THIS_ROUND_NOTE,
  };
}

/**
 * **严格政策本体**（缺省）：只认可核验 `NORMAL`。
 *
 * 🔴 本函数**不**替换 `evaluateStGate`（严格契约 1.1.0 保持不变）；它只把
 *    「严格闸门的三态」翻译成同一套政策判决形状，便于两种政策走**同一段**审计与计数代码。
 *    严格模式下标签索引**不参与**判决（`observation` 仅作证据留档）。
 */
export function decideStrictEligibility(args: {
  readonly outcome: StEligibilityStatus;
  readonly reason: string;
  readonly observation: KnownStLabelObservation | null;
}): StEligibilityDecision {
  const observation = args.observation ?? {
    symbol: "",
    checkDate: "",
    kind: "UNKNOWN" as const,
    reason: "NO_STATUS_FACT" as const,
    securityId: null,
    fact: null,
  };
  const normal = args.outcome === "NORMAL";
  return {
    policyId: STRICT_ELIGIBILITY_POLICY_ID,
    policyVersion: STRICT_ELIGIBILITY_POLICY_VERSION,
    exploratory: false,
    status: args.outcome,
    participatesInRanking: normal,
    allowedToExecute: normal,
    reason: args.reason,
    note: normal
      ? "严格政策：可核验 NORMAL ⇒ 参与并可执行。"
      : `严格政策：${args.outcome}（${args.reason}）⇒ 不参与、不放行（失败关闭）。`,
    observation,
  };
}
