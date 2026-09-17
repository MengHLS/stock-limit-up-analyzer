/**
 * researchAskForm — 「提出问题即研究」默认模式的**纯逻辑**（RESEARCH-PLANNER-001 / §14–§18、§29）。
 *
 * 为什么单独成文件（与 `createExperimentForm` / `candidateForm` 同一约定）：
 *   页面组件里只允许「取值 → 调接口 → 渲染」。「用户填到什么程度才算合法」
 *   「风险提示该怎么算」「关键证据那一行该显示什么」这类判断放在纯函数里，
 *   才能被测试覆盖，也才不会在两次渲染之间漂移。
 *
 * 🔴 本文件**不发明任何统计口径**，也不补算任何数字：
 *   - 数字全部来自后端 `researchPlanner.getOutcome` 的字段，这里只做**取值 / 拼措辞**；
 *   - 「风险提示」是把后端的 `dataValidity` / `limitations` / `stability` / `conflictsWith` /
 *     `sampleGrade` / `plan.dropped` 逐条翻成人话 —— **有一条后端事实才有一条提示**，
 *     绝不凭空加一句「注意风险」；
 *   - 「关键证据」的九列与任务书 §13 的九问一一对应，缺哪个字段就显示「—」，
 *     **不省略列**（省略会让用户看不出「这条发现其实没有稳定性证据」）。
 */

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  RESEARCH_PLAN_DEFAULT_ANALYSIS,
  RESEARCH_PLAN_MAX_ANALYSIS,
  RESEARCH_PLAN_MIN_ANALYSIS,
  RESEARCH_QUESTION_MAX_LENGTH,
  RESEARCH_QUESTION_MIN_LENGTH,
  researchQuestionTextSchema,
} from "@shared/researchContracts";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/** `researchPlanner.getOutcome` 的返回形状（结论视图）。 */
export type ResearchOutcomeView = RouterOutputs["researchPlanner"]["getOutcome"];
/** `researchPlanner.createQuestion` 的返回形状（问题 + 计划 + 预览）。 */
export type ResearchPlannedView = RouterOutputs["researchPlanner"]["createQuestion"];
/** 计划预览。 */
export type ResearchPlanPreview = ResearchPlannedView["preview"];
/** 一条 Top Finding。 */
export type ResearchFindingView = ResearchOutcomeView["topFindings"][number];

/**
 * §16 —— 候选创建回执里的「筛选条件来源」。
 *
 * 🔴 为什么要有它：候选的 `filterRule` 是从某条分析的落库条件导出的，
 *    「从哪条来」是用户人工确认（Research → Candidate → User confirms → Strategy）
 *    时必须看到的信息。此前回执里完全没有这一项，用户只能靠报错猜。
 */
export type CandidateFilterSourceView =
  RouterOutputs["researchPlanner"]["createCandidate"]["filterRuleSource"];

/** 本 Run 里**可导出条件**的分析（结论页展示「还有哪些口径可选」）。 */
export type CandidateEligibleView = ResearchOutcomeView["candidateEligibleAnalyses"][number];

export {
  RESEARCH_PLAN_DEFAULT_ANALYSIS,
  RESEARCH_PLAN_MAX_ANALYSIS,
  RESEARCH_PLAN_MIN_ANALYSIS,
  RESEARCH_QUESTION_MAX_LENGTH,
  RESEARCH_QUESTION_MIN_LENGTH,
};

// ---------------------------------------------------------------------------
// 步骤机（§29 的六步用四个界面状态承载）
// ---------------------------------------------------------------------------

export const RESEARCH_ASK_STEPS = ["ASK", "PREVIEW", "RUNNING", "OUTCOME"] as const;
export type ResearchAskStep = (typeof RESEARCH_ASK_STEPS)[number];

export const RESEARCH_ASK_STEP_LABELS: Record<ResearchAskStep, string> = {
  ASK: "① 提出问题",
  PREVIEW: "② 研究计划预览",
  RUNNING: "③ 正在研究",
  OUTCOME: "④ 研究结论",
};

// ---------------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------------

export interface ResearchAskFormState {
  datasetId: string;
  datasetVersionId: string;
  questionText: string;
}

export function createDefaultResearchAskForm(): ResearchAskFormState {
  return { datasetId: "", datasetVersionId: "", questionText: "" };
}

export interface ResearchAskFormContext {
  /** 当前数据集下的版本列表（决定「版本是否可用」的判断依据）。 */
  versions: readonly { id: number; version: string; status: string; totalEvents?: number | null }[];
  /** 数据集详情是否已加载（未加载时不给「版本不存在」这种结论）。 */
  definitionLoaded: boolean;
}

/**
 * 校验研究问题表单，**一次列出全部原因**（不逐个挤牙膏）。
 *
 * 与后端同源：直接用 `@shared/researchContracts` 的 `researchQuestionTextSchema`，
 * 不在这里另写一遍「至少几个字」。
 */
export function validateResearchAskForm(
  state: ResearchAskFormState,
  ctx: ResearchAskFormContext,
): string[] {
  const errors: string[] = [];
  if (state.datasetId.trim() === "") {
    errors.push("请先选择数据集。");
  }
  if (state.datasetVersionId.trim() === "") {
    errors.push("请选择 Dataset 版本（只有 READY 状态可用于研究）。");
  } else {
    const version = ctx.versions.find((v) => String(v.id) === state.datasetVersionId);
    if (version === undefined) {
      if (ctx.definitionLoaded) errors.push("所选 Dataset 版本不在当前数据集的版本列表里，请重新选择。");
    } else if (version.status !== "READY") {
      errors.push(`Dataset 版本 ${version.version} 当前状态为 ${version.status}，不可用于研究（需要 READY）。`);
    }
  }

  const parsed = researchQuestionTextSchema.safeParse(state.questionText);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(issue.message);
  }
  return errors;
}

/** 提交给后端的入参（**只有两项**，§5 / §27）。 */
export function toResearchAskInput(state: ResearchAskFormState): {
  datasetVersionId: number;
  questionText: string;
} {
  return {
    datasetVersionId: Number(state.datasetVersionId),
    questionText: state.questionText.trim(),
  };
}

/**
 * 示例问题（点一下即可填）。
 *
 * 它们的作用是让用户看到「提问的粒度」——**只写研究问题，不写 Feature/Target/Horizon**。
 * 两句都取自任务书 §27 / §28 的验收案例，因此不是编的。
 */
export const RESEARCH_ASK_EXAMPLES: readonly { text: string; hint: string }[] = [
  {
    text: "首板之后回踩，只要不跌破首板开盘价，后面的收益是不是更好？",
    hint: "→ 会识别成「回踩有效性」：自动建 全样本基准 + 不破开盘价守卫条件 + 缩量/阳线精修 + 对照组 + 稳定性复核",
  },
  {
    text: "首板后回踩深度是否影响后续收益？回踩得深一点是不是更值得买入，还是回踩浅一点更好？",
    hint: "→ 同上，并会把「回踩深度分档」排到精修条件的前面（按提问侧重排序）",
  },
  {
    text: "首板之后不同持有期（T+5 / T+10 / T+20）收益差异大吗？哪个持有期最稳？",
    hint: "→ 会识别成「持有期研究」：自动铺开多视界并做跨切片稳定性复核",
  },
];

// ---------------------------------------------------------------------------
// 结论视图的人读映射（全部由后端字段派生）
// ---------------------------------------------------------------------------

export type RecommendationStage = ResearchOutcomeView["recommendation"]["stage"];

export interface StageStyle {
  label: string;
  tone: "good" | "warn" | "bad";
  /** 该阶段**能**意味着什么、**不能**意味着什么（§15：不得声称能赚钱）。 */
  meaning: string;
}

export function recommendationStageStyleOf(stage: RecommendationStage): StageStyle {
  switch (stage) {
    case "WORTH_NEXT_STAGE":
      return {
        label: "值得进入下一研究阶段",
        tone: "good",
        meaning:
          "存在中等及以上强度、且未见反向证据的发现。这只说明**这批证据值得继续研究**"
          + "（例如转成候选草图、再做参数敏感性研究），**不代表这个策略能赚钱**。",
      };
    case "NEEDS_MORE_RESEARCH":
      return {
        label: "需要补充研究",
        tone: "warn",
        meaning:
          "证据存在缺口（有失败/未完成的分析），或存在反向证据 / 跨切片不稳定，"
          + "或只有弱强度发现。**暂不宜进入下一阶段**，先补做研究。",
      };
    case "NOT_WORTH_CONTINUING":
      return {
        label: "暂不值得继续",
        tone: "bad",
        meaning:
          "没有检出达到阈值的规律。这是一个**合法且有价值**的结果 —— 它说明这个方向在当前数据上不成立。"
          + "建议换一个研究问题，或先确认数据集覆盖是否足够。",
      };
    default:
      return { label: String(stage), tone: "warn", meaning: "" };
  }
}

/** 研究强度等级的人读标签（缺值如实显示「—」）。 */
export function strengthGradeLabelOf(grade: string | null | undefined): string {
  switch (grade) {
    case "STRONG":
      return "强";
    case "MEDIUM":
      return "中";
    case "WEAK":
      return "弱";
    case null:
    case undefined:
      return "—";
    default:
      return String(grade);
  }
}

/** 样本量等级的人读标签。 */
export function sampleGradeLabelOf(grade: string | null | undefined): string {
  switch (grade) {
    case "SUFFICIENT":
      return "充足";
    case "MARGINAL":
      return "临界";
    case "INSUFFICIENT":
      return "不足";
    case null:
    case undefined:
      return "—";
    default:
      return String(grade);
  }
}

/** 百分比格式化（后端返回的是 0~1 的小数；`null` 一律显示「—」，不显示 0）。 */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** 百分点差异（后端 `excessReturn` 与收益同为小数比率）。 */
export function formatPercentPoint(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const pp = value * 100;
  return `${pp >= 0 ? "+" : ""}${pp.toFixed(digits)}pp`;
}

// ---------------------------------------------------------------------------
// 执行进度（§23：进度靠既有逐分析 status 落库，前端只做汇总）
// ---------------------------------------------------------------------------

export interface RunProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  /** 0~100；总数为 0 时为 0（不显示 NaN）。 */
  percent: number;
  /** 是否已经跑完（没有 PENDING / RUNNING 的分析）。 */
  settled: boolean;
}

export function summarizeRunProgress(view: ResearchOutcomeView): RunProgress {
  const total = view.analysisCount;
  const completed = view.completedCount;
  const failed = view.failedCount;
  const pending = view.pendingCount;
  const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
  // `settled` 必须与 `isRunReportable` 同口径，否则会出现「进度条说 100%、但结论区还在等」的自相矛盾。
  return { total, completed, failed, pending, percent, settled: isRunReportable(view) };
}

/**
 * Run 是否已经可以展示结论。
 *
 * 🔴 三个条件缺一不可（这是一个真实的**竞态**，不是保险起见）：
 *   ① `analysisCount === 0` ⇒ 计划还没物化成分析。此时 `pendingCount` 也是 0，
 *     若只看 pending 就会在「刚点开始研究」的瞬间判定「已跑完」，给用户一个空结论页。
 *   ② `pendingCount > 0` ⇒ 还有分析在跑。
 *   ③ Run 状态必须已落定（COMPLETED / FAILED）。只看分析状态的话，
 *     最后一条分析写完与 Run 收尾之间有一个窗口，那期间结论尚未生成。
 */
export function isRunReportable(view: ResearchOutcomeView): boolean {
  if (view.analysisCount === 0) return false;
  if (view.pendingCount > 0) return false;
  return view.runStatus === "COMPLETED" || view.runStatus === "FAILED";
}

// ---------------------------------------------------------------------------
// 关键证据（§13 的九问 → 九列；缺值显示「—」，**不省略列**）
// ---------------------------------------------------------------------------

export interface KeyEvidenceRow {
  findingId: number;
  /** ① 发现了什么 */
  what: string;
  /** ② 在哪个条件下 */
  condition: string;
  /** ③ 对什么目标 */
  target: string;
  /** ④ 哪个视界 */
  horizon: string;
  /** ⑤ 样本量 */
  sample: string;
  /** ⑥ 与基准的差异 */
  vsBenchmark: string;
  /** ⑦ 效果大小（条件组收益 / 胜率） */
  effectSize: string;
  /** ⑧ 是否稳定 */
  stability: string;
  /** ⑨ 是否与其他发现冲突 */
  conflict: string;
}

export function buildKeyEvidenceRows(view: ResearchOutcomeView): KeyEvidenceRow[] {
  return view.topFindings.map((f) => ({
    findingId: f.findingId,
    what: f.title,
    condition: f.analysisName ?? "—",
    target: f.target ?? "—",
    horizon: f.horizon === null || f.horizon === undefined ? "—" : `T+${f.horizon}`,
    sample: `${f.sampleCount ?? "—"}（${sampleGradeLabelOf(f.sampleGrade)}）`,
    vsBenchmark: f.effect.benchmarkUnavailable
      ? "基准不可用"
      : `${formatPercentPoint(f.effect.excessReturn)}（基准 ${formatPercent(f.effect.benchmarkReturn)}）`,
    effectSize: `条件组 ${formatPercent(f.effect.groupReturn)} · 胜率 ${formatPercent(f.effect.winRate, 1)}`,
    stability:
      f.stability === null
        ? "无稳定性证据"
        : f.stability.stable
          ? `稳定（一致率 ${formatPercent(f.stability.consistentRatio, 0)}）`
          : `不稳定（一致率 ${formatPercent(f.stability.consistentRatio, 0)}）`,
    conflict: f.conflictsWith.length > 0 ? `与 ${f.conflictsWith.length} 条发现冲突` : "无",
  }));
}

// ---------------------------------------------------------------------------
// 风险提示（§14：默认页必须给出风险提示；每条都必须对应一条后端事实）
// ---------------------------------------------------------------------------

export function buildRiskNotes(view: ResearchOutcomeView): string[] {
  const notes: string[] = [];

  // ① 有效性缺口 —— 最硬的阻断项，放最前
  if (!view.dataValidity.passed) {
    notes.push(
      `⚠️ 数据有效性检查未通过：${view.analysisCount} 条分析中失败 ${view.dataValidity.failedCount} 条、`
      + `未完成 ${view.dataValidity.pendingCount} 条、执行完成但零结果 ${view.dataValidity.emptyResultCount} 条。`
      + "在补齐之前，任何「总体结论」都只是部分证据。",
    );
  } else {
    notes.push(`✅ 数据有效性检查通过：${view.analysisCount} 条分析全部执行完成且都产出了结果。`);
  }

  // ①' 零结果分析 —— 最容易误解的一类，必须点名
  if (view.dataValidity.emptyResultCount > 0) {
    notes.push(
      `有 ${view.dataValidity.emptyResultCount} 条分析**执行完成但没有产出任何结果**`
      + `（#${view.dataValidity.emptyResultAnalyses.map((a) => a.analysisId).join(", #")}）——`
      + "它们既不算「已验证」也不算「已排除」，常见成因是条件筛出 0 条样本，或该特征在该 Dataset 上全为空。",
    );
  }

  // ② 计划层面：本来打算做但没做成的
  if (view.plan.droppedCount > 0) {
    notes.push(
      `计划里有 ${view.plan.droppedCount} 条分析未生成或被裁剪`
      + `${view.plan.capApplied ? "（触发了规模上限）" : "（该 Dataset 缺少所需数据能力）"} ——`
      + "详见下方「研究计划与原始分析」。",
    );
  }
  if (view.plan.unresolvedClauses.length > 0) {
    notes.push(
      `研究问题里有 ${view.plan.unresolvedClauses.length} 个分句没有被采纳：`
      + `${view.plan.unresolvedClauses.join(" ¶ ")} —— 系统不会假装研究过它们。`,
    );
  }

  // ③ 逐发现的局限（原样透出，不删不改）
  const limitationLines = view.topFindings.flatMap((f) =>
    f.limitations.map((l) => `发现 #${f.findingId}：${l}`),
  );
  notes.push(...limitationLines);

  // ④ 反向证据 / 不稳定 / 弱样本
  const contradicted = view.topFindings.filter((f) => f.stability?.contradicted === true);
  if (contradicted.length > 0) {
    notes.push(`有 ${contradicted.length} 条发现存在**反向证据**（#${contradicted.map((f) => f.findingId).join(", #")}）。`);
  }
  const unstable = view.topFindings.filter((f) => f.stability !== null && f.stability.stable === false);
  if (unstable.length > 0) {
    notes.push(
      `有 ${unstable.length} 条发现在不同切片上方向不稳定（#${unstable.map((f) => f.findingId).join(", #")}）——`
      + "可能只在个别年份 / 板块成立。",
    );
  }
  const conflicted = view.topFindings.filter((f) => f.conflictsWith.length > 0);
  if (conflicted.length > 0) {
    notes.push(`有 ${conflicted.length} 条发现与其它发现相互矛盾（#${conflicted.map((f) => f.findingId).join(", #")}）。`);
  }
  const weak = view.topFindings.filter((f) => f.sampleGrade === "INSUFFICIENT" || f.sampleGrade === "MARGINAL");
  if (weak.length > 0) {
    notes.push(`有 ${weak.length} 条发现的样本量只到「临界/不足」（#${weak.map((f) => f.findingId).join(", #")}）——效应可能只是噪声。`);
  }

  // ⑤ 折叠提示：不让用户以为「第一屏就是全部」
  if (view.hiddenFindingCount > 0) {
    notes.push(`另有 ${view.hiddenFindingCount} 条发现未进第一屏（去重后按强度排序，可在下方展开）。`);
  }
  return notes;
}

/** 「暂不继续」时给出的下一步方向（§29 第 6 步的两个选项之一）。 */
/**
 * 候选筛选条件的**来源方式**的人读标签（纯函数）。
 *
 * 三态必须分开，因为「谁选的」直接影响可信度：
 *   · AUTO    = 系统按「提问点名 → 计划必需项 → 优先级 → 条件分析 → id」挑的；
 *   · EXPLICIT= 调用方（Workbuddy / 高级模式）明确指定的；
 *   · NONE    = 本 Run 没有任何带条件的分析 ⇒ 候选**没有筛选条件**，
 *               这是必须显式警告的状态，不能与「有条件」长得一样。
 */
export function candidateFilterOriginLabelOf(
  origin: CandidateFilterSourceView["origin"],
): string {
  switch (origin) {
    case "AUTO":
      return "系统自动选择";
    case "EXPLICIT":
      return "调用方指定";
    default:
      return "无可用条件";
  }
}

export function nextStepHintOf(stage: RecommendationStage): string {
  switch (stage) {
    case "WORTH_NEXT_STAGE":
      return "可以创建候选（Candidate）——**仍需你人工确认**，且不会自动进入策略。";
    case "NEEDS_MORE_RESEARCH":
      return "建议先补做研究（换分组维度 / 扩大样本区间 / 补对照组），再决定是否创建候选。";
    case "NOT_WORTH_CONTINUING":
      return "建议换一个研究问题，或先确认数据集覆盖是否足够；本轮不必创建候选。";
    default:
      return "";
  }
}
