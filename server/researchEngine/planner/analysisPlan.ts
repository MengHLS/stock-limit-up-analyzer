/**
 * RESEARCH-PLANNER-001 — Analysis Plan 生成器（纯逻辑，零 IO）。
 *
 * 解决的问题（任务书 §6 / §7 / §8 / §9 / §10）：
 *   把「一个 Research Module + 该 Dataset 的真实能力」展开成**一组具体的分析**，
 *   并使这组分析**可预览、可复核、有优先级、规模可控**。
 *
 * 四条设计纪律：
 *
 *   1. **零 IO、零统计**
 *      本模块不读 DB、不读 Dataset、不算任何数字。它只做「选择与展开」：
 *      选目标视界 / 选条件 / 选分组 / 排优先级 / 裁规模。
 *      真正的统计一律由既有 Analysis Executor 执行（§2.1）。
 *
 *   2. **只生成「一定跑得动」的配置**
 *      每一条生成的变量名都先与 `PlanDataFacts`（来自 Dataset Version 的真实覆盖）核对；
 *      核对不通过的分析**直接不生成**，并记一条 `ResearchPlanDropNote`。
 *      绝不允许「先生成、跑到一半再报 UNKNOWN_VARIABLE」——
 *      那会让用户看到一份注定残缺的计划，且失败信息出现在执行期而非预览期（§22）。
 *
 *   3. **PIT 由构造方式保证，不靠事后检查**
 *      观察日条件的求值日 k 与被引用变量的 `availableFromOffset` **逐条相等**
 *      （`pullback_holds_event_*_{k}d` 的 offset 就是 k）。
 *      因此不可能生成「用 T+5 的信息判断 T+3」的条件 —— 这不是「记得别写错」，
 *      而是配方 `build(ctx)` 的签名里根本没有「另一个 offset」可填。
 *
 *   4. **规模超限时裁剪，不报错**（§9）
 *      但裁剪**永不丢 P0 必需项**：核心问题（含基线）必须被回答，
 *      次要维度（对照组 / 精修 / 探索分位）才是被舍弃的对象。
 *      被裁掉的每一条都进 `dropped`，附确切理由 —— 用户能看到「本来还打算做什么」。
 */

import type {
  ResearchAnalysisPriority,
  ResearchPlanDropNote,
  ResearchPlanItem,
  ResearchPlanNotes,
  SegmentStatKind,
} from "../../researchCore";
import {
  RESEARCH_PLAN_DEFAULT_ANALYSIS,
  RESEARCH_PLAN_MAX_ANALYSIS,
  RESEARCH_PLAN_MIN_ANALYSIS,
} from "@shared/researchContracts";
import type { ResearchModuleSpec } from "./moduleRegistry";
import type { RecipeConditionRow, ResearchConditionRecipe, ResearchConditionRecipeContext } from "./moduleRegistry";
// 变量命名的**唯一权威**（`windowOutcomeVariableName` / `segmentValueWindow`）。
// 生成期能力检查必须用它 —— 自己再写一份「变量名怎么拼」的规则就等于造第二套口径，
// 迟早出现「计划说可用、执行期说没这个变量」。
import { segmentValueWindow, windowOutcomeVariableName } from "../variables";

/**
 * 单份计划的默认分析数上限（§9 建议区间 20~50 内的取值）。
 *
 * 为什么落在 30：实测一条 135 分析的 Run 耗时约 425s（跨境 TiDB，RTT ≈ 208ms），
 * 即**单个分析均摊 ≈ 3.1s**；30 条 ≈ 95s，是「用户愿意在页面上等」的量级。
 * 更大规模的探索属于高级/专家模式（人工建分析 + 增量补跑），不属于自动规划。
 */
export const MAX_ANALYSIS_PER_PLAN_DEFAULT = RESEARCH_PLAN_DEFAULT_ANALYSIS;

/** 计划规模上限的合法区间（单一来源在 `shared/researchContracts.ts`，前后端同源）。 */
export const MIN_ANALYSIS_PER_PLAN = RESEARCH_PLAN_MIN_ANALYSIS;
export const MAX_ANALYSIS_PER_PLAN = RESEARCH_PLAN_MAX_ANALYSIS;

/** 生成计划时依据的**真实数据事实**（全部来自 Dataset Version，不臆造）。 */
export interface PlanDataFacts {
  datasetVersionId: number;
  /** Dataset Version 真实登记的**特征变量**名清单。 */
  readonly features: readonly string[];
  /** `path.relativeDay` 的真实可用相对日（升序）。 */
  readonly pathHorizons: readonly number[];
  /** `outcome.horizon` 的真实取值（升序）。 */
  readonly outcomeHorizons: readonly number[];
  /** `post.relativeDay` 的可用上界（0 = 该版本无 post 数据 ⇒ 一切观察日条件不可用）。 */
  readonly observationMaxOffset: number;
  /** Dataset 支持的分组维度键。 */
  readonly dimensions: readonly string[];
}

export interface GenerateAnalysisPlanInput {
  /** 主模块（决定研究骨架）。 */
  readonly primary: ResearchModuleSpec;
  /** 辅助模块（只贡献「推荐分析类型」里尚未被主模块覆盖的部分；可为空）。 */
  readonly secondary?: readonly ResearchModuleSpec[];
  readonly facts: PlanDataFacts;
  /** 计划上限；缺省 `MAX_ANALYSIS_PER_PLAN_DEFAULT`。 */
  readonly maxAnalysisPerPlan?: number;
  /**
   * 用户原话（可选）。
   *
   * 只用于一件事：**精修配方的排序**。用户问「回踩深度」时，深度分档应排在缩量 / 阳线之前；
   * 问「缩量」时反之。规模裁剪（§9）从队尾开始，因此排序直接决定「先保谁」。
   * 不参与任何数值计算（§2.2）。
   */
  readonly questionText?: string;
}

export interface GeneratedAnalysisPlan {
  items: ResearchPlanItem[];
  dropped: ResearchPlanDropNote[];
  conditionReadback: ResearchPlanNotes["conditionReadback"];
  selectionRationale: string[];
  capApplied: boolean;
  maxAnalysisPerPlan: number;
  /** 计划实际采用的分析类型（升序去重）。 */
  analysisTypes: string[];
  /**
   * **与用户提问侧重直接相关**的分析名（§13 / §15 / §28）。
   *
   * 由「强调词命中的精修配方」生成的那几条分析名。它存在的唯一理由是：
   * **提问的侧重必须在结论页被回答**。
   *
   * 🔴 实测缺口（§28 第二验收问题的 Phase I 实测）：
   *    用户问「回踩得深一点是不是更值得买入，还是回踩浅一点更好？」，
   *    系统确实把深档 / 浅档两条分析都跑了、也检出了 Finding（深档超额 −8.49%、
   *    浅档 −2.94%，t 分别 −39.9 / −18.1），但结论页第一屏的「关键发现」是按
   *    `researchStrength`（在 1.0 处**饱和**）+ 样本量排序的，于是
   *    「n=1602、超额 −8.5pp」被「n=8856、超额 +5.3pp」挤到第 6 名之后，
   *    而结论正文的「关键量」又由固定的分析类型优先级（QUANTILE 优先）选出 ——
   *    **用户问的那个问题，在自己问题的结论页上读不到答案。**
   *
   *    这里把「哪些分析是用户在问的」记下来，一路带到 Finding / 结论层
   *    （`buildResearchOutcome` 据此产出 `questionAlignedFindings` 并在结论正文里
   *    显式分段），本字段**不含任何统计结果**，只是计划侧的标注。
   */
  emphasisAnalysisNames: string[];
}

// ---------------------------------------------------------------------------
// 条件字段的人读回执
// ---------------------------------------------------------------------------

/**
 * 把一个引擎条件字段翻译成人话（供「计划预览」核对口径）。
 *
 * 存在的唯一理由：用户必须能回答「系统理解的和我说的是一回事吗」。
 * 尤其是「未破首板日**开盘价**」与「未破首板日**最低价**」这两个口径，
 * 名字只差一个词，研究含义却不同 —— 必须显式回显。
 */
export function describeConditionField(fieldName: string): string | null {
  let m = /^pullback_holds_event_open_(\d+)d$/.exec(fieldName);
  if (m) return `截至 T+${m[1]}，回调期间最低价始终未跌破**首板日开盘价**`;
  m = /^pullback_holds_event_low_(\d+)d$/.exec(fieldName);
  if (m) return `截至 T+${m[1]}，回调期间最低价始终未跌破**首板日最低价**`;
  m = /^pullback_close_ratio_(\d+)d$/.exec(fieldName);
  if (m) return `T+${m[1]} 收盘 / 首板日收盘（1 = 持平，< 1 = 仍在回踩）`;
  m = /^pullback_min_volume_ratio_(\d+)d$/.exec(fieldName);
  if (m) return `T+1..T+${m[1]} 期间最小成交量 / 首板日成交量（< 1 = 缩量）`;
  m = /^pullback_last_volume_ratio_(\d+)d$/.exec(fieldName);
  if (m) return `T+${m[1]} 当日成交量 / 首板日成交量（> 1 = 放量）`;
  m = /^pullback_last_is_bullish_(\d+)d$/.exec(fieldName);
  if (m) return `T+${m[1]} 当日为阳线（收盘 > 开盘）`;
  m = /^obs_(\d+)d\.(.+)$/.exec(fieldName);
  if (m) {
    const fields: Record<string, string> = {
      open: "开盘价",
      high: "最高价",
      low: "最低价",
      close: "收盘价",
      volume: "成交量",
      amount: "成交额",
      return_from_event_close: "相对首板日收盘涨跌幅",
      volume_ratio: "相对首板日成交量比",
    };
    return `T+${m[1]} 的${fields[m[2]!] ?? m[2]}（在 T+${m[1]} 收盘时点可观测）`;
  }
  return null;
}

/**
 * 把一条条件翻译成人读回执。
 *
 * 🔴 必须**按算子纠正语义**：`pullback_holds_event_open_2d == 1` 是「未跌破开盘价」，
 * 而 `== 0` 是它的**否定**（「已跌破」）。若两者回执写同一句话，
 * 用户在计划预览里核对口径时会被误导成「系统把对照组当成守卫组」——
 * 这类「读起来反了」的错比没有回执更糟。
 */
function readbackOf(rows: readonly RecipeConditionRow[]): ResearchPlanNotes["conditionReadback"] {
  return rows
    .map((r) => {
      const base = describeConditionField(r.fieldName) ?? `（未登记人读口径的字段：${r.fieldName}）`;
      return {
        fieldName: r.fieldName,
        operator: r.operator,
        value: r.value,
        readback: applyOperatorSemantics(r.fieldName, base, r.operator, r.value),
      };
    })
    // 去重（同一字段可能在多条分析里出现）：按「字段+算子+值」唯一。
    .filter((row, index, all) =>
      all.findIndex((x) => x.fieldName === row.fieldName && x.operator === row.operator && String(x.value) === String(row.value)) === index);
}

/**
 * 把「字段本身的含义」按算子调整成「这条条件实际表达的含义」。
 *
 * 只有两类需要动手：
 *   - 布尔族（`holds_event_*` / `is_*`）的 `== 0` 与 `!= 1` → 取反；
 *   - 其余（数值比较）保持字段含义不变（「收盘 / 首板日收盘」配上 `<= 0.95`
 *     已经由算子本身表达清楚，不需要在回执里再加形容词）。
 */
function applyOperatorSemantics(
  /** 条件字段名（判据用它，**不是**用人读文本 —— 人读文本里没有变量名）。 */
  fieldName: string,
  base: string,
  operator: string,
  value: unknown,
): string {
  // 布尔族：取值只有 0/1，`== 0` 就是「字段描述不成立」。
  const isFlagField = /holds_event_(low|open)/.test(fieldName) || /_is_bullish_/.test(fieldName);
  if (!isFlagField) return base;
  const negated =
    (operator === "==" && (value === 0 || value === "0"))
    || (operator === "!=" && (value === 1 || value === "1"));
  return negated ? `**不成立（已破位/非阳线）**：${base}` : base;
}

// ---------------------------------------------------------------------------
// 目标视界解析
// ---------------------------------------------------------------------------

/**
 * 解析实际采用的**收益视界**（升序，最多 3 个）。
 *
 * 判据 = 该视界上 `future_return_{h}d` 真的在 Dataset 的 path 覆盖内。
 * 推荐视界全部不可用时**回落到真实最大视界**（而不是留空）——
 * 留空会让 EVENT_STUDY 直接 `INVALID_ANALYSIS_CONFIG` 失败，
 * 而「用该数据集能给的视界跑基准」是任何情况下都有意义的研究。
 */
export function resolveReturnHorizons(
  preferred: readonly number[],
  pathHorizons: readonly number[],
): { horizons: number[]; usedFallback: boolean; fallbackReason: string | null } {
  const available = new Set(pathHorizons.filter((h) => Number.isInteger(h) && h >= 1));
  const picked = preferred.filter((h) => available.has(h)).sort((a, b) => a - b).slice(0, 3);
  if (picked.length > 0) return { horizons: picked, usedFallback: false, fallbackReason: null };
  const sorted = [...available].sort((a, b) => a - b);
  if (sorted.length === 0) return { horizons: [], usedFallback: false, fallbackReason: null };
  return {
    horizons: [sorted[sorted.length - 1]!],
    usedFallback: true,
    fallbackReason:
      `推荐视界 ${preferred.join(" / ")} 在该 Dataset 的 path 覆盖内一个都没有，`
      + `已回落到该数据集可用的最大视界 T+${sorted[sorted.length - 1]!}。`,
  };
}

/** 解析实际采用的目标变量（收益族优先，缺失时用最大回撤）。 */
export function resolvePrimaryTarget(
  targetKinds: readonly string[],
  returnHorizons: readonly number[],
  outcomeHorizons: readonly number[],
): { variable: string | null; kind: string | null; reason: string } {
  const h = returnHorizons[0];
  if (h !== undefined && targetKinds.includes("future_return")) {
    return {
      variable: `future_return_${h}d`,
      kind: "future_return",
      reason: `主目标取 T+${h} 收盘收益（future_return_${h}d）—— 它是最直观、也最容易与「全样本基准」对照的量。`,
    };
  }
  const drawdown = [...outcomeHorizons].sort((a, b) => a - b)[0];
  if (drawdown !== undefined && targetKinds.includes("max_drawdown")) {
    return {
      variable: `max_drawdown_${drawdown}d`,
      kind: "max_drawdown",
      reason: `该数据集没有可用的 path 收益视界，主目标回落到 T+${drawdown} 区间最大回撤（max_drawdown_${drawdown}d）。`,
    };
  }
  return { variable: null, kind: null, reason: "该数据集既无 path 收益视界也无 outcome 视界，无法选定主目标变量。" };
}

// ---------------------------------------------------------------------------
// 计划生成
// ---------------------------------------------------------------------------

type DraftItem = ResearchPlanItem;

/** 生成分析计划（纯函数；同样输入必得同样输出）。 */
export function generateAnalysisPlan(input: GenerateAnalysisPlanInput): GeneratedAnalysisPlan {
  const { primary, facts } = input;
  const secondary = input.secondary ?? [];
  const max = clampMax(input.maxAnalysisPerPlan ?? MAX_ANALYSIS_PER_PLAN_DEFAULT);
  /** 用户原话：只用于「精修配方排序」与「与提问直接相关的分析标注」，不参与任何数值计算。 */
  const questionText = input.questionText ?? "";

  const items: DraftItem[] = [];
  const dropped: ResearchPlanDropNote[] = [];
  const selectionRationale: string[] = [];
  const conditionEntries: ResearchPlanNotes["conditionReadback"] = [];
  const emphasisAnalysisNames: string[] = [];
  let order = 0;

  const push = (item: Omit<DraftItem, "sortOrder">): void => {
    items.push({ ...item, sortOrder: order });
    order += 1;
  };
  const drop = (
    analysisType: DraftItem["analysisType"],
    name: string,
    reason: ResearchPlanDropNote["reason"],
    detail: string,
  ): void => {
    dropped.push({ moduleKey: primary.key, analysisType, name, reason, detail });
  };

  // ---- 能力缺失：整模块不可用（不是「跑出来没有样本」，而是「根本读不到数据」）----
  const missing = primary.requiredCapabilities.filter((cap) => {
    if (cap === "post") return facts.observationMaxOffset <= 0;
    if (cap === "path") return facts.pathHorizons.length === 0;
    if (cap === "outcome") return facts.outcomeHorizons.length === 0;
    if (cap === "features") return facts.features.length === 0;
    return false;
  });
  if (missing.length > 0) {
    const capNames = missing
      .map((c) => ({ features: "事件日特征列", path: "事件后逐日路径", outcome: "事件后区间聚合", post: "事件后观察日行情" })[c])
      .join(" / ");
    drop(
      primary.primaryAnalysisType,
      `${primary.label}（整个方法）`,
      "CAPABILITY_MISSING",
      `该 Dataset Version 缺少本方法必需的数据能力：${capNames}。`
        + `缺少时不会生成任何分析（也不会用别的口径顶替）—— 详见任务书 §22「不满足条件的 Analysis 不得偷偷执行」。`,
    );
    return {
      items: [],
      dropped,
      conditionReadback: [],
      selectionRationale: [
        `研究方法：${primary.label}（${primary.key}）`,
        `⚠️ 该方法在本 Dataset 上不可用：${capNames}`,
      ],
      capApplied: false,
      maxAnalysisPerPlan: max,
      analysisTypes: [],
      emphasisAnalysisNames: [],
    };
  }

  // ---- 目标视界 / 目标变量 ----
  const horizonPlan = resolveReturnHorizons(primary.preferredHorizons, facts.pathHorizons);
  const returnHorizons = horizonPlan.horizons;
  if (horizonPlan.fallbackReason !== null) selectionRationale.push(horizonPlan.fallbackReason);
  selectionRationale.push(
    `采用收益视界：${returnHorizons.length > 0 ? returnHorizons.map((h) => `T+${h}`).join(" / ") : "（该数据集无 path 收益视界）"}`,
  );

  const target = resolvePrimaryTarget(primary.targetKinds, returnHorizons, facts.outcomeHorizons);
  selectionRationale.push(target.reason);
  const primaryTarget = target.variable;
  const h0 = returnHorizons[0] ?? null;

  const minSampleCount = primary.minSampleCount;
  const recipeCtxBase = {
    observationMaxOffset: facts.observationMaxOffset,
    pathHorizons: facts.pathHorizons,
    outcomeHorizons: facts.outcomeHorizons,
  };

  // ---- 基线：全样本事件研究（P0 必需）----
  if (returnHorizons.length > 0) {
    push({
      analysisType: "EVENT_STUDY",
      name: `全样本基准 · 事件后收益 ${returnHorizons.map((h) => `T+${h}`).join("/")}`,
      config: { horizons: [...returnHorizons], minSampleCount },
      priority: "P0",
      purpose:
        "建立全样本参照系：没有它就无法判断「某个条件下更好」到底是条件起了作用，还是这段时间整体就好。",
      required: true,
      moduleKey: primary.key,
    });
  }

  // ---- 基线：结果分布描述（P1）----
  if (primaryTarget !== null) {
    const descVariables = [primaryTarget, ...primary.quantileFeatures.filter((f) => facts.features.includes(f)).slice(0, 2)];
    push({
      analysisType: "DESCRIPTIVE",
      name: `全样本分布 · ${descVariables.join(" / ")}`,
      config: { variables: descVariables, minSampleCount },
      priority: "P1",
      purpose: "描述目标与特征的中心趋势 / 离散度 / 缺失率，用于判断数据能否支撑后续比较。",
      required: false,
      moduleKey: primary.key,
    });
  }

  // ---- 稳定性基线（P1）----
  if (primaryTarget !== null) {
    const dim = pickDimension(primary.stabilityDimension, facts.dimensions);
    if (dim === null) {
      drop(
        "STABILITY",
        `基准稳定性 · 按 ${primary.stabilityDimension} 分组`,
        "CAPABILITY_MISSING",
        `该 Dataset 不提供分组维度「${primary.stabilityDimension}」，不生成稳定性分析（不会换一个维度顶替）。`,
      );
    } else {
      push({
        analysisType: "STABILITY",
        name: `基准稳定性 · 按 ${dim} 分组`,
        config: { targetField: primaryTarget, stabilityDimension: dim, minSampleCount },
        priority: "P1",
        purpose: "检验全样本结论是否只在个别年份 / 板块成立，避免把一次性行情当成规律。",
        required: false,
        moduleKey: primary.key,
      });
    }
  }

  // ---- 求值日候选（T+k）：只保留真的取得到观察日数据的 ----
  const evaluations = primary.entryEvaluations
    .filter((k) => Number.isInteger(k) && k >= 1 && k <= facts.observationMaxOffset)
    .sort((a, b) => a - b)
    .slice(0, 3);
  if (primary.entryEvaluations.length > 0 && evaluations.length === 0) {
    drop(
      primary.primaryAnalysisType,
      `${primary.label} · 观察日条件分析`,
      "CAPABILITY_MISSING",
      `本方法需要观察日（post）条件，但该 Dataset 的 post 可用上界为 ${facts.observationMaxOffset}`
        + `（0 = 没有 post 数据），因此不生成任何观察日条件分析。`,
    );
  }

  // ---- 守卫条件分析（P0 必需：guardRecipes[0]；其余守卫为 P1 备选口径）----
  if (primaryTarget !== null && h0 !== null) {
    primary.guardRecipes.forEach((recipe, guardIndex) => {
      for (const k of evaluations) {
        const rows = safeBuild(recipe, k, recipeCtxBase);
        const name = `${recipe.label}（T+${k}） → T+${h0} 收益`;
        if (rows === null || rows.length === 0) {
          drop("CONDITIONAL", name, "CAPABILITY_MISSING", capabilityDetail(recipe, k, facts));
          continue;
        }
        conditionEntries.push(...readbackOf(rows));
        push({
          analysisType: "CONDITIONAL",
          name,
          target: primaryTarget,
          config: { targetField: primaryTarget, minSampleCount },
          conditions: rows,
          priority: guardIndex === 0 ? "P0" : "P1",
          purpose:
            `${recipe.purpose}目标：T+${h0} 收益。`
            + `条件在 T+${k} 收盘即可判定（观察日变量 availableFromOffset = ${k}），不含未来信息。`,
          required: guardIndex === 0,
          moduleKey: primary.key,
        });
      }
    });
  }

  // ---- 精修条件分析（P1）：守卫（主口径） + 精修 ----
  const primaryGuard = primary.guardRecipes[0];
  if (primaryTarget !== null && h0 !== null && primaryGuard !== undefined) {
    const refineOffsets = evaluations.slice(0, 2);
    /**
     * 🔴 顺序必须是「**先排序，再裁剪**」（§28 实测缺陷修复）。
     *
     * 旧写法 `rankRecipesByQuestion(refinementRecipes.slice(0, 6), q)` 先截断前 6 条再排序，
     * 于是「注册顺序排在第 7、8 位的配方永远进不了计划」，排序只能在这 6 条内部换位置。
     * PULLBACK_EFFECTIVENESS 的深度分档恰好注册在第 6/7/8 位 ⇒
     * 用户明确问「回踩深一点还是浅一点好」时，计划里只剩「浅」一档，
     * 深档根本没有分析可比。先排后裁之后，强调词命中的配方无论注册在哪都能进前 6。
     *
     * 同分保持注册顺序 ⇒ 结果可复现；裁剪上限由 `MAX_REFINEMENT_RECIPES` 单点定义。
     */
    const rankedRefinements = rankRecipesByQuestion(
      primary.refinementRecipes,
      questionText,
    ).slice(0, MAX_REFINEMENT_RECIPES);
    for (const k of refineOffsets) {
      for (const refine of rankedRefinements) {
        const guardRows = safeBuild(primaryGuard, k, recipeCtxBase);
        const refineRows = safeBuild(refine, k, recipeCtxBase);
        const name = `${primaryGuard.label} 且 ${refine.label}（T+${k}） → T+${h0} 收益`;
        if (guardRows === null || refineRows === null || guardRows.length === 0 || refineRows.length === 0) {
          drop("CONDITIONAL", name, "CAPABILITY_MISSING", capabilityDetail(refine, k, facts));
          continue;
        }
        // 合并成一个条件组（同一组的条件之间是 AND）—— 与研究语言里的「且」一致。
        const merged = mergeIntoOneGroup(guardRows, refineRows);
        conditionEntries.push(...readbackOf(merged));
        push({
          analysisType: "CONDITIONAL",
          name,
          target: primaryTarget,
          config: { targetField: primaryTarget, minSampleCount },
          conditions: merged,
          priority: "P1",
          purpose: `${primaryGuard.purpose}${refine.purpose}目标：T+${h0} 收益。两个条件都在 T+${k} 收盘可判定。`,
          required: false,
          moduleKey: primary.key,
        });
        // §13 / §15 —— 标记「这条分析就是用户在问的那件事」（去重，仅登记名字）。
        if (recipeMatchesEmphasis(refine, questionText) && !emphasisAnalysisNames.includes(name)) {
          emphasisAnalysisNames.push(name);
        }
      }
    }
  }

  // ---- 对照组（P2 探索）：守卫取反 ----
  if (primaryTarget !== null && h0 !== null) {
    for (const recipe of primary.controlRecipes.slice(0, 2)) {
      const k = evaluations[0];
      if (k === undefined) break;
      const rows = safeBuild(recipe, k, recipeCtxBase);
      const name = `${recipe.label}（T+${k}） → T+${h0} 收益`;
      if (rows === null || rows.length === 0) {
        drop("CONDITIONAL", name, "CAPABILITY_MISSING", capabilityDetail(recipe, k, facts));
        continue;
      }
      conditionEntries.push(...readbackOf(rows));
      push({
        analysisType: "CONDITIONAL",
        name,
        target: primaryTarget,
        config: { targetField: primaryTarget, minSampleCount },
        conditions: rows,
        priority: "P2",
        purpose: `${recipe.purpose}目标：T+${h0} 收益。有对照组才能回答「不满足条件会怎样」，否则只有单侧证据。`,
        required: false,
        moduleKey: primary.key,
      });
    }
  }

  // ---- QUANTILE（P1）：特征分位 × 主目标 ----
  if (primaryTarget !== null) {
    const usableFeatures = primary.quantileFeatures.filter((f) => facts.features.includes(f)).slice(0, 3);
    const missingFeatures = primary.quantileFeatures.filter((f) => !facts.features.includes(f));
    for (const feature of usableFeatures) {
      push({
        analysisType: "QUANTILE",
        name: `${feature} 分位 → T+${h0 ?? returnHorizons[0] ?? "?"} 收益（5 档）`,
        config: {
          featureField: feature,
          targetField: primaryTarget,
          quantileGroups: 5,
          minSampleCount,
        },
        priority: "P1",
        purpose: `检验「首板日可观测的 ${feature}」是否单调地影响后续收益 —— 这是唯一能在 T 日直接用于决策的一类变量。`,
        required: false,
        moduleKey: primary.key,
      });
    }
    if (missingFeatures.length > 0) {
      drop(
        "QUANTILE",
        `推荐特征分位：${missingFeatures.join(" / ")}`,
        "CAPABILITY_MISSING",
        `这些推荐特征不在本 Dataset 的变量目录中：${missingFeatures.join(" / ")}。不生成（不会用近似名顶替）。`,
      );
    }
  }

  // ---- SEGMENT_RELATION（P1）：回撤窗 → 后续收益窗 ----
  const segment = pickSegmentWindows(evaluations, returnHorizons, facts.pathHorizons, facts.outcomeHorizons);
  const segmentConfig = segment === null
    ? null
    : {
        windowA: [0, segment.anchor],
        windowB: [segment.anchor, segment.anchor + segment.span],
        windowAStat: "max_drawdown",
        windowBStat: "return",
        windowBands: 5,
        minSampleCount,
      };
  const segmentName = segment === null
    ? "回撤窗 → 后续收益窗（分段关系）"
    : `T+1..T+${segment.anchor} 最大回撤 → T+${segment.anchor + 1}..T+${segment.anchor + segment.span} 收益（分段关系）`;
  // 生成期能力闸门（§22）：窗 A / 窗 B 的变量必须都真的存在，否则**不生成**并如实登记原因。
  const segmentGap = segmentConfig === null
    ? "选不出同时满足「窗 A 口径可用（锚点落在 outcome 视界）」与「窗 B 取值区间被 path 逐日覆盖」的窗对。"
    : segmentRelationCapabilityDetail(segmentConfig, facts);

  if (segmentConfig !== null && segmentGap === null) {
    push({
      analysisType: "SEGMENT_RELATION",
      name: segmentName,
      config: segmentConfig,
      priority: "P1",
      purpose:
        "把「回撤深浅」当成连续变量而不是分档条件，检验它与**随后一段**收益的单调关系。"
        + "两窗取值区间不重叠（A = T+1..T+anchor、B = T+anchor+1..T+anchor+span），因此不存在同义反复。",
      required: false,
      moduleKey: primary.key,
    });
  } else if (returnHorizons.length > 0) {
    drop(
      "SEGMENT_RELATION",
      segmentName,
      "CAPABILITY_MISSING",
      `${segmentGap ?? ""}`
        + `（该 Dataset 的 path 相对日覆盖为 ${facts.pathHorizons.length > 0 ? facts.pathHorizons.join("/") : "无"}，`
        + `outcome 视界为 ${facts.outcomeHorizons.length > 0 ? facts.outcomeHorizons.join("/") : "无"}。）`
        + "不生成（不会用一个跑不动的配置顶替 —— 那只会让整轮 Run 在执行期失败）。",
    );
  }

  // ---- 辅助模块：只补「主模块没覆盖到的推荐分析类型」中的稳定性复核 ----
  for (const spec of secondary) {
    if (spec.key === primary.key) continue;
    if (!spec.recommendedAnalysisTypes.includes("STABILITY")) continue;
    if (primaryTarget === null) break;
    const dim = pickDimension(spec.stabilityDimension, facts.dimensions);
    if (dim === null) continue;
    const name = `${spec.label} · 按 ${dim} 分组稳定性复核`;
    if (items.some((i) => i.name === name)) continue;
    push({
      analysisType: "STABILITY",
      name,
      config: { targetField: primaryTarget, stabilityDimension: dim, minSampleCount },
      priority: "P2",
      purpose: `辅助方法「${spec.label}」建议的稳定性复核：同一结论换一个维度再验一次。`,
      required: false,
      moduleKey: spec.key,
    });
  }

  // ---- §9 规模裁剪 ----
  const capped = applyPlanCap(items, dropped, max, primary.key);

  /**
   * 🔴 标注必须**与最终保留的计划一致**。
   *
   * `applyPlanCap` 会按优先级从队尾裁掉条目；被裁掉的分析**不会被物化**，
   * 因此不能出现在「与提问直接相关」的名单里 —— 否则下游会去找一条不存在的分析，
   * 静默得到一个空列表，读起来像「你问的那件事没有任何证据」。
   * 被裁的情况要能在计划侧看出来（`dropped` 里有 `CAP_EXCEEDED` 记录）。
   */
  const keptNames = new Set(capped.items.map((i) => i.name));

  return {
    items: capped.items,
    dropped: capped.dropped,
    conditionReadback: dedupeReadback(conditionEntries),
    selectionRationale,
    capApplied: capped.capApplied,
    maxAnalysisPerPlan: max,
    analysisTypes: [...new Set(capped.items.map((i) => i.analysisType))].sort(),
    emphasisAnalysisNames: emphasisAnalysisNames.filter((n) => keptNames.has(n)),
  };
}

// ---------------------------------------------------------------------------
// §9 规模控制
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<ResearchAnalysisPriority, number> = { P0: 0, P1: 1, P2: 2 };

/**
 * 裁剪到上限（§9）。
 *
 * 算法（确定性）：
 *   1. **P0 必需项永不丢弃**（含基线）—— 无论上限多小。若必需项本身就超过上限，
 *      如实把 `capApplied` 标为 true 并在 dropNote 的 detail 里说明「已优先保留必需项」，
 *      而不是为了凑上限把核心问题砍掉。
 *   2. 剩余预算按 `P1 → P2`、同级按原 `sortOrder` 依次保留。
 *   3. 被舍弃的每一条都进 `dropped`（`reason = CAP_EXCEEDED`，detail 写明「为什么是它被舍弃」）。
 *
 * 为什么不是「简单报错」（§9 明确要求）：报错会让用户面对一份 90 条分析的计划无从下手；
 * 而「保留核心 + 如实告知舍弃了什么」既让研究能立刻开始，又保留了完整的可追溯性。
 */
export function applyPlanCap(
  items: readonly ResearchPlanItem[],
  droppedIn: readonly ResearchPlanDropNote[],
  max: number,
  moduleKey: string,
): { items: ResearchPlanItem[]; dropped: ResearchPlanDropNote[]; capApplied: boolean } {
  const dropped = [...droppedIn];
  if (items.length <= max) {
    return { items: renumber(items), dropped, capApplied: false };
  }

  const required = items.filter((i) => i.required || i.priority === "P0");
  const optional = items
    .filter((i) => !(i.required || i.priority === "P0"))
    .sort((a, b) =>
      (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (a.sortOrder - b.sortOrder));

  const kept = new Set<number>(required.map((i) => i.sortOrder));
  let budget = Math.max(0, max - required.length);
  for (const item of optional) {
    if (budget <= 0) break;
    kept.add(item.sortOrder);
    budget -= 1;
  }

  for (const item of optional) {
    if (kept.has(item.sortOrder)) continue;
    dropped.push({
      moduleKey,
      analysisType: item.analysisType,
      name: item.name,
      reason: "CAP_EXCEEDED",
      detail:
        `计划规模上限为 ${max} 条，本次展开出 ${items.length} 条。`
        + `已优先保留全部 P0 必需项（${required.length} 条）与高优先级辅助项，`
        + `本条（${item.priority}）被舍弃。可在高级/专家模式中手工创建同口径分析后增量补跑。`,
    });
  }

  const keptItems = items.filter((i) => kept.has(i.sortOrder));
  return { items: renumber(keptItems), dropped, capApplied: true };
}

/** 重新编号 `sortOrder`（保持顺序稳定），让「被裁掉的空洞」不出现在物化结果里。 */
function renumber(items: readonly ResearchPlanItem[]): ResearchPlanItem[] {
  return items.map((item, index) => ({ ...item, sortOrder: index }));
}

// ---------------------------------------------------------------------------
// 局部工具
// ---------------------------------------------------------------------------

function clampMax(raw: number): number {
  if (!Number.isFinite(raw)) return MAX_ANALYSIS_PER_PLAN_DEFAULT;
  const i = Math.floor(raw);
  if (i < 1) return 1;
  if (i > MAX_ANALYSIS_PER_PLAN) return MAX_ANALYSIS_PER_PLAN;
  return i;
}

/** 构造条件行的安全包装：配方内部异常 → `null`（等价于「本数据集不支持」），不让计划生成崩掉。 */
function safeBuild(
  recipe: ResearchConditionRecipe,
  offset: number,
  base: Omit<ResearchConditionRecipeContext, "offset">,
): RecipeConditionRow[] | null {
  try {
    return recipe.build({ ...base, offset });
  } catch {
    return null;
  }
}

function capabilityDetail(
  recipe: ResearchConditionRecipe,
  offset: number,
  facts: PlanDataFacts,
): string {
  return (
    `条件配方「${recipe.label}」在求值日 T+${offset} 上无法构造：`
    + `其依赖的变量族为 ${recipe.variableNames.join(" / ")}，`
    + `而该 Dataset 的观察日（post）可用上界为 ${facts.observationMaxOffset}。`
    + `不生成该分析（不会退化成「无条件分析」—— 那等价于全样本，读数含义已变）。`
  );
}

/** 两条配方产出的条件合并进**同一个条件组**（组内 AND），sortOrder 连续重排。 */
function mergeIntoOneGroup(
  a: readonly RecipeConditionRow[],
  b: readonly RecipeConditionRow[],
): RecipeConditionRow[] {
  const all = [...a, ...b];
  return all.map((row, index) => ({ ...row, groupNo: 0, sortOrder: index, groupLogicalOperator: "AND" }));
}

function dedupeReadback(
  rows: ResearchPlanNotes["conditionReadback"],
): ResearchPlanNotes["conditionReadback"] {
  return rows.filter((row, index, all) =>
    all.findIndex((x) =>
      x.fieldName === row.fieldName && x.operator === row.operator && String(x.value) === String(row.value)) === index);
}

function pickDimension(preferred: string, available: readonly string[]): string | null {
  if (available.includes(preferred)) return preferred;
  return null;
}

/**
 * 每个求值日（entry evaluation offset）最多采纳的精修配方条数。
 *
 * 上限存在的理由：精修是「守卫 × 精修条件」的笛卡尔积，一条精修 = 一条分析；
 * 不设上限会让计划条数随配方表线性膨胀（§9「不要无限增加 Analysis」）。
 */
export const MAX_REFINEMENT_RECIPES = 6;

/**
 * 「配方显式声明的侧重词」命中一处的权重。
 *
 * 🔴 必须**大于**标签分词的权重（标签命中 1 处 = 1 分）：
 *   显式声明是配方作者写下的「用户在问这条」，而标签分词只是字符串巧合。
 *   旧实现只做标签分词，而深度分档的标签「回踩深度落在 <0.95]」分词后是
 *   「回踩深度落在 / 0.95」—— §28 的研究问题里两个都不出现，
 *   于是三条深度分档全得 0 分，排序退化成注册顺序（§28 实测缺陷）。
 */
export const RECIPE_EMPHASIS_WEIGHT = 2;

/**
 * 这条配方是否**被用户在问**（强调词命中，或标签分词命中）。
 *
 * 与 `rankRecipesByQuestion` 的区别：那个要的是「排序用的分数」，这里要的是
 * 「是 / 否」——用于给分析打「与提问直接相关」的标记（§13 / §15）。
 */
export function recipeMatchesEmphasis(
  recipe: ResearchConditionRecipe,
  questionText: string,
): boolean {
  if (questionText.trim() === "") return false;
  for (const keyword of recipe.emphasisKeywords ?? []) {
    if (keyword.length > 0 && questionText.includes(keyword)) return true;
  }
  const tokens = recipe.label
    .split(/[\s（）、，,()\[\]<>=≤≥%/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return tokens.some((t) => questionText.includes(t));
}

/**
 * 精修配方排序：**用户提问侧重降序**（同分保持注册顺序 ⇒ 结果可复现）。
 *
 * 得分 = ①`emphasisKeywords` 显式命中 × `RECIPE_EMPHASIS_WEIGHT`
 *      + ②配方标签分词命中数（兜底信号，仍然保留）。
 *
 * ⚠️ 本函数**只排序，不裁剪**。裁剪由调用方按 `MAX_REFINEMENT_RECIPES` 事后做 ——
 *    顺序颠倒（先 slice 再 rank）会让「排在第 7 位以后的配方永远没机会」，
 *    而 §28 的深度分档恰好注册在第 6/7/8 位。
 */
export function rankRecipesByQuestion(
  recipes: readonly ResearchConditionRecipe[],
  questionText: string,
): ResearchConditionRecipe[] {
  if (questionText.trim() === "") return [...recipes];
  const q = questionText;
  const relevance = (recipe: ResearchConditionRecipe): number => {
    let score = 0;
    for (const keyword of recipe.emphasisKeywords ?? []) {
      if (keyword.length > 0 && q.includes(keyword)) score += RECIPE_EMPHASIS_WEIGHT;
    }
    const tokens = recipe.label
      .split(/[\s（）、，,()\[\]<>=≤≥%/]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    score += tokens.filter((t) => q.includes(t)).length;
    return score;
  };
  return recipes
    .map((recipe, index) => ({ recipe, index, score: relevance(recipe) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((x) => x.recipe);
}

/**
 * 选一组**不重叠**的分段窗：窗 A = `[0, anchor]`（回撤），窗 B = `[anchor, anchor + span]`（后续收益）。
 *
 * 不重叠的数学保证：窗 A 的取值区间是 `[1, anchor]`（`from = 0` 时锚点日只作分母），
 * 窗 B 的取值区间是 `[anchor + 1, anchor + span]` —— 天然相邻且不相交。
 *
 * 🔴 锚点必须同时满足**两个**可用性条件（这是 E2E 实测暴露的缺陷修复）：
 *
 *   ① **窗 A 的变量必须存在**。窗 A 用的是 `max_drawdown` + `from = 0`，
 *      于是变量名 = `max_drawdown_{anchor}d` —— 它属于**既有 outcome 族**，
 *      而该族只覆盖 `outcomeHorizons`。因此 `anchor` 必须落在 outcome 视界里。
 *
 *      ⚠️ 旧实现只检查了窗 B，于是 anchor=2 时生成了 `max_drawdown_2d`：
 *      该变量在一个 outcome 视界 = {5,10,20} 的 Dataset 上**不存在**，
 *      导致整轮 Run 在执行期抛 `SEGMENT_RELATION 的窗 A … 不存在` 而**全部失败**。
 *
 *   ② **窗 B 的取值区间必须被 path 逐日覆盖**（是区间覆盖，不是只看两端）。
 *
 * 两条都满足才返回；返回 `null` 时调用方必须 `drop(CAPABILITY_MISSING)`，不得退化成一个跑不动的配置。
 */
export function pickSegmentWindows(
  evaluations: readonly number[],
  returnHorizons: readonly number[],
  pathHorizons: readonly number[],
  outcomeHorizons: readonly number[] = [],
): { anchor: number; span: number } | null {
  const path = new Set(pathHorizons);
  const outcome = new Set(outcomeHorizons);
  const span = [...returnHorizons].sort((a, b) => a - b)[0];
  if (span === undefined) return null;

  const covered = (from: number, to: number): boolean => {
    for (let d = from; d <= to; d += 1) if (!path.has(d)) return false;
    return true;
  };
  const acceptable = (anchor: number): boolean =>
    anchor >= 1 && outcome.has(anchor) && covered(anchor + 1, anchor + span);

  // 优先用「观察日候选」当锚点（与研究语言里的「回踩到第几天」对齐）；
  // 取不到时退到 outcome 视界本身 —— 那仍是一条合法的「回撤窗 → 后续收益窗」关系，只是不绑定某个观察日。
  for (const anchor of [...new Set(evaluations)].sort((a, b) => a - b)) {
    if (acceptable(anchor)) return { anchor, span };
  }
  for (const anchor of [...outcome].sort((a, b) => a - b)) {
    if (acceptable(anchor)) return { anchor, span };
  }
  return null;
}

/** `[from, to]` 是否被 path 逐日覆盖。 */
function pathRangeCovered(from: number, to: number, facts: PlanDataFacts): boolean {
  const have = new Set(facts.pathHorizons);
  for (let d = from; d <= to; d += 1) if (!have.has(d)) return false;
  return true;
}

/**
 * `SEGMENT_RELATION` 配置的**生成期能力检查**（§22）。
 *
 * 返回 `null` = 可用；否则返回人读的不可用原因（写进 `ResearchPlanDropNote.detail`）。
 *
 * 为什么必须有：分析计划生成器的第 2 条纪律是「只生成**一定跑得动**的配置」。
 * 这条检查与 `pickSegmentWindows` 共用同一套命名权威（`windowOutcomeVariableName`），
 * 因此「选窗」与「验窗」不可能各说各话。
 */
export function segmentRelationCapabilityDetail(
  config: { windowA: number[]; windowB: number[]; windowAStat: string; windowBStat: string },
  facts: PlanDataFacts,
): string | null {
  const [aFrom, aTo] = config.windowA;
  const [bFrom, bTo] = config.windowB;
  if (aFrom === undefined || aTo === undefined || bFrom === undefined || bTo === undefined) {
    return "分段窗未同时给出起点与终点，无法映射到结果变量。";
  }
  const outcomeText = facts.outcomeHorizons.length > 0 ? facts.outcomeHorizons.join("/") : "（无）";
  const pathText = facts.pathHorizons.length > 0 ? facts.pathHorizons.join("/") : "（无）";

  const nameA = windowOutcomeVariableName(config.windowAStat as SegmentStatKind, aFrom, aTo);
  const okA = aFrom === 0
    ? facts.outcomeHorizons.includes(aTo)
    : pathRangeCovered(segmentValueWindow(aFrom, aTo)[0], segmentValueWindow(aFrom, aTo)[1], facts);
  if (!okA) {
    return `窗 A（T+${aFrom}..T+${aTo} + ${config.windowAStat}）映射到的变量 "${nameA}" 不存在：`
      + (aFrom === 0
        ? `锚点在事件日收盘（from = 0）时复用既有结果族，而该 Dataset 的 outcome 视界为 ${outcomeText}。`
        : `该 Dataset 的 path 相对日为 ${pathText}，窗 A 的取值区间未被完全覆盖。`);
  }

  const nameB = windowOutcomeVariableName(config.windowBStat as SegmentStatKind, bFrom, bTo);
  const okB = bFrom === 0
    ? facts.outcomeHorizons.includes(bTo)
    : pathRangeCovered(segmentValueWindow(bFrom, bTo)[0], segmentValueWindow(bFrom, bTo)[1], facts);
  if (!okB) {
    return `窗 B（T+${bFrom}..T+${bTo} + ${config.windowBStat}）映射到的变量 "${nameB}" 不存在：`
      + (bFrom === 0
        ? `锚点在事件日收盘（from = 0）时复用既有结果族，而该 Dataset 的 outcome 视界为 ${outcomeText}。`
        : `该 Dataset 的 path 相对日为 ${pathText}，窗 B 的取值区间未被完全覆盖。`);
  }
  return null;
}
