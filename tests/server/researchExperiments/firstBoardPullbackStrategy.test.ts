/**
 * STRATEGY-RESEARCH-BRIDGE-001 —— **首条真实策略** `first-board-pullback@1.0.0` 的草稿测试。
 *
 * 本文件**不碰 DB、不碰对象存储**：它验证的是「这份草稿能不能变成一个**合法的**策略定义，
 * 并且它的待搜索参数真的会进规则图」——那是 §14 / §18.5 / §18.6 的**前置**。
 * 真实 Create / 消费验证在 E2E（`docs/evidence/_e2e_srb001_*.mts`）里做。
 *
 * | 规格 | 判据 | 用例 |
 * | --- | --- | --- |
 * | §8  | 草稿能转成合法 StrategyDefinition（词表 + 结构 + Look-Ahead L1–L8） | 1-a |
 * | §11 | 观察窗口上界 == EXP-001 的 `DECLARED_DECISION_OFFSET_DAYS`（跨模块钉死） | 1-b |
 * | §11 | 无 look-ahead：条件字段全在 `currentBar` 域，不含 `post.*` / `path.*` / `outcome.*` | 1-c |
 * | §11 | `NEXT_OPEN` ⇒ 信号 T_CLOSE / 成交 T+1 开盘（决策 ≤ 决策偏移） | 1-d |
 * | §8  | FIXED / TUNABLE / DERIVED 三分登记完整，研究 / 设计来源逐条可查 | 2-a / 2-b |
 * | §14 | TUNABLE 参数**真的**被 Core 规则图引用（不是「声明了却没人读」） | 3-a / 3-b |
 * | §14 | 规则图引用面**恰好**等于登记的 TUNABLE 集合（不多不少） | 3-c |
 * | §17 | 严禁自动择优：草稿 / 定义的用户可见文本里没有评价性词汇 | 4-a |
 * | §17 | 词表里没有评价性证据种类（`RESEARCH_EVIDENCE_KINDS` 闭集） | 4-b |
 */

import { describe, expect, it } from "vitest";
import {
  buildExperimentStrategyArtifacts,
  type ExperimentStrategyDraft,
} from "../../../server/researchExperiments/strategyBridge";
import {
  FIRST_BOARD_PULLBACK_DECISION_LEDGER,
  FIRST_BOARD_PULLBACK_DRAFT,
  FIRST_BOARD_PULLBACK_EVIDENCES,
  FIRST_BOARD_PULLBACK_OBSERVATION_WINDOW_END,
  FIRST_BOARD_PULLBACK_OBSERVATION_WINDOW_START,
  FIRST_BOARD_PULLBACK_STRATEGY_ID,
  summarizeDecisionLedger,
} from "../../../server/researchExperiments/firstBoardPullbackStrategyDraft";
import {
  deriveUniverseIdForDataset,
  validateBuiltStrategyDefinition,
} from "../../../server/research/strategyCandidate/definitionBuild";
import { createStrategyDocumentFromDefinition } from "../../../server/research/strategySchema/map";
import { resolveFieldTimeDomain, parseStrategyFieldReference } from "../../../server/research/strategySchema/definition";
import { collectRuleParameterReferences } from "../../../server/strategyCore/ruleGraph";
import { coreVersionFromDocument } from "../../../server/strategyCore/production/versionFromDocument";
import { RESEARCH_EVIDENCE_KINDS } from "../../../server/research/strategyCandidate/researchEvidence";
import { DECLARED_DECISION_OFFSET_DAYS } from "@experiments/first-board-pullback/fundamental-study/result";

/** 执行绑定 = 真实 Dataset Version 390002（label `v2`）——与研究来源同坐标。 */
const EXECUTION_DATASET = {
  datasetVersionId: 390002,
  datasetVersionLabel: "v2",
  datasetCode: "first_limit_pullback",
} as const;

/** 取一次「草稿 → 定义 → 文档 → Core 版本」的全链（纯函数，无 IO）。 */
function buildChain(draft: ExperimentStrategyDraft = FIRST_BOARD_PULLBACK_DRAFT) {
  const artifacts = buildExperimentStrategyArtifacts(draft, EXECUTION_DATASET);
  const definition = validateBuiltStrategyDefinition(artifacts.definition);
  const document = createStrategyDocumentFromDefinition({
    strategyId: FIRST_BOARD_PULLBACK_STRATEGY_ID,
    version: "1.0.0",
    name: "首板回踩 1.0.0（测试用名）",
    universe: { universeId: deriveUniverseIdForDataset(EXECUTION_DATASET.datasetVersionLabel) },
    definition: artifacts.definition,
    executionAssumptions: artifacts.executionAssumptions,
  });
  const core = coreVersionFromDocument({ document, createdAt: "2026-09-21T00:00:00.000Z" });
  return { artifacts, definition, document, core };
}

// ---------------------------------------------------------------------------
// 1) 定义合法性 + PIT（§8 / §11）
// ---------------------------------------------------------------------------

describe("§8 / §11 首板回踩草稿 → 合法定义 + PIT", () => {
  const { definition, artifacts, core } = buildChain();

  it("1-a) 草稿能过既有校验器（结构 + Look-Ahead L1–L8），且 Core 定义可构造", () => {
    // `validateBuiltStrategyDefinition` 不抛即通过（抛的话 buildChain 就炸了）。
    expect(definition.schemaVersion).toBe("1.0");
    expect(definition.entry.event?.type).toBe("FIRST_LIMIT_UP");
    expect(definition.entry.conditions).toHaveLength(2);
    // Core 可构造 ⇒ Parameter Search 的「死参数筛查」才不会退化成「未筛查」（§14）。
    expect(core.ok, `Core 定义必须可构造，实际：${core.ok ? "" : JSON.stringify(core)}`).toBe(true);
    // 文档级执行假设必须显式来自草稿（不是组装层补的默认值）。
    expect(artifacts.executionAssumptions.backtestConfig.initialCapital).toBe(1_000_000);
    expect(artifacts.executionAssumptions.costModel.slippageBps).toBe(5);
  });

  it("1-b) 观察窗口上界 == EXP-001 的 DECLARED_DECISION_OFFSET_DAYS（跨模块钉死，含边界语义）", () => {
    // 🔴 这是 §11 最硬的一条：窗口上界**不是**本地常量，而是 EXP-001 声明并强制过的那一个。
    //    研究把边界改成 6 而策略没跟 ⇒ 本用例立刻失败（而不是悄悄 look-ahead）。
    expect(definition.entry.observationWindow).toEqual({
      start: 1,
      end: DECLARED_DECISION_OFFSET_DAYS,
      unit: "TRADING_DAY",
    });
    expect(FIRST_BOARD_PULLBACK_OBSERVATION_WINDOW_END).toBe(DECLARED_DECISION_OFFSET_DAYS);
    expect(FIRST_BOARD_PULLBACK_OBSERVATION_WINDOW_START).toBe(1);
    // **包含式**上界：`end === 5` 覆盖 T+5 当天（不是 `end: 4` 那种差一）。
    expect(definition.entry.observationWindow.end).toBe(5);
  });

  it("1-c) 无 look-ahead：条件字段全在 currentBar 域（不含 post.* / path.* / outcome.*）", () => {
    for (const condition of definition.entry.conditions) {
      const reference = parseStrategyFieldReference(condition.field);
      expect(reference.kind, `字段 ${condition.field} 必须可被权威文法解析`).toBe("currentBar");
      expect(resolveFieldTimeDomain(reference)).toBe("CURRENT_BAR");
      // 显式排除三类前视 / 标签域（即便文法变了也要在这里拦下）。
      expect(condition.field.startsWith("post.")).toBe(false);
      expect(condition.field.startsWith("path.")).toBe(false);
      expect(condition.field.startsWith("outcome.")).toBe(false);
    }
    // 窗口上界本身也不得越过研究声明的信息边界。
    expect(definition.entry.observationWindow.end).toBeLessThanOrEqual(DECLARED_DECISION_OFFSET_DAYS);
  });

  it("1-d) NEXT_OPEN ⇒ 信号 T_CLOSE、成交 T_PLUS_1_OPEN、价类型 OPEN（决策 ≤ 决策偏移）", () => {
    expect(definition.execution.signalTiming).toBe("T_CLOSE");
    expect(definition.execution.executionTiming).toBe("T_PLUS_1_OPEN");
    expect(definition.execution.priceType).toBe("OPEN");
    // 信号 bar 必须落在观察窗口内（决策时点 ≤ 窗口上界）。
    expect(definition.entry.observationWindow.end).toBeLessThanOrEqual(DECLARED_DECISION_OFFSET_DAYS);
  });
});

// ---------------------------------------------------------------------------
// 2) FIXED / TUNABLE / DERIVED 登记（§8）
// ---------------------------------------------------------------------------

describe("§8 FIXED / TUNABLE / DERIVED 与「研究 / 设计」来源登记", () => {
  const { definition } = buildChain();
  const summary = summarizeDecisionLedger();

  it("2-a) 登记表三分完整、来源二分完整，且每条都有非空说明", () => {
    expect(summary.total).toBe(FIRST_BOARD_PULLBACK_DECISION_LEDGER.length);
    expect(summary.total).toBe(summary.byRole.FIXED + summary.byRole.TUNABLE + summary.byRole.DERIVED);
    expect(summary.total).toBe(summary.byOrigin.RESEARCH + summary.byOrigin.DESIGN);
    // 本版刻意**没有** DERIVED 参数（没有「由其他参数算出」的量）—— 把这条事实钉死，
    // 免得日后有人为了「看起来完整」硬塞一个伪造的派生参数。
    expect(summary.byRole.DERIVED).toBe(0);
    // 研究只给出极少数取值，绝大多数是策略设计决策 —— 这个比例本身就是 §8 要求说清的事。
    expect(summary.byOrigin.RESEARCH).toBeGreaterThan(0);
    expect(summary.byOrigin.DESIGN).toBeGreaterThan(summary.byOrigin.RESEARCH);
    for (const entry of FIRST_BOARD_PULLBACK_DECISION_LEDGER) {
      expect(entry.note.trim().length, `${entry.field} 必须有非空说明`).toBeGreaterThan(0);
    }
  });

  it("2-b) 登记为 TUNABLE 的取值**恰好**等于定义里的 TUNABLE 参数（不多不少）", () => {
    const ledgerTunable = FIRST_BOARD_PULLBACK_DECISION_LEDGER
      .filter((entry) => entry.role === "TUNABLE")
      .map((entry) => String(entry.value))
      .sort();
    const definitionTunable = definition.parameters
      .filter((parameter) => parameter.parameterRole === "TUNABLE")
      .map((parameter) => parameter.code)
      .sort();
    expect(ledgerTunable).toEqual(definitionTunable);
    // 非 TUNABLE 的参数一个都不该出现在定义里（FIXED 取值以字面量形式落在 exitRule / riskRule）。
    expect(definition.parameters.every((parameter) => parameter.parameterRole === "TUNABLE")).toBe(true);
  });

  it("2-c) 研究侧登记必须能追到已引用的证据 Run（不能只有一句「来自研究」）", () => {
    const researchBacked = FIRST_BOARD_PULLBACK_DECISION_LEDGER.filter((entry) => entry.origin === "RESEARCH");
    expect(researchBacked.map((entry) => entry.field)).toEqual([
      "entryRule.event",
      "entryRule.extra.observationWindow",
    ]);
    // 这两条的判据都在证据列表里有对应 Run 可查。
    const runIds = new Set(FIRST_BOARD_PULLBACK_EVIDENCES.map((evidence) => evidence.runId));
    expect(runIds.has("RUN-20260921-8557F38A")).toBe(true);
    expect(runIds.has("RUN-20260921-C95B1D47")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3) 待搜索参数真的进规则图（§14 前置）
// ---------------------------------------------------------------------------

describe("§14 TUNABLE 参数的**真实**引用面", () => {
  const { definition, core } = buildChain();

  it("3-a) 两条条件的右值都是参数引用（而不是常量）", () => {
    const valueTypes = definition.entry.conditions.map((condition) => condition.valueType);
    expect(valueTypes).toEqual(["PARAMETER_REFERENCE", "PARAMETER_REFERENCE"]);
    expect(definition.entry.conditions.map((condition) => condition.value)).toEqual([
      "maxBreakDepthRatio",
      "maxVolumeRatio",
    ]);
  });

  it("3-b) Core 规则图**真的**引用了这两个参数（这是 Parameter Search 用的同一判据）", () => {
    if (!core.ok) throw new Error("Core 定义不可构造，无法核引用面");
    const refs = collectRuleParameterReferences(core.version.definition.ruleGraph);
    expect([...refs].sort()).toEqual(["maxBreakDepthRatio", "maxVolumeRatio"]);
    // 出场规则图（若有）与声明式出场的 parameterCode 一并纳入（与 paramSearchRouter 同口径）。
    const exitGraph = core.version.definition.exitRuleGraph;
    const exitRefs = exitGraph === null ? [] : collectRuleParameterReferences(exitGraph);
    const declaredExitCodes = core.version.definition.exitRules
      .map((rule) => (rule as { readonly parameterCode?: unknown }).parameterCode)
      .filter((code): code is string => typeof code === "string" && code !== "");
    expect([...refs, ...exitRefs, ...declaredExitCodes].filter((c) => c.startsWith("max"))).toEqual(
      expect.arrayContaining(["maxBreakDepthRatio", "maxVolumeRatio"]),
    );
  });

  it("3-c) 引用面**恰好**等于声明的 TUNABLE 集合（没有「声明了却没人读」的死参数）", () => {
    if (!core.ok) throw new Error("Core 定义不可构造，无法核引用面");
    const declared = new Set(definition.parameters.filter((p) => p.parameterRole === "TUNABLE").map((p) => p.code));
    const referenced = new Set(collectRuleParameterReferences(core.version.definition.ruleGraph));
    expect([...declared].sort()).toEqual([...referenced].sort());
    // 反向：规则图不得引用未声明的参数（否则是「引用了不存在的旋钮」）。
    for (const code of referenced) expect(declared.has(code)).toBe(true);
  });

  it("3-d) 两个 TUNABLE 参数都带范围与默认值（数值参数缺 min/max 会被构造器响亮拒绝）", () => {
    for (const parameter of definition.parameters) {
      expect(typeof parameter.min, `${parameter.code} 缺 min`).toBe("number");
      expect(typeof parameter.max, `${parameter.code} 缺 max`).toBe("number");
      expect(parameter.min!).toBeLessThan(parameter.max!);
      // 默认值必须落在范围内（否则执行层 `resolveParameters` 会用越界值起步）。
      expect(parameter.defaultValue).toBeGreaterThanOrEqual(parameter.min!);
      expect(parameter.defaultValue).toBeLessThanOrEqual(parameter.max!);
    }
  });
});

// ---------------------------------------------------------------------------
// 4) 严禁自动择优（§17）
// ---------------------------------------------------------------------------

describe("§17 严禁自动择优", () => {
  it("4-a) 草稿 / 定义的**用户可见文本**里没有评价性词汇", () => {
    // 判据写在**渲染值**上（不是「源码里 grep 到就报」）：把草稿序列化后，
    // 排除掉键名（键名是英文技术标识），只看会被展示的值。
    const forbidden = /\b(recommended|best|optimal|winner|top)\b/iu;
    const texts: string[] = [];

    const visit = (value: unknown, keyHint: string): void => {
      if (typeof value === "string") {
        // 技术标识（枚举码 / 字段引用 / 参数 code）不是「展示文本」，跳过。
        const isTechnical = /^[A-Z][A-Z0-9_]*$/u.test(value)
          || /^(bar|prefix|post|event|path|outcome)\./u.test(value)
          || /^[a-z][A-Za-z0-9_]*$/u.test(value);
        if (!isTechnical) texts.push(`${keyHint}=${value}`);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${keyHint}[${index}]`));
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) visit(child, `${keyHint}.${key}`);
      }
    };
    visit(FIRST_BOARD_PULLBACK_DRAFT, "draft");

    const offenders = texts.filter((text) => forbidden.test(text));
    expect(offenders, `以下展示文本含评价性词汇：${offenders.join(" | ")}`).toEqual([]);
    // 反证：闸门本身是活的（拿一个必然命中的样本验一次）。
    expect(forbidden.test("这是 recommended 的参数")).toBe(true);
  });

  it("4-b) 证据种类词表是闭集且不含评价性取值", () => {
    expect([...RESEARCH_EVIDENCE_KINDS]).toEqual(["RESULT_SUMMARY", "STABILITY_VERDICT", "SAMPLE_ACCOUNTING"]);
    for (const kind of RESEARCH_EVIDENCE_KINDS) {
      expect(kind).not.toMatch(/BEST|OPTIMAL|RECOMMEND|WINNER/u);
    }
  });

  it("4-c) 证据列表保持**声明顺序**（不做任何排序 —— 排序会被误读成重要程度）", () => {
    expect(FIRST_BOARD_PULLBACK_EVIDENCES.map((e) => e.runId)).toEqual([
      "RUN-20260921-8557F38A",
      "RUN-20260921-8557F38A",
      "RUN-20260921-8557F38A",
      "RUN-20260921-C95B1D47",
      "RUN-20260921-A95F5B48",
    ]);
  });
});
