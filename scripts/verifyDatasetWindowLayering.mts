/**
 * DATABASE_REDESIGN §2.3 — 事件窗口五表分层：**不变量 I1~I11 全面断言**（真实 DB，只读）。
 *
 * 目标：把 §2.3 的不变量表逐条变成可执行断言，覆盖「结构」与「数据」两层：
 *   I1  prefix ∩ path ∩ post 键集合为空（rd ≤ 0 vs ≥ 1）
 *   I2  每个 eventId 在 prefix 中恰好一行 rd = 0
 *   I3  event 表不含 open/high/low/close/volume/amount
 *   I4  prefix.rd ∈ [−pre, 0]；post.rd ∈ [1, post]；path.rd ∈ [1, post]
 *   I5  event 行数 = prefix 中 rd = 0 行数
 *   I6  outcome 行数 = event 行数 × |horizons|
 *   I7  五表在 (datasetVersionId, 业务键) 上唯一
 *   I7b event 的**自然键** (symbol, tradeDate) 唯一（纵深防御：不依赖 eventId 编码形式）
 *   I12 跨事件窗口重叠副本同源同值（同一根 K 线的多份副本 OHLCV 必须逐字节相同）
 *   I8  prefix 不含 *FromEventClose / isBreakout（结构级 PIT 防线）
 *   I9  post 不含任何衍生列
 *   I10 post 与 path 的键集合完全相等
 *   I11 path 可由 prefix(D0) + post 100% 重算；outcome 可由 path 100% 重算（抽样逐条比对，容差 1e-9）
 *
 * 用法：
 *   npx tsx scripts/verifyDatasetWindowLayering.mts                  # 全部数据集 / 全部版本
 *   npx tsx scripts/verifyDatasetWindowLayering.mts --sample=500     # 指定 I11 抽样事件数（默认 200）
 *   npx tsx scripts/verifyDatasetWindowLayering.mts --code=first_limit_pullback --version=v2
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { defaultDatasetPluginRegistry, resolvePluginTables } from "../server/datasetRegistry/plugins";

const SAMPLE = Number(
  (process.argv.find((a) => a.startsWith("--sample=")) ?? "--sample=200").split("=")[1] ?? 200,
);
const ONLY_CODE = (process.argv.find((a) => a.startsWith("--code=")) ?? "").split("=")[1] ?? null;
const ONLY_VERSION = (process.argv.find((a) => a.startsWith("--version=")) ?? "").split("=")[1] ?? null;

const TOL = 1e-9;

const db = await getDb();
if (!db) {
  console.error("数据库不可用：未找到 DATABASE_URL");
  process.exit(1);
}

const results: { id: string; scope: string; ok: boolean; detail: string }[] = [];
function check(id: string, scope: string, ok: boolean, detail = ""): void {
  results.push({ id, scope, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${id} ${scope}${detail ? ` — ${detail}` : ""}`);
}

async function one<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const raw = await db!.execute(query);
  const rows = ((Array.isArray(raw) ? raw[0] : []) ?? []) as T[];
  return (rows[0] ?? {}) as T;
}
async function all<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  const raw = await db!.execute(query);
  return ((Array.isArray(raw) ? raw[0] : []) ?? []) as T[];
}
const num = (v: unknown): number => Number(v ?? 0);

async function columnsOf(table: string): Promise<string[]> {
  const rows = await all<{ COLUMN_NAME: string }>(
    sql`SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} ORDER BY ORDINAL_POSITION`,
  );
  return rows.map((r) => r.COLUMN_NAME);
}

/** NULL/浮点安全的「不相等」判定（两值皆 NULL → 相等；非 NULL 用容差）。 */
function mismatchSql(a: string, b: string): string {
  return `CASE WHEN ((${a}) IS NULL) <> ((${b}) IS NULL) THEN 1
               WHEN (${a}) IS NULL THEN 0
               WHEN ABS((${a}) - (${b})) > ${TOL} THEN 1 ELSE 0 END`;
}

console.log(`\n=== 事件窗口五表分层：不变量 I1~I12 断言（真实 DB）===\n`);

const definitions = await all<{ id: number; datasetCode: string }>(
  sql`SELECT \`id\`, \`datasetCode\` FROM \`dataset_definition\` ORDER BY \`id\``,
);

let totalChecks = 0;
for (const def of definitions) {
  if (ONLY_CODE && def.datasetCode !== ONLY_CODE) continue;
  const plugin = defaultDatasetPluginRegistry.get(def.datasetCode);
  if (!plugin) {
    console.log(`⚠ [${def.datasetCode}] 未注册插件 → 跳过`);
    continue;
  }
  const spec = resolvePluginTables(plugin, def.datasetCode);
  const T = Object.fromEntries(spec.map((t) => [t.role, t.tableName])) as Record<string, string>;
  console.log(`\n【${def.datasetCode}】`);

  // ------------------------------------------------------------------
  // 结构层（与版本无关）
  // ------------------------------------------------------------------
  const eventCols = await columnsOf(T.event!);
  const prefixCols = await columnsOf(T.prefix!);
  const postCols = await columnsOf(T.post!);
  const pathCols = await columnsOf(T.path!);
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

  // I3
  const dailyBars = ["open", "high", "low", "close", "volume", "amount"];
  const leaked = dailyBars.filter((c) => lower(eventCols).includes(c));
  check("I3", `${def.datasetCode} · event 不含日线行情列`, leaked.length === 0,
    leaked.length === 0 ? `列数=${eventCols.length}` : `违禁列=${leaked.join(",")}`);

  // I8 —— prefix 禁 *FromEventClose / isBreakout / breakout*
  const prefixDerived = lower(prefixCols).filter(
    (c) => c.includes("fromeventclose") || c.includes("fromeventhigh") || c.startsWith("isbreakout") || c.startsWith("breakout") || c === "volumeratio" || c.startsWith("daystobreakout"),
  );
  check("I8", `${def.datasetCode} · prefix 不含任何衍生列（结构级 PIT 防线）`, prefixDerived.length === 0,
    prefixDerived.length === 0 ? `列数=${prefixCols.length}` : `违禁列=${prefixDerived.join(",")}`);

  // I9 —— post 只含身份 + 原始行情
  const postAllowed = new Set([
    "id", "datasetversionid", "eventid", "symbol", "tradedate", "relativeday",
    "open", "high", "low", "close", "volume", "amount", "createdat",
  ]);
  const postIllegal = lower(postCols).filter((c) => !postAllowed.has(c));
  check("I9", `${def.datasetCode} · post 只含身份 + 原始行情`, postIllegal.length === 0,
    postIllegal.length === 0 ? `列数=${postCols.length}` : `多余列=${postIllegal.join(",")}`);

  // I10-结构（I10 的数据层断言在版本循环内）—— prefix / post 严格同构
  const norm = (xs: string[]) => xs.slice().sort().join(",");
  const prefixShape = norm(lower(prefixCols).filter((c) => c !== "id" && c !== "createdat"));
  const postShape = norm(lower(postCols).filter((c) => c !== "id" && c !== "createdat"));
  check("I10s", `${def.datasetCode} · prefix / post 严格同构`, prefixShape === postShape,
    prefixShape === postShape ? `同构列数=${prefixShape.split(",").length}` : "列集合不一致");

  // ------------------------------------------------------------------
  // 版本循环
  // ------------------------------------------------------------------
  const versions = await all<{ id: number; version: string; status: string }>(
    sql`SELECT \`id\`, \`version\`, \`status\` FROM \`dataset_version\`
         WHERE \`datasetId\` = ${def.id} ORDER BY \`id\``,
  );

  for (const v of versions) {
    if (ONLY_VERSION && v.version !== ONLY_VERSION) continue;
    const vid = Number(v.id);
    const scope = `${def.datasetCode}/${v.version}(id=${vid})`;
    console.log(`\n  ── ${scope} status=${v.status}`);

    const cnt = async (table: string, where = "1=1") =>
      num((await one(sql`SELECT COUNT(*) AS n FROM ${sql.raw(`\`${table}\``)} WHERE \`datasetVersionId\` = ${vid} AND ${sql.raw(where)}`)).n);

    const eventN = await cnt(T.event!);
    const prefixN = await cnt(T.prefix!);
    const postN = await cnt(T.post!);
    const pathN = await cnt(T.path!);
    const outcomeN = await cnt(T.outcome!);

    // I1 —— 键集合两两不相交
    const i1 = await one(
      sql`SELECT
        (SELECT COUNT(*) FROM ${sql.raw(`\`${T.prefix!}\``)} p JOIN ${sql.raw(`\`${T.path!}\``)} q
           ON q.datasetVersionId = p.datasetVersionId AND q.eventId = p.eventId AND q.relativeDay = p.relativeDay
          WHERE p.datasetVersionId = ${vid}) AS prefix_path,
        (SELECT COUNT(*) FROM ${sql.raw(`\`${T.prefix!}\``)} p JOIN ${sql.raw(`\`${T.post!}\``)} b
           ON b.datasetVersionId = p.datasetVersionId AND b.eventId = p.eventId AND b.relativeDay = p.relativeDay
          WHERE p.datasetVersionId = ${vid}) AS prefix_post`,
    );
    check("I1", `${scope} · prefix∩path / prefix∩post 为空`,
      num(i1.prefix_path) === 0 && num(i1.prefix_post) === 0,
      `prefix∩path=${num(i1.prefix_path)} prefix∩post=${num(i1.prefix_post)}`);

    // I2 —— 每事件恰好一行 rd=0
    const i2 = await one(
      sql`SELECT COUNT(*) AS bad FROM (
            SELECT \`eventId\` FROM ${sql.raw(`\`${T.prefix!}\``)}
             WHERE \`datasetVersionId\` = ${vid} AND \`relativeDay\` = 0
             GROUP BY \`eventId\` HAVING COUNT(*) <> 1
          ) t`,
    );
    check("I2", `${scope} · 每事件恰好一行 prefix.rd=0`, num(i2.bad) === 0, `异常事件数=${num(i2.bad)}`);

    // I4 —— 区间
    const i4 = await one(
      sql`SELECT
        (SELECT MIN(\`relativeDay\`) FROM ${sql.raw(`\`${T.prefix!}\``)} WHERE \`datasetVersionId\` = ${vid}) AS pmin,
        (SELECT MAX(\`relativeDay\`) FROM ${sql.raw(`\`${T.prefix!}\``)} WHERE \`datasetVersionId\` = ${vid}) AS pmax,
        (SELECT MIN(\`relativeDay\`) FROM ${sql.raw(`\`${T.post!}\``)} WHERE \`datasetVersionId\` = ${vid}) AS bmin,
        (SELECT MAX(\`relativeDay\`) FROM ${sql.raw(`\`${T.post!}\``)} WHERE \`datasetVersionId\` = ${vid}) AS bmax,
        (SELECT MIN(\`relativeDay\`) FROM ${sql.raw(`\`${T.path!}\``)} WHERE \`datasetVersionId\` = ${vid}) AS qmin,
        (SELECT MAX(\`relativeDay\`) FROM ${sql.raw(`\`${T.path!}\``)} WHERE \`datasetVersionId\` = ${vid}) AS qmax`,
    );
    const cfg = await one<{ preWindowDays: number | null; postWindowDays: number | null }>(
      sql`SELECT \`preWindowDays\`, \`postWindowDays\` FROM \`dataset_build_config\`
           WHERE \`datasetVersionId\` = ${vid} LIMIT 1`,
    );
    const pre = cfg.preWindowDays === null || cfg.preWindowDays === undefined ? null : num(cfg.preWindowDays);
    const post = cfg.postWindowDays === null || cfg.postWindowDays === undefined ? null : num(cfg.postWindowDays);
    const i4ok =
      num(i4.pmax) <= 0 &&
      num(i4.bmin) >= 1 &&
      num(i4.qmin) >= 1 &&
      num(i4.bmax) === num(i4.qmax) &&
      (pre === null || num(i4.pmin) >= -pre) &&
      (post === null || num(i4.bmax) <= post);
    check("I4", `${scope} · 区间 prefix∈[−pre,0] post=path∈[1,post]`, i4ok,
      `prefix=[${i4.pmin},${i4.pmax}] post=[${i4.bmin},${i4.bmax}] path=[${i4.qmin},${i4.qmax}] cfg(pre=${pre},post=${post})`);

    // I5 —— event 行数 = prefix rd=0 行数
    const prefixD0 = await cnt(T.prefix!, "`relativeDay` = 0");
    check("I5", `${scope} · event 行数 = prefix.rd=0 行数`, eventN === prefixD0,
      `events=${eventN} prefix.d0=${prefixD0}`);

    // I6 —— outcome = events × |horizons|
    const hz = await all<{ h: number; n: number }>(
      sql`SELECT \`horizon\` AS h, COUNT(*) AS n FROM ${sql.raw(`\`${T.outcome!}\``)}
           WHERE \`datasetVersionId\` = ${vid} GROUP BY \`horizon\` ORDER BY \`horizon\``,
    );
    const distinctH = hz.length;
    check("I6", `${scope} · outcome 行数 = events × |horizons|`,
      eventN * distinctH === outcomeN,
      `events=${eventN} horizons=${distinctH} outcome=${outcomeN}（期望 ${eventN * distinctH}）`);

    // I7 —— 唯一性
    const i7 = await one(
      sql`SELECT
        (SELECT COUNT(*) FROM (SELECT \`eventId\` FROM ${sql.raw(`\`${T.event!}\``)}
            WHERE \`datasetVersionId\` = ${vid} GROUP BY \`eventId\` HAVING COUNT(*) > 1) a) AS e,
        (SELECT COUNT(*) FROM (SELECT \`eventId\`,\`relativeDay\` FROM ${sql.raw(`\`${T.prefix!}\``)}
            WHERE \`datasetVersionId\` = ${vid} GROUP BY \`eventId\`,\`relativeDay\` HAVING COUNT(*) > 1) a) AS p,
        (SELECT COUNT(*) FROM (SELECT \`eventId\`,\`relativeDay\` FROM ${sql.raw(`\`${T.post!}\``)}
            WHERE \`datasetVersionId\` = ${vid} GROUP BY \`eventId\`,\`relativeDay\` HAVING COUNT(*) > 1) a) AS b,
        (SELECT COUNT(*) FROM (SELECT \`eventId\`,\`relativeDay\` FROM ${sql.raw(`\`${T.path!}\``)}
            WHERE \`datasetVersionId\` = ${vid} GROUP BY \`eventId\`,\`relativeDay\` HAVING COUNT(*) > 1) a) AS q,
        (SELECT COUNT(*) FROM (SELECT \`eventId\`,\`horizon\` FROM ${sql.raw(`\`${T.outcome!}\``)}
            WHERE \`datasetVersionId\` = ${vid} GROUP BY \`eventId\`,\`horizon\` HAVING COUNT(*) > 1) a) AS o`,
    );
    const dupTotal = num(i7.e) + num(i7.p) + num(i7.b) + num(i7.q) + num(i7.o);
    check("I7", `${scope} · 五表业务键唯一`, dupTotal === 0,
      `event=${num(i7.e)} prefix=${num(i7.p)} post=${num(i7.b)} path=${num(i7.q)} outcome=${num(i7.o)}`);

    // I7b —— event 的**自然键**唯一（纵深防御）
    // 线上唯一键建在派生字符串 eventId 上（`symbol@tradeDate`）。若将来 eventId 生成规则
    // 变更（如改为哈希），DB 层对「同一股票同一日两个事件」的保护会**静默消失**。
    // 因此额外断言自然键 (symbol, tradeDate) 在版本内唯一 —— 这是「多日间隔涨停」不产生
    // 重复事件的根本保证，且不依赖 eventId 的编码形式。
    const i7b = await one(
      sql`SELECT COUNT(*) AS g FROM (
            SELECT \`symbol\`,\`tradeDate\` FROM ${sql.raw(`\`${T.event!}\``)}
             WHERE \`datasetVersionId\` = ${vid}
             GROUP BY \`symbol\`,\`tradeDate\` HAVING COUNT(*) > 1
          ) t`,
    );
    check("I7b", `${scope} · event 自然键 (symbol, tradeDate) 唯一`, num(i7b.g) === 0,
      `重复组=${num(i7b.g)}`);

    // I12 —— 跨事件窗口重叠：**同一根 K 线的多份副本必须同源同值**
    // 同一股票多次（含间隔）涨停时，事件窗口必然互相覆盖 —— 同一根 K 线会以不同
    // (eventId, relativeDay) 被存多份。这是**结构性冗余、语义必需**（每事件需要自己的
    // 相对日），不是重复行；但必须保证这些副本取自同一行情源 ⇒ OHLCV 逐字节相同。
    // 若出现「同一 (symbol, tradeDate) 两套 OHLCV」即为真数据污染。
    const ovRows = await one(
      sql`SELECT
        (SELECT COUNT(*) FROM (SELECT \`symbol\`,\`tradeDate\` FROM ${sql.raw(`\`${T.prefix!}\``)}
            WHERE \`datasetVersionId\` = ${vid} GROUP BY \`symbol\`,\`tradeDate\`
            HAVING COUNT(DISTINCT CONCAT_WS('|',
              IFNULL(CAST(\`open\` AS CHAR),'~'), IFNULL(CAST(\`high\` AS CHAR),'~'),
              IFNULL(CAST(\`low\` AS CHAR),'~'), IFNULL(CAST(\`close\` AS CHAR),'~'),
              IFNULL(CAST(\`volume\` AS CHAR),'~'), IFNULL(CAST(\`amount\` AS CHAR),'~'))) > 1) a) AS p_bad,
        (SELECT COUNT(*) FROM (SELECT \`symbol\`,\`tradeDate\` FROM ${sql.raw(`\`${T.post!}\``)}
            WHERE \`datasetVersionId\` = ${vid} GROUP BY \`symbol\`,\`tradeDate\`
            HAVING COUNT(DISTINCT CONCAT_WS('|',
              IFNULL(CAST(\`open\` AS CHAR),'~'), IFNULL(CAST(\`high\` AS CHAR),'~'),
              IFNULL(CAST(\`low\` AS CHAR),'~'), IFNULL(CAST(\`close\` AS CHAR),'~'),
              IFNULL(CAST(\`volume\` AS CHAR),'~'), IFNULL(CAST(\`amount\` AS CHAR),'~'))) > 1) a) AS b_bad,
        (SELECT IFNULL(SUM(c) - COUNT(*), 0) FROM (SELECT COUNT(*) AS c FROM ${sql.raw(`\`${T.prefix!}\``)}
            WHERE \`datasetVersionId\` = ${vid} GROUP BY \`symbol\`,\`tradeDate\`) a) AS p_extra,
        (SELECT IFNULL(SUM(c) - COUNT(*), 0) FROM (SELECT COUNT(*) AS c FROM ${sql.raw(`\`${T.post!}\``)}
            WHERE \`datasetVersionId\` = ${vid} GROUP BY \`symbol\`,\`tradeDate\`) a) AS b_extra`,
    );
    const ovBad = num(ovRows.p_bad) + num(ovRows.b_bad);
    check("I12", `${scope} · 窗口重叠副本同源同值（无一套 K 线两套数值）`, ovBad === 0,
      `prefix 异常组=${num(ovRows.p_bad)} post 异常组=${num(ovRows.b_bad)}`);
    if (prefixN > 0 || postN > 0) {
      const pPct = prefixN > 0 ? ((num(ovRows.p_extra) / prefixN) * 100).toFixed(1) : "0.0";
      const bPct = postN > 0 ? ((num(ovRows.b_extra) / postN) * 100).toFixed(1) : "0.0";
      console.log(
        `     ℹ 结构性重叠（每事件独立窗口 ⇒ 同一 K 线存多份）：prefix 冗余 ${num(ovRows.p_extra)} 行/${pPct}%，` +
          `post 冗余 ${num(ovRows.b_extra)} 行/${bPct}%（非重复行，勿按 symbol+日期去重）`,
      );
    }

    // I10 —— post 与 path 键集合完全相等
    const i10 = await one(
      sql`SELECT
        (SELECT COUNT(*) FROM ${sql.raw(`\`${T.post!}\``)} b WHERE b.\`datasetVersionId\` = ${vid}
           AND NOT EXISTS (SELECT 1 FROM ${sql.raw(`\`${T.path!}\``)} q
                            WHERE q.\`datasetVersionId\` = b.\`datasetVersionId\` AND q.\`eventId\` = b.\`eventId\`
                              AND q.\`relativeDay\` = b.\`relativeDay\`)) AS post_only,
        (SELECT COUNT(*) FROM ${sql.raw(`\`${T.path!}\``)} q WHERE q.\`datasetVersionId\` = ${vid}
           AND NOT EXISTS (SELECT 1 FROM ${sql.raw(`\`${T.post!}\``)} b
                            WHERE b.\`datasetVersionId\` = q.\`datasetVersionId\` AND b.\`eventId\` = q.\`eventId\`
                              AND b.\`relativeDay\` = q.\`relativeDay\`)) AS path_only`,
    );
    check("I10", `${scope} · post 与 path 键集合完全相等`,
      num(i10.post_only) === 0 && num(i10.path_only) === 0,
      `postOnly=${num(i10.post_only)} pathOnly=${num(i10.path_only)} post=${postN} path=${pathN}`);

    if (!ONLY_CODE && v.status !== "READY") {
      console.log(`     ℹ 版本非 READY，跳过 I11 抽样重算`);
      continue;
    }

    // ------------------------------------------------------------------
    // I11 —— 抽样逐条重算
    // ------------------------------------------------------------------
    const sampleIds = await all<{ eventId: string }>(
      sql`SELECT \`eventId\` FROM ${sql.raw(`\`${T.event!}\``)} WHERE \`datasetVersionId\` = ${vid}
           ORDER BY \`eventId\` LIMIT ${SAMPLE}`,
    );
    if (sampleIds.length === 0) {
      console.log(`     ℹ 无事件，跳过 I11`);
      continue;
    }
    const idList = sql.join(sampleIds.map((s) => sql`${s.eventId}`), sql`,`);

    // I11a：path ← prefix(D0) + post
    const a = await one(
      sql`SELECT COUNT(*) AS n,
        SUM(${sql.raw(mismatchSql("q.highFromEventClose", "b.high / NULLIF(p0.close, 0) - 1"))}) AS bad_high,
        SUM(${sql.raw(mismatchSql("q.lowFromEventClose", "b.low / NULLIF(p0.close, 0) - 1"))}) AS bad_low,
        SUM(${sql.raw(mismatchSql("q.closeFromEventClose", "b.close / NULLIF(p0.close, 0) - 1"))}) AS bad_close,
        SUM(${sql.raw(mismatchSql("q.pullbackFromEventHigh", "b.low / NULLIF(p0.high, 0) - 1"))}) AS bad_pullback,
        SUM(${sql.raw(mismatchSql("q.volumeRatio", "b.volume / NULLIF(p0.volume, 0)"))}) AS bad_volratio,
        SUM(${sql.raw(mismatchSql("q.isBreakout", "IF(p0.high IS NOT NULL AND b.high IS NOT NULL AND b.high > p0.high, 1, 0)"))}) AS bad_breakout,
        SUM(${sql.raw(mismatchSql("q.breakoutPrice", "p0.high"))}) AS bad_breakout_price,
        SUM(CASE WHEN q.daysToBreakout IS NULL THEN 0
                 WHEN q.daysToBreakout <> (SELECT MIN(b2.relativeDay) FROM ${sql.raw(`\`${T.post!}\``)} b2
                        WHERE b2.datasetVersionId = q.datasetVersionId AND b2.eventId = q.eventId
                          AND b2.high IS NOT NULL AND b2.high > p0.high) THEN 1 ELSE 0 END) AS bad_days
        FROM ${sql.raw(`\`${T.path!}\``)} q
        JOIN ${sql.raw(`\`${T.post!}\``)} b
          ON b.datasetVersionId = q.datasetVersionId AND b.eventId = q.eventId AND b.relativeDay = q.relativeDay
        JOIN ${sql.raw(`\`${T.prefix!}\``)} p0
          ON p0.datasetVersionId = q.datasetVersionId AND p0.eventId = q.eventId AND p0.relativeDay = 0
        WHERE q.datasetVersionId = ${vid} AND q.eventId IN (${idList})`,
    );
    const pathBad =
      num(a.bad_high) + num(a.bad_low) + num(a.bad_close) + num(a.bad_pullback) +
      num(a.bad_volratio) + num(a.bad_breakout) + num(a.bad_breakout_price) + num(a.bad_days);
    check("I11a", `${scope} · path 可由 prefix(D0)+post 100% 重算`, pathBad === 0,
      `抽样事件=${sampleIds.length} 比对行=${num(a.n)} 不一致=${pathBad}` +
        (pathBad ? `（high=${num(a.bad_high)} low=${num(a.bad_low)} close=${num(a.bad_close)} pullback=${num(a.bad_pullback)} vr=${num(a.bad_volratio)} bo=${num(a.bad_breakout)} bop=${num(a.bad_breakout_price)} days=${num(a.bad_days)}）` : ""));

    // I11b：outcome ← path（逐 horizon）
    const b = await one(
      sql`SELECT COUNT(*) AS n,
        SUM(${sql.raw(mismatchSql("o.maxReturn", "(SELECT MAX(q.highFromEventClose) FROM " + `\`${T.path!}\`` + " q WHERE q.datasetVersionId = o.datasetVersionId AND q.eventId = o.eventId AND q.relativeDay BETWEEN 1 AND o.horizon)"))}) AS bad_max,
        SUM(${sql.raw(mismatchSql("o.minReturn", "(SELECT MIN(q.lowFromEventClose) FROM " + `\`${T.path!}\`` + " q WHERE q.datasetVersionId = o.datasetVersionId AND q.eventId = o.eventId AND q.relativeDay BETWEEN 1 AND o.horizon)"))}) AS bad_min,
        SUM(${sql.raw(mismatchSql("o.maxDrawdown", "(SELECT MIN(q.closeFromEventClose) FROM " + `\`${T.path!}\`` + " q WHERE q.datasetVersionId = o.datasetVersionId AND q.eventId = o.eventId AND q.relativeDay BETWEEN 1 AND o.horizon)"))}) AS bad_dd,
        SUM(${sql.raw(mismatchSql("o.daysToBreakout", "(SELECT MIN(q.relativeDay) FROM " + `\`${T.path!}\`` + " q WHERE q.datasetVersionId = o.datasetVersionId AND q.eventId = o.eventId AND q.relativeDay BETWEEN 1 AND o.horizon AND q.isBreakout = 1)"))}) AS bad_days,
        SUM(${sql.raw(mismatchSql("o.isBreakout", "IF(EXISTS(SELECT 1 FROM " + `\`${T.path!}\`` + " q WHERE q.datasetVersionId = o.datasetVersionId AND q.eventId = o.eventId AND q.relativeDay BETWEEN 1 AND o.horizon AND q.isBreakout = 1), 1, 0)"))}) AS bad_bo
        FROM ${sql.raw(`\`${T.outcome!}\``)} o
        WHERE o.datasetVersionId = ${vid} AND o.eventId IN (${idList})`,
    );
    const outBad = num(b.bad_max) + num(b.bad_min) + num(b.bad_dd) + num(b.bad_days) + num(b.bad_bo);
    check("I11b", `${scope} · outcome 可由 path 100% 重算`, outBad === 0,
      `抽样事件=${sampleIds.length} 比对行=${num(b.n)} 不一致=${outBad}` +
        (outBad ? `（max=${num(b.bad_max)} min=${num(b.bad_min)} dd=${num(b.bad_dd)} bo=${num(b.bad_bo)} days=${num(b.bad_days)}）` : ""));

    console.log(
      `     ℹ 行数：event=${eventN} prefix=${prefixN} post=${postN} path=${pathN} outcome=${outcomeN}（合计 ${eventN + prefixN + postN + pathN + outcomeN}）`,
    );
  }
}

totalChecks = results.length;
const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(72));
console.log(`总计 ${totalChecks} 项不变量检查：通过 ${totalChecks - failed.length}，失败 ${failed.length}`);
if (failed.length > 0) {
  console.log("\n失败项：");
  for (const f of failed) console.log(`  ❌ ${f.id} ${f.scope} — ${f.detail}`);
}
console.log("=".repeat(72));
process.exit(failed.length === 0 ? 0 : 1);
