/**
 * P2（FE-PLAN-003 §8）—— ③ 仓位 / ④ 成本与成交的**方案族**锁。
 *
 * 这一层的风险是"方案看起来能选、选完什么也没发生"或"选完把别的字段冲了"。
 * 所以断言分三组：**方案数量与自解释名**、**物化确定性**、**参数真能改到 payload**。
 */
import { describe, expect, it } from "vitest";

import {
  COST_SLOT_PRESETS,
  POSITION_PRESETS,
  findStrategyAuthoringPreset,
  listStrategyAuthoringPresets,
} from "../../../../server/research/strategyAuthoring/presetRegistry";
import { materializePreset } from "../../../../server/research/strategyAuthoring/materialize";
import { buildStrategyAuthoringVocabulary } from "../../../../server/research/strategyAuthoring/vocabulary";

const vocabulary = buildStrategyAuthoringVocabulary();

function materialize(slot: "POSITION" | "COST", presetId: string, parameters: Record<string, number | string> = {}) {
  return materializePreset({ slot, presetId, parameters });
}

describe("③ 仓位预设族（POSITION）", () => {
  it("1) ≥3 个方案，且每个都有自解释中文名（不含 id、不空）", () => {
    expect(POSITION_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const preset of POSITION_PRESETS) {
      expect(preset.displayName.trim(), preset.presetId).not.toBe("");
      expect(preset.displayName, preset.presetId).not.toBe(preset.presetId);
      expect(/[\u4e00-\u9fa5]/.test(preset.displayName), `${preset.presetId} -> ${preset.displayName}`).toBe(true);
    }
  });

  it("2) 每个方案都能物化成功，payload 只含 position 段（不越界写别的段）", () => {
    for (const preset of POSITION_PRESETS) {
      const result = materialize("POSITION", preset.presetId);
      expect(result.issues, preset.presetId).toEqual([]);
      const payload = result.payload as Record<string, unknown>;
      expect(Object.keys(payload), preset.presetId).toEqual(["position"]);
    }
  });

  it("3) ★ `maxPositions` 在预设里只声明一次（C-2 单一编辑点；双写由客户端镜像）", () => {
    for (const preset of POSITION_PRESETS) {
      const paths = preset.parameters.map(p => p.path);
      expect(paths.filter(p => p.endsWith("/maxPositions")), preset.presetId).toEqual(["/position/maxPositions"]);
      // payload 里也不得出现第二处 maxPositions（例如 /cost/maxPositions）
      const json = JSON.stringify(preset.payload);
      expect(json.match(/maxPositions/g)?.length ?? 0, preset.presetId).toBe(1);
    }
  });

  it("4) 参数可调：改参数 ⇒ payload 真的跟着变（且指纹变）", () => {
    const preset = POSITION_PRESETS.find(p => p.presetId === "position:fixed-ratio-20-max5")!;
    const base = materialize("POSITION", preset.presetId);
    const tweaked = materialize("POSITION", preset.presetId, { positionRatio: 0.35, maxPositions: 8 });
    expect(tweaked.issues).toEqual([]);
    expect((tweaked.payload as any).position.positionRatio).toBe(0.35);
    expect((tweaked.payload as any).position.maxPositions).toBe(8);
    expect(tweaked.fingerprint).not.toBe(base.fingerprint);
  });

  it("5) 越界 / 未知参数**响亮**报错（不静默夹取）", () => {
    const id = "position:fixed-ratio-20-max5";
    expect(materialize("POSITION", id, { positionRatio: 3 }).issues[0]?.code).toBe("AUTHORING_PARAMETER_INVALID");
    expect(materialize("POSITION", id, { maxPositions: 0 }).issues[0]?.code).toBe("AUTHORING_PARAMETER_INVALID");
    expect(materialize("POSITION", id, { nope: 1 }).issues[0]?.code).toBe("AUTHORING_PARAMETER_UNKNOWN");
  });

  it("6) 规模口径都在服务端词表内（不发明新枚举）", () => {
    const allowed = ["FIXED_AMOUNT", "FIXED_RATIO", "EQUITY_RATIO", "EQUAL_WEIGHT", "RISK_BASED"];
    for (const preset of POSITION_PRESETS) {
      const sizingMethod = (preset.payload.position as Record<string, unknown>).sizingMethod;
      expect(allowed, preset.presetId).toContain(sizingMethod);
    }
  });
});

describe("④ 成本与成交预设族（COST）", () => {
  it("7) ≥3 个方案，且每个都有自解释中文名", () => {
    expect(COST_SLOT_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const preset of COST_SLOT_PRESETS) {
      expect(/[\u4e00-\u9fa5]/.test(preset.displayName), preset.presetId).toBe(true);
      expect(preset.displayName).not.toBe(preset.presetId);
    }
  });

  it("8) 每个方案都能物化成功，payload 含 cost + execution 两段", () => {
    for (const preset of COST_SLOT_PRESETS) {
      const result = materialize("COST", preset.presetId);
      expect(result.issues, preset.presetId).toEqual([]);
      const payload = result.payload as Record<string, unknown>;
      expect(Object.keys(payload).sort(), preset.presetId).toEqual(["cost", "execution"]);
    }
  });

  it("9) 七项成本假设齐全（初始资金 + 六项费率），且成交口径在词表内", () => {
    const costKeys = ["initialCapital", "commissionRate", "stampDutyRate", "transferFeeRate", "slippageBps", "lotSize", "minCommission"];
    for (const preset of COST_SLOT_PRESETS) {
      const cost = (materialize("COST", preset.presetId).payload as any).cost as Record<string, unknown>;
      expect(Object.keys(cost).sort(), preset.presetId).toEqual([...costKeys].sort());
      for (const key of costKeys) expect(typeof cost[key], `${preset.presetId}.${key}`).toBe("number");
      const execution = (materialize("COST", preset.presetId).payload as any).execution as Record<string, unknown>;
      expect(["T_OPEN", "T_CLOSE"]).toContain(execution.signalTiming);
      expect(["T_CLOSE", "T_PLUS_1_OPEN", "T_PLUS_1_CLOSE", "T_PLUS_2_OPEN"]).toContain(execution.executionTiming);
      expect(["OPEN", "CLOSE", "HIGH", "LOW", "VWAP"]).toContain(execution.priceType);
    }
  });

  it("10) ★ 「A 股标准」与客户端既有口径**同源**（佣金万3 / 印花千1 / 过户万0.1 / 滑点10bp / 100股 / 最低5元）", () => {
    const result = materialize("COST", "cost:a-share-standard-open-1m");
    const cost = (result.payload as any).cost;
    expect(cost.commissionRate).toBe(0.0003);
    expect(cost.stampDutyRate).toBe(0.001);
    expect(cost.transferFeeRate).toBe(0.00001);
    expect(cost.slippageBps).toBe(10);
    expect(cost.lotSize).toBe(100);
    expect(cost.minCommission).toBe(5);
  });

  it("11) 参数可调：滑点 / 成交时点都能改到 payload", () => {
    const result = materialize("COST", "cost:a-share-standard-open-1m", { slippageBps: 25, executionTiming: "T_PLUS_2_OPEN" });
    expect(result.issues).toEqual([]);
    expect((result.payload as any).cost.slippageBps).toBe(25);
    expect((result.payload as any).execution.executionTiming).toBe("T_PLUS_2_OPEN");
  });

  it("12) 枚举参数越界 ⇒ 响亮报错", () => {
    const id = "cost:a-share-standard-open-1m";
    expect(materialize("COST", id, { priceType: "MID" }).issues[0]?.code).toBe("AUTHORING_PARAMETER_INVALID");
    expect(materialize("COST", id, { slippageBps: -1 }).issues[0]?.code).toBe("AUTHORING_PARAMETER_INVALID");
  });
});

describe("P2 与词表 / 注册表的接线", () => {
  it("13) 词表里有 POSITION / COST 槽位元数据（无孤儿预设）", () => {
    const slots = new Set(vocabulary.presetSlots.map(s => s.slot));
    expect(slots.has("POSITION")).toBe(true);
    expect(slots.has("COST")).toBe(true);
    expect(vocabulary.presets.filter(p => p.slot === "POSITION").length).toBe(POSITION_PRESETS.length);
    expect(vocabulary.presets.filter(p => p.slot === "COST").length).toBe(COST_SLOT_PRESETS.length);
  });

  it("14) 注册表能按 (slot, presetId) 查到（materialize 的前提）", () => {
    expect(findStrategyAuthoringPreset("POSITION", "position:fixed-ratio-20-max5")).not.toBeNull();
    expect(findStrategyAuthoringPreset("COST", "cost:a-share-standard-open-1m")).not.toBeNull();
    expect(listStrategyAuthoringPresets().filter(p => p.slot === "POSITION").length).toBeGreaterThanOrEqual(3);
  });

  it("15) 幂等：同输入两次物化 ⇒ 同 payload / 同指纹", () => {
    const a = materialize("COST", "cost:zero-cost-open-1m");
    const b = materialize("COST", "cost:zero-cost-open-1m");
    expect(a.payload).toEqual(b.payload);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
