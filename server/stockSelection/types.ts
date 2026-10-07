import type { SelectionDataSourceKind } from "./dataSource";
/**
 * STOCK-SELECTION-001 —— 选股域类型（策略无关的公共契约）。
 *
 * 职责边界：
 *   - 本域只负责「给定数据集版本 + 决策日 → 当日选股清单」；
 *   - **不定义策略语义**：每个策略自己决定读什么数据、怎么排序（见 `strategies/**`）；
 *   - **不实现第二套打分/过滤**：一律委托既有权威实现（如首板回踩 3F 走
 *     `server/research/compositeRunner`），本域只做数据面裁剪 + 结果投影。
 *
 * 页面（后续阶段）只依赖本文件的公共字段，因此新增策略不需要改页面。
 */

/**
 * 数据载体指认（可选）。
 *
 * 🔴 **选股请求不绑定数据集**：`datasetVersionId` 只是 `dataset` 载体的坐标，
 * 出现在这里而不是请求顶层 —— 换载体（如 `live` 当日行情）时请求形状不变。
 */
export interface StockSelectionSourceRef {
  readonly kind: SelectionDataSourceKind;
  /** 仅 `dataset` 载体需要：数据集版本真实坐标（`dataset_version.id`；label 不作坐标）。 */
  readonly datasetVersionId?: number;
}

/** 选股请求（策略无关）。 */
export interface StockSelectionRequest {
  /** 决策日（收盘后，YYYY-MM-DD）。 */
  readonly decisionDate: string;
  /** 每日最多选几只；省略 = 策略默认值。 */
  readonly topN?: number;
  /** 数据载体；省略 = 使用默认载体（当前 = `dataset`，需在载体指认里给坐标）。 */
  readonly source?: StockSelectionSourceRef;
}

/** 可 JSON 化的明细值（前端直接展示，不允许嵌套对象）。 */
export type StockSelectionDetailValue = number | string | boolean | null;

/** 单只入选标的。 */
export interface StockSelectionPick {
  /** 1-based 名次（与策略内部排名一致）。 */
  readonly rank: number;
  /** 该日横截面分位（1 = 最优；与排名同源）。 */
  readonly rankPercentile: number;
  /** 策略排序分（越高越优先；无分 = null，如实不填 0）。 */
  readonly score: number | null;
  /** canonical 身份（`sec_<uuid>`）—— 权威坐标。 */
  readonly canonicalSecurityId: string;
  /** 面板身份（如 `sec_<uuid>::event:<code>@<date>`），用于回查窗口行。 */
  readonly panelSecurityId: string;
  /** 当日生效完整代码（如 600000.SH）；无 = null。 */
  readonly code: string | null;
  /** 事件 id（数据集内唯一）。 */
  readonly eventId: string;
  /** 事件日 T0（首板日）。 */
  readonly eventDate: string;
  /** 信号日（决策日；本策略 = T0+5 收盘）。 */
  readonly signalDate: string;
  /** 计划执行日（次一交易日开盘买入；无法确定 = null）。 */
  readonly entryDate: string | null;
  /** 策略自有明细（如 3F 三分量），供页面展示「为什么是它」。 */
  readonly detail: Readonly<Record<string, StockSelectionDetailValue>>;
}

/** 被剔除的**单个候选事件**（可审计到票：「哪只票、什么时候、因为什么被剔除」）。 */
export interface StockSelectionExcludedStock {
  /** canonical 身份（`sec_<uuid>`）—— 权威坐标（可据此查名称）。 */
  readonly canonicalSecurityId: string;
  /** 当日生效完整代码（如 600000.SH）；无 = null。 */
  readonly code: string | null;
  /** 事件 id（数据集内唯一）；面板身份反查不到时为空串。 */
  readonly eventId: string;
  /** 事件日 T0（首板日）；解析失败为空串。 */
  readonly eventDate: string;
  /** 剔除原因码（与 `excluded` 的键同源）。 */
  readonly reason: string;
}

/** 候选剔除统计（「为什么没选上」的可审计口径）。 */
export interface StockSelectionFilterStats {
  /** 本次判定涉及的**候选事件数**（决策日当天进入判定的原始事件）。 */
  readonly candidateEventCount: number;
  /** 进入当日排序的合格候选数（通过全部硬过滤）。 */
  readonly rankedCandidateCount: number;
  /**
   * 剔除计数（原因码 → 数量；只登记本策略真实统计的原因）。
   * 🔴 由 `excludedStocks` **归并**得出 ⇒ 计数与明细恒一致（不会出现「有数量没票」）。
   */
  readonly excluded: Readonly<Record<string, number>>;
  /** 被剔除的**具体股票**（含原因、代码、身份）；与 `excluded` 同源。 */
  readonly excludedStocks: readonly StockSelectionExcludedStock[];
}

/** 单日选股结果（策略无关）。 */
export interface DailyStockSelection {
  readonly strategyId: string;
  readonly strategyLabel: string;
  /** 本次实际使用的数据载体（页面显示「数据来源」；**不是**策略属性）。 */
  readonly source: { readonly kind: SelectionDataSourceKind; readonly label: string };
  /** 仅当载体 = `dataset` 时非 null（研究口径坐标；其余载体为 null）。 */
  readonly datasetVersionId: number | null;
  readonly decisionDate: string;
  readonly topN: number;
  readonly picks: readonly StockSelectionPick[];
  readonly filterStats: StockSelectionFilterStats;
  /**
   * 本次选择消费的数据窗口（决策日所属事件窗的交易日范围）；无候选 = null。
   * 🔴 这是**展示用**事实，不是数据集坐标。
   */
  readonly dataWindow: { readonly startDate: string; readonly endDate: string } | null;
}

/**
 * 选股策略端口。
 *
 * 新增策略 = 新增一个实现 + 在 `registry.ts` 注册；页面无需改动。
 * 🔴 实现方必须复用其权威选股实现，禁止在本域复制第二套打分/过滤逻辑。
 */
export interface StockSelectionStrategy {
  /** 稳定策略 id（业务唯一，供路由/页面寻址）。 */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /**
   * 该策略所依据的数据集定义 id（`dataset_definition.id`）。
   *
   * 用途：页面据此列出可选的数据集版本（`datasetRegistry.listVersions({datasetId})`），
   * 避免在前端硬编码 datasetId。**策略必然定义在某个数据集上**，故为必填。
   */
  readonly datasetId: number;
  select(request: StockSelectionRequest): Promise<DailyStockSelection>;
}

/** 决策日形态校验（YYYY-MM-DD 且为合法日历日）；路由与页面共用同一判据。 */
export function isValidDecisionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 选股域错误码（响亮失败，绝不静默降级成空结果）。 */
export const STOCK_SELECTION_ERROR_CODES = [

  /** 候选事件缺 rd=0 行（无法建立特征基准） */
  "SELECTION_EVENT_DAY_BAR_MISSING",
  /** 事件窗投影出的交易日无法复现数据集自己的 relativeDay（日历/数据不一致） */
  "SELECTION_CALENDAR_INCONSISTENT",
  /** 分页读取超出页数上限（防无限循环） */
  "SELECTION_PAGE_LIMIT_EXCEEDED",
  /** 未知策略 id */
  "SELECTION_STRATEGY_UNKNOWN",
  /** 请求指定的数据载体未注册（如 live 尚未接入） */
  "SELECTION_DATA_SOURCE_UNSUPPORTED",
  /** 载体返回的候选超出策略声明的候选宇宙（板块/ST 口径不一致） */
  "SELECTION_UNIVERSE_VIOLATION",
  /** 载体缺所需坐标（如 dataset 载体未给 datasetVersionId） */
  "SELECTION_DATA_SOURCE_COORDINATE_MISSING",
] as const;
export type StockSelectionErrorCode = (typeof STOCK_SELECTION_ERROR_CODES)[number];

export class StockSelectionError extends Error {
  constructor(readonly code: StockSelectionErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "StockSelectionError";
  }
}
