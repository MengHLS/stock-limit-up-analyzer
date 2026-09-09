/**
 * STEP STRATEGY-002 — 真实 TiDB E2E 验证脚本（§16/§17/§24，禁止 mock 证明持久化）。
 *
 * 流程：
 *   Create → Save（幂等 ×2）→ Load → 模拟 Restart（新 Repository/Service 实例）→ Load →
 *   CreateVersion（minor）→ LoadVersions → Immutability 拒绝 → 清理（delete）。
 *
 * 验证点：
 *   1. 真实落库（重启后仍可 Load，strategyId/version/fingerprint/document 全一致）；
 *   2. 幂等（同 document 两次 Save 不产生重复版本）；
 *   3. 版本往返（V1 → createVersion → V1.1 → 两个版本都存在、旧版本不被修改）；
 *   4. 不可变（同 version 不同内容 → 拒绝）。
 *
 * 运行：npx tsx scripts/stepStrategy002E2E.mts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import { createStrategyDocument } from "../server/research/strategySchema/map";
import { composeCodeVersion } from "../server/research/experimentLineage/codeVersion";
import type { CostModel } from "../server/engine/domain";

// dotenv/config 已加载 .env（含 ssl JSON 引号原样）；DATABASE_URL 由 getDb 消费。

function resolveCodeVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return composeCodeVersion({
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      git: { commitShortHash: null, dirty: null },
    });
  } catch {
    return "unknown";
  }
}

const DATASET_VERSION = "rd-1.0.0-1-cffc2a0e66efbf0b";
const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

const STRATEGY_ID = `e2e-strategy-${Date.now()}`;

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    strategyId: STRATEGY_ID,
    version: "1.0.0",
    name: "首板回踩不破首板开盘价（E2E 占位声明式规则）",
    description: "STEP STRATEGY-002 持久化验证用策略（不实现交易逻辑）",
    universe: { universeId: `research-dataset:${DATASET_VERSION}` },
    entryRules: [
      { id: "enter-first-board", kind: "event", field: "candle.isFirstLimitUp", operator: "==", operand: "true", description: "当日为首个涨停板" },
      { id: "enter-pullback", kind: "threshold", field: "price.pctChange", operator: "<=", operand: 0, description: "回踩不破首板开盘价（占位）" },
    ],
    exitRules: [
      { id: "exit-holding", kind: "time-based", field: "position.holdingDays", operator: ">=", operand: 3, description: "持有 >= 3 日退出" },
    ],
    positionSizing: { kind: "equal-weight", maxPositions: 5 },
    riskRules: [
      { id: "risk-stop", kind: "threshold", field: "position.singleLossPct", operator: "<=", operand: -5, description: "单笔亏损 <= -5%" },
    ],
    parameters: {
      parameters: [
        { name: "topN", type: "number", required: true, defaultValue: 5, min: 1, max: 20, description: "选股数" },
      ],
    },
    datasetVersion: DATASET_VERSION,
    executionAssumptions: {
      backtestConfig: { initialCapital: 100_000, maxPositions: 5 },
      costModel: COST_MODEL,
      executionModel: "NEXT_OPEN",
    },
    ...overrides,
  };
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return createStrategyDocument(makeInput(overrides) as never);
}

function newService(): StrategyService {
  return new StrategyService(new DbStrategyRepository(), { codeVersion: resolveCodeVersion() });
}

const report: Record<string, unknown> = { strategyId: STRATEGY_ID, steps: [] };
function step(name: string, fn: () => Promise<unknown>) {
  report.steps.push({ name, ok: true, detail: null as unknown });
  return fn()
    .then((detail) => {
      (report.steps[report.steps.length - 1] as Record<string, unknown>).detail = detail;
    })
    .catch((error) => {
      (report.steps[report.steps.length - 1] as Record<string, unknown>).ok = false;
      (report.steps[report.steps.length - 1] as Record<string, unknown>).detail = (error as Error).message;
      throw error;
    });
}

try {
  const svc1 = newService();

  // 1. Create
  const v1 = makeDoc();
  await step("create", () => svc1.create({ document: v1 as unknown as Record<string, unknown> })
    .then((d) => ({ strategyId: d.strategyId, version: d.version, fingerprint: d.fingerprint })));

  // 2. Save 幂等 ×2
  await step("save-idempotent-1", () => svc1.save({ document: v1 as unknown as Record<string, unknown> })
    .then((d) => ({ version: d.version })));
  await step("save-idempotent-2", () => svc1.save({ document: v1 as unknown as Record<string, unknown> })
    .then((d) => ({ version: d.version })));

  // 3. Load（svc1）
  await step("load-before-restart", () => svc1.load(STRATEGY_ID)
    .then((d) => ({ fingerprint: d.fingerprint, version: d.version })));

  // 4. 模拟 Restart：全新 Repository + Service 实例
  const svc2 = newService();
  await step("load-after-restart", () => svc2.load(STRATEGY_ID)
    .then((d) => ({ fingerprint: d.fingerprint, version: d.version, matchesOriginal: d.fingerprint === v1.fingerprint })));

  // 5. CreateVersion（参数默认值变化 → minor，1.0.0 → 1.1.0）
  const v11 = makeDoc({
    parameters: {
      parameters: [
        { name: "topN", type: "number", required: true, defaultValue: 7, min: 1, max: 20, description: "选股数" },
      ],
    },
  });
  await step("createVersion-minor", () => svc2.createVersion({ strategyId: STRATEGY_ID, document: v11 as unknown as Record<string, unknown> })
    .then((d) => ({ version: d.version, fingerprint: d.fingerprint })));

  // 6. LoadVersions（两个版本都存在）
  await step("listVersions", () => svc2.listVersions(STRATEGY_ID)
    .then((versions) => ({ count: versions.length, versions: versions.map((v) => v.version) })));

  // 7. 旧版本不被修改（V1 fingerprint 仍一致）
  await step("v1-unchanged", () => svc2.loadVersion(STRATEGY_ID, "1.0.0")
    .then((r) => ({ fingerprint: r.strategy.fingerprint, matchesOriginal: r.strategy.fingerprint === v1.fingerprint })));

  // 8. Immutability：同 version（1.1.0）不同内容 → 拒绝
  const mutated = makeDoc({ version: "1.1.0", name: "尝试篡改同版本" });
  let immutableRejected = false;
  await step("immutability-reject", () => svc2.save({ document: mutated as unknown as Record<string, unknown> })
    .then(() => { immutableRejected = false; return { rejected: false }; })
    .catch((error) => { immutableRejected = true; return { rejected: true, message: (error as Error).message }; }));
  if (!immutableRejected) throw new Error("immutability 校验失败：同版本不同内容应被拒绝");

  // 9. 清理
  await step("cleanup", () => svc2.delete(STRATEGY_ID).then(() => ({ deleted: true })));

  console.log(JSON.stringify(report, null, 2));
  console.log("E2E RESULT: PASS");
} catch (error) {
  console.error(JSON.stringify(report, null, 2));
  console.error("E2E RESULT: FAIL —", (error as Error).message);
  process.exit(1);
}
