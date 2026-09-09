# P2-T2 验收 — 同输入两次构建一致性验证

> 状态：VALIDATED | 日期：2026-09-09

## 验收标准

| 项 | 验收要求 | 结果 | 证据 |
|----|---------|------|------|
| 1 | 同输入两次构建 diff 为空 | ✅ PASS | datasetVersion / rowsFingerprint / policySetFingerprint / rowCount / memberDayCount / gate 全一致 |

## 验证方式

`scripts/verifyDatasetConsistency.mts` 串行调用 `buildResearchDataset` 两次（相同请求），对比全字段。

- datasetVersion A == B：`rd-1.0.0-1-879c5142a56cca67`
- rowsFingerprint A == B：`4b4b189f791a4228c445090e2d2e2c15`
- policySetFingerprint A == B：`b415ca53256beeb5`
- rowCount A == B：200（maxSecuritiesPerDay 限制）
- memberDayCount A == B：5097
- gate A == B：INCONCLUSIVE

## 确定性根源

`computeDatasetVersion(request, universe, rows)` 是纯函数（`canonicalStringify` 键字典序递归排序 + SHA-256 前 16 hex），不含 capturedAt/瞬时字段 → 同输入必同版本。
