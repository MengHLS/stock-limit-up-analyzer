/**
 * 组合因子 **OOS 验证组** —— 三方案预设（唯一真源）。
 *
 * ## 为什么另开一组实例，而不是复用既有 id
 *
 * `TASK-OOS-COMPOSITE-3F-001` 要做的是「按年份切分的后置窗口验证」，而平台把窗口做成
 * **确认性协议**（`OBSERVATION` / `HOLDOUT`，见 `shared/researchExperimentsContracts.ts`），
 * 并在**取数层**真实过滤事件（`server/researchExperiments/datasetPort.ts`）。
 *
 * 🔴 但 `findHoldoutWindowContamination()` 规定：**同一实验、同一 Dataset** 下，
 *    任何历史非 `HOLDOUT` Run 若 `evaluationWindow === null`（读全窗）或与目标 Holdout
 *    窗口重叠 ⇒ 该 Holdout 直接被拒（`EXPERIMENT_PROTOCOL_HOLDOUT_CONTAMINATED`）。
 *
 * 而 `3F` / `4F-EQ` / `12F-EQ` 三个方案的既有 Run **都是在 v5 全窗上跑的 EXPLORATORY**
 * ⇒ 在同一批 id 上做 2024–2026 的 Holdout 会被平台正确拒绝。
 *
 * ⇒ 因此本组的做法是：**新开三个 experiment id**，`members` 与 `weighting` 与既有实例
 *    **逐字相同**，只有 id 不同。新 id 无历史 Run ⇒ 不触发污染守卫；而「跑的是哪一套成员」
 *    这一点由**指纹**保证（见下）。
 *
 * ## 为什么可以断言「只是换了 id」
 *
 * 组合的成员指纹（`assemble.ts` 的 `composition.fingerprint`）与桶词表指纹
 * （`members.ts` 的 `compositionBucketFingerprint()`）都只覆盖
 * `code | direction | orientation | weight` 与 `code | orientation | priorVerified | buckets`
 * —— **都不含 experiment id**。因此「同一 members + 同一 weighting」在不同 id 上
 * 必须得到**逐字相同**的指纹。这一条在模块加载时**硬断言**（桶词表指纹，函数已导出）；
 * 成员指纹由结论文档的独立回校脚本对拍（既有报告里已有全窗口值）。
 *
 * ⚠️ 成员顺序会影响 `composition.fingerprint`（它是按数组顺序拼接的），因此
 *    `memberCodes` 的顺序必须与既有实例逐字一致 —— 这不是审美问题，是指纹问题。
 */

import {
  compositionBucketFingerprint,
  FROZEN_TWELVE_FACTOR_MEMBERS,
  resolveCompositeMember,
  type CompositeMemberSpec,
  type WeightingSpec,
} from "../../shared/compositeFactor";

/**
 * 从**冻结成员目录**里按 `code` 取子集（顺序 = 调用方给的字面量顺序）。
 *
 * 🔴 取不到任何一个 code 就**响亮失败**：方案里的成员悄悄少一个，整轮结论就会
 *    指向另一个排序键，而这在结果里看不出来。
 */
export function membersOf(codes: readonly string[]): CompositeMemberSpec[] {
  const byCode = new Map(FROZEN_TWELVE_FACTOR_MEMBERS.map(member => [member.code, member]));
  return codes.map(code => {
    const member = byCode.get(code);
    if (!member) {
      throw new Error(
        `OOS 验证组引用了未登记的成员 code：${code}；` +
          `冻结目录可用：${[...byCode.keys()].join(", ")}`
      );
    }
    return {
      code: member.code,
      direction: member.direction,
      orientation: member.orientation,
    };
  });
}

/** 本组在任务书里的角色（`MAIN` 才进主判定）。 */
export type OosRole = "MAIN" | "REFERENCE" | "NEGATIVE_CONTROL";

/** 一个 OOS 方案预设。 */
export interface OosPreset {
  /** 方案短名（报告与图例用）。 */
  readonly key: string;
  readonly role: OosRole;
  /** 实验 id（= `descriptor.id` = `pageKey`）。**必须是新 id**（见文件头）。 */
  readonly experimentId: string;
  /** 同一组合在既有（全窗口）实例上的 id，仅作对照记录，不参与计算。 */
  readonly baselineExperimentId: string;
  /** 同一组合在既有全窗口 Run 上的成员指纹（独立回校用；不参与计算）。 */
  readonly baselineCompositionFingerprint: string;
  /** 同一组合在既有全窗口 Run 上的桶词表指纹（**加载时硬断言**）。 */
  readonly baselineBucketFingerprint: string;
  readonly name: string;
  readonly pageTitle: string;
  readonly description: string;
  readonly rationale: string;
  /** 成员 code（顺序 = 指纹拼接顺序，必须与既有实例一致）。 */
  readonly memberCodes: readonly string[];
  readonly weighting: WeightingSpec;
  /** 人可读的权重说明（报告首表用；必须与 `weighting` 一致）。 */
  readonly weightLabel: string;
}

/** 两个振幅因子共用前缀（与 `composite-factor-constrained-weight-study` 逐字一致）。 */
const AMPLITUDE_PAIR = ["maxAmplitude", "meanAmplitude"] as const;
/** 冻结 12 因子的全部 code，**目录顺序**（与 `composite-factor-equal-weight-study` 逐字一致）。 */
const ALL_FROZEN_CODES: readonly string[] = FROZEN_TWELVE_FACTOR_MEMBERS.map(
  member => member.code
);

/**
 * 三方案（**顺序 = 报告与并列表的顺序，不参与任何计算**）。
 *
 * | # | 方案 | 角色 | 成员 | 权重 |
 * |---|---|---|---|---|
 * | 1 | `3F` | 主判定 | `maxAmplitude` + `meanAmplitude` + `t1VolumeRatio` | 等权 1/3 |
 * | 2 | `4F-EQ` | 描述性参照 | 上述 + `limitGap` | 等权 1/4 |
 * | 3 | `12F-EQ` | 负对照 | 全部 12 个冻结因子 | 等权 1/12 |
 */
export const OOS_PRESETS: readonly OosPreset[] = [
  {
    key: "3F",
    role: "MAIN",
    experimentId: "first-board-pullback/composite-factor-3f-amplitude-volume-oos-study",
    baselineExperimentId:
      "first-board-pullback/composite-factor-3f-amplitude-volume-study",
    baselineCompositionFingerprint: "fnv1a32:27e759d7",
    baselineBucketFingerprint: "fnv1a32:4eae4835",
    name: "组合因子等权 · 3F 双振幅+量比（OOS 后置窗口验证）",
    pageTitle: "组合因子等权（3F 双振幅+量比 · OOS）",
    description:
      "任务书 TASK-OOS-COMPOSITE-3F-001 的主验证对象：成员固定为 " +
      "maxAmplitude / meanAmplitude / t1VolumeRatio，**等权（各 1/3）**，与既有 " +
      "composite-factor-3f-amplitude-volume-study 的 members / weighting 逐字相同，**只换 id**。" +
      "窗口（选择段 2019–2023 / 验证段 2024–数据末端）由平台协议在取数层施加，" +
      "本实验内不做二次过滤、不新增因子、不搜索权重。",
    rationale:
      "上一轮三方案里同号率最高（四档平均 1.000、四档全 POS）、成员最少、机制最简 ⇒ " +
      "它是最值得花一次 Holdout 去证伪的那一个。",
    memberCodes: [...AMPLITUDE_PAIR, "t1VolumeRatio"],
    weighting: { mode: "EQUAL" },
    weightLabel: "maxAmplitude 1/3 + meanAmplitude 1/3 + t1VolumeRatio 1/3（等权）",
  },
  {
    key: "4F-EQ",
    role: "REFERENCE",
    experimentId: "first-board-pullback/composite-factor-4f-equal-weight-oos-study",
    baselineExperimentId: "first-board-pullback/composite-factor-four-strong-study",
    baselineCompositionFingerprint: "fnv1a32:bbcbb61c",
    baselineBucketFingerprint: "fnv1a32:abc25319",
    name: "组合因子等权 · 4F 强正向子集（OOS 描述性参照）",
    pageTitle: "组合因子等权（4F 强正向 · OOS）",
    description:
      "任务书 §2.2 的**描述性参照**（不纳入主判定）：成员 = 3F + limitGap，**等权（各 1/4）**，" +
      "与既有 composite-factor-four-strong-study 的 members / weighting 逐字相同，只换 id。" +
      "用途是回答「3F 的验证段表现是否只是『少用一个弱成员』的产物」。",
    rationale:
      "四因子等权在上一轮是唯一四档全 POSITIVE 且梯度方向翻转的基线；" +
      "3F 若在验证段输给它，说明 t1VolumeRatio 仍是稀释项。",
    memberCodes: [...AMPLITUDE_PAIR, "t1VolumeRatio", "limitGap"],
    weighting: { mode: "EQUAL" },
    weightLabel: "maxAmplitude 1/4 + meanAmplitude 1/4 + t1VolumeRatio 1/4 + limitGap 1/4（等权）",
  },
  {
    key: "12F-EQ",
    role: "NEGATIVE_CONTROL",
    experimentId: "first-board-pullback/composite-factor-12f-equal-weight-oos-study",
    baselineExperimentId: "first-board-pullback/composite-factor-equal-weight-study",
    baselineCompositionFingerprint: "fnv1a32:c258fe26",
    baselineBucketFingerprint: "fnv1a32:f0500413",
    name: "组合因子等权 · 12F 全因子（OOS 负对照）",
    pageTitle: "组合因子等权（12F 全因子 · OOS）",
    description:
      "任务书 §2.2 的**负对照**：全部 12 个冻结因子、**等权（各 1/12）**，与既有 " +
      "composite-factor-equal-weight-study 的 members / weighting 逐字相同，只换 id。" +
      "用途是回答「3F 是否仍优于全因子等权」——即稀释假说在验证段是否依然成立。",
    rationale:
      "上一轮 12F 等权在 N3/N5/N10 三档 INC、只有 N20 POSITIVE；" +
      "若验证段 3F 不再优于 12F，则「砍成员」这件事本身就没有信息增益。",
    memberCodes: ALL_FROZEN_CODES,
    weighting: { mode: "EQUAL" },
    weightLabel: "12 个冻结因子各 1/12（等权）",
  },
];

/** 预设按 `key` 索引（报告与断言用）。 */
export const OOS_PRESET_BY_KEY: ReadonlyMap<string, OosPreset> = new Map(
  OOS_PRESETS.map(preset => [preset.key, preset])
);

// ---------------------------------------------------------------------------
// 加载时硬断言：换了 id，**桶词表指纹必须逐字不变**
// ---------------------------------------------------------------------------
//
// 这是「路径 A」的全部合法性基础：如果换 id 顺带换了成员集合或方向，那么拿到的
// 就是一个**不同的排序键**，本轮验证对象就不成立，而结果信封里也不会自己喊出来。
// 唯一的风险是「把断言写反」（例如拿新指纹去比新指纹）—— 因此期望值一律写成
// **既有全窗口报告里的字面量**，不来自任何运行时计算。
for (const preset of OOS_PRESETS) {
  const members = membersOf(preset.memberCodes).map(resolveCompositeMember);
  const actual = compositionBucketFingerprint(members);
  if (actual !== preset.baselineBucketFingerprint) {
    throw new Error(
      `OOS 方案 ${preset.key} 的桶词表指纹 ${actual} ≠ 既有实例 ${preset.baselineExperimentId} 的 ` +
        `${preset.baselineBucketFingerprint} ⇒ 成员集合 / 方向已漂移，` +
        "本实验不再是「同一个排序键的窗口验证」，拒绝加载。"
    );
  }
}
