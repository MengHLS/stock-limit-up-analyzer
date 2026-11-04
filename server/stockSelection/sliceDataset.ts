/**
 * 事件窗切片 → `ResearchDataset` 形状适配器。
 *
 * 目的：让「按决策日选股」能够**复用既有权威选股实现**
 * （`server/research/compositeRunner#buildCompositeEvents` / `#buildCompositeSourceRun`），
 * 而不是在选股域里写第二套打分 / 过滤逻辑。
 *
 * 🔴 这不是认证数据集产物：
 *   - 不落库、不作为 `datasetVersionId` 坐标、不参与 dataset gate（gate 恒为 INCONCLUSIVE）；
 *   - `datasetVersion` 用 `selection-slice:<parent>:<date>` 前缀，**刻意不与真实坐标同形**，
 *     避免任何调用方把它当成真实数据集版本；
 *   - 元数据（universe days / dataSnapshot / policySet）如实描述**本次切片的加载事实**，
 *     由平台自己的 `normalizeResearchDatasetRequest` + `derivePolicySet` 派生，不手写口径。
 */

import { derivePolicySet } from "../researchDataset/policy";
import { normalizeResearchDatasetRequest } from "../researchDataset/validate";
import type { DataSnapshot, ResearchDataset, ResearchDatasetRow } from "../researchDataset/types";

export interface SelectionSliceDatasetInput {
  /**
   * 父数据集版本 id（仅用于可追溯标注，不冒充坐标）。
   * `null` = 本次切片不来自数据集载体（如 `live` 当日行情）——如实登记，不编造坐标。
   */
  readonly parentDatasetVersionId: number | null;
  /** 本次切片服务的决策日。 */
  readonly decisionDate: string;
  /** 事件窗投影行（`buildWindowRows` 产物：rd=0 ∪ rd∈[1, end+1]）。 */
  readonly rows: readonly ResearchDatasetRow[];
  /** 切片涉及的交易日（升序、去重、含事件日 rd=0 与决策日 rd=5）。 */
  readonly tradingDays: readonly string[];
  /** 组装时点（注入以便确定性测试）。 */
  readonly capturedAt: string;
}

export function buildSelectionSliceDataset(input: SelectionSliceDatasetInput): ResearchDataset {
  const days = [...input.tradingDays];
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("selectionSlice: 交易日为空，无法构造切片数据集");
  }

  const request = normalizeResearchDatasetRequest({
    name: `stock-selection-slice:${input.parentDatasetVersionId}:${input.decisionDate}`,
    startDate: first,
    endDate: last,
  });

  const dataSnapshot: DataSnapshot = {
    capturedAt: input.capturedAt,
    request,
    calendarName: "ds-event-window-slice",
    calendarFirstDate: first,
    calendarLastDate: last,
    tradingDays: days.length,
    domains: [
      {
        domain: "A",
        rowsLoaded: input.rows.length,
        securitiesCovered: new Set(input.rows.map((row) => row.securityId)).size,
        datesCovered: days.length,
        datesExpected: days.length,
        note:
          `事件窗切片（父数据集 ${input.parentDatasetVersionId ?? "无（非数据集载体）"}，决策日 ${input.decisionDate}）：` +
          "rd=0 来自 prefix、rd≥1 来自 post；只覆盖本次决策涉及的事件。",
      },
    ],
    coverageGaps: [],
  };

  return {
    datasetVersion: `selection-slice:${input.parentDatasetVersionId ?? "live"}:${input.decisionDate}`,
    universeDefinition: {
      rule: "stock-selection-slice（事件窗切片；仅决策日有候选成员）",
      asOfDescription: "逐日 PIT：asOf = tradeDate（与父数据集同口径）",
      days: days.map((tradeDate) => ({
        tradeDate,
        isTradingDay: true,
        members: [] as readonly string[],
        excludedByReason: {} as Readonly<Record<string, number>>,
      })),
    },
    policySet: derivePolicySet(request, dataSnapshot),
    dataSnapshot,
    rows: [...input.rows],
    // 切片刻意**不声明 PASS**：它不是认证产物，只作为既有实现的输入。
    gate: "INCONCLUSIVE",
    gateNotes: ["选股切片非认证产物（不落库 / 不代表数据集坐标）。"],
  };
}
