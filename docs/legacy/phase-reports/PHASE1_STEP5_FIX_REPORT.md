# Step 5-FIX 修复报告
## Feature 接入生产 / 数据质量入库 / 涨停规则统一 / DB 唯一约束
### P1-F1 · P1-F2 · P1-F3 · P1-F4 · P2-F1 · P2-F2 · P2-F3

修复依据：`docs/PHASE1_STEP5_AUDIT_REPORT.md`（独立审计 FAIL：4 项 P1 + 3 项 P2；P0 无）。

> **结论声明**：本报告仅陈述修复内容、工程验证与已知边界，**不自行宣告 "STEP 5 PASS"**。
> 是否通过留待独立审计（Re-audit）。审计结论以代码真实状态为准，不采信本报告自述。

开发约束（全程遵守）：
- 不重设计 Step 1–5 已验收架构；Step 2（Core）/ Step 3（Strategy）/ Step 4（Risk）语义零改动（复用 `runBacktestWithRisk` / `buildStrategySignalProvider` / Registry / 内置策略）。
- 不批量新增因子 / 不改数据单位 / 不加随机与时钟依赖。
- Feature 只消费 asOf 允许数据；新增路径全部为确定性纯函数。

---

## 1. P1-F1（阻塞）— Feature Pipeline 接入生产组装点

**问题**：`runFeaturePipeline` 全仓唯一调用方是测试文件；`buildStrategySignalProvider` 的 `buildFeatures` 选项无任何生产调用方注入 → Feature Pipeline 是孤儿代码。

**修复**：新增**非测试**生产组装模块 `server/strategy/strategyBacktest.ts`（`runStrategyEngineBacktest`），把整条声明链路固化：

```
Raw(limit_up_records + stock_daily_prices 行)
  → toCanonicalBar（canonical adapter）
  → validateMarketBar（三态校验，INVALID 拒用）
  → runFeaturePipeline（visibleBars asOf 过滤，signalDate "close"）   ← 真实生产调用方
  → FeatureSnapshotBundle（createFeatureSnapshotBundle，同 asOf 按 symbol 组织）
  → buildStrategySignalProvider({ buildFeatures: (date) => featuresOfDate(date) })  ← 真实注入
  → StrategyContext.features
  → leader-candidate-baseline（featureMode="limit-up-confirm" 真实消费）
  → Signal → 默认 RiskManager（runBacktestWithRisk 注入）→ Approved Order → Backtest Core
```

- 新增 `FeatureSnapshotBundle`（`server/features/snapshot.ts`）：同一 `asOf{decisionDate,decisionPoint}` 下按 symbol 组织的只读快照集合；混入不同 asOf 成员即抛错。
- `buildFeatures` 按信号日惰性计算并缓存 bundle；`featureDates` / `confirmedSymbols` / `skippedSymbols` 探针随生产组装点输出，供测试与审计断言「生产 Provider 确实构建了 Feature」。

**审计复现命令（修复后）**：

```
grep -rn "runFeaturePipeline" --include="*.ts" server/ | grep -v "\.test\.ts"
# → server/strategy/strategyBacktest.ts:164（import 另计）非测试生产调用
grep -rn "buildFeatures:" --include="*.ts" server/ | grep -v "\.test\.ts"
# → server/strategy/strategyBacktest.ts:200  buildFeatures: (date) => featuresOfDate(date)
```

**验证**：`server/strategy/strategyBacktest.test.ts`（6 条生产集成测试，见 §8）。

---

## 2. P1-F2（阻塞）— 生产策略真实消费 Feature

**问题**：唯一生产策略 `leader-candidate-baseline` 的 `evaluate` 从不读取 `context.features`，即使修复 F1 特征也不影响任何真实决策。

**修复**（`server/strategy/strategies/leaderCandidateBaseline.ts`）：
- 配置新增 `featureMode: "off" | "limit-up-confirm"`：
  - `"off"`（默认）：行为与旧版完全一致，不读 `context.features`（既有调用方零影响）；
  - `"limit-up-confirm"`：候选除满足评分排序外，还须被价格库快照确认「信号日收盘涨停」——`limitUpHit` 必须 READY 且 value=1，且快照 `asOf` 与 `signalTime`/decisionPoint="close" 严格一致。
- 策略被配置为需 Feature 但未收到同 asOf 特征输入时 → 返回空决策 + `insufficientData: true`，**绝不静默降级为「未过滤」输出**。
- 契约/注册中心/适配层类型同步收窄：`StrategyFeatureInput = FeatureSnapshot | FeatureSnapshotBundle`（`contract.ts` / `registry.ts` / `adapter.ts`）。

**审计复现命令（修复后）**：`server/strategy/strategies/` 下 `features!` / `featureMode` 真实读取命中（`leaderCandidateBaseline.ts:164-177`），非测试代码消费 `context.features`。

---

## 3. P1-F3 — 入库路径接入 canonical 校验（杜绝 "undefined"/"null" 污染）

**问题**：`stockPriceSync.ts` 4 处持久化路径直接 `String(price.openPrice)` 写库，绕过 `toCanonicalBar` / `validateMarketBar`；`String(undefined) === "undefined"`、`String(null) === "null"` 会污染 DB。

**修复**（`server/stockPriceSync.ts`）：
- 新增 `toValidatedStockDailyPriceUpserts(priceRows, requestedCodes)` 统一转换：
  - 每行先 `toCanonicalBar` → `validateMarketBar`；
  - **INVALID**（OHLC 矛盾、负 volume/amount、非正价格等）→ 拒写 + `qualityIssues` 留痕（含违规 codes）；
  - **UNPERSISTABLE**：校验通过但 DB `NOT NULL` 列（open/close/preClose）缺失 → 拒写（绝不把缺失写成字符串）；
  - **WARNING**：放行入库，但同步输出质量留痕供日志/审计（provenance）；
  - 数值 → 字符串写库统一经 `text(value)`：缺失字段写数据库 `null`，不产生 `"undefined"/"null"` 字面量。
- 4 处生产持久化调用（约 L239 / L297 / L384 / L479）全部改走该转换器，并对每条质量留痕 `console.warn(formatValidatedPriceQualityIssue(issue))`。

**验证**：`server/stockPriceSync.test.ts`（15 条）覆盖 INVALID 拒写 / UNPERSISTABLE / WARNING 放行带 provenance / 可空字段落 DB null 等。

---

## 4. P1-F4 — 涨停规则统一到 boardRules 权威（消除 9.9% 近似）

**问题**：`realisticBacktest.ts`（L402/514/518）与 `paperTrading.ts`（L412/516/520）硬编码 `1.099` / `0.901`（±9.9%），把 10→10.99（+9.9%，非涨停）误判为涨停，且无法处理 ST/创业板/科创板/北交所差异。

**修复**：两文件涨跌停判定全部替换为 `server/data/boardRules.ts` 新增的纯函数 `isPriceAtLimitUp` / `isPriceAtLimitDown`（内部走 `resolveLimitRules` → 主板 10% / ST 5% / 创业板 20% / 科创板 20% / 北交所 30%）：

| 位置 | 判定 | 替换后语义 |
|---|---|---|
| `realisticBacktest.ts` 开盘止损 | 开盘价是否触及跌停 | `isPriceAtLimitDown({stockCode, stockName, price: marketOpenPrice, referencePrice: previousClosePrice})` |
| `realisticBacktest.ts` 追买拦截 | T+1 开盘是否触及涨停 | `isPriceAtLimitUp({..., price: entryOpenPrice, referencePrice: signalClosePrice})` |
| `realisticBacktest.ts` 跌停出清 / 一字跌停 | 收盘/开盘触及跌停 | `isPriceAtLimitDown`（两处） |
| `paperTrading.ts` 追买 / 一字涨停 | 开盘触及涨停 | `isPriceAtLimitUp` |
| `paperTrading.ts` 跌停出清 / 一字跌停 | 触及跌停 | `isPriceAtLimitDown`（两处） |

规则不可判定（板块无法归类 / 价格缺失 / 非正）→ 返回 `null`，调用方一律视为「不能确认触及」（`=== true` 才拦截），不再做伪 10% 假设。

**残留核对**：`grep "1.099|0.901"` 仅命中注释（解释性文字），无可执行近似。

**验证**：`realisticBacktest.test.ts` 新增「P1-F4：涨跌停判定统一走板块权威阈值」回归；`paperTrading.test.ts` 边界用例（原 10.99 伪涨停）改为真实涨停价 11.00 后全绿。

---

## 5. P2-F1 — 读路径数值解析统一

**问题**：`leaderCandidates.ts` 自维护 `toPositiveNumber` / `toNonNegativeNumber`，与 `data/validation.ts` 的 `parseNumericPrice` 语义重复。

**修复**：删除局部重复实现，`buildLeaderCandidateDailyPriceMap` 统一改用 canonical 语义解析：
- 价格字段（open/high/low/close/preClose）→ `parsePositivePrice`（需 > 0）；
- 数量字段（volume/amount）→ `parseNonNegativeNumber`（需 ≥ 0）；
- 仅当 open 与 close 均无效才丢弃该交易日记录（保留既有业务语义）。

**验证**：`leaderCandidates.ts` 现自 `./data/validation` 引入统一解析；相关既有测试全绿。

---

## 6. P2-F2 — isStStock 严格化（误判 STORE 类普通名称）

**问题**：旧正则 `/ST|退/` 把任何含 "ST"/"退" 子串的名称（如 "STORE"）判为风险警示。

**修复**（`server/data/boardRules.ts`）：
- 名称含明确退市关键词 `退市` → 命中；
- 否则仅当名称匹配 `^\*?ST` **前缀**且其后为中文/空（A 股风险警示真实格式）→ 命中；`ST` 后跟 ASCII（STORE/STAR 等）一律不命中；
- 名称缺失 → false（交给主板默认比例），不做假设。

**验证**：`server/data/data.test.ts` 新增用例：`ST中安`/`ST 舍得`/`*ST金洲`/`退市海润`/`XX退市整理`/纯 `ST` 命中；含 ST/退 子串的普通名不命中。

---

## 7. P2-F3 — stock_daily_prices 加 (stockCode, tradeDate) 唯一约束

**问题**：无 DB 级唯一约束；`MarketBarSeries` 对同日重复 bar 直接抛错，Feature 层读取历史重复行会崩溃。

**修复**：
- **Schema / 迁移**：drizzle `0008_*.sql` 已声明 `ALTER TABLE stock_daily_prices ADD CONSTRAINT uq_stock_daily_price_stock_date UNIQUE(stockCode, tradeDate)`（后续 snapshot 0009–0012 保留该约束）。
- **`server/db.ts` 运行时兜底**：
  - 新增纯函数 `duplicateStockDailyPriceIdsToRemove(rows)`：同 `stockCode+tradeDate` 仅保留最小 id，返回待删 id 列表（供 SQL 路径与测试复用）；
  - 新增 `ensureStockDailyPricesUniqueIndex(db)`：幂等、惰性（进程内一次）尝试 `CREATE UNIQUE INDEX`；
    - 已存在（`Duplicate key name`）→ 完成；
    - 历史脏数据导致 `Duplicate entry` → 先删除同键多余行（保留最小 id）再重试建索引；
    - DDL 失败（如权限不足）→ 降级告警，不阻塞 upsert 主路径。
  - `upsertStockDailyPrices` 写入前 `await ensureStockDailyPricesUniqueIndex(db)`，写入保持 `ON DUPLICATE KEY UPDATE` 全关键字段覆盖。

**验证**：`server/stockDailyPriceUnique.test.ts`（6 条）覆盖 schema 声明、迁移 DDL、upsert 幂等覆盖依赖唯一键、脏数据清理规划（保留最小 id）、清理稳定确定性。
**边界（诚实声明）**：本环境无 TiDB/MySQL 连接，约束实际生效需在部署环境执行迁移（`db:push` / 迁移 0008）；`ensureStockDailyPricesUniqueIndex` 提供运行时幂等兜底。

---

## 8. 新增生产集成测试（P1-F1/F2 的关键证据）

`server/strategy/strategyBacktest.test.ts`（6 条）直接驱动生产组装点 `runStrategyEngineBacktest`，**不是** `runFeaturePipeline → expect(...)` 的单层测试：

| # | 用例 | 证明 |
|---|---|---|
| 1 | 生产 Provider 全链路真实成交（featureDates=[D1]、confirmed=[A]、trades=1，D1 信号 → D2 开盘成交） | 真实 Provider → buildFeatures → Bundle → StrategyContext.features 被消费 |
| 2 | `featureMode=off` 3 单 vs `limit-up-confirm` 1 单（同候选池、同行情） | Feature **真实改变**策略决策；Risk 裁决数同步 3→1 |
| 3 | 价格库 B 收盘 10.20→11.00（候选记录不变）→ B 由跳过变纳入、成交 1→2 | 修改 Feature 输入即改变决策 |
| 4 | X 的 D2（未来）收盘非涨停 vs 涨停，D1 决策/成交逐项相等 | **Feature(T) 不使用未来数据 → Strategy Decision(T) 不变** |
| 5 | 渗漏探针有效性：同一数据在 D2 视角 `limitUpHit=1`、D1 视角 `limitUpHit=0` | 证明用例 4 若发生渗漏必被捕获 |
| 6 | 相同输入两次运行结果深度相等 | 确定性 / 实例隔离（无共享可变状态） |

---

## 9. 回归与工程验证

| 项 | 结果 |
|---|---|
| typecheck（`tsc --noEmit`） | ✅ exit 0 |
| build（vite build + esbuild server bundle） | ✅ exit 0 |
| 全量 `vitest run` | ✅ **499 passed / 15 failed（6 files）**（修复前基线：475 / 15 / 490 → 净增 24 条通过，失败集合与基线完全一致） |
| Future Leakage 回归 | ✅ `features.pipeline.test.ts` 破坏性渗漏用例（T+1/T+2 篡改、未来删除、open 决策、100 次确定性）+ 本报告 §8 用例 4/5 全绿 |
| 相关既有回归 | ✅ Step 2（engine）、Step 3（strategy）、Step 4（risk）、`leaderCandidateBaseline.test.ts`、golden pipeline、realisticBacktest / paperTrading 全绿 |

### 15 条失败：CODE REGRESSION vs ENVIRONMENTAL 判定

| 文件 | 条数 | 原因 | 判定 |
|---|---|---|---|
| `server/marketData.test.ts` | 4 | 依赖 MySQL/TiDB 连接（本环境无库） | ENVIRONMENTAL（基线同源） |
| `server/limitUp.watch.test.ts` | 4 | 依赖 DB | ENVIRONMENTAL（基线同源） |
| `server/limitUp.test.ts` | 1 | custom sector 持久化依赖 DB | ENVIRONMENTAL（基线同源） |
| `server/tushare.secret.test.ts` | 1 | 缺 `TUSHARE_TOKEN` 环境变量 | ENVIRONMENTAL（基线同源） |
| `server/tushareTradingCalendar.test.ts` | 3 | Tushare 网络/限频超时 | ENVIRONMENTAL（基线同源） |
| `server/stockPriceSyncPage.test.ts` | 2 | `client/src/pages/StockPriceSync.tsx` 未同步查询页尚在开发（ENOENT） | ENVIRONMENTAL（基线同源） |

以上 15 条与修复前基线失败**逐一相同**，无新增代码回归；修复代码相关测试全部通过。

---

## 10. 修复文件清单

**修改**
- `server/data/boardRules.ts`（P2-F2 strict ST；新增 `isPriceAtLimitUp/Down`）
- `server/data/validation.ts`（P2-F1 统一解析：`parsePositivePrice` / `parseNonNegativeNumber`）
- `server/leaderCandidates.ts`（P2-F1 去重复实现）
- `server/realisticBacktest.ts` / `server/paperTrading.ts`（P1-F4 权威阈值）
- `server/stockPriceSync.ts`（P1-F3 校验入库）
- `server/db.ts`（P2-F3 唯一索引兜底 + 脏数据清理）
- `server/features/snapshot.ts`（FeatureSnapshotBundle）
- `server/strategy/contract.ts` / `registry.ts` / `adapter.ts`（StrategyFeatureInput 契约收窄）
- `server/strategy/strategies/leaderCandidateBaseline.ts`（P1-F2 featureMode 消费）
- `server/paperTrading.test.ts`（一字涨停边界用例修正为权威涨停价）
- 迁移 `drizzle/0008_*.sql` 及 meta snapshot

**新增**
- `server/strategy/strategyBacktest.ts`（P1-F1 生产组装点，非测试生产代码）
- `server/strategy/strategyBacktest.test.ts`（6 条生产集成测试）
- `server/stockDailyPriceUnique.test.ts`（P2-F3，6 条）

---

## 11. 已知边界与范围说明（诚实声明）

1. `runStrategyEngineBacktest` 是非测试生产代码与统一组装入口；把它暴露为 HTTP/页面入口（新引擎回测页、手动触发同步等）属于另一条并行开发线（同 `StockPriceSync.tsx` 页面，目前未开发完成，故 `stockPriceSyncPage.test.ts` 2 条仍 ENVIRONMENTAL）。
2. P1-F2 的 Feature 消费以 `featureMode="limit-up-confirm"` **显式开启**；默认 `"off"` 保持旧语义，避免任何既有调用方被静默改变。审计方可按需开启新模式验证。
3. P2-F3 的唯一约束以迁移 + 运行时幂等兜底双保险提供；实际 DB 生效取决于部署环境执行迁移。

**修复范围对照审计**：P1-F1 ✅ / P1-F2 ✅ / P1-F3 ✅ / P1-F4 ✅ / P2-F1 ✅ / P2-F2 ✅ / P2-F3 ✅（P0 审计无；P3-F1 为 ENVIRONMENTAL，本报告仅记录不修复）。

是否满足 Step 5 通过标准，留待独立 Re-audit 判定。
