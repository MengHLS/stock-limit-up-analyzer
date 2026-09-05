# STEP 9 — Implementation Report（Portfolio & Risk Foundation）

> 阶段：STEP 9 — Portfolio / Risk Track
> 状态：**COMPLETE（PASS）**
> 角色：Quantitative Portfolio Architect · Risk Engine Architect · Portfolio Accounting Engineer · Trading Risk Auditor
> 日期：2026-09-06

---

## 一、目标回顾

建立**独立**的 Portfolio Engine 与 Risk Engine，使 `Signal → Order → Fill → Position → Portfolio → Risk` 完全解耦。

本步骤**不实现** Strategy / Factor / Feature / WFO / OOS / Live Trading / Paper Trading。

---

## 二、交付物清单

新增目录 `server/portfolio/`（Portfolio Engine）与 `server/riskEngine/`（Risk Engine），共 **12 个文件**（6 源 + 2 测试 + 4 报告），**未改动任何既有生产文件**（engine/risk/strategy/research/features/data 零修改）。

### Portfolio Engine（`server/portfolio/`）

| 文件 | 职责 |
| --- | --- |
| `domain.ts` | 领域模型：`Side` / `FeeSchedule` / `OrderRequest` / `Fill` / `PositionSnapshot` / `PortfolioSnapshot` / `AccountingResult` |
| `accounting.ts` | 确定性会计：`commission` / `transferFee` / `stampDuty` / `buyFees` / `sellFees` / `buyCash` / `sellCash` / `computeFill` / `round2` / `round4` |
| `account.ts` | `PortfolioAccount` 类：cash / positions / equity / marketValue / realizedPnL / unrealizedPnL / fees / tax / exposure + T+1 |
| `index.ts` | 统一出口 |
| `portfolio.test.ts` | 15 个测试 |

### Risk Engine（`server/riskEngine/`）

| 文件 | 职责 |
| --- | --- |
| `domain.ts` | 领域模型：`RiskLimit` / `RiskReasonCode` / `OrderValidationResult` / `RiskSnapshot` / `SectorExposure` / `RiskBreach` / `RiskHistory` / `SectorResolver` |
| `limits.ts` | `validateRiskLimits` / `assertValidRiskLimits` |
| `preTrade.ts` | `validateOrder()` → PASS / REJECT + reasonCode |
| `postTrade.ts` | `calculatePortfolioRisk()` → RiskSnapshot |
| `index.ts` | 统一出口 |
| `riskEngine.test.ts` | 18 个测试 |

---

## 三、规范逐条覆盖

| 规范条目 | 覆盖情况 |
| --- | --- |
| §三 Portfolio（cash/positions/equity/marketValue/realizedPnL/unrealizedPnL/fees/exposure） | ✅ `PortfolioAccount` 全字段 + `PortfolioSnapshot` |
| §四 Position（quantity/availableQuantity/averageCost/marketValue/unrealizedPnL/realizedPnL + T+1 预留） | ✅ 全字段 + `lockedQuantity` T+1 结算（`rollover`） |
| §五 Accounting（Buy/Sell/Fill/Fee/Tax/Cash movement，deterministic） | ✅ `accounting.ts` 纯函数 + `account.ts` 落地 |
| §六 Risk v1（position/cash exposure、single-stock concentration、sector exposure interface、gross/net exposure、drawdown、daily loss、volatility interface） | ✅ `calculatePortfolioRisk` |
| §七 RiskLimit（maxPositionWeight/maxSectorWeight/maxGrossExposure/maxDrawdown/maxDailyLoss，不写死策略参数） | ✅ `RiskLimit` 全部作为输入 + 保守默认 |
| §八 Pre-Trade validateOrder（PASS/REJECT + reasonCode） | ✅ `validateOrder`，5 类原因码 |
| §九 Post-Trade calculatePortfolioRisk（PortfolioSnapshot → RiskSnapshot） | ✅ |
| §十 Determinism | ✅ 纯函数 + 无 Date.now/Math.random/网络 |
| §十一 测试 | ✅ 33 测试（详见测试矩阵） |
| §十二 STEP 8 边界（interfaces 连接，禁止复制 Portfolio 到 STEP 8） | ✅ 零 import engine/risk，未复制 STEP 8 Portfolio |
| §十四 完成标准 + STEP 7.5/7.6/7.7 依赖 | ✅ 见 Integrity Report |

---

## 四、验证结果

| 验证项 | 结果 |
| --- | --- |
| `npx vitest run server/portfolio server/riskEngine` | **33 passed**（portfolio 15 + riskEngine 18） |
| `npx tsc --noEmit`（过滤 portfolio/riskEngine） | **0 error** |
| 全量回归 | 新增失败 = 0（既有环境基线失败与 STEP 7.x 并行工作无关，见下） |

> 备注：当前仓库存在**并行 STEP 7.x 工作**（`server/backtest/`、`server/marketData/`、`server/security/`、`server/backfill/`、`server/corporateActions/` 为另一条 Track 的未完成产出），其 tsc 报错与本步骤无关。本步骤新增目录 `server/portfolio/`、`server/riskEngine/` 自身 tsc 零错误、测试全通过。

---

## 五、关键设计决策

1. **完全解耦**：两个引擎不 import `server/engine/`（STEP 8）与 `server/risk/`（既有预交易风控层），只依赖 `shared/quant-stats`（纯统计数学，项目单一事实来源）与 `server/portfolio` 的类型。
2. **加权平均成本法**：`averageCost = costBasis / quantity`，costBasis 含买入费用；卖出按比例结转成本基，`realizedPnL = 卖出净所得 − 结转成本基`。
3. **费用/税分离**：`fees`（佣金+过户费）与 `tax`（印花税）独立字段，买入 tax=0。
4. **账户级 realizedPnL**：清仓持仓从 Map 删除后，其已实现盈亏仍保留在账户级 `realizedPnLAccumulated`，避免「清仓后 realizedPnL 归零」的会计缺陷。
5. **T+1 预留**：买入进入 `lockedQuantity`，`rollover(nextDate)` 才释放为 `availableQuantity`；卖出只校验 `availableQuantity`。
6. **限额取值约定**：数值型限额 `<= 0` 表示「不启用该检查」（与项目 `maxPositionAmountRatio=0 表示不限` 口径一致）。
7. **接口化依赖**：行业敞口（`sectorOf` 注入）与波动率（`dailyReturns` 注入）均为接口，本引擎不内置行业字典/时间序列状态。

---

## 六、下一步

- **不阻塞**：本步骤为独立基础层，可被 Backtest / Paper / Live 复用。
- STEP 8 若需迁移到本 Portfolio Engine，需写 `adapter` 把 STEP 8 的 `Fill`（单 fees 口径）映射到本层 `Fill`（fees/tax 分离口径），属后续集成步骤（不在本步骤范围）。
- 依赖 STEP 7.x 数据（历史行业分类、全市场日线）落地后，`sectorOf` / 权益曲线即可接入真实数据。
