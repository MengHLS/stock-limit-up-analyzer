# STEP 9 — Risk Architecture（风控架构）

> 交付：Risk Engine 架构与风险语义  
> 位置：`server/riskEngine/`



---

## 一、定位与边界

Risk Engine 是**独立于 Backtest Core（server/engine/）与既有 Risk Layer（server/risk/）**&#x7684;风控基础，只依赖 `server/portfolio` 的组合快照类型。

它分两段：

| 段              | 函数                         | 输入 → 输出                                          |
| -------------- | -------------------------- | ------------------------------------------------ |
| 前置（Pre-Trade）  | `validateOrder()`          | 订单 + 组合快照 + 限额 + 价格 → PASS / REJECT + reasonCode |
| 后置（Post-Trade） | `calculatePortfolioRisk()` | 组合快照 + 限额 + 历史 → RiskSnapshot                    |

```
Strategy 意图 → validateOrder（REJECT 即拦截）
     │ PASS
     ▼
PortfolioAccount.buy/sell（成交落地）
     │
     ▼
calculatePortfolioRisk（组合级风险快照 + 限额击穿）
```

---

## 二、RiskLimit（风险限额，非策略参数）

```typescript
interface RiskLimit {
  maxPositions: number;       // 最大持仓数
  maxPositionWeight: number;  // 单股最大权重（0~1）
  maxSectorWeight: number;    // 单行业最大权重（0~1）
  maxGrossExposure: number;   // 总敞口上限
  maxNetExposure: number;     // 净敞口上限
  maxDrawdown: number;        // 最大回撤（0~1）
  maxDailyLoss: number;       // 单日最大亏损（0~1）
}
```

- **不写死策略参数**：所有限额作为输入传入；`DEFAULT_RISK_LIMITS` 仅为保守兜底默认。
- **取值约定**：数值型限额 `<= 0` 表示「不启用该检查」（`maxPositions <= 0` 表示不限持仓数）。

---

## 三、Pre-Trade：validateOrder()

返回：

```typescript
{ verdict: "PASS" }
| { verdict: "REJECT"; reasonCode; message }
```

### 原因码（规范 §八）

| reasonCode          | 触发条件                                            |
| ------------------- | ----------------------------------------------- |
| `INVALID_ORDER`     | 空 symbol / 非正数量 / 非整手买入 / 缺价 / 卖出无持仓 / T+1 可卖不足 |
| `INSUFFICIENT_CASH` | 买入总成本（含费用）> 现金                                  |
| `MAX_POSITION`      | 开新仓超过 maxPositions                              |
| `MAX_EXPOSURE`      | 单股 / 总敞口 / 行业权重超限                               |
| `RISK_LIMIT`        | 回撤 / 单日亏损击穿，禁止新增风险                              |

### 检查顺序（固定，保证确定性）

`INVALID_ORDER → INSUFFICIENT_CASH → MAX_POSITION → MAX_EXPOSURE → RISK_LIMIT`

卖出不触发新增风险检查（只走 INVALID_ORDER）。

---

## 四、Post-Trade：calculatePortfolioRisk()

输入 `PortfolioSnapshot` + `RiskLimit` + 可选 `RiskHistory`，输出 `RiskSnapshot`：

```typescript
interface RiskSnapshot {
  grossExposure: number;            // marketValue / equity
  netExposure: number;              // (long − short) / equity（当前 long-only，= gross）
  cashExposure: number;             // cash / equity
  positionExposure: number;         // marketValue / equity
  singleStockConcentration: number; // max(单股 marketValue / equity)
  sectorExposures: SectorExposure[]; // 行业敞口（确定性排序）
  drawdown: number;                 // 当前回撤深度
  dailyLoss: number;                // 当日亏损（盈利为 0）
  annualizedVolatility: number|null;// 年化波动率（无收益序列为 null）
  breaches: RiskBreach[];           // 被击穿限额
}
```

### 风险指标口径

| 指标                         | 定义                                                   |    |            |
| -------------------------- | ---------------------------------------------------- | -- | ---------- |
| gross exposure             | \`Σ                                                  | 市值 | / equity\` |
| net exposure               | `(longMV − shortMV) / equity`（short 恒 0，接口预留）        |    |            |
| cash exposure              | `cash / equity`                                      |    |            |
| position exposure          | `marketValue / equity`                               |    |            |
| single-stock concentration | `max(单股 marketValue / equity)`                       |    |            |
| drawdown                   | `max(0, (peakEquity − equity) / peakEquity)`         |    |            |
| daily loss                 | `max(0, (previousEquity − equity) / previousEquity)` |    |            |
| annualized volatility      | `sampleStdDev(dailyReturns) × √252`                  |    |            |

---

## 五、接口化依赖（规范 §六「interface」）

| 接口                                 | 注入方式                                                | 依赖的 STEP 7.x 数据          |
| ---------------------------------- | --------------------------------------------------- | ------------------------ |
| **sector exposure interface**      | `sectorOf(symbol)` 解析函数 或 `PositionSnapshot.sector` | STEP 7.x 历史行业分类（SW 行业快照） |
| **portfolio volatility interface** | `RiskHistory.dailyReturns` 序列                       | STEP 7.x 全市场日线回填 → 权益曲线  |

本引擎**不内置**行业字典、不保存时间序列状态（`RiskHistory` 由上层维护），保持无状态纯函数。

---

## 六、确定性保证

- 所有函数纯函数、无副作用、无 `Date.now()`/`Math.random()`/网络。
- 行业敞口与 breach 列表均按固定顺序（sector 字典序、限额固定顺序）输出。
- `sampleStandardDeviation` 复用 `shared/quant-stats`（项目唯一统计实现，禁止自造）。

---

## 七、与既有 `server/risk/` 的区别

| 维度        | `server/risk/`（STEP 8 预交易层）       | `server/riskEngine/`（STEP 9 基础）                |
| --------- | --------------------------------- | ---------------------------------------------- |
| 依赖        | engine/domain + engine/execution  | 仅 server/portfolio 类型 + shared/quant-stats     |
| 决策语义      | APPROVE / RESIZE / REJECT（自动缩放数量） | PASS / REJECT（不缩放，只拦截）                         |
| 后置风控      | 无                                 | `calculatePortfolioRisk` → RiskSnapshot        |
| 敞口/回撤/波动率 | 部分（敞口在 RiskContext）               | 完整（gross/net/cash/position/集中度/行业/回撤/单日亏损/波动率） |

两者并存、职责互补：`server/risk/` 服务于回测引擎的「自动缩放仓位」链路；`server/riskEngine/` 是**可被 Backtest/Paper/Live 复用**的通用风控基础。
