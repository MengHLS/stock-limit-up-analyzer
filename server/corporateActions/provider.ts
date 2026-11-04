/**
 * STEP 7.7 — Provider 归一化层（BaoStock）。
 *
 * 目标：把 BaoStock 的原始行数组（字符串元组）归一化为 provider-neutral 的
 * `CorporateAction` / `AdjustmentFactor`。本模块只做「纯解析」，不发起网络请求；
 * 实际抓取由 scripts/baostock_fetch_corporate_actions.py 完成并输出 JSON，再由本层消费。
 *
 * BaoStock 端点与字段（见 STEP 7.7_COVERAGE_REPORT）：
 *   - query_adjust_factor：code, dividOperateDate, foreAdjustFactor, backAdjustFactor, adjustFactor
 *     → 累计复权因子（AdjustmentFactor）。
 *   - query_dividend_data：code, dividPreNoticeDate, dividAgmPumDate, dividPlanAnnounceDate,
 *     dividPlanDate, dividRegistDate, dividOperateDate, dividPayDate, dividStockMarketDate,
 *     dividCashPsBeforeTax, dividCashPsAfterTax, dividStocksPs, dividCashStock, dividReserveToStockPs
 *     → 事件级分解（CorporateAction），可拆出 现金分红 / 送股 / 转增。
 *
 * 已知缺口（详见报告）：BaoStock dividend_data 不提供配股（rights_issue）与拆/合股
 * 的结构化字段，仅通过累计因子反映其价格效应；故 rights/split/reverse_split 事件需
 * 由其它来源或人工补齐。
 */

import type {
  AdjustmentFactor,
  CorporateAction,
  CorporateActionType,
} from "./types";

/** 把 BaoStock 代码（"sh.600519" / "sz.000001" / "bj.920xxx"）转为项目统一后缀格式（canonical 代码）。 */
export function toSecurityCode(baostockCode: string): string {
  const m = baostockCode
    .trim()
    .toLowerCase()
    .match(/^(sh|sz|bj)\.(\d+)$/);
  if (!m) throw new Error(`无法解析 BaoStock 代码：${baostockCode}`);
  const [, exchange, code] = m;
  const suffix = exchange === "sh" ? "SH" : exchange === "sz" ? "SZ" : "BJ";
  return `${code}.${suffix}`;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function toDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parsed = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) ? s : null;
}

/** 当前时间 ISO（确定性：同一批解析共享一个 retrievedAt）。 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 解析 BaoStock query_adjust_factor 的行数组。
 * 行字段顺序：[code, dividOperateDate, foreAdjustFactor, backAdjustFactor, adjustFactor]。
 * 非法行（缺代码/日期/因子非正）→ 跳过并返回，由调用方统计。
 */
export function parseBaoStockAdjustFactors(
  rows: readonly (string | number)[][],
  options: { retrievedAt?: string; source?: string } = {}
): { factors: AdjustmentFactor[]; skipped: number } {
  const retrievedAt = options.retrievedAt ?? nowIso();
  const source = options.source ?? "baostock";
  const factors: AdjustmentFactor[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row || row.length < 4) {
      skipped += 1;
      continue;
    }
    try {
      const securityCode = toSecurityCode(String(row[0]));
      const effectiveDate = toDate(row[1]);
      const foreFactor = toNumber(row[2]);
      const backFactor = toNumber(row[3]);
      if (
        !effectiveDate ||
        foreFactor === null ||
        backFactor === null ||
        foreFactor <= 0 ||
        backFactor <= 0
      ) {
        skipped += 1;
        continue;
      }
      factors.push({
        securityId: null,
        securityCode,
        effectiveDate,
        foreFactor,
        backFactor,
        source,
        retrievedAt,
      });
    } catch {
      skipped += 1;
    }
  }
  return { factors, skipped };
}

/**
 * 解析 BaoStock query_dividend_data 的行数组，拆分为单一 actionType 的事件序列。
 * 行字段顺序：
 *   [0]=code, [1]=dividPreNoticeDate, [2]=dividAgmPumDate, [3]=dividPlanAnnounceDate,
 *   [4]=dividPlanDate, [5]=dividRegistDate, [6]=dividOperateDate, [7]=dividPayDate,
 *   [8]=dividStockMarketDate, [9]=dividCashPsBeforeTax, [10]=dividCashPsAfterTax,
 *   [11]=dividStocksPs, [12]=dividCashStock(描述), [13]=dividReserveToStockPs
 *
 * 拆分规则：dividCashPsBeforeTax>0 → dividend；dividStocksPs>0 → bonus_issue；
 * dividReserveToStockPs>0 → transfer；三者共享同一 effectiveDate(除权除息日)。
 * 全部为 0 或缺失 → 该行不产生事件（跳过）。
 */
export function parseBaoStockDividendActions(
  rows: readonly (string | number)[][],
  options: { retrievedAt?: string; source?: string } = {}
): { actions: CorporateAction[]; skipped: number } {
  const retrievedAt = options.retrievedAt ?? nowIso();
  const source = options.source ?? "baostock";
  const actions: CorporateAction[] = [];
  let skipped = 0;

  const push = (
    securityCode: string,
    actionType: CorporateActionType,
    effectiveDate: string | null,
    recordDate: string | null,
    announcementDate: string | null,
    description: string | null,
    components: Partial<
      Pick<CorporateAction, "cashAmount" | "bonusRatio" | "transferRatio">
    >
  ) => {
    if (!effectiveDate) {
      skipped += 1;
      return;
    }
    actions.push({
      securityId: null,
      securityCode,
      actionType,
      effectiveDate,
      recordDate,
      announcementDate,
      cashAmount: components.cashAmount ?? null,
      bonusRatio: components.bonusRatio ?? null,
      transferRatio: components.transferRatio ?? null,
      rightsRatio: null,
      rightsPrice: null,
      splitRatio: null,
      source,
      retrievedAt,
      description,
    });
  };

  for (const row of rows) {
    if (!row || row.length < 14) {
      skipped += 1;
      continue;
    }
    try {
      const securityCode = toSecurityCode(String(row[0]));
      const announcementDate = toDate(row[3]);
      const recordDate = toDate(row[5]);
      const effectiveDate = toDate(row[6]);
      const cashAmount = toNumber(row[9]);
      const bonusRatio = toNumber(row[11]);
      const transferRatio = toNumber(row[13]);
      const description =
        row[12] === null ||
        row[12] === undefined ||
        String(row[12]).trim() === ""
          ? null
          : String(row[12]);

      const hasCash = cashAmount !== null && cashAmount > 0;
      const hasBonus = bonusRatio !== null && bonusRatio > 0;
      const hasTransfer = transferRatio !== null && transferRatio > 0;

      if (hasCash) {
        push(
          securityCode,
          "dividend",
          effectiveDate,
          recordDate,
          announcementDate,
          description,
          { cashAmount }
        );
      }
      if (hasBonus) {
        push(
          securityCode,
          "bonus_issue",
          effectiveDate,
          recordDate,
          announcementDate,
          description,
          { bonusRatio }
        );
      }
      if (hasTransfer) {
        push(
          securityCode,
          "transfer",
          effectiveDate,
          recordDate,
          announcementDate,
          description,
          { transferRatio }
        );
      }
      if (!hasCash && !hasBonus && !hasTransfer) {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return { actions, skipped };
}
