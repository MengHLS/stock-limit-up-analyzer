/**
 * 建运行前置校验（`PAPER_TRADING_CALENDAR_STALE`）的**正向路径**取证。
 *
 * 为什么必须验：该校验是新增的**阻断式**判断，一旦 `context.tradingDates` 在创建路径上取不到，
 * 就会把「所有新建运行」全部挡死（爆炸半径极大）。故用真实 tRPC 建一条**探针命名域**的运行，
 * 断言「不抛错 + 落库 + 锚点不越过日历末端」，然后按命名域**自清理**（不碰任何真实运行）。
 *
 * ⚠️ 反向分支（日历真的落后 ⇒ 抛错）无法在不篡改日历数据的前提下取证 —— 明确登记为未取证。
 *
 * 用法：npx tsx docs/evidence/_probe_paper_create_guard.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { appRouter } from "../../server/routers";
import { getDb } from "../../server/db";

/** 探针命名域（自清理判据绑定它，**不绑定 runId**）。 */
const LABEL_PREFIX = "PROBE-CALENDAR-GUARD-";

const adminCtx = {
  user: { id: "probe", role: "admin" as const, openId: "probe", name: "probe" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never;
const caller = appRouter.createCaller(adminCtx);

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}
function unwrap<T>(res: unknown): T[] {
  if (Array.isArray(res)) return (Array.isArray(res[0]) ? res[0] : res) as T[];
  return [];
}

const db = await getDb();
if (!db) {
  console.log("数据库不可用（DATABASE_URL 未配置）");
  process.exit(1);
}

const label = `${LABEL_PREFIX}${Date.now()}`;
let createdId: number | null = null;

try {
  console.log(`\n=== 1) 真实 tRPC 建运行（label=${label}） ===`);
  const created = await caller.sentiment.createPaperTradingRun({ label, strategyKey: "baseline", initialCapital: 100_000 });
  createdId = created.id;
  console.log(JSON.stringify(created));
  check("创建未抛 PAPER_TRADING_CALENDAR_STALE（正向路径放行）", Number(createdId) > 0, `id=${createdId}`);

  const row = unwrap<Record<string, unknown>>(
    await db.execute(sql`select id, label, status, lastProcessedDate from paper_trading_runs where id = ${createdId}`),
  )[0];
  check("已落库", row !== undefined, JSON.stringify(row ?? null));

  const calendar = unwrap<Record<string, unknown>>(
    await db.execute(sql`select max(tradeDate) as lastDate from index_daily`),
  )[0];
  const calendarLast = (calendar?.["lastDate"] ?? null) as string | null;
  const anchor = (row?.["lastProcessedDate"] ?? null) as string | null;
  check("锚点不越过交易日历末端（校验语义）",
    anchor !== null && calendarLast !== null && anchor <= calendarLast,
    `锚点=${anchor} 日历末端=${calendarLast}`);
  check("状态为 active（新建即可推进的前置）", row?.["status"] === "active", String(row?.["status"]));
} catch (error) {
  const err = error as Error & { cause?: unknown };
  failures += 1;
  checks += 1;
  console.log(` FAIL  建运行抛错：${err.message}`);
  for (let e: unknown = err.cause; e instanceof Error; e = (e as Error & { cause?: unknown }).cause) {
    console.log(`        cause: ${e.constructor.name} ${e.message}`);
  }
} finally {
  console.log("\n=== 2) 按命名域自清理 ===");
  const before = unwrap<Record<string, unknown>>(
    await db.execute(sql`select id from paper_trading_runs where label like ${`${LABEL_PREFIX}%`}`),
  );
  console.log(`  命中探针行：${before.map((r) => r["id"]).join(",") || "（无）"}`);
  if (before.length > 0) {
    await db.execute(sql`delete from paper_trading_runs where label like ${`${LABEL_PREFIX}%`}`);
  }
  const after = unwrap<Record<string, unknown>>(
    await db.execute(sql`select count(*) as c from paper_trading_runs where label like ${`${LABEL_PREFIX}%`}`),
  );
  check("自清理干净（探针命名域剩余 0 行）", Number(after[0]?.["c"] ?? -1) === 0, `剩余 ${after[0]?.["c"]}`);
}

console.log(`\n=== 汇总：${checks - failures}/${checks} 通过，失败 ${failures} ===`);
process.exit(failures === 0 ? 0 : 1);
