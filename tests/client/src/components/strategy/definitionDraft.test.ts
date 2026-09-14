/**
 * `definitionDraft.ts`（定义编辑器的纯函数核心）行为锁。
 *
 * 这是**本轮交付的主证据**：本机 `agent-browser` 不可用、仓库也没有 `jsdom` ⇒
 * 「编辑器渲染成什么样」无法靠渲染测试证明。但**编辑器的全部业务逻辑都是纯函数**，
 * 所以真正会出错的那部分（形状识别 / 往返保真 / 校验口径 / 缺口锚点）可以逐条断言。
 *
 * 四组断言，各防一类**静默失效**：
 *   ① 与草图**逐段对齐** —— 用户本次明确要求「各种规则跟研究实验里的策略候选草图对齐」。
 *      锁的是 key 顺序 + 标题逐字 + 必填性；`hint` **故意不锁**（见该段注释）。
 *   ② **往返保真** —— 拿真实 golden sample 走 `definition → 草稿 → definition`，
 *      必须**深等于**原对象（含 `id` / `description` / `unit` / `note` 这些表单不编辑的键）。
 *      这条是「编辑一次就悄悄丢一个键」这类事故的唯一防线。
 *   ③ **降级纪律** —— 形状不符时必须整份降级为只读并说明原因，不得猜着解析半份。
 *   ④ **缺口 ↔ 输入框** —— 清单说「缺 A」，界面上 A 就必须真的亮起来。
 *      本轮之前没有锚点层，这一段只能靠人肉眼比对，所以专门补了「扫源码」的锁。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FIRST_BOARD_PULLBACK_DEFINITION,
  FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
} from "../../../../../server/research/strategySchema/goldenSample";
import {
  SKETCH_SEGMENTS,
  SKETCH_SEGMENT_KEYS,
  SKETCH_SEGMENT_REQUIRED,
} from "@/components/research/candidateSketchForm";
import {
  DEFINITION_GAP_ANCHORS,
  DEFINITION_SEGMENTS,
  DEFINITION_SEGMENT_KEYS,
  backtestConfigFromDrafts,
  costModelFromDrafts,
  definitionGapAnchors,
  definitionSegmentStatuses,
  definitionToDrafts,
  draftsToDefinition,
  emptyConditionRow,
  emptyExitRuleRow,
  emptyParameterRow,
  resolveEarliestSignalOffset,
  syncPrimaryDatasetBinding,
  uneditedKeysOf,
  validateDefinitionDrafts,
  withDocumentLevelDrafts,
  type DefinitionDrafts,
  type ParameterRowDraft,
} from "@/components/strategy/definitionDraft";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const STRATEGY_DIR = path.join(ROOT, "client/src/components/strategy");

// ---------------------------------------------------------------------------
// 取草稿的小工具
// ---------------------------------------------------------------------------

function structuredDrafts(definition: unknown): DefinitionDrafts {
  const state = definitionToDrafts(definition);
  if (state.kind !== "structured") {
    throw new Error(`期望 structured，实际是 raw：${state.reason}`);
  }
  return state.drafts;
}

/** 一个「什么都没填」的草稿：从空定义推出来，保证字段完整性由被测代码自己负责。 */
function blankDrafts(): DefinitionDrafts {
  return structuredDrafts({ entry: {} });
}

/** 把 golden sample 的文档级成本 / 回测配置也灌进去（成本不在 definition 里）。 */
function goldenDrafts(): DefinitionDrafts {
  const state = withDocumentLevelDrafts(
    definitionToDrafts(FIRST_BOARD_PULLBACK_DEFINITION),
    FIRST_BOARD_PULLBACK_DOCUMENT_INPUT.executionAssumptions,
  );
  if (state.kind !== "structured") throw new Error("golden sample 应当可以被结构化编辑");
  return state.drafts;
}

/** 一行参数（默认取空行工厂，再按需覆盖）。 */
function parameterRow(
  overrides: Partial<ParameterRowDraft> & { original?: Record<string, unknown> },
): ParameterRowDraft {
  return { ...emptyParameterRow(), ...overrides };
}

// ---------------------------------------------------------------------------
// ① 与研究草图逐段对齐（用户本次要求的那一条）
// ---------------------------------------------------------------------------

describe("① 定义七段 ↔ 研究草图七段：对齐是被测试锁住的，不是「看起来像」", () => {
  it("1) 段的 key **逐位相同**（同序）——顺序是用户看到的填写路径，不能各排各的", () => {
    expect(DEFINITION_SEGMENT_KEYS).toEqual(SKETCH_SEGMENT_KEYS);
    expect(DEFINITION_SEGMENT_KEYS.length).toBe(7);
  });

  it("2) 每段标题**逐字相同**", () => {
    for (const segment of SKETCH_SEGMENTS) {
      const mine = DEFINITION_SEGMENTS.find((s) => s.key === segment.key);
      expect(mine, `定义侧缺了 ${segment.key} 段`).toBeDefined();
      expect(mine?.title, `段 ${segment.key} 的标题两边不一致`).toBe(segment.title);
    }
  });

  it("3) 每段必填性**逐段相同**（决定徽标是「还差 N 项」还是「可选」）", () => {
    for (const segment of DEFINITION_SEGMENTS) {
      expect(
        segment.required,
        `段 ${segment.key} 的必填性两边不一致`,
      ).toBe(SKETCH_SEGMENT_REQUIRED[segment.key]);
    }
  });

  it("4) `hint` 只要求非空，**不要求逐字相同** —— 两边的说明本来就在讲不同的事", () => {
    // 例：草图 `condition` 段说的是「留空 = 出现事件就买」（候选语义），
    // 定义侧说的是「留空 = 产生买入信号」（执行语义）。强行对齐会让其中一边说错话。
    // 所以这里只拦「有人把 hint 清空了」这一种退化。
    for (const segment of DEFINITION_SEGMENTS) {
      expect(segment.hint.trim(), `段 ${segment.key} 的说明不能为空`).not.toBe("");
    }
    for (const segment of SKETCH_SEGMENTS) {
      expect(segment.hint.trim(), `草图段 ${segment.key} 的说明不能为空`).not.toBe("");
    }
  });

  it("5) 段状态是**穷尽**的：七段每段都有一条状态，且带得出标题 / 必填性 / 摘要", () => {
    const statuses = definitionSegmentStatuses(goldenDrafts());
    expect(statuses.map((s) => s.segment)).toEqual([...DEFINITION_SEGMENT_KEYS]);
    for (const status of statuses) {
      expect(status.title).toBe(DEFINITION_SEGMENTS.find((s) => s.key === status.segment)?.title);
      expect(typeof status.summary).toBe("string");
      expect(status.gapCount).toBe(status.gaps.length);
    }
  });
});

// ---------------------------------------------------------------------------
// ② 往返保真
// ---------------------------------------------------------------------------

describe("② definition → 草稿 → definition：真实 golden sample 必须逐字往返", () => {
  it("6) 🔴 往返**深等于**原对象（含表单不编辑的 id / description / unit / note）", () => {
    const rebuilt = draftsToDefinition(structuredDrafts(FIRST_BOARD_PULLBACK_DEFINITION));
    expect(rebuilt).toEqual(FIRST_BOARD_PULLBACK_DEFINITION);
  });

  it("7) 再走一圈**幂等** —— 防「每保存一次就漂一点」", () => {
    const once = draftsToDefinition(structuredDrafts(FIRST_BOARD_PULLBACK_DEFINITION));
    const twice = draftsToDefinition(structuredDrafts(once));
    expect(twice).toEqual(once);
  });

  it("8) 往返后仍在意的键确实还在（不靠 toEqual 一条断言糊过去）", () => {
    const rebuilt = draftsToDefinition(structuredDrafts(FIRST_BOARD_PULLBACK_DEFINITION));
    // 条件行的 `id` / `description` 属本次不编辑的键 ⇒ 必须原样穿过。
    const conditions = (rebuilt.entry as Record<string, unknown>).conditions as Record<string, unknown>[];
    expect(conditions[0]?.id).toBe("pullback-not-break-event-open");
    expect(conditions[0]?.description).toContain("不破首板实体下沿");
    // 出场规则的 `parameter`（不编辑）与 `description` 同理。
    const rules = (rebuilt.exit as Record<string, unknown>).rules as Record<string, unknown>[];
    expect(rules.map((r) => r.parameter)).toEqual(["holdingDays", "stopLoss", "takeProfit"]);
    // 数据集绑定的 `note` 不因为「界面上没显示」而丢。
    const datasets = rebuilt.datasets as Record<string, unknown>[];
    expect(datasets[0]?.note).toContain("首板回踩事件窗口数据集");
    // 参数行的 `unit` 也是不编辑的键。
    const parameters = rebuilt.parameters as Record<string, unknown>[];
    expect(parameters[0]?.unit).toBe("TRADING_DAY");
  });

  it("9) 文档级成本 / 回测配置同样往返（它们不在 definition 里，是独立一段）", () => {
    const drafts = goldenDrafts();
    const assumptions = FIRST_BOARD_PULLBACK_DOCUMENT_INPUT.executionAssumptions;
    expect(costModelFromDrafts(drafts)).toEqual(assumptions.costModel);
    expect(backtestConfigFromDrafts(drafts)).toEqual(assumptions.backtestConfig);
  });

  it("10) 表单不编辑的键会被**列出**（而不是悄悄保留）", () => {
    // golden 里的条件行带 `id` / `description`，出场规则带 `id` / `description` / `parameter`
    // ⇒ 提示区应当把它们说出来，用户才知道「有些键不在这里改」。
    const listed = uneditedKeysOf(structuredDrafts(FIRST_BOARD_PULLBACK_DEFINITION));
    expect(listed).toContain("entry.conditions.id");
    expect(listed).toContain("entry.conditions.description");
    expect(listed).toContain("exit.rules.parameter");
  });

  it("11) 无法表达的值 ⇒ 该区降级只读 + 出 warning，但**不丢键**", () => {
    const state = definitionToDrafts({
      entry: { event: { type: "FIRST_LIMIT_UP", params: { nested: { a: 1 } } } },
    });
    expect(state.kind).toBe("structured");
    if (state.kind !== "structured") return;
    expect(state.drafts.event.paramsExpressible).toBe(false);
    expect(state.drafts.event.params).toEqual([]);
    const { warnings } = validateDefinitionDrafts(state.drafts);
    expect(warnings.some((w) => w.includes("原样保留"))).toBe(true);
    // 关键：`original` 仍握有原值 ⇒ 重建时不会把它抹掉。
    expect(draftsToDefinition(state.drafts).entry).toMatchObject({
      event: { params: { nested: { a: 1 } } },
    });
  });
});

// ---------------------------------------------------------------------------
// ③ 降级纪律
// ---------------------------------------------------------------------------

describe("③ 形状不符 ⇒ 整份降级只读（绝不猜着解析半份）", () => {
  const cases: ReadonlyArray<readonly [string, unknown, string]> = [
    ["undefined", undefined, "没有 Canonical 定义"],
    ["null", null, "没有 Canonical 定义"],
    ["不是对象", "1.0", "definition 不是对象"],
    ["entry 不是对象", { schemaVersion: "1.0", entry: 3 }, "entry 不是对象"],
    ["conditions 不是数组", { entry: { conditions: { a: 1 } } }, "conditions 不是数组"],
    ["exit 不是对象", { entry: {}, exit: 5 }, "exit 不是对象"],
    ["exit.rules 不是数组", { entry: {}, exit: { rules: 7 } }, "exit.rules 不是数组"],
    ["parameters 不是数组", { entry: {}, parameters: "x" }, "parameters 不是数组"],
  ];

  it.each(cases)("12) %s ⇒ raw，且原因里说得出是哪一处", (_name, input, fragment) => {
    const state = definitionToDrafts(input);
    expect(state.kind).toBe("raw");
    if (state.kind !== "raw") return;
    expect(state.reason).toContain(fragment);
  });

  it("13) 合法但几乎全空的定义 ⇒ 仍是 structured（不误判成 raw）", () => {
    const state = definitionToDrafts({ entry: {} });
    expect(state.kind).toBe("structured");
  });

  it("14) raw 态带上原文，界面才有东西可展示", () => {
    const state = definitionToDrafts({ entry: { conditions: 1 } });
    expect(state.kind).toBe("raw");
    if (state.kind !== "raw") return;
    expect(state.rawText).toContain("conditions");
  });
});

// ---------------------------------------------------------------------------
// ④ 缺口 ↔ 输入框
// ---------------------------------------------------------------------------

describe("④ 缺口锚点：清单说缺哪一项，界面上那一格就必须亮", () => {
  const ALL_ANCHORS = [
    "event.type",
    "window",
    "trigger",
    "position.sizingMethod",
    "position.maxPositions",
    "risk.maxPositions",
    "execution.quantityMethod",
    "execution.lotSize",
    "execution.signalTiming",
    "execution.executionTiming",
    "execution.priceType",
    "cost.initialCapital",
    "cost.rates",
  ] as const;

  it("15) 锚点词表是**闭集**：新增锚点必须同时加进测试，否则这里先红", () => {
    const used = [...new Set(Object.values(DEFINITION_GAP_ANCHORS).flat())].sort();
    expect(used).toEqual([...ALL_ANCHORS].sort());
  });

  it("16) 每条静态文案都查得到锚点；未知文案回空数组（渲染层退化成只亮清单）", () => {
    for (const label of Object.keys(DEFINITION_GAP_ANCHORS)) {
      expect(definitionGapAnchors(label).length, `文案「${label}」查不到锚点`).toBeGreaterThan(0);
    }
    expect(definitionGapAnchors("完全没见过的文案")).toEqual([]);
  });

  it("17) 「成本假设还差：…」是**动态**文案 ⇒ 靠前缀回落命中", () => {
    expect(definitionGapAnchors("成本假设还差：stampDutyRate / minCommission")).toEqual(["cost.rates"]);
  });

  it("18) 🔴 校验器实跑产出的**每一条** gap 都能查到锚点（改文案不改这里 ⇒ 这里红）", () => {
    const blank = blankDrafts();
    const partialCost = { ...blank, cost: { ...blank.cost, commissionRate: "0.00025" } };
    const collected = [...validateDefinitionDrafts(blank).gaps, ...validateDefinitionDrafts(partialCost).gaps];
    expect(collected.length).toBeGreaterThanOrEqual(13);
    for (const gap of collected) {
      expect(
        definitionGapAnchors(gap.label).length,
        `段 ${gap.segment} 的缺口「${gap.label}」没有界面落点`,
      ).toBeGreaterThan(0);
    }
    // 空白草稿必须把七段里所有必填项都报出来（少报一条 = 用户以为填完了）。
    const segments = new Set(validateDefinitionDrafts(blank).gaps.map((g) => g.segment));
    expect([...segments].sort()).toEqual(["cost", "sizing", "what", "when"]);
  });

  it("19) 🔴 锚点必须落到**真实输入框**（扫源码：每个锚点都要有 missingAt 调用点）", () => {
    const source = readFileSync(path.join(STRATEGY_DIR, "DefinitionFields.tsx"), "utf8");
    const flat = source.replace(/\s+/g, "");
    // 用「空白草稿 + 半填成本」跑出来的缺口去推「应当存在的 (段, 锚点) 组合」，
    // 而不是手抄一份清单 —— 这样测试与校验器同源。
    const statuses = definitionSegmentStatuses(blankDrafts());
    const pairs = new Set<string>();
    for (const status of statuses) {
      for (const gap of status.gaps) {
        for (const anchor of gap.anchors) pairs.add(`${status.segment}|${anchor}`);
      }
    }
    expect(pairs.size).toBeGreaterThanOrEqual(13);
    for (const pair of [...pairs].sort()) {
      const [segment, anchor] = pair.split("|") as [string, string];
      expect(
        flat.includes(`missingAt("${segment}","${anchor}")`),
        `缺口锚点 ${segment}/${anchor} 在 DefinitionFields.tsx 里没有任何输入框接住它`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑤ 校验口径（后端硬约束的本地预检）
// ---------------------------------------------------------------------------

describe("⑤ 校验：把「必然被后端拒」的组合提前说出来", () => {
  it("20) 空的必填项算 gap 而不是 error（本地不拦用户存草稿）", () => {
    const { errors } = validateDefinitionDrafts(blankDrafts());
    expect(errors).toEqual([]);
  });

  it("21) 🔴 出场优先级重复 ⇒ error（后端 SCHEMA_DEFINITION_EXIT_RULE_PRIORITY_DUPLICATE）", () => {
    const drafts = blankDrafts();
    const first = { ...emptyExitRuleRow(1), type: "TIME_EXIT", trigger: "ON_CLOSE", threshold: "3", thresholdUnit: "TRADING_DAY" };
    const second = { ...emptyExitRuleRow(1), type: "TAKE_PROFIT", trigger: "ON_CLOSE", threshold: "0.15", thresholdUnit: "RATIO" };
    const { errors } = validateDefinitionDrafts({ ...drafts, exitRules: [first, second] });
    expect(errors.some((e) => e.includes("优先级 1 与前面的规则重复"))).toBe(true);
  });

  it("22) 空行工厂给的优先级是**结构性初值**，第二条不会自动撞上第一条", () => {
    expect(emptyExitRuleRow(0).priority).toBe("0");
    expect(emptyExitRuleRow(3).priority).toBe("3");
  });

  it("23) 🔴 出场规则三者（threshold / parameter / condition）一个都不给 ⇒ error", () => {
    const drafts = blankDrafts();
    const row = { ...emptyExitRuleRow(0), type: "TIME_EXIT", trigger: "ON_CLOSE" };
    const { errors } = validateDefinitionDrafts({ ...drafts, exitRules: [row] });
    expect(errors.some((e) => e.includes("既没有阈值也没有参数/条件"))).toBe(true);
    // 有 parameter（来自不编辑的 original）⇒ 不再报
    const withParameter = { ...row, original: { parameter: "holdingDays" } };
    const again = validateDefinitionDrafts({ ...drafts, exitRules: [withParameter] });
    expect(again.errors.some((e) => e.includes("既没有阈值也没有参数/条件"))).toBe(false);
  });

  it("24) TIME_EXIT 的阈值必须是 ≥1 的整数交易日；按比例表达时必须在 (0,1)", () => {
    const drafts = blankDrafts();
    const base = { ...emptyExitRuleRow(0), trigger: "ON_CLOSE" };
    const timeBad = validateDefinitionDrafts({
      ...drafts,
      exitRules: [{ ...base, type: "TIME_EXIT", threshold: "0.5", thresholdUnit: "TRADING_DAY" }],
    });
    expect(timeBad.errors.some((e) => e.includes("≥ 1 的整数交易日"))).toBe(true);

    const ratioBad = validateDefinitionDrafts({
      ...drafts,
      exitRules: [{ ...base, type: "TAKE_PROFIT", threshold: "5", thresholdUnit: "RATIO" }],
    });
    expect(ratioBad.errors.some((e) => e.includes("必须在 (0,1)"))).toBe(true);
  });

  it("25) 🔴 L6：信号与成交都在 T 日收盘 ⇒ error（后端 SIGNAL_EXECUTION_TIMING_CONFLICT）", () => {
    const drafts = blankDrafts();
    const { errors } = validateDefinitionDrafts({
      ...drafts,
      execution: { ...drafts.execution, signalTiming: "T_CLOSE", executionTiming: "T_CLOSE" },
    });
    expect(errors.some((e) => e.includes("L6"))).toBe(true);
  });

  it("26) 🔴 L7：触发时点是次一交易日 + 同 bar 成交 ⇒ error", () => {
    const drafts = blankDrafts();
    const { errors } = validateDefinitionDrafts({
      ...drafts,
      trigger: { ...drafts.trigger, type: "NEXT_TRADING_DAY" },
      execution: { ...drafts.execution, signalTiming: "T_OPEN", executionTiming: "T_CLOSE" },
    });
    expect(errors.some((e) => e.includes("L7"))).toBe(true);
  });

  it("27) TUNABLE 数值参数必须同时给 min / max；给了就必须 min < max", () => {
    const drafts = blankDrafts();
    const missingBound = validateDefinitionDrafts({
      ...drafts,
      parameters: [parameterRow({ code: "pullbackWindow", parameterRole: "TUNABLE", min: "1" })],
    });
    expect(missingBound.errors.some((e) => e.includes("必须同时给 min 与 max"))).toBe(true);

    const inverted = validateDefinitionDrafts({
      ...drafts,
      parameters: [parameterRow({ code: "pullbackWindow", parameterRole: "TUNABLE", min: "10", max: "1" })],
    });
    expect(inverted.errors.some((e) => e.includes("min 必须小于 max"))).toBe(true);
  });

  it("28) DERIVED 角色必须给 derivedFrom（不编辑的键，只从 original 读）", () => {
    const drafts = blankDrafts();
    const { errors } = validateDefinitionDrafts({
      ...drafts,
      parameters: [parameterRow({ code: "spread", parameterRole: "DERIVED" })],
    });
    expect(errors.some((e) => e.includes("derivedFrom"))).toBe(true);
    // 给了 derivedFrom（写在 original 里）⇒ 不再报
    const ok = validateDefinitionDrafts({
      ...drafts,
      parameters: [
        parameterRow({
          code: "spread",
          parameterRole: "DERIVED",
          original: { code: "spread", parameterRole: "DERIVED", derivedFrom: "takeProfit - stopLoss" },
        }),
      ],
    });
    expect(ok.errors.some((e) => e.includes("derivedFrom"))).toBe(false);
  });

  it("29) 回测并发上限与策略 maxPositions 不一致 ⇒ **warning** 而不是 error（含义不同，不强行统一）", () => {
    const drafts = blankDrafts();
    const { errors, warnings } = validateDefinitionDrafts({
      ...drafts,
      position: { ...drafts.position, maxPositions: "3" },
      cost: { ...drafts.cost, maxPositions: "5" },
    });
    expect(errors.some((e) => e.includes("maxPositions"))).toBe(false);
    expect(warnings.some((w) => w.includes("两者含义不同"))).toBe(true);
  });

  it("30) 条件右值是前视引用且超出可解析偏移 ⇒ 拦下（防「事后筛选冒充信号」）", () => {
    const drafts = blankDrafts();
    const row = { ...emptyConditionRow(), field: "post.rd3.close", value: "10" };
    const { errors } = validateDefinitionDrafts({
      ...drafts,
      window: { ...drafts.window, start: "1", end: "5", unit: "TRADING_DAY" },
      trigger: { ...drafts.trigger, type: "FIRST_VALID_DAY" },
      conditions: [row],
    });
    expect(errors.some((e) => e.includes("Look-Ahead") || e.includes("前视"))).toBe(true);
  });

  it("31) `path.*` / `outcome.*` 是标签层 ⇒ 作买入条件必拒", () => {
    const drafts = blankDrafts();
    const row = { ...emptyConditionRow(), field: "path.rd1.close", value: "10" };
    const { errors } = validateDefinitionDrafts({ ...drafts, conditions: [row] });
    expect(errors.some((e) => e.includes("前视标签层"))).toBe(true);
  });

  it("32) 前视偏移的复刻口径与服务端一致（FIRST/EVERY → 起点；LAST → 终点；NEXT → 起点+1）", () => {
    expect(resolveEarliestSignalOffset("FIRST_VALID_DAY", 1, 5, "TRADING_DAY")).toEqual({ maxOffset: 1, resolvable: true });
    expect(resolveEarliestSignalOffset("EVERY_VALID_DAY", 2, 5, "TRADING_DAY")).toEqual({ maxOffset: 2, resolvable: true });
    expect(resolveEarliestSignalOffset("LAST_VALID_DAY", 1, 5, "TRADING_DAY")).toEqual({ maxOffset: 5, resolvable: true });
    expect(resolveEarliestSignalOffset("NEXT_TRADING_DAY", 1, 5, "TRADING_DAY")).toEqual({ maxOffset: 2, resolvable: true });
    // 自然日窗口映射不到交易日 ⇒ 不可解析（而不是猜一个数）
    expect(resolveEarliestSignalOffset("FIRST_VALID_DAY", 1, 5, "CALENDAR_DAY")).toEqual({ maxOffset: 1, resolvable: false });
    expect(resolveEarliestSignalOffset("WHATEVER", 1, 5, "TRADING_DAY")).toEqual({ maxOffset: null, resolvable: false });
  });
});

// ---------------------------------------------------------------------------
// ⑥ 数据集坐标镜像（保存阻塞项）
// ---------------------------------------------------------------------------

describe("⑥ 基础信息改数据集 ⇒ 必须同步进 definition.datasets 的 PRIMARY 绑定", () => {
  const coordinate = { datasetVersionId: 390002, datasetVersion: "rd-1.0.0-1-deadbeef" };

  it("33) 🔴 改写 PRIMARY 行的坐标，**连 `original` 一起改**（original 才是重建时被放回的）", () => {
    const drafts = structuredDrafts(FIRST_BOARD_PULLBACK_DEFINITION);
    const next = syncPrimaryDatasetBinding(drafts, coordinate);
    expect(next.datasets[0]?.datasetVersionId).toBe("390002");
    expect(next.datasets[0]?.datasetVersion).toBe(coordinate.datasetVersion);
    expect(next.datasets[0]?.original.datasetVersionId).toBe(390002);
    // 非编辑键（note）不受影响
    expect(next.datasets[0]?.original.note).toContain("首板回踩事件窗口数据集");
    // 重建后的定义里坐标也真的变了
    const rebuilt = draftsToDefinition(next);
    expect((rebuilt.datasets as Record<string, unknown>[])[0]?.datasetVersionId).toBe(390002);
  });

  it("34) 不改输入对象（纯函数）", () => {
    const drafts = structuredDrafts(FIRST_BOARD_PULLBACK_DEFINITION);
    const before = JSON.stringify(drafts);
    syncPrimaryDatasetBinding(drafts, coordinate);
    expect(JSON.stringify(drafts)).toBe(before);
  });

  it("35) 坐标为空 / 没有绑定行 ⇒ 原样返回（那种情况下 doc 级坐标必须缺省）", () => {
    const drafts = structuredDrafts(FIRST_BOARD_PULLBACK_DEFINITION);
    expect(syncPrimaryDatasetBinding(drafts, { datasetVersionId: null, datasetVersion: "x" })).toBe(drafts);
    const empty = { ...drafts, datasets: [] };
    expect(syncPrimaryDatasetBinding(empty, coordinate)).toBe(empty);
  });

  it("36) 只碰 PRIMARY 行、不增删行（非 PRIMARY 绑定原样保留）", () => {
    const drafts = structuredDrafts(FIRST_BOARD_PULLBACK_DEFINITION);
    const secondary = {
      original: { datasetId: "ds_other", datasetVersion: "rd-other", role: "REFERENCE" },
      role: "REFERENCE",
      datasetId: "ds_other",
      datasetVersion: "rd-other",
      datasetVersionId: "",
    };
    const withTwo = { ...drafts, datasets: [...drafts.datasets, secondary] };
    const next = syncPrimaryDatasetBinding(withTwo, coordinate);
    expect(next.datasets).toHaveLength(2);
    expect(next.datasets[1]).toEqual(secondary);
  });

  it("37) 没有 PRIMARY 时退化为第 0 行；已是目标坐标时不产生新对象（幂等）", () => {
    const drafts = structuredDrafts(FIRST_BOARD_PULLBACK_DEFINITION);
    const noRole = {
      ...drafts,
      datasets: [{ ...drafts.datasets[0]!, role: "" }],
    };
    const next = syncPrimaryDatasetBinding(noRole, coordinate);
    expect(next.datasets[0]?.datasetVersionId).toBe("390002");
    expect(syncPrimaryDatasetBinding(next, coordinate)).toBe(next);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 跨端边界（铁律：client 不得 import server/shared 的运行时值）
// ---------------------------------------------------------------------------

describe("⑦ 新增的 client 模块不得把服务端模块拉进浏览器包", () => {
  const FILES = [
    "definitionDraft.ts",
    "definitionVocabulary.ts",
    "DefinitionFields.tsx",
    path.join("..", "common", "SegmentForm.tsx"),
  ];

  it("38) 三个新模块里没有任何**非 type** 的 server/shared 导入", () => {
    for (const relative of FILES) {
      const source = readFileSync(path.join(STRATEGY_DIR, relative), "utf8");
      const importFrom = /(^|\n)\s*import\s+([\s\S]*?)\s*from\s+"([^"]+)"/g;
      for (const match of source.matchAll(importFrom)) {
        const clause = match[2] ?? "";
        const specifier = match[3] ?? "";
        const typeOnly = /^\s*type\b/.test(clause);
        const isServerSide = /(^|\/)(server|shared)\//.test(specifier) || specifier.startsWith("@/../../");
        if (isServerSide && !typeOnly) {
          throw new Error(`${relative} 出现非 type 的服务端导入：${specifier}`);
        }
      }
      expect(source.length).toBeGreaterThan(0);
    }
  });

  it("39) 镜像词表必须**在客户端本地**，不得转手导出服务端对象", () => {
    const source = readFileSync(path.join(STRATEGY_DIR, "definitionVocabulary.ts"), "utf8");
    expect(source).not.toMatch(/from\s+"[^"]*server\/[^"]*"/);
  });
});
