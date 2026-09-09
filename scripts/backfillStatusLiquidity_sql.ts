/**
 * STEP 12 WORK C+E — Status + Liquidity 合并逐股回填 CLI 的 **SQL 文件输出变体**。
 *
 * 与原版 (backfillStatusLiquidity.ts) 唯一差别：所有 DB 写改为流式写本地 .sql 文件，
 * 用户拿到 .sql 后自行 mysql < file.sql 导入到本地 MySQL（schema 自备）。
 *
 * 设计：
 *   - liquidity_daily 按 `INSERT ... ON DUPLICATE KEY UPDATE` 累积多行 VALUES 批写
 *     （匹配 uq_liquidity_daily_security_date 自然键，幂等）
 *   - research_security_status_history 按 `INSERT ... VALUES (...)` 累积多行批写
 *     （表无唯一约束，导入端按 `(securityId,statusType,effectiveFrom)` 自行去重或保留多版本）
 *   - 每只股票处理完后立即 flush 到磁盘（防止中断丢失）
 *   - resume / status 历史去重检查关闭（没 DB 不能 SELECT）
 *
 * 用法（典型三板分别落盘）：
 *   mkdir -p scripts/_dump
 *   MARKETDATA_PYTHON="<venv python>" npx tsx scripts/backfillStatusLiquidity_sql.ts \
 *     --universe-from-db --from=2019-01-01 --to=2026-09-04 \
 *     --board=main --interval=1000 \
 *     --sql-output=scripts/_dump/ce_main_20260907.sql
 *
 *   MARKETDATA_PYTHON="<venv python>" npx tsx scripts/backfillStatusLiquidity_sql.ts \
 *     --universe-from-db --from=2019-01-01 --to=2026-09-04 \
 *     --board=cyb --interval=1000 \
 *     --sql-output=scripts/_dump/ce_cyb_20260907.sql
 *
 *   MARKETDATA_PYTHON="<venv python>" npx tsx scripts/backfillStatusLiquidity_sql.ts \
 *     --universe-from-db --from=2019-01-01 --to=2026-09-04 \
 *     --board=kc --interval=1000 \
 *     --sql-output=scripts/_dump/ce_kc_20260907.sql
 *
 * 导入（在本地 MySQL，schema 已迁移到位）：
 *   mysql -u root -p stock_limit_up < scripts/_dump/ce_main_20260907.sql
 *
 * 参数（在原版基础上新增）：
 *   --sql-output=<path>  必填：写出的 .sql 文件路径
 *   --no-resume          本版默认 true（无 DB 无法 SELECT 已回填集）
 *   --dry-run            本版无效（仍输出 SQL；用于预估规模）
 */

import "dotenv/config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../server/db";
import { researchSecurityIdentifierHistory } from "../drizzle/schema";
import { generateDeterministicSecurityId, securityIdAnchorForTsCode } from "../server/security/deterministicId";
import { inferBaostockStatusIntervals, type BaostockDailyStatusPoint } from "../server/securityStatus/baostockStatus";
import { validateStatusInterval } from "../server/securityStatus/validation";
import { validateLiquidity } from "../server/marketData/liquidity";
import { parseBaostockStockDaily, type BaostockStockRow } from "../server/marketData/providers/baostock";
import { runPythonScript } from "../server/marketData/providers/pythonBridge";
import { liquidityBarToInsert } from "../server/marketData/liquidityStorage";

const CHECKPOINT_FILE = fileURLToPath(new URL("./_backfill_status_liquidity_checkpoint.json", import.meta.url));

interface CliArgs {
  /** 本版默认 true：纯 SQL 输出，无 DB 可 SELECT resume 集 */
  noResume: boolean;
  /** 板块筛选（undefined = 不过滤；否则为白名单：main/cyb/kc/bj）。
   *  例：--board=main / --board=cyb / --board=main,cyb */
  boards?: Set<BoardKey>;
  /** 必填：写出的 .sql 文件路径（路径不存在会自动创建目录）。 */
  sqlOutput: string;
}

type BoardKey = "main" | "cyb" | "kc" | "bj";

const BOARD_LABELS: Record<BoardKey, string> = {
  main: "主板（SH 60xxxx + SZ 000/001/002）",
  cyb: "创业板（SZ 300/301）",
  kc: "科创板（SH 688）",
  bj: "北交所（BJ 83/43/82/87）",
};

/** SQL 写入器：把待写的 liquidity rows / status intervals 累积成 multi-row VALUES，按股 flush。
 *  生成符合 mysql < file.sql 直接导入的语法，幂等性：
 *   - liquidity_daily 用 ON DUPLICATE KEY UPDATE（自然键 uq_liquidity_daily_security_date）
 *   - research_security_status_history 无唯一约束用纯 INSERT（由导入端按业务键自行去重） */
class SqlWriter {
  private liquidityBuffer: string[] = [];
  private statusBuffer: string[] = [];
  private fd: number | null = null;
  private bytesWritten = 0;

  constructor(public readonly outPath: string) {}

  /** 打开文件并写头部注释（含元数据+板块分布，空 SQL 用户也能识别）。 */
  open(meta: { range: string; boards: string[]; host: string; pid: number; codes: number }): void {
    mkdirSync(dirname(this.outPath), { recursive: true });
    this.fd = null; // nodejs 一次写入即可，不需要 fd 句柄
    const header = [
      "-- ============================================================",
      `-- Status + Liquidity 批量产出 (C+E)`,
      `-- generated_at    : ${new Date().toISOString()}`,
      `-- generator_pid   : ${meta.pid}`,
      `-- source_host     : ${meta.host}`,
      `-- trade_date_range: ${meta.range}`,
      `-- target_boards   : ${meta.boards.join(", ") || "(all except BJ)"}`,
      `-- target_codes    : ${meta.codes} stocks`,
      `-- import_hint     : mysql -u <user> -p <dbname> < ${this.outPath}`,
      "-- ============================================================",
      "-- liquidity_daily 表上有 uq_liquidity_daily_security_date (securityCode, tradeDate) 唯一索引，",
      "-- ON DUPLICATE KEY UPDATE 实现幂等；research_security_status_history 无唯一约束，纯 INSERT，",
      "-- 同一 (securityId,statusType,effectiveFrom,effectiveTo) 可能产生重复行，导入端按需去重。",
      "-- ============================================================",
      "",
    ].join("\n");
    writeFileSync(this.outPath, header, { flag: "w", encoding: "utf8" });
    this.bytesWritten = Buffer.byteLength(header, "utf8");
  }

  /** 累积一支股的 liquidity 插入语句，多行 VALUES 直到调用 flushLiquidity()。 */
  appendLiquidityBatch(rows: ReturnType<typeof liquidityBarToInsert>[]): number {
    if (rows.length === 0) return 0;
    const cols = [
      "securityId",
      "securityCode",
      "tradeDate",
      "turnoverRate",
      "circulationMarketCap",
      "totalMarketCap",
      "amount",
      "volume",
      "source",
      "retrievedAt",
    ];
    const head = "INSERT INTO `liquidity_daily` (`" + cols.join("`,`") + "`) VALUES\n  ";
    const tuples = rows
      .map((r) => "(" + sqlTuple([
        r.securityId ?? null,
        r.securityCode,
        r.tradeDate,
        r.turnoverRate ?? null,
        r.circulationMarketCap ?? null,
        r.totalMarketCap ?? null,
        r.amount ?? null,
        r.volume ?? null,
        r.source,
        // retrievedAt 用 NOW() 服务端时间，与 DB 默认值对齐；用户拿到的 SQL 也有「真实回填时刻」标记
      ], /* retrievedAtIndex */ 9) + ")")
      .join(",\n  ");
    const tail =
      "\nON DUPLICATE KEY UPDATE\n" +
      cols
        .filter((c) => c !== "securityCode" && c !== "tradeDate") // 自然键不能写回
        .map((c) => "  `" + c + "` = VALUES(`" + c + "`)")
        .join(",\n") +
      ";\n";
    this.liquidityBuffer.push(head + tuples + tail);
    return rows.length;
  }

  /** 累积一支股的 status 插入语句（每只股的区间不多，一般 <50 条）。 */
  appendStatusBatch(
    intervals: Array<{
      securityId: string;
      statusType: string;
      statusValue: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      source: string;
      retrievedAt: string | null;
      confidence: string;
      availability: string;
    }>,
  ): number {
    if (intervals.length === 0) return 0;
    const cols = [
      "securityId",
      "statusType",
      "statusValue",
      "effectiveFrom",
      "effectiveTo",
      "source",
      "retrievedAt",
      "confidence",
      "availability",
    ];
    const head = "INSERT INTO `research_security_status_history` (`" + cols.join("`,`") + "`) VALUES\n  ";
    const tuples = intervals
      .map((it) => "(" + sqlTuple([
        it.securityId,
        it.statusType,
        it.statusValue,
        it.effectiveFrom,
        it.effectiveTo,
        it.source,
        it.retrievedAt,
        it.confidence,
        it.availability,
      ]) + ")")
      .join(",\n  ");
    const tail = ";\n";
    this.statusBuffer.push(head + tuples + tail);
    return intervals.length;
  }

  /** 每只股处理完调用一次，把累积的所有 INSERT 立即落盘（保证中断时不丢）。 */
  flush(): { liqBytes: number; statusBytes: number } {
    let liqBytes = 0;
    let statusBytes = 0;
    if (this.liquidityBuffer.length > 0) {
      const buf = this.liquidityBuffer.join("\n") + "\n";
      writeFileSync(this.outPath, buf, { flag: "a", encoding: "utf8" });
      liqBytes = Buffer.byteLength(buf, "utf8");
      this.bytesWritten += liqBytes;
      this.liquidityBuffer = [];
    }
    if (this.statusBuffer.length > 0) {
      const buf = this.statusBuffer.join("\n") + "\n";
      writeFileSync(this.outPath, buf, { flag: "a", encoding: "utf8" });
      statusBytes = Buffer.byteLength(buf, "utf8");
      this.bytesWritten += statusBytes;
      this.statusBuffer = [];
    }
    return { liqBytes, statusBytes };
  }

  /** 关闭时无需 flush（每只股已 flush），仅打尾部统计。 */
  close(stats: { codes: number; liqRows: number; statusRows: number }): void {
    const tail = [
      "-- ============================================================",
      `-- end_of_dump`,
      `-- codes_processed  : ${stats.codes}`,
      `-- liquidity_rows   : ${stats.liqRows}`,
      `-- status_rows      : ${stats.statusRows}`,
      `-- bytes_written    : ${this.bytesWritten}`,
      `-- finished_at      : ${new Date().toISOString()}`,
      "-- ============================================================",
    ].join("\n");
    writeFileSync(this.outPath, tail + "\n", { flag: "a", encoding: "utf8" });
  }
}

/** 把 JS 值序列化成 SQL 字面量：null→NULL、字符串→'...'（转义）、数字→字面。 */
function sqlTuple(values: unknown[], retrievedAtIndex = -1): string {
  return values
    .map((v, i) => {
      // retrievedAt 字段统一使用 SQL 的 NOW()，保证每次导入的时刻都「当下」（与 DB 默认值语义一致）
      if (i === retrievedAtIndex) return "NOW()";
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") {
        if (!Number.isFinite(v)) return "NULL";
        return String(v);
      }
      if (typeof v === "boolean") return v ? "1" : "0";
      // string
      return "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
    })
    .join(",");
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  const intervalMs = Number(readFlag(args, "interval") ?? 1000);
  const sqlOutput = readFlag(args, "sql-output");
  if (!sqlOutput) {
    throw new Error("--sql-output=<path> 必填，指定输出的 .sql 文件路径");
  }
  return {
    // 本版无 DB，noResume 必须为 true（即便跳过 DB 也没有意义）
    noResume: true,
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
    sqlOutput: resolvePath(sqlOutput),
  };
}

/** SQL 版默认值常量（与原版 CLI 行为解耦，避免对老参数误用） */
const SQL_FROM_DEFAULT = "2019-01-01";
const SQL_INTERVAL_DEFAULT_MS = 1000;
const SQL_LIMIT_DEFAULT = 0; // 0 = 全部（SQL 模式默认全量）

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

// （SQL 版无 DB 写，已移除 withDbWriteRetry / isTransientDbError / TRANSIENT_DB_ERROR_CODES / MAX_DB_WRITE_RETRIES；
//   仅保留 loadUniverseFromDb 的一次性 DB 读取，连接失败由上层抛错即可，无需细粒度重试。）


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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // SQL 版的 from/to 由常量固定，不暴露给 CLI（保持用户接口简洁）

  const stats: Stats = {
    requested: 0,
    received: 0,
    failed: 0,
    statusPersisted: 0,
    statusRejected: 0,
    liquidityPersisted: 0,
    liquidityRejected: 0,
    rowsReceived: 0,
  };

  // SQL 版：从 DB 读 universe（5552 股），无 --board 限制；
  //         用户策略：主板→创业板→科创板→北交所（用户可 --board 显式白名单）
  const targets = await loadUniverseFromDb();

  // 板块过滤 + 优先级排序：用户策略——主板优先、创业板次之、科创板再次、北交所跳过。
  let filtered = targets;
  // --board 显式白名单：精确筛选某板块，跳过 skipBj 默认行为（让 --board=bj 可显式跑 BJ）
  if (args.boards) {
    filtered = filtered.filter((t) => {
      const k = boardKeyOf(t.securityCode);
      return k !== null && args.boards!.has(k);
    });
  }
  // SQL 版 universe 默认隐含 --skip-bj 行为（除非 --include-bj）
  else {
    filtered = filtered.filter((t) => !t.securityCode.endsWith(".BJ"));
  }
  filtered = filtered.slice().sort((a, b) => boardPriority(a.securityCode) - boardPriority(b.securityCode));
  let universe = filtered;
  stats.requested = universe.length;

  console.log(`[SQL 输出模式] Status+Liquidity 合并回填`);
  console.log(`  universe=${targets.length} 过滤后=${filtered.length} range=${SQL_FROM_DEFAULT}~${new Date().toISOString().slice(0, 10)} interval=${SQL_INTERVAL_DEFAULT_MS}ms`);
  console.log(`  sql-output=${args.sqlOutput}`);
  if (args.boards) {
    const labels = Array.from(args.boards).map((k) => BOARD_LABELS[k]).join("、");
    console.log(`  --board 白名单：${labels}`);
  } else {
    const bjCount = targets.length - filtered.length;
    console.log(`  默认跳过 BJ（${bjCount} 只），如需显式同步请加 --board=bj`);
  }
  {
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

  const sqlWriter = new SqlWriter(args.sqlOutput);
  sqlWriter.open({
    range: `${SQL_FROM_DEFAULT} ~ ${new Date().toISOString().slice(0, 10)}`,
    boards: args.boards ? Array.from(args.boards).map((k) => BOARD_LABELS[k]) : ["默认主板+创业板+科创板（BJ 跳过）"],
    host: process.env.COMPUTERNAME ?? "unknown",
    pid: process.pid,
    codes: filtered.length,
  });

  const retrievedAt = new Date().toISOString();
  let consecutiveFailures = 0;

  for (let i = 0; i < universe.length; i += 1) {
    const target = universe[i]!;

    let rows: BaostockStockRow[];
    try {
      rows = await fetchStockDailyWithRetry(target.baostockCode, SQL_FROM_DEFAULT, new Date().toISOString().slice(0, 10));
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
        await new Promise((resolve) => setTimeout(resolve, SQL_INTERVAL_DEFAULT_MS));
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

    // === SQL 版写出：本股无 DB 去重（无 DB 可 SELECT），所有区间 / 行直接 append ===
    if (validIntervals.length > 0) {
      const statusRows = validIntervals.map((iv) => ({
        securityId: iv.securityId,
        statusType: iv.statusType,
        statusValue: iv.statusValue,
        effectiveFrom: iv.effectiveFrom,
        effectiveTo: iv.effectiveTo ?? null,
        source: iv.source,
        retrievedAt: iv.retrievedAt ?? retrievedAt, // null 时回退到本轮抓取时间
        confidence: iv.confidence,
        availability: iv.availability,
      }));
      const appended = sqlWriter.appendStatusBatch(statusRows);
      stats.statusPersisted += appended;
    }
    if (validBars.length > 0) {
      const liqRows = validBars.map((bar) => liquidityBarToInsert(bar, target.securityCode, target.securityId));
      const appended = sqlWriter.appendLiquidityBatch(liqRows);
      stats.liquidityPersisted += appended;
    }
    // 每只股处理完立即 flush：中断时已写部分不丢
    sqlWriter.flush();

    if ((i + 1) % 10 === 0 || i === universe.length - 1) {
      console.log(
        `  [progress ${i + 1}/${universe.length}] ${target.securityCode} rows=${rows.length} ` +
          `intervals=${validIntervals.length} liquidity=${validBars.length} ` +
          `out_bytes≈${(require("fs") as typeof import("fs")).statSync(args.sqlOutput).size}`,
      );
    }

    if (i < universe.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SQL_INTERVAL_DEFAULT_MS));
    }
  }

  sqlWriter.close({ codes: stats.received, liqRows: stats.liquidityPersisted, statusRows: stats.statusPersisted });

  console.log(`\nSQL 回填结束：`);
  console.log(`  sql-output=${args.sqlOutput}`);
  console.log(`  codes_processed=${stats.received} of ${stats.requested}`);
  console.log(`  Failed(stocks)=${stats.failed}`);
  console.log(`  rows: liquidity=${stats.liquidityPersisted} status_intervals=${stats.statusPersisted}`);
  console.log(`  Rejected: status_intervals=${stats.statusRejected} liquidity_rows=${stats.liquidityRejected}`);
  console.log(`  导入命令示例：mysql -u <user> -p <dbname> < ${args.sqlOutput}`);
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
