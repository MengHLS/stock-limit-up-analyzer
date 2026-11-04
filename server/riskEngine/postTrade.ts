/**
 * STEP 9 — Risk Engine · 后置风控（Post-Trade Risk）。
 *
 * calculatePortfolioRisk()：输入 PortfolioSnapshot，输出 RiskSnapshot。
 * 计算组合层面的敞口、集中度、行业敞口、回撤、单日亏损、年化波动率，
 * 并对照 RiskLimit 产出被击穿的限额列表。
 *
 * 确定性：纯函数，不使用 Date.now()/Math.random()/网络/全局状态；
 * 行业敞口与持仓排序均做确定性排序。
 *
 * 行业敞口为「接口」：行业映射由上层通过 sectorOf 注入（依赖 STEP 7.x 历史行业数据），
 * 本引擎不内置任何行业字典；未解析到行业的持仓不参与行业敞口。
 * 波动率为「接口」：日收益序列由上层传入（依赖 STEP 7.x 全市场日线回填的权益曲线）。
 */

import { sampleStandardDeviation } from "../../shared/quant-stats";
import { round2, type PortfolioSnapshot } from "../portfolio";
import type { RiskHistory, RiskLimit, RiskSnapshot, SectorExposure, SectorResolver } from "./domain";

export interface CalculatePortfolioRiskInput {
  snapshot: PortfolioSnapshot;
  limits: RiskLimit;
  /** 行业解析（可选）。 */
  sectorOf?: SectorResolver;
  /** 历史上下文（可选；缺省则 drawdown/dailyLoss/volatility 取 0/null）。 */
  history?: RiskHistory;
}

const TRADING_DAYS_PER_YEAR = 252;

/** 组合权益（<=0 时回退为 1，避免除零）。 */
function equityOf(snapshot: PortfolioSnapshot): number {
  return snapshot.equity > 0 ? snapshot.equity : 1;
}

/** 后置风控：从组合快照计算风险快照。 */
export function calculatePortfolioRisk(input: CalculatePortfolioRiskInput): RiskSnapshot {
  const { snapshot, limits, sectorOf, history } = input;
  const equity = equityOf(snapshot);

  // ---- 敞口 ----
  const grossExposure = snapshot.marketValue / equity;
  const netExposure = grossExposure; // 当前仅多头，short=0；接口已预留 long/short 分解
  const cashExposure = snapshot.cash / equity;
  const positionExposure = snapshot.marketValue / equity;

  // ---- 单股集中度 ----
  let singleStockConcentration = 0;
  for (const p of snapshot.positions) {
    const weight = p.marketValue / equity;
    if (weight > singleStockConcentration) singleStockConcentration = weight;
  }

  // ---- 行业敞口（接口，确定性排序） ----
  const sectorValueMap = new Map<string, number>();
  for (const p of snapshot.positions) {
    const sector = p.sector ?? sectorOf?.(p.symbol);
    if (sector === undefined || sector === "") continue;
    sectorValueMap.set(sector, round2((sectorValueMap.get(sector) ?? 0) + p.marketValue));
  }
  const sectorExposures: SectorExposure[] = Array.from(sectorValueMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([sector, marketValue]) => ({ sector, marketValue, weight: marketValue / equity }));

  // ---- 回撤 / 单日亏损 / 波动率（接口） ----
  const drawdown = history && Number.isFinite(history.peakEquity) && history.peakEquity > 0
    ? Math.max(0, (history.peakEquity - snapshot.equity) / history.peakEquity)
    : 0;
  const dailyLoss = history && Number.isFinite(history.previousEquity) && history.previousEquity > 0
    ? Math.max(0, (history.previousEquity - snapshot.equity) / history.previousEquity)
    : 0;
  const vol = history ? sampleStandardDeviation(history.dailyReturns) : null;
  const annualizedVolatility = vol === null ? null : vol * Math.sqrt(TRADING_DAYS_PER_YEAR);

  // ---- 限额击穿（固定顺序，确定性） ----
  const breaches: RiskSnapshot["breaches"] = [];
  const push = (code: string, limit: number, actual: number, message: string) => {
    breaches.push({ code, limit, actual, message });
  };

  if (limits.maxPositions > 0 && snapshot.positions.length > limits.maxPositions) {
    push("maxPositions", limits.maxPositions, snapshot.positions.length, `持仓数 ${snapshot.positions.length} 超过上限 ${limits.maxPositions}`);
  }
  if (limits.maxPositionWeight > 0 && singleStockConcentration > limits.maxPositionWeight) {
    push("maxPositionWeight", limits.maxPositionWeight, singleStockConcentration, `单股集中度 ${singleStockConcentration.toFixed(4)} 超过上限 ${limits.maxPositionWeight}`);
  }
  if (limits.maxSectorWeight > 0) {
    for (const s of sectorExposures) {
      if (s.weight > limits.maxSectorWeight) {
        push("maxSectorWeight", limits.maxSectorWeight, s.weight, `行业 ${s.sector} 权重 ${s.weight.toFixed(4)} 超过上限 ${limits.maxSectorWeight}`);
      }
    }
  }
  if (limits.maxGrossExposure > 0 && grossExposure > limits.maxGrossExposure) {
    push("maxGrossExposure", limits.maxGrossExposure, grossExposure, `总敞口 ${grossExposure.toFixed(4)} 超过上限 ${limits.maxGrossExposure}`);
  }
  if (limits.maxNetExposure > 0 && netExposure > limits.maxNetExposure) {
    push("maxNetExposure", limits.maxNetExposure, netExposure, `净敞口 ${netExposure.toFixed(4)} 超过上限 ${limits.maxNetExposure}`);
  }
  if (limits.maxDrawdown > 0 && drawdown > limits.maxDrawdown) {
    push("maxDrawdown", limits.maxDrawdown, drawdown, `回撤 ${drawdown.toFixed(4)} 超过上限 ${limits.maxDrawdown}`);
  }
  if (limits.maxDailyLoss > 0 && dailyLoss > limits.maxDailyLoss) {
    push("maxDailyLoss", limits.maxDailyLoss, dailyLoss, `单日亏损 ${dailyLoss.toFixed(4)} 超过上限 ${limits.maxDailyLoss}`);
  }

  return {
    grossExposure,
    netExposure,
    cashExposure,
    positionExposure,
    singleStockConcentration,
    sectorExposures,
    drawdown,
    dailyLoss,
    annualizedVolatility,
    breaches,
  };
}
