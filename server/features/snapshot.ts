/**
 * STEP 5 — Feature Snapshot。
 *
 * 快照内所有 feature 值必须来自同一 symbol、同一 asOf（decisionDate + decisionPoint）
 * 下同一份可见数据切片；禁止把不同时点计算的特征混入同一快照。
 */

import type { DecisionPoint } from "../data";
import type { FeatureStatus } from "./contract";

/** 快照中单个 feature 的条目。 */
export interface FeatureSnapshotEntry {
  value: number | null;
  status: FeatureStatus;
  requiredBars: number;
  availableBars: number;
  note?: string | null;
}

/** 统一 asOf 描述（快照内所有 feature 共享）。 */
export interface FeatureAsOf {
  decisionDate: string;
  decisionPoint: DecisionPoint;
}

/** Feature Snapshot：symbol + asOf + feature 值表。 */
export interface FeatureSnapshot {
  symbol: string;
  asOf: FeatureAsOf;
  features: Record<string, FeatureSnapshotEntry>;
}

/**
 * 多标的 Feature Snapshot 集合（供龙头候选这类「一个信号日含多只候选股」的策略消费）。
 * 铁律：
 *   - bundle.asOf 与内部每个 snapshot.asOf 一致（同一 decisionDate + decisionPoint）；
 *   - 集合内每只股票的快照都来自其自身在 asOf 允许窗口内的可见数据；
 *   - bundle 不可变：读取方禁止修改其中的快照。
 */
export interface FeatureSnapshotBundle {
  /** 集合共享的 asOf（= 各成员 snapshot.asOf）。 */
  asOf: FeatureAsOf;
  /** symbol → 该 symbol 在 asOf 的 FeatureSnapshot。 */
  bySymbol: ReadonlyMap<string, FeatureSnapshot>;
}

/**
 * 由一批同 asOf 的单标快照构建 bundle。
 * 校验：任一快照的 asOf 与声明 asOf 不一致即抛错（禁止把不同时点快照混入同一集合）。
 */
export function createFeatureSnapshotBundle(asOf: FeatureAsOf, snapshots: ReadonlyArray<FeatureSnapshot>): FeatureSnapshotBundle {
  const bySymbol = new Map<string, FeatureSnapshot>();
  for (const snapshot of [...snapshots].sort((left, right) => left.symbol.localeCompare(right.symbol))) {
    if (snapshot.asOf.decisionDate !== asOf.decisionDate || snapshot.asOf.decisionPoint !== asOf.decisionPoint) {
      throw new Error(
        `FeatureSnapshotBundle 禁止混入不同 asOf 快照：${snapshot.symbol} ${snapshot.asOf.decisionDate}:${snapshot.asOf.decisionPoint} != ${asOf.decisionDate}:${asOf.decisionPoint}`,
      );
    }
    bySymbol.set(snapshot.symbol, snapshot);
  }
  return { asOf, bySymbol };
}
