/**
 * RESEARCH-EXPERIMENT-001 — 独立研究实验体系：对外契约（wire + 结果快照）。
 *
 * 本文件是**新独立实验体系唯一对外契约面**：tRPC 入参校验、返回值形态、以及前端渲染
 * 所需的全部结果结构都共用同一组 schema。纪律对齐既有领域契约（`shared/oosValidationContracts.ts`
 * / `shared/parameterSearchContracts.ts`）：
 *   - **zod schema 与 TS 类型同文件**（`z.infer` 派生，不手抄两份形状）；
 *   - 新增字段一律**可选 / 可空**（历史快照读取不得炸）；
 *   - 只描述**传输 / 展示形态**，不含任何口径计算（一切计算在 `research-experiments/**` 内）。
 *
 * ## 与旧 Research 的关系（规格 §14）
 *
 * 本契约**刻意不包含**旧 Research 链路的任何结构字段：
 * `analysisId` / `findingIds` / `conclusion` / `candidateId` 一律**不得**出现。
 * 新体系允许每个实验自己定义结果结构 ⇒ 结果 = 通用壳（信封） + 实验自有 `customPayload`。
 * 若将来需要兼容旧链路，只允许是**可选适配层**，且不修改本契约。
 *
 * ## 三层结构（自外向内）
 *
 * ```
 * ExperimentDescriptor     静态元数据（注册表可枚举；无 IO，可安全下发前端）
 *   └─ ExperimentDatasetRequirement   声明式 Dataset 需求（版本 / 字段 / 窗口 / 信息边界 / 是否用未来数据）
 * ExperimentRunOutcome     一次执行的全部事实（执行元数据 + Dataset 坐标 + 参数 + 结果 / 错误）
 *   └─ ExperimentResultEnvelope       结果信封（通用壳，可空字段按需填）
 * ```
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 一、参数（实验自己拥有的参数）
// ---------------------------------------------------------------------------

/**
 * 参数种类。
 *
 * 🔴 `INT_LIST` 的元素必须为整数 —— 「入场日集合」这类参数天然是整数集合，
 * 允许浮点只会让实验内部再做一轮拒绝，不如在契约层就钉死。
 */
export const EXPERIMENT_PARAMETER_KINDS = ["INT", "NUMBER", "BOOLEAN", "ENUM", "INT_LIST"] as const;
export type ExperimentParameterKind = (typeof EXPERIMENT_PARAMETER_KINDS)[number];

/** 单个参数值（可序列化的四种标量 + 整数数组）。 */
export const experimentParameterScalarSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.array(z.number().int()),
]);
export type ExperimentParameterScalar = z.infer<typeof experimentParameterScalarSchema>;

/** 参数集（code → value）。 */
export const experimentParameterValuesSchema = z.record(z.string(), experimentParameterScalarSchema);
export type ExperimentParameterValues = z.infer<typeof experimentParameterValuesSchema>;

/** 参数定义（前端据此渲染表单；后端据此做**独立**校验 —— 前端校验不是权威）。 */
export const experimentParameterDefinitionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullish(),
  kind: z.enum(EXPERIMENT_PARAMETER_KINDS),
  /** 是否必填；缺省 false（此时 `defaultValue` 必给）。 */
  required: z.boolean().optional(),
  /** 缺省值；`required !== true` 时必须给。 */
  defaultValue: experimentParameterScalarSchema.nullish(),
  /** 数值 / 整数数组元素的上下界（含）。 */
  bounds: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
    })
    .nullish(),
  /** `ENUM` 的允许取值（唯一来源）。 */
  allowedValues: z.array(z.string()).nullish(),
  /** 展示单位（如 "%" / "个交易日"）。 */
  unit: z.string().nullish(),
});
export type ExperimentParameterDefinition = z.infer<typeof experimentParameterDefinitionSchema>;

// ---------------------------------------------------------------------------
// 二、Dataset 需求（实验不得绕过契约直读数据库）
// ---------------------------------------------------------------------------

/**
 * 数据角色。
 *
 * - `FEATURE`：事件日（rd=0）及之前的行情 ⇒ **PIT 安全**，可直接作为样本资格依据；
 * - `OBSERVATION`：事件日之后（rd ≥ 1）的行情 ⇒ 违反 PIT 的「信息边界」，**必须**显式声明
 *   `usesForwardData: true` 才能读；Runner 会做结构级拒绝（不是靠注释提醒）。
 */
export const EXPERIMENT_DATASET_ROLES = ["FEATURE", "OBSERVATION"] as const;
export type ExperimentDatasetRole = (typeof EXPERIMENT_DATASET_ROLES)[number];

/**
 * 需要读的列，按角色分组（列名必须是物理表真实列名）。
 *
 * 🔴 本声明是**列投影的唯一依据**：Runner 按这里给出的列名生成 SELECT 列表，
 * 未声明的列**根本不会出现在实验拿到的行里**（结果里也就读不到）——
 * 「读了自己没声明的东西」不是靠纪律禁止，而是结构上取不到。
 */
export const experimentRequiredColumnsSchema = z.object({
  /** event 表需要的列（如 `isFirstLimit` / `boardType`）。 */
  events: z.array(z.string().min(1)).optional(),
  /** prefix 表（rd ≤ 0）需要的列。 */
  feature: z.array(z.string().min(1)).optional(),
  /** post 表（rd ≥ 1）需要的列。 */
  observation: z.array(z.string().min(1)).optional(),
});
export type ExperimentRequiredColumns = z.infer<typeof experimentRequiredColumnsSchema>;

/**
 * 事件扫描上限（**平台安全阀**，不是研究范围）。
 *
 * 缺省策略（`eventScanPolicy` 未声明或为 `PLATFORM_LIMIT`）下，一个实验最多扫这么多事件。
 * 超出部分**不会静默丢弃** —— 被截断这件事必须成为可见事实：Runner 侧的
 * `ExperimentAccessStats.eventScanTruncated` 会进执行元数据，实验侧应当把它写进
 * `sampleSummary.notes` 并输出「账目缺口」。EXP-001 真机 Run 就是在这里发现
 * 「数据集声明 23978 / 本轮只扫到 20000 / 中间 3978 个静默消失」的。
 */
export const EXPERIMENT_EVENT_SCAN_LIMIT = 20000;

/**
 * 事件扫描**硬上限**（防跑飞的兜底，不是研究范围）。
 *
 * `eventScanPolicy: "FULL_DATASET"` 的实验可以突破 `EXPERIMENT_EVENT_SCAN_LIMIT`
 * ——「全量」由数据集声明量决定 —— 但**不能**突破这里：一次实验的理论扫描量再大，
 * 也不该把库拖垮。超过即截断，并同样通过 `eventScanTruncated` 如实暴露。
 */
export const EXPERIMENT_EVENT_SCAN_HARD_LIMIT = 400000;

/**
 * 事件分页页大小（每次 `loadEventPage` 拉多少行）。
 *
 * 分页是 keyset（`tradeDate` + `eventId`）游标续读 ⇒ 页大小只影响轮次数与内存峰值，
 * 不影响正确性（无重复、无跳洞）。
 */
export const EXPERIMENT_EVENT_PAGE_SIZE = 2000;

/**
 * 行情批量读的分块大小（每次 `loadPostBars` / `loadPrefixBars` 带多少 eventId）。
 *
 * 🔴 为什么必须分块：读取层的批量接口实现是**单条** `IN (eventId…)` 查询。
 * 全量扫描时 eventId 数量上万，一次性下推会让 SQL 参数表无界膨胀
 * （参数包 / 解析开销 / 计划退化）。分块把「一次 N 万参数」换成
 * 「多次 N 千参数」，查询次数仍是「每相对日 × 块数」而不是「每事件 × 每相对日」。
 */
export const EXPERIMENT_BAR_BATCH_SIZE = 2000;

/**
 * Result / Artifact 资源上限（RESEARCH-EXPERIMENT-004 hardening）。
 *
 * 这些上限不是研究范围，而是平台资源保护：
 * - 超限必须在真正上传前失败，避免「算完才发现 result.json 太大」；
 * - Artifact 超限不能留下半套对象，失败时必须清理本次已写入对象；
 * - 数字刻意取宽松但仍有限，明确拒绝把 parquet / 明细表塞进 result.json。
 */
export const EXPERIMENT_RESULT_JSON_MAX_BYTES = 8 * 1024 * 1024;
export const EXPERIMENT_RESULT_TABLE_MAX_ROWS = 100_000;
export const EXPERIMENT_RESULT_TABLE_MAX_CELLS = 1_000_000;
export const EXPERIMENT_ARTIFACT_MAX_COUNT = 100;
export const EXPERIMENT_ARTIFACT_MAX_SINGLE_BYTES = 64 * 1024 * 1024;
export const EXPERIMENT_ARTIFACT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/**
 * 声明式 Dataset 需求。
 *
 * 🔴 这是**全部**取数能力的上限：Runner 只按这里声明的东西向 Dataset 读取层要数，
 * 实验拿不到任何额外的 DB 句柄（见 `server/researchExperiments/datasetPort.ts`）。
 */
export const experimentDatasetRequirementSchema = z.object({
  /** 期望的数据集语义代码（= `dataset_definition.datasetCode`）。 */
  datasetCode: z.string().min(1),
  requiredColumns: experimentRequiredColumnsSchema,
  /** 需要读的 prefix 相对日（**必须 ≤ 0**）。 */
  prefixRelativeDays: z.array(z.number().int().max(0)).optional(),
  /** 需要读的 post 相对日（**必须 ≥ 1**）。 */
  postRelativeDays: z.array(z.number().int().min(1)).optional(),
  /**
   * 样本资格的**信息边界**（交易日），语义与 Dataset 域的 `decisionOffsetDays` 同源：
   * 判定「该样本是否入池」只允许使用 rd ∈ [1, d] 的数据。
   *
   * `null` = 本实验的样本资格**完全不使用** rd ≥ 1 数据（只按 rd ≤ 0 的特征入池）。
   */
  decisionOffsetDays: z.number().int().min(1).nullable(),
  /** 是否读取事件日之后的数据（rd ≥ 1）。 */
  usesForwardData: z.boolean(),
  /** `usesForwardData === true` 时必填：这些未来数据**用来做什么**（人读，进留档）。 */
  forwardDataPurpose: z.string().nullish(),
  /**
   * 事件扫描策略（**缺省 = 受平台安全阀约束**）。
   *
   * - `PLATFORM_LIMIT`（缺省）：最多扫 `EXPERIMENT_EVENT_SCAN_LIMIT` 个事件；
   * - `FULL_DATASET`：按 Dataset 分页语义扫描**该版本声明的全部事件**。
   *
   * ## 为什么是「声明式放行」而不是「提高或删掉安全阀」
   *
   * 安全阀的存在理由（防一次实验扫爆内存 / 拖垮库）不会因为某个实验想做全量研究就消失。
   * 因此这里**不删阀、也不全局调高**，而是让实验**显式承担**「我要扫全量」这件事：
   * 声明 `FULL_DATASET` 之后，扫描量由「数据集声明量」决定（分页逐页读，不是一次性读），
   * 且仍受 `EXPERIMENT_EVENT_SCAN_HARD_LIMIT` 兜底（防跑飞）。
   * 代价是可见的：`candidateCount` 会等于数据集声明量，实验必须自己出
   * `unscannedEventCount` 并让它为 0，否则账目缺口会被 `summary.notes` 如实点名。
   */
  eventScanPolicy: z.enum(["PLATFORM_LIMIT", "FULL_DATASET"]).optional(),
});
export type ExperimentDatasetRequirement = z.infer<typeof experimentDatasetRequirementSchema>;

export const experimentAuxiliaryDatasetRequirementSchema = z.object({
  alias: z.string().regex(/^[a-z][a-z0-9_]*$/u, "alias 必须是 lowercase snake_case"),
  requirement: experimentDatasetRequirementSchema,
});
export type ExperimentAuxiliaryDatasetRequirement = z.infer<
  typeof experimentAuxiliaryDatasetRequirementSchema
>;

export const experimentDatasetBindingSchema = z.object({
  alias: z.string().min(1),
  datasetVersionId: z.number().int().positive(),
  datasetCode: z.string().min(1),
  datasetVersionLabel: z.string().min(1),
});
export type ExperimentDatasetBinding = z.infer<typeof experimentDatasetBindingSchema>;

// ---------------------------------------------------------------------------
// 三、Research Protocol / 确认性研究阶段
// ---------------------------------------------------------------------------

export const EXPERIMENT_RESEARCH_PHASES = ["EXPLORATORY", "OBSERVATION", "HOLDOUT"] as const;
export type ExperimentResearchPhase = (typeof EXPERIMENT_RESEARCH_PHASES)[number];

export const experimentEvaluationWindowSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "必须是 YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "必须是 YYYY-MM-DD"),
  })
  .refine((window) => window.startDate <= window.endDate, {
    message: "startDate 不得晚于 endDate",
  });
export type ExperimentEvaluationWindow = z.infer<typeof experimentEvaluationWindowSchema>;

/** 用户提交的确认性研究协议；protocolFingerprint 由平台计算，不接受调用方自报。 */
export const experimentResearchProtocolInputSchema = z
  .object({
    protocolId: z.string().min(1),
    protocolVersion: z.string().min(1),
    hypothesisCode: z.string().min(1),
    observationWindow: experimentEvaluationWindowSchema,
    holdoutWindow: experimentEvaluationWindowSchema,
    phase: z.enum(["OBSERVATION", "HOLDOUT"]),
    parentRunId: z.string().min(1).nullable().optional(),
  })
  .superRefine((protocol, ctx) => {
    if (protocol.observationWindow.endDate >= protocol.holdoutWindow.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["holdoutWindow", "startDate"],
        message: "Holdout 必须严格晚于 Observation 结束日",
      });
    }
    if (protocol.phase === "HOLDOUT" && !protocol.parentRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentRunId"],
        message: "HOLDOUT 必须引用一个已完成的 OBSERVATION Run",
      });
    }
    if (protocol.phase === "OBSERVATION" && protocol.parentRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentRunId"],
        message: "OBSERVATION 不得携带 parentRunId",
      });
    }
  });
export type ExperimentResearchProtocolInput = z.infer<typeof experimentResearchProtocolInputSchema>;

/** 平台解析后的协议上下文；只读下发给实验。 */
export interface ExperimentProtocolContext {
  readonly phase: ExperimentResearchPhase;
  readonly protocolId: string | null;
  readonly protocolVersion: string | null;
  readonly hypothesisCode: string | null;
  readonly protocolFingerprint: string | null;
  readonly evaluationWindow: ExperimentEvaluationWindow | null;
  readonly parentRunId: string | null;
}

export const experimentConfirmatoryCheckSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["PASS", "FAIL", "INSUFFICIENT"]),
  value: z.number().nullable().optional(),
  threshold: z.number().nullable().optional(),
  note: z.string().nullish(),
});

/**
 * 确认性 Gate。
 *
 * - OBSERVATION Run 的 gate 只回答“协议和观察段是否准备好进入 Holdout”；
 * - HOLDOUT Run 的 gate 才允许 PASS / FAIL / INSUFFICIENT，作为策略准入依据。
 */
export const experimentConfirmatoryGateSchema = z.object({
  status: z.enum(["OBSERVATION_READY", "PASS", "FAIL", "INSUFFICIENT"]),
  protocolFingerprint: z.string().min(1),
  sampleCount: z.number().int().nonnegative().nullable(),
  checks: z.array(experimentConfirmatoryCheckSchema),
  summary: z.string().min(1),
});
export type ExperimentConfirmatoryGate = z.infer<typeof experimentConfirmatoryGateSchema>;

// ---------------------------------------------------------------------------
// 三、实验描述符（注册表可枚举的静态元数据）
// ---------------------------------------------------------------------------

/** 实验描述符：**纯静态**、无 IO，可安全下发前端列表页。 */
export const experimentDescriptorSchema = z.object({
  /** 全局唯一 id，形如 `<group>/<key>`（小写 kebab-case，两段）。 */
  id: z.string().min(1),
  name: z.string().min(1),
  /** 实验自身版本（语义化，如 `1.0.0`）。改动计算口径必须升版本。 */
  version: z.string().min(1),
  description: z.string().min(1),
  /** 作者 / 来源（如 `stock-limit-up-analyzer` / 外部 AI 名称）。 */
  source: z.string().min(1),
  tags: z.array(z.string()).optional(),
  /** 参数定义列表（前端据此渲染表单）。 */
  parameters: z.array(experimentParameterDefinitionSchema),
  /** Dataset 需求声明。 */
  datasetRequirement: experimentDatasetRequirementSchema,
  /** 辅助 Dataset（可选）；alias 不得为 primary，且不得重复。 */
  auxiliaryDatasetRequirements: z.array(experimentAuxiliaryDatasetRequirementSchema).optional(),
  /**
   * 前端页面键（= 客户端页面注册表 `client/src/researchExperiments/pages.ts` 的键）。
   * 平台按此键挂载实验自己的页面；键不存在时降级为通用结果渲染器。
   */
  pageKey: z.string().min(1),
  /** 页面标题（通用外壳用它做容器标题）。 */
  pageTitle: z.string().min(1),
});
export type ExperimentDescriptor = z.infer<typeof experimentDescriptorSchema>;

// ---------------------------------------------------------------------------
// 四、结果信封（通用壳；实验自己决定填哪些）
// ---------------------------------------------------------------------------

/** 表格 / 图表里的单元格值。 */
export const experimentCellSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);
export type ExperimentCell = z.infer<typeof experimentCellSchema>;

export const experimentResultTableSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  columns: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      unit: z.string().nullish(),
      /** 小数位（数值列）；缺省由前端决定。 */
      digits: z.number().int().min(0).max(8).nullish(),
      align: z.enum(["LEFT", "RIGHT"]).nullish(),
    }),
  ),
  rows: z.array(z.record(z.string(), experimentCellSchema)),
});
export type ExperimentResultTable = z.infer<typeof experimentResultTableSchema>;

export const experimentResultStatisticSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  /** `null` = 样本不足 / 无法计算（**禁 0 兜底**）。 */
  value: z.number().nullable(),
  unit: z.string().nullish(),
  digits: z.number().int().min(0).max(8).nullish(),
  sampleCount: z.number().int().nonnegative().nullish(),
  note: z.string().nullish(),
});
export type ExperimentResultStatistic = z.infer<typeof experimentResultStatisticSchema>;

export const experimentResultDistributionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  buckets: z.array(
    z.object({
      label: z.string().min(1),
      count: z.number().int().nonnegative(),
    }),
  ),
  note: z.string().nullish(),
});
export type ExperimentResultDistribution = z.infer<typeof experimentResultDistributionSchema>;

export const experimentResultSeriesSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  /** 数值序列（`x` 用字符串以保留交易日原样，避免时区改写）。 */
  points: z.array(
    z.object({
      x: z.string().min(1),
      y: z.number().nullable(),
    }),
  ),
});
export type ExperimentResultSeries = z.infer<typeof experimentResultSeriesSchema>;

export const experimentResultChartSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  kind: z.enum(["BAR", "LINE"]),
  xLabel: z.string().nullish(),
  yLabel: z.string().nullish(),
  unit: z.string().nullish(),
  series: z.array(experimentResultSeriesSchema),
});
export type ExperimentResultChart = z.infer<typeof experimentResultChartSchema>;

export const experimentResultComparisonSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  leftLabel: z.string().min(1),
  rightLabel: z.string().min(1),
  rows: z.array(
    z.object({
      label: z.string().min(1),
      left: z.number().nullable(),
      right: z.number().nullable(),
      delta: z.number().nullable(),
      deltaPercent: z.number().nullable(),
    }),
  ),
});
export type ExperimentResultComparison = z.infer<typeof experimentResultComparisonSchema>;

/** 样本口径摘要（**必须如实**：入池 / 剔除 / 剔除原因逐项）。 */
export const experimentSampleSummarySchema = z.object({
  /** 数据集里与本实验相关的候选事件数（未施加实验自己的入池条件）。 */
  candidateCount: z.number().int().nonnegative(),
  /** 实际入池（参与统计）的样本数。 */
  eligibleCount: z.number().int().nonnegative(),
  /** 被剔除数（应等于 candidateCount - eligibleCount）。 */
  excludedCount: z.number().int().nonnegative(),
  /** 剔除原因 → 条数（唯一诊断线索，**禁丢**）。 */
  excludedByReason: z.record(z.string(), z.number().int().nonnegative()),
  notes: z.array(z.string()).optional(),
});
export type ExperimentSampleSummary = z.infer<typeof experimentSampleSummarySchema>;

/** 结果元数据：一次执行的身份与坐标（页面必须显示其中每一条）。 */
export const experimentResultMetadataSchema = z.object({
  experimentId: z.string().min(1),
  experimentName: z.string().min(1),
  experimentVersion: z.string().min(1),
  datasetVersionId: z.number().int().positive(),
  datasetCode: z.string().min(1),
  /** 数据集的业务版本标签（如 `v2`）。 */
  datasetVersionLabel: z.string().min(1),
  datasetStartDate: z.string().nullable(),
  datasetEndDate: z.string().nullable(),
  /** 本次运行绑定的全部 Dataset（首个必须是 primary）。 */
  datasetBindings: z.array(experimentDatasetBindingSchema).optional(),
  /** 本结果的计算引擎版本（实验侧声明，改动口径必须升）。 */
  computationVersion: z.string().min(1),
  /** 实验定义代码指纹（平台计算，历史 Run 的精确执行身份）。 */
  experimentCodeDigest: z.string().min(1).optional(),
  /** 研究阶段；历史 Run / exploratory 缺省。 */
  researchPhase: z.enum(EXPERIMENT_RESEARCH_PHASES).optional(),
  /** 协议指纹；exploratory 为 null。 */
  protocolFingerprint: z.string().min(1).nullish(),
  /** 本次实际生效的数据观察窗口。 */
  evaluationWindow: experimentEvaluationWindowSchema.nullish(),
});
export type ExperimentResultMetadata = z.infer<typeof experimentResultMetadataSchema>;

/**
 * 结果信封。
 *
 * 🔴 除 `metadata` / `parameters` / `sampleSummary` 外**全部可选** ——
 * 规格 §6 明令「不要把以上字段全部强制化」，实验作者按研究问题自选结构。
 */
export const experimentResultEnvelopeSchema = z.object({
  metadata: experimentResultMetadataSchema,
  parameters: experimentParameterValuesSchema,
  sampleSummary: experimentSampleSummarySchema,
  tables: z.array(experimentResultTableSchema).optional(),
  statistics: z.array(experimentResultStatisticSchema).optional(),
  distributions: z.array(experimentResultDistributionSchema).optional(),
  comparisons: z.array(experimentResultComparisonSchema).optional(),
  charts: z.array(experimentResultChartSchema).optional(),
  /** 确认性研究的结构化 Gate；exploratory 不产出。 */
  confirmatoryGate: experimentConfirmatoryGateSchema.optional(),
  /** 实验自有结果结构（由实验自己的 zod schema 校验；runner 负责跑那一层校验）。 */
  customPayload: z.unknown().optional(),
});
export type ExperimentResultEnvelope = z.infer<typeof experimentResultEnvelopeSchema>;

// ---------------------------------------------------------------------------
// 五、一次执行的全部事实
// ---------------------------------------------------------------------------

export const EXPERIMENT_RUN_STATUSES = ["SUCCEEDED", "FAILED"] as const;
export type ExperimentRunStatus = (typeof EXPERIMENT_RUN_STATUSES)[number];

/** 执行元数据（耗时 / 时间戳；时间戳一律 ISO 字符串，避免时区改写）。 */
export const experimentExecutionSchema = z.object({
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  /** 执行时实际落定的参数（默认值已归并）。 */
  resolvedParameters: experimentParameterValuesSchema,
  /**
   * 实验自己写的运行日志（有界：最多 200 行）。
   *
   * 用途：失败时能看出「跑到哪一步了」—— 只有错误码而无进度线索的失败，
   * 下次排查要从头再来一遍。
   */
  logs: z.array(z.string()),
  /** 解析后的 Dataset 事实（版本 / 视界 / 实际读到的行数）。 */
  datasetFacts: z.object({
    datasetVersionId: z.number().int().positive(),
    datasetCode: z.string().min(1),
    datasetVersionLabel: z.string().min(1),
    status: z.string().min(1),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    /** 数据集声明的总事件数（`dataset_version.totalEvents`，可空）。 */
    datasetTotalEvents: z.number().int().nonnegative().nullable(),
    /** 本次实际读到的事件行数（不是表级 COUNT）。 */
    eventCount: z.number().int().nonnegative(),
    /** 本次实际读到的 prefix 行数。 */
    prefixRowCount: z.number().int().nonnegative(),
    /** 本次实际读到的 post 行数。 */
    postRowCount: z.number().int().nonnegative(),
    /** 本次实际读到的最大 post 相对日（证明「读了什么」可复核）。 */
    maxPostRelativeDayRead: z.number().int().nullable(),
    /** 本次实际使用的信息边界（来自实验声明）。 */
    decisionOffsetDays: z.number().int().nullable(),
    /** 本次是否真的读了 rd ≥ 1 的数据。 */
    forwardDataRead: z.boolean(),
    /** 平台级日期过滤窗口；null = 使用 Dataset 全窗。 */
    evaluationWindow: experimentEvaluationWindowSchema.nullish(),
    /** 研究阶段。 */
    researchPhase: z.enum(EXPERIMENT_RESEARCH_PHASES).optional(),
    /** 协议指纹。 */
    protocolFingerprint: z.string().min(1).nullish(),
    /** 样本选择是否已冻结；读取 observation 前必须为 true。 */
    selectionFrozen: z.boolean().optional(),
    /** 冻结后的样本事件数。 */
    selectedEventCount: z.number().int().nonnegative().optional(),
    /** 本次生效的事件扫描策略（来自实验声明；缺省 `PLATFORM_LIMIT`）。 */
    eventScanPolicy: z.enum(["PLATFORM_LIMIT", "FULL_DATASET"]).optional(),
    /** 本次生效的事件扫描上限（＝策略对应的那个阀值）。 */
    eventScanLimit: z.number().int().positive().optional(),
    /** 事件分页实际轮数（证明「全量扫描是分页做的，不是一次性读」）。 */
    eventPageCount: z.number().int().nonnegative().optional(),
    /** 行情批量读实际查询次数（每相对日 × 块数）。 */
    barQueryCount: z.number().int().nonnegative().optional(),
    /** 事件扫描是否被安全阀截断（截断必须在结果里可见，不能静默）。 */
    eventScanTruncated: z.boolean().optional(),
  }),
});
export type ExperimentExecution = z.infer<typeof experimentExecutionSchema>;

/** 执行错误（领域码写进 `code`，不用 message 传递）。 */
export const experimentRunErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  detail: z.unknown().optional(),
});
export type ExperimentRunError = z.infer<typeof experimentRunErrorSchema>;

/** 一次 Experiment 执行结果（Runner 的返回值，也是 tRPC `run` 的返回值）。 */
export const experimentRunOutcomeSchema = z.object({
  runStatus: z.enum(EXPERIMENT_RUN_STATUSES),
  descriptor: experimentDescriptorSchema,
  execution: experimentExecutionSchema,
  result: experimentResultEnvelopeSchema.nullable(),
  error: experimentRunErrorSchema.nullable(),
});
export type ExperimentRunOutcome = z.infer<typeof experimentRunOutcomeSchema>;

/** 可选的 Dataset 版本（前端选择器用）。 */
export const experimentDatasetVersionOptionSchema = z.object({
  datasetVersionId: z.number().int().positive(),
  datasetCode: z.string().min(1),
  datasetName: z.string().min(1),
  version: z.string().min(1),
  status: z.string().min(1),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  totalEvents: z.number().int().nonnegative().nullable(),
});
export type ExperimentDatasetVersionOption = z.infer<typeof experimentDatasetVersionOptionSchema>;

// ---------------------------------------------------------------------------
// 六、tRPC 入参
// ---------------------------------------------------------------------------

export const experimentIdSchema = z.string().min(1);

export const listExperimentsInputSchema = z
  .object({
    /** 只列某个 Dataset 语义代码兼容的实验时使用（缺省 = 全部）。 */
    datasetCode: z.string().min(1).optional(),
  })
  .optional();

export const getExperimentInputSchema = z.object({
  experimentId: experimentIdSchema,
  /** Run 历史分页偏移；缺省 0。 */
  runOffset: z.number().int().nonnegative().optional(),
});

export const runExperimentInputSchema = z.object({
  experimentId: experimentIdSchema,
  /** 唯一 Dataset 坐标（`dataset_version.id`）。 */
  datasetVersionId: z.number().int().positive(),
  /** 辅助 Dataset alias → datasetVersionId。 */
  auxiliaryDatasetVersionIds: z.record(z.string(), z.number().int().positive()).optional(),
  /** 实验参数（缺省键由 runner 用声明里的 `defaultValue` 归并）。 */
  parameters: experimentParameterValuesSchema.optional(),
  /** 可选确认性协议；缺省 = EXPLORATORY。 */
  protocol: experimentResearchProtocolInputSchema.optional(),
});
export type RunExperimentInput = z.infer<typeof runExperimentInputSchema>;

// ---------------------------------------------------------------------------
// 七、领域错误码（跨 tRPC 边界时写进 message：`[CODE] …`）
// ---------------------------------------------------------------------------

export const EXPERIMENT_ERROR_CODES = [
  /** 实验 id 未注册。 */
  "EXPERIMENT_NOT_FOUND",
  /** 实验自身元数据非法（id 形态 / 参数定义 / Dataset 声明不自洽）。 */
  "EXPERIMENT_METADATA_INVALID",
  /** 参数不合法（缺必填 / 越界 / 枚举外 / 类型不符）。 */
  "EXPERIMENT_PARAMETER_INVALID",
  /** Dataset 需求非法（如 post 相对日含 ≤0）。 */
  "EXPERIMENT_DATASET_REQUIREMENT_INVALID",
  /** 数据集版本不存在。 */
  "EXPERIMENT_DATASET_VERSION_NOT_FOUND",
  /** 数据集版本不是 READY。 */
  "EXPERIMENT_DATASET_VERSION_NOT_READY",
  /** 数据集语义代码与实验声明不匹配。 */
  "EXPERIMENT_DATASET_CODE_MISMATCH",
  /** 未声明使用未来数据却去读 rd ≥ 1（结构级 PIT 拒绝）。 */
  "EXPERIMENT_FORWARD_DATA_FORBIDDEN",
  /** 声明了 `usesForwardData=true` 却没写用途。 */
  "EXPERIMENT_FORWARD_DATA_PURPOSE_MISSING",
  /** 声明的相对日超出该数据集真实视界。 */
  "EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE",
  /** 实验结果不符合信封契约 / 实验自有 schema。 */
  "EXPERIMENT_RESULT_INVALID",
  /** 运行器内部失败（含实验 `run()` 抛出的非领域错误）。 */
  "EXPERIMENT_RUN_FAILED",
  // ---- RESEARCH-EXPERIMENT-004：持久化 / Artifact 存储 ----
  /** 指定 `runId` 在持久化层不存在。 */
  "EXPERIMENT_RUN_NOT_FOUND",
  /** 非法的 Run 状态迁移（如 COMPLETED → RUNNING）。 */
  "EXPERIMENT_RUN_STATE_INVALID",
  /** `runId` 已存在（唯一约束；不覆盖历史 Run）。 */
  "EXPERIMENT_RUN_ID_CONFLICT",
  /** Artifact Object Key 非法（空 / 绝对路径 / 含 `..` / 与 Run 前缀不符）。 */
  "EXPERIMENT_ARTIFACT_KEY_INVALID",
  /** Artifact 在对象存储里不存在（`resultManifestKey` 指向了不存在的对象）。 */
  "EXPERIMENT_ARTIFACT_NOT_FOUND",
  /** Result / Artifact 超出平台资源上限。 */
  "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED",
  /** 未冻结样本资格就读取未来观察数据。 */
  "EXPERIMENT_SELECTION_NOT_FROZEN",
  /** 对象存储未配置或不可用（MinIO 连接缺失 / 不可达）。 */
  "EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE",
  /** 对象上传失败（**绝不允许**此时把 Run 标成 COMPLETED）。 */
  "EXPERIMENT_ARTIFACT_UPLOAD_FAILED",
  /** `manifest.json` 无法解析 / 不符合 Manifest 契约。 */
  "EXPERIMENT_MANIFEST_INVALID",
  // ---- Research Protocol / Confirmatory Gate ----
  /** 协议自身非法（窗口重叠 / 阶段缺 parent / 指纹不一致）。 */
  "EXPERIMENT_PROTOCOL_INVALID",
  /** 阶段冲突（Holdout 已使用 / Observation 晚于 Holdout / 父 Run 类型错误）。 */
  "EXPERIMENT_PROTOCOL_PHASE_CONFLICT",
  /** Holdout 窗口已被同实验 / 同 Dataset 的历史 Run 观察过。 */
  "EXPERIMENT_PROTOCOL_HOLDOUT_CONTAMINATED",
  /** Holdout 参数与父 Observation Run 冻结参数不一致。 */
  "EXPERIMENT_PROTOCOL_PARAMETERS_FROZEN",
  /** 确认性 Run 缺少合法 Gate / Exploratory Run 非法产出 Gate。 */
  "EXPERIMENT_CONFIRMATORY_GATE_INVALID",
] as const;
export type ExperimentErrorCode = (typeof EXPERIMENT_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// 八、实验**作者契约**（ExperimentDefinition / run() 的签名与数据面）
// ---------------------------------------------------------------------------
//
// 为什么放在 shared 而不是 `server/**`：
//   实验目录位于仓库根 `research-experiments/<组>/<实验>/`，**层级不固定**
//   （模板在 2 层、示例在 3 层）⇒ 用相对路径 import 会因复制目录而静默失效。
//   放在 `shared` 里，实验一律写 `import type { … } from "@shared/researchExperimentsContracts"`
//   —— **与目录深度无关**，复制模板后不用改 import 路径。
//
// 本节的类型**全是类型**（无运行时值），因此 shared 侧不需要任何服务端依赖。

/**
 * 稀疏行：只含**声明过**的列（未声明的列在结构上不存在）。
 *
 * 这是「列投影即声明」的兑现方式：Runner 按 `requiredColumns` 生成 SELECT 列表，
 * 没声明的列根本不会出现在行里 —— 「读了自己没声明的东西」不是靠纪律禁止，而是取不到。
 */
export interface ExperimentDeclaredRow {
  /** 相对日（rd=0 为事件日；观察行为 rd ≥ 1）。 */
  readonly relativeDay: number;
  /** 该行对应的交易日（YYYY-MM-DD）。 */
  readonly tradeDate: string;
  /** 声明过的列 → 值；未声明的列读出来是 `undefined`。 */
  readonly values: Readonly<Record<string, number | boolean | string | null>>;
}

/** 事件行（`ds_*_event` 的投影）。 */
export interface ExperimentEventRow extends ExperimentDeclaredRow {
  readonly eventId: string;
  /**
   * 代码域标识（如 `600000.SH`）。
   *
   * 🔴 这是**代码**，不是身份：项目里 `securityId`（canonical `sec_<uuid>`）与 `code`
   * 是两个键域。`ds_*` 表只有 `symbol` ⇒ 若你的研究需要按证券聚合，必须经
   * `server/security/engineKeyBridge.ts#resolveSecurityIdByEngineKey`
   * **逐事件按其自身 `tradeDate`** 解析（同一代码在不同历史区间可能属于不同证券），
   * 且解析歧义时必须响亮失败 —— **绝不可**把 `symbol` 当身份用。
   */
  readonly symbol: string;
}

/** 行情行（`ds_*_prefix` / `ds_*_post` 的投影）。 */
export interface ExperimentBarRow extends ExperimentDeclaredRow {
  readonly eventId: string;
  /** 代码域标识；身份解析注意事项同 `ExperimentEventRow.symbol`。 */
  readonly symbol: string;
}

/** Dataset 版本的事实（只读；由 Runner 从 Registry 解析后注入）。 */
export interface ExperimentDatasetFacts {
  readonly datasetVersionId: number;
  readonly datasetCode: string;
  readonly datasetName: string;
  readonly datasetVersionLabel: string;
  readonly status: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  /** `dataset_version.totalEvents`（数据集声明的总事件数；可空）。 */
  readonly totalEvents: number | null;
  /**
   * 该版本 **post（rd ≥ 1）** 的真实视界。
   *
   * 🔴 Registry 读取层只暴露 post 与 path 的真实视界，**不暴露 prefix 视界** ⇒
   * 这里如实不提供 prefix 范围，而不是编一个看起来合理的区间。
   */
  readonly postRelativeDayRange: { readonly min: number; readonly max: number } | null;
}

/**
 * 实验的数据访问面（`context.dataset`）。
 *
 * 🔴 三个刻意的限制：
 *   1. **只有这一层**：没有 `db`、没有 `raw`、没有「按条件全表扫」的入口；
 *   2. `feature()` 只接受**声明过**的相对日；`observation()` 还额外要求
 *      `usesForwardData === true`，否则抛 `EXPERIMENT_FORWARD_DATA_FORBIDDEN`；
 *   3. 返回的每一行都只带声明过的列。
 */
export interface ExperimentDatasetAccess {
  readonly facts: ExperimentDatasetFacts;
  /** 读事件行（列投影 = `requiredColumns.events`）。 */
  events(): Promise<readonly ExperimentEventRow[]>;
  /**
   * 事件**流式分页**（chunked scan）。
   *
   * 与 `events()` 的关系：`events()` 是「一次拿到全部」（内部就是把它读完），
   * `eventPages()` 让实验**逐页消费**、不必把全部事件行同时握在手里 ——
   * 扫描上万事件时这是内存峰值与「分页是否真的发生」可被观测的差别。
   *
   * 页与页之间用 keyset 游标（`tradeDate` + `eventId`）续读，**无重复、无跳洞**；
   * 是否被平台安全阀截断取决于 `descriptor.datasetRequirement.eventScanPolicy`。
   */
  eventPages(): AsyncIterable<readonly ExperimentEventRow[]>;
  /** 读 prefix 行情（`relativeDay` 必须 ∈ `prefixRelativeDays`）。 */
  feature(relativeDay: number): Promise<readonly ExperimentBarRow[]>;
  /** 读 post 行情（`relativeDay` 必须 ∈ `postRelativeDays` 且已声明 `usesForwardData`）。 */
  observation(relativeDay: number): Promise<readonly ExperimentBarRow[]>;
}

/**
 * 实验声明要**落盘为文件**的产物的规格（RESEARCH-EXPERIMENT-004）。
 *
 * ## 为什么需要它
 *
 * 信封（`tables` / `charts` / `statistics` …）描述的是**页面上的展示形态**，
 * 它随 `result.json` 一起落对象存储，体积有界。但研究经常要产出**真正的文件**：
 * 明细 CSV、Parquet、导出的图表、自定义日志。这些不能塞进 `result.json`
 * （会把一次 Run 的结果体撑到几十 MB，正是规格 §17 要避免的）。
 *
 * ## 它怎么被消费
 *
 * `context.artifact(spec)` 收集 ⇒ Runner 随执行结果**私下**交给服务层
 * ⇒ 服务层写到对象存储的 `tables/` `charts/` `logs/` `artifacts/` 段，
 * 并把索引登记进 `manifest.json`。
 *
 * 🔴 **产物内容不进 `outcome`**：`outcome` 是发给浏览器的执行事实，
 *    里面只有 Manifest 索引（Key / 类型 / 体积），**没有字节**。
 *    这条边界靠 `runDetailed()` 与 `run()` 的分工在**类型层**兑现，不靠纪律。
 */
export interface ExperimentArtifactFileSpec {
  /** Run 前缀下的**相对名字**（可含子目录，如 `tables/cohort.csv`）。 */
  readonly name: string;
  /** 落哪个角色段（决定 Object Key 的固定段）。 */
  readonly role: "table" | "chart" | "log" | "artifact";
  /** 内容（文本或字节）。 */
  readonly body: string | Uint8Array;
  /** MIME 类型；缺省按扩展名推断（见服务端 `runManifest.ts#inferArtifactDescriptor`）。 */
  readonly contentType?: string;
  /** 人读标签（进 Manifest，显示在页面上）。 */
  readonly label?: string;
  readonly description?: string;
}

/** `run()` 的入参。 */
export interface ExperimentRunContext {
  /** 实验自己的描述符（只读）。 */
  readonly descriptor: ExperimentDescriptor;
  /** 平台解析后的研究协议；exploratory Run 为 null。 */
  readonly protocol: ExperimentProtocolContext | null;
  /** 已归并默认值的参数（键 = `descriptor.parameters[].code`）。 */
  readonly parameters: ExperimentParameterValues;
  /** 数据面（按声明投影）。 */
  readonly dataset: ExperimentDatasetAccess;
  /** 全部 Dataset 访问面；`primary` 恒为主 Dataset，其余键 = auxiliary alias。 */
  readonly datasets: Readonly<Record<string, ExperimentDatasetAccess>>;
  /**
   * 冻结样本资格。
   *
   * 必须在第一次读取 `dataset.observation()` 前调用。冻结后未来数据只能服务于
   * 已冻结样本的结果观察，不能反过来决定样本入池。
   */
  freezeSelection(eventIds: readonly string[]): void;
  /** 运行日志（进 `execution.logs` 返回给调用方；**不是** console 输出）。 */
  readonly log: (message: string) => void;
  /**
   * 声明一个要落对象存储的文件产物（RESEARCH-EXPERIMENT-004）。
   *
   * 不调用就什么都不写 —— 只产 `result.json` + `manifest.json` + `logs/run.log`。
   * 名字非法（绝对路径 / 含 `..` / 空）会在**收集时**立刻抛领域错误，
   * 不会等到上传阶段才炸。
   */
  readonly artifact: (spec: ExperimentArtifactFileSpec) => void;
}

/**
 * `run()` 的产物。
 *
 * 🔴 `metadata` 与 `parameters` **不在这里** —— 由 Runner 用**自己解析出的**坐标填，
 * 实验无法谎报「我跑的是哪个 Dataset 版本」。`sampleSummary` 必填且账必须平（见 runner）。
 */
export interface ExperimentResultPayload {
  sampleSummary: ExperimentSampleSummary;
  /** 确认性 Gate；OBSERVATION / HOLDOUT 协议 Run 必填，exploratory 必须省略。 */
  confirmatoryGate?: ExperimentConfirmatoryGate;
  tables?: readonly ExperimentResultTable[];
  statistics?: readonly ExperimentResultStatistic[];
  distributions?: readonly ExperimentResultDistribution[];
  comparisons?: readonly ExperimentResultComparison[];
  charts?: readonly ExperimentResultChart[];
  /** 实验自有结构（由 `definition.resultSchema` 校验）。 */
  customPayload?: unknown;
}

/**
 * **ExperimentDefinition —— 本体系的唯一 Contract**。
 *
 * ```
 * ExperimentDefinition
 * ├── descriptor      元数据 + 参数定义 + Dataset 需求 + 页面键（纯静态，可下发前端）
 * ├── resultSchema    校验本实验自有结果（`result.customPayload`）的 zod schema
 * └── run(context)    「具体研究什么、怎么算」
 * ```
 *
 * 「load / validate / resolve dataset / validate parameters / execute / capture result /
 * capture error / return execution metadata」**全部由 Runner 负责**，
 * 实验作者只写 `run()`。
 */
export interface ExperimentDefinition {
  readonly descriptor: ExperimentDescriptor;
  /**
   * 本实验**自有结果**（`result.customPayload`）的 zod schema。
   *
   * 信封（`metadata` / `parameters` / `sampleSummary` / `tables` / …）由平台 schema 统一校验，
   * 这一层只管实验自己发明的那部分结构。返回 `z.unknown()` 表示「本实验没有自有结构」，
   * 但**不建议**省略 —— 有 schema 才能被 Contract Test 钉住。
   */
  readonly resultSchema: z.ZodType;
  /** 研究内容本体。Runner 负责它的加载、校验、执行、结果校验与错误捕获。 */
  run(context: ExperimentRunContext): Promise<ExperimentResultPayload> | ExperimentResultPayload;
}

// ---------------------------------------------------------------------------
// 九、持久化 / Artifact / Manifest 契约（RESEARCH-EXPERIMENT-004）
// ---------------------------------------------------------------------------
//
// 本节的定位（规格 §2 / §10 / §11 / §12）：
//
// ```
// TiDB    ← Run Metadata（轻量：状态 / 时间 / 参数 / Dataset 坐标 / Manifest 引用 / 轻摘要）
// MinIO   ← Result / Manifest / 表格 / 图表 / 日志等**大产物**
// Dataset ← 仍然只有一套（`datasetVersionId` 引用，MinIO 不复制 Dataset）
// ```
//
// 🔴 三条硬纪律：
//   1. **不设计全局固定的实验 Result 表** —— 不同实验的 Result 结构不同，只有「信封」是统一的；
//      `result.json` 落对象存储，DB 只存它的**引用**与**轻量摘要**；
//   2. **Artifact 元数据里不出现任何凭据** —— 凭据只存在于服务端 env（规格 §18）；
//   3. Tool 侧一律不知道 Object Key 的具体拼法细节以外的东西：Key 由
//      `server/artifactStorage/objectKey.ts` 唯一生成，本契约只描述**形态**。

/** `manifest.json` 自身的结构版本（Manifest 是 Run 的 Artifact 索引）。 */
export const EXPERIMENT_MANIFEST_SCHEMA_VERSION = "1.0.0";

/** 结果信封落盘时的结构版本（写进 `experiment_run.resultSchemaVersion`）。 */
export const EXPERIMENT_RESULT_SCHEMA_VERSION = "1.0.0";

/**
 * 「能不能在页内预览」的判据 —— **两端唯一真源**（规格 §17）。
 *
 * 🔴 为什么必须放在契约里而不是各写一份：服务端用这两个常量算
 *    `ExperimentArtifactMetadata.inlineViewable`（权威裁决），前端用它们决定
 *    「给不给预览按钮」。若两边各写一份，迟早出现「服务端说不给预览、前端却给」（或反之）
 *    —— 那就是本仓库明确禁止的「同名不同义」。
 *
 * 语义：体积 ≤ 上限 **且** 形态在列表内 ⇒ 可由后端代理**内联**返回并读成文本。
 * 超限的产物**不是不能看**，只是要用户主动点「下载」在本地打开（§17 大文件策略）。
 */
export const EXPERIMENT_ARTIFACT_INLINE_PREVIEW_MAX_BYTES = 256 * 1024;

/** 可内联预览的形态（`format` 字段取值；大小写不敏感比较）。 */
export const EXPERIMENT_ARTIFACT_INLINE_PREVIEW_FORMATS = [
  "json",
  "csv",
  "tsv",
  "text",
  "svg",
  "html",
] as const;

/**
 * Run 生命周期状态（规格 §12）。
 *
 * ```
 * PENDING → RUNNING → COMPLETED
 *                   ↘ FAILED
 * ```
 *
 * 🔴 `COMPLETED` 的**唯一**含义是「Result 与 Manifest 已确实写入对象存储并通过存在性校验」——
 * 「DB 说完成了、对象却不在」是不允许出现的状态（规格 §13 情况 A）。
 */
export const EXPERIMENT_RUN_LIFECYCLE_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
] as const;
export type ExperimentRunLifecycleStatus = (typeof EXPERIMENT_RUN_LIFECYCLE_STATUSES)[number];

/** 合法状态迁移表（唯一权威；Repository 与测试共用）。 */
export const EXPERIMENT_RUN_ALLOWED_TRANSITIONS: Readonly<
  Record<ExperimentRunLifecycleStatus, readonly ExperimentRunLifecycleStatus[]>
> = {
  PENDING: ["RUNNING", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

/** Artifact 种类（决定前端给什么样的入口：预览 / 下载 / 打开）。 */
export const EXPERIMENT_ARTIFACT_KINDS = [
  "RESULT",
  "MANIFEST",
  "TABLE",
  "CHART",
  "CSV",
  "PARQUET",
  "LOG",
  "IMAGE",
  "OTHER",
] as const;
export type ExperimentArtifactKind = (typeof EXPERIMENT_ARTIFACT_KINDS)[number];

/**
 * 一个 Artifact 的**索引项**（不含内容）。
 *
 * `key` 是对象存储里的**完整 Object Key**（= `server/artifactStorage/objectKey.ts` 生成）。
 * 前端拿到它之后只能经后端 API 取内容（规格 §18），**拿不到任何存储凭据**。
 */
export const experimentArtifactRefSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(EXPERIMENT_ARTIFACT_KINDS),
  /** 形态描述（如 `json` / `csv` / `parquet` / `png` / `text`）。 */
  format: z.string().min(1),
  contentType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  /** 写入时间（ISO 8601）。 */
  createdAt: z.string().nullable(),
  label: z.string().min(1),
  description: z.string().nullish(),
});
export type ExperimentArtifactRef = z.infer<typeof experimentArtifactRefSchema>;

/**
 * `manifest.json` —— 本次 Run 的 Artifact 索引（规格 §10）。
 *
 * 🔴 Manifest 是「这次 Run 到底产出了什么」的**唯一索引**：前端不猜 Key、不做目录列举，
 *    一律以 Manifest 为准；也因此 `result` 字段是 Manifest 里的**引用**，不是内容。
 */
export const experimentRunManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  /** 实验 id（`<group>/<key>`）。 */
  experimentCode: z.string().min(1),
  experimentVersion: z.string().min(1),
  /** 实验定义代码指纹；旧 Manifest 可为空。 */
  experimentCodeDigest: z.string().min(1).nullish(),
  runId: z.string().min(1),
  /** 本次 Run 使用的唯一 Dataset 版本坐标（**软引用**，非 FK）。 */
  datasetVersionId: z.number().int().positive(),
  createdAt: z.string().min(1),
  /** 结果信封对象（`null` = 本 Run 没有结果，如执行失败）。 */
  result: experimentArtifactRefSchema.nullable(),
  tables: z.array(experimentArtifactRefSchema),
  charts: z.array(experimentArtifactRefSchema),
  /** 其它产物（CSV / Parquet / 图片 / 日志 / 大型中间结果 …）。 */
  artifacts: z.array(experimentArtifactRefSchema),
});
export type ExperimentRunManifest = z.infer<typeof experimentRunManifestSchema>;

/**
 * 落进 TiDB 的**轻量摘要**（规格 §2.1「必要的轻量 Summary Metadata」）。
 *
 * 为什么要有它：Run 列表页不应该为了显示「候选 328 / 入池 291」而去对象存储拉一次
 * `result.json`（低带宽环境下这正是规格 §17 要避免的事）。
 */
export const experimentRunSummarySchema = z.object({
  /** Runner 的执行结论（`SUCCEEDED` / `FAILED`）。 */
  runStatus: z.enum(EXPERIMENT_RUN_STATUSES),
  candidateCount: z.number().int().nonnegative().nullable(),
  eligibleCount: z.number().int().nonnegative().nullable(),
  excludedCount: z.number().int().nonnegative().nullable(),
  excludedByReason: z.record(z.string(), z.number().int().nonnegative()).nullable(),
  /** 实际读到的行数（证明「读了什么」）。 */
  prefixRowCount: z.number().int().nonnegative().nullable(),
  postRowCount: z.number().int().nonnegative().nullable(),
  forwardDataRead: z.boolean().nullable(),
  logLineCount: z.number().int().nonnegative(),
  /** 本次写出的 Artifact 个数（含 result / manifest）。 */
  artifactCount: z.number().int().nonnegative(),
  /** 研究阶段快照。 */
  researchPhase: z.enum(EXPERIMENT_RESEARCH_PHASES).optional(),
  /** 确认 Gate 状态快照。 */
  confirmatoryStatus: z
    .enum(["OBSERVATION_READY", "PASS", "FAIL", "INSUFFICIENT"])
    .nullish(),
});
export type ExperimentRunSummary = z.infer<typeof experimentRunSummarySchema>;

/** 一条 Run 的持久化记录（= TiDB 行 + 软引用，**不含 Result 内容**）。 */
export const experimentRunRecordSchema = z.object({
  runId: z.string().min(1),
  /** 实验 id（`<group>/<key>`）。 */
  experimentId: z.string().min(1),
  /** 运行时的实验元数据**快照**（代码改了也仍能读懂这条历史 Run）。 */
  experimentName: z.string().min(1),
  experimentVersion: z.string().min(1),
  /** 实验定义代码指纹（历史行可为 null；新 Run 必填）。 */
  experimentCodeDigest: z.string().min(1).nullable(),
  /** 研究阶段；历史行为 null。 */
  researchPhase: z.enum(EXPERIMENT_RESEARCH_PHASES).nullable(),
  protocolId: z.string().min(1).nullable(),
  protocolVersion: z.string().min(1).nullable(),
  protocolFingerprint: z.string().min(1).nullable(),
  parentRunId: z.string().min(1).nullable(),
  evaluationWindow: experimentEvaluationWindowSchema.nullable(),
  datasetVersionId: z.number().int().positive(),
  datasetCode: z.string().min(1),
  datasetVersionLabel: z.string().min(1),
  /** 全部 Dataset 绑定快照。 */
  datasetBindings: z.array(experimentDatasetBindingSchema),
  /** **已归并默认值**的参数快照（写入即冻结）。 */
  parameters: experimentParameterValuesSchema,
  status: z.enum(EXPERIMENT_RUN_LIFECYCLE_STATUSES),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** Manifest 对象 Key（`COMPLETED` 时必非空 —— 由 Repository 断言）。 */
  resultManifestKey: z.string().nullable(),
  resultSchemaVersion: z.string().nullable(),
  confirmatoryGate: experimentConfirmatoryGateSchema.nullable(),
  summary: experimentRunSummarySchema.nullable(),
  /**
   * `true` = 该 Run 已长时间停留在 `RUNNING`（超过阈值仍未收敛）。
   *
   * 🔴 这是「情况 B：Run 永远 RUNNING」的**可见化**落点：读时不静默改写状态，
   * 而是如实标注「它可能已经卡住了」，并提供收敛入口（`researchExperiments.reconcileRun`）。
   */
  stale: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type ExperimentRunRecord = z.infer<typeof experimentRunRecordSchema>;

/**
 * 列表摘要：当前 Run + 该实验最近的 Run（列表页一次请求拿全）。
 *
 * 🔴 `runsAvailable` / `runsError` 是刻意的：实验**描述符**来自代码里的注册表
 *    （DB 挂了也拿得到），而 Run 事实来自 TiDB。若不分开报告，DB 不可用时页面只能
 *    要么整页报错、要么显示「0 个 Run」——后者是**把故障伪装成事实**。
 *    这里如实说「列表可用，但 Run 事实取不到，原因是 …」。
 */
export const experimentSummarySchema = z.object({
  descriptor: experimentDescriptorSchema,
  runCount: z.number().int().nonnegative(),
  latestRun: experimentRunRecordSchema.nullable(),
  /** Run 事实是否取到（false ⇒ `runCount=0` 与 `latestRun=null` **不代表真的没有 Run**）。 */
  runsAvailable: z.boolean(),
  runsError: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type ExperimentSummary = z.infer<typeof experimentSummarySchema>;

/** 实验详情：描述符 + 该实验的全部 Run（按时间降序）。 */
export const experimentDetailSchema = z.object({
  descriptor: experimentDescriptorSchema,
  runs: z.array(experimentRunRecordSchema),
  /** 同 `experimentSummarySchema`：Run 事实取不到时如实标注，不用空数组冒充「没有 Run」。 */
  runsAvailable: z.boolean(),
  runsError: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type ExperimentDetail = z.infer<typeof experimentDetailSchema>;

/** Artifact 的只读元数据（规格 §16：Chart / CSV / Parquet 至少要能查看 metadata）。 */
export const experimentArtifactMetadataSchema = z.object({
  ref: experimentArtifactRefSchema,
  /** 对象在存储里**确实存在**（读时实测，不是靠 DB 声称）。 */
  present: z.boolean(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  contentType: z.string().nullable(),
  lastModified: z.string().nullable(),
  etag: z.string().nullable(),
  /** 是否可由后端直接内联预览（小体积文本 / JSON；大文件一律只给下载）。 */
  inlineViewable: z.boolean(),
});
export type ExperimentArtifactMetadata = z.infer<typeof experimentArtifactMetadataSchema>;

/**
 * `getRun` 的返回：Run 元数据 + Manifest + Result（+ 每个 Artifact 的存在性）。
 *
 * 🔴 Result / Manifest 来自对象存储 ⇒ 当存储不可用时，它们如实为 `null`，
 *    并由 `artifactsAvailable=false` + `artifactsError` 说明原因；**不伪造空结果**。
 */
export const experimentRunDetailSchema = z.object({
  run: experimentRunRecordSchema,
  manifest: experimentRunManifestSchema.nullable(),
  result: experimentResultEnvelopeSchema.nullable(),
  artifacts: z.array(experimentArtifactMetadataSchema),
  /** 确认性 Holdout 的数据隔离审计；非 Holdout / 旧数据可为空。 */
  dataIsolation: z
    .object({
      status: z.enum(["CLEAN", "CONTAMINATED", "NOT_APPLICABLE"]),
      contaminatedRunIds: z.array(z.string().min(1)),
      summary: z.string().min(1),
    })
    .optional(),
  /** 对象存储是否可读（false 时 manifest/result 必为 null）。 */
  artifactsAvailable: z.boolean(),
  /** 不可读时的原因（领域码 + 人读说明）；可读时为 null。 */
  artifactsError: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type ExperimentRunDetail = z.infer<typeof experimentRunDetailSchema>;

/** Run 执行结果：Runner 的完整事实 + 持久化坐标（`run` 端点的返回值）。 */
export const experimentRunExecutionResultSchema = z.object({
  /** 落库坐标；持久化不可用时为 null（此时 outcome 仍如实返回）。 */
  persisted: z.boolean(),
  run: experimentRunRecordSchema.nullable(),
  outcome: experimentRunOutcomeSchema,
});
export type ExperimentRunExecutionResult = z.infer<typeof experimentRunExecutionResultSchema>;

// ---- tRPC 入参（§14） ----

export const listRunsInputSchema = z
  .object({
    experimentId: experimentIdSchema.optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().nonnegative().max(100_000).optional(),
  })
  .optional();

export const getRunInputSchema = z.object({ runId: z.string().min(1) });

export const getRunResultManifestInputSchema = z.object({ runId: z.string().min(1) });

export const getArtifactInputSchema = z.object({
  runId: z.string().min(1),
  key: z.string().min(1),
});

export const reconcileRunInputSchema = z.object({
  runId: z.string().min(1),
  /** 收敛原因（必填：收敛一条 RUNNING 是**人为判定**，必须留痕）。 */
  reason: z.string().min(1).max(500),
});
