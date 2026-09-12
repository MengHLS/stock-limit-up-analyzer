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
export type PullbackTargetTypeValue = (typeof PULLBACK_TARGET_TYPE_VALUES)[number];

/** 回踩筛选条件（首板后 T+1~T+N「触及且不破」）。 */
export const pullbackScreenConditionSchema = z.object({
  /** 回踩目标位（可多选）。 */
  targetTypes: z
    .array(pullbackTargetTypeSchema)
    .min(1, "至少选择一个回踩目标位"),
  /** 触及容差（%）。 */
  tolerancePercent: z.number().min(0).max(50).default(2),
  /** 观察窗口交易日数（T+1 ~ T+N）。 */
  observationWindowDays: z.number().int().min(1).max(10).default(5),
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
export type DatasetCapabilityStatus = "AVAILABLE" | "CONDITIONAL" | "UNAVAILABLE";

/** 认证资格三态（与后端 certify.ts 一致）。 */
export type DatasetCertificationStatus = "CERTIFIED" | "CONDITIONAL" | "REJECTED";

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

/** 按 (strategyId, version) 加载指定版本。 */
export const strategyLoadVersionInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
  version: z.string().min(1, "version 必填（semver x.y.z）"),
});
export type StrategyLoadVersionInput = z.infer<typeof strategyLoadVersionInputSchema>;

/** 基于最新版本创建新版本（bump 可选，缺省由内容差异自动判定）。 */
export const strategyCreateVersionInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
  document: strategyDocumentSchema,
  bump: z.enum(["major", "minor", "patch"]).optional(),
});
export type StrategyCreateVersionInput = z.infer<typeof strategyCreateVersionInputSchema>;

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
  targetVersion: z.string().min(1, "targetVersion 需为 semver x.y.z").optional(),
  bump: z.enum(["major", "minor", "patch"]).optional(),
  description: z.string().max(512).optional(),
  status: strategyLifecycleStatusSchema.optional(),
});
export type StrategyCloneVersionInput = z.infer<typeof strategyCloneVersionInputSchema>;

/**
 * 版本生命周期状态迁移（STRATEGY-003 唯一允许的 UPDATE；内容仍不可变）。
 * 写操作 → 后端 adminProcedure。
 */
export const strategySetVersionStatusInputSchema = z.object({
  strategyId: z.string().min(1, "strategyId 必填"),
  version: z.string().min(1, "version 必填（semver x.y.z）"),
  status: strategyLifecycleStatusSchema,
});
export type StrategySetVersionStatusInput = z.infer<typeof strategySetVersionStatusInputSchema>;

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
//   - **不冒充 READY**：真实执行链（runResearchBacktest + 数据 loader 装配）未绑定前
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
export type ClosedLoopStageIdValue = (typeof CLOSED_LOOP_STAGE_ID_VALUES)[number];

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
export type ClosedLoopWiringSummary = z.infer<typeof closedLoopWiringSummarySchema>;

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
  /** 阶段选择（缺省 = canonical 全 14 阶段；必须为保序子集）。 */
  stageIds: z.array(closedLoopStageIdSchema).optional(),
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
});
export type ClosedLoopRunResult = z.infer<typeof closedLoopRunResultSchema>;
export type ResearchRunReadiness = z.infer<typeof researchRunReadinessSchema>;
