# 量化系统唯一契约（Quant System Contract）

> **STEP 11-CONTRACT-AMENDMENT 修订版 · 冻结语义**
>
> 本文档是 `stock-limit-up-analyzer` 量化系统地基的**唯一契约来源（Single Source of Truth）**。
> 任何后续 STEP 12+ 开发：若实现与本文档冲突，**以本文档为准**；不得为了兼容旧代码而破坏契约。
>
> **总原则：**
> ```
> Code Contract = Migration Contract = Database Contract = Historical Data Contract
>              = Security Identity Contract = Historical Universe Contract = PIT Contract
>              = Signal Contract = Execution Contract = Portfolio Contract
>              = Corporate Action Contract = PnL Contract
> ```
>
> **诚实性要求（§25）：** 本文档中「AMENDED / DEFINED / CONFIRMED」只表示**契约语义已被修订/定义/确认**，
> 不代表对应数据库/历史数据已经真实完成。契约定义（Contract Definition）与实施状态
> （Implementation Status）在每个相关章节末尾显式区分，禁止把「仅定义」写成「已完成」。

---

## 0. Purpose & Scope

- **目的**：把分散在 STEP 5/6/7.3–7.7/8/9/10/11 中的语义统一冻结为一份契约，供 STEP 12+ 全链路（Historical Dataset → Historical Universe → PIT-aware Feature → Signal → Ranking → Selection → PositionIntent → Order → Execution/Fill → Portfolio → Risk → PnL → Performance Metrics）引用。
- **范围**：本文档只冻结**正确语义**，不提前假设历史数据已经存在、不回填数据、不部署迁移、不新增功能、不重写 Backtest Engine / Portfolio / Research Framework。
- **实施状态分离**：凡涉及数据/数据库的章节，均以「Contract Status（契约状态）」+「Implementation Status（实施状态）」两行分别陈述。

---

## 1. Canonical Architecture（统一架构）

```
Identity(sec_<uuid>)  Time(event/available/decision/execution/settlement)  Data(raw OHLCV)
          \                          |                          /
           \                         ↓                         /
                            PIT (asOf required)
                                  ↓
                         Historical Universe
                                  ↓
                       PIT-aware Feature
                                  ↓
                                Signal
                                  ↓
                          PositionIntent
                                  ↓
                                Order
                                  ↓
                                Fill
                                  ↓
                             Portfolio
                                  ↓
                          Risk / PnL
```

| 环节 | 模块锚点 | 边界铁律 |
| --- | --- | --- |
| Raw Data | `server/data/types.ts` / `drizzle` `stock_daily_prices` | 未复权 raw 唯一事实源 |
| Identity | `server/security/securityId.ts` / `research_securities` | `sec_<uuid>` 永久内部身份 |
| Identifier History | `server/security/identifierHistory.ts` | code 只在有效区间内唯一 |
| Trading Calendar | `server/security/tradingCalendar.ts` | 交易日推进，禁止自然日 T+1 |
| Status Timeline | `server/securityStatus/timeline.ts` + `pointInTime.ts` | T+1 知识日 / 无日历 fail-safe |
| Historical Universe | `server/security/historicalUniverse.ts` | survivorship-safe，as-of |
| Research Framework | `server/research/framework/*`（contract/pipeline/leakage） | 只产出 PositionIntent |
| Backtest Engine | `server/backtest/*`（engine/portfolio/position/dbBarStore） | Signal→Order→Fill→Portfolio |
| Corporate Action | `server/corporateActions/*`（types/engine/portfolioTransform/integration） | 价格调整层 ≠ 组合变换层 |
| PnL | `server/backtest/types.ts`（Trade/Metrics/EquityPoint） | Trade PnL ≠ Portfolio PnL |

---

## 2. Security Identity Contract（证券身份契约）

### 2.1 securityId = 永久内部身份

```text
securityId = 永久内部身份 = sec_<uuid-v4>
```

- 跨历史时期稳定；跨证券代码变化稳定；跨名称变化稳定；跨 identifier 变化稳定；跨数据源稳定的**内部 Join Key**。
- 格式：`sec_` + UUID v4（`server/security/securityId.ts`）；`isValidSecurityId()` 为唯一合法校验。
- 与任何市场代码解耦：代码变化（借壳/换代码/迁移板块）→ securityId 不变；代码复用（退市后新上市沿用同数字代码）→ 分配新 securityId。

**禁止：**

```text
securityId = stockCode
securityId = ticker
securityId = exchange + code
```

### 2.2 软引用语义

- 在数据尚未对账到 Security Master 时，`securityId` 为 `null`（软引用），**禁止**把 `securityCode` 直接写入该列。
- 确定性解析：`server/security/identifierHistory.ts` 的 `resolveSecurityByCode(history, exchange, code, date)`。
- 落地列宽：`varchar(48)`，可空（4 张 STEP 7.x 表）；`research_securities.securityId`、`security_identifier_history.securityId`、`security_status_history.securityId` 为 `varchar(48) NOT NULL`。

### 2.3 已知命名缺口（诚实声明）

- STEP 8 Backtest 引擎域模型（`server/backtest/types.ts` 的 `Security.securityId` / `Signal.securityId` /
  `Fill.securityId`，以及 `DbBarStore`）在 **raw 数据层**仍以「自然键（stockCode）」作键，字段名沿用 `securityId`。
- 该层位于契约边界下方（raw-bar 机器），**不是** canonicaal securityId；跨越该边界进入 PIT Feature / Historical
  Universe 时必须经 Identifier History 按 tradeDate 解析为 `sec_<uuid>`。
- 本任务**不重写**引擎键（避免大规模重构），该缺口以 `GAP-ENG-KEY` 记录，STEP 12+ 处理。

### Implementation Status
- 4 张 STEP 7.x 表结构：**DEFINED**（schema + 迁移 0023 已定义）。
- 迁移 0023 落地 TiDB：**DB-PENDING**（本任务不执行生产迁移）。
- 数据回填：**DATA-PENDING**（STEP 7.x 表当前为空）。

---

## 3. Identifier History Contract（标识符历史契约）

```text
securityId
    ↓  Identifier History（时间有效区间）
securityCode + exchange + validFrom(=effectiveFrom) + validTo(=effectiveTo)
```

- 同一 securityId 可在不同区间拥有不同 code；同一 (exchange, code) 可在不同历史区间对应不同 securityId。
- **唯一性只在标识符有效区间内成立**：禁止 `UNIQUE(securityCode)` 全局永久约束；
  正确约束为「(exchange, securityCode, identifierType, effectiveFrom) 区间起点唯一」（schema
  `uq_security_identifier_code_effective`），同一 (exchange, code, type) 各组区间互不重叠
  （`validateIdentifierHistory` 强制）。
- 区间语义：`[effectiveFrom, effectiveTo]` 闭区间；`effectiveTo = null` 表示开放区间（至今）。
- 代码复用是 survivorship 审计关键信号：`detectCodeReuse(history)`。

### Implementation Status
- 语义：**AMENDED / DEFINED**。
- Security Master 与 Identifier History 数据：**DATA-PENDING**（待回填，见 STEP_7.4 系列报告）。

---

## 4. Historical Data Contract（历史数据契约）

- **raw OHLCV = 唯一事实源**：`stock_daily_prices` 只存**未复权**日线。
- 单位对齐 `server/data/types.ts` canonical 口径（禁止自行换算）：`price` 元/股、`volume` 手、
  `amount` 千元、`turnoverRate` %（未提供一律 `null`，禁止伪造）。
- 允许缺失：`null = 明确未知`；**禁止** `close || 0` 之类静默填零。
- `CanonicalMarketBar.adjustment === "raw"` 在 execution/backtest 默认成立；系统禁止复权价与未复权价混用。
- Derived Layer（复权价）**不得覆盖 raw**；复权价由 `server/corporateActions/engine.ts` 计算。
- 引擎只消费 raw：`DbBarStore.corporateActionMode === "RAW"`（`server/backtest/dbBarStore.ts`），
  数值字段 `parseNumber`：空串/非法值 → `null`。

### Implementation Status
- 数据域：`stock_daily_prices` 已有 **116,332 行**（前序 reality audit），覆盖率未达研究可用标准：**PARTIAL**。
- 无 DB（`getDb()` 为 null）时引擎/存储优雅返回空集，不抛错（测试环境语义）。

---

## 5. Data Coverage vs Research Coverage（数据覆盖分层）

必须区分四级，禁止跨级等同：

```text
Provider Capability      —— 上游 API 能提供什么（如 Tushare）
   ≠
Code Capability          —— 本系统代码能同步什么
   ≠
Database Coverage        —— TiDB 里实际已有什么
   ≠
Research Usable Coverage —— PIT 语义下、asOf 时点可用且覆盖达标的数据
```

> Tushare 可以提供 ⟹ TiDB 已经有数据 ⟹ PIT Research 已经可用 —— 每一步都是独立事实，禁止默认成立。

---

## 6. Historical Universe Contract（历史证券池契约）

### 6.1 Data Coverage Universe ≠ Historical Universe

- **Data Coverage Universe** = `DbBarStore.securities()`：当前数据源中实际存在数据的证券集合。
  仅用于：数据覆盖统计、数据发现、backfill candidate discovery。
  **禁止**直接作为历史回测 Universe。
- **Historical (Tradable) Universe** = `HistoricalUniverse(asOf, tradeDate)`：在 tradeDate 当天，
  该 security **是否已存在、是否上市、是否处于允许交易状态，且这些信息在 asOf 时点是否可知**。

### 6.2 Historical Universe 的构成

```text
Security Master        research_securities（身份/上市退市时间界）
+ Identifier History   security_identifier_history（代码时间有效区间）
+ Listing Interval     listedDate / delistedDate + LISTING 状态
+ Trading Status Interval  security_status_history（TRADING/SUSPENSION/DELISTING）
+ Trading Calendar      下一交易日判定
+ PIT filters           asOf 时点可知性
        ↓
getHistoricalTradableUniverse(input, tradeDate, { asOf })   （server/security/historicalUniverse.ts）
```

- **Historical Universe 不得从当前证券列表反推历史证券池。**
- 判定维度分类（historicalUniverse.ts 明确）：
  - 正向确认（UNKNOWN → 拒绝）：LISTING、TRADING；
  - 负向阻断（仅显式负向；UNKNOWN → 放行）：SUSPENSION、DELISTING；
  - 信息维度（不阻断 eligibility）：ST（NORMAL/ST/*ST/UNKNOWN）——ST 不是停牌，不因此剔除。

### Implementation Status
- 语义与判定器：**AMENDED / DEFINED**（`resolveHistoricalUniverse` + `evaluateHistoricalEligibility` + 单元测试）。
- 所需四类输入数据（master/identifier/status/calendar）：**DATA-PENDING**（部分已定义、未达覆盖率）。
- 引擎数据层到 canonical Historical Universe 的键桥接：`GAP-ENG-KEY`（§2.3），**OPEN**。

---

## 7. Survivorship Bias Contract（幸存者偏差契约，显式新增）

1. 不得使用当前 active securities 作为历史 Universe。
2. 不得因证券今天已退市而删除其历史样本。
3. 不得因证券今天仍存在而把它提前加入历史 Universe。
4. 证券上市/退市区间必须由历史状态（listedDate/delistedDate + LISTING/DELISTING 状态）决定，禁止「当前状态回填历史」。
5. 回测日期必须与 Historical Universe 在同一 PIT 语义下计算（同一 asOf/calendar）。

示意：

```text
2019 时点证券：A B C D       2026 当前证券：A B C D E F G
2019 backtest → 只能看到 2019 当时符合条件者（A B C D，且各自当时状态成立）
绝不：2026 current universe → 回测 2019（引入 E F G，或遗漏已退市样本）
```

- 代码复用检测（`detectCodeReuse`）是发现「同 code 不同主体」导致样本污染的第一道闸。
- 状态解析不得默认 `UNKNOWN → NORMAL/TRADING`（无数据维度 = unknownDimensions，正向维度 UNKNOWN 即拒绝）。

---

## 8. Trading Calendar Contract（交易日历契约）

- 唯一权威：`server/security/tradingCalendar.ts`（`TradingCalendar` 接口 + `buildTradingCalendar` + `loadTradingCalendar`）。
- `nextTradingDay(date)` 必须返回**严格晚于** date 的下一个交易日；`previousTradingDay` 对称。
- `addTradingDays(date, n)`：T+n / 观察窗口 / 滚动窗口的统一入口，date 必须为交易日，否则 `null`（语义无定义），禁止自然日 × n 近似。
- 所有 T+1 / T+n / settlement / holding period / trading-day lookback 必须使用 canonical TradingCalendar。
- **禁止**用 `date + 1 day`（自然日算术）承载任何交易语义——周五的 T+1 是周一，不是周六。
- 自然日加减仅用于非交易语义（区间长度、公告发布时间），见 `server/security/dates.ts`。

---

## 9. PIT Contract（时点契约）

- 无未来泄漏：as-of 查询只能使用「在 asOf 时点已可知」的信息。
- 禁止「当前状态」作为历史状态的 fallback；无数据维度 = UNKNOWN（不默认填充）。
- 三个时间不混同（`server/securityStatus/pointInTime.ts`）：
  - `effectiveFrom/effectiveTo`：状态在真实世界何时为真；
  - `retrievedAt`：我们何时写入系统；
  - availability（`IMMEDIATE | T_PLUS_1 | UNKNOWN`）：状态最早何时可被观察到。
- 知识日解析 `statusKnowledgeDate`：
  - `IMMEDIATE` → `effectiveFrom` 当日；
  - `T_PLUS_1` → `calendar.nextTradingDay(effectiveFrom)`；**无交易日历 → fail-safe `null`**（禁止退回自然日算术）；
  - `UNKNOWN` → `retrievedAt` 的日期；无则 `null`（不可用于 as-of 推理）。
- 引擎/研究侧：决策时点只能消费 `<= decisionTime` 的 bar 与状态；`visibleBars`/asOf 过滤保证，不得依赖「数组里有没有」。

---

## 10. Time Semantics Contract（统一时间语义）

五类时间，逐一明确（禁止混用、禁止缺省假设）：

| 时间 | 含义 | 典型载体 |
| --- | --- | --- |
| `eventTime` | 事件实际发生/生效时间 | `effectiveDate` / `exDate` / `recordDate` |
| `availableAt` | 现实世界最早可知道该信息的时间 | `announcementDate` / `announcementTimestamp` / provider 提供时点 |
| `decisionTime` | 策略做出交易决策的时间 | STEP 10 `DecisionTime{date, point}`（open/close） |
| `executionTime` | 实际订单成交/执行时间 | STEP 8 `Order.executionTime`（下一交易日） |
| `settlementTime` | 资金/证券完成结算并可再次使用的时间 | `PositionBook.settle()` 生效日 |

- 时序约束（PIT 强制）：`availableAt <= decisionTime <= executionTime <= settlementTime`。
- `decisionTime` 时点语义：bar 内 open/preClose 开盘即已知，high/low/close/volume/amount 收盘后才完全可知（`server/data/types.ts`）。
- 代码锚点：研究层 `FeatureAvailability{requiredDataThrough, availableAt}` 与 `LeakageGuard.assertNoLookAhead`
  （`server/research/framework/leakage.ts`）；执行层 `Signal.signalTime`、`Order.tradeDate/executionTime`、`Fill.timestamp`。

---

## 11. asOf / ResearchContext Contract（强制上下文）

- `asOf` 从「推荐参数」升级为 **historical research / backtest / PIT-sensitive query 的强制上下文**。
- 禁止 `asOf = null / undefined` 进入 historical research / backtest。
- 显式双上下文，禁止用 `asOf = null` 作隐式模式切换：

```text
HistoricalContext { mode: "historical", asOf: DateTime }
LiveContext       { mode: "live",       now: DateTime }
```

- 现有实现中 `resolveSecurityStatus` / `resolveHistoricalUniverse` 仍接受 `asOf?: string | null`
  （null = 全知视角），该放宽**仅限**数据审计/诊断/对账路径；研究流水线与回测路径必须显式传
  `decisionTime` / `tradeDate`（其本身即 asOf），违反即视为契约破坏。
- Research Pipeline（`runResearchPipeline`）以 `decisionTime` 为唯一 as-of 锚点，逐日运行（单 decisionTime 横截面）。

---

## 12. Adjusted Price Contract（复权价契约，修订）

**删除任何「后复权天然 PIT-safe」类表述。**

> Adjusted price 是否 PIT-safe，**不由 adjustment direction 单独决定**，而由「构建该价格时使用的
> corporate actions 在 decisionTime 前是否可知」决定。

正确结构：

```text
Raw Price（未复权）
   +  PIT-visible Corporate Actions（announcementDate/retrievedAt 在 decisionTime 前可知）
   ↓
PIT Adjustment Factor
   ↓
Derived Adjusted Price
```

- `foreFactor`（前复权，锚定最新价，最新日恒 1）/ `backFactor`（后复权，锚定最早价）仅描述**锚点与形态**。
- **禁止**以 2026 full-history adjustment factors 直接回测 2019——即使数据是 backward-adjusted，
  也不能仅凭名称认定 PIT-safe；必须先证 events/factors 在该 decisionTime 已知。
- 当前系统 bar 层仅支持 `adjustment: "raw"`；adjusted 数据属 Derived Layer，缺失时禁止伪造。

---

## 13. Raw Data Contract（raw 事实源契约）

- `stock_daily_prices` = raw fact source，任何模块不得原地改写/覆盖 raw close。
- `CanonicalMarketBar.adjustment === "raw"` 为默认；复权为派生层，二者不得混用。
- raw 数据缺失/非法：显式 `null` 或确定性失败（抛错），禁止静默填零/跳过。

---

## 14. Corporate Action Contract（公司行为契约，双层重写）

```text
CorporateAction
   ├── Information Layer（信息层）   announcementDate / availableAt / retrievedAt
   │        → 决定策略何时「可知」该信息（PIT filter）
   └── Accounting Layer（会计层）    exDate / effectiveDate / recordDate
            → 决定组合何时实际发生现金/持仓变化（Portfolio transform）
```

- **`announcementDate ≠ exDate ≠ recordDate`**：三者不可混同；provider 缺失某项时显式置 `null`，
  禁止假设 `announcementDate === effectiveDate`。
- PIT 可用性过滤：`isCorporateActionKnownAt(action, decisionTime)` —— `announcementDate <= decisionTime`
  才可知；`announcementDate` 缺失 → **保守视为不可知**（杜绝 look-ahead）。
- Accounting 生效：`exDate / effectiveDate` 决定组合实际变换；策略提前知道 announcement，**不得**提前增加组合现金。

### Implementation Status
- 语义与校验：**DEFINED**（`server/corporateActions/types.ts` 注释即本契约的领域化表达）。
- 表数据：`corporate_actions` / `adjustment_factors` **DATA-PENDING**（当前为空）。
- 结构迁移 0023：**DB-PENDING**。

---

## 15. Corporate Action Portfolio Contract（组合会计契约）

- **Price Adjustment ≠ Portfolio Transformation**（保留现有双层架构，禁止合并）：
  - 价格调整层：`server/corporateActions/engine.ts` —— 只负责历史价格连续性，绝不改持仓/现金；
  - 组合变换层：`server/corporateActions/portfolioTransform.ts` —— 只负责真实持仓/现金/成本基变换，绝不改历史价格。
- Portfolio Transformation 覆盖：cash dividend（现金分红）、bonus shares（送股）、stock transfer（转增）、
  rights issue（配股）、split（拆股）、reverse split（合股）。
- 会计约定（税前、每股口径）：分红现金 += D×q；送/转/拆/合按 ratio 缩放股数与成本基（总成本基不变）；
  配股股数增加 + 现金减少（认购支出入成本基）；**公司行为本身不产生已实现盈亏**（realizedPnLDelta 恒 0）。
- Portfolio 变换**在 ex-date/effective date 发生**（引擎主循环 (a2) 步，`server/backtest/engine.ts`），
  提前知道 announcement 不提前记账。

---

## 16. Signal Contract（信号契约）

- 保持现有结构，不重写：

```text
Feature → Signal → Ranking → Selection → PositionIntent → Adapter → Order/Backtest
```

- 研究信号 `ResearchSignal{securityId, date, value, direction, confidence?}`；direction ∈ long/short/neutral。
- 排序 `RankingConfig`（higherIsBetter / winsorization / tieBreaking / missingPolicy）→ 选择 `SelectionConfig`
  （topN / topPercentile）。
- 研究层**只产出信号与意图**，不产生 Order/Fill、不修改 Portfolio。

---

## 17. PositionIntent Contract（持仓意图契约）

- **PositionIntent = 目标持仓意图**，不是 Order / Fill / Execution。
- `PositionIntent{securityId, direction, rank, percentile, weight∈(0,1], signalValue, confidence?}`。
- 方向映射（adapter `server/research/framework/positionIntentAdapter.ts`）：`long → buy`、`short → sell`、
  `neutral → skip`（A 股 long-only 研究只产出 long；short→sell 会因无持仓被 Portfolio 拒绝 = 禁止裸卖空的正确引擎语义）。
- `weight → 股数` 的换算由注入的 `PositionSizer`（`equalWeightSizer`：weight × equity ÷ price → 整手）负责；
  权重非法/无价/权益非正 → 0（跳过，不静默填 1）。
- STEP 10 研究产物止于 PositionIntent；由 `positionIntentSignalGenerator` 桥接进 STEP 8 引擎。

---

## 18. Order / Execution Contract（订单与执行契约）

- Signal 规范化为 Order（`server/backtest/types.ts`）：`tradeDate`（决策日）+ `executionTime`（**下一交易日**）。
- Order 生命周期：NEW → SUBMITTED → (PARTIALLY_)FILLED / REJECTED / CANCELLED / EXPIRED；Signal ≠ Order ≠ Fill。
- 引擎事件驱动：每个交易日 (a) `settle()` → (a2) ex-date 公司行为 → (b) `barsForDate(date)` → (c) 处理
  `executionTime === date` 的待成交订单。
- 成交拒绝原因枚举化：`LIMIT_UP / LIMIT_DOWN / SUSPENDED / NO_LIQUIDITY / INSUFFICIENT_CASH / T_PLUS_1 / OTHER`。
- 参考成交额（容量约束）只取**成交时点前已可知**的数据（信号日 bar），避免未来函数。
- 执行模型：`NEXT_OPEN / NEXT_CLOSE / VWAP_PROXY / LIMIT_PRICE`。

---

## 19. Settlement / T+1 Contract（结算契约）

交易语义的 T+1（**保守 fallback**，非所有事件的绝对规则）：

> 当数据源无法提供可信的盘中 `availableAt`、而只有交易日级事件日期时，为防止前视偏差，
> 默认采用**下一交易日**作为最早可使用日：`availableAt = explicit reliable timestamp`，否则
> `availableAt = nextTradingDay(eventDate)`。

结算语义的 T+1（A 股交割制度，无条件）：

```text
Buy → frozen shares（当日买入冻结）→ 每交易日开始 settle() → available shares → Sell
```

- 卖出前必须满足 settlement completed（`PositionBook.settle()`），当日买入不可当日卖出（`rejectionReason: T_PLUS_1`）。
- 模拟结算**不得使用 calendar day**；一律以 canonical TradingCalendar 为准。

---

## 20. Portfolio Contract（组合契约）

- 职责：cash / positions / marketValue / equity / realizedPnL / unrealizedPnL 统一核算。
- 费用与滑点统一经 `CostModel` 结算，策略/引擎不得自行扣费。
- 买入约束链：数量合法 → 整手 → 持仓去重（暂不支持加仓）→ 最大持仓数 → 容量截断 → 现金截断。
- 卖出约束链：数量合法 → 可卖份额（T+1）→ 整手 → 现金/持仓结转。
- 部分成交：`allowPartialFill` 开启时按最大可行数量成交（PARTIALLY_FILLED），否则全额拒绝。
- 公司行为会计按 §15 在 ex-date 应用（`Portfolio.applyCorporateAction` 桥 `PositionBook.applyCorporateAction`）。
- 策略信号阶段只读 `ReadonlyPortfolioSnapshot`（cash/equity/openPositionCount/openPositionSymbols）。

---

## 21. Risk Contract（风险契约）

- Risk 作用于 **PositionIntent / Order / Portfolio** 三个层级；具体执行层级与现有实现一致
  （`server/riskEngine/`，本任务不重构）。
- **Risk 不得绕过 PIT Universe、PIT Feature、Execution 与 Portfolio Accounting**：
  任何风控门都必须发生在同一 asOf/decisionTime 语义下，不得读取未来信息、不得使用当前状态回填历史。

---

## 22. Trade PnL Contract（单笔交易盈亏）

- `Trade PnL` 定义：`allTrades()[].netPnl` —— **单笔已完成交易的已实现净收益**。
- 恒等式：`netPnl = grossPnL − fees − slippage`；仅在真实清仓（卖出使持仓归零）时结转。
- 期末仍持仓：`openAtEnd = true`，`netPnl = null`（不按估值价伪造成已实现）。
- **Trade PnL ≠ Portfolio PnL**：任何组合级结论不得只依赖已平仓 trades。

---

## 23. Portfolio PnL Contract（组合盈亏，显式新增）

- `Portfolio PnL` 由 `Portfolio Equity` 定义：

```text
PortfolioPnL(t) = Equity(t) − Equity(initial) + ExternalCashAdjustment
Equity(t)       = cash(t) + Σ marketValue(t)          （server/backtest/portfolio.ts equityPoint/portfolioState）
```

- 组合级指标只从 `equityCurve` 与 `trades` 计算（`Metrics` 契约，`server/backtest/types.ts`）：
  **Sharpe / Max Drawdown / Calmar / CAGR / Equity Curve** 必须基于权益曲线，不得只依赖已平仓 trades。
- ExternalCashAdjustment：回测期内外部出入金必须显式记账，缺省无出入金（0）。

---

## 24. Database Contract（数据库契约）

- Drizzle ORM（mysql）+ **manual migration** + `drizzle/meta/_journal.json` + `__drizzle_migrations` 账本。
- **禁止**：`drizzle-kit push`、`DROP`、`TRUNCATE`、`DELETE` 业务数据。
- Code Contract = Migration Contract：`drizzle/schema.ts` 的表/索引定义必须与迁移文件一致
  （本修订已对齐 `liquidity_daily` 唯一索引到 `(securityCode, tradeDate)`，与迁移 0023 一致）。
- **Migration file 存在 ≠ Database migration 已落地**：契约区分 Migration Artifact 与 Database Reality（§25）。

---

## 25. Migration Contract（迁移契约）

```text
drizzle/*.sql  →  journal(_journal.json)  →  __drizzle_migrations  →  actual DB schema
```

四者必须最终一致。当前状态（诚实声明）：

| 迁移 | Contract(schema/sql/journal) | Database Reality |
| --- | --- | --- |
| 0000–0022 | 已定义，journal 已登记 | 前序 audit：账本 0000–0022 已落地 |
| **0023_security_identity_unification** | 已定义（artifact + journal idx 23） | **PENDING —— 本任务不执行生产迁移** |

- 任何「已完成」陈述必须附 DB 实查证据（`SELECT`/`SHOW`），不得以 migration file 存在代替。

---

## 26. Historical Dataset Contract（历史数据集契约）

- 明确四级不等同（§5）。研究可用覆盖至少需：OHLCV、Security Master、Status、Industry、Index、Liquidity、
  Corporate Actions、Adjustment，各自达到规定覆盖率，且 PIT 语义下 asOf 可用。
- 数据状态（Implementation Status，诚实声明）：
  - OHLCV（`stock_daily_prices`）：**PARTIAL**（116,332 行，未达研究可用标准）。
  - Security Master / Identifier History / Status / Industry / Index / Liquidity / Corporate Actions / Adjustment：
    契约/表结构 **DEFINED**，数据 **DATA-PENDING**（未回填或未达覆盖率）。
  - 覆盖率审计方法见 `scripts/audit_historical_coverage*.mjs` 与 STEP_11_WF 报告。

---

## 27. Research Ready Contract（研究就绪门禁）

`RESEARCH_READY = TRUE` 当且仅当 **全部** 满足：

| 域 | 要求 | 现状 |
| --- | --- | --- |
| Identity | securityId 统一 | ⚠️ 引擎 raw 层键仍为自然键（GAP-ENG-KEY） |
| Database | schema = migration = DB | ⚠️ 0023 未落地 DB |
| Historical Data | 8 域数据达覆盖率 | ❌ DATA-PENDING / PARTIAL |
| PIT | asOf required / availableAt enforced / T+1 trading calendar / no current-state fallback | ✅ 语义已冻结（代码部分就绪） |
| Universe | survivorship-safe | ⚠️ 判定器就绪，输入数据待回填 |
| Backtest | DB HistoricalBarStore | ✅ 已实现 |
| Execution | PositionIntent→Order→Fill→Portfolio | ✅ 已打通 |
| Accounting | Corporate Action→Portfolio | ✅ 已打通（数据待回填） |
| PnL | Trade PnL + Portfolio PnL | ✅ 语义已冻结 |

> **RESEARCH_READY = FALSE**（当前存在 P0 blocker：引擎键桥接、0023 DB 落地、历史数据覆盖率）。
> 任何 P0 blocker 存在即 FALSE；本契约只冻结语义，不提前宣布研究就绪。

---

## 28. Forbidden Patterns（禁止模式清单）

以下模式在任何 STEP 12+ 实现中均属契约破坏：

```text
securityId = stockCode
securityId = ticker
currentUniverse → historical backtest
current ST → historical ST
current industry → historical industry
asOf = null
date + 1 day → T+1
forward-adjusted price → signal
full-history adjustment → historical PIT
announcementDate = exDate
DbBarStore.securities() → final historical universe
Provider Capability = Database Coverage
Migration File Exists = DB Applied
Trade PnL = Portfolio PnL
backward-adjusted ⇒ PIT-safe
```

---

## 29. Contract Status Matrix

| Contract | Status |
| --- | --- |
| Security Identity | AMENDED |
| Identifier History | AMENDED |
| Historical Universe | AMENDED |
| Survivorship Bias | ADDED |
| Historical Data | CONFIRMED |
| Trading Calendar | AMENDED |
| PIT | AMENDED |
| asOf | AMENDED |
| Adjustment | AMENDED |
| Corporate Action | AMENDED |
| Execution | CONFIRMED |
| Portfolio | AMENDED |
| Trade PnL | AMENDED |
| Portfolio PnL | ADDED |
| Database | CONFIRMED |
| Migration | AMENDED |
| Historical Dataset | AMENDED |
| Research Ready | ADDED |

> **注意**：上表 `AMENDED` 只代表**契约已修订**，不代表真实数据库/历史数据已完成。
> 数据/部署实施状态见 §2–§7、§14、§25、§27 的 Implementation Status 行。
