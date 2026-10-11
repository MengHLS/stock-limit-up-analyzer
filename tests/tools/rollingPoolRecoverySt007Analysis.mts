/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` · **只读**结果提取与 §7 问答分析。
 *
 * ```bash
 * node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolRecoverySt007Analysis.mts --run <RUN_ID> --out _scratch/fbp7
 * ```
 *
 * ## 它做什么
 *
 * 1. 经**既有平台端口**（`defaultExperimentRunService().readRunDetail` / `readArtifact`）读一条 Run 的
 *    信封 + 自有 `customPayload` + 全部产物原件（落到 `<out>/study-artifacts/`）；
 * 2. 用**同一份**产物计算目标 §7 的五个问题所需的读数（不重算策略、不改口径、不挑最优）；
 * 3. 写出 `<out>/analysis.json` 与 `<out>/analysis.md`。
 *
 * ## 🔴 纪律
 *
 * - **只读**：只调 `readRunDetail` / `readArtifact`。没有 `execute`、没有写库、没有 storage.put。
 * - **不发明口径**：所有数字直接来自 `customPayload`（平台信封）或产物 CSV 原件。
 * - **不静默降级**：缺列 / 缺文件 / 账不平 ⇒ 写进 `gaps[]`，**不用 0 冒充**。
 * - 这是**描述性**分析：本工具不做参数搜索、不挑种子、不改阈值。
 *
 * ## 🔴 `SORT-PARITY-008` §5：**按编码**读回（不是把扩展名改掉）
 *
 * 本轮起，达到 1 MiB 的 CSV 以**无损 gzip** 交付为 `.csv.gz`（`application/gzip`，真实二进制 body）。
 * 本工具因此：
 *   1. 读 `artifact-compression-index.csv`（本 Run 的**逻辑名 → 实际对象名 / 编码 / 原文 SHA-256** 索引），
 *      用它把逻辑名解析成真实对象名，而**不是**靠猜扩展名；
 *   2. 对 `gzip` 编码的对象先 `gunzipSync` **再**按 UTF-8 解析，并核对原文 SHA-256；
 *   3. 未出现在索引里的名字按「对象名 = 逻辑名」处理（= 旧普通 CSV 路径，完全兼容）。
 *   4. 只读交付字节，**不**把压缩字节当 UTF-8 字符串。
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { defaultExperimentRunService } from "../../server/researchExperiments/defaults";

/** 压缩索引的产物名（本 Run 自描述；见 `experiment.ts#packArtifactForDelivery`）。 */
const COMPRESSION_INDEX_NAME = "artifact-compression-index.csv";

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

const RUN_ID = argValue("--run");
const OUT_DIR = path.resolve(argValue("--out") ?? "_scratch/fbp7");
/**
 * 🔴 **离线模式**（`--payload` + `--artifacts-dir`）：当 Run 的**产物未能持久化**
 * （平台单文件 / 总量上限）时，仍可从**工具落盘的信封 JSON** + **本地产物目录**做同一份分析。
 *
 * 这条路径**不猜测**：产物目录里没有的文件一律记入 `gaps[]`。
 */
const PAYLOAD_FILE = argValue("--payload");
const ARTIFACTS_DIR = argValue("--artifacts-dir");
/** 产物来自哪一次 Run（离线模式下必须显式声明，否则会被误读成同一次 Run 的产物）。 */
const ARTIFACTS_FROM = argValue("--artifacts-from") ?? null;
/**
 * 报告标题里的轮次标签（缺省 `007`，保持历史调用不变）。
 *
 * 🔴 本工具的**口径**是 007 建立的只读归因口径；`--label` **只改标题**，
 *    不改任何读数、不改变判据 —— 避免把 008 的读数误标成 007 的结果。
 */
const ROUND_LABEL = argValue("--label") ?? "007";

if (RUN_ID === undefined && PAYLOAD_FILE === undefined) {
  process.stderr.write(
    "[007-analysis] 需要 --run <RUN_ID>（在线，经平台端口读）或 "
    + "--payload <study-run.json>（离线，读工具落盘的信封）\n",
  );
  process.exit(2);
}

const gaps: string[] = [];

// ---------------------------------------------------------------------------
// CSV 解析（最小、无依赖；产物里的字段不含换行）
// ---------------------------------------------------------------------------

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/gu, "\n").split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
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
  return { header: split(lines[0]!), rows: lines.slice(1).map(split) };
}

function toObjects(parsed: { header: string[]; rows: string[][] }): Record<string, string>[] {
  return parsed.rows.map((row) => {
    const record: Record<string, string> = {};
    parsed.header.forEach((key, index) => { record[key] = row[index] ?? ""; });
    return record;
  });
}

const numOf = (value: string | undefined): number | null => {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * **R 账户跨 Run 一致性核对**：用产物 CSV（可能是另一次 Run 的 R 产物）与本次 payload 的
 * R 账户指标逐项比对。任一项不一致 ⇒ `consistent = false`（该替代**不成立**，不得据此下结论）。
 */
function rAccountCrossCheck(
  tables: ReadonlyMap<string, Record<string, string>[]>,
  groupReads: readonly Record<string, any>[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const group of groupReads) {
    const groupId = String(group.group);
    const rows = tables.get(`trades-R-${groupId}.csv`);
    const equity = tables.get(`equity-R-${groupId}.csv`);
    if (rows === undefined || equity === undefined) {
      out.push({ group: groupId, consistent: null, note: "缺 trades-R / equity-R 产物 ⇒ 无法核对" });
      continue;
    }
    const completed = rows.filter((row) => (row.openAtEnd ?? "") !== "true");
    const tradeCount = rows.length;
    const lastEquity = numOf(equity.at(-1)?.equity);
    const payloadR = group.r as Record<string, unknown> | null;
    /**
     * 🔴 `uniqueAnchorCount` / `uniqueSecurityCount` 是 `AccountMetrics` 的**意图口径**
     *    （R 账户 `plan.intentsByDate` 覆盖的唯一锚点/证券），产物 CSV 无法一一复算：
     *    引擎层被拒的订单不写进 `skipped`，而产物里只有 `trades` / `skipped` / 拒单审计。
     *    ⇒ 这两项**只作信息**（`informational`），**不参与**一致性判定；
     *      判定只依赖可逐项对齐的 5 项（含由期末权益反推的总收益）。
     */
    const diagnostics = tables.get(`candidate-ranking-diagnostics-${groupId}.csv`) ?? [];
    const rSelectedAnchors = new Set(
      diagnostics.filter((row) => (row.selectedByR ?? "").toLowerCase() === "true")
        .map((row) => row.anchorEventId ?? ""),
    );
    const derivedTotalReturnPct = lastEquity === null ? null : (lastEquity / 100_000 - 1) * 100;
    const reentryFromArtifacts = rows.filter((row) => Number(row.entryOrdinal ?? "0") >= 2).length;
    const eq = (left: number | null, right: unknown): boolean =>
      left === null || typeof right !== "number" ? left === right : Math.abs(left - right) < 1e-6;
    const checks = {
      tradeCount: { artifacts: tradeCount, payload: payloadR?.tradeCount ?? null },
      completedTradeCount: { artifacts: completed.length, payload: payloadR?.completedTradeCount ?? null },
      openAtEndCount: {
        artifacts: rows.filter((row) => (row.openAtEnd ?? "") === "true").length,
        payload: payloadR?.openAtEndCount ?? null,
      },
      reentryEntryCount: { artifacts: reentryFromArtifacts, payload: payloadR?.reentryEntryCount ?? null },
      /** 由产物期末权益反推的总收益必须等于 payload 的总收益（最强的一致性判据）。 */
      derivedTotalReturnPct: { artifacts: derivedTotalReturnPct, payload: payloadR?.totalReturnPct ?? null },
    };
    const informational = {
      /** 产物里实际成交过的唯一锚点数（≠ payload 的意图口径，见上）。 */
      tradedAnchors: new Set(rows.map((row) => row.anchorEventId)).size,
      rSelectedCandidateAnchors: rSelectedAnchors.size,
      payloadIntentAnchors: payloadR?.uniqueAnchorCount ?? null,
      payloadIntentSecurities: payloadR?.uniqueSecurityCount ?? null,
    };
    const mismatches = Object.entries(checks)
      .filter(([key, value]) =>
        key === "derivedTotalReturnPct"
          ? !eq(value.artifacts as number | null, value.payload)
          : value.artifacts !== value.payload)
      .map(([key]) => key);
    out.push({
      group: groupId,
      consistent: mismatches.length === 0,
      mismatches,
      checks,
      informational,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 统计小工具
// ---------------------------------------------------------------------------

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantileOf(sortedValues: readonly number[], q: number): number | null {
  if (sortedValues.length === 0) return null;
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower]!;
  return sortedValues[lower]! + (sortedValues[upper]! - sortedValues[lower]!) * (position - lower);
}

function tailStatsOf(values: readonly number[]): Record<string, number | null> {
  const sorted = [...values].sort((left, right) => left - right);
  const rate = (threshold: number): number | null =>
    values.length === 0 ? null : values.filter((value) => value >= threshold).length / values.length;
  return {
    count: values.length,
    mean: meanOf(values),
    median: quantileOf(sorted, 0.5),
    q05: quantileOf(sorted, 0.05),
    q25: quantileOf(sorted, 0.25),
    q75: quantileOf(sorted, 0.75),
    q95: quantileOf(sorted, 0.95),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    rate20: rate(20),
    rate50: rate(50),
    rate100: rate(100),
    leftRateMinus20: values.length === 0 ? null : values.filter((value) => value <= -20).length / values.length,
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const service = defaultExperimentRunService();
  let record: Record<string, any>;
  let payload: Record<string, unknown> | null;
  const artifactDir = path.join(OUT_DIR, "study-artifacts");
  const artifactNames: string[] = [];
  const tables = new Map<string, Record<string, string>[]>();

  /**
   * 本分析**只**需要这几类产物；其余（尤其 `observation-repair-ledger-*`，单文件可达 ~100 MB）
   * **不载入**，只登记名字与大小 —— 否则会把 373 MB CSV 全部读进内存（实测触发 V8 fatal）。
   * 🔴 「未载入」与「不存在」必须区分：前者写进 `skippedArtifacts`，后者写进 `gaps`。
   */
  const NEEDED = [
    /^trades-R-.+\.csv$/u,
    /^equity-R-.+\.csv$/u,
    /^anchor-trade-chains\.csv$/u,
    /^candidate-ranking-diagnostics-.+\.csv$/u,
  ];
  const skippedArtifacts: string[] = [];
  /** 压缩索引：实际对象名 → 逻辑名 / 编码 / 原文 SHA-256（`SORT-PARITY-008` §5）。 */
  const objectToLogical = new Map<string, { logicalName: string; encoding: string; originalSha256: string }>();
  const registerObject = (objectName: string, logicalName: string, encoding: string, originalSha256 = ""): void => {
    objectToLogical.set(objectName, { logicalName, encoding, originalSha256 });
  };
  /** 未在索引里出现的对象：按「逻辑名 = 对象名去掉 `.gz`」解析（旧普通 CSV 路径不变）。 */
  const logicalNameOf = (objectName: string): string =>
    objectToLogical.get(objectName)?.logicalName ?? objectName.replace(/\.gz$/u, "");

  /** 交付字节与原文完全相同 ⇒ 该件实际上没有压缩（如实记录，不当成通过）。 */
  const gapNoPlainTextCompression: string[] = [];

  /**
   * 🔴 **按编码读回**：gzip 对象先解压再按 UTF-8 解析；非 gzip 对象按原样解析。
   * 返回 `null` = 解压失败（记 `gaps`，绝不把压缩字节当字符串）。
   */
  const readByEncoding = (
    objectName: string,
    bytes: Buffer,
  ): { readonly text: string; readonly originalSha256: string | null } | null => {
    if (!objectName.endsWith(".gz")) return { text: bytes.toString("utf8"), originalSha256: null };
    try {
      const restored = gunzipSync(bytes);
      const sha = createHash("sha256").update(restored).digest("hex");
      const expected = objectToLogical.get(objectName)?.originalSha256 ?? "";
      if (expected !== "" && expected !== sha) {
        gaps.push(`解压哈希不一致：${objectName} 索引=${expected.slice(0, 16)}… 实际=${sha.slice(0, 16)}…`);
      }
      if (bytes.equals(restored)) gapNoPlainTextCompression.push(objectName);
      return { text: restored.toString("utf8"), originalSha256: sha };
    } catch (error) {
      gaps.push(`解压失败 ${objectName}：${String(error)}`);
      return null;
    }
  };

  /**
   * 登记并（按需）载入一件产物；`label` 只用于区分来源。
   * 只有当**逻辑名**命中 `NEEDED` 时才真正解析进 `tables`。
   */
  const consumeArtifact = (objectName: string, bytes: Buffer, label: string): void => {
    const logicalName = logicalNameOf(objectName);
    if (!NEEDED.some((pattern) => pattern.test(logicalName))) {
      skippedArtifacts.push(`${label}${objectName}`);
      artifactNames.push(`${label}${objectName}`);
      return;
    }
    const decoded = readByEncoding(objectName, bytes);
    artifactNames.push(`${label}${objectName}${objectName === logicalName ? "" : ` → ${logicalName}`}`);
    if (decoded === null) return;
    // 🔴 CSV 一律按**逻辑名**入表：消费方不必知道本轮到底压没压。
    tables.set(logicalName, toObjects(parseCsv(decoded.text)));
  };

  /** 读一个本地产物目录（离线模式 / 备用来源）。 */
  const loadLocalArtifacts = (dir: string, label: string): void => {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".csv") || name.endsWith(".csv.gz"));
    /** ① 先读压缩索引（顺序确定性：不依赖目录返回顺序）。 */
    if (files.includes(COMPRESSION_INDEX_NAME)) {
      const bytes = readFileSync(path.join(dir, COMPRESSION_INDEX_NAME));
      for (const row of toObjects(parseCsv(bytes.toString("utf8")))) {
        registerObject(row.objectName ?? "", row.logicalName ?? "", row.encoding ?? "", row.originalSha256 ?? "");
      }
      artifactNames.push(`${label}${COMPRESSION_INDEX_NAME}`);
    }
    /** ② 再逐件按编码读回。 */
    for (const name of files) {
      if (name === COMPRESSION_INDEX_NAME) continue;
      consumeArtifact(name, readFileSync(path.join(dir, name)), label);
    }
    for (const name of gapNoPlainTextCompression) {
      gaps.push(`声称为 gzip 但交付字节与原文相同（没有真正压缩）：${name}`);
    }
  };

  if (PAYLOAD_FILE !== undefined) {
    // ---- 离线模式：从工具落盘的信封读（**产物未能持久化时仍可分析**）----
    const envelope = JSON.parse(readFileSync(PAYLOAD_FILE, "utf8")) as Record<string, any>;
    record = envelope.run ?? { runId: "(offline)", experimentId: envelope.experimentId ?? null };
    payload = (envelope.customPayload ?? null) as Record<string, unknown> | null;
    artifactNames.push(`payload:${path.basename(PAYLOAD_FILE)}`);
    if (ARTIFACTS_DIR !== undefined) {
      loadLocalArtifacts(ARTIFACTS_DIR, `[${ARTIFACTS_FROM ?? "artifacts"}] `);
      if (ARTIFACTS_FROM === null) {
        gaps.push("离线模式提供了 --artifacts-dir 但未声明 --artifacts-from ⇒ 无法判断产物属于哪次 Run");
      }
    } else {
      gaps.push("离线模式未提供 --artifacts-dir ⇒ 无逐锚点产物（Q1 只能给聚合口径）");
    }
  } else {
    const detail = await service.readRunDetail(RUN_ID!);
    record = detail.run as unknown as Record<string, any>;
    payload = (detail.result?.customPayload ?? null) as Record<string, unknown> | null;
    if (detail.artifactsError !== null) {
      gaps.push(`产物告警 ${detail.artifactsError.code}：${detail.artifactsError.message}`);
    }
    mkdirSync(artifactDir, { recursive: true });
    /** ① 先把**压缩索引**读出来（它自身是未压缩的普通 CSV）：逻辑名 → 实际对象名 / 编码 / 原文 SHA-256。 */
    for (const item of detail.artifacts) {
      const objectName = item.ref.key.split("/").pop() ?? item.ref.key;
      if (objectName !== COMPRESSION_INDEX_NAME) continue;
      if (!item.present) { gaps.push(`压缩索引不在存储里：${item.ref.key}`); continue; }
      try {
        const got = await service.readArtifact(RUN_ID!, item.ref.key);
        for (const row of toObjects(parseCsv(got.body.toString("utf8")))) {
          registerObject(row.objectName ?? "", row.logicalName ?? "", row.encoding ?? "", row.originalSha256 ?? "");
        }
        artifactNames.push(objectName);
      } catch (error) {
        gaps.push(`读压缩索引失败 ${item.ref.key}：${String(error)}`);
      }
    }
    /** ② 逐产物**按编码**读回（`gzip` 先解压；CSV 按逻辑名入表）。 */
    for (const item of detail.artifacts) {
      if (!item.present) { gaps.push(`产物缺失（存储里读不到）：${item.ref.key}`); continue; }
      const name = item.ref.key.split("/").pop() ?? item.ref.key;
      if (name === COMPRESSION_INDEX_NAME) continue;
      try {
        const got = await service.readArtifact(RUN_ID!, item.ref.key);
        writeFileSync(path.join(artifactDir, name), got.body);
        consumeArtifact(name, got.body, "");
      } catch (error) {
        gaps.push(`读产物失败 ${item.ref.key}：${String(error)}`);
      }
    }
    for (const name of gapNoPlainTextCompression) {
      gaps.push(`声称为 gzip 但交付字节与原文相同（没有真正压缩）：${name}`);
    }
  }

  if (payload === null) {
    process.stderr.write("[007-analysis] 没有 customPayload ⇒ 无法分析（不猜测）。\n");
    process.exit(1);
  }

  // ---- ② payload 面 ----
  const groups = (payload.groups ?? []) as Record<string, unknown>[];
  const policy = (payload.stEligibilityPolicy ?? null) as Record<string, unknown> | null;
  const primary = (payload.primaryComparison ?? null) as Record<string, unknown> | null;
  const sampleSummary = (payload.sampleSummary ?? null) as Record<string, unknown> | null;
  const frozen = (payload.frozenConfig ?? null) as Record<string, unknown> | null;

  const groupReads = groups.map((group) => {
    const groupId = String(group.group);
    const accounts = (group.accounts ?? []) as Record<string, unknown>[];
    const r = accounts.find((account) => account.kind === "R") ?? null;
    const randoms = accounts.filter((account) => account.kind === "RANDOM");
    const randomReturns = randoms
      .map((account) => numOf(String(account.totalReturnPct ?? "")))
      .filter((value): value is number => value !== null);
    const randomMdd = randoms
      .map((account) => numOf(String(account.maxDrawdownPct ?? "")))
      .filter((value): value is number => value !== null);
    const rReturn = r === null ? null : numOf(String(r.totalReturnPct ?? ""));
    const rMdd = r === null ? null : numOf(String(r.maxDrawdownPct ?? ""));
    const better = rReturn === null ? null : randomReturns.filter((value) => value < rReturn).length;
    return {
      group: groupId,
      decisionDays: group.decisionDateCount,
      candidateRows: group.candidateRowCount,
      breachedAnchors: group.breachedAnchorCount,
      recoverySignals: group.recoverySignalCount,
      r: r === null ? null : {
        totalReturnPct: rReturn,
        maxDrawdownPct: rMdd,
        tradeCount: r.tradeCount,
        completedTradeCount: r.completedTradeCount,
        openAtEndCount: r.openAtEndCount,
        fillCount: r.fillCount,
        rejectedOrderCount: r.rejectedOrderCount,
        skippedIntentCount: r.skippedIntentCount,
        uniqueAnchorCount: r.uniqueAnchorCount,
        uniqueSecurityCount: r.uniqueSecurityCount,
        reentryEntryCount: r.reentryEntryCount,
        winRatePct: r.winRatePct,
        profitFactor: r.profitFactor,
        tail20Count: r.tail20Count,
        tail50Count: r.tail50Count,
        tail100Count: r.tail100Count,
        finalCashSharePct: r.finalCashSharePct,
        averageHoldingPeriod: r.averageHoldingPeriod,
      },
      random: {
        accountCount: randoms.length,
        returnStats: tailStatsOf(randomReturns),
        mddStats: tailStatsOf(randomMdd),
        /** R 严格优于多少个 Random（位置，不是显著性）。 */
        rBetterThanRandomCount: better,
        rReturnPercentileAmongRandom: rReturn === null || randomReturns.length === 0
          ? null
          : randomReturns.filter((value) => value <= rReturn).length / randomReturns.length,
      },
      rTail: group.rTail,
      randomPooledTail: group.randomPooledTail,
      coverage: group.coverage,
      perYear: group.perYear,
      adverseExcursion: group.adverseExcursion,
    };
  });

  // ---- ③ 锚点级：B 相对 A 多捕获的锚点与新增修复交易 ----
  const rTradesByGroup = new Map<string, Record<string, string>[]>();
  for (const [name, rows] of tables) {
    const match = /^trades-R-(.+)\.csv$/u.exec(name);
    if (match !== null) rTradesByGroup.set(match[1]!, rows);
  }
  const branchByCandidate = new Map<string, string>();
  for (const [name, rows] of tables) {
    /**
     * 🔴 产物名是**逐组**的：`candidate-ranking-diagnostics-{group}.csv`
     *    （不是单个文件）—— 按名解析，缺文件即记缺口，不猜。
     */
    if (!/^candidate-ranking-diagnostics-.+\.csv$/u.test(name)) continue;
    for (const row of rows) {
      const group = row.group ?? "";
      const anchor = row.anchorEventId ?? "";
      const confirmRd = row.confirmRd ?? "";
      const branch = row.branch ?? "";
      if (group && anchor) branchByCandidate.set(`${group}\u0000${anchor}\u0000${confirmRd}`, branch);
    }
  }
  if (branchByCandidate.size === 0) {
    gaps.push("未读到任何 candidate-ranking-diagnostics-{group}.csv ⇒ 无法判定 B 独有锚点是否走修复分支");
  }
  const completedAnchorsByGroup = new Map<string, Set<string>>();
  const completedReturnsByGroup = new Map<string, number[]>();
  for (const [groupId, rows] of rTradesByGroup) {
    const anchors = new Set<string>();
    const returns: number[] = [];
    for (const row of rows) {
      if ((row.openAtEnd ?? "") === "true") continue;
      const ret = numOf(row.returnPct);
      if (ret === null) continue;
      anchors.add(row.anchorEventId ?? "");
      returns.push(ret);
    }
    completedAnchorsByGroup.set(groupId, anchors);
    completedReturnsByGroup.set(groupId, returns);
  }
  const aAnchors = completedAnchorsByGroup.get("A_STRICT_20") ?? new Set<string>();
  const bAnchors = completedAnchorsByGroup.get("B_RECOVERY_20") ?? new Set<string>();
  const bOnlyAnchors = [...bAnchors].filter((anchor) => !aAnchors.has(anchor));
  /** B 组**走修复分支**的锚点（预计算成集合，避免逐锚点扫全表）。 */
  const bRecoveryBranchAnchors = new Set<string>();
  for (const [key, branch] of branchByCandidate) {
    if (!key.startsWith("B_RECOVERY_20\u0000")) continue;
    if (branch !== "RECOVERY") continue;
    bRecoveryBranchAnchors.add(key.split("\u0000")[1]!);
  }
  const bOnlyReturns: number[] = [];
  const bOnlyRecoveryBranchAnchors: string[] = [];
  const bOnlySet = new Set(bOnlyAnchors);
  for (const row of rTradesByGroup.get("B_RECOVERY_20") ?? []) {
    const anchor = row.anchorEventId ?? "";
    if (!bOnlySet.has(anchor)) continue;
    const ret = numOf(row.returnPct);
    if (ret !== null && (row.openAtEnd ?? "") !== "true") bOnlyReturns.push(ret);
  }
  for (const anchor of bOnlyAnchors) {
    if (bRecoveryBranchAnchors.has(anchor)) bOnlyRecoveryBranchAnchors.push(anchor);
  }

  const anchorTradeChainNetByGroup = new Map<string, Map<string, number>>();
  for (const row of tables.get("anchor-trade-chains.csv") ?? []) {
    if ((row.account ?? "") !== "R") continue;
    const groupId = row.group ?? "";
    const map = anchorTradeChainNetByGroup.get(groupId) ?? new Map<string, number>();
    map.set(row.anchorEventId ?? "", (map.get(row.anchorEventId) ?? 0) + (numOf(row.chainNetPnl) ?? 0));
    anchorTradeChainNetByGroup.set(groupId, map);
  }

  // ---- ④ 逐年 ----
  const perYear = groupReads.map((group) => ({ group: group.group, perYear: group.perYear }));

  const analysis = {
    runId: record.runId ?? RUN_ID ?? "(offline)",
    runStatus: (record as Record<string, any>).summary?.runStatus ?? null,
    /**
     * 🔴 `runStatus`（**计算**）与 `recordStatus`（**持久化后的 Run 记录**）可能不同：
     *    平台在产物写入失败时把 Run 记为 FAILED，即使实验本体已经 `SUCCEEDED`。
     *    两者都如实记录，不做平均、不做择优。
     */
    recordStatus: (record as Record<string, any>).status ?? null,
    recordErrorCode: (record as Record<string, any>).errorCode ?? null,
    recordErrorMessage: (record as Record<string, any>).errorMessage ?? null,
    experimentId: record.experimentId ?? null,
    experimentVersion: record.experimentVersion ?? null,
    parameters: record.parameters ?? null,
    createdAt: record.createdAt ?? null,
    durationMs: record.durationMs ?? null,
    artifactsFrom: ARTIFACTS_FROM,
    terminalState: payload.terminalState ?? null,
    status: payload.status ?? null,
    matrixEmitted: payload.matrixEmitted === true,
    frozenConfig: frozen,
    sampleAccounting: sampleSummary,
    stEligibilityPolicy: policy,
    primaryComparison: primary,
    groups: groupReads,
    perYear,
    artifactNames,
    /** 🔴 「存在但未载入」（与缺口不同）：本分析不需要的产物（含超大逐日账）。 */
    skippedArtifacts,
    /**
     * R 账户在 `SMOKE` 与 `STUDY` 下**必须相同**：R 计划是 `plans[0]`，
     * 只由 `cells.slice(0, DAILY_TOP_K)` 决定，**与 `randomAccountCount` 无关**，
     * 且账户配置逐字节相同（实验中已断言 `configSnapshotJson` 跨账户一致）。
     * 因此当 STUDY 产物未能持久化时，可用 SMOKE 的 R 产物回答逐锚点问题 ——
     * 但**必须**用本字段交叉核对（一旦不一致，该替代不成立）。
     */
    rAccountCrossCheck: rAccountCrossCheck(tables, groupReads),
    /** §7 问题 1：B 相对 A 多捕获的锚点 + 新增修复交易的右尾 / 均值 / 左尾。 */
    question1: {
      aCompletedAnchors: aAnchors.size,
      bCompletedAnchors: bAnchors.size,
      bOnlyCompletedAnchors: bOnlyAnchors.length,
      bOnlyAnchorsWithRecoveryBranchCandidate: bOnlyRecoveryBranchAnchors.length,
      bOnlyCompletedTradeCount: bOnlyReturns.length,
      bOnlyReturnStats: tailStatsOf(bOnlyReturns),
      aCompletedReturnStats: tailStatsOf(completedReturnsByGroup.get("A_STRICT_20") ?? []),
      bCompletedReturnStats: tailStatsOf(completedReturnsByGroup.get("B_RECOVERY_20") ?? []),
      /**
       * 🔴 口径说明：本节是**账户 R** 上的描述性对照，**不是**主靶。
       *    主靶分母 = 两组共有且数据资格可核实的锚点宇宙（见 primaryComparison）。
       */
      note:
        "本节为 R 账户上的描述性对照（B 独有已完成锚点及其修复交易画像）；"
        + "主靶口径（共同可核实锚点宇宙上的 ≥+20% 唯一锚点覆盖率差）见 primaryComparison。",
    },
    /** §7 问题 2：主靶 + 配对日期块 bootstrap（**直接取自 payload，不重算**）。 */
    question2: primary,
    /** §7 问题 4：账户 / 成交 / 容量 / 年度。 */
    question4: {
      rAccounts: groupReads.map((group) => ({ group: group.group, r: group.r })),
      anchorChainNetPnlSumByGroup: Object.fromEntries(
        [...anchorTradeChainNetByGroup.entries()].map(([groupId, map]) => [
          groupId,
          { anchors: map.size, sum: [...map.values()].reduce((sum, value) => sum + value, 0) },
        ]),
      ),
    },
    /** §7 问题 5：轻量 ST 检查的来源覆盖与政策描述（**不是优化目标**）。 */
    question5: policy,
    /** Runner 贡献不可观测 ⇒ 明确未测（本实验没有退出消融）。 */
    runnerContribution: "UNMEASURED：本实验没有退出消融（ablation）⇒ Runner（3600005 / T74）的因果贡献**不可观测**，未测。",
    gaps,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "analysis.json"), JSON.stringify(analysis, null, 2));
  writeFileSync(path.join(OUT_DIR, "analysis.md"), buildMarkdown(analysis));
  process.stdout.write(
    `[007-analysis] run=${String(analysis.runId)} 产物 ${artifactNames.length} 个`
    + `（载入 ${tables.size} / 按需跳过 ${skippedArtifacts.length}）；analysis.json + analysis.md 已写出\n`
    + `  终态 ${String(payload.terminalState ?? "?")}／${String(payload.status ?? "?")}；`
    + `B 独有已完成锚点 ${bOnlyAnchors.length}；缺口 ${gaps.length}\n`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Markdown 渲染（只搬运已算好的数字，不做任何再判断）
// ---------------------------------------------------------------------------

function cell(value: unknown): string {
  return String(value ?? "").replace(/\|/gu, "\\|");
}

function table(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [
    `| ${header.map(cell).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown(analysis: Record<string, unknown>): string {
  const lines: string[] = [];
  const q1 = analysis.question1 as Record<string, unknown>;
  const q4 = analysis.question4 as Record<string, unknown>;
  const groups = analysis.groups as Record<string, any>[];
  const primary = analysis.primaryComparison as Record<string, any> | null;
  const policy = analysis.stEligibilityPolicy as Record<string, any> | null;
  const stats = (value: unknown): string =>
    value === null || value === undefined
      ? "—"
      : `n=${(value as Record<string, unknown>).count} mean=${(value as Record<string, number>).mean?.toFixed?.(4) ?? "—"} `
        + `median=${(value as Record<string, number>).median?.toFixed?.(4) ?? "—"} `
        + `q05=${(value as Record<string, number>).q05?.toFixed?.(4) ?? "—"} `
        + `q95=${(value as Record<string, number>).q95?.toFixed?.(4) ?? "—"} `
        + `≥20%=${(value as Record<string, number>).rate20?.toFixed?.(4) ?? "—"}`;

  lines.push(`# ${ROUND_LABEL} 结果提取（只读）· ${analysis.runId}`);
  lines.push("");
  lines.push(`- 终态：\`${String(analysis.terminalState ?? "?")}\` / status=\`${String(analysis.status ?? "?")}\``
    + `｜matrixEmitted=${String(analysis.matrixEmitted)}｜耗时 ${String(analysis.durationMs ?? "?")} ms`);
  lines.push(`- 参数：\`${JSON.stringify(analysis.parameters)}\``);
  lines.push("");
  lines.push("## §7 问题 2 · 主靶（直接取自 payload，未重算）");
  lines.push("");
  if (primary === null) lines.push("_（无）_");
  else {
    const difference = primary.difference as Record<string, any>;
    lines.push(table(
      ["口径", "点估计", "95% 下界", "95% 上界", "簇数", "零分母迭代"],
      [
        ["block20 主", difference.pointEstimate, difference.blockPrimary?.low, difference.blockPrimary?.high, difference.blockPrimary?.clusterCount, difference.blockPrimary?.zeroDenominatorIterations],
        ["block40 敏感性", difference.pointEstimate, difference.blockSensitivity?.low, difference.blockSensitivity?.high, difference.blockSensitivity?.clusterCount, difference.blockSensitivity?.zeroDenominatorIterations],
        ["block20 均值差", difference.pointEstimate, difference.meanPrimary?.low, difference.meanPrimary?.high, difference.meanPrimary?.clusterCount, difference.meanPrimary?.zeroDenominatorIterations],
      ],
    ));
    lines.push("");
    lines.push(`- sampleGateMet=${String(primary.sampleGateMet)}；supported=${String(primary.supported)}`);
    lines.push(`- ${String(primary.gateReason)}`);
    lines.push(`- ${String(primary.note)}`);
  }
  lines.push("");
  lines.push("## §7 问题 3 / 4 · 逐组 R vs 20 Random");
  lines.push("");
  lines.push(table(
    ["组", "R 总收益%", "R MDD%", "R 成交", "R 锚点", "R 股票", "R 再入场", "Random 均值%", "Random 中位%", "Random 最好%", "Random 最差%", "R 优于几个", "R 分位"],
    groups.map((group) => [
      group.group,
      group.r?.totalReturnPct,
      group.r?.maxDrawdownPct,
      group.r?.fillCount,
      group.r?.uniqueAnchorCount,
      group.r?.uniqueSecurityCount,
      group.r?.reentryEntryCount,
      group.random.returnStats.mean,
      group.random.returnStats.median,
      group.random.returnStats.max,
      group.random.returnStats.min,
      group.random.rBetterThanRandomCount,
      group.random.rReturnPercentileAmongRandom,
    ]),
  ));
  lines.push("");
  lines.push("## §7 问题 1 · B 独有已完成锚点（R 账户，描述性）");
  lines.push("");
  lines.push(table(
    ["A 已完成锚点", "B 已完成锚点", "B 独有锚点", "其中走修复分支候选", "B 独有已完成交易", "B 独有收益画像"],
    [[q1.aCompletedAnchors, q1.bCompletedAnchors, q1.bOnlyCompletedAnchors, q1.bOnlyAnchorsWithRecoveryBranchCandidate, q1.bOnlyCompletedTradeCount, stats(q1.bOnlyReturnStats)]],
  ));
  lines.push("");
  lines.push(`- A 已完成收益画像：${stats(q1.aCompletedReturnStats)}`);
  lines.push(`- B 已完成收益画像：${stats(q1.bCompletedReturnStats)}`);
  lines.push(`- ${String(q1.note)}`);
  lines.push("");
  lines.push("## §7 问题 4 · 锚点整链净损益（R 账户）");
  lines.push("");
  lines.push(table(
    ["组", "锚点数", "整链净损益合计"],
    Object.entries((q4.anchorChainNetPnlSumByGroup ?? {}) as Record<string, any>)
      .map(([groupId, value]) => [groupId, value.anchors, value.sum]),
  ));
  lines.push("");
  lines.push("## §7 问题 5 · 轻量 ST 检查（来源覆盖与政策描述）");
  lines.push("");
  if (policy === null) lines.push("_（严格模式：不适用）_");
  else {
    lines.push(table(
      ["政策", "版本", "读取来源行", "已知ST 排除候选", "已知ST 拒单(订单)", "UNKNOWN 参与候选", "UNKNOWN 成交(订单)", "UNKNOWN 拒单(订单)", "终态"],
      [[
        policy.policyId, policy.policyVersion, policy.counts?.labelRowsRead,
        policy.counts?.knownStExcludedCandidates, policy.counts?.matchingOrders?.knownStRejectedOrders,
        (Object.values((policy.counts?.participatingUnknownByGroup ?? {}) as Record<string, number>))
          .reduce((sum, value) => sum + value, 0),
        policy.counts?.matchingOrders?.unknownFilledOrders,
        policy.counts?.matchingOrders?.unknownRejectedOrders,
        policy.terminalState,
      ]],
    ));
    lines.push("");
    lines.push(`- 严格 PIT 视角证据：\`${JSON.stringify(policy.strictPitEvidence)}\``);
    lines.push(`- 未知放行说明：${String(policy.unknownAllowedThisRoundNote ?? "—")}`);
  }
  lines.push("");
  lines.push("## 逐年（同靶 + 账户年度收益）");
  lines.push("");
  lines.push(table(
    ["组", "年", "共同宇宙锚点", "≥+20% 命中锚点", "覆盖率", "R 年度收益%"],
    (analysis.perYear as any[]).flatMap((entry) =>
      (entry.perYear as any[]).map((row) => [
        entry.group, row.year, row.universeAnchorCount, row.hitAnchorCount, row.coverage, row.rTotalReturnPct,
      ]),
    ),
  ));
  lines.push("");
  lines.push(`## Runner 贡献：${String(analysis.runnerContribution)}`);
  lines.push("");
  lines.push("## R 账户跨 Run 一致性核对（产物 CSV vs 本次 payload 指标）");
  lines.push("");
  lines.push(table(
    ["组", "一致?", "不一致项", "逐项（产物 vs payload）", "信息项（口径不同，不参与判定）"],
    ((analysis.rAccountCrossCheck ?? []) as Record<string, any>[]).map((entry) => [
      entry.group,
      entry.consistent,
      (entry.mismatches ?? []).join(" "),
      JSON.stringify(entry.checks ?? entry.note),
      JSON.stringify(entry.informational ?? {}),
    ]),
  ));
  lines.push("");
  lines.push(`- 产物来源：\`${String(analysis.artifactsFrom ?? "(同一次 Run)")}\``);
  lines.push(`- 计算 runStatus=\`${String(analysis.runStatus ?? "?")}\`｜持久化 Run 记录=\`${String(analysis.recordStatus ?? "?")}\``
    + `｜errorCode=\`${String(analysis.recordErrorCode ?? "—")}\``);
  if (analysis.recordErrorMessage !== null && analysis.recordErrorMessage !== undefined) {
    lines.push(`- 记录错误：${String(analysis.recordErrorMessage)}`);
  }
  lines.push("");
  if ((analysis.gaps as string[]).length > 0) {
    lines.push("## 缺口（未静默降级）");
    lines.push("");
    for (const gap of analysis.gaps as string[]) lines.push(`- ⚠️ ${gap}`);
  }
  return `${lines.join("\n")}\n`;
}

main().catch((error: unknown) => {
  process.stderr.write(`[007-analysis] ✗ 未预期失败：${String(error)}\n`);
  process.exit(1);
});
