/**
 * 止损口径**等价性**探针 —— 组合回测（realisticBacktest）vs 前向纸面（paperTrading）。
 *
 * 沿革（必读，否则会误判本探针的方向）：
 *   - 2026-09-18 `9bd` STOPLOSS-PARITY-AUDIT-001 首次建立本探针，断言方向是「**偏差存在**」：
 *     当时纸面**没有**开盘阶段止损（D1 结构性缺陷），页面与模块自述却写「开盘触发止损即按开盘出清」。
 *   - 2026-09-18 `9be` 修复 D1（补齐纸面开盘阶段退出）+ 按用户要求新增**纸面专属**组合无条件止损。
 *     ⇒ 断言方向**翻转**为「**两端等价**，且唯一的差异是纸面专属组合止损、可由配置关闭 / 回退」。
 *
 * 本探针现在证明三件事：
 *   ① 同一条价格路径下，两端的 exitDate / exitPrice 逐位一致（开盘分支、收盘分支都对得上）；
 *   ② 唯一的刻意分叉 = 纸面组合无条件止损，**且只有纸面源码里有这条规则**（回测源码零命中）；
 *   ③ 该分叉可由配置关闭 / 回退（`portfolioStopLossPercent: 0` 复原等价；`exitJudgementPhase: "close"`
 *      为「有意保留的时点差异」，不是缺陷）。
 *
 * 只读：不连库、不发请求、不改任何源码。输出同时落盘 `_probe_stoploss_divergence.out.txt`。
 * 运行：node_modules/.bin/tsx docs/evidence/_probe_stoploss_divergence.mts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { simulateRealisticTPlus1ToTPlus2 } from "../../server/realisticBacktest";
import type { RealisticBacktestResult } from "../../server/realisticBacktest";
import type { LeaderCandidateBacktestRow, LeaderCandidateDailyPrice } from "../../server/leaderCandidates";
import {
  advancePaperTradingDay,
  createInitialPaperTradingState,
  type PaperPendingBuy,
  type PaperTradingSettings,
  type PaperTradingState,
} from "../../server/paperTrading";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, "_probe_stoploss_divergence.out.txt");

const CODE = "600001.SH";
const SIGNAL_DATE = "2026-08-18";
const ENTRY_DATE = "2026-08-19"; // T+1：开盘买入日
const SECOND_DATE = "2026-08-20"; // T+2：退出规则生效首日
const TRADING_DATES = ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"];
/** 成交额（千元）。≥2_000_000 ⇒ 流动性滑点加罚为 0，便于逐位比对成交价。 */
const AMOUNT = 3_000_000;

const lines: string[] = [];
const log = (text = "") => { lines.push(text); };
let failures = 0;
const check = (name: string, pass: boolean, detail: string) => {
  if (!pass) failures += 1;
  log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
};

type DayPath = { open: number; low: number; close: number; high?: number };

/** T+1 与 T+2 的日线（两套实现共用同一条路径）。 */
function buildPrices(path2: DayPath): Map<string, LeaderCandidateDailyPrice> {
  const day1: LeaderCandidateDailyPrice = {
    openPrice: 10, closePrice: 10.2, highPrice: 10.2, lowPrice: 10, amount: AMOUNT, preClosePrice: 10,
  };
  const day2: LeaderCandidateDailyPrice = {
    openPrice: path2.open,
    closePrice: path2.close,
    highPrice: path2.high ?? Math.max(path2.open, path2.close, path2.low),
    lowPrice: path2.low,
    amount: AMOUNT,
    preClosePrice: 10.2,
  };
  return new Map([
    [`${CODE}::${ENTRY_DATE}`, day1],
    [`${CODE}::${SECOND_DATE}`, day2],
  ]);
}

function backtestRow(path2: DayPath): LeaderCandidateBacktestRow {
  return {
    date: SIGNAL_DATE,
    nextDate: ENTRY_DATE,
    nextDayDate: ENTRY_DATE,
    secondDayDate: SECOND_DATE,
    stockCode: CODE,
    stockName: "测试股票",
    sector: "题材A",
    boards: 2,
    score: 80,
    circulationValue: "50",
    marketCapScore: 12,
    success: false,
    signalClosePrice: 10,
    nextOpenPrice: 10,
    nextClosePrice: 10.2,
    nextOpenPremium: 0,
    nextClosePremium: 2,
    secondDayOpenPrice: path2.open,
    secondDayClosePrice: path2.close,
    secondDayOpenPremium: null,
    secondDayClosePremium: null,
    tPlus1CloseToTPlus2CloseReturn: null,
    tPlus1CloseToTPlus2CloseSuccess: false,
    phase: "修复上升",
    maxBoards: 3,
  };
}

/** 两套实现共同的成本/仓位底座：零费用、零滑点，便于逐位比对成交价。 */
const BASE = {
  initialCapital: 100_000,
  maxPositions: 1,
  lotSize: 100,
  commissionRate: 0,
  stampDutyRate: 0,
  transferFeeRate: 0,
  slippageBps: 0,
  blockLimitUpBuys: false,
  blockLimitDownSells: false,
};

/** 与两端缺省一致的风险参数（回测页默认值 = 纸面硬编码缺省）。 */
const RISK_DEFAULT = {
  trailingProfitActivationPercent: 6,
  trailingDrawdownPercent: 3,
  stopLossPercent: 5,
  strongHoldMinReturn: 3,
  maxHoldingDays: 5,
};

function runBacktest(path2: DayPath, risk: Partial<typeof RISK_DEFAULT> & Record<string, unknown> = {}): RealisticBacktestResult {
  return simulateRealisticTPlus1ToTPlus2(
    [backtestRow(path2)],
    { ...BASE, minimumExpectedOpenChangePercent: -50, ...RISK_DEFAULT, ...risk },
    buildPrices(path2),
    TRADING_DATES,
  );
}

function runPaper(
  path2: DayPath,
  risk: Partial<typeof RISK_DEFAULT> & Record<string, unknown> = {},
  paperTrading?: PaperTradingSettings,
) {
  const pending: PaperPendingBuy = {
    rank: 1,
    stockCode: CODE,
    stockName: "测试股票",
    sector: "题材A",
    boards: 2,
    signalDate: SIGNAL_DATE,
    signalClosePrice: 10,
    limitUpTime: "09:40:00",
    score: 80,
    riskScore: 20,
    riskTier: "低风险",
    strategyScore: 80,
    reasons: [],
  };
  let state: PaperTradingState = { ...createInitialPaperTradingState(100_000), pendingBuys: [pending] };
  const prices = buildPrices(path2);
  const realistic = { ...BASE, minimumExpectedOpenChangePercent: -50, ...RISK_DEFAULT, ...risk };
  const exits: Array<{ date: string; price: number | null; reason: string | null }> = [];
  let lastOpenPositions = 0;
  for (const today of TRADING_DATES.slice(1)) {
    const result = advancePaperTradingDay({
      state, today, signalCandidates: [], priceByStockDate: prices, tradingDates: TRADING_DATES,
      strategyKey: "baseline", realistic, paperTrading,
    });
    state = result.state;
    for (const order of result.events.exitedOrders) exits.push({ date: today, price: order.exitPrice, reason: order.reason });
    lastOpenPositions = result.events.openPositions;
  }
  return { exits, lastOpenPositions, finalPositions: state.positions.map((p) => ({ code: p.stockCode, shares: p.shares })) };
}

const btFilled = (result: RealisticBacktestResult) => result.trades.filter((t) => t.status === "filled")[0];
const pct = (a: number, b: number) => (((a - b) / b) * 100).toFixed(2);

/** 为了让「回测侧行为」可控，纸面侧在本探针里**关闭**纸面专属组合止损（否则它抢先触发）。 */
const PAPER_PARITY: PaperTradingSettings = { portfolioStopLossPercent: 0, exitJudgementPhase: "both" };

log("=== 止损口径等价性探针：组合回测（realisticBacktest） vs 前向纸面（paperTrading）===");
log("共同前提：初始资金 100,000；T+1 开盘 10.00 买入（零费用零滑点，10,000 股 = 满仓）；止损 5% ⇒ 止损价 9.50；");
log("         T+1 收盘 10.20（最高收盘价基准）；T+2 为退出规则生效首日。");
log("口径说明：本探针对比「退出规则」本身 ⇒ 纸面侧关闭纸面专属组合止损（portfolioStopLossPercent=0），");
log("         以便逐位比对；组合止损单独在第 4/5 节验证。");
log();

// ── 场景 1：T+2 开盘跳空破位，当日收回 ─────────────────────────────────────
const S1: DayPath = { open: 9.4, low: 9.3, close: 10.6 };
log("【场景 1】T+2 开盘 -6.00%（破止损 9.50），盘中最低 -7.00%，收盘 +6.00%（收复全部跌幅）");
{
  const bt = btFilled(runBacktest(S1));
  const paper = runPaper(S1, {}, PAPER_PARITY);
  log(`  组合回测：exitDate=${bt?.exitDate ?? "（无）"} exitPrice=${bt?.exitPrice ?? "（无）"} reason=${bt?.reason ?? "（无）"}`);
  log(`  前向纸面：出清次数=${paper.exits.length} ${paper.exits.length ? JSON.stringify(paper.exits) : "（当日未出清）"}`);
  check("两端都在 T+2 按开盘价 9.40 出清", bt?.exitPrice === 9.4 && paper.exits[0]?.price === 9.4, `回测 ${bt?.exitPrice} / 纸面 ${paper.exits[0]?.price}`);
  check("两端出清日一致 = T+2", bt?.exitDate === SECOND_DATE && paper.exits[0]?.date === SECOND_DATE, `${bt?.exitDate} / ${paper.exits[0]?.date}`);
  check("两端原因都含「开盘触发止损」", String(bt?.reason ?? "").includes("开盘触发止损") && String(paper.exits[0]?.reason ?? "").includes("开盘触发止损"), `回测「${bt?.reason}」 / 纸面「${paper.exits[0]?.reason}」`);
  check("纸面不再「收 +6% 就继续持有」（D1 已修：开盘出清优先于强势续持）", paper.exits.length === 1, `实际出清 ${paper.exits.length} 次`);
}
log();

// ── 场景 2：T+2 开盘跳空破位，续跌收低 ────────────────────────────────────
const S2: DayPath = { open: 9.4, low: 9.2, close: 9.2 };
log("【场景 2】T+2 开盘 -6.00%（破止损 9.50），收盘 -8.00%");
{
  const bt = btFilled(runBacktest(S2));
  const paper = runPaper(S2, {}, PAPER_PARITY);
  log(`  组合回测：exitDate=${bt?.exitDate ?? "（无）"} exitPrice=${bt?.exitPrice ?? "（无）"} reason=${bt?.reason ?? "（无）"}`);
  log(`  前向纸面：${JSON.stringify(paper.exits)}`);
  check("两端成交价一致 = 9.40（此前纸面是收盘 9.20、低 2.13%）", bt?.exitPrice === paper.exits[0]?.price, `${bt?.exitPrice} / ${paper.exits[0]?.price}`);
  const gap = bt?.exitPrice !== undefined && paper.exits[0]?.price !== undefined ? pct(paper.exits[0].price, bt.exitPrice) : null;
  log(`  ⇒ 价差 ${gap}%（D1 修复前为 -2.13%）`);
}
log();

// ── 场景 3：仅盘中破位（开盘与收盘都在止损上方），开启盘中止损 ──────────────
const S3: DayPath = { open: 9.8, low: 9.3, close: 9.6 };
log("【场景 3·对照组】T+2 开盘 -2.00%、盘中最低 -7.00%（触及 9.50）、收盘 -4.00%；开启「盘中止损（用最低价）」");
{
  const risk = { enableIntradayStopLoss: true };
  const bt = btFilled(runBacktest(S3, risk));
  const paper = runPaper(S3, risk, PAPER_PARITY);
  log(`  组合回测：exitPrice=${bt?.exitPrice ?? "（无）"} reason=${bt?.reason ?? "（无）"}`);
  log(`  前向纸面：${JSON.stringify(paper.exits)}`);
  check("两端都按止损价 9.50 出清（盘中分支本就一致，未受本次改动影响）", bt?.exitPrice === 9.5 && paper.exits[0]?.price === 9.5, `${bt?.exitPrice} / ${paper.exits[0]?.price}`);
  check("两端原因都含「盘中触及止损」", String(bt?.reason ?? "").includes("盘中触及止损") && String(paper.exits[0]?.reason ?? "").includes("盘中触及止损"), `回测「${bt?.reason}」 / 纸面「${paper.exits[0]?.reason}」`);
}
log();

// ── 场景 4：纸面专属组合无条件止损 —— 唯一的刻意分叉 ────────────────────────
// 满仓（10,000 股 / 建仓总权益 100,000）⇒ 组合止损 3% 对应价格 ≤ 9.70，比单票止损 5%（9.50）更早。
const S4: DayPath = { open: 9.65, low: 9.6, close: 10.55 };
log("【场景 4】T+2 开盘 -3.50%（未破单票止损 9.50）、收盘 +5.50%（≥ 强势续持阈值 3%）");
{
  const bt = btFilled(runBacktest(S4));
  const paperDefault = runPaper(S4); // 缺省：开盘+收盘 / 组合止损 3%
  const paperOff = runPaper(S4, {}, PAPER_PARITY); // 关闭组合止损
  log(`  组合回测：exitDate=${bt?.exitDate ?? "（无）"} reason=${bt?.reason ?? "（无）"}（强势续持续持 ⇒ 不出清）`);
  log(`  前向纸面（组合止损 3%）：${JSON.stringify(paperDefault.exits)}`);
  log(`  前向纸面（组合止损关闭）：出清次数=${paperOff.exits.length}，期末持仓=${JSON.stringify(paperOff.finalPositions)}`);
  check("纸面在开盘按 9.65 触发组合止损出清", paperDefault.exits[0]?.price === 9.65 && String(paperDefault.exits[0]?.reason ?? "").includes("开盘触发组合止损"), `${paperDefault.exits[0]?.price} / ${paperDefault.exits[0]?.reason}`);
  // ⚠️ 两个坑：
  //   ① 回测的 trade 在**建仓时**就把 exitDate 预填为 secondDayDate（计划退出日）⇒ 未出清时 exitDate 也非 null；
  //   ② 未出清的 trade 也会被写上 reason（「满足强势续持…；回测结束仍持仓，按期末价估值」）
  //      ⇒ **reason 不是「是否出清」的判据**。唯一可靠判据 = exitPrice 是否为 null。
  check("回测同日**不出清**（回测没有组合止损这条规则）", bt?.exitPrice === null && bt?.netPnl === null, `exitPrice=${bt?.exitPrice ?? "（无）"} netPnl=${bt?.netPnl ?? "（无）"} reason=${bt?.reason ?? "（无）"}`);
  check("把组合止损设为 0 ⇒ 纸面回到与回测等价（不出清）", paperOff.exits.length === 0 && paperOff.finalPositions.length === 1, `出清 ${paperOff.exits.length} 次 / 持仓 ${paperOff.finalPositions.length}`);
  log("  ⇒ 这是**用户要求的口径分叉**（只加纸面、不动回测以免重算全部历史回测数值），不是缺陷；上一条断言给出关闭开关。");
}
log();

// ── 场景 5：判定时点可配 —— 「仅收盘」是有意保留的时点差异 ─────────────────
log("【场景 5】价格路径同场景 1；把纸面判定时点设为「仅收盘」（组合止损仍关闭）");
{
  const paperClose = runPaper(S1, {}, { portfolioStopLossPercent: 0, exitJudgementPhase: "close" });
  const paperBoth = runPaper(S1, {}, PAPER_PARITY);
  const bt = btFilled(runBacktest(S1));
  log(`  前向纸面（仅收盘）：出清次数=${paperClose.exits.length}${paperClose.exits.length ? ` ${JSON.stringify(paperClose.exits)}` : "（收 +6% 满足强势续持 ⇒ 持有）"}`);
  log(`  前向纸面（开盘+收盘）：${JSON.stringify(paperBoth.exits)}`);
  log(`  组合回测：exitPrice=${bt?.exitPrice} reason=${bt?.reason}`);
  check("时点=开盘+收盘 ⇒ 与回测一致（都按开盘 9.40 出清）", paperBoth.exits[0]?.price === bt?.exitPrice, `${paperBoth.exits[0]?.price} / ${bt?.exitPrice}`);
  check("时点=仅收盘 ⇒ 开盘不判、当日不出清（**有意**的时点差异，由配置决定）", paperClose.exits.length === 0, `实际出清 ${paperClose.exits.length} 次`);
}
log();

// ── 静态断言：边界必须能从源码上看出来 ────────────────────────────────────
const btSource = readFileSync(join(HERE, "..", "..", "server", "realisticBacktest.ts"), "utf8");
const paperSource = readFileSync(join(HERE, "..", "..", "server", "paperTrading.ts"), "utf8");
const countOf = (text: string, needle: string) => text.split(needle).length - 1;
log("【源码静态断言】");
check("realisticBacktest.ts 存在「开盘触发止损」分支", countOf(btSource, "开盘触发止损") > 0, `出现 ${countOf(btSource, "开盘触发止损")} 次`);
check("paperTrading.ts **也有**「开盘触发止损」分支（D1 已修）", countOf(paperSource, "开盘触发止损") > 0, `出现 ${countOf(paperSource, "开盘触发止损")} 次`);
check("「组合止损」只出现在纸面源码里，回测源码零命中", countOf(paperSource, "组合止损") > 0 && countOf(btSource, "组合止损") === 0, `纸面 ${countOf(paperSource, "组合止损")} 次 / 回测 ${countOf(btSource, "组合止损")} 次`);
check("纸面仍有「动态回撤止盈」且新增了开盘分支", countOf(paperSource, "动态回撤止盈") >= 2, `出现 ${countOf(paperSource, "动态回撤止盈")} 次`);
log();

log(`=== 结论：${failures === 0 ? "全部断言通过" : `${failures} 条断言失败`}（本探针的断言方向为「两端等价 + 唯一刻意分叉」）===`);
log(failures === 0
  ? "组合回测与前向纸面在止损上**已等价**：同路径下退出日、成交价、原因三处逐位一致；"
    + "唯一差异是纸面专属的「组合无条件止损」（回测侧不存在），可由 portfolioStopLossPercent=0 关闭。"
  : "等价性未成立，请复核两端退出规则是否再次分叉。");

const text = lines.join("\n") + "\n";
writeFileSync(OUT_PATH, text, "utf8");
process.stdout.write(text);
process.exit(failures === 0 ? 0 : 1);
