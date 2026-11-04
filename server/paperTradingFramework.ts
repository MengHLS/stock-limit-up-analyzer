/**
 * 通用 Paper Trading / Forward 编排框架（纯状态机 + 注入式端口，无 DB / 无策略实现）。
 *
 * 责任边界：
 * - 本文件负责：PENDING checkpoint 读回 → 初始化或恢复 → 只推进未处理交易日 → merge → checkpoint 写回；
 * - 策略适配器负责：Dataset 交易日解析、历史种子/模拟器调用、每日投影与策略专属状态字段；
 * - 不实现第二套 simulator / selection / exit / runner。
 *
 * 硬保证：
 * - 幂等：只取 `tradeDate > lastProcessedTradingDate`；
 * - no-new-data：没有新交易日时不调用 merge，也不制造记录；
 * - future-data boundary：适配器提供的 tradingDates 是唯一可推进日历源；
 * - restart：先 load 持久化状态，查不到才 initialize；
 * - raw payload recovery：适配器通过 load/save 端口完全控制持久化编码，不在框架内二次解释。
 */

export const PAPER_FORWARD_STATUSES = ["WAITING_FOR_NEW_DATA", "ADVANCED", "ERROR"] as const;
export type PaperForwardStatus = (typeof PAPER_FORWARD_STATUSES)[number];

export interface PaperForwardStateCore {
  readonly runId: string;
  readonly status: PaperForwardStatus;
  readonly latestDataDate: string;
  readonly lastProcessedTradingDate: string;
  readonly nextTradingDate: string | null;
  readonly lastRunAt: string;
  readonly lastError: string | null;
}

export interface PaperForwardTradingCalendar {
  readonly latestDataDate: string;
  readonly tradingDates: readonly string[];
}

export interface PaperForwardIncrementInput<TState extends PaperForwardStateCore> {
  readonly previous: TState;
  readonly fromTradingDate: string;
  readonly toTradingDate: string;
  readonly latestDataDate: string;
  readonly nextTradingDate: string | null;
}

export interface PaperForwardAdvanceAdapter<
  TState extends PaperForwardStateCore,
  TDaily,
  THistory,
  TPosition,
> {
  /** 只返回数据集声明窗口内的交易日；排序由框架统一处理。 */
  resolveTradingCalendar(): Promise<PaperForwardTradingCalendar>;
  markWaiting(input: {
    readonly previous: TState;
    readonly latestDataDate: string;
    readonly lastRunAt: string;
  }): TState;
  buildIncrement(input: PaperForwardIncrementInput<TState>): Promise<{
    readonly newDaily: readonly TDaily[];
    readonly newHistory: readonly THistory[];
    readonly carriedPositions: readonly TPosition[];
  }>;
  mergeIncrement(input: {
    readonly previous: TState;
    readonly increment: {
      readonly newDaily: readonly TDaily[];
      readonly newHistory: readonly THistory[];
      readonly carriedPositions: readonly TPosition[];
    };
    readonly latestDataDate: string;
    readonly nextTradingDate: string | null;
    readonly lastRunAt: string;
  }): TState | Promise<TState>;
  markError(input: {
    readonly previous: TState;
    readonly lastRunAt: string;
    readonly error: unknown;
  }): TState;
}

/** 推进一个可用交易日；无新数据、幂等跳过与错误回写均走同一实现。 */
export async function advancePaperForwardOnce<
  TState extends PaperForwardStateCore,
  TDaily,
  THistory,
  TPosition,
>(
  adapter: PaperForwardAdvanceAdapter<TState, TDaily, THistory, TPosition>,
  previous: TState,
  now: () => string = () => new Date().toISOString(),
): Promise<TState> {
  try {
    const calendar = await adapter.resolveTradingCalendar();
    const latestDataDate = calendar.latestDataDate;
    const newDates = [...calendar.tradingDates]
      .filter((date) => date > previous.lastProcessedTradingDate && date <= latestDataDate)
      .sort();
    if (newDates.length === 0) {
      return adapter.markWaiting({ previous, latestDataDate, lastRunAt: now() });
    }

    const fromTradingDate = newDates[0]!;
    const toTradingDate = newDates.at(-1)!;
    const nextTradingDate = [...calendar.tradingDates].sort().find((date) => date > toTradingDate) ?? null;
    const increment = await adapter.buildIncrement({
      previous,
      fromTradingDate,
      toTradingDate,
      latestDataDate,
      nextTradingDate,
    });
    return await adapter.mergeIncrement({
      previous,
      increment,
      latestDataDate,
      nextTradingDate,
      lastRunAt: now(),
    });
  } catch (error) {
    return adapter.markError({ previous, lastRunAt: now(), error });
  }
}

export interface PaperForwardRunnerPorts<TState extends PaperForwardStateCore> {
  /** 持久化 checkpoint 的唯一读入口；缺行返回 null。 */
  load(): Promise<TState | null>;
  /** 首次运行的历史种子 → 前向账户基线；必须真实恢复账户，不重置。 */
  initialize(): Promise<TState>;
  /** 策略适配器提供的增量推进。 */
  advance(state: TState): Promise<TState>;
  /** 持久化 checkpoint 的唯一写入口。 */
  save(state: TState): Promise<void>;
  /** 可选：从历史种子显式重建 checkpoint。 */
  reset?(): Promise<TState>;
}

export interface PaperForwardRunner<TState extends PaperForwardStateCore> {
  runNextAvailableDay(): Promise<TState>;
  reset(): Promise<TState>;
}

/** 通用断点服务：load → initialize/advance → save；策略层只实现四个端口。 */
export function createPaperForwardRunner<TState extends PaperForwardStateCore>(
  ports: PaperForwardRunnerPorts<TState>,
): PaperForwardRunner<TState> {
  async function runNextAvailableDay(): Promise<TState> {
    const existing = await ports.load();
    const base = existing ?? await ports.initialize();
    const next = await ports.advance(base);
    await ports.save(next);
    return next;
  }

  return {
    runNextAvailableDay,
    async reset(): Promise<TState> {
      if (ports.reset === undefined) {
        throw new Error("PaperForwardRunner.reset 未配置 reset 端口");
      }
      const state = await ports.reset();
      await ports.save(state);
      return state;
    },
  };
}
