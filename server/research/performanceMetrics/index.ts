/**
 * STEP 16 / C-16.1 — 策略评价·收益/风险/回撤指标统一出口。
 *
 * 消费 C-14.1 simulator 产出的 equityCurve / trades 记录流，产出研究链路专用的
 * 收益/风险/回撤确定性评估（Sharpe/Sortino/Calmar 属 C-16.2、交易质量属 C-16.3，
 * 本目录不实现；纯函数与记录形态即为扩展面）。
 */

export * from "./types";
export * from "./analyze";
export * from "./evaluate";
