/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management：in-memory 生命周期账本（可选容器）。
 *
 * 用途：给未来 runner / 编排层一个「状态变更唯一入口」的示例容器——所有变更都经
 * map.applyLifecycleTransition（同步产出一条 append-only transition，否则抛错拒绝），
 * 不存在任何「只改 status 不落审计」的旁路（§23 禁止无记录修改）。
 *
 * 设计纪律（对齐 experimentLineage/bridge.ts 哲学）：
 *   - 纯内存、无 DB、无 IO；进程内隔离，不做持久化（持久化属未来 DB 层职责）；
 *   - 存取的永远是深冻结副本 / 新记录的克隆，绝不把内部对象引用交给调用方改写；
 *   - 确定性：list() 按 lifecycleId 字典序返回；失败响亮（未知 id / 重复建壳抛错）。
 */

import { applyLifecycleTransition, createStrategyLifecycleRecord } from "./map";
import type { LifecycleTransitionInput, StrategyLifecycleRecord, StrategyLifecycleRecordInput } from "./types";

export class StrategyLifecycleLedger {
  /** lifecycleId = `${strategyId}@${version}`（与 inheritance.parentLifecycleId 的可读形态一致）。 */
  private readonly store = new Map<string, StrategyLifecycleRecord>();

  static lifecycleIdOf(strategyId: string, strategyVersion: string): string {
    return `${strategyId}@${strategyVersion}`;
  }

  /** 已存在该策略版本的生命周期壳。 */
  has(strategyId: string, strategyVersion: string): boolean {
    return this.store.has(StrategyLifecycleLedger.lifecycleIdOf(strategyId, strategyVersion));
  }

  /** 建壳（存 genesis 快照；重复建壳拒绝——一个策略版本恰好一个生命周期，防双轨污染）。 */
  create(input: StrategyLifecycleRecordInput): StrategyLifecycleRecord {
    const lifecycleId = StrategyLifecycleLedger.lifecycleIdOf(input.strategyId, input.strategyVersion);
    if (this.store.has(lifecycleId)) {
      throw new Error(
        `生命周期账本：策略版本 ${lifecycleId} 已存在生命周期壳，禁止重复建壳（一个策略版本一个壳，防双轨污染）`,
      );
    }
    const record = createStrategyLifecycleRecord(input);
    this.store.set(lifecycleId, structuredClone(record));
    return structuredClone(record);
  }

  /**
   * 状态变更（唯一入口）：校验迁移 + 四要素 + 证据门槛，append 新 transition 并覆盖壳。
   * 失败（跳级 / 缺记录 / 无证据升级）时账本保持原状并抛错。
   */
  transition(strategyId: string, strategyVersion: string, input: LifecycleTransitionInput): StrategyLifecycleRecord {
    const lifecycleId = StrategyLifecycleLedger.lifecycleIdOf(strategyId, strategyVersion);
    const current = this.store.get(lifecycleId);
    if (current === undefined) {
      throw new Error(
        `生命周期账本：策略版本 ${lifecycleId} 尚无生命周期壳，请先 create（禁止对不存在的策略做无记录状态变更）`,
      );
    }
    const next = applyLifecycleTransition(current, input);
    this.store.set(lifecycleId, structuredClone(next));
    return structuredClone(next);
  }

  /** 取当前壳（深拷贝；未建壳抛错，不静默返回缺省）。 */
  get(strategyId: string, strategyVersion: string): StrategyLifecycleRecord {
    const lifecycleId = StrategyLifecycleLedger.lifecycleIdOf(strategyId, strategyVersion);
    const raw = this.store.get(lifecycleId);
    if (raw === undefined) {
      throw new Error(`生命周期账本：策略版本 ${lifecycleId} 无生命周期壳记录`);
    }
    return structuredClone(raw);
  }

  /** 列出全部壳（按 lifecycleId 字典序，确定性）。 */
  list(): StrategyLifecycleRecord[] {
    return Array.from(this.store.keys())
      .sort()
      .map((id) => structuredClone(this.store.get(id) as StrategyLifecycleRecord));
  }
}
