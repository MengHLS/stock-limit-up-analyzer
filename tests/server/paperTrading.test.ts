import { describe, expect, it } from "vitest";
import type { LeaderCandidate, LeaderCandidateDailyPrice } from "../../server/leaderCandidates";
import {
  advancePaperTradingDay,
  buildForwardPreparedBuys,
  buildPaperTradingSummary,
  classifyAdvanceKind,
  createInitialPaperTradingState,
  paperTradingAdvanceDiagnosis,
  PaperTradingCalendarStaleError,
  type PaperPendingBuy,
  type PaperTradingState,
} from "../../server/paperTrading";

const makeCandidate = (overrides: Partial<LeaderCandidate> = {}): LeaderCandidate => ({
  rank: 0,
  stockCode: "600001.SH",
  stockName: "测试股",
  sector: "题材A",
  boards: 2,
  sectorCount: 3,
  score: 80,
  riskScore: 20,
  riskTier: "低风险",
  riskPenalty: 7,
  netScore: 73,
  limitUpTime: "09:40:00",
  turnover: "20",
  circulationValue: "100",
  marketCapScore: 10,
  marketCapLabel: "中盘",
  reasons: ["2板高度", "题材A 3只涨停"],
  riskTags: [],
  trajectory: [],
  ...overrides,
});

const price = (openPrice: number, closePrice: number, extra: Partial<LeaderCandidateDailyPrice> = {}): LeaderCandidateDailyPrice => ({
  openPrice,
  closePrice,
  highPrice: Math.max(openPrice, closePrice),
  lowPrice: Math.min(openPrice, closePrice),
  amount: 3_000_000,
  preClosePrice: closePrice,
  ...extra,
});

describe("buildForwardPreparedBuys 准备买入清单", () => {
  it("按策略分排序、排除已持有、受最大持仓数限制", () => {
    const candidates = [
      makeCandidate({ stockCode: "600001.SH", score: 60, boards: 2, limitUpTime: "10:00:00" }),
      makeCandidate({ stockCode: "600002.SH", score: 90, boards: 3, limitUpTime: "09:35:00" }),
      makeCandidate({ stockCode: "600003.SH", score: 70, boards: 2, limitUpTime: "09:30:00" }),
    ];
    const buys = buildForwardPreparedBuys(candidates, "2026-08-18", "baseline", {}, new Set(["600001.SH"]), 3);
    expect(buys.map((buy) => buy.stockCode)).toEqual(["600002.SH", "600003.SH"]);
    expect(buys[0]!.strategyScore).toBe(90);
    expect(buys[0]!.rank).toBe(1);
    expect(buys[0]!.signalDate).toBe("2026-08-18");
  });

  it("风险扣分策略使用扣分后的净分排序", () => {
    const candidates = [
      makeCandidate({ stockCode: "600001.SH", score: 80, riskScore: 0 }),
      makeCandidate({ stockCode: "600002.SH", score: 90, riskScore: 90 }),
    ];
    // 固定惩罚权重 0.35：600001 net=80，600002 net=90-31.5=58.5 → 600001 优先
    const buys = buildForwardPreparedBuys(candidates, "2026-08-18", "riskPenalty", { penaltyWeight: 0.35 }, new Set(), 5);
    expect(buys[0]!.stockCode).toBe("600001.SH");
  });

  it("高风险硬过滤与质量门控均排除被阈值排除的候选", () => {
    const candidates = [
      makeCandidate({ stockCode: "600001.SH", score: 80, riskScore: 10, limitUpTime: "09:40:00" }),
      makeCandidate({ stockCode: "600002.SH", score: 70, riskScore: 90, limitUpTime: "09:40:00" }),
    ];
    const priceMap = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-18", price(10, 10, { amount: 60_000 })],
      ["600002.SH::2026-08-18", price(10, 10, { amount: 60_000 })],
    ]);
    const hardFilter = buildForwardPreparedBuys(candidates, "2026-08-18", "hardFilter", { hardRiskThreshold: 50, priceByStockDate: priceMap }, new Set(), 5);
    expect(hardFilter.map((buy) => buy.stockCode)).toEqual(["600001.SH"]);

    const qualityGate = buildForwardPreparedBuys(candidates, "2026-08-18", "qualityGate", { hardRiskThreshold: 50, priceByStockDate: priceMap }, new Set(), 5);
    // 600001 风险低、质量分高，必然在门控内；600002 风险高被排除。
    expect(qualityGate.map((buy) => buy.stockCode)).toEqual(["600001.SH"]);
  });
});

describe("advancePaperTradingDay 逐日推进", () => {
  const tradingDates = ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"];
  const realistic = { initialCapital: 100_000, maxPositions: 5, slippageBps: 10, lotSize: 100 };

  const makePending = (overrides: Partial<PaperPendingBuy> = {}): PaperPendingBuy => ({
    rank: 1,
    stockCode: "600001.SH",
    stockName: "测试股",
    sector: "题材A",
    boards: 2,
    signalDate: "2026-08-18",
    signalClosePrice: 10,
    score: 80,
    riskScore: 20,
    riskTier: "低风险",
    strategyScore: 80,
    reasons: [],
    ...overrides,
  });

  it("完整生命周期：T+1 开盘成交 → T+2 强势续持 → T+3 未满足强势出清", () => {
    const priceByStockDate = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-19", price(10.2, 10.4)],
      ["600001.SH::2026-08-20", price(10.5, 10.6)],
      ["600001.SH::2026-08-21", price(10.2, 10.2)],
    ]);
    let state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [makePending()] };

    const advance = (today: string, signalCandidates: LeaderCandidate[] = []) => {
      const result = advancePaperTradingDay({
        state,
        today,
        signalCandidates,
        priceByStockDate,
        tradingDates,
        strategyKey: "baseline",
        realistic,
      });
      state = result.state;
      return result;
    };

    const day1 = advance("2026-08-19");
    expect(day1.events.filledCount).toBe(1);
    const filled = day1.events.filledOrders[0]!;
    expect(filled.status).toBe("filled");
    expect(filled.shares).toBe(9700);
    expect(filled.entryDate).toBe("2026-08-19");
    expect(state.positions).toHaveLength(1);

    const day2 = advance("2026-08-20");
    expect(day2.events.exitedCount).toBe(0);
    expect(state.positions).toHaveLength(1); // 强势续持

    const day3 = advance("2026-08-21");
    expect(day3.events.exitedCount).toBe(1);
    const exited = day3.events.exitedOrders[0]!;
    expect(exited.status).toBe("exited");
    expect(exited.exitDate).toBe("2026-08-21");
    expect(exited.reason).toContain("未满足强势续持");
    expect(state.positions).toHaveLength(0);
    expect(state.equityCurve).toHaveLength(3);
  });

  it("一字涨停封死按规则不追买", () => {
    // 主板非 ST：signalClose=10 → 真实涨停价 = 11.00（10.99 只是 +9.9%，并非涨停）。
    const priceByStockDate = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-19", price(11, 11, { highPrice: 11, lowPrice: 11 })],
    ]);
    const state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [makePending({ signalClosePrice: 10 })] };
    const result = advancePaperTradingDay({
      state,
      today: "2026-08-19",
      signalCandidates: [],
      priceByStockDate,
      tradingDates,
      strategyKey: "baseline",
      realistic: { ...realistic, blockOneWordLimitUpBuys: true },
    });
    expect(result.events.filledCount).toBe(0);
    expect(result.events.skippedCount).toBe(1);
    expect(result.events.skippedOrders[0]!.reason).toContain("一字涨停");
  });

  it("开盘低于预期阈值不买入", () => {
    const priceByStockDate = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-19", price(9.5, 9.6)],
    ]);
    const state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [makePending({ signalClosePrice: 10 })] };
    const result = advancePaperTradingDay({
      state,
      today: "2026-08-19",
      signalCandidates: [],
      priceByStockDate,
      tradingDates,
      strategyKey: "baseline",
      realistic: { ...realistic, minimumExpectedOpenChangePercent: 0 },
    });
    expect(result.events.filledCount).toBe(0);
    expect(result.events.skippedCount).toBe(1);
    expect(result.events.skippedOrders[0]!.reason).toContain("开盘低于预期");
  });

  it("次日开盘预期三档：尾盘板低开判定不及预期并放弃买入", () => {
    const priceByStockDate = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-19", price(9.8, 9.9)],
    ]);
    const state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [makePending({ signalClosePrice: 10, limitUpTime: "14:40:00" })] };
    const table = {
      early: { center: 3, lower: 1, upper: 4 },
      morning: { center: 2.5, lower: 1, upper: 4 },
      afternoon: { center: 1, lower: -1, upper: 3 },
      late: { center: 0, lower: 0, upper: 2 },
      unknown: { center: 1, lower: -2, upper: 4 },
    };
    const result = advancePaperTradingDay({
      state,
      today: "2026-08-19",
      signalCandidates: [],
      priceByStockDate,
      tradingDates,
      strategyKey: "baseline",
      realistic: { ...realistic, minimumExpectedOpenChangePercent: -50, expectationTierEnabled: true, expectationTable: table },
    });
    expect(result.events.filledCount).toBe(0);
    expect(result.events.skippedCount).toBe(1);
    expect(result.events.skippedOrders[0]!.reason).toContain("次日不及预期");
  });

  it("收盘触发止损出清", () => {
    const priceByStockDate = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-19", price(10.0, 10.0)],
      ["600001.SH::2026-08-20", price(9.5, 9.4)],
    ]);
    let state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [makePending({ signalClosePrice: 10 })] };
    const advance = (today: string) => {
      const result = advancePaperTradingDay({ state, today, signalCandidates: [], priceByStockDate, tradingDates, strategyKey: "baseline", realistic });
      state = result.state;
      return result;
    };
    advance("2026-08-19");
    const day2 = advance("2026-08-20");
    expect(day2.events.exitedCount).toBe(1);
    expect(day2.events.exitedOrders[0]!.reason).toContain("止损");
  });

  it("推进后生成下一交易日准备清单并排除持仓", () => {
    const priceByStockDate = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-19", price(10.2, 10.4)],
      ["600001.SH::2026-08-18", price(10, 10)],
    ]);
    const signalCandidates = [makeCandidate({ stockCode: "600001.SH", score: 80 })];
    const state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [makePending()] };
    const result = advancePaperTradingDay({
      state,
      today: "2026-08-19",
      signalCandidates,
      priceByStockDate,
      tradingDates,
      strategyKey: "baseline",
      realistic,
    });
    // 持仓 600001 后，下一日清单不应再包含它。
    expect(result.state.pendingBuys).toHaveLength(0);
    expect(result.state.lastProcessedDate).toBe("2026-08-19");
  });
});

describe("buildPaperTradingSummary 前向曲线汇总", () => {
  it("统计已出清订单的胜率与收益", () => {
    const state: PaperTradingState = {
      cash: 100_000,
      positions: [],
      pendingBuys: [],
      orders: [
        { signalDate: "d", stockCode: "a", stockName: "A", score: 80, strategyScore: 80, riskScore: 0, riskTier: "低风险", entryDate: "d1", entryPrice: 10, shares: 100, totalFees: 0, exitDate: "d2", exitPrice: 11, netPnl: 100, netReturn: 10, status: "exited", reason: null },
        { signalDate: "d", stockCode: "b", stockName: "B", score: 70, strategyScore: 70, riskScore: 0, riskTier: "低风险", entryDate: "d1", entryPrice: 10, shares: 100, totalFees: 0, exitDate: "d2", exitPrice: 9, netPnl: -50, netReturn: -5, status: "exited", reason: null },
      ],
      equityCurve: [
        { date: "d1", equity: 100_000, cash: 99_000, openPositions: 2 },
        { date: "d2", equity: 100_050, cash: 100_050, openPositions: 0 },
      ],
      lastProcessedDate: "d2",
    };
    const summary = buildPaperTradingSummary(state, 100_000);
    expect(summary.exitedCount).toBe(2);
    expect(summary.winningTrades).toBe(1);
    expect(summary.winRate).toBe(50);
    expect(summary.netProfit).toBe(50);
    expect(summary.tradingDayCount).toBe(2);
  });
});

// 事故背景（2026-09-14）：「推进」在交易日历落后时恒为空转，却报「已推进到最新交易日」。
// 这一组是防回归闸门：**空转必须区分**「合法已最新」与「日历落后（环境故障）」。
describe("classifyAdvanceKind 推进三态判定", () => {
  const CALENDAR_END = "2026-09-04"; // 事故现场：指数日线停更日
  const MARKET_END = "2026-09-14"; // 涨停记录 / 日线行情末端

  it("有推进日期 ⇒ advanced（日历仍落后也照样是 advanced）", () => {
    expect(classifyAdvanceKind({ advancedDates: ["2026-09-11"], calendarLastDate: CALENDAR_END, marketLastDate: MARKET_END }))
      .toBe("advanced");
    expect(classifyAdvanceKind({ advancedDates: ["2026-09-11"], calendarLastDate: CALENDAR_END, marketLastDate: CALENDAR_END }))
      .toBe("advanced");
  });

  it("无推进且日历末端 = 行情末端 ⇒ already-latest（合法空转）", () => {
    expect(classifyAdvanceKind({ advancedDates: [], calendarLastDate: MARKET_END, marketLastDate: MARKET_END }))
      .toBe("already-latest");
  });

  it("无推进且日历早于行情 ⇒ calendar-stale（事故真实形态，不得报成功）", () => {
    expect(classifyAdvanceKind({ advancedDates: [], calendarLastDate: CALENDAR_END, marketLastDate: MARKET_END }))
      .toBe("calendar-stale");
  });

  it("交易日历取不到末端 ⇒ calendar-stale，绝不伪装成「已是最新」", () => {
    expect(classifyAdvanceKind({ advancedDates: [], calendarLastDate: null, marketLastDate: MARKET_END }))
      .toBe("calendar-stale");
    expect(classifyAdvanceKind({ advancedDates: [], calendarLastDate: null, marketLastDate: null }))
      .toBe("calendar-stale");
  });

  it("行情末端取不到时不臆测日历落后（只按日历自身判定）", () => {
    expect(classifyAdvanceKind({ advancedDates: [], calendarLastDate: MARKET_END, marketLastDate: null }))
      .toBe("already-latest");
  });
});

describe("paperTradingAdvanceDiagnosis 人话结论", () => {
  it("advanced：带推进天数与日期，且不误报日历落后", () => {
    const diagnosis = paperTradingAdvanceDiagnosis({
      kind: "advanced",
      lastProcessedDate: "2026-09-10",
      advancedDates: ["2026-09-11", "2026-09-14"],
      calendarLastDate: "2026-09-14",
      marketLastDate: "2026-09-14",
    });
    expect(diagnosis.advancedDates).toEqual(["2026-09-11", "2026-09-14"]);
    expect(diagnosis.calendarStale).toBe(false);
    expect(diagnosis.message).toContain("已推进 2 个交易日");
    expect(diagnosis.message).toContain("2026-09-11、2026-09-14");
  });

  it("advanced 但日历仍落后：calendarStale=true 且文案要求先同步指数日线", () => {
    const diagnosis = paperTradingAdvanceDiagnosis({
      kind: "advanced",
      lastProcessedDate: "2026-08-01",
      advancedDates: ["2026-09-04"],
      calendarLastDate: "2026-09-04",
      marketLastDate: "2026-09-14",
    });
    expect(diagnosis.kind).toBe("advanced");
    expect(diagnosis.calendarStale).toBe(true);
    expect(diagnosis.message).toContain("同步指数日线");
  });

  it("calendar-stale：同时给出日历末端与行情末端", () => {
    const diagnosis = paperTradingAdvanceDiagnosis({
      kind: "calendar-stale",
      lastProcessedDate: "2026-09-10",
      calendarLastDate: "2026-09-04",
      marketLastDate: "2026-09-14",
    });
    expect(diagnosis.calendarStale).toBe(true);
    expect(diagnosis.message).toContain("2026-09-04");
    expect(diagnosis.message).toContain("2026-09-14");
    expect(diagnosis.message).toContain("指数日线");
  });

  it("取不到日历时给出「无数据」而非「已是最新」", () => {
    const diagnosis = paperTradingAdvanceDiagnosis({
      kind: "calendar-stale",
      lastProcessedDate: "2026-09-10",
      calendarLastDate: null,
      marketLastDate: null,
    });
    expect(diagnosis.message).toContain("没有数据");
    expect(diagnosis.message).not.toContain("已是最新");
  });

  it("already-latest / 三类失败态各有明确文案（都不伪装成成功）", () => {
    const latest = paperTradingAdvanceDiagnosis({ kind: "already-latest", lastProcessedDate: "2026-09-14" });
    expect(latest.message).toContain("2026-09-14");
    expect(latest.calendarStale).toBe(false);

    expect(paperTradingAdvanceDiagnosis({ kind: "run-not-found" }).message).toContain("运行不存在");
    expect(paperTradingAdvanceDiagnosis({ kind: "run-not-active" }).message).toContain("不能推进");
    expect(paperTradingAdvanceDiagnosis({ kind: "database-unavailable" }).message).toContain("数据库不可用");
  });

  it("message 可覆盖默认文案（调用方定制）", () => {
    const diagnosis = paperTradingAdvanceDiagnosis({ kind: "already-latest", message: "自定义说明" });
    expect(diagnosis.message).toBe("自定义说明");
  });
});

describe("PaperTradingCalendarStaleError 建运行前置校验", () => {
  it("带稳定领域码与细节，便于路由把码写进 message", () => {
    const error = new PaperTradingCalendarStaleError("最新信号日越过日历末端", {
      signalDate: "2026-09-14",
      calendarLastDate: "2026-09-04",
    });
    expect(error.code).toBe("PAPER_TRADING_CALENDAR_STALE");
    expect(error.name).toBe("PaperTradingCalendarStaleError");
    expect(error.details).toEqual({ signalDate: "2026-09-14", calendarLastDate: "2026-09-04" });
    expect(error).toBeInstanceOf(Error);
  });
});
