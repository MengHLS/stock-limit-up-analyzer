/**
 * STEP 7.7 — Corporate Action & Adjustment Data 层：provider-neutral 领域类型。
 *
 * 目标：全系统「公司行为 / 复权因子」只有一套 canonical 口径；任何 provider（BaoStock /
 * Tushare / 人工）都先归一化为本层的 `CorporateAction` / `AdjustmentFactor`，上层
 * （复权引擎 / 回测 / 研究）不得直接解释 provider 的原始字段。
 *
 * 关键语义（对应 STEP 7.7 第六节，禁止偷懒假设）：
 *   - `effectiveDate`（生效日）：价格发生除权除息、进而需要调整的交易日。
 *     对 A 股现金分红 / 送转 / 配股，effectiveDate 恒等于除权除息日（ex-date）。
 *   - `recordDate`（股权登记日）：享有该次权益的股东登记截止日，通常为 ex-date 前一交易日。
 *   - `announcementDate`（公告日）：预案/实施方案的公开披露日。
 *   三者不可混同；若 provider 只提供其中一项，其余字段必须显式置 null 并记录缺失，
 *   禁止假设 announcementDate === effectiveDate。
 *
 * 时间点（Point-in-Time）语义：调整只依赖 `effectiveDate`（事件实际生效时点）；
 * 是否能在某决策时点「得知」该事件，由上层用 `announcementDate` 做 availability 过滤，
 * 本类型不把两者混为一谈。
 */

/** 公司行为类型（provider-neutral 枚举）。 */
export type CorporateActionType =
  | "dividend" // 现金分红（每股派现金）
  | "bonus_issue" // 送股（每股送股）
  | "transfer" // 转增（资本公积转增股本）
  | "rights_issue" // 配股（每股配股 + 配股价）
  | "split" // 拆股（1 股拆为 N 股）
  | "reverse_split" // 合股（N 股并为 1 股）
  | "other"; // 其他影响历史价格/持仓数量的事件

/** 复权口径。raw = 未复权；forward = 前复权（锚定最新价）；backward = 后复权（锚定最早价）。 */
export type AdjustmentMode = "forward" | "backward";

/**
 * 单一公司行为事件（provider-neutral）。
 *
 * 一个事件只描述「一类」行为（actionType 唯一），但允许携带跨类型的分解字段？
 * —— 否。为保持 actionType 语义唯一，规则如下：
 *   - 一个事件只属于一个 actionType；
 *   - provider 返回的「组合事件」（如 "10 转 10 派 30 元"）必须在归一化层拆分为多个
 *     `CorporateAction`（各持单一 type），共享同一个 `effectiveDate`；
 *   - 复权引擎按 `effectiveDate` 分组，把同日多事件合并为一个除权除息价因子。
 *
 * 分解字段单位（均为「每股」，严禁各自换算）：
 *   - cashAmount    元/股（税前现金分红）
 *   - bonusRatio    股/股（每股送股数，如 10 送 3 → 0.3）
 *   - transferRatio 股/股（每股转增数）
 *   - rightsRatio   股/股（每股配股数）
 *   - rightsPrice   元/股（配股价）
 *   - splitRatio    拆/合股比例（split 时 = N「1 拆 N」；reverse_split 时 = N「N 合 1」）
 */
export interface CorporateAction {
  /**
   * 永久身份（sec_<uuid>，软引用）。尚未对账到 Security Master 时为 null；
   * 必须通过 deterministic resolution（server/security/identifierHistory.ts 的
   * resolveSecurityByCode）把 securityCode 解析为 securityId，禁止直接把代码写入本字段。
   */
  securityId: string | null;
  /** 证券代码（带交易所后缀，如 "600519.SH"），自然键。 */
  securityCode: string;
  /** 行为类型（单一）。 */
  actionType: CorporateActionType;
  /** 生效日（除权除息日，价格在此日调整）。 */
  effectiveDate: string;
  /** 股权登记日；provider 未提供时 null。 */
  recordDate: string | null;
  /** 公告日；provider 未提供时 null。 */
  announcementDate: string | null;
  /** 每股现金分红（税前，元）。 */
  cashAmount: number | null;
  /** 每股送股数。 */
  bonusRatio: number | null;
  /** 每股转增数。 */
  transferRatio: number | null;
  /** 每股配股数。 */
  rightsRatio: number | null;
  /** 配股价（元/股）。 */
  rightsPrice: number | null;
  /** 拆/合股比例（仅 split / reverse_split 使用）。 */
  splitRatio: number | null;
  /** 数据来源（provider 标识，如 "baostock" / "tushare" / "manual"）。 */
  source: string;
  /** 抓取/写入时间（ISO 8601）。 */
  retrievedAt: string;
  /** provider 原始描述文本（如 "10转10派30元"），可选。 */
  description: string | null;
}

/**
 * 一条已解析的复权因子（provider-neutral）。
 *
 * 语义为「累计因子」：某交易日 raw 价乘以 foreFactor 得前复权价、乘以 backFactor 得后复权价。
 *   - foreFactor（前复权因子）：生效日 <= 该日之后所有事件的复权效应乘积，最新日恒为 1。
 *   - backFactor（后复权因子）：生效日 <= 该日（含）所有事件的复权效应乘积，最早日恒为 1。
 * 二者与事件分解层互补：因子直接可用（无需 preClose），但不分解事件类型；
 * 事件层可反推因子但依赖 preClose。
 */
export interface AdjustmentFactor {
  /** 永久身份（sec_<uuid>，软引用）。尚未对账到 Security Master 时为 null。 */
  securityId: string | null;
  /** 证券代码（带交易所后缀，如 "600519.SH"），自然键。 */
  securityCode: string;
  /** 生效日（除权除息日）。 */
  effectiveDate: string;
  /** 累计前复权因子（> 0）。 */
  foreFactor: number;
  /** 累计后复权因子（> 0）。 */
  backFactor: number;
  /** 数据来源。 */
  source: string;
  /** 抓取/写入时间（ISO 8601）。 */
  retrievedAt: string;
}

/** 数据质量三态（与 server/data 层保持一致）。 */
export type DataQuality = "VALID" | "WARNING" | "INVALID";

/** 单条校验问题。 */
export interface ValidationIssue {
  severity: DataQuality;
  /** 稳定 code，供调用方程序化处理。 */
  code: string;
  message: string;
}

/** CorporateAction 校验结果。 */
export interface ActionValidationResult {
  status: DataQuality;
  issues: ValidationIssue[];
}
