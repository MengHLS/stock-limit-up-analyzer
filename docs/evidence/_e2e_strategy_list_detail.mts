/**
 * 探针：策略**列表页 / 详情页分家**后的真实链路验收 —— 零写入、只读。
 *
 * 为什么需要它：本机 `agent-browser` 不可用、仓库也没有 jsdom / @testing-library，
 * 「列表页拿到的是什么行」「详情页坐标能不能落到真实文档」无法靠渲染测试证明。
 * 这里用真实 `appRouter.createCaller` 走「tRPC → Service → Repository → TiDB」。
 *
 * 验证的是**这次拆分引入的新依赖**（全部是既有端点，零新增）：
 *   1. 列表页渲染 + 排序 + 日期截断所依赖的字段真的存在，且 `updatedAt` 是
 *      **UTC 墙钟字符串**（形如 `YYYY-MM-DD…`）⇒ 页面「只截前 10 位、不做时区换算」是合法的；
 *   2. 🔴 **新建草稿必须清空身份**：模板 id 若**已存在于库中**，原样保存会变成
 *      「给既有策略加版本」而不是新建 ⇒ 用真实 `list` 证明这一点是事实而非臆测；
 *   3. 详情页的两条加载分支：`load` → **裸文档**；`loadVersion` → **§17 记录（文档在 `.strategy`）**，
 *      且剥壳后与 `load` 同坐标 —— 这正是 `toStrategyDocument()` 存在的原因；
 *   4. 深链 `strategyVersionPath(id, v)` 能被解析回与 `loadVersion` 完全相同的坐标。
 *
 * 纪律：**全程零写入**（不调 save / createVersion / setVersionStatus / delete），
 * 结尾 `process.exit`（连接池会拖住 event loop）。
 *
 * 重跑：项目根目录 `npx tsx docs/evidence/_e2e_strategy_list_detail.mts`
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { appRouter } from "../../server/routers";
import { strategyVersionPath } from "../../client/src/adapters/strategyCandidateAdapter";
import { STRATEGY_VERSION_STATUS_OPTIONS } from "../../client/src/lib/status";

const OUT = "docs/evidence/_e2e_strategy_list_detail.json";

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const adminUser = {
  id: 1,
  openId: "verify-strategy-split",
  name: "verify-strategy-split",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({
  req: {} as never,
  res: {} as never,
  user: adminUser,
});

const asRec = (v: unknown): Record<string, unknown> =>
  (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;

/** 与详情页 `toStrategyDocument()` 同语义：§17 记录要剥一层 `.strategy`。 */
function toStrategyDocument(raw: unknown): Record<string, unknown> {
  const outer = asRec(raw);
  const inner = outer.strategy;
  if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
    return asRec(inner);
  }
  return outer;
}

/** 列表页 `fmtDate`：只截前 10 位。 */
const fmtDate = (ts: string) => (ts.length >= 10 ? ts.slice(0, 10) : ts);

const STATUSES = new Set<string>(STRATEGY_VERSION_STATUS_OPTIONS);

async function main() {
  try {
    // ---------------------------------------------------------------------
    section("1. 端点存在性（用 _def.procedures，不用属性访问）");
    const procs = Object.keys(appRouter._def.procedures);
    const needed = [
      "research.strategy.list",
      "research.strategy.load",
      "research.strategy.loadVersion",
      "research.strategy.listVersions",
      "research.strategy.validate",
      "research.strategy.save",
      "research.strategy.createVersion",
    ];
    const missing = needed.filter(x => !procs.includes(x));
    check("列表 / 详情用到的 7 个端点全部存在", missing.length === 0, missing.join(", "));

    // ---------------------------------------------------------------------
    section("2. 列表页数据源：字段齐备 + updatedAt 是 UTC 墙钟字符串");
    const list = await caller.research.strategy.list();
    check("list 返回数组且非空", Array.isArray(list) && list.length > 0, `${list.length} 条`);
    const required = ["strategyId", "name", "latestVersion", "status", "updatedAt"];
    const broken = list.filter(r =>
      required.some(k => typeof asRec(r)[k] !== "string" || String(asRec(r)[k]).length === 0)
    );
    check("每行都含 list 页渲染所需的 5 个字段", broken.length === 0, `异常 ${broken.length} 行`);

    const badTs = list.filter(r => !/^\d{4}-\d{2}-\d{2}/.test(String(asRec(r).updatedAt)));
    check(
      "updatedAt 形如 YYYY-MM-DD…（页面只截前 10 位、不做时区换算）",
      badTs.length === 0,
      badTs.length === 0 ? `样例 ${fmtDate(String(asRec(list[0]).updatedAt))}` : `${badTs.length} 行不合形`
    );

    const sorted = [...list].sort((a, b) =>
      asRec(a).updatedAt < asRec(b).updatedAt ? 1 : asRec(a).updatedAt > asRec(b).updatedAt ? -1 : 0
    );
    check(
      "按 updatedAt 降序排序可复现，且首条即最大时间戳",
      sorted.length === list.length &&
        String(asRec(sorted[0]).updatedAt) ===
          String(asRec([...list].sort((a, b) => (asRec(a).updatedAt < asRec(b).updatedAt ? 1 : -1))[0]).updatedAt)
    );

    const badStatus = list.filter(r => !STATUSES.has(String(asRec(r).status)));
    check(
      "所有行的 status 都落在客户端 8 态词表内（StatusBadge 不会拿到未知状态）",
      badStatus.length === 0,
      badStatus.length === 0 ? "" : badStatus.map(r => String(asRec(r).status)).join(", ")
    );

    // ---------------------------------------------------------------------
    section("3. 新建草稿必须清空身份 —— 模板 id 是否真的已在库中");
    const templateId = "limit-up-baseline";
    const collided = list.some(r => String(asRec(r).strategyId) === templateId);
    check(
      `模板 id「${templateId}」已存在于真实库中 ⇒ 新建时清空 strategyId 是必需而非臆测`,
      collided === true,
      collided ? "" : `库中未见 ${templateId}（若确已删除，本判据失去前提）`
    );

    // ---------------------------------------------------------------------
    const target = sorted[0];
    const targetId = String(asRec(target).strategyId);
    const targetLatest = String(asRec(target).latestVersion);
    section(`4. 详情页加载分支：真实策略 ${targetId}@${targetLatest}`);

    const bare = asRec(await caller.research.strategy.load({ strategyId: targetId }));
    check(
      "load → 裸 StrategyDocument（顶层没有 .strategy 外壳）",
      !("strategy" in bare) && typeof bare.strategyId === "string",
      `键 ${Object.keys(bare).length} 个`
    );

    const versions = await caller.research.strategy.listVersions({ strategyId: targetId });
    check("listVersions 至少一版（版本选择器有事可显示）", versions.length > 0, `${versions.length} 版`);

    const firstVersion = String(asRec(versions[0]).version);
    const record = asRec(await caller.research.strategy.loadVersion({ strategyId: targetId, version: firstVersion }));
    check(
      "loadVersion → §17 版本记录（文档在 .strategy 下）",
      typeof record.strategy === "object" && record.strategy !== null,
      `顶层键 ${Object.keys(record).length} 个`
    );

    const unwrapped = toStrategyDocument(record);
    check(
      "剥壳后等价：loadVersion(.strategy) 与 load 指向同一策略",
      String(unwrapped.strategyId) === String(bare.strategyId),
      `${String(unwrapped.strategyId)} vs ${String(bare.strategyId)}`
    );
    check(
      "剥壳后读得出 name / version（否则编辑器会显示空文档）",
      String(unwrapped.name).length > 0 && String(unwrapped.version).length > 0,
      `${String(unwrapped.version)} 名称=${String(unwrapped.name).slice(0, 28)}`
    );

    // ---------------------------------------------------------------------
    section("5. 深链往返：strategyVersionPath → 坐标可被 loadVersion 命中");
    const path = strategyVersionPath(targetId, firstVersion);
    const url = new URL(path, "http://localhost");
    const pathId = decodeURIComponent(url.pathname.replace(/^\/strategies\//, ""));
    const pathVer = url.searchParams.get("version");
    check(
      "路径 = /strategies/:strategyId，版本在 ?version= 上（列表与详情分家后的一致口径）",
      url.pathname.startsWith("/strategies/") && pathId === targetId && pathVer === firstVersion,
      path
    );
    const hit = asRec(
      await caller.research.strategy.loadVersion({ strategyId: pathId, version: String(pathVer) })
    );
    check(
      "按深链解析出的坐标加载，命中的正是同一版本",
      String(asRec(hit.strategy).version) === firstVersion,
      `${pathId}@${String(asRec(hit.strategy).version)}`
    );
  } catch (e) {
    // 🔴 顶层 catch 必须摊开 cause 链（Drizzle 会把真实错误包成 DrizzleQueryError）。
    let cur: unknown = e;
    const chain: string[] = [];
    for (let i = 0; cur && i < 6; i += 1) {
      const rec = asRec(cur);
      chain.push(`${rec.name ?? "Error"}: ${String(rec.message ?? cur).split("\n")[0]}`);
      cur = rec.cause;
    }
    check("探针执行未抛异常", false, chain.join("  ←  "));
  }

  const failed = checks.filter(c => !c.ok);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ total: checks.length, failed: failed.length, checks }, null, 2));
  console.log(`\n总计 ${checks.length} 项，通过 ${checks.length - failed.length}，失败 ${failed.length}`);
  console.log(`报告：${OUT}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
