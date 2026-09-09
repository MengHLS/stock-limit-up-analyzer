/**
 * STEP 12 WORK D — BaoStock 全市场回填 CLI（corporate_actions + adjustment_factors）。
 *
 * 与 Tushare 回填（backfillCorporateActions.ts）互补：BaoStock 免费无配额，可全市场。
 * 策略（以实测为准）：
 *   - 复权因子全市场：优先 query_daily_adjust_factor(date)（按交易日拉全市场，1 次/日），
 *     用 daily_adjust_factor_range 单进程遍历区间内全部交易日（逐日间隔 >= 0.3s）。
 *   - 分红全市场：只对有除权除息事件的股票（由复权因子推导，或直接查 DB distinct code），
 *     逐股 query_dividend_data（按报告期分页），批量命令 dividend_data_batch（逐股间隔 >= 0.3s）。
 *   - 小样本 / 指定股票：--stocks=600519.SH,... 走逐股 adjust_factor / dividend_data。
 *
 * 用法：
 *   # 全市场复权因子（2019-01-01 ~ 今日）
 *   BAOSTOCK_PYTHON="C:/.../python.exe" npx tsx scripts/backfillCorporateActionsBaostock.ts --phase=factors
 *   # 全市场分红（因子已落库后）
 *   BAOSTOCK_PYTHON="C:/.../python.exe" npx tsx scripts/backfillCorporateActionsBaostock.ts --phase=dividend
 *   # 只跑主板（universe/事件推导/写入均过滤；DB 已有因子时自动跳过 factors 逐日扫描）
 *   BAOSTOCK_PYTHON="C:/.../python.exe" npx tsx scripts/backfillCorporateActionsBaostock.ts --board=main
 *   # 小样本验证
 *   BAOSTOCK_PYTHON="C:/.../python.exe" npx tsx scripts/backfillCorporateActionsBaostock.ts --stocks=600519.SH,000001.SZ
 *   # 预览
 *   ... --dry-run --stocks=600519.SH
 */

import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { adjustmentFactors } from "../drizzle/schema";
import {
  accumulateAdjustmentFactors,
  chunk,
  distinctEventCodes,
} from "../server/corporateActions/fullMarket";
import {
  parseBaoStockAdjustFactors,
  parseBaoStockDividendActions,
  toSecurityCode,
} from "../server/corporateActions/provider";
import {
  upsertAdjustmentFactors,
  upsertCorporateActions,
} from "../server/corporateActions/storage";

const PYTHON = process.env.BAOSTOCK_PYTHON ?? process.env.MARKETDATA_PYTHON ?? "python";
const BRIDGE = "scripts/providers/baostock_corporate_actions.py";
const PROBE = "scripts/providers/baostock_probe.py";
const MIN_THROTTLE_MS = 300;
const BATCH_COOLDOWN_MS = 30_000; // dividend 整批异常后的冷却（限速/会话抖动保护）
const FAILED_DIVIDEND_FILE = "scripts/_failed_stocks_d.json";

interface CliArgs {
  stocks: string[] | null; // null = 全市场
  dryRun: boolean;
  limit: number | null;
  phase: "factors" | "dividend" | "both";
  start: string;
  end: string;
  checkpoint: string;
  throttleMs: number;
  board: string | null; // main|cyb|kc|bj 板块白名单；null = 全市场
}

interface Stats {
  requested: number;
  received: number;
  persisted: number;
  rejected: number;
  failed: number;
  checkpoint: number;
}

interface Checkpoint {
  factors?: { done: boolean; lastDate?: string };
  dividend?: { completedCodes: string[] };
}

function parseArgs(args: string[]): CliArgs {
  const get = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
  const stocksRaw = get("stocks");
  const phaseRaw = get("phase");
  const throttleRaw = get("throttle");
  const today = new Date().toISOString().slice(0, 10);
  return {
    stocks: stocksRaw ? stocksRaw.split(",").map((s) => s.trim()).filter(Boolean) : null,
    dryRun: args.includes("--dry-run"),
    limit: get("limit") ? Number(get("limit")) : null,
    phase: phaseRaw === "factors" || phaseRaw === "dividend" ? phaseRaw : "both",
    start: get("start") ?? "2019-01-01",
    end: get("end") ?? today,
    checkpoint: get("checkpoint") ?? "scripts/.baostock_full_checkpoint.json",
    throttleMs: Math.max(throttleRaw ? Number(throttleRaw) : MIN_THROTTLE_MS, MIN_THROTTLE_MS),
    board: get("board") ?? null,
  };
}

const BOARD_LABELS: Record<string, string> = { main: "主板", cyb: "创业板", kc: "科创板", bj: "北交所" };

/** 与 backfillStatusLiquidity.ts 同语义：板块归位 main/cyb/kc/bj。 */
function boardKeyOf(securityCode: string): string | null {
  const m = /^(\d{6})\.(SH|SZ|BJ)$/.exec(securityCode);
  if (!m) return null;
  const code = securityCode.slice(0, 6);
  if (m[2] === "SH") return code.startsWith("688") || code.startsWith("689") ? "kc" : "main";
  if (m[2] === "SZ") {
    return code.startsWith("300") || code.startsWith("301") || code.startsWith("302") ? "cyb" : "main";
  }
  return "bj";
}

function isBoardMatch(securityCode: string, board: string): boolean {
  return boardKeyOf(securityCode) === board;
}

/** canonical "600519.SH" → BaoStock "sh.600519"。 */
function toBaostockCode(tsCode: string): string {
  const m = tsCode.trim().toUpperCase().match(/^(\d{6})\.(SH|SZ|BJ)$/);
  if (!m) throw new Error(`无法解析 ts_code：${tsCode}`);
  return `${m[2]!.toLowerCase()}.${m[1]}`;
}

/** "sh.600519" → canonical "600519.SH"（与 toBaostockCode 互逆）。 */
function canonicalOfBaoStockCode(bsCode: string): string {
  const m = bsCode.trim().toLowerCase().match(/^([a-z]{2})\.(\d{6})$/);
  if (!m) return bsCode;
  return `${m[2]}.${m[1].toUpperCase()}`;
}

/** dividend 单只失败落盘（按 code 去重合并）；失败股未计入 checkpoint，下轮自然重试。 */
function recordDividendFailures(entries: { code: string; error: string }[]): void {
  if (entries.length === 0) return;
  try {
    const prev = existsSync(FAILED_DIVIDEND_FILE)
      ? (JSON.parse(readFileSync(FAILED_DIVIDEND_FILE, "utf8")) as {
          codes: { code: string; error: string }[];
          lastUpdated?: string;
        })
      : { codes: [] as { code: string; error: string }[] };
    const byCode = new Map(prev.codes.map((e) => [e.code, e]));
    for (const e of entries) byCode.set(e.code, e);
    writeFileSync(
      FAILED_DIVIDEND_FILE,
      JSON.stringify({ codes: Array.from(byCode.values()), lastUpdated: new Date().toISOString() }, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("  失败落盘失败：", (err as Error).message);
  }
}

function runPython(script: string, args: string[]): Record<string, unknown> {
  let out: string;
  try {
    out = execFileSync(PYTHON, [script, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    // Python 退出码非 0 时，真实错误 JSON 仍在 stdout；优先提取，给出可读错误。
    const stdout = (error as { stdout?: string })?.stdout ?? "";
    const errJson = stdout.split(/\r?\n/).find((l) => l.trim().startsWith("{"));
    if (errJson) {
      const parsed = JSON.parse(errJson) as { error?: string };
      if (parsed.error) throw new Error(parsed.error);
    }
    throw new Error(`bridge 退出非 0：${(error as Error).message}`);
  }
  const jsonLine = out.split(/\r?\n/).find((l) => l.trim().startsWith("{") || l.trim().startsWith("["));
  if (!jsonLine) throw new Error(`bridge 未返回 JSON：${out.slice(0, 500)}`);
  const parsed = JSON.parse(jsonLine) as unknown;
  if (Array.isArray(parsed)) return { rows: parsed };
  return parsed as Record<string, unknown>;
}

interface BridgeResult {
  rows: (string | number)[][];
  scanned?: number;
  failedCodes?: { code: string; error: string }[];
}

function runBridge(args: string[]): BridgeResult {
  const res = runPython(BRIDGE, args);
  if (res.error) throw new Error(`bridge 错误：${res.error}`);
  return {
    rows: (res.rows as (string | number)[][]) ?? [],
    scanned:
      typeof res.scanned_dates === "number" ? res.scanned_dates : typeof res.scanned_stocks === "number" ? res.scanned_stocks : undefined,
    failedCodes: Array.isArray(res.failed_codes) ? (res.failed_codes as { code: string; error: string }[]) : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCheckpoint(path: string): Checkpoint {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Checkpoint;
  } catch {
    return {};
  }
}

function saveCheckpoint(path: string, cp: Checkpoint): void {
  writeFileSync(path, JSON.stringify(cp, null, 2), "utf8");
}

/** stock_basic（type=1 股票，含退市）→ canonical 代码升序。 */
function fetchStockUniverse(): string[] {
  const res = runPython(PROBE, ["stock_basic"]);
  const rows = (Array.isArray(res) ? res : (res.rows as unknown[])) as { code: string; type: string }[];
  const codes = rows
    .filter((r) => String(r.type) === "1")
    .map((r) => toSecurityCode(r.code))
    .sort();
  return codes;
}

/** 查 DB 中已落库复权因子的 distinct securityCode（resume 场景复用）；board 可选过滤。 */
async function fetchPersistedEventCodes(board?: string | null): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ securityCode: adjustmentFactors.securityCode })
    .from(adjustmentFactors);
  const codes = rows.map((r) => r.securityCode);
  return (board ? codes.filter((c) => isBoardMatch(c, board)) : codes).sort();
}

/** 进程内缓存一次 DB distinct 查询（单次运行 board 固定，避免 factors/dividend 重复查）。 */
let persistedCodesCache: string[] | null = null;
async function getPersistedEventCodes(board?: string | null): Promise<string[]> {
  if (persistedCodesCache) return persistedCodesCache;
  persistedCodesCache = await fetchPersistedEventCodes(board);
  return persistedCodesCache;
}

function printStats(label: string, s: Stats): void {
  console.log(
    `  [${label}] requested=${s.requested} received=${s.received} persisted=${s.persisted} rejected=${s.rejected} failed=${s.failed} checkpoint=${s.checkpoint}`
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cp = loadCheckpoint(args.checkpoint);
  const factorsInMemory: Awaited<ReturnType<typeof accumulateAdjustmentFactors>>["factors"] = [];

  console.log(`BaoStock 全市场回填 [phase=${args.phase} dry-run=${args.dryRun} limit=${args.limit ?? "-"}]`);
  console.log(`  区间 ${args.start} ~ ${args.end}，throttle=${args.throttleMs}ms，python=${PYTHON}`);

  // ---------------- Phase 1: 复权因子 ----------------
  if (args.phase === "factors" || args.phase === "both") {
    const stat: Stats = { requested: 0, received: 0, persisted: 0, rejected: 0, failed: 0, checkpoint: 0 };
    if (cp.factors?.done && !args.dryRun) {
      console.log("  复权因子已 checkpoint 完成，跳过（resume）。");
      stat.checkpoint = 1;
    } else if (args.stocks) {
      // 小样本 / 指定股票：逐股 adjust_factor
      for (const tsCode of args.stocks.slice(0, args.limit ?? args.stocks.length)) {
        stat.requested += 1;
        try {
          const raw = runBridge(["adjust_factor", toBaostockCode(tsCode), args.start, args.end]);
          stat.received += raw.rows.length;
          const { factors, skipped } = parseBaoStockAdjustFactors(raw.rows);
          stat.rejected += skipped;
          factorsInMemory.push(...factors);
          if (!args.dryRun) stat.persisted += await upsertAdjustmentFactors(factors);
          else stat.persisted += factors.length;
          stat.checkpoint += 1;
          await sleep(args.throttleMs);
        } catch (error) {
          stat.failed += 1;
          console.error(`  adjust_factor ${tsCode} 失败：`, (error as Error).message);
        }
      }
    } else {
      // 板块白名单 + DB 已有因子落库 → 跳过昂贵的全市场逐日扫描（factors 已入库，幂等无需重扫）
      const persisted = await getPersistedEventCodes(args.board ?? null);
      if (args.board && persisted.length > 0 && !args.dryRun) {
        console.log(`  [factors] DB 已有 ${persisted.length} 只复权因子（${BOARD_LABELS[args.board] ?? args.board}），跳过全市场逐日扫描。`);
        stat.checkpoint = persisted.length;
      } else {
        // 全市场：daily_adjust_factor_range 单进程遍历交易日（板块模式在落库前过滤）
        stat.requested = 1; // 单次 range 调用；received 以原始行为准
        try {
          const raw = runBridge(["daily_adjust_factor_range", args.start, args.end]);
          const scanned = raw.scanned ?? 0;
          stat.received = raw.rows.length;
          const acc = accumulateAdjustmentFactors(raw.rows);
          let factors = acc.factors;
          if (args.board) {
            const before = factors.length;
            factors = factors.filter((f) => isBoardMatch(f.securityCode, args.board!));
            console.log(`  [factors] board=${args.board} 过滤：${before} → ${factors.length} 条因子`);
          }
          stat.rejected = acc.skipped + acc.duplicates;
          factorsInMemory.push(...factors);
          if (!args.dryRun) stat.persisted = await upsertAdjustmentFactors(factors);
          else stat.persisted = factors.length;
          stat.checkpoint = scanned;
          if (!args.board) cp.factors = { done: true, lastDate: args.end };
          console.log(`  [factors] 扫描交易日 ${scanned}，去重后因子 ${acc.factors.length}，重复 ${acc.duplicates}，跳过 ${acc.skipped}`);
        } catch (error) {
          stat.failed = 1;
          console.error("  daily_adjust_factor_range 失败：", (error as Error).message);
        }
      }
    }
    if (!args.dryRun) saveCheckpoint(args.checkpoint, cp);
    printStats("adjustment_factors", stat);
  }

  // ---------------- Phase 2: 公司行为（分红/送转） ----------------
  if (args.phase === "dividend" || args.phase === "both") {
    const stat: Stats = { requested: 0, received: 0, persisted: 0, rejected: 0, failed: 0, checkpoint: 0 };
    const completed = new Set(cp.dividend?.completedCodes ?? []);

    // 决定目标股票清单
    let codes: string[];
    if (args.stocks) {
      codes = args.stocks;
    } else {
      const eventCodes =
        factorsInMemory.length > 0 ? distinctEventCodes(factorsInMemory) : await getPersistedEventCodes(args.board ?? null);
      const universeAll = fetchStockUniverse();
      const universe = args.board ? universeAll.filter((c) => isBoardMatch(c, args.board!)) : universeAll;
      console.log(
        `  [universe] stock_basic type=1 股票 ${universeAll.length} 只（含退市）` +
          (args.board ? ` → ${BOARD_LABELS[args.board] ?? args.board} ${universe.length} 只` : "")
      );
      const universeSet = new Set(universe);
      codes = eventCodes.filter((c) => universeSet.has(c));
      if (codes.length === 0) {
        // 无因子事件 → 退回全 universe（但限制数量，避免无谓请求）
        codes = universe;
        if (codes.length === 0) console.warn("  [dividend] board 过滤后 universe 为空，跳过 dividend 阶段。");
      }
    }
    codes = codes.filter((c) => !completed.has(c)).slice(0, args.limit ?? undefined);
    // 失败文件中的股票优先重试：移到待处理清单最前
    if (codes.length > 0 && !args.dryRun) {
      try {
        const failedFile = existsSync(FAILED_DIVIDEND_FILE)
          ? (JSON.parse(readFileSync(FAILED_DIVIDEND_FILE, "utf8")) as { codes: { code: string }[] })
          : null;
        if (failedFile?.codes?.length) {
          const failCodes = new Set(failedFile.codes.map((e) => e.code));
          const inList = codes.filter((c) => failCodes.has(c));
          const rest = codes.filter((c) => !failCodes.has(c));
          if (inList.length > 0) {
            codes = [...inList, ...rest];
            console.log(`  [dividend] 失败文件 ${inList.length} 只排前优先重试`);
          }
        }
      } catch {
        // 失败文件损坏不影响主流程
      }
    }
    console.log(`  [dividend] 待处理股票 ${codes.length} 只（已 checkpoint 跳过 ${completed.size} 只）`);

    const startYear = Number(args.start.slice(0, 4));
    const endYear = Number(args.end.slice(0, 4));

    if (args.stocks) {
      // 逐股模式（小样本）
      for (const tsCode of codes) {
        stat.requested += 1;
        try {
          const raw = runBridge(["dividend_data", toBaostockCode(tsCode), String(startYear), String(endYear)]);
          stat.received += raw.rows.length;
          const { actions, skipped } = parseBaoStockDividendActions(raw.rows);
          stat.rejected += skipped;
          if (!args.dryRun) stat.persisted += await upsertCorporateActions(actions);
          else stat.persisted += actions.length;
          completed.add(tsCode);
          stat.checkpoint += 1;
          await sleep(args.throttleMs);
        } catch (error) {
          stat.failed += 1;
          console.error(`  dividend_data ${tsCode} 失败：`, (error as Error).message);
        }
      }
    } else {
      // 批量模式：分块，每块一个子进程（内部逐股 0.3s 节流、单只失败不拖垮整批）
      // CHUNK=100：400 只 × 8 年 ≈ 3200 次请求会超出单会话稳健时长被断开，缩小块避免整批超时
      const CHUNK = 100;
      for (const batch of chunk(codes, CHUNK)) {
        const tmpDir = mkdtempSync(join(tmpdir(), "bs-div-"));
        const planFile = join(tmpDir, "plan.json");
        let batchFailed = 0;
        try {
          writeFileSync(planFile, JSON.stringify(batch.map((c) => [toBaostockCode(c)])), "utf8");
          stat.requested += batch.length;
          const raw = runBridge(["dividend_data_batch", planFile, String(startYear), String(endYear)]);
          stat.received += raw.rows.length;
          const { actions, skipped } = parseBaoStockDividendActions(raw.rows);
          stat.rejected += skipped;
          if (!args.dryRun) stat.persisted += await upsertCorporateActions(actions);
          else stat.persisted += actions.length;
          // 逐只隔离：只把成功股票计入 completed；失败落盘待重跑时自然重试
          const failedEntries = (raw.failedCodes ?? []).map((f) => ({
            code: canonicalOfBaoStockCode(String(f.code)),
            error: f.error,
          }));
          const failSet = new Set(failedEntries.map((e) => e.code));
          const okCodes = batch.filter((c) => !failSet.has(c));
          batchFailed = failSet.size;
          if (batchFailed > 0) {
            stat.failed += batchFailed;
            if (!args.dryRun) recordDividendFailures(failedEntries);
            console.warn(`  [dividend] 本批失败 ${batchFailed}/${batch.length} 只（已落盘，下轮自动重试）`);
          }
          for (const c of okCodes) completed.add(c);
          stat.checkpoint += okCodes.length;
        } catch (error) {
          stat.failed += batch.length;
          batchFailed = batch.length;
          console.error(`  dividend_data_batch 异常（${batch.length} 只）：`, (error as Error).message);
          // 整批异常多为限速/会话抖动：落盘失败（下轮优先重试）+ 冷却后继续
          const errMsg = String((error as Error).message ?? error).slice(0, 300);
          if (!args.dryRun) recordDividendFailures(batch.map((c) => ({ code: c, error: errMsg })));
          console.log(`  冷却 ${BATCH_COOLDOWN_MS / 1000}s 后继续…`);
          await sleep(BATCH_COOLDOWN_MS);
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
        cp.dividend = { completedCodes: Array.from(completed) };
        if (!args.dryRun) saveCheckpoint(args.checkpoint, cp);
        console.log(`  [dividend] 已完成 ${completed.size}/${codes.length + completed.size}（本批失败 ${batchFailed}）`);
      }
    }
    if (!args.dryRun) {
      cp.dividend = { completedCodes: Array.from(completed) };
      saveCheckpoint(args.checkpoint, cp);
      // 清理失败文件中已被 checkpoint 覆盖的条目（成功重试后避免下轮重复抓取）
      try {
        if (existsSync(FAILED_DIVIDEND_FILE)) {
          const prev = JSON.parse(readFileSync(FAILED_DIVIDEND_FILE, "utf8")) as {
            codes: { code: string; error: string }[];
          };
          const remaining = prev.codes.filter((e) => !completed.has(e.code));
          if (remaining.length !== prev.codes.length) {
            writeFileSync(
              FAILED_DIVIDEND_FILE,
              JSON.stringify({ codes: remaining, lastUpdated: new Date().toISOString() }, null, 2),
              "utf8"
            );
          }
        }
      } catch {
        // 清理失败不影响主流程
      }
    }
    printStats("corporate_actions", stat);
  }

  console.log(args.dryRun ? "dry-run 结束，未写库。" : "回填完成。");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });
