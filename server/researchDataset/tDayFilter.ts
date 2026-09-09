/**
 * STEP 12.6 — Research Dataset：T 日条件过滤（纯函数，无 IO，确定性）。
 *
 * 语义（C-12.6.1 之上的可选窄化，不改 eligibility 判定）：
 *   - T 日条件 = 数据集只收录「T 日满足该信号」的 (tradeDate, securityId) 行。
 *   - 涨停判定复用 STEP 5 权威 `limitUpPrice`（close ≥ 前收 × (1+ratio)），
 *     口径与 `isLimitUpBar` 一致（未复权、未四舍五入阈值）；涨停比例按板块 + PIT ST 维度：
 *       主板 10%（ST/*ST 5%）、创业板/科创板 20%、北交所 30%、unknown 板块不可判。
 *   - 首板 = T 日涨停 且 T-1 未涨停（T-1 无数据/窗口首日视作「非连板」，弱化为首板，
 *     与 ./pullback「无前日即首板」口径一致）；连板 = T 日涨停 且 T-1 也涨停。
 *   - PIT：T-1 是否涨停只由「上一交易日」的已知数据决定（逐日滚动），绝不触碰未来。
 *   - 保守缺省：价格缺失 / 板块不可判 → 不算涨停（false），不伪造命中。
 */

import { classifyBoard, limitUpPrice } from "../data/boardRules";
import type { ResearchDatasetRow, TDayCondition } from "./types";

/** 行 → 涨停比例（按板块 + PIT ST 维度）；板块 unknown 或 ST 不可判 → null。 */
export function limitUpRatioForRow(
  row: Pick<ResearchDatasetRow, "code" | "st">,
): number | null {
  const board = classifyBoard(row.code ?? "");
  switch (board) {
    case "main":
      return row.st === "ST" || row.st === "*ST" ? 0.05 : 0.1;
    case "chinext":
    case "star":
      return 0.2;
    case "bse":
      return 0.3;
    default:
      return null;
  }
}

/** 行是否 T 日涨停（close ≥ 涨停价）；价格缺失 / 板块不可判 → false（保守）。 */
export function isRowLimitUp(
  row: Pick<ResearchDatasetRow, "code" | "st" | "close" | "preClose">,
): boolean {
  if (row.close === null || row.preClose === null || row.preClose <= 0) return false;
  const ratio = limitUpRatioForRow(row);
  if (ratio === null) return false;
  return row.close >= limitUpPrice(row.preClose, ratio);
}

/**
 * T 日条件是否命中。
 * @param condition 条件口径。
 * @param limitUp 该行 T 日是否涨停。
 * @param prevLimitUp 该证券上一交易日是否涨停；null = 窗口首日 / 无前日（视为「非连板」）。
 */
export function matchesTDayCondition(
  condition: TDayCondition,
  limitUp: boolean,
  prevLimitUp: boolean | null,
): boolean {
  switch (condition) {
    case "limitUp":
      return limitUp;
    case "firstBoard":
      return limitUp && prevLimitUp !== true;
    case "consecutiveBoard":
      return limitUp && prevLimitUp === true;
    case "none":
    default:
      return true;
  }
}
