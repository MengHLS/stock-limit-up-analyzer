/**
 * BD-21 — `requireRecipe` 路径 3（兜底到默认配方）必须**留痕**。
 *
 * ## 原缺陷（`STRATEGY-RESEARCH-BRIDGE-001` 登记，2026-09-21 修复）
 *
 * `assemble.ts#requireRecipe` 有三条路径；第三条是「文档既没有 `recipe`、
 * 也没有 `definition.entry.conditions`」⇒ 装配层落到 `DEFAULT_STRATEGY_RECIPE_ID`
 * （`leader-candidate-baseline` = 「按涨跌幅取前 5 名」）。
 *
 * 问题不在「有兜底」，而在**兜底被标成了 `explicit-request`** —— 与「调用方显式
 * 指定了 recipeId」**共用同一个来源值**。后果：
 *   - 「有人明确要求按这个配方跑」与「文档什么都没声明、系统自己顶上来的」在审计摘要里
 *     **长得一模一样**；
 *   - 后者是**静默换规则**：产物看起来完全正常，跑的规则却与策略文档无关。
 *     参数搜索会把结果记在一个**根本没被执行**的策略定义名下。
 *
 * ⚠️ 这不是假设：库中现有 2 份 `limit-up-baseline` 文档走的**正是**这条路径
 *    （见 `assemble.ts` 请求字段注释 2026-09-17 实查）。
 *
 * ## 本文件钉住的判据
 *   A. 路径 3 + 无显式 recipeId ⇒ `recipeSource = "default-fallback"` **且**打一条留痕日志；
 *   B. 路径 3 + 有显式 recipeId ⇒ `recipeSource = "explicit-request"` **且不打**该日志；
 *   C. **判别力（可证伪）**：A / B 两种情形必须给出**不同**的来源值 —— 若有人把兜底改回
 *      `explicit-request`，本条立即变红（这正是本文件存在的理由）；
 *   D. 契约同步哨兵：`shared/researchContracts.ts` 的 zod 闭集必须**逐字**含这四个值，
 *      否则 tRPC `.output()` 会在生产上拒值（类型对、运行时炸）。
 *
 * 🔴 本文件**不** mock DB：`assembleStrategySide` 是**纯装配**（不碰数据集），
 *    传一份内存策略文档即可，属最快的真判据。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { closedLoopRunResultSchema } from "@shared/researchContracts";
import type { CostModel } from "../../../server/engine/domain";
import { createStrategyDocument } from "../../../server/research/strategySchema/map";
import type {
  StrategyDocument,
  StrategyDocumentInput,
} from "../../../server/research/strategySchema/types";
import {
  assembleStrategySide,
  type AssembleRunWorkbenchInputsRequest,
} from "../../../server/runWorkbenchAssembly/assemble";

const DATASET_VERSION_LABEL = "rd-1.0.0-1-cffc2a0e66efbf0b";

const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

/**
 * 一份**既无 `recipe` 也无 `definition.entry.conditions`** 的策略文档
 * —— 即 `requireRecipe` 路径 3 的触发形状（与库中 `limit-up-baseline` 同形）。
 *
 * ⚠️ 只给 legacy `entryRules`（`DeclaredRule`）**不构成**「声明式条件」：
 *    路径 2 判的是 `definition.entry.conditions`（`ConditionDefinition[]`），
 *    两者是**不同字段**，不可互相顶替（否则本测试会走进路径 2 而不是路径 3）。
 */
function makeDocInput(overrides: Partial<StrategyDocumentInput> = {}): StrategyDocumentInput {
  return {
    strategyId: "bd21-fallback-probe",
    version: "1.0.0",
    name: "BD-21 兜底路径探针策略",
    description: "无 recipe、无声明式条件 ⇒ 必然走 requireRecipe 路径 3",
    universe: { universeId: `research-dataset:${DATASET_VERSION_LABEL}` },
    entryRules: [
      {
        id: "enter-topN",
        kind: "threshold",
        field: "candidate.rank",
        operator: "<=",
        operand: 5,
        description: "候选排名 <= 5 进场（legacy 规则，不是声明式条件）",
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
    parameters: { parameters: [] },
    datasetVersion: DATASET_VERSION_LABEL,
    executionAssumptions: {
      backtestConfig: { initialCapital: 100_000, maxPositions: 5 },
      costModel: COST_MODEL,
      executionModel: "NEXT_OPEN",
    },
    ...overrides,
  };
}

function makeDocument(overrides: Partial<StrategyDocumentInput> = {}): StrategyDocument {
  return createStrategyDocument(makeDocInput(overrides));
}

function makeRequest(
  document: StrategyDocument,
  recipeId?: string,
): AssembleRunWorkbenchInputsRequest {
  return {
    strategyId: document.strategyId,
    strategyVersion: document.version,
    startDate: "2025-01-02",
    endDate: "2025-03-31",
    createdAt: "2026-09-21T00:00:00.000Z",
    codeVersion: "bd21-test",
    strategyDocument: document,
    ...(recipeId !== undefined ? { recipeId } : {}),
  };
}

/** 静音并捕获 `console.warn`（返回捕获到的完整消息数组）。 */
function captureWarn(): string[] {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  // 用 spy 的 mock.calls 而不是闭包数组：`restoreAllMocks` 后仍可取用返回值
  (spy as unknown as { __msgs: string[] }).__msgs = [];
  spy.mockImplementation((...args: unknown[]) => {
    (spy as unknown as { __msgs: string[] }).__msgs.push(args.map(String).join(" "));
  });
  return (spy as unknown as { __msgs: string[] }).__msgs;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BD-21 — requireRecipe 路径 3 兜底留痕", () => {
  it("A. 无 recipe 且无条件 ⇒ recipeSource = default-fallback，并打一条留痕日志", () => {
    const msgs = captureWarn();
    const document = makeDocument();

    const side = assembleStrategySide(makeRequest(document), "ds-bd21-a");

    expect(side.recipeSource).toBe("default-fallback");
    // 兜底落到哪个配方仍必须可见（recipeSource 与 recipeId 共同构成溯源）
    expect(side.recipeRuntime.recipeId).toBe("leader-candidate-baseline");
    // 留痕：一条日志，且含策略身份与来源值
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("default-fallback");
    expect(msgs[0]).toContain(`${document.strategyId}@${document.version}`);
    expect(msgs[0]).toContain("leader-candidate-baseline");
  });

  it("B. 调用方显式指定 recipeId ⇒ explicit-request，且**不打**留痕日志（两者必须可区分）", () => {
    const msgs = captureWarn();
    const document = makeDocument();

    const side = assembleStrategySide(
      makeRequest(document, "leader-candidate-baseline"),
      "ds-bd21-b",
    );

    expect(side.recipeSource).toBe("explicit-request");
    expect(msgs).toHaveLength(0);
  });

  it("C. 判别力（可证伪）：兜底 与 显式指定 必须给出**不同**的来源值", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const document = makeDocument();

    const fallback = assembleStrategySide(makeRequest(document), "ds-bd21-c1");
    const explicit = assembleStrategySide(
      makeRequest(document, "leader-candidate-baseline"),
      "ds-bd21-c2",
    );

    // 🔴 本断言是**回归哨兵**：若有人把兜底改回 explicit-request，
    //    「静默换规则」会立刻重新隐身，而本行会变红。
    expect(fallback.recipeSource).not.toBe(explicit.recipeSource);
    expect(new Set([fallback.recipeSource, explicit.recipeSource])).toEqual(
      new Set(["default-fallback", "explicit-request"]),
    );
    // 两者落到的**配方**相同（都是默认配方）—— 差别只在「谁要求的」，这正是修复点
    expect(fallback.recipeRuntime.recipeId).toBe(explicit.recipeRuntime.recipeId);
  });

  it("D. 契约同步哨兵：tRPC zod 闭集必须逐字含四值（否则生产上 .output() 拒值）", () => {
    const options = recipeSourceEnumOptions();
    expect(options).toEqual([
      "strategy-document",
      "strategy-declarative-conditions",
      "explicit-request",
      "default-fallback",
    ]);
  });
});

/**
 * 从 `closedLoopRunResultSchema` 里取出 `assembly.recipeSource` 的 zod `.options`。
 *
 * ⚠️ 不做类型断言穿透 zod 内部结构的原因：zod 版本升级会改属性名，
 *    那样测试会以「读不到」而非「值不对」失败 —— 前者噪声大、后者是真信号。
 *    这里显式两条路径（nullable 与非 nullable），读不到就**响亮抛错**。
 */
function recipeSourceEnumOptions(): readonly string[] {
  type WithShape = { shape: Record<string, { options?: readonly string[] }> };
  const assembly = closedLoopRunResultSchema.shape.assembly as unknown as
    | WithShape
    | { unwrap: () => WithShape };

  const inner: WithShape =
    typeof (assembly as { unwrap?: unknown }).unwrap === "function"
      ? (assembly as { unwrap: () => WithShape }).unwrap()
      : (assembly as WithShape);

  const enumSchema = inner.shape["recipeSource"];
  if (enumSchema === undefined || enumSchema.options === undefined) {
    throw new Error(
      "契约读取失败：closedLoopRunResultSchema.assembly 中找不到 recipeSource 的 zod 枚举 .options",
    );
  }
  return enumSchema.options;
}
