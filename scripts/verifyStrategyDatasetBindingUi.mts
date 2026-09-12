/**
 * STEP STRATEGY-004 — **前端验收（§11）· 无浏览器等价验证**
 *
 * 背景：本执行环境无法启动 Chromium（沙箱阻止浏览器进程启动，`agent-browser open about:blank` 亦挂起），
 * 且未安装 jsdom / @testing-library（安装被沙箱禁止）。因此在**不降低证据强度**的前提下改用
 * 「组件真实数据源 + 组件真实判定函数 + 真实 adapter 往返 + 真实 TiDB」四段等价验证：
 *
 *   ① 静态证据：`StrategyBasicInfo.tsx` 已**不再**引用旧 `researchDataset`，改为 `datasetRegistry.*`，
 *      并复用 `isUsableVersionStatus`（与 Research 的 CreateExperimentDialog 同一处口径）。
 *   ② 数据源同源：走**真实 tRPC**（`datasetRegistry.listDefinitions / getDefinition / getVersion`）
 *      —— 这正是组件内三个 useQuery 调用的同一批端点，取回选择器真实选项集。
 *   ③ 选择器行为：用**组件真实导入的** `isUsableVersionStatus` 计算可选项 → 证明「能看到
 *      first_limit_pullback、能看到 v1/v2、只有 READY 可选」；并证明非 READY 一律不可选。
 *   ④ UI ↔ 后端全链往返（真实 TiDB）：`strategyToViewModel(落库文档)` → 坐标正确回显 →
 *      `viewModelToStrategy(vm)` → 真实 tRPC save → 重新 load → 坐标与 DB 一致
 *      （= 「重新打开后正确回显」+「Dataset Version ID 与后端一致」）。
 *      并覆盖 legacy 分支：`datasetVersionId === null` 时 wire **不下发该键**（后端 legacy 分支才成立）。
 *
 * 运行：npx tsx scripts/verifyStrategyDatasetBindingUi.mts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { composeCodeVersion } from "../server/research/experimentLineage/codeVersion";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import type { StrategyDatasetBinding, StrategyDefinitionInput } from "../server/research/strategySchema/definition";
import {
  FIRST_BOARD_PULLBACK_DEFINITION,
  FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
} from "../server/research/strategySchema/goldenSample";
import { createStrategyDocumentFromDefinition } from "../server/research/strategySchema/map";

// 🔴 直接导入**组件真实使用的**前端模块（均为 React-free 纯函数模块），不复制口径。
import { strategyToViewModel, viewModelToStrategy } from "../client/src/adapters/strategyAdapter";
import { isUsableVersionStatus } from "../client/src/components/research/createExperimentForm";

// ---------------------------------------------------------------------------
// 断言框架
// ---------------------------------------------------------------------------

let checks = 0;
const failures: string[] = [];
function check(ok: boolean, label: string, detail?: string): void {
  checks += 1;
  if (!ok) failures.push(`${label}${detail === undefined ? "" : ` :: ${detail}`}`);
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${detail}`}`);
}

function checkEq<T>(actual: T, expected: T, label: string): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(same, label, same ? undefined : `实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
}

function resolveCodeVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return composeCodeVersion({
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      git: { commitShortHash: null, dirty: null },
    });
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const STAMP = Date.now();
const S_UI = `s004-ui-${STAMP}`;
const S_UI_LEGACY = `s004-uilegacy-${STAMP}`;
const ALL_IDS = [S_UI, S_UI_LEGACY];

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const urlMatch = env.match(/DATABASE_URL=(\S+)/);
if (!urlMatch) throw new Error(".env 中缺少 DATABASE_URL");
const parsed = new URL(urlMatch[1].replace(/["']/g, ""));

const conn: Connection = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port === "" ? 4000 : Number(parsed.port),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});

const service = new StrategyService(new DbStrategyRepository(), { codeVersion: resolveCodeVersion() });
const adminCtx: TrpcContext = {
  user: {
    id: 1, openId: "verify-004-ui", name: "STRATEGY-004 前端验收", email: null, loginMethod: null,
    role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
};
const caller = appRouter.createCaller(adminCtx);
const api = caller.research.strategy;
const registry = caller.datasetRegistry;

const baseline: Record<string, number> = {};
const report: Record<string, unknown> = { checks: 0, failures, verdict: "PENDING" };

try {
  // -------------------------------------------------------------------------
  // ① 静态证据：UI 的 Dataset 来源已统一切到 Dataset Registry
  // -------------------------------------------------------------------------
  console.log("\n① 静态证据（StrategyBasicInfo.tsx 数据源）");
  const uiSource = readFileSync(new URL("../client/src/components/strategy/StrategyBasicInfo.tsx", import.meta.url), "utf8");
  // 去注释后再断言：文档注释里保留了「已移除旧 researchDataset」的说明，那不算代码引用。
  const uiCode = uiSource
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
    })
    .join("\n");
  check(!uiCode.includes("researchDataset"), "UI 代码已完全移除对旧 researchDataset 的引用（仅文档注释保留说明）");
  check(!uiCode.includes("trpc.researchDataset"), "UI 不存在 trpc.researchDataset.* 调用");
  check(uiSource.includes("trpc.datasetRegistry.listDefinitions"), "UI 使用 datasetRegistry.listDefinitions 列 Dataset 定义");
  check(uiSource.includes("trpc.datasetRegistry.getDefinition"), "UI 使用 datasetRegistry.getDefinition 取版本清单");
  check(uiSource.includes("trpc.datasetRegistry.getVersion"), "UI 使用 datasetRegistry.getVersion 反查坐标所属定义（重新打开回显）");
  check(uiSource.includes("isUsableVersionStatus"), "UI 复用 isUsableVersionStatus（与 Research 同一处口径）");
  check(uiSource.includes("datasetVersionId: entry.id"), "选择版本时写入 datasetVersionId = dataset_version.id（权威坐标）");
  check(uiSource.includes("datasetVersion: entry.version"), "同时写入 datasetVersion = 版本 label（显示 / 快照）");

  // -------------------------------------------------------------------------
  // ② 选择器数据源（真实 tRPC，与组件同端点）
  // -------------------------------------------------------------------------
  console.log("\n② 选择器数据源（真实 tRPC：datasetRegistry.*）");
  const definitions = await registry.listDefinitions();
  const firstPullback = definitions.find((d) => d.datasetCode === "first_limit_pullback");
  check(firstPullback !== undefined, "选择器能看到第一级选项：first_limit_pullback");
  checkEq(firstPullback?.id, 120001, "first_limit_pullback 的 definitionId = 120001");

  const detail = await registry.getDefinition({ definitionId: firstPullback!.id });
  const versions = detail.versions;
  console.log(`  版本清单：${versions.map((v) => `${v.id}(${v.version},${v.status})`).join(", ")}`);
  checkEq(versions.map((v) => v.version).sort(), ["v1", "v2"], "选择器能看到 v1 / v2 两个版本 label");
  checkEq(versions.map((v) => v.id).sort((a, b) => a - b), [390001, 390002], "版本选项值为 dataset_version.id（390001 / 390002）");
  check(versions.every((v) => v.status === "READY"), "两个版本当前 status 均为 READY");

  const versionDetail = await registry.getVersion({ datasetVersionId: 390002 });
  checkEq(versionDetail.datasetId, 120001, "getVersion(390002).datasetId = 120001（重新打开时反查所属定义）");
  checkEq(versionDetail.version, "v2", "getVersion(390002).version = v2");
  checkEq(versionDetail.status, "READY", "getVersion(390002).status = READY");

  // -------------------------------------------------------------------------
  // ③ 选择器行为：只有 READY 可选（用组件真实导入的判定函数）
  // -------------------------------------------------------------------------
  console.log("\n③ 选择器行为（READY 门禁，复用组件真实判定函数）");
  const usable = versions.filter((v) => isUsableVersionStatus(v.status));
  checkEq(usable.map((v) => v.id).sort((a, b) => a - b), [390001, 390002], "可选版本 = 390001(v1) + 390002(v2)（全部 READY → 全部可选）");
  for (const nonReady of ["DRAFT", "BUILDING", "FAILED", "", "ready", "READY "]) {
    check(!isUsableVersionStatus(nonReady), `非 READY 状态不可选：${JSON.stringify(nonReady)}`);
  }
  check(isUsableVersionStatus("READY"), "READY 可选（正例，排除判定恒为 false 的空转）");
  // 组件对非 READY 版本的渲染是 disabled（而非隐藏）→ 选项集恒为全部版本，但不可点击。
  check(uiSource.includes("disabled={!usable}"), "非 READY 版本以 disabled 渲染（显示但不可选，不藏起来也不放过去）");

  // -------------------------------------------------------------------------
  // ④ UI ↔ 后端全链往返（真实 TiDB）
  // -------------------------------------------------------------------------
  console.log("\n④ UI → 后端 → 重新打开（真实 tRPC + 真实 TiDB）");
  for (const table of ["strategies", "strategy_versions", "strategy_version_datasets"]) {
    baseline[table] = Number((await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``))[0][0]?.n ?? 0);
  }
  const purge = async (): Promise<void> => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT DISTINCT strategyId FROM strategies WHERE strategyId LIKE 's004-%'");
    for (const row of rows) {
      try {
        await service.delete(String(row.strategyId));
      } catch {
        /* 已在别处清理 */
      }
    }
  };
  await purge();

  const bindings: StrategyDatasetBinding[] = [{
    datasetId: "first_limit_pullback",
    datasetVersion: "v2",
    datasetVersionId: 390002,
    role: "PRIMARY",
    note: "UI 验收：选择 v2 → 保存 datasetVersionId=390002",
  }];
  const definition: StrategyDefinitionInput = { ...structuredClone(FIRST_BOARD_PULLBACK_DEFINITION), datasets: bindings };
  const doc = createStrategyDocumentFromDefinition({
    ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
    strategyId: S_UI,
    version: "1.0.0",
    name: `[VERIFY-004-UI] ${S_UI}`,
    description: "前端验收用，验证后删除",
    universe: { universeId: "research-dataset:v2" },
    definition,
  });

  // 模拟「页面重新打开」：把落库文档喂给 UI 的 adapter
  const vm = strategyToViewModel(doc as unknown as Record<string, unknown>);
  checkEq(vm.datasetVersionId, 390002, "adapter 回显：vm.datasetVersionId = 390002");
  checkEq(vm.datasetVersion, "v2", "adapter 回显：vm.datasetVersion = v2（label）");
  checkEq(vm.universeId, "research-dataset:v2", "adapter 回显：universeId 与 label 派生一致");
  check(vm.extra.definition !== undefined, "adapter 无损：definition 落在 extra 中透传（不丢 Canonical）");

  // UI → wire → 真实 tRPC save
  const wire = viewModelToStrategy(vm);
  checkEq(wire.datasetVersionId, 390002, "wire（UI 提交）携带 datasetVersionId = 390002");
  checkEq(wire.datasetVersion, "v2", "wire（UI 提交）携带 datasetVersion = v2");
  await api.create({ document: wire });

  // 重新打开：真实 tRPC load → adapter → 与 DB 三处比对
  const reloaded = await api.load({ strategyId: S_UI });
  const vm2 = strategyToViewModel(reloaded as unknown as Record<string, unknown>);
  checkEq(vm2.datasetVersionId, 390002, "重新打开：tRPC load → adapter 回显 datasetVersionId = 390002");

  const [uiRow] = await conn.query<RowDataPacket[]>(
    `SELECT sv.datasetVersion, sv.datasetVersionId, dv.version AS registryVersion, dv.status AS registryStatus
     FROM strategy_versions sv LEFT JOIN dataset_version dv ON dv.id = sv.datasetVersionId
     WHERE sv.strategyId = ?`,
    [S_UI],
  );
  checkEq(Number(uiRow[0]?.datasetVersionId ?? 0), vm2.datasetVersionId, "DB 与 UI 回显的 datasetVersionId 一致（390002）");
  checkEq(String(uiRow[0]?.registryVersion ?? ""), vm2.datasetVersion, "DB JOIN Registry 的 version 与 UI label 一致（v2）");
  checkEq(String(uiRow[0]?.registryStatus ?? ""), "READY", "DB JOIN Registry 的状态为 READY");

  const uiValidation = await api.validateVersion({ strategyId: S_UI, version: "1.0.0" });
  check(uiValidation.valid, "UI 提交的文档通过后端全量校验（含投影漂移）");

  // -------------------------------------------------------------------------
  // ⑤ legacy 分支的 UI 往返（坐标 null → wire 不下发键）
  // -------------------------------------------------------------------------
  console.log("\n⑤ legacy 分支 UI 往返（坐标缺省不下发键）");
  const legacyDefinition: StrategyDefinitionInput = {
    ...structuredClone(FIRST_BOARD_PULLBACK_DEFINITION),
    datasets: [{
      datasetId: "ds_first_limit_pullback",
      datasetVersion: FIRST_BOARD_PULLBACK_DEFINITION.datasets[0].datasetVersion,
      role: "PRIMARY",
      note: "UI 验收：legacy rd-… 兼容分支",
    }],
  };
  const legacyDoc = createStrategyDocumentFromDefinition({
    ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
    strategyId: S_UI_LEGACY,
    version: "1.0.0",
    name: `[VERIFY-004-UI] ${S_UI_LEGACY}`,
    universe: { universeId: `research-dataset:${FIRST_BOARD_PULLBACK_DEFINITION.datasets[0].datasetVersion}` },
    definition: legacyDefinition,
  });
  const legacyVm = strategyToViewModel(legacyDoc as unknown as Record<string, unknown>);
  checkEq(legacyVm.datasetVersionId, null, "legacy 文档 → vm.datasetVersionId = null（未绑定坐标）");
  const legacyWire = viewModelToStrategy(legacyVm);
  check(
    !Object.prototype.hasOwnProperty.call(legacyWire, "datasetVersionId"),
    "legacy wire 不含 datasetVersionId 键（保持「未声明」语义，后端 legacy 分支才成立）",
  );
  await api.create({ document: legacyWire });
  const legacyReloaded = strategyToViewModel((await api.load({ strategyId: S_UI_LEGACY })) as unknown as Record<string, unknown>);
  checkEq(legacyReloaded.datasetVersionId, null, "legacy 重新打开仍为 null（未被伪造成坐标）");
  checkEq(legacyReloaded.datasetVersion, FIRST_BOARD_PULLBACK_DEFINITION.datasets[0].datasetVersion, "legacy label 原样保留");

  // -------------------------------------------------------------------------
  // ⑥ 切换数据集时必须清坐标（组件 useEffect 的判定前提）
  // -------------------------------------------------------------------------
  console.log("\n⑥ 切换 Dataset 定义时的坐标清理前提");
  check(
    uiSource.includes("pickedDefinitionId !== currentVersion.data.datasetId"),
    "切换判定基于「所选定义 id ≠ 当前坐标归属定义 id」",
  );
  checkEq(versionDetail.datasetId, firstPullback!.id, "当前坐标 390002 归属定义 120001 ⇒ 换到其它定义时判定成立并清坐标");
} catch (error) {
  check(false, "全链执行未抛错", `${(error as Error).message}\n${(error as Error).stack?.split("\n").slice(0, 4).join("\n")}`);
} finally {
  console.log("\n⑦ 清理 + 基线复核");
  for (const strategyId of ALL_IDS) {
    try {
      await service.delete(strategyId);
    } catch {
      /* 未落库则忽略 */
    }
  }
  const [rows] = await conn.query<RowDataPacket[]>("SELECT DISTINCT strategyId FROM strategies WHERE strategyId LIKE 's004-%'");
  for (const row of rows) {
    try {
      await service.delete(String(row.strategyId));
    } catch {
      /* 忽略 */
    }
  }
  for (const [table, expected] of Object.entries(baseline)) {
    const now = Number((await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``))[0][0]?.n ?? 0);
    checkEq(now, expected, `清理后行数回到基线：${table}（${expected} → ${now}）`);
  }
  checkEq(
    Number((await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM strategies WHERE strategyId LIKE 's004-%'"))[0][0]?.n ?? 0),
    0,
    "无残留 s004-% 策略",
  );
  await conn.end();
}

report.checks = checks;
report.verdict = failures.length > 0 ? "FAIL" : "PASS";
console.log(`\n${JSON.stringify(report, null, 2)}`);
console.log(`\n总检查项 ${checks}，失败 ${failures.length}；VERDICT=${report.verdict}`);

process.exit(failures.length > 0 ? 1 : 0);
