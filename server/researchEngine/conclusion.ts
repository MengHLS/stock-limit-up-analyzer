/**
 * RESEARCH-002 — ConclusionBuilder（规则型研究结论）。
 *
 * 立场（指令 §14）：
 *   - 自动结论只是**研究辅助**，不等同于统计显著性或交易有效性。所有自动结论必须保存
 *     `evidence`，并在结论正文中**强制带上免责声明**；
 *   - 「Q10 > Q1」这类单点观察**不足以**判定假设成立：必须先过样本门槛、再过最小效应阈值、
 *     再看统计量、最后看方向稳定性；
 *   - 所有阈值**显式写在 `ConclusionPolicy` 里并落入 evidence**，可复核、可调参、可复现；
 *   - 判定不出来就老实说 `INCONCLUSIVE`，不硬凑 `SUPPORTED`。
 *
 * 判定顺序（短路）：
 *   1. 无可用主效应                      → INCONCLUSIVE
 *   2. 样本不足（总样本或最小分组 < 门槛） → INCONCLUSIVE
 *   3. |效应| < materialityAbs           → REJECTED（未观察到有实际意义的系统性差异）
 *   4. 统计未达标（p ≥ alpha 或算不出 p）  → PARTIALLY_SUPPORTED
 *   5. 方向不稳定（一致性 < 阈值）         → INCONCLUSIVE
 *   6. 全部通过                          → SUPPORTED
 */

import type {
  ResearchAnalysisType,
  ResearchConclusionType,
  ResearchExperiment,
  ResearchFindingType,
  ResearchHypothesis,
  ResearchStrengthGrade,
} from "../researchCore";
import type { AnalysisSummary, ResearchConclusionDraft } from "./types";

/** 结论判定策略（全部可覆盖，且会原样写入 evidence）。 */
export interface ConclusionPolicy {
  /** 显著性水平（越大越宽松）。 */
  alpha: number;
  /** 最小**实际**效应阈值（收益口径，单位 = 变量原单位，如 0.005 = 0.5%）。 */
  materialityAbs: number;
  /** 单组最小样本门槛。 */
  minSampleCount: number;
  /** 方向一致性下限（低于即认为跨期/跨组方向不稳定）。 */
  stabilityMinConsistentRatio: number;
  /** 样本达到 `minSampleCount × 该倍数` 时才给样本充分性加分。 */
  strongSampleMultiple: number;
}

export const DEFAULT_CONCLUSION_POLICY: ConclusionPolicy = Object.freeze({
  alpha: 0.05,
  materialityAbs: 0.005,
  minSampleCount: 30,
  stabilityMinConsistentRatio: 0.6,
  strongSampleMultiple: 2,
});

/**
 * 主效应类型优先级（确定性；不按「效应最大」挑，避免选择性报告）。
 *
 * `SEGMENT_RELATION` 排在末位（RESEARCH-004）：它是分档 × 分段的关系研究，
 * 与「单一主效应」的语义最远。放进列表的唯一目的是 —— 当一次 Run 只跑了它时
 * 仍有主分析可用，而不是把所有这类实验都判成「无主分析」。
 */
const PRIMARY_PRIORITY: ResearchAnalysisType[] = [
  "QUANTILE",
  "CONDITIONAL",
  "EVENT_STUDY",
  "STABILITY",
  "SEGMENT_RELATION",
];

const DISCLAIMER =
  "⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；"
  + "任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。";

/**
 * RESEARCH-FINDING-001 §15 —— 结论要引用的 Finding 的**最小只读视图**。
 *
 * 为什么只取这几个字段：结论需要的是「引用了谁 + 谁更值得继续研究 + 谁自带什么局限」，
 * 而不是把整条 Finding 复制进结论（那会造成同一事实两份存储，迟早不一致）。
 * 完整证据仍在 `research_finding`，由 `findingIds` 回溯。
 */
export interface ConclusionFindingInput {
  id: number;
  findingType: ResearchFindingType;
  title: string;
  researchStrength: number | null;
  researchStrengthGrade: ResearchStrengthGrade | null;
  sampleCount: number | null;
  limitations: string[] | null;
  /** 是否被判定为「切片方向明显冲突」（驱动 nextQuestions）。 */
  stabilityContradicted: boolean;
}

export interface ConclusionBuildInput {
  experiment: Pick<ResearchExperiment, "id" | "name" | "researchType">;
  hypothesis?: Pick<ResearchHypothesis, "id" | "name" | "statement"> | null;
  /** 各分析摘要（含 analysisId，便于证据回溯）。 */
  analyses: Array<{ analysisId: number; analysisType: ResearchAnalysisType; summary: AnalysisSummary }>;
  /**
   * RESEARCH-FINDING-001 §15 —— 本次 Run 检出的 Finding。
   *
   * 缺省（`undefined`）= **Finding 层未参与**（例如 Finding 检测被关闭或失败）：
   * 此时结论照旧产出，但 `findingIds` 为空、`evidenceSummary` 如实写明「本次结论不含 Finding 证据」，
   * 且**不允许定稿**。**不允许**用「假装有 Finding」来掩盖这一步缺失。
   */
  findings?: ConclusionFindingInput[];
  /** 研究问题原文（来自假设或显式传入）。 */
  researchQuestion?: string | null;
  policy?: Partial<ConclusionPolicy>;
}

/** 结论构造结果（草稿 + 判定过程）。 */
export interface ConclusionBuildResult {
  draft: ResearchConclusionDraft;
  /** 命中/未命中的判定步骤（供报告与调试）。 */
  trace: Array<{ rule: string; passed: boolean; detail: string }>;
}

function pct(value: number | null, digits = 2): string {
  if (value === null) return "不可用";
  return `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "不可用";
  return value.toFixed(digits);
}

/**
 * 结论证据（**唯一构造入口**）。
 *
 * 为什么必须收敛到一个函数：证据是前端 / 报告 / 审计共同消费的机器可读契约。
 * 早前「无可用主效应」分支与主判定分支各自手写了一个对象字面量，键名与键集**不一致**
 * （前者 `trace` / `analyses`，后者 `ruleTrace` / `contributingAnalyses`），
 * 下游必须写两套解析分支才不会崩。此处统一为同一形状，并用 `primaryAnalysis: null`
 * 表达「本次没有主分析」，而不是让键消失。由 `conclusion.test.ts` 断言两个分支键集相同。
 */
function buildEvidence(input: {
  policy: ConclusionPolicy;
  hypothesisId: number | null;
  hypothesisStatement: string;
  primary: {
    analysisId: number;
    analysisType: ResearchAnalysisType;
    effectLabel: string;
    effect: number | null;
    pValue: number | null;
    tStat: number | null;
    sampleCount: number;
    minGroupSampleCount: number | null;
    groupCount: number | null;
    directionConsistency: number | null;
  } | null;
  analyses: ConclusionBuildInput["analyses"];
  trace: Array<{ rule: string; passed: boolean; detail: string }>;
  confidenceBasis: string;
  // ---- RESEARCH-FINDING-001 §15：结论必须可回溯到 Finding ----
  researchQuestion: string | null;
  findings: readonly ConclusionFindingInput[];
}) {
  return {
    disclaimer: DISCLAIMER,
    policy: input.policy,
    hypothesisId: input.hypothesisId,
    hypothesisStatement: input.hypothesisStatement,
    researchQuestion: input.researchQuestion,
    primaryAnalysis: input.primary,
    primarySelectionRule: `按 ${PRIMARY_PRIORITY.join(" → ")} 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）`,
    contributingAnalyses: input.analyses.map((a) => ({
      analysisId: a.analysisId,
      analysisType: a.analysisType,
      effect: a.summary.effect,
      effectLabel: a.summary.effectLabel,
      pValue: a.summary.pValue,
      sampleCount: a.summary.sampleCount,
      notes: a.summary.notes,
    })),
    ruleTrace: input.trace,
    confidenceBasis: input.confidenceBasis,
    confidenceIsNotPValue: true as const,
    /**
     * §15 Finding 引用。`findingCount = 0` 是**如实**表达「本次结论不建立在任何 Finding 上」，
     * 而不是让键消失 —— 与 `primaryAnalysis: null` 同一纪律（两个分支键集必须一致）。
     */
    findingIds: input.findings.map((f) => f.id),
    findingCount: input.findings.length,
    findings: input.findings.map((f) => ({
      id: f.id,
      findingType: f.findingType,
      title: f.title,
      researchStrength: f.researchStrength,
      researchStrengthGrade: f.researchStrengthGrade,
      sampleCount: f.sampleCount,
      stabilityContradicted: f.stabilityContradicted,
    })),
    /** 结论的局限来源：各 Finding 自带局限的并集（去重）。 */
    findingLimitations: [...new Set(input.findings.flatMap((f) => f.limitations ?? []))],
  };
}

// ---------------------------------------------------------------------------
// §15 结论的三件配套文本（证据摘要 / 局限 / 后续问题）
//
// 为什么单独成函数而不是内联进模板串：这三段是**结论的结构化字段**（落库列），
// 前端与报告会分别渲染；内联进正文会导致「正文与字段两份措辞」逐渐漂移。
// ---------------------------------------------------------------------------

/** 证据摘要（人读；机器可读证据在 `evidence`）。 */
function buildEvidenceSummary(args: {
  findings: readonly ConclusionFindingInput[];
  conclusionType: ResearchConclusionType;
  verdict: string;
}): string {
  const { findings, conclusionType, verdict } = args;
  if (findings.length === 0) {
    return `判定 ${conclusionType}（${verdict}）。本次 Run **未引用任何 Finding** `
      + "（Finding 层未参与或未检出达标发现）—— 结论仅基于 Analysis 层面的统计摘要。";
  }
  const lines = findings
    .slice(0, 8)
    .map(
      (f) =>
        `- Finding #${f.id} [${f.findingType}] ${f.title}`
        + `（研究强度 ${f.researchStrength === null ? "不可评估" : f.researchStrength.toFixed(3)}`
        + `${f.researchStrengthGrade === null ? "" : ` / ${f.researchStrengthGrade}`}，样本 ${f.sampleCount ?? "未知"}）`,
    );
  if (findings.length > 8) lines.push(`- …（另有 ${findings.length - 8} 条，见 findings 面板）`);
  return `判定 ${conclusionType}（${verdict}）。引用 ${findings.length} 条 Finding：\n${lines.join("\n")}`;
}

/** 局限并集（Finding 自带局限 + 结论层局限）。 */
function buildLimitations(findings: readonly ConclusionFindingInput[]): string[] {
  const out = [
    "自动结论为**规则型**研究辅助，不等同于统计显著性，也不构成交易结论。",
    "跨分析未做多重比较校正；事件样本重叠视界使独立性假设不严格成立。",
  ];
  for (const f of findings) for (const l of f.limitations ?? []) out.push(l);
  return [...new Set(out)];
}

/** 后续待答问题（驱动下一轮研究 → 新假设）。 */
function buildNextQuestions(
  findings: readonly ConclusionFindingInput[],
  conclusionType: ResearchConclusionType,
): string[] {
  const out: string[] = [];
  const hasRelation = findings.some((f) =>
    ["MONOTONIC_RELATION", "PEAK_RELATION", "VALLEY_RELATION"].includes(f.findingType),
  );
  if (hasRelation) {
    out.push("对上述分档关系做**门槛 / 条件组合**验证：新建覆盖该区间的 CONDITIONAL 分析，比较单条件与组合条件效应。");
  }
  if (findings.some((f) => f.stabilityContradicted)) {
    out.push("存在方向明显冲突的时间 / 结构切片：复核这些切片的样本构成，并考虑按市场状态分层重做。");
  }
  if (findings.some((f) => f.findingType === "HORIZON_PATTERN")) {
    out.push("按有效视界区间确定持有期假设（Entry / Exit Timing），并在假设中显式登记 target 与 horizon。");
  }
  if (conclusionType === "PARTIALLY_SUPPORTED") {
    out.push("统计强度不足：扩大样本窗口或降低共线性后再复验，不要以当前证据进入策略化。");
  }
  if (conclusionType === "INCONCLUSIVE") {
    out.push("证据不足 / 方向不稳定：先补齐 Data 覆盖与变量缺失，再重跑本实验。");
  }
  if (findings.length === 0) {
    out.push("本次未检出达标发现：检查 analysisDefaults 与变量覆盖是否足以支撑该研究问题。");
  }
  return out;
}

/** 主体判定。 */
export function buildConclusion(input: ConclusionBuildInput): ConclusionBuildResult {
  const policy: ConclusionPolicy = { ...DEFAULT_CONCLUSION_POLICY, ...(input.policy ?? {}) };
  const trace: Array<{ rule: string; passed: boolean; detail: string }> = [];
  /** §15 引用的 Finding（可空）：结论必须能回溯到「哪个发现支撑了它」。 */
  const findings: readonly ConclusionFindingInput[] = input.findings ?? [];
  const researchQuestion = input.researchQuestion ?? null;

  const comparable = input.analyses.filter(
    (a) => a.summary.effect !== null && (a.summary.groupCount === null || a.summary.groupCount >= 2),
  );

  const primary =
    PRIMARY_PRIORITY.map((type) => comparable.find((a) => a.summary.analysisType === type)).find(
      (a): a is NonNullable<typeof a> => a !== undefined,
    ) ?? comparable[0];

  const hypothesisStatement = input.hypothesis?.statement?.trim() || "(未登记假设陈述)";

  // ---- 规则 1：无可用主效应 ----
  if (!primary) {
    trace.push({
      rule: "R1_有可用主效应",
      passed: false,
      detail: `本次 Run 的 ${input.analyses.length} 个分析均未产出可比较的主效应（effect 为 null 或分组数 < 2）`,
    });
    return {
      draft: {
        conclusionType: "INCONCLUSIVE",
        title: `${input.experiment.name} — 自动结论：证据不足`,
        conclusion:
          `假设「${hypothesisStatement}」在本次执行中**无法评估**：没有任何分析产出可比较的主效应`
          + `（通常是样本缺失或分组退化）。建议检查 Dataset 覆盖度与变量缺失率后重跑。\n\n${DISCLAIMER}`,
        evidence: buildEvidence({
          policy,
          hypothesisId: input.hypothesis?.id ?? null,
          hypothesisStatement,
          primary: null,
          analyses: input.analyses,
          trace,
          confidenceBasis: "证据不足（无可用主效应），不计算主观置信度（固定 0）",
          researchQuestion,
          findings,
        }),
        confidence: 0,
        researchQuestion,
        evidenceSummary: buildEvidenceSummary({ findings, conclusionType: "INCONCLUSIVE", verdict: "无法评估" }),
        findingIds: findings.map((f) => f.id),
        limitations: buildLimitations(findings),
        nextQuestions: buildNextQuestions(findings, "INCONCLUSIVE"),
      },
      trace,
    };
  }

  const minGroupSamples = primary.summary.minGroupSampleCount;
  const sampleOk =
    primary.summary.sampleCount >= policy.minSampleCount
    && (minGroupSamples === null || minGroupSamples >= policy.minSampleCount);
  trace.push({
    rule: "R2_样本达标",
    passed: sampleOk,
    detail: `总样本 ${primary.summary.sampleCount}（门槛 ${policy.minSampleCount}），`
      + `最小分组样本 ${minGroupSamples ?? "不适用"}（门槛 ${policy.minSampleCount}）`,
  });

  const effect = primary.summary.effect;
  const materialOk = effect !== null && Math.abs(effect) >= policy.materialityAbs;
  trace.push({
    rule: "R3_效应达到最小实际阈值",
    passed: materialOk,
    detail: `|效应| = ${num(effect === null ? null : Math.abs(effect))}，阈值 ${policy.materialityAbs}`,
  });

  const statOk = primary.summary.pValue !== null && primary.summary.pValue < policy.alpha;
  trace.push({
    rule: "R4_统计量达标",
    passed: statOk,
    detail: `p = ${num(primary.summary.pValue)}，alpha = ${policy.alpha}`
      + (primary.summary.pValue === null ? "（未能计算 p 值，视为未达标）" : ""),
  });

  const stabilitySummary = input.analyses.find((a) => a.summary.analysisType === "STABILITY")?.summary;
  const consistency = primary.summary.directionConsistency ?? stabilitySummary?.directionConsistency ?? null;
  const stabilityOk = consistency === null || consistency >= policy.stabilityMinConsistentRatio;
  trace.push({
    rule: "R5_方向稳定",
    passed: stabilityOk,
    detail: consistency === null
      ? "无方向一致性信息（不构成否决条件）"
      : `一致性 ${num(consistency, 3)}，下限 ${policy.stabilityMinConsistentRatio}`,
  });

  // ---- 判定 ----
  let conclusionType: ResearchConclusionDraft["conclusionType"];
  let verdict: string;
  if (!sampleOk) {
    conclusionType = "INCONCLUSIVE";
    verdict = "**样本不足**：无法做出任何方向性判断";
  } else if (!materialOk) {
    conclusionType = "REJECTED";
    verdict = `**未观察到达到预设最小实际效应的系统性差异**（|效应| < ${policy.materialityAbs}）`;
  } else if (!statOk) {
    conclusionType = "PARTIALLY_SUPPORTED";
    verdict = "**方向一致但统计强度不足**：差异存在方向性，但未能通过预设统计门槛";
  } else if (!stabilityOk) {
    conclusionType = "INCONCLUSIVE";
    verdict = "**方向不稳定**：整体效应达标，但分组/跨期方向一致性过低，不能判定为稳定关系";
  } else {
    conclusionType = "SUPPORTED";
    verdict = "**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）";
  }

  // ---- 主观置信度（**不是 p-value**）----
  const parts: string[] = [];
  let confidence = 0.3;
  parts.push("基础 0.30");
  if (statOk) {
    confidence += 0.25;
    parts.push("+0.25 统计达标");
  }
  if (consistency !== null) {
    confidence += 0.2 * consistency;
    parts.push(`+${num(0.2 * consistency, 3)} 方向一致性 × 0.20`);
  }
  if (primary.summary.sampleCount >= policy.minSampleCount * policy.strongSampleMultiple) {
    confidence += 0.15;
    parts.push("+0.15 样本充裕");
  }
  const signAgreement = signAgreementOf(input.analyses);
  if (signAgreement === 1) {
    confidence += 0.1;
    parts.push("+0.10 各分析方向一致");
  }
  confidence = Math.min(1, Math.max(0, Number(confidence.toFixed(4))));

  const evidence = buildEvidence({
    policy,
    hypothesisId: input.hypothesis?.id ?? null,
    hypothesisStatement,
    primary: {
      analysisId: primary.analysisId,
      analysisType: primary.analysisType,
      effectLabel: primary.summary.effectLabel,
      effect: primary.summary.effect,
      pValue: primary.summary.pValue,
      tStat: primary.summary.tStat,
      sampleCount: primary.summary.sampleCount,
      minGroupSampleCount: primary.summary.minGroupSampleCount,
      groupCount: primary.summary.groupCount,
      directionConsistency: primary.summary.directionConsistency,
    },
    analyses: input.analyses,
    trace,
    confidenceBasis: parts.join("；"),
    researchQuestion,
    findings,
  });

  const numbers =
    `关键量：${primary.summary.effectLabel} = ${num(effect)}；`
    + `p = ${num(primary.summary.pValue)}；t = ${num(primary.summary.tStat)}；`
    + `样本 ${primary.summary.sampleCount}（最小分组 ${minGroupSamples ?? "不适用"}）；`
    + (consistency !== null ? `方向一致性 ${num(consistency, 3)}。` : "");

  const conclusion =
    `假设：「${hypothesisStatement}」\n\n`
    + `判定：${verdict}。\n\n`
    + `${numbers}\n\n`
    + `判定依据（按顺序短路）：\n`
    + trace.map((t, i) => `${i + 1}. [${t.passed ? "通过" : "未通过"}] ${t.rule} —— ${t.detail}`).join("\n")
    + `\n\n${DISCLAIMER}`;

  const draft: ResearchConclusionDraft = {
    conclusionType,
    title: `${input.experiment.name} — 自动结论（${conclusionType}）`,
    conclusion,
    evidence,
    confidence,
  };
  return { draft, trace };
}

/** 各分析主效应方向是否一致（返回 1 / 0 / null）。 */
function signAgreementOf(
  analyses: Array<{ summary: AnalysisSummary }>,
): number | null {
  const signs = analyses
    .map((a) => a.summary.effect)
    .filter((e): e is number => typeof e === "number" && Number.isFinite(e) && e !== 0)
    .map((e) => Math.sign(e));
  if (signs.length === 0) return null;
  const first = signs[0]!;
  return signs.every((s) => s === first) ? 1 : 0;
}

/** 供报告引用：人类可读的策略摘要。 */
export function renderConclusionPolicy(policy: ConclusionPolicy = DEFAULT_CONCLUSION_POLICY): string {
  return `alpha=${policy.alpha}, materialityAbs=${pct(policy.materialityAbs, 2)}, `
    + `minSampleCount=${policy.minSampleCount}, stabilityMinConsistentRatio=${policy.stabilityMinConsistentRatio}`;
}
