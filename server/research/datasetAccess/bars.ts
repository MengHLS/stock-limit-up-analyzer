/**
 * STEP 13 / C-13.1 — Research Dataset 访问层：Row → CanonicalMarketBar 映射与 DataSource。
 *
 * 把 ResearchDataset 的扁平宽行（逐日 PIT 决议产物）映射为 framework 消费的
 * ResearchDataSource（getBars(securityId) 全窗口 bars；as-of / decisionTime 过滤由
 * pipeline 的 visibleBars 负责，本层不做二次 look-ahead 过滤——因为行本身即 PIT 安全）。
 *
 * 映射语义（设计决策，报告协调者）：
 *   - bar.symbol = row.securityId：数据集与 framework 都以 securityId 为主键（universe
 *     成员 / 信号 / 候选均为 securityId），bar 序列身份必须与 universe 成员一致；原始
 *     交易所代码仍保留在 row.code，不进入 bar.symbol。
 *   - bar.timestamp = row.tradeDate；OHLCV / volume / amount / turnoverRate 逐字段直拷
 *     （单位与 canonical 一致：price 元、volume 手、amount 千元、turnoverRate %）；
 *     adjustment 恒为 "raw"；null 原样透传（= 明确未知，禁止填零）。
 *   - 禁止 import DB：本层只消费 dataset 内存对象。
 *
 * 不变量：每行在映射入口再次断言 asOf === tradeDate（逐日 PIT），防未来有人绕过
 * bind 喂脏行给本映射。
 */

import type { CanonicalMarketBar } from "../../data";
import type { ResearchDatasetRow } from "../../researchDataset/types";
import type { ResearchDataSource } from "../framework/contract";
import type { ResearchDatasetHandle } from "./handle";
import { assertRowPitInvariant } from "./invariants";

/** Dataset 宽行结构上保证携带的标准数据域（strategy.requiredData 校验用）。 */
export const DATASET_ROW_DOMAINS = [
  "OHLCV",
  "Turnover",
  "Industry",
  "MarketState",
  "Status",
  "Identity",
] as const;

/** 单行 → CanonicalMarketBar 的纯映射（不修改入参；null 透传）。 */
export function rowToCanonicalBar(row: ResearchDatasetRow): CanonicalMarketBar {
  assertRowPitInvariant(row);
  return {
    symbol: row.securityId,
    timestamp: row.tradeDate,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    preClose: row.preClose,
    volume: row.volume,
    amount: row.amount,
    turnoverRate: row.turnoverRate,
    adjustment: "raw",
  };
}

/**
 * 构建 dataset 背书的 ResearchDataSource：
 *   - availableData：宽行结构保证携带的标准数据域（见 DATASET_ROW_DOMAINS）；
 *   - getBars(securityId)：该证券全窗口逐日 bars（升序，只读引用）；
 *     数据集无该证券任何行 → null（由 pipeline 记为 NO_BARS 剔除，不静默填空）。
 *
 * 构造期对 rows 做单遍分组：rows 已按 (tradeDate, securityId) 升序（bind 已断言），
 * 分组顺序即日期升序，无需再次排序，保证确定性。
 */
export function createDatasetDataSource(handle: ResearchDatasetHandle): ResearchDataSource {
  const barsBySecurity = new Map<string, CanonicalMarketBar[]>();
  for (const row of handle.rows) {
    let bars = barsBySecurity.get(row.securityId);
    if (bars === undefined) {
      bars = [];
      barsBySecurity.set(row.securityId, bars);
    }
    bars.push(rowToCanonicalBar(row));
  }

  return {
    availableData: [...DATASET_ROW_DOMAINS],
    getBars(securityId: string): readonly CanonicalMarketBar[] | null {
      const bars = barsBySecurity.get(securityId);
      return bars === undefined ? null : Object.freeze(bars.slice());
    },
  };
}
