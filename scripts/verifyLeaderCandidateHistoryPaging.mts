/**
 * 龙头候选池性能修复验收（真实 DB，只读；同时充当磁盘快照的预热）。
 *
 * 覆盖：
 *  1. 分页端点首次调用（冷）：行数/计数契约 + 单次响应体积。
 *  2. 同一进程内翻页：应命中回测结果缓存（毫秒级）。
 *  3. 剥离明细后的聚合响应体积 vs 原全量响应体积。
 *  4. 跨进程可复用的磁盘快照（模拟服务重启后无需重算）。
 */
import "dotenv/config";
import { getLeaderCandidateBacktest, getLeaderCandidateHistoryPage } from "../server/db";
import { stripLeaderCandidateHistory, MAX_LEADER_CANDIDATE_HISTORY_PAGE_SIZE } from "../server/leaderCandidateHistory";
import { readLeaderCandidateBacktestSnapshot } from "../server/leaderCandidateBacktestSnapshot";
import { stableHash } from "../server/backtestCache";

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

const OPTIONS = { observationDays: 1 as const };

// --- 1. 冷启动：分页端点第一次调用（会真正跑一次全区间回测） ---
let started = Date.now();
const page1 = await getLeaderCandidateHistoryPage({ ...OPTIONS, page: 1, pageSize: 50 });
console.log(`[${elapsed()}] 冷调用 pageSize=50 | 耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  当前页行数 ${page1.rows.length} / 上限 ${MAX_LEADER_CANDIDATE_HISTORY_PAGE_SIZE}`);
console.log(`  totalRows=${page1.totalRows} allRows=${page1.allRows} totalPages=${page1.totalPages} truncated=${page1.truncated}`);
console.log(`  单次响应体积 ${bytes(page1)} B (= ${(bytes(page1) / 1024).toFixed(1)} KB)`);

// --- 2. 同进程翻页：应命中缓存 ---
started = Date.now();
const page2 = await getLeaderCandidateHistoryPage({ ...OPTIONS, page: 2, pageSize: 50 });
console.log(`[${elapsed()}] 翻页 page=2 | 耗时 ${Date.now() - started}ms | 行数 ${page2.rows.length} page=${page2.page}`);

// 分页契约：切片不重叠
const key1 = new Set(page1.rows.map((row) => `${row.date}-${row.stockCode}`));
const overlap = page2.rows.filter((row) => key1.has(`${row.date}-${row.stockCode}`)).length;
console.log(`  与第 1 页重叠行数 ${overlap}（应为 0）`);

// 阶段过滤：计数应等于该阶段在全量中的占比
const phases = ["冰点试错", "修复上升", "上升发酵", "高位分歧", "高位亢奋", "高位退潮"] as const;
const filtered = await getLeaderCandidateHistoryPage({ ...OPTIONS, page: 1, pageSize: 20, phase: phases[0] });
console.log(`  阶段筛选「${phases[0]}」totalRows=${filtered.totalRows} allRows=${filtered.allRows} 首行阶段=${filtered.rows[0]?.phase ?? "-"}`);

// 越界页码夹取
const outOfRange = await getLeaderCandidateHistoryPage({ ...OPTIONS, page: 99999, pageSize: 50 });
console.log(`  越界页码 99999 → 实际 page=${outOfRange.page} / ${outOfRange.totalPages}，行数 ${outOfRange.rows.length}`);

// --- 3. 载荷裁剪对比 ---
started = Date.now();
const full = await getLeaderCandidateBacktest(OPTIONS);
const summary = stripLeaderCandidateHistory(full);
console.log(`[${elapsed()}] 回测结果缓存命中 | 耗时 ${Date.now() - started}ms`);
console.log(`  全量响应 ${(bytes(full) / 1024 / 1024).toFixed(2)} MB → 剥离明细后 ${(bytes(summary) / 1024 / 1024).toFixed(2)} MB`);
console.log(`  historicalRows 在剥离结果中存在？${"historicalRows" in summary} | historicalRowCount=${summary.historicalRowCount}`);
console.log(`  计数一致性：historicalRowCount(${summary.historicalRowCount}) == totalRows(${page1.totalRows}) == allRows(${page1.allRows})`);

// --- 4. 磁盘快照（模拟重启后免重算） ---
const snapshot = await readLeaderCandidateBacktestSnapshot<{ historicalRows: unknown[] }>(stableHash(OPTIONS));
console.log(`  磁盘快照命中：${snapshot !== null} | 快照内明细行数 ${snapshot?.payload.historicalRows.length ?? "-"}`);
console.log(`[总计 ${elapsed()}]`);
process.exit(0);
