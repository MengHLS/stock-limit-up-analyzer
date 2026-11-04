/**
 * STEP 12 WORK G — 行业（Industry）域真实数据回填 CLI。
 *
 * 目标：把 industry_assignments 表从 0 行回填为全市场「当前证监会行业分类」快照。
 *
 * 数据流：BaoStock query_stock_basic（type=1 股票）→ query_stock_industry（逐股）→
 *   parseBaostockIndustry（PIT：effectiveFrom=updateDate，effectiveTo=null）→ upsert 落库。
 *
 * PIT 诚实声明：BaoStock 只提供「当前」行业，无历史行业区间，本回填是当前行业快照；
 * 历史行业缺失是 CONDITIONAL GAP（不伪造历史归属）。
 *
 * 用法：
 *   npx tsx scripts/backfillIndustry.ts --dry-run
 *   npx tsx scripts/backfillIndustry.ts --limit=20
 *   npx tsx scripts/backfillIndustry.ts --code=sh.600000,sz.000001
 *
 * 参数：
 *   --dry-run        只拉取 + 解析，不写库
 *   --limit=N        最多处理 N 只股票（默认全量；小样本验证用 --limit=20）
 *   --code=c1,c2     只回填指定 BaoStock 代码（逗号分隔，跳过 stock_basic 全市场枚举）
 *   --interval=ms    逐股请求间隔（默认 300ms，>=300ms 避免打爆 BaoStock 免费服务器）
 *
 * resume 语义：已回填（industry_assignments 已有该 securityCode）的股票自动跳过；
 * upsert 幂等（uq_industry_assign_security_effective 在 securityCode+effectiveFrom）。
 */

import "dotenv/config";
import { isValidIsoDate } from "../server/marketData/types";
import {
  baostockCodeToSecurityCode,
  fetchBaostockIndustry,
  fetchBaostockStockBasic,
  type BaostockStockBasicRow,
} from "../server/marketData/providers/baostock";
import {
  countIndustryAssignments,
  listBackfilledIndustrySecurityCodes,
  upsertIndustryAssignments,
} from "../server/marketData/industryStorage";
import type { IndustryAssignment } from "../server/marketData/types";
import { getDb } from "../server/db";
import { researchSecurityIdentifierHistory } from "../drizzle/schema";

interface CliArgs {
  dryRun: boolean;
  limit: number | null;
  codes: string[];
  intervalMs: number;
  universeFromDb: boolean;
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  const limitRaw = readFlag(args, "limit");
  const codesRaw = readFlag(args, "code");
  const intervalRaw = readFlag(args, "interval");
  return {
    dryRun: args.includes("--dry-run"),
    limit: limitRaw ? Number(limitRaw) : null,
    codes: codesRaw ? codesRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    intervalMs: Math.max(300, Number(intervalRaw ?? 300)),
    universeFromDb: args.includes("--universe-from-db"),
  };
}

function usage(): string {
  return [
    "用法：npx tsx scripts/backfillIndustry.ts [--dry-run] [--limit=N] [--code=...] [--interval=ms]",
    "  --dry-run       只拉取 + 解析，不写库",
    "  --limit=N       最多处理 N 只股票（默认全量）",
    "  --code=c1,c2    只回填指定 BaoStock 代码（逗号分隔）",
    "  --interval=ms   逐股请求间隔（默认 300ms，强制 >=300ms）",
    "  --universe-from-db  从 research_security_identifier_history 读 universe（绕过 stock_basic 分页限制）",
  ].join("\n");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 增量落库批次大小。逐股拉取耗时（每只 ~2s）较长，若攒到最后一次性 upsert，DB 连接会空闲
 * 数分钟被 TiDB 断开（ECONNRESET）导致整批丢失；改为每攒满 FLUSH_SIZE 只就 flush 一次，
 * 保持连接活跃、失败影响面小（未落库的 code 会在 resume 时重试）。
 */
const FLUSH_SIZE = 25;

interface RunStats {
  candidates: number;
  requested: number;
  parsed: number;
  skippedResume: number;
  empty: number;
  failed: number;
  invalid: number;
  persisted: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const already = args.dryRun ? new Set<string>() : await listBackfilledIndustrySecurityCodes();

  let candidates: string[];
  if (args.codes.length > 0) {
    candidates = args.codes;
  } else if (args.universeFromDb) {
    const db = await getDb();
    if (!db) {
      console.error("DB 不可用");
      process.exit(1);
    }
    const rows = await db
      .selectDistinct({
        exchange: researchSecurityIdentifierHistory.exchange,
        securityCode: researchSecurityIdentifierHistory.securityCode,
      })
      .from(researchSecurityIdentifierHistory);
    candidates = rows.map((row) => `${row.exchange.toLowerCase()}.${row.securityCode}`);
    console.log(`universe-from-db 共 ${candidates.length} 只股票`);
  } else {
    let basics: BaostockStockBasicRow[];
    try {
      basics = await fetchBaostockStockBasic();
    } catch (error) {
      console.error("获取 stock_basic 失败：", error instanceof Error ? error.message : error);
      process.exit(1);
    }
    const stocks = basics.filter((row) => row.type === "1");
    candidates = stocks.map((row) => row.code);
    console.log(`stock_basic 共 ${basics.length} 行，type=1 股票 ${stocks.length} 只`);
  }

  if (args.limit !== null && args.limit > 0) {
    candidates = candidates.slice(0, args.limit);
  }

  const stats: RunStats = {
    candidates: candidates.length,
    requested: 0,
    parsed: 0,
    skippedResume: 0,
    empty: 0,
    failed: 0,
    invalid: 0,
    persisted: 0,
  };

  const toPersist: IndustryAssignment[] = [];

  const flush = async (): Promise<void> => {
    if (args.dryRun || toPersist.length === 0) return;
    const batch = toPersist.splice(0, toPersist.length);
    try {
      const written = await upsertIndustryAssignments(batch);
      stats.persisted += written;
    } catch (error) {
      // 单批落库失败不中断整跑：这些 code 未写库，resume 重跑会重试。
      console.log(`  [flush-fail] ${batch.length} 行落库失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  for (let i = 0; i < candidates.length; i += 1) {
    const baostockCode = candidates[i]!;

    let securityCode: string;
    try {
      securityCode = baostockCodeToSecurityCode(baostockCode);
    } catch {
      console.log(`  [invalid-code] ${baostockCode}: 无法规范化`);
      stats.invalid += 1;
      continue;
    }

    if (already.has(securityCode)) {
      stats.skippedResume += 1;
      continue;
    }

    stats.requested += 1;
    try {
      const assignment = await fetchBaostockIndustry(baostockCode);
      if (!assignment) {
        stats.empty += 1;
        console.log(`  [empty] ${securityCode}: 无行业归属`);
      } else if (!isValidIsoDate(assignment.effectiveFrom)) {
        stats.invalid += 1;
        console.log(`  [invalid] ${securityCode}: updateDate 非法（${assignment.effectiveFrom}）`);
      } else {
        stats.parsed += 1;
        toPersist.push(assignment);
        console.log(`  [ok] ${securityCode}: ${assignment.industryCode} ${assignment.industryName} (from ${assignment.effectiveFrom})`);
      }
    } catch (error) {
      stats.failed += 1;
      console.log(`  [fail] ${securityCode}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (toPersist.length >= FLUSH_SIZE) {
      await flush();
    }

    if (i < candidates.length - 1) {
      await sleep(args.intervalMs);
    }
  }

  console.log(`\n统计：candidates=${stats.candidates} requested=${stats.requested} parsed=${stats.parsed} ` +
    `empty=${stats.empty} failed=${stats.failed} invalid=${stats.invalid} skippedResume=${stats.skippedResume}`);

  if (args.dryRun) {
    console.log("dry-run 结束，未写库。");
    return;
  }

  await flush();
  const total = await countIndustryAssignments();
  console.log(`落库：本次成功写入 ${stats.persisted} 行；industry_assignments 当前总行数=${total}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });
