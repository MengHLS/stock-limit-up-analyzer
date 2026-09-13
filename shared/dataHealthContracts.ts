/**
 * FE-1 — 数据域健康看板 前后端契约（唯一来源）。
 *
 * 纪律（§0.2 / §27 Frontend Audit）：
 * - **只读真实证据**：判定来源于 `docs/researchReadyGate/research_ready_gate.json`
 *   （由 `scripts/step12_certify_gate.mjs` 只读 TiDB 生成）；后端只做「读取 + 解析 + 派生展示字段」，
 *   **不计算 gate 判定**；
 * - **不粉饰**：gate 的 FAIL / PENDING 原样透传，前端不得改写成 PASS；
 * - **认证态 vs 实况态分离**：`researchReadyGate` 是**认证快照**（有 capturedAt，可复现）；
 *   `liveCounts` 是**未认证实况**（查库，仅用于观察回填进度，不得当作 gate 依据）；
 * - **唯一带副作用的入径 = `recertify`**：它只「重跑那条既有只读脚本 + 读回产物」，
 *   判定逻辑仍 100% 在脚本里（服务端零复制），入参里没有任何字段能让调用方给出状态。
 *   见 `server/researchReadyGate/recertify.ts`。
 */

import { z } from "zod";

/** gate 单项状态。PENDING 表示「数据未达阈值」，FAIL 表示「判定不通过」。 */
export const GATE_STATUSES = ["PASS", "PENDING", "FAIL"] as const;
export const gateStatusSchema = z.enum(GATE_STATUSES);
export type GateStatus = (typeof GATE_STATUSES)[number];

/** STEP 12 七大历史数据域。 */
export const DATA_DOMAINS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export const dataDomainSchema = z.enum(DATA_DOMAINS);
export type DataDomain = (typeof DATA_DOMAINS)[number];

/** gate 单项（结构以 certify 脚本输出为准；current/threshold 各域形状不同，故松散传输）。 */
export const gateCheckSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  dataScope: z.boolean().optional(),
  status: gateStatusSchema,
  current: z.record(z.string(), z.unknown()),
  threshold: z.record(z.string(), z.unknown()),
  detail: z.string(),
});
export type GateCheck = z.infer<typeof gateCheckSchema>;

/** gate 汇总计数。 */
export const gateSummarySchema = z.object({
  total: z.number().int(),
  dataScope: z.number().int().optional(),
  PASS: z.number().int(),
  PENDING: z.number().int(),
  FAIL: z.number().int(),
});
export type GateSummary = z.infer<typeof gateSummarySchema>;

/**
 * 分层 Gate 单项（G0~G5，见 RESEARCH_GATE_SPECIFICATION.md §2 / GCP-001）。
 * status: PASS（本 Gate 验证通过）| GAP（未建设/存在缺口）| FAIL（判定不通过）。
 * reason: GAP/FAIL 时的人类可读缺口说明；PASS 时为 null。
 * checks: 本 Gate 的探测明细（形状因 Gate 而异，松散传输）。
 */
export const GATE_LEVEL_STATUSES = ["PASS", "GAP", "FAIL"] as const;
export const gateLevelStatusSchema = z.enum(GATE_LEVEL_STATUSES);
export type GateLevelStatus = (typeof GATE_LEVEL_STATUSES)[number];

export const gateLevelSchema = z.object({
  status: gateLevelStatusSchema,
  reason: z.string().nullable().optional(),
  /** 本 Gate 的探测明细：形状因 Gate 而异（G0 为 check 数组，G1~G5 为键值对象），松散传输。 */
  checks: z.unknown().optional(),
});
export type GateLevel = z.infer<typeof gateLevelSchema>;

/**
 * 认证 gate 文件（`docs/researchReadyGate/research_ready_gate.json`）结构。
 * 分层语义（GCP-001）：
 *   - `dataFoundationReady` = G0（15 项数据域检查全 PASS）；
 *   - `researchReady` = G4（真实研究 E2E + OOS + overfitting），**不再**等于数据域 PASS；
 *   - `productionReady` = G5（持久化 + 前端 + 安全 + 监控）。
 * 旧字段（summary/thresholds/checks/snapshot）保留向后兼容；`gates` 为新增分层明细。
 */
export const researchReadyGateFileSchema = z.object({
  capturedAt: z.string(),
  researchReady: z.boolean(),
  productionReady: z.boolean().optional(),
  dataFoundationReady: z.boolean().optional(),
  gates: z.record(z.string(), gateLevelSchema).optional(),
  summary: gateSummarySchema,
  thresholds: z.record(z.string(), z.unknown()),
  checks: z.array(gateCheckSchema),
  snapshot: z.record(z.string(), z.unknown()).optional(),
});
export type ResearchReadyGateFile = z.infer<typeof researchReadyGateFileSchema>;

/** 覆盖率：当前值 / 目标阈值 / 百分比（任一缺失 → null，不臆造）。 */
export const coverageSchema = z.object({
  current: z.number().nullable(),
  target: z.number().nullable(),
  unit: z.string(),
  pct: z.number().nullable(),
});
export type Coverage = z.infer<typeof coverageSchema>;

/** 数据域健康度（由 gate checks **派生**，非独立判定）。 */
export const domainHealthSchema = z.object({
  domain: dataDomainSchema,
  label: z.string(),
  tables: z.array(z.string()),
  /** 派生规则：含 FAIL→FAIL；含 PENDING→PENDING；否则 PASS。 */
  status: gateStatusSchema,
  /** 归属该域的 gate check id。 */
  checkIds: z.array(z.number().int()),
  coverage: coverageSchema,
  detail: z.string(),
});
export type DomainHealth = z.infer<typeof domainHealthSchema>;

/** 证据产物（docs 下的真实 JSON 证据文件）。 */
export const EVIDENCE_KINDS = [
  "gate",
  "certify",
  "pit",
  "dataset",
  "deploy",
  "audit",
] as const;
export const evidenceArtifactSchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(EVIDENCE_KINDS),
  bytes: z.number().int(),
  capturedAt: z.string().nullable(),
  modifiedAt: z.string(),
});
export type EvidenceArtifact = z.infer<typeof evidenceArtifactSchema>;

/** 健康看板总览响应。 */
export const dataHealthOverviewSchema = z.object({
  source: z.object({
    path: z.string(),
    exists: z.boolean(),
    capturedAt: z.string().nullable(),
    staleMinutes: z.number().nullable(),
    /** 解析失败原因（文件缺失 / schema 不匹配）；成功为 null。 */
    parseError: z.string().nullable(),
  }),
  researchReady: z.boolean(),
  /** 分层 Gate 语义（GCP-001）：researchReady 只指 G4；此处透传 G0/G5 与分层明细。 */
  productionReady: z.boolean().nullable(),
  dataFoundationReady: z.boolean().nullable(),
  gates: z.record(z.string(), gateLevelSchema).nullable(),
  summary: gateSummarySchema.nullable(),
  /** A~G 七域派生健康度。 */
  domains: z.array(domainHealthSchema),
  /** 全部 17 项 gate（含数据域项与跨域 gate 项）。 */
  checks: z.array(gateCheckSchema),
  /** 跨域 gate 项（PIT / Survivorship / 数据质量 / 可复现 …）。 */
  crossCuttingChecks: z.array(gateCheckSchema),
  thresholds: z.record(z.string(), z.unknown()),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
  evidence: z.array(evidenceArtifactSchema),
});
export type DataHealthOverview = z.infer<typeof dataHealthOverviewSchema>;

/** 实况表行数（**未认证**，仅用于观察回填进度）。 */
export const liveTableCountSchema = z.object({
  table: z.string(),
  /** 行数。rowsEstimated=true 时取自 information_schema 统计（近似值，非精确 COUNT）。 */
  rows: z.number().int(),
  rowsEstimated: z.boolean(),
  /** 覆盖口径（如「多少只证券已回填」）；精确 COUNT(DISTINCT)，超时/失败为 null。 */
  coverage: z.number().int().nullable(),
  coverageLabel: z.string().nullable(),
  /** 覆盖查询失败或超时原因；成功为 null。 */
  coverageError: z.string().nullable(),
});
export type LiveTableCount = z.infer<typeof liveTableCountSchema>;

export const liveCountsResultSchema = z.object({
  capturedAt: z.string(),
  /** 恒为 false：本结果未经过 gate 认证，不得作为 RESEARCH_READY 依据。 */
  certified: z.literal(false),
  tables: z.array(liveTableCountSchema),
  /** 整体说明（口径解释）。 */
  note: z.string(),
  /** 查库失败原因（如 DATABASE_URL 未配置）；成功为 null。 */
  error: z.string().nullable(),
});
export type LiveCountsResult = z.infer<typeof liveCountsResultSchema>;

/** 产出认证 gate 快照的脚本（相对仓库根）；服务端与前端展示的唯一坐标。 */
export const RECERTIFY_SCRIPT_REL = "scripts/step12_certify_gate.mjs";

/** 与 `recertify` 所执行的完全同源的人工命令（供前端原样展示、可复制）。 */
export const RECERTIFY_MANUAL_COMMAND = `node ${RECERTIFY_SCRIPT_REL}`;

/**
 * 「重跑认证」结果（`dataHealth.recertify`）。
 *
 * 铁律（**由 schema 结构强制**，不靠调用方自觉）：
 *   - `ok === true`  ⟺  `snapshot !== null`：`snapshot` 只可能来自「脚本 exitCode=0 + 产物解析通过」；
 *   - `ok === false` ⇒ `snapshot` 恒为 `null`，且带回 `error` 原文 —— 即使磁盘上还留着上一次的
 *     产物文件，也**绝不回传**，免得被当成「本次认证结果」（§0.2 禁止粉饰）。
 *
 * 本结果**不承载任何判定入参**：没有字段能让调用方指定 PASS/FAIL。
 */
export const recertifyGateResultSchema = z.object({
  ok: z.boolean(),
  /** 子进程退出码；被信号（超时/中断）终止时为 null。 */
  exitCode: z.number().int().nullable(),
  /** 是否因超时而终止。 */
  timedOut: z.boolean(),
  /** 本次等待耗时（毫秒）。 */
  durationMs: z.number().int().nonnegative(),
  /** true = 本次未新起进程，而是复用同一时刻在途的运行（并发触发时）。 */
  sharedWithInFlight: z.boolean(),
  script: z.string(),
  manualCommand: z.string(),
  /** 失败原因（人类可读）；`ok === true` 时为 null。 */
  error: z.string().nullable(),
  /** 本次运行产出的快照摘要；`ok === false` 时恒为 null。 */
  snapshot: z
    .object({
      capturedAt: z.string(),
      researchReady: z.boolean(),
      dataFoundationReady: z.boolean().nullable(),
      productionReady: z.boolean().nullable(),
      summary: gateSummarySchema,
      gates: z.record(z.string(), gateLevelSchema).nullable(),
    })
    .nullable(),
  /** 子进程 stdout 末尾若干字符（仅排障，不参与任何判定）。 */
  stdoutTail: z.string(),
  /** 子进程 stderr 末尾若干字符（仅排障，不参与任何判定）。 */
  stderrTail: z.string(),
});
export type RecertifyGateResult = z.infer<typeof recertifyGateResultSchema>;
