/**
 * STEP 13 / C-13.1 — Research Dataset 访问层：日期范围切片（闭区间）。
 *
 * 对齐 datasetSplit 的日期语义：[start, end] 闭区间、两端点含、start === end 为
 * 合法单日区间。只按 tradeDate 切分（dataset 行即逐日 PIT，不存在需要按 asOf 二次
 * 过滤的行）；切分结果保留原 (tradeDate, securityId) 升序，确定性。
 */

import { assertValidDatasetRange, type ResearchDatasetRange } from "../datasetSplit";
import type { ResearchDatasetRow } from "../../researchDataset/types";

/**
 * rows 按 tradeDate ∈ [range.start, range.end]（闭区间）切片。
 * 返回新数组，不改入参；无命中返回空数组（不抛错——是否要求非空由调用方按业务判断）。
 */
export function sliceRowsByDateRange(rows: readonly ResearchDatasetRow[], range: ResearchDatasetRange): readonly ResearchDatasetRow[] {
  assertValidDatasetRange(range);
  const out: ResearchDatasetRow[] = [];
  for (const row of rows) {
    if (row.tradeDate < range.start) continue;
    if (row.tradeDate > range.end) break; // rows 升序，越过 end 即可停止。
    out.push(row);
  }
  return out;
}
