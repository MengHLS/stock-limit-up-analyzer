/**
 * PARAMETER-002 §8/§9/§10 — Parameter Search **有效性**回归测试。
 *
 * | 组 | 覆盖 |
 * |----|------|
 * | 死参数（N-02） | 规则图引用面缺省 ⇒ 不筛查；提供 ⇒ 未引用的 TUNABLE 被排除且原因可读；`excludeUnreferencedDomains` 剥离搜索域 |
 * | 覆盖顺序守卫 | 「派生 → 覆盖 → 死参数剥离」的顺序：覆盖**不能**把死参数塞回搜索域 |
 * | 窗口前置校验（N-01） | 合法窗口通过；起止倒挂 / 起早于数据集 / 止晚于数据集 各带独立领域码，且错误信息含两个窗口 |
 * | 派生器单一（N-05） | **静态源码守卫**：`server/research/parameterSearch/**` 不得 import 旧派生器；旧派生器必须带 `LEGACY / PREVIEW` 标记 |
 * | 契约 | 创建回执新增字段可选（历史消费方不炸） |
 *
 * 🔴 真机全链（真策略版本 + 真数据集 + 真回测 + 真 tRPC）由
 *   `docs/evidence/_e2e_param002_parameter_effect.mts` 承担 —— 单测与它互补，不重复。
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StrategyParameterProjectionRow } from "../../../../server/research/strategySchema/projection";
import {
  applySearchDomainOverrides,
  deriveParameterSearchSpaceFromProjection,
  excludeUnreferencedDomains,
  summarizeParameterSearchSpace,
  validateParameterSearchSpace,
} from "../../../../server/research/parameterSearch/searchSpace";
import { assertSearchWindowWithinDataset } from "../../../../server/research/parameterSearch/executor";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function row(code: string, ordinal: number): StrategyParameterProjectionRow {
  return {
    code,
    name: code,
    dataType: "number",
    parameterRole: "TUNABLE",
    defaultValueJson: "1",
    minValue: 1,
    maxValue: 5,
    stepValue: 1,
    unit: null,
    description: null,
    required: true,
    ordinal,
  };
}

const THREE_TUNABLE = [row("alpha", 0), row("beta", 1), row("gamma", 2)];

function derive(referenced?: readonly string[]) {
  return deriveParameterSearchSpaceFromProjection({
    strategyId: "s",
    strategyVersion: "1.0.0",
    parameters: THREE_TUNABLE,
    ...(referenced === undefined ? {} : { referencedParameterCodes: new Set(referenced) }),
  });
}

// ---------------------------------------------------------------------------
// 死参数（N-02）
// ---------------------------------------------------------------------------

describe("PARAMETER-002 §8 — 死参数（规则图未引用）筛查", () => {
  it("未提供引用面 ⇒ 不做筛查，并在结果里如实标注 referenceCheckApplied = false", () => {
    const derivation = derive();
    expect(derivation.referenceCheckApplied).toBe(false);
    expect(derivation.unreferencedTunableCodes).toEqual([]);
    expect(summarizeParameterSearchSpace(derivation.definition).searchable).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    // 必须有一条明确的「未筛查」说明（禁静默）
    expect(derivation.notes.some((note) => note.includes("未做死参数筛查"))).toBe(true);
  });

  it("提供引用面 ⇒ 未被引用的 TUNABLE 被排除，且排除原因点名「规则图未引用」", () => {
    const derivation = derive(["beta"]);
    expect(derivation.referenceCheckApplied).toBe(true);
    expect(derivation.unreferencedTunableCodes).toEqual(["alpha", "gamma"]);
    const summary = summarizeParameterSearchSpace(derivation.definition);
    expect(summary.searchable).toEqual(["beta"]);
    expect(summary.excluded.map((item) => item.name).sort()).toEqual(["alpha", "gamma"]);
    for (const item of summary.excluded) {
      expect(item.reason).toContain("规则图未引用");
    }
  });

  it("引用面为空集合 ⇒ 三个 TUNABLE 全被排除（= 实测 cand-360001 的形态）", () => {
    const derivation = derive([]);
    expect(derivation.referenceCheckApplied).toBe(true);
    expect(derivation.unreferencedTunableCodes).toEqual(["alpha", "beta", "gamma"]);
    expect(summarizeParameterSearchSpace(derivation.definition).searchable).toEqual([]);
  });

  it("排除项**不产生** `TUNABLE 缺少搜索域` 校验错误（那是刻意排除，原因已登记）", () => {
    const derivation = derive(["beta"]);
    const result = validateParameterSearchSpace(derivation.definition);
    expect(result.valid).toBe(true);
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      "PARAMETER_SEARCH_TUNABLE_WITHOUT_DOMAIN",
    );
  });

  it("🔴 但「TUNABLE 无搜索域且无 exclusionReason」仍然是错误（真的配置缺失）", () => {
    const result = validateParameterSearchSpace({
      recordKind: "PARAMETER_SEARCH_SPACE",
      recordVersion: 1,
      strategyId: "s",
      strategyVersion: "1",
      parameters: [{ name: "alpha", type: "number", kind: "TUNABLE", required: true }],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "PARAMETER_SEARCH_TUNABLE_WITHOUT_DOMAIN",
    );
  });

  it("`excludeUnreferencedDomains` 剥离搜索域、保留 kind、写清原因", () => {
    const definition = derive().definition;
    const stripped = excludeUnreferencedDomains(definition, new Set(["beta"]));
    const beta = stripped.parameters.find((item) => item.name === "beta");
    expect(beta?.kind).toBe("TUNABLE");
    expect(beta?.search).toBeUndefined();
    expect(beta?.exclusionReason).toContain("规则图未引用");
    // 未在集合里的参数不受影响
    expect(stripped.parameters.find((item) => item.name === "alpha")?.search).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 覆盖顺序守卫（「派生 → 覆盖 → 死参数剥离」）
// ---------------------------------------------------------------------------

describe("PARAMETER-002 §8 — 覆盖不得把死参数塞回搜索空间（顺序守卫）", () => {
  it("先覆盖后剥离：覆盖为死参数赋的搜索域会被剥掉（这正是实测踩到的洞）", () => {
    const definition = derive(["beta"]).definition;
    const overridden = applySearchDomainOverrides(definition, [
      { name: "alpha", domain: { mode: "DECIMAL_RANGE", min: 0, max: 1, step: 0.5 } },
    ]);
    // 覆盖本身「成功」（它只管分类与形状，不管引用面）
    expect(overridden.issues).toEqual([]);
    expect(summarizeParameterSearchSpace(overridden.definition).searchable).toContain("alpha");
    // 剥离必须在覆盖之后应用 ⇒ alpha 被移除
    const stripped = excludeUnreferencedDomains(overridden.definition, new Set(["alpha"]));
    expect(summarizeParameterSearchSpace(stripped).searchable).toEqual(["beta"]);
  });

  it("覆盖为死参数赋 FIXED（单值）⇒ 剥离后不进搜索空间，也不报错", () => {
    const definition = derive(["beta"]).definition;
    const overridden = applySearchDomainOverrides(definition, [
      { name: "alpha", domain: { mode: "FIXED", value: 0.02 } },
    ]);
    const stripped = excludeUnreferencedDomains(overridden.definition, new Set(["alpha"]));
    expect(summarizeParameterSearchSpace(stripped).searchable).toEqual(["beta"]);
  });
});

// ---------------------------------------------------------------------------
// 窗口前置校验（N-01）
// ---------------------------------------------------------------------------

describe("PARAMETER-002 §9（N-01）— 搜索窗口前置校验", () => {
  const datasetWindow = { startDate: "2024-09-01", endDate: "2026-09-01" };

  it("窗口落在数据集窗口内 ⇒ 通过（含两端）", () => {
    expect(() =>
      assertSearchWindowWithinDataset({ startDate: "2025-01-02", endDate: "2025-02-28", datasetWindow }),
    ).not.toThrow();
    expect(() =>
      assertSearchWindowWithinDataset({
        startDate: datasetWindow.startDate,
        endDate: datasetWindow.endDate,
        datasetWindow,
      }),
    ).not.toThrow();
  });

  it("起止倒挂 ⇒ PARAMETER_SEARCH_WINDOW_INVALID", () => {
    expect(() =>
      assertSearchWindowWithinDataset({ startDate: "2025-03-01", endDate: "2025-01-01", datasetWindow }),
    ).toThrow(/PARAMETER_SEARCH_WINDOW_INVALID/);
  });

  it("起早于数据集 ⇒ PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE，且信息含两个窗口", () => {
    let message = "";
    try {
      assertSearchWindowWithinDataset({ startDate: "2020-01-01", endDate: "2025-02-28", datasetWindow });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE");
    expect(message).toContain("requested window = 2020-01-01..2025-02-28");
    expect(message).toContain("dataset window = 2024-09-01..2026-09-01");
  });

  it("止晚于数据集 ⇒ 同样被拒且信息含两个窗口", () => {
    let message = "";
    try {
      assertSearchWindowWithinDataset({ startDate: "2025-01-02", endDate: "2027-01-01", datasetWindow });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("PARAMETER_SEARCH_WINDOW_OUT_OF_DATASET_RANGE");
    expect(message).toContain("requested window = 2025-01-02..2027-01-01");
    expect(message).toContain("dataset window = 2024-09-01..2026-09-01");
  });
});

// ---------------------------------------------------------------------------
// 派生器单一（N-05）
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const PARAM_SEARCH_DIR = join(REPO_ROOT, "server", "research", "parameterSearch");
const LEGACY_DERIVATOR = join(
  REPO_ROOT,
  "server",
  "research",
  "strategyEvaluation",
  "parameterSpaceFromDocument.ts",
);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("PARAMETER-002 §10（N-05）— 生产路径的 Parameter Space 派生器收敛状态", () => {
  it("🔴 静态守卫：`server/research/parameterSearch/**` 不得 import 旧派生器（回退即变红）", () => {
    const violations: string[] = [];
    for (const file of listFiles(PARAM_SEARCH_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
        const spec = match[1] as string;
        if (spec.includes("parameterSpaceFromDocument")) violations.push(`${file} → ${spec}`);
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("🔴 静态守卫：`executor.ts` 必须使用 role-aware 派生器（而不是「谁都没用」）", () => {
    const text = readFileSync(join(PARAM_SEARCH_DIR, "executor.ts"), "utf8");
    expect(text).toContain("deriveParameterSearchSpaceFromProjection");
  });

  it("旧派生器必须带 `LEGACY / PREVIEW` 标记并写明「谁还在用」", () => {
    const text = readFileSync(LEGACY_DERIVATOR, "utf8");
    expect(text).toContain("LEGACY / PREVIEW");
    // 两个真实消费者必须在注释里点名（防止有人把它当死代码删掉）
    expect(text).toContain("paramSearchRouter.ts");
    expect(text).toContain("closedLoopWiring/executors.ts");
  });

  it("新派生器仍是唯一「读 parameterRole」的搜索空间派生实现", () => {
    const text = readFileSync(join(PARAM_SEARCH_DIR, "searchSpace.ts"), "utf8");
    expect(text).toContain("PARAMETER_SEARCH_SEARCHABLE_ROLE");
    // 判据必须收敛到一个函数（不得在别处内联比较 TUNABLE）
    expect(text).toContain("isSearchableStrategyParameter");
  });
});
