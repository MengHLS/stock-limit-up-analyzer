/**
 * PARAMETER-001-PRE · P0 回归 —— **定义指纹缓存不得改变任何产物**。
 *
 * ## 被测改动
 *
 * `server/strategyCore/runtime.ts`：`evaluateWithDetail` 原先在**每次求值**里调用
 * `computeDefinitionFingerprint(definition)` **两次**（`explanation` 一条 + `decision` 一个）。
 * 实测（`_probe_param001_pre_profile.cpuprofile`，657.8 s 真实 Run）该计算独占 **44.3% CPU**，
 * 因为它对**整份定义**做 canonical JSON + sha256。
 *
 * 改为按 definition 对象身份（`WeakMap`）缓存 + 每次求值只取一次。
 *
 * ## 为什么这是「逐字节等价」而不是「优化近似」
 *
 * `computeDefinitionFingerprint` 是纯函数（无 IO / 无时钟 / 无随机），
 * 且 `StrategyCoreDefinition` 不可变 ⇒ **同一对象必得同一字符串**。
 * 本测试把这条性质钉成断言，覆盖四种退化可能：
 *   ① 同一定义重复求值 ⇒ 指纹稳定；
 *   ② 与「不缓存的唯一实现」逐字节相等（`computeDefinitionFingerprint(version.definition)`）；
 *   ③ 内容相同但**对象不同**的定义 ⇒ 指纹相同（缓存键是身份，不能因身份不同而给出不同值）；
 *   ④ 行为面不同的定义 ⇒ 指纹**必须不同**（缓存不得跨定义串味）。
 */

import { describe, expect, it } from "vitest";
import {
  StrategyRuntime,
  computeDefinitionFingerprint,
  type RuntimeContext,
} from "../../../server/strategyCore";
import { TEST_REGISTRY, barsThrough, eventFields, makePullbackDefinition, makeVersion } from "./_fixtures";

function pullbackBars() {
  return barsThrough(5, {
    0: { open: 10, close: 11, low: 9.9, volume: 1_000_000 },
    1: { open: 10.5, low: 10.2, close: 10.8, volume: 300_000 },
  });
}

function context(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    timestamp: { date: "2026-09-11", point: "close" },
    instrument: { securityId: "sec_test-600001", code: "600001.SH" },
    visibleData: pullbackBars(),
    currentRelativeDay: 1,
    eventFields: eventFields(),
    state: { positionState: "FLAT", openPositions: 0 },
    datasetCapability: {
      frequency: "1D",
      availableFields: ["open", "low", "close", "volume"],
      availableDomains: ["OHLCV"],
      eventTypes: ["FIRST_LIMIT_UP"],
      maxRelativeDay: 5,
      availableHistory: 6,
    },
    resolveEvent: () => true,
    ...overrides,
  };
}

const OPTIONS = { featureRegistry: TEST_REGISTRY } as const;

describe("PARAMETER-001-PRE · P0 定义指纹缓存 —— 产物逐字节不变", () => {
  it("① 同一定义重复求值：指纹稳定，且等于不缓存的唯一实现", () => {
    const version = makeVersion(makePullbackDefinition());
    const expected = computeDefinitionFingerprint(version.definition);
    for (let i = 0; i < 25; i += 1) {
      const decision = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.5 }, context(), OPTIONS);
      expect(decision.definitionFingerprint).toBe(expected);
    }
  });

  it("② explanation 里的 12 位指纹前缀未被改动（用户可见文案零漂移）", () => {
    const version = makeVersion(makePullbackDefinition());
    const expectedPrefix = computeDefinitionFingerprint(version.definition).slice(0, 12);
    const decision = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.5 }, context(), OPTIONS);
    expect(decision.explanation.some((line) => line.includes("定义指纹 " + expectedPrefix + "…"))).toBe(true);
  });

  it("③ 内容相同但对象不同的定义 ⇒ 指纹相同（缓存键是对象身份，不改变取值）", () => {
    const left = makeVersion(makePullbackDefinition());
    const right = makeVersion(makePullbackDefinition());
    expect(left.definition).not.toBe(right.definition);
    const leftDecision = StrategyRuntime.evaluate(left, { max_volume_ratio: 0.5 }, context(), OPTIONS);
    const rightDecision = StrategyRuntime.evaluate(right, { max_volume_ratio: 0.5 }, context(), OPTIONS);
    expect(leftDecision.definitionFingerprint).toBe(rightDecision.definitionFingerprint);
    expect(leftDecision.definitionFingerprint).toBe(computeDefinitionFingerprint(left.definition));
  });

  it("④ 行为面不同的定义 ⇒ 指纹必须不同（缓存不得跨定义串味）", () => {
    const baseline = makeVersion(makePullbackDefinition());
    // 去掉「当日阳线」条件 = 行为面变化 ⇒ 指纹必须变（`fingerprint.ts` 的 FINGERPRINT_SCOPES 覆盖 ruleGraph）
    const variant = makeVersion(makePullbackDefinition({ includeBullishCondition: false }));
    const baselineFingerprint = StrategyRuntime.evaluate(
      baseline,
      { max_volume_ratio: 0.5 },
      context(),
      OPTIONS,
    ).definitionFingerprint;
    const variantFingerprint = StrategyRuntime.evaluate(
      variant,
      { max_volume_ratio: 0.5 },
      context(),
      OPTIONS,
    ).definitionFingerprint;
    expect(baselineFingerprint).not.toBe(variantFingerprint);
    expect(variantFingerprint).toBe(computeDefinitionFingerprint(variant.definition));
    // 交错再取一次：证明缓存不会把「先算过的那份」串到另一份上
    expect(
      StrategyRuntime.evaluate(baseline, { max_volume_ratio: 0.5 }, context(), OPTIONS).definitionFingerprint,
    ).toBe(baselineFingerprint);
  });

  it("⑤ 同一定义不同参数 ⇒ 定义指纹相同（参数不属于定义指纹面），但行为可变", () => {
    const version = makeVersion(makePullbackDefinition());
    const loose = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.5 }, context(), OPTIONS);
    const strict = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.2 }, context(), OPTIONS);
    expect(loose.definitionFingerprint).toBe(strict.definitionFingerprint);
    expect(loose.signals.length).toBe(1);
    expect(strict.signals.length).toBe(0);
  });
});
