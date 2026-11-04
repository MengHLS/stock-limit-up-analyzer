/**
 * STRATEGY-ARCH-001 — Leakage Guard（规格 §15）。
 *
 * 核心规则（唯一表述）：
 *
 *   StrategyRuntime.evaluate(T) 只能访问 informationAvailableAt(T)
 *
 * 🔴 与 legacy 的关键差别（这是本次改造最要紧的一条）：
 *   legacy 的 `LeakageGuard.assertNoLookAhead` 本身逻辑是对的，但**它比较的对象是
 *   一个恒为远古日期的静态声明**（配方特征 `samePointAvailability` 把
 *   `requiredDataThrough` / `availableAt` 恒置 `1990-01-01`）⇒ **守卫恒通过**，
 *   等于没有防护；且 `conditionSignal/compile.ts` 根本不调用它。
 *
 *   Core 的做法（三层，缺一层都不算落实）：
 *     ① **静态审计**：`auditDefinitionLeakage()` 在图结构上判定
 *        「字段引用是否越界 / 特征是否声明了未来依赖 / 特征可用时点与决策时点是否矛盾」；
 *     ② **运行时关卡**：`DayScopedBarAccess` 在访问点比对「读 rd」与「当前决策日 rd」，
 *        越界即**记录违规**（不是静默 null）；
 *     ③ **产出前断言**：`assertNoViolations()` 在 Runtime 产出决策前检查，
 *        非空即抛 `LEAKAGE_LOOK_AHEAD`。
 *
 * 覆盖范围（规格 §15）：future OHLC / future volume / future feature / future outcome /
 * future return —— 全部落在「① 的字段时间域 + ② 的访问关卡」上。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import {
  STRATEGY_CORE_ERROR_CODES,
  StrategyCoreError,
  type EvaluationTime,
  type RelativeDay,
  type StrategyCoreErrorCode,
} from "./types";
import { collectFeatureReferences, collectFieldReferences, type ValueExpression } from "./expression";
import { parseCoreFieldReference, describeUnsupportedField, fieldReferenceFeatureId } from "./fieldReference";
import type { FeatureLeakageDeclaration, FeatureRegistry } from "./featureRegistry";
import { collectRuleWindows, walkRule, type RuleNode } from "./ruleGraph";
import type { VisibilityViolation } from "./temporal";

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

export interface LeakageFinding {
  readonly code: StrategyCoreErrorCode;
  readonly path: string;
  readonly message: string;
  readonly raw: string;
}

export interface LeakageAuditOptions {
  readonly featureRegistry?: FeatureRegistry;
  /** 决策时点（用于判定「特征可用时点 vs 决策时点」）。缺省 = 不判定这一项。 */
  readonly decisionPoint?: "open" | "close";
}

/** 收集 Definition 内全部字段 / 特征引用的位置（路径 + 值）。 */
interface ReferenceSite {
  readonly path: string;
  readonly kind: "field" | "feature";
  readonly value: string;
}

function collectReferenceSites(definition: {
  readonly ruleGraph: RuleNode;
  readonly exitRuleGraph: RuleNode | null;
  readonly exitRules?: readonly { readonly id: string; readonly condition: RuleNode | null }[];
}): readonly ReferenceSite[] {
  const sites: ReferenceSite[] = [];
  const roots: readonly (readonly [string, RuleNode])[] = [
    ["ruleGraph", definition.ruleGraph],
    ...(definition.exitRuleGraph === null ? [] : ([["exitRuleGraph", definition.exitRuleGraph]] as const)),
    ...((definition.exitRules ?? [])
      .filter((rule) => rule.condition !== null)
      .map((rule) => ["exitRule:" + rule.id, rule.condition as RuleNode] as const)),
  ];
  for (const [rootName, root] of roots) {
    let counter = 0;
    walkRule(root, (node) => {
      counter += 1;
      const at = rootName + "#" + String(counter) + "[" + node.kind + "]";
      const expressions: readonly ValueExpression[] =
        node.kind === "CONDITION" ? [node.left, node.right] : [];
      for (const expression of expressions) {
        for (const field of collectFieldReferences(expression)) {
          sites.push({ path: at, kind: "field", value: field });
          // 🔴 `bar.<派生字段>`（volumeRatio 等）在 Runtime 里由**特征**承载 ⇒
          //    它的 availability 声明也必须被审计，否则「声明了 close 可得却在 open 时用」
          //    这类矛盾会绕过本守卫（实测：仅扫 FEATURE_REFERENCE 会漏掉全部 `bar.*` 派生写法）。
          const bridged = fieldReferenceFeatureId(field);
          if (bridged !== null) sites.push({ path: at, kind: "feature", value: bridged });
        }
        for (const featureId of collectFeatureReferences(expression)) {
          sites.push({ path: at, kind: "feature", value: featureId });
        }
      }
    });
  }
  return sites;
}

/**
 * 静态泄漏审计（规格 §15 的 ①）。
 *
 * 判定项（逐条给独立 code，便于报告区分）：
 *   A1 `LABEL_ONLY` 字段（`path.*` / `outcome.*`）→ 未来标签层，禁止作为条件输入；
 *   A2 `UNKNOWN` 时间域 → 默认拒绝；
 *   A3 `prefix.rd{n}`（n > 0）→ 形态上属于「前缀」但值是未来的，一律拒绝；
 *   A4 `post.rd{n}`（n > 最早可引用偏移）→ 前视越界；
 *   A5 特征声明 `usesForwardData=true` → 未来结果类变量；
 *   A6 特征声明 `dataThroughRelativeDay > 0` → 需要未来数据；
 *   A7 决策时点为 `open` 而特征声明 `availableAtPoint=close` → 时点矛盾。
 */
export function auditDefinitionLeakage(
  definition: {
    readonly ruleGraph: RuleNode;
    readonly exitRuleGraph: RuleNode | null;
    readonly exitRules?: readonly { readonly id: string; readonly condition: RuleNode | null }[];
    readonly executionSemantics?: { readonly signalTiming: "T_OPEN" | "T_CLOSE" };
  },
  options: LeakageAuditOptions = {},
): readonly LeakageFinding[] {
  const findings: LeakageFinding[] = [];
  const sites = collectReferenceSites(definition);

  // 决策时点：显式传入优先，否则由 executionSemantics.signalTiming 推出（判定一次、结论一致）。
  const decisionPoint: "open" | "close" | undefined =
    options.decisionPoint ??
    (definition.executionSemantics === undefined
      ? undefined
      : definition.executionSemantics.signalTiming === "T_OPEN"
        ? "open"
        : "close");

  // A4 的界：最早可引用偏移 = 所有 WINDOW 的最小 start。
  // 🔴 无 WINDOW（纯条件策略）⇒ 静态层**无法**界定「最早信号偏移」⇒ 不设界（+∞），
  //    把「读 post.rd{n} 是否越界」交给**运行时关卡**（它按当前决策日逐次判定）。
  //    这符合本模块的原则：静态层只证明它证得出的东西，不用一个编造的界去误杀合法定义。
  const windows = [
    ...collectRuleWindows(definition.ruleGraph),
    ...(definition.exitRuleGraph === null ? [] : collectRuleWindows(definition.exitRuleGraph)),
    ...((definition.exitRules ?? [])
      .filter((rule) => rule.condition !== null)
      .flatMap((rule) => [...collectRuleWindows(rule.condition as RuleNode)])),
  ];
  const maxReferencableOffset: RelativeDay =
    windows.length === 0 ? Number.POSITIVE_INFINITY : windows.reduce((min, window) => Math.min(min, window.start), windows[0]?.start ?? 0);

  for (const site of sites) {
    if (site.kind === "field") {
      const parsed = parseCoreFieldReference(site.value);
      switch (parsed.kind) {
        case "LABEL_ONLY":
          findings.push({
            code: "LEAKAGE_LOOK_AHEAD",
            path: site.path,
            raw: site.value,
            message: "A1 " + describeUnsupportedField(site.value),
          });
          break;
        case "UNKNOWN":
          findings.push({
            code: "LEAKAGE_UNKNOWN_TIME_DOMAIN",
            path: site.path,
            raw: site.value,
            message: "A2 " + describeUnsupportedField(site.value),
          });
          break;
        case "PRE_EVENT": {
          const offset = parsed.relativeDay ?? 0;
          if (offset > 0) {
            findings.push({
              code: "LEAKAGE_LOOK_AHEAD",
              path: site.path,
              raw: site.value,
              message:
                "A3 prefix.rd 的相对日 " + String(offset) + " > 0 —— 形态上写了「前缀」但值是事件日之后的行情，" +
                "属于未来数据（一律拒绝；要用未来行情请显式写 post.rd" + String(offset) + "）",
            });
          }
          break;
        }
        case "FORWARD_BAR": {
          const offset = parsed.relativeDay ?? Number.POSITIVE_INFINITY;
          if (offset > maxReferencableOffset) {
            findings.push({
              code: "LEAKAGE_LOOK_AHEAD",
              path: site.path,
              raw: site.value,
              message:
                "A4 引用 post.rd" +
                String(offset) +
                " 超出可引用范围（最早可产生信号的相对日为 T+" +
                String(maxReferencableOffset) +
                "）：在该 bar 上求值会读到未来数据",
            });
          }
          break;
        }
        default:
          break;
      }
      continue;
    }

    // 特征引用
    const registry = options.featureRegistry;
    if (registry === undefined) continue;
    const found = registry.get(site.value);
    if (found === null) continue; // 未注册由 definition 校验负责报错，这里不重复
    findings.push(...auditFeatureLeakage(found.featureId, found.leakage, site.path, decisionPoint));
  }

  return findings;
}

/** 单个特征的泄漏判定（供静态审计与运行时复用）。 */
export function auditFeatureLeakage(
  featureId: string,
  leakage: FeatureLeakageDeclaration,
  path: string,
  decisionPoint?: "open" | "close",
): readonly LeakageFinding[] {
  const findings: LeakageFinding[] = [];
  if (leakage.usesForwardData) {
    findings.push({
      code: "LEAKAGE_LOOK_AHEAD",
      path,
      raw: featureId,
      message: "A5 特征 " + featureId + " 声明 usesForwardData=true（未来结果类变量），禁止参与策略决策",
    });
  }
  if (leakage.dataThroughRelativeDay > 0) {
    findings.push({
      code: "LEAKAGE_LOOK_AHEAD",
      path,
      raw: featureId,
      message:
        "A6 特征 " + featureId + " 声明 dataThroughRelativeDay=" + String(leakage.dataThroughRelativeDay) + "（> 0 ⇒ 需要未来数据）",
    });
  }
  if (decisionPoint === "open" && leakage.availableAtPoint === "close") {
    findings.push({
      code: "LEAKAGE_LOOK_AHEAD",
      path,
      raw: featureId,
      message:
        "A7 决策时点为开盘（T_OPEN），而特征 " + featureId + " 声明在收盘才可用（availableAtPoint=close）—— 该时点上取不到它",
    });
  }
  return findings;
}

/** 非空即抛（静态审计入口）。 */
export function assertNoDefinitionLeakage(findings: readonly LeakageFinding[]): void {
  if (findings.length === 0) return;
  throw new StrategyCoreError(
    "LEAKAGE_LOOK_AHEAD",
    findings.map((finding) => finding.path + ": " + finding.message).join(" | "),
    { findingCount: findings.length },
  );
}

// ---------------------------------------------------------------------------
// 运行时关卡（规格 §15 的 ② / ③）
// ---------------------------------------------------------------------------

/** 运行时泄漏守卫。 */
export const LeakageGuard = {
  /**
   * 特征可用性 vs 决策时点（**声明是相对当前 bar 的，因此这里能真正判定**）。
   * `availableAtPoint=close` 的特征在 `open` 时点的决策中不可用 ⇒ 抛错。
   */
  assertFeatureUsable(featureId: string, leakage: FeatureLeakageDeclaration, asOf: EvaluationTime): void {
    const findings = auditFeatureLeakage(featureId, leakage, "feature:" + featureId, asOf.point);
    assertNoDefinitionLeakage(findings);
  },

  /** 字段引用在当前相对日是否可读（PIT）。 */
  assertFieldReadable(field: string, currentRelativeDay: RelativeDay, path: string): void {
    const parsed = parseCoreFieldReference(field);
    if (parsed.kind === "LABEL_ONLY" || parsed.kind === "UNKNOWN") {
      throw new StrategyCoreError("LEAKAGE_LOOK_AHEAD", path + ": " + describeUnsupportedField(field), { raw: field });
    }
    if (parsed.kind === "FORWARD_BAR") {
      const offset = parsed.relativeDay ?? Number.POSITIVE_INFINITY;
      if (offset > currentRelativeDay) {
        throw new StrategyCoreError(
          "LEAKAGE_LOOK_AHEAD",
          path +
            ": 在 " +
            String(currentRelativeDay) +
            " 日求值却引用了 post.rd" +
            String(offset) +
            "（未来数据）",
          { raw: field, currentRelativeDay: currentRelativeDay, referencedDay: offset },
        );
      }
    }
    if (parsed.kind === "PRE_EVENT") {
      const offset = parsed.relativeDay ?? 0;
      if (offset > currentRelativeDay) {
        throw new StrategyCoreError(
          "LEAKAGE_LOOK_AHEAD",
          path + ": 在 " + String(currentRelativeDay) + " 日求值却引用了 prefix.rd" + String(offset) + "（未来数据）",
          { raw: field, currentRelativeDay: currentRelativeDay, referencedDay: offset },
        );
      }
    }
  },

  /** 产出决策前检查访问关卡记下的违规（**非空即抛**）。 */
  assertNoViolations(violations: readonly VisibilityViolation[]): void {
    if (violations.length === 0) return;
    const detail = violations
      .map((violation) => "读 " + String(violation.relativeDay) + " 日（当前 " + String(violation.requestedAtDay) + " 日，" + violation.reason + "）")
      .join(" | ");
    throw new StrategyCoreError(
      "LEAKAGE_LOOK_AHEAD",
      "本次决策发生了 " + String(violations.length) + " 次未来数据读取：" + detail,
      { violationCount: violations.length },
    );
  },
};

/** 宽松探针用：把违规整理成可序列化数组（供报告 / 测试断言，不抛错）。 */
export function summarizeViolations(
  violations: readonly VisibilityViolation[],
): readonly { readonly relativeDay: RelativeDay; readonly requestedAtDay: RelativeDay; readonly reason: string }[] {
  return violations.map((violation) => ({
    relativeDay: violation.relativeDay,
    requestedAtDay: violation.requestedAtDay,
    reason: violation.reason,
  }));
}

/** 由错误码判定是否为泄漏类错误（供上层分类，不重复写字符串）。 */
export function isLeakageErrorCode(code: string): boolean {
  return (STRATEGY_CORE_ERROR_CODES as readonly string[]).includes(code) && (code === "LEAKAGE_LOOK_AHEAD" || code === "LEAKAGE_UNKNOWN_TIME_DOMAIN");
}

/** 供调用方构造「已知安全」的特征声明（测试与内置特征使用）。 */
export function knownSafeLeakage(
  availableAtPoint: "open" | "close" = "close",
  dataThroughRelativeDay: RelativeDay = 0,
): FeatureLeakageDeclaration {
  return { usesForwardData: false, dataThroughRelativeDay, availableAtPoint };
}

/** 供调用方构造「未来结果类」声明（**仅用于测试「守卫确实拦得住」**）。 */
export function futureOutcomeLeakage(): FeatureLeakageDeclaration {
  return { usesForwardData: true, dataThroughRelativeDay: 1, availableAtPoint: "close" };
}
