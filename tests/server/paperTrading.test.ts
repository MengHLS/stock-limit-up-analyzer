import { describe, expect, it } from "vitest";
import type { LeaderCandidate, LeaderCandidateDailyPrice } from "../../server/leaderCandidates";
import {
  advancePaperTradingDay,
  buildForwardPreparedBuys,
  buildPaperTradingSummary,
  classifyAdvanceKind,
  createInitialPaperTradingState,
  evaluateHardExitRules,
  paperTradingAdvanceDiagnosis,
  resolvePaperTradingSettings,
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

/**
 * 组合无条件止损 + 止损判定时点可配（2026-09-18，用户要求；**纸面专属**）。
 *
 * 口径（必须钉死，否则数值会漂）：
 * - 分母 = **建仓时账户总权益**（冻结在建仓那一刻），与回测 `pnlToEquityRatio` 同源；
 * - 浮亏 = 市值 − 建仓成本（成本含买入费用）；
 * - 触发 = 浮亏占建仓总权益的比例 ≤ −阈值，**无条件**（不受强势续持 / 回撤止盈已激活 / 最多续持未到豁免）；
 * - 缺省：判定时点 `both`、阈值 `3%`；旧运行 paramsJson 缺字段 ⇒ 零写库即生效。
 *
 * 本组用例的建仓算术（固定种子，便于人工复核）：
 *   开盘 10.00 → 滑点 10bp → 成交价 10.01；9900 股；建仓成本 99,129.72；建仓时账户总权益 100,000。
 *   ⇒ 组合止损阈值 3% ⇒ 3,000 元；单票比例止损阈值 5% ⇒ 价格 9.5095。
 *   ⇒ 收盘 9.68（单票 −3.30% > −5% **不触发**比例止损；浮亏 −3,297.72 = 建仓总权益的 −3.30% **触发**组合止损）。
 */
describe("advancePaperTradingDay 组合止损与判定时点", () => {
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

  /** 建仓日（08-19）+ 待判日（08-20）：建仓算术在注释里已固定，便于断言精确数值。 */
  const run = (
    day2Open: number,
    day2Close: number,
    paperTrading?: { exitJudgementPhase?: "open" | "close" | "both"; portfolioStopLossPercent?: number },
    extraRealistic: Record<string, unknown> = {},
  ) => {
    const priceByStockDate = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-19", price(10.0, 10.0)],
      ["600001.SH::2026-08-20", price(day2Open, day2Close)],
    ]);
    let state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [makePending()] };
    const advance = (today: string) => {
      const result = advancePaperTradingDay({
        state,
        today,
        signalCandidates: [],
        priceByStockDate,
        tradingDates,
        strategyKey: "baseline",
        realistic: { ...realistic, ...extraRealistic },
        paperTrading,
      });
      state = result.state;
      return result;
    };
    const day1 = advance("2026-08-19");
    const day2 = advance("2026-08-20");
    return { day1, day2, state };
  };

  it("建仓算术基线：成交价/股数/建仓成本/建仓时账户总权益", () => {
    const { day1 } = run(10.0, 10.0);
    expect(day1.events.filledCount).toBe(1);
    const filled = day1.events.filledOrders[0]!;
    expect(filled.shares).toBe(9900);
    expect(filled.entryPrice).toBeCloseTo(10.01, 4);
    expect(filled.totalFees).toBeCloseTo(30.72, 2);
    // 建仓当日不判退出（T+1 闸），且已冻结「建仓时账户总权益」= 100,000。
    expect(day1.events.exitedCount).toBe(0);
    expect(day1.state.positions).toHaveLength(1);
    expect(day1.state.positions[0]!.equityAtEntry).toBe(100_000);
  });

  it("组合止损在收盘触发：浮亏占建仓总权益 3.3% ⇒ 无条件出清（单票比例止损此时并未触发）", () => {
    // 开盘 10.01（与原价持平，不触发任何退出）→ 收盘 9.68：单票 −3.30% > −5%，只有组合止损成立。
    const { day2, state } = run(10.01, 9.68);
    expect(day2.events.exitedCount).toBe(1);
    const exited = day2.events.exitedOrders[0]!;
    expect(exited.exitDate).toBe("2026-08-20");
    expect(exited.exitPrice).toBeCloseTo(9.6703, 4);
    expect(exited.reason).toContain("收盘触发组合止损");
    // 分母必须是「建仓时账户总权益 100,000」：3.3%（而非按成本算的 3.33%）就是这条口径的指纹。
    expect(exited.reason).toContain("占建仓总权益 3.3%");
    expect(exited.reason).toContain("无条件出清");
    expect(exited.reason).not.toContain("触发止损（");
    expect(state.positions).toHaveLength(0);
  });

  it("组合止损在开盘触发：开盘 9.68 ⇒ 按开盘价出清（不是等到收盘）", () => {
    const { day2 } = run(9.68, 10.60);
    expect(day2.events.exitedCount).toBe(1);
    const exited = day2.events.exitedOrders[0]!;
    expect(exited.reason).toContain("开盘触发组合止损");
    // 关键差异：按开盘 9.68 出清；若等收盘（10.60）则反而是浮盈。
    expect(exited.exitPrice).toBeCloseTo(9.6703, 4);
  });

  it("判定时点=收盘 ⇒ 跳空破位不在开盘出清（保住旧语义），收盘缺口仍在收盘出清", () => {
    const { day2 } = run(9.30, 9.20, { exitJudgementPhase: "close" });
    expect(day2.events.exitedCount).toBe(1);
    const exited = day2.events.exitedOrders[0]!;
    expect(exited.reason).toContain("收盘触发止损");
    expect(exited.exitPrice).toBeCloseTo(9.1908, 4);
  });

  it("判定时点=开盘 ⇒ 跳空破位按开盘价出清（补上 D1 的开盘分支）", () => {
    const { day2 } = run(9.30, 10.60, { exitJudgementPhase: "open" });
    expect(day2.events.exitedCount).toBe(1);
    const exited = day2.events.exitedOrders[0]!;
    expect(exited.reason).toContain("开盘触发止损");
    expect(exited.exitPrice).toBeCloseTo(9.2907, 4);
  });

  it("判定时点=开盘 ⇒ 收盘不再判硬性止损，但续持类规则仍生效（否则持仓没有收盘退出路径）", () => {
    // 开盘 10.50 不触发；收盘 9.40 本应「收盘触发止损」，但时点设为仅开盘 ⇒ 落到续持判定。
    const { day2 } = run(10.50, 9.40, { exitJudgementPhase: "open" });
    expect(day2.events.exitedCount).toBe(1);
    const exited = day2.events.exitedOrders[0]!;
    expect(exited.reason).toContain("收盘未满足强势续持条件");
    expect(exited.reason).not.toContain("止损");
  });

  it("判定时点=开盘+收盘 ⇒ 同一日既有开盘判定也有收盘判定（缺省行为）", () => {
    const both = run(9.30, 10.60, { exitJudgementPhase: "both" });
    expect(both.day2.events.exitedOrders[0]!.reason).toContain("开盘触发止损");
    const closeOnly = run(10.50, 9.40, { exitJudgementPhase: "both" });
    expect(closeOnly.day2.events.exitedOrders[0]!.reason).toContain("收盘触发止损");
  });

  it("动态回撤止盈进入开盘判定：峰值 +9.89% 后开盘回撤 4.55% ⇒ 按开盘价止盈", () => {
    const priceByStockDate = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-19", price(10.0, 11.0)],
      ["600001.SH::2026-08-20", price(10.5, 10.6)],
    ]);
    let state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [makePending()] };
    const advance = (today: string) => {
      const result = advancePaperTradingDay({
        state, today, signalCandidates: [], priceByStockDate, tradingDates,
        strategyKey: "baseline", realistic,
      });
      state = result.state;
      return result;
    };
    advance("2026-08-19"); // 建仓日：收盘 11.00 计入峰值，不判退出。
    const day2 = advance("2026-08-20");
    expect(day2.events.exitedCount).toBe(1);
    const exited = day2.events.exitedOrders[0]!;
    expect(exited.reason).toContain("开盘触发动态回撤止盈");
    expect(exited.exitPrice).toBeCloseTo(10.4895, 4);
  });

  it("阈值设为 0 ⇒ 关闭组合止损，行为回落到「仅比例止损 + 续持」", () => {
    const { day2 } = run(10.01, 9.68, { portfolioStopLossPercent: 0 });
    expect(day2.events.exitedCount).toBe(1);
    const exited = day2.events.exitedOrders[0]!;
    expect(exited.reason).toContain("收盘未满足强势续持条件");
    expect(exited.reason).not.toContain("组合止损");
  });

  it("一字跌停卖不出时不假装出清，且如实写下原因（不留黑洞）", () => {
    // 涨停板跌停价 = 前收 10.00 × 0.9 = 9.00；开盘即跌停。
    const priceByStockDate = new Map<string, LeaderCandidateDailyPrice>([
      ["600001.SH::2026-08-19", price(10.0, 10.0)],
      ["600001.SH::2026-08-20", price(9.0, 9.0)],
    ]);
    let state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [makePending()] };
    const advance = (today: string) => {
      const result = advancePaperTradingDay({
        state, today, signalCandidates: [], priceByStockDate, tradingDates,
        strategyKey: "baseline", realistic: { ...realistic, blockLimitDownSells: true },
      });
      state = result.state;
      return result;
    };
    advance("2026-08-19");
    const day2 = advance("2026-08-20");
    expect(day2.events.exitedCount).toBe(0);
    expect(state.positions).toHaveLength(1);
    expect(state.orders[0]!.status).toBe("filled");
    expect(state.orders[0]!.reason).toContain("等待收盘确认可成交性");
  });
});

describe("resolvePaperTradingSettings 缺省解析（旧运行零写库即生效）", () => {
  it("完全不传 ⇒ 缺省「开盘+收盘 / 组合止损 3%」", () => {
    expect(resolvePaperTradingSettings(undefined)).toEqual({
      exitJudgementPhase: "both",
      portfolioStopLossPercent: 3,
    });
  });

  it("显式 0 表示关闭组合止损（不是「回落成缺省」）", () => {
    expect(resolvePaperTradingSettings({ portfolioStopLossPercent: 0 }).portfolioStopLossPercent).toBe(0);
  });

  it("认不出的时点值回落为缺省，不静默变成 undefined", () => {
    expect(resolvePaperTradingSettings({ exitJudgementPhase: "intraday" as never }).exitJudgementPhase).toBe("both");
  });

  it("阈值超界被夹取到 [0, 100]", () => {
    expect(resolvePaperTradingSettings({ portfolioStopLossPercent: 999 }).portfolioStopLossPercent).toBe(100);
    expect(resolvePaperTradingSettings({ portfolioStopLossPercent: -5 }).portfolioStopLossPercent).toBe(0);
  });
});

describe("evaluateHardExitRules 纯判定（优先级：比例止损 → 组合止损 → 回撤止盈）", () => {
  const position = {
    stockCode: "600001.SH",
    stockName: "测试股",
    signalDate: "2026-08-18",
    entryDate: "2026-08-19",
    entryPrice: 10.01,
    shares: 9900,
    capitalCost: 99_129.72,
    previousClosePrice: 10,
    highestClosePrice: 10.01,
    entryTradingDateIndex: 1,
    equityAtEntry: 100_000,
  };

  const base = {
    position,
    stopLossPercent: 5,
    trailingProfitActivationPercent: 6,
    trailingDrawdownPercent: 3,
    portfolioStopLossPercent: 3,
    fallbackEquityBase: 100_000,
  } as const;

  it("价格无效 / 非正 ⇒ 不判定（不臆测成交价）", () => {
    expect(evaluateHardExitRules({ ...base, phaseLabel: "开盘", price: Number.NaN })).toBeNull();
    expect(evaluateHardExitRules({ ...base, phaseLabel: "开盘", price: 0 })).toBeNull();
  });

  it("单票比例止损优先于组合止损（两者同时成立时给出前者）", () => {
    // 9.40 ⇒ 单票 −6.09% ≤ −5% 且组合 −6.09% ≤ −3%，必须报比例止损。
    const reason = evaluateHardExitRules({ ...base, phaseLabel: "开盘", price: 9.4 });
    expect(reason).toContain("开盘触发止损");
    expect(reason).not.toContain("组合止损");
  });

  it("旧持仓缺 equityAtEntry 时回落为传入的兜底分母（初始资金）", () => {
    const legacy = { ...position, equityAtEntry: undefined as unknown as number };
    const reason = evaluateHardExitRules({ ...base, phaseLabel: "收盘", price: 9.68, position: legacy });
    expect(reason).toContain("收盘触发组合止损");
    expect(reason).toContain("占建仓总权益 3.3%");
  });

  it("分组名与阈值都写进原因，便于事后读日志判口径", () => {
    const reason = evaluateHardExitRules({ ...base, phaseLabel: "收盘", price: 9.68 });
    expect(reason).toBe("收盘触发组合止损（该笔浮亏占建仓总权益 3.3%，达 3% 无条件出清）");
  });
});
