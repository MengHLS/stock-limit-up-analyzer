/**
 * STEP 12 WORK B — Security Master 全量回填 CLI（BaoStock 免费无配额）。
 *
 * 用 BaoStock `stock_basic` 全量回填 research_securities + research_security_identifier_history。
 * 复用 server/security 的确定性 security_id、构建器与幂等 upsert（不重写一套）。
 *
 * 用法：
 *   # 实时拉取 BaoStock stock_basic 全量（type=1 股票，含退市股）
 *   MARKETDATA_PYTHON="C:/Users/A/.workbuddy/binaries/python/envs/default/Scripts/python.exe" \
 *     npx tsx scripts/backfillSecurityMasterBaostock.ts --fetch
 *
 *   # 预览（不写库）
 *   npx tsx scripts/backfillSecurityMasterBaostock.ts --fetch --dry-run
 *
 *   # 离线回放（已保存的原始行 JSON）
 *   npx tsx scripts/backfillSecurityMasterBaostock.ts --input=./scripts/_baostock_stock_basic_dump.json
 *
 *   # 拉取并保存原始行（供离线回放/复现）
 *   npx tsx scripts/backfillSecurityMasterBaostock.ts --fetch --dump=./scripts/_baostock_stock_basic_dump.json
 *
 * resume 语义：upsert 幂等（securityId 由 `tushare:<code>.<exchange>` 确定性生成），
 * 中断后重新执行即可续跑；多次运行自动按 securityId 去重，不产生重复行。
 */

import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { buildSecurityMasterFromStockBasic } from "../server/security/buildSecurityMaster";
import {
  BaoStockStockBasicProvider,
  parseBaoStockStockBasic,
  type BaoStockRawRow,
} from "../server/security/baostock";
import type { ProviderSecurityRecord } from "../server/security/provider";
import {
  detectCodeReuseFromDb,
  getSecurityMasterCounts,
  upsertSecurityMaster,
} from "../server/security/repository";

interface CliArgs {
  fetch: boolean;
  input?: string;
  dump?: string;
  dryRun: boolean;
  limit: number;
  attempts: number;
  python?: string;
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  const input = readFlag(args, "input");
  const fetch = args.includes("--fetch") || input === undefined;
  return {
    fetch,
    input,
    dump: readFlag(args, "dump"),
    dryRun: args.includes("--dry-run"),
    limit: Number(readFlag(args, "limit") ?? 0),
    attempts: Number(readFlag(args, "attempts") ?? 8),
    python: readFlag(args, "python"),
  };
}

function usage(): string {
  return [
    "用法：npx tsx scripts/backfillSecurityMasterBaostock.ts [--fetch | --input=file.json]",
    "  --fetch                    实时拉取 BaoStock stock_basic 全量（默认）",
    "  --input=file.json          离线：读取已保存的原始行 JSON（BaoStockRawRow[]）",
    "  --dump=file.json           拉取后把原始行（去重并集）保存到文件",
    "  --dry-run                  只构建与统计，不写库",
    "  --limit=N                  最多落库 N 个证券（默认 0 = 全部）",
    "  --attempts=N               BaoStock 拉取尝试次数（默认 8，对抗后端截断）",
    "  --python=path              指定 Python 解释器（等价于设置 MARKETDATA_PYTHON）",
  ].join("\n");
}

function isBaoStockRawRowArray(value: unknown): value is BaoStockRawRow[] {
  return Array.isArray(value) && (value.length === 0 || (typeof value[0] === "object" && value[0] !== null && "code" in value[0] && "type" in value[0]));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.python) process.env.MARKETDATA_PYTHON = args.python;

  let requested = 0;
  let received = 0;
  let failed = 0;
  let attempts = 0;
  let complete = false;
  let rawRows: BaoStockRawRow[] = [];
  let records: ProviderSecurityRecord[] = [];

  if (args.fetch) {
    const provider = new BaoStockStockBasicProvider({ maxAttempts: args.attempts });
    const result = await provider.fetch();
    attempts = result.stats.attempts;
    requested = result.stats.rawRows;
    failed = result.stats.failures;
    complete = result.stats.complete;
    rawRows = result.rawRows;
    records = result.records;
    received = records.length;
    if (args.dump) {
      writeFileSync(args.dump, JSON.stringify(rawRows, null, 2));
      console.log(`原始行已保存到 ${args.dump}（${rawRows.length} 行）`);
    }
  } else if (args.input) {
    const parsed = JSON.parse(readFileSync(args.input, "utf8")) as unknown;
    if (!isBaoStockRawRowArray(parsed)) {
      console.error("错误：--input 需要 BaoStockRawRow[] 形态的 JSON 数组（含 code/type 字段）");
      process.exit(1);
    }
    rawRows = parsed;
    requested = rawRows.length;
    records = parseBaoStockStockBasic(rawRows);
    received = records.length;
  }

  const built = buildSecurityMasterFromStockBasic(records);
  const rejected = built.rejected.length;
  const delisted = built.securities.filter((s) => s.status === "delisted").length;

  let securities = built.securities;
  let identifiers = built.identifiers;
  if (args.limit > 0 && securities.length > args.limit) {
    const keptIds = new Set(securities.slice(0, args.limit).map((s) => s.securityId));
    securities = securities.filter((s) => keptIds.has(s.securityId));
    identifiers = identifiers.filter((i) => keptIds.has(i.securityId));
  }

  console.log(`[dry-run=${args.dryRun}] Security Master 全量回填（BaoStock）`);
  if (args.fetch) {
    console.log(`  attempts=${attempts} complete=${complete}`);
  }
  console.log(`  Requested=${requested} Received=${received} Failed=${failed}`);
  console.log(`  Rejected=${rejected}（缺上市日/重复代码）`);
  console.log(`  Securities=${securities.length}（退市股 ${delisted}） Identifiers=${identifiers.length}`);

  if (args.dryRun) {
    console.log("dry-run 结束，未写库。");
    return;
  }

  const { securitiesPersisted, identifiersPersisted } = await upsertSecurityMaster(securities, identifiers);
  console.log(`  Persisted: securities=${securitiesPersisted} identifiers=${identifiersPersisted}`);

  const reuse = await detectCodeReuseFromDb();
  const counts = await getSecurityMasterCounts();
  console.log(`  DB 现状: securities=${counts.securities} identifiers=${counts.identifiers} distinctSecurityIds=${counts.distinctSecurityIds}`);
  console.log(`  code reuse 检测到 ${reuse.length} 条：`);
  for (const record of reuse.slice(0, 20)) {
    console.log(`    ${record.exchange} ${record.code} → ${record.securityIds.length} 个 security_id`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });
