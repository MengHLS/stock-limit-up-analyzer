/**
 * STEP 7.7 — Adjustment Engine（确定性复权引擎）。
 *
 * 纯函数、无副作用：输入「raw bar + adjustment data」输出「adjusted bar」，
 * 绝不修改 raw 数据（不原地改写，不覆盖 raw close）。
 *
 * 核心数学约定（A 股复权，以「每股」为单位的税前口径）：
 *   给定某一交易日（ex-date）的除权除息事件组合，令 preClose 为除权前最近收盘价：
 *     cash  = Σ 每股现金分红（元）
 *     bonus = Σ 每股送股
 *     trans = Σ 每股转增
 *     rights= Σ 每股配股，rightsPrice = 配股价
 *     除权除息价 = (preClose - cash + rights * rightsPrice) / (1 + bonus + trans + rights)
 *   → 前向因子（ex_ratio，价格在 ex-date 的“下跌比例”）：
 *        f = (preClose - cash + rights * rightsPrice) / (preClose * (1 + bonus + trans + rights))
 *   → 拆股（1 拆 N）：f = 1 / N
 *   → 合股（N 合 1）：f = N
 *
 * 累计因子（对每个交易日 d）：
 *   fore(d) = ∏ { f(e) : e.effectiveDate >  d }   —— 前复权（锚定最新价，最新日恒 1）
 *   back(d) = ∏ { 1/f(e) : e.effectiveDate <= d } —— 后复权（锚定最早价，最早日恒 1）
 *
 * 价格无关事件（送/转/拆/合）无需 preClose；价格相关事件（现金分红/配股）需要 preClose，
 * 缺失时抛 AdjustmentError（确定性失败，禁止静默跳过或伪造因子）。
 */

import type { CanonicalMarketBar } from "../data/types";
import type {
  AdjustmentFactor,
  AdjustmentMode,
  CorporateAction,
} from "./types";

/** 复权引擎抛出的确定性错误。 */
export class AdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdjustmentError";
  }
}

/** 解析出的单事件分解分量（内部使用）。 */
interface ActionComponents {
  cash: number;
  bonus: number;
  transfer: number;
  rights: number;
  rightsPrice: number;
  /** split / reverse_split 的 N（其余类型为 null）。 */
  splitRatio: number | null;
  reverseSplit: boolean;
}

/** 事件生效日不合法（非 YYYY-MM-DD）。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function positive(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0)
    throw new AdjustmentError(`非法的事件分解数值：${String(value)}`);
  return n;
}

/** 从单个 CorporateAction 抽取数值分量（严格：负值/非有限抛错，缺省按 0）。 */
function toComponents(action: CorporateAction): ActionComponents {
  if (!action.securityCode || action.securityCode.trim().length === 0) {
    throw new AdjustmentError("CorporateAction 缺少 securityCode");
  }
  if (!isValidDate(action.effectiveDate)) {
    throw new AdjustmentError(
      `CorporateAction effectiveDate 非法：${action.effectiveDate}`
    );
  }
  const splitRatio =
    action.actionType === "split" || action.actionType === "reverse_split"
      ? action.splitRatio
      : null;
  if (
    splitRatio !== null &&
    (!Number.isFinite(splitRatio) || splitRatio <= 0)
  ) {
    throw new AdjustmentError(
      `split/reverse_split 的 splitRatio 必须 > 0，实际 ${splitRatio}`
    );
  }
  return {
    cash: positive(action.cashAmount),
    bonus: positive(action.bonusRatio),
    transfer: positive(action.transferRatio),
    rights: positive(action.rightsRatio),
    rightsPrice: positive(action.rightsPrice),
    splitRatio,
    reverseSplit: action.actionType === "reverse_split",
  };
}

/**
 * 计算单次除权除息事件的前向因子（ex_ratio，价格在 ex-date 的“下跌比例”）。
 * @param preClose 除权前最近收盘价（raw）。仅现金分红/配股需要；纯送转/拆合可传 0。
 */
export function computeForwardFactor(
  action: CorporateAction,
  preClose: number
): number {
  const c = toComponents(action);
  if (c.splitRatio !== null) {
    return c.reverseSplit ? c.splitRatio : 1 / c.splitRatio;
  }
  const totalNew = 1 + c.bonus + c.transfer + c.rights;
  const needsPreClose = c.cash > 0 || c.rights > 0;
  if (needsPreClose && (!Number.isFinite(preClose) || preClose <= 0)) {
    throw new AdjustmentError(
      `事件 ${action.securityCode} @ ${action.effectiveDate} 含现金分红/配股，但缺少有效 preClose（实际 ${preClose}），无法确定复权因子`
    );
  }
  if (preClose <= 0) preClose = 1; // 纯送转/拆合时 preClose 不参与，取 1 保证分母非零
  const numerator = preClose - c.cash + c.rights * c.rightsPrice;
  const denominator = preClose * totalNew;
  if (denominator === 0) throw new AdjustmentError("复权因子分母为零");
  const f = numerator / denominator;
  if (!Number.isFinite(f) || f <= 0) {
    throw new AdjustmentError(
      `计算出的复权因子非法：${f}（${action.securityCode} @ ${action.effectiveDate}）`
    );
  }
  return f;
}

/** 后向因子 = 1 / 前向因子。 */
export function computeBackwardFactor(
  action: CorporateAction,
  preClose: number
): number {
  return 1 / computeForwardFactor(action, preClose);
}

/**
 * 把同 effectiveDate 的多个事件合并为「一个综合除权事件」。
 * 输入动作数组；返回按 effectiveDate 升序分组的 `{ effectiveDate, actions }[]`。
 * 仅做分组，不修改入参。事件之间相互独立，不要求预先排序。
 */
export function groupActionsByEffectiveDate(
  actions: readonly CorporateAction[]
): { effectiveDate: string; actions: CorporateAction[] }[] {
  const groups = new Map<string, CorporateAction[]>();
  for (const action of actions) {
    const list = groups.get(action.effectiveDate);
    if (list) list.push(action);
    else groups.set(action.effectiveDate, [action]);
  }
  return Array.from(groups.entries())
    .map(([effectiveDate, groupActions]) => ({
      effectiveDate,
      actions: groupActions,
    }))
    .sort((left, right) =>
      left.effectiveDate.localeCompare(right.effectiveDate)
    );
}

/**
 * 计算一组同日事件的综合前向因子。
 * 同日多事件按「一次除权除息」合并：现金/送/转/配 分量求和后套用统一公式；
 * 拆/合股与现金送转配不同时出现（A 股实际），若混入则拆/合按独立事件叠乘。
 */
export function computeGroupForwardFactor(
  actions: readonly CorporateAction[],
  preClose: number
): number {
  if (actions.length === 0) return 1;
  const comps = actions.map(toComponents);
  const splitOnly = comps.filter(c => c.splitRatio !== null);
  const nonSplit = comps.filter(c => c.splitRatio === null);
  let factor = 1;
  // 拆/合股：各自独立叠乘（N 拆 1 → f=1/N；N 合 1 → f=N）
  for (const c of splitOnly) {
    factor *= c.reverseSplit ? c.splitRatio! : 1 / c.splitRatio!;
  }
  if (nonSplit.length > 0) {
    const cash = nonSplit.reduce((s, c) => s + c.cash, 0);
    const bonus = nonSplit.reduce((s, c) => s + c.bonus, 0);
    const transfer = nonSplit.reduce((s, c) => s + c.transfer, 0);
    const rights = nonSplit.reduce((s, c) => s + c.rights, 0);
    const rightsValue = nonSplit.reduce(
      (s, c) => s + c.rights * c.rightsPrice,
      0
    );
    const needsPreClose = cash > 0 || rights > 0;
    if (needsPreClose && (!Number.isFinite(preClose) || preClose <= 0)) {
      throw new AdjustmentError(
        `同日事件组含现金分红/配股，但缺少有效 preClose（实际 ${preClose}）`
      );
    }
    const p = preClose > 0 ? preClose : 1;
    const totalNew = 1 + bonus + transfer + rights;
    const numerator = p - cash + rightsValue;
    const denominator = p * totalNew;
    if (denominator === 0) throw new AdjustmentError("复权因子分母为零");
    factor *= numerator / denominator;
  }
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new AdjustmentError(`综合复权因子非法：${factor}`);
  }
  return factor;
}

/** 一个交易日的累计因子。 */
export interface CumulativeFactors {
  /** 累计前复权因子。 */
  fore: number;
  /** 累计后复权因子。 */
  back: number;
}

/**
 * 由「事件 + raw 价格序列」构建每个交易日的累计复权因子。
 *
 * @param actions 公司行为事件（任意顺序）。
 * @param rawBars 该证券的 raw 日线（任意顺序，内部按交易日升序）。
 * @returns 按交易日升序的 `{ date, fore, back }[]`；无事件时 fore/back 恒 1。
 *
 * 需要 preClose 的事件（现金分红/配股）取「生效日前最近一根 raw close」；
 * 若在 raw 序列内找不到（事件早于序列起点），抛 AdjustmentError（确定性失败）。
 */
export function buildFactorSeriesFromActions(
  actions: readonly CorporateAction[],
  rawBars: readonly CanonicalMarketBar[]
): { date: string; fore: number; back: number }[] {
  const dates = rawBars
    .map(b => b.timestamp)
    .sort((a, b) => a.localeCompare(b));
  const closeByDate = new Map<string, number | null>();
  for (const bar of rawBars) closeByDate.set(bar.timestamp, bar.close);

  const groups = groupActionsByEffectiveDate(actions);
  // 每个事件组的前向因子 + 其 preClose
  const eventFactors: { effectiveDate: string; f: number }[] = groups.map(
    group => {
      const priorDates = dates.filter(d => d < group.effectiveDate);
      let preClose = 0;
      for (let i = priorDates.length - 1; i >= 0; i -= 1) {
        const c = closeByDate.get(priorDates[i]!);
        if (c !== null && c !== undefined && c > 0) {
          preClose = c;
          break;
        }
      }
      const f = computeGroupForwardFactor(group.actions, preClose);
      return { effectiveDate: group.effectiveDate, f };
    }
  );

  // fore(d) = ∏ f(e) for e.date > d；back(d) = ∏ 1/f(e) for e.date <= d
  const sortedEvents = eventFactors.sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate)
  );
  return dates.map(date => {
    let fore = 1;
    let back = 1;
    for (const ev of sortedEvents) {
      if (ev.effectiveDate > date) fore *= ev.f;
      else back /= ev.f;
    }
    return { date, fore, back };
  });
}

/**
 * 将累计因子应用到一根 raw bar，得到 adjusted bar（前复权或后复权）。
 * 返回新对象，不修改入参 raw bar。
 *
 * 调整字段：open/high/low/close/preClose 乘以因子（同因子缩放保持 OHLC 不变量）；
 * volume（手）/amount（千元）不调整——成交额是元、与每股价格无关；成交量的份额口径
 * 调整属另一维度，不在本引擎范围（见 STEP 7.7 报告）。
 */
export function applyAdjustmentToBar(
  bar: CanonicalMarketBar,
  factor: number,
  mode: AdjustmentMode
): CanonicalMarketBar {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new AdjustmentError(`调整因子必须 > 0，实际 ${factor}`);
  }
  const scale = (v: number | null): number | null =>
    v === null ? null : v * factor;
  return {
    symbol: bar.symbol,
    timestamp: bar.timestamp,
    open: scale(bar.open),
    high: scale(bar.high),
    low: scale(bar.low),
    close: scale(bar.close),
    preClose: scale(bar.preClose),
    volume: bar.volume,
    amount: bar.amount,
    turnoverRate: bar.turnoverRate,
    adjustment: mode,
  };
}

/**
 * 由「事件 + raw 序列」生成整段 adjusted 序列（前复权或后复权）。
 * 纯函数，不修改 rawBars；输入 rawBars 顺序无关（内部排序）。
 */
export function adjustSeriesFromActions(
  rawBars: readonly CanonicalMarketBar[],
  actions: readonly CorporateAction[],
  mode: AdjustmentMode
): CanonicalMarketBar[] {
  const factors = buildFactorSeriesFromActions(actions, rawBars);
  const factorByDate = new Map(factors.map(f => [f.date, f]));
  return rawBars
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(bar => {
      const f = factorByDate.get(bar.timestamp);
      if (!f)
        throw new AdjustmentError(`raw 序列缺少 ${bar.timestamp} 的复权因子`);
      return applyAdjustmentToBar(
        bar,
        mode === "forward" ? f.fore : f.back,
        mode
      );
    });
}

/**
 * 便捷：把「provider 累计因子」应用到 raw 序列（直接复权路径，无需 preClose）。
 * provider 累计因子语义：foreFactor(生效日 d) = ∏ f(e) for e > d；backFactor(d) = ∏ 1/f(e) for e <= d。
 * 边界：d 早于最早生效日 → fore = foreFactor(最早)/backFactor(最早)、back = 1；d 晚于最晚生效日 → fore = 1、back = backFactor(最晚)。
 * 返回 adjusted 序列；raw 不修改。若某交易日在因子区间内无法确定，抛 AdjustmentError。
 */
export function adjustSeriesFromFactors(
  rawBars: readonly CanonicalMarketBar[],
  factors: readonly AdjustmentFactor[],
  mode: AdjustmentMode
): CanonicalMarketBar[] {
  const sorted = factors
    .slice()
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  if (sorted.length === 0) {
    throw new AdjustmentError("缺少复权因子，无法复权");
  }
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const resolve = (date: string): number => {
    // 找到最大生效日 <= date 的因子台阶
    let step = 1;
    let stepBack = 1;
    for (const f of sorted) {
      if (f.effectiveDate <= date) {
        step = f.foreFactor;
        stepBack = f.backFactor;
      } else {
        break;
      }
    }
    if (date < first.effectiveDate) {
      // 早于最早生效日：fore = ∏ 全部事件 f = fore(最早)/back(最早)；back = 1
      return mode === "forward" ? first.foreFactor / first.backFactor : 1;
    }
    if (date >= last.effectiveDate) {
      return mode === "forward" ? 1 : last.backFactor;
    }
    return mode === "forward" ? step : stepBack;
  };
  return rawBars
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(bar => applyAdjustmentToBar(bar, resolve(bar.timestamp), mode));
}
