/**
 * STEP 7.5 — Historical Security Status / ST / Trading Status：领域类型与分类法。
 *
 * 依赖 STEP 7.4 Security Identity Contract（server/security）：
 *   - security_id = sec_<uuid> 永久身份，与 stock_code 解耦（见 server/security/securityId.ts）。
 *   - 本模块【不实现】身份解析；一切 code → security_id 转换由 7.4 的 resolver 注入。
 *   - 历史标识映射能力保留：同一 security_id 可在不同时间对应不同 code（7.4 identifierHistory）。
 *
 * status_type（维度）严格区分语义，禁止把不同语义混成一个 status：
 *   - LISTING     上市生命周期
 *   - TRADING     可交易状态（复合口径）
 *   - ST          特别处理（历史状态，禁止用 stock_name.includes("ST") 作为最终判断）
 *   - DELISTING   退市风险
 *   - SUSPENSION  停牌/复牌窗口
 */

/** 状态维度。 */
export const STATUS_TYPES = ["LISTING", "TRADING", "ST", "DELISTING", "SUSPENSION"] as const;
export type StatusType = (typeof STATUS_TYPES)[number];

/**
 * 各维度的合法 status_value 集合（唯一权威来源）。
 * 语义说明：
 *   - LISTING    LISTED / NOT_YET_LISTED / DELISTED —— 上市生命周期。
 *   - TRADING    TRADING / SUSPENDED / NOT_YET_LISTED / DELISTED / UNKNOWN —— 可交易状态。
 *                 UNKNOWN 是显式值，【不得】默认回退为 TRADING。
 *   - ST         NORMAL / ST / *ST —— 特别处理。NORMAL 也必须是显式记录，无记录 ≠ NORMAL。
 *   - DELISTING  NONE / AT_RISK / DELISTED —— 退市风险警示。
 *   - SUSPENSION SUSPENDED / RESUMED —— 停牌窗口（SUSPENDED=区间内停牌；RESUMED=区间内已复牌）。
 */
export const STATUS_VALUES = {
  LISTING: ["LISTED", "NOT_YET_LISTED", "DELISTED"],
  TRADING: ["TRADING", "SUSPENDED", "NOT_YET_LISTED", "DELISTED", "UNKNOWN"],
  ST: ["NORMAL", "ST", "*ST"],
  DELISTING: ["NONE", "AT_RISK", "DELISTED"],
  SUSPENSION: ["SUSPENDED", "RESUMED"],
} as const satisfies Record<StatusType, readonly string[]>;

/** 维度内取值（字符串；精确枚举见 STATUS_VALUES）。 */
export type StatusValue = (typeof STATUS_VALUES)[StatusType][number];

/** 置信度。 */
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/**
 * 状态发布时间语义（availability）：区分 effective 与 retrieved，不假设 retrieved_at = effective_date。
 *   - IMMEDIATE  状态在 effectiveFrom 当日即可知（如上市/退市公告当日）。
 *   - T_PLUS_1   状态在 effectiveFrom 次一自然日才可知。
 *   - UNKNOWN    来源发布时间未知；【不得】擅自假设 T+1。
 */
export const AVAILABILITIES = ["IMMEDIATE", "T_PLUS_1", "UNKNOWN"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

/** 单条历史状态区间（对应 research_security_status_history 一行）。 */
export interface SecurityStatusInterval {
  /** 永久身份（sec_<uuid>）。 */
  securityId: string;
  /** 状态维度。 */
  statusType: StatusType;
  /** 维度内取值。 */
  statusValue: string;
  /** 生效日（含，YYYY-MM-DD）。 */
  effectiveFrom: string;
  /** 失效日（含，YYYY-MM-DD）；null = 至今（开放区间）。 */
  effectiveTo: string | null;
  /** 来源。 */
  source: string;
  /** 抓取/写入时间（何时写入本行）；null = 未知。 */
  retrievedAt: string | null;
  /** 置信度。 */
  confidence: ConfidenceLevel;
  /** 发布时间语义。 */
  availability: Availability;
}

/** as-of 解析出的单维度结果。 */
export interface ResolvedStatusValue {
  statusType: StatusType;
  statusValue: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
  confidence: ConfidenceLevel;
}

/** 某证券在指定日期的状态快照。 */
export interface SecurityStatusSnapshot {
  securityId: string;
  /** 查询的生效日（YYYY-MM-DD）。 */
  date: string;
  /** point-in-time 截止点；null = 全知（当前视角）。 */
  asOf: string | null;
  /** 已解析的维度；仅包含「有已知数据」的维度。 */
  resolved: Partial<Record<StatusType, ResolvedStatusValue>>;
  /** 无已知数据的维度（禁止默认填充；UNKNOWN 不默认 TRADING / NORMAL）。 */
  unknownDimensions: StatusType[];
}
