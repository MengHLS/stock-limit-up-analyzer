# STEP 7.3 — 数据完整性报告（Data Integrity）

> 报告日期：2026-09-06
> 状态：**代码级完整性保障已实现；实盘数据完整性待回填后验证**

---

## 一、完整性保障机制（已实现，§17–§22、§26–§27）

### 1. 幂等写入（§26）
- `backfill_checkpoints` 表 `tradeDate` 唯一键；`stock_daily_prices` 沿用既有 `(stockCode, tradeDate)` 唯一键。
- 持久化走 `ON DUPLICATE KEY UPDATE`（`upsertStockDailyPrices`），重复回填不产生重复行。

### 2. Checkpoint 一致性（§20）
- 状态机 `PENDING → RUNNING → SUCCESS | FAILED | SUSPICIOUS | QUOTA_STOPPED`。
- **仅在持久化成功后写 `SUCCESS`**，避免「已标记成功但未落库」的不一致。

### 3. 已有数据保护（§27）
- 全程仅幂等 upsert；**无 DELETE / TRUNCATE / 暴力重建**。

### 4. 单位一致性（§7）
- Raw 层保留原始单位（手/千元）并显式标记 provenance；
- Canonical 层归一化为 shares / CNY（`vol×100`、`amount×1000`）；
- DB 持久化仍写原始单位（与既有窄样本生产数据一致）。

### 5. 数据校验（§15）
- `validateCanonicalBackfillBar()`：symbol 格式 / 日期有效 / OHLC>0 / volume&amount≥0 / OHLC 关系 / 非交易日告警。
- 仅 VALID / WARNING 且具备必需价格的行才持久化；INVALID / UNPERSISTABLE 计数不入库。

### 6. 重复键检测
- `queryDuplicateCount`（DB 侧）可审计是否有重复 `(stockCode, tradeDate)`。

---

## 二、完整性风险清单（待实盘验证）

| 风险 | 说明 | 缓解 |
|------|------|------|
| 停牌缺失 | 停牌日无 OHLC 行 → 覆盖度缺失 | 覆盖度报告标记缺失日期 |
| 单位漂移 | 若 Tushare 未来改单位定义 | `volumeUnit/amountUnit` provenance 显式记录 |
| 部分响应 | Tushare 返回不完整当日数据 | `receivedRows` vs `rowCount` 记录 + suspicious 检测 |
| 重复写入 | 并发/重试导致重复 | 唯一键 + 幂等 upsert |
| 迁移冲突 | 0018 编号漂移 | 见迁移漂移报告 |

---

## 三、结论

完整性保障**在代码层面已完备**（幂等 + checkpoint 一致性 + 单位溯源 + 校验 + 去重检测）。**实盘完整性（无重复、无缺失、单位正确）需在 Pilot 与全量回填后，通过覆盖度报告与 `queryDuplicateCount` 复核确认。** 当前不可据此声称数据已完整。
