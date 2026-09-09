/**
 * STEP 13 / C-13.1 — Research Dataset 访问层：Universe 视图。
 *
 * 由 handle.universeDefinition.days（逐日 universe 决议）实现 framework 的
 * UniverseProvider 契约：
 *   - getUniverse(asOfDate) 返回该日 PIT 决议的可交易成员（dataset 已保证确定性排序）；
 *   - 缺失日期（非交易日 / 超出窗口）FAIL FAST，绝不静默返回空或回退「当前股票列表」；
 *   - 跨日切片按日期过滤由调用方逐日查询完成（与 pipeline 单 decisionTime 契约一致）。
 */

import type { ResearchDatasetHandle } from "./handle";
import type { UniverseProvider } from "../framework/contract";

interface UniverseDayIndexEntry {
  readonly isTradingDay: boolean;
  readonly members: readonly string[];
}

/** 依据 handle 的逐日决议构建 UniverseProvider。 */
export function createDatasetUniverseProvider(handle: ResearchDatasetHandle): UniverseProvider {
  const dayByDate = new Map<string, UniverseDayIndexEntry>();
  for (const day of handle.universeDays) {
    dayByDate.set(day.tradeDate, {
      isTradingDay: day.isTradingDay,
      // members 由 dataset 保证确定性排序（exchange → code → securityId），只读引用不再改写。
      members: day.members,
    });
  }

  return {
    universeId: handle.universeId,
    getUniverse(asOfDate: string): readonly string[] {
      const entry = dayByDate.get(asOfDate);
      if (!entry) {
        throw new Error(
          `DatasetUniverse(${handle.universeId}): 无 ${asOfDate} 的 universe 决议` +
            `（非交易日或超出数据集窗口 ${handle.startDate} ~ ${handle.endDate}），禁止回退到当前股票列表`,
        );
      }
      if (!entry.isTradingDay) {
        throw new Error(
          `DatasetUniverse(${handle.universeId}): ${asOfDate} 在决议中标记为非交易日，禁止作为决策日`,
        );
      }
      return entry.members;
    },
  };
}
