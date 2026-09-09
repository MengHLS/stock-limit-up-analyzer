# DATASET_VERSIONING — Research Dataset 版本化规范

> 版本：v1.0 | 日期：2026-09-09 | 权威实现：`server/researchDataset/version.ts` + `policy.ts` + `persist.ts`

---

## 1. 身份模型（content-addressed，不可变）

```
datasetVersion = rd-<builderVersion>-<rowSchemaVersion>-<16hex>
               = rd-1.0.0-1-<sha256(rows).slice(0,16)>
datasetId      = DS-<datasetVersion>
```

- `builderVersion = "1.0.0"`（构建器语义版本，构建逻辑变更才 bump）。
- `rowSchemaVersion = "1"`（行投影 schema 版本，行形状变更才 bump）。
- `<16hex>` = 标准行内容 sha256 前 16 位（**内容寻址**，行变了版本必变）。

**关键设计决策（任务显式要求，保持不变）**：
- 身份是**内容寻址不可变**的，**不引入 V1/V2/V3 语义版本**。语义演化由 `builderVersion`/`rowSchemaVersion` 前缀承载，不改变身份模型。

## 2. 三级指纹

| 指纹 | 计算 | 长度 | 用途 |
|---|---|---|---|
| `rowsFingerprint` | sha256(行内容 canonical stringify) | 前 32 hex | 行内容不可变 |
| `policySetFingerprint` | sha256(9 类 policy) | 前 16 hex | policy 冻结 |
| `versionSnapshotFingerprint` | sha256(版本快照产物) | 前 16 hex | 版本快照防篡改 |

## 3. 确定性保证

- `buildResearchDataset` 是确定性纯编排（无 Date.now / Math.random 影响行内容）。
- 行在组装后**强制重排为 `(tradeDate, securityId)` 升序**，再计算 `dataSnapshot` / `datasetVersion`。
  - 修复前：universe 成员按 `exchange→code→securityId` 顺序，违反 `bindResearchDataset` 的排序不变量，正式链从未 E2E 过（`research_runs=0` 掩盖了此 bug）。
  - 修复后：两次构建同一窗口，`datasetVersion` 一致（E2E 实查验证）。

## 4. 幂等持久化

`persistResearchDataset` 按 `datasetId` 唯一键幂等写入 `research_datasets`；重复持久化不产生新行、不改历史。

## 5. 与 Research Run 的绑定

`research_runs` 新增三列（migration 0025）：
- `datasetId`（可空）
- `datasetVersion`（可空）
- `datasetFingerprint`（可空）

**legacy 路径**（engineAdapter）这三列为 `NULL`，用于与 FORMAL 路径（强绑定）区分。

## 6. 身份完整性（防篡改）

- `datasetVersion` 由行内容派生，任何人改行内容必然改变版本号。
- `certify` 校验 `policySet` 含 `pit` + `survivorship`，缺失即 CONDITIONAL（不伪造安全）。
