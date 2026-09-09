/**
 * STEP 15 / C-15.1 — Strategy Schema + Versioning 测试（纯内存 fixture，无 DB）。
 *
 * 覆盖（对应任务验收八组场景）：
 *   ① 全字段合法策略 validate 通过（本体 / 含执行配方本体 / 版本追溯记录）；
 *   ② 缺字段 / 非法版本 / 非法日期 / 参数与 schema 不符 → validate 报结构化 issue；
 *   ③ 版本 bump 语义（参数变 → minor、结构变 → major）正确且不可变（原本体不被修改）；
 *   ④ strategiesDeepEqual 比较（同策略两版本不等、等价拷贝相等）；
 *   ⑤ canonical serialize round-trip（含指纹复核）；
 *   ⑥ fingerprint 确定性 + 内容变更指纹变化；
 *   ⑦ §17 版本追溯记录含九项且 codeVersion 注入生效；
 *   ⑧ Strategy13 → 执行配方引用（recipe）兼容映射正确。
 */

import { describe, expect, it } from "vitest";
import type { CostModel } from "../../engine/domain";
import {
  makeBarFeatureProvider,
  makeWeightedSignalBuilder,
  sameDayAvailability,
  type RankingConfig,
  type SelectionConfig,
} from "../framework";
import type { Strategy13 } from "../signalEngine/types";
import { composeCodeVersion } from "../experimentLineage/codeVersion";
import { ResearchValidationError } from "../experimentValidation";
import {
  assertValidStrategyDocument,
  bumpStrategyVersion,
  classifyRequiredBumpKind,
  cloneStrategyDocument,
  compareStrategyDocuments,
  computeStrategyDocumentFingerprint,
  createStrategyDocument,
  createStrategyVersionRecord,
  deserializeStrategyDocument,
  deserializeStrategyVersionRecord,
  isValidStrategyVersionFormat,
  parseStrategyVersion,
  serializeStrategyDocument,
  serializeStrategyVersionRecord,
  strategiesDeepEqual,
  strategy13ToRecipeRef,
  validateStrategyDocument,
  validateStrategyVersionRecord,
  attachSignal13Recipe,
  STRATEGY_DOCUMENT_RECORD_KIND,
  STRATEGY_DOCUMENT_RECORD_VERSION,
  STRATEGY_VERSION_RECORD_KIND,
  STRATEGY_VERSION_RECORD_VERSION,
  type StrategyDocument,
  type StrategyDocumentInput,
  type StrategyVersionRecord,
} from "./index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DATASET_VERSION = "rd-1.0.0-1-cffc2a0e66efbf0b";

const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

const RANKING_CONFIG: RankingConfig = { higherIsBetter: true, tieBreaking: "stable", missingPolicy: "exclude" };
const SELECTION_CONFIG: SelectionConfig = { method: { kind: "topN", n: 5 } };

function makeDocInput(): StrategyDocumentInput {
  return {
    strategyId: "limit-up-baseline",
    version: "1.0.0",
    name: "涨停候选基线",
    description: "研究链路基线策略",
    universe: { universeId: `research-dataset:${DATASET_VERSION}` },
    entryRules: [
      {
        id: "enter-topN",
        kind: "threshold",
        field: "candidate.rank",
        operator: "<=",
        operand: 5,
        description: "候选排名 <= 5 进场",
      },
    ],
    exitRules: [
      {
        id: "exit-holding-days",
        kind: "time-based",
        field: "position.holdingDays",
        operator: ">=",
        operand: 3,
        description: "持有 >= 3 个交易日退出",
      },
    ],
    positionSizing: { kind: "equal-weight", maxPositions: 5 },
    riskRules: [
      {
        id: "risk-max-positions",
        kind: "state",
        field: "position.count",
        operator: "<=",
        operand: 5,
        description: "组合持仓数不超过 5",
      },
    ],
    parameters: {
      parameters: [
        { name: "topN", type: "number", required: true, defaultValue: 5, min: 1, max: 20, description: "选股数" },
        { name: "minScore", type: "number", required: false, nullable: true, defaultValue: null, description: "分数阈值" },
      ],
    },
    datasetVersion: DATASET_VERSION,
    executionAssumptions: {
      backtestConfig: { initialCapital: 100_000, maxPositions: 5 },
      costModel: COST_MODEL,
      executionModel: "NEXT_OPEN",
    },
  };
}

function makeDocument(overrides: Partial<StrategyDocumentInput> = {}): StrategyDocument {
  return createStrategyDocument({ ...makeDocInput(), ...overrides });
}

function makeParameterSchema(defaultTopN: number): StrategyDocumentInput["parameters"] {
  return {
    parameters: [
      { name: "topN", type: "number", required: true, defaultValue: defaultTopN, min: 1, max: 20, description: "选股数" },
      { name: "minScore", type: "number", required: false, nullable: true, defaultValue: null, description: "分数阈值" },
    ],
  };
}

// -- C-13.2 Strategy13 fixture（可执行实例仅用于配方引用映射，不运行引擎） --
const FEATURE_PCT_CHANGE = makeBarFeatureProvider({
  featureId: "pctChange",
  version: "1.0.0",
  availability: sameDayAvailability({ date: "2026-01-05", point: "close" }, "close", "close"),
  compute: () => 0.01,
});

const FEATURE_TURNOVER = makeBarFeatureProvider({
  featureId: "turnover",
  version: "2.0.0",
  availability: sameDayAvailability({ date: "2026-01-05", point: "close" }, "close", "close"),
  compute: () => 2.5,
});

function makeStrategy13(): Strategy13 {
  return {
    point: "close",
    features: [FEATURE_TURNOVER, FEATURE_PCT_CHANGE], // 故意逆字母序，验证映射会按 featureId 升序排序
    signalBuilder: makeWeightedSignalBuilder({ pctChange: 1 }),
    rankingConfig: structuredClone(RANKING_CONFIG),
    selectionConfig: structuredClone(SELECTION_CONFIG),
    signalDescription: "pctChange 加权信号",
  };
}

const VERSION_CONTEXT = { codeVersion: composeCodeVersion({ packageVersion: "1.0.0", git: { commitShortHash: "2b786f7", dirty: false } }), createdAt: "2026-09-06T00:00:00.000Z" };

// ---------------------------------------------------------------------------
// ① 合法全字段 validate 通过
// ---------------------------------------------------------------------------

describe("全字段合法策略 validate 通过", () => {
  it("本体 validate 通过且不可变（recordKind / fingerprint 齐备）", () => {
    const doc = makeDocument();
    const validation = validateStrategyDocument(doc);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toHaveLength(0);
    expect(doc.recordKind).toBe(STRATEGY_DOCUMENT_RECORD_KIND);
    expect(doc.recordVersion).toBe(STRATEGY_DOCUMENT_RECORD_VERSION);
    expect(doc.version).toBe("1.0.0");
    expect(doc.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(doc)).toBe(true);
    expect(() => assertValidStrategyDocument(doc)).not.toThrow();
  });

  it("含执行配方引用（attachSignal13Recipe）的本体 validate 通过", () => {
    const input = attachSignal13Recipe(makeDocInput(), makeStrategy13(), {
      recipeId: "recipe-limit-up-v1",
      signalFrequency: "daily",
      requiredData: ["OHLCV"],
    });
    const doc = createStrategyDocument(input);
    expect(doc.recipe?.kind).toBe("signalEngine");
    const validation = validateStrategyDocument(doc);
    expect(validation.valid).toBe(true);
    expect(doc.recipe?.featureVersions.map((f) => f.featureId)).toEqual(["pctChange", "turnover"]);
  });

  it("§17 版本追溯记录 validate 通过且含九项", () => {
    const record = createStrategyVersionRecord({ document: makeDocument(), context: VERSION_CONTEXT });
    const validation = validateStrategyVersionRecord(record);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ② 缺字段 / 非法版本 / 非法日期 / 参数与 schema 不符 → 结构化 issue
// ---------------------------------------------------------------------------

describe("非法策略 validate 报结构化 issue", () => {
  it("缺字段：name / strategyId 缺失报缺项 issue", () => {
    const doc = { ...makeDocument(), name: "", strategyId: "  " } as unknown as StrategyDocument;
    const validation = validateStrategyDocument(doc);
    expect(validation.valid).toBe(false);
    const codes = validation.issues.map((i) => i.code);
    expect(codes).toContain("SCHEMA_NAME_EMPTY");
    expect(codes).toContain("SCHEMA_STRATEGY_ID_EMPTY");
  });

  it("非法版本号（1.0）报 issue", () => {
    const doc = { ...makeDocument(), version: "1.0" } as unknown as StrategyDocument;
    const validation = validateStrategyDocument(doc);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((i) => i.code)).toContain("SCHEMA_VERSION_INVALID");
  });

  it("非法 dataset 版本（非 rd-… 内容寻址形态）报 issue", () => {
    const doc = { ...makeDocument(), datasetVersion: "v1" } as unknown as StrategyDocument;
    const validation = validateStrategyDocument(doc);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((i) => i.code)).toContain("SCHEMA_DATASET_VERSION_INVALID");
  });

  it("参数 schema 与 defaultValue 自洽失败（default 越界）报 issue", () => {
    const doc = { ...makeDocument(), parameters: { parameters: [{ name: "topN", type: "number", required: true, defaultValue: 25, min: 1, max: 20 }] } } as unknown as StrategyDocument;
    const validation = validateStrategyDocument(doc);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((i) => i.path.includes("defaultValue"))).toBe(true);
  });

  it("规则集内 id 重复报 issue", () => {
    const doc = {
      ...makeDocument(),
      entryRules: [
        { id: "dup", kind: "threshold", description: "规则一" },
        { id: "dup", kind: "threshold", description: "规则二" },
      ],
    } as unknown as StrategyDocument;
    const validation = validateStrategyDocument(doc);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((i) => i.code)).toContain("SCHEMA_RULE_ID_DUPLICATE");
  });

  it("派生 universe 与 datasetVersion 不一致报 issue", () => {
    const doc = {
      ...makeDocument(),
      universe: { universeId: "research-dataset:rd-1.0.0-1-0000000000000000" },
    } as unknown as StrategyDocument;
    const validation = validateStrategyDocument(doc);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((i) => i.code)).toContain("SCHEMA_UNIVERSE_DATASET_MISMATCH");
  });

  it("版本追溯记录 parameterSet 与 schema 不符 → create 抛 ResearchValidationError", () => {
    expect(() =>
      createStrategyVersionRecord({
        document: makeDocument(),
        context: VERSION_CONTEXT,
        parameterSet: { topN: "5" }, // 类型不符：number 参数给了字符串
      }),
    ).toThrowError(ResearchValidationError);
  });
});

// ---------------------------------------------------------------------------
// ③ 版本 bump 语义 + 不可变
// ---------------------------------------------------------------------------

describe("版本 bump 语义与不可变", () => {
  it("参数 defaultValue 变化 → clone minor bump 至 1.1.0，且原本体不被修改", () => {
    const base = makeDocument();
    const baseFingerprint = base.fingerprint;
    const next = cloneStrategyDocument(base, { parameters: makeParameterSchema(6) }, "minor");
    expect(next.version).toBe("1.1.0");
    expect(next.parameters.parameters[0]?.defaultValue).toBe(6);
    // 不可变：base 仍为 1.0.0，defaultValue 仍为 5，指纹未变。
    expect(base.version).toBe("1.0.0");
    expect(base.parameters.parameters[0]?.defaultValue).toBe(5);
    expect(base.fingerprint).toBe(baseFingerprint);
  });

  it("结构变化（entryRules 变更）→ clone major bump 至 2.0.0", () => {
    const base = makeDocument();
    const next = cloneStrategyDocument(
      base,
      {
        entryRules: [
          ...base.entryRules,
          { id: "enter-extra", kind: "state", field: "security.st", operator: "!=", operand: "ST", description: "剔除 ST 证券的入场规则" },
        ],
      },
      "major",
    );
    expect(next.version).toBe("2.0.0");
    expect(next.entryRules).toHaveLength(2);
    expect(base.entryRules).toHaveLength(1);
  });

  it("结构变化却给 minor bump → 响亮抛错且原本体不被修改", () => {
    const base = makeDocument();
    expect(() =>
      cloneStrategyDocument(
        base,
        { entryRules: [...base.entryRules, { id: "enter-extra", kind: "threshold", description: "新规则" }] },
        "minor",
      ),
    ).toThrowError(/至少.*major|必须 major|bump 级别不足/);
    expect(base.version).toBe("1.0.0");
  });

  it("参数变化却给 patch bump → 响亮抛错（参数变化至少 minor）", () => {
    const base = makeDocument();
    expect(() => cloneStrategyDocument(base, { parameters: makeParameterSchema(7) }, "patch")).toThrowError(
      /bump 级别不足/,
    );
    expect(base.version).toBe("1.0.0");
  });

  it("空补丁 + patch bump 允许（无内容变化）", () => {
    const base = makeDocument();
    const next = cloneStrategyDocument(base, {}, "patch");
    expect(next.version).toBe("1.0.1");
  });

  it("bumpStrategyVersion / parse 纯函数行为正确", () => {
    expect(bumpStrategyVersion("1.0.0", "patch")).toBe("1.0.1");
    expect(bumpStrategyVersion("1.0.0", "minor")).toBe("1.1.0");
    expect(bumpStrategyVersion("1.0.0", "major")).toBe("2.0.0");
    expect(bumpStrategyVersion("1.1.0", "major")).toBe("2.0.0");
    expect(parseStrategyVersion("2.1.3")).toEqual({ major: 2, minor: 1, patch: 3 });
    expect(isValidStrategyVersionFormat("1.0.0")).toBe(true);
    expect(isValidStrategyVersionFormat("01.0.0")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ④ strategiesDeepEqual / 结构化比较
// ---------------------------------------------------------------------------

describe("strategiesDeepEqual 结构化比较", () => {
  it("等价拷贝相等；compare 无差异", () => {
    const a = makeDocument();
    const b = createStrategyDocument(makeDocInput());
    expect(strategiesDeepEqual(a, b)).toBe(true);
    expect(compareStrategyDocuments(a, b).equal).toBe(true);
    expect(compareStrategyDocuments(a, b).differences).toHaveLength(0);
  });

  it("同策略两版本（参数不同）不等，diff 定位到 defaultValue，bump 级别为 minor", () => {
    const a = makeDocument();
    const b = cloneStrategyDocument(a, { parameters: makeParameterSchema(8) }, "minor");
    expect(strategiesDeepEqual(a, b)).toBe(false);
    const result = compareStrategyDocuments(a, b);
    expect(result.equal).toBe(false);
    expect(result.differences.some((d) => d.path.includes("defaultValue"))).toBe(true);
    expect(classifyRequiredBumpKind(a, b)).toBe("minor");
  });

  it("规则变化 classify 为 major", () => {
    const a = makeDocument();
    const b = cloneStrategyDocument(
      a,
      { exitRules: [...a.exitRules, { id: "exit-new", kind: "time-based", description: "新退出规则" }] },
      "major",
    );
    expect(classifyRequiredBumpKind(a, b)).toBe("major");
  });
});

// ---------------------------------------------------------------------------
// ⑤⑥ canonical round-trip + fingerprint
// ---------------------------------------------------------------------------

describe("canonical round-trip 与 fingerprint", () => {
  it("serialize → deserialize round-trip 保持等价与指纹", () => {
    const doc = makeDocument();
    const json = serializeStrategyDocument(doc);
    const restored = deserializeStrategyDocument(json);
    expect(strategiesDeepEqual(doc, restored)).toBe(true);
    expect(restored.fingerprint).toBe(doc.fingerprint);
  });

  it("fingerprint 确定性：同内容两次计算相同；内容变化指纹变化", () => {
    const a = makeDocument();
    const b = makeDocument();
    expect(computeStrategyDocumentFingerprint(a)).toBe(computeStrategyDocumentFingerprint(b));
    const changed = cloneStrategyDocument(a, { name: "改名" }, "minor");
    expect(changed.fingerprint).not.toBe(a.fingerprint);
  });

  it("deserialize 指纹复核：篡改内容后抛指纹不匹配", () => {
    const doc = makeDocument();
    const parsed = JSON.parse(serializeStrategyDocument(doc)) as Record<string, unknown>;
    parsed.name = "被篡改的策略名";
    expect(() => deserializeStrategyDocument(JSON.stringify(parsed))).toThrowError(ResearchValidationError);
  });

  it("版本追溯记录 round-trip 与指纹复核", () => {
    const record = createStrategyVersionRecord({ document: makeDocument(), context: VERSION_CONTEXT });
    const restored = deserializeStrategyVersionRecord(serializeStrategyVersionRecord(record));
    expect(restored.fingerprint).toBe(record.fingerprint);
    expect(restored.codeVersion).toBe(record.codeVersion);

    const parsed = JSON.parse(serializeStrategyVersionRecord(record)) as Record<string, unknown>;
    parsed.createdAt = "2026-01-01T00:00:00.000Z";
    expect(() => deserializeStrategyVersionRecord(JSON.stringify(parsed))).toThrowError(ResearchValidationError);
  });
});

// ---------------------------------------------------------------------------
// ⑦ §17 版本追溯记录九项 + codeVersion 注入
// ---------------------------------------------------------------------------

describe("§17 版本追溯记录", () => {
  it("记录含九项追溯字段且与 strategy 交叉一致", () => {
    const doc = makeDocument();
    const record = createStrategyVersionRecord({ document: doc, context: VERSION_CONTEXT });
    expect(record.recordKind).toBe(STRATEGY_VERSION_RECORD_KIND);
    expect(record.recordVersion).toBe(STRATEGY_VERSION_RECORD_VERSION);
    // 九项：strategy / parameters / dataset / universe / backtest config / cost model / execution model / code version / created_at。
    expect(strategiesDeepEqual(record.strategy, doc)).toBe(true);
    expect(record.parameterSet).toEqual({ topN: 5, minScore: null }); // 从 schema 默认值解析
    expect(record.datasetVersion).toBe(DATASET_VERSION);
    expect(record.universeId).toBe(`research-dataset:${DATASET_VERSION}`);
    expect(record.backtestConfig.initialCapital).toBe(100_000);
    expect(record.costModel.slippageBps).toBe(10);
    expect(record.executionModel).toBe("NEXT_OPEN");
    expect(record.codeVersion).toBe("1.0.0+g2b786f7"); // codeVersion 注入生效
    expect(record.createdAt).toBe("2026-09-06T00:00:00.000Z");
    expect(record.strategyId).toBe("limit-up-baseline");
    expect(record.version).toBe("1.0.0");
    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("required 参数无 defaultValue 时缺省解析抛错（失败响亮，不猜参数）", () => {
    const doc = makeDocument({
      parameters: { parameters: [{ name: "topN", type: "number", required: true, min: 1, max: 20 }] },
    });
    expect(() => createStrategyVersionRecord({ document: doc, context: VERSION_CONTEXT })).toThrowError(
      ResearchValidationError,
    );
  });

  it("显式传入 parameterSet 与 schema 一致则记录通过并保留给定值", () => {
    const record = createStrategyVersionRecord({
      document: makeDocument(),
      context: VERSION_CONTEXT,
      parameterSet: { topN: 9, minScore: null },
    });
    expect(record.parameterSet.topN).toBe(9);
    expect(validateStrategyVersionRecord(record).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑧ Strategy13 → 执行配方引用映射
// ---------------------------------------------------------------------------

describe("Strategy13 兼容映射（执行配方引用）", () => {
  it("映射提取可序列化面：point / 排序后的 featureVersions / ranking / selection / 频率", () => {
    const recipe = strategy13ToRecipeRef(makeStrategy13(), {
      recipeId: "recipe-limit-up-v1",
      signalFrequency: "daily",
      requiredData: ["OHLCV", "Industry"],
    });
    expect(recipe.kind).toBe("signalEngine");
    expect(recipe.point).toBe("close");
    expect(recipe.signalDescription).toBe("pctChange 加权信号");
    expect(recipe.featureVersions).toEqual([
      { featureId: "pctChange", version: "1.0.0" },
      { featureId: "turnover", version: "2.0.0" },
    ]); // 已按 featureId 升序（输入顺序为 turnover 在前）
    expect(recipe.signalFrequency).toBe("daily");
    expect(recipe.requiredData).toEqual(["OHLCV", "Industry"]);
    expect(recipe.rankingConfig).toEqual(RANKING_CONFIG);
    expect(recipe.selectionConfig).toEqual(SELECTION_CONFIG);
  });

  it("映射配方嵌入本体后 validate 通过；recipeId 空串映射抛错", () => {
    const doc = createStrategyDocument(
      attachSignal13Recipe(makeDocInput(), makeStrategy13(), { recipeId: "recipe-v1", signalFrequency: "daily" }),
    );
    expect(validateStrategyDocument(doc).valid).toBe(true);
    expect(() => strategy13ToRecipeRef(makeStrategy13(), { recipeId: "", signalFrequency: "daily" })).toThrowError(
      /recipeId/,
    );
  });
});
