/**
 * STEP 5 P2-2 —— research-legacy 模拟器与新引擎「非等价」契约测试。
 *
 * 为什么下行风险研究必须保留 research-legacy 模拟器、不能切换为 Strategy Engine？
 * 因为二者交易语义不等价：
 *
 *   · research-legacy（simulateRealisticTPlus1ToTPlus2）：
 *     T 收盘信号 → T+1 开盘买入 → 风险管理退出（开盘止损 / 动态止盈 / 强势续持 /
 *     最多持有 N 日强制出清）→ **资金循环复用**。因此会产出「已完成平仓交易」。
 *
 *   · Strategy Engine 生产策略（leader-candidate-baseline）：
 *     long-only、无 SELL 信号，持仓持有到回测期末按市价估值（Mark-to-Market）。
 *     Engine Result Adapter 语义（由 realisticSimulationSemantics.test.ts 固定）：
 *     completedCount=0 → winRate=null、winningTrades=0，openPositionCount>0。
 *
 * 若有人声称「研究实验可等价替换为引擎」，本测试会失败：
 *   同一类回测输入下，legacy 明确产出已平仓交易（winRate 非 null），
 *   而引擎语义固定为「无平仓事件」。二者不可互换。
 *
 * 边界铁律校验：RESEARCH_LEGACY_SIMULATION_SOURCE 是唯一合法研究出口，
 * productionRuntime=false；生产核心服务（runLeaderCandidateStrategyBacktest）结果中
 * 研究段必须为 null（由 productionIntegration.test.ts TEST 9 校验字段形状另行覆盖）。
 */

import { describe, expect, it } from "vitest";
import type { LeaderCandidateBacktestRow, LeaderCandidateDailyPrice } from "../leaderCandidates";
import { RESEARCH_LEGACY_SIMULATION_SOURCE } from "./legacyTransactionSimulator";

function row(overrides: Partial<LeaderCandidateBacktestRow>): LeaderCandidateBacktestRow {
  return {
    date: "2026-03-02",
    nextDate: "2026-03-03",
    nextDayDate: "2026-03-03",
    secondDayDate: "2026-03-04",
    stockCode: "600001.SH",
    stockName: "测试股",
    sector: "题材A",
    boards: 2,
    sectorCount: 4,
    score: 80,
    limitUpTime: "09:40:00",
    turnover: "20",
    circulationValue: "100",
    marketCapScore: 16,
    success: false,
    signalClosePrice: 10,
    nextOpenPrice: 10.2,
    nextClosePrice: 10.5,
    nextOpenPremium: 2,
    nextClosePremium: 5,
    secondDayOpenPrice: 10.5,
    secondDayClosePrice: 11,
    secondDayOpenPremium: 5,
    secondDayClosePremium: 10,
    tPlus1CloseToTPlus2CloseReturn: 5,
    tPlus1CloseToTPlus2CloseSuccess: true,
    phase: "修复上升",
    maxBoards: 3,
    ...overrides,
  };
}

/** 连续 30 个信号日、每日一只温和上行候选：legacy 会在多次信号间完成平仓并复用资金。 */
function buildLegacyFixture() {
  const tradingDates = Array.from({ length: 30 }, (_, index) => {
    const day = index + 1;
    return `2026-03-${String(day).padStart(2, "0")}`;
  });
  const rows: LeaderCandidateBacktestRow[] = [];
  const prices = new Map<string, LeaderCandidateDailyPrice>();
  for (let index = 0; index < tradingDates.length - 1; index += 1) {
    const date = tradingDates[index]!;
    const next = tradingDates[index + 1]!;
    const stockCode = `6000${String(index).padStart(2, "0")}.SH`;
    rows.push(row({ date, nextDate: next, nextDayDate: next, stockCode }));
    // 信号日收盘 ~10，随后温和上行：legacy 按风险管理退出并释放资金 → 存在已平仓交易。
    for (let dayIndex = index; dayIndex < tradingDates.length; dayIndex += 1) {
      const dayPrice = 10 + (dayIndex - index) * 0.15;
      prices.set(`${stockCode}::${tradingDates[dayIndex]!}`, {
        openPrice: Number(dayPrice.toFixed(2)),
        closePrice: Number(dayPrice.toFixed(2)),
        lowPrice: Number((dayPrice - 0.1).toFixed(2)),
        amount: 90_000,
      });
    }
  }
  return { tradingDates, rows, prices };
}

describe("P2-2 research-legacy 与 Engine 非等价契约", () => {
  it("research-legacy 唯一出口标识：productionRuntime=false，语义明确为逐笔退出+资金循环", () => {
    expect(RESEARCH_LEGACY_SIMULATION_SOURCE.productionRuntime).toBe(false);
    expect(RESEARCH_LEGACY_SIMULATION_SOURCE.id).toBe("research-legacy-tplus1-tplus2");
    expect(RESEARCH_LEGACY_SIMULATION_SOURCE.semantics).toContain("资金循环");
    expect(typeof RESEARCH_LEGACY_SIMULATION_SOURCE.simulate).toBe("function");
  });

  it("legacy 在同一回测输入下产出已平仓交易与资金循环（引擎语义下 completedCount=0，故二者不等价）", () => {
    const { tradingDates, rows, prices } = buildLegacyFixture();
    const simulation = RESEARCH_LEGACY_SIMULATION_SOURCE.simulate(rows, {
      initialCapital: 100_000,
      maxPositions: 2,
      commissionRate: 0.0003,
      stampDutyRate: 0.0005,
      transferFeeRate: 0.00001,
      slippageBps: 10,
      lotSize: 100,
    }, prices, tradingDates);

    // legacy 有能力完成平仓：存在已平仓交易 → 已平仓胜率非 null（引擎语义恒为 null）。
    expect(simulation.filledCount).toBeGreaterThan(0);
    expect(simulation.completedCount).toBeGreaterThan(0);
    expect(simulation.winRate).not.toBeNull();
    // 资金循环复用：成交笔数可超过同时持仓上限（平仓后释放资金再开新仓）。
    expect(simulation.filledCount).toBeGreaterThan(2);

    // 引擎语义对照：long-only 无 SELL → completedCount=0 / winRate=null（另见 realisticSimulationSemantics.test.ts）。
    // 若研究默认来源被替换为引擎 Adapter，上述断言将无法满足 —— 即「伪等价」被本测试拦截。
  });
});
