/**
 * promoteForm 纯函数测试（RESEARCH-006.4.1-B §27.1 / §27.2 / §27.3）。
 *
 * 为什么这些断言摆在纯函数上：本机 `agent-browser` 不可用、仓库没有 `jsdom` /
 * `@testing-library` ⇒ 转正弹窗的**行为**无法用渲染测试证明。这里退而求其次且更强的做法是
 * 「把弹窗真正调用的判断函数直接 `import` 出来测」——组件里**不允许**另写一套判断，
 * 因此测住这些函数就等于测住弹窗的决策。
 *
 * 🔴 本文件的三条硬纪律（对应任务 §27）：
 *   1. **状态门槛**不许手抄：断言逐条来自后端 `RESEARCH_CANDIDATE_STATUSES`；
 *   2. **错误码表**不许手抄：断言 `PROMOTE_DOMAIN_HINTS` 的每个 key 都是后端真实字面量
 *      （防止抄错、防止后端改名后前端静默失效）；
 *   3. **提交体**永远不可能含 `strategyDefinition` / `definition` / `strategyDocumentJson`
 *      —— 用「键白名单」正面断言，而不是靠人记得别写（§14）。
 */

import { describe, expect, it } from "vitest";
import { PROMOTE_DOMAIN_HINTS } from "../../adapters/strategyCandidateAdapter";
import { STRATEGY_CANDIDATE_ERROR } from "../../../../server/research/strategyCandidate/candidateTypes";
import { RESEARCH_CANDIDATE_STATUSES } from "../../../../server/researchCore/types";
import {
  buildDatasetVersionOptions,
  buildPromoteInput,
  createDefaultPromoteForm,
  datasetOptionLabel,
  findDatasetVersionLabel,
  isPromotableStatus,
  NON_PROMOTABLE_STATUSES,
  PROMOTABLE_STATUS,
  validatePromoteForm,
  type PromoteFormState,
  type PromoteSourceContext,
} from "./promoteForm";

/** 正常候选：研究来源 Dataset 可提得出（`dataset_version.id = 900`）。 */
const SOURCE: PromoteSourceContext = { sourceDatasetVersionId: 900, sourceDatasetLabel: "v2" };
/** 异常候选：证据提不出研究来源坐标（后端允许存在，转正必须显式选）。 */
const SOURCE_EMPTY: PromoteSourceContext = { sourceDatasetVersionId: null, sourceDatasetLabel: null };

function form(overrides: Partial<PromoteFormState> = {}): PromoteFormState {
  return { ...createDefaultPromoteForm(), ...overrides };
}

/** 键白名单断言（正面证明「没有多余字段」，比断言「不含某个词」更强）。 */
function expectOnlyKeys(value: object, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    expect(allowed, `出现白名单外的键 ${key}`).toContain(key);
  }
}

// ---------------------------------------------------------------------------
// §27.1 —— 转正资格只看状态字面量
// ---------------------------------------------------------------------------

describe("isPromotableStatus（§8 / §27.1）", () => {
  it("1-a) 唯一可转正状态是 ACCEPTED（与后端 CANDIDATE_NOT_ACCEPTED 门槛镜像）", () => {
    expect(PROMOTABLE_STATUS).toBe("ACCEPTED");
    expect(isPromotableStatus("ACCEPTED")).toBe(true);
  });

  it("1-b) 其余每一个状态都不可转正（逐个取后端常量，不手抄清单）", () => {
    const others = RESEARCH_CANDIDATE_STATUSES.filter((s) => s !== "ACCEPTED");
    expect(others.length).toBe(RESEARCH_CANDIDATE_STATUSES.length - 1);
    expect(others.length).toBeGreaterThanOrEqual(5);
    for (const status of others) {
      expect(isPromotableStatus(status), `${status} 不应可转正`).toBe(false);
    }
  });

  it("1-c) 已转正（CONVERTED）不再显示可执行入口 —— 幂等由后端闸门负责，不是「再点一次」", () => {
    expect(isPromotableStatus("CONVERTED")).toBe(false);
  });

  it("1-d) 空值 / 大小写不符 / 未知状态一律不可转正（不猜、不兜底放行）", () => {
    expect(isPromotableStatus(null)).toBe(false);
    expect(isPromotableStatus(undefined)).toBe(false);
    expect(isPromotableStatus("")).toBe(false);
    expect(isPromotableStatus("accepted")).toBe(false);
    expect(isPromotableStatus("SOMETHING_NEW")).toBe(false);
  });

  it("1-e) 展示用黑名单与后端状态机不漂移：并集**恰好**等于后端六态", () => {
    const union = [...NON_PROMOTABLE_STATUSES, PROMOTABLE_STATUS].slice().sort();
    expect(union).toEqual([...RESEARCH_CANDIDATE_STATUSES].slice().sort());
    expect(new Set(union).size).toBe(union.length);
  });
});

// ---------------------------------------------------------------------------
// §27.2 —— Dataset：继承 / 相同 / 不同 / 空白
// ---------------------------------------------------------------------------

describe("validatePromoteForm（§10 ~ §12 / §27.2）", () => {
  it("2-a) 继承模式（默认）：执行 = 研究来源，无分歧，不需要显式绑定", () => {
    const v = validatePromoteForm(createDefaultPromoteForm(), SOURCE);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.executionDatasetVersionId).toBe(900);
    expect(v.diverges).toBe(false);
    expect(v.needsExplicitBinding).toBe(false);
  });

  it("2-b) 继承模式但候选提不出来源坐标 → 提前拦住（后端必报 DATASET_VERSION_INVALID）", () => {
    const v = validatePromoteForm(createDefaultPromoteForm(), SOURCE_EMPTY);
    expect(v.ok).toBe(false);
    expect(v.executionDatasetVersionId).toBeNull();
    expect(v.errors.join()).toContain("没有可继承的研究来源 Dataset");
  });

  it("2-c) 显式选「与来源相同」的版本 → 不构成分歧、不需要原因、也不需要提交绑定", () => {
    const v = validatePromoteForm(form({ mode: "OVERRIDE", datasetVersionId: 900 }), SOURCE);
    expect(v.ok).toBe(true);
    expect(v.executionDatasetVersionId).toBe(900);
    expect(v.diverges).toBe(false);
    expect(v.needsExplicitBinding).toBe(false);
  });

  it("2-d) 显式选「与来源不同」但未填原因 → 不通过（后端 DATASET_DIVERGENCE_REASON_REQUIRED）", () => {
    const v = validatePromoteForm(form({ mode: "OVERRIDE", datasetVersionId: 901 }), SOURCE);
    expect(v.ok).toBe(false);
    expect(v.diverges).toBe(true);
    expect(v.executionDatasetVersionId).toBe(901);
    expect(v.errors.join()).toContain("数据集分歧原因");
  });

  it("2-e) 原因只有空白 / 换行 / 制表符 → 仍然不通过（trim 判据，不是 length > 0）", () => {
    for (const blank of ["", "   ", "\n", "\t ", " \n \t "]) {
      const v = validatePromoteForm(
        form({ mode: "OVERRIDE", datasetVersionId: 901, divergenceReason: blank }),
        SOURCE,
      );
      expect(v.ok, `「${JSON.stringify(blank)}」不应算填了原因`).toBe(false);
    }
  });

  it("2-f) 不同 + 有实质原因 → 通过，且明确要求提交显式绑定", () => {
    const v = validatePromoteForm(
      form({ mode: "OVERRIDE", datasetVersionId: 901, divergenceReason: "执行域补了 T+6 数据" }),
      SOURCE,
    );
    expect(v.ok).toBe(true);
    expect(v.diverges).toBe(true);
    expect(v.needsExplicitBinding).toBe(true);
  });

  it("2-g) 显式模式但没选版本 → 不通过", () => {
    const v = validatePromoteForm(form({ mode: "OVERRIDE", datasetVersionId: null }), SOURCE);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toContain("请选择一个执行 Dataset 版本");
  });

  it("2-h) 来源为空时填了原因 → 不通过（不存在分歧，后端要求 reason 必须是 NULL）", () => {
    const v = validatePromoteForm(
      form({ mode: "OVERRIDE", datasetVersionId: 901, divergenceReason: "随便写的理由" }),
      SOURCE_EMPTY,
    );
    expect(v.ok).toBe(false);
    expect(v.diverges).toBe(false);
    expect(v.errors.join()).toContain("不存在数据集分歧");
  });

  it("2-i) 来源为空 + 显式选版本 + 不填原因 → 通过且**不**算分歧（与后端口径一致）", () => {
    const v = validatePromoteForm(form({ mode: "OVERRIDE", datasetVersionId: 901 }), SOURCE_EMPTY);
    expect(v.ok).toBe(true);
    expect(v.executionDatasetVersionId).toBe(901);
    expect(v.diverges).toBe(false);
    expect(v.needsExplicitBinding).toBe(true);
  });

  it("2-j) 来源为空时**永远**不判为分歧（diverges 的判据含 `来源 !== null`）", () => {
    for (const id of [null, 901, 0, -1]) {
      const v = validatePromoteForm(form({ mode: "OVERRIDE", datasetVersionId: id }), SOURCE_EMPTY);
      expect(v.diverges).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// §27.3 —— 提交体字段（绝不含 StrategyDefinition）
// ---------------------------------------------------------------------------

describe("buildPromoteInput（§14 / §27.3）", () => {
  it("3-a) 继承模式：入参只有 candidateId，**不**提交 overrides（继承规则留在后端）", () => {
    const built = buildPromoteInput({ candidateId: 41, form: createDefaultPromoteForm(), source: SOURCE });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toEqual({ candidateId: 41 });
    expectOnlyKeys(built.input, ["candidateId", "overrides"]);
    expect("overrides" in built.input).toBe(false);
  });

  it("3-b) 执行与来源一致：仍然不提交 datasetBinding（等价于继承，不重复表述）", () => {
    const built = buildPromoteInput({
      candidateId: 41,
      form: form({ mode: "OVERRIDE", datasetVersionId: 900 }),
      source: SOURCE,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect("overrides" in built.input).toBe(false);
  });

  it("3-c) 构成分歧：overrides 恰好两个键，原因已 trim，坐标只有 datasetVersionId", () => {
    const built = buildPromoteInput({
      candidateId: 41,
      form: form({ mode: "OVERRIDE", datasetVersionId: 901, divergenceReason: "  换执行域，样本更长  " }),
      source: SOURCE,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expectOnlyKeys(built.input, ["candidateId", "overrides"]);
    const overrides = built.input.overrides!;
    expectOnlyKeys(overrides, ["datasetBinding", "datasetDivergenceReason"]);
    expectOnlyKeys(overrides.datasetBinding!, ["datasetVersionId"]);
    expect(overrides.datasetBinding!.datasetVersionId).toBe(901);
    expect(overrides.datasetDivergenceReason).toBe("换执行域，样本更长");
  });

  it("3-d) 校验不通过时**不产出**输入，只回报错误（绝不带着半成品去调后端）", () => {
    const built = buildPromoteInput({
      candidateId: 41,
      form: form({ mode: "OVERRIDE", datasetVersionId: 901 }),
      source: SOURCE,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.length).toBeGreaterThan(0);
    expect("input" in built).toBe(false);
  });

  it("3-e) 🔴 提交体绝不可能出现 StrategyDefinition 相关字段（键白名单 + 序列化双向断言）", () => {
    const built = buildPromoteInput({
      candidateId: 41,
      form: form({ mode: "OVERRIDE", datasetVersionId: 901, divergenceReason: "理由" }),
      source: SOURCE,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expectOnlyKeys(built.input, ["candidateId", "overrides"]);
    expectOnlyKeys(built.input.overrides!, ["datasetBinding", "datasetDivergenceReason"]);
    const serialized = JSON.stringify(built.input);
    expect(serialized).not.toContain("strategyDefinition");
    expect(serialized).not.toContain("strategyDocumentJson");
    expect(serialized).not.toContain("definition");
    expect(serialized).not.toContain("universe");
    expect(serialized).not.toContain("entryRules");
    expect(serialized).not.toContain("exitRules");
    expect(serialized).not.toContain("positionSizing");
  });

  it("3-f) 构造器**不修改**传入的表单与上下文（纯函数，无隐藏状态）", () => {
    const state = form({ mode: "OVERRIDE", datasetVersionId: 901, divergenceReason: "  待 trim  " });
    const snapshot = JSON.stringify(state);
    const sourceSnapshot = JSON.stringify(SOURCE);
    buildPromoteInput({ candidateId: 41, form: state, source: SOURCE });
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(JSON.stringify(SOURCE)).toBe(sourceSnapshot);
  });
});

// ---------------------------------------------------------------------------
// §27.4（前置）—— 错误码表必须与后端字面量对得上
// ---------------------------------------------------------------------------

/** 转正链路上**前端必须能解释**的领域码（逐个取自后端真实常量，不手抄字符串）。 */
const REQUIRED_COVERED_CODES = [
  STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED,
  STRATEGY_CANDIDATE_ERROR.PROMOTE_SOURCE_INCOMPLETE,
  STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
  STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID,
  STRATEGY_CANDIDATE_ERROR.PROMOTE_DEFINITION_INVALID,
  STRATEGY_CANDIDATE_ERROR.DATASET_DIVERGENCE_REASON_REQUIRED,
  STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY,
  STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND,
  STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_INVALID,
  STRATEGY_CANDIDATE_ERROR.DATASET_BINDING_INVALID,
  STRATEGY_CANDIDATE_ERROR.PROMOTE_STRATEGY_ID_CONFLICT,
  STRATEGY_CANDIDATE_ERROR.PROMOTE_VERSION_CONFLICT,
  STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT,
  STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED,
  STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
] as const;

describe("PROMOTE_DOMAIN_HINTS ↔ 后端错误码（§27.4 前置）", () => {
  it("4-a) 提示表里每个 key 都是后端**真实存在**的领域码（防抄错 / 防后端改名静默失效）", () => {
    const realCodes = new Set<string>(Object.values(STRATEGY_CANDIDATE_ERROR));
    const keys = Object.keys(PROMOTE_DOMAIN_HINTS);
    expect(keys.length).toBeGreaterThanOrEqual(7);
    for (const key of keys) {
      expect(realCodes.has(key), `前端提示表里的 ${key} 在后端 STRATEGY_CANDIDATE_ERROR 中不存在`).toBe(true);
    }
  });

  it("4-b) 转正链路的 15 个领域码**全部**有针对性解释（一个都不漏）", () => {
    const covered = new Set(Object.keys(PROMOTE_DOMAIN_HINTS));
    const missing = REQUIRED_COVERED_CODES.filter((code) => !covered.has(code));
    expect(missing).toEqual([]);
    expect(new Set(REQUIRED_COVERED_CODES).size).toBe(REQUIRED_COVERED_CODES.length);
  });

  it("4-c) 这些码的解释**两两不同**（≥7 个不同诊断，不能拿一句话糊弄所有失败）", () => {
    const explanations = REQUIRED_COVERED_CODES.map((code) => PROMOTE_DOMAIN_HINTS[code]!.explanation);
    const titles = REQUIRED_COVERED_CODES.map((code) => PROMOTE_DOMAIN_HINTS[code]!.title);
    expect(new Set(explanations).size).toBe(explanations.length);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(explanations).size).toBeGreaterThanOrEqual(7);
  });

  it("4-d) 每条提示都有非空标题与可执行解释（不出现空壳条目）", () => {
    for (const [code, hint] of Object.entries(PROMOTE_DOMAIN_HINTS)) {
      expect(hint.title.length, `${code} 缺标题`).toBeGreaterThan(0);
      expect(hint.explanation.length, `${code} 缺解释`).toBeGreaterThan(0);
    }
  });

  it("4-e) 写回失败必须原话提示「不要创建新 Candidate + 可再次 Promote 恢复」（§11）", () => {
    const hint = PROMOTE_DOMAIN_HINTS[STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED]!;
    expect(hint.explanation).toContain("请不要创建新 Candidate");
    expect(hint.explanation).toContain("再次执行 Promote 恢复");
    expect(hint.title).toContain("Strategy 可能已经建出来了");
  });

  it("4-f) 「草图缺内容」必须指向「回去补草稿」而不是「在转正时另给定义」", () => {
    const hint = PROMOTE_DOMAIN_HINTS[STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE]!;
    expect(hint.explanation).toContain("回去补什么");
    expect(hint.explanation).toContain("绝不补默认值");
  });

  it("4-g) 「入参不合法」必须写明「策略定义由服务端生成、调用方不得提交」（§14）", () => {
    const hint = PROMOTE_DOMAIN_HINTS[STRATEGY_CANDIDATE_ERROR.INVALID_INPUT]!;
    expect(hint.explanation).toContain("不得提交");
    expect(hint.explanation).toContain("candidateId");
  });
});

// ---------------------------------------------------------------------------
// §11 —— Dataset 选项：只认 datasetVersionId，READY 才可用
// ---------------------------------------------------------------------------

const VERSIONS = [
  { id: 900, version: "v2", status: "READY", startDate: "2019-01-02", endDate: "2026-08-31", totalEvents: 23978 },
  { id: 901, version: "v3", status: "READY", startDate: "2019-01-02", endDate: "2026-09-10", totalEvents: 25100 },
  { id: 902, version: "v4", status: "BUILDING", startDate: null, endDate: null, totalEvents: null },
] as const;

describe("Dataset 版本选项（§11 / §27.2）", () => {
  const options = buildDatasetVersionOptions({
    datasetName: "首板事件集",
    datasetCode: "first_board",
    versions: VERSIONS,
    sourceDatasetVersionId: 900,
  });

  it("5-a) 坐标只有 datasetVersionId；label / datasetCode 仅用于显示", () => {
    expect(options.map((o) => o.datasetVersionId)).toEqual([900, 901, 902]);
    expect(options[0]!.label).toBe("v2");
    expect(options[0]!.datasetCode).toBe("first_board");
  });

  it("5-b) 非 READY 版本照样列出但标记 usable=false（看见「还不能用」而不是消失）", () => {
    expect(options.length).toBe(VERSIONS.length);
    expect(options.map((o) => o.usable)).toEqual([true, true, false]);
    expect(options[2]!.status).toBe("BUILDING");
  });

  it("5-c) 只有等于研究来源坐标的选项被标 isSource", () => {
    expect(options.map((o) => o.isSource)).toEqual([true, false, false]);
  });

  it("5-d) 无研究来源时任何选项都不是 isSource（不误标「继承」）", () => {
    const none = buildDatasetVersionOptions({
      datasetName: "x",
      datasetCode: "y",
      versions: VERSIONS,
      sourceDatasetVersionId: null,
    });
    expect(none.every((o) => o.isSource === false)).toBe(true);
  });

  it("5-e) 选项标签含 #id / code / label / status —— 界面上不会只剩一个看不出坐标的 label", () => {
    const label = datasetOptionLabel(options[1]!);
    expect(label).toContain("#901");
    expect(label).toContain("first_board");
    expect(label).toContain("v3");
    expect(label).toContain("READY");
  });

  it("5-f) 按坐标回查 label 找不到即 null（不猜、不退回第一个）", () => {
    expect(findDatasetVersionLabel(options, 901)).toBe("v3");
    expect(findDatasetVersionLabel(options, 123456)).toBeNull();
    expect(findDatasetVersionLabel(options, null)).toBeNull();
  });
});
