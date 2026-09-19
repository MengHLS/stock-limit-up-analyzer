/**
 * STRATEGY-ARCH-001 — 字段引用目录（Core 侧的唯一口径桥）。
 *
 * 纪律：**不发明第二套时间域目录** —— 本模块复用策略域既有的唯一权威
 *   `server/research/strategySchema/definition.ts` 的
 *   `parseStrategyFieldReference` / `resolveFieldTimeDomain` / 白名单常量，
 * 只做两件 legacy 没做的事：
 *   ① 给出 Core 需要的**判定函数**（`isKnownCoreFieldReference`）；
 *   ② 把 legacy 的 `bar.<派生字段>`（`volumeRatio` 等）**桥接**为 Core 的特征引用
 *      （映射表 `DERIVED_BAR_FIELD_TO_FEATURE_ID`，未登记即拒绝，不猜）。
 *
 * `path.* / outcome.*` 在 legacy 里就是「前视，仅打标签」层 ⇒ Core 里**判为未知**（拒绝作为条件输入）。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import {
  STRATEGY_BAR_FIELDS,
  STRATEGY_CURRENT_BAR_FIELDS,
  STRATEGY_DERIVED_BAR_FIELDS,
  STRATEGY_EVENT_FIELDS,
  parseStrategyFieldReference,
} from "../research/strategySchema/definition";
import { DERIVED_BAR_FIELD_TO_FEATURE_ID } from "./featureRegistry";
import type { RelativeDay } from "./types";

/** Core 字段引用形态。 */
export type CoreFieldKind =
  /** `prefix.rd{n}`（n ≤ 0）：事件日及之前，PIT 安全。 */
  | "PRE_EVENT"
  /** `event.<field>`：事件日身份信息。 */
  | "EVENT_DAY"
  /** `bar.<field>`：当前被评估的那根 bar（派生字段另见 `DERIVED_BAR_FEATURE`）。 */
  | "CURRENT_BAR"
  /** `post.rd{n}`（n ≥ 1）：事件日之后 —— 只在 n ≤ 当前相对日时可用。 */
  | "FORWARD_BAR"
  /** `bar.<派生字段>`：等价于某个注册特征（桥接到 FeatureRegistry）。 */
  | "DERIVED_BAR_FEATURE"
  /** `path.*` / `outcome.*`：前视标签层 —— **禁止作为策略条件**。 */
  | "LABEL_ONLY"
  /** 无法判定 / 未知字段。 */
  | "UNKNOWN";

export interface CoreFieldReference {
  readonly raw: string;
  readonly kind: CoreFieldKind;
  /** 形态里带相对日的引用（PRE_EVENT / FORWARD_BAR）才有。 */
  readonly relativeDay?: RelativeDay;
  /** 字段名（去掉前缀之后）。 */
  readonly field: string;
  /** `kind === "DERIVED_BAR_FEATURE"` 时对应的注册特征 id。 */
  readonly featureId?: string;
}

const BAR_FIELD_SET = new Set<string>(STRATEGY_BAR_FIELDS);
const EVENT_FIELD_SET = new Set<string>(STRATEGY_EVENT_FIELDS);
const DERIVED_BAR_FIELD_SET = new Set<string>(STRATEGY_DERIVED_BAR_FIELDS);
const CURRENT_BAR_FIELD_SET = new Set<string>(STRATEGY_CURRENT_BAR_FIELDS);

/**
 * 解析字段引用（复用 legacy 唯一解析器 + Core 侧语义判定）。
 *
 * 判定顺序（**先判派生 bar 字段**，再判普通 bar 字段 —— 否则 `bar.volumeRatio` 会被
 * 误判成「未知的原始列」而丢失特征桥接）：
 */
export function parseCoreFieldReference(field: string): CoreFieldReference {
  const raw = typeof field === "string" ? field.trim() : String(field);
  if (raw === "") return { raw, kind: "UNKNOWN", field: raw };

  const parsed = parseStrategyFieldReference(raw);
  switch (parsed.kind) {
    case "preEvent": {
      if (!BAR_FIELD_SET.has(parsed.field)) return { raw, kind: "UNKNOWN", field: parsed.field };
      return { raw, kind: "PRE_EVENT", relativeDay: parsed.relativeDay, field: parsed.field };
    }
    case "forwardBar": {
      if (!BAR_FIELD_SET.has(parsed.field)) return { raw, kind: "UNKNOWN", field: parsed.field };
      return { raw, kind: "FORWARD_BAR", relativeDay: parsed.relativeDay, field: parsed.field };
    }
    case "eventDay": {
      if (!EVENT_FIELD_SET.has(parsed.field)) return { raw, kind: "UNKNOWN", field: parsed.field };
      return { raw, kind: "EVENT_DAY", field: parsed.field };
    }
    case "currentBar": {
      if (DERIVED_BAR_FIELD_SET.has(parsed.field)) {
        const featureId = DERIVED_BAR_FIELD_TO_FEATURE_ID[parsed.field];
        if (featureId === undefined) {
          // 派生字段白名单里有、桥接表里没有 ⇒ 登记缺口，判为未知（拒绝），不猜同名。
          return { raw, kind: "UNKNOWN", field: parsed.field };
        }
        return { raw, kind: "DERIVED_BAR_FEATURE", field: parsed.field, featureId };
      }
      if (!CURRENT_BAR_FIELD_SET.has(parsed.field)) return { raw, kind: "UNKNOWN", field: parsed.field };
      return { raw, kind: "CURRENT_BAR", field: parsed.field };
    }
    case "labelOnly":
      return { raw, kind: "LABEL_ONLY", field: parsed.field };
    default:
      return { raw, kind: "UNKNOWN", field: raw };
  }
}

/** 是否是可用的策略条件字段（`LABEL_ONLY` / `UNKNOWN` 一律 false）。 */
export function isKnownCoreFieldReference(field: string): boolean {
  const kind = parseCoreFieldReference(field).kind;
  return kind !== "UNKNOWN" && kind !== "LABEL_ONLY";
}

/** 该字段引用对应的特征 id（派生 bar 字段才有；其余为 null）。 */
export function fieldReferenceFeatureId(field: string): string | null {
  const parsed = parseCoreFieldReference(field);
  return parsed.kind === "DERIVED_BAR_FEATURE" ? (parsed.featureId ?? null) : null;
}

/** 拒绝原因（用于把「为什么这个字段不能用」如实写进错误消息）。 */
export function describeUnsupportedField(field: string): string {
  const parsed = parseCoreFieldReference(field);
  switch (parsed.kind) {
    case "LABEL_ONLY":
      return (
        "字段 " + field + " 属于 Dataset 的「前视，仅打标签」层（path.* / outcome.*）：" +
        "作为信号条件输入即构成未来数据泄漏（Look-Ahead Bias），Core 一律拒绝"
      );
    case "UNKNOWN":
      return (
        "字段 " + field + " 无法判定时间域（未知根 / 未知字段 / 形态不匹配）：" +
        "Core 采用「默认拒绝」，而不是「黑名单命中 future 才拒绝」（后者可被命名绕过）"
      );
    default:
      return "字段 " + field + " 可用（kind=" + parsed.kind + "）";
  }
}

/** 该字段引用在当前相对日是否可读（PIT）。 */
export function isFieldReadableAt(field: string, currentRelativeDay: RelativeDay): boolean {
  const parsed = parseCoreFieldReference(field);
  switch (parsed.kind) {
    case "PRE_EVENT":
      return (parsed.relativeDay ?? 0) <= currentRelativeDay;
    case "EVENT_DAY":
      return 0 <= currentRelativeDay;
    case "CURRENT_BAR":
    case "DERIVED_BAR_FEATURE":
      return true;
    case "FORWARD_BAR":
      return (parsed.relativeDay ?? Number.POSITIVE_INFINITY) <= currentRelativeDay;
    default:
      return false;
  }
}
