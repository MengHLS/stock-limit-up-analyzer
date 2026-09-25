/**
 * 组合因子 **OOS 验证组** —— 三个实验实例（一次调用一个，与模板约定一致）。
 *
 * ## 与既有实例的关系（**只差 id**）
 *
 * ```
 * composite-factor-3f-amplitude-volume-study    3F 等权（各 1/3）   ← 全窗口 EXPLORATORY
 * composite-factor-four-strong-study            4F 等权（各 1/4）   ← 全窗口 EXPLORATORY
 * composite-factor-equal-weight-study           12F 等权（各 1/12） ← 全窗口 EXPLORATORY
 * ── 本组（members / weighting 逐字复制，只换 id）──────────────────────
 * composite-factor-3f-amplitude-volume-oos-study     3F     （主判定）
 * composite-factor-4f-equal-weight-oos-study         4F-EQ  （描述性参照）
 * composite-factor-12f-equal-weight-oos-study        12F-EQ （负对照）
 * ```
 *
 * ## 🔴 与既有实例的差异面（必须只有 `id` 与其文案）
 *
 * | 项 | 是否改动 |
 * |---|---|
 * | `members` | ❌ 逐字复制（`presets.ts` 加载时用桶词表指纹硬断言） |
 * | `weighting` | ❌ 全部 `EQUAL` |
 * | Dataset / 样本池（`deriveTwelveFactorSamples`） | ❌ 未动 |
 * | 标准化（`BUCKET_POSITIONAL`） | ❌ 未动 |
 * | TopN 3/5/10/20、`OWN` / `FIXED` 日集 | ❌ 未动 |
 * | 坐标 T+6 Open → T+10 Close、成本 20 bps | ❌ 未动（`assertTemplateCoordinate()` 强制） |
 * | **读取窗口** | ✅ **由平台协议在取数层施加**（本组代码里没有任何过滤逻辑） |
 *
 * ## 窗口从哪来（这是本组唯一的新增语义）
 *
 * 窗口**不是**本组的参数、也不是本组写的过滤代码，而是 Run 的 `protocol`：
 *
 * ```ts
 * // 选择段（放行门槛）
 * { phase: "OBSERVATION", observationWindow: {2019-01-01 .. 2023-12-31}, holdoutWindow: {...} }
 * // 验证段（主判定；必须引用上面那个已 COMPLETED 的 Observation Run）
 * { phase: "HOLDOUT", parentRunId: "RUN-…", ... }
 * ```
 *
 * 平台据此把 `evaluationWindow` 传到 `server/researchExperiments/datasetPort.ts`，
 * 由它转成 `fromDate` / `toDate` 交给读取层 ⇒ **实验侧不可能「忘了过滤」**。
 */

import { defineCompositeFactorExperiment } from "../../shared/compositeFactor";
import { OOS_PRESETS, membersOf } from "./presets";
import { COMPUTATION_VERSION } from "./result";

/** 本组共用的标签（`tags` 会进结果信封，供事后筛选整组）。 */
const SHARED_TAGS = [
  "first-board-pullback",
  "composite-factor",
  "oos-validation",
  "post-hoc-window",
  "frozen-buckets",
  "subset-composition",
  "top-n-ranking",
  "bootstrap",
] as const;

/**
 * 按预设方案构造实验定义。
 *
 * 🔴 三个实例**只差 `id` / 文案**：`normalization` / `topNSizes` / `dayScopes` / `weighting`
 *    一律走模板默认值或预设值 ⇒ 「一个方案一处差异」在代码里是结构性的。
 *
 * ⚠️ `descriptor.parameters` 一律为空数组：本组**不引入任何自造参数**（尤其不引入
 *    「事件年份过滤」这类参数）。窗口的唯一来源是平台协议 —— 自造参数会绕过平台的
 *    参数冻结、单次 Holdout 与污染守卫三条纪律（见 `presets.ts` 文件头）。
 */
export const compositeFactorOosValidationExperiments = OOS_PRESETS.map(preset =>
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
export const [compositeFactorThreeFactorOosExperiment] =
  compositeFactorOosValidationExperiments.slice(0, 1);
export const [compositeFactorFourEqualOosExperiment] =
  compositeFactorOosValidationExperiments.slice(1, 2);
export const [compositeFactorTwelveEqualOosExperiment] =
  compositeFactorOosValidationExperiments.slice(2, 3);

export default compositeFactorOosValidationExperiments;
