/**
 * RESEARCH-PLANNER-001 — Research Module Registry（研究方法注册表）。
 *
 * 解决的问题（任务书 §3 / §4）：
 *   过去「一次研究」等于「用户手工填 N 个分析对话框」，用户必须自己知道
 *   该用 `pullback_holds_event_low_3d` 还是 `obs_3d.return_from_event_close`。
 *   Research Module 把这份**方法学知识**沉淀成可注册的数据结构：
 *   「研究目的 / 适用场景 / 需要的数据能力 / 推荐分析类型 / 推荐视界 / 条件配方 /
 *     推荐分组 / 稳定性口径 / 结论类型」。
 *
 * 三条设计纪律（都不是保守，是「不重复造 Domain / 不写死列表」的直接推论）：
 *
 *   1. **可扩展注册机制，不是写死的 switch**
 *      `ResearchModuleRegistry` 与 `AnalysisExecutorRegistry` 同构（register / require /
 *      has / listKeys），重复注册具名失败。新增一种研究方法 = `register()` 一份 spec，
 *      不需要改 Planner、不需要改路由、不需要改前端。
 *      内置 7 个方法只是 `createDefaultResearchModuleRegistry()` 的**初始内容**，
 *      不是「最终列表」。任务书 §3 明确要求这一点。
 *
 *   2. **模块不绑定 Strategy**（§26）
 *      键名一律是「研究方法」语义（`PULLBACK_EFFECTIVENESS`），
 *      绝不出现 `FIRST_BOARD_PULLBACK_STRATEGY_RESEARCH` 这类把某条策略焊进方法名的写法。
 *      理由：同一个研究方法可以服务任意多条候选策略；一旦绑定，策略改口径就必须改研究方法。
 *
 *   3. **模块只声明「要什么」，不自己算**
 *      本文件**零 IO、零统计**：不读 DB、不碰 Dataset、不计算任何数字。
 *      它产出的是 Analysis 的**配置意图**（条件 / 目标 / 视界），
 *      具体求值一律交给既有 Analysis Executor（§2.1 不推翻现有 Analysis Engine）。
 */

// 🔴 内容来自模式声明库；本文件只保留机制（注册表类 / 规格类型 / 条件配方构造器）。
import { buildPatternModuleSpecs } from "../../research/patternLibrary/project";
import type {
  ResearchAnalysisPriority,
  ResearchAnalysisType,
  ResearchConditionOperator,
  ResearchConditionValue,
  ResearchConclusionType,
  ResearchGroupLogicalOperator,
  ResearchLogicalOperator,
  ResearchType,
} from "../../researchCore";

// ---------------------------------------------------------------------------
// 数据能力
// ---------------------------------------------------------------------------

/**
 * Research Module 需要的数据能力。
 *
 * 用途：`PlanDataCapabilities` 由 Dataset Version 的**真实覆盖**推导（不是假设），
 * 模块声明自己需要哪几种；缺能力时 Planner **不生成**该模块的分析，
 * 而是记一条 `ResearchPlanDropNote`（§22：不满足条件的分析不得偷偷执行）。
 */
export const RESEARCH_MODULE_CAPABILITIES = ["features", "path", "outcome", "post"] as const;
export type ResearchModuleCapability = (typeof RESEARCH_MODULE_CAPABILITIES)[number];

export const RESEARCH_MODULE_CAPABILITY_LABEL: Record<ResearchModuleCapability, string> = {
  features: "事件日及之前的特征列（PIT 安全）",
  path: "事件日后逐日路径（path.relativeDay）",
  outcome: "事件日后区间聚合（outcome.horizon）",
  post: "事件日后逐日观察日行情（post.relativeDay）",
};

// ---------------------------------------------------------------------------
// 条件配方
// ---------------------------------------------------------------------------

/**
 * 条件配方的求值上下文（由 Planner 注入，配方本身**不读 DB**）。
 *
 * 每个字段都是「该 Dataset Version 的真实可用事实」，配方只在这些事实里做选择，
 * 因此不存在「生成了一条引用不存在变量的条件」这种失败模式。
 */
export interface ResearchConditionRecipeContext {
  /**
   * 求值日 offset（T+k，k ≥ 1）——「站在 T+k 收盘做判断」。
   *
   * 🔴 这是把观察日条件 PIT 安全化的关键：`pullback_holds_event_low_{k}d` 的
   * `availableFromOffset = k`，因此求值日必须 ≥ k；Planner 生成的每条条件都满足
   * 「条件变量的 offset == 求值日」，绝不会出现「用 T+5 的信息判断 T+3」。
   */
  readonly offset: number;
  /** 该 Dataset Version 真实可用的观察日上界（0 = 无 post 数据）。 */
  readonly observationMaxOffset: number;
  /** 该 Dataset Version 真实可用的 path 相对日（升序）。 */
  readonly pathHorizons: readonly number[];
  /** 该 Dataset Version 真实可用的 outcome 视界（升序）。 */
  readonly outcomeHorizons: readonly number[];
}

/** 一条条件行（与 `research_analysis_condition` 落库形态一致）。 */
export interface RecipeConditionRow {
  groupNo: number;
  sortOrder: number;
  fieldName: string;
  operator: ResearchConditionOperator;
  /**
   * 比较右值。
   *
   * 🔴 **布尔族（`holds_event_*` / `is_*`）必须用数字 `1` / `0`，不能用字符串 `"1"`**。
   * 理由是求值器 `conditionEvaluator.ts#asNumber` 只接受 `typeof === "number"`：
   * 传字符串会让 `1 == "1"` 走进「两侧都不是数字 → 严格相等」分支而恒为 false，
   * 于是条件静默筛出**零样本**（看起来像「这个条件没人满足」，实则口径写错）。
   * 这是本项目已登记过的一类静默失效，这里用类型 + 注释双重钉死。
   */
  value: ResearchConditionValue;
  logicalOperator: ResearchLogicalOperator;
  groupLogicalOperator: ResearchGroupLogicalOperator;
}

/**
 * 条件配方 —— 「一句研究问题」到「一组引擎条件」的翻译单元。
 *
 * `build` 返回 `null` 表示**本数据集不支持这条配方**（例如没有 post 数据时的
 * 「回踩未破位」）。此时 Planner 记一条 dropNote 并跳过，**不降级成无条件分析**
 * —— 没有条件的「条件研究」等价于全样本，会产出含义已变的数字（§22 / §14）。
 */
export interface ResearchConditionRecipe {
  /** 稳定 id（进 `purpose` / dropNote，便于回溯是哪条配方被弃用）。 */
  id: string;
  /** 人读标签，如「未破首板日开盘价」。 */
  label: string;
  /** 这条条件在研究上想表达什么（写入分析的 purpose）。 */
  purpose: string;
  /**
   * 用户提问里出现哪些词，说明**这条配方正是他要问的**（用于精修配方的排序）。
   *
   * 🔴 为什么不能只靠 `label` 分词匹配（旧实现就是这么干的，§28 实测暴露了它）：
   *
   *   深度分档的 label 是「回踩深度落在 <0.95]」。分词后得到「回踩深度落在 / 0.95」，
   *   而研究问题「首板后回踩深度是否影响后续收益？回踩得深一点…还是回踩浅一点更好？」
   *   里**既没有**「回踩深度落在」，**也没有**「0.95」⇒ 三条深度分档得分全为 0，
   *   排序退化成注册顺序；再叠加 `slice(0, 6)` 在排序**之前**执行，
   *   注册顺序里排第 6/7/8 位的深度分档只有 `shallow` 挤得进去。
   *   结果：用户明确在问「深 vs 浅」，计划里却只有「浅」一档，
   *   另一档根本没有分析可比 —— §28 的验收问题因此**问不出答案**。
   *
   *   所以这里改为**显式声明**：配方作者直接写出「哪些词代表用户在问这条」。
   *   `label` 分词仍然保留，作为兜底信号。
   */
  readonly emphasisKeywords?: readonly string[];
  /** 需要的变量名（用于「能力缺失」判定与可读性）。 */
  readonly variableNames: readonly string[];
  /** 构造条件行；`null` = 本数据集不支持。 */
  build(ctx: ResearchConditionRecipeContext): RecipeConditionRow[] | null;
}

/** 顺序构造条件行（单组内递增 sortOrder），避免手写 sortOrder 漂移。 */
export function conditionRows(
  rows: ReadonlyArray<{ fieldName: string; operator: ResearchConditionOperator; value: ResearchConditionValue }>,
): RecipeConditionRow[] {
  return rows.map((r, index) => ({
    groupNo: 0,
    sortOrder: index,
    fieldName: r.fieldName,
    operator: r.operator,
    value: r.value,
    logicalOperator: "AND",
    groupLogicalOperator: "AND",
  }));
}

// ---------------------------------------------------------------------------
// Research Module 规格
// ---------------------------------------------------------------------------

/** 目标变量族 —— 模块声明它研究「什么结果」。 */
export const RESEARCH_TARGET_KINDS = [
  "future_return",
  "max_drawdown",
  "min_return",
  "is_breakout",
  "days_to_breakout",
  "volume_ratio",
] as const;
export type ResearchTargetKind = (typeof RESEARCH_TARGET_KINDS)[number];

export const RESEARCH_TARGET_KIND_LABEL: Record<ResearchTargetKind, string> = {
  future_return: "未来收益（T→T+h 收盘收益）",
  max_drawdown: "区间最大回撤（负值）",
  min_return: "区间最低收益（最大不利偏移）",
  is_breakout: "是否突破首板日高点（1/0）",
  days_to_breakout: "突破发生在 T+几",
  volume_ratio: "当日量能比（相对首板日）",
};

export interface ResearchModuleSpec {
  /** 稳定键（大写下划线）。进 `research_analysis.moduleKey` 与 `research_plan.planJson`。 */
  readonly key: string;
  /** 人读名。 */
  readonly label: string;
  /** 一句话研究目的。 */
  readonly purpose: string;
  /** 适用场景（人读，用于「计划预览」向用户解释「为什么这么设计」）。 */
  readonly whenToUse: readonly string[];
  /** 映射到 `research_experiment.researchType`（复用既有枚举，不新增研究类型域）。 */
  readonly researchType: ResearchType;
  /** 需要的真实数据能力；缺一即该模块不生成。 */
  readonly requiredCapabilities: readonly ResearchModuleCapability[];
  /**
   * 意图识别的**泛化**关键词（中英混排）。
   *
   * 「泛化」= 在很多研究问题里都会出现的词（如「收益」「分布」「表现」）。
   * 它们提供**弱信号**，权重低于 `primaryKeywords`。
   */
  readonly keywords: readonly string[];

  /**
   * 意图识别的**专指**关键词 —— 每个词都几乎只属于这一个研究方法
   * （如「回踩」「缩量」只属于回踩有效性；「止损」只属于止损研究）。
   *
   * 🔴 为什么必须分两档权重（实测踩到的坑）：
   *   最初用「命中关键词数」等权打分，结果「首板后回踩深度是否影响后续收益？」
   *   里，「收益」（泛化词，几乎每个交易研究问题都有）与「回踩」（专指词）
   *   被算成平手 ⇒ 因字典序回落到了「事件后收益研究」，**回踩方法只当了辅助**，
   *   于是计划里一条守护条件分析都没有。等权打分把「问的是回踩」这件事抹掉了。
   *   分档后：专指词权重 3、泛化词权重 1 —— 谁在问什么就由专指词决定。
   */
  readonly primaryKeywords: readonly string[];

  /** 结论的主分析类型（进 `PRIMARY_PRIORITY` 口径）。 */
  readonly primaryAnalysisType: ResearchAnalysisType;
  /** 该模块推荐的分析类型清单（人读 + 计划预览）。 */
  readonly recommendedAnalysisTypes: readonly ResearchAnalysisType[];
  /** 研究目标族。 */
  readonly targetKinds: readonly ResearchTargetKind[];

  /** 推荐视界（会与 Dataset 真实视界取交集，交集为空则回落到真实视界本身）。 */
  readonly preferredHorizons: readonly number[];
  /** 推荐求值日候选（T+k，k ≥ 1）；只有 ≤ post 上界的才会被采用。 */
  readonly entryEvaluations: readonly number[];

  /** 「守卫」类必要条件配方（缺一个就不成其为该研究方法）。 */
  readonly guardRecipes: readonly ResearchConditionRecipe[];
  /** 「精修」类可选条件配方（在守卫之上再叠加，用于分层比较）。 */
  readonly refinementRecipes: readonly ResearchConditionRecipe[];
  /** 「对照组」配方（守卫的取反，用于回答「如果不满足会怎样」）。 */
  readonly controlRecipes: readonly ResearchConditionRecipe[];

  /** QUANTILE 推荐的特征变量名（PIT 安全）；不存在的会被跳过。 */
  readonly quantileFeatures: readonly string[];
  /** 推荐分组维度（须在 Dataset 支持的维度列表内）。 */
  readonly groupingDimensions: readonly string[];
  /** STABILITY 的分组维度。 */
  readonly stabilityDimension: string;
  /** 结论类型候选（按顺序取第一个可用者）。 */
  readonly conclusionTypes: readonly ResearchConclusionType[];
  /** 该模块的最小样本门槛（低于此值的分析仍会跑，但结论会如实标注样本不足）。 */
  readonly minSampleCount: number;
  /** 命中的目标族（保留顺序）里，哪些是 P0 必需、哪些是 P1 辅助。 */
  readonly primaryTargetKinds: readonly ResearchTargetKind[];
  /** 默认优先级（P0 核心 / P1 辅助 / P2 探索）。 */
  readonly defaultPriority: ResearchAnalysisPriority;
}

/** 泛化关键词的权重。 */
export const GENERIC_KEYWORD_WEIGHT = 1;
/** 专指关键词的权重（必须显著高于泛化词，否则「问的是什么」会被泛化词抹平）。 */
export const PRIMARY_KEYWORD_WEIGHT = 3;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ResearchModuleRegistry {
  private readonly modules = new Map<string, ResearchModuleSpec>();

  register(spec: ResearchModuleSpec): void {
    if (this.modules.has(spec.key)) {
      // 与 `AnalysisExecutorRegistry` 同一纪律：重复注册 = 静默覆盖，必须具名拒绝。
      throw new Error(`Research Module 已注册，禁止覆盖：${spec.key}`);
    }
    this.modules.set(spec.key, spec);
  }

  has(key: string): boolean {
    return this.modules.has(key);
  }

  get(key: string): ResearchModuleSpec | undefined {
    return this.modules.get(key);
  }

  /** 取模块；不存在 → 抛错（不返回 undefined 让调用方猜）。 */
  require(key: string): ResearchModuleSpec {
    const spec = this.modules.get(key);
    if (spec === undefined) {
      throw new Error(
        `未知 Research Module：${key}（已注册：${this.listKeys().join(" / ")}）`,
      );
    }
    return spec;
  }

  listKeys(): string[] {
    return [...this.modules.keys()].sort();
  }

  list(): ResearchModuleSpec[] {
    return [...this.modules.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
}

// ---------------------------------------------------------------------------
// 内置条件配方（复用既有变量族，不新增变量语义）
// ---------------------------------------------------------------------------

/** 回踩守卫的价格基准 —— 与 `variables.ts#EVENT_LOW_GUARD_BASES` 同一词汇体系。 */
export const PULLBACK_GUARD_FLOORS = ["low", "open"] as const;
export type PullbackGuardFloor = (typeof PULLBACK_GUARD_FLOORS)[number];

export const PULLBACK_GUARD_FLOOR_LABEL: Record<PullbackGuardFloor, string> = {
  low: "首板日最低价",
  open: "首板日开盘价",
};

/**
 * 回踩守卫变量名。
 *
 * 🔴 与 `variables.ts#buildPullbackVariable` 的命名**必须逐字一致**：
 *   - `low`  → `pullback_holds_event_low_{k}d`（既有，仓内已有 10 条分析在用）
 *   - `open` → `pullback_holds_event_open_{k}d`（PLANNER-001 新增的平行口径）
 *
 * 为什么 `open` 必须新建而不是拿 `low` 顶替：「不破首板日最低价」与「不破首板日开盘价」
 * 是**两个不同的口径**（`low(T) ≤ open(T)`，故后者严格更强）。前端 `researchMatrix.ts`
 * 已把这条差异登记在案 —— 用 low 冒充 open 属于读数不实（§21）。
 */
export function pullbackHoldVariableName(floor: PullbackGuardFloor, offset: number): string {
  return floor === "low"
    ? `pullback_holds_event_low_${offset}d`
    : `pullback_holds_event_open_${offset}d`;
}

/** 回踩深度（收盘相对首板日收盘）；`1` = 持平，`< 1` = 回踩。 */
export function pullbackDepthVariableName(offset: number): string {
  return `pullback_close_ratio_${offset}d`;
}

/** 回踩期最小量能比（缩量口径；`min_volume` 是绝对股数，与常量比较恒假，不能用）。 */
export function pullbackMinVolumeRatioVariableName(offset: number): string {
  return `pullback_min_volume_ratio_${offset}d`;
}

/** 回踩末日量能比（放量确认）。 */
export function pullbackLastVolumeRatioVariableName(offset: number): string {
  return `pullback_last_volume_ratio_${offset}d`;
}

/** 回踩末日是否阳线。 */
export function pullbackLastBullishVariableName(offset: number): string {
  return `pullback_last_is_bullish_${offset}d`;
}

/** `min(post.low[T+1..T+k]) >= floor(T)` 的守卫条件（k == 求值日，PIT 安全）。 */
export function buildGuardRecipe(floor: PullbackGuardFloor): ResearchConditionRecipe {
  const label = PULLBACK_GUARD_FLOOR_LABEL[floor];
  return {
    id: `guard_${floor}`,
    label: `回踩期未破${label}`,
    purpose: `要求「截至 T+k，回调期间最低价始终没有跌破${label}」。`,
    emphasisKeywords: ["不破", "未破", "不跌破", "没跌破", "守住", "支撑", "支撑位", "破位", "生命线"],
    variableNames: ["pullback_holds_event_low_*", "pullback_holds_event_open_*"],
    build(ctx) {
      if (ctx.observationMaxOffset <= 0 || ctx.offset > ctx.observationMaxOffset) return null;
      return conditionRows([
        {
          fieldName: pullbackHoldVariableName(floor, ctx.offset),
          operator: "==",
          value: 1,
        },
      ]);
    },
  };
}

/** 守卫的取反（对照组）：`pullback_holds_event_*_{k}d == 0`。 */
export function buildGuardControlRecipe(floor: PullbackGuardFloor): ResearchConditionRecipe {
  const label = PULLBACK_GUARD_FLOOR_LABEL[floor];
  return {
    id: `control_broke_${floor}`,
    label: `回踩期已破${label}（对照组）`,
    purpose: `对照组：截至 T+k 已跌破${label}的样本后续如何走。`,
    emphasisKeywords: ["跌破", "破位", "对照组", "反过来"],
    variableNames: ["pullback_holds_event_low_*", "pullback_holds_event_open_*"],
    build(ctx) {
      if (ctx.observationMaxOffset <= 0 || ctx.offset > ctx.observationMaxOffset) return null;
      return conditionRows([
        {
          fieldName: pullbackHoldVariableName(floor, ctx.offset),
          operator: "==",
          value: 0,
        },
      ]);
    },
  };
}

/**
 * 深度分档各自的「问法」词表。
 *
 * 🔴 深与浅**必须分别指向自己那一档**。如果两档共用同一份词表（例如都写 ["深","浅"]），
 * 它们会得到相同得分、按注册顺序回落，等于「问深度」这件事对排序毫无影响 ——
 * 而「深 vs 浅」恰恰是 §28 那个验收问题的全部内容。
 */
const DEPTH_BAND_EMPHASIS: Record<string, readonly string[]> = {
  shallow: ["浅回踩", "回踩浅", "浅一点", "浅浅", "轻微回踩", "小幅回踩", "浅"],
  normal: ["标准回踩", "温和回踩", "中等回踩", "适中"],
  deep: ["深回踩", "回踩深", "回踩深度", "深度", "深一点", "更深", "大幅回踩", "深"],
};
/** 未知 tag 的兜底词表（工厂是导出的，外部可以传自定义 tag）。 */
const DEPTH_BAND_EMPHASIS_FALLBACK: readonly string[] = ["回踩深度", "深度", "回踩多深"];

/** 回踩深度分档（`close_ratio` 上界），用于回答「回踩多深才算深」。 */
export function buildDepthBandRecipe(
  offset: number,
  lowerInclusive: number | null,
  upperInclusive: number,
  tag: string,
): ResearchConditionRecipe {
  return {
    id: `depth_${tag}`,
    label: `回踩深度落在 ${lowerInclusive === null ? "<" : `[${lowerInclusive}, `}${upperInclusive}]`,
    purpose: `按回踩深度（T+k 收盘 / 首板日收盘）分档，检验「回踩深度是否影响后续收益」。`,
    emphasisKeywords: DEPTH_BAND_EMPHASIS[tag] ?? DEPTH_BAND_EMPHASIS_FALLBACK,
    variableNames: ["pullback_close_ratio_*"],
    build(ctx) {
      if (ctx.observationMaxOffset <= 0 || ctx.offset > ctx.observationMaxOffset) return null;
      const name = pullbackDepthVariableName(ctx.offset);
      const rows: Array<{ fieldName: string; operator: ResearchConditionOperator; value: ResearchConditionValue }> = [];
      if (lowerInclusive !== null) {
        rows.push({ fieldName: name, operator: ">=", value: lowerInclusive });
      }
      rows.push({ fieldName: name, operator: "<=", value: upperInclusive });
      return conditionRows(rows);
    },
  };
}

/** 缩量条件（`pullback_min_volume_ratio_{k}d <= ratio`）。 */
export function buildShrinkVolumeRecipe(ratio: number, tag: string): ResearchConditionRecipe {
  return {
    id: `shrink_${tag}`,
    label: `回踩期最小量能比 ≤ ${ratio}（缩量）`,
    purpose: "缩量是「抛压衰竭」的代理量：检验缩量回踩是否比放量回踩更值得参与。",
    emphasisKeywords: ["缩量", "量能比", "抛压", "地量"],
    variableNames: ["pullback_min_volume_ratio_*"],
    build(ctx) {
      if (ctx.observationMaxOffset <= 0 || ctx.offset > ctx.observationMaxOffset) return null;
      return conditionRows([
        {
          fieldName: pullbackMinVolumeRatioVariableName(ctx.offset),
          operator: "<=",
          value: ratio,
        },
      ]);
    },
  };
}

/** 回踩末日放量确认（`pullback_last_volume_ratio_{k}d > 1`）。 */
export function buildVolumeExpansionRecipe(): ResearchConditionRecipe {
  return {
    id: "last_expansion",
    label: "回踩末日量能比 > 1（放量确认）",
    purpose: "回踩末日放量是「资金重新进场」的代理量：检验放量确认是否改善后续表现。",
    emphasisKeywords: ["放量", "量能比", "资金进场", "成交放大"],
    variableNames: ["pullback_last_volume_ratio_*"],
    build(ctx) {
      if (ctx.observationMaxOffset <= 0 || ctx.offset > ctx.observationMaxOffset) return null;
      return conditionRows([
        {
          fieldName: pullbackLastVolumeRatioVariableName(ctx.offset),
          operator: ">",
          value: 1,
        },
      ]);
    },
  };
}

/** 回踩末日阳线（`pullback_last_is_bullish_{k}d == 1`）。 */
export function buildLastBullishRecipe(): ResearchConditionRecipe {
  return {
    id: "last_bullish",
    label: "回踩末日为阳线（红盘）",
    purpose: "回踩末日收阳是「当日买盘占优」的代理量：检验红盘确认是否改善后续表现。",
    emphasisKeywords: ["阳线", "红盘", "收阳", "翻红"],
    variableNames: ["pullback_last_is_bullish_*"],
    build(ctx) {
      if (ctx.observationMaxOffset <= 0 || ctx.offset > ctx.observationMaxOffset) return null;
      return conditionRows([
        {
          fieldName: pullbackLastBullishVariableName(ctx.offset),
          operator: "==",
          value: 1,
        },
      ]);
    },
  };
}

/** 回踩末期仍在首板日收盘之上（`pullback_close_ratio_{k}d >= 1`）。 */
export function buildAboveEventCloseRecipe(): ResearchConditionRecipe {
  return {
    id: "above_event_close",
    label: "回踩末期收盘仍在首板日收盘之上",
    purpose: "「还没跌回首板日收盘」是强势整理的代理量：检验强势整理与弱势整理后续收益是否不同。",
    variableNames: ["pullback_close_ratio_*"],
    build(ctx) {
      if (ctx.observationMaxOffset <= 0 || ctx.offset > ctx.observationMaxOffset) return null;
      return conditionRows([
        { fieldName: pullbackDepthVariableName(ctx.offset), operator: ">=", value: 1 },
      ]);
    },
  };
}

/** 单日观察日条件（`obs_{k}d.{field} {op} {value}`）。 */
export function buildObsDayRecipe(
  id: string,
  label: string,
  purpose: string,
  field: string,
  operator: ResearchConditionOperator,
  value: ResearchConditionValue,
): ResearchConditionRecipe {
  return {
    id,
    label,
    purpose,
    variableNames: [`obs_{k}d.${field}`],
    build(ctx) {
      if (ctx.observationMaxOffset <= 0 || ctx.offset > ctx.observationMaxOffset) return null;
      return conditionRows([
        { fieldName: `obs_${ctx.offset}d.${field}`, operator, value },
      ]);
    },
  };
}

// ---------------------------------------------------------------------------
// 默认注册表
// ---------------------------------------------------------------------------

/**
 * 默认注册表 —— 模块内容来自 `research/patternLibrary`（交易模式声明库）。
 *
 * 🔴 2026-09-17 起，内置模块**不再手写在本文件**：它们是「交易模式声明」的研究侧投影
 * （见 `server/research/patternLibrary/patterns/*.ts`）。本文件只保留**机制**
 * （注册表类 / 规格类型 / 条件配方构造器），内容一律由声明库提供。
 *
 * ⇒ 「新增一种研究方法」= 在声明库里加一个模式文件（`patterns/index.ts` 登记一行），
 *   不需要改本文件、不需要改 Planner、不需要改路由、不需要改前端。
 *   此前本文件只做到了「可以 register」，内容仍然是写死的 —— 那正是「研究模块过于复杂」
 *   的一环：加一种方法要改 3 个地方。
 *
 * ⚠️ 关于循环 import：本文件与 `patternLibrary/project.ts` 互相 import，但
 * `project.ts` **只在函数体内**调用本文件的构造器（`buildGuardRecipe` 等），
 * 本文件也**只在函数体内**调用 `buildPatternModuleSpecs()` ⇒ 两边都是在对方
 * 求值完成之后才真正执行，ESM 下安全。反例（会炸）是任一方在**模块顶层**调用对方。
 */
export function createDefaultResearchModuleRegistry(): ResearchModuleRegistry {
  const registry = new ResearchModuleRegistry();
  for (const spec of buildPatternModuleSpecs()) registry.register(spec);
  return registry;
}

let defaultRegistryCache: ResearchModuleRegistry | null = null;

/**
 * 默认注册表（**惰性单例**；模块是无状态数据，可安全共享）。
 *
 * 🔴 为什么不是顶层常量（2026-09-17 实测踩到）：本文件与 `patternLibrary/project.ts`
 * 互相 import。若在任何模块里把构造写成**顶层表达式**，就会出现
 * 「A 还在求值中，B 已经调用 A 的函数」⇒ 运行时 `TypeError: ... is not a function`
 * （而 `tsc --noEmit` 完全看不出来 —— 类型是对的，只是绑定还没发生）。
 * 惰性化之后，首次调用一定发生在**两边都已求值完**之后。
 */
export function defaultResearchModuleRegistry(): ResearchModuleRegistry {
  if (defaultRegistryCache === null) {
    defaultRegistryCache = createDefaultResearchModuleRegistry();
  }
  return defaultRegistryCache;
}
