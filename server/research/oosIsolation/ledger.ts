/**
 * STEP 19 / C-19.2 — OOS 隔离归档账本（in-memory，append-only）。
 *
 * 用途：给未来 runner / 编排层一个「OOS 隔离记录归档唯一入口」的示例容器——每条
 * OosIsolationRun 以 runId 唯一入库，append-only，重复 runId 拒绝；不存在任何「只改记录
 * 不落归档」的旁路。范式对齐 C-21.1 `StrategyLifecycleLedger`（纯内存、无 DB、无 IO）。
 *
 * 设计纪律（对齐 lifecycle/ledger.ts 哲学）：
 *   - 纯内存、无 DB、无 IO；进程内隔离，不做持久化（持久化属未来 DB 层职责）；
 *   - 存取的永远是深拷贝（structuredClone），绝不把内部对象引用交给调用方改写；
 *   - 确定性：list() 按 runId 字典序返回；失败响亮（重复 runId / 未知 runId 抛错）。
 */

import type { OosIsolationRun } from "./types";

export class OosIsolationLedger {
  private readonly store = new Map<string, OosIsolationRun>();

  /** 是否已归档该 runId。 */
  has(runId: string): boolean {
    return this.store.has(runId);
  }

  /**
   * 归档一条 OosIsolationRun（append-only）。重复 runId → 抛错（防双轨污染）。
   * 存深拷贝，返回深拷贝，内部对象与调用方隔离。
   */
  append(run: OosIsolationRun): OosIsolationRun {
    if (this.store.has(run.runId)) {
      throw new Error(`OOS 隔离归档账本：runId ${run.runId} 已存在，禁止重复归档（append-only）`);
    }
    this.store.set(run.runId, structuredClone(run));
    return structuredClone(run);
  }

  /** 取一条归档（深拷贝；未知 runId 抛错，不静默返回缺省）。 */
  get(runId: string): OosIsolationRun {
    const raw = this.store.get(runId);
    if (raw === undefined) {
      throw new Error(`OOS 隔离归档账本：runId ${runId} 无归档记录`);
    }
    return structuredClone(raw);
  }

  /** 列出全部归档（按 runId 字典序，确定性）。 */
  list(): OosIsolationRun[] {
    return Array.from(this.store.keys())
      .sort()
      .map((id) => structuredClone(this.store.get(id) as OosIsolationRun));
  }

  /** 归档条数。 */
  count(): number {
    return this.store.size;
  }
}
