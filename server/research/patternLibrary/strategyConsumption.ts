/**
 * 9cc · PHASE-D（AR-14）—— Pattern 语义 → **策略侧消费点**。
 *
 * ## 要消灭的断链
 *
 * PHASE-B-001 建立了「唯一 Expander → 两侧投影」的结构：
 *
 * ```text
 * Pattern Semantic Declaration
 *         ↓ expandPatternSemantics（唯一 Expander）
 *      ExpandedSemantic[]
 *      ↙                    ↘
 * projectSemanticsToResearch   projectSemanticsToStrategy
 *      ↙                        ↘
 *   Research ✅                 Strategy ❌（**没有任何生产调用方**）
 * ```
 *
 * 9cc 审计实测：`projectSemanticsToStrategy` 全仓**只被它自己的单测引用**，执行侧
 * （`runWorkbenchAssembly` / `strategyCore`）**从不读语义注册表** —— 策略侧的特征与阈值
 * 是另一份手写声明（`strategyCore/featureRegistry.ts` + `SEMANTIC_*` 无关的常量）。
 * 于是「Research 用的 `pat_X` 与 Strategy 用的 `pat_X` 来自同一份 semantic definition」
 * 这句话**只在文件层面成立，在执行路径上不成立**。
 *
 * ## 本模块做什么（**只做校验，不改任何计算**）
 *
 * 它把「语义声明里的执行侧投影」与**执行侧的真实能力面**对表：
 *   - `strategyProjection.featureId` 必须在 Core 特征注册表里**真的登记过**；
 *   - `strategyProjection.thresholdParam` 必须在策略文档声明的参数里**真的存在**。
 *
 * 两条都是**可失败**的：声明了一个不存在的特征 / 阈值参数，以前要被静默走到「运行时取不到值」
 * 才发现，现在在**装配期**就被点名。
 *
 * ## 三条边界（与 PHASE-B 同一纪律）
 *
 * 1. **不复制 Expander**：本模块只消费 `listPatternSemantics()`（= 唯一 Expander 的产物），
 *    自己不展开、不拼变量名、不解释 `definition` 文本。
 * 2. **不改计算**：本模块**不产出**任何用于执行的特征值，也不参与信号判定 ——
 *    特征值仍由 Core 注册表算。它只回答「声明与能力面是否对得上」。
 * 3. **零新的跨域依赖**：不 import `strategyCore`，注册表能力由调用方以回调注入
 *    （`isFeatureRegistered`），避免在 `server/research/**` 与 `server/strategyCore/**`
 *    之间新增一条生产依赖边。
 */

import type { SemanticStrategyProjection } from "../../../shared/patternSemantics";
// 🔴 RESEARCH-EXPERIMENT-002：从 `./catalog`（纯查询）取，**不要**从 `./index` 取 ——
// `./index` 会连带求值 `./project`，而它运行时 import `researchEngine/planner/moduleRegistry`，
// 于是「生产回测装配链 → 本文件」会顺带把旧 Research 目录拉进运行时模块图。
import { findPatternByRecipeId } from "./catalog";
import { findPatternSemantics } from "./semanticRegistry";

/** 一条「语义变量 ↔ 执行侧特征 / 阈值参数」的绑定（**这张表就是 AR-14 要的映射关系**）。 */
export interface StrategySemanticBinding {
  /** 研究侧变量名（`pat_*`）—— 与 Research 投影**同名同源**。 */
  readonly semanticVariable: string;
  readonly semanticId: string;
  /** 执行侧特征 id（Core 注册表的键）。 */
  readonly featureId: string;
  readonly comparison: "GTE" | "LTE";
  /** 阈值参数名（由策略版本给值，声明里只有名字）。 */
  readonly thresholdParam: string;
  /** 声明的精确口径（进留档，便于 review 两侧是否同义）。 */
  readonly definition: string;
  /** 与研究侧的已知差异（如实带上，禁抹平）。 */
  readonly noteAboutResearchDifference?: string;
}

export interface StrategyConsumptionIssue {
  readonly code:
    | "FEATURE_NOT_REGISTERED"
    | "THRESHOLD_PARAM_NOT_DECLARED";
  readonly semanticId: string;
  readonly message: string;
}

export interface StrategyConsumptionResult {
  /** 是否真的做了对表（`false` = 该策略不属于任何已注册 Pattern ⇒ 无语义可消费）。 */
  readonly applied: boolean;
  readonly patternId: string | null;
  readonly bindings: readonly StrategySemanticBinding[];
  readonly issues: readonly StrategyConsumptionIssue[];
  /** 一句人读结论（进 `assembly.strategyDecisionEngineNote`）。 */
  readonly note: string;
}

/** 由 `recipeId` 反查 Pattern（执行侧文档里记录的是配方 id）。 */
export function resolvePatternIdByRecipeId(recipeId: string | null): string | null {
  if (recipeId === null || recipeId.trim() === "") return null;
  return findPatternByRecipeId(recipeId)?.patternId ?? null;
}

/**
 * 纯函数：把语义注册表里的**执行侧投影**与执行侧能力面对表。
 *
 * @param patternId            该策略对应的 Pattern（`null` ⇒ 不做对表，如实返回 `applied:false`）
 * @param isFeatureRegistered  Core 特征注册表的成员判据（由调用方注入，避免跨域 import）
 * @param declaredParameterCodes 策略文档声明的参数 code 集合
 */
export function verifyStrategyConsumption(input: {
  readonly patternId: string | null;
  readonly isFeatureRegistered: (featureId: string) => boolean;
  readonly declaredParameterCodes: ReadonlySet<string>;
}): StrategyConsumptionResult {
  const { patternId } = input;
  if (patternId === null) {
    return {
      applied: false,
      patternId: null,
      bindings: [],
      issues: [],
      note: "本策略未匹配到已注册 Pattern ⇒ 无语义声明可消费（不臆造语义）。",
    };
  }
  const entry = findPatternSemantics(patternId);
  if (entry === undefined) {
    return {
      applied: false,
      patternId,
      bindings: [],
      issues: [],
      note: `Pattern "${patternId}" 无语义声明 ⇒ 无语义可消费。`,
    };
  }

  const bindings: StrategySemanticBinding[] = [];
  const issues: StrategyConsumptionIssue[] = [];
  /** 只声明了研究侧意图、没有执行侧投影的语义 —— 如实登记（禁臆造执行口径）。 */
  const researchOnly: string[] = [];

  for (const item of entry.expanded) {
    const projection: SemanticStrategyProjection | null = item.strategyProjection;
    if (projection === null) {
      researchOnly.push(item.name);
      continue;
    }
    if (!input.isFeatureRegistered(projection.featureId)) {
      issues.push({
        code: "FEATURE_NOT_REGISTERED",
        semanticId: item.semanticId,
        message:
          `语义 ${item.semanticId}（研究侧变量 ${item.name}）声明执行侧特征 "${projection.featureId}"，`
          + "但该特征**未在 Core 特征注册表登记** ⇒ 执行侧取不到值（声明与能力面不一致）",
      });
    }
    if (!input.declaredParameterCodes.has(projection.thresholdParam)) {
      issues.push({
        code: "THRESHOLD_PARAM_NOT_DECLARED",
        semanticId: item.semanticId,
        message:
          `语义 ${item.semanticId} 的阈值参数 "${projection.thresholdParam}" **未在本策略文档的参数中声明** `
          + "⇒ Parameter Search / 执行层都拿不到它（该语义无法被调参）",
      });
    }
    bindings.push({
      semanticVariable: item.name,
      semanticId: item.semanticId,
      featureId: projection.featureId,
      comparison: projection.comparison,
      thresholdParam: projection.thresholdParam,
      definition: item.definition,
      ...(projection.noteAboutResearchDifference === undefined
        ? {}
        : { noteAboutResearchDifference: projection.noteAboutResearchDifference }),
    });
  }

  const parts = [
    `Pattern "${patternId}"@${entry.version} 的执行侧语义消费：`
      + `${bindings.length} 条绑定`
      + (bindings.length === 0
        ? ""
        : `（${bindings
            .map((b) => `${b.semanticVariable} → ${b.featureId} ${b.comparison} ${b.thresholdParam}`)
            .join("；")}）`),
  ];
  if (researchOnly.length > 0) {
    parts.push(`仅研究侧声明（不参与执行，未臆造执行口径）：${researchOnly.join(" / ")}`);
  }
  if (issues.length > 0) {
    parts.push(`⚠️ 对表发现 ${issues.length} 处不一致：${issues.map((i) => `[${i.code}] ${i.message}`).join("｜")}`);
  }
  return {
    applied: true,
    patternId,
    bindings,
    issues,
    note: parts.join("。") + "。",
  };
}
