/**
 * SCOPE-002 §4.4 / §0.1 DoD —— **纯前端构建 3570001 的机器可判定验收**。
 *
 * 模拟真实前端流程（S5）：
 *   1. `getBlankDraft(datasetVersionId=750001)` → 空白 canonical 骨架（含 PRIMARY 绑定）；
 *   2. `materializePreset(RECIPE)` → 文档级 `recipe`；
 *   3. `materializePreset(EXIT_POLICY)` → `definition.exit.rules[0]`（外壳 + policy）；
 *   4. 用户在表单里逐段填写**自由段**（事件 / 观察窗 / 触发 / 仓位 / 风控 / 执行）；
 *   5. `diffAgainstVersion` 与冻结 golden 比较 ⇒ `equal: true`。
 *
 * 🔴 两条断言的分工：
 *   - 断言 A（crisp）：**预设覆盖的两条路径**（`/recipe`、`/definition/exit`）**零差异** ——
 *     这才是"预设能不能产出 3570001"的证据；
 *   - 断言 B：整份文档（自由段按 3570001 的真实取值填写）**语义等价**（`description` 文案除外）。
 */
import { describe, expect, it } from "vitest";
import { buildStrategyAuthoringBlank } from "../../../../server/research/strategyAuthoring/blankDraft";
import { materializePreset } from "../../../../server/research/strategyAuthoring/materialize";
import { EXIT_POLICY_RULE_ENVELOPE } from "../../../../server/research/strategyAuthoring/presetRegistry";
import { diffAgainstVersion } from "../../../../server/research/strategyAuthoring/diff";
import { GOLDEN_3570001, GOLDEN_3570001_META } from "./golden3570001";

const goldenDefinition = GOLDEN_3570001.definition as Record<string, unknown>;

/** 步骤 1：空白骨架 + Dataset 坐标（由 Dataset 选择器写入）。 */
const blank = buildStrategyAuthoringBlank({
  datasetBinding: { datasetId: "first_limit_pullback", datasetVersion: "v7", datasetVersionId: 750001 },
});

/** 步骤 2/3：两个预设槽的物化结果（前端只做逐字复制）。 */
const recipeResult = materializePreset({ slot: "RECIPE", presetId: "recipe:first-limit-pullback-3f-top3", parameters: {} });
const exitPolicyResult = materializePreset({ slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20", parameters: {} });

/** 步骤 4/5：自由段由用户在表单填写；本测试以 golden 的真实取值代表"用户填对了"。 */
const authoredDocument: Record<string, unknown> = {
  strategyId: "authoring-equivalence-3570001",
  version: GOLDEN_3570001_META.version,
  name: "authoring equivalence",
  strategyType: "THREE_FACTOR_TOPN",
  universe: blank.parts.universe,
  datasetVersion: "v7",
  datasetVersionId: GOLDEN_3570001_META.datasetVersionId,
  definition: {
    ...goldenDefinition,
    datasets: (blank.parts.definition as Record<string, unknown>).datasets,
    exit: {
      rules: [
        {
          ...EXIT_POLICY_RULE_ENVELOPE,
          policy: exitPolicyResult.payload,
        },
      ],
    },
  },
  recipe: recipeResult.payload,
};

describe("S6 · 纯前端构建 3570001 的等价验收", () => {
  it("预设前置条件都成功（无 issues）", () => {
    expect(recipeResult.issues).toEqual([]);
    expect(exitPolicyResult.issues).toEqual([]);
  });

  it("断言 A（crisp）：预设覆盖的路径零差异 —— /recipe 与 /definition/exit", () => {
    const result = diffAgainstVersion({ document: authoredDocument, target: GOLDEN_3570001 });
    const presetPaths = result.differences.filter(
      item => item.path.startsWith("/recipe") || item.path.startsWith("/definition/exit"),
    );
    expect(presetPaths).toEqual([]);
  });

  it("断言 B：整份文档语义等价（equal:true，忽略 description 文案）", () => {
    const result = diffAgainstVersion({ document: authoredDocument, target: GOLDEN_3570001 });
    expect(result.differences).toEqual([]);
    expect(result.equal).toBe(true);
    expect(result.comparedPaths).toBeGreaterThan(50);
  });

  it("文案差异确实存在：不忽略 description 时会报差异（证明忽略规则在起作用，不是在空比空）", () => {
    const result = diffAgainstVersion({
      document: authoredDocument,
      target: GOLDEN_3570001,
      ignoreFieldNames: [],
    });
    expect(result.equal).toBe(false);
    expect(result.differences.some(item => item.path.endsWith("/description"))).toBe(true);
  });

  it("用户在自由段填错（如不填事件类型）⇒ 差异被如实报出，不静默通过", () => {
    const broken = JSON.parse(JSON.stringify(authoredDocument)) as Record<string, any>;
    broken.definition.entry.event.type = "";
    const result = diffAgainstVersion({ document: broken, target: GOLDEN_3570001 });
    expect(result.equal).toBe(false);
    expect(result.differences.some(item => item.path === "/definition/entry/event/type")).toBe(true);
  });
});