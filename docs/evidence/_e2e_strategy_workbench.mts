/**
 * 探针：策略详情页（`/strategies/:strategyId`，旧地址 `/strategy-editor` 已改为兼容跳转）
 * 的真实链路验收 —— 零写入、只读。
 *
 * 为什么需要它：本机 `agent-browser` 不可用、仓库也没有 jsdom / @testing-library，
 * 「页面真的接上了后端」无法靠渲染测试证明。退而求其次且**更强**的做法是：
 * 用真实 `appRouter.createCaller` 走「tRPC → Service → Repository → TiDB」，
 * 并把页面**同一套 React-free 纯函数**（`strategyAdapter`）拉进来一起跑。
 *
 * 本探针只验证重设计**新接上的那几条链路**（都是既有端点，不新增任何端点）：
 *   1. 端点存在性（用 `_def.procedures` 而非属性访问 —— 访问不存在的 procedure 会触发
 *      未处理的 Promise rejection，见 PROJECT_RULES「真实 tRPC 全链 E2E」）；
 *   2. `research.strategy.list` / `listVersions` 的真实形状（页头选择器 + 版本历史的数据源）；
 *      🔴 关键：**`load` 返回裸 StrategyDocument，而 `loadVersion` 返回 §17 版本记录
 *      （文档在 `.strategy` 下）** —— 两者混用会把外壳当文档、字段全部读空。这里把它钉死。
 *   3. `compare` 的「无改动」判据（版本与状态页签的差异对比依赖它）；
 *   4. 编辑器往返：`strategyToViewModel → viewModelToStrategy` 在**真实文档**上无损
 *      （否则「比较」会把纯噪声报成改动）；
 *   5. 客户端状态词表 ↔ 后端契约：下拉里的 8 个状态后端真会接受。
 *
 * 纪律：**全程零写入**（不调 setVersionStatus / save / createVersion），
 * 结尾 `process.exit`（连接池会拖住 event loop）。
 *
 * 重跑：项目根目录 `npx tsx docs/evidence/_e2e_strategy_workbench.mts`
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { appRouter } from "../../server/routers";
import {
  strategyToViewModel,
  viewModelToStrategy,
} from "../../client/src/adapters/strategyAdapter";
import { STRATEGY_VERSION_STATUS_OPTIONS } from "../../client/src/lib/status";
import {
  STRATEGY_LIFECYCLE_STATUS_VALUES,
  strategySetVersionStatusInputSchema,
} from "../../shared/researchContracts";

const OUT = "docs/evidence/_e2e_strategy_workbench.json";

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
  openId: "verify-strategy-workbench",
  name: "verify-strategy-workbench",
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

try {
  // -------------------------------------------------------------------------
  section("1. 端点存在性（页面实际调用的每一个）");
  const procedures = Object.keys(appRouter._def.procedures);
  for (const p of [
    "research.strategy.list",
    "research.strategy.listVersions",
    "research.strategy.load",
    "research.strategy.loadVersion",
    "research.strategy.compare",
    "research.strategy.setVersionStatus",
  ]) {
    check(`端点存在 ${p}`, procedures.includes(p));
  }

  // -------------------------------------------------------------------------
  section("2. 客户端状态词表 ↔ 后端契约（下拉选项后端真会接受）");
  check(
    "客户端顺序常量 == shared 权威值",
    JSON.stringify([...STRATEGY_VERSION_STATUS_OPTIONS]) ===
      JSON.stringify([...STRATEGY_LIFECYCLE_STATUS_VALUES]),
    `${STRATEGY_VERSION_STATUS_OPTIONS.length} 项`
  );
  const rejected = STRATEGY_VERSION_STATUS_OPTIONS.filter(
    s =>
      !strategySetVersionStatusInputSchema.safeParse({
        strategyId: "probe",
        version: "1.0.0",
        status: s,
      }).success
  );
  check(
    "8 个状态全部通过 setVersionStatus 入参契约",
    rejected.length === 0,
    rejected.length ? `被拒：${rejected.join(",")}` : ""
  );

  // -------------------------------------------------------------------------
  section("3. list / listVersions 真实形状（页头选择器 + 版本历史数据源）");
  const strategies = await caller.research.strategy.list();
  check("list 返回数组", Array.isArray(strategies), `共 ${strategies.length} 条`);
  console.log(
    `  策略：${strategies.map(s => `${s.strategyId}@${s.latestVersion}(${s.status})`).join("、") || "(无)"}`
  );

  const withVersions = strategies.filter(s => s.strategyId && s.latestVersion);
  check(
    "至少 1 条可用于「加载并运行」的策略（strategyId + latestVersion 齐备）",
    withVersions.length > 0,
    `可用 ${withVersions.length} / 共 ${strategies.length}`
  );

  if (withVersions.length === 0) {
    console.log("\n⚠️ 库里没有可加载策略 —— 后续「加载 / 比较」断言无法执行（属数据缺失，不记 FAIL）。");
  } else {
    const target = withVersions[0]!;
    const versions = await caller.research.strategy.listVersions({
      strategyId: target.strategyId,
    });
    check("listVersions 返回非空数组", versions.length > 0, `共 ${versions.length} 个版本`);

    const badStatus = versions.filter(
      v => !STRATEGY_LIFECYCLE_STATUS_VALUES.includes(v.status as never)
    );
    check(
      "版本行的 status 全部落在 §23 八态内（否则页头徽标会落到灰）",
      badStatus.length === 0,
      badStatus.length ? badStatus.map(v => `${v.version}=${v.status}`).join(",") : ""
    );
    const missingFields = versions.filter(
      v => typeof v.fingerprint !== "string" || typeof v.createdAt !== "string"
    );
    check(
      "版本行带 fingerprint / createdAt（版本历史表要显示）",
      missingFields.length === 0
    );

    // -----------------------------------------------------------------------
    section("4. 🔴 load vs loadVersion 的返回形态差异（归一逻辑的正确性依据）");
    const latestDoc = await caller.research.strategy.load({
      strategyId: target.strategyId,
    });
    const latestRec = asRec(latestDoc);
    check(
      "load → 裸 StrategyDocument（顶层直接有 strategyId / version）",
      typeof latestRec.strategyId === "string" && typeof latestRec.version === "string",
      `strategyId=${String(latestRec.strategyId)} version=${String(latestRec.version)}`
    );
    check(
      "load 的返回值**没有** .strategy 外壳",
      latestRec.strategy === undefined
    );

    const rec = await caller.research.strategy.loadVersion({
      strategyId: target.strategyId,
      version: target.latestVersion,
    });
    const recWrap = asRec(rec);
    const nested = asRec(recWrap.strategy);
    check(
      "loadVersion → §17 版本记录（文档在 .strategy 下）",
      typeof nested.strategyId === "string" && typeof nested.version === "string",
      `record 顶层键：${Object.keys(recWrap).slice(0, 6).join(",")}…`
    );

    // 关键：两条路的文档必须**逐字节等价** ⇒ 页面把 `.strategy` 剥出来就是对的。
    const sameDoc = await caller.research.strategy.compare({
      left: latestDoc,
      right: nested,
    });
    check(
      "load 的文档 == loadVersion(.strategy) 的文档（剥壳后等价）",
      sameDoc.equal === true,
      sameDoc.equal ? "" : `差异 ${sameDoc.differences.length} 处`
    );

    // -----------------------------------------------------------------------
    section("5. compare 的「无改动」判据（版本与状态页签的差异对比依赖它）");
    const selfCmp = await caller.research.strategy.compare({
      left: nested,
      right: nested,
    });
    check("同一文档自比 → equal=true", selfCmp.equal === true);

    const mutated = { ...nested, name: `${String(nested.name)}__probe` };
    const mutCmp = await caller.research.strategy.compare({
      left: nested,
      right: mutated,
    });
    check(
      "改一个字段 → equal=false 且能定位到 name",
      mutCmp.equal === false &&
        mutCmp.differences.some(d => String(d.path).includes("name")),
      `差异 ${mutCmp.differences.length} 处`
    );

    // -----------------------------------------------------------------------
    section("6. 编辑器往返：真实文档 → ViewModel → 文档（无损）");
    const vm = strategyToViewModel(nested);
    const roundTrip = viewModelToStrategy(vm);
    const rtCmp = await caller.research.strategy.compare({
      left: nested,
      right: roundTrip,
    });
    check(
      "往返后 compare.equal=true（否则「比较」会把噪声报成改动）",
      rtCmp.equal === true,
      rtCmp.equal
        ? ""
        : `差异 ${rtCmp.differences.length} 处：${rtCmp.differences
            .slice(0, 4)
            .map(d => d.path)
            .join(", ")}`
    );
    const k1 = Object.keys(nested).sort().join(",");
    const k2 = Object.keys(roundTrip).sort().join(",");
    check("往返后顶层键集合不变", k1 === k2, k1 === k2 ? `${Object.keys(nested).length} 键` : `左 ${k1} / 右 ${k2}`);
    check(
      "往返保留 fingerprint 与 version（compare 恰好忽略的两项，单独钉住）",
      roundTrip.fingerprint === nested.fingerprint &&
        roundTrip.version === nested.version
    );
    check(
      "ViewModel 读出了关键字段（页头/编辑器真的有事可显示）",
      vm.strategyId === String(nested.strategyId) &&
        vm.version === String(nested.version) &&
        vm.name.length > 0,
      `${vm.strategyId}@${vm.version} 名称=${vm.name} 入场规则=${vm.entryRules.length}`
    );
  }
} catch (e) {
  // 🔴 顶层 catch 必须摊开 cause 链（Drizzle 会把真实错误包成 DrizzleQueryError）。
  let cur: unknown = e;
  const chain: string[] = [];
  for (let i = 0; cur && i < 6; i += 1) {
    const c = asRec(cur);
    chain.push(
      `${(cur as Error).constructor?.name ?? typeof cur}: ${String(c.code ?? c.errno ?? "")} ${String((cur as Error).message ?? cur).slice(0, 300)}`
    );
    cur = c.cause;
  }
  check("探针整体执行未抛错", false, chain.join("  ⇒  "));
  console.log("\n错误链：\n  " + chain.join("\n  ⇒ "));
}

// ---------------------------------------------------------------------------
const failed = checks.filter(c => !c.ok);
console.log(
  `\n===== ${checks.length - failed.length}/${checks.length} PASS =====`
);
if (failed.length > 0) {
  console.log("失败项：");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ at: new Date().toISOString(), checks }, null, 2),
  "utf8"
);
console.log(`\n证据已写入 ${OUT}`);

process.exit(failed.length > 0 ? 1 : 0);
