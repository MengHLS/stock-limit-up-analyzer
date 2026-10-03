/**
 * ⑤ 派生视图（P3）行为锁。
 *
 * 两条必须钉死的纪律：
 *   ① **同一参数不得两处定义** —— 勾两次只能有一行；取消只删这一行；
 *   ② **死参数不许勾** —— 规则图没引用的候选一律拒绝（否则用户勾完会在参数搜索页吃拒绝，
 *      真实库里已踩过：`cand-360001@1.0.0` 声明 3 个 TUNABLE、规则图引用 0 个）。
 */
import { describe, expect, it } from "vitest";

import { FIRST_BOARD_PULLBACK_DEFINITION } from "../../../../../server/research/strategySchema/goldenSample";
import {
  definitionToDrafts,
  type DefinitionDrafts,
  type ParameterRowDraft,
} from "@/components/strategy/definitionDraft";
import {
  candidateStatusLabel,
  candidateToParameterRow,
  declaredParameterCodes,
  deriveSearchParameterCandidates,
  referencedParameterCodes,
  toggleSearchParameter,
  type SearchParameterCandidate,
  type SelectedPresetParameters,
} from "@/components/strategy/searchParameterCandidates";

function drafts(): DefinitionDrafts {
  const state = definitionToDrafts(FIRST_BOARD_PULLBACK_DEFINITION);
  if (state.kind !== "structured") throw new Error("golden sample 应当可结构化编辑");
  return state.drafts;
}

/** 造一条「条件右值 = 参数引用」的草稿，模拟"参数真的被规则图引用"。 */
function withConditionParameterReference(base: DefinitionDrafts, code: string): DefinitionDrafts {
  return {
    ...base,
    conditions: [
      ...base.conditions,
      {
        original: {},
        field: "bar.low",
        operator: "GREATER_THAN_OR_EQUAL",
        value: code,
        valueType: "PARAMETER_REFERENCE",
        enabled: true,
      },
    ],
  };
}

function withExitRuleParameter(base: DefinitionDrafts, parameter: string): DefinitionDrafts {
  return {
    ...base,
    exitRules: [
      ...base.exitRules,
      {
        original: { parameter },
        type: "SIGNAL_EXIT",
        trigger: "ON_CLOSE",
        threshold: "",
        thresholdUnit: "",
        priority: "9",
        enabled: true,
      },
    ],
  };
}

/** golden sample 自带 TUNABLE 行（holdingDays / positionRatio …）—— 测"新增"时先清空，避免与既有行混在一起。 */
function withoutDeclaredParameters(base: DefinitionDrafts): DefinitionDrafts {
  return { ...base, parameters: [] };
}

const SOURCES: readonly SelectedPresetParameters[] = [
  {
    blockLabel: "② 出场",
    presetDisplayName: "6%止损｜8%回撤保护｜破均线走｜最长20日",
    parameters: [
      { code: "anchor.stopRatio", label: "初始止损比例", valueType: "number", min: 0.005, max: 0.5, step: 0.005, defaultValue: 0.06 },
      { code: "holdingDays", label: "到期持有日", valueType: "number", min: 1, max: 250, step: 1, defaultValue: 5 },
    ],
  },
  {
    blockLabel: "③ 仓位",
    presetDisplayName: "固定比例 20% × 最多 5 只",
    parameters: [
      { code: "positionRatio", label: "单笔比例", valueType: "number", min: 0.01, max: 1, step: 0.01, defaultValue: 0.2 },
    ],
  },
];

describe("referencedParameterCodes（哪个 code 真的被规则图引用）", () => {
  it("1) 只认「参数引用」条件与出场规则的 parameter，别的一律不算", () => {
    const base = drafts();
    expect([...referencedParameterCodes(base)]).not.toContain("bar.low");
    const withCond = withConditionParameterReference(base, "max_volume_ratio");
    expect([...referencedParameterCodes(withCond)]).toContain("max_volume_ratio");
    const withExit = withExitRuleParameter(base, "stop_ratio");
    expect([...referencedParameterCodes(withExit)]).toContain("stop_ratio");
  });

  it("2) 空白引用被忽略（不制造空 code）", () => {
    const blank = withConditionParameterReference(drafts(), "   ");
    expect([...referencedParameterCodes(blank)].every(code => code.trim() !== "")).toBe(true);
  });
});

describe("deriveSearchParameterCandidates（派生，不自造）", () => {
  it("3) 候选 = 各方案参数的并集；同一 code 只出现一次（先出现的赢）", () => {
    const dup: readonly SelectedPresetParameters[] = [
      ...SOURCES,
      { blockLabel: "④ 成本与成交", presetDisplayName: "A 股标准", parameters: [{ code: "holdingDays", label: "到期持有日（重复）", valueType: "number", defaultValue: 10 }] },
    ];
    const list = deriveSearchParameterCandidates(drafts(), dup);
    expect(list.map(c => c.code)).toEqual(["anchor.stopRatio", "holdingDays", "positionRatio"]);
    expect(list[1]?.blockLabel).toBe("② 出场");
  });

  it("4) 三项标记如实：referenced / alreadyDeclared / 来源", () => {
    const base = drafts();
    const withRef = withConditionParameterReference(base, "positionRatio");
    const list = deriveSearchParameterCandidates(withRef, SOURCES);
    // golden sample 的 TIME_EXIT 出场规则带 `parameter: holdingDays` ⇒ 它**已被引用**；
    // 新增的条件参数引用让 positionRatio 也变得可搜；anchor.stopRatio 无人引用。
    expect(list.map(c => c.referenced)).toEqual([false, true, true]);
    // golden sample 本身就声明了 holdingDays / positionRatio ⇒ 这两条已被认领
    expect(list.map(c => c.alreadyDeclared)).toEqual([false, true, true]);
    expect(list[2]?.blockLabel).toBe("③ 仓位");
    expect(list[0]?.presetDisplayName).toContain("止损");
  });

  it("5) 已声明的 code 会被标成 alreadyDeclared（不新增第二处定义）", () => {
    const base = drafts();
    const declared: ParameterRowDraft = { ...candidateToParameterRow({
      code: "holdingDays", label: "到期持有日", dataType: "number", currentValue: 5,
      blockLabel: "② 出场", presetDisplayName: "x", referenced: true, alreadyDeclared: false,
    }) };
    const withRow = { ...base, parameters: [...base.parameters, declared] };
    expect([...declaredParameterCodes(withRow)]).toContain("holdingDays");
    const list = deriveSearchParameterCandidates(withRow, SOURCES);
    expect(list.find(c => c.code === "holdingDays")?.alreadyDeclared).toBe(true);
  });
});

describe("toggleSearchParameter（勾选 / 取消）", () => {
  const candidateOf = (list: readonly SearchParameterCandidate[], code: string): SearchParameterCandidate => {
    const found = list.find(c => c.code === code);
    if (found === undefined) throw new Error(`缺候选 ${code}`);
    return found;
  };

  it("6) ★ 未被规则引用的候选：响亮拒绝，草稿一字不动", () => {
    const base = drafts();
    const result = toggleSearchParameter(base, candidateOf(deriveSearchParameterCandidates(base, SOURCES), "anchor.stopRatio"), true);
    expect(result.kind).toBe("REJECTED_UNREFERENCED");
    expect(result.drafts).toBe(base);
  });

  it("7) 被引用的候选：写出一行 TUNABLE，范围与中文名照抄预设", () => {
    const base = withoutDeclaredParameters(withConditionParameterReference(drafts(), "positionRatio"));
    const result = toggleSearchParameter(base, candidateOf(deriveSearchParameterCandidates(base, SOURCES), "positionRatio"), true);
    expect(result.kind).toBe("APPLIED");
    const row = result.drafts.parameters.at(-1);
    expect(row?.code).toBe("positionRatio");
    expect(row?.name).toBe("单笔比例");
    expect(row?.parameterRole).toBe("TUNABLE");
    expect(row?.dataType).toBe("number");
    expect(row?.min).toBe("0.01");
    expect(row?.max).toBe("1");
    expect(row?.step).toBe("0.01");
    expect(row?.defaultValue).toBe("0.2");
    expect(row?.hasDefaultValue).toBe(true);
  });

  it("8) ★ 同一参数不得两处定义：勾两次仍然只有一行", () => {
    const base = withoutDeclaredParameters(withConditionParameterReference(drafts(), "positionRatio"));
    const candidate = candidateOf(deriveSearchParameterCandidates(base, SOURCES), "positionRatio");
    const once = toggleSearchParameter(base, candidate, true).drafts;
    const twice = toggleSearchParameter(once, candidate, true).drafts;
    expect(twice.parameters.filter(r => r.code === "positionRatio")).toHaveLength(1);
  });

  it("9a) 勾选一个已经存在的 code：原样不动（幂等），绝不覆盖既有行", () => {
    const base = withConditionParameterReference(drafts(), "holdingDays");
    const existing = base.parameters.find(r => r.code === "holdingDays");
    expect(existing).toBeDefined();
    const candidate = candidateOf(deriveSearchParameterCandidates(base, SOURCES), "holdingDays");
    const result = toggleSearchParameter(base, candidate, true);
    expect(result.kind).toBe("APPLIED");
    // 行数不变、对象引用不变（＝ original 里的键一个没丢）
    expect(result.drafts.parameters).toHaveLength(base.parameters.length);
    expect(result.drafts.parameters.find(r => r.code === "holdingDays")).toBe(existing);
  });

  it("9) 取消勾选：只删这一行，别的行原样保留", () => {
    const base = withoutDeclaredParameters(withConditionParameterReference(drafts(), "positionRatio"));
    const candidate = candidateOf(deriveSearchParameterCandidates(base, SOURCES), "positionRatio");
    const added = toggleSearchParameter(base, candidate, true).drafts;
    const removed = toggleSearchParameter(added, candidate, false).drafts;
    expect(removed.parameters.some(r => r.code === "positionRatio")).toBe(false);
    expect(removed.parameters).toEqual(base.parameters);
  });

  it("10) 纯函数：入参不被修改", () => {
    const base = withoutDeclaredParameters(withConditionParameterReference(drafts(), "positionRatio"));
    const snapshot = JSON.stringify(base);
    const candidate = candidateOf(deriveSearchParameterCandidates(base, SOURCES), "positionRatio");
    toggleSearchParameter(base, candidate, true);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe("状态文案", () => {
  it("11) 三态：可加入 / 已在搜索空间 / 未被规则引用", () => {
    const mk = (patch: Partial<SearchParameterCandidate>): SearchParameterCandidate => ({
      code: "c", label: "l", dataType: "number", currentValue: 1,
      blockLabel: "b", presetDisplayName: "p", referenced: true, alreadyDeclared: false, ...patch,
    });
    expect(candidateStatusLabel(mk({}))).toBe("可加入搜索");
    expect(candidateStatusLabel(mk({ alreadyDeclared: true }))).toBe("已在搜索空间");
    expect(candidateStatusLabel(mk({ referenced: false }))).toBe("未被规则引用，不可搜索");
  });
});
