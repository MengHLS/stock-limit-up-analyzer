/**
 * OOS-001 §10 — IS / OOS 对照（**纯函数**，零 IO、零指标重算）。
 *
 * ## 本模块只做「事实与比较」，不做「结论」
 *
 * 规格 §10 末句与 §15 明禁：
 *
 * > 不要在本任务定义「优秀 / 最优 / 推荐」结论。OOS 模块负责事实与比较，
 * > 不负责自动选策略。
 *
 * ⇒ 本文件**不得**出现 `best` / `optimal` / `winner` / `recommend` 一类词汇
 *   （由源码扫描守卫测试钉住；那条测试同时带负例自测，确保它不是空转）。
 *
 * ## 语义（逐条写清，避免「同一个词两种意思」）
 *
 * | 量 | 定义 | 单位 |
 * | --- | --- | --- |
 * | `*Delta` | `OOS − IS` | 百分点 / 笔 |
 * | `*Ratio` | `OOS / IS`（**IS = 0 或任一侧不可用 ⇒ `null`**） | 无量纲 |
 * | `totalReturnDegradationPct` | `IS − OOS`（**正数 = 样本外下降**） | 百分点 |
 * | `drawdownChangePct` | `OOS − IS`（**正数 = 样本外回撤加深**） | 百分点 |
 * | `tradeCountChange` | `OOS − IS`（**正数 = 样本外交易更频繁**） | 笔 |
 *
 * 🔴 `delta` 与 `degradation` 是**同一个差的相反数** —— 刻意都提供：
 *   「回撤变化」与「收益退化」在同一张表里若共用一种符号，读者必然读错一次。
 *   每个量的符号方向都写进字段名（`Degradation` / `Change`）与本注释，不靠约定。
 *
 * 🔴 不可用一律 `null`，**绝不用 0 顶替**：`0` 是「没有变化」这一**事实**，
 *   与「算不出来」是完全不同的两件事（本仓已有真实教训：`stabilityRatio` 0 vs null）。
 */

import type { OosComparisonView, OosMetricsView } from "../../../shared/oosValidationContracts";

/** 可空标量的差（任一侧不可用 ⇒ null；非有限数一律视为不可用）。 */
function deltaOf(oos: number | null, is: number | null): number | null {
  if (!isUsable(oos) || !isUsable(is)) return null;
  const value = oos - is;
  return Number.isFinite(value) ? value : null;
}

/** 可空标量的比（IS = 0 或任一侧不可用 ⇒ null；**不做除零**）。 */
function ratioOf(oos: number | null, is: number | null): number | null {
  if (!isUsable(oos) || !isUsable(is)) return null;
  if (is === 0) return null;
  const value = oos / is;
  return Number.isFinite(value) ? value : null;
}

function isUsable(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** 逐指标对照的字段对（保证「新增指标时不会漏算一处」）。 */
const COMPARED_KEYS = [
  ["totalReturnPct", "totalReturnPctDelta", "totalReturnPctRatio"],
  ["annualizedReturnPct", "annualizedReturnPctDelta", "annualizedReturnPctRatio"],
  ["maxDrawdownPct", "maxDrawdownPctDelta", "maxDrawdownPctRatio"],
  ["tradeCount", "tradeCountDelta", "tradeCountRatio"],
  ["winRatePct", "winRatePctDelta", "winRatePctRatio"],
  ["profitFactor", "profitFactorDelta", "profitFactorRatio"],
] as const;

/**
 * 组装 IS / OOS 对照。
 *
 * 两侧读数都是**已有事实**（IS = 源结果冻结副本；OOS = 本次重跑读数），本函数只做算术。
 */
export function buildOosComparison(input: {
  readonly is: OosMetricsView;
  readonly oos: OosMetricsView;
  /** 源结果是否可用（不可用时对照必然不成立，如实说明原因）。 */
  readonly isAvailable: boolean;
}): OosComparisonView {
  const notes: string[] = [];
  const partial: Record<string, number | null> = {};
  let comparableCount = 0;
  const missing: string[] = [];

  for (const [valueKey, deltaKey, ratioKey] of COMPARED_KEYS) {
    const isValue = input.is[valueKey];
    const oosValue = input.oos[valueKey];
    partial[deltaKey] = deltaOf(oosValue, isValue);
    partial[ratioKey] = ratioOf(oosValue, isValue);
    if (isUsable(isValue) && isUsable(oosValue)) comparableCount += 1;
    else missing.push(valueKey);
  }

  /**
   * 🔴 `comparable` 必须**同时**要求「源结果可用」与「至少一对指标可比」。
   *
   *   为什么：`comparableCount` 是**事实计数**（有几对指标两侧都有值），
   *   而 `comparable` 是**语义结论**（这次对照成立吗）。若源结果本身不可用
   *   （`isAvailable = false`，例如源结果行缺失），那么「样本外相对样本内如何」
   *   这个问题**根本没有基线**，无论调用方递进来的 IS 数字长什么样。
   *   早期实现里 `comparable = comparableCount > 0` 会让 `comparable: true` 与
   *   note 里的「对照不成立」**自相矛盾** —— 同一份产物里两个字段互相打脸，
   *   下游无论信哪个都可能错。
   */
  const comparable = input.isAvailable && comparableCount > 0;
  if (!input.isAvailable) {
    notes.push(
      "IS 侧读数不可用（源 Search 结果缺失或指标为 null）⇒ 对照不成立。"
      + "本域不做任何估计或补值：OOS 读数照常落库，但「样本外相对样本内如何」这一问题本次无答案。",
    );
  } else if (missing.length > 0) {
    notes.push(
      `以下 ${String(missing.length)} 项指标两侧未能同时取到（任一侧为 null）`
      + `⇒ 其 delta / ratio 如实为 null：${missing.join(" / ")}。`,
    );
  }
  if (!comparable) {
    notes.push("没有任何一项指标两侧同时可用 ⇒ 本次对照不成立（`comparable = false`）。");
  }

  const tradeCountDelta = partial["tradeCountDelta"] ?? null;
  if (tradeCountDelta !== null && tradeCountDelta < 0) {
    notes.push(
      `样本外成交笔数**少于**样本内（${String(tradeCountDelta)} 笔）—— `
      + "这是如实读数，本域不对其做「好 / 坏」判定。",
    );
  }

  return {
    comparableCount,
    totalReturnPctDelta: partial["totalReturnPctDelta"] ?? null,
    totalReturnPctRatio: partial["totalReturnPctRatio"] ?? null,
    annualizedReturnPctDelta: partial["annualizedReturnPctDelta"] ?? null,
    annualizedReturnPctRatio: partial["annualizedReturnPctRatio"] ?? null,
    maxDrawdownPctDelta: partial["maxDrawdownPctDelta"] ?? null,
    maxDrawdownPctRatio: partial["maxDrawdownPctRatio"] ?? null,
    tradeCountDelta,
    tradeCountRatio: partial["tradeCountRatio"] ?? null,
    winRatePctDelta: partial["winRatePctDelta"] ?? null,
    winRatePctRatio: partial["winRatePctRatio"] ?? null,
    profitFactorDelta: partial["profitFactorDelta"] ?? null,
    profitFactorRatio: partial["profitFactorRatio"] ?? null,
    // 🔴 方向刻进字段名：正数 = 样本外**下降**（不是「改善」）。
    totalReturnDegradationPct: deltaOf(input.is.totalReturnPct, input.oos.totalReturnPct),
    // 🔴 正数 = 样本外回撤**加深**。
    drawdownChangePct: deltaOf(input.oos.maxDrawdownPct, input.is.maxDrawdownPct),
    tradeCountChange: deltaOf(input.oos.tradeCount, input.is.tradeCount),
    comparable,
    notes,
  };
}
