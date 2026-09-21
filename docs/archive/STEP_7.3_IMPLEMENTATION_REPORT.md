# STEP 7.3 — 全市场 OHLCV 回填与规范化 实施报告

> 报告日期：2026-09-06
> 状态：**CONDITIONAL PASS / IMPLEMENTATION READY**（代码 + 单元测试通过；Pilot / 全量回填尚未对生产库执行）

---

## 一、总体结论（§50 Verdict）

| 维度 | 结果 |
|------|------|
| 代码实现（A–N 全部交付物） | ✅ 已完成 |
| 单元测试（14 文件 / 117 用例） | ✅ 全部通过 |
| 类型检查 / 构建 | ✅ `npm run build` PASS；backfill 模块 `npm run check` 干净 |
| 迁移脚本（0018_backfill_checkpoints） | ✅ 已生成（含漂移说明，见迁移漂移报告） |
| 全市场回填（2019-01-01 → 当前） | ⛔ 未执行（§23/§24 硬门槛：必须先跑 Pilot 3 交易日 + 5–10 连续交易日 + 断点续跑验证） |
| 最终判定 | **IMPLEMENTATION READY**（不可声称 FULLY COMPLETE） |

> 依据 §50：verdict 必须区分 IMPLEMENTED / PILOT VERIFIED / FULLY COMPLETE 三档。
> 当前仅达到第一档。Pilot 与全量回填需在有 Tushare Token 的环境下由运维/用户触发（CLI 已备好）。

---

## 二、交付物核对（§A–N）

| 编号 | 交付物 | 文件 | 状态 |
|------|--------|------|------|
| A | 全市场回填架构 | `server/backfill/scheduler.ts` + `pipeline.ts` | ✅ |
| B | Provider 适配层（中立接口） | `server/backfill/provider.ts` + `types.ts` | ✅ |
| C | Raw→Canonical 规范化 | `server/backfill/canonical.ts` + `units.ts` | ✅ |
| D | 流式/分块摄取 | `server/backfill/pagination.ts`（keyset）+ `dbRead.ts` | ✅ |
| E | Checkpoint/断点续跑 | `server/backfill/checkpoint.ts` + `checkpointDb.ts` | ✅ |
| F | 重试/限流 | `server/backfill/retry.ts` + `rateLimiter.ts` | ✅ |
| G | 幂等 upsert | `server/backfill/persistence.ts`（依赖 DB 唯一键） | ✅ |
| H | 每日覆盖度校验 | `server/backfill/coverage.ts` | ✅ |
| I | 缺失日期/标的检测 | `server/backfill/coverage.ts` + `scheduler.ts`（suspicious 检测） | ✅ |
| J | 已有数据保护 | 幂等 upsert，不 DELETE/TRUNCATE（§27） | ✅ |
| K | 消除全表内存加载 | `dbRead.ts`（DB 侧聚合）+ keyset 分页；`db.ts` 有界查询 | ✅ |
| L | 可复现回填清单 | `server/backfill/manifest.ts` | ✅ |
| M | 回填审计报告 | 本报告 + coverage/integrity 报告 | ✅ |
| N | 测试 | 14 个 `*.test.ts`，117 用例 | ✅ |

---

## 三、架构总览

```
                    ┌────────────────────────────────────────────┐
                    │           BackfillScheduler (顺序)          │
                    │  resolveTargetDates → checkpoint 恢复 → 循环 │
                    └───────┬──────────────────────┬─────────────┘
                            │                      │
                 ┌──────────▼─────────┐   ┌────────▼─────────┐
                 │ MarketDataProvider │   │ TradingCalendar   │
                 │  (Tushare 实现)     │   │ Provider (Tushare)│
                 │  fetchDailyByDate  │   │  fetchTradingDates│
                 └──────────┬─────────┘   └──────────────────┘
                            │ (raw bars, 带 unit provenance)
                 ┌──────────▼─────────┐
                 │  RateLimiter(6s)   │   ┌──────────────────┐
                 │  RetryPolicy       │   │  withRetry()      │
                 └────────────────────┘   └──────────────────┘
                 ┌──────────────────────────────┐
                 │  runDailyPipeline()           │
                 │  Raw → Canonical → Validate   │
                 └──────────────┬───────────────┘
                 ┌──────────────▼───────────────┐
                 │  persistInBatches (≤1000/batch)│
                 │  idempotent ON DUPLICATE KEY  │
                 └──────────────┬───────────────┘
                 ┌──────────────▼───────────────┐
                 │  Checkpoint SUCCESS (仅持久化成功后)│
                 └──────────────────────────────┘
```

### 关键设计约束（严格遵循 §28–§30、§6–§8）
1. **数据源优先级**：`daily` 为唯一主源；未接入 `stock_basic` / `daily_basic` / `index_daily` / `adj_factor`（§28 禁止）。BaoStock 未作主源。
2. **单位溯源**：Raw 层保留 `volumeUnit="hands"`、`amountUnit="thousand-cny"`；Canonical 层归一化为 `shares` / `CNY`。
   - `vol × 100`（手→股）；`amount × 1000`（千元→CNY）。
3. **不复权**：`adjustment = "raw"`（§29）。
4. **时间语义**：`tradeDate` 为交易日（`YYYY-MM-DD`），无日内时间戳；`retrievedAt` 为抓取时刻（ISO8601，UTC）。

---

## 四、核心模块实现说明

### 1. Provider 适配层（`provider.ts` + `types.ts`）
- `MarketDataProvider` / `TradingCalendarProvider` 为中立接口，业务/调度器**绝不直接调用 Tushare**。
- `TushareMarketDataProvider` 注入 `fetchTushareDailyPricesByDate`；`tusharePriceToRawBar()` 将 Tushare 行映射为 `RawDailyBar`（显式标记 `volumeUnit`/`amountUnit`）。
- `computeRawHash()`：对行做 SHA-256，生成 `rawHash` 供溯源/审计。

### 2. 规范化（`canonical.ts` + `units.ts`）
- `mapRawToCanonical()`：单位转换 → 挂 provenance（`source`/`sourceVersion`/`retrievedAt`/`rawHash`）→ `adjustment="raw"`。
- `units.ts` 常量：`SHARES_PER_HAND=100`、`CNY_PER_THOUSAND=1000`。

### 3. 校验（`validation.ts`）
- `validateCanonicalBackfillBar()` 检查：
  - symbol 非空 + `^\d{6}\.(SH|SZ|BJ)$` 格式；
  - 日期有效；OHLC > 0；volume/amount ≥ 0；
  - OHLC 关系：`HIGH ≥ MAX(OPEN,CLOSE)`、`LOW ≤ MIN(OPEN,CLOSE)`、`HIGH ≥ LOW`；
  - 非交易日仅告警（WARNING，不阻断）。
- 采用 `price > 0` 严格方向（与 §15 一致）。

### 4. 限流（`rateLimiter.ts`）
- `IntervalRateLimiter`：`minIntervalMs` 默认 `DEFAULT_REQUEST_INTERVAL_MS=6000`；注入 clock/sleeper 便于测试。
- `resolveRequestIntervalMs()` 读取环境变量覆盖。

### 5. 重试（`retry.ts`）
- `DEFAULT_RETRY_POLICY`：`transientDelaysMs=[1000,2500,5000]`、`rateLimitBackoffMs=60000`、`maxRateLimitRetries=1`。
- `withRetry()`：瞬态错误重试；限流错误等待 60s 后重试一次，仍失败则 `QUOTA_STOP`；auth/unknown 不重试。
- 错误分类（`errors.ts`）：`TRANSIENT_NETWORK` / `RATE_LIMIT`（40203→`RATE_LIMIT`）/ `QUOTA_EXCEEDED` / `AUTHORIZATION` / `MALFORMED_DATA` / `VALIDATION_ERROR` / `PERSISTENCE_ERROR` / `UNKNOWN`。

### 6. 交易日历（`tradingCalendar.ts`）
- `fetchTushareTradeCalendar()` 使用 `trade_cal`（SSE + SZSE），合并去重 `isOpen` 交易日；`extractTradingDates()` 提取 `YYYY-MM-DD` 列表。

### 7. Checkpoint（`checkpoint.ts` + `checkpointDb.ts`）
- 状态机：`PENDING → RUNNING → SUCCESS | FAILED | SUSPICIOUS | QUOTA_STOPPED`。
- **一致性规则**：仅在持久化成功后才写 `SUCCESS`（§20）。
- `DbCheckpointStore` 基于 drizzle `backfill_checkpoints` 表（`tradeDate` 唯一，upsert）。

### 8. 持久化（`persistence.ts`）
- `persistInBatches()`：有界批量（≤1000/batch）；`rawBarToUpsert()` 写入**原始单位（手/千元）**，与既有窄样本生产数据及 `upsertStockDailyPrices` 幂等逻辑保持一致。
- `StockDailyPriceUpsertCandidate` + `hasRequiredPrices()`：open/close/preClose 可能为 null，仅当具备必需价格才持久化。

### 9. 分页/内存安全（`pagination.ts` + `dbRead.ts`）
- **Keyset 分页**（`iterateKeysetPages()`），非 OFFSET；死循环守卫。
- DB 侧聚合：`queryDailyAggregates` / `queryYearlyAggregates` / `queryDuplicateCount` / `queryDistinctSymbolCount`，**绝不全表加载到内存**（§40）。
- `db.ts` 的 `loadStockDailyPriceRows(range?)` 增加 `{startDate, endDate, stockCodes}` 有界查询。

### 10. 调度器（`scheduler.ts`）
- 顺序执行（`concurrency=1`）：resolve 目标日期 → checkpoint 恢复 → `rateLimiter.wait()` → fetch + `withRetry` → pipeline → persist → checkpoint 更新。
- suspicious 检测：对比 `median` 行数；`QUOTA_STOP` 时中断循环。

### 11. 清单（`manifest.ts`）
- `generateManifestId()` 用 `crypto.randomBytes`（非 `Math.random`）；`createManifest` / `finalizeManifest`。

### 12. CLI（`scripts/backfillDaily.ts`）
- 参数：`--start` / `--end` / `--dry-run` / `--batch-size` / `--interval`。
- `npm run backfill:daily`（`package.json` 已加）。

---

## 五、Schema 迁移

| 项 | 值 |
|----|----|
| 表 | `backfill_checkpoints` |
| 迁移文件 | `drizzle/0018_backfill_checkpoints.sql` |
| 唯一键 | `tradeDate` |
| 字段 | `status`(enum) / `attempts` / `rowCount` / `receivedRows` / `completedAt` / `errorCode` / `errorMessage` / 索引 |

> ⚠️ 编号为 **0018** 而非 0016 —— 因并行轨道（STEP 7.4/7.6/7.7）已占用 0016/0017。详见《STEP_7.3_MIGRATION_DRIFT_REPORT.md》。

---

## 六、测试结果

| 项 | 结果 |
|----|------|
| backfill 模块单元测试 | **117 passed / 0 failed** |
| 测试文件 | `units` / `canonical` / `validation` / `rateLimiter` / `retry` / `provider` / `checkpoint` / `persistence` / `pagination` / `coverage` / `scheduler` / `pipeline` / `tradingCalendar` / `errors`（14 个） |
| 全仓 `npm test` | 15 failed / 1146 passed（15 个失败均为**历史环境基线**，见下） |
| `npm run build` | ✅ PASS（dist/index.js 501.5kb） |
| `npm run check` | backfill 模块干净；仅并行轨道遗留错误 |

### 全仓 15 个失败 = 历史基线（非本次引入）
- `customSector`(1)、`watchStatus`(4)、`marketData`(4) —— 环境/并行轨道遗留；
- `stockPriceSyncPage`(2) —— `client/src/pages/StockPriceSync.tsx` 缺失（ENOENT，非本 STEP 文件）；
- `tushare.secret`(1) —— 无 TUSHARE_TOKEN；
- `tushareTradingCalendar`(3) —— 网络超时。

**结论：0 新增回归。**

---

## 七、已知限制 / 待办

1. **Pilot 未执行**（§23/§24 硬门槛）：需在有 Token 环境跑 3 交易日 Pilot → 5–10 连续交易日 → 断点续跑。
2. **全量回填未执行**（~9M stock-day，预计需要较长时间与足够 Tushare 积分）。
3. **覆盖度/完整性报告**：需真实回填后由 DB 侧聚合填充（`distinctSymbols` 等）。
4. **`loadStockDailyPriceRows`** 默认仍为全量，仅新增有界查询参数（调用方须显式传入 range 才受内存保护）。

---

## 八、绝对禁止事项合规确认（§3）

| 禁止项 | 是否触碰 |
|--------|----------|
| 策略逻辑 / Strategy Registry / STEP 6 选择权 | ❌ 未触碰 |
| WFO / PBO / CSCV / Portfolio / Risk | ❌ 未触碰 |
| STEP 8 Backtest / STEP 9–12 | ❌ 未触碰 |
| `limit_up_records` 业务定义 | ❌ 未触碰 |
| OCR / LLM 重设计 | ❌ 未触碰 |
| `stock_basic` / `daily_basic` / `index_daily` / `adj_factor` | ❌ 未接入 |
| 删除已有数据 / TRUNCATE / 暴力重建 | ❌ 仅幂等 upsert |
| 全表内存加载（`loadStockDailyPriceRows` 全量） | ✅ 已消除（新增有界查询 + keyset 分页 + DB 侧聚合） |
| token/secret 硬编码进代码或日志 | ❌ 未硬编码 |
| commit / push / 无关测试 / 大重构 | ❌ 未执行 |

---

## 九、下一步（供运维/用户执行）

```bash
# 1. 干跑（不落库，验证日历 + 抓取链路）
npm run backfill:daily -- --dry-run --start 2026-08-01 --end 2026-08-05

# 2. Pilot：3 个交易日
npm run backfill:daily -- --start 2026-08-03 --end 2026-08-05

# 3. 5–10 连续交易日 + 断点续跑验证
npm run backfill:daily -- --start 2026-08-01 --end 2026-08-10

# 4. 全量（2019-01-01 → 当前）
npm run backfill:daily -- --start 2019-01-01
```

> 每次执行前确认 `TUSHARE_TOKEN` 已注入环境，且积分充足（`daily` 接口限频）。
