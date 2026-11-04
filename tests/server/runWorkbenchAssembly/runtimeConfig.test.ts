/**
 * 单策略前端回测 — `runtimeConfig` 覆写语义（纯装配，无 DB / 无数据集）。
 *
 * 存在理由：前端「回测配置」面板可以覆写初始资金 / 成本 / 持仓上限 / 执行模型 / 参数。
 * 这些覆写必须**精确**落进装配产物，否则会出现「界面上改了、实际按文档默认跑」的静默口径漂移。
 *
 * 本文件钉住的判据：
 *   1. 覆写优先于策略文档（initialCapital / maxPositions / maxDailyBuys / executionModel）；
 *   2. 成本模型**逐字段**合并：只改一个费率时，其余字段仍取文档声明（禁止整体替换）；
 *   3. 参数覆写生效，且**未知键**响亮抛 `RECIPE_PARAMETER_UNKNOWN`（拒绝静默忽略）；
 *   4. `runtimeOverrides` 摘要如实列出本次真正覆写了哪些字段（空对象 ⇒ 空数组）；
 *   5. 无覆写时行为与既往完全一致（全部取文档声明）。
 *
 * 🔴 走 `assembleStrategySide`（同步纯装配），传内存策略文档即可 —— 最便宜的真判据。
 */

import { describe, expect, it } from "vitest";
import type { CostModel } from "../../../server/engine/domain";
import { createStrategyDocument } from "../../../server/research/strategySchema/map";
import type {
  StrategyDocument,
  StrategyDocumentInput,
} from "../../../server/research/strategySchema/types";
import { StrategyRecipeRuntimeError } from "../../../server/research/recipeErrors";
import {
  LoopRunAssemblyError,
  assembleStrategySide,
  type AssembleRunWorkbenchInputsRequest,
} from "../../../server/runWorkbenchAssembly/assemble";
import type { ClosedLoopRuntimeConfig } from "@shared/researchContracts";

const DATASET_VERSION_LABEL = "rd-1.0.0-1-cffc2a0e66efbf0b";

const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

function makeDocInput(
  overrides: Partial<StrategyDocumentInput> = {},
): StrategyDocumentInput {
  return {
    strategyId: "runtime-config-probe",
    version: "1.0.0",
    name: "运行期覆写探针策略",
    description: "既无 recipe 也无声明式条件",
    universe: { universeId: `research-dataset:${DATASET_VERSION_LABEL}` },
    entryRules: [
      {
        id: "enter-topN",
        kind: "threshold",
        field: "candidate.rank",
        operator: "<=",
        operand: 5,
        description: "候选排名 <= 5 进场",
      },
    ],
    exitRules: [
      {
        id: "exit-holding-days",
        kind: "time-based",
        field: "position.holdingDays",
        operator: ">=",
        operand: 3,
        description: "持有 >= 3 日退出",
      },
    ],
    positionSizing: { kind: "equal-weight", maxPositions: 5 },
    riskRules: [],
    // 给两个参数：一个带数值默认、一个带布尔默认，用于覆写测试。
    parameters: {
      parameters: [
        {
          name: "rankThreshold",
          type: "number",
          required: false,
          defaultValue: 5,
        },
        {
          name: "useStrict",
          type: "boolean",
          required: false,
          defaultValue: false,
        },
      ],
    },
    datasetVersion: DATASET_VERSION_LABEL,
    executionAssumptions: {
      backtestConfig: {
        initialCapital: 100_000,
        maxPositions: 5,
        maxDailyBuys: 2,
      },
      costModel: COST_MODEL,
      executionModel: "NEXT_OPEN",
    },
    ...overrides,
  };
}

function makeDocument(
  overrides: Partial<StrategyDocumentInput> = {},
): StrategyDocument {
  return createStrategyDocument(makeDocInput(overrides));
}

function makeRequest(
  document: StrategyDocument,
  runtimeConfig?: ClosedLoopRuntimeConfig,
): AssembleRunWorkbenchInputsRequest {
  return {
    strategyId: document.strategyId,
    strategyVersion: document.version,
    startDate: "2025-01-02",
    endDate: "2025-03-31",
    createdAt: "2026-09-21T00:00:00.000Z",
    codeVersion: "runtime-config-test",
    strategyDocument: document,
    ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
  };
}

describe("runtimeConfig — 单策略前端覆写语义", () => {
  it("无覆写 ⇒ 全部取文档声明，runtimeOverrides 为空数组", () => {
    const document = makeDocument();
    const side = assembleStrategySide(makeRequest(document), "ds-rc-none");

    expect(side.runtimeOverrides).toEqual([]);
    expect(side.simulationConfig.initialCapital).toBe(100_000);
    expect(side.costModel).toEqual(COST_MODEL);
    expect(side.executionModel).toBe("NEXT_OPEN");
    expect(side.parameterSet).toEqual({ rankThreshold: 5, useStrict: false });
  });

  it("数值覆写优先于文档（initialCapital / maxPositions / maxDailyBuys / 执行模型）", () => {
    const document = makeDocument();
    const side = assembleStrategySide(
      makeRequest(document, {
        initialCapital: 250_000,
        maxPositions: 8,
        maxDailyBuys: 4,
        executionModel: "NEXT_CLOSE",
      }),
      "ds-rc-values",
    );

    expect(side.simulationConfig.initialCapital).toBe(250_000);
    expect(side.simulationConfig.maxPositions).toBe(8);
    expect(side.simulationConfig.maxDailyBuys).toBe(4);
    expect(side.executionModel).toBe("NEXT_CLOSE");
    // 摘要如实列出覆写字段（顺序 = 装配层固定顺序）
    expect(side.runtimeOverrides).toEqual([
      "initialCapital",
      "maxPositions",
      "maxDailyBuys",
      "executionModel",
    ]);
  });

  it("成本模型逐字段合并：只改 slippage 时其余费率仍取文档声明", () => {
    const document = makeDocument();
    const side = assembleStrategySide(
      makeRequest(document, { slippageBps: 25 }),
      "ds-rc-cost",
    );

    expect(side.costModel.slippageBps).toBe(25);
    // 🔴 未覆写的字段必须原样保留（禁止整体替换成本模型）
    expect(side.costModel.commissionRate).toBe(COST_MODEL.commissionRate);
    expect(side.costModel.stampDutyRate).toBe(COST_MODEL.stampDutyRate);
    expect(side.costModel.transferFeeRate).toBe(COST_MODEL.transferFeeRate);
    expect(side.costModel.lotSize).toBe(COST_MODEL.lotSize);
    expect(side.costModel.minCommission).toBe(COST_MODEL.minCommission);
    expect(side.runtimeOverrides).toEqual(["costModel.slippageBps"]);
  });

  it("参数覆写生效（含布尔值）", () => {
    const document = makeDocument();
    const side = assembleStrategySide(
      makeRequest(document, {
        parameterOverrides: { rankThreshold: 3, useStrict: true },
      }),
      "ds-rc-params",
    );

    expect(side.parameterSet).toEqual({ rankThreshold: 3, useStrict: true });
    expect(side.runtimeOverrides).toEqual(["parameterOverrides"]);
  });

  it("未知参数覆写键 ⇒ 响亮抛 RECIPE_PARAMETER_UNKNOWN（拒绝静默忽略）", () => {
    const document = makeDocument();
    expect(() =>
      assembleStrategySide(
        makeRequest(document, {
          parameterOverrides: { notARealParam: 1 },
        }),
        "ds-rc-unknown",
      ),
    ).toThrowError(StrategyRecipeRuntimeError);

    try {
      assembleStrategySide(
        makeRequest(document, {
          parameterOverrides: { notARealParam: 1 },
        }),
        "ds-rc-unknown-2",
      );
    } catch (error) {
      expect((error as StrategyRecipeRuntimeError).code).toBe(
        "RECIPE_PARAMETER_UNKNOWN",
      );
    }
  });

  it("文档身份不一致 ⇒ 拒绝装配（防读错版本）", () => {
    const document = makeDocument();
    const request: AssembleRunWorkbenchInputsRequest = {
      ...makeRequest(document),
      strategyVersion: "9.9.9",
    };
    expect(() => assembleStrategySide(request, "ds-rc-mismatch")).toThrowError(
      LoopRunAssemblyError,
    );
  });
});
