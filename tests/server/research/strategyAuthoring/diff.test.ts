/**
 * SCOPE-002 §2.3 A6（裁定 Q3）—— `diffAgainstVersion` 纯函数单测。
 *
 * 覆盖：等价判定 / 缺字段 / 多字段 / 值不同 / 数组长度 / 路径转义 / 确定性 / 防"两侧都缺"。
 * 不触 DB、不起服务。
 */
import { describe, expect, it } from "vitest";
import { diffAgainstVersion, type StrategyAuthoringGolden } from "../../../../server/research/strategyAuthoring/diff";
import { GOLDEN_3570001 } from "./golden3570001";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pathOf(differences: readonly { readonly path: string }[]): string[] {
  return differences.map(d => d.path);
}

describe("diffAgainstVersion", () => {
  it("同一份文档与 golden 比较 ⇒ equal，且确实比较到了叶子（不是空比空）", () => {
    const result = diffAgainstVersion({ document: clone(GOLDEN_3570001), target: GOLDEN_3570001 });
    expect(result.differences).toEqual([]);
    expect(result.equal).toBe(true);
    expect(result.comparedPaths).toBeGreaterThan(50);
  });

  it("document 完全没有 definition ⇒ 不等价，差异落在 /definition", () => {
    const result = diffAgainstVersion({ document: {}, target: GOLDEN_3570001 });
    expect(result.equal).toBe(false);
    expect(result.differences.some(d => d.path === "/definition" && d.kind === "VALUE")).toBe(true);
  });

  it("嵌套值不同 ⇒ 精确报出 JSON Pointer 路径与左右值", () => {
    const doc = clone(GOLDEN_3570001) as unknown as { definition: { exit: { rules: { policy: { runnerBridge: { decisionHoldingDays: number } } }[] } }; recipe: unknown };
    doc.definition.exit.rules[0]!.policy.runnerBridge.decisionHoldingDays = 7;
    const result = diffAgainstVersion({ document: doc, target: GOLDEN_3570001 });
    const hit = result.differences.find(d => d.path === "/definition/exit/rules/0/policy/runnerBridge/decisionHoldingDays");
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe("VALUE");
    expect(hit?.left).toBe(7);
    expect(hit?.right).toBe(5);
  });

  it("本次文档多出一个键 ⇒ EXTRA；少一个键 ⇒ MISSING", () => {
    const doc = clone(GOLDEN_3570001) as unknown as { definition: Record<string, unknown>; recipe: unknown };
    doc.definition.extraFlag = true;
    delete doc.definition.risk;
    const result = diffAgainstVersion({ document: doc, target: GOLDEN_3570001 });
    expect(result.differences).toContainEqual({ path: "/definition/extraFlag", left: true, right: undefined, kind: "EXTRA" });
    expect(result.differences).toContainEqual({ path: "/definition/risk", left: undefined, right: GOLDEN_3570001.definition && (GOLDEN_3570001.definition as Record<string, unknown>).risk, kind: "MISSING" });
  });

  it("数组长度不同 ⇒ 下标级别报 MISSING / EXTRA", () => {
    const doc = clone(GOLDEN_3570001) as unknown as { definition: { datasets: unknown[] }; recipe: unknown };
    doc.definition.datasets.push({ role: "SECONDARY", datasetVersionId: 1 });
    const result = diffAgainstVersion({ document: doc, target: GOLDEN_3570001 });
    expect(result.differences.some(d => d.path === "/definition/datasets/1" && d.kind === "EXTRA")).toBe(true);
  });

  it("JSON Pointer 转义：键名含 / 或 ~ 时按 RFC 6901 输出", () => {
    const target: StrategyAuthoringGolden = { definition: { "a/b": 1, "c~d": 2 }, recipe: null };
    const result = diffAgainstVersion({ document: { definition: { "a/b": 9, "c~d": 2 }, recipe: null }, target });
    expect(pathOf(result.differences)).toEqual(["/definition/a~1b"]);
  });

  it("确定性：同输入两次调用 ⇒ 差异完全一致且按路径排序", () => {
    const doc = clone(GOLDEN_3570001) as unknown as { definition: Record<string, unknown>; recipe: unknown };
    doc.definition.extraFlag = true;
    delete doc.definition.risk;
    const a = diffAgainstVersion({ document: doc, target: GOLDEN_3570001 });
    const b = diffAgainstVersion({ document: doc, target: GOLDEN_3570001 });
    expect(a.differences).toEqual(b.differences);
    expect(pathOf(a.differences)).toEqual([...pathOf(a.differences)].sort());
  });

  it("recipe 缺失也会被捕获（不只比 definition）", () => {
    const doc = clone(GOLDEN_3570001) as unknown as { definition: unknown; recipe?: unknown };
    delete doc.recipe;
    const result = diffAgainstVersion({ document: doc, target: GOLDEN_3570001 });
    expect(result.equal).toBe(false);
    expect(result.differences.some(d => d.path.startsWith("/recipe"))).toBe(true);
  });
});