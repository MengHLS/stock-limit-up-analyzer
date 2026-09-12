/**
 * RESEARCH-006.3 — `definitionBuild` **唯一转换器**的映射测试（§6~§9 / §37）。
 *
 * 本文件只碰纯函数，**不触 DB、不装 Service**：006.3 §6 要求转换器「确定性、纯函数、可测试」，
 * 那么它的测试就不该需要仓储 / 事务 / 网络。
 *
 * 覆盖（§37 的五例）：
 *   1. 正常映射：草稿 → Definition 的**逐段对应**（entry / execution / position / risk / exit /
 *      parameters / datasets），并证明产物**能过既有校验器**（build 与 validate 分离）；
 *   2. 缺失字段：一律 `PROMOTE_SKETCH_INCOMPLETE`，**绝不补默认**（默认买入 / 止盈 / 止损 / 持有 N 天）；
 *   3. 不允许猜测：未定义扩展键 / 别处扩展槽 / 词表不支持的操作符 / 非引用文法的字段名 /
 *      同一事实两处声明 —— 一律 `PROMOTE_SKETCH_INVALID`；
 *   4. 确定性：同一输入连续两次 ⇒ 深度相等且 JSON 串相同；
 *   5. 输入不被修改：深度冻结的草稿能原样跑完（且跑完后与快照逐字段相等）。
 */

import { describe, expect, it } from "vitest";
import type { ResearchStrategyCandidate } from "../../researchCore";
import { STRATEGY_CANDIDATE_ERROR, StrategyCandidateError } from "./candidateTypes";
import {
  buildExecutionAssumptions,
  buildStrategyDefinition,
  PROMOTE_INITIAL_STRATEGY_VERSION,
  PROMOTE_INITIAL_VERSION_STATUS,
  deriveStrategyId,
  deriveUniverseIdForDataset,
  validateBuiltStrategyDefinition,
  type DefinitionBuildInput,
} from "./definitionBuild";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 一段**完整**的候选草稿：语义等价于 strategySchema 的 golden sample（首板回踩）。 */
function fullDraft(): ResearchStrategyCandidate {
  return {
    id: 88001,
    experimentId: 70001,
    conclusionId: 30001,
    strategyDefinitionId: null,
    name: "首板回踩不破首板开盘价",
    description: "首板后 1~5 个交易日内缩量回踩不破首板开盘价 → 收盘出信号 → T+1 开盘买入",
    entryRule: {
      event: "FIRST_LIMIT_UP",
      timing: "NEXT_OPEN",
      extra: {
        observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
        trigger: "FIRST_VALID_DAY",
        eventParams: { limitUpRatio: 0.1 },
        execution: {
          quantityMethod: "TARGET_WEIGHT",
          lotSize: 100,
          slippageModel: "BPS",
          commissionModel: "BPS",
          executionConstraints: ["一字板（开盘即涨停）不成交", "停牌顺延至下一交易日"],
        },
        position: { sizingMethod: "FIXED_RATIO", positionRatio: 0.2, maxExposure: 0.8 },
        risk: { stopLoss: 0.08, maxExposure: 0.8, maxDrawdown: 0.25 },
        document: {
          backtestConfig: { initialCapital: 1_000_000, maxPositions: 5 },
          costModel: {
            commissionRate: 0.00025,
            stampDutyRate: 0.0005,
            transferFeeRate: 0.00001,
            slippageBps: 5,
            lotSize: 100,
            minCommission: 5,
          },
        },
      },
    },
    filterRule: {
      groups: [
        {
          groupNo: 0,
          groupLogicalOperator: "AND",
          conditions: [
            {
              groupNo: 0,
              sortOrder: 0,
              fieldName: "bar.low",
              operator: ">=",
              value: "prefix.rd0.open",
              logicalOperator: "AND",
              groupLogicalOperator: "AND",
              note: "回踩当日最低价不低于首板日开盘价",
            },
            {
              groupNo: 0,
              sortOrder: 1,
              fieldName: "bar.volume",
              operator: "<",
              value: "prefix.rd0.volume",
              logicalOperator: "AND",
              groupLogicalOperator: "AND",
            },
          ],
        },
      ],
    },
    exitRule: { holdingDays: 3, takeProfit: 0.15, stopLoss: 0.08 },
    riskRule: { maxPositions: 5, maxPositionWeight: 0.3 },
    parameterSpace: {
      holdingDays: { type: "number", min: 1, max: 20, step: 1 },
      pullbackWindow: { type: "number", min: 1, max: 10, step: 1 },
    },
    sourceDatasetVersionId: 390002,
    sourceResearchRunId: 450001,
    sourceTraceJson: { metricCode: "future_return_mean", effectLabel: "回踩不破" },
    sourceDatasetDivergenceReason: null,
    status: "ACCEPTED",
  };
}

const EXECUTION_DATASET: DefinitionBuildInput["executionDataset"] = {
  datasetVersionId: 390002,
  datasetVersionLabel: "v2",
  datasetCode: "first_limit_pullback",
};

function input(candidate: ResearchStrategyCandidate): DefinitionBuildInput {
  return { candidate, executionDataset: EXECUTION_DATASET };
}

/** 在草稿上做一次「受控破坏」，返回新草稿（不修改原对象）。 */
function mutateDraft(mutator: (draft: ResearchStrategyCandidate) => void): ResearchStrategyCandidate {
  const draft = structuredClone(fullDraft());
  mutator(draft);
  return draft;
}

/**
 * 取草稿的 `entryRule.extra` 扩展槽（**返回真实引用**，供用例加键 / 删键）。
 *
 * ⚠️ 用例里一律「先取出标识符再 delete」：`delete (expr).prop` 这种写法在转译后
 * 可能不生效（本文件实测如此），会让用例变成「其实什么都没删」的假绿。
 */
function extraOf(draft: ResearchStrategyCandidate): Record<string, unknown> {
  return (draft.entryRule as { extra: Record<string, unknown> }).extra;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

async function expectSketchError(
  fn: () => unknown,
  code: string,
  pathFragment?: string,
): Promise<StrategyCandidateError> {
  try {
    fn();
  } catch (err) {
    expect(err, `期望 StrategyCandidateError(${code})，实际抛出 ${String(err)}`).toBeInstanceOf(
      StrategyCandidateError,
    );
    const e = err as StrategyCandidateError;
    expect(e.code).toBe(code);
    if (pathFragment !== undefined) {
      expect(e.message).toContain(pathFragment);
    }
    return e;
  }
  throw new Error(`期望抛出 StrategyCandidateError(${code})，但调用成功返回`);
}

// ---------------------------------------------------------------------------
// 1) 正常映射
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · definitionBuild 正常映射（§9）", () => {
  const definition = buildStrategyDefinition(input(fullDraft()));

  it("1-a) entry：事件 / 观测窗口 / 触发时点逐段对应", () => {
    expect(definition.entry.event?.type).toBe("FIRST_LIMIT_UP");
    expect(definition.entry.event?.params).toEqual({ limitUpRatio: 0.1 });
    expect(definition.entry.observationWindow).toEqual({ start: 1, end: 5, unit: "TRADING_DAY" });
    expect(definition.entry.trigger?.type).toBe("FIRST_VALID_DAY");
  });

  it("1-b) entry.timing（Research 词表）→ execution 三元组（Strategy 词表）", () => {
    // 草稿声明 NEXT_OPEN ⇒ 信号在 T 日收盘、成交在 T+1 开盘、成交价取开盘价。
    expect(definition.execution.signalTiming).toBe("T_CLOSE");
    expect(definition.execution.executionTiming).toBe("T_PLUS_1_OPEN");
    expect(definition.execution.priceType).toBe("OPEN");
  });

  it("1-c) filterRule → entry.conditions（操作符 + valueType 机械判定）", () => {
    expect(definition.entry.conditions).toHaveLength(2);
    expect(definition.entry.conditions[0]).toMatchObject({
      field: "bar.low",
      operator: "GREATER_THAN_OR_EQUAL",
      value: "prefix.rd0.open",
      valueType: "FIELD_REFERENCE",
      enabled: true,
      description: "回踩当日最低价不低于首板日开盘价",
    });
    expect(definition.entry.conditions[1]).toMatchObject({
      field: "bar.volume",
      operator: "LESS_THAN",
      value: "prefix.rd0.volume",
      valueType: "FIELD_REFERENCE",
    });
  });

  it("1-d) exitRule → exit.rules（固定 trigger / priority，按止损→止盈→时间出场）", () => {
    expect(definition.exit.rules.map((r) => [r.type, r.trigger, r.priority])).toEqual([
      ["STOP_LOSS", "INTRADAY", 1],
      ["TAKE_PROFIT", "INTRADAY", 2],
      ["TIME_EXIT", "ON_CLOSE", 3],
    ]);
    const byType = new Map(definition.exit.rules.map((r) => [r.type, r]));
    expect(byType.get("STOP_LOSS")?.threshold).toBe(0.08);
    expect(byType.get("TAKE_PROFIT")?.threshold).toBe(0.15);
    expect(byType.get("TIME_EXIT")?.threshold).toBe(3);
    expect(byType.get("TIME_EXIT")?.thresholdUnit).toBe("TRADING_DAY");
  });

  it("1-e) position / risk：maxPositions 只认 riskRule，单标的上限只认 maxPositionWeight", () => {
    expect(definition.position.sizingMethod).toBe("FIXED_RATIO");
    expect(definition.position.maxPositions).toBe(5);
    expect(definition.position.positionRatio).toBe(0.2);
    expect(definition.position.maxExposure).toBe(0.8);
    expect(definition.position.maxSinglePosition).toBe(0.3);
    expect(definition.risk.stopLoss).toBe(0.08);
    expect(definition.risk.maxDrawdown).toBe(0.25);
  });

  it("1-f) parameterSpace → parameters（确定性排序；角色恒 TUNABLE）", () => {
    expect(definition.parameters.map((p) => p.code)).toEqual(["holdingDays", "pullbackWindow"]);
    expect(definition.parameters.every((p) => p.parameterRole === "TUNABLE")).toBe(true);
    expect(definition.parameters.every((p) => p.dataType === "number")).toBe(true);
  });

  it("1-g) datasets：PRIMARY = **执行** Dataset（唯一坐标 dataset_version.id）", () => {
    expect(definition.datasets).toEqual([
      {
        datasetId: "first_limit_pullback",
        datasetVersionId: 390002,
        datasetVersion: "v2",
        role: "PRIMARY",
        note: "由 RESEARCH-006.3 promote 绑定（唯一坐标 dataset_version.id）",
      },
    ]);
  });

  it("1-h) build 的产物能通过既有校验器（build 与 validate 分离但相容）", () => {
    const normalized = validateBuiltStrategyDefinition(definition);
    expect(normalized.schemaVersion).toBe("1.0");
    // 补齐的 id 必须存在且非空（由既有 normalizeStrategyDefinition 生成，本 STEP 不自己编号）。
    for (const id of normalized.entry.conditions.map((c) => c.id)) {
      expect(typeof id === "string" && id.length > 0).toBe(true);
    }
  });

  it("1-i) 文档级执行假设只能来自草稿（不可从 definition 派生）", () => {
    const assumptions = buildExecutionAssumptions(fullDraft());
    expect(assumptions.backtestConfig).toEqual({ initialCapital: 1_000_000, maxPositions: 5 });
    expect(assumptions.costModel).toEqual({
      commissionRate: 0.00025,
      stampDutyRate: 0.0005,
      transferFeeRate: 0.00001,
      slippageBps: 5,
      lotSize: 100,
      minCommission: 5,
    });
  });

  it("1-j) 身份 / 版本 / universe 派生是确定性的（不是随机 / 时间相关）", () => {
    expect(deriveStrategyId(88001)).toBe("cand-88001");
    expect(deriveUniverseIdForDataset("v2")).toBe("research-dataset:v2");
    expect(PROMOTE_INITIAL_STRATEGY_VERSION).toBe("1.0.0");
    expect(PROMOTE_INITIAL_VERSION_STATUS).toBe("Draft");
  });
});

// ---------------------------------------------------------------------------
// 2) 缺失字段 —— 一律响亮失败，绝不补默认
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · 缺失字段 ⇒ PROMOTE_SKETCH_INCOMPLETE（§8）", () => {
  it("2-a) 缺 entryRule.extra.observationWindow（观测窗口无处可猜）", async () => {
    const draft = mutateDraft((d) => {
      const extra = extraOf(d);
      delete extra.observationWindow;
    });
    const err = await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "entryRule.extra.observationWindow",
    );
    expect(err.details?.path).toBe("entryRule.extra.observationWindow");
  });

  it("2-b) 缺 entryRule.extra.trigger", async () => {
    const draft = mutateDraft((d) => {
      const extra = extraOf(d);
      delete extra.trigger;
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "entryRule.extra.trigger",
    );
  });

  it("2-c) 缺 execution.quantityMethod / lotSize", async () => {
    const a = mutateDraft((d) => {
      const execution = extraOf(d).execution as Record<string, unknown>;
      delete execution.quantityMethod;
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(a)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "execution.quantityMethod",
    );
    const b = mutateDraft((d) => {
      const execution = extraOf(d).execution as Record<string, unknown>;
      delete execution.lotSize;
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(b)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "execution.lotSize",
    );
  });

  it("2-d) 缺 position.sizingMethod（不默认按比例 / 等权）", async () => {
    const draft = mutateDraft((d) => {
      const position = extraOf(d).position as Record<string, unknown>;
      delete position.sizingMethod;
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "position.sizingMethod",
    );
  });

  it("2-e) 缺 riskRule.maxPositions（不默认 1 / 不默认 5）", async () => {
    const draft = mutateDraft((d) => {
      const riskRule = d.riskRule as Record<string, unknown>;
      delete riskRule.maxPositions;
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "riskRule.maxPositions",
    );
  });

  it("2-f) 文档级假设缺失（initialCapital / costModel）同样响亮失败", async () => {
    const noCapital = mutateDraft((d) => {
      const document = extraOf(d).document as { backtestConfig: Record<string, unknown> };
      delete document.backtestConfig.initialCapital;
    });
    await expectSketchError(
      () => buildExecutionAssumptions(noCapital),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "backtestConfig.initialCapital",
    );

    const noCost = mutateDraft((d) => {
      const extra = extraOf(d);
      delete extra.document;
    });
    await expectSketchError(
      () => buildExecutionAssumptions(noCost),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "entryRule.extra.document",
    );
  });

  it("2-g) TUNABLE 数值参数缺 min / max（搜索空间不可定界 ⇒ 不猜范围）", async () => {
    const draft = mutateDraft((d) => {
      d.parameterSpace = { holdingDays: { type: "number" } };
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "parameterSpace.holdingDays.min",
    );
  });

  it("2-h) 非数值 TUNABLE 参数缺 allowedValues", async () => {
    const draft = mutateDraft((d) => {
      d.parameterSpace = { exitMode: { type: "string" } };
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
      "parameterSpace.exitMode.allowedValues",
    );
  });
});

// ---------------------------------------------------------------------------
// 3) 不允许猜测 / 不允许静默降级
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · 不可无损映射 ⇒ PROMOTE_SKETCH_INVALID（§8 / §9）", () => {
  it("3-a) 未定义的扩展键（闭集；不静默忽略）", async () => {
    const draft = mutateDraft((d) => {
      (d.entryRule as { extra: Record<string, unknown> }).extra.defaultTakeProfit = 0.1;
    });
    const err = await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
    );
    expect(err.message).toContain("defaultTakeProfit");
  });

  it("3-b) exitRule.extra 非空（本 STEP 只认 entryRule.extra 一处扩展槽）", async () => {
    const draft = mutateDraft((d) => {
      d.exitRule = { holdingDays: 3, extra: { trailingStop: 0.05 } };
    });
    const err = await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
    );
    expect(err.message).toContain("entryRule.extra");
  });

  it("3-c) riskRule.extra 非空同理", async () => {
    const draft = mutateDraft((d) => {
      d.riskRule = { maxPositions: 5, extra: { pauseOnLimitDown: true } };
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
    );
  });

  it("3-d) 词表不支持的 Research 操作符（BETWEEN / IS_NULL）不被降级", async () => {
    const draft = mutateDraft((d) => {
      const rows = (
        d.filterRule as { groups: Array<{ conditions: Array<Record<string, unknown>> }> }
      ).groups[0].conditions;
      rows[0].operator = "BETWEEN";
      rows[0].value = [1, 2];
    });
    const err = await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
      "operator",
    );
    expect(err.message).toContain("BETWEEN");
  });

  it("3-e) 字段名写不进既有引用文法（不替它猜时间域）", async () => {
    const draft = mutateDraft((d) => {
      const rows = (
        d.filterRule as { groups: Array<{ conditions: Array<Record<string, unknown>> }> }
      ).groups[0].conditions;
      rows[0].fieldName = "turnover";
    });
    const err = await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
      "fieldName",
    );
    expect(err.message).toContain("prefix.rd-1.close");
  });

  it("3-f) riskRule.regimeGate 无法无损落入 Strategy 词表 ⇒ 拒绝（不静默丢弃）", async () => {
    const draft = mutateDraft((d) => {
      d.riskRule = {
        maxPositions: 5,
        regimeGate: {
          groups: [
            {
              groupNo: 0,
              groupLogicalOperator: "AND",
              conditions: [
                {
                  groupNo: 0,
                  sortOrder: 0,
                  fieldName: "market_strength",
                  operator: ">",
                  value: 0.6,
                  logicalOperator: "AND",
                  groupLogicalOperator: "AND",
                },
              ],
            },
          ],
        },
      };
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
      "regimeGate",
    );
  });

  it("3-g) 单标的仓位上限两处声明 ⇒ 拒绝（同一事实只能有一个权威）", async () => {
    const draft = mutateDraft((d) => {
      (
        d.entryRule as { extra: { position: Record<string, unknown> } }
      ).extra.position.maxSinglePosition = 0.25;
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
      "maxSinglePosition",
    );
  });

  it("3-h) position.maxPositions 两处声明 ⇒ 拒绝（唯一权威是 riskRule.maxPositions）", async () => {
    const draft = mutateDraft((d) => {
      (
        d.entryRule as { extra: { position: Record<string, unknown> } }
      ).extra.position.maxPositions = 2;
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
      "riskRule.maxPositions",
    );
  });

  it("3-i) 未知入场时点 ⇒ 拒绝（避免把未知 timing 当成默认值）", async () => {
    const draft = mutateDraft((d) => {
      (d.entryRule as { timing: string }).timing = "NEXT_HOUR";
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
      "entryRule.timing",
    );
  });

  it("3-j) 事件类型不在 Strategy 白名单 ⇒ 拒绝", async () => {
    const draft = mutateDraft((d) => {
      (d.entryRule as { event: string }).event = "SECOND_LIMIT_UP";
    });
    await expectSketchError(
      () => buildStrategyDefinition(input(draft)),
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
      "entryRule.event",
    );
  });
});

// ---------------------------------------------------------------------------
// 4) 确定性
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · 确定性（§6）", () => {
  it("4-a) 同一输入连续两次 ⇒ 深度相等且 JSON 串一致", () => {
    const draft = fullDraft();
    const a = buildStrategyDefinition(input(draft));
    const b = buildStrategyDefinition(input(draft));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("4-b) 键序不影响结果（确定性排序而非插入序）", () => {
    const reordered = mutateDraft((d) => {
      d.parameterSpace = {
        pullbackWindow: { type: "number", min: 1, max: 10, step: 1 },
        holdingDays: { type: "number", min: 1, max: 20, step: 1 },
      };
      (
        d.entryRule as { extra: { eventParams: Record<string, unknown> } }
      ).extra.eventParams = { limitUpRatio: 0.1, market: "SH" };
    });
    const a = buildStrategyDefinition(input(fullDraft()));
    const b = buildStrategyDefinition(input(reordered));
    expect(b.parameters.map((p) => p.code)).toEqual(a.parameters.map((p) => p.code));
    expect(Object.keys(b.entry.event?.params ?? {})).toEqual(["limitUpRatio", "market"]);
    // datasets 的 note 是固定串，不受输入键序影响
    expect(b.datasets).toEqual(a.datasets);
  });
});

// ---------------------------------------------------------------------------
// 5) 输入不被修改
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · 纯函数：输入不被修改（§6）", () => {
  it("5-a) 深度冻结的草稿能原样跑完 build + buildExecutionAssumptions", () => {
    const frozen = deepFreeze(fullDraft());
    expect(() => buildStrategyDefinition(input(frozen))).not.toThrow();
    expect(() => buildExecutionAssumptions(frozen)).not.toThrow();
  });

  it("5-b) 构建前后草稿与快照逐字段相等", () => {
    const draft = fullDraft();
    const snapshot = structuredClone(draft);
    buildStrategyDefinition(input(draft));
    buildExecutionAssumptions(draft);
    expect(draft).toEqual(snapshot);
  });

  it("5-c) 返回值不与输入共享可变引用（改返回值不会回写草稿）", () => {
    const draft = fullDraft();
    const definition = buildStrategyDefinition(input(draft));
    const params = definition.entry.event?.params as Record<string, unknown>;
    params.limitUpRatio = 0.2;
    expect(
      (draft.entryRule as { extra: { eventParams: Record<string, unknown> } }).extra.eventParams
        .limitUpRatio,
    ).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// validate（§10：build 之后必须校验；失败 ⇒ 无副作用地响亮失败）
// ---------------------------------------------------------------------------

describe("RESEARCH-006.3 · validateBuiltStrategyDefinition（§10）", () => {
  it("合法产物通过并返回 normalize 后的定义", () => {
    const definition = buildStrategyDefinition(input(fullDraft()));
    const normalized = validateBuiltStrategyDefinition(definition);
    expect(normalized.entry.conditions).toHaveLength(2);
    expect(normalized.exit.rules).toHaveLength(3);
  });

  it("非法产物 ⇒ PROMOTE_DEFINITION_INVALID，且 details 带 issues（不尝试「修一下让它过」）", () => {
    const definition = buildStrategyDefinition(input(fullDraft()));
    const tampered = structuredClone(definition);
    tampered.execution = { ...tampered.execution, lotSize: 0 };
    try {
      validateBuiltStrategyDefinition(tampered);
      throw new Error("期望抛出 StrategyCandidateError，但校验通过了");
    } catch (err) {
      expect(err).toBeInstanceOf(StrategyCandidateError);
      const e = err as StrategyCandidateError;
      expect(e.code).toBe(STRATEGY_CANDIDATE_ERROR.PROMOTE_DEFINITION_INVALID);
      expect(Array.isArray(e.details?.issues)).toBe(true);
    }
  });
});
