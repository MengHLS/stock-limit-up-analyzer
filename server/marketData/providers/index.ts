/**
 * STEP 7.6 — Provider 统一出口 + 注册表。
 * 消费方按 name 从注册表取 provider（provider-neutral），不直接依赖具体实现。
 */

import type { IndexProvider, IndustryProvider, LiquidityProvider } from "./types";
import { fetchTushareIndexIdentity, fetchTushareIndexDaily, tushareLiquidityProvider } from "./tushare";
import { fetchSinaIndexIdentity, fetchSinaIndexDaily } from "./sina";
import { fetchBaostockIndexIdentity, fetchBaostockIndexDaily, baostockLiquidityProvider } from "./baostock";
import { akShareSwIndustryProvider } from "./akshare";

export * from "./types";
export * from "./tushare";
export * from "./sina";
export * from "./baostock";
export * from "./akshare";
export { runPythonScript } from "./pythonBridge";

/** 指数 provider 注册表（provider-neutral）。 */
export const indexProviders: Record<string, IndexProvider> = {
  tushare: { name: "tushare", fetchIdentity: fetchTushareIndexIdentity, fetchDaily: fetchTushareIndexDaily },
  sina: { name: "sina", fetchIdentity: fetchSinaIndexIdentity, fetchDaily: fetchSinaIndexDaily },
  baostock: { name: "baostock", fetchIdentity: fetchBaostockIndexIdentity, fetchDaily: fetchBaostockIndexDaily },
};

/** 流动性 provider 注册表。 */
export const liquidityProviders: Record<string, LiquidityProvider> = {
  "tushare-daily-basic": tushareLiquidityProvider,
  "baostock-daily": baostockLiquidityProvider,
};

/** 行业 provider 注册表。 */
export const industryProviders: Record<string, IndustryProvider> = {
  "akshare-sw": akShareSwIndustryProvider,
};
