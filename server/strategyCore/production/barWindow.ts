/**
 * STRATEGY-ARCH-002 — 生产 bar 窗口 → Core 时间语义（**唯一转换入口**）。
 *
 * ## 解决的问题
 *
 * Core 的时间语义是「相对**事件日**（T=0）」：`prefix.rd0.open` = 事件日开盘、
 * `post.rd{n}` = T+n、`bar.*` = 当前被评估的那根 bar。而生产链路（STEP 10 pipeline）
 * 只提供「已按 decisionTime as-of 过滤的绝对日期 bar 序列」——**没有相对日**。
 *
 * 本模块就是那条桥：`CanonicalMarketBar[]` → `VisibleBar[]`（带 `relativeDay`）。
 *
 * ## 🔴 锚定策略：**继承** legacy 既有口径，不另立一套
 *
 * 锚定 = 「哪根 bar 是事件日」。本模块**不发明**该判定，而是继承生产链路里已经在用的
 * 唯一口径 —— `server/research/recipeFeatures/pullbackFeatures.ts#eventBaselineOf`：
 *
 *   > 首板日基准 = `bars` 序列**第一根** bar。
 *
 * 该文件的注释同时登记了它的**已知边界**（「若窗口左边界未预热（`bars[0]` 不是首板日），
 * 特征会偏」）。本模块把这条边界**显式化**为 `anchorPolicy`，写进 RunSnapshot 的
 * `runtimeConfig` ⇒ 「这次跑的锚定是什么」永远是留档事实，而不是散在注释里的假设。
 *
 * 之所以不能在 Core 侧「更聪明地」自己找事件日：那会让同一份策略文档在 Core 与 legacy 上
 * 得到不同的 T=0 ⇒ 两套语义。锚定是**数据绑定**问题，属于运行方（本模块由调用方声明）。
 *
 * ## 与 legacy 的逐项对应（改动前先读）
 *
 * | Core 概念 | 本模块取值 | legacy 对应物 |
 * |---|---|---|
 * | `VisibleBar.relativeDay` | 序列下标（0 = `bars[0]`） | 无（legacy 只有绝对日期） |
 * | 事件日 bar | `bars[0]` | `eventBaselineOf(bars)` |
 * | 当前相对日 | `bars.length - 1` | `decisionBarOf(bars)` = `bars[last]` |
 * | 可见范围 | 全序列（PIT 收窄由 `createDayScopedBarAccess` 在 Runtime 内做） | `visibleBars(...)` |
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import type { CanonicalMarketBar } from "../../data";
import type { RelativeDay } from "../types";
import type { DatasetCapabilityDescriptor } from "../dataRequirements";
import type { BarUniverse, VisibleBar } from "../temporal";

// ---------------------------------------------------------------------------
// 锚定策略（闭集；未登记即拒绝）
// ---------------------------------------------------------------------------

/**
 * 事件锚定策略。
 *
 * - `SERIES_START`：序列第一根 bar = 事件日（**继承 legacy `eventBaselineOf` 口径**）。
 *
 * 将来若接入「按事件表锚定」（每个 event 自带 rd 列），在此登记新策略并同步更新
 * `describeAnchorPolicy`，**不要**在调用点 if/else 里偷偷换口径。
 */
export const EVENT_ANCHOR_POLICIES = ["SERIES_START"] as const;
export type EventAnchorPolicy = (typeof EVENT_ANCHOR_POLICIES)[number];

export const DEFAULT_EVENT_ANCHOR_POLICY: EventAnchorPolicy = "SERIES_START";

/** 人类可读的锚定说明（进 RunSnapshot 的 `notes` / 决策解释）。 */
export function describeAnchorPolicy(policy: EventAnchorPolicy): string {
  switch (policy) {
    case "SERIES_START":
      return "事件锚定 = 序列第一根 bar（继承 recipeFeatures/pullbackFeatures.ts#eventBaselineOf 口径；窗口左边界未预热时会偏）";
    default:
      return "未登记的锚定策略 " + String(policy);
  }
}

// ---------------------------------------------------------------------------
// 转换
// ---------------------------------------------------------------------------

export interface CoreBarWindow {
  /** 交给 `RuntimeContext.visibleData` 的 bar 全集（**升序、relativeDay 唯一**）。 */
  readonly universe: BarUniverse;
  /** 本次评估的当前相对日 = `bars.length - 1`（序列末根 = 决策 bar）。 */
  readonly currentRelativeDay: RelativeDay;
  /** 允许的最远相对日（= 当前相对日；由运行方按声明视界决定）。 */
  readonly maxRelativeDay: RelativeDay;
  /** 事件日（rd=0）的绝对交易日；序列为空时 null。 */
  readonly eventDayDate: string | null;
  readonly anchorPolicy: EventAnchorPolicy;
  readonly barCount: number;
}

export interface ToCoreBarWindowOptions {
  readonly anchorPolicy?: EventAnchorPolicy;
  /**
   * 允许的最远相对日（缺省 = 当前相对日）。
   * 调用方可用它在**不进 Core** 的前提下收窄求值视界（Core 内部仍会二次把关）。
   */
  readonly maxRelativeDay?: RelativeDay;
}

/** 空窗口（无 bar；调用方据此走「数据不足」而非伪造 bar）。 */
export function emptyCoreBarWindow(policy: EventAnchorPolicy = DEFAULT_EVENT_ANCHOR_POLICY): CoreBarWindow {
  return {
    universe: { bars: [] },
    currentRelativeDay: 0,
    maxRelativeDay: 0,
    eventDayDate: null,
    anchorPolicy: policy,
    barCount: 0,
  };
}

/**
 * 由（已 as-of 过滤的）bar 序列构造 Core 窗口。
 *
 * 🔴 `bars` **必须**已按决策时点过滤 —— 本模块**不**做 as-of 过滤（那是 pipeline 的职责，
 * 见 `framework/pipeline.ts` 的 `visibleBars(rawBars, decisionTime.date, decisionTime.point)`）。
 * 在本模块里再过滤一次会形成「两个 PIT 关卡」，且第二个的判据更弱。
 */
export function toCoreBarWindow(
  bars: readonly CanonicalMarketBar[],
  options: ToCoreBarWindowOptions = {},
): CoreBarWindow {
  const anchorPolicy = options.anchorPolicy ?? DEFAULT_EVENT_ANCHOR_POLICY;
  if (!(EVENT_ANCHOR_POLICIES as readonly string[]).includes(anchorPolicy)) {
    throw new Error(
      "未登记的事件锚定策略 " + String(anchorPolicy) + "（已登记：" + EVENT_ANCHOR_POLICIES.join("、") + "）—— 拒绝猜测口径",
    );
  }
  if (bars.length === 0) return emptyCoreBarWindow(anchorPolicy);

  const visible: VisibleBar[] = bars.map((bar, index) => ({
    date: bar.timestamp,
    relativeDay: index,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    amount: bar.amount,
    preClose: bar.preClose ?? null,
  }));

  const currentRelativeDay = (bars.length - 1) as RelativeDay;
  const maxRelativeDay = options.maxRelativeDay ?? currentRelativeDay;

  return {
    universe: { bars: visible, maxRelativeDay },
    currentRelativeDay,
    maxRelativeDay,
    eventDayDate: bars[0]?.timestamp ?? null,
    anchorPolicy,
    barCount: bars.length,
  };
}

/**
 * 数据兼容性能力声明（喂 `RuntimeContext.datasetCapability`）。
 *
 * **如实声明**：本窗口由日频 OHLCV 行投影而来 ⇒ `1D` / `OHLCV`；`availableHistory` 取
 * **本次最短的 bar 根数**（不是最长 —— 兼容性校验必须对**最坏情况**成立）；
 * `maxRelativeDay` 取本次观测到的最远相对日（视界校验据它判定）。
 *
 * 🔴 不编造：`eventCount` **不填**（本模块数不出「事件数」，那是数据集层的量）⇒ 兼容性报告
 * 对 `minEvents` 给出「未知，跳过」而不是「满足」。
 */
export function coreDatasetCapability(input: {
  readonly anchorPolicy: EventAnchorPolicy;
  readonly eventTypes?: readonly string[];
  /**
   * 数据集在**事件日之后**的覆盖深度（最远相对日）。
   *
   * 🔴 刻意可选：**逐决策日求值时这个量不可知** —— 在 rd=1 那一刻，可见 bar 只到 rd=1，
   * 而数据集可能覆盖到 rd=5。此时**不填**（Core 语义 = 「未知 ⇒ 不做视界校验」），
   * 把「读不读得到未来」交给 PIT 关卡（`createDayScopedBarAccess`）负责。
   * 编一个 `maxRelativeDay = 当前相对日` 会**误杀**所有早期决策日。
   *
   * 运行级的视界校验应在装配层用**整个数据集**做一次（那才拿得到真实覆盖深度）。
   */
  readonly horizonRelativeDay?: RelativeDay;
  /** 本次运行中**最短**的 bar 序列长度（lookback 校验的最坏情况）。 */
  readonly minBarCount: number;
}): DatasetCapabilityDescriptor {
  return {
    frequency: "1D",
    availableFields: ["open", "high", "low", "close", "volume", "amount"],
    availableDomains: ["OHLCV"],
    eventTypes: [...(input.eventTypes ?? [])].sort(),
    ...(input.horizonRelativeDay === undefined ? {} : { maxRelativeDay: input.horizonRelativeDay }),
    availableHistory: Math.max(1, input.minBarCount),
  };
}
