# STEP 7.3 — 迁移漂移报告（Migration Drift）

> 报告日期：2026-09-06
> 主题：`drizzle/0018_backfill_checkpoints.sql` 编号漂移的成因、影响与处置

---

## 一、问题概述

本 STEP 需要一个 checkpoints 持久化表（`backfill_checkpoints`）。按序应分配迁移号 `0016`，但落地时发现编号已被并行开发轨道占用，因此最终落地为 **`0018_backfill_checkpoints.sql`**。

## 二、并行轨道占位（漂移根因）

检查 `drizzle/` 目录，发现以下迁移文件已存在（**非本 STEP 产生**，属并行开发轨道）：

| 迁移号 | 文件 | 所属轨道 |
|--------|------|----------|
| 0016 | `0016_market_data_infra.sql` | STEP 7.6（市场数据基础设施） |
| 0017 | `0017_corporate_actions.sql` | STEP 7.7（公司行为） |
| 0017 | `0017_security_status_history.sql` | STEP 7.4（证券状态历史） |
| **0018** | **`0018_backfill_checkpoints.sql`** | **STEP 7.3（本 STEP）** |

> 注意：并行轨道存在 **两个 0017**（`0017_corporate_actions` 与 `0017_security_status_history`），说明并行开发本身已存在编号冲突，需由各自轨道负责人核对最终序列。

## 三、处置过程

1. 初版误将本 STEP 迁移编号为 `0016`，并写入了 `drizzle/meta/_journal.json`。
2. 发现并行轨道已占用 0016/0017 后：
   - 将本 STEP 迁移重命名为 **`0018_backfill_checkpoints.sql`**；
   - **回退** `_journal.json` 中误加的 0016 条目（journal 序号保留在 15，避免破坏并行轨道的元数据）。
3. 最终状态：`_journal.json` 序号 = 15（由本 STEP 负责的部分保持原状），本 STEP 迁移文件独立为 0018。

## 四、影响与风险

| 项 | 评估 |
|----|------|
| 本 STEP 功能 | ✅ 无影响 —— `backfill_checkpoints` 表可独立创建 |
| journal 元数据 | ⚠️ 需人工核对：0018 尚未写入 `_journal.json`（因并行轨道拥有 0016/0017 的 journal 归属） |
| 迁移执行顺序 | ⚠️ 需确认最终迁移序列：0016 → 0017(二选一/合并) → 0018，避免重复或缺失 |
| 生产库 | ⛔ 尚未对生产库执行任何迁移（§23 硬门槛） |

## 五、后续建议（供迁移负责人）

1. **统一迁移号**：由迁移负责人确认 0016/0017 的最终归属，合并或区分两个 0017。
2. **补写 journal**：在确认序列后，将 0018 正确追加到 `drizzle/meta/_journal.json`。
3. **先 dry-run 后执行**：对生产库执行迁移前，先在 staging 环境验证 0018 的 CREATE TABLE 无冲突。
4. **不得**由本 STEP 擅自推进迁移执行（遵守 §23 Pilot 硬门槛 + §48 轨道边界）。

---

## 六、结论

迁移漂移是**并行轨道编号冲突**所致，非本 STEP 代码缺陷。本 STEP 通过重命名为 0018 已规避直接冲突，但最终序列需迁移负责人统一协调。**当前不可对生产库执行迁移**。
