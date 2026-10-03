/**
 * FE-PLAN-004 —— 「退出政策」9 个规则槽的行为锁。
 *
 * 这一层最怕两件事，而且**都会静默**：
 *   ① **往返不等**：把既有版本的政策拆成槽、再原样拼回去，结果与原来不同
 *      ⇒ 打开一个老策略、什么都没改、保存下去就产生"新版本"（还可能改掉行为）；
 *   ② **覆盖越界**：只改一个槽，却把别的槽或不归本表单管的键冲掉
 *      （`stop.contexts`、`strongHold.scaleOutRatio` …）。
 *
 * 所以主证据是 **§46 个实验逐个"识别 → 重新物化 → 合并"深等于**。
 */
import { describe, expect, it } from "vitest";

import type { ExitPolicyDefinition } from "../../../../server/research/exitPolicyCommon";
import { STOP_POLICY_EXPERIMENTS } from "../../../../server/research/exitPolicyExperiments";
import {
  EXIT_POLICY_SLOTS,
  EXIT_POLICY_SLOT_IDS,
  applyExitPolicySlot,
  exitSlotIsAtDefaults,
  findExitPolicySlot,
  materializeExitPolicySlotOption,
  mergeExitPolicyPatch,
  recognizeExitPolicySlot,
  type ExitPolicySlotId,
} from "../../../../server/research/strategyAuthoring/exitPolicySlots";

const EXPERIMENTS = Object.entries(STOP_POLICY_EXPERIMENTS).map(([id, exp]) => ({
  id,
  policy: exp.policy as unknown as ExitPolicyDefinition,
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 键序无关的规范化串（只用于比较"结构是否相同"）。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value as Record<string, unknown>).sort()
      .map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

describe("① 槽表本身", () => {
  it("1) 9 个槽齐备，且首屏只常显 3 个（止损位置 / 止盈 / 到期）", () => {
    expect(EXIT_POLICY_SLOTS.map(slot => slot.slotId)).toEqual([...EXIT_POLICY_SLOT_IDS]);
    expect(EXIT_POLICY_SLOTS).toHaveLength(9);
    const primary = EXIT_POLICY_SLOTS.filter(slot => slot.visibility === "PRIMARY").map(slot => slot.slotId);
    expect(primary).toEqual(["ANCHOR", "TAKE_PROFIT", "TIME_EXIT"]);
    expect(EXIT_POLICY_SLOTS.filter(slot => slot.visibility === "MORE")).toHaveLength(5);
    expect(EXIT_POLICY_SLOTS.filter(slot => slot.visibility === "RESEARCH")).toHaveLength(1);
  });

  it("2) 每个槽都有中文名与那句人话问题；每个选项的名自带规则（≠ optionId、含汉字）", () => {
    for (const slot of EXIT_POLICY_SLOTS) {
      expect(/[\u4e00-\u9fa5]/.test(slot.label), slot.slotId).toBe(true);
      expect(/[\u4e00-\u9fa5]/.test(slot.question), slot.slotId).toBe(true);
      expect(slot.options.length, slot.slotId).toBeGreaterThan(1);
      for (const option of slot.options) {
        expect(/[\u4e00-\u9fa5]/.test(option.displayName), slot.slotId + "/" + option.optionId).toBe(true);
        expect(option.displayName).not.toBe(option.optionId);
        expect(option.summary.trim().length, slot.slotId + "/" + option.optionId).toBeGreaterThan(0);
      }
    }
  });

  it("3) 每个选项都能物化出合法 patch（无 issues）", () => {
    for (const slot of EXIT_POLICY_SLOTS) {
      for (const option of slot.options) {
        const result = materializeExitPolicySlotOption(slot.slotId, option.optionId);
        expect(result.issues, slot.slotId + "/" + option.optionId).toEqual([]);
        expect(result.patch, slot.slotId + "/" + option.optionId).not.toBeNull();
      }
    }
  });
});

describe("② ★ 46 个实验逐个往返（X-2：既有版本零改写）", () => {
  it("4) 「识别 → 重新物化 → 合并」必须与原始政策**深等于**", () => {
    const failures: string[] = [];
    for (const { id, policy } of EXPERIMENTS) {
      let rebuilt = clone(policy);
      for (const slotId of EXIT_POLICY_SLOT_IDS) {
        const recognized = recognizeExitPolicySlot(policy, slotId);
        if (recognized === null) {
          failures.push(id + " 的槽 " + slotId + " 认不出来");
          continue;
        }
        const materialized = materializeExitPolicySlotOption(slotId, recognized.optionId, recognized.parameters);
        if (materialized.issues.length > 0 || materialized.patch === null) {
          failures.push(id + " 的槽 " + slotId + " 物化失败：" + materialized.issues.join(" / "));
          continue;
        }
        rebuilt = mergeExitPolicyPatch(rebuilt, materialized.patch);
      }
      // 🔴 用规范化比较：键序变化不算改写；**多/少一个键、或值不同**才算。
      if (canonical(rebuilt) !== canonical(policy)) {
        failures.push(id + " 往返后与原政策不同");
      }
    }
    expect(failures).toEqual([]);
  });

  it("5) 46 个实验的每个槽都能被认出来（不存在「认不出」的已登记实验）", () => {
    const unknown: string[] = [];
    for (const { id, policy } of EXPERIMENTS) {
      for (const slotId of EXIT_POLICY_SLOT_IDS) {
        if (recognizeExitPolicySlot(policy, slotId) === null) unknown.push(id + "/" + slotId);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("6) 基准 SL-00 的每个槽都被认成「默认值」（没有参数被改）", () => {
    const sl00 = EXPERIMENTS.find(item => item.id === "SL-00");
    expect(sl00).toBeDefined();
    for (const slotId of EXIT_POLICY_SLOT_IDS) {
      const recognized = recognizeExitPolicySlot(sl00!.policy, slotId);
      expect(recognized, slotId).not.toBeNull();
      expect(exitSlotIsAtDefaults(recognized!, slotId), slotId).toBe(true);
    }
  });
});

describe("③ 只覆盖自己的键（不越界）", () => {
  it("7) 只改「止损位置」：别的槽与本表单不管的键**逐字不动**", () => {
    const base = clone(EXPERIMENTS.find(item => item.id === "SL-18.1")!.policy);
    const before = clone(base);
    const applied = applyExitPolicySlot(base, "ANCHOR", "fixed-percent", { stopRatio: 0.07 });
    expect(applied.issues).toEqual([]);
    expect(applied.policy.stop.anchor).toEqual({ kind: "FIXED_PERCENT", stopRatio: 0.07 });
    // 同一 stop 里的其它字段
    expect(applied.policy.stop.confirmation).toBe(before.stop.confirmation);
    expect(applied.policy.stop.escalation).toEqual(before.stop.escalation);
    expect(applied.policy.stop.schedule ?? null).toEqual(before.stop.schedule ?? null);
    expect(applied.policy.stop.reduction ?? null).toEqual(before.stop.reduction ?? null);
    // 其它槽
    expect(applied.policy.takeProfit).toEqual(before.takeProfit);
    expect(applied.policy.timeExit).toEqual(before.timeExit);
    expect(applied.policy.strongHold).toEqual(before.strongHold);
    expect(applied.policy.runnerBridge ?? null).toEqual(before.runnerBridge ?? null);
  });

  it("8) ★ 本表单不编辑的键被保留：\`stop.contexts\` 与 \`strongHold.scaleOutRatio\`", () => {
    const base = clone(EXPERIMENTS.find(item => item.id === "SL-26.0")!.policy);
    expect((base.stop as { contexts?: unknown }).contexts).toBeDefined();
    const withScaleOut: ExitPolicyDefinition = {
      ...base,
      strongHold: { ...(base.strongHold as object), scaleOutRatio: 0.5 } as ExitPolicyDefinition["strongHold"],
    };
    const applied = applyExitPolicySlot(withScaleOut, "ANCHOR", "fixed-percent", { stopRatio: 0.05 });
    expect(applied.issues).toEqual([]);
    expect((applied.policy.stop as { contexts?: unknown }).contexts).toEqual((base.stop as { contexts?: unknown }).contexts);
    expect((applied.policy.strongHold as { scaleOutRatio?: number }).scaleOutRatio).toBe(0.5);
  });

  it("9) 「不启用」真的清字段（不是什么都不做）", () => {
    const base = clone(EXPERIMENTS.find(item => item.id === "SL-00")!.policy);
    expect(base.takeProfit).not.toBeNull();
    const applied = applyExitPolicySlot(base, "TAKE_PROFIT", "off");
    expect(applied.issues).toEqual([]);
    expect(applied.policy.takeProfit).toBeNull();
    // 而且不会顺手清掉别的槽
    expect(applied.policy.timeExit).toEqual(base.timeExit);
  });
});

describe("④ 认不出就不猜（不许就近匹配）", () => {
  it("10) 自定义阶梯的止损收紧 ⇒ 认不出（不能被当成「默认阶梯」）", () => {
    const base = clone(EXPERIMENTS.find(item => item.id === "SL-13.0")!.policy);
    const custom: ExitPolicyDefinition = {
      ...base,
      stop: {
        ...base.stop,
        escalation: {
          kind: "LADDER",
          steps: [{ activationRatio: 0.02, stopRatio: 0.01 }],
        },
      } as ExitPolicyDefinition["stop"],
    };
    expect(recognizeExitPolicySlot(custom, "ESCALATION")).toBeNull();
  });

  it("11) 认不出的槽，其它槽照常认得出（互不牵连）", () => {
    const base = clone(EXPERIMENTS.find(item => item.id === "SL-13.0")!.policy);
    const custom: ExitPolicyDefinition = {
      ...base,
      stop: { ...base.stop, escalation: { kind: "R_MULTIPLE", rRatio: 0.05, steps: [{ triggerR: 1.5, lockR: 0.5 }] } } as ExitPolicyDefinition["stop"],
    };
    expect(recognizeExitPolicySlot(custom, "ESCALATION")).toBeNull();
    expect(recognizeExitPolicySlot(custom, "ANCHOR")).not.toBeNull();
    expect(recognizeExitPolicySlot(custom, "TAKE_PROFIT")).not.toBeNull();
  });
});

describe("⑤ 参数校验与「没有假旋钮」", () => {
  it("12) 未知参数 / 越界参数 ⇒ 响亮报错，不静默夹取", () => {
    expect(materializeExitPolicySlotOption("ANCHOR", "fixed-percent", { nope: 1 }).issues.length).toBeGreaterThan(0);
    expect(materializeExitPolicySlotOption("ANCHOR", "fixed-percent", { stopRatio: 0.9 }).issues.length).toBeGreaterThan(0);
    expect(materializeExitPolicySlotOption("TAKE_PROFIT", "ma-cross", { fastWindow: 0 }).issues.length).toBeGreaterThan(0);
    expect(materializeExitPolicySlotOption("ANCHOR", "no-such-option").issues.length).toBeGreaterThan(0);
  });

  it("13) 不存在的槽位 ⇒ 抛（不是静默返回空）", () => {
    expect(() => findExitPolicySlot("NOT_A_SLOT" as ExitPolicySlotId)).toThrow();
  });

  it("14) ★ 槽表里**没有** ⛔ 假旋钮：\`stop.contexts\` 与 \`capitalRecycle\` 都不在任何 patch 里", () => {
    expect(EXIT_POLICY_SLOT_IDS as readonly string[]).not.toContain("CONTEXTS");
    expect(EXIT_POLICY_SLOT_IDS as readonly string[]).not.toContain("CAPITAL_RECYCLE");
    for (const slot of EXIT_POLICY_SLOTS) {
      for (const option of slot.options) {
        const json = JSON.stringify(option.patch);
        expect(json.includes("contexts"), slot.slotId + "/" + option.optionId).toBe(false);
        expect(json.includes("capitalRecycle"), slot.slotId + "/" + option.optionId).toBe(false);
      }
    }
  });
});

describe("⑥ 契约与词表（防静默漂移）", () => {
  it("15) 共享契约的槽 id 与本体**逐字同序**", async () => {
    const shared = await import("../../../../shared/researchContracts");
    expect([...shared.exitPolicySlotIdSchema.options]).toEqual([...EXIT_POLICY_SLOT_IDS]);
  });

  it("16) 词表下发 9 个槽，且**不携带 patch**（拼装逻辑留在服务端）", async () => {
    const { buildStrategyAuthoringVocabulary } = await import(
      "../../../../server/research/strategyAuthoring/vocabulary"
    );
    const vocabulary = buildStrategyAuthoringVocabulary();
    expect(vocabulary.exitPolicySlots.map(slot => slot.slotId)).toEqual([...EXIT_POLICY_SLOT_IDS]);
    for (const slot of vocabulary.exitPolicySlots) {
      expect(slot.label.length).toBeGreaterThan(0);
      expect(slot.question.length).toBeGreaterThan(0);
      expect(slot.options.length).toBeGreaterThan(1);
      for (const option of slot.options) {
        expect(option.displayName.length).toBeGreaterThan(0);
        // 🔴 前端拿不到 patch ⇒ 它没有能力自行拼 policy
        expect(Object.keys(option)).not.toContain("patch");
      }
    }
    const json = JSON.stringify(vocabulary.exitPolicySlots);
    expect(json.includes('"patch"')).toBe(false);
  });

  it("17) 词表的可见性分组与本体一致（常显 3 / 折叠 5 / 研究 1）", async () => {
    const { buildStrategyAuthoringVocabulary } = await import(
      "../../../../server/research/strategyAuthoring/vocabulary"
    );
    const vocabulary = buildStrategyAuthoringVocabulary();
    const group = (visibility: string) =>
      vocabulary.exitPolicySlots.filter(slot => slot.visibility === visibility).map(slot => slot.slotId);
    expect(group("PRIMARY")).toEqual(["ANCHOR", "TAKE_PROFIT", "TIME_EXIT"]);
    expect(group("MORE")).toHaveLength(5);
    expect(group("RESEARCH")).toEqual(["RESEARCH"]);
  });
});

describe("⑦ 起步基准（没有退出政策时的起点）", () => {
  it("18) 词表下发的起步基准 === 已登记实验 SL-00 的 policy（引用，不是复刻）", async () => {
    const { buildStrategyAuthoringVocabulary } = await import(
      "../../../../server/research/strategyAuthoring/vocabulary"
    );
    const vocabulary = buildStrategyAuthoringVocabulary();
    const sl00 = STOP_POLICY_EXPERIMENTS["SL-00"];
    expect(sl00).toBeDefined();
    expect(vocabulary.exitPolicyBasePolicy).toEqual(sl00!.policy);
    expect(vocabulary.exitPolicyBaseLabel).toContain("SL-00");
  });

  it("19) 起步基准能被 9 个槽全部认出来（否则用户一开始就面对「不识别」）", async () => {
    const { buildStrategyAuthoringVocabulary } = await import(
      "../../../../server/research/strategyAuthoring/vocabulary"
    );
    const base = buildStrategyAuthoringVocabulary().exitPolicyBasePolicy as unknown as ExitPolicyDefinition;
    for (const slotId of EXIT_POLICY_SLOT_IDS) {
      expect(recognizeExitPolicySlot(base, slotId), slotId).not.toBeNull();
    }
  });
});
