/**
 * RESEARCH-PLANNER-001 — 研究结论聚合层（Result → Finding → Outcome 视图）。
 *
 * 解决的问题（任务书 §12 §13 §14 §15）：
 *   一次自动研究会产生 20~30 条分析、几十条 Finding。用户**不可能逐个看**。
 *   本模块把这一堆东西压成**一份可读的结论视图**：Top Findings（排序 + 去重 +
 *   冲突标注 + 稳定性提示）+ 数据有效性 + 风险提示 + 明确定位的 Recommendation。
 *
 * 五条设计纪律：
 *
 *   1. **本模块不做任何统计**（§2.2）
 *      它只做**读取与重排**：读已落库的 `research_finding` / `research_analysis` /
 *      `research_result` / `research_conclusion`，按已有字段排序、分组、去重。
 *      任何「新算一个数字」的冲动都必须回到 Finding Engine 里做（那里有 policy 与可复核的阈值）。
 *
 *   2. **默认只展示结论与关键证据**（§14）
 *      `topFindings` 默认 8 条且**必须有强度下限**。其余 Finding 仍在库里、仍可经既有
 *      `listFindings` 端点全量读取 —— 不是删掉，而是不摆在第一屏。
 *
 *   3. **Recommendation 只能说「是否值得进入下一研究阶段」**（§15）
 *      严禁出现「这个策略赚钱 / 建议买入」这类表述。本文件里的 `recommendation.text`
 *      由固定模板生成，并强制附 `DISCLAIMER`，不给调用方留「自由发挥」的口子。
 *
 *   4. **数据有效性如实上报**（§22）
 *      `dataValidity.failedAnalyses` 列出**真的失败**的分析（含错误码与原始消息）。
 *      只要有失败，`passed = false`，且 Recommendation 直接降级为「需补跑 / 补数据」，
 *      不会在证据残缺的情况下给出「值得继续」。
 *
 *   5. **「没有发现」是合法结论**（§27）
 *      `topFindings = []` 时输出明确说明，**不造数、不降级阈值硬凑一条**。
 */

import type {
  ResearchAnalysis,
  ResearchConclusion,
  ResearchFinding,
  ResearchRepositories,
  ResearchRun,
} from "../../researchCore";

/** Top Finding 的对外形态（只含用户需要判断的东西，不含 policy / fingerprint 等内部件）。 */
export interface ResearchFindingView {
  findingId: number;
  findingType: string;
  title: string;
  summary: string | null;
  status: string;
  researchStrength: number | null;
  researchStrengthGrade: string | null;
  /** 主证据分析的 id / 类型（用户点进去复核的入口）。 */
  primaryAnalysisId: number | null;
  analysisName: string | null;
  analysisType: string | null;
  target: string | null;
  horizon: number | null;
  sampleCount: number | null;
  sampleGrade: string | null;
  /** 效应（§13 第 5/7 条：与基准差异 + 效果大小）。 */
  effect: {
    groupReturn: number | null;
    benchmarkReturn: number | null;
    excessReturn: number | null;
    winRate: number | null;
    benchmarkUnavailable: boolean;
  };
  /** 稳定性（§13 第 8 条）。 */
  stability: {
    dimensionKey: string;
    stable: boolean;
    contradicted: boolean;
    consistentRatio: number | null;
    slices: Array<{ label: string; metricValue: number | null; sampleCount: number | null }>;
  } | null;
  /** 是否与其它 Finding 冲突（§13 第 9 条）。 */
  conflictsWith: number[];
  /** 原始局限（不删，原样透出）。 */
  limitations: string[];
}

export interface ResearchOutcomeAnalysisStat {
  analysisId: number;
  name: string;
  analysisType: string;
  priority: string | null;
  purpose: string | null;
  status: string;
  resultCount: number;
  /**
   * 该分析落库的**条件行数**（`research_analysis_condition`）。
   *
   * 🔴 `> 0` 才代表这条分析**可以导出候选筛选条件**。
   *    `EVENT_STUDY` / `QUANTILE` / `DESCRIPTIVE` / `STABILITY` 这类基准与纯分组分析
   *    天然没有条件行；拿它们去 `createCandidate({ deriveFilterFromAnalysisId })`
   *    必然被服务端拒绝（**实测缺陷**：结论页挑中 `EVENT_STUDY` 全样本基准 ⇒ 创建候选恒失败）。
   */
  conditionCount: number;
  /** 是否计划里的必需项（`ResearchAnalysis.requiredFlag`）。候选来源排序要用。 */
  requiredFlag: boolean;
  /** 是否被提问点名（计划 `notes.emphasisAnalysisNames`）。候选来源排序要用。 */
  isQuestionEmphasis: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * 「这条分析凭什么可以当候选筛选条件的来源」——排序后的输出项。
 * 单独建接口而不是复用 `ResearchOutcomeAnalysisStat`：候选来源只关心条件相关的那几列，
 * 把 13 个字段整包丢给前端会让「该看什么」失焦。
 */
export interface ResearchOutcomeCandidateSource {
  analysisId: number;
  name: string;
  analysisType: string;
  priority: string | null;
  requiredFlag: boolean;
  conditionCount: number;
  isQuestionEmphasis: boolean;
  /** 排序理由（人读）——让「为什么挑这条」可被审查，而不是黑箱。 */
  why: string;
}

/** 完整研究结论视图。 */
export interface ResearchOutcome {
  questionId: number | null;
  questionText: string | null;
  planId: number | null;
  experimentId: number;
  runId: number | null;
  datasetVersionId: number | null;
  moduleKeys: string[];

  runStatus: string | null;
  sampleCount: number | null;

  analysisCount: number;
  completedCount: number;
  /** 未产出结果的分析（FAILED / CANCELLED），**不是**「跑输了」。 */
  failedCount: number;
  /** 尚未执行的分析（PENDING / RUNNING）—— 进度未完成，不能当结论用。 */
  pendingCount: number;

  /**
   * §22 —— 数据有效性。**三个维度都要如实报告**：
   * 失败（跑了但报错）、未完成（还没跑）、**零结果**（跑完了但一条结果都没产出）。
   *
   * 🔴 为什么「零结果」必须单列：它既不是失败、也不是通过。
   *    实测案例（Dataset 390002）：`marketCap` 在该版本上 **100% 为 NULL**（0 / 25108），
   *    于是「market_cap 分位 → T+5 收益」这条分析 **status = COMPLETED、resultCount = 0**。
   *    旧实现只看 FAILED / PENDING，于是把「这条分析什么都没算出来」报成
   *    「数据有效性检查 ✓ Passed：28 条分析全部执行完成」—— 一句**误导性的真话**：
   *    用户会以为这条分析也贡献了证据。§22 明确要求这类分析必须被标出来。
   */
  dataValidity: {
    passed: boolean;
    checkedCount: number;
    failedCount: number;
    pendingCount: number;
    emptyResultCount: number;
    notes: string[];
    failedAnalyses: Array<{ analysisId: number; name: string; errorCode: string | null; errorMessage: string | null }>;
    /** 执行完成但零结果的分析（人读成因在 `note` 里给出**可能**解释，不臆断具体是哪一种）。 */
    emptyResultAnalyses: Array<{ analysisId: number; name: string; note: string }>;
  };

  findingsTotal: number;
  dedupedCount: number;
  topFindings: ResearchFindingView[];
  /** 被 Top-N 截断但仍在库里的条数（用户可展开全量）。 */
  hiddenFindingCount: number;

  /**
   * §13 / §15 / §28 —— **与用户提问直接相关的 Finding**（提问侧重的落点）。
   *
   * 🔴 为什么必须有这个字段（实测缺口）：
   *    `topFindings` 按 `researchStrength`（在 1.0 处**饱和**）→ 样本量 排序。
   *    在 §28 那个「回踩深度」问题上，深度分档的 Finding（深档超额 −8.49%、n=1602；
   *    浅档 −2.94%、n=2841；t = −39.9 / −18.1）因为样本量小于「放量确认」类分析
   *    （n=8856）而被挤到第 6 名之后 —— 用户问的那件事**不在第一屏**。
   *    单靠强度排序回答不了「用户到底在问什么」。
   *
   * 来源优先级：① 计划里 `emphasisAnalysisNames`（强调词命中的精修分析）；
   *            ② 若为空 ⇒ 回落到必需项（P0，即问题的主口径）。
   * 这里**只做筛选与排序，不重新计算任何统计量**（§21）。
   */
  questionAlignedFindings: ResearchFindingView[];
  /** 上一字段的来源，如实标注（避免让读的人以为「一定是强调词命中的」）。 */
  questionAlignment: {
    source: "EMPHASIS" | "REQUIRED_FALLBACK" | "NONE";
    /** 被认定为「用户在问的」候选分析数（不是 Finding 数）。 */
    analysisCount: number;
    note: string;
  };

  conclusion: {
    id: number;
    conclusionType: string;
    title: string;
    conclusion: string;
    evidenceSummary: string | null;
    researchQuestion: string | null;
    findingIds: number[];
    limitations: string[];
    nextQuestions: string[];
    confidence: number | null;
    status: string;
  } | null;

  /**
   * §15 —— **只能表示「是否值得进入下一研究阶段」**。
   * `text` 由固定模板生成并强制附免责声明，不允许调用方自由发挥。
   */
  recommendation: {
    stage: "WORTH_NEXT_STAGE" | "NEEDS_MORE_RESEARCH" | "NOT_WORTH_CONTINUING";
    text: string;
    /** 判定依据（人读，逐条列）。 */
    reasons: string[];
    /**
     * §15 强制免责声明。**前端必须原样渲染**（作为独立的 ⚠️ 区块）。
     *
     * 🔴 为什么给独立字段而不是让前端从 `text` 里截：免责声明是**结构性约束**，
     *    不能依赖「文案里恰好带了」。独立字段让「前端漏渲染」变成可断言的事实。
     *
     * 🔴 RESEARCH-PLANNER-001 实测缺陷：`withDisclaimer` / `RESEARCH_OUTCOME_DISCLAIMER`
     *    此前**定义了但没有任何调用方** —— 即 §15 的免责要求实际上没落地。
     *    本字段 + `pickConclusion` 里的后缀共同补齐（两处都不可去掉）。
     */
    disclaimer: string;
  };

  /** 下一步动作（可执行建议）。 */
  nextActions: string[];

  /** 计划规模裁剪情况（§9：用户要知道本来还打算做什么）。 */
  plan: {
    plannedCount: number | null;
    droppedCount: number;
    capApplied: boolean;
    maxAnalysisPerPlan: number | null;
    unresolvedClauses: string[];
    selectionRationale: string[];
    dropped: Array<{ name: string; analysisType: string; reason: string; detail: string }>;
  };

  /** 全部分析的逐条执行状态（默认折叠；给「哪些分析没通过有效性检查」提供落点）。 */
  analyses: ResearchOutcomeAnalysisStat[];

  /**
   * §16 —— **可导出候选筛选条件的分析**，按推荐序（第 0 条即默认来源）。
   *
   * 🔴 为什么必须由聚合层给出：`createCandidate` 要求来源分析**真的有条件行**，
   *    而「哪条分析有条件」是数据库事实 —— 调用方（前端 / Workbuddy）无从猜测。
   *    实测缺陷：结论页自己按「第一条 P0」挑，挑中 `EVENT_STUDY` 基准 ⇒ 创建候选恒失败。
   *    现在改成「聚合层如实列出 + 唯一排序实现」，调用方只取第 0 条即可。
   *
   * 条件数为 0 的分析**不出现在这里**（不是「排在后面」）。
   */
  candidateEligibleAnalyses: ResearchOutcomeCandidateSource[];
}

/** §15 强制免责声明（不可去掉；前端必须原样渲染）。 */
export const RESEARCH_OUTCOME_DISCLAIMER =
  "⚠️ 本结论仅说明「这批研究证据是否值得进入下一阶段」，"
  + "**不构成任何盈利能力判断、不构成投资建议**。"
  + "统计关系不等于可交易策略：样本内关系可能在样本外失效，交易成本 / 流动性 / 涨跌停无法成交等约束尚未纳入。";

/** Top Findings 默认条数。 */
export const DEFAULT_TOP_FINDINGS = 8;

/** 「与提问直接相关的 Finding」默认最多呈现几条（比 Top Findings 更窄，避免第二屏变长）。 */
export const DEFAULT_QUESTION_ALIGNED_FINDINGS = 6;

/**
 * 计划优先级排序权重（与 `analysisPlan.ts#PRIORITY_RANK` **同口径**）。
 * 刻意不 import：那个常量是 `analysisPlan.ts` 的模块私有实现细节，
 * 把它变成跨模块依赖会让「规模裁剪顺序」与「候选来源顺序」被迫一起改。
 * 未分级（人工创建的分析）排在有分级之后。
 */
const CANDIDATE_PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

/**
 * 「哪条分析可以当候选筛选条件的来源」—— **排序的唯一实现**（§16）。
 *
 * 🔴 为什么必须集中在一处：这个判断曾经在三个地方各写一遍且互不一致 ——
 *    · 前端 `ResearchAsk.tsx`：`find(a => a.priority === "P0")`（**过松**）；
 *    · E2E `_e2e_research_planner.mts`：`priority === "P0" && analysisType === "CONDITIONAL"`（较严）；
 *    · 服务端 `createCandidate`：只校验调用方给的那条，不参与挑选。
 *    结果是 **E2E 全绿、产品恒失败** —— 实测：结论页挑中 `EVENT_STUDY 全样本基准`
 *    （`analysisPlan.ts:361` 是全函数第一条 push，priority = "P0"、`requiredFlag = true`、
 *    条件数 0）⇒ 服务端按设计拒绝，用户看到「分析 780001 没有任何条件」。
 *
 * 排序口径（越靠前越优先）：
 *   ① `conditionCount > 0` —— **硬门槛**，0 条件的分析直接不入选（不是排后面）；
 *   ② 被提问点名（`isQuestionEmphasis`）—— 候选条件要跟着「用户问的那件事」走
 *      （§28：问「回踩深一点还是浅一点」，候选条件就该是那个深度档）；
 *   ③ `requiredFlag` —— 计划必需项 = 本问题的核心口径（§27：问题里没点名精修维度时用它）；
 *   ④ priority `P0 → P1 → P2`（未分级最后）；
 *   ⑤ `CONDITIONAL` 类型优先 —— 条件分析才天然携带条件，但**不写死为唯一来源**
 *      （§3：方法必须可扩展，将来出现别的带条件分析类型也要能被选中）；
 *   ⑥ `analysisId` 升序 —— 同一 Run 两次调用挑到同一条（可复现）。
 */
export function rankCandidateSourceAnalyses(
  stats: readonly ResearchOutcomeAnalysisStat[],
): ResearchOutcomeCandidateSource[] {
  return stats
    .filter((s) => s.conditionCount > 0)
    .slice()
    .sort(
      (a, b) =>
        Number(b.isQuestionEmphasis) - Number(a.isQuestionEmphasis)
        || Number(b.requiredFlag) - Number(a.requiredFlag)
        || (CANDIDATE_PRIORITY_RANK[a.priority ?? ""] ?? 9)
          - (CANDIDATE_PRIORITY_RANK[b.priority ?? ""] ?? 9)
        || Number(b.analysisType === "CONDITIONAL") - Number(a.analysisType === "CONDITIONAL")
        || a.analysisId - b.analysisId,
    )
    .map((s) => {
      const why: string[] = [];
      if (s.isQuestionEmphasis) why.push("提问点名");
      if (s.requiredFlag) why.push("计划必需项");
      if (s.priority !== null) why.push(s.priority);
      if (s.analysisType === "CONDITIONAL") why.push("条件分析");
      why.push(`${s.conditionCount} 条条件`);
      return {
        analysisId: s.analysisId,
        name: s.name,
        analysisType: s.analysisType,
        priority: s.priority,
        requiredFlag: s.requiredFlag,
        conditionCount: s.conditionCount,
        isQuestionEmphasis: s.isQuestionEmphasis,
        why: why.join(" · "),
      };
    });
}

/**
 * 把「提问锚点」拼到引擎结论正文**前面**（§15：结论必须基于研究问题）。
 *
 * 🔴 为什么不是改数据库里的结论，而是拼在视图层：
 *    与 `withDisclaimer` 同一纪律 —— 库里的原文是**证据**，不可二次加工；
 *    视图层负责「让读者读到该读的东西」。两处都保留，任何一处被去掉都会被断言抓到。
 *
 * 🔴 为什么必须显式回答「你问的那件事」：
 *    引擎的「关键量」由固定分析类型优先级（QUANTILE → CONDITIONAL → …）选出，
 *    **与用户问了什么无关**。实测两轮不同问题拿到了几乎逐字相同的结论正文。
 *    这不是统计错误，而是「问题没有被带下去」——用户无法从结论页确认自己的问题被回答了。
 */
export function composeQuestionAnchor(input: {
  questionText: string | null;
  alignedFindings: readonly ResearchFindingView[];
  alignmentSource: ResearchOutcome["questionAlignment"]["source"];
  totalAnalyses: number;
  engineConclusion: string;
}): string {
  const lines: string[] = [];
  if (input.questionText !== null && input.questionText.trim() !== "") {
    lines.push(`【研究问题】${input.questionText}`);
    lines.push("");
  }
  const sourceLabel =
    input.alignmentSource === "EMPHASIS"
      ? "按提问侧重筛出的"
      : input.alignmentSource === "REQUIRED_FALLBACK"
        ? "按本问题的核心口径（必需项）筛出的"
        : "（未能定位到与本问题直接对应的分析）";
  if (input.alignedFindings.length === 0) {
    lines.push(
      `【针对该问题】本次 ${input.totalAnalyses} 条分析里，${sourceLabel}直接证据一条也没有进入 Finding 列表 ——`
        + `即**这个问题本轮没有得到可直接引用的证据**。请先核对计划是否真的包含了对应分析，再考虑进入下一阶段。`,
    );
    lines.push("");
  } else {
    lines.push(`【针对该问题】以下 ${input.alignedFindings.length} 条是${sourceLabel}直接证据：`);
    for (const f of input.alignedFindings) {
      const n = f.sampleCount === null ? "样本不可用" : `n=${f.sampleCount}`;
      const eff = f.effect.excessReturn;
      const effText =
        eff === null || eff === undefined
          ? "超额不可用"
          : `超额 ${(eff * 100).toFixed(2)} 个百分点`;
      const stability =
        f.stability === null || f.stability === undefined
          ? "稳定性未评估"
          : f.stability.contradicted
            ? "稳定性有冲突"
            : f.stability.stable
              ? "稳定性通过"
              : "稳定性未通过";
      lines.push(`  · ${f.title}（${n}，${effText}，${stability}）`);
    }
    lines.push("");
  }
  lines.push("【统计判定】");
  lines.push(input.engineConclusion);
  return lines.join("\n");
}

export interface BuildOutcomeInput {
  /** 定位方式二选一：`questionId` 或 `runId`。 */
  questionId?: number;
  runId?: number;
  topN?: number;
  /** Top 展示的最小研究强度（低于此值不进第一屏，但仍在库）。默认 0（不设门槛，只按条数截断）。 */
  minStrength?: number;
}

/**
 * 组装研究结论视图。
 *
 * 定位优先级：`questionId` → 其 plan/run；否则用 `runId` 反查（容错：人工建的 Run 没有 question）。
 */
export async function buildResearchOutcome(
  repos: ResearchRepositories,
  input: BuildOutcomeInput,
): Promise<ResearchOutcome> {
  const topN = Math.max(1, Math.floor(input.topN ?? DEFAULT_TOP_FINDINGS));
  const minStrength = input.minStrength ?? 0;

  // ---- 定位 ----
  let question = null;
  let plan = null;
  if (input.questionId !== undefined) {
    question = (await repos.questions.getById(input.questionId)) ?? null;
    if (question !== null && question.id !== undefined) {
      plan = (await repos.plans.latestForQuestion(question.id)) ?? null;
    }
  }

  const runId = input.runId ?? plan?.runId ?? question?.runId ?? null;
  const run: ResearchRun | null = runId !== null ? ((await repos.runs.getById(runId)) ?? null) : null;
  const experimentId = plan?.experimentId ?? question?.experimentId ?? run?.experimentId ?? null;

  if (experimentId === null) {
    throw new Error(
      "无法定位研究：既没有可用的 questionId（含 plan/run），也没有可用的 runId / experimentId。",
    );
  }

  // ---- 读分析 / Finding / 结论 ----
  const [analyses, findingsAll, conclusionsAll] = await Promise.all([
    runId !== null ? repos.analyses.list({ runId }) : Promise.resolve([] as ResearchAnalysis[]),
    repos.findings.list({ experimentId }),
    repos.conclusions.list({ experimentId }),
  ]);

  /**
   * ---- 按「Run → 分析 → planId」反查补齐 plan / question（**幂等**）----
   *
   * 🔴 为什么必须有：`getOutcome` 支持两种定位入口（`questionId` / `runId`），
   *    而旧实现**只在 `questionId` 路径上**解析 plan / question ⇒
   *    **同一份研究换个入口结果就不同**：按 `runId` 调用（Workbuddy、高级模式、
   *    `createCandidate({ runId })`）会丢掉 planId / datasetVersionId / moduleKeys /
   *    `plan.notes.*`。实测后果（本仓 `_verify_candidate_filter_source.mts`）：
   *    · `provenance.complete === false` —— §16 要求的六项 provenance 不齐；
   *    · §13 提问锚点失效（`emphasisAnalysisNames` 随 plan 一起丢）⇒
   *      用户明确问的精修维度不再进「针对你的问题」，退回 `REQUIRED_FALLBACK`。
   *
   * `research_analysis.planId` 就是「这条分析由哪份计划生成」的权威记录
   * （RESEARCH-PLANNER-001 刻意把它加在 `research_analysis` 上、不另建关系表），
   * 顺着它补齐即可 —— **不需要第二套映射**。
   * 人工在高级模式逐个建的分析 `planId` 为 NULL ⇒ 这里老老实实什么都不做。
   */
  if (plan === null && analyses.length > 0) {
    const planId = analyses.find((a) => a.planId !== null)?.planId ?? null;
    if (planId !== null) plan = (await repos.plans.getById(planId)) ?? null;
  }
  if (question === null && plan !== null && plan.questionId !== null) {
    question = (await repos.questions.getById(plan.questionId)) ?? null;
  }

  const analysisById = new Map<number, ResearchAnalysis>();
  for (const a of analyses) if (a.id !== undefined) analysisById.set(a.id, a);

  // 结果行数 / 条件行数逐分析统计。
  //   · 结果行数 → 「这条分析到底产出了什么」（§22 的「零结果」判据）；
  //   · 条件行数 → 「这条分析能不能导出候选筛选条件」（§16）。
  // 🔴 两条查询**并发**：往返次数与改动前完全一致（仍是 analyses.length 次），
  //    因此不引入任何额外跨境延迟（RTT ≈ 208ms，顺序 await 才是真瓶颈）。
  const resultCountByAnalysis = new Map<number, number>();
  const conditionCountByAnalysis = new Map<number, number>();
  for (const a of analyses) {
    if (a.id === undefined) continue;
    const [results, conditions] = await Promise.all([
      repos.results.list({ analysisId: a.id }),
      repos.conditions.listByAnalysis(a.id),
    ]);
    resultCountByAnalysis.set(a.id, results.length);
    conditionCountByAnalysis.set(a.id, conditions.length);
  }

  /**
   * §13 / §15 / §28 —— 「用户问的那件事」对应的分析集合。
   * 提前到这里算：`analysisStats` 的 `isQuestionEmphasis` 与下面的候选来源排序都要用它，
   * 而 `questionAlignedFindings` 只是它的消费方之一。
   */
  const emphasisNames = new Set(plan?.notes?.emphasisAnalysisNames ?? []);
  const emphasisAnalysisIds = new Set(
    analyses.filter((a) => a.id !== undefined && emphasisNames.has(a.name)).map((a) => a.id as number),
  );

  // ---- 分析执行状态 ----
  const analysisStats: ResearchOutcomeAnalysisStat[] = analyses.map((a) => ({
    analysisId: a.id!,
    name: a.name,
    analysisType: a.analysisType,
    priority: a.priority ?? null,
    purpose: a.purpose ?? null,
    status: a.status,
    resultCount: resultCountByAnalysis.get(a.id!) ?? 0,
    conditionCount: conditionCountByAnalysis.get(a.id!) ?? 0,
    requiredFlag: a.requiredFlag === true,
    isQuestionEmphasis: emphasisAnalysisIds.has(a.id!),
    // `research_analysis` 不存错误信息（错误落在 Run 的 executionLog / 结果为空）。
    // 这里如实置 null，**不编造**「失败原因」。
    errorCode: null,
    errorMessage: null,
  }));

  const completedCount = analysisStats.filter((a) => a.status === "COMPLETED").length;
  const failedCount = analysisStats.filter((a) => a.status === "FAILED" || a.status === "CANCELLED").length;
  const pendingCount = analysisStats.filter((a) => a.status === "PENDING" || a.status === "RUNNING").length;

  // ---- Finding → 视图 ----
  const runFindings = runId !== null ? findingsAll.filter((f) => f.runId === runId) : findingsAll;
  const ranked = rankAndDedupeFindings(runFindings, analysisById);
  const views = ranked.kept.map((f) => toFindingView(f, analysisById, ranked.conflicts));
  const visible = views.filter((v) => (v.researchStrength ?? 0) >= minStrength);

  // ---- 最新结论（优先引用 runId 匹配的）----
  const conclusionRaw = pickConclusion(conclusionsAll, runId, plan?.id ?? null);

  /**
   * ---- §13 / §15 / §28：把「用户问的那件事」筛出来 ----
   *
   * 两条来源（优先级从高到低）：
   *   ① 计划里的 `emphasisAnalysisNames` —— 由「强调词命中的精修配方」生成的分析（最精确）；
   *   ② 回落：**必需项**（`requiredFlag`，即 P0 主口径）—— 用户没在问题里点明某个精修维度时，
   *      「本问题的核心口径」就是最直接的证据（例如 §27 的「不跌破首板开盘价」本身）。
   *
   * 🔴 这两条都**只是筛选**，不重算任何统计量（§21），也不改变 `topFindings` 的全局排序
   *    （那是对全部证据的陈述，不该被提问偏向改写）。
   */
  const requiredAnalysisIds = new Set(
    analyses.filter((a) => a.id !== undefined && a.requiredFlag === true).map((a) => a.id as number),
  );
  const alignedIds = emphasisAnalysisIds.size > 0 ? emphasisAnalysisIds : requiredAnalysisIds;
  const alignmentSource: ResearchOutcome["questionAlignment"]["source"] =
    emphasisAnalysisIds.size > 0
      ? "EMPHASIS"
      : requiredAnalysisIds.size > 0
        ? "REQUIRED_FALLBACK"
        : "NONE";
  const questionAlignedFindings = views
    .filter((v) => v.primaryAnalysisId !== null && alignedIds.has(v.primaryAnalysisId))
    .slice(0, Math.min(topN, DEFAULT_QUESTION_ALIGNED_FINDINGS));
  const questionAlignment: ResearchOutcome["questionAlignment"] = {
    source: alignmentSource,
    analysisCount: alignedIds.size,
    note:
      alignmentSource === "EMPHASIS"
        ? `按提问侧重锁定 ${alignedIds.size} 条分析（计划里标注为与问题直接相关）。`
        : alignmentSource === "REQUIRED_FALLBACK"
          ? `问题里没有点明具体精修维度，回落到本问题的 ${alignedIds.size} 条必需项（核心口径）分析。`
          : "既没有侧重标注、也没有必需项 —— 本问题没有可直接对应的分析。",
  };

  /**
   * §15 —— 结论正文**前**拼「研究问题 / 针对该问题的直接证据」段（视图层，库内原文不动）。
   * `researchQuestion` 也在这里兜底：库里有值就用库里的（引擎写入），没有就用问题原文。
   */
  const conclusion =
    conclusionRaw === null
      ? null
      : {
          ...conclusionRaw,
          researchQuestion: conclusionRaw.researchQuestion ?? question?.questionText ?? null,
          conclusion: composeQuestionAnchor({
            questionText: question?.questionText ?? null,
            alignedFindings: questionAlignedFindings,
            alignmentSource,
            totalAnalyses: analysisStats.length,
            engineConclusion: conclusionRaw.conclusion,
          }),
        };

  // ---- 数据有效性（§22）：失败 / 未完成 / **零结果** 三个维度分开报 ----
  const emptyResultStats = analysisStats.filter((a) => a.status === "COMPLETED" && a.resultCount === 0);
  const emptyResultCount = emptyResultStats.length;
  const dataValidity = {
    passed: failedCount === 0 && pendingCount === 0 && emptyResultCount === 0,
    checkedCount: analysisStats.length,
    failedCount,
    pendingCount,
    emptyResultCount,
    notes: [
      failedCount === 0 && pendingCount === 0 && emptyResultCount === 0
        ? `数据有效性检查 ✓ Passed：${analysisStats.length} 条分析全部执行完成且都产出了结果。`
        : `存在 ${failedCount + pendingCount + emptyResultCount} 条分析未通过有效性检查`
          + `（失败 ${failedCount} 条、未完成 ${pendingCount} 条、执行完成但**零结果** ${emptyResultCount} 条），`
          + `共 ${analysisStats.length} 条。`,
      ...(pendingCount > 0
        ? ["未完成的条数说明本次执行还没跑完 —— 在跑完之前，任何「总体结论」都只是部分证据，不应据此进入下一阶段。"]
        : []),
      ...(emptyResultCount > 0
        ? [
            "「执行完成但零结果」既不是成功也不是失败：执行器跑完了，但没有任何可报告的分组 / 样本。"
              + "常见成因有两类 —— ① 条件把样本筛成了 0 条；② 该分析引用的特征在该 Dataset 上全为空。"
              + "这类分析**没有进入任何 Finding 的证据**，因此不要把它当作「已验证」或「已排除」。",
          ]
        : []),
    ],
    failedAnalyses: analysisStats
      .filter((a) => a.status === "FAILED" || a.status === "CANCELLED")
      .map((a) => ({ analysisId: a.analysisId, name: a.name, errorCode: a.errorCode, errorMessage: a.errorMessage })),
    emptyResultAnalyses: emptyResultStats.map((a) => ({
      analysisId: a.analysisId,
      name: a.name,
      note:
        `${a.analysisType} 分析执行完成但没有产出任何结果行。`
        + "请核对：该分析引用的特征 / 条件字段在这个 Dataset 版本上的实际填充率"
        + "（「声明了这个变量」不等于「这个变量有值」）。",
    })),
  };

  const recommendationBase = buildRecommendation({
    failedCount,
    pendingCount,
    emptyResultCount,
    findingsTotal: ranked.kept.length,
    topFindings: visible,
    conclusionExists: conclusion !== null,
  });
  // §15 —— 免责声明在聚合层**唯一注入**：`buildRecommendation` 只管「判定」，
  // 文案约束由这里统一添加。放在被调用方内部的话，将来新增一个判定分支就可能漏加。
  const recommendation: ResearchOutcome["recommendation"] = {
    ...recommendationBase,
    disclaimer: RESEARCH_OUTCOME_DISCLAIMER,
  };

  /**
   * §16 —— 可导出候选筛选条件的分析清单（排序实现见 `rankCandidateSourceAnalyses`）。
   * `createCandidate` 未显式指定来源时直接取第 0 条。
   */
  const candidateEligibleAnalyses = rankCandidateSourceAnalyses(analysisStats);

  return {
    questionId: question?.id ?? null,
    questionText: question?.questionText ?? null,
    planId: plan?.id ?? null,
    experimentId,
    runId,
    datasetVersionId: plan?.datasetVersionId ?? question?.datasetVersionId ?? null,
    moduleKeys: plan?.moduleKeys ?? [],

    runStatus: run?.status ?? null,
    sampleCount: run?.sampleCount ?? null,

    analysisCount: analysisStats.length,
    completedCount,
    failedCount,
    pendingCount,

    dataValidity,

    findingsTotal: ranked.kept.length,
    dedupedCount: ranked.dedupedCount,
    topFindings: visible.slice(0, topN),
    hiddenFindingCount: Math.max(0, ranked.kept.length - Math.min(visible.length, topN)),

    questionAlignedFindings,
    questionAlignment,

    conclusion,

    recommendation,
    nextActions: buildNextActions({
      failedCount,
      pendingCount,
      emptyResultCount,
      findingsTotal: ranked.kept.length,
      visible,
      conclusion,
    }),

    plan: {
      plannedCount: plan?.plannedCount ?? null,
      droppedCount: plan?.droppedCount ?? 0,
      capApplied: plan?.capApplied ?? false,
      maxAnalysisPerPlan: plan?.maxAnalysisPerPlan ?? null,
      unresolvedClauses: plan?.notes?.unresolvedClauses ?? [],
      selectionRationale: plan?.notes?.selectionRationale ?? [],
      dropped: (plan?.notes?.dropped ?? []).map((d) => ({
        name: d.name,
        analysisType: d.analysisType,
        reason: d.reason,
        detail: d.detail,
      })),
    },

    analyses: analysisStats,

    candidateEligibleAnalyses,
  };
}

// ---------------------------------------------------------------------------
// 排序 / 去重 / 冲突标注
// ---------------------------------------------------------------------------

/** 去重键：同一「发现类型 + 目标 + 维度键」视为同一件事的多次表述，只留最强的一条。 */
export function findingDedupeKey(finding: ResearchFinding): string {
  const dim = finding.dimension ?? {};
  const dimKey = Object.keys(dim).sort().map((k) => `${k}=${dim[k]}`).join("&");
  // ⚠️ 刻意**不**把 horizon 放进键：同一现象在 T+5 / T+10 各出一条属于「同一件事的跨视界重复」，
  // 摆在 Top 里会让用户以为是两个独立发现。跨视界一致性由 `horizon` 分项承载。
  return `${finding.findingType}|${finding.target ?? "-"}|${dimKey}`;
}

export interface RankedFindings {
  kept: ResearchFinding[];
  /** 被去重合并掉的条数（**不是删除** —— 它们仍在库里，只是不进第一屏）。 */
  dedupedCount: number;
  /** findingId → 与之方向相反的 findingId 列表。 */
  conflicts: Map<number, number[]>;
}

/**
 * 排序 + 去重 + 冲突标注。
 *
 * 排序口径（确定性）：研究强度降序 → 样本量降序 → findingId 升序。
 * 之所以把 id 作为最后一级：强度相同的两条必须有一个稳定次序，否则同一个 Run
 * 两次打开页面可能给出不同的 Top 列表（用户会以为数据变了）。
 */
export function rankAndDedupeFindings(
  findings: readonly ResearchFinding[],
  _analysisById: ReadonlyMap<number, ResearchAnalysis>,
): RankedFindings {
  const byKey = new Map<string, ResearchFinding[]>();
  for (const f of findings) {
    const key = findingDedupeKey(f);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [f]);
    else list.push(f);
  }

  const kept: ResearchFinding[] = [];
  let dedupedCount = 0;
  for (const list of byKey.values()) {
    const sorted = [...list].sort(compareFindings);
    kept.push(sorted[0]!);
    dedupedCount += sorted.length - 1;
  }
  kept.sort(compareFindings);

  return { kept, dedupedCount, conflicts: detectConflicts(kept) };
}

function compareFindings(a: ResearchFinding, b: ResearchFinding): number {
  const sa = a.researchStrength ?? -1;
  const sb = b.researchStrength ?? -1;
  if (sb !== sa) return sb - sa;
  const na = a.sample?.sampleCount ?? -1;
  const nb = b.sample?.sampleCount ?? -1;
  if (nb !== na) return nb - na;
  return (a.id ?? 0) - (b.id ?? 0);
}

/**
 * 冲突检测：同一**目标 + 维度**下的多条 Finding，若效应方向相反则互相标记。
 *
 * 为什么必须做（§13 第 9 条）：只展示「支持」的证据、把反向证据埋在列表深处，
 * 等于选择性报告。冲突一旦检出就在这里显式标注，前端必须显示「有 N 条相反证据」。
 */
export function detectConflicts(findings: readonly ResearchFinding[]): Map<number, number[]> {
  const groups = new Map<string, ResearchFinding[]>();
  for (const f of findings) {
    const dim = f.dimension ?? {};
    const key = `${f.target ?? "-"}|${Object.keys(dim).sort().join("&")}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [f]);
    else list.push(f);
  }

  const out = new Map<number, number[]>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const f of list) {
      const dirF = effectDirection(f);
      if (dirF === 0 || f.id === undefined) continue;
      const opposite = list
        .filter((o) => o.id !== undefined && o.id !== f.id && effectDirection(o) === -dirF)
        .map((o) => o.id!);
      if (opposite.length > 0) out.set(f.id, opposite);
    }
  }
  return out;
}

/** 效应方向：+1 / −1 / 0（不可判定）。优先超额收益，其次组内收益。 */
function effectDirection(finding: ResearchFinding): number {
  const effect = finding.effect;
  if (!effect) return 0;
  const value = effect.excessReturn ?? effect.groupReturn;
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function toFindingView(
  finding: ResearchFinding,
  analysisById: ReadonlyMap<number, ResearchAnalysis>,
  conflicts: Map<number, number[]>,
): ResearchFindingView {
  const analysis = finding.primaryAnalysisId != null ? analysisById.get(finding.primaryAnalysisId) : undefined;
  return {
    findingId: finding.id!,
    findingType: finding.findingType,
    title: finding.title,
    summary: finding.summary ?? null,
    status: finding.status,
    researchStrength: finding.researchStrength ?? null,
    researchStrengthGrade: finding.researchStrengthGrade ?? null,
    primaryAnalysisId: finding.primaryAnalysisId ?? null,
    analysisName: analysis?.name ?? null,
    analysisType: analysis?.analysisType ?? null,
    target: finding.target ?? null,
    horizon: finding.horizon?.peakHorizon ?? null,
    sampleCount: finding.sample?.sampleCount ?? null,
    sampleGrade: finding.sample?.grade ?? null,
    effect: {
      groupReturn: finding.effect?.groupReturn ?? null,
      benchmarkReturn: finding.effect?.benchmarkReturn ?? null,
      excessReturn: finding.effect?.excessReturn ?? null,
      winRate: finding.effect?.winRate ?? null,
      benchmarkUnavailable: finding.effect?.benchmarkUnavailable ?? true,
    },
    stability: finding.stability
      ? {
          dimensionKey: finding.stability.dimensionKey,
          stable: finding.stability.stable,
          contradicted: finding.stability.contradicted,
          consistentRatio: finding.stability.consistentRatio,
          slices: finding.stability.slices,
        }
      : null,
    conflictsWith: finding.id !== undefined ? (conflicts.get(finding.id) ?? []) : [],
    limitations: finding.limitations ?? [],
  };
}

/**
 * 选取本次研究的结论（`research_conclusion` 是**实验级**实体，故按实验取最新一条）。
 *
 * 🔴 §15 —— 结论正文在这里**追加免责声明后缀**。理由：结论文本是被用户**整段阅读**的，
 *    读者看不到「这段后面还有一句免责」，所以后缀必须拼在正文里，而不是交给渲染方自觉。
 *    数据库里的原文**不动**（证据不可被二次加工）；后缀只存在于「结论视图」这一层。
 */
function pickConclusion(
  conclusions: readonly ResearchConclusion[],
  runId: number | null,
  planId: number | null,
): ResearchOutcome["conclusion"] {
  if (conclusions.length === 0) return null;
  // 无 runId 关联的结论（本项目结论是**实验级**实体）→ 取最新一条（按 id 降序）。
  const sorted = [...conclusions].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  const chosen = sorted[0]!;
  return {
    id: chosen.id!,
    conclusionType: chosen.conclusionType,
    title: chosen.title,
    conclusion: withDisclaimer(chosen.conclusion),
    evidenceSummary: chosen.evidenceSummary ?? null,
    researchQuestion: chosen.researchQuestion ?? null,
    findingIds: chosen.findingIds ?? [],
    limitations: chosen.limitations ?? [],
    nextQuestions: chosen.nextQuestions ?? [],
    confidence: chosen.confidence ?? null,
    status: chosen.status,
  };
}

// ---------------------------------------------------------------------------
// Recommendation（§15：只能说「是否值得进入下一研究阶段」）
// ---------------------------------------------------------------------------

/**
 * 「建议」的**判定部分**（不含免责声明）。
 *
 * 🔴 之所以拆出来：`buildRecommendation` 有 6 个返回分支，若让它自己带上免责声明，
 *    将来新增分支就可能漏加 —— 而这是**合规性字段**，漏加是不可接受的。
 *    因此用 `Omit<...>` 让类型系统强制「判定函数不可能产出完整建议」，
 *    免责声明只能在 `buildResearchOutcome` 里唯一注入一次。
 */
export type ResearchRecommendationVerdict = Omit<ResearchOutcome["recommendation"], "disclaimer">;

export function buildRecommendation(input: {
  failedCount: number;
  pendingCount: number;
  /** §22 —— 执行完成但零结果的分析数（＝计划的一部分证据事实上没拿到）。 */
  emptyResultCount: number;
  findingsTotal: number;
  topFindings: readonly ResearchFindingView[];
  conclusionExists: boolean;
}): ResearchRecommendationVerdict {
  const reasons: string[] = [];

  if (input.pendingCount > 0) {
    reasons.push(`还有 ${input.pendingCount} 条分析未跑完 ⇒ 当前证据不完整，不能下结论。`);
    return {
      stage: "NEEDS_MORE_RESEARCH",
      text: `研究尚未执行完（${input.pendingCount} 条分析未完成）。请先执行完本轮研究，再评估是否进入下一阶段。`,
      reasons,
    };
  }
  if (input.failedCount > 0) {
    reasons.push(`有 ${input.failedCount} 条分析未通过有效性检查（失败）⇒ 证据存在缺口。`);
    return {
      stage: "NEEDS_MORE_RESEARCH",
      text: `本轮研究有 ${input.failedCount} 条分析失败，证据存在缺口。建议补跑失败的分析后再评估是否进入下一阶段。`,
      reasons,
    };
  }
  if (input.emptyResultCount > 0) {
    // §22：零结果 = 计划里有一部分证据事实上没拿到。此时**不能**说「值得进入下一阶段」——
    // 否则等于用残缺的证据下结论。这是「绝不在证据残缺时给正面建议」的硬约束。
    reasons.push(
      `有 ${input.emptyResultCount} 条分析执行完成但**零结果** ⇒ 计划的一部分证据缺失`
        + "（常见成因：条件筛出 0 条样本，或该特征在该 Dataset 上全为空）。",
    );
    return {
      stage: "NEEDS_MORE_RESEARCH",
      text:
        `本轮研究有 ${input.emptyResultCount} 条分析虽然执行完成，但没有产出任何结果 ——`
        + "这意味着计划的证据不完整。建议先核对这些分析引用的字段在该 Dataset 上的填充率，"
        + "再评估是否进入下一阶段。",
      reasons,
    };
  }
  if (input.findingsTotal === 0) {
    reasons.push("本轮未检出任何达到阈值的 Finding ⇒ 没有可支撑的证据。");
    return {
      stage: "NOT_WORTH_CONTINUING",
      text:
        "本轮研究没有检出达到阈值的规律（这是**合法且有价值**的结果：它说明这个方向在当前数据上不成立）。"
        + "建议换一个研究问题，或先确认数据集覆盖是否足够。",
      reasons,
    };
  }

  const strong = input.topFindings.filter((f) => f.researchStrengthGrade === "STRONG");
  const medium = input.topFindings.filter((f) => f.researchStrengthGrade === "MEDIUM");
  const contradicted = input.topFindings.filter(
    (f) => f.stability?.contradicted === true || f.conflictsWith.length > 0,
  );
  const unstable = input.topFindings.filter((f) => f.stability !== null && f.stability.stable === false);

  reasons.push(`检出 ${input.findingsTotal} 条 Finding（去重后进第一屏 ${input.topFindings.length} 条）。`);
  if (strong.length > 0) reasons.push(`其中 ${strong.length} 条强度为 STRONG。`);
  else if (medium.length > 0) reasons.push(`其中 ${medium.length} 条强度为 MEDIUM（无 STRONG）。`);
  else reasons.push("没有任何 STRONG / MEDIUM 强度的发现，全部为 WEAK。");
  if (contradicted.length > 0) reasons.push(`${contradicted.length} 条存在反向证据或自相矛盾。`);
  if (unstable.length > 0) reasons.push(`${unstable.length} 条跨切片方向不稳定。`);
  if (!input.conclusionExists) reasons.push("本轮尚未生成结论记录（结论需在执行完成时由 ConclusionBuilder 落库）。");

  if (contradicted.length > 0 || unstable.length > 0) {
    return {
      stage: "NEEDS_MORE_RESEARCH",
      text:
        "存在反向证据或跨切片不稳定的发现 —— 该方向**暂不宜进入下一阶段**。"
        + "建议先补做稳定性 / 分层研究（例如换分组维度），确认哪一部分样本上规律成立。",
      reasons,
    };
  }
  if (strong.length === 0 && medium.length === 0) {
    return {
      stage: "NEEDS_MORE_RESEARCH",
      text:
        "只检出弱强度发现（WEAK）—— 效应量或样本量不足以支撑下一步。"
        + "建议扩大样本（换更长的数据区间）或补充对照组研究后再评估。",
      reasons,
    };
  }
  return {
    stage: "WORTH_NEXT_STAGE",
    text:
      "检出至少一条中等及以上强度、且未见反向证据的发现 —— **值得进入下一研究阶段**"
      + "（例如转成 Candidate 草图、再做参数敏感性研究）。"
      + "是否真正可用仍需后续的阶段判定，本轮研究不回答「能不能赚钱」。",
    reasons,
  };
}

function buildNextActions(input: {
  failedCount: number;
  pendingCount: number;
  /** §22 —— 零结果分析数（要在「下一步动作」里给出核对字段填充率的指引）。 */
  emptyResultCount: number;
  findingsTotal: number;
  visible: readonly ResearchFindingView[];
  conclusion: ResearchOutcome["conclusion"];
}): string[] {
  const actions: string[] = [];
  if (input.pendingCount > 0) actions.push("先执行完本轮 Run（或对未完成的分析做增量补跑）。");
  if (input.failedCount > 0) actions.push("查看失败分析的原因并补跑（本轮证据不完整）。");
  if (input.emptyResultCount > 0) {
    actions.push(
      `核对 ${input.emptyResultCount} 条「零结果」分析引用的字段实际填充率`
        + "（「数据集登记了这个变量」不等于「这个变量有值」）；确认后再把这些分析当作有效证据。",
    );
  }
  if (input.findingsTotal === 0) {
    actions.push("换一个研究问题重新规划（当前方向在本数据集上未检出规律）。");
    actions.push("确认数据集时间区间与样本量是否足够（样本太少时任何规律都测不出来）。");
  }
  const weakStatus = input.visible.filter((f) => f.status === "DISCOVERED");
  if (weakStatus.length > 0) {
    actions.push(
      `人工 review ${weakStatus.length} 条 Finding 的状态（系统只产出 DISCOVERED，SUPPORTED / WEAK / REJECTED 必须由人判断）。`,
    );
  }
  const contradicted = input.visible.filter((f) => f.stability?.contradicted === true || f.conflictsWith.length > 0);
  if (contradicted.length > 0) actions.push("对存在反向证据的发现补做稳定性 / 分层研究，确认适用范围。");
  if (input.conclusion === null) actions.push("结论记录缺失：确认 Run 是否完整执行（结论由执行收尾时落库）。");
  actions.push("如决定继续：创建 Candidate 草图（保留 researchId / runId / planId / datasetVersionId / findingIds / conclusionId 全套溯源）。");
  return actions;
}

/** §15 —— 结论文本的强制后缀（前端渲染结论时必须拼上）。 */
export function withDisclaimer(text: string): string {
  return `${text}\n\n${RESEARCH_OUTCOME_DISCLAIMER}`;
}
