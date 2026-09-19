/**
 * BACKTEST-002（R-02）— `fixed-amount` 仓位口径正式进入 Strategy Schema。
 *
 * 规格 §4 的 7 条要求，逐条落到断言：
 *   ① schema 可声明 ② validation 可验证 ③ 声明 → 执行口径 → 实际下单股数 全链可通
 *   ④ `fixedAmount <= 0` 拒绝 ⑤ 缺失 `fixedAmount` 拒绝 ⑥ 不得静默退化成 equal-weight
 *   ⑦ 至少一个真实执行测试（本文件最后一节直接调 `planDecisionDay`）。
 *
 * 🔴 判据落在**真实执行层**（下单股数），不是「类型能不能写」。
 */

import { describe, expect, it } from "vitest";
import type { CostModel } from "../../../server/engine/domain";
import type { PositionIntent } from "../../../server/research/framework/contract";
import { planDecisionDay } from "../../../server/research/simulator/plan";
import {
  createStrategyDefinition,
  createStrategyDocument,
  createStrategyDocumentFromDefinition,
  deriveLegacyViews,
  validateStrategyDocument,
} from "../../../server/research/strategySchema/index";
import {
  FIRST_BOARD_PULLBACK_DATASET_VERSION,
  FIRST_BOARD_PULLBACK_DEFINITION,
  FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
} from "../../../server/research/strategySchema/goldenSample";
import { mapDeclaredPositionSizing } from "../../../server/runWorkbenchAssembly/assemble";

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 5,
} as CostModel;

const INITIAL_CAPITAL = 100_000;
const PRICE = 10;

/**
 * 以**黄金样例文档**（含齐备的 `executionAssumptions` 等必填段）为底，只覆写 `positionSizing`。
 *
 * 🔴 不能直接 `createStrategyDocument({ positionSizing: 非法值 })`：构造函数自身会校验并抛
 * `ResearchValidationError`（这是好事，但那样就测不到 `validateStrategyDocument` 的返回）。
 * 先取合法文档、再定点覆写，才能把「待测值」送进校验器。
 */
/**
 * 以**黄金样例**的 `executionAssumptions` 为执行口径底，构造一份 **v1 文档**（无 `definition` 段）。
 *
 * 🔴 为什么用 v1 文档而不是覆写富文档的 `positionSizing`：富文档的 v1 视图由 `definition`
 * **派生**，直接改 `positionSizing` 会触发 `SCHEMA_DEFINITION_VIEW_DRIFT`（那是既有的一致性闸门，
 * 正确地拦住了「绕过 definition 改视图」）。而 `fixed-amount` 的**权威声明位置**是
 * `definition.position`，其派生已经在「⑥ legacy 投影」一节单独验证。
 * 本节只验证「文档 schema 这一层能不能承载 fixed-amount」⇒ 用会走同一套 `checkPositionSizing`
 * 校验器的 v1 文档路径，等价且不混淆两条路径。
 */
const GOLDEN_DOCUMENT = createStrategyDocumentFromDefinition(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT);

const LEGACY_DOCUMENT = createStrategyDocument({
  strategyId: "r02-fixed-amount",
  version: "1.0.0",
  name: "R-02 固定金额仓位",
  universe: { universeId: `research-dataset:${FIRST_BOARD_PULLBACK_DATASET_VERSION}` },
  entryRules: [{ id: "r1", kind: "threshold", description: "回踩不破首板开盘价" }],
  exitRules: [{ id: "x1", kind: "time-based", description: "持有 3 日退出" }],
  positionSizing: { kind: "fixed-amount", fixedAmount: 20_000, maxPositions: 5 },
  riskRules: [{ id: "k1", kind: "state", description: "最多 5 仓" }],
  parameters: {
    parameters: [{ name: "holdingDays", type: "number", required: true, defaultValue: 3 }],
  },
  datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION,
  executionAssumptions: GOLDEN_DOCUMENT.executionAssumptions,
  metadata: { author: "test" },
});

/** 定点覆写 `positionSizing`（v1 文档无 `definition` ⇒ 不触发 view-drift 闸门，专测校验器本身）。 */
function makeDocument(positionSizing: unknown) {
  return { ...LEGACY_DOCUMENT, positionSizing } as typeof LEGACY_DOCUMENT;
}

/** 捕获同步抛错并返回 `code`（`LoopRunAssemblyError.code` 才是稳定判据，message 会变）。 */
function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? null;
  }
}

// ---------------------------------------------------------------------------
// ① / ② schema 可声明 + validation 可验证
// ---------------------------------------------------------------------------

describe("R-02 — ① schema 可声明 / ② validation 可验证", () => {
  it("fixed-amount 声明通过文档校验（kind 已进白名单）", () => {
    const result = validateStrategyDocument(LEGACY_DOCUMENT);
    expect(result.issues.map((item) => item.code)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(LEGACY_DOCUMENT.positionSizing).toEqual({ kind: "fixed-amount", fixedAmount: 20_000, maxPositions: 5 });
  });

  it("rich 文档路径：`definition.position.sizingMethod=FIXED_AMOUNT` ⇒ 派生出 fixed-amount 且校验通过", () => {
    const definition = createStrategyDefinition({
      ...structuredClone(FIRST_BOARD_PULLBACK_DEFINITION),
      position: { ...FIRST_BOARD_PULLBACK_DEFINITION.position, sizingMethod: "FIXED_AMOUNT", fixedAmount: 25_000 },
    });
    const doc = createStrategyDocumentFromDefinition({
      ...structuredClone(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT),
      definition,
    });
    expect(doc.positionSizing).toEqual({
      kind: "fixed-amount",
      fixedAmount: 25_000,
      maxPositions: FIRST_BOARD_PULLBACK_DEFINITION.position.maxPositions,
    });
    expect(validateStrategyDocument(doc).valid).toBe(true);
  });

  it("④ fixedAmount <= 0 ⇒ 拒绝（0 / 负数 / NaN 逐项）", () => {
    for (const bad of [0, -1, Number.NaN]) {
      const result = validateStrategyDocument(
        makeDocument({ kind: "fixed-amount", fixedAmount: bad, maxPositions: 5 }),
      );
      expect(result.valid, `fixedAmount=${String(bad)} 应被拒`).toBe(false);
      expect(result.issues.some((item) => item.code === "SCHEMA_POSITION_SIZING_FIXED_AMOUNT_INVALID")).toBe(true);
    }
  });

  it("⑤ 缺失 fixedAmount ⇒ 拒绝（不是「默认 0」也不是「退化成等权」）", () => {
    const result = validateStrategyDocument(makeDocument({ kind: "fixed-amount", maxPositions: 5 }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((item) => item.code === "SCHEMA_POSITION_SIZING_FIXED_AMOUNT_INVALID")).toBe(true);
  });

  it("未登记 kind 仍被拒（白名单没有放宽）", () => {
    const result = validateStrategyDocument(makeDocument({ kind: "kelly", maxPositions: 5 }));
    const codes = result.issues.map((item) => item.code);
    expect(result.valid).toBe(false);
    expect(
      codes.includes("SCHEMA_POSITION_SIZING_KIND_INVALID") ||
        codes.includes("SCHEMA_POSITION_SIZING_FIXED_AMOUNT_INVALID"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑥ legacy 投影不得静默退化
// ---------------------------------------------------------------------------

describe("R-02 — ⑥ legacy FIXED_AMOUNT 投影为 fixed-amount（不再被静默改写为 fixed-fraction）", () => {
  it("sizingMethod=FIXED_AMOUNT + fixedAmount ⇒ 派生出 fixed-amount 声明", () => {
    const base = structuredClone(FIRST_BOARD_PULLBACK_DEFINITION);
    const definition = createStrategyDefinition({
      ...base,
      position: { ...base.position, sizingMethod: "FIXED_AMOUNT", fixedAmount: 30_000 },
    });
    expect(deriveLegacyViews(definition).positionSizing).toEqual({
      kind: "fixed-amount",
      fixedAmount: 30_000,
      maxPositions: base.position.maxPositions,
    });
  });

  it("sizingMethod=FIXED_AMOUNT 但缺金额 ⇒ **响亮抛错**（不退化成等权 / 固定比例）", () => {
    const base = structuredClone(FIRST_BOARD_PULLBACK_DEFINITION);
    const definition = createStrategyDefinition({
      ...base,
      position: { ...base.position, sizingMethod: "FIXED_AMOUNT", fixedAmount: 30_000 },
    });
    // 定点抹掉金额（模拟「绕过校验的畸形定义」），投影必须拒绝而不是静默换口径。
    const malformed = { ...definition, position: { ...definition.position, fixedAmount: undefined } };
    expect(() => deriveLegacyViews(malformed)).toThrowError(/FIXED_AMOUNT/);
  });
});

// ---------------------------------------------------------------------------
// ③ 声明 → 执行口径（唯一映射实现）
// ---------------------------------------------------------------------------

describe("R-02 — ③ 文档声明 → 执行层口径（mapDeclaredPositionSizing 是唯一实现）", () => {
  it("四种已登记 kind 逐一机械映射", () => {
    expect(mapDeclaredPositionSizing({ kind: "equal-weight", maxPositions: 5 })).toEqual({
      sizingMethod: "EQUAL_WEIGHT",
      fraction: null,
      fixedAmount: null,
    });
    expect(mapDeclaredPositionSizing({ kind: "fixed-fraction", fraction: 0.2, maxPositions: 5 })).toEqual({
      sizingMethod: "FIXED_FRACTION",
      fraction: 0.2,
      fixedAmount: null,
    });
    expect(mapDeclaredPositionSizing({ kind: "rank-weighted", maxPositions: 5 })).toEqual({
      sizingMethod: "RANK_WEIGHTED",
      fraction: null,
      fixedAmount: null,
    });
    expect(mapDeclaredPositionSizing({ kind: "fixed-amount", fixedAmount: 20_000, maxPositions: 5 })).toEqual({
      sizingMethod: "FIXED_AMOUNT",
      fraction: null,
      fixedAmount: 20_000,
    });
  });

  it("fixed-amount 缺金额 / 金额非法 ⇒ 响亮抛错；未知 kind ⇒ 响亮抛错", () => {
    expect(codeOf(() => mapDeclaredPositionSizing({ kind: "fixed-amount", maxPositions: 5 }))).toBe(
      "LOOP_RUN_ASSEMBLY_POSITION_SIZING_AMOUNT_INVALID",
    );
    expect(codeOf(() => mapDeclaredPositionSizing({ kind: "fixed-amount", fixedAmount: 0 }))).toBe(
      "LOOP_RUN_ASSEMBLY_POSITION_SIZING_AMOUNT_INVALID",
    );
    expect(codeOf(() => mapDeclaredPositionSizing({ kind: "kelly" }))).toBe(
      "LOOP_RUN_ASSEMBLY_UNKNOWN_POSITION_SIZING",
    );
  });
});

// ---------------------------------------------------------------------------
// ⑦ 真实执行测试：声明 → 口径 → 实际下单股数
// ---------------------------------------------------------------------------

function intent(securityId: string, weight: number): PositionIntent {
  return {
    securityId,
    direction: "long",
    rank: 1,
    percentile: 1,
    weight,
    signalValue: 1,
    confidence: null,
  } as PositionIntent;
}

/** 用**映射产物**直接喂执行层（不手写引擎参数）⇒ 覆盖「声明 → 执行」整段。 */
function buyQuantityForDeclaration(positionSizing: unknown): number {
  const mapping = mapDeclaredPositionSizing(positionSizing);
  const result = planDecisionDay({
    decisionDate: "2026-09-12",
    intents: [intent("600001.SH", 1)],
    holdings: [],
    availableBySecurity: new Map<string, number>(),
    cash: INITIAL_CAPITAL,
    maxPositions: 5,
    hasNextTradingDay: true,
    closePriceBySecurity: new Map([["600001.SH", PRICE]]),
    amountBySecurity: new Map<string, number | null>([["600001.SH", 500_000]]),
    cost: COST,
    directionPolicy: "longOnly",
    positionSizing: {
      sizingMethod: mapping.sizingMethod,
      fraction: mapping.fraction,
      fixedAmount: mapping.fixedAmount,
    },
    initialCapital: INITIAL_CAPITAL,
  });
  const order = result.orders.find((item) => item.kind === "buy");
  return order === undefined ? 0 : order.quantity;
}

describe("R-02 — ⑦ 真实执行：fixed-amount 声明真正限制下单金额，且改金额结果就变", () => {
  it("fixedAmount=30000 ⇒ 约 3000 股（而非等权全仓约 10000 股）", () => {
    const baseline = buyQuantityForDeclaration({ kind: "equal-weight", maxPositions: 5 });
    const fixed = buyQuantityForDeclaration({ kind: "fixed-amount", fixedAmount: 30_000, maxPositions: 5 });
    expect(baseline).toBeGreaterThanOrEqual(9_900);
    expect(fixed).toBeGreaterThan(0);
    expect(fixed % 100).toBe(0);
    // 3 万 / 10 元 = 3000 股（费估算使其略低）；±1 手容差。
    expect(Math.abs(fixed - 3_000)).toBeLessThanOrEqual(100);
    expect(fixed).toBeLessThan(baseline);
  });

  it("✅ 参数敏感性：fixedAmount 30000 → 60000 ⇒ 下单股数约翻倍（参数搜索前置条件）", () => {
    const small = buyQuantityForDeclaration({ kind: "fixed-amount", fixedAmount: 30_000, maxPositions: 5 });
    const large = buyQuantityForDeclaration({ kind: "fixed-amount", fixedAmount: 60_000, maxPositions: 5 });
    expect(large).toBeGreaterThan(small);
    expect(Math.abs(large - small * 2)).toBeLessThanOrEqual(200);
  });

  it("金额不足一手 ⇒ 不建仓，并给出可辨 skip 原因（不是静默按一手强买）", () => {
    const mapping = mapDeclaredPositionSizing({ kind: "fixed-amount", fixedAmount: 500, maxPositions: 5 });
    const result = planDecisionDay({
      decisionDate: "2026-09-12",
      intents: [intent("600001.SH", 1)],
      holdings: [],
      availableBySecurity: new Map<string, number>(),
      cash: INITIAL_CAPITAL,
      maxPositions: 5,
      hasNextTradingDay: true,
      closePriceBySecurity: new Map([["600001.SH", PRICE]]),
      amountBySecurity: new Map<string, number | null>([["600001.SH", 500_000]]),
      cost: COST,
      directionPolicy: "longOnly",
      positionSizing: {
        sizingMethod: mapping.sizingMethod,
        fraction: mapping.fraction,
        fixedAmount: mapping.fixedAmount,
      },
      initialCapital: INITIAL_CAPITAL,
    });
    expect(result.orders.filter((item) => item.kind === "buy")).toHaveLength(0);
    // 真实 skip 码（`simulator/types.ts#PlanSkipCode`）：预算不足一手 ⇒ BUDGET_BELOW_MIN_LOT。
    expect(result.skipped.some((item) => item.code === "BUDGET_BELOW_MIN_LOT")).toBe(true);
  });
});
