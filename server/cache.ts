/**
 * 简单的内存缓存实现，用于缓存频繁查询的结果
 * 支持TTL（生存时间）和手动失效
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class QueryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private timers = new Map<string, NodeJS.Timeout>();

  /**
   * 从缓存获取值
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * 设置缓存值
   * @param key 缓存键
   * @param value 缓存值
   * @param ttlMs 生存时间（毫秒），默认5分钟
   */
  set<T>(key: string, value: T, ttlMs: number = 5 * 60 * 1000): void {
    // 清除旧的定时器
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key)!);
    }

    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { value, expiresAt });

    // 设置自动过期定时器
    const timer = setTimeout(() => {
      this.delete(key);
    }, ttlMs);

    this.timers.set(key, timer);
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key)!);
      this.timers.delete(key);
    }
    return this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.timers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.cache.clear();
    this.timers.clear();
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取或设置缓存值（缓存穿透保护）
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlMs: number = 5 * 60 * 1000
  ): Promise<T> {
    // 先检查缓存
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // 缓存未命中，调用获取函数
    const value = await fetchFn();
    this.set(key, value, ttlMs);
    return value;
  }
}

// 导出全局缓存实例
export const queryCache = new QueryCache();

/**
 * 缓存键生成工具
 */
export const cacheKeys = {
  // 涨停相关
  allLimitUpRecords: () => 'limit_up:all',
  limitUpByDate: (date: string) => `limit_up:date:${date}`,
  limitUpSearch: (query: string) => `limit_up:search:${query}`,
  limitUpBySector: (sector: string) => `limit_up:sector:${sector}`,
  dailySectorStats: (date: string) => `sector_stats:${date}`,
  distinctDates: () => 'dates:distinct',
  dailyLimitUpStats: () => 'stats:daily_limit_up',
  dailySectorDistribution: () => 'stats:daily_sector_distribution',

  // 大盘数据相关
  marketDataByDate: (date: string) => `market_data:date:${date}`,
  allMarketData: () => 'market_data:all',
  recentMarketData: (days: number) => `market_data:recent:${days}`,

  // 关注列表相关
  userWatchlist: (userId: number) => `watchlist:user:${userId}`,
  isStockWatched: (userId: number, stockCode: string) => `watchlist:watched:${userId}:${stockCode}`,

  // 图片相关
  allUploadedImages: () => 'images:all',
};
