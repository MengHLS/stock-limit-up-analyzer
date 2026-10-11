/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005` · F1/F2 执行面验收（**真实 `runTradeSimulation`**）。
 *
 * ⚠️ **纯合成 fixture**：不读真实 Dataset、不连 DB、不跑 Run、不产出收益矩阵。
 *
 * ## 为什么必须走真实撮合
 *
 * 只检查 `gate.buyAllowed` **不算**验收（AUDIT-004 §9.2 点名的正是这条）：纯函数判 false
 * 与「订单真的没有成交、现金没被扣、仓位没建、成功入场次数没加」是两件事。因此本文件：
 *
 *   - 用**研究装配层的真实闸门实现** `createStExecutionEligibilityGate(provider)`
 *     （= `experiment.ts` 注入执行层的那个对象，研究装配层与执行层**同一个**政策）；
 *   - 经**服务侧唯一封装** `sealRollingPoolExecutionDataset` + 真实
 *     `runTradeSimulation` 走完整撮合链；
 *   - 断言交易台账 / 现金 / 持仓 / 成交计数 / 逐笔执行资格审计，
 *     而不是断言闸门函数的返回值。
 *
 * ## 覆盖（PLAN-FIX-005 §3 的九个场景）
 *
 * 1. 确认日 NORMAL、成交日 ST ⇒ 真实拒单：不扣款、不建仓、不计成功次数；
 * 2. 成交日 UNKNOWN ⇒ 同上且保留 UNKNOWN 原因；
 * 3. 首次成交后全平、再出新信号、次日 ST ⇒ 二次入场被拒，历史已完成交易保留；
 * 4. R 与 Random 使用同一成交前政策，账户状态独立；
 * 5. 第 1 名隔夜 ST、第 4 名正常 ⇒ 第 1 名拒单，**不使用**次日事实补选第 4 名；
 * 6. 两时点均可靠 NORMAL ⇒ 真实买卖、成本与权益路径正常；
 * 7. 持有中变 ST ⇒ 不增加买入；原退出订单仍按既有规则执行；
 * 8. 未提供可选接口 ⇒ 同输入旧路径 `tradeDigest` / `equityDigest` / `canonicalMetrics` 完全一致；
 * 9. 日内与日期边界：09:00 到期 / 08:00 生效 / 精确端点 / 日期终点 / 隔夜 / `availableAsOf` 过晚。
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CostModel } from "../../../server/engine/domain";
import type { ResearchDataset } from "../../../server/researchDataset/types";
import type { EquityPoint, Trade } from "../../../server/backtest/types";
import { canonicalMetrics } from "../../../server/backtest/backtestResult";
import { evaluateCandidateRun } from "../../../server/research/signalEngine/evaluate";
import { computeCandidateEvaluationRunFingerprint } from "../../../server/research/signalEngine/serialize";
import type {
  CandidateDayRecord,
  CandidateEvaluationRun,
  PositionIntent,
  SelectedCandidate,
} from "../../../server/research/signalEngine/types";
import { runTradeSimulation } from "../../../server/research/simulator/engine";
import {
  deserializeTradeSimulationRun,
  serializeTradeSimulationRun,
} from "../../../server/research/simulator/serialize";
import type {
  ExecutionEligibilityAuditEntry,
  SimulationConfig,
  TradeSimulationRun,
} from "../../../server/research/simulator/types";
import {
  sealRollingPoolExecutionDataset,
  type RollingPoolExecutionRowInput,
} from "../../../server/researchExperiments/rollingPoolExecutionSupport";
import {
  ST_GATE_CONTRACT_VERSION,
  evaluateStGate,
  type SecurityStatusFact,
  type SecurityStatusProvider,
} from "../../../research-experiments/shared/rollingPoolRecovery";
import {
  ST_EXECUTION_ELIGIBILITY_GATE_ID,
  createStExecutionEligibilityGate,
} from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment";

// ---------------------------------------------------------------------------
// digest 口径（与 `server/backtest/backtestResult.ts#rollingDigest` **同一配方**）
// ---------------------------------------------------------------------------

function rollingDigest(seed: string, lines: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(seed);
  for (const line of lines) {
    hash.update("\u0000");
    hash.update(line);
  }
  return hash.digest("hex");
}

function equityDigestOf(curve: readonly EquityPoint[]): string {
  return rollingDigest(
    "equity/v1",
    curve.map((point) => [point.date, point.equity, point.cash, point.marketValue, point.openPositions].join("|")),
  );
}

function tradeDigestOf(trades: readonly Trade[]): string {
  return rollingDigest(
    "trade/v1",
    trades.map((trade) => [
      trade.securityId,
      trade.entryTime,
      trade.entryPrice,
      trade.exitTime ?? "",
      trade.exitPrice ?? "",
      trade.quantity,
      trade.netPnl ?? "",
      trade.fees,
      trade.slippageAmount,
    ].join("|")),
  );
}

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

const COST_ZERO: CostModel = {
  commissionRate: 0,
  stampDutyRate: 0,
  transferFeeRate: 0,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 0,
};

const COST_STD: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00002,
  slippageBps: 5,
  lotSize: 100,
  minCommission: 5,
};

/** 8 个交易日（rd0 = D0；确认日 D0 ⇒ 成交日 D1 等）。 */
const D0 = "2024-03-01";
const D1 = "2024-03-04";
const D2 = "2024-03-05";
const D3 = "2024-03-06";
const D4 = "2024-03-07";
const D5 = "2024-03-08";
const D6 = "2024-03-11";
const D7 = "2024-03-12";
const DATES: readonly string[] = [D0, D1, D2, D3, D4, D5, D6, D7];

/** 事件作用域身份（与实验一致）：`<base>::event:<symbol>@<date>`。 */
function scoped(base: string, symbol: string, date = D0): string {
  return `${base}::event:${symbol}@${date}`;
}

const SEC_A = scoped("sec_a", "000001.SZ");
const SEC_B = scoped("sec_b", "000002.SZ");
const SEC_C = scoped("sec_c", "000003.SZ");
const SEC_D = scoped("sec_d", "000004.SZ");

function row(args: {
  readonly date: string;
  readonly securityId: string;
  readonly open: number;
  readonly close: number;
  readonly volume?: number;
}): RollingPoolExecutionRowInput {
  return {
    tradeDate: args.date,
    securityId: args.securityId,
    code: `${args.securityId.replace(/[^0-9A-Za-z]/gu, "").slice(0, 8)}.SZ`,
    exchange: "SZ",
    open: args.open,
    high: Math.max(args.open, args.close) + 0.1,
    low: Math.min(args.open, args.close) - 0.1,
    close: args.close,
    preClose: args.open,
    volume: args.volume ?? 1_000_000,
    amount: null,
    barPresent: true,
    suspended: false,
  };
}

/** 价格表：每个证券按 `DATES` 索引给出（open/close），保证决策日与成交日都有行。 */
function rowsFor(securities: readonly string[], opens: readonly number[]): RollingPoolExecutionRowInput[] {
  const rows: RollingPoolExecutionRowInput[] = [];
  for (const securityId of securities) {
    DATES.forEach((date, index) => {
      const open = opens[index % opens.length]!;
      rows.push(row({ date, securityId, open, close: open + 0.2 }));
    });
  }
  return rows;
}

function sealDataset(rows: readonly RollingPoolExecutionRowInput[]): ResearchDataset {
  return sealRollingPoolExecutionDataset({
    name: "fix005-execution-gate-test",
    startDate: D0,
    endDate: D7,
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
    builderVersion: "fix005-execution-gate-test-1.0.0",
    rowSchemaVersion: "fix005-execution-gate-test-1.0.0",
    datasetGate: args.dataset.gate,
    universeId: `fix005-execution-gate-test:${args.dataset.datasetVersion}`,
    strategyId: "study-recovery-st-execution-gate-test",
    strategyVersion: "1.0.0",
    parameters: { topK: 3 },
    dateRange: {
      startDate: args.days[0]!.date,
      endDate: args.days[args.days.length - 1]!.date,
    },
    point: "close",
    signalDescription: "fix005 execution-gate test fixture",
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
    dateRange: { startDate: D0, endDate: D7 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 状态 provider（穷尽式：区间显式列出，区间之外返回 null = 无结论）
// ---------------------------------------------------------------------------

interface FactSpec {
  /** 只对该 symbol 生效；缺省 = 对所有 symbol 生效。 */
  readonly symbol?: string;
  readonly status: "NORMAL" | "ST";
  readonly from: string;
  readonly to: string | null;
  readonly availableAsOf: string;
}

/** `YYYY-MM-DDTHH:mm:ss` / `YYYY-MM-DD` 的日期部分（格式非法时返回 null ⇒ 不做日期预筛）。 */
function datePartOf(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}(T|$)/u.test(value) ? value.slice(0, 10) : null;
}

/**
 * 按声明顺序返回**第一条**匹配 symbol 且**日期上可能覆盖该交易日**的事实；
 * 时点级判定（09:00 到期 / 08:00 生效 / 精确端点 / 可获知时间）一律交给 `evaluateStGate`。
 *
 * 🔴 日期预筛只用于「同一 symbol 在不同时段有不同事实」的场景（隔夜转 ST）；
 *    写法非法的 `from`/`to` **不参与**预筛 ⇒ 无效日期仍然流到闸门并在那里被拒。
 */
function providerOf(specs: readonly FactSpec[]): SecurityStatusProvider {
  return {
    providerId: "TEST_EXEC_ELIGIBILITY",
    contractVersion: ST_GATE_CONTRACT_VERSION,
    statusAt: (query): SecurityStatusFact | null => {
      for (const spec of specs) {
        if (spec.symbol !== undefined && spec.symbol !== query.symbol) continue;
        const from = datePartOf(spec.from);
        const to = spec.to === null ? null : datePartOf(spec.to);
        if (from !== null && query.tradeDate < from) continue;
        if (to !== null && query.tradeDate > to) continue;
        return {
          symbol: query.symbol,
          tradeDate: query.tradeDate,
          status: spec.status,
          effectiveFrom: spec.from,
          effectiveTo: spec.to,
          availableAsOf: spec.availableAsOf,
          source: "TEST_EXEC_ELIGIBILITY",
          confidence: "VERIFIED",
          evidenceFingerprint: `test:${spec.status}:${spec.from}..${spec.to ?? "null"}`,
        };
      }
      return null;
    },
  };
}

function gateOf(provider: SecurityStatusProvider): SimulationConfig["executionEligibilityGate"] {
  return createStExecutionEligibilityGate({ provider });
}

function runOf(args: {
  readonly securities: readonly string[];
  readonly opens: readonly number[];
  readonly days: readonly DaySpec[];
  readonly simConfig?: Partial<SimulationConfig>;
}): TradeSimulationRun {
  const dataset = sealDataset(rowsFor(args.securities, args.opens));
  const sourceRun = buildSourceRun({ dataset, days: args.days });
  return runTradeSimulation({ dataset, sourceRun, simConfig: simConfig(args.simConfig) });
}

function auditOf(run: TradeSimulationRun): readonly ExecutionEligibilityAuditEntry[] {
  return run.executionEligibilityAudit ?? [];
}

function tradesOf(run: TradeSimulationRun): readonly string[] {
  return run.trades.map((trade) => `${trade.securityId}@${trade.entryTime}`);
}

// ---------------------------------------------------------------------------
// 1) 确认日 NORMAL、成交日 ST ⇒ 真实拒单
// ---------------------------------------------------------------------------

describe("1) 确认日 NORMAL、成交日 ST ⇒ 真实拒单（不扣款 / 不建仓 / 不计成功次数）", () => {
  const provider = providerOf([
    { status: "ST", from: D1, to: D7, availableAsOf: D0 },
    { status: "NORMAL", from: D0, to: D0, availableAsOf: D0 },
  ]);

  it("已选买单被真实拒绝：无成交、现金不动、无持仓、成交计数为 0", () => {
    const run = runOf({
      securities: [SEC_A],
      opens: [10, 11, 12, 13, 14, 15, 16, 17],
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { executionEligibilityGate: gateOf(provider) },
    });

    // 拒单事实（引擎侧）
    expect(run.trades).toHaveLength(0);
    expect(run.positions).toHaveLength(0);
    expect(run.executionStats.totalFills).toBe(0);
    expect(run.executionStats.rejectedOrders).toBe(1);
    // 现金 / 权益没有被扣（零成本下权益恒为初始资金）
    for (const point of run.equityCurve) {
      expect(point.cash).toBe(100_000);
      expect(point.marketValue).toBe(0);
      expect(point.equity).toBe(100_000);
    }
    expect(run.finalEquity).toBe(100_000);
    // 逐笔执行资格审计：真实调用记录，判 ST + REJECTED
    const audit = auditOf(run);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.securityId).toBe(SEC_A);
    expect(audit[0]!.status).toBe("ST");
    expect(audit[0]!.reason).toBe("VERIFIED_ST");
    expect(audit[0]!.outcome).toBe("REJECTED");
    expect(audit[0]!.plannedDate).toBe(D0);
    expect(audit[0]!.executionDate).toBe(D1);
    expect(audit[0]!.gateId).toBe(ST_EXECUTION_ELIGIBILITY_GATE_ID);
    expect(audit[0]!.checkedAt).toBe(`${D1}T09:15:00`);
    expect(audit[0]!.plannedCheckDate).toBe(D0);
    // 订单审计里留下具名拒单原因（不静默）
    const rejectedOrder = run.audit.orders.find((order) => order.status === "REJECTED")!;
    expect(rejectedOrder.explanation).toContain("执行资格闸门拒绝");
    expect(rejectedOrder.explanation).toContain("status=ST");
    // 卖单不受影响（本用例没有持仓，故无卖单）
    expect(run.audit.orders.every((order) => order.side === "buy")).toBe(true);
  });

  it("闸门放行时同一 fixture 会真实成交（正对照：拒单不是「永远不买」）", () => {
    const normalProvider = providerOf([{ status: "NORMAL", from: D0, to: D7, availableAsOf: D0 }]);
    const run = runOf({
      securities: [SEC_A],
      opens: [10, 11, 12, 13, 14, 15, 16, 17],
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { executionEligibilityGate: gateOf(normalProvider) },
    });
    expect(run.trades).toHaveLength(1);
    expect(run.trades[0]!.entryTime).toBe(D1);
    expect(run.executionStats.totalFills).toBe(1);
    expect(auditOf(run)[0]!.outcome).toBe("FILLED");
    expect(auditOf(run)[0]!.status).toBe("NORMAL");
  });
});

// ---------------------------------------------------------------------------
// 2) 成交日 UNKNOWN ⇒ 同样拒单且保留原因
// ---------------------------------------------------------------------------

describe("2) 成交日 UNKNOWN ⇒ 同样拒单，并保留 UNKNOWN 拒单原因", () => {
  it("provider 对成交日无事实（NO_STATUS_FACT）⇒ 不成交，原因原样保留", () => {
    // NORMAL 只覆盖确认日；成交日 provider 仍返回 NORMAL 但区间不覆盖 ⇒ 其实是 NOT_EFFECTIVE。
    // 这里要的是**无事实**：用一个只对成交日之前有效的区间 + 显式 UNKNOWN 情形。
    const emptyProvider: SecurityStatusProvider = {
      providerId: "TEST_NO_FACT",
      contractVersion: ST_GATE_CONTRACT_VERSION,
      statusAt: () => null,
    };
    const run = runOf({
      securities: [SEC_A],
      opens: [10, 11, 12, 13, 14, 15, 16, 17],
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { executionEligibilityGate: gateOf(emptyProvider) },
    });
    expect(run.trades).toHaveLength(0);
    expect(run.executionStats.totalFills).toBe(0);
    expect(run.executionStats.rejectedOrders).toBe(1);
    expect(run.finalEquity).toBe(100_000);
    const audit = auditOf(run);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.status).toBe("UNKNOWN");
    expect(audit[0]!.reason).toBe("NO_STATUS_FACT");
    expect(audit[0]!.outcome).toBe("REJECTED");
    expect(audit[0]!.providerId).toBe("TEST_NO_FACT");
  });

  it("provider 在成交日给不出任何事实（覆盖只到确认日）也一律拒单", () => {
    const provider = providerOf([
      { status: "NORMAL", from: D0, to: D0, availableAsOf: D0 },
    ]);
    const run = runOf({
      securities: [SEC_A],
      opens: [10, 11, 12, 13, 14, 15, 16, 17],
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { executionEligibilityGate: gateOf(provider) },
    });
    expect(run.trades).toHaveLength(0);
    const audit = auditOf(run);
    expect(audit[0]!.status).toBe("UNKNOWN");
    expect(audit[0]!.reason).toBe("NO_STATUS_FACT");
    expect(audit[0]!.outcome).toBe("REJECTED");
  });
});

// ---------------------------------------------------------------------------
// 3) 平仓后再入场、次日 ST ⇒ 二次入场被拒，历史成交保留
// ---------------------------------------------------------------------------

describe("3) 首次成交后全平、再出新信号，次日 ST ⇒ 二次入场被拒且历史交易保留", () => {
  it("第一次完整交易保留；第二次入场被拒单（无新成交）", () => {
    // D0 选 A ⇒ D1 买入；D2 选 B（A 不在 desired ⇒ 候选退出）⇒ D3 卖出 A；
    // D4 再选 A ⇒ D5 尝试买入，但 A 在 D5 起 ST ⇒ 拒单。
    const provider = providerOf([
      { symbol: "000001.SZ", status: "ST", from: D5, to: D7, availableAsOf: D4 },
      { symbol: "000002.SZ", status: "NORMAL", from: D0, to: D7, availableAsOf: D0 },
      { symbol: "000001.SZ", status: "NORMAL", from: D0, to: D4, availableAsOf: D0 },
    ]);
    const run = runOf({
      securities: [SEC_A, SEC_B],
      opens: [10, 20, 11, 21, 12, 22, 13, 23],
      days: [
        { date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] },
        { date: D2, intents: [{ securityId: SEC_B, value: 0.04 }] },
        { date: D4, intents: [{ securityId: SEC_A, value: 0.03 }] },
      ],
      simConfig: {
        executionEligibilityGate: gateOf(provider),
        candidateExitPolicy: "HOLD_WHILE_SELECTED",
      },
    });

    const aTrades = run.trades.filter((trade) => trade.securityId === SEC_A);
    // 第一次完整交易被保留（D1 买入 / D3 卖出），第二次入场没有产生新交易。
    expect(aTrades).toHaveLength(1);
    expect(aTrades[0]!.entryTime).toBe(D1);
    expect(aTrades[0]!.exitTime).toBe(D3);
    expect(aTrades[0]!.returnPct).not.toBeNull();
    expect(run.trades.some((trade) => trade.securityId === SEC_A && trade.entryTime === D5)).toBe(false);

    const audit = auditOf(run);
    const aEntries = audit.filter((entry) => entry.securityId === SEC_A);
    expect(aEntries.map((entry) => `${entry.executionDate}:${entry.outcome}`))
      .toEqual([`${D1}:FILLED`, `${D5}:REJECTED`]);
    expect(aEntries[1]!.status).toBe("ST");
    expect(aEntries[1]!.reason).toBe("VERIFIED_ST");
  });
});

// ---------------------------------------------------------------------------
// 4) R 与 Random：同一成交前政策、账户状态独立
// ---------------------------------------------------------------------------

describe("4) R 与 Random 使用同一成交前政策，账户状态各自独立", () => {
  it("同一次拒单政策下：R（持有 ST 标的）空仓，Random（持有正常标的）成交", () => {
    const provider = providerOf([
      { symbol: "000001.SZ", status: "ST", from: D1, to: D7, availableAsOf: D0 },
      { symbol: "000002.SZ", status: "NORMAL", from: D0, to: D7, availableAsOf: D0 },
    ]);
    const gate = gateOf(provider);
    const dataset = sealDataset(rowsFor([SEC_A, SEC_B], [10, 20, 11, 21, 12, 22, 13, 23]));
    const rSourceRun = buildSourceRun({
      dataset,
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
    });
    const randomSourceRun = buildSourceRun({
      dataset,
      days: [{ date: D0, intents: [{ securityId: SEC_B, value: 0.04 }] }],
    });
    const rRun = runTradeSimulation({ dataset, sourceRun: rSourceRun, simConfig: simConfig({ executionEligibilityGate: gate }) });
    const randomRun = runTradeSimulation({ dataset, sourceRun: randomSourceRun, simConfig: simConfig({ executionEligibilityGate: gate }) });

    // 同一实现、同一政策版本、同一闸门身份 ⇒ 不是两套政策。
    expect(auditOf(rRun)[0]!.policyVersion).toBe(auditOf(randomRun)[0]!.policyVersion);
    expect(auditOf(rRun)[0]!.gateId).toBe(auditOf(randomRun)[0]!.gateId);
    expect(gate!.gateId).toBe(ST_EXECUTION_ELIGIBILITY_GATE_ID);

    expect(rRun.trades).toHaveLength(0);
    expect(rRun.finalEquity).toBe(100_000);
    expect(randomRun.trades).toHaveLength(1);
    expect(randomRun.trades[0]!.securityId).toBe(SEC_B);
    // 账户状态独立：R 的拒单没有影响 Random 的现金 / 持仓。
    expect(randomRun.equityCurve.at(-1)!.cash).toBeLessThan(100_000);
    expect(runOf({
      securities: [SEC_A, SEC_B],
      opens: [10, 20, 11, 21, 12, 22, 13, 23],
      days: [{ date: D0, intents: [{ securityId: SEC_B, value: 0.04 }] }],
      simConfig: { executionEligibilityGate: gate },
    }).finalEquity).toBe(randomRun.finalEquity);
  });
});

// ---------------------------------------------------------------------------
// 5) 第 1 名隔夜 ST、第 4 名正常 ⇒ 不递补
// ---------------------------------------------------------------------------

describe("5) 第 1 名隔夜 ST、第 4 名正常 ⇒ 第 1 名拒单，且**不**用次日事实补选第 4 名", () => {
  it("意图只有 Top3（rank1/2/3）；rank1 被拒后 rank4 不会替补，也不产生任何额外订单", () => {
    const provider = providerOf([
      { symbol: "000001.SZ", status: "ST", from: D1, to: D7, availableAsOf: D0 },
      { symbol: "000002.SZ", status: "NORMAL", from: D0, to: D7, availableAsOf: D0 },
      { symbol: "000003.SZ", status: "NORMAL", from: D0, to: D7, availableAsOf: D0 },
      { symbol: "000004.SZ", status: "NORMAL", from: D0, to: D7, availableAsOf: D0 },
    ]);
    // 当日可排序买点池 = 4 个；Top3 = rank1/2/3（rank4=SEC_D 只作观察，不生成意图）。
    const run = runOf({
      securities: [SEC_A, SEC_B, SEC_C, SEC_D],
      opens: [10, 20, 30, 40, 11, 21, 31, 41],
      days: [{
        date: D0,
        intents: [
          { securityId: SEC_A, value: 0.05 },
          { securityId: SEC_B, value: 0.04 },
          { securityId: SEC_C, value: 0.03 },
        ],
      }],
      simConfig: { executionEligibilityGate: gateOf(provider), maxDailyBuys: 5 },
    });

    expect(tradesOf(run)).toEqual([`${SEC_B}@${D1}`, `${SEC_C}@${D1}`]);
    expect(run.trades.some((trade) => trade.securityId === SEC_D)).toBe(false);
    // rank4 从未进入意图 ⇒ 连计划订单都没有（不是「下了单又被拒」）。
    expect(run.audit.orders.some((order) => order.securityId === SEC_D)).toBe(false);
    const audit = auditOf(run);
    expect(audit).toHaveLength(3);
    const aAudit = audit.find((entry) => entry.securityId === SEC_A)!;
    expect(aAudit.status).toBe("ST");
    expect(aAudit.outcome).toBe("REJECTED");
    expect(audit.filter((entry) => entry.outcome === "FILLED")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 6) 两时点均可靠 NORMAL ⇒ 真实买卖、成本与权益路径正常
// ---------------------------------------------------------------------------

describe("6) 两时点均可靠 NORMAL ⇒ 真实买卖、成本与权益路径正常", () => {
  it("真实成交并有成本；候选退出仍按既有规则卖出", () => {
    const provider = providerOf([
      { symbol: "000001.SZ", status: "NORMAL", from: D0, to: D7, availableAsOf: D0 },
      { symbol: "000002.SZ", status: "NORMAL", from: D0, to: D7, availableAsOf: D0 },
    ]);
    const run = runOf({
      securities: [SEC_A, SEC_B],
      opens: [10, 20, 11, 21, 12, 22, 13, 23],
      days: [
        { date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] },
        { date: D2, intents: [{ securityId: SEC_B, value: 0.04 }] },
      ],
      simConfig: {
        executionEligibilityGate: gateOf(provider),
        candidateExitPolicy: "HOLD_WHILE_SELECTED",
        cost: COST_STD,
      },
    });

    const aTrade = run.trades.find((trade) => trade.securityId === SEC_A)!;
    expect(aTrade.entryTime).toBe(D1);
    expect(aTrade.exitTime).toBe(D3);
    expect(aTrade.fees).toBeGreaterThan(0);
    expect(aTrade.returnPct).not.toBeNull();
    expect(run.costs.totalCost).toBeGreaterThan(0);
    // 权益路径：成交日现金因买入+成本下降，退出后因回款上升（真实买卖，不是空转）
    expect(run.equityCurve[0]!.cash).toBe(100_000);
    expect(run.equityCurve[1]!.cash).toBeLessThan(100_000);
    expect(run.equityCurve.at(-1)!.cash).toBeGreaterThan(0);
    const metrics = canonicalMetrics({
      equityCurve: run.equityCurve,
      tradeLedger: run.trades,
      initialCapital: run.initialCapital,
    });
    expect(metrics.tradeCount).toBeGreaterThanOrEqual(1);
    // 所有真实成交的资格判决都是 NORMAL（审计断言）
    expect(auditOf(run).filter((entry) => entry.outcome === "FILLED").every((entry) => entry.status === "NORMAL"))
      .toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7) 持有中变 ST ⇒ 不增加买入；原退出订单仍按既有规则执行
// ---------------------------------------------------------------------------

describe("7) 持有中变 ST ⇒ 不加仓，且原退出订单仍按既有规则执行", () => {
  it("A 在持仓期间转为 ST：不新买 A，但候选退出照常卖出 A", () => {
    const provider = providerOf([
      // A 自 D2 起 ST（持仓期间）；B 全程 NORMAL。
      { symbol: "000001.SZ", status: "ST", from: D2, to: D7, availableAsOf: D1 },
      { symbol: "000002.SZ", status: "NORMAL", from: D0, to: D7, availableAsOf: D0 },
      { symbol: "000001.SZ", status: "NORMAL", from: D0, to: D1, availableAsOf: D0 },
    ]);
    const run = runOf({
      securities: [SEC_A, SEC_B],
      opens: [10, 20, 11, 21, 12, 22, 13, 23],
      days: [
        { date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] },
        // D2 起改选 B ⇒ A 不再是 desired ⇒ 既有候选退出规则卖出 A（即便 A 已 ST）。
        { date: D2, intents: [{ securityId: SEC_B, value: 0.04 }] },
      ],
      simConfig: {
        executionEligibilityGate: gateOf(provider),
        candidateExitPolicy: "HOLD_WHILE_SELECTED",
      },
    });

    const aTrades = run.trades.filter((trade) => trade.securityId === SEC_A);
    expect(aTrades).toHaveLength(1);
    expect(aTrades[0]!.entryTime).toBe(D1);
    // 退出订单照常执行（ST 不影响卖出）
    expect(aTrades[0]!.exitTime).toBe(D3);
    expect(aTrades[0]!.exitPrice).not.toBeNull();
    // 只有买入受闸门约束 ⇒ 审计里只有买入检查
    expect(auditOf(run).every((entry) => entry.side === "buy")).toBe(true);
    // 卖出订单没有任何「执行资格」拒绝
    const rejectedSells = run.audit.orders.filter(
      (order) => order.side === "sell" && (order.explanation ?? "").includes("执行资格闸门拒绝"),
    );
    expect(rejectedSells).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8) 未提供可选接口 ⇒ 旧路径逐字节一致
// ---------------------------------------------------------------------------

describe("8) 未提供可选接口 ⇒ 同输入旧路径 tradeDigest / equityDigest / canonicalMetrics 完全一致", () => {
  /**
   * 🔴 **与 STEP 0.3 探针逐字同源**的 fixture（`probe-digest-baseline.mts`）：
   * 只有它记录的常量才能作为「改动前 == 改动后」的判据。任何细节（证券 id、
   * 价格、行序、`builderVersion`）都不能凭记忆简化 —— 简化过的 fixture 会得到
   * 另一个（同样合法但不可比的）指纹。
   */
  function baselineProbeRun(): TradeSimulationRun {
    const probeDates = ["2024-03-01", "2024-03-04", "2024-03-05", "2024-03-06", "2024-03-07", "2024-03-08"];
    const probeRow = (args: { date: string; securityId: string; open: number; close: number }): RollingPoolExecutionRowInput => ({
      tradeDate: args.date,
      securityId: args.securityId,
      code: `${args.securityId.replace(/[^0-9A-Za-z]/gu, "")}.SZ`,
      exchange: "SZ",
      open: args.open,
      high: Math.max(args.open, args.close) + 0.1,
      low: Math.min(args.open, args.close) - 0.1,
      close: args.close,
      preClose: args.open,
      volume: 1_000_000,
      amount: null,
      barPresent: true,
      suspended: false,
    });
    const rows: RollingPoolExecutionRowInput[] = [
      ...probeDates.map((date, index) => probeRow({ date, securityId: "sec_A", open: 10 + index * 0.1, close: 10.1 + index * 0.1 })),
      ...probeDates.map((date, index) => probeRow({ date, securityId: "sec_B", open: 20 + index * 0.2, close: 20.2 + index * 0.2 })),
    ];
    const dataset = sealRollingPoolExecutionDataset({
      name: "recovery-st-fix005-digest-probe",
      startDate: probeDates[0]!,
      endDate: probeDates[probeDates.length - 1]!,
      datasetVersionId: 780_004,
      rows,
      tradingDates: probeDates,
    });
    const dayRecord: CandidateDayRecord = {
      date: "2024-03-01",
      universeMembers: ["sec_A", "sec_B"],
      signalCount: 2,
      dropped: [],
      selected: [
        { securityId: "sec_A", rank: 1, percentile: 1, value: 0.05 },
        { securityId: "sec_B", rank: 2, percentile: 0.5, value: 0.02 },
      ] satisfies SelectedCandidate[],
      positionIntents: [
        { securityId: "sec_A", direction: "long", rank: 1, percentile: 1, weight: 0.5, signalValue: 0.05, confidence: null },
        { securityId: "sec_B", direction: "long", rank: 2, percentile: 0.5, weight: 0.5, signalValue: 0.02, confidence: null },
      ] satisfies PositionIntent[],
    };
    const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
      recordKind: "CANDIDATE_EVALUATION_RUN",
      recordVersion: 1,
      datasetVersion: dataset.datasetVersion,
      builderVersion: "fix005-digest-probe-1.0.0",
      rowSchemaVersion: "fix005-digest-probe-1.0.0",
      datasetGate: dataset.gate,
      universeId: `fix005-digest-probe:${dataset.datasetVersion}`,
      strategyId: "fix005-digest-probe",
      strategyVersion: "1.0.0",
      parameters: { topK: 3 },
      dateRange: { startDate: "2024-03-01", endDate: "2024-03-01" },
      point: "close",
      signalDescription: "fix005 digest probe",
      featureVersions: [{ featureId: "preReturn10", version: "1.0.0" }],
      rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
      selectionConfig: { method: { kind: "topN", n: 3 } },
      days: [dayRecord],
      evaluation: evaluateCandidateRun([dayRecord]),
    };
    const sourceRun: CandidateEvaluationRun = {
      ...body,
      fingerprint: computeCandidateEvaluationRunFingerprint(body),
    };
    return runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: {
        initialCapital: 100_000,
        cost: COST_ZERO,
        candidateExitPolicy: "DISABLED",
        maxPositions: 5,
        maxDailyBuys: 2,
        positionSizing: { sizingMethod: "EQUITY_FRACTION", fraction: 0.2, fixedAmount: null },
        dateRange: { startDate: "2024-03-01", endDate: "2024-03-08" },
      },
    });
  }

  it("缺省无闸门：指纹与 digest 与改动前（STEP 0.3 记录值）逐字节相同", () => {
    const run = baselineProbeRun();
    // 🔴 这些常量是改动**之前**（scripts/_scratch/recovery-st-fix005/probe-digest-before.json）
    //    在同一 fixture 上记录的实测值 ⇒ 任何「缺省路径被动过」都会让本用例变红。
    expect(run.fingerprint).toBe("fefd610464fe50f3a33bf1e6a5fb0dbce96a43ff342885497b9937d07302c4da");
    expect(tradeDigestOf(run.trades)).toBe("d2b52157226aaf6ed2cb1d5db8eec7eb40cbbe6c047c435274610a381fed2644");
    expect(equityDigestOf(run.equityCurve)).toBe("6aacf974abad078038d8635479931a2cc7ec6b446996df831584ec455e1d0a29");
    const metrics = canonicalMetrics({
      equityCurve: run.equityCurve,
      tradeLedger: run.trades,
      initialCapital: run.initialCapital,
    });
    expect(metrics).toEqual({
      totalReturnPct: 1.849999999999996,
      annualizedReturnPct: 151.90458954383158,
      maxDrawdownPct: 0,
      tradeCount: 2,
      winRatePct: "NOT_AVAILABLE",
      averageWinPct: "NOT_AVAILABLE",
      averageLossPct: "NOT_AVAILABLE",
      profitFactor: "NOT_AVAILABLE",
      completedTradeCount: 0,
      openAtEndCount: 2,
      annualizationBasis: { type: "TRADING_DAYS", daysPerYear: 252 },
    });
    // 缺省时新字段**完全不出现**（不是「出现但为空数组」）
    expect(run.executionEligibilityAudit).toBeUndefined();
    expect(Object.keys(run.config)).not.toContain("executionEligibility");
  });

  it("全部放行的闸门不改变交易 / 权益路径（digest 一致）；只多出可审计字段", () => {
    const provider = providerOf([{ status: "NORMAL", from: D0, to: D7, availableAsOf: D0 }]);
    const options = {
      securities: [SEC_A, SEC_B],
      opens: [10, 20, 11, 21, 12, 22, 13, 23],
      days: [{
        date: D0,
        intents: [
          { securityId: SEC_A, value: 0.05 },
          { securityId: SEC_B, value: 0.02 },
        ],
      }],
    } as const;
    const withoutGate = runOf({ ...options, simConfig: { candidateExitPolicy: "DISABLED" } });
    const withGate = runOf({
      ...options,
      simConfig: { candidateExitPolicy: "DISABLED", executionEligibilityGate: gateOf(provider) },
    });
    expect(tradeDigestOf(withGate.trades)).toBe(tradeDigestOf(withoutGate.trades));
    expect(equityDigestOf(withGate.equityCurve)).toBe(equityDigestOf(withoutGate.equityCurve));
    expect(withGate.executionStats).toEqual(withoutGate.executionStats);
    // 闸门身份进入配置快照（函数本身**不**进 JSON）
    expect(withGate.config.executionEligibility).toEqual({
      gateId: ST_EXECUTION_ELIGIBILITY_GATE_ID,
      policyVersion: "recovery-st-execution-eligibility/1.0.0",
    });
    expect(auditOf(withGate).every((entry) => entry.status === "NORMAL" && entry.outcome === "FILLED")).toBe(true);
  });

  it("非法闸门形状 ⇒ 响亮失败（不静默退化成「没有闸门」）", () => {
    const dataset = sealDataset(rowsFor([SEC_A], [10, 11, 12, 13, 14, 15, 16, 17]));
    const sourceRun = buildSourceRun({
      dataset,
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
    });
    expect(() => runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({
        executionEligibilityGate: { gateId: "", policyVersion: "", decideBuy: () => undefined } as never,
      }),
    })).toThrow(/executionEligibilityGate|闸门/u);
  });

  it("失败关闭：`status !== NORMAL` 时即使闸门自称 allowed=true 也拒单", () => {
    const contradictory: SimulationConfig["executionEligibilityGate"] = {
      gateId: "TEST_CONTRADICTORY",
      policyVersion: "test/1.0.0",
      decideBuy: () => ({
        allowed: true,
        status: "ST",
        reason: "VERIFIED_ST",
        providerId: "TEST_CONTRADICTORY",
        policyVersion: "test/1.0.0",
        evidenceFingerprint: "test",
        checkedAt: `${D1}T09:15:00`,
        plannedCheckDate: D0,
      }),
    };
    const run = runOf({
      securities: [SEC_A],
      opens: [10, 11, 12, 13, 14, 15, 16, 17],
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { executionEligibilityGate: contradictory },
    });
    expect(run.trades).toHaveLength(0);
    expect(run.finalEquity).toBe(100_000);
    expect(auditOf(run)[0]!.outcome).toBe("REJECTED");
  });

  it("序列化往返：带闸门的运行记录可 serialize/deserialize 且指纹自洽", () => {
    const provider = providerOf([{ status: "NORMAL", from: D0, to: D7, availableAsOf: D0 }]);
    const run = runOf({
      securities: [SEC_A],
      opens: [10, 11, 12, 13, 14, 15, 16, 17],
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { executionEligibilityGate: gateOf(provider) },
    });
    const restored = deserializeTradeSimulationRun(serializeTradeSimulationRun(run));
    expect(restored.fingerprint).toBe(run.fingerprint);
    expect(restored.executionEligibilityAudit).toEqual(run.executionEligibilityAudit);
    expect(restored.config.executionEligibility).toEqual(run.config.executionEligibility);
  });
});

// ---------------------------------------------------------------------------
// 9) 日内与日期边界（冻结语义）
// ---------------------------------------------------------------------------

describe("9) 日内与日期边界：09:00 到期 / 08:00 生效 / 精确端点 / 日期终点 / 隔夜 / availableAsOf 过晚", () => {
  interface BoundaryCase {
    readonly label: string;
    readonly spec: FactSpec;
    readonly shouldFill: boolean;
    readonly expectedStatus: "NORMAL" | "ST" | "UNKNOWN";
    readonly expectedReason: string;
  }
  const cases: readonly BoundaryCase[] = [
    {
      label: "A 当日00:00→09:00（PRE_FILL 09:15 已失效）",
      spec: { status: "NORMAL", from: D1, to: `${D1}T09:00:00`, availableAsOf: D0 },
      shouldFill: false, expectedStatus: "UNKNOWN", expectedReason: "NOT_EFFECTIVE_ON_TRADE_DATE",
    },
    {
      label: "B 当日08:00→23:59:59（09:15 已生效）",
      spec: { status: "NORMAL", from: `${D1}T08:00:00`, to: `${D1}T23:59:59`, availableAsOf: D0 },
      shouldFill: true, expectedStatus: "NORMAL", expectedReason: "VERIFIED_NORMAL",
    },
    {
      label: "C 精确端点：effectiveTo=09:15:00（失效含）",
      spec: { status: "NORMAL", from: `${D1}T08:00:00`, to: `${D1}T09:15:00`, availableAsOf: D0 },
      shouldFill: true, expectedStatus: "NORMAL", expectedReason: "VERIFIED_NORMAL",
    },
    {
      label: "D 精确端点：effectiveFrom=09:15:00（生效含）",
      spec: { status: "NORMAL", from: `${D1}T09:15:00`, to: `${D1}T23:59:59`, availableAsOf: D0 },
      shouldFill: true, expectedStatus: "NORMAL", expectedReason: "VERIFIED_NORMAL",
    },
    {
      label: "E 精确端点：effectiveFrom=09:15:01（尚未生效）",
      spec: { status: "NORMAL", from: `${D1}T09:15:01`, to: `${D1}T23:59:59`, availableAsOf: D0 },
      shouldFill: false, expectedStatus: "UNKNOWN", expectedReason: "NOT_EFFECTIVE_ON_TRADE_DATE",
    },
    {
      label: "F 日期终点：effectiveTo=成交日（覆盖整日，含 09:15）",
      spec: { status: "NORMAL", from: D0, to: D1, availableAsOf: D0 },
      shouldFill: true, expectedStatus: "NORMAL", expectedReason: "VERIFIED_NORMAL",
    },
    {
      label: "G 隔夜转 ST：确认日 NORMAL、成交日 00:00 起 ST",
      spec: {
        symbol: "000001.SZ", status: "ST", from: `${D1}T00:00:00`, to: D7, availableAsOf: D0,
      },
      shouldFill: false, expectedStatus: "ST", expectedReason: "VERIFIED_ST",
    },
    {
      label: "H availableAsOf 过晚（成交日 10:00 才可知）",
      spec: { status: "NORMAL", from: D0, to: D7, availableAsOf: `${D1}T10:00:00` },
      shouldFill: false, expectedStatus: "UNKNOWN", expectedReason: "NOT_AVAILABLE_AS_OF",
    },
    {
      label: "I 无效日期（2024-13-45）不得字典序放行",
      spec: { status: "NORMAL", from: D0, to: "2024-13-45", availableAsOf: D0 },
      shouldFill: false, expectedStatus: "UNKNOWN", expectedReason: "INVALID_STATUS_TIME_FORMAT",
    },
    {
      label: "J 不支持的时间格式（2024-3-4T08:00:00）不得放行",
      spec: { status: "NORMAL", from: "2024-3-4T08:00:00", to: D7, availableAsOf: D0 },
      shouldFill: false, expectedStatus: "UNKNOWN", expectedReason: "INVALID_STATUS_TIME_FORMAT",
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.label} ⇒ ${testCase.shouldFill ? "成交" : "拒单"}（${testCase.expectedReason}）`, () => {
      const run = runOf({
        securities: [SEC_A],
        opens: [10, 11, 12, 13, 14, 15, 16, 17],
        days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
        simConfig: { executionEligibilityGate: gateOf(providerOf([testCase.spec])) },
      });
      const audit = auditOf(run);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.status).toBe(testCase.expectedStatus);
      expect(audit[0]!.reason).toBe(testCase.expectedReason);
      expect(audit[0]!.checkedAt).toBe(`${D1}T09:15:00`);
      if (testCase.shouldFill) {
        expect(run.trades).toHaveLength(1);
        expect(audit[0]!.outcome).toBe("FILLED");
      } else {
        expect(run.trades).toHaveLength(0);
        expect(audit[0]!.outcome).toBe("REJECTED");
        expect(run.finalEquity).toBe(100_000);
      }
    });
  }

  it("单时点契约与引擎判决同源：同一 (symbol, tradeDate, PRE_FILL) 直接求值给出相同 status", () => {
    const provider = providerOf([{ status: "NORMAL", from: D0, to: D7, availableAsOf: D0 }]);
    const direct = evaluateStGate({
      provider,
      query: {
        symbol: "000001.SZ",
        tradeDate: D1,
        timepoint: "PRE_FILL",
        effectiveAt: `${D1}T09:15:00`,
      },
    });
    const run = runOf({
      securities: [SEC_A],
      opens: [10, 11, 12, 13, 14, 15, 16, 17],
      days: [{ date: D0, intents: [{ securityId: SEC_A, value: 0.05 }] }],
      simConfig: { executionEligibilityGate: gateOf(provider) },
    });
    expect(direct.outcome).toBe("NORMAL");
    expect(auditOf(run)[0]!.status).toBe(direct.outcome);
    expect(auditOf(run)[0]!.reason).toBe(direct.reason);
  });
});
