import { createHash } from "node:crypto";

/**
 * 回测结果与中间数据的内存缓存层。
 * - 结果缓存：按「参数 JSON 哈希」命中，相同参数直接返回上次结果，避免重复跑全量模拟。
 * - 中间数据缓存：price/marketFactor/phase/suspension 等只依赖 DB 的数据单独物化，参数变化只重算模拟部分。
 * 缓存只做加速，不含业务语义；数据变更后最多等待一个 TTL 周期即可反映。
 */

/** 稳定序列化 + 哈希，把参数对象映射成确定性缓存键。 */
export function stableHash(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** 简单的 TTL + LRU 内存缓存（进程内，重启即失效）。 */
export class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 64,
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // 命中后刷新到队尾，实现近 LRU 语义。
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    const existing = this.store.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = Date.now() + this.ttlMs;
      this.store.delete(key);
      this.store.set(key, existing);
      return;
    }
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
