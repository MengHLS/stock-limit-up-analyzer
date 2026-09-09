/**
 * STEP 14 / C-14.3 — 执行与约束模型测试（纯内存 fixture，无 DB）。
 *
 * 覆盖（对应任务验收）：
 *   (a) 约束 schema 校验：资金非正 / 持仓数上限非法 / 单标的·总仓位上限越界 /
 *       perSecurity > total 冲突 / 手数非法 / 非法执行模型 id（含自造时机）/
 *       禁买禁卖列表乱序·重复·空项 / marketClaims 字面量被篡改（tPlus1=false 等）/
 *       板块覆盖非法 → 结构化 issue 集合，assert* 抛 ResearchValidationError；
 *   (b) round-trip：canonical serialize（键字典序，与键插入序无关）→ deserialize
 *       深相等、串稳定、指纹相同；NaN 拒绝；篡改/声明退化在反序列化时被拦截；
 *   (c) 映射正确：声明 → C-14.1 SimulationConfig 逐字段正确（资金/持仓数/执行规则/
 *       手数写回/部分成交/boards/directionPolicy），并经 simulator validateSimulationConfig
 *       复核；手数写回外部 CostModel 的 note；不可执行轴（perSecurityCap/totalCap/
 *       buyBanned/sellBanned/LIMIT_PRICE）→ 显式 blocker 报错不静默；
 *   (d) 约束生效端到端（import runTradeSimulation 跑小 fixture）：
 *       - 并发持仓数上限导致超额候选被拒（MAX_POSITIONS_REACHED skip）；
 *       - 买卖限制阻止成交（开盘涨停禁买 → LIMIT_UP 拒绝；开盘跌停禁卖 → LIMIT_DOWN 拒绝；
 *         同场景关闭拦截则正常成交）；
 *       - lot 舍入生效（成交股数均为 lotSize=100 的整数倍；声明手数写回 cost.lotSize）；
 *   (e) 确定性：两次「声明→映射→模拟」全链路结果深相等，声明串与指纹稳定。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../data";
import type { CostModel } from "../../engine/domain";
import {
  RESEARCH_DATASET_BUILDER_VERSION,
  type DataSnapshot,
  type ResearchDataset,
  type ResearchDatasetRow,
  type UniverseDayResult,
} from "../../researchDataset/types";
import type { CandidateEvaluationRun } from "../signalEngine";
import { runCandidateEngine } from "../signalEngine";
import { deriveDatasetUniverseId } from "../datasetAccess/handle";
import {
  makeBarFeatureProvider,
  makeWeightedSignalBuilder,
  type ExperimentConfig,
  type StrategyContract,
} from "../framework";
import { runTradeSimulation, validateSimulationConfig } from "../simulator";
import {
  assertMapExecutionConstraintDeclaration,
  createExecutionConstraintDeclaration,
  deserializeExecutionConstraintDeclaration,
  mapExecutionConstraintDeclaration,
  serializeExecutionConstraintDeclaration,
  validateExecutionConstraintDeclaration,
  computeExecutionConstraintDeclarationFingerprint,
  describeExecutionConstraintCoverage,
  type ExecutionConstraintDeclaration,
  type ConstraintEnforcementState,
} from "./index";
import { ResearchValidationError } from "../experimentValidation";

// ---------------------------------------------------------------------------
// 常量与基础 fixture 构建（对齐 simulator.test.ts 口径）
// ---------------------------------------------------------------------------

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 5,
};

interface SeedSpec {
  date: string;
  sec: string;
  open: number;
  close: number;
  preClose: number;
}

function makeRow(seed: SeedSpec): ResearchDatasetRow {
  const high = Math.max(seed.open, seed.close) + 0.05;
  const low = Math.min(seed.open, seed.close) - 0.05;
  const close = seed.close;
  return {
    tradeDate: seed.date,
    asOf: seed.date,
    securityId: seed.sec,
    code: `${seed.sec}.SH`,
    securityType: "stock",
    exchange: "SH",
    lifecycleVerdict: "LISTED",
    eligible: true,
    exclusionReason: null,
    st: "NORMAL",
    industryCode: "801780",
    industryName: "测试行业",
    turnoverRate: 2.5,
    circulationMarketCap: 2_000_000_000,
    totalMarketCap: 2_400_000_000,
    liquidityAmount: 800_000,
    liquidityVolume: 160_000,
    open: seed.open,
    high,
    low,
    close,
    preClose: seed.preClose,
    volume: 100_000,
    // 成交额足够大（≥ 2,000,000 千元），使滑点分层加成 = 0（fixture 零滑点）。
    amount: 5_000_000,
    corporateActionsEffectiveCount: 0,
    corporateActionsKnownCount: 0,
    indexClose: { "000300.SH": 4000 },
    knowledge: {
      policy: "PIT",
      listing: "KNOWN",
      delisting: "KNOWN",
      tradability: "KNOWN",
      industry: "KNOWN",
      liquidity: "KNOWN",
      price: "KNOWN",
      corporateActions: "KNOWN",
      marketState: "KNOWN",
    },
  };
}

interface BuiltDataset {
  readonly dataset: ResearchDataset;
  readonly dates: readonly string[];
}

function buildDataset(
  specs: readonly SeedSpec[],
  datasetVersion: string
): BuiltDataset {
  const sorted = specs
    .slice()
    .sort((a, b) =>
      a.date !== b.date
        ? a.date.localeCompare(b.date)
        : a.sec.localeCompare(b.sec)
    );
  const rows = sorted.map(seed => makeRow(seed));
  const dateOrder = Array.from(new Set(sorted.map(s => s.date))).sort();
  const membersByDate = new Map<string, string[]>();
  for (const date of dateOrder) {
    const secs = sorted.filter(s => s.date === date).map(s => s.sec);
    membersByDate.set(date, secs);
  }
  const universeDays: UniverseDayResult[] = dateOrder.map(date => ({
    tradeDate: date,
    isTradingDay: true,
    members: membersByDate.get(date)!.slice(),
    excludedByReason: {},
  }));
  const snapshot: DataSnapshot = {
    capturedAt: "2026-01-01T00:00:00.000Z",
    request: {
      name: "excon14-test-daily",
      startDate: dateOrder[0]!,
      endDate: dateOrder[dateOrder.length - 1]!,
      asOfPerTradeDate: true,
      asOf: null,
      coreIndexCodes: ["000300.SH"],
    },
    calendarName: "cn-stock",
    calendarFirstDate: dateOrder[0]!,
    calendarLastDate: dateOrder[dateOrder.length - 1]!,
    tradingDays: dateOrder.length,
    domains: [],
    coverageGaps: [],
  };
  const dataset: ResearchDataset = {
    datasetVersion,
    universeDefinition: {
      rule: "test",
      asOfDescription: "PIT per tradeDate",
      days: universeDays,
    },
    policySet: [],
    dataSnapshot: snapshot,
    rows,
    gate: "PASS",
    gateNotes: [],
  };
  return { dataset, dates: dateOrder };
}

function makeStrategy(topN: number): StrategyContract {
  return {
    strategyId: "excon-test-strategy",
    strategyVersion: "1.0.0",
    name: "C-14.3 测试策略",
    description: "仅用于 executionConstraints 测试。",
    parameters: {
      parameters: [{ name: "topN", type: "number", required: true, min: 1 }],
    },
    requiredData: ["OHLCV"],
    signalFrequency: "daily",
  };
}

function makeExperimentConfig(
  datasetVersion: string,
  startDate: string,
  endDate: string,
  topN: number
): ExperimentConfig {
  return {
    datasetVersion,
    strategyId: "excon-test-strategy",
    strategyVersion: "1.0.0",
    parameters: { topN },
    universe: { universeId: deriveDatasetUniverseId(datasetVersion) },
    dateRange: { startDate, endDate },
    costModel: COST,
    randomSeed: 7,
  };
}

/** 运行候选引擎（C-13.2），产出交易模拟的输入（对齐 simulator.test.ts 辅助函数）。 */
function runCandidates(
  built: BuiltDataset,
  datasetVersion: string,
  decisionStart: string,
  decisionEnd: string,
  topN: number
): CandidateEvaluationRun {
  const pctChange = makeBarFeatureProvider({
    featureId: "pctChange",
    version: "1.0.0",
    availability: {
      requiredDataThrough: { date: decisionStart, point: "close" },
      availableAt: { date: decisionStart, point: "close" },
    },
    compute: (bars: readonly CanonicalMarketBar[]) => {
      const last = bars[bars.length - 1];
      if (
        last === undefined ||
        last.close === null ||
        last.preClose === null ||
        last.preClose === 0
      )
        return null;
      return last.close / last.preClose - 1;
    },
  });
  return runCandidateEngine({
    dataset: built.dataset,
    config: makeExperimentConfig(
      datasetVersion,
      decisionStart,
      decisionEnd,
      topN
    ),
    strategy: makeStrategy(topN),
    strategy13: {
      point: "close",
      features: [pctChange],
      signalBuilder: makeWeightedSignalBuilder({ pctChange: 1 }),
      rankingConfig: { higherIsBetter: true },
      selectionConfig: { method: { kind: "topN", n: topN } },
      signalDescription: "按日涨跌幅择优（long-only 候选研究）",
    },
  });
}

// 测试日期窗口（与测试场景一一对应，避免跨用例共用状态）
const M1 = "2026-01-05";
const M2 = "2026-01-06";
const U1 = "2026-04-06";
const U2 = "2026-04-07";
const R1 = "2026-02-02";
const R2 = "2026-02-03";
const R3 = "2026-02-04";
const R4 = "2026-02-05";

const DECL_VERSION = "excon-v1";

function coverageState(
  decl: ExecutionConstraintDeclaration,
  key: string
): ConstraintEnforcementState {
  return describeExecutionConstraintCoverage(decl).find(item => item.key === key)!
    .enforcement;
}

// ---------------------------------------------------------------------------
// (a) 约束 schema 校验
// ---------------------------------------------------------------------------

describe("约束 schema 校验（validateExecutionConstraintDeclaration）", () => {
  it("规范声明（工厂默认值 + 显式资金）→ 无 issue", () => {
    const decl = createExecutionConstraintDeclaration({
      label: "plain",
      initialCapital: 100_000,
    });
    const result = validateExecutionConstraintDeclaration(decl);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("初始资金非正 / 非有限 → EXCON_INITIAL_CAPITAL_INVALID", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const decl = structuredClone(
        createExecutionConstraintDeclaration({ initialCapital: 100_000 })
      ) as ExecutionConstraintDeclaration;
      (decl.capital as { initialCapital: number }).initialCapital = value;
      const result = validateExecutionConstraintDeclaration(decl);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(i => i.code === "EXCON_INITIAL_CAPITAL_INVALID")
      ).toBe(true);
    }
  });

  it("并发持仓数上限非法（0/负/小数）→ issue；null 放行", () => {
    for (const value of [0, -3, 1.5]) {
      const decl = createExecutionConstraintDeclaration({
        initialCapital: 100_000,
        positions: { maxPositionCount: value },
      });
      const result = validateExecutionConstraintDeclaration(decl);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(i => i.code === "EXCON_MAX_POSITION_COUNT_INVALID")
      ).toBe(true);
    }
    const declNull = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      positions: { maxPositionCount: null },
    });
    expect(validateExecutionConstraintDeclaration(declNull).valid).toBe(true);
  });

  it("单标的/总仓位上限越界（0 / >1 / 负 / 非有限）→ issue；(0,1] 放行", () => {
    for (const value of [0, -0.1, 1.01, Number.NaN]) {
      const decl = createExecutionConstraintDeclaration({
        initialCapital: 100_000,
        positions: { perSecurityEquityCap: value },
      });
      const result = validateExecutionConstraintDeclaration(decl);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(i => i.code === "EXCON_PER_SECURITY_CAP_INVALID")
      ).toBe(true);
    }
    const declTotalBad = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      positions: { totalEquityCap: 1.5 },
    });
    expect(
      validateExecutionConstraintDeclaration(declTotalBad).issues.some(
        i => i.code === "EXCON_TOTAL_EQUITY_CAP_INVALID"
      )
    ).toBe(true);

    const declOk = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      positions: { perSecurityEquityCap: 0.25, totalEquityCap: 0.8 },
    });
    expect(validateExecutionConstraintDeclaration(declOk).valid).toBe(true);
  });

  it("单标的仓位上限 > 总仓位上限 → EXCON_POSITION_CAP_CONFLICT", () => {
    const decl = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      positions: { perSecurityEquityCap: 0.9, totalEquityCap: 0.5 },
    });
    const result = validateExecutionConstraintDeclaration(decl);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(i => i.code === "EXCON_POSITION_CAP_CONFLICT")
    ).toBe(true);
  });

  it("一手股数非法（0/负/小数）→ EXCON_LOT_SIZE_INVALID", () => {
    for (const value of [0, -100, 50.5]) {
      const decl = createExecutionConstraintDeclaration({
        initialCapital: 100_000,
        lot: { lotSize: value },
      });
      const result = validateExecutionConstraintDeclaration(decl);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(i => i.code === "EXCON_LOT_SIZE_INVALID")
      ).toBe(true);
    }
  });

  it("非法执行模型 id（含研究链自造时机）→ EXCON_EXECUTION_MODEL_INVALID；STEP 8 四枚举放行", () => {
    for (const bad of ["OPEN_PLUS_5_MIN", "AUCTION_ONLY", "NEXT_YEAR"]) {
      const decl = createExecutionConstraintDeclaration({
        initialCapital: 100_000,
        timing: { executionModel: bad as never },
      });
      const result = validateExecutionConstraintDeclaration(decl);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(i => i.code === "EXCON_EXECUTION_MODEL_INVALID")
      ).toBe(true);
    }
    for (const good of ["NEXT_OPEN", "NEXT_CLOSE", "VWAP_PROXY", "LIMIT_PRICE"]) {
      const decl = createExecutionConstraintDeclaration({
        initialCapital: 100_000,
        timing: { executionModel: good as never },
      });
      expect(validateExecutionConstraintDeclaration(decl).valid).toBe(true);
    }
  });

  it("禁买/禁卖列表乱序或重复 → EXCON_BANNED_NOT_CANONICAL；空项 → EXCON_BANNED_ENTRY_INVALID", () => {
    const unsorted = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      restrictions: { buyBanned: ["B.SZ", "A.SZ"] },
    });
    // 工厂会规范化 → 需绕过工厂直接构造非法形。
    const raw = structuredClone(
      createExecutionConstraintDeclaration({ initialCapital: 100_000 })
    ) as unknown as Record<string, unknown>;
    (raw.restrictions as Record<string, unknown>).buyBanned = ["B.SZ", "A.SZ"];
    const r1 = validateExecutionConstraintDeclaration(
      raw as unknown as ExecutionConstraintDeclaration
    );
    expect(r1.valid).toBe(false);
    expect(
      r1.issues.some(i => i.code === "EXCON_BANNED_NOT_CANONICAL")
    ).toBe(true);

    const dup = structuredClone(
      createExecutionConstraintDeclaration({ initialCapital: 100_000 })
    ) as unknown as Record<string, unknown>;
    (dup.restrictions as Record<string, unknown>).sellBanned = ["A.SZ", "A.SZ"];
    const r2 = validateExecutionConstraintDeclaration(
      dup as unknown as ExecutionConstraintDeclaration
    );
    expect(r2.valid).toBe(false);
    expect(
      r2.issues.some(i => i.code === "EXCON_BANNED_NOT_CANONICAL")
    ).toBe(true);

    const emptyEntry = structuredClone(
      createExecutionConstraintDeclaration({ initialCapital: 100_000 })
    ) as unknown as Record<string, unknown>;
    (emptyEntry.restrictions as Record<string, unknown>).buyBanned = ["  "];
    const r3 = validateExecutionConstraintDeclaration(
      emptyEntry as unknown as ExecutionConstraintDeclaration
    );
    expect(r3.valid).toBe(false);
    expect(
      r3.issues.some(i => i.code === "EXCON_BANNED_ENTRY_INVALID")
    ).toBe(true);

    // 工厂规范化后校验放行。
    const sorted = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      restrictions: {
        buyBanned: ["B.SZ", "A.SZ", "A.SZ"],
        sellBanned: ["C.SZ"],
      },
    });
    expect(sorted.restrictions.buyBanned).toEqual(["A.SZ", "B.SZ"]);
    expect(validateExecutionConstraintDeclaration(sorted).valid).toBe(true);
  });

  it("marketClaims 字面量被篡改（tPlus1=false 等）→ 守卫 issue", () => {
    const tampered = structuredClone(
      createExecutionConstraintDeclaration({ initialCapital: 100_000 })
    ) as unknown as Record<string, unknown>;
    (tampered.marketClaims as Record<string, unknown>).tPlus1 = false;
    const result = validateExecutionConstraintDeclaration(
      tampered as unknown as ExecutionConstraintDeclaration
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(i => i.code === "EXCON_CLAIM_T_PLUS_1")
    ).toBe(true);
  });

  it("boards 值非法（非板块枚举）→ EXCON_BOARDS_VALUE_INVALID", () => {
    const decl = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      marketClaims: { boards: { "300750.SZ": "otc" as never } },
    });
    const result = validateExecutionConstraintDeclaration(decl);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(i => i.code === "EXCON_BOARDS_VALUE_INVALID")
    ).toBe(true);
  });

  it("多问题聚合：一次非法输入产出完整 issue 集（非短路）", () => {
    const raw = {
      recordKind: "EXECUTION_CONSTRAINT_DECLARATION",
      recordVersion: 1,
      capital: { initialCapital: -5 },
      positions: { perSecurityEquityCap: 1.2 },
      lot: { lotSize: 0 },
      restrictions: { buyBanned: ["B.SZ", "A.SZ"], sellBanned: [] },
      timing: { executionModel: "OPEN_PLUS_5_MIN", allowPartialFill: false },
      marketClaims: {
        tPlus1: true,
        decisionPoint: "close",
        directionPolicy: "longOnly",
        suspensionMode: "REJECT_NO_BAR",
        corporateActions: "NOT_APPLIED",
        boards: {},
      },
    };
    const result = validateExecutionConstraintDeclaration(
      raw as unknown as ExecutionConstraintDeclaration
    );
    expect(result.valid).toBe(false);
    const codes = new Set(result.issues.map(i => i.code));
    expect(codes.has("EXCON_INITIAL_CAPITAL_INVALID")).toBe(true);
    expect(codes.has("EXCON_PER_SECURITY_CAP_INVALID")).toBe(true);
    expect(codes.has("EXCON_LOT_SIZE_INVALID")).toBe(true);
    expect(codes.has("EXCON_BANNED_NOT_CANONICAL")).toBe(true);
    expect(codes.has("EXCON_EXECUTION_MODEL_INVALID")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) round-trip / 序列化
// ---------------------------------------------------------------------------

describe("序列化与 round-trip", () => {
  it("serialize → deserialize 深相等，串稳定，指纹相同", () => {
    const decl = createExecutionConstraintDeclaration({
      label: "roundtrip",
      initialCapital: 100_000,
      positions: { maxPositionCount: 3 },
      restrictions: { blockLimitUpBuy: true },
      timing: { executionModel: "VWAP_PROXY" },
    });
    const json = serializeExecutionConstraintDeclaration(decl);
    const restored = deserializeExecutionConstraintDeclaration(json);
    expect(restored).toEqual(decl);
    expect(serializeExecutionConstraintDeclaration(restored)).toBe(json);
    expect(computeExecutionConstraintDeclarationFingerprint(restored)).toBe(
      computeExecutionConstraintDeclarationFingerprint(decl)
    );
  });

  it("canonical：键插入序无关，同内容同串同指纹", () => {
    const factory = createExecutionConstraintDeclaration({
      label: "canon",
      initialCapital: 200_000,
      positions: { maxPositionCount: 2, perSecurityEquityCap: 0.3 },
      marketClaims: { boards: { "300750.SZ": "gem" } },
    });
    const scrambled = {
      recordVersion: 1,
      marketClaims: {
        boards: { "300750.SZ": "gem" },
        corporateActions: "NOT_APPLIED",
        directionPolicy: "longOnly",
        decisionPoint: "close",
        suspensionMode: "REJECT_NO_BAR",
        tPlus1: true,
      },
      recordKind: "EXECUTION_CONSTRAINT_DECLARATION",
      timing: { allowPartialFill: false, executionModel: "NEXT_OPEN" },
      lot: { lotSize: 100 },
      restrictions: {
        blockLimitDownSell: false,
        buyBanned: [],
        sellBanned: [],
        blockLimitUpBuy: false,
      },
      positions: {
        perSecurityEquityCap: 0.3,
        maxPositionCount: 2,
        totalEquityCap: null,
      },
      capital: { initialCapital: 200_000 },
      label: "canon",
    } as unknown as ExecutionConstraintDeclaration;
    expect(serializeExecutionConstraintDeclaration(scrambled)).toBe(
      serializeExecutionConstraintDeclaration(factory)
    );
    expect(computeExecutionConstraintDeclarationFingerprint(scrambled)).toBe(
      computeExecutionConstraintDeclarationFingerprint(factory)
    );
  });

  it("拒绝序列化非有限数字（NaN 静默折叠防线）", () => {
    const bad = structuredClone(
      createExecutionConstraintDeclaration({ initialCapital: 100_000 })
    ) as ExecutionConstraintDeclaration;
    (bad.capital as { initialCapital: number }).initialCapital = Number.NaN;
    expect(() => serializeExecutionConstraintDeclaration(bad)).toThrow(
      /非有限数字/
    );
  });

  it("篡改/声明退化在反序列化时被拦截（结构校验）", () => {
    const json = serializeExecutionConstraintDeclaration(
      createExecutionConstraintDeclaration({ initialCapital: 100_000 })
    );
    const parsed = JSON.parse(json) as Record<string, unknown>;
    (parsed.capital as Record<string, unknown>).initialCapital = -1;
    expect(() =>
      deserializeExecutionConstraintDeclaration(JSON.stringify(parsed))
    ).toThrow(/EXCON_INITIAL_CAPITAL_INVALID/);

    const parsed2 = JSON.parse(json) as Record<string, unknown>;
    (parsed2.marketClaims as Record<string, unknown>).tPlus1 = false;
    expect(() =>
      deserializeExecutionConstraintDeclaration(JSON.stringify(parsed2))
    ).toThrow(/EXCON_CLAIM_T_PLUS_1/);
  });
});

// ---------------------------------------------------------------------------
// (c) 声明 → C-14.1 SimulationConfig 装配映射
// ---------------------------------------------------------------------------

describe("映射到 simulator SimulationConfig", () => {
  it("可执行子集逐字段映射正确，且通过 C-14.1 validateSimulationConfig 复核", () => {
    const decl = createExecutionConstraintDeclaration({
      label: "mapped",
      initialCapital: 1_000_000,
      positions: { maxPositionCount: 5 },
      restrictions: { blockLimitUpBuy: true, blockLimitDownSell: true },
      timing: { executionModel: "NEXT_CLOSE", allowPartialFill: true },
      marketClaims: { boards: { "300750.SZ": "gem", "688981.SH": "star" } },
    });
    const mapping = mapExecutionConstraintDeclaration(decl, COST);
    expect(mapping.ok).toBe(true);
    expect(mapping.issues).toEqual([]);
    const config = mapping.simConfig!;
    expect(config.name).toBe("mapped");
    expect(config.initialCapital).toBe(1_000_000);
    expect(config.maxPositions).toBe(5);
    expect(config.executionModel).toBe("NEXT_CLOSE");
    expect(config.directionPolicy).toBe("longOnly");
    expect(config.allowPartialFill).toBe(true);
    expect(config.executionRules).toEqual({
      blockLimitUpBuy: true,
      blockLimitDownSell: true,
    });
    expect(config.cost).toEqual(COST); // 声明手数 = 外部 cost.lotSize = 100，无覆盖
    expect(config.securityBoards).toEqual({
      "300750.SZ": "gem",
      "688981.SH": "star",
    });
    // C-14.1 侧复核：映射产物一定是 simulator 敢收的配置。
    const simValidation = validateSimulationConfig(config);
    expect(simValidation.valid).toBe(true);
  });

  it("声明手数写回外部 CostModel.lotSize，且附说明 note", () => {
    const decl = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      lot: { lotSize: 200 },
    });
    const mapping = mapExecutionConstraintDeclaration(decl, COST);
    expect(mapping.ok).toBe(true);
    expect(mapping.simConfig!.cost.lotSize).toBe(200);
    expect(mapping.simConfig!.cost.commissionRate).toBe(
      COST.commissionRate
    ); // 其余字段保留外部 cost
    expect(
      mapping.notes.some(note => note.includes("lotSize=200"))
    ).toBe(true);
  });

  it("单标的/总仓位上限非空 → blocker issue（不静默丢弃）", () => {
    const perSecurity = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      positions: { perSecurityEquityCap: 0.3 },
    });
    const m1 = mapExecutionConstraintDeclaration(perSecurity, COST);
    expect(m1.ok).toBe(false);
    expect(m1.simConfig).toBeUndefined();
    expect(
      m1.issues.some(i => i.code === "EXMAP_UNENFORCEABLE_PER_SECURITY_EQUITY_CAP")
    ).toBe(true);
    expect(() =>
      assertMapExecutionConstraintDeclaration(perSecurity, COST)
    ).toThrow(ResearchValidationError);

    const totalCap = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      positions: { totalEquityCap: 0.8 },
    });
    const m2 = mapExecutionConstraintDeclaration(totalCap, COST);
    expect(m2.ok).toBe(false);
    expect(
      m2.issues.some(i => i.code === "EXMAP_UNENFORCEABLE_TOTAL_EQUITY_CAP")
    ).toBe(true);
  });

  it("禁买/禁卖标的集非空 → blocker issue", () => {
    const buyBan = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      restrictions: { buyBanned: ["600000.SH"] },
    });
    const m1 = mapExecutionConstraintDeclaration(buyBan, COST);
    expect(m1.ok).toBe(false);
    expect(
      m1.issues.some(i => i.code === "EXMAP_UNENFORCEABLE_BUY_BANNED")
    ).toBe(true);

    const sellBan = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      restrictions: { sellBanned: ["600000.SH"] },
    });
    const m2 = mapExecutionConstraintDeclaration(sellBan, COST);
    expect(m2.ok).toBe(false);
    expect(
      m2.issues.some(i => i.code === "EXMAP_UNENFORCEABLE_SELL_BANNED")
    ).toBe(true);
  });

  it("LIMIT_PRICE 声明 → blocker（C-14.1 只发市价单，真限价即伪造）", () => {
    const decl = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      timing: { executionModel: "LIMIT_PRICE" },
    });
    // 值域校验放行（尊重 STEP 8 枚举），但映射报不可执行。
    expect(validateExecutionConstraintDeclaration(decl).valid).toBe(true);
    const mapping = mapExecutionConstraintDeclaration(decl, COST);
    expect(mapping.ok).toBe(false);
    expect(
      mapping.issues.some(
        i => i.code === "EXMAP_UNENFORCEABLE_EXECUTION_MODEL_LIMIT_PRICE"
      )
    ).toBe(true);
  });

  it("能力矩阵：可执行轴 ENFORCED；未设约束轴 NOT_DECLARED；声明不可执行轴 DECLARED_ONLY", () => {
    const plain = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      positions: { maxPositionCount: 2 },
    });
    expect(coverageState(plain, "capital.initialCapital")).toBe("ENFORCED");
    expect(coverageState(plain, "positions.maxPositionCount")).toBe("ENFORCED");
    expect(coverageState(plain, "positions.perSecurityEquityCap")).toBe(
      "NOT_DECLARED"
    );
    expect(coverageState(plain, "positions.totalEquityCap")).toBe("NOT_DECLARED");
    expect(coverageState(plain, "restrictions.buyBanned")).toBe("NOT_DECLARED");
    expect(coverageState(plain, "lot.lotSize")).toBe("ENFORCED");
    expect(coverageState(plain, "timing.executionModel")).toBe("ENFORCED");
    expect(coverageState(plain, "marketClaims.tPlus1")).toBe("ENFORCED");

    const rich = createExecutionConstraintDeclaration({
      initialCapital: 100_000,
      positions: { perSecurityEquityCap: 0.3, totalEquityCap: 0.8 },
      restrictions: { buyBanned: ["600000.SH"] },
      timing: { executionModel: "LIMIT_PRICE" },
    });
    expect(coverageState(rich, "positions.perSecurityEquityCap")).toBe(
      "DECLARED_ONLY"
    );
    expect(coverageState(rich, "positions.totalEquityCap")).toBe("DECLARED_ONLY");
    expect(coverageState(rich, "restrictions.buyBanned")).toBe("DECLARED_ONLY");
    expect(coverageState(rich, "timing.executionModel")).toBe("DECLARED_ONLY");
  });

  it("声明非法时映射直接抛错（编程错误，不产出半成品配置）", () => {
    const bad = createExecutionConstraintDeclaration({
      initialCapital: 0, // 非法资金
    });
    expect(() => mapExecutionConstraintDeclaration(bad, COST)).toThrow(
      ResearchValidationError
    );
  });
});

// ---------------------------------------------------------------------------
// (d) 约束生效端到端（import runTradeSimulation，跑小 fixture）
// ---------------------------------------------------------------------------

describe("约束生效端到端（runTradeSimulation）", () => {
  it("并发持仓数上限=1 导致超额候选被拒（MAX_POSITIONS_REACHED）", () => {
    // E 窗口单决策日两候选（A/B pct 均正，topN=2 双双入选），并发上限 1 → 只成交其一。
    // M2 开盘价低于决策日收盘估算价，保证成交全额可行（与 simulator 端到端口径一致）。
    const seeds: readonly SeedSpec[] = [
      { date: M1, sec: "A", open: 9.9, close: 10.0, preClose: 9.5 },
      { date: M1, sec: "B", open: 19.9, close: 20.2, preClose: 19.5 },
      { date: M2, sec: "A", open: 9.6, close: 9.5, preClose: 10.0 },
      { date: M2, sec: "B", open: 20.0, close: 20.0, preClose: 20.2 },
    ];
    const built = buildDataset(seeds, "excon-maxpos-v1");
    const candidate = runCandidates(built, "excon-maxpos-v1", M1, M1, 2);
    expect(candidate.days[0]!.positionIntents).toHaveLength(2);

    const decl = createExecutionConstraintDeclaration({
      label: "maxPos1",
      initialCapital: 100_000,
      positions: { maxPositionCount: 1 },
    });
    const simConfig = assertMapExecutionConstraintDeclaration(decl, COST, {
      dateRange: { startDate: M1, endDate: M2 },
    });
    expect(simConfig.maxPositions).toBe(1);

    const run = runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig,
    });
    // 计划层只放行 1 单；超限候选被显式跳过。
    expect(run.executionStats.totalOrders).toBe(1);
    expect(run.executionStats.totalFills).toBe(1);
    const skip = run.skipped.find(s => s.side === "buy");
    expect(skip).toBeDefined();
    expect(skip!.date).toBe(M1);
    expect(skip!.code).toBe("MAX_POSITIONS_REACHED");
    expect(run.config.maxPositions).toBe(1);
    // lot 舍入：成交股数是 100 的整数倍。
    for (const fill of run.audit.fills) {
      expect(fill.quantity % 100).toBe(0);
    }
  });

  it("开盘涨停禁买 → 买入订单 LIMIT_UP 拒绝；关闭拦截则正常成交", () => {
    const seeds: readonly SeedSpec[] = [
      { date: U1, sec: "A", open: 10.0, close: 10.1, preClose: 10.0 },
      { date: U1, sec: "B", open: 9.9, close: 10.0, preClose: 9.7 },
      { date: U2, sec: "A", open: 10.0, close: 10.0, preClose: 10.1 },
      { date: U2, sec: "B", open: 11.0, close: 11.0, preClose: 10.0 },
    ];
    const built = buildDataset(seeds, "excon-limitup-v1");
    const candidate = runCandidates(built, "excon-limitup-v1", U1, U1, 1);
    expect(candidate.days[0]!.selected[0]!.securityId).toBe("B");

    // 开涨停禁买 → 拒绝。
    const blocked = createExecutionConstraintDeclaration({
      label: "blockLimitUp",
      initialCapital: 1_000_000,
      restrictions: { blockLimitUpBuy: true },
    });
    const runBlocked = runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig: assertMapExecutionConstraintDeclaration(blocked, COST, {
        dateRange: { startDate: U1, endDate: U2 },
      }),
    });
    expect(runBlocked.executionStats.totalFills).toBe(0);
    expect(runBlocked.executionStats.rejectedOrders).toBe(1);
    expect(runBlocked.executionStats.byReason.LIMIT_UP).toBe(1);
    const rejected = runBlocked.audit.orders.find(o => o.status === "REJECTED")!;
    expect(rejected.securityId).toBe("B");
    expect(rejected.rejectionReason).toBe("LIMIT_UP");

    // 同场景关闭拦截 + 部分成交 → 涨停开盘价成交（对照：限制是唯一拒绝原因）。
    const open = createExecutionConstraintDeclaration({
      label: "allowLimitUp",
      initialCapital: 1_000_000,
      restrictions: { blockLimitUpBuy: false },
      timing: { allowPartialFill: true },
    });
    const runOpen = runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig: assertMapExecutionConstraintDeclaration(open, COST, {
        dateRange: { startDate: U1, endDate: U2 },
      }),
    });
    expect(runOpen.executionStats.totalFills).toBe(1);
    expect(runOpen.audit.fills[0]!.basePrice).toBeCloseTo(11.0, 10);
    expect(runOpen.audit.fills[0]!.quantity % 100).toBe(0);
  });

  it("开盘跌停禁卖 → 卖出订单 LIMIT_DOWN 拒绝", () => {
    // A 入选（R1 决策）→ R2 开盘买入；R2/R3 B 接力入选 → A 掉出候选。
    // R2 收盘 A 冻结（T+1）卖出顺延；R3 收盘 A 可卖 → R4 开盘卖出，但 R4 开盘触及跌停。
    const seeds: readonly SeedSpec[] = [
      { date: R1, sec: "A", open: 10.4, close: 10.5, preClose: 10.0 },
      { date: R1, sec: "B", open: 10.1, close: 10.2, preClose: 10.0 },
      { date: R2, sec: "A", open: 10.5, close: 10.6, preClose: 10.5 },
      { date: R2, sec: "B", open: 10.4, close: 10.9, preClose: 10.2 },
      { date: R3, sec: "A", open: 10.5, close: 10.1, preClose: 10.6 },
      { date: R3, sec: "B", open: 10.85, close: 11.0, preClose: 10.9 },
      { date: R4, sec: "A", open: 9.0, close: 9.0, preClose: 10.1 }, // 跌停开盘
      { date: R4, sec: "B", open: 11.0, close: 11.2, preClose: 11.0 },
    ];
    const built = buildDataset(seeds, "excon-limitdown-v1");
    const candidate = runCandidates(built, "excon-limitdown-v1", R1, R4, 1);
    expect(candidate.days.map(d => d.selected[0]!.securityId)).toEqual([
      "A",
      "B",
      "B",
      "B",
    ]);

    const decl = createExecutionConstraintDeclaration({
      label: "blockLimitDown",
      initialCapital: 1_000_000,
      restrictions: { blockLimitDownSell: true },
    });
    const run = runTradeSimulation({
      dataset: built.dataset,
      sourceRun: candidate,
      simConfig: assertMapExecutionConstraintDeclaration(decl, COST),
    });
    // 仅 A 买入成交 1 笔（现金耗尽后 B 预算不足一手）；卖出被跌停拦截。
    expect(run.executionStats.totalFills).toBe(1);
    expect(run.executionStats.rejectedOrders).toBe(1);
    expect(run.executionStats.byReason.LIMIT_DOWN).toBe(1);
    const rejected = run.audit.orders.find(o => o.status === "REJECTED")!;
    expect(rejected.securityId).toBe("A");
    expect(rejected.side).toBe("sell");
    expect(rejected.rejectionReason).toBe("LIMIT_DOWN");
    // A 期末仍持仓（卖出失败未被静默成清仓）。
    expect(run.positions.find(p => p.securityId === "A")).toBeDefined();
    // lot 舍入：全部成交为 100 整数倍。
    for (const fill of run.audit.fills) {
      expect(fill.quantity % 100).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// (e) 确定性
// ---------------------------------------------------------------------------

describe("全链路确定性（声明 → 映射 → 模拟）", () => {
  it("两次独立运行结果深相等，声明串与指纹稳定", () => {
    const seeds: readonly SeedSpec[] = [
      { date: M1, sec: "A", open: 9.9, close: 10.0, preClose: 9.5 },
      { date: M1, sec: "B", open: 19.9, close: 20.2, preClose: 19.5 },
      { date: M2, sec: "A", open: 10.1, close: 10.0, preClose: 10.0 },
      { date: M2, sec: "B", open: 20.0, close: 19.8, preClose: 20.2 },
      { date: "2026-01-07", sec: "A", open: 10.0, close: 10.2, preClose: 10.0 },
      { date: "2026-01-07", sec: "B", open: 19.9, close: 20.5, preClose: 19.8 },
    ];
    const version = "excon-det-v1";

    function runOnce(): {
      run: ReturnType<typeof runTradeSimulation>;
      json: string;
      fingerprint: string;
    } {
      const decl = createExecutionConstraintDeclaration({
        label: "det",
        initialCapital: 100_000,
        positions: { maxPositionCount: 2 },
        restrictions: { blockLimitUpBuy: true },
      });
      const built = buildDataset(seeds, version);
      const candidate = runCandidates(built, version, M1, "2026-01-07", 2);
      const config = assertMapExecutionConstraintDeclaration(decl, COST);
      const run = runTradeSimulation({
        dataset: built.dataset,
        sourceRun: candidate,
        simConfig: config,
      });
      return {
        run,
        json: serializeExecutionConstraintDeclaration(decl),
        fingerprint: computeExecutionConstraintDeclarationFingerprint(decl),
      };
    }

    const first = runOnce();
    const second = runOnce();
    expect(second.run).toEqual(first.run);
    expect(second.run.fingerprint).toBe(first.run.fingerprint);
    expect(second.json).toBe(first.json);
    expect(second.fingerprint).toBe(first.fingerprint);
  });
});
