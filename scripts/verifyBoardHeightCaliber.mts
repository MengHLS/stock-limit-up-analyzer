/**
 * 连板高度（boardCount）口径审计（只读，真实 DB）。
 *
 * 背景：
 *   `limit_up_records.boardCount` 是**写入时各自算的文本**，来源有两套互不相同的约定：
 *     - `scripts/backfillLimitUpRecords.mjs`（区间回填）：写 `首板` / `N天N板`（N = 连续板数）
 *     - `routers.ts#uploadAndRecognize`（复盘图 OCR）：直接抄图上的 `1` / `N天M板`（N 天窗口内 M 个板，可含间隔）
 *   而页面与统计真正使用的连板高度**并不读这个字段**，而是 `db.ts#calculateConsecutiveBoards`
 *   在读取时用「表内出现过的 limitUpDate 集合」做邻接链重算。
 *   ⇒ 该字段与实际连板口径**可能互相矛盾**，任何按 `boardCount` 字段做的筛选/统计都会错。
 *
 * 关键机制（本脚本要守住的）：
 *   `calculateConsecutiveBoards` 的邻接链要求**链上每一个交易日都有该股记录**。
 *   因此只要某天缺行（未回填 / 未上传 / 被 ST 过滤 / 停牌未记），链就在那里断，
 *   连板高度被低估为 1。→「按日期区间间隔分批入库」会直接制造这种缺口。
 *
 * 判据：
 *   H1 形态报告：boardCount 的文本形态分布（两套约定并存是客观事实，先让它可见）
 *   H2 ✅ 断言：所有 limitUpDate 都必须是 `index_daily` 里的交易日（连板链的日期基准必须真实）
 *   H3 🔴 断言：`N天N板` 声称的连续板数必须等于表内实际连续天数
 *              （大于 = 库里有缺口；小于 = 连板链断裂）
 *   H4 🔴 断言：不得出现「前一交易日同股有记录、当日却记为空/首板/1」的断裂
 *   H5 🔴 断言：真实数据无同日多行（`getLimitUpCountsByDate` 用 COUNT(*)，同日多行会虚增涨停家数）
 *
 * 用法：npx tsx scripts/verifyBoardHeightCaliber.mts
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

let checks = 0;
let failures = 0;

function assert(label: string, condition: boolean, detail = ""): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** boardCount 文本的形态解析。window = `N天M板`(M<N)，是数据源自身的「间隔板」语义，非本表邻接口径。 */
type Shape = "empty" | "first" | "digit" | "streak" | "window" | "other";

function parseShape(raw: string | null): { shape: Shape; claim: number } {
  const s = String(raw ?? "").trim();
  if (s === "") return { shape: "empty", claim: 1 };
  if (s === "首板") return { shape: "first", claim: 1 };
  if (/^\d+$/.test(s)) return { shape: "digit", claim: Number(s) };
  const m = s.match(/^(\d+)天(\d+)板$/);
  if (m) {
    const n = Number(m[1]);
    const b = Number(m[2]);
    return { shape: n === b ? "streak" : "window", claim: b };
  }
  return { shape: "other", claim: Number.NaN };
}

async function main(): Promise<void> {
  const connection = await createConnection(process.env.DATABASE_URL!);
  const q = async <T = Record<string, unknown>>(text: string): Promise<T[]> => {
    const [rows] = (await connection.query(text)) as unknown as [T[]];
    return rows;
  };

  // 真实交易日历：连板连通性的唯一合法基准
  const calendar = (
    await q<{ d: string }>(`SELECT DISTINCT DATE_FORMAT(tradeDate, '%Y-%m-%d') AS d FROM index_daily ORDER BY d`)
  ).map((r) => r.d);
  const dayIndex = new Map<string, number>(calendar.map((d, i) => [d, i]));
  console.log(`\nindex_daily 交易日历：${calendar.length} 个交易日（${calendar[0]} ~ ${calendar[calendar.length - 1]}）`);

  const rows = await q<{ stockCode: string; d: string; boardCount: string | null; createdBy: number | null }>(`
    SELECT stockCode, DATE_FORMAT(limitUpDate, '%Y-%m-%d') AS d, boardCount, createdBy
    FROM limit_up_records
    WHERE stockName NOT LIKE '测试%' AND IFNULL(sector, '') NOT LIKE '测试%'
    ORDER BY stockCode, d
  `);
  console.log(`涨停记录：${rows.length} 行（已剔除「测试」占位行；注意用**前缀**而非 %测试%，否则会误剔「谱尼测试」等真实股）`);

  // ------------------------------------------------------------------
  console.log("\n=== H1 boardCount 文本形态分布（两套约定并存的客观现状） ===");
  const shapeCount: Record<Shape, number> = { empty: 0, first: 0, digit: 0, streak: 0, window: 0, other: 0 };
  for (const r of rows) shapeCount[parseShape(r.boardCount).shape] += 1;
  console.log(`  空=${shapeCount.empty}  首板=${shapeCount.first}  纯数字(OCR "1"/"2")=${shapeCount.digit}`);
  console.log(`  N天N板(回填/连续口径)=${shapeCount.streak}  N天M板(M<N, 数据源间隔板)=${shapeCount.window}  其他=${shapeCount.other}`);
  console.log("  说明：两套写法并存本身不报错，但下游若按字段文本筛选会得到不一致的连板梯队。");

  // ------------------------------------------------------------------
  console.log("\n=== H2 涨停日期必须落在真实交易日历内（连板链的基准） ===");
  const allDates = [...new Set(rows.map((r) => r.d))].sort();
  const calStart = calendar[0];
  const calEnd = calendar[calendar.length - 1];
  const beforeStart = allDates.filter((d) => d < calStart);
  const insideGap = allDates.filter((d) => d >= calStart && d <= calEnd && !dayIndex.has(d));
  const afterTail = allDates.filter((d) => d > calEnd);
  assert(
    "index_daily 日历区间内不存在非交易日（限涨停数据与交易日历基准一致）",
    beforeStart.length === 0 && insideGap.length === 0,
    beforeStart.length === 0 && insideGap.length === 0
      ? `区间 ${calStart} ~ ${calEnd} 内全部命中`
      : `早于日历起点的日期 ${beforeStart.join(", ") || "无"}；区间内的非交易日 ${insideGap.slice(0, 8).join(", ") || "无"}`,
  );
  if (afterTail.length > 0) {
    console.log(
      `  参考（非失败）：${afterTail.join(", ")} 晚于 index_daily 尾部 ${calEnd} —— 指数域尚未同步到该日，` +
        `连带使这些日期的连板链缺少基准，属「指数同步缺口」而非本表口径错误。`,
    );
  }

  // ------------------------------------------------------------------
  const hasRecord = new Set<string>(rows.map((r) => `${r.stockCode}|${r.d}`));
  const byCode = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!dayIndex.has(r.d)) continue;
    const list = byCode.get(r.stockCode) ?? [];
    list.push(r);
    byCode.set(r.stockCode, list);
  }

  let gap = 0; // N天N板 声称的板数 > 表内实际连续天数 ⇒ 库里有缺口
  let broken = 0; // 声称的板数 < 实际连续天数 ⇒ 连板链断裂
  const gapDates = new Map<string, number>();
  const brokenBySource: Record<string, number> = { backfill: 0, ocr: 0 };
  const gapSamples: string[] = [];
  const brokenSamples: string[] = [];

  for (const [code, list] of byCode) {
    let streak = 0;
    let prevIdx = Number.NEGATIVE_INFINITY;
    for (const r of list) {
      const i = dayIndex.get(r.d)!;
      streak = i === prevIdx + 1 ? streak + 1 : 1;
      prevIdx = i;
      const { shape, claim } = parseShape(r.boardCount);
      const source = r.createdBy == null ? "backfill" : "ocr";

      if (shape === "streak" && claim !== streak) {
        if (claim > streak) {
          gap += 1;
          gapDates.set(r.d, (gapDates.get(r.d) ?? 0) + 1);
          if (gapSamples.length < 8) {
            gapSamples.push(`${code} ${r.d} 自称 ${claim} 连板，表内只有 ${streak} 天 → 中间缺 ${claim - streak} 个交易日记录`);
          }
        } else {
          broken += 1;
          brokenBySource[source] += 1;
          if (brokenSamples.length < 8) {
            brokenSamples.push(`${code} ${r.d} 自称 ${claim} 连板，表内却已有 ${streak} 天连续 src=${source}`);
          }
        }
        continue;
      }

      // 空/首板/纯数字：若前一交易日同股也有记录，则当日不可能是首板
      if (shape === "empty" || shape === "first" || shape === "digit") {
        if (streak > 1 && claim !== streak) {
          broken += 1;
          brokenBySource[source] += 1;
          if (brokenSamples.length < 8) {
            brokenSamples.push(`${code} ${r.d} boardCount="${r.boardCount ?? ""}" 但表内已连续 ${streak} 天 src=${source}`);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  console.log("\n=== H3 连板链与实际记录一致性 ===");
  assert(
    "`N天N板` 声称的连续板数 == 表内实际连续天数（缺口 = 0）",
    gap === 0,
    gap === 0 ? "一致" : `🔴 ${gap} 行「自称连板数 > 表内实际」⇒ 中间有交易日缺口（间隔/分批入库的直接后果）`,
  );
  for (const s of gapSamples) console.log(`        ${s}`);
  assert(
    "`N天N板` 声称的连续板数 == 表内实际连续天数（断裂 = 0）",
    broken === 0,
    broken === 0 ? "一致" : `🔴 ${broken} 行「自称连板数 < 表内实际」，backfill=${brokenBySource.backfill} ocr=${brokenBySource.ocr}`,
  );
  for (const s of brokenSamples) console.log(`        ${s}`);
  if (gapDates.size > 0) {
    const top = [...gapDates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`  缺口行最多的交易日：${top.map(([d, c]) => `${d}(${c})`).join("  ")}`);
  }

  // ------------------------------------------------------------------
  console.log("\n=== H4 同一股票相邻交易日却记为首板 ===");
  console.log(`  已并入 H3 的「断裂」计数（backfill=${brokenBySource.backfill} ocr=${brokenBySource.ocr}）——同一根因：链上缺行或写入方未参考既有历史。`);

  // ------------------------------------------------------------------
  console.log("\n=== H5 同日多行（该表无业务唯一键，靠写入方自律） ===");
  const dup = await q<{ dupGroups: number; extraRows: number }>(`
    SELECT COUNT(*) AS dupGroups, IFNULL(SUM(c - 1), 0) AS extraRows FROM (
      SELECT COUNT(*) AS c FROM limit_up_records
      WHERE stockName NOT LIKE '测试%' AND IFNULL(sector, '') NOT LIKE '测试%'
      GROUP BY limitUpDate, stockCode HAVING COUNT(*) > 1
    ) x
  `);
  const dupGroups = Number(dup[0]?.dupGroups ?? 0);
  const extraRows = Number(dup[0]?.extraRows ?? 0);
  assert(
    "真实数据无 (limitUpDate, stockCode) 多行",
    dupGroups === 0,
    dupGroups === 0 ? "无重复" : `🔴 ${dupGroups} 组 / ${extraRows} 行多余 ⇒ getLimitUpCountsByDate(COUNT(*)) 与连板梯队被虚增`,
  );
  if (dupGroups > 0) {
    const worst = await q<{ limitUpDate: string; stockCode: string; c: number }>(`
      SELECT DATE_FORMAT(limitUpDate, '%Y-%m-%d') AS limitUpDate, stockCode, COUNT(*) AS c
      FROM limit_up_records
      WHERE stockName NOT LIKE '%测试%' AND IFNULL(sector, '') NOT LIKE '%测试%'
      GROUP BY limitUpDate, stockCode HAVING COUNT(*) > 1 ORDER BY c DESC LIMIT 5
    `);
    for (const r of worst) console.log(`        ${r.limitUpDate} ${r.stockCode} → ${r.c} 行`);
  }

  await connection.end();
  console.log(`\n结果：${checks - failures}/${checks} 通过${failures > 0 ? `，${failures} 项失败` : ""}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error("审计脚本异常：", error);
  process.exit(2);
});
