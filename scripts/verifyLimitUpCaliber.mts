/**
 * 涨停判定口径真实性审计（ds_* 版本 → 是否由「四舍五入到分」口径构建）。
 *
 * 背景（为什么需要这个脚本）：
 *   `_limitprecision_probe.mjs` 曾实测「未四舍五入阈值」在原始行情上的系统性漏判率 ≈38.03%，
 *   该数字是**旧判定谓词**对 `stock_daily_prices` 的属性，**不是** `ds_*` 表数据的属性。
 *   但 ROADMAP 一度据此推断「既有 `ds_*` 仍是旧口径、不可用于策略结论」。
 *   该推断会随时间反复被不同会话重新怀疑，故固化为可复现断言。
 *
 * 判据（充分性证明，而非相关性）：
 *   修复后阈值 = round(pc*(1+r), 2)（四舍五入到分）；修复前 = pc*(1+r)（未舍入浮点乘积）。
 *   封板日 close ≡ 四舍五入后的涨停价。若某事件属于「向下舍入型」
 *   （即 round 值 < 未舍入值，此时 close = round 值 < 未舍入阈值）：
 *     - 修复后口径：close >= round 值 → 判涨 ✅
 *     - 修复前口径：close >= 未舍入阈值 → **必然判否**（该事件根本不可能被产出）
 *   因此：只要某版本事件集中存在「向下舍入型」样本，就证明它**不是**旧口径的产物。
 *   经验值：全市场随机分布下约 37%~39% 的封板样本属这一类（与 38.03% 同源）。
 *
 * 额外断言（更强）：
 *   - 每个 event 行的 `limitUpPrice` 必须恒等于 `exchangeLimitUpPrice(previousClose, ratio)`；
 *   - 「向下舍入型」事件必须能与 `stock_daily_prices` 的原始收盘价逐一对上
 *     （close == limitUpPrice 且 close < 未舍入阈值），排除 ds_* 表内部自洽但行情对不上的情况。
 *
 * 用法：
 *   npx tsx scripts/verifyLimitUpCaliber.mts                 # 审计全部版本
 *   npx tsx scripts/verifyLimitUpCaliber.mts --version=390001
 *   npx tsx scripts/verifyLimitUpCaliber.mts --samples=10    # 原始行情交叉验证样本数
 *
 * 只读：不写任何库表。
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { exchangeLimitUpPrice } from "../server/data/boardRules";
import { DbDatasetBuildIO, limitUpRatio } from "../server/datasetRegistry";

const db = await getDb();
if (!db) {
  console.error("数据库不可用：未找到 DATABASE_URL");
  process.exit(1);
}

// PIT 涨停比例：必须按「在册 ST 状态」逐日解析，禁用代码前缀猜（与 builder 同源）。
const io = new DbDatasetBuildIO();
await io.loadSecurityIndexes();
const ratioOf = (symbol: string, tradeDate: string): number | null =>
  limitUpRatio(symbol, io.resolveStSync(symbol, tradeDate));

async function raw<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res: unknown = await db!.execute(sql.raw(query));
  const rows = Array.isArray(res) ? (res as unknown[])[0] : res;
  return (rows ?? []) as T[];
}

const argv = process.argv.slice(2);
const versionArg = argv.find((a) => a.startsWith("--version="));
const samplesArg = argv.find((a) => a.startsWith("--samples="));
const sampleCount = samplesArg ? Number(samplesArg.slice("--samples=".length)) : 5;

const TABLES = [
  "event",
  "prefix",
  "post",
  "path",
  "outcome",
] as const;
const TABLE_NAME: Record<string, string> = {
  event: "ds_first_limit_pullback_event",
  prefix: "ds_first_limit_pullback_prefix",
  post: "ds_first_limit_pullback_post",
  path: "ds_first_limit_pullback_path",
  outcome: "ds_first_limit_pullback_outcome",
};

const results: { step: string; ok: boolean; detail: string }[] = [];
function check(step: string, ok: boolean, detail = ""): void {
  results.push({ step, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
}

const versions = versionArg
  ? await raw<{ id: number; version: string; status: string; startDate: string; endDate: string }>(
      `SELECT id, version, status, startDate, endDate FROM dataset_version WHERE id = ${Number(versionArg.slice("--version=".length))}`,
    )
  : await raw<{ id: number; version: string; status: string; startDate: string; endDate: string }>(
      `SELECT id, version, status, startDate, endDate FROM dataset_version ORDER BY id`,
    );

console.log(`\n=== 涨停判定口径真实性审计（${versions.length} 个版本）===`);

for (const v of versions) {
  console.log(`\n[versionId=${v.id} ${v.version} status=${v.status} ${v.startDate}~${v.endDate}]`);

  // 1) 构建完整性（哪几张表有数据）
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const r = await raw<{ c: number }>(
      `SELECT COUNT(*) AS c FROM \`${TABLE_NAME[t]}\` WHERE datasetVersionId = ${v.id}`,
    );
    counts[t] = Number(r[0]?.c ?? 0);
  }
  console.log(
    `  表行数：${TABLES.map((t) => `${t}=${counts[t]}`).join("  ")}`,
  );
  const complete = TABLES.every((t) => counts[t]! > 0);
  check(`${v.version} 五表均已物化（构建完整）`, complete, complete ? "五表非空" : "存在空表 → 构建未完成");

  const eventRows = await raw<{
    symbol: string;
    tradeDate: string;
    previousClose: string | null;
    limitUpPrice: string | null;
  }>(
    `SELECT symbol, tradeDate, previousClose, limitUpPrice FROM \`${TABLE_NAME.event}\`
     WHERE datasetVersionId = ${v.id} ORDER BY symbol, tradeDate`,
  );
  if (eventRows.length === 0) {
    console.log(`  [无事件行 → 口径审计跳过]`);
    continue;
  }

  // 2) limitUpPrice 必须恒等于权威口径 exchangeLimitUpPrice（按 PIT 涨停比例）
  let exact = 0;
  const mismatches: string[] = [];
  for (const r of eventRows) {
    const pc = Number(r.previousClose);
    const actual = Number(r.limitUpPrice);
    if (!Number.isFinite(pc) || !Number.isFinite(actual)) {
      mismatches.push(`${r.symbol} ${r.tradeDate} 非有限值`);
      continue;
    }
    const ratio = ratioOf(r.symbol, r.tradeDate);
    if (ratio === null) {
      mismatches.push(`${r.symbol} ${r.tradeDate} 涨停比例不可判（unknown 板块）`);
      continue;
    }
    const expect = exchangeLimitUpPrice(pc, ratio);
    if (Math.abs(actual - expect) < 1e-9) exact += 1;
    else if (mismatches.length < 5) {
      mismatches.push(`${r.symbol} ${r.tradeDate} actual=${actual} expect=${expect} (ratio=${ratio})`);
    }
  }
  check(
    `${v.version} 每行 limitUpPrice === exchangeLimitUpPrice(pc, ratio)`,
    exact === eventRows.length,
    `${exact}/${eventRows.length}${mismatches.length ? ` 不符例：${mismatches.join(" | ")}` : ""}`,
  );

  // 3) 向下舍入型样本 → 证明事件集不可能是「未舍入」旧口径的产物
  const roundDown = eventRows.filter((r) => {
    const pc = Number(r.previousClose);
    const actual = Number(r.limitUpPrice);
    const ratio = ratioOf(r.symbol, r.tradeDate);
    if (!Number.isFinite(pc) || !Number.isFinite(actual) || ratio === null) return false;
    return actual < pc * (1 + ratio) - 1e-9;
  });
  const pct = (roundDown.length / eventRows.length) * 100;
  check(
    `${v.version} 事件集由【四舍五入】口径构建（含向下舍入样本）`,
    roundDown.length > 0,
    `向下舍入型 ${roundDown.length}/${eventRows.length} = ${pct.toFixed(1)}%；` +
      `未舍入旧口径最多只能产出 ${eventRows.length - roundDown.length} 个事件`,
  );

  // 4) 原始行情交叉验证：向下舍入样本必须能在 stock_daily_prices 对上真实收盘价
  const probe = roundDown.slice(0, sampleCount);
  let verified = 0;
  console.log(`  原始行情交叉验证（${probe.length} 例）`);
  for (const e of probe) {
    const bars = await raw<{ closePrice: string; preClosePrice: string }>(
      `SELECT closePrice, preClosePrice FROM stock_daily_prices
       WHERE stockCode = '${e.symbol}' AND tradeDate = '${e.tradeDate}' LIMIT 1`,
    );
    const b = bars[0];
    if (!b) {
      console.log(`    ${e.symbol} ${e.tradeDate} ⚠️ 行情缺失`);
      continue;
    }
    const close = Number(b.closePrice);
    const pc = Number(b.preClosePrice);
    const ratio = ratioOf(e.symbol, e.tradeDate);
    const unrounded = ratio === null ? Number.NaN : pc * (1 + ratio);
    const ok =
      Number.isFinite(unrounded) && Math.abs(close - Number(e.limitUpPrice)) < 1e-9 && close < unrounded - 1e-9;
    if (ok) verified += 1;
    console.log(
      `    ${ok ? "✔" : "✘"} ${e.symbol} ${e.tradeDate} 行情 close=${close} pc=${pc} | ` +
        `ds.limitUp=${e.limitUpPrice} | 未舍入阈值=${unrounded} | 旧口径=${close >= unrounded ? "判涨" : "判否(漏判)"}`,
    );
  }
  check(
    `${v.version} 向下舍入样本与原始行情逐一对上`,
    verified === probe.length && probe.length > 0,
    `${verified}/${probe.length} 例（close == limitUpPrice 且 < 未舍入阈值）`,
  );
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== 汇总 ===\n断言 ${results.length} 项：通过 ${passed} / 失败 ${results.length - passed}`);
for (const r of results.filter((x) => !x.ok)) console.log(`  ❌ ${r.step} — ${r.detail}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
