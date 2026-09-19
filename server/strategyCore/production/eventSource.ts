/**
 * STRATEGY-ARCH-002 — 生产侧**事件判定器**（Core 要求运行方注入的那一个）。
 *
 * ## 为什么必须在这里注入，而不是进 Core
 *
 * `StrategyRuntime` 的硬纪律（ARCH-001 §12）：**Core 不绑定 Dataset**，事件语义
 * （`FIRST_LIMIT_UP` 到底怎么算）必须由**运行方**提供；未注入 ⇒ 响亮抛错
 * （不静默返回 false —— 否则「没接事件源」会被伪装成「当日无事件」）。
 *
 * 生产链路里真正知道「这份数据集是不是事件窗、事件参数是什么」的层是**装配层**
 * （它读策略文档、绑定 `datasetVersionId`）。⇒ 事件判定器由装配层构造并注入。
 *
 * ## 判定口径（全部来自**声明**，没有一条是本模块发明的）
 *
 * | 输入 | 来源 |
 * |---|---|
 * | 事件类型闭集 | 策略文档 `definition.entry.event.type` |
 * | 锚定日 = rd 0 | `barWindow.ts#toCoreBarWindow`（继承 `eventBaselineOf`） |
 * | 涨停判定阈值 | 策略文档 `definition.entry.event.params.limitUpRatio` |
 * | 「首板」性 | **不在本窗口可验证** ⇒ 委托给数据集定义（`dataset_definition`）本身，如实登记 |
 *
 * 三条判定结果，彼此**可辨**（禁把「不知道」混进「不成立」）：
 *
 *   ① 锚定 bar 可用 且 涨幅 ≥ `limitUpRatio` ⇒ **发生**（true）；
 *   ② 锚定 bar 可用 但涨幅 < 阈值 ⇒ **未发生**（false）—— 这是真实的「否」；
 *   ③ 锚定 bar 缺 OHLC ⇒ **无法判定**：返回 false（与 legacy `eventBaselineOf` 返回 null
 *      ⇒ 特征 null ⇒ 证券被剔除 **逐字一致**），并**计数**到决策摘要
 *      `undecidableAnchorCount`，由 RunRecord 持久化 —— 可辨，不静默。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import { StrategyCoreError, type CoreValue } from "../types";
import type { EventOccurrenceResolver, RuntimeContext } from "../runtime";

// ---------------------------------------------------------------------------
// 数据集事件源声明（由装配层给出）
// ---------------------------------------------------------------------------

export interface DatasetEventSourceDeclaration {
  /**
   * 该数据集是否为「事件窗」数据集（每证券：rd 0 = 事件日 + 若干后续日）。
   *
   * `false` ⇒ **拒绝构造**（不是静默不判定）：非事件窗数据集上跑事件型策略，
   * 「rd 0 是事件日」这条前提不成立，静默跑出来的结果没有意义。
   */
  readonly eventAnchored: boolean;
  /** 该数据集承载的事件类型闭集（来自策略文档声明）。非空。 */
  readonly eventTypes: readonly string[];
  /**
   * 涨停判定阈值（来自 `entry.event.params.limitUpRatio`）。
   * `null` ⇒ 文档未声明 ⇒ **不做涨停校验**（并在 notes 里如实写出来），
   * 而不是替它猜一个 A 股常用值。
   */
  readonly limitUpRatio: number | null;
  /** 声明来源（如实写进快照 notes / 决策解释，便于审计是谁说的）。 */
  readonly declaredBy: string;
}

export interface ProductionEventResolver {
  readonly resolve: EventOccurrenceResolver;
  /**
   * 同判定、**不计数**的解析器（供「首个成立日」辅助求值使用）。
   *
   * 🔴 为什么需要它：生产层为了判定「今天是不是触发日」，会额外求一次「截到昨天的窗口」。
   * 那次求值只是**探针**，不是一次真实决策 —— 若它也计数，Run Record 里的
   * `occurredEventCount` / `decisionCount` 会被凭空放大（实测 2×）。
   */
  readonly resolveQuiet: EventOccurrenceResolver;
  /** 无法判定「事件是否发生」的次数（锚定 bar 缺 OHLC）—— 由调用方持久化。 */
  readonly undecidableCount: () => number;
  /** 判定为「发生」的次数。 */
  readonly occurredCount: () => number;
  /** 判定为「明确未发生」的次数（锚定 bar 可用但涨幅不足）。 */
  readonly notOccurredCount: () => number;
  /** 人类可读口径说明（进 RunSnapshot.notes）。 */
  readonly notes: readonly string[];
}

/**
 * 构造生产事件判定器（**唯一入口**）。
 *
 * 抛错条件（全部响亮）：非事件窗数据集 / 事件类型闭集为空 / `limitUpRatio` 非法。
 */
export function createDatasetEventResolver(
  declaration: DatasetEventSourceDeclaration,
): ProductionEventResolver {
  if (!declaration.eventAnchored) {
    throw new StrategyCoreError(
      "CORE_DEFINITION_INVALID",
      "数据集事件源声明 eventAnchored=false：该数据集不是事件窗数据集（rd 0 不是事件日），" +
        "拒绝在其上运行事件型策略 —— 静默跑出来的候选没有事件语义。",
      { declaredBy: declaration.declaredBy },
    );
  }
  const eventTypes = [...new Set(declaration.eventTypes.map((type) => String(type).trim()).filter((type) => type !== ""))];
  if (eventTypes.length === 0) {
    throw new StrategyCoreError(
      "CORE_DEFINITION_INVALID",
      "数据集事件源声明缺少事件类型闭集（eventTypes 为空）：无法判定任何事件是否发生。",
      { declaredBy: declaration.declaredBy },
    );
  }
  const ratio = declaration.limitUpRatio;
  if (ratio !== null && (!Number.isFinite(ratio) || ratio <= 0)) {
    throw new StrategyCoreError(
      "CORE_DEFINITION_INVALID",
      "limitUpRatio 必须是 > 0 的有限数字或 null，实际 " + JSON.stringify(ratio),
      { declaredBy: declaration.declaredBy },
    );
  }

  // 浮点安全余量：价格按元计、两位小数，`close >= preClose*(1+ratio)` 在 ratio=0.1 时
  // 理论等号（1.10 元）因二进制表示可能差 1e-16 ⇒ 用 1e-6 的**相对**余量。
  // 这是**判定容差**，不是业务参数（不进指纹）。
  const EPSILON = 1e-6;

  let undecidable = 0;
  let occurred = 0;
  let notOccurred = 0;

  /** 纯判定（**不计数**）—— 计数一律由 `counting` 包一层，避免探针求值放大计数。 */
  const judge = (eventType: string, context: RuntimeContext): boolean | "UNDECIDABLE" => {
    if (!eventTypes.includes(eventType)) {
      throw new StrategyCoreError(
        "CORE_DEFINITION_INVALID",
        "事件判定器收到未声明的事件类型 `" + eventType + "`（本数据集声明：" + eventTypes.join("、") + "）" +
          "—— 拒绝静默返回 false（那会把「数据集不支持该事件」伪装成「当日无事件」）。",
        { eventType },
      );
    }

    const anchor = context.visibleData.bars.find((bar) => bar.relativeDay === 0) ?? null;
    if (anchor === null) {
      // 窗口里没有 rd 0：锚定不成立。这是**结构性问题**（不是数据不足）⇒ 响亮抛错。
      throw new StrategyCoreError(
        "CORE_DEFINITION_INVALID",
        "事件判定：可见窗口内没有相对日 0 的 bar（窗口左边界未覆盖事件日）—— 锚定不成立，拒绝判定。",
        { eventType },
      );
    }

    // 文档未声明涨停阈值 ⇒ 不做校验（锚定日由数据集定义保证）。
    if (ratio === null) return true;

    const { close, preClose } = anchor;
    if (
      typeof close !== "number" || !Number.isFinite(close) ||
      typeof preClose !== "number" || !Number.isFinite(preClose) || preClose <= 0
    ) {
      // 无法判定（与 legacy `eventBaselineOf` 返回 null 的行为一致：该证券被剔除）。
      return "UNDECIDABLE";
    }

    const limitUpPrice = preClose * (1 + ratio);
    return close + EPSILON * Math.abs(limitUpPrice) >= limitUpPrice;
  };

  /** 计数包装（**只用于真实决策**；探针走 `resolveQuiet`）。 */
  const counting: EventOccurrenceResolver = (eventType, _params, context) => {
    const verdict = judge(eventType, context);
    if (verdict === "UNDECIDABLE") {
      undecidable += 1;
      return false;
    }
    if (verdict) {
      occurred += 1;
    } else {
      notOccurred += 1;
    }
    return verdict;
  };

  return {
    resolve: counting,
    resolveQuiet: (eventType, _params, context) => judge(eventType, context) === true,
    undecidableCount: () => undecidable,
    occurredCount: () => occurred,
    notOccurredCount: () => notOccurred,
    notes: [
      "事件判定器口径（生产）：锚定日 = 相对日 0（" + declaration.declaredBy + " 声明该数据集为事件窗）",
      ratio === null
        ? "limitUpRatio 未在策略文档声明 ⇒ **运行期不做涨停校验**（锚定日的首板性由数据集定义承担），仅要求锚定 bar 的 close/preClose 可用"
        : "涨停校验：close >= preClose × (1 + " + String(ratio) + ")（阈值来自策略文档 entry.event.params.limitUpRatio）",
      "「首板性」（rd-1 非涨停）**不在本窗口可验证**，由数据集定义（dataset_definition）承担 —— 如实登记，不伪装成运行期已校验",
    ],
  };
}
