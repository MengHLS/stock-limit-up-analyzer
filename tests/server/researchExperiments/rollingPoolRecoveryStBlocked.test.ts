/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004` · **ST 覆盖守卫**（`ST_COVERAGE_BLOCKED`）契约测试。
 *
 * ⚠️ **纯合成 fixture**：不读真实 Dataset、**不连 DB**、不跑 Run、不产出收益矩阵。
 *
 * ## 它钉住的是什么（本轮的**主交付物**）
 *
 * S1 审计判定 ST 逐日状态源不可 PIT 核验（E1/E2/E3），因此目标 §4 的默认条款是
 * **暂停收益矩阵、先交付覆盖缺口**。这条纪律只有被**真的执行**才算数，所以这里断言：
 *
 * 1. provider 缺省（`ABSENT_STATUS_PROVIDER`，恒返回 `null`）⇒ **早诊断**路径
 *    （FIX-005 / F3）：只做事件扫描、**不读任何 post rd≥1**，Run 的终态仍是
 *    **`ST_COVERAGE_BLOCKED`**；
 * 2. 缺口摘要**如实标记「未测」**：provider 身份缺失、探针全 `NO_STATUS_PROVIDER`，
 *    而未扫描的候选数 / 覆盖分母一律 `null`（**不是 0**）；
 * 3. **不产出任何交易 / 权益 / 收益结果**：没有交易表、没有权益图、收益类统计一律 `null`
 *    （**不是 0**），`eligibleCount = 0`；
 * 4. 覆盖缺口**真的落盘为产物**：`st-coverage-gap-summary.json` + `st-early-diagnostic.json`
 *    + `status-coverage.csv`（未测 ⇒ 0 数据行，**不伪造** NORMAL 区间）+ `st-coverage-counts.csv`
 *    + `st-gap-samples.csv` + `frozen-config.json`；
 * 5. 闸门位置正确：早诊断路线**不调用 `freezeSelection`**、不解析证券身份（DB）、不撮合
 *    ⇒ 本测试无需 DB、无需行情即可跑完。
 *
 * 🔴 「已实测」的暂停路径（provider 存在但结论不可核验）与「未测」路径**共用**同一个
 *    `assembleRecoveryStBlockedResult`：本文件末尾用**直接调用**钉住已实测路径的计数语义
 *    （`resolveStatusProvider()` 恒为 `null` ⇒ 实测路径在 `run()` 里当前不可达）。
 *
 * 🔴 反向的「正对照」（全时点可核验 ⇒ `ST_COVERAGE_VERIFIED`）在闸门纯函数层测试
 *    （`stCoverageReportLiteral` + `summarizeStCoverage`）；成交前拒单的真实撮合验收在
 *    `rollingPoolRecoveryStExecutionGate.test.ts`。真跑通非暂停路径需要
 *    Security Master / 真实 ST 源，那属于 S4/S5。
 */

import { describe, expect, it } from "vitest";
import type {
  ExperimentArtifactFileSpec,
  ExperimentBarRow,
  ExperimentDatasetAccess,
  ExperimentEventRow,
  ExperimentResultPayload,
  ExperimentRunContext,
} from "../../../shared/researchExperimentsContracts";
import {
  ABSENT_STATUS_PROVIDER_ID,
  ST_COVERAGE_BLOCKED,
  ST_GATE_CONTRACT_VERSION,
} from "../../../research-experiments/shared/rollingPoolRecovery";
import {
  COMPUTATION_VERSION,
  RECOVERY_ST_BLOCKED_ARTIFACTS,
  assembleRecoveryStBlockedResult,
  recoveryStCustomPayloadSchema,
  resolveRunMode,
} from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/result";
import { rollingPoolRecoveryStExperiment } from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment";

// ---------------------------------------------------------------------------
// 合成 fixture：一个首板事件 + rd1..80 的行情（足够让**价格信号在 rd7 成立**）
// ---------------------------------------------------------------------------

const SYMBOL = "000001.SZ";
const EVENT_DATE = "2024-01-02";
const EVENT_ID = `${SYMBOL}@${EVENT_DATE}`;
/** 事件日开盘 `O_0 = 10` ⇒ 原支撑线 `0.98·O_0 = 9.8`；事件日成交量 `V_0 = 1000`。 */
const EVENT_OPEN = 10;
const EVENT_VOLUME = 1_000;

function shiftDate(isoDate: string, days: number): string {
  const base = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** 相对日 ⇒ 交易日（rd0 = 事件日；测试里用自然日推进，只要求**有序且唯一**）。 */
function tradeDateOf(relativeDay: number): string {
  return shiftDate(EVENT_DATE, relativeDay);
}

function barRow(relativeDay: number, values: Record<string, number | boolean | string | null>): ExperimentBarRow {
  return {
    relativeDay,
    tradeDate: tradeDateOf(relativeDay),
    eventId: EVENT_ID,
    symbol: SYMBOL,
    values,
  };
}

/**
 * 基线 post bar：低点 9.95（≥ 9.8 支撑线，**全程不破位**）、收盘 9.96、量 400。
 *
 * ⇒ 原分支每日 `S = 3`（守线 + 缩量 + 低点稳定；收盘不变 ⇒ `closeImprove = 0`），
 *   前五日（rd2..rd6）逐日 ≥3 ⇒ rd7 具备确认资格。
 */
function postValues(relativeDay: number): Record<string, number | boolean | string | null> {
  const breakout = relativeDay === 7;
  return {
    open: 10,
    high: breakout ? 10.1 : 10.01,
    low: 9.95,
    close: breakout ? 10.06 : 9.96,
    preClose: 9.96,
    limitUpPrice: 11,
    limitDownPrice: 9,
    volume: 400,
    amount: 5_000,
    barPresent: true,
    suspensionStatus: "NORMAL",
    canBuyAtOpen: true,
    canSellAtClose: true,
  };
}

function prefixRows(): ExperimentBarRow[] {
  return [
    barRow(-10, {
      open: 9.4, high: 9.6, low: 9.4, close: 9.5, preClose: 9.4,
      limitUpPrice: 11, limitDownPrice: 9, volume: 300, amount: 3_000,
      barPresent: true, suspensionStatus: "NORMAL", canBuyAtOpen: true, canSellAtClose: true,
    }),
    barRow(-1, {
      open: 9.6, high: 9.9, low: 9.6, close: 9.8, preClose: 9.5,
      limitUpPrice: 11, limitDownPrice: 9, volume: 350, amount: 3_500,
      barPresent: true, suspensionStatus: "NORMAL", canBuyAtOpen: true, canSellAtClose: true,
    }),
    barRow(0, {
      open: EVENT_OPEN, high: 10.2, low: 9.8, close: 10, preClose: 9.9,
      limitUpPrice: 11, limitDownPrice: 9, volume: EVENT_VOLUME, amount: 10_000,
      barPresent: true, suspensionStatus: "NORMAL", canBuyAtOpen: true, canSellAtClose: true,
    }),
  ];
}

function eventRow(): ExperimentEventRow {
  return {
    relativeDay: 0,
    tradeDate: EVENT_DATE,
    eventId: EVENT_ID,
    symbol: SYMBOL,
    values: { isFirstLimit: true, boardType: "main", market: "SZ" },
  };
}

interface SyntheticState {
  readonly frozenEventIds: string[][];
  readonly observationRelativeDays: number[];
  observationBeforeFreezeCount: number;
}

interface SyntheticPort {
  readonly access: ExperimentDatasetAccess;
  readonly state: SyntheticState;
  markFrozen(eventIds: readonly string[]): void;
}

/** 合成数据集访问面：只有一个事件；`observation()` 在 `freezeSelection` 之前被调用即响亮计数。 */
function syntheticAccess(args: { readonly postMaxRelativeDay: number }): SyntheticPort {
  const state: SyntheticState = {
    frozenEventIds: [],
    observationRelativeDays: [],
    observationBeforeFreezeCount: 0,
  };
  let frozen = false;

  const access: ExperimentDatasetAccess = {
    facts: {
      datasetVersionId: 780_004,
      datasetCode: "first_limit_pullback",
      datasetName: "synthetic-fixture",
      datasetVersionLabel: "v10-listed365-pre10-post80",
      status: "READY",
      startDate: EVENT_DATE,
      endDate: shiftDate(EVENT_DATE, args.postMaxRelativeDay),
      totalEvents: 1,
      postRelativeDayRange: { min: 1, max: args.postMaxRelativeDay },
    },
    events: async (): Promise<readonly ExperimentEventRow[]> => [eventRow()],
    eventPages: async function* (): AsyncIterable<readonly ExperimentEventRow[]> {
      yield [eventRow()];
    },
    feature: async (relativeDay: number): Promise<readonly ExperimentBarRow[]> =>
      prefixRows().filter((row) => row.relativeDay === relativeDay),
    observation: async (relativeDay: number): Promise<readonly ExperimentBarRow[]> => {
      if (!frozen) state.observationBeforeFreezeCount += 1;
      state.observationRelativeDays.push(relativeDay);
      return [barRow(relativeDay, postValues(relativeDay))];
    },
  };

  return {
    access,
    state,
    markFrozen: (eventIds: readonly string[]): void => {
      frozen = true;
      state.frozenEventIds.push([...eventIds]);
    },
  };
}

interface RunHarness {
  readonly payload: ExperimentResultPayload;
  readonly artifacts: readonly ExperimentArtifactFileSpec[];
  readonly logs: readonly string[];
  readonly frozenEventIds: readonly string[][];
  readonly observationRelativeDays: readonly number[];
  readonly observationBeforeFreezeCount: number;
}

async function runBlockedFixture(
  parameters: Record<string, number>,
): Promise<RunHarness> {
  const synthetic = syntheticAccess({ postMaxRelativeDay: 80 });
  const artifacts: ExperimentArtifactFileSpec[] = [];
  const logs: string[] = [];

  const context = {
    descriptor: rollingPoolRecoveryStExperiment.descriptor,
    codeDigest: "test-code-digest",
    protocol: null,
    parameters,
    dataset: synthetic.access,
    datasets: { primary: synthetic.access },
    freezeSelection: (eventIds: readonly string[]): void => {
      synthetic.markFrozen(eventIds);
    },
    log: (message: string): void => {
      logs.push(message);
    },
    artifact: (spec: ExperimentArtifactFileSpec): void => {
      artifacts.push(spec);
    },
  } as unknown as ExperimentRunContext;

  // 🔴 关键：Run **必须正常返回**（不抛异常）—— 抛异常会让平台丢弃全部产物，
  //    「先交付覆盖缺口」就落不了盘（见 result.ts 的暂停终态说明）。
  const payload = await rollingPoolRecoveryStExperiment.run(context);
  return {
    payload,
    artifacts,
    logs,
    frozenEventIds: synthetic.state.frozenEventIds,
    observationRelativeDays: synthetic.state.observationRelativeDays,
    observationBeforeFreezeCount: synthetic.state.observationBeforeFreezeCount,
  };
}

function customOf(payload: ExperimentResultPayload): Record<string, unknown> {
  return payload.customPayload as Record<string, unknown>;
}

const ARTIFACT_NAME_PATTERN = /trades|equity|random|chains|attribution|entry-path|stage-performance|checkpoint/i;

// ---------------------------------------------------------------------------
// 1) 终态与计数
// ---------------------------------------------------------------------------

describe("1) 缺省 provider ⇒ 终态 ST_COVERAGE_BLOCKED（带缺口计数）", () => {
  it("Run 正常返回显式暂停终态：status/matrixEmitted/eligibleCount 三项一致", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const custom = customOf(harness.payload);

    expect(custom.status).toBe(ST_COVERAGE_BLOCKED);
    expect(custom.matrixEmitted).toBe(false);
    expect(custom.primaryComparison).toBeNull();
    expect(harness.payload.sampleSummary.eligibleCount).toBe(0);
    // 样本账必须平（否则 Runner 的信封校验会拒绝，把「如实暂停」变成「结果不可读」）
    const summary = harness.payload.sampleSummary;
    expect(summary.eligibleCount + summary.excludedCount).toBe(summary.candidateCount);
    expect(Object.values(summary.excludedByReason).reduce((sum, value) => sum + value, 0))
      .toBe(summary.excludedCount);
    // 报告自己也要能被本实验的 schema 校验通过
    const parsed = recoveryStCustomPayloadSchema.safeParse(custom);
    expect(parsed.success).toBe(true);
  });

  it("缺口摘要**如实标记未测**（计数 null、provider 缺失、探针全 NO_STATUS_PROVIDER）", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const custom = customOf(harness.payload);
    const blocked = custom.stCoverageBlocked as Record<string, unknown>;
    expect(blocked).toBeTruthy();

    // 🔴 FIX-005 / F3：provider 明确缺失 ⇒ 未测（不是 0）。
    expect(blocked.measurement).toBe("NOT_SCANNED_PROVIDER_ABSENT");
    expect(blocked.plannedCandidateCount).toBeNull();
    expect(blocked.unknownBlockedCandidateCount).toBeNull();
    expect(blocked.fullyVerifiedNormalCandidateCount).toBeNull();
    expect(blocked.candidatesWithoutPlannedFillCount).toBeNull();
    expect(blocked.unknownBlockedCandidateCountByGroup).toBeNull();
    expect(blocked.plannedCandidateCountByGroup).toBeNull();
    expect(blocked.priceStateCountsByGroup).toBeNull();
    // 覆盖分母同样是**未测**（不是 0 缺口）
    expect(blocked.timepointChecks).toBeNull();
    expect(blocked.unknownTimepointCheckCount).toBeNull();
    expect(blocked.verifiedNormalTimepointCheckCount).toBeNull();
    expect(blocked.stRejectedTimepointCheckCount).toBeNull();
    expect(blocked.unknownByTimepoint).toBeNull();
    expect(blocked.unknownByReason).toBeNull();
    expect(blocked.gapSampleCount).toBeNull();
    // 未扫描 ⇒ 观察池计数也未测；但**事件扫描**是真做过的
    expect(blocked.watchPoolEventCount).toBeNull();
    expect(blocked.watchPoolDecisionDateCount).toBeNull();
    expect(typeof blocked.scannedEventCount).toBe("number");
    // 缺失的 provider 身份（**可核验 = false**）与真实探针
    expect(blocked.providerId).toBe(ABSENT_STATUS_PROVIDER_ID);
    expect(blocked.providerVerifiable).toBe(false);
    expect(blocked.providerProbeCount).toBeGreaterThan(0);
    expect(blocked.providerProbeUnknownCount).toBe(blocked.providerProbeCount);
    expect((blocked.blockedReasons as unknown[]).length).toBeGreaterThan(0);
    // 刻意未产出的读数必须逐条列出（避免被误读成 0）
    expect((blocked.notEmittedMetrics as unknown[]).length).toBeGreaterThan(0);
  });

  it("🔴 未测 ≠ 0：未扫描的计数在产物与信封里都是 null，而不是 0", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const custom = customOf(harness.payload);
    const blocked = custom.stCoverageBlocked as Record<string, unknown>;
    for (const key of [
      "plannedCandidateCount", "unknownBlockedCandidateCount", "timepointChecks", "unknownTimepointCheckCount",
    ]) {
      expect(blocked[key], key).toBeNull();
      expect(blocked[key], key).not.toBe(0);
    }
    // 统计行同样是 null（value: 0 会被读成「查过了、没有缺口」）
    const statistics = harness.payload.statistics ?? [];
    const planned = statistics.find((row) => row.code === "plannedCandidateCount")!;
    expect(planned.value).toBeNull();
    expect(planned.note).toContain("未测");
    // 早诊断产物显式列出未测清单
    const diagnostic = JSON.parse(
      String(harness.artifacts.find((file) => file.name === "st-early-diagnostic.json")!.body),
    ) as Record<string, unknown>;
    expect(diagnostic.measurement).toBe("NOT_SCANNED_PROVIDER_ABSENT");
    const unscanned = diagnostic.unscanned as Record<string, unknown>;
    expect(unscanned.plannedCandidateCount).toBeNull();
    expect(unscanned.coverageDenominator).toBeNull();
    const scanPlan = diagnostic.scanPlan as Record<string, unknown>;
    expect(scanPlan.postRelativeDayReads).toEqual([]);
    expect(scanPlan.selectionFrozen).toBe(false);
    expect(scanPlan.matchingExecuted).toBe(false);
  });

  it("价格观察历史**不被 ST 抹掉**：本路径未扫描 ⇒ 分布记「未测」而非空的 0 桶", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const custom = customOf(harness.payload);
    const blocked = custom.stCoverageBlocked as Record<string, unknown>;
    // 未读 post rd≥1 ⇒ 无法、也不得给出逐日价格状态分布（0 桶会被读成「查过了全无信号」）
    expect(blocked.priceStateCountsByGroup).toBeNull();
    // 价格状态与买入资格正交这一定性结论由规则层测试钉住（day14 = SIGNAL_FORMED + ST_BLOCKED）。
  });

  it("SMOKE 参数只改账户坐标、不改变暂停终态（6 账户）", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const custom = customOf(harness.payload);
    const runMode = custom.runMode as Record<string, unknown>;
    expect(runMode.mode).toBe("SMOKE");
    expect(runMode.totalAccountCount).toBe(6);
    expect((custom.frozenConfig as Record<string, unknown>).runMode).toBe("SMOKE");
  });
});

// ---------------------------------------------------------------------------
// 2) 不产出任何交易 / 权益 / 收益结果
// ---------------------------------------------------------------------------

describe("2) 暂停终态**不产出**交易 / 权益 / 收益结果", () => {
  it("没有交易与权益表、没有权益图；收益类统计一律 value = null（不是 0）", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const tables = harness.payload.tables ?? [];
    const charts = harness.payload.charts ?? [];

    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.key, `表 ${table.key} 不应是交易/权益表`).not.toMatch(/trade|equity|random|chain/i);
    }
    expect(charts).toHaveLength(0);

    const statistics = harness.payload.statistics ?? [];
    const emittedWithValue = statistics.filter((row) => row.value !== null);
    // 有值的只允许是「缺口 / 状态」类计数，绝不允许收益 / 尾率 / 回撤类读数。
    for (const row of emittedWithValue) {
      expect(row.code).toMatch(
        /^(stCoverageBlocked|matrixEmitted|plannedCandidateCount|unknownBlockedCandidateCount|unknownTimepointChecks|providerProbeUnknownCount)$/,
      );
    }
    const notEmitted = statistics.filter((row) => row.code.startsWith("notEmitted_"));
    expect(notEmitted.length).toBeGreaterThan(0);
    expect(notEmitted.every((row) => row.value === null)).toBe(true);
    expect(notEmitted.every((row) => (row.note ?? "").includes("未产出"))).toBe(true);
  });

  it("customPayload 里没有账户指标 / 尾块 / 覆盖率读数（groups 为空数组）", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const custom = customOf(harness.payload);
    expect(custom.groups).toEqual([]);
    expect(custom.stCoverage).toBeTruthy();
    // 结果结构里没有任何「交易台账 / 权益曲线」字段
    expect(Object.keys(custom)).not.toContain("equityCurves");
    expect(Object.keys(custom)).not.toContain("accounts");
    // 🔴 主靶分母（共同锚点宇宙）**未计算** ⇒ 必须是 `null`，**不是 0**：
    //    `0` 会被读成「查过了、没有共同锚点」，而事实是 ST 闸门在任何撮合之前就停了 Run。
    expect(custom.commonAnchorUniverseSize).toBeNull();
    expect(custom.commonAnchorUniverseSize).not.toBe(0);
    // 契约层同样钉住：`null` 只在暂停终态合法 —— 非暂停分支仍要求整数（不被放宽成 `number | null`）。
    expect(recoveryStCustomPayloadSchema.safeParse(custom).success).toBe(true);
    expect(
      recoveryStCustomPayloadSchema.safeParse({ ...custom, status: "ST_COVERAGE_VERIFIED" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3) 覆盖缺口真的落盘为产物（而且**只有**缺口产dust）
// ---------------------------------------------------------------------------

describe("3) 覆盖缺口落盘：只有缺口产物，**没有**交易 / 权益产物", () => {
  it("交付 6 份缺口产物（含早诊断 JSON 与 status-coverage.csv）", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const names = harness.artifacts.map((file) => file.name).sort();
    expect(names).toEqual([
      "frozen-config.json",
      "st-coverage-counts.csv",
      "st-coverage-gap-summary.json",
      "st-early-diagnostic.json",
      "st-gap-samples.csv",
      "status-coverage.csv",
    ]);
    for (const name of names) {
      expect(name, `${name} 不应是交易 / 权益 / S5 明细产物`).not.toMatch(ARTIFACT_NAME_PATTERN);
    }
    // 声明与交付一致（名单即契约）
    const custom = customOf(harness.payload);
    const manifest = (custom.artifactManifest as { name: string }[]).map((row) => row.name).sort();
    expect(manifest).toEqual(names);
    expect(RECOVERY_ST_BLOCKED_ARTIFACTS.map((spec) => spec.name).sort()).toEqual(names);
  });

  it("缺口摘要 JSON 显式声明状态、未测语义与缺失 provider（不静默）", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const summaryFile = harness.artifacts.find((file) => file.name === "st-coverage-gap-summary.json")!;
    const body = JSON.parse(String(summaryFile.body)) as Record<string, unknown>;
    expect(body.status).toBe(ST_COVERAGE_BLOCKED);
    expect(body.matrixEmitted).toBe(false);
    expect(body.measurement).toBe("NOT_SCANNED_PROVIDER_ABSENT");
    const counts = body.counts as Record<string, unknown>;
    expect(counts.measurement).toBe("NOT_SCANNED_PROVIDER_ABSENT");
    expect(counts.plannedCandidateCount).toBeNull();
    expect(counts.unknownBlockedCandidateCount).toBeNull();
    expect(counts.unknownTimepointChecks).toBeNull();
    expect(counts.postRelativeDaysRead).toEqual([]);
    expect(typeof counts.scannedEventCount).toBe("number");
    const provider = body.provider as Record<string, unknown>;
    expect(provider.providerId).toBe(ABSENT_STATUS_PROVIDER_ID);
    expect(provider.configured).toBe(false);
    expect(provider.providerVerifiable).toBe(false);
    expect((provider.probes as unknown[]).length).toBeGreaterThan(0);
  });

  it("status-coverage.csv：未测 ⇒ 0 数据行（既不伪造 NORMAL，也不伪造 0 缺口）", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const coverageFile = harness.artifacts.find((file) => file.name === "status-coverage.csv")!;
    const text = String(coverageFile.body);
    const lines = text.split("\n");
    expect(lines[0]).toContain("outcome");
    expect(lines[0]).toContain("availableAsOf");
    expect(lines[0]).toContain("evidenceFingerprint");
    expect(lines[0]).toContain("measurement");
    // 未扫描 ⇒ 没有任何检查点行。**0 行 = 未测**，不是「查过了全是 NORMAL」。
    const dataLines = lines.slice(1).filter((line) => line.length > 0);
    expect(dataLines).toHaveLength(0);
    expect(text).not.toContain("NORMAL");
  });

  it("st-coverage-counts.csv：未测行 + 已实测的事件扫描账（两类 scope 分开）", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const countsFile = harness.artifacts.find((file) => file.name === "st-coverage-counts.csv")!;
    const text = String(countsFile.body);
    expect(text).toContain("EARLY_DIAGNOSTIC,NOT_SCANNED_PROVIDER_ABSENT");
    expect(text).toContain("note");
    // 未测行的计数列必须留空（不是 0）
    const diagnosticLine = text.split("\n").find((line) => line.includes("EARLY_DIAGNOSTIC"))!;
    expect(diagnosticLine).toContain(",,,,,,,");
  });
});

// ---------------------------------------------------------------------------
// 4) 闸门位置与 provider 注入点（结构级）
// ---------------------------------------------------------------------------

describe("4) 闸门排在 DB（身份解析）之前 ⇒ 本测试能无 DB 跑完闸门", () => {
  it("早诊断路线不冻结样本、不读 post rd≥1、不解析身份、不撮合", async () => {
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    // 走到这里就说明闸门在身份解析之前（`resolveRollingPoolSecurityIds` 需要 Security Master）。
    expect(customOf(harness.payload).status).toBe(ST_COVERAGE_BLOCKED);
    // 🔴 FIX-005 / F3：provider 明确缺失 ⇒ **不读**任何 rd≥1 观察数据（不再重复全量扫描 post80）
    expect(harness.observationRelativeDays).toHaveLength(0);
    expect(harness.frozenEventIds).toHaveLength(0);
    expect(harness.observationBeforeFreezeCount).toBe(0);
    // 日志里必须留下可追溯的闸门结论
    expect(harness.logs.some((line) => line.includes(ST_COVERAGE_BLOCKED))).toBe(true);
    expect(harness.logs.some((line) => line.includes("早诊断"))).toBe(true);
  });

  it("provider 注入点显式：缺省 = 无非 PIT 可核验源（不是「按 NORMAL 兜底」）", async () => {
    // 契约常量必须与闸门一致（FIX-005 / F2 起 = 1.1.0：区间语义变更 ⇒ 显式升版）
    expect(ST_GATE_CONTRACT_VERSION).toBe("1.1.0");
    expect(ABSENT_STATUS_PROVIDER_ID).toBe("ABSENT_STATUS_PROVIDER");
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const custom = customOf(harness.payload);
    const provider = custom.stProvider as Record<string, unknown>;
    expect(provider.providerId).toBe(ABSENT_STATUS_PROVIDER_ID);
    expect(provider.verifiable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5) 已实测路径的计数器语义（直接组装；`resolveStatusProvider()` 恒 null ⇒ run() 里不可达）
// ---------------------------------------------------------------------------

describe("5) 已实测暂停路径：同一组装函数给出**真实计数**（不是 null）", () => {
  it("measurement=MEASURED 时计数照原样进入信封、产物与 schema", async () => {
    // 复用真实 Run 产出的 frozenConfig（避免在测试里重抄一遍冻结常量）。
    const harness = await runBlockedFixture({ randomAccountCount: 2 });
    const baseFrozenConfig = customOf(harness.payload).frozenConfig;
    const measured = {
      measurement: "MEASURED" as const,
      status: "ST_COVERAGE_BLOCKED" as const,
      contractVersion: ST_GATE_CONTRACT_VERSION,
      providerId: "TEST_MEASURED",
      candidateCount: 2,
      timepointChecks: 4,
      verifiedNormalCount: 1,
      stRejectedCount: 1,
      unknownCount: 2,
      unknownByTimepoint: { CONFIRM_CLOSE_ELIGIBILITY: 1, PRE_FILL: 1 },
      unknownByReason: { NO_STATUS_FACT: 2 },
      gapSamples: [
        {
          anchorEventId: EVENT_ID,
          symbol: SYMBOL,
          group: "A_STRICT_20",
          tradeDate: EVENT_DATE,
          timepoint: "PRE_FILL" as const,
          reason: "NO_STATUS_FACT" as const,
        },
      ],
      blocked: true,
      note: "已实测（provider 存在但结论不可核验）。",
    };
    const payload = assembleRecoveryStBlockedResult({
      computationVersion: COMPUTATION_VERSION,
      runMode: resolveRunMode(2),
      frozenConfig: baseFrozenConfig,
      providerId: "TEST_MEASURED",
      providerVerifiable: false,
      providerContractVersion: ST_GATE_CONTRACT_VERSION,
      providerProbeCount: 4,
      providerProbeUnknownCount: 4,
      stCoverage: measured,
      plannedCandidateCount: 2,
      candidatesWithPlannedFillCount: 2,
      candidatesWithoutPlannedFillCount: 0,
      unknownBlockedCandidateCount: 2,
      fullyVerifiedNormalCandidateCount: 0,
      stRejectedCandidateCount: 1,
      unknownBlockedCandidateCountByGroup: { A_STRICT_20: 1, B_RECOVERY_20: 1 },
      plannedCandidateCountByGroup: { A_STRICT_20: 1, B_RECOVERY_20: 1 },
      priceStateCountsByGroup: { A_STRICT_20: { SIGNAL_FORMED: 40 }, B_RECOVERY_20: { SIGNAL_FORMED: 40 } },
      scannedEventCount: 2,
      watchPoolEventCount: 1,
      watchPoolDecisionDateCount: 40,
      excludedByReason: { NOT_FIRST_LIMIT: 1 },
      blockedReasons: ["计划检查时点缺可核验结论"],
      notes: ["单元测试：已实测路径的计数语义。"],
    });
    const custom = payload.customPayload as Record<string, unknown>;
    const blocked = custom.stCoverageBlocked as Record<string, unknown>;
    expect(blocked.measurement).toBe("MEASURED");
    expect(blocked.plannedCandidateCount).toBe(2);
    expect(blocked.unknownBlockedCandidateCount).toBe(2);
    expect(blocked.timepointChecks).toBe(4);
    expect(blocked.unknownTimepointCheckCount).toBe(2);
    expect(blocked.unknownByReason).toEqual({ NO_STATUS_FACT: 2 });
    expect(blocked.watchPoolEventCount).toBe(1);
    expect(blocked.gapSampleCount).toBe(1);
    // schema 双向钉住：已实测路径的 null 会被拒（避免「偷懒全填 null」）
    expect(recoveryStCustomPayloadSchema.safeParse(custom).success).toBe(true);
    const tampered = {
      ...custom,
      stCoverageBlocked: { ...blocked, plannedCandidateCount: null },
    };
    expect(recoveryStCustomPayloadSchema.safeParse(tampered).success).toBe(false);
    // 样本账仍然平
    const summary = payload.sampleSummary;
    expect(summary.eligibleCount + summary.excludedCount).toBe(summary.candidateCount);
    expect(Object.values(summary.excludedByReason).reduce((sum, value) => sum + value, 0))
      .toBe(summary.excludedCount);
  });
});
