/**
 * Dataset 构建 — 有界并发原语（Node 原生，零依赖）。
 *
 * 定位：跨境 TiDB 是**延迟受限**（实测单次 RTT ≈ 0.21s），构建链路的正确做法不是
 * 「多线程」（Node 无共享内存线程模型，且 limitUpDays 等状态必须单线程串行推进），
 * 而是**把相互独立的 I/O 用有界并发叠起来**，把连接池真正用满。
 *
 * 铁律：
 *   - **有界**：并发度必须显式给定且不得超过连接池上限（否则只是把排队搬到客户端）；
 *   - **保序**：`mapWithConcurrency` 的结果数组与输入顺序**逐一对应**（乱序完成不影响结果顺序），
 *     保证构建的确定性可复现；
 *   - **快速失败**：任一子任务抛错立刻向外抛（不吞、不延迟到全部跑完），
 *     先把在飞的任务收敛再抛，避免留下未处理的 rejection。
 */

/** 连接池默认并发上限（与 server/db.ts 的 connectionLimit 对齐；env DB_POOL_SIZE 可覆盖）。 */
export function defaultConcurrency(): number {
  const raw = Number(process.env.DB_POOL_SIZE);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(Math.floor(raw), 32);
  return 8;
}

/** 把数组按 size 均分为连续切片（size ≤ 1 时原样返回单元素切片）。 */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step) as T[]);
  return out;
}

/**
 * 有界并发 map：最多 `concurrency` 个子任务同时在飞，结果**按输入顺序**返回。
 *
 * @param items 输入序列
 * @param mapper 单个元素 → Promise
 * @param concurrency 并发上限（≤ 0 视作 1）
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  if (limit === 1) {
    for (let i = 0; i < items.length; i += 1) results[i] = await mapper(items[i]!, i);
    return results;
  }

  let cursor = 0;
  let failure: unknown = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (failure === null) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index]!, index);
      } catch (err) {
        // 记录首个失败并停止领取新任务；在飞任务自然收敛后统一抛出（不产生未处理 rejection）。
        if (failure === null) failure = err;
        return;
      }
    }
  });
  await Promise.all(workers);
  if (failure !== null) throw failure;
  return results;
}

/** 有界并发 forEach（无返回值）：用于「并发发出、顺序无关」的副作用（如批量写入）。 */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
): Promise<void> {
  await mapWithConcurrency(items, worker, concurrency);
}

// ---------------------------------------------------------------------------
// 分片粒度（实测标定，见 ROADMAP §47 数据集构建性能专项）
// ---------------------------------------------------------------------------
//
// 分片目标：**单次 SQL 的返回行数有界**，同时把「同一份数据被相邻分片重复抓取」的放大倍数压到最低。
// 实测（跨境 TiDB，RTT≈0.21s）：行数越少越接近纯 RTT 下界；60 天全市场冷片 ≈ 21.9 万行/16.9s，
// 而其中仅约 8% 可能封板。

/** 单次 `IN (…)` 的 symbol 个数上限（400 实测 1.46s/1.6 万行，再大边际收益递减且 SQL 变长）。 */
export const SYMBOL_BATCH_SIZE = 400;

/**
 * 单条 INSERT 的最大行数（MySQL/TiDB 单语句占位符上限 65535；event 表 17 列 → 2000×17=34000，安全）。
 * 实测 5000 行/批的「每行成本」低于 1000 行/批约 1.7×，故写入仍按 `batchSize` 逻辑分片，
 * 但 IO 层再把单片压到本上限，避免占位符超限。
 */
export const MAX_ROWS_PER_STATEMENT = 2000;

/**
 * Phase 2 的日期分片长度（事件日个数）。
 *
 * 分片内先取「本片事件涉及的 symbol 集合」，再按 symbol 定向取数 —— 相比按整段日期取全市场，
 * 实测数据量压缩 13.4×（21.9 万行 → 1.6 万行）、耗时 16.9s → 1.46s。
 * 分片长度决定内存峰值（片内所有事件的窗口 bar 同时驻留），30 个事件日 ≈ 数百只标的。
 */
export const PATH_CHUNK_DAYS = 30;

/**
 * Phase 1 的「富集/落库」分片长度（事件日个数）。
 *
 * 逐日做流动性富集 + 事件 upsert 会产生「2 次/日」的往返（实测单次约 0.77s）——
 * 一年 242 个交易日即 ~370 次往返。改为按片（片内一次性按 symbol 批量富集、按 `batchSize` 批量落库）
 * 可把往返降到 ~12 次/年，同时保证 checkpoint 只上报**已落库**的日期（resume 语义不放松）。
 */
export const EVENT_CHUNK_DAYS = 20;

/**
 * 单次涨停候选查询的最大跨月数；超过则按月切分并发下推。
 *
 * 实测整年单次 12.8s → 月度分片 concurrency=12 为 3.9s、concurrency=4 为 8.5s。
 */
export const CANDIDATE_RANGE_MAX_MONTHS = 1;

/**
 * 单表内的写入并发（Phase 2 的 4 张表已各自并发，故此处取 2 → 最多 8 条语句在飞，
 * 与连接池上限 10 留出余量；同表写入的是**互不相同**的唯一键，不会互相等待）。
 */
export const INSERT_CONCURRENCY = 2;

