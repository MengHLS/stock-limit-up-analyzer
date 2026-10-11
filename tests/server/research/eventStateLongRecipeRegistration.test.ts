/**
 * EVENT-STATE-LONG-EXECUTION-PARITY-001 · S2 配方注册契约测试。
 *
 * 覆盖三件事：
 *   1. **注册即通**：策略文档已声明的 `event-state-long-amp5-top3` 真的在注册表里
 *      （修复前 `requireRecipe` 路径 1 必抛 `RECIPE_NOT_REGISTERED`）；
 *   2. **口径唯一**：recipe 的 `maxAmp5` 特征值 = Strategy Core 注册表里那份定义的值
 *      （本层不重算因子；用测试内独立复算的链式前收定义做三方对拍）；
 *   3. **PIT 边界不被放宽**：rd14 及以前拿不到值、rd16+ 的 bar 不参与计算。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../server/data";
import {
  EVENT_STATE_AMPLITUDE_FEATURE_IDS,
  getDefaultFeatureRegistry,
} from "../../../server/strategyCore";
import { toCoreBarWindow } from "../../../server/strategyCore/production/barWindow";
import {
  buildEventStateAmplitudeFeatureProvider,
} from "../../../server/research/recipeRegistryAtoms";
import {
  projectStrategyRecipe,
  registeredStrategyRecipeIds,
  resolveStrategyRecipe,
} from "../../../server/research/recipeRegistry";
import { StrategyRecipeRuntimeError } from "../../../server/research/recipeErrors";
import type { StrategyRecipe } from "../../../server/research/strategySchema/types";

const RECIPE_ID = "event-state-long-amp5-top3";
const EVENT_CLOSE = 10;

/** 事件日收盘 = 10；rd_i 收盘 = 10 + i*0.1；每根 high/low 距收盘 ±0.2。 */
function barsThroughRd(rd: number): CanonicalMarketBar[] {
  const out: CanonicalMarketBar[] = [];
  for (let i = 0; i <= rd; i += 1) {
    const close = i === 0 ? EVENT_CLOSE : EVENT_CLOSE + i * 0.1;
    out.push({
      symbol: "600000.SH",
      timestamp: "2026-09-" + String(10 + i).padStart(2, "0"),
      open: close,
      high: close + 0.2,
      low: close - 0.2,
      close,
      preClose: i === 0 ? close : EVENT_CLOSE + (i - 1) * 0.1,
      volume: 1_000_000,
      amount: 10_000_000,
      turnoverRate: null,
      adjustment: "raw",
    });
  }
  return out;
}

/** 测试内**独立复算**冻结研究的链式前收定义（不 import 生产实现）。 */
function expectedMaxAmp5(bars: readonly CanonicalMarketBar[]): number | null {
  if (bars.length < 16) return null;
  let runningPreClose = bars[0]!.close as number;
  const amplitudes: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const bar = bars[i]!;
    if (i >= 11 && i <= 15) {
      amplitudes.push(((bar.high as number) - (bar.low as number)) / runningPreClose);
    }
    runningPreClose = bar.close as number;
  }
  return amplitudes.length === 5 ? Math.max(...amplitudes) : null;
}

function providerValue(rd: number): number | null {
  const provider = buildEventStateAmplitudeFeatureProvider(
    EVENT_STATE_AMPLITUDE_FEATURE_IDS.maxAmp5,
    "close",
  );
  return provider.compute({
    data: { bars: barsThroughRd(rd) } as never,
    decisionTime: { date: "2026-09-25", point: "close" },
  } as never);
}

describe("EVENT_STATE_LONG · maxAmp5 Top3 配方注册", () => {
  it("策略文档声明的 recipeId 已在注册表里", () => {
    expect(registeredStrategyRecipeIds()).toContain(RECIPE_ID);
  });

  it("文档声明的可序列化面能解析，且投影与文档字段一致", () => {
    const documentRecipe: StrategyRecipe = {
      kind: "signalEngine",
      recipeId: RECIPE_ID,
      point: "close",
      signalFrequency: "daily",
      signalDescription: "EVENT_STATE_LONG",
      featureVersions: [{ featureId: EVENT_STATE_AMPLITUDE_FEATURE_IDS.maxAmp5, version: "1.0.0" }],
      rankingConfig: { higherIsBetter: false },
      selectionConfig: { method: { kind: "topN", n: 3 } },
      requiredData: ["OHLCV"],
    };
    expect(resolveStrategyRecipe(documentRecipe).recipeId).toBe(RECIPE_ID);
    const projected = projectStrategyRecipe(RECIPE_ID);
    expect(projected.point).toBe(documentRecipe.point);
    expect(projected.signalFrequency).toBe(documentRecipe.signalFrequency);
    expect(projected.featureVersions).toEqual(documentRecipe.featureVersions);
    expect(projected.rankingConfig).toEqual(documentRecipe.rankingConfig);
    expect(projected.selectionConfig).toEqual(documentRecipe.selectionConfig);
  });

  it("特征值 = Strategy Core 同一份定义的值（本层不重算因子）", () => {
    // 与「直接调用 Core 定义」逐值相同 —— 证明适配器只是转接，没有第二套公式。
    // bar 序列 → Core 时间语义必须走唯一转换入口 `toCoreBarWindow`。
    const bars = toCoreBarWindow(barsThroughRd(15)).universe.bars;
    const coreValue = getDefaultFeatureRegistry().get(EVENT_STATE_AMPLITUDE_FEATURE_IDS.maxAmp5)!.compute({
      asOf: { date: "2026-09-25", point: "close" },
      bars,
      eventDayBar: bars[0]!,
      eventField: () => null,
      parameters: {},
    });
    expect(providerValue(15)).toBe(coreValue);
  });

  it("与冻结研究的链式前收定义逐值相同（rd15 完整窗口）", () => {
    const value = providerValue(15);
    expect(value).toBeCloseTo(expectedMaxAmp5(barsThroughRd(15)) as number, 12);
    expect(value).toBeGreaterThan(0);
  });

  it("决策点下界：rd14 及以前返回 null（不臆造完整窗口）", () => {
    for (let rd = 0; rd <= 14; rd += 1) expect(providerValue(rd)).toBeNull();
  });

  it("上限硬截断：rd16+ 的 bar 不改变 rd15 定义的值", () => {
    const at15 = providerValue(15);
    expect(providerValue(16)).toBe(at15);
    expect(providerValue(20)).toBe(at15);
  });

  it("未在 Core 注册的 featureId 在构造期响亮拒绝（不留第二套实现的口子）", () => {
    expect(() => buildEventStateAmplitudeFeatureProvider("maxAmp5DoesNotExist", "close")).toThrowError(
      StrategyRecipeRuntimeError,
    );
    try {
      buildEventStateAmplitudeFeatureProvider("maxAmp5DoesNotExist", "close");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("RECIPE_FEATURE_NOT_PRODUCED");
    }
  });

  it("文档声明了配方未产出的特征 ⇒ resolveStrategyRecipe 拒绝", () => {
    try {
      resolveStrategyRecipe({
        kind: "signalEngine",
        recipeId: RECIPE_ID,
        point: "close",
        signalFrequency: "daily",
        signalDescription: "x",
        featureVersions: [{ featureId: "avgAmp5", version: "1.0.0" }],
        rankingConfig: { higherIsBetter: false },
        selectionConfig: { method: { kind: "topN", n: 3 } },
        requiredData: ["OHLCV"],
      });
      throw new Error("应当拒绝：文档声明了配方未产出的特征");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("RECIPE_FEATURE_VERSION_MISMATCH");
    }
  });
});
