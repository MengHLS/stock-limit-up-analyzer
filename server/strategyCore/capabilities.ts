/**
 * STRATEGY-ARCH-001 — Capabilities（规格 §14）。
 *
 * 🔴 取代 `backtestType = EVENT_STUDY` 这类「把策略绑死在某一类回测上」的写法：
 *   能力是**策略自身声明的属性**，执行引擎按能力挑选自己需要的 StrategyDecision 片段。
 *
 *   eventObservation  可被 Event Study 消费（事件是否发生 + 事件后观察）
 *   signalGeneration  产生信号（有触发节点）
 *   entryIntent       产生入场意图
 *   exitIntent        产生出场意图
 *   positionIntent    产生仓位意图
 *
 * 🔴 反「声明了却无效」纪律：能力**不手写**，由 RuleGraph 结构**推导**；
 *   `assertCapabilitiesConsistent()` 要求「声明 == 推导」，不一致即抛错。
 *   ⇒ 声明面与实现面永远对得上（这正是 legacy 里 `parameterRole` / `topN` 那类
 *   「声明了却无人消费」缺陷的根治办法）。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import { STRATEGY_CAPABILITIES, StrategyCoreError, type StrategyCapability } from "./types";
import { walkRule, type RuleNode } from "./ruleGraph";

/** 能力推导输入（**只取所需字段**，避免与 `definition.ts` 形成 import 环）。 */
export interface CapabilityDerivationInput {
  readonly ruleGraph: RuleNode;
  readonly exitRuleGraph: RuleNode | null;
  readonly positionSpec: { readonly sizingMethod: string; readonly maxPositions: number };
}

function kinds(root: RuleNode): ReadonlySet<string> {
  const found = new Set<string>();
  walkRule(root, (node) => found.add(node.kind));
  return found;
}

/**
 * 由规则图结构推导能力（唯一权威）。
 *
 * 判据（逐条可测）：
 *   - `ruleGraph` 含 `EVENT` ⇒ `eventObservation`
 *     （Event Study 消费的是「事件 + 事件后观察」，没有事件节点就没有可观察对象）；
 *   - `ruleGraph` 含 `TRIGGER` ⇒ `signalGeneration`（触发是产信号的唯一入口）；
 *   - 有 `signalGeneration` 且有入场图 ⇒ `entryIntent`；
 *   - `exitRuleGraph !== null` ⇒ `exitIntent`；
 *   - `positionSpec.maxPositions >= 1` ⇒ `positionIntent`。
 */
export function deriveCapabilities(input: CapabilityDerivationInput): readonly StrategyCapability[] {
  const entryKinds = kinds(input.ruleGraph);
  const out: StrategyCapability[] = [];
  if (entryKinds.has("EVENT")) out.push("eventObservation");
  const signalGeneration = entryKinds.has("TRIGGER");
  if (signalGeneration) out.push("signalGeneration");
  if (signalGeneration) out.push("entryIntent");
  if (input.exitRuleGraph !== null) {
    const exitKinds = kinds(input.exitRuleGraph);
    if (exitKinds.size > 0) out.push("exitIntent");
  }
  if (Number.isInteger(input.positionSpec.maxPositions) && input.positionSpec.maxPositions >= 1) {
    out.push("positionIntent");
  }
  return [...new Set(out)].sort() as readonly StrategyCapability[];
}

/** 能力闭集校验（防止手写字符串拼错被静默接受）。 */
export function validateCapabilityList(capabilities: readonly StrategyCapability[]): readonly string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (!(STRATEGY_CAPABILITIES as readonly string[]).includes(capability)) {
      issues.push("未知能力 " + String(capability) + "（闭集：" + STRATEGY_CAPABILITIES.join("/") + "）");
    }
    if (seen.has(capability)) issues.push("能力重复声明 " + String(capability));
    seen.add(capability);
  }
  return issues;
}

/**
 * 一致性断言：声明面必须**恰好等于**推导面。
 *
 * 为什么要求「恰好等于」而不是「包含」：只声明不实现 = 死声明（误导消费者）；
 * 只实现不声明 = 消费者看不到（等于没实现）。两种都必须响亮暴露。
 */
export function assertCapabilitiesConsistent(
  declared: readonly StrategyCapability[],
  derived: readonly StrategyCapability[],
): void {
  const listIssues = validateCapabilityList(declared);
  if (listIssues.length > 0) {
    throw new StrategyCoreError("CAPABILITIES_MISMATCH", listIssues.join(" | "));
  }
  const declaredSet = new Set(declared);
  const derivedSet = new Set(derived);
  const missing = [...derivedSet].filter((capability) => !declaredSet.has(capability)).sort();
  const extra = [...declaredSet].filter((capability) => !derivedSet.has(capability)).sort();
  if (missing.length === 0 && extra.length === 0) return;
  const parts: string[] = [];
  if (missing.length > 0) parts.push("声明缺少（规则图已实现但未声明）：" + missing.join("、"));
  if (extra.length > 0) parts.push("多声明（声明了但规则图不产生）：" + extra.join("、"));
  throw new StrategyCoreError("CAPABILITIES_MISMATCH", parts.join("；"), {
    missingCount: missing.length,
    extraCount: extra.length,
  });
}

/** 「该策略能否被 Event Study 消费」——唯一判据。 */
export function supportsEventStudy(capabilities: readonly StrategyCapability[]): boolean {
  return capabilities.includes("eventObservation");
}

/** 「该策略能否被 Signal / Portfolio Backtest 消费」——唯一判据。 */
export function supportsTrading(capabilities: readonly StrategyCapability[]): boolean {
  return capabilities.includes("signalGeneration") && capabilities.includes("entryIntent");
}
