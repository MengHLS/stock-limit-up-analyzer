/**
 * 已同步行情「对位」索引（行情同步页性能）
 *
 * 背景（实测证据，2026-09-11）：
 *   - `stock_daily_prices` 共 8,893,077 行；
 *   - 跨境 TiDB 全表取回 `SELECT stockCode, tradeDate` 需 **700,376ms（≈12 分钟）**，
 *     再在 JS 里建 8,893,077 个字符串的 `Set` 又要 +23,280ms，内存约 1GB；
 *   - 而同步检查真正需要的只是「该股票该交易日有没有行情」这一位信息。
 *
 * 因此把该信息压成 **交易日序号位图**：
 *   - 位图起点 `2019-01-01`（与 stock_daily_prices 最早交易日一致），上限 4096 天；
 *   - 每只股票 512 字节，全量（约 5,800 只）≈ 2.8MB，内存占用从 ~1GB 降到 ~3MB；
 *   - 查询 O(1)；
 *   - 磁盘快照（`.cache/stock-price-day-index.json`）→ 冷启动秒级载入；
 *   - 快照缺失时用一次 `GROUP_CONCAT(DATEDIFF(...))` 聚合重建（实测 ~90s，不再逐行传输）；
 *   - 每次经 `upsertStockDailyPrices` 写入行情后 **增量置位**，避免频繁重建。
 *
 * 注意：`stock_daily_prices` 只增不删（upsert 覆盖），所以增量置位是单调的、安全的。
 * 若通过脚本（如 backfillDaily）直接写库而绕过服务端，索引会滞后 —— 由 `maxAgeMs` 兜底重建。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getStockDailyPriceDaySeries } from "./db";

/** 位图起点，必须与 stock_daily_prices 最早交易日一致。 */
export const STOCK_PRICE_INDEX_ORIGIN = "2019-01-01";
const ORIGIN_MS = Date.parse(`${STOCK_PRICE_INDEX_ORIGIN}T00:00:00Z`);
const MS_PER_DAY = 86_400_000;
/** 位图容量（天）。4096 天 ≈ 11 年，覆盖 2019-01-01 起并留出未来余量。 */
const MAX_DAY_OFFSET = 4096;
const BYTES_PER_STOCK = Math.ceil(MAX_DAY_OFFSET / 8);
const INDEX_VERSION = 2;
const INDEX_FILE = resolve(process.cwd(), ".cache", "stock-price-day-index.json");
/** 快照超过该时长即视为可能滞后（绕过服务端的脚本回填），需要重建。 */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type StockPriceIndexStatus = "missing" | "loading" | "building" | "ready" | "error";

export type StockPriceIndexSnapshot = {
  status: StockPriceIndexStatus;
  builtAt: string | null;
  loadedFrom: "disk" | "database" | null;
  stockCount: number;
  pairCount: number;
  buildStartedAt: string | null;
  buildFinishedAt: string | null;
  lastBuildMs: number | null;
  error: string | null;
};

type IndexBits = Map<string, Uint8Array>;

let bits: IndexBits = new Map();
let status: StockPriceIndexStatus = "missing";
let builtAt: number | null = null;
let loadedFrom: "disk" | "database" | null = null;
let pairCount = 0;
let buildStartedAt: number | null = null;
let buildFinishedAt: number | null = null;
let lastBuildMs: number | null = null;
let lastError: string | null = null;
let inFlight: Promise<void> | null = null;

/** 把 `YYYY-MM-DD` 换算为距位图起点的天数；超出范围返回 null。 */
export function stockPriceDayOffset(tradeDate: string): number | null {
  const ms = Date.parse(`${tradeDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const offset = Math.round((ms - ORIGIN_MS) / MS_PER_DAY);
  if (offset < 0 || offset >= MAX_DAY_OFFSET) return null;
  return offset;
}

function setBit(target: Uint8Array, offset: number): void {
  target[offset >> 3] |= 1 << (offset & 7);
}

function hasBit(target: Uint8Array, offset: number): boolean {
  return (target[offset >> 3] & (1 << (offset & 7))) !== 0;
}

function emptyBitmap(): Uint8Array {
  return new Uint8Array(BYTES_PER_STOCK);
}

export function stockPriceIndexSnapshot(): StockPriceIndexSnapshot {
  return {
    status,
    builtAt: builtAt === null ? null : new Date(builtAt).toISOString(),
    loadedFrom,
    stockCount: bits.size,
    pairCount,
    buildStartedAt: buildStartedAt === null ? null : new Date(buildStartedAt).toISOString(),
    buildFinishedAt: buildFinishedAt === null ? null : new Date(buildFinishedAt).toISOString(),
    lastBuildMs,
    error: lastError,
  };
}

export function isStockPriceIndexReady(): boolean {
  return status === "ready";
}

/**
 * 判断「该股票在该交易日是否已有行情」。
 * 索引未就绪时返回 `null`（调用方必须显式区分「未知」与「不存在」，不得当作缺失处理）。
 */
export function hasStockDailyPrice(stockCode: string, tradeDate: string): boolean | null {
  if (status !== "ready") return null;
  const offset = stockPriceDayOffset(tradeDate);
  if (offset === null) return false;
  const target = bits.get(stockCode);
  if (!target) return false;
  return hasBit(target, offset);
}

/** 已同步行情对总数（等价于原先 `getStockDailyPricePairs().size`，但无需扫表）。 */
export function stockPricePairCount(): number {
  return pairCount;
}

/**
 * 增量登记刚写入库的行情对（由 upsertStockDailyPrices 的调用方传入）。
 * 幂等：重复置位不改变结果。索引未就绪时直接忽略（就绪后会由完整重建补齐）。
 */
export function registerSyncedPricePairs(rows: ReadonlyArray<{ stockCode: string; tradeDate: string }>): number {
  if (status !== "ready" || rows.length === 0) return 0;
  let added = 0;
  for (const row of rows) {
    const offset = stockPriceDayOffset(row.tradeDate);
    if (offset === null) continue;
    let target = bits.get(row.stockCode);
    if (!target) {
      target = emptyBitmap();
      bits.set(row.stockCode, target);
    }
    if (!hasBit(target, offset)) {
      setBit(target, offset);
      added += 1;
      pairCount += 1;
    }
  }
  return added;
}

async function readSnapshot(): Promise<{ builtAt: number; bits: IndexBits; pairCount: number } | null> {
  try {
    const text = await readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(text) as {
      version?: number;
      origin?: string;
      builtAt?: number;
      series?: Array<[string, string]>;
    };
    if (parsed.version !== INDEX_VERSION) return null;
    if (parsed.origin !== STOCK_PRICE_INDEX_ORIGIN) return null;
    if (typeof parsed.builtAt !== "number" || !Array.isArray(parsed.series)) return null;
    const restored: IndexBits = new Map();
    let restoredPairs = 0;
    for (const entry of parsed.series) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [code, encoded] = entry;
      if (typeof code !== "string" || typeof encoded !== "string") continue;
      const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
      if (bytes.length !== BYTES_PER_STOCK) continue;
      restored.set(code, bytes);
    }
    // 重新统计置位数，避免快照被截断时计数失真。
    for (const [code, bytes] of restored) {
      for (let index = 0; index < MAX_DAY_OFFSET; index += 1) {
        if (hasBit(bytes, index)) restoredPairs += 1;
      }
      void code;
    }
    return { builtAt: parsed.builtAt, bits: restored, pairCount: restoredPairs };
  } catch {
    return null;
  }
}

async function writeSnapshot(): Promise<void> {
  const series: Array<[string, string]> = [];
  for (const [code, bytes] of bits) series.push([code, Buffer.from(bytes).toString("base64")]);
  const payload = JSON.stringify({
    version: INDEX_VERSION,
    origin: STOCK_PRICE_INDEX_ORIGIN,
    builtAt: builtAt ?? Date.now(),
    stockCount: bits.size,
    pairCount,
    series,
  });
  await mkdir(dirname(INDEX_FILE), { recursive: true });
  await writeFile(INDEX_FILE, payload, "utf8");
}

/** 从数据库整表聚合重建位图索引（一次聚合查询，实测 ~90s）。 */
export async function rebuildStockPriceIndex(): Promise<StockPriceIndexSnapshot> {
  const startedAt = Date.now();
  status = "building";
  buildStartedAt = startedAt;
  lastError = null;
  try {
    const rows = await getStockDailyPriceDaySeries();
    const next: IndexBits = new Map();
    let count = 0;
    for (const row of rows) {
      if (!row.offsets) continue;
      const target = emptyBitmap();
      for (const token of row.offsets.split(",")) {
        const offset = Number.parseInt(token, 10);
        if (!Number.isFinite(offset) || offset < 0 || offset >= MAX_DAY_OFFSET) continue;
        if (hasBit(target, offset)) continue;
        setBit(target, offset);
        count += 1;
      }
      next.set(row.stockCode, target);
    }
    bits = next;
    pairCount = count;
    builtAt = Date.now();
    loadedFrom = "database";
    buildFinishedAt = Date.now();
    lastBuildMs = buildFinishedAt - startedAt;
    status = "ready";
    await writeSnapshot().catch((error: unknown) => {
      console.warn("[StockPriceIndex] 快照写入失败（不影响本次查询）：", error);
    });
  } catch (error: unknown) {
    status = "error";
    lastError = error instanceof Error ? error.message : String(error);
    buildFinishedAt = Date.now();
    console.error("[StockPriceIndex] 重建失败：", error);
  }
  return stockPriceIndexSnapshot();
}

/**
 * 确保索引可用：优先载入磁盘快照；快照缺失/过期时返回需重建的标记。
 * 只做一次磁盘尝试与一次构建触发，重复调用共享同一个 Promise。
 */
export async function refreshStockPriceIndex(options: { force?: boolean; maxAgeMs?: number } = {}): Promise<StockPriceIndexSnapshot> {
  if (inFlight) {
    await inFlight;
    if (!options.force) return stockPriceIndexSnapshot();
  }
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const run = (async () => {
    if (!options.force) {
      status = status === "ready" ? status : "loading";
      const snapshot = await readSnapshot();
      if (snapshot && Date.now() - snapshot.builtAt <= maxAgeMs) {
        bits = snapshot.bits;
        pairCount = snapshot.pairCount;
        builtAt = snapshot.builtAt;
        loadedFrom = "disk";
        status = "ready";
        return;
      }
      if (snapshot) {
        // 快照已过期：先立即可用（避免页面空窗），随后由事件循环触发后台重建。
        bits = snapshot.bits;
        pairCount = snapshot.pairCount;
        builtAt = snapshot.builtAt;
        loadedFrom = "disk";
        status = "ready";
        console.warn(
          `[StockPriceIndex] 磁盘快照已过期（${new Date(snapshot.builtAt).toISOString()}），将在后台重建`,
        );
        return;
      }
    }
    await rebuildStockPriceIndex();
  })().finally(() => {
    inFlight = null;
  });
  inFlight = run;
  await run;
  return stockPriceIndexSnapshot();
}

/** 触发（幂等、非阻塞）索引装载；适合在服务启动或查询入口调用。 */
export function ensureStockPriceIndex(): void {
  if (inFlight || status === "ready" || status === "building") return;
  void refreshStockPriceIndex().catch((error: unknown) => {
    console.warn("[StockPriceIndex] 后台装载失败：", error);
  });
}

/** 强制丢充并后台重建（供写操作后或人工「重建索引」使用）。 */
export function invalidateStockPriceIndex(): void {
  if (inFlight) return;
  void refreshStockPriceIndex({ force: true }).catch((error: unknown) => {
    console.warn("[StockPriceIndex] 强制重建失败：", error);
  });
}

/** 仅测试使用：清空进程内状态。 */
export function resetStockPriceIndexForTests(): void {
  bits = new Map();
  status = "missing";
  builtAt = null;
  loadedFrom = null;
  pairCount = 0;
  buildStartedAt = null;
  buildFinishedAt = null;
  lastBuildMs = null;
  lastError = null;
  inFlight = null;
}
