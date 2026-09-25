/**
 * 组合因子等权模板 · **强正向四因子子集实例**（第一版）。
 *
 * ## 这个实验回答什么
 *
 * `RESULT-12F-TOPN-002.md`（12 因子等权，`RUN-20260925-F92742B8`）的结论是：
 * 综合评分在头部没有信息增益，且**弱于多个单因子** ⇒ 怀疑「等权把强信号稀释了」。
 * 本实验即对该假说的**最小检验**：把成员从 12 个换成「对齐臂已判 `POSITIVE` 的 4 个」，
 * 其余一切不动，看头部超额是否改善。
 *
 * ## 🔴 与 12 因子实例的**唯一差异 = `members`**
 *
 * | 项 | 12 因子实例 | 本实例 |
 * |---|---|---|
 * | `members` | `FROZEN_TWELVE_FACTOR_MEMBERS`（12 个） | 同目录里**按 code 取 4 个**（见 `STRONG_SUBSET_CODES`） |
 * | 其余（标准化 / 权重 / 档位 / 日集 / 坐标 / 统计 / Bootstrap / 样本池） | 完全不动 | 完全不动 |
 *
 * ⇒ 两个实例的**样本池逐条相同**（都走 `deriveTwelveFactorSamples` 的 12 完备用例池），
 * 因此可以逐档直接横向比较。
 *
 * ## 刻意不做（与任务书一致）
 *
 * - ❌ 不做**不等权 / 权重搜索**（`weighting` 仍是 `{ mode: "EQUAL" }`，各 1/4）；
 * - ❌ 不新增因子、不改任何因子定义 / 桶边界 / 方向（全部经 `members.ts` 适配器 import）；
 * - ❌ 不因为「哪些因子的对齐臂更好」而重估方向 —— 4 个成员的方向仍由契约 `orientation` 推出，
 *      `assertMemberDirections()` 结构级强制；
 * - ❌ 不做归因、不做 OOS、不宣称最优。
 */

import {
  FROZEN_TWELVE_FACTOR_MEMBERS,
  defineCompositeFactorExperiment,
} from "../../shared/compositeFactor";
import { COMPUTATION_VERSION } from "./result";

/**
 * 保留的 4 个因子（冻结 `code`）。
 *
 * 选取依据 = `RESULT-12F-TOPN-002.md` §6.2 / §6.4：这 4 个是**对齐臂在 `OWN` 日集上
 * 至少一个档位判 `POSITIVE`** 的因子；其中 `maxAmplitude` / `meanAmplitude` 在三个档位以上判
 * `POSITIVE` 且跨年 8/8 同号。
 *
 * ⚠️ 这是**事后按已读数据挑的成员**（`EXPLORATORY` 的典型形态）⇒ 本实验的结论
 *    **不可当作 OOS 证据**，这一点在报告与结果信封的 disclosures 里都必须写明。
 */
export const STRONG_SUBSET_CODES = [
  "maxAmplitude",
  "meanAmplitude",
  "t1VolumeRatio",
  "limitGap",
] as const;

/**
 * 从**冻结成员目录**里按 code 取子集（保持目录顺序 ⇒ 组合指纹与书写顺序无关，
 * 但仍要求「少一个就响亮失败」）。
 */
function strongSubsetMembers() {
  const byCode = new Map(FROZEN_TWELVE_FACTOR_MEMBERS.map(member => [member.code, member]));
  return STRONG_SUBSET_CODES.map(code => {
    const member = byCode.get(code);
    if (!member) {
      throw new Error(
        `强正向子集引用了未登记的成员 code：${code}；` +
          `冻结目录可用：${[...byCode.keys()].join(", ")}`
      );
    }
    return member;
  });
}

export const compositeFactorFourStrongStudyExperiment =
  defineCompositeFactorExperiment({
    id: "first-board-pullback/composite-factor-four-strong-study",
    name: "组合因子等权 · 强正向四因子子集（第一版）",
    version: COMPUTATION_VERSION,
    description:
      "对「12 因子等权是否被稀释」假说的最小检验：成员固定为对齐臂已判 POSITIVE 的 4 个冻结因子" +
      "（maxAmplitude / meanAmplitude / t1VolumeRatio / limitGap），仍做桶位分标准化 + **等权（各 1/4）**合成，" +
      "在 T+6 开盘入场、T+10 收盘退出的固定坐标下逐决策日按合成分排序取前 3/5/10/20 名，" +
      "与当日全部候选等权（= 随机 N 的期望）配对比较。除 members 外与 composite-factor-equal-weight-study 逐字一致，" +
      "样本池 / 档位 / 日集 / Bootstrap 口径完全相同 ⇒ 可逐档横向比较。不做权重优化、不改因子定义、不做 OOS。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "composite-factor",
      "equal-weight",
      "frozen-buckets",
      "subset-composition",
      "ablation",
      "top-n-ranking",
      "bootstrap",
    ],
    pageTitle: "组合因子等权（强正向四因子）",
    members: strongSubsetMembers().map(member => ({
      code: member.code,
      direction: member.direction,
      orientation: member.orientation,
    })),
    normalization: "BUCKET_POSITIONAL",
    weighting: { mode: "EQUAL" },
  });

export default compositeFactorFourStrongStudyExperiment;
