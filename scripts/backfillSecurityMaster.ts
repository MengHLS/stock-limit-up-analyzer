/**
 * STEP 7.4 / WORK B — Security Master 回填 CLI。
 *
 * 把 Tushare stock_basic（L/D/P 全量）或 namechange 历史落库为
 *   research_securities + research_security_identifier_history。
 *
 * 用法：
 *   # 实时拉取 stock_basic 全量（L/D/P，约 5 次/天，硬配额）
 *   npx tsx scripts/backfillSecurityMaster.ts --fetch
 *
 *   # 小样本 namechange（限频 1 次/分钟，务必节制）
 *   npx tsx scripts/backfillSecurityMaster.ts --namechange=000001.SZ,600000.SH
 *
 *   # 离线回填（从 JSON 恢复，不请求 API）
 *   npx tsx scripts/backfillSecurityMaster.ts --input=./scripts/_stock_basic_dump.json
 *
 *   # 预览（不写库）
 *   npx tsx scripts/backfillSecurityMaster.ts --fetch --dry-run
 *
 *   # 小规模真实回填（限制落库证券数）
 *   npx tsx scripts/backfillSecurityMaster.ts --fetch --limit=100
 *
 * resume 语义：upsert 幂等（securityId 由 ts_code 确定性生成），重复运行不会产生重复行；
 * 中断后重新执行即可续跑，无需显式 checkpoint。
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  buildSecurityMasterFromNameChanges,
  buildSecurityMasterFromStockBasic,
} from "../server/security/buildSecurityMaster";
import type { NameChangeRecord } from "../server/security/namechange";
import { TushareNameChangeProvider } from "../server/security/namechange";
import type { ProviderSecurityRecord } from "../server/security/provider";
import { TushareStockBasicProvider } from "../server/security/provider";
import {
  detectCodeReuseFromDb,
  getSecurityMasterCounts,
  upsertSecurityMaster,
} from "../server/security/repository";

interface CliArgs {
  fetch: boolean;
  namechange?: string[];
  input?: string;
  dryRun: boolean;
  limit: number;
  namechangeIntervalMs: number;
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  const namechangeRaw = readFlag(args, "namechange");
  return {
    fetch: args.includes("--fetch"),
    namechange: namechangeRaw ? namechangeRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    input: readFlag(args, "input"),
    dryRun: args.includes("--dry-run"),
    limit: Number(readFlag(args, "limit") ?? 0),
    namechangeIntervalMs: Number(readFlag(args, "namechange-interval") ?? 65_000),
  };
}

function usage(): string {
  return [
    "用法：npx tsx scripts/backfillSecurityMaster.ts [--fetch | --namechange=ts1,ts2 | --input=file.json]",
    "  --fetch                    实时拉取 stock_basic 全量（L/D/P）",
    "  --namechange=ts1,ts2,...   小样本 namechange 历史（限频，务必节制）",
    "  --input=file.json          离线：读取已保存的 stock_basic / namechange 记录",
    "  --dry-run                  只构建与统计，不写库",
    "  --limit=N                  最多落库 N 个证券（默认 0 = 全部）",
    "  --namechange-interval=ms   namechange 请求间隔（默认 65000）",
  ].join("\n");
}

function isNameChangeRecord(value: unknown): value is NameChangeRecord {
  return typeof value === "object" && value !== null && "tsCode" in value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const modes = [args.fetch, args.namechange !== undefined, args.input !== undefined].filter(Boolean).length;
  if (modes !== 1) {
    console.error("错误：必须且只能指定一种数据来源（--fetch / --namechange / --input）");
    console.error(usage());
    process.exit(1);
  }

  let requested = 0;
  let received = 0;
  let failed = 0;
  let records: ProviderSecurityRecord[] = [];
  let nameChanges: NameChangeRecord[] = [];

  if (args.fetch) {
    const provider = new TushareStockBasicProvider();
    const raw = await provider.fetchSecurityMaster();
    requested = raw.length;
    received = raw.length;
    records = raw;
  } else if (args.namechange) {
    const provider = new TushareNameChangeProvider();
    requested = args.namechange.length;
    for (const tsCode of args.namechange) {
      try {
        const rows = await provider.fetch(tsCode);
        received += 1;
        nameChanges.push(...rows);
      } catch (error) {
        failed += 1;
        console.warn(`[namechange] ${tsCode} 失败：${error instanceof Error ? error.message : String(error)}`);
      }
      if (args.namechange.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, args.namechangeIntervalMs));
      }
    }
  } else if (args.input) {
    const parsed = JSON.parse(readFileSync(args.input, "utf8")) as unknown[];
    requested = parsed.length;
    if (parsed.length === 0) {
      console.error("错误：输入文件为空数组");
      process.exit(1);
    }
    if (isNameChangeRecord(parsed[0])) {
      nameChanges = parsed as NameChangeRecord[];
      received = nameChanges.length;
    } else {
      records = parsed as ProviderSecurityRecord[];
      received = records.length;
    }
  }

  // 构建
  const built = nameChanges.length > 0
    ? buildSecurityMasterFromNameChanges(nameChanges)
    : buildSecurityMasterFromStockBasic(records);

  const rejected = built.rejected.length;
  let securities = built.securities;
  let identifiers = built.identifiers;
  if (args.limit > 0 && securities.length > args.limit) {
    const keptIds = new Set(securities.slice(0, args.limit).map((s) => s.securityId));
    securities = securities.filter((s) => keptIds.has(s.securityId));
    identifiers = identifiers.filter((i) => keptIds.has(i.securityId));
  }

  console.log(`[dry-run=${args.dryRun}] Security Master 回填`);
  console.log(`  Requested=${requested} Received=${received} Failed=${failed}`);
  console.log(`  Rejected=${rejected}（缺上市日/重复/无有效区间）`);
  console.log(`  Securities=${securities.length} Identifiers=${identifiers.length}`);

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
