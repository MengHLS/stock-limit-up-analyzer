/**
 * candidateSketchForm 测试 —— 候选草图「结构化表单」的纯函数契约。
 *
 * 两类断言：
 *   ① **与服务端逐字对表（防漂移）**：客户端不能 `import` 服务端的运行时值，
 *      所以本地词表是唯一可落地的形式；本文件是唯一能证明它没漂的地方。
 *      对表覆盖：事件 / 入场时点 / 窗口单位 / 触发 / 数量口径 / 成本模型 / 仓位方式 /
 *      参数类型 / 扩展槽闭集 / 条件运算符（从源码抽 `CONDITION_OPERATOR_MAP` 的键）/
 *      字段引用解析（与服务端 `parseStrategyFieldReference` 逐例比对）。
 *   ② **互转契约**：`JSON → 草稿 → JSON` 往返幂等；表达不了 ⇒ 整块只读且不提交；
 *      校验只做「提示」，不越权替后端判定。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STRATEGY_BAR_FIELDS,
  STRATEGY_CONDITION_VALUE_TYPES,
  STRATEGY_COST_MODELS,
  STRATEGY_EVENT_FIELDS,
  STRATEGY_EVENT_TYPES,
  STRATEGY_PARAMETER_DATA_TYPES,
  STRATEGY_POSITION_SIZING_METHODS,
  STRATEGY_QUANTITY_METHODS,
  STRATEGY_TRIGGER_TYPES,
  STRATEGY_WINDOW_UNITS,
  parseStrategyFieldReference,
  resolveSignalTimeline,
} from "../../../../server/research/strategySchema/definition";
import {
  CANDIDATE_SKETCH_EXTENSION_KEYS as SERVER_EXTENSION_KEYS,
  ENTRY_TIMING_TO_EXECUTION,
} from "../../../../server/research/strategyCandidate/definitionBuild";
import {
  CANDIDATE_BAR_FIELD_CHOICES,
  CANDIDATE_BAR_FIELD_OPTIONS,
  CANDIDATE_CONDITION_OPERATOR_OPTIONS,
  CANDIDATE_CONDITION_PRESETS,
  CANDIDATE_CONDITION_VALUE_TYPE_OPTIONS,
  CANDIDATE_COST_MODEL_OPTIONS,
  CANDIDATE_ENTRY_TIMING_OPTIONS,
  CANDIDATE_EVENT_FIELD_CHOICES,
  CANDIDATE_EVENT_OPTIONS,
  CANDIDATE_FIELD_ROOT_OPTIONS,
  CANDIDATE_PARAMETER_TYPE_OPTIONS,
  CANDIDATE_QUANTITY_METHOD_OPTIONS,
  CANDIDATE_SIZING_METHOD_OPTIONS,
  CANDIDATE_SKETCH_EXTENSION_KEYS,
  CANDIDATE_TRIGGER_OPTIONS,
  CANDIDATE_WINDOW_UNIT_OPTIONS,
  buildCandidateFieldReference,
  candidateFieldChoicesOf,
  describeCandidateCondition,
  parseCandidateFieldReference,
  splitCandidateFieldReference,
} from "./candidateSketchVocabulary";
import {
  SKETCH_BLOCK_LABELS,
  buildSketchPatch,
  conditionsUseNonConjunction,
  describeFilterGroups,
  emptySketchDrafts,
  SKETCH_BLOCK_HOME_SEGMENT,
  SKETCH_FIELD_ANCHORS,
  SKETCH_SEGMENT_KEYS,
  SKETCH_SEGMENT_REQUIRED,
  SKETCH_SEGMENTS,
  sketchDraftsToJson,
  sketchSegmentBlocks,
  sketchSegmentStatuses,
  sketchValuesEqual,
  summarizeSketchSegment,
  toSketchDrafts,
  validateSketchDrafts,
} from "./candidateSketchForm";
import {
  A_SHARE_COST_PRESET,
  applyCostPreset,
  COST_ASSUMPTION_FIELDS,
  describeCostPreset,
  formatCapital,
  formatCostRate,
  isCostAssumptionComplete,
  matchCostPreset,
} from "./candidateSketchCostPreset";

// ---------------------------------------------------------------------------
// ① 与服务端逐字对表
// ---------------------------------------------------------------------------

function conditionOperatorKeysFromServerSource(): string[] {
  const file = path.resolve(
    import.meta.dirname,
    "../../../../server/research/strategyCandidate/definitionBuild.ts",
  );
  const source = readFileSync(file, "utf8");
  const start = source.indexOf("const CONDITION_OPERATOR_MAP");
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("};", start));
  const keys: string[] = [];
  for (const line of body.split("\n")) {
    const match = /^\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*"/.exec(line);
    if (match !== null) keys.push(match[1] ?? match[2]!);
  }
  return keys;
}

describe("词表与服务端逐字对表（防漂移）", () => {
  it("事件类型 / 窗口单位 / 触发 / 数量口径 / 成本模型 / 仓位方式 / 参数类型 ≡ 服务端常量", () => {
    expect(CANDIDATE_EVENT_OPTIONS.map((o) => o.value)).toEqual([...STRATEGY_EVENT_TYPES]);
    expect(CANDIDATE_WINDOW_UNIT_OPTIONS.map((o) => o.value)).toEqual([...STRATEGY_WINDOW_UNITS]);
    expect(CANDIDATE_TRIGGER_OPTIONS.map((o) => o.value)).toEqual([...STRATEGY_TRIGGER_TYPES]);
    expect(CANDIDATE_QUANTITY_METHOD_OPTIONS.map((o) => o.value)).toEqual([...STRATEGY_QUANTITY_METHODS]);
    expect(CANDIDATE_COST_MODEL_OPTIONS.map((o) => o.value)).toEqual([...STRATEGY_COST_MODELS]);
    expect(CANDIDATE_SIZING_METHOD_OPTIONS.map((o) => o.value)).toEqual([
      ...STRATEGY_POSITION_SIZING_METHODS,
    ]);
    expect(CANDIDATE_PARAMETER_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      ...STRATEGY_PARAMETER_DATA_TYPES,
    ]);
  });

  it("入场时点 ≡ 服务端 ENTRY_TIMING_TO_EXECUTION 的键（多一个都不得提供）", () => {
    expect(CANDIDATE_ENTRY_TIMING_OPTIONS.map((o) => o.value).sort()).toEqual(
      Object.keys(ENTRY_TIMING_TO_EXECUTION).sort(),
    );
  });

  it("extra 扩展槽闭集 ≡ 服务端 CANDIDATE_SKETCH_EXTENSION_KEYS", () => {
    expect([...CANDIDATE_SKETCH_EXTENSION_KEYS]).toEqual([...SERVER_EXTENSION_KEYS]);
  });

  it("🔴 条件运算符 ≡ 服务端 CONDITION_OPERATOR_MAP 的键（BETWEEN / IS_NULL 不得出现）", () => {
    const serverOps = conditionOperatorKeysFromServerSource().sort();
    expect(serverOps.length).toBeGreaterThan(0);
    expect(CANDIDATE_CONDITION_OPERATOR_OPTIONS.map((o) => o.value).sort()).toEqual(serverOps);
    for (const forbidden of ["BETWEEN", "IS_NULL", "IS_NOT_NULL"]) {
      expect(CANDIDATE_CONDITION_OPERATOR_OPTIONS.map((o) => o.value)).not.toContain(forbidden);
    }
  });

  it("字段引用解析 ≡ 服务端 parseStrategyFieldReference（逐例）", () => {
    const cases = [
      "prefix.rd0.close",
      "prefix.rd-1.close",
      "prefix.rd-2.marketCap",
      "prefix.rd1.close",
      "post.rd1.close",
      "post.rd0.close",
      "event.turnover",
      "event.isFirstLimit",
      "bar.close",
      "path.return_1_5d",
      "outcome.future_return_3d",
      "turnover",
      "prefix.rd0",
      "prefix.rd0.",
      "",
      "   ",
      "PREFIX.RD0.CLOSE",
      "bar.9bad",
    ];
    for (const raw of cases) {
      const local = parseCandidateFieldReference(raw);
      const server = parseStrategyFieldReference(raw);
      expect({ raw, kind: local.kind, day: local.relativeDay, field: local.field }).toEqual({
        raw,
        kind: server.kind,
        day: "relativeDay" in server ? server.relativeDay : undefined,
        field: "field" in server ? server.field : undefined,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// ② 互转契约
// ---------------------------------------------------------------------------

/** 一份**能被表单完整表达**、且已处于规范形（组号 0 起连续、sortOrder 0 起连续）的草图。 */
const FULL_SKETCH: Record<string, unknown> = {
  entryRule: {
    event: "FIRST_LIMIT_UP",
    timing: "NEXT_OPEN",
    extra: {
      observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
      trigger: "FIRST_VALID_DAY",
      eventParams: { eventCode: "FIRST_BOARD", minBoards: 1, strict: true },
      execution: {
        quantityMethod: "FIXED_SHARES",
        lotSize: 100,
        slippageModel: "BPS",
        executionConstraints: ["no_open_limit_up", "skip_suspended"],
      },
      position: { sizingMethod: "EQUAL_WEIGHT", maxSinglePosition: 0.2 },
      risk: { stopLoss: 0.05, maxDrawdown: 0.2, extensions: { maxBoardHeight: 3 } },
      document: {
        backtestConfig: { initialCapital: 1000000, maxPositions: 10 },
        costModel: {
          commissionRate: 0.0003,
          stampDutyRate: 0.001,
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
            fieldName: "prefix.rd0.close",
            operator: ">=",
            value: 5,
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
          },
          {
            groupNo: 0,
            sortOrder: 1,
            fieldName: "event.turnover",
            operator: "NOT_IN",
            value: ["st", "delisted"],
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
          },
        ],
      },
    ],
  },
  exitRule: { stopLoss: 0.05, takeProfit: 0.1, holdingDays: 3 },
  riskRule: { maxPositions: 5, maxPositionWeight: 0.2 },
  parameterSpace: {
    turnoverLow: { type: "number", min: 5, max: 12, step: 1 },
    boardPool: { type: "string", allowedValues: ["main", "chinext"] },
  },
};

describe("JSON → 草稿", () => {
  it("全部可表达 → 五块都是 structured，且值原样搬运", () => {
    const drafts = toSketchDrafts(FULL_SKETCH);
    expect(drafts.entryRule.kind).toBe("structured");
    expect(drafts.filterRule.kind).toBe("structured");
    expect(drafts.exitRule.kind).toBe("structured");
    expect(drafts.riskRule.kind).toBe("structured");
    expect(drafts.parameterSpace.kind).toBe("structured");
    if (drafts.entryRule.kind === "structured") {
      expect(drafts.entryRule.draft.event).toBe("FIRST_LIMIT_UP");
      expect(drafts.entryRule.draft.execution.lotSize).toBe("100");
      expect(drafts.entryRule.draft.execution.constraintsText).toBe("no_open_limit_up,skip_suspended");
      expect(drafts.entryRule.draft.eventParams).toHaveLength(3);
    }
    if (drafts.riskRule.kind === "structured") expect(drafts.riskRule.draft.maxPositions).toBe("5");
  });

  it("null / 缺失 → empty（不是空对象草稿）", () => {
    const drafts = toSketchDrafts({ entryRule: null, filterRule: undefined });
    expect(drafts.entryRule.kind).toBe("empty");
    expect(drafts.filterRule.kind).toBe("empty");
    expect(drafts.exitRule.kind).toBe("empty");
  });

  it("未知键 / 非法类型 → 整块 raw，并说明原因（不静默截断）", () => {
    const unknownTop = toSketchDrafts({ entryRule: { event: "FIRST_LIMIT_UP", agentNote: "x" } });
    expect(unknownTop.entryRule.kind).toBe("raw");
    if (unknownTop.entryRule.kind === "raw") expect(unknownTop.entryRule.reason).toContain("未收录的键");

    const unknownExtra = toSketchDrafts({
      entryRule: { event: "FIRST_LIMIT_UP", extra: { madeUpSlot: 1 } },
    });
    expect(unknownExtra.entryRule.kind).toBe("raw");

    const nested = toSketchDrafts({
      entryRule: { extra: { observationWindow: { start: 1, end: 5, unit: "TRADING_DAY", tz: "UTC" } } },
    });
    expect(nested.entryRule.kind).toBe("raw");
  });

  it("exitRule.extra / riskRule.regimeGate 非空 → raw，且原因是「服务端会明确拒绝」", () => {
    const exit = toSketchDrafts({ exitRule: { stopLoss: 0.05, extra: { note: 1 } } });
    expect(exit.exitRule.kind).toBe("raw");
    if (exit.exitRule.kind === "raw") expect(exit.exitRule.reason).toContain("扩展槽");

    const risk = toSketchDrafts({ riskRule: { maxPositions: 3, regimeGate: { groups: [] } } });
    expect(risk.riskRule.kind).toBe("raw");
    if (risk.riskRule.kind === "raw") expect(risk.riskRule.reason).toContain("regimeGate");
  });

  it("🔴 filterRule 含转正不支持的运算符（BETWEEN）→ raw，且点名该运算符", () => {
    const drafts = toSketchDrafts({
      filterRule: {
        groups: [
          {
            groupNo: 0,
            groupLogicalOperator: "AND",
            conditions: [
              {
                groupNo: 0,
                sortOrder: 0,
                fieldName: "prefix.rd0.close",
                operator: "BETWEEN",
                value: [1, 2],
                logicalOperator: "AND",
                groupLogicalOperator: "AND",
              },
            ],
          },
        ],
      },
    });
    expect(drafts.filterRule.kind).toBe("raw");
    if (drafts.filterRule.kind === "raw") {
      expect(drafts.filterRule.reason).toContain("BETWEEN");
      expect(drafts.filterRule.reason).toContain("转正支持");
    }
  });

  it("filterRule 组号 / sortOrder 乱序也能收敛到规范草稿（往返不再漂）", () => {
    const drafts = toSketchDrafts({
      filterRule: {
        groups: [
          {
            groupNo: 1,
            groupLogicalOperator: "OR",
            conditions: [
              {
                groupNo: 1,
                sortOrder: 7,
                fieldName: "bar.close",
                operator: ">",
                value: 3,
                logicalOperator: "AND",
                groupLogicalOperator: "OR",
              },
            ],
          },
        ],
      },
    });
    expect(drafts.filterRule.kind).toBe("structured");
    if (drafts.filterRule.kind === "structured") {
      const json = sketchDraftsToJson(drafts).filterRule as { groups: Array<{ groupNo: number }> };
      expect(json.groups).toHaveLength(1);
      expect(json.groups[0]!.groupNo).toBe(0);
    }
  });
});

describe("草稿 → JSON（往返幂等）", () => {
  it("FULL_SKETCH → 草稿 → JSON ⇒ 逐块与原值语义相等", () => {
    const drafts = toSketchDrafts(FULL_SKETCH);
    const rebuilt = sketchDraftsToJson(drafts);
    for (const key of Object.keys(FULL_SKETCH)) {
      expect(sketchValuesEqual(rebuilt[key], FULL_SKETCH[key])).toBe(true);
    }
  });

  it("未填写的块 → null；raw 块 → 不产出键（永不提交）", () => {
    const drafts = toSketchDrafts({ entryRule: null, exitRule: { extra: { note: 1 } } });
    const json = sketchDraftsToJson(drafts);
    expect(json.entryRule).toBeNull();
    expect(Object.keys(json)).not.toContain("exitRule");
  });

  it("空草稿 → 五块全为 null（清空语义，不是省略键）", () => {
    const json = sketchDraftsToJson(emptySketchDrafts());
    expect(json).toEqual({
      entryRule: null,
      filterRule: null,
      exitRule: null,
      riskRule: null,
      parameterSpace: null,
    });
  });
});

describe("校验：错误（填了但不合法）与缺口（转正必填但没填）", () => {
  it("空草稿 → 全是缺口，没有错误（本来就没填，谈不上填错）", () => {
    const result = validateSketchDrafts(emptySketchDrafts());
    expect(result.errors).toEqual([]);
    // 「入场规则整块没填」被按**段**拆开 —— 分段界面里一句笼统的话没法定位到任何一段。
    expect(result.gaps.join()).toContain("入场事件类型");
    expect(result.gaps.join()).toContain("入场时点");
    expect(result.gaps.join()).toContain("最大同时持仓数");
    // `gaps` 是 `gapDetails` 的投影：两套说法必须同源同序。
    expect(result.gaps).toEqual(result.gapDetails.map((item) => item.label));
  });

  it("🔴 exitRule 为空**不是**转正缺口（后端只校验 exit.rules 是数组，无「至少一条」约束）", () => {
    const result = validateSketchDrafts(emptySketchDrafts());
    expect(result.gapDetails.some((item) => item.segment === "exit")).toBe(false);
    expect(result.gaps.join()).not.toContain("出场规则");
  });

  it("缺口带段归属，且六段的缺口数之和 = 总缺口数（没有缺口掉在段外）", () => {
    const drafts = toSketchDrafts({
      entryRule: { event: "FIRST_LIMIT_UP", extra: { observationWindow: { start: 1, end: 3, unit: "TRADING_DAY" } } },
    });
    const { gapDetails } = validateSketchDrafts(drafts);
    const statuses = sketchSegmentStatuses(drafts);
    expect(statuses.reduce((sum, status) => sum + status.gapCount, 0)).toBe(gapDetails.length);
    for (const item of gapDetails) {
      expect(SKETCH_SEGMENT_KEYS).toContain(item.segment);
    }
  });

  it("整行空白不算「填错」：空的条件行 / 空的参数行都不进 errors", () => {
    const drafts = toSketchDrafts({
      filterRule: { groups: [{ groupNo: 0, groupLogicalOperator: "AND", conditions: [{ groupNo: 0, sortOrder: 0, fieldName: "", operator: ">=", value: null, logicalOperator: "AND", groupLogicalOperator: "AND" }] }] },
      parameterSpace: { turnoverLow: { type: "number" } },
    });
    const result = validateSketchDrafts(drafts);
    // 参数行「写了名字但没给范围」是真错；空条件行不是。
    expect(result.errors.join()).toContain("min 与 max");
    expect(result.errors.join()).not.toContain("还没选字段");
  });

  it("填了但不合法 → 进 errors（阻止保存），缺口仍单独列出", () => {
    const base = toSketchDrafts(FULL_SKETCH);
    if (base.exitRule.kind !== "structured") throw new Error("fixture 期望 exitRule 可结构化");
    const result = validateSketchDrafts({
      ...base,
      exitRule: { kind: "structured", draft: { ...base.exitRule.draft, stopLoss: "1.5" } },
    });
    expect(result.errors.join()).toContain("止损比例");
    expect(result.errors.join()).toContain("(0,1)");
  });

  it("观察窗口只填一半 → 进缺口（不替你默认单位）", () => {
    const drafts = toSketchDrafts({ entryRule: { event: "FIRST_LIMIT_UP", extra: { observationWindow: { start: 1 } } } });
    const result = validateSketchDrafts(drafts);
    expect(result.gaps.join()).toContain("观察窗口");
  });

  it("条件字段不是 Strategy 字段引用 → 进 errors，并说明「不会被猜成某个时间域」", () => {
    const drafts = toSketchDrafts({
      filterRule: {
        groups: [
          {
            groupNo: 0,
            groupLogicalOperator: "AND",
            conditions: [
              {
                groupNo: 0,
                sortOrder: 0,
                fieldName: "turnover",
                operator: ">",
                value: 3,
                logicalOperator: "AND",
                groupLogicalOperator: "AND",
              },
            ],
          },
        ],
      },
    });
    const result = validateSketchDrafts(drafts);
    expect(result.errors.join()).toContain("字段引用");
    expect(result.errors.join()).toContain("不会被猜成某个时间域");
  });

  it("数值参数缺 max → 进 errors（TUNABLE 必须自带搜索界）", () => {
    const drafts = toSketchDrafts({ parameterSpace: { turnoverLow: { type: "number", min: 5 } } });
    const result = validateSketchDrafts(drafts);
    expect(result.errors.join()).toContain("min 与 max");
  });
});

describe("patch 构造", () => {
  it("只提交改动过的块；未改动 → 拒绝空补丁", () => {
    const drafts = toSketchDrafts(FULL_SKETCH);
    const unchanged = buildSketchPatch(FULL_SKETCH, drafts);
    expect(unchanged.ok).toBe(false);
    if (!unchanged.ok) expect(unchanged.errors[0]).toContain("没有任何字段被修改");
  });

  it("🔴 raw 块永不进入补丁（无论其它块怎么改）", () => {
    const original = { ...FULL_SKETCH, riskRule: { maxBoards: 3 } };
    const drafts = toSketchDrafts(original);
    if (drafts.exitRule.kind !== "structured") throw new Error("fixture 期望 exitRule 可结构化");
    const patch = buildSketchPatch(original, {
      ...drafts,
      exitRule: { kind: "structured", draft: { ...drafts.exitRule.draft, holdingDays: "5" } },
    });
    expect(patch.ok).toBe(true);
    if (patch.ok) {
      expect(Object.keys(patch.patch)).toEqual(["exitRule"]);
      expect(patch.patch.riskRule).toBeUndefined();
    }
  });

  it("填了非法值 → 补丁整体失败（不产出一半）", () => {
    const drafts = toSketchDrafts(FULL_SKETCH);
    if (drafts.riskRule.kind !== "structured") throw new Error("fixture 期望 riskRule 可结构化");
    const patch = buildSketchPatch(FULL_SKETCH, {
      ...drafts,
      riskRule: { kind: "structured", draft: { ...drafts.riskRule.draft, maxPositions: "0" } },
    });
    expect(patch.ok).toBe(false);
    if (!patch.ok) expect(patch.errors.join()).toContain("maxPositions");
  });
});

// ---------------------------------------------------------------------------
// ③ 界面段模型：折叠态摘要与状态
// ---------------------------------------------------------------------------

describe("界面段（按交易决策顺序）", () => {
  it("段的定义自洽：键唯一、块全覆盖、必填性表覆盖所有段", () => {
    expect(SKETCH_SEGMENT_KEYS).toHaveLength(SKETCH_SEGMENTS.length);
    expect(new Set(SKETCH_SEGMENT_KEYS).size).toBe(SKETCH_SEGMENT_KEYS.length);
    // 六个块键恰好被段覆盖一遍（`entryRule` 被四段共享，属预期）。
    const covered = new Set(SKETCH_SEGMENT_KEYS.flatMap((key) => sketchSegmentBlocks(key)));
    expect([...covered].sort()).toEqual(
      ["entryRule", "exitRule", "filterRule", "parameterSpace", "riskRule"].sort(),
    );
    expect(Object.keys(SKETCH_SEGMENT_REQUIRED).sort()).toEqual([...SKETCH_SEGMENT_KEYS].sort());
    expect(Object.keys(SKETCH_BLOCK_HOME_SEGMENT).sort()).toEqual([...covered].sort());
    // 每个块的「归属段」必须真的包含它（否则只读提示会挂到不相干的段上）。
    for (const [block, segment] of Object.entries(SKETCH_BLOCK_HOME_SEGMENT)) {
      expect(sketchSegmentBlocks(segment)).toContain(block);
    }
  });

  it("段的顺序就是「下单时的思路」：买什么 → 什么价买 → 怎么卖 → 买多少 → 成本 → 参数", () => {
    expect([...SKETCH_SEGMENT_KEYS]).toEqual(["what", "when", "exit", "sizing", "cost", "parameters"]);
    expect(SKETCH_SEGMENT_REQUIRED).toEqual({
      what: true,
      when: true,
      exit: false,
      sizing: true,
      cost: true,
      parameters: false,
    });
  });

  it("完整草图 → 六段摘要都是人话，且必填段全部「齐了」", () => {
    const drafts = toSketchDrafts(FULL_SKETCH);
    const statuses = sketchSegmentStatuses(drafts);
    expect(statuses.map((status) => status.segment)).toEqual([...SKETCH_SEGMENT_KEYS]);
    expect(statuses.every((status) => status.summary !== "")).toBe(true);
    expect(statuses.reduce((sum, status) => sum + status.gapCount, 0)).toBe(0);
    expect(statuses.filter((status) => status.required).every((status) => status.gapCount === 0)).toBe(true);

    // ① 买什么：只剩「观察哪类事件」—— 条件已经归到「什么价买」（见下一条）。
    expect(summarizeSketchSegment(drafts, "what")).toBe("首个涨停（首板） · 3 个事件参数");
    // ② 什么价买：时点 + 窗口 + 触发 + **买入条件**（后者正是 `filterRule` 的去向）。
    expect(summarizeSketchSegment(drafts, "when")).toBe(
      "次一交易日开盘买入 · 观察第 1–5 交易日 · 首个有效日触发 · 买入条件："
        + "事件日当天（rd0）的收盘价 大于等于 5 且 事件日的换手率 不属于 st,delisted",
    );
    expect(summarizeSketchSegment(drafts, "exit")).toBe("止损 5% · 止盈 10% · 3 个交易日后卖出");
    expect(summarizeSketchSegment(drafts, "sizing")).toBe(
      "最多 5 只 · 单标的 ≤ 20% · 等权 · 固定股数 · 100 股/手",
    );
    // ⚠️ FULL_SKETCH 的持仓偏离 A 股标准（滑点 5bp ≠ 10bp）⇒ 必须报「自定义」而不是硬套预设名。
    expect(summarizeSketchSegment(drafts, "cost")).toBe("本金 100 万 · 自定义成本");
    expect(summarizeSketchSegment(drafts, "parameters")).toBe("2 个参数：turnoverLow、boardPool");
  });

  it("空草图 → 摘要基本为空；③ 怎么卖 例外，它会明说「未设置」（那是提醒，不是假摘要）", () => {
    const statuses = sketchSegmentStatuses(emptySketchDrafts());
    expect(statuses.every((status) => status.empty)).toBe(true);
    const nonEmptySummaries = statuses.filter((status) => status.summary !== "");
    expect(nonEmptySummaries.map((status) => status.segment)).toEqual(["exit"]);
    expect(nonEmptySummaries[0].summary).toContain("未设置");
    expect(summarizeSketchSegment(emptySketchDrafts(), "what")).toBe("");
  });

  it("入场规则整块变 raw → 承载它的四段都标出只读块（不只在第一段报）", () => {
    const drafts = toSketchDrafts({ entryRule: { event: "FIRST_LIMIT_UP", agentNote: "x" } });
    const statuses = sketchSegmentStatuses(drafts);
    const rawSegments = statuses.filter((status) => status.rawBlocks.includes("entryRule"));
    expect(rawSegments.map((status) => status.segment)).toEqual(["what", "when", "sizing", "cost"]);
  });
});

// ---------------------------------------------------------------------------
// ③.5 缺口落点（anchors）：编辑器靠它说清「差的是哪一项」
// ---------------------------------------------------------------------------

describe("缺口落点（anchors）", () => {
  it("段状态携带逐条缺口明细，且与总清单同源同序（不出现两套说法）", () => {
    const drafts = toSketchDrafts(FULL_SKETCH);
    const { gapDetails } = validateSketchDrafts(drafts);
    for (const status of sketchSegmentStatuses(drafts)) {
      // `gapCount` 就是明细长度；`gaps` 是总清单按段的切片，逐条相同。
      expect(status.gapCount).toBe(status.gaps.length);
      expect(status.gaps).toEqual(gapDetails.filter((item) => item.segment === status.segment));
    }
  });

  it("锚点必须都是声明过的那几个 —— 空草稿恰好用满全部锚点（穷尽性）", () => {
    // 空草稿走「整块未填」分支，那里一条缺口会同时列出它对应的全部输入框。
    const used = new Set<string>();
    for (const item of validateSketchDrafts(emptySketchDrafts()).gapDetails) {
      expect(SKETCH_SEGMENT_KEYS).toContain(item.segment);
      for (const anchor of item.anchors) {
        expect(SKETCH_FIELD_ANCHORS).toContain(anchor);
        used.add(anchor);
      }
    }
    // 每个锚点都真的会被产出 —— 若有人往表里加了一个没接线的锚点，这里先红。
    expect([...used].sort()).toEqual([...SKETCH_FIELD_ANCHORS].sort());
    // 缺口总数 ≤ 锚点数 * 3（一条缺口最多对应三件套），防「一条缺口塞一堆落点」的写法。
    for (const item of validateSketchDrafts(emptySketchDrafts()).gapDetails) {
      expect(item.anchors.length).toBeLessThanOrEqual(3);
    }
  });

  it("整块未填时，一条缺口可以对应多个输入框（时点 / 窗口 / 触发三件套）", () => {
    const when = sketchSegmentStatuses(emptySketchDrafts()).find((status) => status.segment === "when");
    expect(when?.gaps).toHaveLength(1);
    expect([...(when?.gaps[0]?.anchors ?? [])].sort()).toEqual(
      ["entryRule.observationWindow", "entryRule.timing", "entryRule.trigger"].sort(),
    );
  });

  it("观察窗口只填一半 → 落点是窗口本身（不是时点 / 触发）", () => {
    const drafts = toSketchDrafts({
      entryRule: { event: "FIRST_LIMIT_UP", extra: { observationWindow: { start: 1 } } },
    });
    const item = validateSketchDrafts(drafts).gapDetails.find(
      (entry) => entry.segment === "when" && entry.label.includes("观察窗口"),
    );
    expect(item?.anchors).toEqual(["entryRule.observationWindow"]);
  });

  it("🔴 回归：窗口 / 触发 / 买入条件都填了、只缺「入场时点」时，缺口必须指名道姓", () => {
    // fixture 复刻真实库 `research_strategy_candidate` 里那一行 `entryRuleJson`：
    //   {"event":"FIRST_LIMIT_UP","extra":{"observationWindow":{1,4,"TRADING_DAY"},
    //    "trigger":"NEXT_TRADING_DAY", …}}   —— **没有 `timing` 键**。
    // 当时用户把段里看得见的东西都填完了，徽标却一直停在「还差 1 项」而无法推进：
    // 编辑器只显示**数量**，从不显示那 1 项是「入场时点」。
    const stuck = toSketchDrafts({
      entryRule: {
        event: "FIRST_LIMIT_UP",
        extra: { observationWindow: { start: 1, end: 4, unit: "TRADING_DAY" }, trigger: "NEXT_TRADING_DAY" },
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
    });

    const { errors, warnings, gapDetails } = validateSketchDrafts(stuck);
    // 内容完全合法（能保存），所以这里的「差一项」纯粹是**转正必填**没填。
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);

    const whenGaps = gapDetails.filter((item) => item.segment === "when");
    expect(whenGaps).toHaveLength(1);
    expect(whenGaps[0]?.label).toContain("入场时点");
    expect(whenGaps[0]?.anchors).toEqual(["entryRule.timing"]);

    // 段状态能把这「1 项」说到具体名字 —— 编辑器据此渲染清单并给那个下拉套琥珀圈。
    const when = sketchSegmentStatuses(stuck).find((status) => status.segment === "when");
    expect(when?.gapCount).toBe(1);
    expect(when?.gaps[0]?.label).toContain("入场时点");
    expect(when?.gaps[0]?.anchors).toContain("entryRule.timing");

    // 补上入场时点 ⇒ 该段归零（证明卡住的就是这一项，不是别的）。
    if (stuck.entryRule.kind !== "structured") throw new Error("fixture 期望 entryRule 可结构化");
    const fixed = {
      ...stuck,
      entryRule: {
        kind: "structured" as const,
        draft: { ...stuck.entryRule.draft, timing: "NEXT_OPEN" },
      },
    };
    expect(validateSketchDrafts(fixed).gapDetails.filter((item) => item.segment === "when")).toEqual([]);
    expect(validateSketchDrafts(fixed).errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ③.6 入场时点 / 触发时点：取值语义，以及「选了必然被拒」的陷阱
// ---------------------------------------------------------------------------

describe("入场时点 / 触发时点：取值语义与「选了必然被拒」的陷阱", () => {
  it("🔴 `SAME_CLOSE` 的自相矛盾是**服务端事实**，不是前端的判断", () => {
    // 断言的正是「陷阱的前提」：它映射出的三元组是同 bar 成交
    // （`signalTiming = T_CLOSE` 且 `executionTiming = T_CLOSE`），
    // 而 `definitionValidation.ts:710-715` 的 L6 明确拒绝这一组合。
    // ⇒ 服务端一旦修好映射表（或改 L6），**这条先红**，届时前端就该把置灰撤掉。
    const sameClose = ENTRY_TIMING_TO_EXECUTION.SAME_CLOSE;
    expect(sameClose).toBeDefined();
    expect(sameClose.signalTiming).toBe("T_CLOSE");
    expect(sameClose.executionTiming).toBe("T_CLOSE");
  });

  it("该取值仍留在表里（对表哨兵不被关掉），但置灰并写明原因", () => {
    const option = CANDIDATE_ENTRY_TIMING_OPTIONS.find((o) => o.value === "SAME_CLOSE");
    expect(option).toBeDefined();
    expect(option?.disabled).toBe(true);
    expect(option?.note ?? "").toContain("SIGNAL_EXECUTION_TIMING_CONFLICT");
    // 置灰是很重的手段，不能被随手滥用：整张表里只允许这一个。
    expect(
      CANDIDATE_ENTRY_TIMING_OPTIONS.filter((o) => o.disabled === true).map((o) => o.value),
    ).toEqual(["SAME_CLOSE"]);
  });

  it("其余入场时点都不置灰，且映射出的三元组自洽（成交不早于信号）", () => {
    for (const option of CANDIDATE_ENTRY_TIMING_OPTIONS) {
      if (option.disabled === true) continue;
      const triple = ENTRY_TIMING_TO_EXECUTION[option.value];
      expect(triple).toBeDefined();
      expect(triple.signalTiming === "T_CLOSE" && triple.executionTiming === "T_CLOSE").toBe(false);
    }
  });

  it("触发时点的四条说明 ≡ 服务端 `resolveSignalTimeline` 的真实行为（不是我自己的解释）", () => {
    // 「首个有效日」= 窗口内第一个满足条件的 bar；「次一交易日」= 再顺延一天 …… 见
    // `strategySchema/definition.ts:333-336`。这里用它的真实返回值把 note 的措辞钉住。
    const expected: Record<string, number> = {
      FIRST_VALID_DAY: 1, // 第一个满足条件的 bar
      EVERY_VALID_DAY: 1, // 每个满足条件的 bar（最早与「第一个」相同）
      LAST_VALID_DAY: 5, // 窗口内最后一个满足条件的 bar
      NEXT_TRADING_DAY: 2, // 再顺延一个交易日
    };
    expect(CANDIDATE_TRIGGER_OPTIONS.map((o) => o.value).sort()).toEqual(Object.keys(expected).sort());
    for (const option of CANDIDATE_TRIGGER_OPTIONS) {
      expect(option.note ?? "").not.toBe("");
      const timeline = resolveSignalTimeline(
        option.value as Parameters<typeof resolveSignalTimeline>[0],
        { start: 1, end: 5, unit: "TRADING_DAY" },
      );
      expect(timeline.resolvable).toBe(true);
      expect(timeline.earliestSignalOffset).toBe(expected[option.value]);
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 「买入条件」：语义纠正 + 字段引用双向构造 + 常用模板 + OR 警告
// ---------------------------------------------------------------------------

/** 一行条件的 fixture（`filterRule` 用的是 Research 条件集形态）。 */
function conditionRow(
  fieldName: string,
  operator: string,
  value: string | readonly string[],
  logicalOperator: "AND" | "OR" | "NOT" = "AND",
) {
  return {
    groupNo: 0,
    sortOrder: 0,
    fieldName,
    operator,
    value,
    logicalOperator,
    groupLogicalOperator: "AND",
  };
}

describe("买入条件（filterRule）：语义是「满足才买」，不是「剔除」", () => {
  it("🔴 归属段是 when（什么价买），不是 what（买什么）；标签也必须说人话", () => {
    // 依据：`definitionBuild.ts:506-508` 把 filterRule 唯一地送进 `entry.conditions`，
    // 而那是「全部满足才产生买入信号」。
    expect(SKETCH_BLOCK_HOME_SEGMENT.filterRule).toBe("when");
    expect(sketchSegmentBlocks("when")).toContain("filterRule");
    expect(sketchSegmentBlocks("what")).not.toContain("filterRule");
    // 「过滤条件 / 剔除条件」都会让用户把条件方向写反（写成 NOT 才买）。
    expect(SKETCH_BLOCK_LABELS.filterRule).toBe("买入条件");
  });

  it("条件整句是人话：字段翻中文，比较值不是引用则原样显示（不编造）", () => {
    expect(describeCandidateCondition("bar.close", "<=", "prefix.rd0.close")).toBe(
      "观察窗口内当天的收盘价 小于等于 事件日当天（rd0）的收盘价",
    );
    expect(describeCandidateCondition("bar.volume", "<", "prefix.rd0.volume")).toBe(
      "观察窗口内当天的成交量 小于 事件日当天（rd0）的成交量",
    );
    expect(describeCandidateCondition("event.turnover", ">=", "5")).toBe("事件日的换手率 大于等于 5");
    expect(describeCandidateCondition("bar.low", ">=", " ")).toBe(
      "观察窗口内当天的最低价 大于等于 （比较值还没填）",
    );
  });

  it("条件组摘要照实翻逻辑连接符（OR 用的是草稿原意，由别处警告兜底）", () => {
    const drafts = toSketchDrafts({
      filterRule: {
        groups: [
          {
            groupNo: 0,
            groupLogicalOperator: "AND",
            conditions: [
              conditionRow("bar.low", ">=", "prefix.rd0.open"),
              conditionRow("bar.volume", "<", "prefix.rd0.volume", "OR"),
            ],
          },
        ],
      },
    });
    if (drafts.filterRule.kind !== "structured") throw new Error("fixture 期望 filterRule 可结构化");
    expect(describeFilterGroups(drafts.filterRule.draft)).toBe(
      "观察窗口内当天的最低价 大于等于 事件日当天（rd0）的开盘价"
        + " 或 观察窗口内当天的成交量 小于 事件日当天（rd0）的成交量",
    );
  });

  it("🔴 OR / NOT 会被转正静默压成 AND —— 必须给出警告，但不阻断保存", () => {
    const drafts = toSketchDrafts({
      filterRule: {
        groups: [
          {
            groupNo: 0,
            groupLogicalOperator: "AND",
            conditions: [
              conditionRow("bar.low", ">=", "prefix.rd0.open"),
              conditionRow("bar.close", "<", "prefix.rd0.close", "OR"),
            ],
          },
        ],
      },
    });
    if (drafts.filterRule.kind !== "structured") throw new Error("fixture 期望 filterRule 可结构化");
    expect(conditionsUseNonConjunction(drafts.filterRule.draft)).toBe(true);
    const result = validateSketchDrafts(drafts);
    // 警告 ≠ 错误：草稿合法、转正也会通过，只是含义会变。
    expect(result.errors).toEqual([]);
    expect(result.warnings.join()).toContain("或");
    expect(result.warnings.join()).toContain("当成「且」");
  });

  it("只用「并且」时不给警告（避免狼来了；整套 fixture 的 warnings 必须为空）", () => {
    expect(validateSketchDrafts(toSketchDrafts(FULL_SKETCH)).warnings).toEqual([]);
  });

  it("条件段落空 = 出现事件即视为满足，但**不是**转正缺口（entry.conditions 可为空数组）", () => {
    const drafts = toSketchDrafts(FULL_SKETCH);
    const withoutFilter = { ...drafts, filterRule: { kind: "empty" } as const };
    const result = validateSketchDrafts(withoutFilter);
    expect(result.gapDetails.some((item) => item.segment === "when" && item.label.includes("买入条件"))).toBe(false);
    expect(summarizeSketchSegment(drafts, "when")).toContain("买入条件：");
  });
});

describe("字段引用的双向构造（把手写 `prefix.rd0.close` 换成三格选择）", () => {
  it("build → parse 回到同一组输入（四个部位全覆盖）", () => {
    for (const root of CANDIDATE_FIELD_ROOT_OPTIONS) {
      const day = root.takesRelativeDay ? (root.dayDefault ?? "1") : "";
      const field = root.kind === "eventDay" ? "turnover" : "close";
      const reference = buildCandidateFieldReference(root.kind, day, field);
      expect(splitCandidateFieldReference(reference)).toEqual({ kind: root.kind, relativeDay: day, field });
      // 与服务端解析器同口径（逐例；详细比对另有一组 18 例对表）。
      expect(parseCandidateFieldReference(reference).kind).toBe(parseStrategyFieldReference(reference).kind);
    }
  });

  it("相对日留空 → 用该部位默认日（prefix 用 0、post 用 1），绝不拼出半成品", () => {
    expect(buildCandidateFieldReference("preEvent", "", "close")).toBe("prefix.rd0.close");
    expect(buildCandidateFieldReference("forwardBar", "", "high")).toBe("post.rd1.high");
    expect(buildCandidateFieldReference("currentBar", "9", "low")).toBe("bar.low");
    // 字段没选 ⇒ 空串（界面据此显示「还没选字段」），而不是拼出一个假引用。
    expect(buildCandidateFieldReference("preEvent", "0", "  ")).toBe("");
    expect(buildCandidateFieldReference("不存在的部位", "0", "close")).toBe("");
    // 不可解析的既有值 ⇒ `null`（界面退回自由文本，**不重建**、因此不会冲掉原值）。
    expect(splitCandidateFieldReference("turnover")).toBeNull();
  });

  it("四个部位恰好覆盖服务端解析器的四个具名分支（不含 labelOnly / unknown）", () => {
    expect(CANDIDATE_FIELD_ROOT_OPTIONS.map((o) => o.kind).sort()).toEqual(
      ["currentBar", "eventDay", "forwardBar", "preEvent"],
    );
    // 字段下拉的值集 ≡ 服务端白名单（逐字；不是「常见写法」）。
    expect(CANDIDATE_BAR_FIELD_CHOICES.map((o) => o.value)).toEqual([...STRATEGY_BAR_FIELDS]);
    expect(CANDIDATE_EVENT_FIELD_CHOICES.map((o) => o.value)).toEqual([...STRATEGY_EVENT_FIELDS]);
    expect(CANDIDATE_BAR_FIELD_CHOICES.map((o) => o.value)).toEqual([...CANDIDATE_BAR_FIELD_OPTIONS]);
    expect(candidateFieldChoicesOf("eventDay")).toBe(CANDIDATE_EVENT_FIELD_CHOICES);
    expect(candidateFieldChoicesOf("currentBar")).toBe(CANDIDATE_BAR_FIELD_CHOICES);
  });

  it("右值类型词表 ≡ 服务端 STRATEGY_CONDITION_VALUE_TYPES（逐字）", () => {
    expect(CANDIDATE_CONDITION_VALUE_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      ...STRATEGY_CONDITION_VALUE_TYPES,
    ]);
  });
});

describe("常用买入条件模板", () => {
  it("🔴 前两条与后端 golden sample 的「首板回踩」逐字一致（不是我自己编的口径）", () => {
    const byId = new Map(CANDIDATE_CONDITION_PRESETS.map((preset) => [preset.id, preset]));
    expect(byId.get("pullback-not-break-event-open")).toMatchObject({
      field: "bar.low",
      operator: ">=",
      value: "prefix.rd0.open",
    });
    expect(byId.get("pullback-volume-shrink")).toMatchObject({
      field: "bar.volume",
      operator: "<",
      value: "prefix.rd0.volume",
    });
  });

  it("每个模板都是「合法引用 + 转正支持的运算符 + 无前视 + 有说明」", () => {
    for (const preset of CANDIDATE_CONDITION_PRESETS) {
      expect(parseCandidateFieldReference(preset.field).kind).not.toBe("unknown");
      expect(CANDIDATE_CONDITION_OPERATOR_OPTIONS.map((o) => o.value)).toContain(preset.operator);
      // 右值要么是常量，要么是**后视 / 事件日 / 当前 bar** 的引用 —— 绝不能是前视层。
      const parsedValue = parseCandidateFieldReference(preset.value);
      if (parsedValue.kind !== "unknown") {
        expect(["preEvent", "eventDay", "currentBar"]).toContain(parsedValue.kind);
      }
      expect(preset.description.trim()).not.toBe("");
      expect(preset.name.trim()).not.toBe("");
    }
  });

  it("⚠️ 不提供「回撤 X%」模板，且所有模板的右值都不含算式（词表里根本没有运算符）", () => {
    // 依据：`ConditionDefinition.value` 只有 CONSTANT / FIELD_REFERENCE / PARAMETER_REFERENCE，
    // 没有表达式 ⇒ `prefix.rd0.close * (1 - x)` 写不出来。宁可少给选项，也不给一个转正必被拒的。
    expect(CANDIDATE_CONDITION_PRESETS.map((p) => p.name).join(" ")).not.toMatch(/\d+\s*%/);
    for (const preset of CANDIDATE_CONDITION_PRESETS) {
      expect(preset.value).not.toMatch(/[*/+]|(?:^|\D)-\d/);
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 成本预设（复用仓库既有口径 + 本机记忆的纯函数部分）
// ---------------------------------------------------------------------------

describe("成本预设", () => {
  it("A 股标准 = 仓库既有数字（与 strategyAdapter 兜底值 / StrategyEditor 模板同源，不另立第二套）", () => {
    expect(A_SHARE_COST_PRESET.values).toEqual({
      initialCapital: "100000",
      maxPositions: "",
      commissionRate: "0.0003",
      stampDutyRate: "0.001",
      transferFeeRate: "0.00001",
      slippageBps: "10",
      lotSize: "100",
      minCommission: "5",
    });
    // 预设**恰好**只管成本七项 —— 不含 maxPositions（那是另一个概念，不能被套用顺手清掉）。
    expect([...COST_ASSUMPTION_FIELDS]).toEqual([
      "initialCapital",
      "commissionRate",
      "stampDutyRate",
      "transferFeeRate",
      "slippageBps",
      "lotSize",
      "minCommission",
    ]);
    expect(COST_ASSUMPTION_FIELDS).not.toContain("maxPositions");
  });

  it("比例渲染成 A 股读法：千 / 万 优先，顺序不能反（0.001 是「千1」不是「万10」）", () => {
    expect(formatCostRate("0.001")).toBe("千1");
    expect(formatCostRate("0.0015")).toBe("千1.5");
    expect(formatCostRate("0.0003")).toBe("万3");
    expect(formatCostRate("0.00025")).toBe("万2.5");
    expect(formatCostRate("0.00001")).toBe("万0.1");
    expect(formatCostRate("")).toBe("");
  });

  it("金额渲染：整万写「N 万」，非整万加千分位", () => {
    expect(formatCapital("100000")).toBe("10 万");
    expect(formatCapital("1000000")).toBe("100 万");
    expect(formatCapital("150000")).toBe("15 万");
    expect(formatCapital("123456")).toBe("123,456");
  });

  it("套用只覆盖七项，绝不动 maxPositions", () => {
    const current = { ...A_SHARE_COST_PRESET.values, maxPositions: "8", slippageBps: "3" };
    const applied = applyCostPreset(current, A_SHARE_COST_PRESET);
    expect(applied.maxPositions).toBe("8");
    expect(applied.slippageBps).toBe("10");
    expect(isCostAssumptionComplete(applied)).toBe(true);
  });

  it("matchCostPreset 不把「看起来齐了但不是同一套」误判成命中", () => {
    expect(matchCostPreset(A_SHARE_COST_PRESET.values)?.id).toBe("a-share-standard");
    // 只差滑点一项 —— 这是自定义，不能报「已套用 A 股标准」。
    expect(matchCostPreset({ ...A_SHARE_COST_PRESET.values, slippageBps: "5" })).toBeNull();
    // 数字写法不同但数值相同 ⇒ 仍算命中（比较是数值语义，不是字符串）。
    expect(matchCostPreset({ ...A_SHARE_COST_PRESET.values, commissionRate: "3e-4" })?.id).toBe(
      "a-share-standard",
    );
    expect(isCostAssumptionComplete({ ...A_SHARE_COST_PRESET.values, minCommission: "" })).toBe(false);
  });

  it("描述串覆盖七项（供折叠态与按钮副标题共用）", () => {
    const text = describeCostPreset(A_SHARE_COST_PRESET);
    expect(text).toContain("本金 10 万");
    expect(text).toContain("佣金 万3");
    expect(text).toContain("印花税 千1");
    expect(text).toContain("100 股/手");
    expect(text).toContain("最低 5 元");
  });
});
