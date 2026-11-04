/**
 * STEP 7.3 — Checkpoint 存储。
 *
 * 支持中断续跑：已完成交易日不重复下载。checkpoint 记录 tradeDate / status /
 * attempts / rowCount / completedAt / errorCode。状态机 PENDING→RUNNING→
 * SUCCESS|FAILED|SUSPICIOUS|QUOTA_STOPPED。
 *
 * 一致性铁律（§20）：只有「数据持久化成功」之后才能标记 SUCCESS。错误顺序
 * 「checkpoint SUCCESS → 数据写入失败」绝对禁止。
 */

import type { BackfillCheckpoint, CheckpointStatus, CheckpointStore } from "./types";

/** 创建 PENDING checkpoint。 */
export function createPendingCheckpoint(tradeDate: string): BackfillCheckpoint {
  return {
    tradeDate,
    status: "PENDING",
    attempts: 0,
    rowCount: null,
    receivedRows: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
  };
}

/** 创建 RUNNING checkpoint（attempts 递增）。 */
export function toRunningCheckpoint(previous: BackfillCheckpoint | null, tradeDate: string): BackfillCheckpoint {
  return {
    tradeDate,
    status: "RUNNING",
    attempts: (previous?.attempts ?? 0) + 1,
    rowCount: previous?.rowCount ?? null,
    receivedRows: previous?.receivedRows ?? null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
  };
}

/** 创建终态 checkpoint。 */
export function toFinalCheckpoint(
  tradeDate: string,
  status: Exclude<CheckpointStatus, "PENDING" | "RUNNING">,
  attempts: number,
  details: { rowCount?: number | null; receivedRows?: number | null; errorCode?: string | null; errorMessage?: string | null } = {},
): BackfillCheckpoint {
  return {
    tradeDate,
    status,
    attempts,
    rowCount: details.rowCount ?? null,
    receivedRows: details.receivedRows ?? null,
    completedAt: new Date().toISOString(),
    errorCode: details.errorCode ?? null,
    errorMessage: details.errorMessage ?? null,
  };
}

/** 内存 checkpoint 存储（测试 / 短生命周期运行）。 */
export class MemoryCheckpointStore implements CheckpointStore {
  private readonly store = new Map<string, BackfillCheckpoint>();

  async get(tradeDate: string): Promise<BackfillCheckpoint | null> {
    return this.store.get(tradeDate) ?? null;
  }

  async set(checkpoint: BackfillCheckpoint): Promise<void> {
    this.store.set(checkpoint.tradeDate, { ...checkpoint });
  }

  async list(startDate: string, endDate: string): Promise<BackfillCheckpoint[]> {
    return Array.from(this.store.values())
      .filter((cp) => cp.tradeDate >= startDate && cp.tradeDate <= endDate)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  }

  /** 测试辅助：直接读取内部大小。 */
  get size(): number {
    return this.store.size;
  }
}
