/**
 * createExperimentForm 测试。
 *
 * 重点：**不推荐不可用版本**。真实 DB 上 `first_limit_pullback` 只有 v1(390001) 是 READY，
 * v2(390002) 长期停在 BUILDING；引擎对非 READY 版本会抛 `DATASET_VERSION_NOT_READY`。
 * 所以「默认选中一个不可用版本」是要被单测挡住的缺陷。
 */

import { describe, expect, it } from "vitest";
import {
  RESEARCH_TYPE_OPTIONS,
  createDefaultExperimentForm,
  isUsableVersionStatus,
  recommendVersionId,
  suggestHypothesisName,
  toExperimentInput,
  toHypothesisInput,
  validateExperimentForm,
  type CreateExperimentFormState,
  type VersionOptionLike,
} from "./createExperimentForm";

const READY_V1: VersionOptionLike = {
  id: 390001,
  version: "v1",
  status: "READY",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  totalEvents: 1130,
};
const BUILDING_V2: VersionOptionLike = {
  id: 390002,
  version: "v2",
  status: "BUILDING",
  startDate: "2026-09-01",
  endDate: "2026-09-01",
  totalEvents: null,
};

function state(overrides: Partial<CreateExperimentFormState> = {}): CreateExperimentFormState {
  return {
    ...createDefaultExperimentForm(),
    datasetId: "120001",
    datasetVersionId: "390001",
    name: "首板换手率与未来5日收益研究",
    ...overrides,
  };
}

describe("createExperimentForm — 枚举与常量", () => {
  it("研究类型选项穷尽后端 ResearchType（8 种）且不重复", () => {
    expect(RESEARCH_TYPE_OPTIONS).toHaveLength(8);
    expect(new Set(RESEARCH_TYPE_OPTIONS.map((o) => o.value)).size).toBe(8);
    expect(RESEARCH_TYPE_OPTIONS.map((o) => o.value)).toContain("FEATURE");
  });

  it("只有 READY 是可研究状态", () => {
    expect(isUsableVersionStatus("READY")).toBe(true);
    for (const s of ["DRAFT", "BUILDING", "FAILED", "CANCELLED"]) {
      expect(isUsableVersionStatus(s)).toBe(false);
    }
  });
});

describe("createExperimentForm — 版本推荐", () => {
  it("在 READY 中选事件数最多的", () => {
    const versions = [
      { ...BUILDING_V2 },
      { ...READY_V1, id: 3, totalEvents: 50 },
      { ...READY_V1, id: 4, totalEvents: 900 },
    ];
    expect(recommendVersionId(versions)).toBe(4);
  });

  it("没有任何 READY 版本时返回 null（绝不推荐不可用版本）", () => {
    expect(recommendVersionId([BUILDING_V2])).toBeNull();
    expect(recommendVersionId([])).toBeNull();
  });

  it("事件数缺失时不崩，退化为取 id 最大", () => {
    const versions = [
      { id: 10, version: "v1", status: "READY", totalEvents: null },
      { id: 11, version: "v2", status: "READY", totalEvents: null },
    ];
    expect(recommendVersionId(versions)).toBe(11);
  });
});

describe("createExperimentForm — 校验", () => {
  it("未选数据集直接返回", () => {
    const errors = validateExperimentForm(createDefaultExperimentForm(), {
      versions: [READY_V1],
      definitionSelected: false,
    });
    expect(errors).toEqual(["请先选择数据集"]);
  });

  it("合法表单通过", () => {
    expect(
      validateExperimentForm(state(), { versions: [READY_V1, BUILDING_V2], definitionSelected: true }),
    ).toEqual([]);
  });

  it("选中的版本不属于当前数据集 → 明确报错", () => {
    const errors = validateExperimentForm(state({ datasetVersionId: "999" }), {
      versions: [READY_V1],
      definitionSelected: true,
    });
    expect(errors.join(" ")).toContain("不属于当前数据集");
  });

  it("选中非 READY 版本 → 报出真实状态，而不是笼统「不可用」", () => {
    const errors = validateExperimentForm(state({ datasetVersionId: "390002" }), {
      versions: [READY_V1, BUILDING_V2],
      definitionSelected: true,
    });
    expect(errors.join(" ")).toContain("BUILDING");
    expect(errors.join(" ")).toContain("READY");
  });

  it("数据集下无任何版本 与 有版本但都不可用 → 提示文案不同", () => {
    const noVersion = validateExperimentForm(state({ datasetVersionId: "" }), {
      versions: [],
      definitionSelected: true,
    });
    expect(noVersion.join(" ")).toContain("还没有任何版本");

    const noReady = validateExperimentForm(state({ datasetVersionId: "" }), {
      versions: [BUILDING_V2],
      definitionSelected: true,
    });
    expect(noReady.join(" ")).toContain("没有 READY 状态的版本");
  });

  it("名称必填且有长度上限", () => {
    expect(
      validateExperimentForm(state({ name: "  " }), { versions: [READY_V1], definitionSelected: true }),
    ).toContain("请填写实验名称");
    expect(
      validateExperimentForm(state({ name: "x".repeat(201) }), {
        versions: [READY_V1],
        definitionSelected: true,
      }).join(" "),
    ).toContain("200");
  });

  it("假设必须成对填写（半填会污染结论链路）", () => {
    const onlyStatement = validateExperimentForm(
      state({ hypothesisName: "", hypothesisStatement: "换手率越高收益越低。" }),
      { versions: [READY_V1], definitionSelected: true },
    );
    expect(onlyStatement.join(" ")).toContain("请同时填写假设名称");

    const onlyName = validateExperimentForm(state({ hypothesisName: "H1", hypothesisStatement: "" }), {
      versions: [READY_V1],
      definitionSelected: true,
    });
    expect(onlyName.join(" ")).toContain("请同时填写假设陈述");

    const both = validateExperimentForm(
      state({ hypothesisName: "H1", hypothesisStatement: "换手率越高收益越低。" }),
      { versions: [READY_V1], definitionSelected: true },
    );
    expect(both).toEqual([]);
  });
});

describe("createExperimentForm — payload", () => {
  it("description 为空时不发送空字符串（让后端落 NULL 而不是 ''）", () => {
    const input = toExperimentInput(state({ description: "   " }));
    expect("description" in input).toBe(false);
    expect(toExperimentInput(state({ description: " 说明 " })).description).toBe("说明");
  });

  it("datasetVersionId 转成 number", () => {
    expect(toExperimentInput(state()).datasetVersionId).toBe(390001);
  });

  it("假设项为空时返回 null（调用方跳过创建）", () => {
    expect(toHypothesisInput(state(), 12)).toBeNull();
    expect(
      toHypothesisInput(state({ hypothesisName: "H1", hypothesisStatement: "陈述" }), 12),
    ).toEqual({ experimentId: 12, name: "H1", statement: "陈述" });
  });

  it("从陈述生成默认假设名：取首句 + 截断", () => {
    expect(suggestHypothesisName("换手率越高收益越低。第二句。")).toBe("换手率越高收益越低");
    expect(suggestHypothesisName("")).toBe("假设 1");
    expect(suggestHypothesisName("x".repeat(100)).endsWith("…")).toBe(true);
    expect(suggestHypothesisName("x".repeat(100)).length).toBe(58);
  });
});
