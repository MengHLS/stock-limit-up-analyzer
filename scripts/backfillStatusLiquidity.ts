/**
 * STEP 12 WORK C+E — Status + Liquidity 合并逐股回填 CLI。
 *
 * 用 BaoStock 逐股日线（一次请求同时返回 tradestatus / isST / turn / amount / volume），
 * 同时回填：
 *   - research_security_status_history（停牌 SUSPENSION/SUSPENDED + ST/ST 区间，WORK C）
 *   - liquidity_daily（turn/amount/volume，WORK E）
 *
 * 权威性：tradestatus/isST 是 BaoStock 权威字段；区间合并是 gap inference（confidence=medium）。
 * 单位：复用 normalizeLiquidity("baostock-daily") 的 scale（股→手 ×0.01、元→千元 ×0.001、turn 原样%）。
 * 市值：BaoStock 无市值 → circulation/total market cap 显式 UNAVAILABLE（null）。
 *
 * 取数走「单 Python 驻留会话」（baostock_probe.py session 模式：login 一次，stdin JSONL 逐股请求），
 * 避免旧版「每股 spawn 新进程 + login/logout」的固定开销（5552 股约省 3-4 小时纯登录时间）。
 *
 * 用法：
 *   MARKETDATA_PYTHON="<venv python>" npx tsx scripts/backfillStatusLiquidity.ts --limit=10 --dry-run
 *   MARKETDATA_PYTHON="<venv python>" npx tsx scripts/backfillStatusLiquidity.ts --codes=sh.600000,sz.000017
 *   MARKETDATA_PYTHON="<venv python>" npx tsx scripts/backfillStatusLiquidity.ts --limit=10
 *
 * 参数：
 *   --dry-run       只抓取与统计，不写库
 *   --limit=N       最多回填 N 只股票（0 = 全部；在 universe 排序后取前 N）
 *   --codes=...     显式指定 BaoStock 代码列表（覆盖 universe，逗号分隔）
 *   --from=YYYY-MM-DD  回填起始日（默认 1990-01-01；STEP 12 研究窗口 2019+，
 *                      建议显式传 2019-01-01 收敛范围，省约一半分页查询与写入量）
 *   --to=YYYY-MM-DD    回填结束日（默认今天）
 *   --interval=ms   请求间隔 ms（默认 300；≥300 硬约束）
 *   --no-resume     不跳过已回填的 securityCode
 *   --include-bj    纳入北交所股（默认跳过——研究链路暂不同步 BJ）
 *   --no-priority   不按板块优先级排序（默认主板→创业板→科创板→北交所）
 *   --board=<list>  精确筛选板块：main/cyb/kc/bj 逗号分隔（覆盖 skipBj 默认行为）
 */

import "dotenv/config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDb } from "../server/db";
import { researchSecurityIdentifierHistory, researchSecurityStatusHistory } from "../drizzle/schema";
import { generateDeterministicSecurityId, securityIdAnchorForTsCode } from "../server/security/deterministicId";
import { inferBaostockStatusIntervals, type BaostockDailyStatusPoint } from "../server/securityStatus/baostockStatus";
import { upsertSecurityStatusIntervals } from "../server/securityStatus/persistence";
import { validateStatusInterval } from "../server/securityStatus/validation";
import { validateLiquidity } from "../server/marketData/liquidity";
import { parseBaostockStockDaily, type BaostockStockRow } from "../server/marketData/providers/baostock";
import { runPythonScript } from "../server/marketData/providers/pythonBridge";
import {
  getBackfilledSecurityCodes,
  liquidityBarToInsert,
  upsertLiquidityDaily,
} from "../server/marketData/liquidityStorage";

const CHECKPOINT_FILE = fileURLToPath(new URL("./_backfill_status_liquidity_checkpoint.json", import.meta.url));

interface CliArgs {
  dryRun: boolean;
  limit: number;
  codes?: string[];
  from: string;
  to: string;
  intervalMs: number;
  noResume: boolean;
  universeFromDb: boolean;
  /** 跳过北交所（默认 true：研究链路暂不同步 BJ 数据） */
  skipBj: boolean;
  /** 按交易所优先级排序（默认 true：主板→创业板→科创板→北交所） */
  prioritizeBoards: boolean;
  /** 板块筛选（undefined = 不过滤；否则为白名单：main/cyb/kc/bj）。
   *  例：--board=main / --board=cyb / --board=main,cyb */
  boards?: Set<BoardKey>;
}

type BoardKey = "main" | "cyb" | "kc" | "bj";

const BOARD_LABELS: Record<BoardKey, string> = {
  main: "主板（SH 60xxxx + SZ 000/001/002）",
  cyb: "创业板（SZ 300/301）",
  kc: "科创板（SH 688）",
  bj: "北交所（BJ 83/43/82/87）",
};

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  const codesRaw = readFlag(args, "codes");
  const intervalMs = Number(readFlag(args, "interval") ?? 300);
  return {
    dryRun: args.includes("--dry-run"),
    limit: Number(readFlag(args, "limit") ?? 0),
    codes: codesRaw ? codesRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    from: readFlag(args, "from") ?? "1990-01-01",
    to: readFlag(args, "to") ?? new Date().toISOString().slice(0, 10),
    intervalMs: Math.max(intervalMs, 300),
    noResume: args.includes("--no-resume"),
    universeFromDb: args.includes("--universe-from-db"),
    skipBj: !args.includes("--include-bj"), // 默认跳过北交所；显式 --include-bj 才纳入
    prioritizeBoards: !args.includes("--no-priority"), // 默认按优先级排序；显式 --no-priority 才保留原序
    boards: (() => {
      const raw = readFlag(args, "board");
      if (!raw) return undefined;
      const keys = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const valid: BoardKey[] = [];
      for (const k of keys) {
        if (k !== "main" && k !== "cyb" && k !== "kc" && k !== "bj") {
          throw new Error(`--board 非法值 '${k}'，仅支持 main/cyb/kc/bj`);
        }
        valid.push(k);
      }
      return valid.length > 0 ? new Set(valid) : undefined;
    })(),
  };
}

/** 交易所板块优先级：主板→创业板→科创板→北交所（数字越小越优先）。
 *  根据 securityCode 前缀判定：
 *   - SH 主板：60xxxx / 601xxx / 603xxx / 605xxx（含 689 不在此，689 归科创板）
 *   - SH 科创板：688xxx / 689xxx
 *   - SZ 主板：000xxx / 001xxx / 002xxx / 003xxx（2024 起新增 003 段）
 *   - SZ 创业板：300xxx / 301xxx / 302xxx
 *   - BJ 北交所：83xxxx / 43xxxx / 82xxxx / 87xxxx */
function boardPriority(securityCode: string): number {
  const m = /^\d{6}\.(SH|SZ|BJ)$/.exec(securityCode);
  if (!m) return 99; // 未知格式排最后
  const code = securityCode.slice(0, 6);
  if (m[1] === "SH") {
    if (code.startsWith("688") || code.startsWith("689")) return 2; // 科创板
    return 0; // SH 主板（含 60/601/603/605）
  }
  if (m[1] === "SZ") {
    if (
      code.startsWith("300") ||
      code.startsWith("301") ||
      code.startsWith("302")
    ) {
      return 1; // 创业板
    }
    return 0; // SZ 主板（000/001/002/003）
  }
  return 3; // BJ 北交所
}

/** 返回该 securityCode 所属板块 key（用于 --board 白名单匹配）。 */
function boardKeyOf(securityCode: string): BoardKey | null {
  const m = /^\d{6}\.(SH|SZ|BJ)$/.exec(securityCode);
  if (!m) return null;
  const code = securityCode.slice(0, 6);
  if (m[1] === "SH") {
    return code.startsWith("688") || code.startsWith("689") ? "kc" : "main";
  }
  if (m[1] === "SZ") {
    return code.startsWith("300") || code.startsWith("301") || code.startsWith("302")
      ? "cyb"
      : "main";
  }
  return "bj";
}

function usage(): string {
  return [
    "用法：MARKETDATA_PYTHON=<venv python> npx tsx scripts/backfillStatusLiquidity.ts [选项]",
    "  --dry-run              只抓取与统计，不写库",
    "  --limit=N              最多回填 N 只股票（0 = 全部）",
    "  --codes=sh.600000,...  显式指定 BaoStock 代码（覆盖 universe）",
    "  --from=YYYY-MM-DD      回填起始日（默认 1990-01-01；研究窗口 2019+ 建议显式 2019-01-01）",
    "  --to=YYYY-MM-DD        回填结束日（默认今天）",
    "  --interval=ms          请求间隔（默认 300，≥300 硬约束）",
    "  --no-resume            不跳过已回填的 securityCode",
    "  --universe-from-db     从 research_security_identifier_history 读 universe（绕过 stock_basic 分页限制）",
    "  --include-bj           纳入北交所股（默认跳过）",
    "  --no-priority          不按板块优先级排序（默认主板→创业板→科创板→北交所）",
    "  --board=<list>         精确筛选板块，逗号分隔（main/cyb/kc/bj）；例：--board=main 或 --board=main,cyb",
  ].join("\n");
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** "sh.600000" → { exchange: "SH", code: "600000", securityCode: "600000.SH" }。 */
function baostockToSecurityParts(baostockCode: string): { exchange: string; code: string; securityCode: string } | null {
  const m = /^(sh|sz|bj)\.(\d{6})$/.exec(baostockCode.toLowerCase());
  if (!m) return null;
  const exchange = m[1]!.toUpperCase();
  const code = m[2]!;
  return { exchange, code, securityCode: `${code}.${exchange}` };
}

interface StockTarget {
  baostockCode: string;
  securityCode: string;
  securityId: string;
}

/** 从 BaoStock stock_basic 拉取 type=1（股票）作为 universe。 */
async function loadUniverse(from: string, to: string): Promise<StockTarget[]> {
  const stdout = await runPythonScript("baostock_probe.py", ["stock_basic"], "MARKETDATA_PYTHON");
  const rows = JSON.parse(stdout) as Array<{ code: string; type: string }>;
  // BaoStock query_stock_basic 免费接口单次上限约 2000 行（全市场 ~8940 行），
  // 超过会静默截断；此处诚实上报，避免把「截断的 universe」冒充全量。
  if (rows.length >= 2000) {
    console.warn(
      `  [warning] stock_basic 返回 ${rows.length} 行（可能触及 2000 上限被截断，全市场约 8940 行）；` +
        `全量回填请改用 --codes 显式列表或分页枚举。`,
    );
  }
  const targets: StockTarget[] = [];
  for (const row of rows) {
    if (row.type !== "1") continue; // 仅 A 股（BaoStock type=1 = 股票）
    const parts = baostockToSecurityParts(row.code);
    if (!parts) continue;
    const securityId = generateDeterministicSecurityId(securityIdAnchorForTsCode(parts.exchange, parts.code));
    targets.push({ baostockCode: row.code.toLowerCase(), securityCode: parts.securityCode, securityId });
  }
  return targets;
}

function buildTargetsFromCodes(codes: string[]): StockTarget[] {
  const targets: StockTarget[] = [];
  for (const code of codes) {
    const parts = baostockToSecurityParts(code);
    if (!parts) continue;
    const securityId = generateDeterministicSecurityId(securityIdAnchorForTsCode(parts.exchange, parts.code));
    targets.push({ baostockCode: code.toLowerCase(), securityCode: parts.securityCode, securityId });
  }
  return targets;
}

/** 从已落库的 identifier_history 读全量 universe（复用 WORK B 的 5552 股，绕过 stock_basic 分页限制）。 */
async function loadUniverseFromDb(): Promise<StockTarget[]> {
  const db = await getDb();
  if (!db) throw new Error("DB 不可用");
  const rows = await db
    .selectDistinct({
      exchange: researchSecurityIdentifierHistory.exchange,
      securityCode: researchSecurityIdentifierHistory.securityCode,
    })
    .from(researchSecurityIdentifierHistory);
  const targets: StockTarget[] = [];
  for (const row of rows) {
    const exchange = row.exchange; // SH / SZ / BJ
    const code = row.securityCode; // 6 位数字
    const securityId = generateDeterministicSecurityId(securityIdAnchorForTsCode(exchange, code));
    targets.push({
      baostockCode: `${exchange.toLowerCase()}.${code}`,
      securityCode: `${code}.${exchange}`,
      securityId,
    });
  }
  return targets;
}

interface Stats {
  requested: number;
  received: number;
  failed: number;
  skippedResume: number;
  statusPersisted: number;
  statusRejected: number;
  liquidityPersisted: number;
  liquidityRejected: number;
  rowsReceived: number;
}

/** 登录/会话类瞬时失败的最大重试次数（"用户未登录"/"login failed" 常因并发会话竞争或服务端抖动）。
 *  BaoStock 高峰期「网络接收错误」频发，3 次太少；增到 6 次配指数退避更稳。 */
const MAX_FETCH_RETRIES = 6;

/** 连续失败股票阈值：累计到此数触发冷却（避免对服务端雪崩）。 */
const COOLDOWN_AFTER_CONSECUTIVE_FAILURES = 5;

/** 冷却时长：连续失败后等 BaoStock 服务喘息。 */
const COOLDOWN_DURATION_MS = 30_000;

/** 持久化失败股票清单：下轮启动时优先重试（不放回队尾）。 */
const FAILED_STOCKS_FILE = fileURLToPath(new URL("./_failed_stocks_ce.json", import.meta.url));

interface FailedStocksFile {
  /** 各失败股票及其最后一次失败时间，便于下轮优先重试与人工排查。 */
  codes: Array<{ code: string; lastFailedAt: string; lastError: string }>;
}

function loadFailedStocks(): FailedStocksFile {
  try {
    return JSON.parse(readFileSync(FAILED_STOCKS_FILE, "utf8")) as FailedStocksFile;
  } catch {
    return { codes: [] };
  }
}

function recordFailedStock(code: string, error: string): void {
  const data = loadFailedStocks();
  const now = new Date().toISOString();
  const existing = data.codes.find((c) => c.code === code);
  if (existing) {
    existing.lastFailedAt = now;
    existing.lastError = error;
  } else {
    data.codes.push({ code, lastFailedAt: now, lastError: error });
  }
  writeFileSync(FAILED_STOCKS_FILE, JSON.stringify(data, null, 2) + "\n");
}

/** DB 写操作瞬时网络错误（ECONNRESET/ETIMEDOUT 等）的最大重试次数。 */
const MAX_DB_WRITE_RETRIES = 3;

/** 瞬时网络错误码集合（TiDB Cloud 长连接偶发重置/抖动，重试可恢复）。 */
const TRANSIENT_DB_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "ETIMEOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "PROTOCOL_CONNECTION_LOST",
]);

function isTransientDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && TRANSIENT_DB_ERROR_CODES.has(code)) return true;
  // DrizzleQueryError 会把底层 mysql2 错误包进 cause 链（如 read ECONNRESET）。
  let cause: unknown = (error as { cause?: unknown }).cause;
  for (let depth = 0; cause && depth < 5; depth += 1) {
    const c = cause as { code?: string };
    if (c.code && TRANSIENT_DB_ERROR_CODES.has(c.code)) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  const msg = error.message.toLowerCase();
  return /econnreset|etimedout|epipe|econnrefused|socket hang up|connection reset|connection lost/.test(msg);
}

/** 包装 DB 写操作：瞬时网络错误指数退避重试，非瞬时错误直接抛（由上层逐股隔离）。 */
async function withDbWriteRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_DB_WRITE_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= MAX_DB_WRITE_RETRIES) {
        throw error;
      }
      const wait = 1000 * attempt * 2; // 2s → 4s
      const msg = error instanceof Error ? error.message.slice(0, 120) : String(error);
      console.warn(`  [db-retry ${attempt}/${MAX_DB_WRITE_RETRIES}] ${label}: ${msg}（${wait}ms 后重试）`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}

/** BaoStock Python bridge 脚本与解释器（驻留会话复用，login 仅一次）。 */
const PROBE_SCRIPT = fileURLToPath(new URL("./providers/baostock_probe.py", import.meta.url));
const PYTHON = process.env.MARKETDATA_PYTHON ?? "python";

/**
 * 单 Python 驻留会话（baostock_probe.py session 模式）。
 *
 * 相比旧「每股 execFile 新进程 + login/logout」：
 *   - login 只做一次（消除 5552 × ~2s 重复登录/进程启动固定开销）；
 *   - 请求/响应走 stdin/stdout JSONL，逐股同步等待；
 *   - 请求级超时看门狗：会话疑似卡死即 kill，下个请求自动重启（重新 login）；
 *   - 子进程异常退出 → 所有 in-flight reject，下个请求自动重启。
 * BaoStock 单账号单活跃会话约束依旧满足：同一时刻只有这一个子进程持有会话。
 */
class BaostockSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stderrTail = "";
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;

  constructor(
    private readonly pythonPath: string,
    private readonly probeScript: string,
    private readonly requestTimeoutMs = 120_000,
  ) {}

  /** 请求会话未存活则 spawn（login 在 Python 侧启动即执行）。 */
  private ensureAlive(): void {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) return;
    this.child = spawn(this.pythonPath, [this.probeScript, "session"], {
      env: process.env as Record<string, string>,
      windowsHide: true,
    });
    this.stdoutBuffer = "";
    this.stderrTail = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-2000);
    });
    this.child.on("error", (err) => {
      this.rejectAll(new Error(`baostock session spawn error: ${err.message}`));
      this.child = null;
    });
    this.child.on("exit", (code, signal) => {
      const err = new Error(
        `baostock session exited code=${code} signal=${signal ?? ""}${this.stderrTail ? ` stderr=${this.stderrTail.slice(-300)}` : ""}`,
      );
      this.rejectAll(err);
      this.child = null;
    });
  }

  private rejectAll(err: unknown): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let nl: number;
    while ((nl = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, nl).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; ok?: boolean; result?: unknown; error?: string };
      try {
        msg = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string };
      } catch {
        continue; // Python 侧 login/logout 打印已被 redirect，非 JSON 行理论上不出现
      }
      if (msg.id === undefined) continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? "baostock session request error"));
    }
  }

  /** 发送一个请求并同步等待对应 id 的响应；超时/崩溃时本请求抛错，会话由下个请求重生。 */
  request<T>(req: Record<string, unknown>): Promise<T> {
    this.ensureAlive();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill("request timeout");
        reject(new Error(`baostock session request timeout (${this.requestTimeoutMs}ms): ${JSON.stringify(req)}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      const payload = `${JSON.stringify({ id, ...req })}\n`;
      try {
        this.child!.stdin.write(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.kill("stdin write failed");
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private kill(reason: string): void {
    try {
      this.child?.kill();
    } catch {
      // 已退出则忽略
    }
    this.child = null;
    if (reason !== "closed") console.warn(`  [session] ${reason}，下个请求将自动重启`);
  }

  async close(): Promise<void> {
    this.kill("closed");
  }
}

/** 模块级单例会话：整个回填进程只 login 一次。 */
let activeSession: BaostockSession | null = null;
function getSession(): BaostockSession {
  if (!activeSession) {
    activeSession = new BaostockSession(PYTHON, PROBE_SCRIPT);
  }
  return activeSession;
}

/** 逐股拉日线（走驻留会话），带重试：会话临时故障（登录竞争/超时）退避后自动重启重试。
 *  指数退避（3s/6s/12s/24s/48s）：BaoStock 高峰期「网络接收错误」连续触发时，
 *  短间隔退避（600/1200ms）只会加剧服务端抖动，长退避 + 限速更稳。 */
async function fetchStockDailyWithRetry(
  baostockCode: string,
  from: string,
  to: string,
): Promise<BaostockStockRow[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt += 1) {
    try {
      const rows = await getSession().request<BaostockStockRow[]>({
        cmd: "stock_daily",
        code: baostockCode,
        start: from,
        end: to,
      });
      if (!Array.isArray(rows)) throw new Error(`unexpected session result shape for ${baostockCode}`);
      return rows;
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message.slice(0, 160) : String(error);
      if (attempt < MAX_FETCH_RETRIES) {
        // 指数退避 3s/6s/12s/24s/48s（attempt=1→3s；与旧 intervalMs 解耦以避免拖慢正常路径）
        const wait = 3000 * Math.pow(2, attempt - 1);
        console.warn(`  [retry ${attempt}/${MAX_FETCH_RETRIES}] ${baostockCode}: ${msg}（${wait}ms 后重试）`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  throw lastError;
}

/** 状态区间幂等键（securityId + 四元组）。主循环内由 infer 出的区间构造。 */
function statusIntervalKey(
  securityId: string,
  it: { statusType: string; statusValue: string; effectiveFrom: string; effectiveTo?: string | null },
): string {
  return `${securityId}|${it.statusType}|${it.statusValue}|${it.effectiveFrom}|${it.effectiveTo ?? ""}`;
}

/** 启动时一次性加载全表已落库区间键到内存（取代每股 1 次 getSecurityStatusIntervals SELECT，
 *  省掉每股 ~1 次公网 DB 往返——universe 5552 只 ≈ 节省 ~20 分钟纯等待）。 */
async function loadExistingStatusKeys(): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .select({
      securityId: researchSecurityStatusHistory.securityId,
      statusType: researchSecurityStatusHistory.statusType,
      statusValue: researchSecurityStatusHistory.statusValue,
      effectiveFrom: researchSecurityStatusHistory.effectiveFrom,
      effectiveTo: researchSecurityStatusHistory.effectiveTo,
    })
    .from(researchSecurityStatusHistory);
  return new Set(
    rows.map(
      (r) =>
        `${r.securityId}|${r.statusType}|${r.statusValue}|${r.effectiveFrom}|${r.effectiveTo ?? ""}`,
    ),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.from > args.to) {
    console.error("错误：--from 不能晚于 --to");
    console.error(usage());
    process.exit(1);
  }

  const stats: Stats = {
    requested: 0,
    received: 0,
    failed: 0,
    skippedResume: 0,
    statusPersisted: 0,
    statusRejected: 0,
    liquidityPersisted: 0,
    liquidityRejected: 0,
    rowsReceived: 0,
  };

  const targets = args.codes
    ? buildTargetsFromCodes(args.codes)
    : args.universeFromDb
      ? await withDbWriteRetry(() => loadUniverseFromDb(), "load universe (db)")
      : await withDbWriteRetry(() => loadUniverse(args.from, args.to), "load universe (baostock)");

  // 板块过滤 + 优先级排序：用户策略——主板优先、创业板次之、科创板再次、北交所跳过。
  let filtered = targets;
  // --board 显式白名单：精确筛选某板块，跳过 skipBj 默认行为（让 --board=bj 可显式跑 BJ）
  if (args.boards) {
    filtered = filtered.filter((t) => {
      const k = boardKeyOf(t.securityCode);
      return k !== null && args.boards!.has(k);
    });
  } else if (args.skipBj) {
    // 默认行为：跳过 BJ（除非 --include-bj）
    filtered = filtered.filter((t) => !t.securityCode.endsWith(".BJ"));
  }
  if (args.prioritizeBoards) {
    filtered = filtered.slice().sort((a, b) => boardPriority(a.securityCode) - boardPriority(b.securityCode));
  }
  let universe = args.limit > 0 ? filtered.slice(0, args.limit) : filtered;
  stats.requested = universe.length;

  const backfilled = args.noResume ? new Set<string>() : await getBackfilledSecurityCodes();
  // 内存化 status 区间键：启动一次全表拉取（取代每股 1 次 SELECT 往返），进程内维护幂等。
  const existingStatusKeys = args.dryRun ? new Set<string>() : await loadExistingStatusKeys();

  console.log(`[dry-run=${args.dryRun}] Status+Liquidity 合并回填`);
  console.log(`  universe=${targets.length} 过滤后=${filtered.length} target=${universe.length} range=${args.from}~${args.to} interval=${args.intervalMs}ms`);
  console.log(`  已回填 securityCode 数（resume 跳过）：${backfilled.size}`);
  if (!args.dryRun) console.log(`  已加载 status 区间键（内存去重）：${existingStatusKeys.size}`);
  if (args.boards) {
    const labels = Array.from(args.boards).map((k) => BOARD_LABELS[k]).join("、");
    console.log(`  --board 白名单：${labels}`);
  } else if (args.skipBj) {
    const bjCount = targets.length - filtered.length;
    console.log(`  --skip-bj 跳过北交所 ${bjCount} 只`);
  }
  if (args.prioritizeBoards) {
    const counts = { main: 0, cyb: 0, kc: 0, bj: 0 };
    for (const t of filtered) {
      const p = boardPriority(t.securityCode);
      if (p === 0) counts.main += 1;
      else if (p === 1) counts.cyb += 1;
      else if (p === 2) counts.kc += 1;
      else if (p === 3) counts.bj += 1;
    }
    console.log(`  板块分布：主板=${counts.main} 创业板=${counts.cyb} 科创板=${counts.kc} 北交所=${counts.bj}`);
  }

  // 失败股票优先重试：本轮把 _failed_stocks_ce.json 里的股票提到队首。
  // 无论 --no-resume 与否都启用——失败股本来就没成功落库，不能让它们永远卡住。
  // resume 跳过逻辑只过滤已 backfilled 的，与优先重试互不影响。
  const failedPrev = loadFailedStocks().codes;
  if (failedPrev.length > 0) {
    const codeToIdx = new Map(universe.map((t, idx) => [t.securityCode, idx]));
    const ordered: StockTarget[] = [];
    const seen = new Set<string>();
    // 失败股票优先（按 lastFailedAt 升序：最早失败的先重试）
    failedPrev
      .slice()
      .sort((a, b) => a.lastFailedAt.localeCompare(b.lastFailedAt))
      .forEach((entry) => {
        const idx = codeToIdx.get(entry.code);
        if (idx !== undefined) {
          ordered.push(universe[idx]!);
          seen.add(entry.code);
        }
      });
    // 其余股票按原 universe 顺序
    for (const t of universe) {
      if (!seen.has(t.securityCode)) ordered.push(t);
    }
    universe = ordered;
    console.log(`  失败股票优先重试：${failedPrev.length} 只提到队首`);
  }

  const retrievedAt = new Date().toISOString();
  let consecutiveFailures = 0;

  for (let i = 0; i < universe.length; i += 1) {
    const target = universe[i]!;
    if (backfilled.has(target.securityCode)) {
      stats.skippedResume += 1;
      continue;
    }

    let rows: BaostockStockRow[];
    try {
      rows = await fetchStockDailyWithRetry(target.baostockCode, args.from, args.to);
    } catch (error) {
      stats.failed += 1;
      const msg = error instanceof Error ? error.message.slice(0, 160) : String(error);
      console.warn(`  [failed] ${target.baostockCode}: ${msg}`);
      // 失败股票落盘：下轮启动时优先重试（不放回队尾）
      recordFailedStock(target.securityCode, msg);
      consecutiveFailures += 1;
      if (consecutiveFailures >= COOLDOWN_AFTER_CONSECUTIVE_FAILURES) {
        console.warn(
          `  [cooldown] 连续失败 ${consecutiveFailures} 只，等待 ${COOLDOWN_DURATION_MS / 1000}s 让 BaoStock 服务喘息`,
        );
        await new Promise((resolve) => setTimeout(resolve, COOLDOWN_DURATION_MS));
        consecutiveFailures = 0;
      } else {
        await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
      }
      continue;
    }
    consecutiveFailures = 0;

    stats.received += 1;
    stats.rowsReceived += rows.length;

    // WORK C — 状态区间（provider 权威字段 → gap inference 区间）
    const points: BaostockDailyStatusPoint[] = rows.map((row) => ({
      date: row.date,
      tradestatus: num(row.tradestatus),
      isST: num(row.isST),
    }));
    const intervals = inferBaostockStatusIntervals(target.securityId, points, retrievedAt);
    const validIntervals = intervals.filter((interval) => validateStatusInterval(interval).length === 0);
    stats.statusRejected += intervals.length - validIntervals.length;

    // WORK E — 流动性（复用 normalizeLiquidity 单位换算）
    const bars = parseBaostockStockDaily(rows, target.securityCode);
    const validBars = bars.filter((bar) => validateLiquidity(bar).status !== "INVALID");
    stats.liquidityRejected += bars.length - validBars.length;

    if (!args.dryRun) {
      try {
        // Status 区间表无唯一约束（允许同区间多版本）；本 CLI 按 (securityId,statusType,statusValue,
        // effectiveFrom,effectiveTo) 内存去重（启动时一次性加载全表键），保证重复回填幂等——
        // 不产生重复区间，仅保留最新 retrievedAt 由 timeline 解析层取舍。
        let toPersistIntervals = validIntervals;
        if (validIntervals.length > 0) {
          toPersistIntervals = validIntervals.filter(
            (it) => !existingStatusKeys.has(statusIntervalKey(target.securityId, it)),
          );
        }
        if (toPersistIntervals.length > 0) {
          stats.statusPersisted += await withDbWriteRetry(
            () => upsertSecurityStatusIntervals(toPersistIntervals),
            `${target.securityCode} status`,
          );
          for (const it of toPersistIntervals) {
            existingStatusKeys.add(statusIntervalKey(target.securityId, it));
          }
        }
        if (validBars.length > 0) {
          const inserts = validBars.map((bar) => liquidityBarToInsert(bar, target.securityCode, target.securityId));
          stats.liquidityPersisted += await withDbWriteRetry(
            () => upsertLiquidityDaily(inserts),
            `${target.securityCode} liquidity`,
          );
        }
      } catch (error) {
        // 逐股隔离：单只 DB 写入失败不崩溃整个回填，记 failed 由下次 resume 重跑。
        stats.failed += 1;
        const msg = error instanceof Error ? error.message.slice(0, 160) : String(error);
        console.warn(`  [write-failed] ${target.securityCode}: ${msg}`);
        await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
        continue;
      }
    } else {
      stats.statusPersisted += validIntervals.length;
      stats.liquidityPersisted += validBars.length;
    }

    if ((i + 1) % 10 === 0 || i === universe.length - 1) {
      console.log(
        `  [progress ${i + 1}/${universe.length}] ${target.securityCode} rows=${rows.length} ` +
          `intervals=${validIntervals.length} liquidity=${validBars.length}`,
      );
    }

    if (i < universe.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
    }
  }

  const checkpoint = { processed: stats.received + stats.failed, lastCode: universe.at(-1)?.securityCode ?? null, at: retrievedAt };
  if (!args.dryRun) {
    writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2) + "\n");
  }

  console.log(`\n回填结束：`);
  console.log(`  Requested(stocks)=${stats.requested}`);
  console.log(`  Received(stocks)=${stats.received} rows=${stats.rowsReceived}`);
  console.log(`  Skipped(resume)=${stats.skippedResume}`);
  console.log(`  Failed(stocks)=${stats.failed}`);
  console.log(`  Persisted: status_intervals=${stats.statusPersisted} liquidity_rows=${stats.liquidityPersisted}`);
  console.log(`  Rejected: status_intervals=${stats.statusRejected} liquidity_rows=${stats.liquidityRejected}`);
  console.log(`  Checkpoint=${JSON.stringify(checkpoint)}`);
  if (args.dryRun) console.log("dry-run 结束，未写库。");
}

async function run(): Promise<void> {
  try {
    await main();
  } finally {
    // 回填结束/异常均关闭 BaoStock 驻留会话（login 会话不悬挂）。
    await getSession().close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });
