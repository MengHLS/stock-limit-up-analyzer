# P2-T1 验收 — research_datasets 表持久化

> 状态：VALIDATED | 日期：2026-09-09

## 验收标准（MASTER_TASK_TRACKING）

| 项 | 验收要求 | 结果 | 证据 |
|----|---------|------|------|
| 1 | `research_datasets` 表落库 | ✅ PASS | 18 列齐全，`SHOW COLUMNS` 确认 |
| 2 | 持久化链路（persistResearchDataset） | ✅ PASS | datasetVersion/rowsFingerprint/policySetFingerprint/versionSnapshotJson 全落库 |
| 3 | ≥1 真实 dataset 记录 | ✅ PASS | 1 条真实记录，rowCount=20391（非空） |
| 4 | 幂等（同 datasetVersion 回放不重复） | ✅ PASS | datasetId = DS-<datasetVersion> 唯一；persist 层先查后插 |

## 关键过程

1. **表定义 + 迁移**：`drizzle/schema.ts` 加 `researchDatasets`（18 列）；`scripts/migrate_add_research_datasets.ts` 幂等 DDL 落库；`drizzle/0024_research_datasets.sql` reconciliation 记录。
2. **持久化层**：`server/researchDataset/persist.ts` 新增 `persistResearchDataset`，绑定 versionSnapshot（`buildDatasetVersionSnapshot`）+ rowsFingerprint（`computeRowsFingerprint`）+ policySetFingerprint。
3. **CLI 扩展**：`runStep126BuildDataset.mts` 加 `--persist` 标志。

## 附带修复（本任务暴露的 G1 阻塞缺口）

首次真实构建产出 **universe=0 / rows=0**，根因：`research_security_status_history` 只回填了 SUSPENSION(9532)+ST(841)，缺 **TRADING 维度**；而 `resolveHistoricalUniverse` 把 TRADING 当「正向确认维度」（UNKNOWN→拒绝），导致全市场默认拒绝。

**修复**：新增 `scripts/backfillTradingStatus.mjs`，从 `research_securities.listedDate/delistedDate` 派生 5552 条 TRADING 记录（幂等），符合原设计（不修改 universe 决议语义）。

**效果**：universe 0→20391 成员日；rows 0→20391；excludedReasonCodes 中 `TRADING_UNKNOWN` 消失。

## 验证

- `tsc --noEmit` 无错误。
- `server/researchDataset/policy.test.ts`(16) + `version.test.ts`(6) = 22 测试全绿。
- 真实构建（2024-01-02~05，4 交易日）20391 行落库，datasetVersion 可复现。
