/**
 * `StrategyRecipeRuntime.resolveParameters(schema, overrides?)` 单测 —— STEP B 落点① 的前置改造。
 *
 * 为什么值得单独锁死：这个函数是「参数搜索 / 走查 / 稳健性检验」能否跑在**策略文档**上的总开关。
 * 在加 `overrides` 之前，调用方**无法**在同一份策略上换参数 ⇒ 那些功能只能另接一套 legacy 回测
 * （审计报告 P0-2）。而放开覆写时最容易犯、也最危险的错是**未知维度静默忽略** ——
 * 那会让调用方以为某维度参与了寻优、实际却被丢掉，**产物看起来完全正常**。
 * ⇒ 本文件把「不认识就喊」钉成硬约束。
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_RECIPE_ID, resolveStrategyRecipeById } from "../../../server/research/recipeRegistry";
import { StrategyRecipeRuntimeError } from "../../../server/research/recipeErrors";
import type { ResearchParameterSchema } from "../../../server/research/types";

const runtime = resolveStrategyRecipeById(DEFAULT_STRATEGY_RECIPE_ID);

const SCHEMA: ResearchParameterSchema = {
  parameters: [
    { name: "topN", type: "number", required: false, defaultValue: 5 },
    { name: "minScore", type: "number", required: false, defaultValue: 0.1 },
    { name: "allowNull", type: "number", required: false, defaultValue: 7, nullable: true },
  ],
};

const SCHEMA_NO_DEFAULT: ResearchParameterSchema = {
  parameters: [{ name: "mustProvide", type: "number", required: true }],
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof StrategyRecipeRuntimeError ? error.code : `UNEXPECTED:${String(error)}`;
  }
  return "NO_ERROR";
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("resolveParameters —— 无覆写时与既往完全一致", () => {
  it("全取 defaultValue", () => {
    expect(runtime.resolveParameters(SCHEMA)).toEqual({ topN: 5, minScore: 0.1, allowNull: 7 });
  });

  it("空 schema ⇒ 空参数集", () => {
    expect(runtime.resolveParameters({ parameters: [] })).toEqual({});
  });

  it("参数缺 defaultValue ⇒ RECIPE_PARAMETER_NO_DEFAULT", () => {
    expect(codeOf(() => runtime.resolveParameters(SCHEMA_NO_DEFAULT))).toBe("RECIPE_PARAMETER_NO_DEFAULT");
  });
});

describe("resolveParameters —— 覆写生效", () => {
  it("覆写值优先于 defaultValue", () => {
    expect(runtime.resolveParameters(SCHEMA, { topN: 3 })).toEqual({ topN: 3, minScore: 0.1, allowNull: 7 });
  });

  it("可同时覆写多个参数（参数搜索的组合语义）", () => {
    expect(runtime.resolveParameters(SCHEMA, { topN: 3, minScore: 0.5 })).toEqual({
      topN: 3,
      minScore: 0.5,
      allowNull: 7,
    });
  });

  it("覆写值 0 一律生效（不被真值判断吃掉）", () => {
    expect(runtime.resolveParameters(SCHEMA, { topN: 0 })).toEqual({ topN: 0, minScore: 0.1, allowNull: 7 });
  });

  it("nullable 参数覆写为 null ⇒ 保留 null（不退化成 defaultValue）", () => {
    expect(runtime.resolveParameters(SCHEMA, { allowNull: null }).allowNull).toBeNull();
  });

  it("覆写能解掉「schema 无 defaultValue」的死局", () => {
    expect(runtime.resolveParameters(SCHEMA_NO_DEFAULT, { mustProvide: 3 })).toEqual({ mustProvide: 3 });
  });

  it("空覆写对象 = 无覆写", () => {
    expect(runtime.resolveParameters(SCHEMA, {})).toEqual({ topN: 5, minScore: 0.1, allowNull: 7 });
  });
});

describe("🔴 未知覆写参数必须响亮拒绝（「未收录维度被静默忽略」这条缺陷的对症修法）", () => {
  it("未声明的参数名 ⇒ RECIPE_PARAMETER_UNKNOWN", () => {
    expect(codeOf(() => runtime.resolveParameters(SCHEMA, { notDeclared: 1 }))).toBe("RECIPE_PARAMETER_UNKNOWN");
  });

  it("即使同时给了合法覆写，只要含未知键就整体拒绝（不静默丢弃未知键）", () => {
    expect(codeOf(() => runtime.resolveParameters(SCHEMA, { topN: 3, ghost: 9 }))).toBe("RECIPE_PARAMETER_UNKNOWN");
  });

  it("空 schema 下任何覆写都算未知 ⇒ 拒绝", () => {
    expect(codeOf(() => runtime.resolveParameters({ parameters: [] }, { anything: 1 }))).toBe(
      "RECIPE_PARAMETER_UNKNOWN",
    );
  });

  it("错误消息点出未知键名与已声明清单（调用方可直接照着改）", () => {
    const message = messageOf(() => runtime.resolveParameters(SCHEMA, { ghost: 9 }));
    expect(message).toContain("ghost");
    expect(message).toContain("topN");
  });
});
