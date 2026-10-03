/**
 * P3（FE-PLAN-004 §3）—— 「本表单不编辑的退出政策字段」的标注必须**说实话**。
 *
 * 最坏的写法是把两类混成一句「不参与回测」：
 *   - stop.contexts / capitalRecycle：**确实**零求值器 ⇒ 不参与回测；
 *   - strongHold.scaleOutRatio 等：**会参与回测**，只是本表单还没做编辑面。
 * 混在一起就会让用户以为 scaleOutRatio 也是假的。
 */
import { describe, expect, it } from "vitest";
import { uneditedExitPolicyFields } from "@/components/strategy/ExitPolicySlotEditor";

describe("uneditedExitPolicyFields（P3）", () => {
  it("1) 没有 policy ⇒ 空（不编造）", () => {
    expect(uneditedExitPolicyFields(null)).toEqual([]);
    expect(uneditedExitPolicyFields(undefined)).toEqual([]);
    expect(uneditedExitPolicyFields({})).toEqual([]);
  });

  it("2) contexts 与 capitalRecycle 标成「仅声明，不参与回测」", () => {
    const fields = uneditedExitPolicyFields({
      stop: { contexts: [{ kind: "MARKET", tightenToRatio: 0.04 }] },
      capitalRecycle: { maxConcurrentRunners: 2, replacementScoreMargin: 0.05 },
    });
    const contexts = fields.find(field => field.path.endsWith("stop.contexts"));
    const recycle = fields.find(field => field.path.endsWith("policy.capitalRecycle"));
    expect(contexts?.note).toContain("仅声明，不参与回测");
    expect(recycle?.note).toContain("仅声明，不参与回测");
  });

  it("3) strongHold 的扩展字段标成「会参与回测」（不能跟上一类混）", () => {
    const fields = uneditedExitPolicyFields({
      stop: { anchor: { kind: "FIXED_PERCENT", stopRatio: 0.06 } },
      strongHold: { atHoldingDays: 5, scaleOutRatio: 0.5, runnerExitAtHoldingDays: 10 },
    });
    const scaleOut = fields.find(field => field.path.endsWith("strongHold.scaleOutRatio"));
    expect(scaleOut?.note).toContain("会参与回测");
    expect(scaleOut?.note).not.toContain("不参与回测");
  });

  it("4) 值原样回显（不美化、不四舍五入）", () => {
    const fields = uneditedExitPolicyFields({ stop: { contexts: [{ kind: "SECTOR" }] } });
    expect(fields[0]?.value).toContain("SECTOR");
  });
});
