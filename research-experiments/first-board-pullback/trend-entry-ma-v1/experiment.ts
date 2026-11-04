/**
 * TREND-ENTRY-MA-V1 —— 首板事件 + **趋势触发入场**（配置驱动），不做固定日期收益。
 *
 * 口径（与 `arms.ts` 的冻结配置一一对应）：
 *   事件   = `first_limit_pullback` v9 的全部首板事件（主板 · 非 ST · **上市龄 ≥ 365 天**）；
 *   入场   = 观察窗 rd 1..20 内**首个**满足该臂全部条件的交易日 ⇒ **次一交易日开盘**；
 *   退出   = 统一 `TREND_ENTRY_EXIT`（20 日持有期 / 收盘跌破 MA10 / 盘中 −6% 止损，取先到）；
 *   收益   = **实际入场 → 实际退出**（不是 T+6 买 / T+10 卖）；成本 = 买边 + 卖边（含印花税）。
 *
 * 🔴 这是**研究实验**：不接 simulator、不建 StrategyVersion、不注册执行路径。
 *    条件求值走 `shared/firstBoardPullback/trendEntry.ts` 的**唯一实现**（预注册四类条件）。
 */
import { z } from "zod";
import type {
  ExperimentDefinition,
  ExperimentResultPayload,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  evaluateEntry,
  evaluateExit,
  netReturnPct,
  type TrendBarSeries,
  type TrendCostConfig,
} from "../../shared/firstBoardPullback/trendEntry";
import type { NormalizedFoundationBar } from "../../shared/firstBoardPullback/types";
import {
  TREND_ENTRY_ARMS,
  TREND_ENTRY_MAX_RELATIVE_DAY,
  TREND_ENTRY_POST_RELATIVE_DAYS,
  TREND_ENTRY_PREFIX_RELATIVE_DAYS,
  TREND_CONDITION_KINDS,
  type TrendEntryArm,
} from "./arms";

export const COMPUTATION_VERSION = "1.0.0";
/** 与既有首板回撤底座一致的单边成本口径（佣金/滑点/冲击各 2.5bps + 卖出印花税 5bps）。 */
export const TREND_ENTRY_COST: TrendCostConfig = Object.freeze({
  commissionBpsPerSide: 2.5,
  slippageBpsPerSide: 2.5,
  impactBpsPerSide: 2.5,
  stampDutyBps: 5,
});

const armOutcomeSchema = z.object({
  id: z.string(),
  label: z.string(),
  eventsEvaluated: z.number().int(),
  triggered: z.number().int(),
  unfillable: z.number().int(),
  noTrigger: z.number().int(),
  triggerRatePct: z.number(),
  exited: z.number().int(),
  openAtEnd: z.number().int(),
  meanNetReturnPct: z.number().nullable(),
  medianNetReturnPct: z.number().nullable(),
  winRatePct: z.number().nullable(),
  bigWin50Count: z.number().int(),
  bigWin100Count: z.number().int(),
  meanHoldingDays: z.number().nullable(),
  medianHoldingDays: z.number().nullable(),
  meanEntryRd: z.number().nullable(),
  medianEntryRd: z.number().nullable(),
  meanUnevaluableDaysPerEvent: z.number().nullable(),
});

export const trendEntryMaV1Schema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  datasetVersionId: z.number().int(),
  costBps: z.object({
    buy: z.number(),
    sell: z.number(),
  }),
  arms: z.array(armOutcomeSchema),
  yearly: z.array(z.object({
    armId: z.string(),
    year: z.string(),
    trades: z.number().int(),
    meanNetReturnPct: z.number().nullable(),
  })),
  note: z.string(),
});

function numberValue(values: Readonly<Record<string, number | boolean | string | null>>, key: string): number | null {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function booleanValue(values: Readonly<Record<string, number | boolean | string | null>>, key: string): boolean | null {
  const value = values[key];
  return typeof value === "boolean" ? value : null;
}
function stringValue(values: Readonly<Record<string, number | boolean | string | null>>, key: string): string | null {
  const value = values[key];
  return typeof value === "string" ? value : null;
}

/** `ExperimentBarRow` → 底座同形的 bar（结构有效性 = OHLC 齐全且 high ≥ low）。 */
function toBar(relativeDay: number, values: Readonly<Record<string, number | boolean | string | null>>): NormalizedFoundationBar {
  const open = numberValue(values, "open");
  const high = numberValue(values, "high");
  const low = numberValue(values, "low");
  const close = numberValue(values, "close");
  const preClose = numberValue(values, "preClose");
  const barPresent = booleanValue(values, "barPresent") ?? true;
  const suspended = stringValue(values, "suspensionStatus") === "SUSPENDED";
  const structurallyValid =
    open !== null && high !== null && low !== null && close !== null
    && open > 0 && close > 0 && high >= low;
  return {
    relativeDay,
    open, high, low, close, preClose,
    limitUpPrice: numberValue(values, "limitUpPrice"),
    limitDownPrice: numberValue(values, "limitDownPrice"),
    barPresent,
    suspended,
    canBuyAtOpen: booleanValue(values, "canBuyAtOpen"),
    canSellAtClose: booleanValue(values, "canSellAtClose"),
    structurallyValid,
  };
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

interface ArmTally {
  eventsEvaluated: number;
  triggered: number;
  unfillable: number;
  noTrigger: number;
  exited: number;
  openAtEnd: number;
  netReturns: number[];
  holdingDays: number[];
  entryRds: number[];
  unevaluableDays: number;
  yearly: Map<string, number[]>;
}

function emptyTally(): ArmTally {
  return {
    eventsEvaluated: 0, triggered: 0, unfillable: 0, noTrigger: 0,
    exited: 0, openAtEnd: 0, netReturns: [], holdingDays: [], entryRds: [],
    unevaluableDays: 0, yearly: new Map(),
  };
}

/** 逐事件跑一条臂（纯函数式的主要计算；I/O 已在调用方完成）。 */
function runArm(
  arm: TrendEntryArm,
  events: readonly { eventId: string; tradeDate: string; series: TrendBarSeries }[],
  tally: ArmTally,
): void {
  for (const event of events) {
    const entry = evaluateEntry(arm.entry, event.series);
    tally.eventsEvaluated += 1;
    tally.unevaluableDays += entry.unevaluableDays;
    if (entry.status === "NO_TRIGGER") { tally.noTrigger += 1; continue; }
    if (entry.status === "UNFILLABLE" || entry.entryRd === null || entry.entryPrice === null) {
      tally.unfillable += 1;
      continue;
    }
    tally.triggered += 1;
    tally.entryRds.push(entry.entryRd);
    const exit = evaluateExit(arm.exit, event.series, entry.entryRd, entry.entryPrice, TREND_ENTRY_MAX_RELATIVE_DAY);
    if (exit.exitPrice === null) { tally.noTrigger += 1; tally.triggered -= 1; continue; }
    if (exit.status === "OPEN_AT_END") tally.openAtEnd += 1;
    else tally.exited += 1;
    const gross = (exit.exitPrice / entry.entryPrice - 1) * 100;
    const net = netReturnPct(gross, TREND_ENTRY_COST);
    tally.netReturns.push(net);
    if (exit.holdingDays !== null) tally.holdingDays.push(exit.holdingDays);
    const year = event.tradeDate.slice(0, 4);
    const list = tally.yearly.get(year) ?? [];
    list.push(net);
    tally.yearly.set(year, list);
  }
}

export const trendEntryMaV1Experiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/trend-entry-ma-v1",
    name: "趋势触发入场（MA5/10/20/60，配置驱动）",
    version: COMPUTATION_VERSION,
    description:
      "首板事件 + 趋势确认入场：观察窗 rd1..20 内首个满足条件的交易日建仓（次一开盘），"
      + "退出按配置（20 日持有 / 跌破 MA10 / −6% 止损取先到）。收益按实际入场→实际退出计算，"
      + "不钉死 T+6 买 / T+10 卖。三条预注册臂（A1 多头排列 / A2 回踩转强 / A3 站上长均线）。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["first-board-pullback", "trend-entry", "ma", "config-driven", "pre-registered"],
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredDatasetVersionLabel: "v9",
      requiredColumns: {
        events: ["limitUpPrice"],
        observation: ["open", "high", "low", "close", "preClose", "canBuyAtOpen", "canSellAtClose", "barPresent", "suspensionStatus"],
      },
      // MA60 在 rd ≤ 20 处需要 rd−59..0 ⇒ 必须物化 −59..0 的前置行（v9 preWindowDays=60）。
      prefixRelativeDays: [...TREND_ENTRY_PREFIX_RELATIVE_DAYS],
      postRelativeDays: [...TREND_ENTRY_POST_RELATIVE_DAYS],
      // 样本资格**不使用** rd ≥ 1 数据（入池只看「是不是 v9 的首板事件」）。
      decisionOffsetDays: null,
      usesForwardData: true,
      forwardDataPurpose: "入场触发 / 退出 / 收益都发生在事件日之后，必须读 rd ≥ 1 的真实行情。",
      eventScanPolicy: "PLATFORM_LIMIT",
    },
    pageKey: "first-board-pullback/trend-entry-ma-v1",
    pageTitle: "趋势触发入场（MA5/10/20/60）",
  },
  resultSchema: trendEntryMaV1Schema,
  async run(context: ExperimentRunContext): Promise<ExperimentResultPayload> {
    // 配置自检：词表必须仍在预注册的四类之内（越界即失败，不静默放行）。
    const allowed = new Set<string>(TREND_CONDITION_KINDS);
    for (const arm of TREND_ENTRY_ARMS) {
      for (const condition of [...arm.entry.trigger.all, ...arm.entry.trigger.any, ...arm.exit.conditions]) {
        if (!allowed.has(condition.kind)) {
          throw new Error(`臂 ${arm.id} 使用了预注册词表之外的条件：${condition.kind}`);
        }
      }
    }

    const eventRows = await context.dataset.events();
    context.log(`[trend-entry] events=${eventRows.length}；开始装载 ${TREND_ENTRY_PREFIX_RELATIVE_DAYS.length} 个前置相对日 + ${TREND_ENTRY_POST_RELATIVE_DAYS.length} 个后置相对日`);

    const seriesByEvent = new Map<string, Map<number, NormalizedFoundationBar>>();
    const touch = (eventId: string): Map<number, NormalizedFoundationBar> => {
      const existing = seriesByEvent.get(eventId);
      if (existing !== undefined) return existing;
      const created = new Map<number, NormalizedFoundationBar>();
      seriesByEvent.set(eventId, created);
      return created;
    };
    for (const eventId of eventRows.map((row) => row.eventId)) touch(eventId);

    let loadedDays = 0;
    for (const relativeDay of TREND_ENTRY_PREFIX_RELATIVE_DAYS) {
      const rows = await context.dataset.feature(relativeDay);
      for (const row of rows) {
        const series = seriesByEvent.get(row.eventId);
        if (series === undefined) continue;
        series.set(relativeDay, toBar(relativeDay, row.values));
      }
      loadedDays += 1;
      if (loadedDays % 20 === 0) context.log(`[trend-entry] prefix ${loadedDays}/${TREND_ENTRY_PREFIX_RELATIVE_DAYS.length}`);
    }
    for (const relativeDay of TREND_ENTRY_POST_RELATIVE_DAYS) {
      const rows = await context.dataset.observation(relativeDay);
      for (const row of rows) {
        const series = seriesByEvent.get(row.eventId);
        if (series === undefined) continue;
        series.set(relativeDay, toBar(relativeDay, row.values));
      }
      loadedDays += 1;
      if (loadedDays % 20 === 0) context.log(`[trend-entry] bars ${loadedDays}/${TREND_ENTRY_PREFIX_RELATIVE_DAYS.length + TREND_ENTRY_POST_RELATIVE_DAYS.length}`);
    }

    const events = eventRows.map((row) => ({
      eventId: row.eventId,
      tradeDate: row.tradeDate,
      series: seriesByEvent.get(row.eventId) ?? new Map<number, NormalizedFoundationBar>(),
    }));

    const tallies = new Map<string, ArmTally>();
    for (const arm of TREND_ENTRY_ARMS) {
      const tally = emptyTally();
      runArm(arm, events, tally);
      tallies.set(arm.id, tally);
      context.log(`[trend-entry] 臂 ${arm.id} 完成：触发 ${tally.triggered} / 无触发 ${tally.noTrigger} / 不可买 ${tally.unfillable}`);
    }

    const outcomes = TREND_ENTRY_ARMS.map((arm) => {
      const tally = tallies.get(arm.id)!;
      const sorted = [...tally.netReturns].sort((a, b) => a - b);
      const holdingSorted = [...tally.holdingDays].sort((a, b) => a - b);
      const entrySorted = [...tally.entryRds].sort((a, b) => a - b);
      const mean = (xs: readonly number[]): number | null => xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;
      return {
        id: arm.id,
        label: arm.label,
        eventsEvaluated: tally.eventsEvaluated,
        triggered: tally.triggered,
        unfillable: tally.unfillable,
        noTrigger: tally.noTrigger,
        triggerRatePct: tally.eventsEvaluated === 0 ? 0 : (tally.triggered / tally.eventsEvaluated) * 100,
        exited: tally.exited,
        openAtEnd: tally.openAtEnd,
        meanNetReturnPct: mean(tally.netReturns),
        medianNetReturnPct: percentile(sorted, 0.5),
        winRatePct: tally.netReturns.length === 0 ? null : (tally.netReturns.filter((r) => r > 0).length / tally.netReturns.length) * 100,
        bigWin50Count: tally.netReturns.filter((r) => r >= 50).length,
        bigWin100Count: tally.netReturns.filter((r) => r >= 100).length,
        meanHoldingDays: mean(tally.holdingDays),
        medianHoldingDays: percentile(holdingSorted, 0.5),
        meanEntryRd: mean(tally.entryRds),
        medianEntryRd: percentile(entrySorted, 0.5),
        meanUnevaluableDaysPerEvent: tally.eventsEvaluated === 0 ? null : tally.unevaluableDays / tally.eventsEvaluated,
      };
    });

    const yearly: { armId: string; year: string; trades: number; meanNetReturnPct: number | null }[] = [];
    for (const arm of TREND_ENTRY_ARMS) {
      const tally = tallies.get(arm.id)!;
      for (const year of [...tally.yearly.keys()].sort()) {
        const list = tally.yearly.get(year)!;
        yearly.push({
          armId: arm.id,
          year,
          trades: list.length,
          meanNetReturnPct: list.length === 0 ? null : list.reduce((s, x) => s + x, 0) / list.length,
        });
      }
    }

    const buyBps = TREND_ENTRY_COST.commissionBpsPerSide + TREND_ENTRY_COST.slippageBpsPerSide + TREND_ENTRY_COST.impactBpsPerSide;
    const rows = outcomes.map((outcome) => ({
      arm: outcome.label,
      triggerRatePct: outcome.triggerRatePct,
      meanEntryRd: outcome.meanEntryRd,
      meanHoldingDays: outcome.meanHoldingDays,
      meanNetReturnPct: outcome.meanNetReturnPct,
      medianNetReturnPct: outcome.medianNetReturnPct,
      winRatePct: outcome.winRatePct,
      bigWin50Count: outcome.bigWin50Count,
      triggered: outcome.triggered,
      unfillable: outcome.unfillable,
      noTrigger: outcome.noTrigger,
    }));

    return {
      sampleSummary: {
        candidateCount: events.length,
        eligibleCount: events.length,
        excludedCount: 0,
        excludedByReason: {},
        notes: [
          "arms=" + String(TREND_ENTRY_ARMS.length),
          "barsPerEvent=" + String(TREND_ENTRY_PREFIX_RELATIVE_DAYS.length + TREND_ENTRY_POST_RELATIVE_DAYS.length),
          "entryMode=first-trigger-in-window(then NEXT_OPEN)",
          "returnMode=actual-entry-to-actual-exit",
        ],
      },
      tables: [
        {
          key: "trend-entry-arms",
          title: "趋势触发入场：触发率 / 实际入场 / 持有期 / 收益",
          description:
            "入场 = 观察窗 rd1..20 内首个满足该臂全部条件的交易日（次一开盘成交）；"
            + "收益 = 实际入场→实际退出（含成本）。三条臂为**预注册**配置，未做参数搜索。",
          columns: [
            { key: "arm", label: "臂" },
            { key: "triggerRatePct", label: "触发率 %", digits: 2 },
            { key: "meanEntryRd", label: "平均入场相对日", digits: 2 },
            { key: "meanHoldingDays", label: "平均持有日", digits: 2 },
            { key: "meanNetReturnPct", label: "净收益均值 %", digits: 3 },
            { key: "medianNetReturnPct", label: "净收益中位 %", digits: 3 },
            { key: "winRatePct", label: "胜率 %", digits: 2 },
            { key: "bigWin50Count", label: ">=+50% 笔数", digits: 0 },
            { key: "triggered", label: "触发笔数", digits: 0 },
            { key: "unfillable", label: "不可买", digits: 0 },
            { key: "noTrigger", label: "未触发", digits: 0 },
          ],
          rows,
        },
        {
          key: "trend-entry-yearly",
          title: "逐臂 × 逐年净收益均值（%）",
          description: "按事件日年份分组；仅统计已实现（触发且可成交）的交易。",
          columns: [
            { key: "armId", label: "臂" },
            { key: "year", label: "年" },
            { key: "trades", label: "笔数", digits: 0 },
            { key: "meanNetReturnPct", label: "净收益均值 %", digits: 3 },
          ],
          rows: yearly.map((row) => ({ ...row })),
        },
      ],
      statistics: [
        { code: "events", label: "事件数", value: events.length, digits: 0 },
        { code: "arms", label: "预注册臂数", value: TREND_ENTRY_ARMS.length, digits: 0 },
        { code: "buy_bps", label: "买边成本 bps", value: buyBps, digits: 1 },
        { code: "sell_bps", label: "卖边成本 bps（含印花税）", value: buyBps + TREND_ENTRY_COST.stampDutyBps, digits: 1 },
      ],
      customPayload: {
        computationVersion: COMPUTATION_VERSION,
        datasetVersionId: context.dataset.facts.datasetVersionId,
        costBps: { buy: buyBps, sell: buyBps + TREND_ENTRY_COST.stampDutyBps },
        arms: outcomes,
        yearly,
        note:
          "入场/退出全部由配置声明（预注册 3 臂）；收益为「实际入场→实际退出」，成本 = 佣金+滑点+冲击（双边）+ 卖出印花税。"
          + "条件词表 = PRICE_VS_MA / MA_ORDER / MA_SLOPE / RETURN_OVER 四类；数据不足按不可评估（不插补），不计入触发。",
      },
    };
  },
};
