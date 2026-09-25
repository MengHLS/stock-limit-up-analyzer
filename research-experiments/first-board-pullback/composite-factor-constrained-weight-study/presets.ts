/**
 * 受约束组合因子实验组 —— **三组预设权重方案**（唯一真源）。
 *
 * ## 这个实验组回答什么
 *
 * `RESULT-COMPOSITE-SUBSET4-001.md`（强正向四因子**等权**，`RUN-20260925-5B9BD064`）的结论是：
 * 把 12 因子砍到 4 个强正向因子后，头部超额从「三档 `INCONCLUSIVE`」变成「**四档全 `POSITIVE`**」，
 * 且跨 N 梯度方向由「N 越小越差」翻转为「N 越小**越好**」⇒ 稀释假说得到支持。
 * 但它留下一个问题：**这 4 个成员该不该等权？**
 *
 * 本轮**不做自由权重搜索**（那会在同一批已读数据上二次拟合），只把 3 个**事先定好的**
 * 组合方案一次跑完、并列输出，不择优：
 *
 * | # | 方案 | 成员 | 权重 | 权重语义 |
 * |---|---|---|---|---|
 * | 1 | `2F` | `maxAmplitude` + `meanAmplitude` | 50% + 50% | **等权**（按构造即为 1/2） |
 * | 2 | `3F` | 上述 + `t1VolumeRatio` | 1/3 各 | **等权** |
 * | 3 | `4F-WEIGHTED` | 上述 + `limitGap` | 35% + 35% + 15% + 15% | **自定义（非等权）** |
 *
 * ⚠️ 这 3 个方案是**按上一轮已读数据挑出来的**（`EXPLORATORY` 的典型形态）⇒
 *    本组结论**不是 OOS 证据**，也不得择优后宣称「最优权重」。
 *
 * ## 为什么前两组用 `EQUAL` 而不是把 50% / 33.3% 写成 `CUSTOM`
 *
 * 「50% + 50%」与「1/3 + 1/3 + 1/3」**按构造就是等权**。模板的 `EQUAL` 走 `(Σ x)/n`
 * 浮点路径（`scoring.ts` 不变量 4），与四因子等权基线 `RUN-20260925-5B9BD064` **同一条路**；
 * 写成 `CUSTOM` 会改走 `Σ w·oriented`，可能差 1 ULP ⇒ 改变同值 tie-break。
 * 因此前两组用 `EQUAL`：**与基线的差异只能来自「成员集合」，不可能来自权重代码路径**。
 * 只有第 3 组（35/35/15/15）真正非等权，才用 `CUSTOM`。
 *
 * ## 🔴 不改任何因子定义
 *
 * 成员一律从 `FROZEN_TWELVE_FACTOR_MEMBERS`（冻结契约适配器）按 `code` 过滤取得 ——
 * label / 方向 / 桶边界 / 取值函数全部来自上游唯一真源，实验内**零边界搜索、零方向重估**。
 */

import {
  FROZEN_TWELVE_FACTOR_MEMBERS,
  type CompositeMemberSpec,
  type WeightingSpec,
} from "../../shared/compositeFactor";

/**
 * 从**冻结成员目录**里按 `code` 取子集。
 *
 * 🔴 取不到任何一个 code 就**响亮失败**（不做静默跳过）—— 「方案里的成员悄悄少了一个」
 *    会让整轮结论指向另一个排序键，而这在结果里看不出来。
 */
export function membersOf(codes: readonly string[]): CompositeMemberSpec[] {
  const byCode = new Map(FROZEN_TWELVE_FACTOR_MEMBERS.map(member => [member.code, member]));
  return codes.map(code => {
    const member = byCode.get(code);
    if (!member) {
      throw new Error(
        `受约束权重方案引用了未登记的成员 code：${code}；` +
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

/** 一个预设方案。 */
export interface ConstrainedWeightPreset {
  /** 方案短名（报告与图例用）。 */
  readonly key: string;
  /** 实验 id（= `descriptor.id` = `pageKey`）。 */
  readonly experimentId: string;
  readonly name: string;
  readonly pageTitle: string;
  readonly description: string;
  readonly rationale: string;
  /** 成员 code（顺序 = 冻结目录取子集时给出的顺序）。 */
  readonly memberCodes: readonly string[];
  readonly weighting: WeightingSpec;
  /** 人可读的权重说明（报告首表用；必须与 `weighting` 一致）。 */
  readonly weightLabel: string;
}

/** 两组等权方案共用的成员前缀。 */
const AMPLITUDE_PAIR = ["maxAmplitude", "meanAmplitude"] as const;

/**
 * 三组预设方案（**顺序 = 报告与并列表的顺序，不参与任何计算**）。
 */
export const CONSTRAINED_WEIGHT_PRESETS: readonly ConstrainedWeightPreset[] = [
  {
    key: "2F",
    experimentId: "first-board-pullback/composite-factor-2f-amplitude-study",
    name: "组合因子等权 · 双振幅（2F，50/50）",
    pageTitle: "组合因子等权（2F 双振幅）",
    description:
      "受约束权重方案 1/3：只保留 maxAmplitude 与 meanAmplitude 两个因子，**等权（各 50%）**合成。" +
      "用于检验「上一轮四因子方案里的超额，是否其实全部来自这两个振幅因子」——" +
      "若 2F 的头部超额已与 4F 等权持平，则 t1VolumeRatio / limitGap 对头部没有增量贡献。",
    rationale:
      "这两个因子是 RESULT-SINGLE-FACTOR-V1-12F-001 里唯一做到「四档全 POSITIVE」与「跨年 8/8 同号」的两个，" +
      "也是 12F 综合评分里最强的两个成员 ⇒ 先问「只留它们够不够」。",
    memberCodes: [...AMPLITUDE_PAIR],
    weighting: { mode: "EQUAL" },
    weightLabel: "maxAmplitude 50% + meanAmplitude 50%（等权）",
  },
  {
    key: "3F",
    experimentId: "first-board-pullback/composite-factor-3f-amplitude-volume-study",
    name: "组合因子等权 · 三因子（2F + 量比，各 1/3）",
    pageTitle: "组合因子等权（3F 双振幅+量比）",
    description:
      "受约束权重方案 2/3：在 2F 基础上加入 t1VolumeRatio，**等权（各 1/3）**合成。" +
      "用于分离 t1VolumeRatio 的增量：与 2F 同口径逐档对比，" +
      "若三档超额不升反降，说明该成员在头部是稀释项而非增益项。",
    rationale:
      "t1VolumeRatio 在单因子实验里是对齐臂至少一档 POSITIVE 的成员，但它同时是 12F 稀释假说的嫌疑成员之一" +
      "⇒ 用「2F → 3F」这一步把它单独隔离出来测。",
    memberCodes: [...AMPLITUDE_PAIR, "t1VolumeRatio"],
    weighting: { mode: "EQUAL" },
    weightLabel: "maxAmplitude 1/3 + meanAmplitude 1/3 + t1VolumeRatio 1/3（等权）",
  },
  {
    key: "4F-WEIGHTED",
    experimentId: "first-board-pullback/composite-factor-4f-weighted-study",
    name: "组合因子加权 · 四因子预设权重（35/35/15/15）",
    pageTitle: "组合因子加权（4F 预设 35/35/15/15）",
    description:
      "受约束权重方案 3/3：四因子**非等权**预设 —— maxAmplitude 35% + meanAmplitude 35% + " +
      "t1VolumeRatio 15% + limitGap 15%（`CUSTOM`，归一化到 Σw = 1）。" +
      "用于检验「把权重向两个强因子倾斜」是否能改善四因子等权基线；" +
      "⚠️ 这是**事先定好的单一预设**，不是搜索出来的最优解，不得据此刻画最优权重。",
    rationale:
      "两个振幅因子在单因子侧的证据最强（maxAmplitude 四档全 POSITIVE 且 8/8 同号），" +
      "另两个成员各只有一个档位 POSITIVE、「先验未验证方向」（limitGap）或仅一档显著（t1VolumeRatio）" +
      "⇒ 直接把权重按证据强弱倾斜成 35/35/15/15，一次跑完看方向，不做权重搜索。",
    memberCodes: [...AMPLITUDE_PAIR, "t1VolumeRatio", "limitGap"],
    weighting: {
      mode: "CUSTOM",
      weights: {
        maxAmplitude: 0.35,
        meanAmplitude: 0.35,
        t1VolumeRatio: 0.15,
        limitGap: 0.15,
      },
    },
    weightLabel:
      "maxAmplitude 35% + meanAmplitude 35% + t1VolumeRatio 15% + limitGap 15%（自定义权重）",
  },
];

/** 预设方案按 `key` 索引（报告与断言用）。 */
export const PRESET_BY_KEY: ReadonlyMap<string, ConstrainedWeightPreset> = new Map(
  CONSTRAINED_WEIGHT_PRESETS.map(preset => [preset.key, preset])
);
