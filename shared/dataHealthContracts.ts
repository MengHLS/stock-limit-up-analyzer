/**
 * FE-1 — 数据域健康看板 前后端契约（唯一来源）。
 *
 * 纪律（§0.2 / §27 Frontend Audit）：
 * - **只读真实证据**：数据来源于 `docs/step12-evidence/*.json`（由 `scripts/step12_certify_gate.mjs`
 *   只读 TiDB 生成），后端只做「读取 + 解析 + 派生展示字段」，**不重新计算 gate 判定**；
 * - **不粉饰**：gate 的 FAIL / PENDING 原样透传，前端不得改写成 PASS；
 * - **认证态 vs 实况态分离**：`researchReadyGate` 是**认证快照**（有 capturedAt，可复现）；
 *   `liveCounts` 是**未认证实况**（查库，仅用于观察回填进度，不得当作 gate 依据）。
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

/** 认证 gate 文件（`docs/step12-evidence/research_ready_gate.json`）结构。 */
export const researchReadyGateFileSchema = z.object({
  capturedAt: z.string(),
  researchReady: z.boolean(),
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
