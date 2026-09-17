# STEP 9 — Integrity Report（完整性报告）

> 交付：确定性、会计完整性、边界隔离与依赖关系的独立核验
> 结果：**PASS**（P0=0 / P1=0 / P2=0）

---

## 一、完成标准逐项判定（规范 §十四）

| 完成项 | 判定 | 证据 |
| --- | --- | --- |
| Portfolio contract | ✅ PASS | `PortfolioSnapshot` 含 cash/marketValue/equity/realizedPnL/unrealizedPnL/fees/tax/exposure/positions |
| Position accounting | ✅ PASS | `PositionSnapshot` 含 quantity/availableQuantity/averageCost/marketValue/unrealizedPnL/realizedPnL + T+1 |
| Risk contract | ✅ PASS | `RiskSnapshot` 含 gross/net/cash/position exposure、集中度、行业、回撤、单日亏损、波动率、breaches |
| Pre-trade risk | ✅ PASS | `validateOrder` PASS/REJECT + 5 类 reasonCode |
| Post-trade risk | ✅ PASS | `calculatePortfolioRisk(PortfolioSnapshot) → RiskSnapshot` |
| Determinism | ✅ PASS | 纯函数 + 确定性排序 + 无 Date.now/Math.random/网络 |
| Tests | ✅ PASS | 35 测试全通过 |

---

## 二、测试覆盖矩阵（规范 §十一 → 实际测试）

| 规范测试项 | 覆盖测试 | 文件 |
| --- | --- | --- |
| buy | 买入扣减现金/建立持仓、非整手拒绝、资金不足拒绝 | `portfolio.test.ts` |
| sell | 清仓、部分减仓、无持仓拒绝 | `portfolio.test.ts` |
| partial fill | 部分减仓按比例结转成本基、剩余持仓成本不变 | `portfolio.test.ts` |
| fees | 买入费用 = 佣金+过户费、卖出费用含印花税 | `portfolio.test.ts` |
| tax | 印花税仅卖出 | `portfolio.test.ts` |
| cash | 现金净变动方向、computeFill | `portfolio.test.ts` |
| position | T+1 锁定、rollover 释放 | `portfolio.test.ts` |
| average cost | 加权平均成本、加仓重算 | `portfolio.test.ts` |
| realized PnL | 清仓 984.29、部分减仓 390.72、清仓后保留 | `portfolio.test.ts` |
| unrealized PnL | mark-to-market 估值 | `portfolio.test.ts` |
| exposure | exposure = marketValue / equity | `portfolio.test.ts` |
| drawdown | 回撤计算、RISK_LIMIT 拦截 | `riskEngine.test.ts` |
| risk limits | 限额校验、击穿列表、`<=0 不启用` 口径 | `riskEngine.test.ts` |
| order rejection | 5 类 reasonCode 全部覆盖 | `riskEngine.test.ts` |
| determinism | 组合/风险快照双跑一致、实例隔离 | 两文件 |

**总计 35 tests：portfolio 17 + riskEngine 18。**

---

## 三、确定性证明

1. **无随机/时间/网络依赖**：全模块仅用整数/浮点算术与 Map/Array，无 `Date.now()` / `Math.random()` / I/O。
2. **固定舍入**：金额 `round2`（分）、成本比率 `round4`；股数整数。
3. **确定性遍历**：Map 迭代统一 `Array.from`；`snapshot()` 持仓按 symbol 升序；`sectorExposures` 按 sector 字典序；`breaches` 按固定限额顺序。
4. **实证**：`portfolio` 与 `riskEngine` 各含「相同输入 → `toEqual`」测试，重复执行通过。

---

## 四、会计完整性（资金守恒）

**守恒恒等式（任意时点成立，已用测试断言）：**

```
equity − initialCash = realizedPnL + unrealizedPnL
```

等价表述：`Net PnL = Gross PnL − Fees − Tax`（fees/tax 为流出账户的资金）。

**清仓后 realizedPnL 保留**：持仓从 `Map` 删除后，其已实现盈亏不丢失（账户级 `realizedPnLAccumulated` 独立累积）。

> 关键缺陷修复记录：首版 `realizedPnL()` 对剩余持仓求和，清仓后归零；已改为账户级累积，并新增「全清仓后 realizedPnL 仍保留」回归测试。

---

## 五、边界隔离核验（规范 §十二）

**禁止 import 扫描结果（`grep "from \""`）：**

- `server/portfolio/` → 仅自引用（`./domain`、`./accounting`）。
- `server/riskEngine/` → 仅引用 `../portfolio`（类型）+ `../../shared/quant-stats`（纯统计）+ 自引用。
- **零 import** `server/engine/`、`server/risk/`、`server/strategy/`、`server/research/`、`server/features/`、`server/data/`。

**未复制 STEP 8 Portfolio**：本层 `PortfolioAccount` 为全新实现（加权平均成本法 + T+1 预留 + fees/tax 分离），与 STEP 8 `server/engine/portfolio.ts`（单 fees 口径、无 T+1、entryPrice 成本模型）在接口与语义上均不同。

---

## 六、STEP 7.x 依赖（规范 §十四「明确哪些能力依赖 STEP 7.5/7.6/7.7」）

> 说明：本仓库当前仅固化了 STEP 7.0/7.1/7.2 文档（数据盘点/架构/Provider 审计），STEP 7.3–7.7 的具体拆分为项目规划推断，尚在并行实施（观测到 `server/security/`、`server/backfill/`、`server/marketData/` 等未完成目录）。故以下按**能力 → 数据依赖**粒度标注，精确 Step 编号以 STEP 7.x 阶段最终文档为准。

| STEP 9 能力 | 是否自足 | 依赖的 STEP 7.x 数据能力 |
| --- | --- | --- |
| cash/position/gross/net exposure | ✅ 自足 | 无（仅需组合快照） |
| single-stock concentration | ✅ 自足 | 无 |
| drawdown / daily loss | ✅ 自足 | 无（仅需权益曲线，上层提供） |
| pre-trade validateOrder | ✅ 自足 | 无（成本估算用 FeeSchedule） |
| **sector exposure interface** | ⚠️ 接口（`sectorOf` 注入） | STEP 7.x **历史行业分类**（SW 行业快照 + 成分有效期） |
| **portfolio volatility interface** | ⚠️ 接口（`dailyReturns` 注入） | STEP 7.x **全市场日线回填** → 权益曲线 → 日收益率 |
| 复用（Backtest/Paper/Live）的 survivorship-safe 组合 | ⚠️ 依赖上游 | STEP 7.x **Security Master**（上市/退市/历史 ST 状态） |

**结论**：STEP 9 的核心（组合会计 + 前置/后置风控 + 敞口/回撤/单日亏损）**完全自足、可立即使用**；仅「行业敞口」与「组合波动率」两个**接口**的**真实数据供给**依赖 STEP 7.x 数据建设完成，当前以注入接口预留，不阻塞本步骤交付。

---

## 七、最终判定

| 项 | 值 |
| --- | --- |
| P0 / P1 / P2 | 0 / 0 / 0 |
| 测试 | 35 passed |
| tsc（portfolio/riskEngine） | 0 error |
| 边界隔离 | 零 import engine/risk/strategy/research |
| 结论 | **STEP 9 = PASS / COMPLETE** |
