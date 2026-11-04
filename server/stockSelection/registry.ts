/**
 * 选股策略注册表（STOCK-SELECTION-001）。
 *
 * 新增策略 = 新增 `strategies/<name>.ts` 实现 + 在本文件注册一行；页面与路由只依赖
 * `StockSelectionStrategy` 端口 ⇒ 「一个页面兼容不同策略」由本注册表兑现。
 */

import { DbDatasetDataReader } from "../datasetRegistry/query";
import { DbBarStore } from "../backtest/dbBarStore";
import { DbDatasetBuildIO } from "../datasetRegistry/db";
import { createDatasetSelectionDataSource } from "./sources/datasetSource";
import { createLiveSelectionDataSource } from "./sources/liveSource";
import { loadPrimaryIdentifiers } from "../runWorkbenchAssembly/datasetIdentityProvider";
import {
  createFirstLimitPullback3FTopNStrategy,
  FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
  type StockSelectionDeps,
} from "./strategies/firstLimitPullback3FTopN";
import type { SecurityIdentifier } from "../security/types";
import { StockSelectionError, type StockSelectionStrategy } from "./types";
import type { SelectionDataSourceKind } from "./dataSource";

/**
 * 进程内缓存 primary 标识（研究域小表，全表读一次约 19s；选股按日调用 ⇒ 必须只读一次）。
 *
 * 与 `runWorkbenchAssembly/datasetIdentityProvider#createCachedDatasetIdentityResolver` 同一动机：
 * 标识表是**跨区小表**，按日重读会把同一份不可变数据读 N 次。
 */
let cachedPrimaryIdentifiers: Promise<readonly SecurityIdentifier[]> | null = null;
function loadPrimaryIdentifiersOnce(): Promise<readonly SecurityIdentifier[]> {
  cachedPrimaryIdentifiers ??= loadPrimaryIdentifiers();
  return cachedPrimaryIdentifiers;
}

/**
 * 生产默认依赖。
 *
 * 载体：同时注册 `live`（当日原始行情，日常选股口径）与 `dataset`（冻结快照，研究 / 回放 /
 * 对拍口径）。请求未指认载体时用 `defaultSourceKind`；指认了但未注册 ⇒ **响亮拒绝**
 * （`SELECTION_DATA_SOURCE_UNSUPPORTED`），不静默回退。
 * 身份表：跨区小表，进程内只读一次。
 */
export function defaultStockSelectionDeps(overrides: Partial<StockSelectionDeps> = {}): StockSelectionDeps {
  return {
    sources: overrides.sources ?? [
      // live：当日原始行情（日常选股口径；**不需要数据集版本**）
      createLiveSelectionDataSource({
        bars: new DbBarStore(),
        referenceData: new DbDatasetBuildIO(),
        label: "当日行情（live）",
      }),
      // dataset：冻结快照（研究 / 回放 / 对拍口径）
      createDatasetSelectionDataSource({ reader: new DbDatasetDataReader() }),
    ],
    defaultSourceKind: overrides.defaultSourceKind ?? "dataset",
    loadIdentifiers: overrides.loadIdentifiers ?? loadPrimaryIdentifiersOnce,
    now: overrides.now,
  };
}

export interface StockSelectionRegistry {
  /** 可选策略清单（页面选择器用；不触发任何数据读取）。 */
  list(): readonly StockSelectionStrategy[];
  /** 可选**数据载体**清单（页面「数据来源」选择器用；不触发任何数据读取）。 */
  listDataSources(): readonly { readonly kind: SelectionDataSourceKind; readonly label: string }[];
  /** 按 id 取策略；未知 id **响亮抛错**（不静默回退到默认策略）。 */
  get(strategyId: string): StockSelectionStrategy;
}

export function createStockSelectionRegistry(
  deps: StockSelectionDeps = defaultStockSelectionDeps(),
): StockSelectionRegistry {
  const strategies: readonly StockSelectionStrategy[] = [createFirstLimitPullback3FTopNStrategy(deps)];
  const byId = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  return {
    list: () => strategies,
    listDataSources: () => strategies.length === 0 ? [] : deps.sources.map((source) => ({ kind: source.kind, label: source.label })),
    get: (strategyId: string) => {
      const strategy = byId.get(strategyId);
      if (strategy === undefined) {
        throw new StockSelectionError(
          "SELECTION_STRATEGY_UNKNOWN",
          `未注册的选股策略：${strategyId}（已注册：${[...byId.keys()].join(", ") || "无"}）。`,
        );
      }
      return strategy;
    },
  };
}

/** 已注册策略 id 常量（供路由 / 测试引用，避免硬编码字符串漂移）。 */
export const STOCK_SELECTION_STRATEGY_IDS = [FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID] as const;
