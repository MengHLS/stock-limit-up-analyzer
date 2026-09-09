# P2-T3 验收 — 9 项 policy 冻结

> 状态：VALIDATED | 日期：2026-09-09

## 验收标准

| 项 | 验收要求 | 结果 | 证据 |
|----|---------|------|------|
| 1 | 9 项 policy 齐备 | ✅ PASS | 真实构建的 policySet 含 9 类，顺序正确 |
| 2 | policy 文档 + 版本 | ✅ PASS | `docs/quantRoadmap/reports/research-dataset-policies.md`（FROZEN v1.0） |
| 3 | policy 一致性校验 | ✅ PASS | `policy.test.ts` 16 测试全绿（含 derivePolicySet 确定性 + 齐备性） |

## 9 类 policy（顺序）

`pit → survivorship → corporate-action → adjustment → industry → liquidity → universe-membership → calendar-trading-days → knowledge`

## 关键证据

- 真实构建的 `versionSnapshotJson` 中 policySet 类数 = 9，顺序与 `RESEARCH_DATASET_POLICY_ORDER` 完全一致。
- `policySetFingerprint = 8ee5e42b4d96094e` 在两次真实构建中**完全一致**（policy 是口径声明，不随 universe/rows 内容变化）。
- policy schema 版本 = `1`（`RESEARCH_DATASET_POLICY_SCHEMA_VERSION`）。

## 冻结文档

见 `docs/quantRoadmap/reports/research-dataset-policies.md`，含 9 类 policy 的权威口径（value 派生规则）+ 铁律 + 校验四层 + 版本。
