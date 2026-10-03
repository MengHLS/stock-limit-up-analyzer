/**
 * SCOPE-002 §2 —— `strategyDomain.authoring.*` 契约测试。
 *
 * 覆盖：词表 / 空白草稿 / 预设物化 / 预检（**含 3570001 等价文档 valid:true**）/ 保存门槛。
 * 🔴 本文件**不落库**：`saveDraft` 只测"门槛与权限"这两条在写库之前就成立的分支。
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "../../../../server/routers";
import { GOLDEN_3570001 } from "./golden3570001";

const baseCtx = { req: {} as never, res: {} as never, user: null };
const publicCaller = appRouter.createCaller(baseCtx);
const adminCaller = appRouter.createCaller({ ...baseCtx, user: { role: "admin" } as never });

const goldenPolicy = (GOLDEN_3570001.definition as any).exit.rules[0].policy;

/** 用 golden 的 definition + recipe 组一份"前端会产出"的文档（identity 换成测试值）。 */
function equivalentDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    strategyId: "authoring-router-test-3570001",
    version: "1.0.0",
    name: "authoring router test",
    strategyType: "THREE_FACTOR_TOPN",
    universe: { universeId: "research-dataset:v7" },
    datasetVersion: "v7",
    datasetVersionId: 750001,
    definition: GOLDEN_3570001.definition,
    recipe: GOLDEN_3570001.recipe,
    executionAssumptions: {
      backtestConfig: { initialCapital: 1_000_000, maxPositions: 5 },
      costModel: { commissionRate: 0.00025, stampDutyRate: 0.0005, transferFeeRate: 0.00001, slippageBps: 5, lotSize: 100, minCommission: 5 },
      executionModel: "NEXT_OPEN",
    },
    ...overrides,
  };
}

describe("strategyDomain.authoring · 只读面", () => {
  it("getVocabulary 暴露词表（含 presetSlots / presets / runnerStates / strategyTypes）", async () => {
    const vocab = await publicCaller.strategyDomain.authoring.getVocabulary();
    expect(vocab.presetSlots.map(s => s.slot)).toEqual(expect.arrayContaining(["RECIPE", "EXIT_POLICY", "RUNNER_BRIDGE"]));
    expect(vocab.presets.map(p => p.presetId)).toContain("exit:SL-18.1-nh3-5-20");
    expect(vocab.runnerStates.length).toBe(12);
    expect(vocab.strategyTypes).toContain("THREE_FACTOR_TOPN");
  });

  it("getBlankDraft（未绑定）返回骨架零件 + 必填段清单", async () => {
    const blank = await publicCaller.strategyDomain.authoring.getBlankDraft({});
    expect(blank.parts.identity.strategyId).toBe("");
    expect((blank.parts.definition as any).datasets).toEqual([]);
    expect(blank.requiredSections.map(s => s.key)).toContain("recipe");
  });

  it("materializePreset 产出 == 3570001 golden policy（逐字段）", async () => {
    const result = await publicCaller.strategyDomain.authoring.materializePreset({
      slot: "EXIT_POLICY", presetId: "exit:SL-18.1-nh3-5-20", parameters: {},
    });
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual(goldenPolicy);
  });
});

describe("strategyDomain.authoring · previewDocument", () => {
  it("★ 用 golden 组的等价文档 ⇒ valid:true 且有 fingerprint", async () => {
    const preview = await publicCaller.strategyDomain.authoring.previewDocument({ document: equivalentDocument() });
    expect(preview.issues).toEqual([]);
    expect(preview.valid).toBe(true);
    expect(preview.canonicalDefinitionPresent).toBe(true);
    expect(preview.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("缺 event / 配方等必填 ⇒ valid:false 并给出 issue 路径", async () => {
    const broken = equivalentDocument();
    delete (broken as any).recipe;
    (broken as any).definition = { ...(GOLDEN_3570001.definition as any), entry: { conditions: [] } };
    const preview = await publicCaller.strategyDomain.authoring.previewDocument({ document: broken });
    expect(preview.valid).toBe(false);
    expect(preview.issues.length).toBeGreaterThan(0);
    expect(preview.issues.every(i => typeof i.path === "string" && typeof i.code === "string")).toBe(true);
  });

  it("legacy-only 文档（无 definition）⇒ canonicalDefinitionPresent:false（但不崩）", async () => {
    const legacy = { strategyId: "legacy-x", version: "1.0.0", name: "legacy", universe: { universeId: "u" } };
    const preview = await publicCaller.strategyDomain.authoring.previewDocument({ document: legacy });
    expect(preview.canonicalDefinitionPresent).toBe(false);
    expect(preview.valid).toBe(false);
  });
});

describe("strategyDomain.authoring · saveDraft 门槛（不落库分支）", () => {
  it("非 admin ⇒ FORBIDDEN（创作写入口与既有 strategy.save 同权限口径）", async () => {
    await expect(publicCaller.strategyDomain.authoring.saveDraft({
      document: equivalentDocument(), origin: { kind: "BLANK_CANONICAL", presetRefs: [] },
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin 但文档无 canonical definition ⇒ AUTHORING_DEFINITION_MISSING（写库之前拒绝）", async () => {
    await expect(adminCaller.strategyDomain.authoring.saveDraft({
      document: { strategyId: "x", version: "1.0.0", name: "x", universe: { universeId: "u" } },
      origin: { kind: "BLANK_CANONICAL", presetRefs: [] },
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("AUTHORING_DEFINITION_MISSING") });
  });
});