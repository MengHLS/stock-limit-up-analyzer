/**
 * STEP 12 WORK D — Corporate Action / Adjustment Factor 回填 CLI（Tushare）。
 *
 * 把 Tushare `dividend`（公司行为：现金分红/送股/转增）与 `adj_factor`（累计复权因子）
 * 归一化后幂等落库到 corporate_actions / adjustment_factors。
 *
 * 用法：
 *   # 预览（不发写库；仍会发真实 API 请求）
 *   npx tsx scripts/backfillCorporateActions.ts --dry-run
 *
 *   # 小样本真实回填（默认 600519.SH,000001.SZ,600036.SH）
 *   npx tsx scripts/backfillCorporateActions.ts
 *
 *   # 指定股票 / 限制数量
 *   npx tsx scripts/backfillCorporateActions.ts --stocks=600519.SH,000001.SZ,000651.SZ --limit=3
 *
 *   # 只跑 dividend 或只跑 adj_factor
 *   npx tsx scripts/backfillCorporateActions.ts --skip-adj-factor
 *   npx tsx scripts/backfillCorporateActions.ts --skip-dividend
 *
 *   # 强制重新拉取（默认 resume：跳过已回填的 ts_code）
 *   npx tsx scripts/backfillCorporateActions.ts --force
 *
 * 配额提示：dividend / adj_factor 均为 1 次/分钟（实测 40203 限频），
 * 默认请求间隔 65000ms，请节制使用（dividend ≤ 10 只、adj_factor ≤ 3 只）。
 */

import "dotenv/config";
import { corporateActions, adjustmentFactors } from "../drizzle/schema";
import { getDb } from "../server/db";
import {
  upsertAdjustmentFactors,
  upsertCorporateActions,
} from "../server/corporateActions/storage";
import {
  validateAdjustmentFactor,
  validateCorporateAction,
} from "../server/corporateActions/validation";
import {
  fetchTushareAdjFactor,
  fetchTushareDividend,
  isTusharePermissionLimited,
} from "../server/corporateActions/tushareProvider";

const DEFAULT_STOCKS = ["600519.SH", "000001.SZ", "600036.SH"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CliArgs {
  dryRun: boolean;
  limit: number;
  stocks?: string[];
  skipDividend: boolean;
  skipAdjFactor: boolean;
  force: boolean;
  intervalMs: number;
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  const stocksRaw = readFlag(args, "stocks");
  return {
    dryRun: args.includes("--dry-run"),
    limit: Number(readFlag(args, "limit") ?? 0),
    stocks: stocksRaw ? stocksRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    skipDividend: args.includes("--skip-dividend"),
    skipAdjFactor: args.includes("--skip-adj-factor"),
    force: args.includes("--force"),
    intervalMs: Number(readFlag(args, "interval") ?? 65_000),
  };
}

function usage(): string {
  return [
    "用法：npx tsx scripts/backfillCorporateActions.ts [选项]",
    "  --stocks=ts1,ts2,...   指定股票（默认 600519.SH,000001.SZ,600036.SH）",
    "  --limit=N              最多处理 N 只股票（0=全部）",
    "  --skip-dividend        跳过公司行为（dividend）回填",
    "  --skip-adj-factor      跳过复权因子（adj_factor）回填",
    "  --force                忽略 resume，强制重新拉取",
    "  --dry-run              只拉取/解析/校验，不写库",
    "  --interval=ms          请求间隔（默认 65000，1次/分钟限频）",
  ].join("\n");
}

interface DomainStats {
  requested: number;
  received: number;
  persisted: number;
  rejected: number;
  failed: number;
  checkpoint: number;
}

async function alreadyBackfilled(table: typeof corporateActions | typeof adjustmentFactors): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db.selectDistinct({ securityCode: table.securityCode }).from(table);
  return new Set(rows.map((r) => r.securityCode));
}

function printStats(label: string, s: DomainStats): void {
  console.log(`[${label}] Requested=${s.requested} Received=${s.received} Persisted=${s.persisted} Rejected=${s.rejected} Failed=${s.failed} Checkpoint=${s.checkpoint}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stocks = (args.stocks ?? DEFAULT_STOCKS).slice(0, args.limit > 0 ? args.limit : undefined);

  console.log(`[dry-run=${args.dryRun}] Corporate Action / Adjustment Factor 回填（Tushare）`);
  console.log(`  股票：${stocks.join(", ")}`);
  if (args.skipDividend && args.skipAdjFactor) {
    console.error("错误：--skip-dividend 与 --skip-adj-factor 不能同时指定（无任何可回填域）");
    console.error(usage());
    process.exit(1);
  }

  const dividendDone = args.skipDividend ? new Set<string>() : await alreadyBackfilled(corporateActions);
  const adjDone = args.skipAdjFactor ? new Set<string>() : await alreadyBackfilled(adjustmentFactors);

  const dividendStats: DomainStats = { requested: 0, received: 0, persisted: 0, rejected: 0, failed: 0, checkpoint: 0 };
  const adjStats: DomainStats = { requested: 0, received: 0, persisted: 0, rejected: 0, failed: 0, checkpoint: 0 };

  // ---------- dividend ----------
  if (!args.skipDividend) {
    for (const tsCode of stocks) {
      if (!args.force && dividendDone.has(tsCode)) {
        console.log(`  [dividend] ${tsCode} 已回填，跳过（resume）`);
        dividendStats.checkpoint += 1;
        continue;
      }
      dividendStats.requested += 1;
      try {
        const result = await fetchTushareDividend(tsCode);
        dividendStats.received += result.received;
        const rejectedByParse = result.skipped + result.missingExDate;
        const validActions = [];
        let rejectedByValidation = 0;
        for (const action of result.actions) {
          if (validateCorporateAction(action).status === "INVALID") {
            rejectedByValidation += 1;
          } else {
            validActions.push(action);
          }
        }
        dividendStats.rejected += rejectedByParse + rejectedByValidation;
        console.log(`  [dividend] ${tsCode}: received=${result.received} actions=${result.actions.length} missingExDate=${result.missingExDate} skipped=${result.skipped} rejected=${rejectedByValidation}`);
        if (!args.dryRun && validActions.length > 0) {
          dividendStats.persisted += await upsertCorporateActions(validActions);
        }
        dividendStats.checkpoint += 1;
      } catch (error) {
        dividendStats.failed += 1;
        console.warn(`  [dividend] ${tsCode} 失败：${error instanceof Error ? error.message : String(error)}`);
        if (isTusharePermissionLimited(error)) {
          console.warn("    检测到 40203 限频，中止 dividend 回填（请等待配额重置后再跑）。");
          break;
        }
      }
      if (stocks.indexOf(tsCode) < stocks.length - 1) await sleep(args.intervalMs);
    }
    printStats("dividend", dividendStats);
  }

  // ---------- adj_factor ----------
  if (!args.skipAdjFactor) {
    for (const tsCode of stocks) {
      if (!args.force && adjDone.has(tsCode)) {
        console.log(`  [adj_factor] ${tsCode} 已回填，跳过（resume）`);
        adjStats.checkpoint += 1;
        continue;
      }
      adjStats.requested += 1;
      try {
        const result = await fetchTushareAdjFactor(tsCode);
        adjStats.received += result.received;
        const rejectedByParse = result.skipped;
        const validFactors = [];
        let rejectedByValidation = 0;
        for (const factor of result.factors) {
          if (validateAdjustmentFactor(factor).status === "INVALID") {
            rejectedByValidation += 1;
          } else {
            validFactors.push(factor);
          }
        }
        adjStats.rejected += rejectedByParse + rejectedByValidation;
        console.log(`  [adj_factor] ${tsCode}: received=${result.received} factors=${result.factors.length} skipped=${result.skipped} rejected=${rejectedByValidation}`);
        if (!args.dryRun && validFactors.length > 0) {
          adjStats.persisted += await upsertAdjustmentFactors(validFactors);
        }
        adjStats.checkpoint += 1;
      } catch (error) {
        adjStats.failed += 1;
        console.warn(`  [adj_factor] ${tsCode} 失败：${error instanceof Error ? error.message : String(error)}`);
        if (isTusharePermissionLimited(error)) {
          console.warn("    检测到 40203 限频，中止 adj_factor 回填（请等待配额重置后再跑）。");
          break;
        }
      }
      if (stocks.indexOf(tsCode) < stocks.length - 1) await sleep(args.intervalMs);
    }
    printStats("adj_factor", adjStats);
  }

  if (args.dryRun) {
    console.log("dry-run 结束，未写库。");
  } else {
    console.log("回填完成。");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });
