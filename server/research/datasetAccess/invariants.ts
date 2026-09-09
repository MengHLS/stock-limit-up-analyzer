/**
 * STEP 13 / C-13.1 — Research Dataset 访问层：共享不变量（单一事实来源）。
 *
 * 目前只有一条：逐日 PIT 决议不变量 asOf === tradeDate。
 * 由 bindResearchDataset（绑定期）与 rowToCanonicalBar（单行映射入口）共用，
 * 保证两条防守路径报错口径一致，未来新增不变量在此集中维护。
 */

import type { ResearchDatasetRow } from "../../researchDataset/types";

/** 断言逐日 PIT 不变量：asOf === tradeDate（默认口径每行 asOf=tradeDate）。 */
export function assertRowPitInvariant(row: ResearchDatasetRow): void {
  if (row.asOf !== row.tradeDate) {
    throw new Error(
      `ResearchDatasetRow(${row.tradeDate}, ${row.securityId}): 违反逐日 PIT 决议约束，` +
        `asOf=${row.asOf} != tradeDate=${row.tradeDate}；` +
        `本访问层只支持 asOfPerTradeDate=true 的逐日 PIT 面板，禁止把冻结快照/脏行喂给按日 Research Engine`,
    );
  }
}
