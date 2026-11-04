/**
 * 受约束组合因子实验组 —— **三个实验实例**（一次调用一个，与模板约定一致）。
 *
 * ## 与既有实例的关系
 *
 * ```
 * composite-factor-equal-weight-study        12F，等权            RUN-20260925-F92742B8
 * composite-factor-four-strong-study         4F，等权             RUN-20260925-5B9BD064
 * ── 本轮（受约束权重三方案，全部只换 members + weighting）─────────────
 * composite-factor-2f-amplitude-study        2F，等权（50/50）
 * composite-factor-3f-amplitude-volume-study 3F，等权（各 1/3）
 * composite-factor-4f-weighted-study         4F，自定义（35/35/15/15）
 * ```
 *
 * ## 🔴 与既有实例的差异面（必须只有这两项）
 *
 * | 项 | 是否改动 |
 * |---|---|
 * | `members` | ✅ 按方案取子集 |
 * | `weighting` | ✅ 2F/3F = `EQUAL`；4F-WEIGHTED = `CUSTOM`（归一化 Σw = 1） |
 * | Dataset / 样本池（`deriveTwelveFactorSamples`） | ❌ 未动 |
 * | 标准化（`BUCKET_POSITIONAL`） | ❌ 未动 |
 * | TopN 3/5/10/20、`OWN` / `FIXED` 日集 | ❌ 未动 |
 * | 坐标 T+6 Open → T+10 Close、成本 20 bps | ❌ 未动（`assertTemplateCoordinate()` 强制） |
 * | Bootstrap 种子机制、时间切片、随机抽签检验 | ❌ 未动 |
 * | 因子定义 / 桶边界 / 方向 | ❌ 未动（全部经 `members.ts` 适配器 import） |
 *
 * ⇒ 四个实例（含已落库的 4F 等权基线）**共用同一份 `deriveTwelveFactorSamples`**，
 *    候选 / 入池 / 剔除原因与各档纳入日数应逐格相同，差异只可能来自「排序键」。
 *
 * ## 刻意不做
 *
 * - ❌ **不做自由 / 连续权重搜索**：只有 3 个事先定好的方案，一次跑完、全部输出、**不择优**；
 * - ❌ 不新增因子、不改任何因子定义 / 桶边界 / 方向；
 * - ❌ 不做 OOS、不宣称最优、不形成策略结论（`EXPLORATORY`）。
 */

import { defineCompositeFactorExperiment } from "../../shared/compositeFactor";
import { CONSTRAINED_WEIGHT_PRESETS, membersOf } from "./presets";
import { COMPUTATION_VERSION } from "./result";

/** 本实验组共用的标签（`tags` 会进结果信封，供事后筛选整组）。 */
const SHARED_TAGS = [
  "first-board-pullback",
  "composite-factor",
  "constrained-weight",
  "frozen-buckets",
  "subset-composition",
  "ablation",
  "top-n-ranking",
  "bootstrap",
] as const;

/**
 * 按预设方案构造实验定义。
 *
 * 🔴 三个实例**只差 `members` 与 `weighting`**，其余参数（`normalization` / `topNSizes` /
 *    `dayScopes`）一律走模板默认值 ⇒ 「一个方案一处差异」这件事在代码里是结构性的，
 *    不靠人工逐项对照。
 */
export const constrainedWeightExperiments = CONSTRAINED_WEIGHT_PRESETS.map(preset =>
  defineCompositeFactorExperiment({
    id: preset.experimentId,
    name: preset.name,
    version: COMPUTATION_VERSION,
    description: preset.description,
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [...SHARED_TAGS],
    pageTitle: preset.pageTitle,
    members: membersOf(preset.memberCodes),
    normalization: "BUCKET_POSITIONAL",
    weighting: preset.weighting,
  })
);

/** 三个实例按方案顺序展开（供 `manifest.ts` 显式登记，便于逐一 review）。 */
export const [compositeFactorTwoFactorStudyExperiment] = constrainedWeightExperiments.slice(0, 1);
export const [compositeFactorThreeFactorStudyExperiment] = constrainedWeightExperiments.slice(1, 2);
export const [compositeFactorFourWeightedStudyExperiment] = constrainedWeightExperiments.slice(2, 3);

export default constrainedWeightExperiments;
