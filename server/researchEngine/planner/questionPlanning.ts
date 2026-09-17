/**
 * RESEARCH-PLANNER-001 — 研究问题编排（Question → Experiment → Run → Plan → Analyses）。
 *
 * 这是「用户只填 Dataset + 一句话」这件事的**唯一实现**：
 *   planResearchQuestion()  → 识别意图 → 建 Experiment / Run → 生成并落地 Research Plan（可预览）
 *   materializePlan()       → 把计划里的每条分析**经既有 `createAnalysesBatch` 落库**
 *   （执行仍走既有 `ResearchEngine.run`，本文件不执行任何统计）
 *
 * 四条设计纪律：
 *
 *   1. **复用既有落库路径，不新开第二条**
 *      `materializePlan` 把 `ResearchPlanItem` 转成 `ResearchBatchAnalysisItem` 后交给
 *      `createAnalysesBatch`。于是「从计划建分析」自动继承：预检整批拒绝、执行期部分失败
 *      如实回显、条件写入失败的补偿删除。**不另写一个批量插入**（第二套行为迟早漂移）。
 *
 *   2. **不执行统计**
 *      本文件不调用 Analysis Executor、不算任何数字。它只建「待执行的分析」。
 *      执行仍由 `ResearchEngine.run` 负责（§2.1 不推翻现有 Analysis Engine）。
 *
 *   3. **计划可预览，且预览就是落库的那一份**
 *      不做「预览用一份临时计划、执行时另生成一份」——那样用户确认的东西和真正跑的东西
 *      可以不一致。`createPlan` 落库即预览；`materializePlan` 只把同一份计划物化。
 *
 *   4. **失败不留半成品**
 *      任一步失败都不留下「有 Question 没 Plan」这类残缺对象：本函数按顺序建 Experiment →
 *      Run → Plan，最后才把 question 置为 PLANNED 并回填 planId / runId。
 *      中间失败时 question 停在 DRAFT，用户可安全重试（重试会新建 Experiment，不会污染旧对象）。
 */

import {
  type PlanVariableRole,
  type PlanVariableUse,
  type ResearchAnalysisPriority,
  type ResearchExperiment,
  type ResearchGeneratedBy,
  type ResearchPlan,
  type ResearchPlanItem,
  type ResearchPlanNotes,
  type ResearchPlanSpec,
  type ResearchQuestion,
  type ResearchRepositories,
  type ResearchRun,
} from "../../researchCore";
import {
  RESEARCH_QUESTION_MAX_LENGTH,
  RESEARCH_QUESTION_MIN_LENGTH,
} from "@shared/researchContracts";
import { createAnalysesBatch } from "../batchCreate";
import type { ResearchBatchAnalysisItem, ResearchBatchCreateResult } from "../types";
import { generateAnalysisPlan, type GeneratedAnalysisPlan, type PlanDataFacts } from "./analysisPlan";
import { ResearchPlannerError } from "./errors";
import { describeIntent, detectResearchIntent, type ResearchIntentResult } from "./intent";
import { defaultResearchModuleRegistry, type ResearchModuleRegistry } from "./moduleRegistry";

/**
 * 研究问题的长度边界。
 *
 * 🔴 **单一来源在 `shared/researchContracts.ts`** —— 前端要在提交前拦住过短/过长的问题，
 *    后端也要拦（前端不是可信边界）。这里只是把 shared 常量在本模块内起个别名，
 *    让领域层的错误信息与前端校验共用同一组边界（不再各写一份）。
 */
export const MIN_QUESTION_LENGTH = RESEARCH_QUESTION_MIN_LENGTH;
export const MAX_QUESTION_LENGTH = RESEARCH_QUESTION_MAX_LENGTH;

export interface PlanResearchQuestionInput {
  repos: ResearchRepositories;
  datasetVersionId: number;
  /** 用户原话（**禁改写**）。 */
  questionText: string;
  /** Dataset Version 的真实覆盖事实（由调用方从 reader 取得）。 */
  facts: PlanDataFacts;
  createdBy?: ResearchGeneratedBy;
  maxAnalysisPerPlan?: number;
  /** 计划规模上限（校验用；可注入以便测试）。 */
  registry?: ResearchModuleRegistry;
}

export interface PlanResearchQuestionResult {
  question: ResearchQuestion;
  experiment: ResearchExperiment;
  run: ResearchRun;
  plan: ResearchPlan;
  intent: ResearchIntentResult;
  generated: GeneratedAnalysisPlan;
  /**
   * 正式执行前的**预览**（§18）。
   *
   * 刻意把「核心分析 / 辅助分析 / 探索分析」的条数与清单直接算好返回，
   * 让前端不必自己按 priority 分组（前端分组逻辑 = 第二套口径，迟早与后端不一致）。
   */
  preview: {
    coreCount: number;
    auxiliaryCount: number;
    exploratoryCount: number;
    coreAnalyses: Array<{ name: string; analysisType: string; purpose: string }>;
    auxiliaryAnalyses: Array<{ name: string; analysisType: string; purpose: string }>;
    exploratoryAnalyses: Array<{ name: string; analysisType: string; purpose: string }>;
    plannedCount: number;
    droppedCount: number;
    capApplied: boolean;
    maxAnalysisPerPlan: number;
    unstableModuleCount: number;
    /**
     * §13 / §15 / §18 —— **与用户提问直接相关**的分析名（预览期就能看到）。
     *
     * 只有「用户点明了某个精修维度」（如「回踩深度」）时才非空；否则为空数组，
     * 此时执行后的结论页会如实地回落到「必需项（核心口径）」作为直接证据。
     * 预览期把这件事摊开，用户可以在**花 4 分钟跑之前**确认「系统有没有听清我在问什么」。
     */
    emphasisAnalysisNames: string[];
    /** 该 Dataset 上不可用的能力（人读）。 */
    capabilityNotes: string[];
    /** 数据有效性检查结果（§22）。 */
    dataValidity: {
      passed: boolean;
      checkedCount: number;
      failedCount: number;
      notes: string[];
    };
  };
}

/** 研究问题校验（不通过即具名拒绝；不猜用户想问什么）。 */
export function assertQuestionText(questionText: string): string {
  const text = typeof questionText === "string" ? questionText.trim() : "";
  if (text.length < MIN_QUESTION_LENGTH) {
    throw new ResearchPlannerError(
      "QUESTION_TOO_SHORT",
      `研究问题至少要 ${MIN_QUESTION_LENGTH} 个字（实得 ${text.length}）—— 太短的输入无法定位研究方法，系统不会猜。`,
    );
  }
  if (text.length > MAX_QUESTION_LENGTH) {
    throw new ResearchPlannerError(
      "QUESTION_TOO_LONG",
      `研究问题不能超过 ${MAX_QUESTION_LENGTH} 个字符（实得 ${text.length}）。`,
    );
  }
  return text;
}

/** 由研究问题派生 Experiment 名（保留可读性，不引入第二套命名口径）。 */
export function deriveExperimentName(questionText: string): string {
  const oneLine = questionText.replace(/\s+/g, " ").trim();
  const head = oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 60)}…`;
  return `[自动研究] ${head}`.slice(0, 200);
}

/**
 * Question → Plan 全链路。
 *
 * 返回的 `plan.items` 就是「用户会看到的计划」；`materializePlan` 只把同一份计划物化。
 */
export async function planResearchQuestion(
  input: PlanResearchQuestionInput,
): Promise<PlanResearchQuestionResult> {
  const { repos } = input;
  const questionText = assertQuestionText(input.questionText);
  const registry = input.registry ?? defaultResearchModuleRegistry();

  // ---- 意图识别 ----
  const intent = detectResearchIntent(questionText, registry);
  const secondarySpecs = intent.rankedModules
    .filter((m) => m.moduleKey !== intent.primaryModuleKey)
    .map((m) => registry.get(m.moduleKey))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  // ---- 计划生成（纯函数） ----
  const generated = generateAnalysisPlan({
    primary: intent.primaryModule,
    secondary: secondarySpecs,
    facts: input.facts,
    questionText,
    ...(input.maxAnalysisPerPlan !== undefined ? { maxAnalysisPerPlan: input.maxAnalysisPerPlan } : {}),
  });

  const rationale = [
    `研究方法：${intent.primaryModule.label}（${intent.primaryModuleKey}）`,
    ...describeIntent(intent),
    ...generated.selectionRationale,
  ];

  const notes: ResearchPlanNotes = {
    unresolvedClauses: intent.evidence.unresolvedClauses,
    dropped: generated.dropped,
    conditionReadback: generated.conditionReadback,
    selectionRationale: rationale,
    // §7 —— 结构化登记（由同一份 `generated.items` 推导，不含任何统计结论）。
    spec: buildPlanSpec(generated, input.facts, {
      primary: { key: intent.primaryModuleKey, label: intent.primaryModule.label },
      secondaryKeys: secondarySpecs.map((s) => s.key),
    }),
    // §13 / §15 —— 「用户问的那件事」在计划里的落点（一路带到 Finding / 结论）。
    emphasisAnalysisNames: generated.emphasisAnalysisNames,
  };

  // ---- 落库：Experiment → Run → Plan → Question 回填 ----
  const experiment = await repos.experiments.create({
    datasetVersionId: input.datasetVersionId,
    name: deriveExperimentName(questionText),
    description: questionText,
    researchType: intent.researchType,
    config: {
      parameters: {},
      analysisDefaults: { minSampleCount: intent.primaryModule.minSampleCount },
      tags: ["auto-planned", intent.primaryModuleKey],
      notes: "由 Research Planner 自动创建（用户只输入了研究问题）。",
    },
  });
  if (experiment.id === undefined) {
    throw new ResearchPlannerError("EXPERIMENT_WRITE_FAILED", "实验创建成功但未返回 id，已中止本次规划。");
  }

  const runNo = await repos.runs.nextRunNo(experiment.id);
  const run = await repos.runs.create({
    experimentId: experiment.id,
    runNo,
    config: { analyses: generated.analysisTypes as never },
  });
  if (run.id === undefined) {
    throw new ResearchPlannerError("RUN_WRITE_FAILED", "Run 创建成功但未返回 id，已中止本次规划。");
  }

  /**
   * 🔴 **注册可检验假设** —— 这一步以前缺失，导致 §15「结论必须基于研究问题」实际没落地。
   *
   * 引擎生成结论时读的是 `repos.hypotheses.listByExperiment(...)[0]`，并据此推导
   * `researchQuestion`（`engine.ts`：`hypothesis?.researchQuestion ?? hypothesis?.statement`）。
   * Planner 此前只建 Experiment / Run / Question / Plan，**没有建 Hypothesis**，
   * 于是：
   *   · 结论正文里的假设陈述退化成占位符「(未登记假设陈述)」；
   *   · `research_conclusion.researchQuestion` 落成 **null**；
   *   · §16 给 Candidate 预留的 `sourceHypothesisId` 永远为空。
   * 实测两轮（§27 / §28）拿到的结论正文与「关键量」几乎逐字相同，
   * 正是因为两次都没有假设、也就没有把「问的是什么」传下去。
   *
   * `statement` 一律用**用户原话**（`questionText`），不做改写、不做润色：
   * §21 禁止系统篡改用户的表达，也禁止替用户编一个他没说过的假设。
   * 问题侧的措辞是否够「可检验」，属于用户与研究者的判断，不由程序替他改。
   */
  const primaryTarget = notes.spec?.targetMapping[0]?.variable ?? null;
  const primaryHorizon = notes.spec?.horizons[0] ?? null;
  const hypothesis = await repos.hypotheses.create({
    experimentId: experiment.id,
    runId: run.id,
    // 与 Experiment 同名会让人分不清「实验」和「它的假设」，这里显式区分前缀。
    name: `自动假设：${questionText.slice(0, 40)}${questionText.length > 40 ? "…" : ""}`,
    statement: questionText,
    researchQuestion: questionText,
    ...(primaryTarget !== null ? { target: primaryTarget } : {}),
    ...(primaryHorizon !== null ? { horizon: `T+${primaryHorizon}` } : {}),
    status: "DRAFT",
  });
  if (hypothesis.id === undefined) {
    throw new ResearchPlannerError("HYPOTHESIS_WRITE_FAILED", "假设创建成功但未返回 id，已中止本次规划。");
  }

  const question = await repos.questions.create({
    datasetVersionId: input.datasetVersionId,
    questionText,
    researchType: intent.researchType,
    createdBy: input.createdBy ?? "SYSTEM",
    intent: intent.evidence,
    status: "PLANNED",
    experimentId: experiment.id,
    runId: run.id,
  });
  if (question.id === undefined) {
    throw new ResearchPlannerError("QUESTION_WRITE_FAILED", "研究问题创建成功但未返回 id，已中止本次规划。");
  }

  const plan = await repos.plans.create({
    questionId: question.id,
    experimentId: experiment.id,
    runId: run.id,
    datasetVersionId: input.datasetVersionId,
    moduleKeys: [intent.primaryModuleKey, ...secondarySpecs.map((s) => s.key)],
    items: generated.items,
    plannedCount: generated.items.length,
    materializedCount: 0,
    droppedCount: generated.dropped.length,
    maxAnalysisPerPlan: generated.maxAnalysisPerPlan,
    capApplied: generated.capApplied,
    generatedBy: input.createdBy ?? "SYSTEM",
    notes,
  });

  const updatedQuestion = await repos.questions.update(question.id, { planId: plan.id ?? null });

  return {
    question: updatedQuestion,
    experiment,
    run,
    plan,
    intent,
    generated,
    preview: buildPreview(generated, input.facts, intent.evidence.unresolvedClauses),
  };
}

/** 构造「研究计划预览」（§18 / §22）。 */
export function buildPreview(
  generated: GeneratedAnalysisPlan,
  facts: PlanDataFacts,
  /** 未采纳分句（从 `question.intent.unresolvedClauses` 或 intent 结果取；只用于计数与提示）。 */
  unresolvedClauses: readonly string[],
): PlanResearchQuestionResult["preview"] {
  const bucket = (predicate: (item: ResearchPlanItem) => boolean) =>
    generated.items
      .filter(predicate)
      .map((item) => ({ name: item.name, analysisType: item.analysisType as string, purpose: item.purpose }));

  const capabilityNotes: string[] = [];
  if (facts.observationMaxOffset <= 0) {
    capabilityNotes.push("该 Dataset 没有观察日（post）数据 ⇒ 一切「截至 T+k 是否破位 / 是否缩量」类条件不可用。");
  }
  if (facts.pathHorizons.length === 0) {
    capabilityNotes.push("该 Dataset 没有逐日路径（path）数据 ⇒ 无法计算 T→T+h 收益，只能看区间聚合结果。");
  }
  if (facts.outcomeHorizons.length === 0) {
    capabilityNotes.push("该 Dataset 没有区间聚合（outcome）数据 ⇒ 无法计算区间最大回撤 / 突破标记。");
  }

  // 数据有效性检查（§22）：这里能如实检查的是「每条分析引用的变量是否都在真实覆盖内」。
  // 之所以是「通过」：分析计划生成阶段**已经把不存在的能力直接剔掉**（见 analysisPlan.ts），
  // 因此落进 items 的每一条都是通过校验的；不通过的会出现在 dropped 里并注明原因。
  const failed = generated.dropped.filter((d) => d.reason === "CAPABILITY_MISSING");

  return {
    coreCount: generated.items.filter((i) => i.priority === "P0").length,
    auxiliaryCount: generated.items.filter((i) => i.priority === "P1").length,
    exploratoryCount: generated.items.filter((i) => i.priority === "P2").length,
    coreAnalyses: bucket((i) => i.priority === "P0"),
    auxiliaryAnalyses: bucket((i) => i.priority === "P1"),
    exploratoryAnalyses: bucket((i) => i.priority === "P2"),
    plannedCount: generated.items.length,
    droppedCount: generated.dropped.length,
    capApplied: generated.capApplied,
    maxAnalysisPerPlan: generated.maxAnalysisPerPlan,
    unstableModuleCount: unresolvedClauses.length,
    emphasisAnalysisNames: [...generated.emphasisAnalysisNames],
    capabilityNotes,
    dataValidity: {
      passed: failed.length === 0,
      checkedCount: generated.items.length + generated.dropped.length,
      failedCount: failed.length,
      notes: [
        `已生成 ${generated.items.length} 条分析，引用的变量都已在 Dataset ${facts.datasetVersionId} 的变量目录中登记`
          + `（path 相对日 ${facts.pathHorizons.length > 0 ? `${facts.pathHorizons[0]}..${facts.pathHorizons[facts.pathHorizons.length - 1]}` : "无"}，`
          + `outcome 视界 ${facts.outcomeHorizons.length > 0 ? facts.outcomeHorizons.join("/") : "无"}）。`,
        // 🔴 这句不能省：执行前的检查是**名字级**的。实测反例 —— 某版本登记了 `market_cap`，
        //    但该列在其事件表上 100% 为 NULL，于是「market_cap 分位」这条分析跑完却是零结果。
        //    不把这件事说清楚，用户在预览页就会把「已登记」读成「一定能算出东西」。
        "⚠️ 执行前只能确认「变量已登记」，**不能确认「变量有值」**：特征在该版本上的实际填充率"
          + "要到执行后才能核对。若某条分析最终零结果，结论页会把它单列为「执行完成但零结果」，"
          + "既不算作已验证、也不算作已排除。",
        ...(failed.length > 0
          ? [`另有 ${failed.length} 条分析因数据能力不足**未被生成**（详见 dropped）。`]
          : []),
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// §7 —— Analysis Plan 的结构化登记（由 items 确定性推导；零 IO、零统计）
// ---------------------------------------------------------------------------

/** 分组维度 → 中文标签（**只翻译既有的六个维度**，不新增维度口径）。 */
const PLAN_DIMENSION_LABELS: Record<string, string> = {
  year: "年份",
  month: "月份",
  quarter: "季度",
  board: "板块",
  market: "市场环境",
  industry: "行业",
};

/** 角色的规范顺序（保证同一份计划每次输出的顺序一致）。 */
const PLAN_ROLE_ORDER: readonly PlanVariableRole[] = ["condition", "grouping", "descriptive", "target"];

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function asNumberArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
}
function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
/** 从 `future_return_5d` / `max_drawdown_20d` 这类结果变量名取视界；取不到返回 null（不猜）。 */
function horizonOfVariable(variable: string): number | null {
  const m = /_(\d+)d$/.exec(variable);
  return m === null ? null : Number(m[1]);
}
/** 条件值的人读形式（数组 / 标量都能显示；不改变值本身）。 */
function formatPlanValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => String(x)).join(", ")}]`;
  return String(v);
}

interface PlanVariableAccumulator {
  roles: Set<PlanVariableRole>;
  analysisCount: number;
  readbacks: Set<string>;
  horizons: Set<number>;
}

/**
 * §7 —— 从计划项推导「Analysis Plan 结构化登记」。
 *
 * 只登记 `items` 里**真的有**的东西：所有分支都基于计划项自己的字段
 * （`conditions[].fieldName` / `config.featureField` / `config.targetField` /
 * `config.variables` / `config.stabilityDimension` / `config.windowA|windowB`），
 * 不读数据库、不做统计、不推测意图。
 *
 * 未列举到的分析类型走 `default` 分支做**通用收割**（`targetField` / `featureField` /
 * `variables`）—— 于是以后新增分析类型时，这份登记不会静默漏掉它的变量
 * （漏掉比多登记更危险：预览会显示成「这条分析什么都没用」）。
 */
export function buildPlanSpec(
  generated: GeneratedAnalysisPlan,
  facts: PlanDataFacts,
  modules: { primary: { key: string; label: string }; secondaryKeys: readonly string[] },
): ResearchPlanSpec {
  const featureAcc = new Map<string, PlanVariableAccumulator>();
  const targetAcc = new Map<string, PlanVariableAccumulator>();

  function bump(
    acc: Map<string, PlanVariableAccumulator>,
    variable: string | null,
    role: PlanVariableRole,
    readbacks: readonly string[] = [],
  ): void {
    if (variable === null) return;
    const name = variable.trim();
    if (name.length === 0) return;
    let entry = acc.get(name);
    if (entry === undefined) {
      entry = { roles: new Set(), analysisCount: 0, readbacks: new Set(), horizons: new Set() };
      acc.set(name, entry);
    }
    entry.roles.add(role);
    entry.analysisCount += 1;
    for (const r of readbacks) entry.readbacks.add(r);
    if (role === "target") {
      const h = horizonOfVariable(name);
      if (h !== null) entry.horizons.add(h);
    }
  }

  const readbackByField = new Map<string, string[]>();
  for (const r of generated.conditionReadback) {
    const list = readbackByField.get(r.fieldName) ?? [];
    list.push(r.readback);
    readbackByField.set(r.fieldName, list);
  }

  const segments: ResearchPlanSpec["segments"] = [];
  const stabilityPlan: ResearchPlanSpec["stabilityPlan"] = [];
  const interactionPlan: ResearchPlanSpec["interactionPlan"] = [];
  const condition: ResearchPlanSpec["condition"] = [];
  const horizonSet = new Set<number>();
  let baseline: ResearchPlanSpec["baseline"] = null;

  for (const item of generated.items) {
    const config = asRecord(item.config);

    // 通用收割：先按 config 里公认的三个键登记，再按分析类型补细分角色。
    // 这样「新增分析类型忘了写分支」的后果只是角色不够细，而不是变量整个消失。
    bump(targetAcc, asString(config["targetField"]) ?? asString(item.target), "target");

    switch (item.analysisType) {
      case "EVENT_STUDY": {
        const horizons = asNumberArray(config["horizons"]);
        for (const h of horizons) horizonSet.add(h);
        // 无条件事件研究 = 基准。只取第一条，保证同输入同输出（计划里也只会有一条）。
        baseline ??= {
          analysisName: item.name,
          horizons,
          note:
            "全样本无条件事件研究 —— 判断「某条件下是否更好」的参照系；"
            + "没有它就无法区分「条件起了作用」与「这段时间整体就好」。",
        };
        break;
      }
      case "CONDITIONAL": {
        const expressions: string[] = [];
        const readbacks = new Set<string>();
        for (const c of item.conditions ?? []) {
          const hits = readbackByField.get(c.fieldName) ?? [];
          bump(featureAcc, c.fieldName, "condition", hits);
          expressions.push(`${c.fieldName} ${c.operator} ${formatPlanValue(c.value)}`);
          for (const r of hits) readbacks.add(r);
        }
        if (item.priority === "P0") {
          condition.push({ analysisName: item.name, expressions, readbacks: [...readbacks] });
        }
        break;
      }
      case "QUANTILE": {
        bump(featureAcc, asString(config["featureField"]), "grouping");
        break;
      }
      case "DESCRIPTIVE": {
        for (const v of asStringArray(config["variables"])) bump(featureAcc, v, "descriptive");
        break;
      }
      case "STABILITY": {
        const dim = asString(config["stabilityDimension"]);
        if (dim !== null) {
          bump(featureAcc, dim, "grouping");
          stabilityPlan.push({
            dimension: dim,
            dimensionLabel: PLAN_DIMENSION_LABELS[dim] ?? dim,
            analysisName: item.name,
          });
        }
        break;
      }
      case "SEGMENT_RELATION": {
        const windowA = asNumberArray(config["windowA"]);
        const windowB = asNumberArray(config["windowB"]);
        const windowAStat = asString(config["windowAStat"]) ?? "-";
        const windowBStat = asString(config["windowBStat"]) ?? "-";
        segments.push({ analysisName: item.name, windowA, windowB, windowAStat, windowBStat });
        interactionPlan.push({
          analysisName: item.name,
          analysisType: item.analysisType,
          description:
            `分段关系：A 窗 T+${windowA[0] ?? "?"}..T+${windowA[1] ?? "?"} 的「${windowAStat}」`
            + ` ↔ B 窗 T+${windowB[0] ?? "?"}..T+${windowB[1] ?? "?"} 的「${windowBStat}」`
            + `（两窗不重叠，因此不是同义反复）。`,
        });
        break;
      }
      default: {
        // 通用收割：让新分析类型至少不丢变量归属。
        bump(featureAcc, asString(config["featureField"]), "grouping");
        for (const v of asStringArray(config["variables"])) bump(featureAcc, v, "descriptive");
        break;
      }
    }
  }

  // QUANTILE 的 featureField 同时也是「分位分档」的结果侧对照 —— 这里不进 targetMapping：
  // 它确实是特征（T 日可观测），角色的定义不因分析类型而变。

  const toUseList = (acc: Map<string, PlanVariableAccumulator>): PlanVariableUse[] =>
    [...acc.entries()]
      .map(([variable, a]) => ({
        variable,
        roles: PLAN_ROLE_ORDER.filter((r) => a.roles.has(r)),
        analysisCount: a.analysisCount,
        readbacks: [...a.readbacks].sort(),
        horizons: [...a.horizons].sort((x, y) => x - y),
      }))
      .sort((a, b) => (a.variable < b.variable ? -1 : a.variable > b.variable ? 1 : 0));

  return {
    researchModule: {
      primary: modules.primary.key,
      primaryLabel: modules.primary.label,
      secondary: [...modules.secondaryKeys],
    },
    datasetVersionId: facts.datasetVersionId,
    analysisTypes: [...generated.analysisTypes].sort(),
    featureMapping: toUseList(featureAcc),
    targetMapping: toUseList(targetAcc),
    horizons: [...horizonSet].sort((a, b) => a - b),
    segments,
    baseline,
    condition,
    stabilityPlan,
    interactionPlan,
  };
}

// ---------------------------------------------------------------------------
// 计划物化（Plan → 真实 Analysis 行）
// ---------------------------------------------------------------------------

export interface MaterializePlanResult {
  planId: number;
  runId: number;
  /** 是否为幂等重放（计划已 MATERIALIZED / EXECUTED，直接返回既有物化结果）。 */
  alreadyMaterialized: boolean;
  created: ResearchBatchCreateResult["created"];
  failed: ResearchBatchCreateResult["failed"];
  createdCount: number;
  failedCount: number;
}

/** 计划项 → 批量创建项（同一落库路径的入参形态）。 */
export function planItemsToBatchItems(
  items: readonly ResearchPlanItem[],
  planId: number,
): ResearchBatchAnalysisItem[] {
  return items.map((item) => ({
    analysisType: item.analysisType,
    name: item.name,
    target: item.target ?? null,
    config: item.config,
    planId,
    moduleKey: item.moduleKey,
    priority: item.priority,
    purpose: item.purpose,
    requiredFlag: item.required,
    ...(item.conditions !== undefined && item.conditions.length > 0
      ? {
          conditions: item.conditions.map((c) => ({
            groupNo: c.groupNo,
            sortOrder: c.sortOrder,
            fieldName: c.fieldName,
            operator: c.operator as string,
            value: c.value,
            logicalOperator: c.logicalOperator as string,
            groupLogicalOperator: c.groupLogicalOperator as string,
          })),
        }
      : {}),
  }));
}

/**
 * 把计划落成真实的 `research_analysis` 行。
 *
 * 幂等：计划已是 MATERIALIZED / EXECUTED 时**不重复建分析**，直接返回该计划下已存在的
 * 分析清单（按 planId 查 `repos.analyses.list({ planId })`）。
 * 理由：网络重试、用户连点两次「开始研究」都不应该把 30 条分析变成 60 条。
 *
 * ⚠️ 执行本函数的**前提**是该 Run 处于 PENDING。若 Run 已经执行过（COMPLETED），
 * 新增的分析拿不到结果 → 应走既有 `runIncremental` 补跑。本函数不自动执行任何分析。
 */
export async function materializePlan(
  repos: ResearchRepositories,
  planId: number,
): Promise<MaterializePlanResult> {
  const plan = await repos.plans.getById(planId);
  if (plan === undefined) {
    throw new ResearchPlannerError("PLAN_NOT_FOUND", `未找到研究计划：${planId}`);
  }
  if (plan.runId === null || plan.runId === undefined) {
    throw new ResearchPlannerError(
      "PLAN_RUN_MISSING",
      `研究计划 ${planId} 没有绑定 Run，无法物化分析。`,
    );
  }

  if (plan.status === "MATERIALIZED" || plan.status === "EXECUTED") {
    const existing = await repos.analyses.list({ planId });
    return {
      planId,
      runId: plan.runId,
      alreadyMaterialized: true,
      created: existing.map((a) => ({
        index: 0,
        analysisId: a.id!,
        analysisType: a.analysisType,
        name: a.name,
      })),
      failed: [],
      createdCount: existing.length,
      failedCount: 0,
    };
  }

  const items = planItemsToBatchItems(plan.items, planId);
  const result = await createAnalysesBatch(repos, plan.runId, items);

  await repos.plans.update(planId, {
    // 部分失败时计划仍是 MATERIALIZED：`failed` 已如实回显，用户可重试（幂等分支会跳过已建项）。
    status: "MATERIALIZED",
    materializedCount: result.createdCount,
  });

  return {
    planId,
    runId: plan.runId,
    alreadyMaterialized: false,
    created: result.created,
    failed: result.failed,
    createdCount: result.createdCount,
    failedCount: result.failedCount,
  };
}
