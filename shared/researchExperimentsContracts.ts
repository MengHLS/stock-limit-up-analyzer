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
});
export type ExperimentDatasetRequirement = z.infer<typeof experimentDatasetRequirementSchema>;

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
  /** 本结果的计算引擎版本（实验侧声明，改动口径必须升）。 */
  computationVersion: z.string().min(1),
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

export const getExperimentInputSchema = z.object({ experimentId: experimentIdSchema });

export const runExperimentInputSchema = z.object({
  experimentId: experimentIdSchema,
  /** 唯一 Dataset 坐标（`dataset_version.id`）。 */
  datasetVersionId: z.number().int().positive(),
  /** 实验参数（缺省键由 runner 用声明里的 `defaultValue` 归并）。 */
  parameters: experimentParameterValuesSchema.optional(),
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
  /** 读 prefix 行情（`relativeDay` 必须 ∈ `prefixRelativeDays`）。 */
  feature(relativeDay: number): Promise<readonly ExperimentBarRow[]>;
  /** 读 post 行情（`relativeDay` 必须 ∈ `postRelativeDays` 且已声明 `usesForwardData`）。 */
  observation(relativeDay: number): Promise<readonly ExperimentBarRow[]>;
}

/** `run()` 的入参。 */
export interface ExperimentRunContext {
  /** 实验自己的描述符（只读）。 */
  readonly descriptor: ExperimentDescriptor;
  /** 已归并默认值的参数（键 = `descriptor.parameters[].code`）。 */
  readonly parameters: ExperimentParameterValues;
  /** 数据面（按声明投影）。 */
  readonly dataset: ExperimentDatasetAccess;
  /** 运行日志（进 `execution.logs` 返回给调用方；**不是** console 输出）。 */
  readonly log: (message: string) => void;
}

/**
 * `run()` 的产物。
 *
 * 🔴 `metadata` 与 `parameters` **不在这里** —— 由 Runner 用**自己解析出的**坐标填，
 * 实验无法谎报「我跑的是哪个 Dataset 版本」。`sampleSummary` 必填且账必须平（见 runner）。
 */
export interface ExperimentResultPayload {
  sampleSummary: ExperimentSampleSummary;
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
