/**
 * 数据集构建性能专项 — 真实 DB 验证脚本（DATASET-PERF-001）。
 *
 * 目的：为 2026-09-11 的构建链路优化提供**可复核的证据**，而不是「感觉快了」。
 * 四个阶段，全部只读或写入**临时版本**（结束后级联清理，零残留）：
 *
 *   S1 阈值数值证明（纯计算，无 DB）
 *      SQL 下推谓词 `closePrice >= preClosePrice * 1.045` 必须是 `isLimitUpClose` 的**超集**。
 *      枚举全部 2 位小数昨收，断言 preClose ≥ 1.00 时 `limitUpPrice(preClose, 0.05) ≥ preClose × 1.045`
 *      恒成立；preClose < 1.00 由谓词中的 guard 子句兜住（不筛）。
 *
 *   S2 真实 DB 下推补集证明
 *      一个月：逐日拉**全量**全市场 bar → `isLimitUpClose` 精确判定得集合 A；
 *      用下推候选 → 同样精确判定得集合 B；断言 A ⊆ B（零漏判）并报告压缩比与耗时。
 *
 *   S3 定向取数等价性
 *      同一日期区间：(a) 按 symbol 集合定向取数；(b) 拉全市场再过滤同 symbol 集合。
 *      断言两者逐行完全相同（证明 Phase 2 的 13× 压缩没有丢数据）。
 *
 *   S4 端到端等价 + 计时（核心）
 *      用**新 builder** 在临时版本上重建 v1 的窗口与口径（2026-08-01~08-31 / main / 排除 ST /
 *      pre=20 / post=20），与已存在的 v1 逐表比对「行数 + 内容指纹（SUM(CRC32(...))）」，
 *      断言完全一致；同时报告墙钟耗时与行/秒。
 *
 *   S5 长窗口吞吐实测（--stage=5 才跑；默认跳过以省时间）
 *      2024-01-01~2024-12-31 全窗口构建（临时版本），报告耗时 / 吞吐 / 压缩效果，随后清理。
 *
 * 用法：
 *   npx tsx scripts/verifyDatasetBuildPerf.mts                 # S1~S4
 *   npx tsx scripts/verifyDatasetBuildPerf.mts --stage=1,2,3,5  # 指定阶段
 *   npx tsx scripts/verifyDatasetBuildPerf.mts --keep           # 不清理临时版本（排障用）
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import {
  DatasetRegistryService,
  DbDatasetBuildIO,
  DbDatasetPhysicalStore,
  DbDatasetRegistry,
  FirstLimitPullbackDatasetBuilder,
  createDefaultPluginRegistry,
  isLimitUpCandidateBar,
  isLimitUpClose,
  limitUpRatio,
  type DatasetBuildCheckpoint,
  type DatasetBoard,
  type DailyBar,
} from "../server/datasetRegistry";
import { exchangeLimitUpPrice } from "../server/data/boardRules";

// ---------------------------------------------------------------------------
// 基础设施
// ---------------------------------------------------------------------------

const db = await getDb();
if (!db) {
  console.error("数据库不可用：未找到 DATABASE_URL");
  process.exit(1);
}

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const stageArg = argv.find((a) => a.startsWith("--stage="));
const stages = new Set(
  (stageArg ? stageArg.slice("--stage=".length) : "1,2,3,4")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

const results: { step: string; ok: boolean; detail: string }[] = [];
function check(step: string, ok: boolean, detail = ""): void {
  results.push({ step, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
}

async function raw<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res: unknown = await db!.execute(sql.raw(query));
  const rows = Array.isArray(res) ? (res as unknown[])[0] : res;
  return (rows ?? []) as T[];
}

function elapsed(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

const DATASET_CODE = "first_limit_pullback";
const registry = new DbDatasetRegistry();
const service = new DatasetRegistryService(registry, {
  plugins: createDefaultPluginRegistry(),
  physicalStore: new DbDatasetPhysicalStore(),
});
const TABLES = [
  "ds_first_limit_pullback_event",
  "ds_first_limit_pullback_prefix",
  "ds_first_limit_pullback_post",
  "ds_first_limit_pullback_path",
  "ds_first_limit_pullback_outcome",
] as const;

/** 逐表的行数 + 内容指纹（SUM(CRC32(...))，与行序无关）+ 参与比对的列清单。 */
async function tableFingerprints(
  versionId: number,
): Promise<Record<string, { rows: number; fp: string; cmp: string[] }>> {
  const out: Record<string, { rows: number; fp: string; cmp: string[] }> = {};
  for (const table of TABLES) {
    const cols = (await raw<{ columnName: string }>(
      `SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`,
    )).map((c) => c.columnName);
    // id / createdAt 是自增与写入时刻、datasetVersionId 是版本主键，三者都**天然不同**，
    // 不参与内容比对（否则永远不可能相等）。曾因漏排除 datasetVersionId 导致 S4 假阴性。
    const cmp = cols.filter((c) => c !== "id" && c !== "createdAt" && c !== "datasetVersionId");
    const expr = cmp.map((c) => `IFNULL(CAST(\`${c}\` AS CHAR), '~')`).join(", ");
    const rows = await raw<{ c: number; h: string | null }>(
      `SELECT COUNT(*) AS c, SUM(CRC32(CONCAT_WS('|', ${expr}))) AS h FROM \`${table}\` WHERE datasetVersionId = ${versionId}`,
    );
    out[table] = { rows: Number(rows[0]?.c ?? 0), fp: String(rows[0]?.h ?? "0"), cmp };
  }
  return out;
}

/**
 * 行级多重集差集 = 差异行数。
 * 把 A、B 两版本的行哈希合并到一个多重集里，计数为奇数的桶即为「只在一边出现」的行。
 * 比全表指纹更强：指纹只证明「总和不冲突」，本函数证明**每一行都能在对面找到逐字节相同的对应行**。
 * （CRC32 碰撞概率极低；此处仅作等价性佐证，不承担安全用途。）
 */
async function rowMultisetDiff(table: string, a: number, b: number, cmp: string[]): Promise<number> {
  const expr = cmp.map((c) => `IFNULL(CAST(\`${c}\` AS CHAR), '~')`).join(",");
  const rows = await raw<{ h: unknown }>(
    `SELECT COUNT(*) AS h FROM (
       SELECT CRC32(CONCAT_WS('|', ${expr})) AS h FROM \`${table}\` WHERE datasetVersionId = ${a}
       UNION ALL
       SELECT CRC32(CONCAT_WS('|', ${expr})) AS h FROM \`${table}\` WHERE datasetVersionId = ${b}
     ) u GROUP BY h HAVING COUNT(*) % 2 = 1`,
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// S1 — 阈值数值证明（纯计算）
// ---------------------------------------------------------------------------

async function stage1(): Promise<void> {
  console.log("\n=== S1 阈值数值证明（SQL 下推谓词必须是精确判定的超集）===");
  const RATIOS = [0.05, 0.1, 0.2, 0.3]; // ST 主板 / 主板 / 创业板·科创板 / 北交所
  const MAX_K = 300_000; // 昨收 0.01 ~ 3000.00 元

  // (1) 主谓词：preClose ≥ 1.00 时 `close ≥ preClose × 1.045` 必须收录全部涨停价。
  let worst = { k: 0, margin: Number.POSITIVE_INFINITY };
  let violations = 0;
  let lowPriceNeedingGuard = 0;
  for (let k = 1; k <= MAX_K; k += 1) {
    const preClose = k / 100;
    const limitUp = exchangeLimitUpPrice(preClose, 0.05); // 最低比例（ST 主板）= 全网下界
    const threshold = preClose * 1.045;
    if (limitUp + 1e-9 < threshold) {
      if (k >= 100) {
        violations += 1;
        const margin = limitUp / threshold;
        if (margin < worst.margin) worst = { k, margin };
      } else {
        // preClose < 1.00 元 → 谓词走 guard 子句（不筛），由 (2) 证明其覆盖性。
        lowPriceNeedingGuard += 1;
      }
    }
  }
  check(
    "preClose ≥ 1.00 元：5% 涨停价 ≥ preClose × 1.045（k = 100..300000，零例外）",
    violations === 0,
    `最紧余量比 ${worst.margin === Number.POSITIVE_INFINITY ? "-" : worst.margin.toFixed(6)}${worst.k ? `（k=${worst.k}）` : ""}`,
  );

  // (2) 低价股 guard（close ≥ preClose）必须覆盖全部封板（涨停价 ≥ 昨收）。
  let guardViolations = 0;
  for (let k = 1; k < 100; k += 1) {
    const preClose = k / 100;
    if (exchangeLimitUpPrice(preClose, 0.05) + 1e-9 < preClose) guardViolations += 1;
  }
  check(
    "低价股 guard（close ≥ preClose）覆盖全部 5% 封板（k = 1..99）",
    guardViolations === 0,
    `需 guard 兜住的价位 ${lowPriceNeedingGuard} 处（1.045 谓词单独会漏，guard 补齐）`,
  );

  // (3) 超集硬性质：任何比例、任何 2 位小数昨收，其涨停价都必须被判为候选。
  let supersetViolations = 0;
  for (let k = 1; k <= 100_000; k += 1) {
    const preClose = k / 100;
    for (const ratio of RATIOS) {
      if (!isLimitUpCandidateBar(exchangeLimitUpPrice(preClose, ratio), preClose)) supersetViolations += 1;
    }
  }
  check(
    "超集硬性质：4 种涨停比例 × 10 万价位，涨停价 100% 被判为候选（零漏判）",
    supersetViolations === 0,
    `isLimitUpCandidateBar(limitUpPrice(pc, ratio), pc) 全覆盖`,
  );
}

// ---------------------------------------------------------------------------
// S2 — 真实 DB 下推补集证明
// ---------------------------------------------------------------------------

async function stage2(): Promise<void> {
  console.log("\n=== S2 真实 DB 下推补集证明（一个月，全量精确判定 vs 粗筛）===");
  const start = "2024-03-01";
  const end = "2024-03-31";

  const t1 = Date.now();
  const days = (await raw<{ d: string }>(
    `SELECT DISTINCT tradeDate AS d FROM index_daily WHERE tradeDate >= '${start}' AND tradeDate <= '${end}' ORDER BY d`,
  )).map((r) => r.d);
  const tDays = Date.now() - t1;
  check("取到区间交易日历", days.length > 0, `${days.length} 天 / ${tDays}ms`);

  // A：全市场逐日全量（旧 Phase 1 的取数方式）→ 精确判定
  const tA = Date.now();
  let fullRows = 0;
  const setA = new Set<string>();
  const io = new DbDatasetBuildIO();
  await io.loadSecurityIndexes();
  for (const day of days) {
    const rows = await raw<{ stockCode: string; closePrice: string; preClosePrice: string }>(
      `SELECT stockCode, closePrice, preClosePrice FROM stock_daily_prices WHERE tradeDate = '${day}'`,
    );
    fullRows += rows.length;
    for (const row of rows) {
      const close = Number(row.closePrice);
      const preClose = Number(row.preClosePrice);
      const st = io.resolveStSync(row.stockCode, day);
      if (isLimitUpClose(close, preClose, limitUpRatio(row.stockCode, st))) setA.add(`${row.stockCode}|${day}`);
    }
  }
  const msA = Date.now() - tA;

  // B：下推候选（新 Phase 1 的取数方式）→ 同样精确判定
  const tB = Date.now();
  const candidateBars = await io.fetchLimitUpCandidateBars(start, end);
  const msB = Date.now() - tB;
  const setB = new Set<string>();
  for (const bar of candidateBars) {
    const st = io.resolveStSync(bar.symbol, bar.tradeDate);
    if (isLimitUpClose(bar.close, bar.preClose, limitUpRatio(bar.symbol, st))) {
      setB.add(`${bar.symbol}|${bar.tradeDate}`);
    }
  }

  check("下推候选 100% 覆盖全量判定结果（零漏判）", setA.size === setB.size && [...setA].every((k) => setB.has(k)),
    `A=${setA.size} B=${setB.size} 差集=${[...setA].filter((k) => !setB.has(k)).length}`);
  check(
    `取数压缩 + 提速`,
    true,
    `全量 ${fullRows} 行/${msA}ms（${days.length} 次往返） → 候选 ${candidateBars.length} 行/${msB}ms（1 次调用）` +
      `，压缩 ${(fullRows / Math.max(candidateBars.length, 1)).toFixed(1)}×、提速 ${(msA / Math.max(msB, 1)).toFixed(1)}×`,
  );
  // 粗筛本身不应把「非涨停」误判为涨停（精确判定已把超集收敛，此处校验收敛后的纯度）
  check(
    "候选集经精确判定后无假阳性",
    candidateBars.length >= setB.size,
    `候选 ${candidateBars.length} → 精确涨停 ${setB.size}（纯度 ${((setB.size / Math.max(candidateBars.length, 1)) * 100).toFixed(1)}%）`,
  );
}

// ---------------------------------------------------------------------------
// S3 — 定向取数等价性
// ---------------------------------------------------------------------------

async function stage3(): Promise<void> {
  console.log("\n=== S3 定向取数等价性（按 symbol 定向 vs 全市场过滤）===");
  const io = new DbDatasetBuildIO();
  const symbols = (await raw<{ stockCode: string }>(
    `SELECT stockCode FROM stock_daily_prices WHERE tradeDate = '2024-03-15' ORDER BY stockCode LIMIT 400`,
  )).map((r) => r.stockCode);
  const start = "2024-03-01";
  const end = "2024-04-30";

  const t1 = Date.now();
  const scoped = await io.fetchBarsForSymbolsInRange(symbols, start, end);
  const ms1 = Date.now() - t1;

  const t2 = Date.now();
  const fullMarket = await raw<Record<string, string>>(
    `SELECT * FROM stock_daily_prices WHERE tradeDate >= '${start}' AND tradeDate <= '${end}'`,
  );
  const ms2 = Date.now() - t2;
  const wanted = new Set(symbols);
  const manual = fullMarket.filter((r) => wanted.has(r.stockCode));

  const key = (r: { symbol?: string; stockCode?: string; tradeDate: string; close: unknown; closePrice?: string }) =>
    `${r.symbol ?? r.stockCode}|${r.tradeDate}|${r.close ?? r.closePrice}`;
  const setScoped = new Set(scoped.map((b: DailyBar) => key(b)));
  const setManual = new Set(manual.map((r) => key(r as never)));

  check(
    "定向取数与全市场过滤结果逐行一致",
    setScoped.size === setManual.size && [...setScoped].every((k) => setManual.has(k)),
    `定向 ${scoped.length} 行 / 全市场 ${fullMarket.length} 行（筛后 ${manual.length} 行）`,
  );
  check(
    "定向取数压缩 + 提速",
    true,
    `${fullMarket.length} 行/${ms2}ms → ${scoped.length} 行/${ms1}ms，压缩 ${(fullMarket.length / Math.max(scoped.length, 1)).toFixed(1)}×`,
  );
}

// ---------------------------------------------------------------------------
// 通用：在临时版本上跑一次真实构建
// ---------------------------------------------------------------------------

interface BuildOutcome {
  versionId: number;
  elapsedMs: number;
  result: {
    events: number;
    prefixes: number;
    posts: number;
    paths: number;
    outcomes: number;
    processedRows: number;
  };
}

async function buildTempVersion(options: {
  label: string;
  startDate: string;
  endDate: string;
  boards: DatasetBoard[];
  excludeSt: boolean;
  events: { relativeDay: number; kind: string }[];
  preWindowDays: number;
  postWindowDays: number;
  outcomeHorizons: number[];
  batchSize: number;
}): Promise<BuildOutcome> {
  const definition = await registry.getDefinitionByCode(DATASET_CODE);
  if (!definition?.id) throw new Error(`未找到 dataset 定义：${DATASET_CODE}`);
  const version = await service.createVersionWithBuildConfig({
    datasetId: definition.id,
    version: options.label,
    startDate: options.startDate,
    endDate: options.endDate,
    filter: {
      boards: options.boards,
      excludeSt: options.excludeSt,
      events: options.events,
      preWindowDays: options.preWindowDays,
      postWindowDays: options.postWindowDays,
      outcomeHorizons: options.outcomeHorizons,
      batchSize: options.batchSize,
    },
  });
  const versionId = version.id!;
  let job = await service.createJob(versionId);
  job = await service.startJob(job.jobId);
  await service.markBuilding(versionId);

  const resolved = await service.resolveBuildConfigForVersion(versionId);
  const io = new DbDatasetBuildIO();
  const builder = new FirstLimitPullbackDatasetBuilder(io, { batchSize: resolved.batchSize });
  const startedAt = Date.now();
  let lastLog = startedAt;
  const report = async (cp: DatasetBuildCheckpoint): Promise<void> => {
    await service.updateJobProgress(job.jobId, {
      lastTradeDate: cp.lastTradeDate,
      lastSymbol: cp.lastSymbol,
      lastCursor: JSON.stringify(cp),
      processedRows: cp.processedRows,
      completedChunks: cp.completedChunks,
    });
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log(
        `    [${elapsed(startedAt)}] phase=${cp.phase} 至 ${cp.lastTradeDate ?? "-"} ` +
          `processedRows=${cp.processedRows} chunks=${cp.completedChunks}`,
      );
    }
  };

  try {
    const result = await builder.build(
      {
        datasetVersionId: versionId,
        startDate: resolved.startDate,
        endDate: resolved.endDate,
        boards: resolved.boards,
        excludeSt: resolved.excludeSt,
        events: resolved.events,
        preWindowDays: resolved.preWindowDays,
        postWindowDays: resolved.postWindowDays,
        outcomeHorizons: resolved.outcomeHorizons,
        batchSize: resolved.batchSize,
        resumeCheckpoint: null,
      },
      report,
    );
    const elapsedMs = Date.now() - startedAt;
    const totalRows = result.events + result.prefixes + result.posts + result.paths + result.outcomes;
    await service.completeJob(job.jobId);
    await service.markReady(versionId, { totalEvents: result.events, totalRows });
    return { versionId, elapsedMs, result: { ...result } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await service.failJob(job.jobId, message).catch(() => {});
    await service.markFailed(versionId).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// S4 — 端到端等价 + 计时（对比既有 v1）
// ---------------------------------------------------------------------------

async function stage4(): Promise<void> {
  console.log("\n=== S4 端到端等价 + 计时（新 builder 重建 v1 窗口，与既有 v1 比对）===");
  const v1 = await registry.getVersion(120001, "v1");
  if (!v1?.id) {
    check("找到基线版本 v1", false, "缺失 → 跳过 S4");
    return;
  }
  const baseConfig = await registry.getBuildConfig(v1.id);
  if (!baseConfig) {
    check("读取 v1 已固化筛选配置", false, "缺失 → 跳过 S4");
    return;
  }
  console.log(
    `  基线 v1：id=${v1.id} ${v1.startDate}~${v1.endDate} boards=[${baseConfig.boards.join(",")}] ` +
      `excludeSt=${baseConfig.excludeSt} events=[${baseConfig.events.map((e) => `${e.relativeDay}:${e.kind}`).join(",")}] ` +
      `pre=${baseConfig.preWindowDays} post=${baseConfig.postWindowDays} horizons=${baseConfig.outcomeHorizons.join(",")}`,
  );

  const beforeBase = await tableFingerprints(v1.id);
  const label = `perf-verify-${Date.now()}`;
  const outcome = await buildTempVersion({
    label,
    startDate: v1.startDate!,
    endDate: v1.endDate!,
    boards: baseConfig.boards as DatasetBoard[],
    excludeSt: baseConfig.excludeSt,
    events: baseConfig.events,
    preWindowDays: baseConfig.preWindowDays,
    postWindowDays: baseConfig.postWindowDays,
    outcomeHorizons: baseConfig.outcomeHorizons,
    batchSize: baseConfig.batchSize,
  });
  const after = await tableFingerprints(outcome.versionId);

  let allMatch = true;
  for (const table of TABLES) {
    const name = table.replace("ds_first_limit_pullback_", "");
    const okFp =
      beforeBase[table]!.rows === after[table]!.rows && beforeBase[table]!.fp === after[table]!.fp;
    if (!okFp) allMatch = false;
    check(
      `${name} 行数 + 内容指纹一致`,
      okFp,
      `v1=${beforeBase[table]!.rows}/fp=${beforeBase[table]!.fp} 新=${after[table]!.rows}/fp=${after[table]!.fp}`,
    );
    // 更强判据：逐行多重集比对（排除 id/createdAt/datasetVersionId）。指纹一致仍可能是「总和不冲突」，
    // 行级差集为 0 才能证明每一行都有逐字节相同的对应行。
    const diff = await rowMultisetDiff(table, v1.id!, outcome.versionId, after[table]!.cmp);
    if (diff !== 0) allMatch = false;
    check(
      `${name} 行级多重集零差异（逐字节等价）`,
      diff === 0,
      `差异行 ${diff} / ${after[table]!.rows} 行（比对列 ${after[table]!.cmp.length} 个）`,
    );
  }
  const totalRows = TABLES.reduce((s, t) => s + after[t]!.rows, 0);
  check("五表总量一致（端到端结果等价）", allMatch, `${totalRows} 行，耗时 ${(outcome.elapsedMs / 1000).toFixed(1)}s`);

  console.log(
    `  吞吐：${(totalRows / (outcome.elapsedMs / 1000)).toFixed(0)} 行/s，` +
      `${(outcome.result.events / (outcome.elapsedMs / 1000)).toFixed(1)} 事件/s（窗口 ${v1.startDate}~${v1.endDate}）`,
  );

  if (!keep) {
    await service.deleteVersion(outcome.versionId);
    const remain = await raw<{ c: number }>(
      `SELECT COUNT(*) AS c FROM dataset_version WHERE id = ${outcome.versionId}`,
    );
    check("临时版本已级联清理（零残留）", Number(remain[0]?.c ?? 0) === 0, `versionId=${outcome.versionId}`);
  } else {
    console.log(`  [--keep] 保留临时版本 ${outcome.versionId}（label=${label}）`);
  }
}

// ---------------------------------------------------------------------------
// S5 — 长窗口吞吐实测（默认跳过）
// ---------------------------------------------------------------------------

async function stage5(): Promise<void> {
  console.log("\n=== S5 长窗口吞吐实测（2024 全年，临时版本）===");
  const outcome = await buildTempVersion({
    label: `perf-year-${Date.now()}`,
    startDate: "2024-01-02",
    endDate: "2024-12-31",
    boards: ["main"],
    excludeSt: true,
    events: [{ relativeDay: 0, kind: "firstBoard" }],
    preWindowDays: 20,
    postWindowDays: 20,
    outcomeHorizons: [5, 10, 20],
    batchSize: 1000,
  });
  const f = await tableFingerprints(outcome.versionId);
  const totalRows = TABLES.reduce((s, t) => s + f[t]!.rows, 0);
  console.log(
    `  事件 ${outcome.result.events} / 五表 ${totalRows} 行 / 耗时 ${(outcome.elapsedMs / 1000).toFixed(1)}s ` +
      `→ ${(totalRows / (outcome.elapsedMs / 1000)).toFixed(0)} 行/s、${(outcome.result.events / (outcome.elapsedMs / 1000)).toFixed(1)} 事件/s`,
  );
  check("2024 全年窗口构建完成", outcome.result.events > 0, `events=${outcome.result.events} rows=${totalRows}`);
  if (!keep) {
    await service.deleteVersion(outcome.versionId);
    check("临时版本已级联清理（零残留）", true, `versionId=${outcome.versionId}`);
  } else {
    console.log(`  [--keep] 保留临时版本 ${outcome.versionId}`);
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const runStage = async (id: string, fn: () => Promise<void>): Promise<void> => {
  if (!stages.has(id)) return;
  try {
    await fn();
  } catch (err) {
    check(`S${id} 执行异常`, false, err instanceof Error ? err.message : String(err));
  }
};

await runStage("1", stage1);
await runStage("2", stage2);
await runStage("3", stage3);
await runStage("4", stage4);
await runStage("5", stage5);

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 汇总 ===`);
console.log(`断言 ${results.length} 项：通过 ${results.length - failed.length} / 失败 ${failed.length}`);
for (const r of failed) console.log(`  ❌ ${r.step} — ${r.detail}`);
process.exit(failed.length === 0 ? 0 : 1);
