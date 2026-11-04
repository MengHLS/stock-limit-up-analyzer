/**
 * 直读桥「扩展为事件窗口投影」的**可行性 + 成本实测**（2026-09-14）。
 *
 * 背景：`docs/evidence/_probe_dataset_window_coverage.mts` 已证 `ds_*_post`（rd 1..20）
 * 带完整 OHLCV（471,816 行 / 2,967 证券）。本探针回答「改造成本」：
 *   A. 现有 rd=0 读法耗时（基线）
 *   B. post rd ∈ [1, +6]（观察窗口 5 天 + 执行日）批量读耗时与行数
 *   C. post rd ∈ [1, +20]（全部可用窗口）批量读耗时与行数
 *   D. 两种口径去重后的逐日面板规模（决定 `REGISTRY_BRIDGE_MAX_ROWS` 要不要调）
 *
 * 读法 = 与桥完全一致的 `loadRawBarsBatch` + `mapWithConcurrency`（batch 1000 / conc 池上限）。
 * 只读。用法（项目根目录）：npx tsx docs/evidence/_probe_bridge_window_cost.mts
 */
import "dotenv/config";
import { DbDatasetDataReader } from "../../server/datasetRegistry/query";
import { mapWithConcurrency } from "../../server/datasetRegistry/concurrency";

const VERSION_ID = 390002;
const EVENT_PAGE_LIMIT = 5000;
const EVENT_ID_BATCH_SIZE = 1000;
const CONC = Number(process.env.DB_POOL_SIZE ?? 16);

const reader = new DbDatasetDataReader();

const t0 = Date.now();
const eventIds: string[] = [];
let cursor: { tradeDate: string; eventId: string } | null = null;
for (;;) {
  const page: { items: Array<{ tradeDate: string; eventId: string }>; nextCursor: string | null } =
    await reader.listEventsPage({
      datasetVersionId: VERSION_ID,
      ...(cursor !== null ? { cursor } : {}),
      limit: EVENT_PAGE_LIMIT,
    });
  for (const e of page.items) eventIds.push(e.eventId);
  if (page.nextCursor === null || page.items.length === 0) break;
  const last = page.items[page.items.length - 1]!;
  cursor = { tradeDate: last.tradeDate, eventId: last.eventId };
}
console.log(`[0] 事件读取 ${eventIds.length} 个 / ${Date.now() - t0}ms`);

const batches: string[][] = [];
for (let i = 0; i < eventIds.length; i += EVENT_ID_BATCH_SIZE) {
  batches.push(eventIds.slice(i, i + EVENT_ID_BATCH_SIZE));
}
console.log(`    批次 = ${batches.length} × ${EVENT_ID_BATCH_SIZE}，并发 = ${CONC}`);

type Row = {
  eventId: string;
  symbol: string;
  tradeDate: string | Date;
  relativeDay: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  amount: number | null;
};
const COLS = ["eventId", "symbol", "tradeDate", "relativeDay", "open", "high", "low", "close", "volume", "amount"];

async function readBars(
  role: "prefix" | "post",
  relativeDays: number[],
): Promise<{ rows: Row[]; ms: number }> {
  const started = Date.now();
  const results = await mapWithConcurrency(
    batches,
    (batch) =>
      reader.loadRawBarsBatch(role, {
        datasetVersionId: VERSION_ID,
        eventIds: batch,
        relativeDays,
        columns: COLS,
      }),
    CONC,
  );
  const rows: Row[] = [];
  for (const part of results) for (const r of part) rows.push(r as unknown as Row);
  return { rows, ms: Date.now() - started };
}

/** 去重为逐日面板：(symbol, tradeDate) 唯一；同时校验重复值是否一致。 */
function panelize(rows: readonly Row[]): { panel: number; dupGroups: number; valueDiff: number } {
  const m = new Map<string, { close: number | null; open: number | null }>();
  let dupGroups = 0;
  let valueDiff = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.symbol}\u0000${String(r.tradeDate).slice(0, 10)}`;
    const prev = m.get(key);
    if (prev === undefined) {
      m.set(key, { close: r.close, open: r.open });
      continue;
    }
    if (!seen.has(key)) seen.add(key);
    if (prev.close !== r.close || prev.open !== r.open) valueDiff += 1;
  }
  dupGroups = seen.size;
  return { panel: m.size, dupGroups, valueDiff };
}

function summarize(tag: string, res: { rows: Row[]; ms: number }) {
  const p = panelize(res.rows);
  const distinctEv = new Set(res.rows.map((r) => r.eventId)).size;
  console.log(
    `\n[${tag}] ${res.ms}ms  raw=${res.rows.length} 行  事件=${distinctEv}` +
      `  →  去重面板=${p.panel}  (重复组=${p.dupGroups}, 值冲突=${p.valueDiff})`,
  );
  return { ms: res.ms, raw: res.rows.length, panel: p.panel, dupGroups: p.dupGroups, valueDiff: p.valueDiff };
}

const out: Record<string, unknown> = { versionId: VERSION_ID, eventCount: eventIds.length, concurrency: CONC };

// A. 现状基线：prefix rd=0
out.prefixRd0 = summarize("A prefix rd=0（现状基线）", await readBars("prefix", [0]));
// B. post rd 1..6
const b6 = await readBars("post", [1, 2, 3, 4, 5, 6]);
out.post1to6 = summarize("B post rd=1..6", b6);
// C. post rd 1..20
const b20 = await readBars("post", Array.from({ length: 20 }, (_, i) => i + 1));
out.post1to20 = summarize("C post rd=1..20", b20);

// D. 合并面板规模（prefix rd=0 + post）
const a0 = await readBars("prefix", [0]);
const merged6 = panelize([...a0.rows, ...b6.rows]);
const merged20 = panelize([...a0.rows, ...b20.rows]);
console.log(`\n[D] 合并面板：rd 0..6 → ${merged6.panel} 行（冲突 ${merged6.valueDiff}）`);
console.log(`   合并面板：rd 0..20 → ${merged20.panel} 行（冲突 ${merged20.valueDiff}）`);
out.merged = { rd0to6: merged6, rd0to20: merged20 };
out.totalMs = Date.now() - t0;

console.log("\nsummary=" + JSON.stringify(out));
process.exit(0);
