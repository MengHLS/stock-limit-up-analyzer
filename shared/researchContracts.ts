/**
 * FE-0 — 研究链路 tRPC 契约（shared 层：前后端共享的唯一契约来源）。
 *
 * 定位（ROADMAP §2 正确性优先 / §9 Frontend 不是 Quant Engine）：
 * - 本文件只描述**传输形状**（入参校验），**不定义任何量化语义**；
 *   一切语义（PIT / 复权 / 指标口径 / 生命周期迁移表）一律由后端模块给出，前端不得重算。
 * - 领域对象（StrategyDocument / StrategyLifecycleRecord）用 `z.custom` **类型透传**，
 *   由后端既有权威校验器（validateStrategyDocument / assertValidStrategyLifecycleRecord）校验，
 *   避免 shared 层复制领域 schema 造成「双份口径漂移」。
 * - 生命周期状态枚举在 shared 侧以传输层字面量定义，并由契约单测断言与后端
 *   `STRATEGY_LIFECYCLE_STATUSES` 完全一致（见 server/researchContracts.test.ts），防静默漂移。
 * - Research Dataset 构建只回传**摘要**（剔除 rows）：rows 可达百万级，不可经 RPC 传输；
 *   rows 仅供后端研究链路消费（§31 禁止前端篡改/重算量化结果）。
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 通用基础
// ---------------------------------------------------------------------------

/** ISO 日期形态 YYYY-MM-DD（仅形态校验；语义/区间合法性由后端校验）。 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期须为 YYYY-MM-DD 形态");

// ---------------------------------------------------------------------------
// historicalState（STEP 12.5 · asOf(T) 历史状态）
// ---------------------------------------------------------------------------

export const historicalStateAsOfInputSchema = z.object({
  /** 永久身份 securityId（sec_<uuid>）。 */
  securityId: z.string().min(1, "securityId 必填"),
  /** 被查询交易日。 */
  tradeDate: isoDateSchema,
  /**
   * PIT 信息截止点。
   * - 显式传值 = 研究口径（推荐）；
   * - null / 省略 = 全知视角，仅供调试与审计，研究使用属未来函数（§4 PIT 铁律）。
   */
  asOf: isoDateSchema.nullable().optional(),
  /** 市场状态核心指数；省略用后端默认 4 大基准。 */
  coreIndexCodes: z.array(z.string()).optional(),
});

export type HistoricalStateAsOfInput = z.infer<
  typeof historicalStateAsOfInputSchema
>;

// ---------------------------------------------------------------------------
// historicalState · 代码解析（FE-2 身份解析 UX 支持，非领域语义）
// ---------------------------------------------------------------------------

export const CODE_EXCHANGES = ["SH", "SZ", "BJ"] as const;
export const codeExchangeSchema = z.enum(CODE_EXCHANGES);
export type CodeExchange = (typeof CODE_EXCHANGES)[number];

/** 代码解析入参：6 位数字代码，可带 .SH/.SZ/.BJ 后缀。 */
export const historicalStateResolveInputSchema = z.object({
  query: z.string().trim().min(1, "请输入证券代码").max(24),
  limit: z.number().int().min(1).max(50).optional(),
});
export type HistoricalStateResolveInput = z.infer<
  typeof historicalStateResolveInputSchema
>;

/** 一个候选证券（代码可能跨证券复用，故返回候选集，由用户选定）。 */
export const codeCandidateSchema = z.object({
  /** 永久身份 sec_<uuid>。 */
  securityId: z.string(),
  securityType: z.string(),
  exchange: codeExchangeSchema,
  /** master 生命周期快照状态。 */
  status: z.string(),
  listedDate: z.string().nullable(),
  delistedDate: z.string().nullable(),
  /** 该证券最优先的生效标识符（primary 优先）；无标识符为 null。 */
  identifier: z
    .object({
      securityCode: z.string(),
      identifierType: z.string(),
      effectiveFrom: z.string(),
      effectiveTo: z.string().nullable(),
    })
    .nullable(),
  /** 该证券的标识符区间总数（含别名/多 provider）。 */
  identifierCount: z.number().int(),
});
export type CodeCandidate = z.infer<typeof codeCandidateSchema>;

/** 代码解析结果。parseError 非空 = 输入无法解析（candidates 为空）。 */
export const historicalStateResolveResultSchema = z.object({
  query: z.string(),
  digits: z.string().nullable(),
  exchange: codeExchangeSchema.nullable(),
  parseError: z.string().nullable(),
  candidates: z.array(codeCandidateSchema),
  /** DB 不可用/超时/失败说明；null = 正常返回（可能零候选）。 */
  error: z.string().nullable(),
});
export type HistoricalStateResolveResult = z.infer<
  typeof historicalStateResolveResultSchema
>;

// ---------------------------------------------------------------------------
// researchDataset（STEP 12.6 · Research Dataset 构建）
// ---------------------------------------------------------------------------

/** 市场板块类别（与后端 classifyBoard 输出一致）。 */
export const BOARD_CATEGORY_VALUES = [
  "main",
  "chinext",
  "star",
  "bse",
  "unknown",
] as const;
export const boardCategorySchema = z.enum(BOARD_CATEGORY_VALUES);
export type BoardCategoryValue = (typeof BOARD_CATEGORY_VALUES)[number];

/** T 日条件口径（与后端 TDayCondition 一致）。 */
export const TDAY_CONDITION_VALUES = [
  "none",
  "limitUp",
  "firstBoard",
  "consecutiveBoard",
] as const;
export const tDayConditionSchema = z.enum(TDAY_CONDITION_VALUES);
export type TDayConditionValue = (typeof TDAY_CONDITION_VALUES)[number];

/** 回踩目标位类型（与后端 PullbackTargetType 一致）。 */
export const PULLBACK_TARGET_TYPE_VALUES = [
  "limitPrice",
  "t0Open",
  "t0Low",
  "ma5",
] as const;
export const pullbackTargetTypeSchema = z.enum(PULLBACK_TARGET_TYPE_VALUES);
export type PullbackTargetTypeValue =
  (typeof PULLBACK_TARGET_TYPE_VALUES)[number];

/** 回踩筛选条件（首板后 T+1~T+d「触及且不破」）。 */
export const pullbackScreenConditionSchema = z.object({
  /** 回踩目标位（可多选）。 */
  targetTypes: z
    .array(pullbackTargetTypeSchema)
    .min(1, "至少选择一个回踩目标位"),
  /** 触及容差（%）。 */
  tolerancePercent: z.number().min(0).max(50).default(2),
  /** 观察窗口交易日数（T+1 ~ T+N）——数据集携带的观察日数据上界。 */
  observationWindowDays: z.number().int().min(1).max(10).default(5),
  /**
   * 🔴 决策日偏移 d（交易日）—— **样本资格的唯一信息边界**：
   * 判定「该样本是否满足回踩条件」只允许使用 T+1..T+d。
   *
   * 用整段 T+1..T+N 决定样本是否进池，等于在**样本层**使用未来数据。
   * 刻意**不给 default**：缺省即静默回到该 look-ahead 行为，必须显式声明；
   * 跨字段约束 `d ≤ observationWindowDays` 由 `validate` 权威判定。
   */
  decisionOffsetDays: z
    .number()
    .int()
    .min(1, "决策日偏移至少为 1（T+1）")
    .max(10, "决策日偏移最大为 10"),
});
export type PullbackScreenConditionInput = z.infer<
  typeof pullbackScreenConditionSchema
>;

/** universe 过滤层（板块 / ST / T 日条件 / 首板回踩）。 */
export const universeFilterSchema = z.object({
  boards: z.array(boardCategorySchema).optional(),
  excludeSt: z.boolean().optional(),
  tDayCondition: tDayConditionSchema.optional(),
  pullback: pullbackScreenConditionSchema.optional(),
});
export type UniverseFilterInput = z.infer<typeof universeFilterSchema>;

/**
 * 数据集构建入参。
 *
 * 安全约束：经 RPC 触发构建必须显式限流（FE-0 约定）——
 * `maxTradingDays` / `maxSecuritiesPerDay` 省略时取保守默认值，防止误触全历史构建。
 */
export const researchDatasetBuildInputSchema = z.object({
  name: z.string().min(1, "数据集名称必填"),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  /** 逐日 PIT（默认 true）。 */
  asOfPerTradeDate: z.boolean().optional(),
  /** 固定 asOf（仅 asOfPerTradeDate=false 时生效）。 */
  asOf: isoDateSchema.nullable().optional(),
  coreIndexCodes: z.array(z.string()).optional(),
  maxTradingDays: z.number().int().positive().optional(),
  maxSecuritiesPerDay: z.number().int().positive().optional(),
  /** 数据链是否已就绪（影响 gate 判定；默认 false = 诚实未就绪）。 */
  dataReady: z.boolean().optional(),
  /** universe 过滤层（板块 / ST / T 日条件）；省略 = 全量可交易池。 */
  universeFilter: universeFilterSchema.optional(),
});

export type ResearchDatasetBuildInput = z.infer<
  typeof researchDatasetBuildInputSchema
>;

/** 经 RPC 构建的默认限流（保护后端，非语义默认值）。 */
export const RESEARCH_DATASET_RPC_DEFAULTS = {
  maxTradingDays: 5,
  maxSecuritiesPerDay: 50,
  dataReady: false,
} as const;

/** 数据集摘要：与后端 ResearchDataset 同构，但剔除 rows。 */
export interface ResearchDatasetSummary {
  datasetVersion: string;
  universeDefinition: unknown;
  policySet: unknown;
  dataSnapshot: unknown;
  gate: "FAIL" | "PASS" | "INCONCLUSIVE";
  gateNotes: readonly string[];
  /** 实际构建行数（rows 长度；rows 本体不回传）。 */
  rowCount: number;
}

// ---------------------------------------------------------------------------
// researchDataset · 能力矩阵 / 预览 / 认证（STEP DS-V2）
// ---------------------------------------------------------------------------

/** 能力可用性三态（与后端 capability.ts 一致）。 */
export type DatasetCapabilityStatus =
  | "AVAILABLE"
  | "CONDITIONAL"
  | "UNAVAILABLE";

/** 认证资格三态（与后端 certify.ts 一致）。 */
export type DatasetCertificationStatus =
  | "CERTIFIED"
  | "CONDITIONAL"
  | "REJECTED";

/** 认证依赖声明（研究是否实际消费这些可选域）。 */
export const datasetCertificationRequirementsSchema = z.object({
  industry: z.boolean().optional(),
  liquidity: z.boolean().optional(),
  corporateActions: z.boolean().optional(),
});
export type DatasetCertificationRequirements = z.infer<
  typeof datasetCertificationRequirementsSchema
>;

/** 单个能力条目（六维矩阵）。 */
export interface DatasetCapabilityEntry {
  key: string;
  name: string;
  status: DatasetCapabilityStatus;
  uiAvailable: boolean;
  backendAvailable: boolean;
  historicalDataAvailable: boolean;
  pitSafe: boolean;
  tested: boolean;
  researchSafe: boolean;
  evidence: string;
}

/** 能力矩阵（10 维度）。 */
export interface DatasetCapabilityMatrix {
  capturedAt: string;
  facts: {
    industryHistoricalPit: DatasetCapabilityStatus;
    liquidityHistoricalCoverage: DatasetCapabilityStatus;
    corporateActionPit: DatasetCapabilityStatus;
  };
  entries: DatasetCapabilityEntry[];
}

/** 预览摘要（配置后、构建前；元数据 + 内存决议，不构建全量）。 */
export interface DatasetPreviewSummary {
  request: {
    name: string;
    startDate: string;
    endDate: string;
    asOfPerTradeDate: boolean;
    asOf: string | null;
    coreIndexCodes: string[];
  };
  dateRange: { startDate: string; endDate: string };
  tradingDays: number;
  firstTradingDay: string | null;
  lastTradingDay: string | null;
  truncated: boolean;
  totalTradingDays: number;
  universe: {
    totalSecurities: number;
    delistedSecurities: number;
    avgMembersPerDay: number;
    memberDays: number;
    estimatedBarCount: number;
  };
  pit: { mode: "asOfPerTradeDate" | "fixed"; safe: boolean; note: string };
  survivorship: { safe: boolean; note: string };
  historicalState: { available: boolean; note: string };
  industry: { status: DatasetCapabilityStatus; note: string };
  liquidity: { status: DatasetCapabilityStatus; note: string };
  corporateAction: { status: DatasetCapabilityStatus; note: string };
  coverage: {
    priceDates: number;
    liquidityDates: number;
    priceWindowCoverage: number | null;
    liquidityWindowCoverage: number | null;
  };
  universeFilter: {
    boards: string[];
    excludeSt: boolean;
    tDayCondition: string;
    note: string;
  };
  verdict: "FAIL" | "PASS" | "INCONCLUSIVE";
  verdictNotes: string[];
}

/** 认证结果。 */
export interface DatasetCertificationResult {
  status: DatasetCertificationStatus;
  researchSafe: boolean;
  reasons: string[];
}

/** 认证 + 持久化结果（certify 端点返回）。 */
export interface DatasetCertifyResult {
  datasetId: string;
  datasetVersion: string;
  rowCount: number;
  gate: "FAIL" | "PASS" | "INCONCLUSIVE";
  certification: DatasetCertificationResult;
  fingerprints: {
    rowsFingerprint: string;
    policySetFingerprint: string;
    versionSnapshotFingerprint: string;
  };
  /** true = 该 datasetVersion 已存在（幂等回放）。 */
  replayed: boolean;
}

/** 已持久化数据集的列表条目（list 端点返回）。 */
export interface DatasetListEntry {
  datasetId: string;
  datasetVersion: string;
  name: string;
  startDate: string;
  endDate: string;
  rowCount: number;
  gate: string;
  /** 分片行表名（rd_rows_<buildKey>）；null = 非分片构建。 */
  rowsTableName: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// research · strategy（STEP 15 · 策略 Schema + 版本化）
// ---------------------------------------------------------------------------

/** StrategyDocument 传输层透传（语义校验由后端 validateStrategyDocument 负责）。 */
export const strategyDocumentSchema = z.custom<Record<string, unknown>>(
  value => typeof value === "object" && value !== null && !Array.isArray(value),
  { message: "StrategyDocument 缺失或非对象" }
);

export const strategyValidateInputSchema = z.object({
  document: strategyDocumentSchema,
});

export const strategyBumpInputSchema = z.object({
  version: z.string().min(1, "version 必填（semver x.y.z）"),
  bump: z.enum(["major", "minor", "patch"]),
});

export const strategyCompareInputSchema = z.object({
  left: strategyDocumentSchema,
  right: strategyDocumentSchema,
});

export type StrategyValidateInput = z.infer<typeof strategyValidateInputSchema>;
export type StrategyBumpInput = z.infer<typeof strategyBumpInputSchema>;
export type StrategyCompareInput = z.infer<typeof strategyCompareInputSchema>;

// ---------------------------------------------------------------------------
// research · strategy CRUD（STEP STRATEGY-002 · 策略持久化）
// ---------------------------------------------------------------------------

/** 创建 / 保存策略（document 为 wire 透传，语义由后端 createStrategyDocument 权威重算）。 */
export const strategySaveInputSchema = z.object({
  document: strategyDocumentSchema,
});
export type StrategySaveInput = z.infer<typeof strategySaveInputSchema>;

/** 按 strategyId 加载 / 删除 / 列版本。 */
export const strategyIdInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
});
export type StrategyIdInput = z.infer<typeof strategyIdInputSchema>;

/**
 * 统一版本目录行：正式 `strategy_versions` 与 `closed_loop_backtest_run` 留档的只读投影。
 *
 * 设计约束：
 *   - 一行表示正式存在的 `(strategyId, version)`；留档不再单独增行；
 *   - `isStarred` 统一来自 `strategy_version_star`；
 *   - 留档只补运行事实（runId / 窗口 / 指标），**不伪造** canonical strategy document。
 */
export const strategyVersionStudyMinuteStageSchema = z.object({
  label: z.string().min(1),
  effect: z.string().min(1),
});

export const strategyVersionStudyMinuteFieldSchema = z.object({
  field: z.string().min(1),
  role: z.string().min(1),
  stages: strategyVersionStudyMinuteStageSchema.array(),
  limitations: z.string().array(),
});

export const strategyVersionStudySignalSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  stage: z.string().min(1),
  effect: z.string().min(1),
  source: z.enum(["TUNABLE", "FIXED", "ASSEMBLY"]),
});
export type StrategyVersionStudySignalDto = z.infer<
  typeof strategyVersionStudySignalSchema
>;

export const strategyVersionStudyFamilyArmSchema = z.object({
  armId: z.string().min(1),
  strategyVersion: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  signals: strategyVersionStudySignalSchema.array(),
});
export type StrategyVersionStudyFamilyArmDto = z.infer<
  typeof strategyVersionStudyFamilyArmSchema
>;

export const strategyVersionStudyFamilySchema = z.object({
  familyId: z.string().min(1),
  familyLabel: z.string().min(1),
  minVersion: z.string().min(1),
  maxVersion: z.string().min(1),
  studyStage: z.string().min(1),
  uniqueDimension: z.string().min(1),
  minuteStage: z.string().min(1),
  minuteEffect: z.string().min(1),
  /** 该族是否已恢复为可执行参数；HISTORICAL_ONLY 表示留档不足以还原、拒绝按默认值重跑。 */
  executability: z.enum(["EXECUTABLE", "HISTORICAL_ONLY"]),
  /** 不可执行时的具体原因；可执行时为 null。 */
  historicalOnlyReason: z.string().min(1).nullable(),
  /**
   * 该族可执行时可覆写的维度参数（来自权威注册表），与版本文档的 TUNABLE 声明同源。
   */
  tunableParameters: z
    .object({
      name: z.string().min(1),
      defaultValue: z.number(),
      min: z.number(),
      max: z.number(),
      step: z.number(),
      note: z.string().min(1),
    })
    .array(),
  /**
   * 该族留档过的具体 arm：每个 arm 显式携带 strategyVersion 与关键执行取值。
   * 版本落在族区间内但没有登记为 arm 时，不冒领 arm 参数。
   */
  arms: strategyVersionStudyFamilyArmSchema.array(),
  /** 该族按权威注册表解析出的关键执行取值，供版本详情直接展示。 */
  resolvedSignals: strategyVersionStudySignalSchema.array(),
  /** 该族留档参数的证据出处，便于追溯。 */
  evidenceSources: z.string().array(),
});
export type StrategyVersionStudyFamilyDto = z.infer<
  typeof strategyVersionStudyFamilySchema
>;

export const strategyVersionFirstLimitPoolDetailSchema = z.object({
  familyId: z.string().min(1),
  armId: z.string().min(1),
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  admissionRule: z.string().min(1),
  earlyScoreStage: z.string().min(1),
  fullScoreStage: z.string().min(1),
  invalidationRule: z.string().min(1),
  ageCapTradingDays: z.number().int().positive(),
  scoreInvalidationDays: z.number().int().positive(),
  scoreAffectsExit: z.literal(false),
  maxDailyCandidates: z.number().int().nonnegative(),
  minimumScore: z.number().min(0).max(1).optional(),
  maxObservationAmplitude: z.number().gt(0).lt(1).optional(),
  calibrationVersion: z.string().min(1).optional(),
  allowMultipleMembersPerSecurity: z.boolean().optional(),
  panelBudgets: z.object({
    maxMembersPerDay: z.number().int().positive(),
    maxPanelRows: z.number().int().positive(),
  }),
  errorCodes: z.string().array(),
});
export type StrategyVersionFirstLimitPoolDetailDto = z.infer<
  typeof strategyVersionFirstLimitPoolDetailSchema
>;

export const strategyVersionStudyAnnotationSchema = z.object({
  familyId: z.string().min(1),
  familyLabel: z.string().min(1),
  studyStage: z.string().min(1),
  keyDifference: z.string().min(1),
  observedResult: z.string().min(1),
  signals: strategyVersionStudySignalSchema.array(),
  minuteFields: strategyVersionStudyMinuteFieldSchema.array(),
  familyDirectory: strategyVersionStudyFamilySchema.array(),
  /** 首板股票池族专用声明面；旧事件窗 3F 族与历史对照族为 null。 */
  firstLimitPool: strategyVersionFirstLimitPoolDetailSchema.nullable().default(null),
  caution: z.string().nullable(),
});
export type StrategyVersionStudyAnnotationDto = z.infer<
  typeof strategyVersionStudyAnnotationSchema
>;

export const strategyVersionCatalogRowSchema = z.object({
  strategyId: z.string().min(1),
  version: z.string().min(1),
  isStarred: z.boolean(),
  versionStatus: z.string().nullable(),
  versionCreatedAt: z.string().nullable(),
  fingerprint: z.string().nullable(),
  parentVersionId: z.number().int().positive().nullable(),
  /**
   * 父版本号（由 `parentVersionId` 解析得到）。父版本行缺失 / 不可解析时为 null，
   * 调用方必须按「无父」处理，不得据此伪造父子关系。
   */
  parentVersion: z.string().min(1).nullable(),
  description: z.string().nullable(),
  datasetVersion: z.string().nullable(),
  datasetVersionId: z.number().int().positive().nullable(),
  archiveId: z.number().int().positive().nullable(),
  runId: z.string().nullable(),
  archiveCreatedAt: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  backtestStatus: z.string().nullable(),
  totalReturnPct: z.number().nullable(),
  maxDrawdownPct: z.number().nullable(),
  cagrPct: z.number().nullable(),
  /** 最新留档的覆盖广度 / 重复度（历史行缺失为 null）。 */
  tradedInstrumentCount: z.number().int().nonnegative().nullable(),
  repeatTradeRatioPct: z.number().nullable(),
  maxTradesPerInstrument: z.number().int().nonnegative().nullable(),
  longestReentryChainLength: z.number().int().nonnegative().nullable(),
  study: strategyVersionStudyAnnotationSchema.nullable(),
});
export type StrategyVersionCatalogRowDto = z.infer<
  typeof strategyVersionCatalogRowSchema
>;

export const strategyVersionCatalogSchema =
  strategyVersionCatalogRowSchema.array();
export type StrategyVersionCatalogDto = z.infer<
  typeof strategyVersionCatalogSchema
>;

// ---------------------------------------------------------------------------
// 注册模式族配置（服务端 materialize，前端只提交参数值）
// ---------------------------------------------------------------------------

export const strategyFamilyParameterValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
]);

export const strategyFamilyParameterDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["number", "boolean", "string"]),
  defaultValue: strategyFamilyParameterValueSchema,
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  description: z.string(),
});

export const strategyFamilyDefinitionSchema = z.object({
  familyId: z.string().min(1),
  label: z.string().min(1),
  strategyType: z.string().min(1),
  baseStrategyId: z.string().min(1),
  baseVersion: z.string().min(1),
  baseArmId: z.string().min(1),
  parameters: strategyFamilyParameterDefinitionSchema.array(),
});
export type StrategyFamilyDefinitionDto = z.infer<
  typeof strategyFamilyDefinitionSchema
>;

export const materializeStrategyFamilyInputSchema = z.object({
  familyId: z.string().min(1),
  strategyId: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  datasetVersionId: z.number().int().positive(),
  datasetLabel: z.string().min(1),
  parameters: z.record(z.string(), strategyFamilyParameterValueSchema),
});
export type MaterializeStrategyFamilyInputDto = z.infer<
  typeof materializeStrategyFamilyInputSchema
>;

export const createStrategyFromFamilyInputSchema =
  materializeStrategyFamilyInputSchema;
export type CreateStrategyFromFamilyInputDto = z.infer<
  typeof createStrategyFromFamilyInputSchema
>;

// ---------------------------------------------------------------------------
// SCOPE-002 — 策略创作工作台（strategyDomain.authoring.*）
// ---------------------------------------------------------------------------

/** 作者面槽位（与 `server/research/strategyAuthoring/presetRegistry.ts` 的枚举逐字一致）。 */
export const strategyAuthoringSlotSchema = z.enum([
  "RECIPE",
  "EXIT_POLICY",
  // ③ 仓位 / ④ 成本与成交：**字段补丁**预设（写草稿字段，不是 canonical payload）
  "POSITION",
  "COST",
  "EXIT_BASE",
  "STOP",
  "TAKE_PROFIT",
  "TIME_EXIT",
  "STRONG_HOLD",
  "CAPITAL_RECYCLE",
  "RUNNER_BRIDGE",
]);
export type StrategyAuthoringSlotDto = z.infer<typeof strategyAuthoringSlotSchema>;

export const strategyPresetParameterValueSchema = z.union([z.number(), z.boolean(), z.string()]);
export type StrategyPresetParameterValueDto = z.infer<typeof strategyPresetParameterValueSchema>;

/**
 * FE-PLAN-004 —— 退出政策的 **9 个规则槽**（传输层字面量）。
 *
 * 🔴 与 `server/research/strategyAuthoring/exitPolicySlots.ts#EXIT_POLICY_SLOT_IDS`
 *    **逐字同序**，由 `tests/server/research/strategyAuthoring/exitPolicySlotsContract.test.ts`
 *    断言相等 —— 与生命周期状态同款的"防静默漂移"手法。
 */
export const exitPolicySlotIdSchema = z.enum([
  "ANCHOR",
  "TAKE_PROFIT",
  "TIME_EXIT",
  "CONFIRMATION",
  "ESCALATION",
  "SCHEDULE",
  "REDUCTION",
  "STRONG_HOLD",
  "RESEARCH",
]);
export type ExitPolicySlotIdDto = z.infer<typeof exitPolicySlotIdSchema>;

/**
 * 应用一个退出政策槽的入参。
 *
 * 🔴 `policy` 用 `z.unknown()` **透传**：它的语义权威是服务端的
 *    `ExitPolicyDefinition` 校验器，shared 层复制一份 schema 只会造成双份口径漂移
 *    （与 StrategyDocument 的处理一致）。服务端在 `applyExitPolicySlot` 里复核。
 */
export const applyExitPolicySlotInputSchema = z.object({
  policy: z.unknown(),
  slotId: exitPolicySlotIdSchema,
  optionId: z.string().min(1, "optionId 必填"),
  parameters: z.record(z.string(), strategyPresetParameterValueSchema),
});
export type ApplyExitPolicySlotInputDto = z.infer<typeof applyExitPolicySlotInputSchema>;

/** A2 `getBlankDraft` 输入：可选绑定 Dataset Version（不传 = 未绑定骨架）。 */
export const strategyAuthoringBlankInputSchema = z.object({
  datasetVersionId: z.number().int().positive().optional(),
});
export type StrategyAuthoringBlankInputDto = z.infer<typeof strategyAuthoringBlankInputSchema>;

/** A3 `materializePreset` 输入。 */
export const materializeStrategyPresetInputSchema = z.object({
  slot: strategyAuthoringSlotSchema,
  presetId: z.string().min(1, "presetId 必填"),
  parameters: z.record(z.string(), strategyPresetParameterValueSchema),
});
export type MaterializeStrategyPresetInputDto = z.infer<
  typeof materializeStrategyPresetInputSchema
>;

/**
 * A5 `saveDraft` 输入。
 *
 * `origin` 只做**审计**：记录本稿由哪条路径产生、用过哪些预设（含预设版本，裁定 Q5）。
 * 🔴 它**不进 `definition`**，因此不影响策略指纹。
 */
export const strategyAuthoringDraftOriginSchema = z.object({
  kind: z.literal("BLANK_CANONICAL"),
  presetRefs: z.array(z.object({
    slot: strategyAuthoringSlotSchema,
    presetId: z.string().min(1),
    presetVersion: z.string().min(1),
    parameters: z.record(z.string(), strategyPresetParameterValueSchema),
  })),
});
export type StrategyAuthoringDraftOriginDto = z.infer<
  typeof strategyAuthoringDraftOriginSchema
>;

export const saveStrategyAuthoringDraftInputSchema = z.object({
  document: strategyDocumentSchema,
  origin: strategyAuthoringDraftOriginSchema,
});
export type SaveStrategyAuthoringDraftInputDto = z.infer<
  typeof saveStrategyAuthoringDraftInputSchema
>;

/** A4 `previewDocument` 输入（只做校验与缺口展示，不落库）。 */
export const previewStrategyAuthoringDocumentInputSchema = z.object({
  document: strategyDocumentSchema,
});
export type PreviewStrategyAuthoringDocumentInputDto = z.infer<
  typeof previewStrategyAuthoringDocumentInputSchema
>;

/** 按 (strategyId, version) 加载指定版本。 */
export const strategyLoadVersionInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
  version: z.string().min(1, "version 必填（semver x.y.z）"),
});
export type StrategyLoadVersionInput = z.infer<
  typeof strategyLoadVersionInputSchema
>;

/** 基于最新版本创建新版本（bump 可选，缺省由内容差异自动判定）。 */
export const strategyCreateVersionInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
  document: strategyDocumentSchema,
  bump: z.enum(["major", "minor", "patch"]).optional(),
});
export type StrategyCreateVersionInput = z.infer<
  typeof strategyCreateVersionInputSchema
>;

// ---------------------------------------------------------------------------
// research · lifecycle（STEP 21 · 策略生命周期）
// ---------------------------------------------------------------------------

/**
 * §23 生命周期状态（传输层字面量）。
 * 必须与后端 `STRATEGY_LIFECYCLE_STATUSES` 完全一致，由契约单测断言守护。
 */
export const STRATEGY_LIFECYCLE_STATUS_VALUES = [
  "Draft",
  "Research",
  "Candidate",
  "Validated",
  "Paper",
  "Approved",
  "Production",
  "Retired",
] as const;

export const strategyLifecycleStatusSchema = z.enum(
  STRATEGY_LIFECYCLE_STATUS_VALUES
);
export type StrategyLifecycleStatusValue =
  (typeof STRATEGY_LIFECYCLE_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// research · strategy（STEP STRATEGY-003 / 004 · 按源版本 clone / 版本状态迁移）
// ---------------------------------------------------------------------------
// 说明：这两组 schema 放在生命周期状态常量之后，因为它们复用 `STRATEGY_LIFECYCLE_STATUS_VALUES`
// 作为版本状态的单一字面量来源（避免在前端再维护一份八态枚举）。

/**
 * 按**指定源版本** clone（SPEC §13：源版本可以是任意历史版本，不限于 latest）。
 * 写操作 → 后端 adminProcedure。
 */
export const strategyCloneVersionInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
  fromVersion: z.string().min(1, "fromVersion 必填（semver x.y.z）"),
  targetVersion: z
    .string()
    .min(1, "targetVersion 需为 semver x.y.z")
    .optional(),
  bump: z.enum(["major", "minor", "patch"]).optional(),
  description: z.string().max(512).optional(),
  status: strategyLifecycleStatusSchema.optional(),
});
export type StrategyCloneVersionInput = z.infer<
  typeof strategyCloneVersionInputSchema
>;

/**
 * 版本生命周期状态迁移（STRATEGY-003 唯一允许的 UPDATE；内容仍不可变）。
 * 写操作 → 后端 adminProcedure。
 */
export const strategySetVersionStatusInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
  version: z.string().min(1, "version 必填（semver x.y.z）"),
  status: strategyLifecycleStatusSchema,
});
export type StrategySetVersionStatusInput = z.infer<
  typeof strategySetVersionStatusInputSchema
>;

/** 版本星标：用户标记有价值的版本（仅展示元数据；不改变版本内容）。 */
export const strategySetVersionStarredInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
  version: z.string().min(1, "version 必填（semver x.y.z）"),
  isStarred: z.boolean(),
});
export type StrategySetVersionStarredInput = z.infer<
  typeof strategySetVersionStarredInputSchema
>;

/** StrategyLifecycleRecord 传输层透传（校验由后端 assertValidStrategyLifecycleRecord 负责）。 */
export const strategyLifecycleRecordSchema = z.custom<Record<string, unknown>>(
  value => typeof value === "object" && value !== null && !Array.isArray(value),
  { message: "StrategyLifecycleRecord 缺失或非对象" }
);

/**
 * 证据引用：**透传**。
 * 后端 `LifecycleEvidenceRef` 是 union（不同 kind 有各自必填字段），
 * 结构校验由后端 gates/checkers 权威判定；shared 层不复制该 union，避免双份漂移。
 */
export const lifecycleEvidenceRefSchema = z.record(z.string(), z.unknown());

export const lifecycleTransitionInputSchema = z.object({
  to: strategyLifecycleStatusSchema,
  /** 迁移时间（ISO-8601）。 */
  timestamp: z.string().min(1, "timestamp 必填"),
  /** 迁移原因（§23 四要素之一，必填非空）。 */
  reason: z.string().min(1, "reason 必填（§23 四要素）"),
  experimentId: z.string().nullish(),
  evidence: z.array(lifecycleEvidenceRefSchema).optional(),
  actor: z.string().nullish(),
});

export const lifecycleTransitionCallSchema = z.object({
  record: strategyLifecycleRecordSchema,
  input: lifecycleTransitionInputSchema,
});

export type LifecycleTransitionCall = z.infer<
  typeof lifecycleTransitionCallSchema
>;

// ---------------------------------------------------------------------------
// FE-0 扩展 — 研究 run 目录与就绪探测（只读，供 FE-4 运行工作台 / FE-5 就绪门）
//
// 纪律：
//   - **只读探测**：catalog = 已注册研究策略元数据（无执行、无状态变更）；
//     readiness = dataset gate 认证快照 + 注册策略 + 执行器绑定状态的合成判定，
//     绝不发起回测、绝不产生 run 记录；
//   - **不冒充 READY**：真实执行链（研究回测执行 + 数据 loader 装配）未绑定前
//     executorBound=false 恒定，readiness 老实给 BLOCKED（对应 closedLoop 的
//     CL_DATA_NOT_INJECTED / CL_DATASET_GATE_NOT_PASS 语义），数据认证完成后
//     由后端翻转为 true，前端无需改动；
//   - **决策时点值域对齐后端**：DecisionPoint = "close" | "open"（server/data/series.ts）。
//     此处用 enum 与后端单一事实来源保持同构；若后端扩展须同步此枚举。
// ---------------------------------------------------------------------------

/** 目录条目：已注册研究策略的轻量元数据（不含参数明细，避免 payload 膨胀）。 */
export const researchCatalogItemSchema = z.object({
  strategyId: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  requiredData: z.array(z.string()),
  requiredFeatures: z.array(z.string()),
  decisionPoint: z.enum(["close", "open"]),
  tags: z.array(z.string()).optional(),
  parameterCount: z.number().int().nonnegative(),
});
export type ResearchCatalogItem = z.infer<typeof researchCatalogItemSchema>;

/** dataset gate 认证摘要（由 research_ready_gate.json 派生；证据缺失时如实给 error）。 */
export const researchDatasetGateSummarySchema = z.object({
  researchReady: z.boolean(),
  capturedAt: z.string().nullish(),
  passCount: z.number().int(),
  pendingCount: z.number().int(),
  failCount: z.number().int(),
  pendingChecks: z.array(z.string()),
  evidenceAvailable: z.boolean(),
  evidenceError: z.string().nullish(),
});
export type ResearchDatasetGateSummary = z.infer<
  typeof researchDatasetGateSummarySchema
>;

/**
 * 运行就绪判定（v1）。
 * 阻塞主因优先级：EVIDENCE_MISSING > DATASET_NOT_READY > STRATEGIES_MISSING > EXECUTOR_NOT_BOUND。
 * canRun=true 仅当证据存在、数据认证通过、策略已注册、执行器已绑定四者同时成立。
 */
export const RESEARCH_RUN_READINESS_VALUES = [
  "READY_TO_RUN",
  "EVIDENCE_MISSING",
  "DATASET_NOT_READY",
  "STRATEGIES_MISSING",
  "EXECUTOR_NOT_BOUND",
] as const;
export const researchRunReadinessVerdictSchema = z.enum(
  RESEARCH_RUN_READINESS_VALUES
);
export type ResearchRunReadinessVerdict = z.infer<
  typeof researchRunReadinessVerdictSchema
>;

// ---------------------------------------------------------------------------
// 闭环装配摘要（FE-4 · 与 readiness 同源）
// ---------------------------------------------------------------------------

/**
 * 闭环 14 阶段 id（传输层字面量）。
 * 必须与后端 `CLOSED_LOOP_STAGE_IDS` 完全一致，由契约单测断言守护。
 */
export const CLOSED_LOOP_STAGE_ID_VALUES = [
  "data",
  "research",
  "strategy",
  "backtest",
  "evaluation",
  "optimization",
  "robustness",
  "oos",
  "overfitting",
  "regime",
  "paper",
  "review",
  "discipline",
  "finalize",
] as const;

export const closedLoopStageIdSchema = z.enum(CLOSED_LOOP_STAGE_ID_VALUES);
export type ClosedLoopStageIdValue =
  (typeof CLOSED_LOOP_STAGE_ID_VALUES)[number];

/**
 * 闭环装配覆盖率摘要（`assessClosedLoopWiringCoverage` 的传输层投影）。
 * `wiredStages` = 本层已装配真实执行器的阶段（静态能力）；
 * `coveredStages` = 给定入参下真正可覆盖的阶段（能力 ∧ 入参）。
 */
export const closedLoopWiringSummarySchema = z.object({
  requestedStages: z.array(closedLoopStageIdSchema),
  wiredStages: z.array(z.string()),
  unwiredStages: z.array(z.string()),
  coveredStages: z.array(closedLoopStageIdSchema),
  uncoveredStages: z.array(closedLoopStageIdSchema),
  executorBound: z.boolean(),
});
export type ClosedLoopWiringSummary = z.infer<
  typeof closedLoopWiringSummarySchema
>;

export const researchRunReadinessSchema = z.object({
  canRun: z.boolean(),
  verdict: researchRunReadinessVerdictSchema,
  /** 全部阻塞原因（人类可读，按优先级排序；READY_TO_RUN 时为空数组）。 */
  reasons: z.array(z.string()),
  datasetGate: researchDatasetGateSummarySchema.nullish(),
  /** 已注册研究策略轻量目录（与 catalog.list 同构）。 */
  strategies: z.array(researchCatalogItemSchema),
  /**
   * 真实执行链是否已绑定。
   * **真实探测**（不再硬编码）：由 `assessClosedLoopWiringCoverage` 计算——仅当被请求的
   * 整条链的每个阶段都有「已装配执行器 ∧ 入参来源成立」时才为 true。任一段无执行器或
   * 入参不可得 → false，并按 `wiring` 如实列出缺口阶段。
   */
  executorBound: z.boolean(),
  /** 闭环装配覆盖率明细（诊断用；与 executorBound 同一事实来源）。 */
  wiring: closedLoopWiringSummarySchema,
});

// ---------------------------------------------------------------------------
// research · chain health（STEP 0-3 · RESEARCH-CHAIN-HEALTH-001）
// ---------------------------------------------------------------------------

/**
 * 研究链七环计数（与 `server/researchChainHealth.ts` 1:1）。
 *
 * 契约单测（`tests/researchChainHealth.test.ts`）断言二者形状一致，
 * **禁止漂移** —— 体检的全部价值在于「读数可信」。
 */
export const researchChainHealthCountsSchema = z.object({
  questions: z.number().int().nonnegative(),
  plans: z.number().int().nonnegative(),
  hypotheses: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  analyses: z.number().int().nonnegative(),
  results: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  conclusions: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
});

export const researchChainExperimentSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string(),
  researchType: z.string(),
  datasetVersionId: z.number().int(),
  sampleCount: z.number().int().nullable(),
  createdAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const researchChainLatestRunSchema = z.object({
  id: z.number().int().positive(),
  runNo: z.number().int(),
  status: z.string(),
  createdAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

/**
 * 研究链体检结果（**只读**；`gaps` 为空数组 = 七环齐全且已产出结果）。
 *
 * `experiment` 为 null 表示实验不存在 —— **不伪造空链**，调用方据此提示「实验不存在」。
 */
export const researchChainHealthSchema = z.object({
  experimentId: z.number().int().positive(),
  experiment: researchChainExperimentSummarySchema.nullable(),
  counts: researchChainHealthCountsSchema,
  /** Run 状态分布（如 `{ COMPLETED: 9, FAILED: 1 }`）。 */
  runByStatus: z.record(z.string(), z.number()),
  /** Analysis 状态分布。 */
  analysisByStatus: z.record(z.string(), z.number()),
  latestRun: researchChainLatestRunSchema.nullable(),
  /** 断环清单（人读；只依赖「计数为 0」与「存在未终态」，不引入新阈值）。 */
  gaps: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// research · metrics（FE-5 · C-16.1 / C-16.2 / C-16.3 绩效评估）
// ---------------------------------------------------------------------------

/**
 * 权益点（传输层，1:1 对应 server/backtest/types.ts EquityPoint）。
 * 由契约单测断言守护，禁止与后端字段漂移。
 */
export const equityPointSchema = z.object({
  date: z.string().min(1, "date 必填（YYYY-MM-DD）"),
  cash: z.number(),
  marketValue: z.number(),
  equity: z.number(),
  openPositions: z.number(),
});

/**
 * 交易生命周期（传输层，1:1 对应 server/backtest/types.ts Trade）。
 * 由契约单测断言守护，禁止与后端字段漂移。
 */
export const tradeSchema = z.object({
  securityId: z.string(),
  entryTime: z.string(),
  entryPrice: z.number(),
  exitTime: z.string().nullable(),
  exitPrice: z.number().nullable(),
  quantity: z.number(),
  grossPnL: z.number().nullable(),
  fees: z.number(),
  slippageAmount: z.number(),
  netPnl: z.number().nullable(),
  returnPct: z.number().nullable(),
  holdingPeriod: z.number().nullable(),
  openAtEnd: z.boolean(),
  reason: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
});

export type EquityPointInput = z.infer<typeof equityPointSchema>;
export type TradeInput = z.infer<typeof tradeSchema>;

/**
 * 绩效评估输入：equityCurve（必需）+ trades（可选）+ 三套口径参数。
 * 三套指标（C-16.1 收益/风险/回撤、C-16.2 风险调整、C-16.3 交易质量）共享同一
 * equityCurve/trades 输入，一次性求值；口径参数各自缺省时由后端默认值回灌。
 */
export const metricsEvaluateInputSchema = z.object({
  /** 逐模拟交易日收盘权益点（升序，每点一个交易日）。 */
  equityCurve: z.array(equityPointSchema).min(1, "equityCurve 至少 1 点"),
  /** 全部交易生命周期（可省略；省略时 C-16.3 交易质量指标为 null）。 */
  trades: z.array(tradeSchema).optional(),
  /** 年化交易日数（默认 252）。 */
  annualizationFactor: z.number().positive().optional(),
  /** 回撤剖面过滤阈值（%，默认 5）。 */
  drawdownThresholdPct: z.number().min(0).optional(),
  /** 下行偏差目标日收益（小数，默认 0）。 */
  downsideTarget: z.number().optional(),
  /** 无风险年利率（%，默认 0；C-16.2 Sharpe/Sortino 用）。 */
  rfAnnualPct: z.number().optional(),
});

export type MetricsEvaluateInput = z.infer<typeof metricsEvaluateInputSchema>;

// ---------------------------------------------------------------------------
// FE-4 扩展 — 闭环运行请求 / 结果（真实执行，可复现）
//
// 纪律：
//   - **本层不伪造入参**：`loopRun` 只接受调用方显式声明的真实入参（权益曲线 / 上游交接
//     种子 / 生命周期意图）。拿不到的入参一律不注入 → 对应阶段由编排器如实 BLOCKED，
//     绝不返回占位产物；
//   - **无状态**：`loopRun` 不写库、不产生 run 记录持久化，只返回一次真实执行的完整轨迹
//     （含链指纹），由调用方决定是否落账；
//   - **可复现**：`runId` / `createdAt` 可由调用方注入；稳定输入 → 稳定 `chainFingerprint`。
// ---------------------------------------------------------------------------

/** 日期窗口（闭区间）。 */
export const closedLoopDateRangeSchema = z.object({
  startDate: z.string().min(1, "startDate 必填"),
  endDate: z.string().min(1, "endDate 必填"),
});

/**
 * backtest 阶段交接种子（subset 链场景：调用方已持有真实回测摘要，不想重跑 backtest）。
 * 每个数字都必须来自一次真实回测——本层只做透传，不做任何派生/推算。
 */
export const closedLoopBacktestSummarySeedSchema = z.object({
  /** 产生该摘要的模块名（默认 simulator）。 */
  module: z.string().min(1).default("simulator"),
  /** 该回测产物的内容指纹（sha256 hex）——将作为 evaluation 的 backtestFingerprint 绑定依据。 */
  fingerprint: z.string().min(1, "fingerprint 必填（回测产物指纹）"),
  /** 是否合成产物（合成摘要不得与真实结论混淆）。 */
  synthetic: z.boolean().default(false),
  datasetVersion: z.string().min(1),
  datasetGate: z.string().min(1),
  dateRange: closedLoopDateRangeSchema,
  initialCapital: z.number(),
  finalEquity: z.number(),
  decisionDayCount: z.number().int().nonnegative(),
  equityCurvePointCount: z.number().int().nonnegative(),
  tradeCount: z.number().int().nonnegative(),
});
export type ClosedLoopBacktestSummarySeed = z.infer<
  typeof closedLoopBacktestSummarySeedSchema
>;

/** finalize 阶段的生命周期推进意图（复用 STEP 21 传输契约）。 */
export const closedLoopLifecycleInputSchema = z.object({
  lifecycleRecord: strategyLifecycleRecordSchema,
  transition: lifecycleTransitionInputSchema,
  allowSyntheticEvidence: z.boolean().optional(),
});
export type ClosedLoopLifecycleInput = z.infer<
  typeof closedLoopLifecycleInputSchema
>;

/**
 * 运行工作台 — 本次运行的**运行期覆写**（`useRealData=true` 时生效）。
 *
 * 存在的理由：单策略回测要能在前端改「初始资金 / 成本口径 / 持仓上限 / 执行模型 / 参数」，
 * 而这些在策略文档里都有默认声明。覆写必须**显式声明**并进入运行记录，
 * 否则「界面上改了、实际按文档默认跑」会变成静默口径漂移。
 *
 * 优先级（装配层实现）：系统默认 < 策略文档声明 < **本对象**。
 * 未提供的字段一律取策略文档声明，不做任何猜测补齐。
 */
export const closedLoopRuntimeConfigSchema = z.object({
  /** 初始资金（> 0）；缺省 = 策略文档 `executionAssumptions.backtestConfig.initialCapital`。 */
  initialCapital: z.number().positive().optional(),
  /** 最大持仓数（>= 1 整数）；缺省 = 策略文档声明。 */
  maxPositions: z.number().int().positive().optional(),
  /** 单日最多新建仓数（>= 1 整数）；缺省 = 策略文档声明。 */
  maxDailyBuys: z.number().int().positive().optional(),
  /** 佣金费率（双边）；缺省 = 策略文档 `costModel.commissionRate`。 */
  commissionRate: z.number().min(0).optional(),
  /** 印花税（仅卖出）；缺省 = 策略文档声明。 */
  stampDutyRate: z.number().min(0).optional(),
  /** 过户费（双边）；缺省 = 策略文档声明。 */
  transferFeeRate: z.number().min(0).optional(),
  /** 滑点（bps）；缺省 = 策略文档声明。 */
  slippageBps: z.number().min(0).optional(),
  /** 执行模型（NEXT_OPEN / NEXT_CLOSE / VWAP_PROXY / LIMIT_PRICE）；缺省 = 策略文档声明。 */
  executionModel: z.string().min(1).optional(),
  /**
   * 参数覆写（键必须存在于策略文档 `parameters`，否则装配层响亮拒绝）。
   * 缺省 = 全部取各参数 `defaultValue`。
   */
  parameterOverrides: z.record(z.string(), z.unknown()).optional(),
});
export type ClosedLoopRuntimeConfig = z.infer<
  typeof closedLoopRuntimeConfigSchema
>;

/**
 * 闭环运行请求（FE-4）。
 *
 * 未提供的入参 = 该阶段入参不可得 → 对应阶段不会被注册执行器，编排器如实 BLOCKED。
 * 这保证「UI 上点运行」永远不会得到一份凭空捏造的全绿结果。
 */
export const closedLoopRunInputSchema = z.object({
  /** run id（缺省由 createdAt 派生，保证同 createdAt → 同 runId）。 */
  runId: z.string().min(1).optional(),
  /** 创建时间（ISO-8601；缺省取服务端当前时间）。 */
  createdAt: z.string().min(1).optional(),
  experimentId: z.string().min(1, "experimentId 必填（§28 谱系锚点）"),
  strategyId: z.string().min(1, "strategyId 必填"),
  strategyVersion: z.string().min(1).default("1.0.0"),
  dateRange: closedLoopDateRangeSchema,
  datasetVersion: z.string().nullish(),
  universeVersion: z.string().nullish(),
  codeVersion: z.string().nullish(),
  executionModel: z.string().nullish(),
  parameterSet: z.record(z.string(), z.unknown()).optional(),
  /**
   * 运行工作台「真实跑通」开关（FE-4 扩展）。
   *
   * `true` = 服务端按 `dateRange` **真实构建** ResearchDataset、真实读取
   * `strategyId@strategyVersion` 的策略文档、并据此装配 data / research / backtest /
   * evaluation / regime 五阶段的真实入参（见 `server/runWorkbenchAssembly/`）。
   *
   * 纪律：这是**唯一**允许服务端自行装配入参的开关；关闭（缺省）时行为与既有
   * 完全一致 —— 只注入调用方显式声明的入参，拿不到的一律 BLOCKED。
   * 装配任何一环失败（策略文档缺失 / recipe 未注册 / 成本模型缺失等）→ 抛错并附
   * 稳定错误码，**绝不**降级为「假装跑过」。
   */
  useRealData: z.boolean().optional(),
  /**
   * 数据集构建护栏（仅 `useRealData=true` 时生效；对齐 `researchDataset.build` 选项）。
   *
   * 用途：先小步验证链路（如 10 个交易日 × 200 只证券）再放大 —— 真实全窗口构建在
   * 跨境库上可能很慢。**不得**用护栏值冒充「全量已验证」。
   */
  datasetGuards: z
    .object({
      dataReady: z.boolean().optional(),
      maxTradingDays: z.number().int().positive().optional(),
      maxSecuritiesPerDay: z.number().int().positive().optional(),
    })
    .optional(),
  /**
   * 显式指定的执行配方 id（仅策略文档没有 `recipe` 时生效；见 `recipeRegistry`）。
   * 缺省 → 服务端用显式声明的默认配方常量，并把事实写进 `assembly.recipeSource`。
   */
  recipeId: z.string().min(1).optional(),
  /** 阶段选择（缺省 = canonical 全 14 阶段；必须为保序子集）。 */
  stageIds: z.array(closedLoopStageIdSchema).optional(),
  /**
   * 运行期覆写（初始资金 / 成本 / 持仓上限 / 执行模型 / 参数）。
   * 仅 `useRealData=true` 时由装配层消费；缺省 = 全部取策略文档声明。
   */
  runtimeConfig: closedLoopRuntimeConfigSchema.optional(),
  /** evaluation 阶段的直供入参（权益曲线 + 可选交易明细 + 口径参数）。 */
  evaluationInput: metricsEvaluateInputSchema.optional(),
  /** evaluation 阶段的上游交接种子（提供后 evaluation 可在无 backtest 阶段时执行）。 */
  backtestSummarySeed: closedLoopBacktestSummarySeedSchema.optional(),
  /** finalize 阶段生命周期推进意图。 */
  lifecycle: closedLoopLifecycleInputSchema.optional(),
});
export type ClosedLoopRunInput = z.infer<typeof closedLoopRunInputSchema>;

/** 单阶段结果（不含 lineage：lineage 为服务端内部锚点，不外传）。 */
export const closedLoopRunStageResultSchema = z.object({
  stageId: closedLoopStageIdSchema,
  state: z.enum(["READY", "EXECUTED", "BLOCKED", "SKIPPED"]),
  outputKind: z.string(),
  outputHandoffFingerprint: z.string().nullable(),
  /** 真实交接摘要（EXECUTED 才有；形状按 kind 判别，故透传）。 */
  output: z.unknown().nullable(),
  blocked: z
    .object({
      reasonCode: z.string(),
      detail: z.string(),
      upstreamStageId: z.string().nullable(),
      errorCode: z.string().nullable(),
      errorMessage: z.string().nullable(),
    })
    .nullable(),
});

export const closedLoopRunBlockedItemSchema = z.object({
  stageId: closedLoopStageIdSchema,
  reasonCode: z.string(),
  detail: z.string(),
  upstreamStageId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

/**
 * STRATEGY-ARCH-002 — 运行留档里的「策略运行记录」。
 *
 * 承载的是 Core 的 `StrategyRunSnapshot` + `StrategyDecisionDigest` + 执行元数据。
 * 落点在**既有** `closed_loop_backtest_run.resultJson`（零 schema 变更），
 * 因此这里只做**形状校验**，不引入新表 / 新列。
 */
export const strategyRunRecordSchema = z.object({
  /** 一次执行的可复现坐标（Core `StrategyRunSnapshot`）。 */
  strategyRunSnapshot: z.object({
    snapshotVersion: z.number().int().positive(),
    runId: z.string(),
    strategyId: z.string(),
    strategyVersion: z.string(),
    /** 行为级定义指纹（`computeDefinitionFingerprint`）。 */
    definitionFingerprint: z.string(),
    /** 调用方提供的原始参数（未解析）。 */
    parameterSet: z.record(z.string(), z.unknown()),
    /** 解析后的参数（含 DERIVED 结果）——复现的主判据。 */
    resolvedParameterSet: z.record(z.string(), z.unknown()),
    engineVersion: z.string(),
    codeVersion: z.string(),
    executionSemanticsVersion: z.string(),
    universe: z.object({
      universeId: z.string(),
      members: z.array(z.string()).nullable(),
    }),
    datasetReference: z
      .object({
        datasetVersionId: z.number().int().positive().nullable(),
        datasetLabel: z.string().nullable(),
        datasetSource: z.enum(["registry", "rebuild", "injected"]),
        datasetContentFingerprint: z.string().nullable(),
      })
      .nullable(),
    seed: z.number().nullable(),
    runtimeConfig: z.object({
      evaluationDate: z.string(),
      evaluationPoint: z.enum(["open", "close"]),
      currentRelativeDay: z.number().int(),
      maxRelativeDay: z.number().int(),
    }),
    createdAt: z.string(),
  }),
  /** 行为面摘要（全量计数 + 滚动指纹 + 有界样本）。 */
  strategyDecision: z.object({
    decisionCount: z.number().int().nonnegative(),
    emittedSignalCount: z.number().int().nonnegative(),
    totalSignalCount: z.number().int().nonnegative(),
    totalEventHitCount: z.number().int().nonnegative(),
    totalConditionCount: z.number().int().nonnegative(),
    totalSatisfiedConditionCount: z.number().int().nonnegative(),
    insufficientDataCount: z.number().int().nonnegative(),
    droppedNoSignalCount: z.number().int().nonnegative(),
    droppedMissingRankValueCount: z.number().int().nonnegative(),
    undecidableAnchorCount: z.number().int().nonnegative(),
    occurredEventCount: z.number().int().nonnegative(),
    notOccurredEventCount: z.number().int().nonnegative(),
    minBarCount: z.number().int().nonnegative(),
    maxBarCount: z.number().int().nonnegative(),
    maxRelativeDayObserved: z.number().int(),
    poolScoreRemovalCount: z.number().int().nonnegative().default(0),
    decisionDigestFingerprint: z.string(),
    samples: z.array(
      z.object({
        securityId: z.string(),
        tradeDate: z.string(),
        currentRelativeDay: z.number().int(),
        barCount: z.number().int().nonnegative(),
        eventCount: z.number().int().nonnegative(),
        conditionCount: z.number().int().nonnegative(),
        satisfiedConditionCount: z.number().int().nonnegative(),
        signalCount: z.number().int().nonnegative(),
        entryIntentCount: z.number().int().nonnegative(),
        insufficientData: z.boolean(),
        emitted: z.boolean(),
        rankValue: z.number().nullable(),
        explanation: z.array(z.string()),
      })
    ),
  }),
  /** 执行元数据（谁跑的 / 怎么接的）。 */
  executionMetadata: z.object({
    decisionSource: z.literal("strategy-core"),
    engineVersion: z.string(),
    codeVersion: z.string(),
    anchorPolicy: z.string(),
    notes: z.array(z.string()),
    unmappedExitRuleIds: z.array(z.string()),
  }),
});
export type StrategyRunRecordDto = z.infer<typeof strategyRunRecordSchema>;

/**
 * BACKTEST-002（B-03）— 回测结果留档载荷（**有界**：摘要 + 有界样本 + 全量指纹）。
 *
 * 🔴 与 `backtestResult.ts` 的 `BacktestRunPayload` 同形：**不重新设计结果结构**。
 * 明细刻意 `z.unknown()`（形状由 Core 侧类型约束）—— 这里只校验**必须存在的标量与指纹**，
 * 避免契约层变成第二个数据模型。
 */
export const backtestRunPayloadSchema = z.object({
  /** Canonical Metrics（唯一读数面；`NOT_AVAILABLE` 为字符串标记，不是 0）。 */
  canonicalMetrics: z.object({
    totalReturnPct: z.union([z.number(), z.literal("NOT_AVAILABLE")]),
    annualizedReturnPct: z.union([z.number(), z.literal("NOT_AVAILABLE")]),
    maxDrawdownPct: z.number(),
    tradeCount: z.number().int().nonnegative(),
    winRatePct: z.union([z.number(), z.literal("NOT_AVAILABLE")]),
    averageWinPct: z.union([z.number(), z.literal("NOT_AVAILABLE")]),
    averageLossPct: z.union([z.number(), z.literal("NOT_AVAILABLE")]),
    profitFactor: z.union([z.number(), z.literal("NOT_AVAILABLE")]),
    /** 已平仓笔数（胜率 / 盈亏比的分母；口径可辨）。 */
    completedTradeCount: z.number().int().nonnegative(),
    /** 期末未平仓笔数（不进胜率 / 盈亏比）。 */
    openAtEndCount: z.number().int().nonnegative(),
    /** BACKTEST-002（B-04）— 年化口径自述（规格 §2C）。 */
    annualizationBasis: z.object({
      type: z.literal("TRADING_DAYS"),
      daysPerYear: z.number().int().positive(),
    }),
  }),
  summary: z
    .object({
      initialCapital: z.number(),
      finalEquity: z.number(),
      totalReturnPct: z.union([z.number(), z.literal("NOT_AVAILABLE")]),
      equityPointCount: z.number().int().nonnegative(),
      tradingDayCount: z.number().int().nonnegative(),
    })
    .passthrough(),
  /** 有界样本（≤ 上限；**全量明细不进这里**）。 */
  equitySamples: z.array(z.unknown()),
  tradeSamples: z.array(z.unknown()),
  truncated: z.object({ equity: z.boolean(), trades: z.boolean() }),
  equityDigest: z.string(),
  tradeDigest: z.string(),
  notes: z.array(z.string()),
  /** 回测执行元数据（政策版本 / 成本模型 / 初始资金等）。 */
  executionMetadata: z
    .object({
      executionPolicyVersion: z.number().int().positive(),
      engineVersion: z.string(),
      codeVersion: z.string(),
      initialCapital: z.number(),
      sampleLimit: z.number().int().positive(),
      notes: z.array(z.string()),
    })
    .passthrough()
    .optional(),
});
export type BacktestRunPayloadDto = z.infer<typeof backtestRunPayloadSchema>;

/** 闭环运行结果（一次真实执行的完整可审计轨迹）。 */
export const closedLoopRunResultSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  chainFingerprint: z.string(),
  fingerprint: z.string(),
  overall: z.object({
    status: z.enum(["ALL_EXECUTED", "PARTIAL_BLOCKED", "NO_STAGE_EXECUTED"]),
    executedStageCount: z.number().int().nonnegative(),
    blockedStageCount: z.number().int().nonnegative(),
    skippedStageCount: z.number().int().nonnegative(),
    firstBlockedReasonCode: z.string().nullable(),
    synthetic: z.boolean(),
    note: z.string(),
  }),
  /** 本次真正注入执行器的阶段。 */
  runnerInjected: z.array(closedLoopStageIdSchema),
  /** 全 14 阶段记录（未请求 = SKIPPED）。 */
  stages: z.array(closedLoopRunStageResultSchema),
  blockedSummary: z.array(closedLoopRunBlockedItemSchema),
  /** 本次装配覆盖率（与 readiness.wiring 同一探测函数）。 */
  wiring: closedLoopWiringSummarySchema,
  /**
   * 本次「真实跑通」装配摘要（`useRealData=true` 且装配成功时才有；否则 null）。
   *
   * 用途：让界面能如实说明「这次跑的数据从哪来、多大规模、按什么成本口径」——
   * 没有这段，用户看到非 0 执行也无法判断数字是否可信。
   */
  assembly: z
    .object({
      datasetVersion: z.string(),
      datasetGate: z.string(),
      datasetRowCount: z.number().int().nonnegative(),
      datasetSecurityCount: z.number().int().nonnegative(),
      /**
       * 数据来源：`registry`（直读策略已绑定的 ds_* 数据集）| `rebuild`（按窗口从零重建）。
       * 界面据此如实展示「这次跑的到底是不是你绑定的那份数据」。
       */
      datasetSource: z.enum(["registry", "rebuild", "injected"]),
      /** `rebuild` 且由「直读失败」引起时的原因（否则 null）。 */
      datasetSourceNote: z.string().nullable(),
      /** 直读命中时的已落库数据集坐标（`dataset_version.id`）；重建时为 null。 */
      datasetVersionId: z.number().int().positive().nullable(),
      dateRange: closedLoopDateRangeSchema,
      strategyId: z.string(),
      strategyVersion: z.string(),
      recipeId: z.string(),
      /**
       * 配方来源（**四条**诚实路径）：`strategy-document`（文档带 recipe）|
       * `strategy-declarative-conditions`（文档无 recipe，由声明式条件现场合成）|
       * `explicit-request`（**调用方显式指定** recipeId）|
       * `default-fallback`（文档既无 recipe 又无条件 ⇒ 落到默认常量；`BD-21`）。
       *
       * 🔴 后两者必须分开：兜底曾被标成 `explicit-request` ⇒ 「系统自己顶上来」与
       * 「有人要求」在摘要里无法区分（静默换规则）。本闭集与
       * `server/runWorkbenchAssembly/assemble.ts#RecipeResolutionSource` 必须逐字一致。
       */
      recipeSource: z.enum([
        "strategy-document",
        "strategy-declarative-conditions",
        "explicit-request",
        "default-fallback",
      ]),
      recipeFeatureIds: z.array(z.string()),
      selectionSummary: z.string(),
      /**
       * STRATEGY-ARCH-002 — 本次运行的策略判定引擎。
       *
       * `strategy-core`：判定由 `StrategyRuntime.evaluate` 产出；
       * `legacy-recipe`：Core 定义无法从该文档构造 ⇒ 回落既有配方判定器（原因见下一字段）。
       */
      strategyDecisionEngine: z.enum(["strategy-core", "legacy-recipe"]),
      /** 回落原因 / 接线事实（**必填**，防「回落了但界面看不出来」）。 */
      strategyDecisionEngineNote: z.string(),
      /**
       * 本次运行**显式覆写**的字段名（形如 `initialCapital` / `costModel.slippageBps` /
       * `parameterOverrides`）。空数组 = 全部取策略文档声明。
       * 用途：让「界面上改了哪些、这次到底按什么跑的」一眼可辨，杜绝静默口径漂移。
       */
      runtimeOverrides: z.array(z.string()).optional(),
      simulation: z.object({
        initialCapital: z.number(),
        maxPositions: z.number().nullable(),
        maxDailyBuys: z.number().nullable().default(null),
        executionModel: z.string(),
        /** 成本模型六字段（口径自描述，避免界面只能显示「已配置」）。 */
        costModel: z.object({
          commissionRate: z.number(),
          stampDutyRate: z.number(),
          transferFeeRate: z.number(),
          slippageBps: z.number(),
          lotSize: z.number(),
          minCommission: z.number(),
        }),
      }),
    })
    .nullable(),
  /**
   * STRATEGY-ARCH-002 — 策略运行记录（**每次运行必留**；未接线 / 未装配时为 null）。
   *
   * 落点 = 本对象（`closed_loop_backtest_run.resultJson`），**零 schema 变更**。
   */
  strategyRun: strategyRunRecordSchema.nullable().optional(),
  /**
   * BACKTEST-002（B-03）— 回测结果留档（**有界**）。
   *
   * 与 `strategyRun` 并列，**不覆盖**后者（ARCH-002 已持久化的 StrategyRunSnapshot 保持原样）。
   * 未跑 backtest 阶段（无 `artifacts.tradeSimulationRun`）时为 null / 缺省。
   */
  backtest: backtestRunPayloadSchema.nullable().optional(),
  /** 本次运行写入「回测历史」的结果；失败时结果仍返回，但必须由页面响亮提示。 */
  persistence: z
    .object({
      persisted: z.boolean(),
      errorCode: z.string().nullable(),
      errorMessage: z.string().nullable(),
      /** 本次运行写入的留档行 id（`persisted=false` 时为 null）。 */
      archiveId: z.number().int().positive().nullable().optional(),
    })
    .optional(),
});
export type ClosedLoopRunResult = z.infer<typeof closedLoopRunResultSchema>;

// ---------------------------------------------------------------------------
// 多版本回测对比（单策略 · 多版本 · 各自独立账户）
//
// 定位：让前端**不依赖 AI** 就能对同一策略的多个版本跑同一份运行配置，
// 得到可复现的指标对比。语义纪律：
//   - **各自独立**：每个版本跑一次独立的闭环运行（独立 experimentId / runId），
//     不做共享账户 / 组合持仓 —— 组合属于另一个功能域；
//   - **同一份口径**：所有版本共享同一 dateRange / runtimeConfig；
//   - **单版本失败不连坐**：某个版本装配/执行失败时，其余版本照常返回，
//     失败版本以 `failure` 如实标注（绝不静默丢弃）。
// ---------------------------------------------------------------------------

/** 多版本对比入参（版本 ≥ 2 才有对比意义；上限 10 防止误触发长任务风暴）。 */
export const compareStrategyVersionsInputSchema = z.object({
  /** 谱系锚点（缺省由服务端按 strategyId + 窗口 + 首个版本确定性派生）。 */
  experimentId: z.string().min(1).optional(),
  strategyId: z.string().min(1, "strategyId 必填"),
  strategyVersions: z
    .array(z.string().min(1))
    .min(2, "至少选择 2 个版本进行对比")
    .max(10, "一次最多对比 10 个版本"),
  dateRange: closedLoopDateRangeSchema,
  /** 所有版本共享的运行期覆写。 */
  runtimeConfig: closedLoopRuntimeConfigSchema.optional(),
  /** 显式指定的执行配方 id（仅策略文档没有 `recipe` 时生效）。 */
  recipeId: z.string().min(1).optional(),
  /** 数据集构建护栏（对齐 `loopRun.datasetGuards`）。 */
  datasetGuards: z
    .object({
      dataReady: z.boolean().optional(),
      maxTradingDays: z.number().int().positive().optional(),
      maxSecuritiesPerDay: z.number().int().positive().optional(),
    })
    .optional(),
  codeVersion: z.string().nullish(),
});
export type CompareStrategyVersionsInput = z.infer<
  typeof compareStrategyVersionsInputSchema
>;

/** 单个版本的运行结果（成功 / 失败都如实返回）。 */
export const strategyVersionRunOutcomeSchema = z.object({
  strategyVersion: z.string(),
  /** 本次运行的 runId（失败时仍返回，便于在日志 / 留档里定位）。 */
  runId: z.string(),
  /** 该版本的留档行 id；落库失败或运行失败时为 null（错误见 `persistence` / `failure`）。 */
  archiveId: z.number().int().positive().nullable(),
  /** `ALL_EXECUTED` / `PARTIAL_BLOCKED` / `NO_STAGE_EXECUTED`；运行失败为 `FAILED`。 */
  status: z.string(),
  /** 运行失败时的稳定错误码 + 人话（成功为 null）。 */
  failure: z.object({ code: z.string(), message: z.string() }).nullable(),
  /** 完整运行结果（失败时为 null）。 */
  result: closedLoopRunResultSchema.nullable(),
});
export type StrategyVersionRunOutcome = z.infer<
  typeof strategyVersionRunOutcomeSchema
>;

/** 多版本对比结果。 */
export const compareStrategyVersionsOutputSchema = z.object({
  comparisonId: z.string().min(1),
  createdAt: z.string(),
  strategyId: z.string(),
  dateRange: closedLoopDateRangeSchema,
  /** 本次对比统一的运行期覆写（如实回显；未覆写为空对象）。 */
  runtimeConfig: closedLoopRuntimeConfigSchema,
  /** 按请求顺序返回每个版本的结果。 */
  entries: z.array(strategyVersionRunOutcomeSchema),
});
export type CompareStrategyVersionsOutput = z.infer<
  typeof compareStrategyVersionsOutputSchema
>;

// ---------------------------------------------------------------------------
// CLOSED-LOOP-BACKTEST-PERSIST-001 — 闭环回测留档（历史列表 / 详情）
//
// 与 `closedLoopRunResultSchema` 的关系：那张是**一次运行的完整可审计轨迹**（重、含明细），
// 这里是**它的留档条目**（轻摘要 + 可选的完整结果）。二者不可互相替代：
// 列表页只读前者派生的摘要，详情页才加载完整轨迹。
// ---------------------------------------------------------------------------

/**
 * 留档条目的展示字段（列表页与详情页头部共用；**不含**长文本结果）。
 *
 * 字段与 `closed_loop_backtest_run` 的结构化列一一对应；`null` 表示「本次确实没有这个量」
 * （例如 backtest 阶段被阻塞 ⇒ 没有期末权益），**不是 0**。
 */
/**
 * BREADTH-001 — 回测覆盖广度 / 重复买入 / 连续链诊断指标。
 *
 * 全部为**投影计数**（直接由真实成交明细与权益曲线算出）；成交明细被截断或无成交时整体为
 * null —— 绝不按截断样本低报「重复很少」。
 */
export const breadthMetricsSchema = z.object({
  tradedInstrumentCount: z.number().int().nonnegative().nullable(),
  tradedIdentityCount: z.number().int().nonnegative().nullable(),
  repeatTradeCount: z.number().int().nonnegative().nullable(),
  repeatTradeRatioPct: z.number().nullable(),
  maxTradesPerInstrument: z.number().int().nonnegative().nullable(),
  sameCodeOverlapPairCount: z.number().int().nonnegative().nullable(),
  longestReentryChainLength: z.number().int().nonnegative().nullable(),
  chainTradeRatioPct: z.number().nullable(),
  immediateReentryCount: z.number().int().nonnegative().nullable(),
  medianReentryGapTradingDays: z.number().nullable(),
  maxReentryGapTradingDays: z.number().nullable(),
});
export type BreadthMetricsDto = z.infer<typeof breadthMetricsSchema>;

export const closedLoopBacktestRunRecordSchema = z.object({
  id: z.number().int().positive(),
  runId: z.string().min(1),
  /** 留档时间（ISO-8601，UTC）。 */
  createdAt: z.string(),
  experimentId: z.string(),
  strategyId: z.string(),
  strategyVersion: z.string(),
  /**
   * 该版本是否已加星。
   *
   * 来源是独立的 `strategy_version_star`（`(strategyId, version)` 唯一键）；版本行是
   * 版本存在的唯一来源，星标只允许绑定正式 `strategy_versions` 坐标。
   */
  isStarred: z.boolean(),
  /** 回测窗口（含两端，YYYY-MM-DD）。 */
  startDate: z.string(),
  endDate: z.string(),
  /** 整体状态：ALL_EXECUTED / PARTIAL_BLOCKED / NO_STAGE_EXECUTED。 */
  status: z.string(),
  executedStageCount: z.number().int().nonnegative(),
  blockedStageCount: z.number().int().nonnegative(),
  skippedStageCount: z.number().int().nonnegative(),
  firstBlockedReasonCode: z.string().nullable(),
  /** Dataset label 快照（仅显示）。 */
  datasetVersion: z.string().nullable(),
  /** 真实 Dataset 坐标 → `dataset_version.id`。 */
  datasetVersionId: z.number().int().positive().nullable(),
  /** 数据来源：registry（直读已落库数据集）| rebuild（回落从零重建）。 */
  datasetSource: z.string().nullable(),
  /** 装配层如实记录的回落原因；未回落为 null。 */
  datasetSourceNote: z.string().nullable(),
  recipeId: z.string().nullable(),
  initialCapital: z.number().nullable(),
  finalEquity: z.number().nullable(),
  tradeCount: z.number().int().nullable(),
  equityCurvePointCount: z.number().int().nullable(),
  /** 最近一次回测的评估标量（卡片展示；历史摘要缺失时由服务端惰性回填）。 */
  totalReturnPct: z.number().nullable(),
  /** 最大回撤幅度（正数，%）。 */
  maxDrawdownPct: z.number().nullable(),
  /** 年化收益率（%）。 */
  cagrPct: z.number().nullable(),
  /** 覆盖广度 / 重复买入 / 连续链诊断指标（历史行缺失时由服务端惰性回填）。 */
  breadth: breadthMetricsSchema,
  /** 池化漏斗（取不到为 null）。 */
  poolMemberCount: z.number().int().nonnegative().nullable(),
  poolPeakActiveMembers: z.number().int().nonnegative().nullable(),
  poolLowScoreRemoved: z.number().int().nonnegative().nullable(),
  poolRetired: z.number().int().nonnegative().nullable(),
  candidateCount: z.number().int().nonnegative().nullable(),
  selectedIdentityCount: z.number().int().nonnegative().nullable(),
  /** ST 口径审计（事件日被排除 / 池期内转 ST 移池）。 */
  stExcludedEventCount: z.number().int().nonnegative().nullable(),
  stRemovedMemberCount: z.number().int().nonnegative().nullable(),
});
export type ClosedLoopBacktestRunRecordDto = z.infer<
  typeof closedLoopBacktestRunRecordSchema
>;

/** 留档详情：在条目之上带完整运行结果（`result` 为 null = 本次未留完整结果）。 */
/**
 * SCOPE-002 S7 —— 「按策略版本坐标读回评估 / 模拟盘留档」的通用入参。
 *
 * 与写死的 runId 专项端点相对：任何策略版本都可查自己那一条留档（查不到即 null）。
 */
export const strategyVersionCoordinatesInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
  strategyVersion: z.string().min(1, "strategyVersion 必填"),
});
export type StrategyVersionCoordinatesInputDto = z.infer<
  typeof strategyVersionCoordinatesInputSchema
>;

export const closedLoopBacktestRunDetailSchema =
  closedLoopBacktestRunRecordSchema.extend({
    result: closedLoopRunResultSchema.nullable(),
    /**
     * `resultJson` 存在、却**读不出来**时的如实原因（`null` = 无此问题）。
     *
     * 🔴 与 `result === null` 是**两件不同的事**：
     *   - `result === null` 且本字段为 `null` ⇒ 本次**没留**完整结果（`resultJson` 为 NULL）
     *   - 本字段非 `null` ⇒ **留了，但按当前契约读不出来**（例：留档写于某次契约收紧之前，
     *     且无事实依据可升级）—— 「记录不可读」绝不能被伪装成「没跑过」。
     */
    resultIssue: z.string().nullable(),
  });
export type ClosedLoopBacktestRunDetailDto = z.infer<
  typeof closedLoopBacktestRunDetailSchema
>;

/** 留档列表查询入参（按留档时间倒序；可按策略过滤）。 */
export const closedLoopBacktestRunListInputSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    strategyId: z.string().min(1).optional(),
  })
  .optional();

/**
 * 批量读取留档详情入参。
 *
 * 与单条 `getBacktest` 的差异：这是「多版本对比」的只读批处理入口，一次最多 20 条，
 * 顺序由调用方给定的 id 顺序决定。
 */
export const closedLoopBacktestRunBatchInputSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(20),
});

/**
 * 成交明细的「证券名称 + 代码」标签。
 *
 * 动因：闭环回测 `trades[].securityId` 是 `sec_<uuid>`（Research canonical identity），
 * 直接展示用户看不懂。名称与代码都由服务端解析后补上 —— 前端**不做**任何身份翻译。
 *
 * 🔴 `code` / `name` 允许为 `null`：名称源（`limit_up_records`）只收录有过涨停记录的
 * 股票，回测 universe 是全市场 ⇒ 必然存在取不到名称的标的。**如实返回 null**，
 * 前端显示「—」，绝不用代码冒充名称。
 */
export const securityLabelSchema = z.object({
  securityId: z.string().min(1),
  /** canonical 代码（`6位数字.交易所`）。 */
  code: z.string().nullable(),
  /** 股票名称。 */
  name: z.string().nullable(),
  /** 交易所（SH / SZ / BJ）。 */
  exchange: z.string().nullable(),
});

/** 证券标签查询入参：一次最多 500 个 identity（够覆盖单次回测的全部成交标的）。 */
export const securityLabelsInputSchema = z.object({
  securityIds: z.array(z.string().min(1)).min(1).max(500),
});

/** 查询出参：按 `securityId` 索引的标签表。 */
export const securityLabelsOutputSchema = z.record(
  z.string(),
  securityLabelSchema
);

export type SecurityLabelDto = z.infer<typeof securityLabelSchema>;
export type SecurityLabelsInput = z.infer<typeof securityLabelsInputSchema>;

export type ResearchRunReadiness = z.infer<typeof researchRunReadinessSchema>;

// ---------------------------------------------------------------------------
// RESEARCH-PLANNER-001 — 自动研究编排（§5 研究问题 / §9 规模控制 / §19–§20 调用入口）
// ---------------------------------------------------------------------------

/**
 * 研究问题的长度边界。
 *
 * 🔴 放在 shared 而不是前后端各写一份：前端要在**提交前**就拦住过短 / 过长的问题
 *    （不该让用户点一下按钮才被拒），后端 `planResearchQuestion` 也必须拦
 *    （不能只靠前端 —— 前端不是可信边界）。两处若各写一份，
 *    「前端放过去、后端拒绝」这类体验裂缝只是时间问题。
 *
 * `MIN = 4`：短于 4 个字的一句话无法定位研究方法，系统**选择不猜**（`QUESTION_TOO_SHORT`）。
 * `MAX = 2000`：与 `research_question.questionText` 的列宽一致。
 */
export const RESEARCH_QUESTION_MIN_LENGTH = 4;
export const RESEARCH_QUESTION_MAX_LENGTH = 2000;

/**
 * 单份自动计划的规模边界（§9）。
 * `MIN = 20`：低于它必然丢掉核心问题（基线 + 守卫 + 对照组就占掉大半）。
 * `MAX = 50`：高于它会退化成「批量跑」，探索超大组合属于高级/专家模式。
 */
export const RESEARCH_PLAN_MIN_ANALYSIS = 20;
export const RESEARCH_PLAN_MAX_ANALYSIS = 50;

/**
 * 单份自动计划的**默认**上限（§9 建议区间 20~50 内的取值）。
 * 为什么落在 30：实测单条分析均摊 ≈ 3.1s（跨境 TiDB，RTT ≈ 208ms），30 条 ≈ 95s，
 * 是「用户愿意在页面上等」的量级。
 */
export const RESEARCH_PLAN_DEFAULT_ANALYSIS = 30;

/** 研究问题文本校验（前后端同源；后端领域层另有 `assertQuestionText` 给出可读理由）。 */
export const researchQuestionTextSchema = z
  .string()
  .trim()
  .min(
    RESEARCH_QUESTION_MIN_LENGTH,
    `研究问题至少要 ${RESEARCH_QUESTION_MIN_LENGTH} 个字`
  )
  .max(
    RESEARCH_QUESTION_MAX_LENGTH,
    `研究问题不能超过 ${RESEARCH_QUESTION_MAX_LENGTH} 个字符`
  );

/** `maxAnalysisPerPlan` 校验（§9：只允许在建议区间内显式指定）。 */
export const researchPlanCapSchema = z
  .number()
  .int()
  .min(RESEARCH_PLAN_MIN_ANALYSIS)
  .max(RESEARCH_PLAN_MAX_ANALYSIS);
