/**
 * RESEARCH-ONLY LEGACY TRANSACTION SIMULATOR —— 生产运行时边界（STEP 5 P2-2）。
 *
 * 本模块是「legacy 交易模拟器」在全 codebase 中的**唯一**合法出口。
 * 除本文件外，任何模块（尤其生产运行时模块）都不得直接引用
 * `simulateRealisticTPlus1ToTPlus2`，必须通过这里导出的 `ResearchSimulationSource`
 * 显式注入，以便调用图可追溯、可审计。
 *
 * ── 旧语义（legacy simulator：simulateRealisticTPlus1ToTPlus2）──────────────
 *   T 收盘信号 → T+1 开盘买入 → 风险管理退出：
 *     · 开盘触发止损即按开盘出清；
 *     · 收盘达到启动浮盈后，自持仓期最高收盘价回撤达到阈值则动态止盈；
 *     · 未启动止盈时仅满足「强势续持」条件才继续持有；
 *     · 超过 maxHoldingDays 强制出清。
 *   关键能力：**资金循环复用**（平仓释放现金后可继续开新仓）。
 *
 * ── 为什么不能换成新 Engine（非等价，禁止伪装等价）─────────────────────────
 *   新 Engine 的生产策略 leader-candidate-baseline 为 long-only、**不产生 SELL 信号**；
 *   持仓持有到回测期末按市价估值（Mark-to-Market）。Portfolio 的 maxPositions 限制的是
 *   「同时持仓数」，在无可卖出信号时等价于「整个回测期最多成交 maxPositions 笔」。
 *   因此新 Engine **不具备**「资金循环 + 逐笔退出」能力，与下列研究指标不等价：
 *     · selectPenaltyWeight（训练窗口 收益 − 0.5×回撤 寻优，依赖资金循环后的多笔成交）
 *     · strategyEvaluation.tradeQuality（胜率/盈亏比/最大连败，依赖逐笔退出）
 *     · buildTradeDifferences / buildRiskPenaltyAttribution（依赖订单替换与逐笔成交）
 *     · factorAblations（依赖逐笔成交差异）
 *   等价性由 server/research/engineNonEquivalence.test.ts 以可执行断言固定，
 *   任何人若声称二者等价，该测试会失败。
 *
 * ── 边界铁律 ──────────────────────────────────────────────────────────────
 *   1. 只允许 research-only 调用方使用（研究报表 / 历史对比 / legacy benchmark）；
 *   2. 严禁进入 `getLeaderCandidateBacktest` 生产请求路径——生产回测只由
 *      Strategy Engine 产出（见 server/leaderCandidateStrategyBacktest.ts）；
 *   3. 严禁影响任何生产信号 / 订单 / 成交 / 持仓 / 绩效；
 *   4. 研究报表的模拟来源必须在 API 层显式标注 provenance（DownsideRiskResearchResult.simulator）。
 */

import { simulateRealisticTPlus1ToTPlus2 } from "../realisticBacktest";
import type { LeaderCandidateBacktestRow, LeaderCandidateDailyPrice } from "../leaderCandidates";
import type { RealisticBacktestOptions, RealisticBacktestResult } from "../realisticBacktest";

/** 研究报表使用的交易模拟器签名（与 legacy 模拟器一致；priceByStockDate/tradingDates 缺省为空映射/空日历）。 */
export type ResearchTransactionSimulator = (
  rows: LeaderCandidateBacktestRow[],
  options: RealisticBacktestOptions | undefined,
  priceByStockDate: Map<string, LeaderCandidateDailyPrice> | undefined,
  tradingDates: string[] | undefined,
) => RealisticBacktestResult;

/** 研究报表模拟来源（模拟器 + 可对外暴露的 provenance）。 */
export type ResearchSimulationProvenance = {
  /** 模拟器标识，随 API 结果下发，供前端/审计识别。 */
  id: string;
  /** 可读名称。 */
  label: string;
  /** 是否为生产运行时（交易决策）使用的模拟器。研究报表恒为 false。 */
  productionRuntime: boolean;
  /** 该模拟器的交易语义说明。 */
  semantics: string;
};

export type ResearchSimulationSource = ResearchSimulationProvenance & {
  simulate: ResearchTransactionSimulator;
};

export const RESEARCH_LEGACY_SIMULATOR_ID = "research-legacy-tplus1-tplus2";

export const RESEARCH_LEGACY_SIMULATOR_SEMANTICS =
  "T 收盘信号 → T+1 开盘买入 → 风险管理退出（开盘止损 / 动态止盈回撤 / 强势续持 / 最多持有 N 日强制出清），支持资金循环复用。";

/**
 * 唯一的 research-legacy 交易模拟器来源。
 * 生产请求（getLeaderCandidateBacktest）不得引用；仅供研究报表与历史对比使用。
 */
export const RESEARCH_LEGACY_SIMULATION_SOURCE: ResearchSimulationSource = {
  id: RESEARCH_LEGACY_SIMULATOR_ID,
  label: "RESEARCH-LEGACY 交易模拟器（非生产引擎）",
  productionRuntime: false,
  semantics: RESEARCH_LEGACY_SIMULATOR_SEMANTICS,
  simulate: simulateRealisticTPlus1ToTPlus2,
};
