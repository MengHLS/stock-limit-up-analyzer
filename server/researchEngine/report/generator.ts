/**
 * PHASE-A-001 —— Research Report Generator（**纯投影层**）。
 *
 * ============================================================================
 * 🔴 本文件最重要的技术边界（任务书 §2.2 / §13）
 * ============================================================================
 *
 * 允许：
 *
 *     Result / Finding / Conclusion / Run metadata / Analysis metadata / Dataset metadata
 *             ↓
 *     Report Generator（= 本文件）
 *             ↓
 *     markdown 正文 + metadata + checksum
 *
 * 禁止（本文件**一律不做**）：
 *
 *     Report Generator → 重新查询原始股票数据 → 重新计算收益 → 重新计算条件统计 → 重新计算 Finding
 *
 * 保证手段（可机械复核，不必读完全文）：
 *   1. 本文件**不 import** 任何 Repository、datasetReader、engine、metrics、analyses/*；
 *   2. 唯一输入是 `ResearchReportSource` —— 一个已落库数据的只读快照（见 `types.ts`）；
 *   3. 全文只有字符串拼接与 `JSON.stringify`，**没有任何算术运算**（除统计计数用 `.length`）；
 *   4. `buildResearchReport` 是纯函数：同输入 ⇒ 同输出（含 checksum），不读时钟、不读环境变量。
 *
 * 内容纪律（§13）：
 *   - 不产出「最佳参数 / 策略推荐 / 收益承诺 / 买卖建议」；
 *   - 指标一律用 `metricCode` **原文**，不做「胜率」之类的业务化改名
 *     （`WIN_RATE` 是数据库里的机器码，不是本报告给它的名字）；
 *   - 结论的 `policy` 与 `disclaimer` **原样引用** `research_conclusion.evidenceJson`，
 *     不重写、不删除、不替换成生成器自己的措辞；
 *   - 取不到的溯源字段如实置空并记入 `unresolvedTraceFields`，**禁止为凑格式编造**。
 */

import { createHash } from "node:crypto";
import { FINDING_DISCLAIMER } from "../../researchCore/findings";
import { renderConclusionPolicy, type ConclusionPolicy } from "../conclusion";
import {
  REPORT_CHECKSUM_SCOPE,
  REPORT_FORMAT,
  REPORT_GENERATOR_VERSION,
  REPORT_MEDIA_TYPE,
  type ResearchReportDraft,
  type ResearchReportMetadata,
  type ResearchReportPayload,
  type ResearchReportSource,
} from "./types";

// ---------------------------------------------------------------------------
// 通用格式化（全部为「原样呈现」，不做数值变换）
// ---------------------------------------------------------------------------

const EMPTY = "—";

/** 空值 → `—`；其余原样。 */
function text(value: unknown): string {
  if (value === null || value === undefined) return EMPTY;
  const s = typeof value === "string" ? value : String(value);
  return s.length === 0 ? EMPTY : s;
}

/**
 * 数值原样输出。
 *
 * 🔴 **不做任何数值变换**（§6.3「不要改变原始数值」）：不四舍五入、不做单位换算、不补 0。
 * `String(0.0001234)` 就是它落库时的字面量；这是报告与 `research_result` 对得上账的前提。
 */
function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  if (!Number.isFinite(value)) return String(value);
  return String(value);
}

/** 百分比仅用于**阈值类**配置展示（policy），且由 `renderConclusionPolicy` 负责；此处不参与指标展示。 */
function ratio(value: number | null | undefined): string {
  return num(value);
}

/**
 * 对象 → 稳定的紧凑 JSON。
 *
 * 为什么必须**递归排序键**：本函数的输出进了 markdown 正文，而正文参与 checksum。
 * 若键序随 JSON 解析/序列化实现漂移，同一份数据会算出两个 checksum，
 * 幂等验收（A-2）就会变成偶发失败。
 */
function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    if (seen.has(node as object)) return "[Circular]";
    seen.add(node as object);
    if (Array.isArray(node)) return node.map(normalize);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
      out[key] = normalize((node as Record<string, unknown>)[key]);
    }
    return out;
  };
  try {
    return JSON.stringify(normalize(value)) ?? String(value);
  } catch {
    return String(value);
  }
}

function compactJson(value: unknown, maxLength = 0): string {
  if (value === null || value === undefined) return EMPTY;
  const json = stableJson(value);
  if (json === "{}" || json === "[]" || json.length === 0) return EMPTY;
  if (maxLength > 0 && json.length > maxLength) {
    return `${json.slice(0, maxLength)}…（已截断，完整内容见原表字段）`;
  }
  return json;
}

/** markdown 表格单元格转义（管道符与换行会破坏表结构）。 */
function cell(value: unknown): string {
  const s = text(value);
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function table(headers: string[], rows: Array<Array<unknown>>): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

function bullets(items: readonly string[], emptyText = "（无）"): string {
  if (items.length === 0) return emptyText;
  return items.map((i) => `- ${i}`).join("\n");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickNumber(source: Record<string, unknown> | null, key: string): number | null {
  if (!source) return null;
  const v = source[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// 正文渲染
// ---------------------------------------------------------------------------

const REPORT_HEADER_NOTE = [
  "> **本报告是既有 Research 结果的展示层投影（PHASE-A-001）。**",
  "> 全部数值直接引自 `research_result` / `research_finding` / `research_conclusion`，",
  "> 生成过程**未重新查询原始行情、未重算收益或条件统计、未重算 Finding**。",
  "> 报告不包含最佳参数、策略推荐、收益承诺或买卖建议；",
  "> 指标名称一律使用 `metricCode` 原文，不做业务化改名。",
].join("\n");

function renderBasicInfo(source: ResearchReportSource): string {
  const { experiment, run, dataset, patterns, conclusion } = source;
  const snapshot = asRecord(run.inputSnapshot);
  const snapshotAt = snapshot ? snapshot["snapshotAt"] : null;
  const snapshotDatasetVersionId = snapshot ? snapshot["datasetVersionId"] : null;

  const patternText =
    patterns.length === 0
      ? "（无法确定：Run 下分析的 `moduleKey` 未能反查到交易模式声明）"
      : patterns.map((p) => `${p.patternId}（${p.label}）`).join("、");

  const rows: Array<[string, string]> = [
    ["Report", "Research Report（`artifactType = REPORT`）"],
    ["Experiment", `#${experiment.id ?? EMPTY} · ${text(experiment.name)}`],
    ["研究类型", text(experiment.researchType)],
    ["Run", `#${run.runNo}（runId=${run.id}）· 状态 ${text(run.status)}`],
    [
      "Dataset Version",
      dataset
        ? `${dataset.datasetName}（${dataset.datasetCode}）· ${dataset.versionLabel}（datasetVersionId=${dataset.datasetVersionId}）`
        : `datasetVersionId=${text(experiment.datasetVersionId)}（版本上下文不可达，未取到名称/区间）`,
    ],
    [
      "Dataset 覆盖",
      dataset ? `${text(dataset.startDate)} ~ ${text(dataset.endDate)} · 事件 ${num(dataset.totalEvents)}` : EMPTY,
    ],
    ["Run 样本量", num(run.sampleCount)],
    ["Run 完成时间", text(run.completedAt)],
    ["数据快照时间", text(snapshotAt)],
    ["快照 Dataset Version", num(typeof snapshotDatasetVersionId === "number" ? snapshotDatasetVersionId : null)],
    ["Pattern", patternText],
    ["结论归属", conclusion ? `#${conclusion.id ?? EMPTY}（${text(conclusion.conclusionType)}）` : "（本 Run 未解析出归属结论）"],
    ["Generator Version", REPORT_GENERATOR_VERSION],
  ];

  return table(["项", "值"], rows);
}

function renderAnalysisSection(source: ResearchReportSource): string {
  const { analyses, resultsByAnalysisId } = source;
  if (analyses.length === 0) {
    return "本 Run 下**没有任何 Analysis** —— 这不是「没跑出结果」，而是「没有可执行的分析定义」。";
  }

  const rows = analyses.map((a) => {
    const resultCount = (resultsByAnalysisId.get(a.id ?? -1) ?? []).length;
    return [
      `#${a.id ?? EMPTY}`,
      a.analysisType,
      text(a.moduleKey),
      text(a.status),
      text(a.target),
      text(a.priority),
      resultCount,
      compactJson(a.config, 200),
    ];
  });

  const purposeLines = analyses
    .filter((a) => typeof a.purpose === "string" && a.purpose.trim().length > 0)
    .map((a) => `- #${a.id ?? EMPTY}：${a.purpose}`);

  return [
    `共 **${analyses.length}** 条分析（全部来自 \`research_analysis\`，未凭空生成）。`,
    "",
    table(
      ["analysisId", "类型", "Module", "状态", "目标(target)", "优先级", "结果行", "主要配置摘要"],
      rows,
    ),
    ...(purposeLines.length > 0 ? ["", "**分析意图（`purpose` 原文）**", "", ...purposeLines] : []),
  ].join("\n");
}

function renderResultSection(source: ResearchReportSource): string {
  const { analyses, resultsByAnalysisId } = source;
  const total = analyses.reduce((sum, a) => sum + (resultsByAnalysisId.get(a.id ?? -1) ?? []).length, 0);

  const summaryRows = analyses.map((a) => {
    const rows = resultsByAnalysisId.get(a.id ?? -1) ?? [];
    const types = Array.from(new Set(rows.map((r) => r.resultType))).sort();
    return [`#${a.id ?? EMPTY}`, a.name, rows.length, types.length > 0 ? types.join("/") : EMPTY];
  });

  const blocks = analyses.map((a) => {
    const rows = resultsByAnalysisId.get(a.id ?? -1) ?? [];
    if (rows.length === 0) {
      return [
        `#### #${a.id ?? EMPTY} · ${a.name}（${a.analysisType}）`,
        "",
        "（该分析在 `research_result` 中**没有结果行** —— 可能是未执行、执行失败或结果已被口径变更失效。此处不补任何数值。）",
      ].join("\n");
    }
    const body = table(
      ["resultId", "metricCode", "类型", "维度", "值", "样本量", "明细"],
      rows.map((r) => [
        `#${r.id ?? EMPTY}`,
        r.metricCode,
        r.resultType,
        compactJson(r.dimension),
        num(r.metricValue),
        num(r.sampleCount),
        compactJson(r.details, 300),
      ]),
    );
    return [`#### #${a.id ?? EMPTY} · ${a.name}（${a.analysisType}）`, "", body].join("\n");
  });

  return [
    `共 **${total}** 行结果（全部来自 \`research_result\`，**原样引用**：不重算、不换算、不补 0）。`,
    "",
    "**逐分析结果行数**",
    "",
    table(["analysisId", "分析名", "结果行", "结果形态"], summaryRows),
    "",
    "**结果明细**",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function renderFindingSection(source: ResearchReportSource): string {
  const { findings } = source;
  if (findings.length === 0) {
    return [
      "本 Run 下**没有 Finding**。",
      "",
      "⚠️ 「没有发现」是**合法且必须如实展示**的结果（任务书 §27）：Finding 层只消费已落库的 Result，",
      "查不到符合判定策略的模式时就不产出 Finding。此处不为了报告好看而补齐任何条目。",
    ].join("\n");
  }

  const overview = table(
    [
      "findingId",
      "类型",
      "目标",
      "效应(groupReturn)",
      "样本",
      "视界峰值",
      "稳定性",
      "单调性",
      "交互",
      "研究强度",
    ],
    findings.map((f) => {
      const sample = f.sample ?? null;
      const horizon = f.horizon ?? null;
      const stability = f.stability ?? null;
      const monotonicity = f.monotonicity ?? null;
      const interaction = f.interaction ?? null;
      return [
        `#${f.id ?? EMPTY}`,
        f.findingType,
        text(f.target),
        num(f.effect?.groupReturn ?? null),
        sample ? `${num(sample.sampleCount)}（${sample.grade}）` : EMPTY,
        horizon ? num(horizon.peakHorizon) : EMPTY,
        stability ? `${stability.stable ? "稳定" : "不稳定"}${stability.contradicted ? "·有冲突" : ""}` : EMPTY,
        monotonicity ? monotonicity.pattern : EMPTY,
        interaction ? (interaction.tested ? `已测试(${num(interaction.combinedEffect)})` : "未测试") : EMPTY,
        f.researchStrength === null || f.researchStrength === undefined
          ? EMPTY
          : `${num(f.researchStrength)}（${text(f.researchStrengthGrade)}）`,
      ];
    }),
  );

  const details = findings.map((f) => {
    const lines: string[] = [];
    lines.push(`### #${f.id ?? EMPTY} · ${f.title}`);
    lines.push("");
    lines.push(
      `- 类型 / 状态：\`${f.findingType}\` / \`${text(f.status)}\`；目标变量：\`${text(f.target)}\``,
    );
    if (f.summary) lines.push(`- 摘要：${f.summary}`);
    lines.push(`- 分析维度：${compactJson(f.dimension)}`);
    lines.push(
      `- provenance：primaryAnalysisId=${num(f.primaryAnalysisId ?? null)}；sourceResultIds=${compactJson(
        f.sourceResultIds ?? null,
      )}`,
    );

    if (f.effect) {
      lines.push(
        `- 效应：groupReturn=${num(f.effect.groupReturn)}；benchmarkReturn=${num(
          f.effect.benchmarkReturn,
        )}；excessReturn=${num(f.effect.excessReturn)}；medianReturn=${num(f.effect.medianReturn)}；winRate=${num(
          f.effect.winRate,
        )}；基准可用=${f.effect.benchmarkUnavailable ? "否" : "是"}（来源 ${f.effect.benchmarkSource}）`,
      );
      if (f.effect.buckets.length > 0) {
        lines.push(
          `  - 分组明细：${f.effect.buckets
            .map((b) => `${b.label}=${num(b.metricValue)}（n=${num(b.sampleCount)}）`)
            .join("；")}`,
        );
      }
    }
    if (f.sample) {
      lines.push(
        `- 样本充分性：${num(f.sample.sampleCount)}（${f.sample.grade}）；阈值快照 weak=${num(
          f.sample.thresholds.weak,
        )} / medium=${num(f.sample.thresholds.medium)} / strong=${num(f.sample.thresholds.strong)}`,
      );
    }
    if (f.horizon) {
      lines.push(
        `- 视界一致性：峰值=${num(f.horizon.peakHorizon)}；有效区间=${
          f.horizon.effectiveHorizonRange
            ? `[${num(f.horizon.effectiveHorizonRange[0])}, ${num(f.horizon.effectiveHorizonRange[1])}]`
            : EMPTY
        }；方向一致性=${num(f.horizon.directionConsistency)}`,
      );
      if (f.horizon.points.length > 0) {
        lines.push(
          `  - 逐视界：${f.horizon.points
            .map((p) => `${num(p.horizon)}=${num(p.metricValue)}（n=${num(p.sampleCount)}）`)
            .join("；")}`,
        );
      }
    }
    if (f.stability) {
      lines.push(
        `- 时间稳定性：维度=${f.stability.dimensionKey}；稳定=${f.stability.stable ? "是" : "否"}；冲突=${f.stability.contradicted ? "是" : "否"}；一致性=${ratio(f.stability.consistentRatio)}`,
      );
      if (f.stability.slices.length > 0) {
        lines.push(
          `  - 切片：${f.stability.slices
            .map((s) => `${s.label}=${num(s.metricValue)}（n=${num(s.sampleCount)}）`)
            .join("；")}`,
        );
      }
    }
    if (f.monotonicity) {
      lines.push(
        `- 单调性：pattern=${f.monotonicity.pattern}；反转点=${text(f.monotonicity.reversalAt)}；秩相关=${num(f.monotonicity.rankCorrelation)}`,
      );
      if (f.monotonicity.buckets.length > 0) {
        lines.push(`  - 档位：${f.monotonicity.buckets.map((b) => `${b.label}=${num(b.metricValue)}`).join("；")}`);
      }
    }
    if (f.interaction) {
      lines.push(
        `- 交互：组合 Finding=${compactJson(f.interaction.findingIds)}；singleEffect=${num(
          f.interaction.singleEffect,
        )}；combinedEffect=${num(f.interaction.combinedEffect)}；已测试=${f.interaction.tested ? "是" : "否"}${
          f.interaction.tested ? "" : `（原因：${text(f.interaction.untestedReason)}）`
        }`,
      );
      lines.push(`  - 组合条件：${compactJson(f.interaction.combinedConditions, 600)}`);
    }
    lines.push(
      `- 五维研究强度：effect=${num(f.effectStrength)}；sample=${num(f.sampleStrength)}；stability=${num(
        f.stabilityStrength,
      )}；horizonConsistency=${num(f.horizonConsistency)}；monotonicity=${num(f.monotonicityStrength)}；综合=${num(
        f.researchStrength,
      )}（${text(f.researchStrengthGrade)}）`,
    );
    const limitations = asStringArray(f.limitations);
    if (limitations.length > 0) lines.push(`- 局限：\n${limitations.map((l) => `  - ${l}`).join("\n")}`);
    return lines.join("\n");
  });

  return [
    `共 **${findings.length}** 条 Finding（全部来自 \`research_finding\`）。`,
    "",
    "**发现总览**",
    "",
    overview,
    "",
    "**发现明细**",
    "",
    details.join("\n\n"),
  ].join("\n");
}

/**
 * 渲染结论策略。
 *
 * 为什么不用 `JSON.stringify` 了事：`renderConclusionPolicy`（`conclusion.ts`）是**系统既有的**
 * policy 渲染口径（也是前端「策略口径」展示用的同一函数），报告复用它才能保证
 * 「前端看到的阈值」与「报告里的阈值」逐字一致。
 *
 * 取不到完整五元组时**退回原文 JSON**，而不是用 `Number(undefined) → NaN` 拼出一行
 * 看起来像真的、实际是垃圾的阈值 —— 那是比缺失更坏的失真。
 */
function renderPolicyText(policy: Record<string, unknown>): string {
  const alpha = pickNumber(policy, "alpha");
  const materialityAbs = pickNumber(policy, "materialityAbs");
  const minSampleCount = pickNumber(policy, "minSampleCount");
  const stabilityMinConsistentRatio = pickNumber(policy, "stabilityMinConsistentRatio");
  const strongSampleMultiple = pickNumber(policy, "strongSampleMultiple");
  if (
    alpha === null ||
    materialityAbs === null ||
    minSampleCount === null ||
    stabilityMinConsistentRatio === null ||
    strongSampleMultiple === null
  ) {
    return `（policy 不完整，原文：${compactJson(policy)}）`;
  }
  const complete: ConclusionPolicy = {
    alpha,
    materialityAbs,
    minSampleCount,
    stabilityMinConsistentRatio,
    strongSampleMultiple,
  };
  return renderConclusionPolicy(complete);
}

function renderConclusionSection(source: ResearchReportSource): string {
  const { conclusion, conclusionResolution } = source;
  if (!conclusion) {
    return [
      "本 Run **未解析出归属结论**（`research_conclusion` 无 `runId` 列，只能经",
      "`evidence.primaryAnalysis.analysisId → research_analysis.runId` 两跳解析）。",
      "",
      `- 解析说明：${text(conclusionResolution)}`,
      "",
      "🔴 按纪律，此处**不用「实验下最新结论」冒充**本 Run 的结论 —— 那样会把另一条 Run 的判断",
      "挂到本 Run 名下。请检查该实验的结论是否由其它 Run 产出。",
    ].join("\n");
  }

  const evidence = asRecord(conclusion.evidence);
  const policy = asRecord(evidence ? evidence["policy"] : null);
  const disclaimer = evidence ? evidence["disclaimer"] : null;
  const primary = asRecord(evidence ? evidence["primaryAnalysis"] : null);
  const contributing = Array.isArray(evidence ? evidence["contributingAnalyses"] : null)
    ? (evidence!["contributingAnalyses"] as unknown[])
    : [];
  const ruleTrace = Array.isArray(evidence ? evidence["ruleTrace"] : null)
    ? (evidence!["ruleTrace"] as unknown[])
    : [];

  const lines: string[] = [];
  lines.push(
    `- 结论 id / 类型 / 状态：#${conclusion.id ?? EMPTY} · \`${conclusion.conclusionType}\` · \`${conclusion.status}\``,
  );
  lines.push(`- 标题：${conclusion.title}`);
  lines.push(
    `- 置信度：${num(conclusion.confidence)}（**主观置信度 [0,1]，不是 p-value**）`,
  );
  lines.push(`- 研究问题（原文）：${text(conclusion.researchQuestion)}`);
  lines.push("");
  lines.push("**结论正文（`research_conclusion.conclusion` 原文）**");
  lines.push("");
  lines.push(conclusion.conclusion);
  lines.push("");
  lines.push(`**证据摘要（人读）**：${text(conclusion.evidenceSummary)}`);
  lines.push("");
  lines.push(`**引用的 Finding id**：${compactJson(conclusion.findingIds ?? null)}`);
  lines.push("");
  lines.push("**机器可读证据（`evidenceJson` 的结构化要点）**");
  lines.push("");
  lines.push(
    `- 主分析：${
      primary
        ? `analysisId=${num(pickNumber(primary, "analysisId"))}，类型=${text(
            primary["analysisType"],
          )}，效应=${num(pickNumber(primary, "effect"))}，p=${num(pickNumber(primary, "pValue"))}，样本=${num(
            pickNumber(primary, "sampleCount"),
          )}`
        : "（无主分析：本次没有可比的主效应）"
    }`,
  );
  if (evidence && typeof evidence["primarySelectionRule"] === "string") {
    lines.push(`- 主分析选择规则：${evidence["primarySelectionRule"]}`);
  }
  if (contributing.length > 0) {
    lines.push(`- 参与分析（${contributing.length} 条）：`);
    for (const item of contributing) {
      const rec = asRecord(item);
      if (!rec) continue;
      lines.push(
        `  - analysisId=${num(pickNumber(rec, "analysisId"))}，类型=${text(rec["analysisType"])}，效应=${num(
          pickNumber(rec, "effect"),
        )}，p=${num(pickNumber(rec, "pValue"))}，样本=${num(pickNumber(rec, "sampleCount"))}`,
      );
    }
  }
  if (ruleTrace.length > 0) {
    lines.push("- 规则判定轨迹：");
    for (const item of ruleTrace) {
      const rec = asRecord(item);
      if (!rec) continue;
      lines.push(`  - ${rec["passed"] === true ? "通过" : "未通过"} · ${text(rec["rule"])}：${text(rec["detail"])}`);
    }
  }
  lines.push("");
  lines.push("**结论策略 policy（原样引用 `evidence.policy`，未改写）**");
  lines.push("");
  lines.push(
    policy
      ? `\`${renderPolicyText(policy)}\``
      : "（结论证据里未携带 policy）",
  );
  lines.push("");
  lines.push("**免责声明 disclaimer（原样引用 `evidence.disclaimer`，未删除、未改写）**");
  lines.push("");
  lines.push(typeof disclaimer === "string" && disclaimer.length > 0 ? disclaimer : "（结论证据里未携带 disclaimer）");
  return lines.join("\n");
}

function renderLimitationsSection(
  source: ResearchReportSource,
  unresolvedTraceFields: readonly string[],
): string {
  const { conclusion, findings, dataset, run } = source;

  const conclusionLimitations = asStringArray(conclusion?.limitations);
  const nextQuestions = asStringArray(conclusion?.nextQuestions);
  const findingLimitations = findings.flatMap((f) =>
    asStringArray(f.limitations).map((l) => `#${f.id ?? EMPTY}（${f.findingType}）：${l}`),
  );

  const dataLimitations: string[] = [];
  if (dataset) {
    dataLimitations.push(
      `数据坐标：Dataset Version ${dataset.datasetVersionId}（${dataset.datasetCode} · ${dataset.versionLabel}），` +
        `区间 ${text(dataset.startDate)} ~ ${text(dataset.endDate)}，事件 ${num(dataset.totalEvents)}。`,
    );
    dataLimitations.push(`可用 outcome 视界：${compactJson(dataset.horizons)}。`);
    dataLimitations.push(
      `观察日（post）取值范围：${
        dataset.postRelativeDayRange
          ? `[${num(dataset.postRelativeDayRange.min)}, ${num(dataset.postRelativeDayRange.max)}]`
          : "不可用（该数据集没有观察日数据）"
      }。`,
    );
  } else {
    dataLimitations.push("Dataset 版本上下文不可达：本报告未能取到该版本的区间 / 事件数 / 视界信息。");
  }
  dataLimitations.push(`本 Run 使用的样本量：${num(run.sampleCount)}。`);

  return [
    "以下内容**全部为既有数据的原文引用或客观计数**，不含生成器自行推导的新结论。",
    "",
    "### 6.1 样本 / 数据层面的限制",
    "",
    bullets(dataLimitations),
    "",
    "### 6.2 结论声明的局限（`research_conclusion.limitationsJson` 原文）",
    "",
    bullets(conclusionLimitations),
    "",
    "### 6.3 Finding 自带局限（`research_finding.limitationsJson` 原文）",
    "",
    bullets(findingLimitations),
    "",
    "### 6.4 未决问题（`research_conclusion.nextQuestionsJson` 原文）",
    "",
    bullets(nextQuestions),
    "",
    "### 6.5 未能可靠取得的溯源字段",
    "",
    bullets(unresolvedTraceFields, "（无：本次全部溯源字段均已取到）"),
  ].join("\n");
}

function renderDisclaimerSection(): string {
  return [
    "本报告不含投资建议。",
    "",
    "**Finding 层免责声明（`researchCore/findings.ts#FINDING_DISCLAIMER` 原文）**",
    "",
    FINDING_DISCLAIMER,
    "",
    "**结论层免责声明**：见上文「结论」一节的 `evidence.disclaimer` 原文。",
    "",
    "研究强度只是**研究优先级**指标，不是策略评分；任何策略性判断必须经 Backtest / 稳健性 / OOS",
    "验证后才可成立。本报告不产出买卖建议、不承诺收益。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 把既有 Research 数据投影成一份研究报告草稿（**纯函数**）。
 *
 * @param source 已落库数据的只读快照（由 `service.ts` 装配；本函数不触碰任何 IO）
 */
export function buildResearchReport(source: ResearchReportSource): ResearchReportDraft {
  const warnings: string[] = [];

  const analysisIds = source.analyses.map((a) => a.id).filter((id): id is number => typeof id === "number");
  const findingIds = source.findings.map((f) => f.id).filter((id): id is number => typeof id === "number");

  const missingResultAnalyses = source.analyses.filter(
    (a) => (source.resultsByAnalysisId.get(a.id ?? -1) ?? []).length === 0,
  );
  if (missingResultAnalyses.length > 0) {
    warnings.push(
      `${missingResultAnalyses.length} 条分析没有结果行：${missingResultAnalyses
        .map((a) => `#${a.id ?? "?"}(${a.status})`)
        .join(", ")}`,
    );
  }

  // ---- 溯源字段可达性（§7：取不到就置空 + 明确记录，绝不伪造）----
  const unresolvedTraceFields: string[] = [];
  if (!source.dataset) unresolvedTraceFields.push("datasetVersion.名称/区间/事件数（版本上下文不可达）");
  if (source.patterns.length === 0) unresolvedTraceFields.push("patternId（分析的 moduleKey 未能反查到模式声明）");
  if (!source.conclusion) unresolvedTraceFields.push("conclusionId（无法把实验级结论归属到本 Run）");
  if (source.conclusion && !source.conclusion.id) unresolvedTraceFields.push("conclusionId（结论行缺少 id）");

  const patternIds = Array.from(new Set(source.patterns.map((p) => p.patternId))).sort();

  const body = [
    `# 研究报告 · Run #${source.run.runNo}`,
    "",
    REPORT_HEADER_NOTE,
    "",
    `实验：**${text(source.experiment.name)}**`,
    "",
    "## 1. 基本信息",
    "",
    renderBasicInfo(source),
    "",
    "## 2. Research Analysis 清单",
    "",
    renderAnalysisSection(source),
    "",
    "## 3. Research Result",
    "",
    renderResultSection(source),
    "",
    "## 4. Finding",
    "",
    renderFindingSection(source),
    "",
    "## 5. Conclusion",
    "",
    renderConclusionSection(source),
    "",
    "## 6. Limitations / Open Questions",
    "",
    renderLimitationsSection(source, unresolvedTraceFields),
    "",
    "## 7. 免责声明",
    "",
    renderDisclaimerSection(),
    "",
  ].join("\n");

  const checksum = createHash("sha256").update(body, "utf8").digest("hex");
  const bytes = Buffer.byteLength(body, "utf8");

  const metadata: ResearchReportMetadata = {
    datasetVersionId: source.experiment.datasetVersionId ?? null,
    runId: source.run.id,
    experimentId: source.experiment.id ?? null,
    analysisIds: [...analysisIds].sort((a, b) => a - b),
    findingIds: [...findingIds].sort((a, b) => a - b),
    conclusionId: source.conclusion?.id ?? null,
    patternId: patternIds.length === 1 ? patternIds[0]! : null,
    patternIds,
    generatorVersion: REPORT_GENERATOR_VERSION,
    report: {
      format: REPORT_FORMAT,
      mediaType: REPORT_MEDIA_TYPE,
      bytes,
      body,
    },
    checksum: {
      algorithm: "sha256",
      scope: REPORT_CHECKSUM_SCOPE,
      value: checksum,
    },
    conclusionResolution: source.conclusionResolution,
    unresolvedTraceFields,
  };

  return {
    body,
    format: REPORT_FORMAT,
    generatorVersion: REPORT_GENERATOR_VERSION,
    checksum,
    metadata,
    warnings,
  };
}

/**
 * 取回**可追溯字段**（= `metadataJson` 去掉正文）。
 *
 * 为什么单独给一个读取器：API 的响应里 `report.body` 已单独返回一次，
 * 若再把完整 metadata 原样带上，同一份几十 KB 的正文会在一个响应里出现两遍。
 * 这里做的是纯减法（只删 `report.body`），不新增、不改写任何字段。
 */
export function readReportTraceability(metadata: unknown): Record<string, unknown> | null {
  const rec = asRecord(metadata);
  if (!rec) return null;
  const report = asRecord(rec["report"]);
  if (!report) return { ...rec };
  const { body: _body, ...rest } = report;
  return { ...rec, report: rest };
}

/**
 * 从 artifact 的 `metadataJson` 里取回正文载荷。
 *
 * 只做**读**，不做任何补默认值 —— 取不到就返回 `null`，由调用方决定怎么报错。
 */
export function readReportPayload(metadata: unknown): ResearchReportPayload | null {
  const rec = asRecord(metadata);
  if (!rec) return null;
  const report = asRecord(rec["report"]);
  if (!report) return null;
  const body = report["body"];
  if (typeof body !== "string") return null;
  return {
    format: typeof report["format"] === "string" ? report["format"] : REPORT_FORMAT,
    mediaType: typeof report["mediaType"] === "string" ? report["mediaType"] : REPORT_MEDIA_TYPE,
    bytes: typeof report["bytes"] === "number" ? report["bytes"] : Buffer.byteLength(body, "utf8"),
    body,
  };
}
