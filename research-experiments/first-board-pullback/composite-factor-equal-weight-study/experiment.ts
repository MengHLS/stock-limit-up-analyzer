/**
 * 组合因子等权模板 · **12 冻结因子参照实例**（第一版）。
 *
 * 这是 `COMPOSITE_FACTOR_EXPERIMENT_V1`（`shared/compositeFactor`）的**第一个真实实例**，
 * 目的有两个：
 *
 * 1. **验证模板**：12 因子等权 + 桶位分标准化 + 冻结方向，在本模板下的合成分
 *    与 `FROZEN-BUCKET-CONTRACT-001 §3.3` 的 `composite` **逐位相同**；
 *    因此 Top-3 / Top-5 / Top-10 的**点估计**必须与既有
 *    `first-board-pullback/twelve-factor-topn-ranking-study` 的对应档位逐位一致
 *    （那是一个独立实现，两者一致即证明本模板没有把交易 / 样本口径写歪）。
 * 2. **第一阶段交付**：12 因子 + 按单因子实验确定的方向 + 等权 + TopN 3/5/10/20。
 *
 * ## 刻意不做（与 PLAN/契约一致）
 *
 * - ❌ 不修改 12 个因子的定义（边界 / 方向 / 取值口径一律 import，见 `members.ts` 的适配器）；
 * - ❌ 不新增复杂组合算法（合成只有「方向 → 标准化 → 加权」三步，标准化只有两种单调映射）；
 * - ❌ 不做权重优化（等权 `1/12`；`CUSTOM` 接口已预留但本实例不启用）；
 * - ❌ 不做归因、不做 OOS、不宣称最优。
 */

import {
  FROZEN_TWELVE_FACTOR_MEMBERS,
  defineCompositeFactorExperiment,
} from "../../shared/compositeFactor";
import { COMPUTATION_VERSION } from "./result";

export const compositeFactorEqualWeightStudyExperiment =
  defineCompositeFactorExperiment({
    id: "first-board-pullback/composite-factor-equal-weight-study",
    name: "组合因子等权模板 · 12 冻结因子参照实例（第一版）",
    version: COMPUTATION_VERSION,
    description:
      "通用组合因子实验模板（COMPOSITE_FACTOR_EXPERIMENT_V1）的参照实例：" +
      "把 FROZEN-BUCKET-CONTRACT-001 的 12 个冻结因子按各自动冻结方向做桶位分标准化、" +
      "等权（各 1/12）合成一个排序键，在 T+6 开盘入场、T+10 收盘退出的固定坐标下，" +
      "逐决策日按合成分排序取前 3/5/10/20 名，与当日全部候选等权（= 随机 N 的期望）配对比较。" +
      "交易 / 结果 / PIT / 基准全部复用 SINGLE_FACTOR_EXPERIMENT_V1 引擎，本实验只新增合成分。" +
      "不改因子定义、不做权重优化、不重估边界、不做归因、不做 OOS。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "composite-factor",
      "equal-weight",
      "frozen-buckets",
      "top-n-ranking",
      "template-reference",
      "bootstrap",
    ],
    pageTitle: "组合因子等权模板（12 冻结因子）",
    members: FROZEN_TWELVE_FACTOR_MEMBERS.map(member => ({
      code: member.code,
      direction: member.direction,
      orientation: member.orientation,
    })),
    normalization: "BUCKET_POSITIONAL",
    weighting: { mode: "EQUAL" },
  });

export default compositeFactorEqualWeightStudyExperiment;
