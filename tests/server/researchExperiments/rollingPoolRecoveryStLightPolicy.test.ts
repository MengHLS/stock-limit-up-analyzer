/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` §5.1 —— **轻量 ST 政策与最小执行契约兼容**验收。
 *
 * ⚠️ **纯合成 fixture**：不读真实 Dataset、不连 DB、不跑 Run、不产出收益矩阵。
 *
 * ## 为什么必须走真实撮合
 *
 * 只断言「政策函数返回 allowed=true」**不算**验收：纯函数判 true 与「订单真的成交、
 * 现金真的被扣、审计真的记 UNKNOWN」是两件事。因此本文件：
 *
 *   - 用**研究装配层的真实闸门实现** `createKnownStOnlyEligibilityGate(index)`
 *     （= `experiment.ts` 注入执行层的那个对象）；
 *   - 经**服务侧唯一封装** `sealRollingPoolExecutionDataset` + 真实 `runTradeSimulation` 走完整撮合链；
 *   - 断言交易台账 / 现金 / 持仓 / 费用 / 成交计数 / 逐笔执行资格审计。
 *
 * ## 本文件锁定的行为（§5.1）
 *
 * 1. **显式轻量模式**：`UNKNOWN` 能在**真实撮合链**成交，且审计**保留 `UNKNOWN`**（不改写 NORMAL）；
 * 2. **缺省严格**：同一份 `UNKNOWN` 判决在**没有**显式声明时仍被拒单；
 * 3. **两种模式已知 ST ⇒ 零买入**；隔夜 ST / 重试 / 再入场都能真实拒单，
 *    且拒单后**现金 / 仓位 / 成本 / 成功入场次数不变**；
 * 4. **成交前变化不回写排名**：确认日 `UNKNOWN`（可参与）与成交日 `KNOWN_ST`（拒单）并存；
 * 5. **仓位使用同日当前权益快照**（`EQUITY_FRACTION`），不是初始资金的固定 20%。
 */

import { describe, expect, it } from "vitest";
import type { CostModel } from "../../../server/engine/domain";
import type { ResearchDataset } from "../../../server/researchDataset/types";
import { runTradeSimulation } from "../../../server/research/simulator/engine";
import {
  assertValidSimulationConfig,
  validateSimulationConfig,
} from "../../../server/research/simulator/validate";
import type {
  ExecutionEligibilityAuditEntry,
  SimulationConfig,
  TradeSimulationRun,
} from "../../../server/research/simulator/types";
import { evaluateCandidateRun } from "../../../server/research/signalEngine/evaluate";
import { computeCandidateEvaluationRunFingerprint } from "../../../server/research/signalEngine/serialize";
import type {
  CandidateDayRecord,
  CandidateEvaluationRun,
  PositionIntent,
  SelectedCandidate,
} from "../../../server/research/signalEngine/types";
import {
  sealRollingPoolExecutionDataset,
  type RollingPoolExecutionRowInput,
} from "../../../server/researchExperiments/rollingPoolExecutionSupport";
import {
  KNOWN_ST_ONLY_ELIGIBILITY_POLICY_ID,
  KNOWN_ST_ONLY_POLICY_VERSION,
  ST_POLICY_DEFAULT_VALUE,
  ST_POLICY_PARAMETER_VALUES,
  STRICT_ELIGIBILITY_POLICY_ID,
  UNKNOWN_ALLOWED_THIS_ROUND_NOTE,
  decideKnownStOnlyEligibility,
  decideStrictEligibility,
  resolveStEligibilityPolicy,
  type KnownStLabelIndexPort,
  type KnownStLabelObservation,
} from "../../../research-experiments/shared/rollingPoolRecovery";
import {
  ST_KNOWN_ST_ONLY_EXECUTION_ELIGIBILITY_GATE_ID,
  createKnownStOnlyEligibilityGate,
} from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment";
import { assembleRecoveryStResult } from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/result";

// ---------------------------------------------------------------------------
// 合成标签索引（**不连 DB**；与 `server/researchExperiments/knownStLabelIndex.ts` 同形状）
// ---------------------------------------------------------------------------

interface IntervalSpec {
  readonly symbol: string;
  readonly status: "ST" | "NORMAL";
  readonly from: string;
  readonly to: string | null;
}

/** 显式声明无法解析身份的 symbol（模拟 ST 来源映射缺口）。 */
const UNRESOLVABLE_SYMBOLS = new Set<string>(["999999.SZ"]);

function syntheticIndex(specs: readonly IntervalSpec[]): KnownStLabelIndexPort {
  const lookup = (input: { readonly symbol: string; readonly checkDate: string }): KnownStLabelObservation => {
    if (UNRESOLVABLE_SYMBOLS.has(input.symbol)) {
      return {
        symbol: input.symbol,
        checkDate: input.checkDate,
        kind: "UNKNOWN",
        reason: "IDENTITY_UNRESOLVED",
        securityId: null,
        fact: null,
      };
    }
    for (const spec of specs) {
      if (spec.symbol !== input.symbol) continue;
      if (input.checkDate < spec.from) continue;
      if (spec.to !== null && input.checkDate > spec.to) continue;
      return {
        symbol: input.symbol,
        checkDate: input.checkDate,
        kind: spec.status === "ST" ? "KNOWN_ST" : "EXPLICIT_NORMAL",
        reason: spec.status === "ST"
          ? "KNOWN_ST_INTERVAL_COVERS_CHECK_DATE"
          : "EXPLICIT_NORMAL_INTERVAL_COVERS_CHECK_DATE",
        securityId: `sec_${spec.symbol}`,
        fact: {
          statusValue: spec.status,
          effectiveFrom: spec.from,
          effectiveTo: spec.to,
          source: "TEST_SYNTHETIC_LABEL_INDEX",
          confidence: "medium",
          availability: "UNKNOWN",
          retrievedAt: null,
          evidenceFingerprint: `test:${spec.symbol}:${spec.status}:${spec.from}..${spec.to ?? "null"}`,
        },
      };
    }
    return {
      symbol: input.symbol,
      checkDate: input.checkDate,
      kind: "UNKNOWN",
      reason: "NO_STATUS_FACT",
      securityId: `sec_${input.symbol}`,
      fact: null,
    };
  };
  return {
    sourceId: "TEST_SYNTHETIC_LABEL_INDEX",
    sourceFingerprint: "test-source-fingerprint",
    rowCount: specs.length,
    securityCount: new Set(specs.map((spec) => spec.symbol)).size,
    identifierRowCount: 1,
    availabilityCounts: { UNKNOWN: specs.length },
    confidenceCounts: { medium: specs.length },
    explicitNormalRowCount: specs.filter((spec) => spec.status === "NORMAL").length,
    tablesRead: ["TEST_SYNTHETIC_LABEL_INDEX"],
    lookup,
  };
}

// ---------------------------------------------------------------------------
// 撮合 fixture（与 `rollingPoolRecoveryStExecutionGate.test.ts` 同形的紧凑版）
// ---------------------------------------------------------------------------

const COST_ZERO: CostModel = {
  commissionRate: 0,
  stampDutyRate: 0,
  transferFeeRate: 0,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 0,
};

const D0 = "2024-03-01";
const D1 = "2024-03-04";
const D2 = "2024-03-05";
const D3 = "2024-03-06";
const D4 = "2024-03-07";
const D5 = "2024-03-08";
const DATES: readonly string[] = [D0, D1, D2, D3, D4, D5];

const SYMBOL_A = "000001.SZ";
const SYMBOL_B = "000002.SZ";
const SEC_A = `sec_a::event:${SYMBOL_A}@${D0}`;
const SEC_B = `sec_b::event:${SYMBOL_B}@${D0}`;

function row(args: {
  readonly date: string;
  readonly securityId: string;
  readonly open: number;
}): RollingPoolExecutionRowInput {
  const close = args.open + 0.4;
  return {
    tradeDate: args.date,
    securityId: args.securityId,
    code: "000001.SZ",
    exchange: "SZ",
    open: args.open,
    high: Math.max(args.open, close) + 0.1,
    low: Math.min(args.open, close) - 0.1,
    close,
    preClose: args.open,
    volume: 1_000_000,
    amount: null,
    barPresent: true,
    suspended: false,
  };
}

function defaultRows(): RollingPoolExecutionRowInput[] {
  return [
    ...DATES.map((date, index) => row({ date, securityId: SEC_A, open: 10 + index * 2 })),
    ...DATES.map((date, index) => row({ date, securityId: SEC_B, open: 20 + index * 2 })),
  ];
}

function sealDataset(rows: readonly RollingPoolExecutionRowInput[]): ResearchDataset {
  return sealRollingPoolExecutionDataset({
    name: "light-st-007-test",
    startDate: D0,
    endDate: D5,
    datasetVersionId: 780_004,
    rows,
    tradingDates: [...DATES],
  });
}

interface DaySpec {
  readonly date: string;
  readonly intents: readonly { readonly securityId: string; readonly value: number }[];
}

function buildSourceRun(args: {
  readonly dataset: ResearchDataset;
  readonly days: readonly DaySpec[];
}): CandidateEvaluationRun {
  const dayRecords: CandidateDayRecord[] = args.days.map((day) => {
    const selected: SelectedCandidate[] = day.intents.map((intent, index) => ({
      securityId: intent.securityId,
      rank: index + 1,
      percentile: day.intents.length === 0 ? 0 : 1 - index / day.intents.length,
      value: intent.value,
    }));
    const positionIntents: PositionIntent[] = day.intents.map((intent, index) => ({
      securityId: intent.securityId,
      direction: "long",
      rank: index + 1,
      percentile: day.intents.length === 0 ? 0 : 1 - index / day.intents.length,
      weight: day.intents.length === 0 ? 0 : 1 / day.intents.length,
      signalValue: intent.value,
      confidence: null,
    }));
    return {
      date: day.date,
      universeMembers: day.intents.map((intent) => intent.securityId).sort(),
      signalCount: day.intents.length,
      dropped: [],
      selected,
      positionIntents,
    };
  });
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    recordKind: "CANDIDATE_EVALUATION_RUN",
    recordVersion: 1,
    datasetVersion: args.dataset.datasetVersion,
    builderVersion: "light-st-007-test-1.0.0",
    rowSchemaVersion: "light-st-007-test-1.0.0",
    datasetGate: args.dataset.gate,
    universeId: `light-st-007-test:${args.dataset.datasetVersion}`,
    strategyId: "study-light-st-007-test",
    strategyVersion: "1.0.0",
    parameters: { topK: 3 },
    dateRange: {
      startDate: args.days[0]!.date,
      endDate: args.days[args.days.length - 1]!.date,
    },
    point: "close",
    signalDescription: "light-st-007 test fixture",
    featureVersions: [{ featureId: "preReturn10", version: "1.0.0" }],
    rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    selectionConfig: { method: { kind: "topN", n: 3 } },
    days: dayRecords,
    evaluation: evaluateCandidateRun(dayRecords),
  };
  return { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) };
}

function simConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    initialCapital: 100_000,
    cost: COST_ZERO,
    maxPositions: 5,
    maxDailyBuys: 2,
    positionSizing: { sizingMethod: "EQUITY_FRACTION", fraction: 0.2, fixedAmount: null },
    dateRange: { startDate: D0, endDate: D5 },
    candidateExitPolicy: "DISABLED",
    ...overrides,
  };
}

function runOf(args: {
  readonly index: KnownStLabelIndexPort;
  readonly days: readonly DaySpec[];
  readonly simConfig?: Partial<SimulationConfig>;
}): TradeSimulationRun {
  const dataset = sealDataset(defaultRows());
  return runTradeSimulation({
    dataset,
    sourceRun: buildSourceRun({ dataset, days: args.days }),
    simConfig: simConfig(args.simConfig),
  });
}

function auditOf(run: TradeSimulationRun): readonly ExecutionEligibilityAuditEntry[] {
  return run.executionEligibilityAudit ?? [];
}

/** 轻量闸门 + **显式**声明 UNKNOWN 放行（= 本轮实验注入执行层的**同一个**配置）。 */
function lightSimConfig(
  index: KnownStLabelIndexPort,
  overrides: Partial<SimulationConfig> = {},
): Partial<SimulationConfig> {
  return {
    executionEligibilityGate: createKnownStOnlyEligibilityGate({ index }),
    executionEligibilityUnknownPolicy: "ALLOW_WHEN_DECISION_ALLOWS",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1) 政策本体：三态行为表（目标 §4 逐字）
// ---------------------------------------------------------------------------

describe("1) 轻量政策本体：已知 ST 排除 / 明确 NORMAL 参与 / UNKNOWN 本轮允许", () => {
  it("缺省解析 = 严格；`known-st-only` 才是本轮探索性变体；非法值抛错", () => {
    expect(resolveStEligibilityPolicy(undefined).id).toBe(STRICT_ELIGIBILITY_POLICY_ID);
    expect(resolveStEligibilityPolicy(ST_POLICY_DEFAULT_VALUE).strictDefault).toBe(true);
    expect(resolveStEligibilityPolicy("known-st-only").id).toBe(KNOWN_ST_ONLY_ELIGIBILITY_POLICY_ID);
    expect(resolveStEligibilityPolicy("known-st-only").version).toBe(KNOWN_ST_ONLY_POLICY_VERSION);
    expect(resolveStEligibilityPolicy("known-st-only").exploratory).toBe(true);
    expect(resolveStEligibilityPolicy("known-st-only").strictDefault).toBe(false);
    expect([...ST_POLICY_PARAMETER_VALUES]).toEqual(["strict", "known-st-only"]);
    expect(() => resolveStEligibilityPolicy("loose")).toThrow(/未知 ST 资格政策/u);
    expect(() => resolveStEligibilityPolicy(1)).toThrow(/未知 ST 资格政策/u);
  });

  it("行为表逐字：ST ⇒ 不参与 + 不放行；NORMAL ⇒ 参与 + 放行；UNKNOWN ⇒ 参与 + 放行（注明本轮允许）", () => {
    const index = syntheticIndex([
      { symbol: SYMBOL_A, status: "ST", from: D1, to: D5 },
      { symbol: SYMBOL_B, status: "NORMAL", from: D0, to: D5 },
    ]);
    const st = decideKnownStOnlyEligibility({ index, symbol: SYMBOL_A, checkDate: D2 });
    expect(st.status).toBe("ST");
    expect(st.participatesInRanking).toBe(false);
    expect(st.allowedToExecute).toBe(false);
    expect(st.observation.fact?.evidenceFingerprint).toBe(`test:${SYMBOL_A}:ST:${D1}..${D5}`);
    // 🔴 来源的 availability / confidence **原样保留**（本轮不升级为 PIT 证据、不修改它们）。
    expect(st.observation.fact?.availability).toBe("UNKNOWN");
    expect(st.observation.fact?.confidence).toBe("medium");

    const normal = decideKnownStOnlyEligibility({ index, symbol: SYMBOL_B, checkDate: D2 });
    expect(normal.status).toBe("NORMAL");
    expect(normal.participatesInRanking).toBe(true);
    expect(normal.allowedToExecute).toBe(true);

    const unknown = decideKnownStOnlyEligibility({ index, symbol: SYMBOL_A, checkDate: D0 });
    expect(unknown.status).toBe("UNKNOWN");
    expect(unknown.reason).toBe("UNKNOWN_ALLOWED_THIS_ROUND:NO_STATUS_FACT");
    expect(unknown.participatesInRanking).toBe(true);
    expect(unknown.allowedToExecute).toBe(true);
    expect(unknown.note).toBe(UNKNOWN_ALLOWED_THIS_ROUND_NOTE);
    // 🔴 缺席 ⇒ UNKNOWN（**绝不**派生成 NORMAL）。
    expect(unknown.observation.kind).toBe("UNKNOWN");
  });

  it("身份无法解析 ⇒ UNKNOWN（ST 来源映射缺口），且**不凭空生成** securityId", () => {
    const index = syntheticIndex([]);
    const decision = decideKnownStOnlyEligibility({ index, symbol: "999999.SZ", checkDate: D2 });
    expect(decision.status).toBe("UNKNOWN");
    expect(decision.observation.reason).toBe("IDENTITY_UNRESOLVED");
    expect(decision.observation.securityId).toBeNull();
    expect(decision.allowedToExecute).toBe(true);
  });

  it("严格政策本体：只认可核验 NORMAL（ST / UNKNOWN 均不参与、不放行）", () => {
    const strictNormal = decideStrictEligibility({
      outcome: "NORMAL", reason: "VERIFIED_NORMAL", observation: null,
    });
    expect(strictNormal.participatesInRanking).toBe(true);
    expect(strictNormal.exploratory).toBe(false);
    const strictUnknown = decideStrictEligibility({
      outcome: "UNKNOWN", reason: "NO_STATUS_PROVIDER", observation: null,
    });
    expect(strictUnknown.participatesInRanking).toBe(false);
    expect(strictUnknown.allowedToExecute).toBe(false);
    const strictSt = decideStrictEligibility({
      outcome: "ST", reason: "VERIFIED_ST", observation: null,
    });
    expect(strictSt.participatesInRanking).toBe(false);
    expect(strictSt.allowedToExecute).toBe(false);
  });

  it("成交前变化**不回写排名**：确认日 UNKNOWN（可参与）与成交日 KNOWN_ST（拒单）并存", () => {
    const index = syntheticIndex([{ symbol: SYMBOL_A, status: "ST", from: D2, to: D5 }]);
    const confirm = decideKnownStOnlyEligibility({ index, symbol: SYMBOL_A, checkDate: D1 });
    const preFill = decideKnownStOnlyEligibility({ index, symbol: SYMBOL_A, checkDate: D2 });
    expect(confirm.status).toBe("UNKNOWN");
    expect(confirm.participatesInRanking).toBe(true);
    expect(preFill.status).toBe("ST");
    expect(preFill.allowedToExecute).toBe(false);
    // 同一次确认日查找的结果与「成交日是否 ST」无关（纯函数、只按 checkDate）。
    expect(decideKnownStOnlyEligibility({ index, symbol: SYMBOL_A, checkDate: D1 }).status).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// 2) 真实撮合链：UNKNOWN 成交（显式） vs 缺省 REJECT
// ---------------------------------------------------------------------------

describe("2) 真实撮合链：显式声明后 UNKNOWN 能成交；缺省严格仍拒单", () => {
  it("显式 `ALLOW_WHEN_DECISION_ALLOWS` ⇒ 真实成交，且逐笔审计**保留 UNKNOWN**", () => {
    const index = syntheticIndex([]); // 无任何记录 ⇒ 全部 UNKNOWN
    const run = runOf({
      index,
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: lightSimConfig(index),
    });
    expect(run.trades).toHaveLength(1);
    expect(run.trades[0]!.entryTime).toBe(D1);
    expect(run.executionStats.totalFills).toBe(1);
    const audit = auditOf(run);
    expect(audit).toHaveLength(1);
    // 🔴 真实状态保留：UNKNOWN，**绝不**改写为 NORMAL。
    expect(audit[0]!.status).toBe("UNKNOWN");
    expect(audit[0]!.reason).toBe("UNKNOWN_ALLOWED_THIS_ROUND:NO_STATUS_FACT");
    expect(audit[0]!.outcome).toBe("FILLED");
    expect(audit[0]!.gateId).toBe(ST_KNOWN_ST_ONLY_EXECUTION_ELIGIBILITY_GATE_ID);
    expect(audit[0]!.policyVersion).toBe(KNOWN_ST_ONLY_POLICY_VERSION);
    expect(audit[0]!.checkedAt).toBe(`${D1}T09:15:00`);
    // 配置快照记录**显式**声明（与严格快照不是同一份配置）。
    expect(run.config.executionEligibility).toEqual({
      gateId: ST_KNOWN_ST_ONLY_EXECUTION_ELIGIBILITY_GATE_ID,
      policyVersion: KNOWN_ST_ONLY_POLICY_VERSION,
      unknownPolicy: "ALLOW_WHEN_DECISION_ALLOWS",
    });
    expect(run.finalEquity).not.toBe(100_000);
  });

  it("同一闸门但**不声明** unknown 政策 ⇒ 缺省 REJECT，UNKNOWN 被拒且资金/仓位/成本/成交计数不变", () => {
    const index = syntheticIndex([]);
    const run = runOf({
      index,
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { executionEligibilityGate: createKnownStOnlyEligibilityGate({ index }) },
    });
    expect(run.trades).toHaveLength(0);
    expect(run.positions).toHaveLength(0);
    expect(run.executionStats.totalFills).toBe(0);
    expect(run.executionStats.rejectedOrders).toBe(1);
    expect(run.costs.totalCost).toBe(0);
    expect(run.finalEquity).toBe(100_000);
    for (const point of run.equityCurve) {
      expect(point.cash).toBe(100_000);
      expect(point.openPositions).toBe(0);
    }
    const audit = auditOf(run);
    expect(audit[0]!.status).toBe("UNKNOWN");
    expect(audit[0]!.outcome).toBe("REJECTED");
    // 缺省 ⇒ 快照**不出现** unknownPolicy 键（既有精确断言不被打扰）。
    expect(run.config.executionEligibility).toEqual({
      gateId: ST_KNOWN_ST_ONLY_EXECUTION_ELIGIBILITY_GATE_ID,
      policyVersion: KNOWN_ST_ONLY_POLICY_VERSION,
    });
  });

  it("已知 ST ⇒ **零买入**（即使显式放宽 UNKNOWN，ST 仍恒拒绝）", () => {
    const index = syntheticIndex([{ symbol: SYMBOL_A, status: "ST", from: D1, to: D5 }]);
    const run = runOf({
      index,
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: lightSimConfig(index),
    });
    expect(run.trades).toHaveLength(0);
    expect(run.executionStats.totalFills).toBe(0);
    expect(run.executionStats.rejectedOrders).toBe(1);
    expect(run.costs.totalCost).toBe(0);
    expect(run.finalEquity).toBe(100_000);
    const audit = auditOf(run);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.status).toBe("ST");
    expect(audit[0]!.reason).toBe("KNOWN_ST_RECORD_EXCLUDED");
    expect(audit[0]!.outcome).toBe("REJECTED");
  });

  it("闸门自称 allowed=true 但 status=UNKNOWN 且未声明放宽 ⇒ 仍拒单（失败关闭）", () => {
    const contradictory: SimulationConfig["executionEligibilityGate"] = {
      gateId: "TEST_UNKNOWN_ALLOWED_NO_DECLARATION",
      policyVersion: "test/1.0.0",
      decideBuy: () => ({
        allowed: true,
        status: "UNKNOWN",
        reason: "UNKNOWN_ALLOWED_THIS_ROUND:NO_STATUS_FACT",
        providerId: "TEST",
        policyVersion: "test/1.0.0",
        evidenceFingerprint: null,
        checkedAt: `${D1}T09:15:00`,
        plannedCheckDate: D0,
      }),
    };
    const index = syntheticIndex([]);
    const run = runOf({
      index,
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { executionEligibilityGate: contradictory },
    });
    expect(run.trades).toHaveLength(0);
    expect(auditOf(run)[0]!.outcome).toBe("REJECTED");
  });

  it("ST 恒拒绝：闸门自称 allowed=true 且 status=ST ⇒ 拒单；显式放宽后亦然", () => {
    const contradictorySt: SimulationConfig["executionEligibilityGate"] = {
      gateId: "TEST_ST_ALLOWED",
      policyVersion: "test/1.0.0",
      decideBuy: () => ({
        allowed: true,
        status: "ST",
        reason: "KNOWN_ST_RECORD_EXCLUDED",
        providerId: "TEST",
        policyVersion: "test/1.0.0",
        evidenceFingerprint: null,
        checkedAt: `${D1}T09:15:00`,
        plannedCheckDate: D0,
      }),
    };
    const index = syntheticIndex([]);
    const variants: readonly Partial<SimulationConfig>[] = [
      { executionEligibilityGate: contradictorySt },
      { executionEligibilityGate: contradictorySt, executionEligibilityUnknownPolicy: "ALLOW_WHEN_DECISION_ALLOWS" },
    ];
    for (const variant of variants) {
      const run = runOf({
        index,
        days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
        simConfig: variant,
      });
      expect(run.trades).toHaveLength(0);
      expect(run.finalEquity).toBe(100_000);
      expect(auditOf(run)[0]!.outcome).toBe("REJECTED");
      expect(auditOf(run)[0]!.status).toBe("ST");
    }
  });
});

// ---------------------------------------------------------------------------
// 3) 拒单的账目不变性：隔夜 ST / 重试 / 再入场
// ---------------------------------------------------------------------------

describe("3) 拒单不改账：隔夜 ST / 重试 / 再入场都能真实拒单", () => {
  it("隔夜转 ST：确认日 UNKNOWN（参与）、成交日已知 ST ⇒ 拒单，现金/仓位/成本/成交计数全不变", () => {
    const index = syntheticIndex([{ symbol: SYMBOL_A, status: "ST", from: D1, to: D5 }]);
    const run = runOf({
      index,
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: lightSimConfig(index),
    });
    expect(run.executionStats.totalFills).toBe(0);
    expect(run.executionStats.rejectedOrders).toBe(1);
    expect(run.trades).toHaveLength(0);
    expect(run.positions).toHaveLength(0);
    expect(run.costs.totalCost).toBe(0);
    expect(run.finalEquity).toBe(100_000);
    expect(auditOf(run)[0]!.executionDate).toBe(D1);
    expect(auditOf(run)[0]!.plannedDate).toBe(D0);
  });

  it("重试：同锚点两日意图，第一日被拒 ⇒ 第二日独立复查并按当日状态判决", () => {
    const index = syntheticIndex([
      { symbol: SYMBOL_A, status: "ST", from: D1, to: D2 },
      { symbol: SYMBOL_A, status: "NORMAL", from: D3, to: D5 },
    ]);
    const run = runOf({
      index,
      days: [
        { date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] },
        { date: D2, intents: [{ securityId: SEC_A, value: 0.04 }] },
      ],
      simConfig: lightSimConfig(index),
    });
    const audit = auditOf(run);
    expect(audit.map((entry) => `${entry.executionDate}:${entry.status}:${entry.outcome}`)).toEqual([
      `${D1}:ST:REJECTED`,
      `${D3}:NORMAL:FILLED`,
    ]);
    expect(run.trades).toHaveLength(1);
    expect(run.trades[0]!.entryTime).toBe(D3);
    expect(run.executionStats.totalFills).toBe(1);
    expect(run.executionStats.rejectedOrders).toBe(1);
  });

  it("再入场遇 ST：首笔成交并平仓；同锚点再入场的成交日已知 ST ⇒ 拒单且历史交易保留", () => {
    const index = syntheticIndex([
      // D0..D1 正常（第一笔成交）；D2 起已知 ST（再入场被拒）。
      { symbol: SYMBOL_A, status: "NORMAL", from: D0, to: D1 },
      { symbol: SYMBOL_A, status: "ST", from: D2, to: D5 },
      { symbol: SYMBOL_B, status: "NORMAL", from: D0, to: D5 },
    ]);
    const run = runOf({
      index,
      days: [
        { date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] },
        // D2 改选 B（A 不再 desired）⇒ 候选取胜退出规则卖出 A；
        // D3 重新选 A ⇒ 订单在 D4 尝试成交，但 A 已 ST ⇒ 拒单。
        { date: D2, intents: [{ securityId: SEC_B, value: 0.04 }] },
        { date: D3, intents: [{ securityId: SEC_A, value: 0.03 }] },
      ],
      simConfig: lightSimConfig(index, { candidateExitPolicy: "HOLD_WHILE_SELECTED" }),
    });

    const aTrades = run.trades.filter((trade) => trade.securityId === SEC_A);
    expect(aTrades).toHaveLength(1);
    expect(aTrades[0]!.entryTime).toBe(D1);
    expect(aTrades[0]!.exitTime).toBe(D3);
    expect(aTrades[0]!.returnPct).not.toBeNull();

    const aAudit = auditOf(run).filter((entry) => entry.securityId === SEC_A);
    expect(aAudit.map((entry) => `${entry.executionDate}:${entry.status}:${entry.outcome}`)).toEqual([
      `${D1}:NORMAL:FILLED`,
      `${D4}:ST:REJECTED`,
    ]);
    // 二次入场没有成交，也**没有**递补其它候选。
    expect(run.trades.filter((trade) => trade.entryTime === D4)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4) 配置校验契约（最小兼容的**缺省**与**非法**路径）
// ---------------------------------------------------------------------------

describe("4) 最小执行契约兼容：校验与快照", () => {
  it("非法 unknown 政策取值 ⇒ 响亮失败（不静默忽略）", () => {
    const result = validateSimulationConfig(
      simConfig({
        executionEligibilityGate: createKnownStOnlyEligibilityGate({ index: syntheticIndex([]) }),
        executionEligibilityUnknownPolicy: "ALLOW_EVERYTHING" as never,
      }),
    );
    expect(result.issues.some(
      (entry) => entry.code === "SIM_CONFIG_EXECUTION_ELIGIBILITY_UNKNOWN_POLICY_INVALID",
    )).toBe(true);
  });

  it("声明了 unknown 政策却没有闸门 ⇒ 响亮失败（政策无处生效）", () => {
    expect(() => assertValidSimulationConfig(simConfig({
      executionEligibilityUnknownPolicy: "ALLOW_WHEN_DECISION_ALLOWS",
    }))).toThrow(/executionEligibilityUnknownPolicy|unknown/u);
  });

  it("未声明闸门 ⇒ 配置快照逐字节不变（没有 `executionEligibility` 键）", () => {
    const index = syntheticIndex([]);
    const run = runOf({
      index,
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { candidateExitPolicy: "DISABLED" },
    });
    expect(Object.keys(run.config)).not.toContain("executionEligibility");
    expect(Object.keys(run.config)).not.toContain("executionEligibilityUnknownPolicy");
    expect(run.executionEligibilityAudit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5) 仓位：同日当前权益快照（不是初始资金固定 20%）
// ---------------------------------------------------------------------------

describe("6) 结果信封：矩阵路径必须**显式**声明 `matrixEmitted` 与政策身份 status", () => {
  it("`assembleRecoveryStResult` 原样带出 `status=EXPLORATORY_KNOWN_ST_ONLY` / `matrixEmitted=true` / terminalState", () => {
    /**
     * 为什么需要这条：旧代码**从不**产出矩阵 ⇒ 从未写过 `matrixEmitted` / `status`，
     * 于是「跑成功并产出矩阵」与「刻意暂停（`ST_COVERAGE_BLOCKED`）」在信封上无法区分
     * （自动化只能靠猜）。本轮 SMOKE 首跑正是被这一点误导（run 已 SUCCEEDED、产物 31 个，
     * 工具却判为暂停）。
     */
    const compute = {
      computationVersion: "1.0.0",
      runMode: {
        mode: "SMOKE",
        randomAccountCount: 2,
        accountsPerGroup: 3,
        groupCount: 2,
        totalAccountCount: 6,
        seedIndexes: [1, 2],
        note: "test",
      },
      status: "EXPLORATORY_KNOWN_ST_ONLY",
      matrixEmitted: true,
      frozenConfig: {
        datasetCode: "first_limit_pullback",
        datasetVersionId: 780_004,
        datasetVersionLabel: "v10-listed365-pre10-post80",
        mainWindowStart: "2024-01-02",
        mainWindowEnd: "2025-09-30",
        positionFraction: 0.2,
        maxPositions: 5,
        maxDailyBuys: 2,
        initialCapital: 100_000,
        dailyTopK: 3,
        randomAccountCount: 2,
        randomSeedIndexBase: 20_261_010,
        runMode: "SMOKE",
        accountsPerGroup: 3,
        totalAccountCount: 6,
        supportRatio: 0.98,
        shrinkRatio: 0.5,
        observationMinScore: 3,
        runnerExtendHoldingDays: 74,
        datasetPostMaxRelativeDay: 80,
        strategyVersionId: 3_600_005,
        strategyVersion: "2.0.0",
        strategyFingerprint: "f".repeat(64),
        referenceRunId: "eval-3600005-promoted-t74",
        bootstrapIterations: 1_000,
        bootstrapBlockPrimary: 20,
        bootstrapBlockSensitivity: 40,
        bootstrapSeedPrimary: 20_261_010,
        bootstrapSeedSensitivity: 20_261_011,
        stGateContractVersion: "1.1.0",
        stEligibilityPolicyId: "KNOWN_ST_ONLY_EXPLORATORY",
        stEligibilityPolicyVersion: "recovery-known-st-only/1.0.0",
        stEligibilityPolicyParameter: "known-st-only",
        stEligibilityPolicyExploratory: true,
        stEligibilityPolicyStrictDefault: false,
        repairWindowDays: 5,
        repairScoreTotalMin: 15,
        watchMaxRelativeDay: 40,
      },
      commonAnchorUniverseSize: 18_611,
      groups: [],
      primaryComparison: {
        key: "B_R − A_R",
        classification: "PRIMARY",
        fromGroup: "B_RECOVERY_20",
        toGroup: "A_STRICT_20",
        pointEstimate: null,
        difference: {
          metric: "uniqueAnchorTail20Coverage",
          pointEstimate: null,
          blockPrimary: null,
          blockSensitivity: null,
          meanPrimary: null,
        },
        clusterKey: "test",
        calendarLength: 0,
        sampleGateMet: false,
        supported: false,
        gateReason: "test",
        note: "test",
      },
      stCoverage: null,
      stEligibilityPolicy: null,
      terminalState: "EXPLORATORY_COMPLETED",
      contractGaps: [],
      sampleSummary: {
        candidateCount: 58_983,
        eligibleCount: 19_510,
        excludedCount: 39_473,
        excludedByReason: { EVENT_OUTSIDE_POOL_WINDOW: 39_473 },
        notes: [],
      },
    } as unknown as Parameters<typeof assembleRecoveryStResult>[0];

    const payload = assembleRecoveryStResult(compute);
    const custom = payload.customPayload as Record<string, unknown>;
    expect(custom.matrixEmitted).toBe(true);
    expect(custom.status).toBe("EXPLORATORY_KNOWN_ST_ONLY");
    expect(custom.terminalState).toBe("EXPLORATORY_COMPLETED");
    // 样本账不变量（平台强制）：原因合计 = excludedCount、eligible + excluded = candidate。
    const summary = payload.sampleSummary;
    expect(Object.values(summary.excludedByReason).reduce((sum, value) => sum + value, 0))
      .toBe(summary.excludedCount);
    expect(summary.eligibleCount + summary.excludedCount).toBe(summary.candidateCount);
  });
});

// ---------------------------------------------------------------------------
// 7) 仓位：同日当前权益快照（不是初始资金固定 20%）
// ---------------------------------------------------------------------------

describe("7) 仓位使用决策日**收盘当前总权益 × 20%**（不是初始资金固定 20%）", () => {
  it("第二笔的股数由**决策日当日权益**推出：若固定在初始资金 20%，股数会不同", () => {
    const index = syntheticIndex([]);
    const dataset = sealDataset(defaultRows());
    const run = runTradeSimulation({
      dataset,
      sourceRun: buildSourceRun({
        dataset,
        days: [
          { date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] },
          { date: D3, intents: [{ securityId: SEC_B, value: 0.04 }] },
        ],
      }),
      simConfig: simConfig(lightSimConfig(index, { maxDailyBuys: 1 })),
    });
    expect(run.trades).toHaveLength(2);
    const first = run.trades.find((trade) => trade.securityId === SEC_A)!;
    const second = run.trades.find((trade) => trade.securityId === SEC_B)!;
    expect(first.entryTime).toBe(D1);
    expect(second.entryTime).toBe(D4);

    /**
     * 口径（`plan.ts#applyPositionSizing` 的 `EQUITY_FRACTION`）：
     *   `budget = min(allocatable, 决策日收盘总权益 × fraction)`，
     *   股数按**决策日收盘价**折算到整手。
     *
     * fixture（`open = 10 + 2i`、`close = open + 0.4`）：
     *   - 第一笔：决策日 D0、当日权益 100,000、收盘价 10.4 ⇒ floor(100000×0.2/10.4/100)×100 = **1,900** 股；
     *   - 第二笔：决策日 D3、当日权益 108,360（现金 77,200 + 持仓 1,900×16.4）、收盘价 26.4
     *            ⇒ floor(108360×0.2/26.4/100)×100 = **800** 股。
     *
     * 🔴 若仓位被**错误地固定为初始资金的 20%**，第二笔会是 floor(100000×0.2/26.4/100)×100 = **700** 股
     *    ⇒ 本用例当场变红。
     */
    expect(first.quantity).toBe(1_900);
    expect(second.quantity).toBe(800);
    expect(second.quantity).not.toBe(Math.floor((100_000 * 0.2) / 26.4 / 100) * 100);
    // 权益在两次决策之间确实随持仓市值变化（同口径的计量基数存在且非恒定）。
    const equityByDate = new Map(run.equityCurve.map((point) => [point.date, point.equity]));
    expect(equityByDate.get(D0)).toBe(100_000);
    expect(equityByDate.get(D3)).toBeCloseTo(108_360, 6);
  });
});
