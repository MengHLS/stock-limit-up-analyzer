/**
 * STRATEGY-ARCH-002 — 落库策略文档 → Core 版本（含 ARCH-002 实测发现的**真实阻塞缺陷**）。
 *
 * 夹具形状**逐字段照抄** `docs/evidence/_probe_arch002_documents.out.json` 里
 * `cand-360004@1.0.0` 的真实结构（不是凭类型定义猜的）。
 */

import { describe, expect, it } from "vitest";
import type { StrategyDocument } from "../../../../server/research/strategySchema/types";
import {
  coreVersionFromDocument,
  readLegacyDefinition,
} from "../../../../server/strategyCore/production";
import {
  StrategyRuntime,
  describeUnsupportedField,
  parseCoreFieldReference,
} from "../../../../server/strategyCore";
import { FIXED_CREATED_AT } from "../_fixtures";

/** 真实文档里那两条条件（🔴 cond-2 的 valueType 是 CONSTANT，值却是表达式文本）。 */
const REAL_CONDITIONS = [
  {
    id: "cond-1",
    field: "bar.low",
    operator: "GREATER_THAN_OR_EQUAL",
    value: "prefix.rd0.open",
    valueType: "FIELD_REFERENCE",
    enabled: true,
    description: "守线：观察日未破首板日开盘价",
  },
  {
    id: "cond-2",
    field: "bar.volume",
    operator: "LESS_THAN_OR_EQUAL",
    value: "prefix.rd0.volume * 0.3",
    valueType: "CONSTANT",
    enabled: true,
    description: "缩量：观察日量能 ≤ 首板日的 30%",
  },
] as const;

function documentFixture(overrides: { conditions?: readonly unknown[] } = {}): StrategyDocument {
  return {
    recordKind: "strategyDocument",
    recordVersion: 1,
    strategyId: "cand-360004",
    version: "1.0.0",
    name: "[CAND-4GROUPS] ④-a 守线+缩量≤30%",
    description: "由候选草稿转正",
    fingerprint: "doc-fingerprint",
    datasetVersion: "v2",
    datasetVersionId: 390002,
    universe: { universeId: "research-dataset:v2" },
    parameters: {
      parameters: [
        { name: "max_drawdown", type: "number", defaultValue: 0.02, min: 0, max: 0.3, step: 0.01, required: false },
        { name: "max_volume_ratio", type: "number", defaultValue: 0.3, min: 0.05, max: 1, step: 0.05, required: false },
        { name: "require_bullish", type: "number", defaultValue: 0, min: 0, max: 1, step: 1, required: false },
      ],
    },
    recipe: {
      kind: "signalEngine",
      recipeId: "first-limit-pullback-hold-shrink",
      point: "close",
      signalFrequency: "daily",
      requiredData: ["OHLCV"],
      rankingConfig: { higherIsBetter: true },
      selectionConfig: { method: { kind: "topN", n: 5 } },
      featureVersions: [],
    },
    entryRules: [],
    exitRules: [],
    positionSizing: { kind: "equal-weight", maxPositions: 5 },
    riskRules: [],
    executionAssumptions: {
      costModel: {
        commissionRate: 0.0003,
        stampDutyRate: 0.001,
        transferFeeRate: 0.00001,
        slippageBps: 10,
        lotSize: 100,
        minCommission: 5,
      },
      backtestConfig: { initialCapital: 100_000 },
      executionModel: "NEXT_OPEN",
    },
    definition: {
      datasets: [
        {
          datasetId: "first_limit_pullback",
          datasetVersion: "v2",
          datasetVersionId: 390002,
          role: "PRIMARY",
          note: "由 RESEARCH-006.3 promote 绑定",
        },
      ],
      entry: {
        event: { type: "FIRST_LIMIT_UP", params: { limitUpRatio: 0.1 } },
        observationWindow: { start: 1, end: 3, unit: "TRADING_DAY" },
        trigger: { type: "NEXT_TRADING_DAY" },
        conditions: [...(overrides.conditions ?? REAL_CONDITIONS)],
      },
      exit: {
        rules: [
          {
            id: "exit-stop-loss",
            type: "STOP_LOSS",
            trigger: "INTRADAY",
            threshold: 0.05,
            thresholdUnit: "RATIO",
            priority: 1,
            enabled: true,
            description: "止损",
          },
          {
            id: "exit-time-exit",
            type: "TIME_EXIT",
            trigger: "ON_CLOSE",
            threshold: 5,
            thresholdUnit: "TRADING_DAY",
            priority: 3,
            enabled: true,
            description: "时间出场",
          },
        ],
      },
      execution: {
        signalTiming: "T_CLOSE",
        executionTiming: "T_PLUS_1_OPEN",
        priceType: "OPEN",
        quantityMethod: "TARGET_WEIGHT",
        lotSize: 100,
        commissionModel: "BPS",
        slippageModel: "BPS",
      },
      parameters: [
        { code: "max_drawdown", name: "max_drawdown", dataType: "number", parameterRole: "TUNABLE", defaultValue: 0.02, min: 0, max: 0.3, step: 0.01, required: false },
        { code: "max_volume_ratio", name: "max_volume_ratio", dataType: "number", parameterRole: "TUNABLE", defaultValue: 0.3, min: 0.05, max: 1, step: 0.05, required: false },
        { code: "require_bullish", name: "require_bullish", dataType: "number", parameterRole: "TUNABLE", defaultValue: 0, min: 0, max: 1, step: 1, required: false },
      ],
    },
  } as unknown as StrategyDocument;
}

describe("落库文档 → Core 版本", () => {
  it("真实文档（cand-360004 形状）可成功翻译，并读出事件类型与涨停阈值", () => {
    const result = coreVersionFromDocument({ document: documentFixture(), createdAt: FIXED_CREATED_AT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version.strategyId).toBe("cand-360004");
    expect(result.version.version).toBe("1.0.0");
    expect(result.eventType).toBe("FIRST_LIMIT_UP");
    expect(result.limitUpRatio).toBe(0.1);
    // Dataset 绑定**不进 Definition**（分离返回）
    expect(result.adaptation.datasetBinding).toHaveLength(1);
    expect(result.version.definition.parameterSchema.map((item) => item.code).sort()).toEqual([
      "max_drawdown",
      "max_volume_ratio",
      "require_bullish",
    ]);
  });

  it("🔴 真实文档里的 `valueType=CONSTANT` + 表达式文本被正确解析为表达式（不是字符串常量）", () => {
    const result = coreVersionFromDocument({ document: documentFixture(), createdAt: FIXED_CREATED_AT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const conditions = JSON.stringify(result.version.definition.ruleGraph);
    // 表达式里必须出现「取事件日成交量」的字段引用 —— 若译成字符串常量，这里不会有 prefix.rd0.volume
    expect(conditions).toContain("prefix.rd0.volume");
    expect(conditions).toContain("*");
    expect(result.adaptation.notes.join(" ")).toContain("valueType=CONSTANT 的值是表达式文本");
  });

  it("若无该修复，条件会退化为「数字 ≤ 字符串」—— 用 Core 侧字段判定佐证字段本身是已知可用字段", () => {
    expect(parseCoreFieldReference("prefix.rd0.volume").kind).toBe("PRE_EVENT");
    expect(parseCoreFieldReference("prefix.rd0.open").kind).toBe("PRE_EVENT");
    expect(parseCoreFieldReference("bar.low").kind).toBe("CURRENT_BAR");
    expect(parseCoreFieldReference("bar.volume").kind).toBe("CURRENT_BAR");
    // 前视标签层必须被判为不可用（这不是新逻辑，是 ARCH-001 的既有守卫）
    expect(parseCoreFieldReference("outcome.future_return_5d").kind).toBe("LABEL_ONLY");
    expect(describeUnsupportedField("outcome.future_return_5d")).toContain("Look-Ahead");
  });

  it("窗口量化器逐条登记（legacy 无法表达 ALL_DAYS ⇒ 一律 ANY_DAY 并写 note）", () => {
    const result = coreVersionFromDocument({ document: documentFixture(), createdAt: FIXED_CREATED_AT });
    if (!result.ok) throw new Error(result.detail);
    expect(result.adaptation.notes.join(" ")).toContain("ALL_DAYS");
  });

  it("阈值型出场（STOP_LOSS / TIME_EXIT）仍在 exitRules 声明，未进 RuleGraph，且如实登记", () => {
    const result = coreVersionFromDocument({ document: documentFixture(), createdAt: FIXED_CREATED_AT });
    if (!result.ok) throw new Error(result.detail);
    expect(result.adaptation.unmappedExitRuleIds.sort()).toEqual(["exit-stop-loss", "exit-time-exit"]);
    expect(result.version.definition.exitRuleGraph).toBeNull();
  });

  it("文档没有 definition 段 ⇒ 返回 ok:false（不凭空构造），原因码稳定", () => {
    const doc = documentFixture() as unknown as Record<string, unknown>;
    delete doc.definition;
    const result = coreVersionFromDocument({
      document: doc as unknown as StrategyDocument,
      createdAt: FIXED_CREATED_AT,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("NO_LEGACY_DEFINITION");
    expect(result.detail).toContain("没有 definition 段");
    expect(readLegacyDefinition(doc as unknown as StrategyDocument)).toBeNull();
  });

  it("未登记的运算符 ⇒ 返回 ok:false（CORE_VERSION_BUILD_FAILED，不静默丢弃条件）", () => {
    const doc = documentFixture({
      conditions: [{ id: "c", field: "bar.low", operator: "APPROXIMATELY", value: 1, valueType: "CONSTANT", enabled: true }],
    });
    const result = coreVersionFromDocument({ document: doc, createdAt: FIXED_CREATED_AT });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("CORE_VERSION_BUILD_FAILED");
    expect(result.detail).toContain("LEGACY_MAPPING_UNSUPPORTED");
  });

  it("翻译出的定义能被 StrategyRuntime 直接消费（不含 Dataset 绑定，兼容性检查不炸）", () => {
    const result = coreVersionFromDocument({ document: documentFixture(), createdAt: FIXED_CREATED_AT });
    if (!result.ok) throw new Error(result.detail);
    const leaks = StrategyRuntime.auditLeakage(result.version);
    expect(leaks).toEqual([]);
  });
});
