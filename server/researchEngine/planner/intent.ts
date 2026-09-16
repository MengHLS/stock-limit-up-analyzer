/**
 * RESEARCH-PLANNER-001 — 研究意图识别（自然语言 → Research Module 候选）。
 *
 * 解决的问题（任务书 §5）：用户**只填** Dataset Version + 研究问题（一句话），
 * 不填 Research Type、不填 Feature / Target / Horizon / Grouping。
 * 因此必须先把这句话映射到「用哪种研究方法」。
 *
 * 三条设计纪律：
 *
 *   1. **不改写用户原话**
 *      `questionText` 原样落库（`research_question.questionText`）。本模块只做
 *      「分句 → 关键词命中 → 排序」，产出的是**证据**（哪些分句命中了哪个方法），
 *      而不是「一句话总结用户想说什么」。改写会让用户无法核对系统是否理解正确。
 *
 *   2. **未命中 ≠ 静默丢**
 *      每个没有命中任何关键词的分句都进 `unresolvedClauses`，一路带到
 *      `research_plan.notes` 并回显到前端「这次研究没听懂的部分」。
 *      静默丢弃分句的后果是：用户以为系统按他说的做了，实际只做了一半（§21 不篡改）。
 *
 *   3. **命中为 0 时**回落到「事件后收益研究」这个**基线方法**，并明说这是回落
 *      （`fallbackApplied = true`）。基线方法本身是有意义的研究（全样本收益分布），
 *      比报错更有用；但必须让用户知道「系统没听懂你的具体诉求，先给你基准」。
 *
 * 打分口径刻意做成**确定性**的（分数相同时按模块键字典序），
 * 否则同一句话两次规划可能得到不同的计划，会让「研究可复现」这一条失效。
 */

import {
  DEFAULT_RESEARCH_MODULE_REGISTRY,
  GENERIC_KEYWORD_WEIGHT,
  PRIMARY_KEYWORD_WEIGHT,
  type ResearchModuleRegistry,
  type ResearchModuleSpec,
} from "./moduleRegistry";
import type { ResearchIntentEvidence, ResearchType } from "../../researchCore";

/** 兜底方法键（无任何关键词命中时使用）。 */
export const FALLBACK_MODULE_KEY = "EVENT_RETURN_RESEARCH";

/** 分句分隔符（中英文标点 + 常见并列连词）。 */
const CLAUSE_SPLIT_RE = /[，。；、！？,;!?\n\r]+|\s+(?:and|or|then|plus)\s+/gi;

/**
 * 把研究问题切成**分句**。
 *
 * 为什么按分句而不是整句打分：用户常在一句话里问两件事
 * （「回踩不破开盘价之后会不会涨，另外持有几天最好？」）。
 * 整句打分会让关键词互相稀释；按分句打分能把两个意图分别记录下来，
 * 既保留（多方法合并规划），也不丢失（未命中分句回显）。
 */
export function splitQuestionClauses(questionText: string): string[] {
  return questionText
    .split(CLAUSE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 关键词是否在分句中命中（大小写不敏感；中文按子串）。 */
function clauseHitsKeyword(clause: string, keyword: string): boolean {
  const c = clause.toLowerCase();
  const k = keyword.toLowerCase();
  return c.includes(k);
}

export interface ModuleScore {
  moduleKey: string;
  label: string;
  /** 命中的**不同关键词数**（同一关键词命中多个分句只记一次）。 */
  score: number;
  /**
   * 加权分 = Σ(命中词权重)：专指词 3、泛化词 1。
   *
   * 排序**只看这一项**。理由见 `moduleRegistry.ts#primaryKeywords` 的注释：
   * 等权打分会让泛化词（「收益」）把专指词（「回踩」）压平。
   */
  weightedScore: number;
  /** 命中的**专指**词数（用于加权分相同时的第二级排序）。 */
  primaryMatches: number;
  matchedKeywords: string[];
  /** 命中的分句（原样）。 */
  matchedClauses: string[];
}

export interface ResearchIntentResult {
  /** 选定为「主方法」的模块（决定 recommendedAnalysisTypes / 研究类型 / 结论口径）。 */
  primaryModuleKey: string;
  /** 全部有命中的模块（按分数降序，分数相同按键字典序），**含主方法**。 */
  rankedModules: ModuleScore[];
  /** 是否发生了「零命中 → 基线方法」的回落。 */
  fallbackApplied: boolean;
  /** 落库用的证据（与 `ResearchIntentEvidence` 同构）。 */
  evidence: ResearchIntentEvidence;
  /** 主方法对应的研究类型（写 `research_question.researchType` 与 Experiment）。 */
  researchType: ResearchType;
  /** 主方法 spec（调用方直接用，省一次 require）。 */
  primaryModule: ResearchModuleSpec;
}

/**
 * 识别研究意图。
 *
 * @param questionText 用户原话（**不得为空**；调用方负责校验长度）。
 * @param registry 注册表（默认内置 7 个方法；测试可注入自定义表）。
 */
export function detectResearchIntent(
  questionText: string,
  registry: ResearchModuleRegistry = DEFAULT_RESEARCH_MODULE_REGISTRY,
): ResearchIntentResult {
  const clauses = splitQuestionClauses(questionText);
  const modules = registry.list();

  const scores: ModuleScore[] = [];
  const keywordHits: ResearchIntentEvidence["keywordHits"] = [];
  const matchedClauses: ResearchIntentEvidence["matchedClauses"] = [];

  for (const spec of modules) {
    // 词 → 权重。同一词同时出现在两个列表时**专指档优先**（不重复计分）：
    // 一个词只表达一件事，算两次会让「词表里重复登记」变成偷偷加权的手段。
    const weights = new Map<string, number>();
    for (const term of spec.keywords) weights.set(term, GENERIC_KEYWORD_WEIGHT);
    for (const term of spec.primaryKeywords) weights.set(term, PRIMARY_KEYWORD_WEIGHT);

    const hitKeywords: string[] = [];
    const hitClauses: string[] = [];
    let weightedScore = 0;
    let primaryMatches = 0;

    for (const [term, weight] of weights) {
      let matched = false;
      for (const clause of clauses) {
        if (clauseHitsKeyword(clause, term)) {
          matched = true;
          if (!hitClauses.includes(clause)) hitClauses.push(clause);
          matchedClauses.push({ clause, keyword: term, moduleKeys: [spec.key] });
        }
      }
      // 逐关键词记录命中与否 —— 用于解释「为什么没选中另一个方法」。
      keywordHits.push({ moduleKey: spec.key, keyword: term, matched });
      if (matched) {
        hitKeywords.push(term);
        weightedScore += weight;
        if (weight === PRIMARY_KEYWORD_WEIGHT) primaryMatches += 1;
      }
    }

    if (hitKeywords.length > 0) {
      scores.push({
        moduleKey: spec.key,
        label: spec.label,
        score: hitKeywords.length,
        weightedScore,
        primaryMatches,
        matchedKeywords: hitKeywords,
        matchedClauses: hitClauses,
      });
    }
  }

  // 确定性排序：加权分降序 → 专指词命中数降序 → 键字典序。
  // 三级排序缺一不可：前两级决定「谁更贴题」，第三级保证同分时结果**可复现**
  // （否则同一句话两次规划可能给出不同计划，「研究可复现」就失效了）。
  scores.sort((a, b) =>
    (b.weightedScore - a.weightedScore)
    || (b.primaryMatches - a.primaryMatches)
    || a.moduleKey.localeCompare(b.moduleKey));

  const unresolvedClauses = clauses.filter(
    (clause) => !matchedClauses.some((m) => m.clause === clause),
  );

  const fallbackApplied = scores.length === 0;
  const primaryModule = registry.require(
    fallbackApplied ? FALLBACK_MODULE_KEY : scores[0]!.moduleKey,
  );

  return {
    primaryModuleKey: primaryModule.key,
    rankedModules: scores,
    fallbackApplied,
    researchType: primaryModule.researchType,
    primaryModule,
    evidence: {
      matchedModuleKeys: scores.map((s) => s.moduleKey),
      matchedClauses,
      unresolvedClauses,
      keywordHits,
    },
  };
}

/**
 * 意图识别的**人读回执**（写入 `research_plan.notes.selectionRationale`）。
 *
 * 存在的唯一理由：用户要能回答「系统为什么这么设计」。
 * 没有这段文字，计划预览就只是一堆变量名，用户无法判断系统是否理解正确。
 */
export function describeIntent(intent: ResearchIntentResult): string[] {
  const lines: string[] = [];
  lines.push(
    `识别到研究方法：${intent.primaryModule.label}（${intent.primaryModuleKey}）`,
  );
  if (intent.fallbackApplied) {
    lines.push(
      "⚠️ 问题中没有命中任何已登记的研究方法关键词，已回落到「事件后收益研究」作为基准；"
      + "若要更贴合你的问题，可在问题中写明「回踩 / 入场时点 / 持有几天 / 突破 / 止损 / 稳定性」等意图词。",
    );
  }
  lines.push(
    `判定依据：加权分 ${intent.rankedModules[0]?.weightedScore ?? 0}`
    + `（专指词命中 ${intent.rankedModules[0]?.primaryMatches ?? 0} 个，`
    + `命中词：${(intent.rankedModules[0]?.matchedKeywords ?? []).join(" / ") || "无"}）`,
  );
  const secondary = intent.rankedModules.filter((m) => m.moduleKey !== intent.primaryModuleKey);
  if (secondary.length > 0) {
    lines.push(
      `同时命中其它方法（作为辅助）：${secondary.map((m) => `${m.label}（${m.moduleKey}，加权分 ${m.weightedScore}）`).join("、")}`,
    );
  }
  if (intent.evidence.unresolvedClauses.length > 0) {
    lines.push(
      `未采纳的分句（没有匹配到任何已登记的方法关键词，已原样保留供你核对）：`
      + intent.evidence.unresolvedClauses.map((c) => `「${c}」`).join("、"),
    );
  }
  return lines;
}
