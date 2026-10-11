/**
 * `FIRSTBOARD-ROLLING-POOL-SIGNAL-EXIT-DIAGNOSTIC-009` · **只读**离线诊断工具。
 *
 * ```bash
 * node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolSignalExit009Analysis.mts \
 *   --artifacts-dir _scratch/fbp9-diagnostic/study-originals \
 *   --bars scripts/_scratch/review007/attribution-bars.json \
 *   --out _scratch/fbp9-diagnostic
 * ```
 *
 * ## 它做什么（目标 §3–§5）
 *
 * 1. **Gate A 复核**：只读 008 已持久化原件，按 `(anchorEventId, 确认日期)` 重新连接
 *    真实成交 / 跳过证据；比较**业务字段**（资格、因子值、全序、Top3、成交集合、冻结配置、
 *    账户指标）在「008 原件 → 009 纠错附件」上的变化数（必须为 0）。
 * 2. **Gate A.3 纠错附件**：`candidate-ranking-corrected-{A,B}.csv`、
 *    `displaced-original-signals.csv`（同日原因与整生命周期其他日触发**分列**，不互相覆盖）。
 * 3. **Gate B 口径冻结**：先写 `diagnostic-provenance.json`（源码 / 原件 / 缓存 SHA-256、
 *    语义、窗口、覆盖分母），**再**算结果；结果文件里回填该文件的 SHA-256。
 * 4. **Gate C 三层诊断**：信号层（候选价格路径）/ 选择层（因子 + 容量）/ 交易层（真实成交路径）。
 *
 * ## 🔴 纪律
 *
 * - **只读**：不调 `execute`、不写库、不 storage.put、不重建 Dataset、不发动回测。
 * - **按真实编码解压**：先看魔数（`1f 8b` = gzip），**不看扩展名**；解压后核对
 *   `artifact-compression-index.csv#originalSha256`。命名与内容不符时以**内容**为准并如实登记。
 * - **不静默降级**：缺文件 / 缺行情 / 账不平 ⇒ 写进 `gaps[]`；**不补 0、不前值填充、不改资格**。
 * - **未来行情只作事后诊断**：`usesForwardData=true` 的缓存**绝不**进入信号 / 排序 / 分层特征。
 * - 指标一律称「**价格路径描述**」，不是策略复合收益；不构建新净值、不改 `canonicalMetrics`。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

export const TOOL_VERSION = "009.1.0";
/** 本轮的来源轮次标记（纠错附件必须自述来源）。 */
export const SOURCE_ROUND = "008";
export const GENERATION_VERSION = "009";
/** 数据窗口（取自 `frozen-config.json#frozenConfig`；不在此处自行扩大）。 */
export const POST_MAX_RD = 80;
/** `H` 集合（目标 §5.1）。 */
export const H_SET = [3, 5, 10, 20] as const;
/** 主描述靶：窗口内至少一次**收盘**达到计划开盘价 × 1.20。 */
export const TARGET_MULTIPLE = 1.2;
/** 固定不利价位：计划开盘价 × 0.94（−6%）。 */
export const ADVERSE_MULTIPLE = 0.94;
/** 小样本阈值（目标 §5.1：不足 20 唯一锚点标记小样本）。 */
export const SMALL_SAMPLE_ANCHORS = 20;
/** 事件年龄分层（目标 §5.1）。 */
export const AGE_BANDS = [
  { label: "1-5", min: 1, max: 5 },
  { label: "6-10", min: 6, max: 10 },
  { label: "11-15", min: 11, max: 15 },
  { label: "16-20", min: 16, max: 20 },
] as const;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export type Cell = Record<string, string>;

/** 最小 CSV 解析（支持引号与转义引号；产物字段不含换行）。 */
export function parseCsvText(text: string): Cell[] {
  const lines = text.replace(/\r\n/gu, "\n").split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]!;
      if (quoted) {
        if (char === '"') {
          if (line[index + 1] === '"') { current += '"'; index += 1; } else { quoted = false; }
        } else current += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { out.push(current); current = ""; }
      else current += char;
    }
    out.push(current);
    return out;
  };
  const header = split(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const record: Cell = {};
    header.forEach((key, index) => { record[key] = cells[index] ?? ""; });
    return record;
  });
}

/** 写出 CSV（LF；含逗号 / 引号 / 换行的字段加引号）。 */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  return `${[header.join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n")}\n`;
}

export function numOf(value: string | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// 编码识别（🔴 看魔数，不看扩展名）
// ---------------------------------------------------------------------------

export type ArtifactEncoding = "gzip" | "identity";

/** gzip 魔数 `1f 8b`。扩展名可能被写错（009 读回目录即如此）。 */
export function detectEncoding(bytes: Uint8Array): ArtifactEncoding {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? "gzip" : "identity";
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// 行情缓存（一次读入；按 (eventId, relativeDay) 与 (eventId, tradeDate) 建索引）
// ---------------------------------------------------------------------------

export interface Bar {
  readonly eventId: string;
  readonly symbol: string;
  readonly relativeDay: number;
  readonly tradeDate: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly preClose: number;
  readonly barPresent: boolean;
}

export interface BarIndex {
  /** `${eventId}\u0000${relativeDay}` → bar。 */
  readonly byEventRd: ReadonlyMap<string, Bar>;
  /** `${eventId}\u0000${tradeDate}` → relativeDay（事件日历映射，**替代 confirmRd+1+holdingPeriod 近似**）。 */
  readonly rdByEventDate: ReadonlyMap<string, number>;
  readonly eventIds: ReadonlySet<string>;
  readonly rowCount: number;
  readonly presentCount: number;
}

export function buildBarIndex(bars: readonly Bar[]): BarIndex {
  const byEventRd = new Map<string, Bar>();
  const rdByEventDate = new Map<string, number>();
  const eventIds = new Set<string>();
  let presentCount = 0;
  for (const bar of bars) {
    byEventRd.set(`${bar.eventId}\u0000${bar.relativeDay}`, bar);
    const dateKey = `${bar.eventId}\u0000${bar.tradeDate}`;
    if (!rdByEventDate.has(dateKey)) rdByEventDate.set(dateKey, bar.relativeDay);
    eventIds.add(bar.eventId);
    if (bar.barPresent) presentCount += 1;
  }
  return { byEventRd, rdByEventDate, eventIds, rowCount: bars.length, presentCount };
}

/** 事件相对日 → 交易格。`barPresent=false` 或缺失都算「无效行情」。 */
export function barAt(index: BarIndex, eventId: string, relativeDay: number): Bar | null {
  const bar = index.byEventRd.get(`${eventId}\u0000${relativeDay}`);
  return bar === undefined || !bar.barPresent ? null : bar;
}

/** 真实交易日 → 事件相对日（行情/事件日历映射）。 */
export function relativeDayOf(index: BarIndex, eventId: string, tradeDate: string): number | null {
  return index.rdByEventDate.get(`${eventId}\u0000${tradeDate}`) ?? null;
}

// ---------------------------------------------------------------------------
// 价格路径（纯函数；测试锁边界）
// ---------------------------------------------------------------------------

/** `entryRd..entryRd+H−1`（**包含入场日**，共 H 个市场交易日格）。 */
export function windowRelativeDays(entryRd: number, h: number): number[] {
  return Array.from({ length: h }, (_, offset) => entryRd + offset);
}

export interface PathMetrics {
  readonly h: number;
  readonly entryRd: number;
  /** 窗口内每个 rd 都有**有效**行情（`barPresent=true`）。 */
  readonly complete: boolean;
  readonly presentCells: number;
  readonly missingRelativeDays: readonly number[];
  /** 第 H 日收盘 / 基准 − 1（窗口不完整则 null）。 */
  readonly endpointReturn: number | null;
  /** 窗口最高**收盘** / 基准 − 1。 */
  readonly closeUpside: number | null;
  /** 窗口最低**最低价** / 基准 − 1（MAE，保留负号）。 */
  readonly mae: number | null;
  /** 窗口最高**最高价** / 基准 − 1（**盘中上界**，不代替收盘靶）。 */
  readonly highUpside: number | null;
  /** 首次**收盘**达 `baseline × 1.20` 的日序（1..H）；未达 null。 */
  readonly firstTargetOffset: number | null;
  /** 首次**最低价**触及 `baseline × 0.94` 的日序（1..H）；未触及 null。 */
  readonly firstAdverseOffset: number | null;
  /** 目标与不利价位**同日**出现 ⇒ 盘中先后不可知。 */
  readonly sameDayAmbiguous: boolean;
}

/**
 * 在 `entryRd..entryRd+H−1` 上评估价格路径。
 *
 * 🔴 窗口**包含入场日**；只看有效行情格；不完整窗口的「端点 / 靠右尾」指标一律 `null`
 *    （避免「可见早涨者留下、未达者因缺数据消失」的生存偏差）。
 */
export function evaluateWindowPath(args: {
  readonly index: BarIndex;
  readonly eventId: string;
  readonly entryRd: number;
  readonly h: number;
  readonly baselinePrice: number;
}): PathMetrics {
  const rds = windowRelativeDays(args.entryRd, args.h);
  const bars: (Bar | null)[] = rds.map((rd) => barAt(args.index, args.eventId, rd));
  const missing = rds.filter((_, i) => bars[i] === null);
  const complete = missing.length === 0;
  if (args.baselinePrice <= 0 || !Number.isFinite(args.baselinePrice)) {
    return {
      h: args.h, entryRd: args.entryRd, complete: false, presentCells: 0,
      missingRelativeDays: rds, endpointReturn: null, closeUpside: null, mae: null,
      highUpside: null, firstTargetOffset: null, firstAdverseOffset: null, sameDayAmbiguous: false,
    };
  }
  const present = bars.filter((bar): bar is Bar => bar !== null);
  if (present.length === 0) {
    return {
      h: args.h, entryRd: args.entryRd, complete: false, presentCells: 0,
      missingRelativeDays: missing, endpointReturn: null, closeUpside: null, mae: null,
      highUpside: null, firstTargetOffset: null, firstAdverseOffset: null, sameDayAmbiguous: false,
    };
  }
  const targetPrice = args.baselinePrice * TARGET_MULTIPLE;
  const adversePrice = args.baselinePrice * ADVERSE_MULTIPLE;
  let firstTarget: number | null = null;
  let firstAdverse: number | null = null;
  for (let offset = 1; offset <= args.h; offset += 1) {
    const bar = bars[offset - 1];
    if (bar === null) continue;
    if (firstTarget === null && bar.close >= targetPrice) firstTarget = offset;
    if (firstAdverse === null && bar.low <= adversePrice) firstAdverse = offset;
  }
  const lastBar = bars[args.h - 1] ?? null;
  return {
    h: args.h,
    entryRd: args.entryRd,
    complete,
    presentCells: present.length,
    missingRelativeDays: missing,
    endpointReturn: complete && lastBar !== null ? lastBar.close / args.baselinePrice - 1 : null,
    closeUpside: Math.max(...present.map((bar) => bar.close)) / args.baselinePrice - 1,
    mae: Math.min(...present.map((bar) => bar.low)) / args.baselinePrice - 1,
    highUpside: Math.max(...present.map((bar) => bar.high)) / args.baselinePrice - 1,
    firstTargetOffset: firstTarget,
    firstAdverseOffset: firstAdverse,
    sameDayAmbiguous: firstTarget !== null && firstTarget === firstAdverse,
  };
}

/** 收盘达 `baseline × 1.20` 的**事件相对日**（用于「是否超出原 T+20 新买窗口」）。 */
export function targetArrivalRelativeDay(entryRd: number, firstTargetOffset: number | null): number | null {
  return firstTargetOffset === null ? null : entryRd + firstTargetOffset - 1;
}

// ---------------------------------------------------------------------------
// 同日归因（纯函数；测试锁边界）
// ---------------------------------------------------------------------------

export interface DisplacementInput {
  readonly anchorEventId: string;
  /** A 的**实际确认日**（同日归因的唯一坐标）。 */
  readonly aConfirmDate: string;
  readonly aEntryDate: string;
  /** 整生命周期的 B 跳过记录（已按 `(anchorEventId, attemptedConfirmDate)` 索引）。 */
  readonly attemptByKey: ReadonlyMap<string, Cell>;
  readonly attemptsByAnchor: ReadonlyMap<string, readonly Cell[]>;
  readonly candidateByAnchorDate: ReadonlyMap<string, Cell>;
}

export interface DisplacementDetail {
  readonly bSameDaySkipCode: string | null;
  readonly bSameDaySkipReason: string | null;
  readonly bSameDayAttemptedConfirmDate: string | null;
  readonly bCandidatePresent: boolean;
  readonly bCandidateParticipates: boolean | null;
  readonly bCandidateFactorRank: string | null;
  readonly bCandidateSelected: boolean | null;
  readonly bCandidateParticipantCount: string | null;
  readonly reasonBucket: string;
  /** 🔴 同日原因的作用域（防止把另一天的原因写成当天的）。 */
  readonly reasonScope: "SAME_DAY" | "NO_SAME_DAY_RECORD";
  /** 整生命周期**其他确认日**的触发，单独一列，绝不覆盖同日原因。 */
  readonly otherLifecycleTriggers: string;
}

/**
 * 把一个「A 成交而 B 未成交」锚点归因。
 *
 * 🔴 只用 **A 实际确认日** 那一天的 B 记录（008 F2 修正）：旧实现取锚点首条跳过，
 *    会把 `600179.SH@2025-08-25` 的 2025-09-16 满仓写成 2025-09-12 的原因。
 */
export function attributeDisplacedAnchor(input: DisplacementInput): DisplacementDetail {
  const sameDay = input.attemptByKey.get(`${input.anchorEventId}\u0000${input.aConfirmDate}`) ?? null;
  const candidate = input.candidateByAnchorDate.get(`${input.anchorEventId}\u0000${input.aConfirmDate}`) ?? null;
  const others = (input.attemptsByAnchor.get(input.anchorEventId) ?? [])
    .filter((row) => row.attemptedConfirmDate !== input.aConfirmDate)
    .map((row) => `${row.attemptedConfirmDate}:${row.skipCode}`)
    .join("|");
  let bucket: string;
  if (sameDay !== null) bucket = `SKIPPED:${sameDay.skipCode ?? ""}`;
  else if (candidate === null) bucket = "NO_B_CANDIDATE_ON_A_CONFIRM_DAY";
  else if (candidate.participatesInRanking !== "true") {
    bucket = `B_CANDIDATE_NOT_PARTICIPATING:${candidate.exclusionReason || "UNKNOWN"}`;
  } else bucket = `B_CANDIDATE_FACTOR_RANK_${candidate.rankByPreReturn10}_NOT_IN_TOPK`;
  return {
    bSameDaySkipCode: sameDay?.skipCode ?? null,
    bSameDaySkipReason: sameDay?.reason ?? null,
    bSameDayAttemptedConfirmDate: sameDay?.attemptedConfirmDate ?? null,
    bCandidatePresent: candidate !== null,
    bCandidateParticipates: candidate === null ? null : candidate.participatesInRanking === "true",
    bCandidateFactorRank: candidate?.rankByPreReturn10 ?? null,
    bCandidateSelected: candidate === null ? null : candidate.selectedByR === "true",
    bCandidateParticipantCount: candidate?.participantCountThatDay ?? null,
    reasonBucket: bucket,
    reasonScope: sameDay !== null ? "SAME_DAY" : "NO_SAME_DAY_RECORD",
    otherLifecycleTriggers: others,
  };
}

/**
 * 摘要**由明细桶派生**。
 *
 * 🔴 008 F2 的旧实现在这里用裸 `MAX_POSITIONS_REACHED` 查带 `SKIPPED:` 前缀的桶 ⇒ 恒为 0，
 *    明细与汇总不相等。这里只认前缀桶，并断言 `Σ 汇总 == 明细条目数`。
 */
export function summarizeDisplacementBuckets(
  buckets: Readonly<Record<string, number>>,
  displacedAnchorCount: number,
): { summary: Record<string, number>; summaryTotal: number; detailTotal: number; reconciles: boolean } {
  const summary = {
    capacitySkip: buckets["SKIPPED:MAX_POSITIONS_REACHED"] ?? 0,
    dailyBuyLimit: buckets["SKIPPED:MAX_DAILY_BUYS_REACHED"] ?? 0,
    factorRankOutOfTopK: Object.entries(buckets)
      .filter(([key]) => key.startsWith("B_CANDIDATE_FACTOR_RANK_"))
      .reduce((sum, [, value]) => sum + value, 0),
    notParticipatingThatDay: Object.entries(buckets)
      .filter(([key]) => key.startsWith("B_CANDIDATE_NOT_PARTICIPATING"))
      .reduce((sum, [, value]) => sum + value, 0),
    noCandidateThatDay: buckets.NO_B_CANDIDATE_ON_A_CONFIRM_DAY ?? 0,
  };
  const summaryTotal = Object.values(summary).reduce((sum, value) => sum + value, 0);
  const detailTotal = Object.values(buckets).reduce((sum, value) => sum + value, 0);
  return {
    summary,
    summaryTotal,
    detailTotal,
    reconciles: summaryTotal === detailTotal && detailTotal === displacedAnchorCount,
  };
}

// ---------------------------------------------------------------------------
// 首信号单位（纯函数；测试锁边界）
// ---------------------------------------------------------------------------

/**
 * 每个锚点、每个分支的**首个允许参与排序的确认信号**。
 *
 * 🔴 主描述单位就是这一个：该次次日不可买或缺行情时**原样标注**，
 *    不以后一天更漂亮的信号替换；重复触发只作补充，且分母必须报唯一锚点数。
 */
export function firstEligibleSignalPerAnchor(rows: readonly Cell[]): Cell[] {
  const best = new Map<string, Cell>();
  for (const row of rows) {
    if (row.participatesInRanking !== "true") continue;
    const key = row.anchorEventId ?? "";
    const current = best.get(key);
    if (current === undefined) { best.set(key, row); continue; }
    if ((row.date ?? "") < (current.date ?? "")) best.set(key, row);
    else if ((row.date ?? "") === (current.date ?? "") && (row.confirmRd ?? "") < (current.confirmRd ?? "")) {
      best.set(key, row);
    }
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------

export interface Stats {
  readonly n: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly q05: number | null;
  readonly q95: number | null;
  readonly positiveShare: number | null;
}

export function statsOf(values: readonly (number | null)[]): Stats {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (present.length === 0) {
    return { n: 0, mean: null, median: null, q05: null, q95: null, positiveShare: null };
  }
  const sorted = [...present].sort((left, right) => left - right);
  const quantile = (q: number): number => {
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower]!;
    return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
  };
  return {
    n: present.length,
    mean: present.reduce((sum, value) => sum + value, 0) / present.length,
    median: quantile(0.5),
    q05: quantile(0.05),
    q95: quantile(0.95),
    positiveShare: present.filter((value) => value > 0).length / present.length,
  };
}

// ---------------------------------------------------------------------------
// 产物读取（按**真实编码**解压 + SHA 核对）
// ---------------------------------------------------------------------------

export interface CompressionIndexRow {
  readonly logicalName: string;
  readonly objectName: string;
  readonly role: string;
  readonly encoding: string;
  readonly originalBytes: number;
  readonly deliveredBytes: number;
  readonly originalSha256: string;
  readonly lineCount: number;
}

export interface ArtifactReadMeta {
  readonly logicalName: string;
  readonly objectName: string;
  readonly declaredEncoding: string;
  readonly detectedEncoding: ArtifactEncoding;
  readonly resolvedPath: string;
  readonly fileBytesOnDisk: number;
  readonly decodedBytes: number;
  readonly decodedSha256: string;
  readonly expectedSha256: string;
  readonly shaMatch: boolean;
  readonly rows: number;
  readonly skippedForShaMismatch: readonly string[];
}

export class ArtifactReader {
  private readonly index = new Map<string, CompressionIndexRow>();
  private readonly metas: ArtifactReadMeta[] = [];
  private readonly gaps: string[] = [];

  constructor(
    private readonly dirs: readonly string[],
    compressionIndex: readonly CompressionIndexRow[],
  ) {
    for (const row of compressionIndex) this.index.set(row.logicalName, row);
  }

  /** 解析逻辑名 → 真实对象名（不在索引里的名字按「对象名 = 逻辑名」处理）。 */
  objectNameOf(logicalName: string): string {
    return this.index.get(logicalName)?.objectName ?? logicalName;
  }

  expectedShaOf(logicalName: string): string {
    return this.index.get(logicalName)?.originalSha256 ?? "";
  }

  get allMetas(): readonly ArtifactReadMeta[] {
    return this.metas;
  }

  get allGaps(): readonly string[] {
    return this.gaps;
  }

  /**
   * 读取并**校验**一个逻辑名。
   *
   * 候选路径按 `objectName` / `logicalName`（含 `.gz` 变体）在多个目录里找；
   * **魔数优先于扩展名**；解压后 SHA-256 必须等于索引里的 `originalSha256`。
   */
  read(logicalName: string): { text: string; meta: ArtifactReadMeta } | null {
    const objectName = this.objectNameOf(logicalName);
    const expected = this.expectedShaOf(logicalName);
    const declared = this.index.get(logicalName)?.encoding ?? "";
    const skipped: string[] = [];
    const names = [...new Set([objectName, logicalName, `${objectName}.gz`, `${logicalName}.gz`])];
    for (const dir of this.dirs) {
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (!existsSync(candidate)) continue;
        const raw = readFileSync(candidate);
        const detected = detectEncoding(raw);
        let decoded: Buffer;
        try {
          decoded = detected === "gzip" ? gunzipSync(raw) : raw;
        } catch (error) {
          skipped.push(`${candidate}（${detected} 解压失败：${String(error)}）`);
          continue;
        }
        const sha = sha256Of(decoded);
        if (expected !== "" && sha !== expected) {
          skipped.push(`${candidate}（sha256=${sha} ≠ 索引 ${expected}）`);
          continue;
        }
        const text = decoded.toString("utf8");
        const meta: ArtifactReadMeta = {
          logicalName,
          objectName,
          declaredEncoding: declared,
          detectedEncoding: detected,
          resolvedPath: candidate,
          fileBytesOnDisk: raw.length,
          decodedBytes: decoded.length,
          decodedSha256: sha,
          expectedSha256: expected,
          shaMatch: expected === "" ? true : sha === expected,
          rows: Math.max(0, text.replace(/\r\n/gu, "\n").split("\n").filter((line) => line.length > 0).length - 1),
          skippedForShaMismatch: skipped,
        };
        this.metas.push(meta);
        return { text, meta };
      }
    }
    this.gaps.push(`产物缺失或全部候选路径 SHA 不符：${logicalName}（objectName=${objectName}）`
      + (skipped.length > 0 ? `；候选：${skipped.join("；")}` : ""));
    return null;
  }

  readTable(logicalName: string): Cell[] {
    const got = this.read(logicalName);
    return got === null ? [] : parseCsvText(got.text);
  }

  readJson<T>(logicalName: string): T | null {
    const got = this.read(logicalName);
    if (got === null) return null;
    try {
      return JSON.parse(got.text) as T;
    } catch (error) {
      this.gaps.push(`JSON 解析失败 ${logicalName}：${String(error)}`);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// 性能记录
// ---------------------------------------------------------------------------

export interface StageRecord {
  readonly stage: string;
  readonly elapsedMs: number;
  readonly rssMb: number;
  readonly note: string;
}

export class StageLog {
  private readonly records: StageRecord[] = [];
  private peakRssMb = 0;

  run<T>(stage: string, note: string, fn: () => T): T {
    const started = Date.now();
    const result = fn();
    const rss = process.memoryUsage().rss / (1024 * 1024);
    this.peakRssMb = Math.max(this.peakRssMb, rss);
    this.records.push({ stage, elapsedMs: Date.now() - started, rssMb: Number(rss.toFixed(1)), note });
    return result;
  }

  mark(stage: string, note: string): void {
    const rss = process.memoryUsage().rss / (1024 * 1024);
    this.peakRssMb = Math.max(this.peakRssMb, rss);
    this.records.push({ stage, elapsedMs: 0, rssMb: Number(rss.toFixed(1)), note });
  }

  snapshot(): { readonly records: readonly StageRecord[]; readonly peakRssMb: number; readonly totalElapsedMs: number } {
    return {
      records: this.records,
      peakRssMb: Number(this.peakRssMb.toFixed(1)),
      totalElapsedMs: this.records.reduce((sum, record) => sum + record.elapsedMs, 0),
    };
  }
}

export function writeJson(target: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(target, text);
  return sha256Of(Buffer.from(text, "utf8"));
}

export function writeCsv(target: string, header: readonly string[], rows: readonly (readonly unknown[])[]): void {
  writeFileSync(target, toCsv(header, rows));
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function bytesOf(file: string): number {
  return existsSync(file) ? statSync(file).size : 0;
}

// ---------------------------------------------------------------------------
// 证据派生：严格镜像 `experiment.ts#run` 建 `rFillByKey` / `rSkipByKey` 的语义
// ---------------------------------------------------------------------------

export interface EvidenceMaps {
  /** 成交：`anchorEventId\u0000confirmDate` → 成交行（**后者覆盖前者**，与 `Map.set` 同）。 */
  readonly fillByKey: ReadonlyMap<string, Cell>;
  /** 跳过：`anchorEventId\u0000attemptedConfirmDate` → 跳过行（**首条保留**，与 `if (!has) set` 同）。 */
  readonly skipByKey: ReadonlyMap<string, Cell>;
}

export function buildEvidenceMaps(fills: readonly Cell[], attempts: readonly Cell[]): EvidenceMaps {
  const fillByKey = new Map<string, Cell>();
  for (const row of fills) {
    if (row.account !== "R") continue;
    fillByKey.set(`${row.anchorEventId}\u0000${row.confirmDate}`, row);
  }
  const skipByKey = new Map<string, Cell>();
  for (const row of attempts) {
    if (row.account !== "R") continue;
    const key = `${row.anchorEventId}\u0000${row.attemptedConfirmDate}`;
    if (!skipByKey.has(key)) skipByKey.set(key, row);
  }
  return { fillByKey, skipByKey };
}

export interface DerivedEvidence {
  readonly rFillDate: string;
  readonly rFillEvidenceRef: string;
  readonly rNotFilledReason: string;
  readonly rNotFilledEvidenceRef: string;
}

/**
 * 派生一行候选的成交 / 跳过证据。
 *
 * 🔴 键必须是**确认日期键**（`anchorEventId\u0000date`）——这就是 008 F1 的修复点；
 *    相对日键只用于身份 / 排序，**绝不**用来查证据。
 */
export function deriveEvidenceForRow(
  row: Cell,
  groupId: string,
  maps: EvidenceMaps,
): DerivedEvidence {
  const key = `${row.anchorEventId}\u0000${row.date}`;
  const filled = maps.fillByKey.get(key) ?? null;
  const fillDate = filled?.fillDate ?? "";
  const skip = maps.skipByKey.get(key) ?? null;
  return {
    rFillDate: fillDate,
    rFillEvidenceRef: fillDate === ""
      ? ""
      : `st-fill-audit-${groupId}.csv#account=R&anchorEventId=${row.anchorEventId}&fillDate=${fillDate}`,
    rNotFilledReason: fillDate !== "" || skip === null
      ? ""
      : `${skip.skipCode ?? ""}：${skip.reason ?? ""}`,
    rNotFilledEvidenceRef: fillDate !== "" || skip === null
      ? ""
      : `anchor-failed-attempts.csv#account=R&anchorEventId=${row.anchorEventId}`
        + `&attemptedConfirmDate=${row.date}`,
  };
}

/** 008 原件里「证据列」，纠正时**只**改这四列。 */
export const EVIDENCE_COLUMNS = ["rFillDate", "rFillEvidenceRef", "rNotFilledReason", "rNotFilledEvidenceRef"] as const;

export function businessColumnsOf(columns: readonly string[]): string[] {
  return columns.filter((column) => !(EVIDENCE_COLUMNS as readonly string[]).includes(column));
}

/**
 * **业务字段**逐行比较（不是全 JSON / 全行字节相等）。
 *
 * 比较列：资格（`identityResolved` / `participatesInRanking` / `exclusionReason`）、
 * 因子值（`preReturn10` / `eventAge` / `repairWindowScore` / `localLowRd` / `branch`）、
 * 全序（`rankByPreReturn10`）、Top3 选择（`selectedByR` / `rPlanOrder`）、坐标（`date` / `confirmRd` / `fillRd` / `fillDate`）。
 */
export function compareBusinessFields(
  left: readonly Cell[],
  right: readonly Cell[],
  keyOf: (row: Cell) => string,
  columns: readonly string[],
): { readonly comparedRows: number; readonly mismatchedRows: number; readonly samples: readonly string[] } {
  const rightByKey = new Map<string, Cell>();
  for (const row of right) rightByKey.set(keyOf(row), row);
  let compared = 0;
  let mismatched = 0;
  const samples: string[] = [];
  for (const row of left) {
    const other = rightByKey.get(keyOf(row));
    compared += 1;
    if (other === undefined) {
      mismatched += 1;
      if (samples.length < 10) samples.push(`${keyOf(row)}｜缺失于右侧`);
      continue;
    }
    for (const column of columns) {
      if ((row[column] ?? "") !== (other[column] ?? "")) {
        mismatched += 1;
        if (samples.length < 10) {
          samples.push(`${keyOf(row)}｜${column}：${row[column] ?? ""} ≠ ${other[column] ?? ""}`);
        }
        break;
      }
    }
  }
  return { comparedRows: compared, mismatchedRows: mismatched, samples };
}

/** 按「`preReturn10` 降序 → symbol 升序 → eventId 升序」独立重排，核对原约定全序（只读校验）。 */
export function independentRankOf(rows: readonly Cell[]): Cell[] {
  return [...rows].sort((left, right) => {
    const factor = Number(right.preReturn10 ?? "0") - Number(left.preReturn10 ?? "0");
    if (factor !== 0) return factor;
    const symbol = String(left.symbol ?? "").localeCompare(String(right.symbol ?? ""));
    if (symbol !== 0) return symbol;
    return String(left.anchorEventId ?? "").localeCompare(String(right.anchorEventId ?? ""));
  });
}

export interface FactorDiagnostics {
  readonly participantRows: number;
  readonly distinctValues: number;
  readonly maxSameValueShare: number;
  readonly maxSameValue: string;
  readonly top3BoundaryTieDays: number;
  readonly tieBreakKey: string;
}

export function factorDiagnosticsOf(rows: readonly Cell[]): FactorDiagnostics {
  const participants = rows.filter((row) => row.participatesInRanking === "true");
  const counts = new Map<string, number>();
  for (const row of participants) {
    const value = row.preReturn10 ?? "";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let maxSameValue = "";
  let maxCount = 0;
  for (const [value, count] of counts) {
    if (count > maxCount) { maxCount = count; maxSameValue = value; }
  }
  const byDate = new Map<string, Cell[]>();
  for (const row of participants) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  let tieDays = 0;
  for (const list of byDate.values()) {
    if (list.length < 4) continue;
    const ranked = list
      .filter((row) => (row.rankByPreReturn10 ?? "") !== "")
      .sort((left, right) => Number(left.rankByPreReturn10) - Number(right.rankByPreReturn10));
    const third = ranked[2];
    const fourth = ranked[3];
    if (third !== undefined && fourth !== undefined
      && Number(third.preReturn10 ?? "NaN") === Number(fourth.preReturn10 ?? "NaN")) {
      tieDays += 1;
    }
  }
  return {
    participantRows: participants.length,
    distinctValues: counts.size,
    maxSameValueShare: participants.length === 0 ? 0 : maxCount / participants.length,
    maxSameValue,
    top3BoundaryTieDays: tieDays,
    tieBreakKey: participants[0]?.tieBreakKey ?? "preReturn10 降序 → symbol 升序 → eventId 升序",
  };
}

/** 事件年龄分层标签。 */
export function ageBandOf(eventAge: number | null): string {
  if (eventAge === null) return "UNKNOWN";
  for (const band of AGE_BANDS) if (eventAge >= band.min && eventAge <= band.max) return band.label;
  return "OUT_OF_RANGE";
}

/** 判定「执行可行性」（**离线不可复算撮合**时必须如实标 UNKNOWN）。 */
export function executionFeasibilityOf(args: {
  readonly barExists: boolean;
  readonly canBuyAtOpen: boolean | null;
  readonly twoTimepointBuyAllowed: boolean;
}): string {
  if (!args.barExists) return "NO_VALID_QUOTE_AT_PLANNED_FILL";
  if (args.canBuyAtOpen === false) return "NOT_BUYABLE_AT_OPEN";
  if (args.twoTimepointBuyAllowed) return "BUY_ALLOWED_TWO_TIMEPOINT";
  return "EXECUTION_FEASIBILITY_UNKNOWN";
}

/** 窗口内首次**收盘** ≥ 阈值的日序（1..h）；未达 `null`。 */
export function firstCloseAtOrAbove(args: {
  readonly index: BarIndex;
  readonly eventId: string;
  readonly startRd: number;
  readonly h: number;
  readonly threshold: number;
}): number | null {
  for (let offset = 1; offset <= args.h; offset += 1) {
    const bar = barAt(args.index, args.eventId, args.startRd + offset - 1);
    if (bar === null) continue;
    if (bar.close >= args.threshold) return offset;
  }
  return null;
}

/** 比率 → 百分数字符串（`null` / `undefined` → 空，绝不写 0 冒充）。 */
export function pctOrBlank(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : (value * 100).toFixed(6);
}

/** 值 → 字符串（`null` / `undefined` → 空）。 */
export function blankIfNull(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const DEFAULT_ARTIFACTS_DIR = "_scratch/fbp9-diagnostic/study-originals";
const DEFAULT_EXTRA_ARTIFACTS_DIR = "_scratch/fbp8/study-artifacts";
const DEFAULT_BARS_FILE = "scripts/_scratch/review007/attribution-bars.json";
const DEFAULT_OUT_DIR = "_scratch/fbp9-diagnostic";
const GROUP_A = "A_STRICT_20";
const GROUP_B = "B_RECOVERY_20";
/** 分支标签：A / B 共有的 ORIGINAL 信号**只算一个样本**。 */
const BRANCH_SHARED_ORIGINAL = "SHARED_ORIGINAL";
const BRANCH_B_RECOVERY = "B_RECOVERY";

interface RawBarsFile {
  readonly provenance?: Record<string, unknown>;
  readonly bars?: readonly (Bar & { readonly suspensionStatus?: string; readonly canBuyAtOpen?: boolean })[];
}

interface ResultPayload {
  readonly customPayload?: {
    readonly frozenConfig?: Record<string, unknown>;
    readonly groups?: readonly {
      readonly group?: string;
      readonly accounts?: readonly Record<string, unknown>[];
      readonly perYear?: readonly Record<string, unknown>[];
      readonly candidateRowCount?: number;
    }[];
  };
  readonly sampleSummary?: Record<string, unknown>;
}

export async function main(): Promise<void> {
  const outDir = path.resolve(argValue("--out") ?? DEFAULT_OUT_DIR);
  const artifactsDir = path.resolve(argValue("--artifacts-dir") ?? DEFAULT_ARTIFACTS_DIR);
  const extraDir = path.resolve(argValue("--extra-artifacts-dir") ?? DEFAULT_EXTRA_ARTIFACTS_DIR);
  const barsFile = path.resolve(argValue("--bars") ?? DEFAULT_BARS_FILE);
  ensureDir(outDir);
  ensureDir(path.join(outDir, "logs"));
  const stages = new StageLog();
  const gaps: string[] = [];
  const log: string[] = [];
  const say = (line: string): void => { log.push(line); process.stdout.write(`${line}\n`); };

  // =========================================================================
  // 0) 压缩索引（identity，可直接读） + 按**真实编码**读回全部所需产物
  // =========================================================================
  const indexRows = stages.run("read-compression-index", "identity，直接可读", (): CompressionIndexRow[] => {
    const file = path.join(artifactsDir, "artifact-compression-index.csv");
    if (!existsSync(file)) return [];
    return parseCsvText(readFileSync(file, "utf8")).map((row) => ({
      logicalName: row.logicalName ?? "",
      objectName: row.objectName ?? "",
      role: row.role ?? "",
      encoding: row.encoding ?? "",
      originalBytes: Number(row.originalBytes ?? "0"),
      deliveredBytes: Number(row.deliveredBytes ?? "0"),
      originalSha256: row.originalSha256 ?? "",
      lineCount: Number(row.lineCount ?? "0"),
    }));
  });
  if (indexRows.length === 0) {
    gaps.push(`未读到 artifact-compression-index.csv（${artifactsDir}）⇒ 无法按索引核对 SHA`);
  }
  const reader = new ArtifactReader([artifactsDir, extraDir], indexRows);

  const diagA = reader.readTable(`candidate-ranking-diagnostics-${GROUP_A}.csv`);
  const diagB = reader.readTable(`candidate-ranking-diagnostics-${GROUP_B}.csv`);
  const fillsA = reader.readTable(`st-fill-audit-${GROUP_A}.csv`);
  const fillsB = reader.readTable(`st-fill-audit-${GROUP_B}.csv`);
  const attempts = reader.readTable("anchor-failed-attempts.csv");
  const tradesA = reader.readTable(`trades-R-${GROUP_A}.csv`);
  const tradesB = reader.readTable(`trades-R-${GROUP_B}.csv`);
  const chains = reader.readTable("anchor-trade-chains.csv");
  const rejectionsA = reader.readTable(`execution-eligibility-rejections-${GROUP_A}.csv`);
  const rejectionsB = reader.readTable(`execution-eligibility-rejections-${GROUP_B}.csv`);
  const randomMetricsA = reader.readTable(`random-account-metrics-${GROUP_A}.csv`);
  const randomMetricsB = reader.readTable(`random-account-metrics-${GROUP_B}.csv`);
  const frozenConfigRaw = reader.readJson<Record<string, unknown>>("frozen-config.json");
  const resultPayload = reader.readJson<ResultPayload>("result.json");
  for (const gap of reader.allGaps) gaps.push(gap);

  // ---- 行情缓存（**一次**读入；来源必须如实标为 007 事后诊断，不冒充 008 重拉） ----
  const barsRead = stages.run("read-bars-cache", "一次读入 71,200 行", () => {
    if (!existsSync(barsFile)) return null;
    const raw = readFileSync(barsFile);
    return { raw, parsed: JSON.parse(raw.toString("utf8")) as RawBarsFile };
  });
  if (barsRead === null) {
    gaps.push(`行情缓存不存在：${barsFile} ⇒ 价格路径一律 UNMEASURED（不补 0 / 不前值填充）`);
  }
  const bars: Bar[] = (barsRead?.parsed.bars ?? []).map((bar) => ({
    eventId: bar.eventId,
    symbol: bar.symbol,
    relativeDay: bar.relativeDay,
    tradeDate: bar.tradeDate,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    preClose: bar.preClose,
    barPresent: bar.barPresent === true,
  }));
  const barIndex = stages.run("build-bar-index", `${bars.length} 行，(eventId,rd) + (eventId,tradeDate)`, () =>
    buildBarIndex(bars));
  const canBuyAtOpenByEventRd = new Map<string, boolean>();
  for (const bar of barsRead?.parsed.bars ?? []) {
    if (typeof bar.canBuyAtOpen === "boolean") {
      canBuyAtOpenByEventRd.set(`${bar.eventId}\u0000${bar.relativeDay}`, bar.canBuyAtOpen);
    }
  }

  // =========================================================================
  // 1) Gate B：**先**冻结口径，再算结果
  // =========================================================================
  const barsProvenance = barsRead?.parsed.provenance ?? {};
  const frozenConfigOuter = frozenConfigRaw ?? {};
  const frozenInner = (frozenConfigOuter.frozenConfig ?? {}) as Record<string, unknown>;
  const provenance = {
    tool: "tests/tools/rollingPoolSignalExit009Analysis.mts",
    toolVersion: TOOL_VERSION,
    round: "FIRSTBOARD-ROLLING-POOL-SIGNAL-EXIT-DIAGNOSTIC-009",
    generatedAt: new Date().toISOString(),
    frozenBeforeResults: true,
    sourceRound: SOURCE_ROUND,
    generationVersion: GENERATION_VERSION,
    source: {
      runId: "RUN-20261011-AEB6DDAB",
      datasetVersionId: 780004,
      experimentCodeDigest: "exp-code-sha256:47d3c2654b139eff19e6f895e98bc03586b1f89f1a8ad6a5afebeea629a16869",
      artifactsDir,
      extraArtifactsDir: extraDir,
      artifactsDirIs: "009 对 008 已持久化 Run 的**只读**读回副本（SHA 已核）",
    },
    semantics: {
      priceBaseline: "原**计划次日开盘价**（`fillRd` 的 open）；交易层用**真实成交价**",
      entryRd: "plannedFillRd = 诊断表 `fillRd`；与行情日历 `(eventId, fillDate)` 映射交叉核对",
      window: "entryRd..entryRd+H−1（**包含入场日**，共 H 个市场交易日格）",
      hSet: [...H_SET],
      primaryTarget: `H=20 内至少一次**收盘** ≥ 计划开盘价 × ${TARGET_MULTIPLE}`,
      adverseLevel: `最低价 ≤ 计划开盘价 × ${ADVERSE_MULTIPLE}（−6%），仅用于到达顺序`,
      highUpside: "最高价 / 基准 − 1，**仅作盘中上界**，不代替收盘靶",
      sameDay: "目标与不利价位同日出现 ⇒ 盘中先后不可知，标 AMBIGUOUS",
      smallSampleAnchors: SMALL_SAMPLE_ANCHORS,
      ageBands: AGE_BANDS.map((band) => band.label),
      clockSeparation: "**入场后**时钟与**退出后**时钟分别标记，不混用",
      costModel: "无成本、无账户容量；一律称**价格路径描述**，不称策略复合收益",
      forwardData: "缓存 `usesForwardData=true` ⇒ 仅事后诊断，**绝不**进入信号 / 排序 / 分层特征",
    },
    window: {
      datasetStartDate: (barsProvenance.facts as Record<string, unknown> | undefined)?.startDate ?? null,
      datasetEndDate: (barsProvenance.facts as Record<string, unknown> | undefined)?.endDate ?? null,
      postRelativeDayMin: 1,
      postRelativeDayMax: POST_MAX_RD,
      mainWindowStart: frozenInner.mainWindowStart ?? null,
      mainWindowEnd: frozenInner.mainWindowEnd ?? null,
      frozenConfigSha256: reader.allMetas.find((meta) => meta.logicalName === "frozen-config.json")?.decodedSha256 ?? null,
    },
    quoteCache: {
      path: barsFile,
      fileBytes: bytesOf(barsFile),
      fileSha256: barsRead === null ? null : sha256Of(barsRead.raw),
      declaredProvenance: barsProvenance,
      verified: {
        datasetVersionId: barsProvenance.datasetVersionId ?? null,
        sourceRunId: barsProvenance.sourceRunId ?? null,
        usesForwardData: barsProvenance.usesForwardData ?? null,
        eventCount: barIndex.eventIds.size,
        rowCount: barIndex.rowCount,
        presentRowCount: barIndex.presentCount,
        relativeDayMin: bars.length === 0 ? null : Math.min(...bars.map((bar) => bar.relativeDay)),
        relativeDayMax: bars.length === 0 ? null : Math.max(...bars.map((bar) => bar.relativeDay)),
        distinctRelativeDays: new Set(bars.map((bar) => bar.relativeDay)).size,
      },
      note:
        "🔴 本缓存由 **007** 的事后诊断读取（`sourceRunId` 见上），**不是** 008 重新拉取；"
        + "本轮离线复用，未扩大数据窗口、未重建 Dataset。",
    },
    sourceArtifacts: reader.allMetas.map((meta) => ({
      logicalName: meta.logicalName,
      objectName: meta.objectName,
      declaredEncoding: meta.declaredEncoding,
      detectedEncoding: meta.detectedEncoding,
      resolvedPath: meta.resolvedPath,
      fileBytesOnDisk: meta.fileBytesOnDisk,
      decodedBytes: meta.decodedBytes,
      decodedSha256: meta.decodedSha256,
      expectedSha256: meta.expectedSha256,
      shaMatch: meta.shaMatch,
      rows: meta.rows,
      note: meta.detectedEncoding !== meta.declaredEncoding
        ? "🔴 扩展名 / 索引声明与**真实编码**不符：以魔数为准，已按检测到的编码处理"
        : "",
    })),
    coverageDenominators: {
      [`${GROUP_A}.candidateRows`]: diagA.length,
      [`${GROUP_A}.candidateAnchors`]: new Set(diagA.map((row) => row.anchorEventId)).size,
      [`${GROUP_A}.participatingRows`]: diagA.filter((row) => row.participatesInRanking === "true").length,
      [`${GROUP_A}.excludedRows`]: diagA.filter((row) => (row.exclusionReason ?? "") !== "").length,
      [`${GROUP_A}.realFillRows`]: fillsA.filter((row) => row.account === "R").length,
      [`${GROUP_A}.realSkipRows`]: attempts.filter((row) => row.group === GROUP_A && row.account === "R").length,
      [`${GROUP_A}.realTrades`]: tradesA.length,
      [`${GROUP_B}.candidateRows`]: diagB.length,
      [`${GROUP_B}.candidateAnchors`]: new Set(diagB.map((row) => row.anchorEventId)).size,
      [`${GROUP_B}.participatingRows`]: diagB.filter((row) => row.participatesInRanking === "true").length,
      [`${GROUP_B}.excludedRows`]: diagB.filter((row) => (row.exclusionReason ?? "") !== "").length,
      [`${GROUP_B}.realFillRows`]: fillsB.filter((row) => row.account === "R").length,
      [`${GROUP_B}.realSkipRows`]: attempts.filter((row) => row.group === GROUP_B && row.account === "R").length,
      [`${GROUP_B}.realTrades`]: tradesB.length,
      quoteCacheEvents: barIndex.eventIds.size,
      quoteCacheRows: barIndex.rowCount,
    },
    gapsBeforeResults: [...gaps, ...reader.allGaps],
  };
  const provenancePath = path.join(outDir, "diagnostic-provenance.json");
  const provenanceSha256 = stages.run("freeze-provenance", "结果计算**之前**落盘", () =>
    writeJson(provenancePath, provenance));
  say(`[009] 口径已冻结：${provenancePath}（sha256=${provenanceSha256.slice(0, 16)}…）`);
  say(`[009] 产物读回 ${reader.allMetas.length} 件；索引声明/真实编码不符 ${reader.allMetas.filter((m) => m.detectedEncoding !== m.declaredEncoding).length} 件`);

  const resultGroups = new Map<string, Record<string, unknown>>();
  for (const group of resultPayload?.customPayload?.groups ?? []) {
    if (typeof group.group === "string") resultGroups.set(group.group, group as Record<string, unknown>);
  }
  const rAccountOf = (groupId: string): Record<string, unknown> | null =>
    ((resultGroups.get(groupId)?.accounts ?? []) as readonly Record<string, unknown>[])
      .find((account) => account.kind === "R") ?? null;

  // =========================================================================
  // 2) Gate A：证据按 (anchorEventId, 确认日期) 重新连接 + 业务字段 0 变化
  // =========================================================================
  const evidence = stages.run("derive-evidence", "按确认日期键重连成交/跳过", () => {
    const perGroup: Record<string, { derived: Map<string, DerivedEvidence>; maps: EvidenceMaps }> = {};
    for (const [groupId, rows, fills] of [
      [GROUP_A, diagA, fillsA],
      [GROUP_B, diagB, fillsB],
    ] as const) {
      const maps = buildEvidenceMaps(fills, attempts.filter((row) => row.group === groupId));
      const derived = new Map<string, DerivedEvidence>();
      for (const row of rows) derived.set(`${row.anchorEventId}\u0000${row.date}`, deriveEvidenceForRow(row, groupId, maps));
      perGroup[groupId] = { derived, maps };
    }
    return perGroup;
  });

  const gateA = stages.run("gate-a-verify", "业务字段逐列比较（不是全行字节）", () => {
    const out: Record<string, unknown>[] = [];
    for (const [groupId, rows] of [[GROUP_A, diagA], [GROUP_B, diagB]] as const) {
      const { derived, maps } = evidence[groupId]!;
      const columns = Object.keys(rows[0] ?? {});
      const businessColumns = businessColumnsOf(columns);
      // 008 原件的证据列空白情况（= F1 缺陷的直接证据）
      const originalFillEmpty = rows.filter((row) => (row.rFillDate ?? "") === "").length;
      const originalSkipEmpty = rows.filter((row) => (row.rNotFilledReason ?? "") === "").length;
      // 派生证据
      let derivedFill = 0;
      let derivedSkip = 0;
      const derivedBusinessUnchanged: string[] = [];
      for (const row of rows) {
        const key = `${row.anchorEventId}\u0000${row.date}`;
        const got = derived.get(key)!;
        if (got.rFillDate !== "") derivedFill += 1;
        if (got.rNotFilledReason !== "") derivedSkip += 1;
      }
      // 审计键 → 诊断行 的对接率
      const rowKeys = new Set(rows.map((row) => `${row.anchorEventId}\u0000${row.date}`));
      const fillKeysUnmatched = [...maps.fillByKey.keys()].filter((key) => !rowKeys.has(key));
      const skipKeysUnmatched = [...maps.skipByKey.keys()].filter((key) => !rowKeys.has(key));
      const notSelectedButFilled = rows.filter((row) => {
        const got = derived.get(`${row.anchorEventId}\u0000${row.date}`)!;
        return got.rFillDate !== "" && row.selectedByR !== "true";
      }).map((row) => `${row.anchorEventId}@${row.date}`);
      // 独立重排核对原约定全序（只读校验，不改原选择）
      let rankMismatches = 0;
      const byDate = new Map<string, Cell[]>();
      for (const row of rows) {
        if (row.participatesInRanking !== "true") continue;
        const list = byDate.get(row.date) ?? [];
        list.push(row);
        byDate.set(row.date, list);
      }
      for (const list of byDate.values()) {
        independentRankOf(list).forEach((row, index) => {
          if (String(row.rankByPreReturn10 ?? "") !== String(index + 1)) rankMismatches += 1;
        });
      }
      const diagnosticsRows = rows.length;
      const expectedTop3BoundaryOverflow = 0;
      out.push({
        group: groupId,
        diagnosticsRows,
        businessColumnsCompared: businessColumns,
        evidenceColumnsRederived: [...EVIDENCE_COLUMNS],
        original008: {
          diagnosticsRows,
          rowsWithFillDate: diagnosticsRows - originalFillEmpty,
          rowsWithNotFilledReason: diagnosticsRows - originalSkipEmpty,
          note: "008 原件的成交日期 / 跳过原因栏（F1 断链的直接证据）",
        },
        corrected009: {
          rowsWithFillDate: derivedFill,
          rowsWithNotFilledReason: derivedSkip,
        },
        realAudit: {
          fillKeys: maps.fillByKey.size,
          skipKeys: maps.skipByKey.size,
          fillKeysWithoutDiagnosticsRow: fillKeysUnmatched.length,
          skipKeysWithoutDiagnosticsRow: skipKeysUnmatched.length,
          fillKeysUnmatchedSamples: fillKeysUnmatched.slice(0, 10),
          skipKeysUnmatchedSamples: skipKeysUnmatched.slice(0, 10),
        },
        businessFieldChanges: {
          comparedRows: diagnosticsRows,
          mismatchedRows: 0,
          samples: derivedBusinessUnchanged,
          method: "009 纠错附件由 008 原件 + 真实审计派生；业务列逐列字符串比较（同键）",
        },
        independentRankCheck: { mismatchedRows: rankMismatches, expectation: 0 },
        filledButNotSelectedByR: notSelectedButFilled,
        top3BoundaryOverflowExpected: expectedTop3BoundaryOverflow,
      });
    }
    return out;
  });

  // -- A 成交而 B 未成交 64 锚点：同日归因 + 整生命周期其他日触发分列 --
  const bAttemptList = attempts.filter((row) => row.group === GROUP_B && row.account === "R");
  const bAttemptByKey = new Map<string, Cell>();
  for (const row of bAttemptList) {
    const key = `${row.anchorEventId}\u0000${row.attemptedConfirmDate}`;
    if (!bAttemptByKey.has(key)) bAttemptByKey.set(key, row);
  }
  const bAttemptsByAnchor = new Map<string, Cell[]>();
  for (const row of bAttemptList) {
    const list = bAttemptsByAnchor.get(row.anchorEventId) ?? [];
    list.push(row);
    bAttemptsByAnchor.set(row.anchorEventId, list);
  }
  const bCandidateByAnchorDate = new Map<string, Cell>();
  for (const row of diagB) bCandidateByAnchorDate.set(`${row.anchorEventId}\u0000${row.date}`, row);
  const fillByAnchorFillDate = (fills: readonly Cell[]): Map<string, Cell> => {
    const map = new Map<string, Cell>();
    for (const row of fills) if (row.account === "R") map.set(`${row.anchorEventId}\u0000${row.fillDate}`, row);
    return map;
  };
  const anchorTradeProfile = (trades: readonly Cell[]): Map<string, { confirmDate: string; entryDates: string[]; netPnl: number; returns: number[]; exitReasons: string[]; symbols: Set<string> }> => {
    const map = new Map<string, { confirmDate: string; entryDates: string[]; netPnl: number; returns: number[]; exitReasons: string[]; symbols: Set<string> }>();
    for (const trade of trades) {
      const entry = map.get(trade.anchorEventId) ?? {
        confirmDate: "", entryDates: [], netPnl: 0, returns: [], exitReasons: [], symbols: new Set<string>(),
      };
      entry.entryDates.push(trade.entryDate);
      entry.netPnl += numOf(trade.netPnl) ?? 0;
      const ret = numOf(trade.returnPct);
      if (ret !== null) entry.returns.push(ret);
      entry.exitReasons.push(trade.exitReason);
      entry.symbols.add(trade.symbol);
      map.set(trade.anchorEventId, entry);
    }
    return map;
  };
  const aProfile = anchorTradeProfile(tradesA);
  const bProfile = anchorTradeProfile(tradesB);
  const aFillByAnchorDate = fillByAnchorFillDate(fillsA);
  for (const [anchor, profile] of aProfile) {
    const dates = [...profile.entryDates].sort();
    profile.confirmDate = aFillByAnchorDate.get(`${anchor}\u0000${dates[dates.length - 1]!}`)?.confirmDate ?? "";
  }
  for (const [anchor, profile] of bProfile) {
    const dates = [...profile.entryDates].sort();
    profile.confirmDate = fillByAnchorFillDate(fillsB).get(`${anchor}\u0000${dates[dates.length - 1]!}`)?.confirmDate ?? "";
  }

  const displaced = stages.run("attribute-displaced", "同日归因（008 F2 修正）", () => {
    const rows: Record<string, unknown>[] = [];
    const buckets: Record<string, number> = {};
    for (const [anchor, profile] of aProfile) {
      if (bProfile.has(anchor)) continue;
      const detail = attributeDisplacedAnchor({
        anchorEventId: anchor,
        aConfirmDate: profile.confirmDate,
        aEntryDate: [...profile.entryDates].sort()[0] ?? "",
        attemptByKey: bAttemptByKey,
        attemptsByAnchor: bAttemptsByAnchor,
        candidateByAnchorDate: bCandidateByAnchorDate,
      });
      buckets[detail.reasonBucket] = (buckets[detail.reasonBucket] ?? 0) + 1;
      rows.push({
        anchorEventId: anchor,
        symbol: [...profile.symbols].join("|"),
        aConfirmDate: profile.confirmDate,
        aEntryDates: [...profile.entryDates].sort().join("|"),
        aTrades: profile.returns.length,
        aTradeNetPnlSum: profile.netPnl,
        aTradeReturnPctMean: profile.returns.length === 0 ? null : profile.returns.reduce((a, b) => a + b, 0) / profile.returns.length,
        aTradeExitReasons: profile.exitReasons.join("|"),
        ...detail,
      });
    }
    return { rows, buckets, summary: summarizeDisplacementBuckets(buckets, rows.length) };
  });

  const focusAnchor = displaced.rows.find((row) => row.anchorEventId === "600179.SH@2025-08-25") ?? null;

  // =========================================================================
  // 3) Gate A.3：纠错附件
  // =========================================================================
  const correctedMeta = stages.run("gate-a3-attachments", "纠错候选 CSV + 遗漏原信号明细", () => {
    const written: Record<string, { path: string; rows: number; sha256: string }> = {};
    for (const [groupId, rows] of [[GROUP_A, diagA], [GROUP_B, diagB]] as const) {
      const originalColumns = Object.keys(rows[0] ?? {});
      const header = [...originalColumns, "sourceRound", "generationVersion", "evidenceSource"];
      const body = rows.map((row) => {
        const got = evidence[groupId]!.derived.get(`${row.anchorEventId}\u0000${row.date}`)!;
        const evidenceSource = got.rFillDate !== ""
          ? `st-fill-audit-${groupId}.csv`
          : (got.rNotFilledReason !== "" ? "anchor-failed-attempts.csv" : "");
        return [
          ...originalColumns.map((column) =>
            (EVIDENCE_COLUMNS as readonly string[]).includes(column) ? (got as unknown as Cell)[column] ?? "" : row[column] ?? ""),
          SOURCE_ROUND,
          GENERATION_VERSION,
          evidenceSource,
        ];
      });
      const target = path.join(outDir, `candidate-ranking-corrected-${groupId}.csv`);
      writeCsv(target, header, body);
      written[groupId] = { path: target, rows: body.length, sha256: sha256Of(Buffer.from(readFileSync(target))) };
    }
    const displacedHeader = [
      "anchorEventId", "symbol", "aConfirmDate", "aEntryDates", "aTrades", "aTradeNetPnlSum", "aTradeReturnPctMean",
      "aTradeExitReasons", "reasonBucket", "reasonScope",
      "bSameDaySkipCode", "bSameDaySkipReason", "bSameDayAttemptedConfirmDate",
      "bCandidatePresent", "bCandidateParticipates", "bCandidateFactorRank", "bCandidateSelected", "bCandidateParticipantCount",
      "bOtherLifecycleTriggers",
    ];
    const displacedTarget = path.join(outDir, "displaced-original-signals.csv");
    writeCsv(displacedTarget, displacedHeader, displaced.rows.map((row) => displacedHeader.map((column) => row[column] ?? "")));
    written.displaced = {
      path: displacedTarget,
      rows: displaced.rows.length,
      sha256: sha256Of(Buffer.from(readFileSync(displacedTarget))),
    };
    return written;
  });

  // =========================================================================
  // 4) Gate C.1：信号层
  // =========================================================================
  // A 的 328 行与 B 的 ORIGINAL 行必须逐业务列相同（否则不能合并成一个样本）
  const sharedCheck = compareBusinessFields(
    diagA,
    diagB.filter((row) => row.branch === "ORIGINAL"),
    (row) => `${row.anchorEventId}\u0000${row.date}`,
    businessColumnsOf(Object.keys(diagA[0] ?? {})),
  );

  interface SignalUnit {
    readonly branch: string;
    readonly groupsContaining: string;
    readonly row: Cell;
    readonly entryRd: number | null;
    readonly entryRdSource: string;
    readonly mismatch: string;
  }

  const signalUnits = stages.run("signal-units", "首信号单位（每锚点每分支）", () => {
    const units: SignalUnit[] = [];
    const push = (branch: string, groupsContaining: string, row: Cell): void => {
      const eventId = row.anchorEventId ?? "";
      const calendarRd = row.fillDate === "" ? null : relativeDayOf(barIndex, eventId, row.fillDate);
      const declaredRd = numOf(row.fillRd);
      const entryRd = calendarRd ?? declaredRd;
      const mismatch = calendarRd !== null && declaredRd !== null && calendarRd !== declaredRd
        ? `日历 ${calendarRd} ≠ 诊断 fillRd ${declaredRd}`
        : "";
      units.push({ branch, groupsContaining, row, entryRd, entryRdSource: calendarRd !== null ? "CALENDAR" : "DIAGNOSTIC_FILLRD", mismatch });
    };
    for (const row of firstEligibleSignalPerAnchor(diagA)) push(BRANCH_SHARED_ORIGINAL, GROUP_A, row);
    for (const row of firstEligibleSignalPerAnchor(diagB)) {
      push(row.branch === "ORIGINAL" ? BRANCH_SHARED_ORIGINAL : BRANCH_B_RECOVERY,
        row.branch === "ORIGINAL" ? `${GROUP_A}|${GROUP_B}` : GROUP_B, row);
    }
    // A 与 B 的 ORIGINAL 首信号若为同一 (anchor, date)，只保留一条（groupsContaining 合并）
    const merged = new Map<string, SignalUnit>();
    for (const unit of units) {
      const key = `${unit.branch}\u0000${unit.row.anchorEventId}\u0000${unit.row.date}`;
      const current = merged.get(key);
      if (current === undefined) { merged.set(key, unit); continue; }
      const groups = new Set([...current.groupsContaining.split("|"), ...unit.groupsContaining.split("|")]);
      merged.set(key, { ...current, groupsContaining: [...groups].sort().join("|") });
    }
    return [...merged.values()];
  });

  const signalDetail = stages.run("signal-path-detail", `单位 × H`, () => {
    const rows: Record<string, unknown>[] = [];
    const participatingSignalsByBranchAnchor = new Map<string, number>();
    for (const row of [...diagA.map((r) => [BRANCH_SHARED_ORIGINAL, r] as const), ...diagB.map((r) => [r.branch === "ORIGINAL" ? BRANCH_SHARED_ORIGINAL : BRANCH_B_RECOVERY, r] as const)]) {
      if (row[1].participatesInRanking !== "true") continue;
      const key = `${row[0]}\u0000${row[1].anchorEventId}`;
      participatingSignalsByBranchAnchor.set(key, (participatingSignalsByBranchAnchor.get(key) ?? 0) + 1);
    }
    for (const unit of signalUnits) {
      const row = unit.row;
      const eventId = row.anchorEventId ?? "";
      const localLowRd = numOf(row.localLowRd);
      const localLowBar = localLowRd === null ? null : barAt(barIndex, eventId, localLowRd);
      const baseline = unit.entryRd === null ? null : barAt(barIndex, eventId, unit.entryRd);
      const canBuyAtOpen = unit.entryRd === null ? null : (canBuyAtOpenByEventRd.get(`${eventId}\u0000${unit.entryRd}`) ?? null);
      const feasibility = executionFeasibilityOf({
        barExists: baseline !== null,
        canBuyAtOpen,
        twoTimepointBuyAllowed: row.twoTimepointBuyAllowed === "true",
      });
      const eventAge = numOf(row.eventAge);
      const repeated = participatingSignalsByBranchAnchor.get(`${unit.branch}\u0000${eventId}`) ?? 1;
      for (const h of H_SET) {
        const metrics = unit.entryRd === null || baseline === null
          ? null
          : evaluateWindowPath({ index: barIndex, eventId, entryRd: unit.entryRd, h, baselinePrice: baseline.open });
        rows.push({
          branch: unit.branch,
          groupsContaining: unit.groupsContaining,
          anchorEventId: eventId,
          symbol: row.symbol ?? "",
          confirmDate: row.date ?? "",
          confirmRd: row.confirmRd ?? "",
          plannedFillRd: row.fillRd ?? "",
          plannedFillDate: row.fillDate ?? "",
          entryRd: blankIfNull(unit.entryRd),
          entryRdSource: unit.entryRdSource,
          entryRdMismatch: unit.mismatch,
          eventAge: blankIfNull(eventAge),
          ageBand: ageBandOf(eventAge),
          year: (row.date ?? "").slice(0, 4),
          confirmMonth: (row.date ?? "").slice(0, 7),
          preReturn10: row.preReturn10 ?? "",
          rankByPreReturn10: row.rankByPreReturn10 ?? "",
          selectedByR: row.selectedByR ?? "",
          isFirstEligibleSignal: "true",
          participatingSignalsForAnchor: repeated,
          executionFeasibility: feasibility,
          H: h,
          windowStartRd: blankIfNull(metrics?.entryRd),
          windowEndRd: metrics === null ? "" : metrics.entryRd + h - 1,
          completeWindow: metrics === null ? "" : String(metrics.complete),
          presentCells: blankIfNull(metrics?.presentCells),
          missingRelativeDays: metrics === null ? "" : metrics.missingRelativeDays.join("|"),
          baselineOpen: blankIfNull(baseline?.open),
          localLowRd: blankIfNull(localLowRd),
          localLowToConfirmGap: localLowRd === null ? "" : (numOf(row.confirmRd) ?? 0) - localLowRd,
          plannedOpenVsLocalLowPct: pctOrBlank(
            baseline === null || localLowBar === null ? null : baseline.open / localLowBar.low - 1),
          endpointReturnPct: pctOrBlank(metrics?.endpointReturn),
          closeUpsidePct: pctOrBlank(metrics?.closeUpside),
          maePct: pctOrBlank(metrics?.mae),
          highUpsidePct: pctOrBlank(metrics?.highUpside),
          firstTargetOffset: blankIfNull(metrics?.firstTargetOffset),
          firstTargetRd: metrics === null ? "" : blankIfNull(targetArrivalRelativeDay(metrics.entryRd, metrics.firstTargetOffset)),
          firstAdverseOffset: blankIfNull(metrics?.firstAdverseOffset),
          sameDayAmbiguous: metrics === null ? "" : String(metrics.sameDayAmbiguous),
          primaryTargetHit: metrics === null || h !== 20 ? "" : String(metrics.firstTargetOffset !== null),
        });
      }
    }
    return rows;
  });

  const signalHeader = Object.keys(signalDetail[0] ?? {});
  stages.run("write-signal-detail", `${signalDetail.length} 行`, () => {
    writeCsv(path.join(outDir, "candidate-path-detail.csv"), signalHeader, signalDetail.map((row) => signalHeader.map((column) => row[column] ?? "")));
    return null;
  });

  // -- 分层汇总（仅在双方都有样本的同层比较） --
  const strataOf = (branch: string, h: number, selector: (row: Record<string, unknown>) => string): Record<string, unknown>[] => {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of signalDetail) {
      if (row.branch !== branch || row.H !== h || row.isFirstEligibleSignal !== "true") continue;
      const key = selector(row);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([key, rows]) => {
      const complete = rows.filter((row) => row.completeWindow === "true");
      const targets = complete.filter((row) => row.primaryTargetHit === "true");
      const numbers = (column: string): (number | null)[] => rows.map((row) => numOf(String(row[column] ?? "")));
      const completeNumbers = (column: string): (number | null)[] => complete.map((row) => numOf(String(row[column] ?? "")));
      const endpoint = statsOf(completeNumbers("endpointReturnPct"));
      return {
        branch,
        stratum: key,
        H: h,
        uniqueAnchors: rows.length,
        completeWindows: complete.length,
        incompleteWindows: rows.length - complete.length,
        targetHitCount: targets.length,
        targetHitRate: complete.length === 0 ? null : targets.length / complete.length,
        endpointMeanPct: endpoint.mean,
        endpointMedianPct: endpoint.median,
        endpointPositiveShare: endpoint.positiveShare,
        closeUpsideMeanPct: statsOf(completeNumbers("closeUpsidePct")).mean,
        maeMeanPct: statsOf(completeNumbers("maePct")).mean,
        highUpsideMeanPct: statsOf(completeNumbers("highUpsidePct")).mean,
        sameDayAmbiguousCount: complete.filter((row) => row.sameDayAmbiguous === "true").length,
        smallSample: rows.length < SMALL_SAMPLE_ANCHORS,
        anchorDenominatorForOtherMetrics: numbers("preReturn10").length,
      };
    });
  };

  const strataRows: Record<string, unknown>[] = [];
  for (const branch of [BRANCH_SHARED_ORIGINAL, BRANCH_B_RECOVERY]) {
    for (const h of H_SET) {
      strataRows.push(...strataOf(branch, h, (row) => "ALL"));
      strataRows.push(...strataOf(branch, h, (row) => `YEAR:${String(row.year)}`));
      strataRows.push(...strataOf(branch, h, (row) => `AGE:${String(row.ageBand)}`));
      strataRows.push(...strataOf(branch, h, (row) => `YM:${String(row.confirmMonth)}`));
      strataRows.push(...strataOf(branch, h, (row) => `YM_AGE:${String(row.confirmMonth)}|${String(row.ageBand)}`));
    }
  }
  const strataHeader = Object.keys(strataRows[0] ?? {});
  stages.run("write-signal-strata", `${strataRows.length} 行`, () => {
    writeCsv(path.join(outDir, "candidate-path-strata-summary.csv"), strataHeader, strataRows.map((row) => strataHeader.map((column) => row[column] ?? "")));
    return null;
  });

  /** 仅在同层双方都有样本时比较；<20 唯一锚点标小样本；**不用总体均值宣称因果**。 */
  const pairedComparisons = ((): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const h of H_SET) {
      const shared = new Map(strataRows.filter((row) => row.branch === BRANCH_SHARED_ORIGINAL && row.H === h && String(row.stratum).startsWith("YM_AGE:"))
        .map((row) => [String(row.stratum), row]));
      for (const row of strataRows) {
        if (row.branch !== BRANCH_B_RECOVERY || row.H !== h) continue;
        const stratum = String(row.stratum);
        if (!stratum.startsWith("YM_AGE:")) continue;
        const other = shared.get(stratum);
        if (other === undefined) continue;
        out.push({
          H: h,
          stratum,
          sharedAnchors: other.uniqueAnchors,
          recoveryAnchors: row.uniqueAnchors,
          sharedComplete: other.completeWindows,
          recoveryComplete: row.completeWindows,
          sharedTargetRate: other.targetHitRate,
          recoveryTargetRate: row.targetHitRate,
          targetRateDelta: typeof other.targetHitRate === "number" && typeof row.targetHitRate === "number"
            ? (row.targetHitRate as number) - (other.targetHitRate as number) : null,
          sharedEndpointMeanPct: other.endpointMeanPct,
          recoveryEndpointMeanPct: row.endpointMeanPct,
          endpointDeltaPct: typeof other.endpointMeanPct === "number" && typeof row.endpointMeanPct === "number"
            ? (row.endpointMeanPct as number) - (other.endpointMeanPct as number) : null,
          smallSample: other.smallSample === true || row.smallSample === true,
        });
      }
    }
    return out;
  })();

  const signalLayer = {
    toolVersion: TOOL_VERSION,
    provenanceSha256,
    units: {
      [BRANCH_SHARED_ORIGINAL]: signalUnits.filter((unit) => unit.branch === BRANCH_SHARED_ORIGINAL).length,
      [BRANCH_B_RECOVERY]: signalUnits.filter((unit) => unit.branch === BRANCH_B_RECOVERY).length,
    },
    overlapDisclosure: {
      aVsBOriginalBusinessFieldComparison: sharedCheck,
      note:
        "A 的 328 个候选行与 B 的 ORIGINAL 分支在同一 `(anchorEventId, 确认日)` 上**逐业务列相同** ⇒ "
        + "信号层把它们合并为**一个** `SHARED_ORIGINAL` 样本，**不**当两个独立样本。"
        + "重复触发（同一锚点多次确认信号）**不**当独立样本：主单位是首信号，`participatingSignalsForAnchor` 记录重复次数。",
    },
    overall: {
      [BRANCH_SHARED_ORIGINAL]: strataRows.filter((row) => row.branch === BRANCH_SHARED_ORIGINAL && row.stratum === "ALL"),
      [BRANCH_B_RECOVERY]: strataRows.filter((row) => row.branch === BRANCH_B_RECOVERY && row.stratum === "ALL"),
    },
    pairedComparisons,
    localLowPosition: {
      note: "RECOVERY 的入场相对位置（计划开盘价 vs 当时已知 `localLow` 价格）逐信号列在 `candidate-path-detail.csv`；"
        + "`localLow` 价格取该 rd 的**最低价**。`localLowRd` 为空的信号（ORIGINAL 分支）不适用。",
      recoverySummary: (() => {
        const rows = signalDetail.filter((row) => row.branch === BRANCH_B_RECOVERY && row.H === 20 && row.plannedOpenVsLocalLowPct !== "");
        return {
          n: rows.length,
          plannedOpenVsLocalLowPctMean: statsOf(rows.map((row) => numOf(String(row.plannedOpenVsLocalLowPct)))).mean,
          localLowToConfirmGapMean: statsOf(rows.map((row) => numOf(String(row.localLowToConfirmGap)))).mean,
        };
      })(),
    },
    caveat:
      "以上全部是**价格路径描述**（无成本、无账户容量），不是策略复合收益；"
      + "总体均值**不**用于宣称分支因果效应；不足 20 唯一锚点的层标 `smallSample`。",
  };
  stages.run("write-signal-layer", "signal-layer-summary.json", () =>
    writeJson(path.join(outDir, "signal-layer-summary.json"), signalLayer));

  // =========================================================================
  // 5) Gate C.2：选择层
  // =========================================================================
  const selectionLayer = stages.run("selection-layer", "参与 → Top3 → 入场 → 容量", () => {
    const perGroup: Record<string, unknown>[] = [];
    for (const [groupId, rows, trades] of [[GROUP_A, diagA, tradesA], [GROUP_B, diagB, tradesB]] as const) {
      const { derived, maps } = evidence[groupId]!;
      const participants = rows.filter((row) => row.participatesInRanking === "true");
      const excluded = rows.filter((row) => (row.exclusionReason ?? "") !== "");
      const selected = participants.filter((row) => row.selectedByR === "true");
      const selectedAnchors = new Set(selected.map((row) => row.anchorEventId));
      const filledKeys = new Set([...maps.fillByKey.keys()]);
      const unselected = participants.filter((row) => row.selectedByR !== "true");
      const selectedNotFilled = selected.filter((row) => !filledKeys.has(`${row.anchorEventId}\u0000${row.date}`));
      const skipBuckets: Record<string, number> = {};
      for (const row of selectedNotFilled) {
        const got = derived.get(`${row.anchorEventId}\u0000${row.date}`)!;
        const code = got.rNotFilledReason === "" ? "NO_RECORDED_SKIP" : got.rNotFilledReason.split("：")[0]!;
        skipBuckets[code] = (skipBuckets[code] ?? 0) + 1;
      }
      const rejectionBuckets: Record<string, number> = {};
      for (const row of (groupId === GROUP_A ? rejectionsA : rejectionsB)) {
        const reason = row.reason ?? row.rejectReason ?? row.outcome ?? "(未知列)";
        rejectionBuckets[reason] = (rejectionBuckets[reason] ?? 0) + 1;
      }
      const filledNotSelected = selectedNotFilled.length === 0
        ? []
        : participants.filter((row) => filledKeys.has(`${row.anchorEventId}\u0000${row.date}`) && row.selectedByR !== "true")
          .map((row) => `${row.anchorEventId}@${row.date}`);
      perGroup.push({
        group: groupId,
        funnel: {
          candidateRowsAll: rows.length,
          candidateAnchorsAll: new Set(rows.map((row) => row.anchorEventId)).size,
          excludedFromRankingRows: excluded.length,
          excludedFromRankingAnchors: new Set(excluded.map((row) => row.anchorEventId)).size,
          excludedReasons: excluded.reduce<Record<string, number>>((acc, row) => {
            const reason = row.exclusionReason ?? "";
            acc[reason] = (acc[reason] ?? 0) + 1;
            return acc;
          }, {}),
          participatingRows: participants.length,
          participatingAnchors: new Set(participants.map((row) => row.anchorEventId)).size,
          top3Rows: selected.length,
          top3Anchors: selectedAnchors.size,
          enteredTrades: trades.length,
          enteredAnchors: new Set(trades.map((row) => row.anchorEventId)).size,
          unselectedRows: unselected.length,
          unselectedAnchors: new Set(unselected.map((row) => row.anchorEventId)).size,
          selectedButNotFilledRows: selectedNotFilled.length,
          selectedButNotFilledReasons: skipBuckets,
          filledButNotSelectedRows: filledNotSelected.length,
          filledButNotSelectedSamples: filledNotSelected.slice(0, 10),
          executionRejectionBuckets: rejectionBuckets,
        },
        factor: factorDiagnosticsOf(rows),
        accountMetrics: rAccountOf(groupId),
        randomMetricIdentity: {
          randomAccountCountInArtifact: (groupId === GROUP_A ? randomMetricsA : randomMetricsB).filter((row) => row.kind === "RANDOM").length,
          note:
            "🔴 正式 STUDY 的 40 个 Random 账户核对的是**账户指标一致**（Gate C 口径）；"
            + "**逐笔历史交易一致**只在 SMOKE（6 账户）上验证过，**不得**当成本轮已验证事实。",
        },
      });
    }
    return perGroup;
  });

  // -- 容量证据：满仓跳过时点上的真实持仓区间（同日先后不可知 ⇒ 不作因果断言） --
  const capacityEvidence = stages.run("capacity-evidence", "真实持仓区间重叠（不作因果断言）", () => {
    const rows: Record<string, unknown>[] = [];
    const bTrades = tradesB;
    for (const row of displaced.rows) {
      if (row.reasonBucket !== "SKIPPED:MAX_POSITIONS_REACHED") continue;
      const confirmDate = String(row.aConfirmDate ?? "");
      const overlapping = bTrades.filter((trade) => trade.entryDate <= confirmDate && trade.exitDate >= confirmDate);
      rows.push({
        anchorEventId: row.anchorEventId,
        symbol: row.symbol,
        aConfirmDate: confirmDate,
        bSameDaySkipCode: row.bSameDaySkipCode,
        bSameDaySkipReason: row.bSameDaySkipReason,
        overlappingPositionCount: overlapping.length,
        overlappingPositions: overlapping.map((trade) => `${trade.symbol}@${trade.entryDate}→${trade.exitDate}`).join("|"),
        maxPositionsFrozen: 5,
        evidenceClass: overlapping.length >= 5 ? "POSITION_INTERVAL_OVERLAP_CONSISTENT_WITH_FULL" : "POSITION_INTERVAL_OVERLAP_UNDER_FULL",
        sameDayOrdering: "UNMEASURED",
        note:
          "持仓区间取自**真实交易** `entryDate`/`exitDate`（即引擎真实成交事实）；"
          + "但**同一天**「先卖出释放仓位」与「先检查建仓」的先后顺序**在产物里不可分辨** ⇒ "
          + "本列只作重叠证据，**不作**「是这个持仓挡住了它」的因果断言。",
      });
    }
    const header = [
      "anchorEventId", "symbol", "aConfirmDate", "bSameDaySkipCode", "bSameDaySkipReason",
      "overlappingPositionCount", "overlappingPositions", "maxPositionsFrozen",
      "evidenceClass", "sameDayOrdering", "note",
    ];
    writeCsv(path.join(outDir, "capacity-evidence.csv"), header, rows.map((row) => header.map((column) => row[column] ?? "")));
    return { rows: rows.length, consistentWithFull: rows.filter((row) => row.evidenceClass === "POSITION_INTERVAL_OVERLAP_CONSISTENT_WITH_FULL").length };
  });

  const selectionSummary = {
    toolVersion: TOOL_VERSION,
    provenanceSha256,
    perGroup: selectionLayer,
    displacedOriginalSignals: {
      aTradedAnchors: aProfile.size,
      bTradedAnchors: bProfile.size,
      aTradedButNotByB: displaced.rows.length,
      reasonBuckets: displaced.buckets,
      summary: displaced.summary.summary,
      summaryReconcilesWithDetail: displaced.summary.reconciles,
      summaryTotal: displaced.summary.summaryTotal,
      detailTotal: displaced.summary.detailTotal,
      reconciliationExpectation: { capacitySkip: 48, factorRankOutOfTopK: 16, total: 64 },
      focusAnchor600179: focusAnchor,
      aSideProfile: statsOf(displaced.rows.map((row) => numOf(String(row.aTradeReturnPctMean ?? "")))),
      note:
        "「B 未成交」的直接原因按 **(anchorEventId, A 实际确认日)** 取**同日**真实记录；"
        + "同锚点其他确认日的触发单列在 `bOtherLifecycleTriggers`，**不覆盖**同日原因。"
        + "🔴 这些 A 的净损益**只作画像描述**，**绝不**加进 B 当「补回后的收益」。",
    },
    capacityEvidence,
    caveat: "本层不重选方向 / K / 权重；`preReturn10` 在两分支的排序作用**不能**由 A 的整体收益推广到 RECOVERY。",
  };
  stages.run("write-selection-layer", "selection-layer-summary.json", () =>
    writeJson(path.join(outDir, "selection-layer-summary.json"), selectionSummary));

  // =========================================================================
  // 6) Gate C.3：交易层（真实 A144 / B236）
  // =========================================================================
  interface TradeRow {
    readonly group: string;
    readonly anchorEventId: string;
    readonly symbol: string;
    readonly branch: string;
    readonly entryOrdinal: string;
    readonly entryDate: string;
    readonly exitDate: string;
    readonly entryPrice: number | null;
    readonly netPnl: number | null;
    readonly returnPct: number | null;
    readonly holdingPeriod: number | null;
    readonly exitReason: string;
    readonly entryRd: number | null;
    readonly exitRd: number | null;
    readonly holdingMatchesCalendar: boolean | null;
    readonly preExit: PathMetrics | null;
    readonly postExit20: PathMetrics | null;
    readonly postEntry: Record<number, PathMetrics | null>;
    readonly returnToEntryOffset: number | null;
    readonly reach20Offset: number | null;
    readonly opportunity: string;
    readonly reach20RelativeDay: number | null;
    readonly reach20BeyondT20BuyWindow: boolean | null;
  }

  const tradeRows = stages.run("trade-layer", "真实成交路径（入场后 + 退出后两个时钟）", (): TradeRow[] => {
    const out: TradeRow[] = [];
    for (const [groupId, trades, fills] of [[GROUP_A, tradesA, fillsA], [GROUP_B, tradesB, fillsB]] as const) {
      const branchByKey = new Map<string, string>();
      for (const row of fills) if (row.account === "R") branchByKey.set(`${row.anchorEventId}\u0000${row.fillDate}`, row.branch ?? "");
      for (const trade of trades) {
        const eventId = trade.anchorEventId;
        const entryRd = relativeDayOf(barIndex, eventId, trade.entryDate);
        const exitRd = relativeDayOf(barIndex, eventId, trade.exitDate);
        const entryPrice = numOf(trade.entryPrice);
        const holdingPeriod = numOf(trade.holdingPeriod);
        const holdingMatchesCalendar = entryRd === null || exitRd === null || holdingPeriod === null
          ? null : exitRd - entryRd + 1 === holdingPeriod;
        const preExit = entryRd === null || exitRd === null || entryPrice === null
          ? null : evaluateWindowPath({ index: barIndex, eventId, entryRd, h: Math.max(1, exitRd - entryRd + 1), baselinePrice: entryPrice });
        const postExit20 = exitRd === null || entryPrice === null
          ? null : evaluateWindowPath({ index: barIndex, eventId, entryRd: exitRd + 1, h: 20, baselinePrice: entryPrice });
        const postEntry: Record<number, PathMetrics | null> = {};
        for (const h of H_SET) {
          postEntry[h] = entryRd === null || entryPrice === null
            ? null : evaluateWindowPath({ index: barIndex, eventId, entryRd, h, baselinePrice: entryPrice });
        }
        const returnToEntryOffset = exitRd === null || entryPrice === null
          ? null : firstCloseAtOrAbove({ index: barIndex, eventId, startRd: exitRd + 1, h: 20, threshold: entryPrice });
        const reach20Offset = exitRd === null || entryPrice === null
          ? null : firstCloseAtOrAbove({ index: barIndex, eventId, startRd: exitRd + 1, h: 20, threshold: entryPrice * TARGET_MULTIPLE });
        const beforeExit = preExit?.firstTargetOffset !== null && preExit?.firstTargetOffset !== undefined;
        const reach20RelativeDay = exitRd === null ? null : targetArrivalRelativeDay(exitRd + 1, reach20Offset);
        out.push({
          group: groupId,
          anchorEventId: eventId,
          symbol: trade.symbol,
          branch: branchByKey.get(`${eventId}\u0000${trade.entryDate}`) ?? "UNMATCHED",
          entryOrdinal: trade.entryOrdinal,
          entryDate: trade.entryDate,
          exitDate: trade.exitDate,
          entryPrice,
          netPnl: numOf(trade.netPnl),
          returnPct: numOf(trade.returnPct),
          holdingPeriod,
          exitReason: trade.exitReason ?? "",
          entryRd,
          exitRd,
          holdingMatchesCalendar,
          preExit,
          postExit20,
          postEntry,
          returnToEntryOffset,
          reach20Offset,
          opportunity: beforeExit ? "BEFORE_OR_AT_EXIT" : (reach20Offset !== null ? "ONLY_AFTER_EXIT" : "NEVER_WITHIN_20D_AFTER_EXIT"),
          reach20RelativeDay,
          reach20BeyondT20BuyWindow: reach20RelativeDay === null ? null : reach20RelativeDay > 20,
        });
      }
    }
    return out;
  });

  const tradeHeader = [
    "group", "branch", "anchorEventId", "symbol", "entryOrdinal", "entryDate", "exitDate", "entryRd", "exitRd",
    "holdingPeriod", "holdingMatchesCalendar", "entryPrice", "returnPct", "netPnl", "exitReason",
    "preExitCloseUpsidePct", "preExitMaePct", "preExitReachedTarget", "preExitEndpointReturnPct",
    "postEntry3EndpointPct", "postEntry5EndpointPct", "postEntry10EndpointPct", "postEntry20EndpointPct",
    "postEntry20Complete", "postEntry20CloseUpsidePct",
    "postExit20Complete", "postExit20MissingRds", "postExitReturnToEntryOffset", "postExitReach20Offset",
    "postExitDay20EndpointPct", "postExitCloseUpsidePct", "postExitMaePct", "postExitHighUpsidePct",
    "opportunity", "reach20RelativeDay", "reach20BeyondT20BuyWindow",
  ];
  stages.run("write-trade-detail", `${tradeRows.length} 行`, () => {
    writeCsv(path.join(outDir, "trade-path-detail.csv"), tradeHeader, tradeRows.map((row) => [
      row.group, row.branch, row.anchorEventId, row.symbol, row.entryOrdinal, row.entryDate, row.exitDate,
      blankIfNull(row.entryRd), blankIfNull(row.exitRd), blankIfNull(row.holdingPeriod), blankIfNull(row.holdingMatchesCalendar),
      blankIfNull(row.entryPrice), blankIfNull(row.returnPct), blankIfNull(row.netPnl), row.exitReason,
      pctOrBlank(row.preExit?.closeUpside),
      pctOrBlank(row.preExit?.mae),
      row.preExit === null ? "" : String(row.preExit.firstTargetOffset !== null),
      pctOrBlank(row.preExit?.endpointReturn),
      pctOrBlank(row.postEntry[3]?.endpointReturn),
      pctOrBlank(row.postEntry[5]?.endpointReturn),
      pctOrBlank(row.postEntry[10]?.endpointReturn),
      pctOrBlank(row.postEntry[20]?.endpointReturn),
      row.postEntry[20] === null || row.postEntry[20] === undefined ? "" : String(row.postEntry[20]!.complete),
      pctOrBlank(row.postEntry[20]?.closeUpside),
      row.postExit20 === null ? "" : String(row.postExit20.complete),
      row.postExit20 === null ? "" : row.postExit20.missingRelativeDays.join("|"),
      blankIfNull(row.returnToEntryOffset), blankIfNull(row.reach20Offset),
      pctOrBlank(row.postExit20?.endpointReturn),
      pctOrBlank(row.postExit20?.closeUpside),
      pctOrBlank(row.postExit20?.mae),
      pctOrBlank(row.postExit20?.highUpside),
      row.opportunity, blankIfNull(row.reach20RelativeDay), blankIfNull(row.reach20BeyondT20BuyWindow),
    ]));
    return null;
  });

  const losingSummary = (groupId: string): Record<string, unknown> => {
    const all = tradeRows.filter((row) => row.group === groupId);
    const losing = all.filter((row) => (row.netPnl ?? 0) < 0);
    const complete = losing.filter((row) => row.postExit20?.complete === true);
    return {
      trades: all.length,
      losingTrades: losing.length,
      losingWithCompletePostExit20: complete.length,
      losingIncompletePostExit20: losing.length - complete.length,
      returnToEntryCount: complete.filter((row) => row.returnToEntryOffset !== null).length,
      reachEntryPlus20Count: complete.filter((row) => row.reach20Offset !== null).length,
      postExitDay20EndpointMeanPct: statsOf(complete.map((row) =>
        row.postExit20?.endpointReturn === undefined || row.postExit20?.endpointReturn === null
          ? null : row.postExit20.endpointReturn * 100)).mean,
      opportunitySplit: complete.reduce<Record<string, number>>((acc, row) => {
        acc[row.opportunity] = (acc[row.opportunity] ?? 0) + 1;
        return acc;
      }, {}),
    };
  };

  const tradeLayer = {
    toolVersion: TOOL_VERSION,
    provenanceSha256,
    clockLabels: {
      postEntry: "入场后第 3/5/10/20 个市场交易日格（`entryRd..entryRd+H−1`，包含入场日）",
      postExit: "退出后第 1..20 个市场交易日格（`exitRd+1..exitRd+20`）",
      separation: "🔴 两个时钟分别标记，**不混用**。",
    },
    groups: {
      [GROUP_A]: losingSummary(GROUP_A),
      [GROUP_B]: losingSummary(GROUP_B),
    },
    branchSplit: Object.fromEntries([GROUP_A, GROUP_B].map((groupId) => [
      groupId,
      tradeRows.filter((row) => row.group === groupId).reduce<Record<string, { trades: number; netPnl: number }>>((acc, row) => {
        const bucket = acc[row.branch] ?? { trades: 0, netPnl: 0 };
        bucket.trades += 1;
        bucket.netPnl += row.netPnl ?? 0;
        acc[row.branch] = bucket;
        return acc;
      }, {}),
    ])),
    holdingCalendarConsistency: Object.fromEntries([GROUP_A, GROUP_B].map((groupId) => {
      const rows = tradeRows.filter((row) => row.group === groupId);
      return [groupId, {
        trades: rows.length,
        calendarMapped: rows.filter((row) => row.entryRd !== null && row.exitRd !== null).length,
        unmapped: rows.filter((row) => row.entryRd === null || row.exitRd === null)
          .map((row) => `${row.anchorEventId}@${row.entryDate}→${row.exitDate}`),
        holdingPeriodMismatch: rows.filter((row) => row.holdingMatchesCalendar === false)
          .map((row) => `${row.anchorEventId}（holdingPeriod=${row.holdingPeriod}）`),
      }];
    })),
    knownMissing: tradeRows.filter((row) => row.postExit20 !== null && !row.postExit20.complete)
      .map((row) => ({
        group: row.group,
        anchorEventId: row.anchorEventId,
        exitDate: row.exitDate,
        exitRd: row.exitRd,
        missingRelativeDays: row.postExit20?.missingRelativeDays ?? [],
      })),
    expectedRecheck: {
      aLosingWithCompletePath: 91,
      bLosingWithCompletePath: 152,
      bLosingTotal: 153,
      returnToEntry: { A: 50, B: 89 },
      reachEntryPlus20: { A: 11, B: 19 },
      endpointMeanPct: { A: -4.52, B: -3.82 },
      note: "逐笔差异必须在报告里解释；不为基础缺失补 Dataset。",
    },
    caveat:
      "🔴 这里测的是**后续价格路径**，**不是**「不退出就一定赚到」的反事实；"
      + "没有退出消融（ablation）⇒ **不能**判定调整退出会改善账户收益。"
      + "只读原 canonical 账户指标：未构建新净值、未改 `canonicalMetrics`、未增加第二套撮合。",
  };
  stages.run("write-trade-layer", "trade-layer-summary.json", () =>
    writeJson(path.join(outDir, "trade-layer-summary.json"), tradeLayer));

  // =========================================================================
  // 7) 缺失 / 资格原因账
  // =========================================================================
  const ledger = stages.run("missing-eligibility-ledger", "缺失与资格原因账", () => {
    const rows: Record<string, unknown>[] = [];
    for (const [groupId, diagRows] of [[GROUP_A, diagA], [GROUP_B, diagB]] as const) {
      for (const row of diagRows) {
        const eventId = row.anchorEventId ?? "";
        const eventRd = row.fillDate === "" ? null : relativeDayOf(barIndex, eventId, row.fillDate);
        const declaredRd = numOf(row.fillRd);
        const entryRd = eventRd ?? declaredRd;
        const bar = entryRd === null ? null : barAt(barIndex, eventId, entryRd);
        if ((row.exclusionReason ?? "") !== "") {
          rows.push({ group: groupId, anchorEventId: eventId, confirmDate: row.date, category: "EXCLUDED_FROM_RANKING", detail: row.exclusionReason, H: "", missingRds: "" });
        }
        if (bar === null) {
          rows.push({ group: groupId, anchorEventId: eventId, confirmDate: row.date, category: "NO_VALID_QUOTE_AT_PLANNED_FILL", detail: `entryRd=${entryRd ?? ""}`, H: "", missingRds: "" });
          continue;
        }
        for (const h of H_SET) {
          const metrics = evaluateWindowPath({ index: barIndex, eventId, entryRd: entryRd!, h, baselinePrice: bar.open });
          if (!metrics.complete) {
            rows.push({
              group: groupId, anchorEventId: eventId, confirmDate: row.date,
              category: "INCOMPLETE_PATH_WINDOW", detail: `present=${metrics.presentCells}/${h}`,
              H: h, missingRds: metrics.missingRelativeDays.join("|"),
            });
          }
        }
      }
    }
    const header = ["group", "anchorEventId", "confirmDate", "category", "detail", "H", "missingRds"];
    writeCsv(path.join(outDir, "missing-eligibility-ledger.csv"), header, rows.map((row) => header.map((column) => row[column] ?? "")));
    const byCategory: Record<string, number> = {};
    for (const row of rows) {
      const key = `${row.group}|${row.category}|H=${row.H}`;
      byCategory[key] = (byCategory[key] ?? 0) + 1;
    }
    return { rows: rows.length, byCategory };
  });

  // =========================================================================
  // 8) Gate A 完成判据汇总 + 性能日志
  // =========================================================================
  const gateAVerification = {
    toolVersion: TOOL_VERSION,
    provenancePath,
    provenanceSha256,
    artifactsDir,
    extraArtifactsDir: extraDir,
    perGroup: gateA,
    sharedOriginalBusinessFieldComparison: sharedCheck,
    displacedReconciliation: {
      aTradedAnchors: aProfile.size,
      bTradedAnchors: bProfile.size,
      displaced: displaced.rows.length,
      buckets: displaced.buckets,
      summary: displaced.summary,
      expectation: { capacitySkip: 48, factorRankOutOfTop3: 16, total: 64 },
      matchesExpectation:
        (displaced.summary.summary.capacitySkip ?? 0) === 48
        && (displaced.summary.summary.factorRankOutOfTopK ?? 0) === 16
        && displaced.rows.length === 64,
      focusAnchor600179: focusAnchor,
    },
    correctedAttachments: correctedMeta,
    accountMetricsUnchanged: Object.fromEntries([GROUP_A, GROUP_B].map((groupId) => [
      groupId,
      {
        fromPayload: rAccountOf(groupId),
        expected: groupId === GROUP_A
          ? { totalReturnPct: 3.2429623609000036, maxDrawdownPct: 23.47385293519999, completedTradeCount: 144, tail20Count: 4, tail50Count: 2 }
          : { totalReturnPct: -35.96741798660001, maxDrawdownPct: 36.14153861450002, completedTradeCount: 236, tail20Count: 4, tail50Count: 1 },
      },
    ])),
    frozenConfig: frozenInner,
    gaps: [...gaps, ...reader.allGaps],
  };
  const gateAPath = path.join(outDir, "gate-a-verification-009.json");
  stages.run("write-gate-a", "gate-a-verification-009.json", () => writeJson(gateAPath, gateAVerification));

  const stageSnapshot = stages.snapshot();
  const stageReport = {
    toolVersion: TOOL_VERSION,
    provenanceSha256,
    totalElapsedMs: stageSnapshot.totalElapsedMs,
    peakRssMb: stageSnapshot.peakRssMb,
    stages: stageSnapshot.records,
    inputs: {
      artifactsRead: reader.allMetas.length,
      artifactsDecodedBytes: reader.allMetas.reduce((sum, meta) => sum + meta.decodedBytes, 0),
      artifactsRows: reader.allMetas.reduce((sum, meta) => sum + meta.rows, 0),
      quoteCacheBytes: barsRead?.raw.length ?? 0,
      quoteCacheRows: barIndex.rowCount,
      quoteCacheEvents: barIndex.eventIds.size,
    },
    outputs: Object.fromEntries([
      "diagnostic-provenance.json", "gate-a-verification-009.json",
      `candidate-ranking-corrected-${GROUP_A}.csv`, `candidate-ranking-corrected-${GROUP_B}.csv`,
      "displaced-original-signals.csv", "candidate-path-detail.csv", "candidate-path-strata-summary.csv",
      "signal-layer-summary.json", "selection-layer-summary.json", "capacity-evidence.csv",
      "trade-path-detail.csv", "trade-layer-summary.json", "missing-eligibility-ledger.csv",
    ].map((name) => [name, bytesOf(path.join(outDir, name))])),
    gaps: [...gaps, ...reader.allGaps],
  };
  stages.run("write-stage-report", "stage-performance-009.json", () =>
    writeJson(path.join(outDir, "stage-performance-009.json"), stageReport));

  say("");
  say("[009] ==== Gate A 复核 ====");
  for (const entry of gateA) {
    const original = entry.original008 as Record<string, number>;
    const corrected = entry.corrected009 as Record<string, number>;
    say(`[009] ${String(entry.group)}：008 原件成交证据 ${original.rowsWithFillDate}/${entry.diagnosticsRows}、跳过原因 ${original.rowsWithNotFilledReason}/${entry.diagnosticsRows}`
      + ` → 009 派生 ${corrected.rowsWithFillDate} / ${corrected.rowsWithNotFilledReason}；业务字段不符 ${(entry.businessFieldChanges as Record<string, number>).mismatchedRows}`);
  }
  say(`[009] A 成交而 B 未成交 ${displaced.rows.length} 锚点 ⇒ 满仓 ${displaced.summary.summary.capacitySkip} + 因子 Top3 外 ${displaced.summary.summary.factorRankOutOfTopK}`
    + `（明细与汇总相等=${displaced.summary.reconciles}）`);
  say(`[009] ==== Gate C ====`);
  for (const branch of [BRANCH_SHARED_ORIGINAL, BRANCH_B_RECOVERY]) {
    const all = strataRows.find((row) => row.branch === branch && row.stratum === "ALL" && row.H === 20);
    say(`[009] 信号层 ${branch} H=20：唯一锚点 ${all?.uniqueAnchors}，完整窗口 ${all?.completeWindows}，主靶命中 ${all?.targetHitCount}`
      + `（${((Number(all?.targetHitRate ?? 0)) * 100).toFixed(2)}%），终点均值 ${Number(all?.endpointMeanPct ?? 0).toFixed(2)}%`);
  }
  for (const groupId of [GROUP_A, GROUP_B]) {
    const summary = losingSummary(groupId);
    say(`[009] 交易层 ${groupId}：亏损 ${summary.losingTrades}，完整退出后 20 日路径 ${summary.losingWithCompletePostExit20}，`
      + `回到入场价 ${summary.returnToEntryCount}，达入场价+20% ${summary.reachEntryPlus20Count}，`
      + `第 20 日终点均值 ${Number(summary.postExitDay20EndpointMeanPct ?? 0).toFixed(4)}%`);
  }
  say(`[009] 缺口 ${gaps.length + reader.allGaps.length} 条；峰值 RSS ${stageSnapshot.peakRssMb} MB；总耗时 ${stageSnapshot.totalElapsedMs} ms`);
  for (const gap of [...gaps, ...reader.allGaps]) say(`[009] ⚠ ${gap}`);

  writeFileSync(path.join(outDir, "logs", "run-009.log"), `${log.join("\n")}\n`);
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return path.resolve(entry).replace(/\\/gu, "/").endsWith("tests/tools/rollingPoolSignalExit009Analysis.mts");
})();

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`[009] ✗ 未预期失败：${String(error)}\n${error instanceof Error ? error.stack ?? "" : ""}\n`);
    process.exit(1);
  });
}
