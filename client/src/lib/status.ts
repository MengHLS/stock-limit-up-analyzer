/**
 * 统一状态语义与颜色体系（任务 §12，前端产品化唯一事实来源）。
 *
 * 定位：
 * - 页面**不得**各自定义状态颜色（历史上 DataHealth / DatasetBuilder / StrategyEditor
 *   各有一份 STATUS_META / GateBadge / statusBadgeClass，已统一收敛到本文件）；
 * - 本文件只做「状态 → 语义色」的展示映射，**不参与任何量化判定**（gate / fingerprint /
 *   lifecycle 语义仍以后端为权威，前端不重算）。
 *
 * 状态 → 语义色（§12 铁律）：
 *   READY/SUCCESS      → success（绿）
 *   RUNNING/INFO       → info（蓝）
 *   INCONCLUSIVE/WARNING → warning（黄）
 *   FAILED/ERROR       → danger（红）
 *   NOT_RUN/SKIPPED    → neutral（灰）
 *
 * 额外纳入既有语义（保持向后兼容）：
 *   gate：PASS(success) / PENDING(warning) / FAIL(danger)
 *   生命周期：Draft/Retired(neutral)，Research/Candidate/Paper(info)，
 *            Validated/Approved/Production(success)
 *   历史状态十问（HistoricalState）：LISTED/KNOWN(success)，NOT_YET_LISTED(warning)，
 *            DELISTED(danger)，UNKNOWN(neutral)
 */

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";

export interface StatusStyle {
  tone: StatusTone;
  /** 徽标：border + bg + text 三段 tailwind class（配合 `Badge variant="outline"`）。 */
  badge: string;
  /** 纯文本着色。 */
  text: string;
  /** 小圆点 / 指示器背景色。 */
  dot: string;
  /** 进度条 / 图表填充色（用于 Progress 等）。 */
  fill: string;
}

const TONES: Record<StatusTone, StatusStyle> = {
  success: {
    tone: "success",
    badge: "border-emerald-300 bg-emerald-100 text-emerald-700",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    fill: "bg-emerald-500",
  },
  info: {
    tone: "info",
    badge: "border-blue-300 bg-blue-100 text-blue-700",
    text: "text-blue-700",
    dot: "bg-blue-500",
    fill: "bg-blue-500",
  },
  warning: {
    tone: "warning",
    badge: "border-amber-300 bg-amber-100 text-amber-700",
    text: "text-amber-700",
    dot: "bg-amber-500",
    fill: "bg-amber-500",
  },
  danger: {
    tone: "danger",
    badge: "border-red-300 bg-red-100 text-red-700",
    text: "text-red-700",
    dot: "bg-red-500",
    fill: "bg-red-500",
  },
  neutral: {
    tone: "neutral",
    badge: "border-slate-300 bg-slate-100 text-slate-600",
    text: "text-slate-600",
    dot: "bg-slate-400",
    fill: "bg-slate-400",
  },
};

/** 状态字符串 → 语义色（唯一映射表；未收录状态回退 neutral，不猜测）。 */
const STATUS_TONE: Record<string, StatusTone> = {
  // §12 统一状态
  READY: "success",
  SUCCESS: "success",
  RUNNING: "info",
  INFO: "info",
  INCONCLUSIVE: "warning",
  WARNING: "warning",
  FAILED: "danger",
  ERROR: "danger",
  NOT_RUN: "neutral",
  SKIPPED: "neutral",

  // gate 状态（DataHealth / DatasetBuilder）
  PASS: "success",
  PENDING: "warning",
  FAIL: "danger",

  // 生命周期状态（StrategyEditor §23）
  Draft: "neutral",
  Research: "info",
  Candidate: "info",
  Validated: "success",
  Paper: "info",
  Approved: "success",
  Production: "success",
  Retired: "neutral",

  // 数据域 / 构建节点状态
  PARTIAL: "warning",
  EMPTY: "warning",
  UNKNOWN: "neutral",
  FULL: "success",

  // 历史状态十问（HistoricalState）：生命周期裁决 / 维度可知性
  LISTED: "success",
  NOT_YET_LISTED: "warning",
  DELISTED: "danger",
  KNOWN: "success",

  // Dataset 能力 / 认证状态（STEP DS-V2）
  AVAILABLE: "success",
  CONDITIONAL: "warning",
  UNAVAILABLE: "neutral",
  CERTIFIED: "success",
  REJECTED: "danger",

  // Dataset Registry（STEP DATASET-002）：定义 / 版本 / 构建作业状态
  // 版本：DRAFT / BUILDING / READY / FAILED；作业：PENDING / RUNNING / COMPLETED / FAILED / CANCELLED
  DRAFT: "neutral",
  BUILDING: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
  // 定义：ACTIVE / ARCHIVED
  ACTIVE: "success",
  ARCHIVED: "neutral",

  // Research（RESEARCH-002 前端工作台）：假设状态 / 结论类型
  // RESEARCH_HYPOTHESIS_STATUSES 的 DRAFT/REJECTED/INCONCLUSIVE 已在上方收录，此处补差集。
  TESTING: "info",
  SUPPORTED: "success",
  // 「部分支持」按语义必须落在 warning：它有方向证据但未过门槛，不能显示成 success。
  PARTIALLY_SUPPORTED: "warning",
  // RESEARCH_CONCLUSION_STATUSES
  FINAL: "success",
  SUPERSEDED: "neutral",

  // 闭环阶段状态机（closedLoop · FE-4 运行工作台）
  // 阶段：READY / EXECUTED / BLOCKED / SKIPPED（READY/SKIPPED 已收录）
  EXECUTED: "success",
  BLOCKED: "danger",
  // 全链状态：ALL_EXECUTED / PARTIAL_BLOCKED / NO_STAGE_EXECUTED
  ALL_EXECUTED: "success",
  PARTIAL_BLOCKED: "warning",
  NO_STAGE_EXECUTED: "danger",
};


/** 状态字符串 → 语义色。空值 / 未收录 → neutral。 */
export function toneForStatus(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONE[status] ?? "neutral";
}

/** 状态字符串 → 完整样式。 */
export function styleForStatus(status: string | null | undefined): StatusStyle {
  return TONES[toneForStatus(status)];
}

/** 语义色 → 完整样式。 */
export function toneStyle(tone: StatusTone): StatusStyle {
  return TONES[tone];
}

export { TONES };
