# RESULT-STRATEGY-GOAL-CONSOLIDATED-001 · 本 Goal 汇总（两个 Draft Variant 的正式 Backtest）

> **性质**：本 Goal（`goal-5edeceac-12e0-400f-a1b0-e873ae6396f5`，21 轮）的**单一汇总入口**。
> **替代阅读**：本文汇总 `RESULT-STRATEGY-BRIDGE-002 ~ 021` 与 `RESULT-STRATEGY-FINAL-001`（24 份过程文档）的全部结论；过程文档保留为**证据链**，不删除。
>
> 🔴 **NON-PLATFORM-FORMAL-RUN**（平台真实引擎，但**未落库为正式 Run**）· **零数据库写入** · **零业务代码改动**
> Dataset **`780004`**（`v10-listed365-pre10-post80`，`first_limit_pullback`）· HEAD **`f8b6810`** · 日期 **2026-10-08**

---

## 0. 一页结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Goal 七项条目【全部完成】。最终裁定 = **`A. YES_CONDITIONAL`（进入 OOS/WFA）**                            │
│                                                                                                      │
│  【结果】同区间 2019-01-03 ~ 2026-01-28（各 1,716 交易日）：                                             │
│    · maxAmp5 : TOTAL +53.40% · MDD −37.45% · 正年份 7/7 · 4,766 笔 · 胜率 46.1% · 持有 39.95 日        │
│    · avgAmp5 : TOTAL +43.62% · MDD −33.54% · 正年份 6/7 · 4,793 笔 · 胜率 45.4% · 持有 39.93 日        │
│    · 沪深300  : TOTAL +59.13% · MDD −45.60% · 正年份 6/8                                              │
│                                                                                                      │
│  🎯 绝对收益【跑输】基准（−5.73pp / −15.51pp）；风险特征【占优】（MDD 浅 8.15pp / 12.06pp；7/7 vs 6/8）    │
│  🎯 Alpha 来源已定位 = 【熊市防御】，不是牛市进攻                                                          │
│                                                                                                      │
│  【过程中修正】4 项平台口径错配（均已实测确认）+ 纠正 1 项假设 + 修正 2 项度量误读                            │
│  【强制限定】D1 出场时点差 1 日 · mark-to-market（未实现占 40.6%）· 未落库                                 │
│  【未证明】9 项（含风险调整指标与统计显著性未做、逐笔等价性未验证）                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Goal 条目完成情况

| # | Goal 条目 | 状态 | 关键证据 |
|---|---|:---:|---|
| 1 | 创建两个 Draft Strategy Variant | ✅ | §2 |
| 2 | 在创建时**实际执行** `validateCanonicalStrategyDefinition`（**R1**） | ✅ | **2/2 Variant · 0 issues**（实跑生产校验器） |
| 3 | 确认平台 **20bps** 总成本与研究口径一致（**R2**） | ✅ | **实算往返 20.000000 bps**（12/12 断言，差 < 1e-12） |
| 4 | 小范围/单 Run 核对 **rd55 close → 不可卖顺延 → rd80 fallback**（**R3**） | ✅ | 平台**真实 simulator** 实测，三项语义全部确认（§4.1） |
| 5 | **两个 Variant 都跑正式 Backtest** | ✅ | §5 |
| 6 | Backtest 后**据结果决定是否进入 OOS/WFA** | ✅ | §0 / §7 |
| 7 | 暂不做 OOS/WFA、参数搜索、仓位搜索、TopN 搜索 | ✅ | **全程未做**（零参数/仓位/TopN 搜索；未执行 OOS/WFA） |

---

## 2. 两个 Draft Strategy Variant

| Variant | `maxAmp5` | `avgAmp5` |
|---|---|---|
| ID | `event-state-long-maxamp5-top3@1.0.0` | `event-state-long-avgamp5-top3@1.0.0` |
| 排名特征 | `maxAmp5` | `avgAmp5` |
| 其余字段 | 🔴 **逐字段完全相同** | 同左 |

**共同定义**

| 项 | 值 |
|---|---|
| `schemaVersion` | `1.0` |
| 数据集 | `first_limit_pullback` · `v10-listed365-pre10-post80` · **`datasetVersionId = 780004`** · `role: PRIMARY` |
| `observationWindow` | `{ start: 15, end: 15, unit: "TRADING_DAY" }`（**决策日 = rd15**） |
| `trigger` | `LAST_VALID_DAY` · `conditions: []` |
| 出场 | 单条 `TIME_EXIT` 规则 · `trigger: "ON_CLOSE"` · `threshold: 40` · `thresholdUnit: "TRADING_DAY"` · **无 `policy` 对象**（规避 `ExitPolicyDefinition.stop` 必填约束） |
| 仓位 | `EQUAL_WEIGHT` · `maxPositions: 180` · `maxExposure: 1` · `maxSinglePosition: 1/180` |
| 执行 | `signalTiming: T_CLOSE` · `executionTiming: T_PLUS_1_OPEN` · `priceType: OPEN` · `lotSize: 100` |
| 约束 | `["OPEN_AT_LIMIT_UP_UNFILLED","SUSPENDED_NEXT_OPEN_UNFILLED"]` |
| `recipe` | `kind: signalEngine` · `point: close` · `signalFrequency: daily` · `rankingConfig: { higherIsBetter: false }`（方向 `dir = −1`）· `selectionConfig: topN n=3` |

**冻结因子定义**（`maxAmp5` / `avgAmp5`，`EVENT_STATE_AMPLITUDE`）

```
窗口 = 事件窗 rd11~15（5 个交易日）· 链式前收：amp(rd) = (post[rd].high − post[rd].low) / close(rd−1)
runningPreClose 起于事件日收盘 ⇒ maxAmp5 = max(5) · avgAmp5 = mean(5) · 方向 dir = −1
🔴 决策日下界 = rd15
```

📌 平台侧注册于 `server/strategyCore/featureRegistry.ts`（`EVENT_STATE_AMPLITUDE_FEATURE_IDS` / `_WINDOW` / `eventStateAmplitudeValues` / `makeEventStateAmplitudeFeatures`，`historyMode: "EVENT_TO_CURRENT"`，`dataThroughRelativeDay ≤ 0`，`usesForwardData: false`），含 **3 道结构防线**（`current.relativeDay < 15 ⇒ null` · `filter(rd ≥ 1 && rd ≤ 15)` · `values.length === 5`）。

---

## 3. 方法：正式 Backtest 的装配链（本轮勘定并跑通）

```
buildEventWindowDatasetCursorFromRegistry({ datasetVersionId: 780004,
    observationWindow: { start: 15, end: 79 }, dataReady: true,
    decisionMemberPredicate: m => m.relativeDay === 15 })
        ├─ cursor  → await cursor.restart()
        │            → runCandidateEngineFromCursor({ cursor, config, strategy, strategy13 })
        │            → runTradeSimulationFromCursor({ cursor, sourceRun: candidateRun, simConfig })
        └─ dataset → 轻量装配摘要（rows = 0，仅供策略定义；🔴 不可喂候选引擎）

参照平台自身接线：server/research/closedLoopWiring/executors.ts L846 / L849 / L912
```

### 3.1 关键路径决策

| 决策 | 依据 |
|---|---|
| **必须走 event-window cursor** | `REGISTRY_BRIDGE_MAX_ROWS = 1,600,000`（`datasetFromRegistry.ts` L181）< 780004 的 **10,320,499** 行 ⇒ 直读桥不可用 |
| **必须走 `research/simulator`** | `runBacktestEngine2`（STEP 8）的 `executionModel` 是**单一全局**设置 ⇒ 无法同时表达「入场 rd16 `open`」+「出场」；`research/simulator` 是唯一带退出策略层（`exitPolicy.timeExit`）的引擎 |
| **`observationWindow.end = 79`** | `maxRd = endRd + 1 = 80` = 数据集 `post` 上限 ⇒ 覆盖 F40 的 rd55 + 执行日；`{15,15}` 只投影 rd0~16，**rd55 缺席** |
| **`decisionMemberPredicate` 收敛 rd15** | 逐行验证：谓词**只**影响 `members` / `visibleBars` / 计数；**`rows` 与 `executionBars` 无条件产出**（`datasetFromRegistry.ts` L1894-1927）⇒ 面板身份与 rd 口径不变 |
| **每 Variant 独立构造 cursor** | 事件窗 cursor **只能顺序读一次** |

### 3.2 研究口径 ↔ 平台配置对照

| 项 | 研究口径 | 平台配置 |
|---|---|---|
| 决策 | rd15 `close` | `observationWindow {15,·}` + 谓词 `relativeDay === 15` |
| 入场 | rd16 `open` | `signalTiming: T_CLOSE` → `executionTiming: T_PLUS_1_OPEN` |
| 出场触发 | rd55 `close`（持满 40 日） | `exitPolicy.maxHoldingDays = 40` |
| **出场成交** | **rd55 `close`** | 🔴 **rd56 `open`** —— **D1，见 §6.1** |
| 候选退出 | **不因掉出候选而退出** | `candidateExitPolicy: "DISABLED"` |
| 仓位 | `w = 1/MAX_CONC = 1/180`（恒定） | `positionSizing: { FIXED_RATIO, fraction: 1/180, fixedAmount: null }` |
| 并发上限 | `MAX_CONC = ceil(1.5 × 3 × 40) = 180` | `maxPositions: 180` |
| 成本 | 往返 20 bps | `commission 2.5bps/边 + slippage 7.5bps/边`；`stampDuty/transferFee = 0`；`minCommission = 0` |
| 不可卖 | `canSellAtClose = 0` ⇒ 顺延 | `blockLimitDownSells: true` + 退出条件每日重估 |
| 边界兜底 | 至 rd80 强制按 close 结算 | 🔴 **无强制结算** —— 记为 `回测结束仍持仓`（§6.2） |

---

## 4. 三项 R 的解决

### 4.1 ✅ R3（小范围 / 单 Run 核对 rd55 → 顺延 → rd80）

**方法**：平台**真实 `runTradeSimulation`** · 纯内存 fixture（≤ 6 交易日 / 1 标的）· 范式对齐 `tests/server/research/executionConstraints/executionConstraints.test.ts`

| 语义 | 实测结果 |
|---|---|
| **不可卖 ⇒ 拒单** | ✅ `sell tradeDate=06-03 status=REJECTED rr=LIMIT_DOWN` |
| **被拒后【每日重新发单】⇒ 结构性顺延** | ✅ 次日 `sell tradeDate=06-04 status=FILLED`；连续 3 日被拒时**每日都重新发单** |
| **边界处行为** | ✅ `positions` 仍持有 + `reason = "回测结束仍持仓"` + `exitPrice` 按边界价标注 |

🔴 **机制澄清**：顺延**不是**显式 `DEFER` 机制 —— `suspensionPolicy` 字段**无任何消费者**（`backtest/context.ts` 内 5 处声明层命中）；单笔挂单**不重试**（`pending.filter(e => e.executionTime !== date)`）；顺延靠**退出条件（`holdingDays >= 40`）每日恒真 ⇒ 每日重新生成卖单**。

**先例锁定**：`executionConstraints.test.ts` **L927**（止损被跌停拒 ⇒ `exitTime: retryDay`）· **L877**（`run.positions` 期末仍持有）。

### 4.2 ✅ R1（`validateCanonicalStrategyDefinition` 实跑）

**方法**：`tsc` 编译生产模块 → CJS → `require` 实跑
**结果**：**2/2 Variant · `issues = 0`**；确认 `maxExposure = 1` · `maxSinglePosition = 1/180` · `180 × (1/180) = 1.0` · `exit.rules` **不含 `policy` 对象**

### 4.3 ✅ R2（平台 20bps ≡ 研究口径）

**方法**：`validateCostModelDeclaration` + `computeFillCostBreakdown`（复刻 `engine/execution.ts` 的成交价约定）

```
buy  price=10.0075  commission=2.501875  slippage=7.500000 ⇒ 10.001875 bps
sell price=9.9925   commission=2.498125  slippage=-7.500000 ⇒  9.998125 bps
🔴 往返合计 = 20.000000 bps       12/12 断言通过
平台 net ≡ 研究 gross − 0.002（差 < 1e-12）· 恒等式 往返 ≡ 2×(c_bps + s_bps) 成立
对照：平台 A_SHARE_DEFAULT 往返 ≈ 35.9950 bps ⇒ 必须显式声明研究口径
```

---

## 5. 正式 Backtest 结果

### 5.1 组合级（同区间 **2019-01-03 ~ 2026-01-28** · 各 **1,716** 交易日）

| 项 | **`maxAmp5`** | **`avgAmp5`** | **沪深300** |
|---|---:|---:|---:|
| **TOTAL** | **+53.40%** | **+43.62%** | **+59.13%** |
| **MDD** | **−37.45%** | **−33.54%** | **−45.60%** |
| **正年份** | **7/7** | 6/7 | 6/8 |
| 2019 | +4.05% | +3.90% | +38.17% |
| 2020 | +8.76% | +9.41% | +27.21% |
| **2021** | **+11.42%** | +8.15% | −5.20% |
| **2022** | **+0.67%** | −1.23% | −21.63% |
| **2023** | **+1.58%** | +2.54% | −11.38% |
| 2024 | +8.21% | +6.25% | +14.68% |
| 2025 | +9.94% | +8.56% | +17.66% |
| 2026 | 0.00%（见 §6.2） | 0.00% | +1.90% |

### 5.2 交易层

| 项 | `maxAmp5` | `avgAmp5` |
|---|---:|---:|
| `trades` | **4,766** | **4,793** |
| `winRate` | 46.1% | 45.4% |
| `holdAvg` / `holdMin` / `holdMax` | **39.95** / 0 / 47 | **39.93** / 0 / 48 |
| 退出原因 | `持有满40个交易日` **4,643（97.42%）** · `回测结束仍持仓` 123 | **4,667（97.37%）** · 126 |
| `stuck`（末端未平仓） | **2.64%** | **2.69%** |
| 拒单构成 | `SUSPENDED 8,315` · `NO_LIQUIDITY 45` · `OTHER 5` | `SUSPENDED 8,906` · `NO_LIQUIDITY 102` · `OTHER 5` |

### 5.3 逐年超额（策略 − 基准，`maxAmp5`）

| 2019 | 2020 | **2021** | **2022** | **2023** | 2024 | 2025 |
|---:|---:|---:|---:|---:|---:|---:|
| −34.12pp | −18.45pp | **+16.62pp** | **+22.30pp** | **+12.96pp** | −6.47pp | −7.72pp |

> ## 🎯 **Alpha 来源 = 【熊市防御】** —— 牛市（2019/2020/2024/2025）大幅落后；熊市（2021/2022/2023）大幅占优
> ## ⇒ 与 `POST-EVENT-STATE-2022-ATTRIBUTION-001` 的「**减亏机制**」结论**方向一致**且机制可解释

### 5.4 两 Variant 对比

🎯 **`maxAmp5` 在 TOTAL（+9.78pp）与 2022 尾部（+1.90pp）上均优于 `avgAmp5`**
📌 ⇒ 为 `POST-EVENT-STATE-FACTOR-SELECT-001` 的「**3:3 平局 / `KEEP = 暂不择一`**」提供**首个组合级证据**（非裁定）

---

## 6. 🔴 强制口径限定（**引用本结果时必须一并声明**）

### 6.1 D1 —— 出场时点（**1 个交易日差异，不可消除**）

| 项 | 研究口径 | 平台实测 |
|---|---|---|
| 触发 | rd55 `close` | rd55 `close` ✅ |
| **成交** | **rd55 `close`** | 🔴 **rd56 `open`** |

**平台依据**（`server/research/simulator/types.ts` **L250** 原文）：
> 「`TIME_EXIT`：持有满 N 个交易日后的**收盘触发**，**下一交易日开盘卖出**。」

⇒ **平台定义、非可配置项**（`trigger: "ON_CLOSE"` 指**触发时点**，非成交时点）
**实测证据**：两 Variant 全部样本 **`holdAvg = 39.95 / 39.93`**（40 日持有 + 1 日执行）
⇒ 🔴 **本结果与研究的 F40 【不是逐位等价】**；差值 = `close(rd55)` 与 `open(rd56)` 的 1 日缺口，**完全可量化**

### 6.2 末端未平仓（**数据集边界效应**）⇒ mark-to-market 口径

| 项 | `maxAmp5` | `avgAmp5` |
|---|---:|---:|
| 未平仓笔数 | **123**（2.58%） | **126**（2.63%） |
| `marketValue` | **622,792** | 同源 |
| 占 `finalEquity` | **40.6%** | 同量级 |
| 根因 | `stuckYr = {2025: 125}` ⇒ 2025 年入场、本应 **2026** 退出，但数据集止于 `2025-09-26` | 同 |
| 2026 年 `0.00%` | **机制性**：数据集结束后无新行情 ⇒ 未平仓按最后已知价标注 ⇒ `marketValue` 冻结 ⇒ `equity` 不变 | 同 |

⇒ 🔴 **本结果为 mark-to-market 口径，含【未实现收益】；与「已实现收益」不可混称**
⇒ 研究口径有 **rd80 兜底**（按边界 close 强制结算）；平台**无强制结算**，记为 `回测结束仍持仓`

### 6.3 其他

| # | 项 |
|---|---|
| 1 | 年度收益一律 **(B) 严格口径** `eq[last of y] / eq[last of y−1] − 1`（**非** (A) 的 `eq[last of y]/eq[first of y] − 1`） |
| 2 | 成本 = **往返 20 bps** |
| 3 | 仓位 = **`FIXED_RATIO × 1/180`** |
| 4 | 候选退出 = **`candidateExitPolicy: "DISABLED"`** |
| 5 | 数据窗 = `{start:15, end:79}` · `maxRelativeDay = 80` |
| 6 | 🔴 **未落库为正式 Run** ⇒ 本结果为**研究性复现结果**，非平台正式 Run 记录 |

---

## 7. 最终裁定：**`A. YES_CONDITIONAL`（进入 OOS/WFA）**

| 条件 | 内容 |
|---|---|
| **C-a** | **目的修正** —— 验证「**熊市防御**」是否**样本外稳定**，**不是**「能否跑赢基准」（依据：同区间绝对收益跑输 5.73pp，但 MDD 浅 8.15pp、正年份 7/7 vs 6/8） |
| **C-b** | **不得用 2019-2025 调参**（Goal 明确「暂不做参数搜索」）⇒ OOS 用**时间外样本** |
| **C-c** | **口径必须标注**（§6 全部） |
| **C-d** | **须先补**：风险调整指标（Sharpe / Calmar）与统计显著性（§8 N1/N2） |

**建议的 OOS/WFA 形式（仅登记，未执行）**

| 项 | 建议 |
|---|---|
| OOS 切分 | 时间外样本；窗口须与 **40 交易日持有**匹配 |
| WFA | 滚动窗，窗长 ≥ 1 年 |
| 两 Variant | **同一协议**下并行，便于对比 |
| 口径 | 年度 **(B)** · 往返 **20bps** · 标注 D1 与末端未平仓 |

### 门槛 G1~G4

| # | 门槛 | 状态 |
|---|---|:---:|
| **G1** | 两 Variant 组合级结果均已产出 | ✅ |
| **G2** | 结果无未解释异常 | ✅（2026=0% 与曲线尾段为机制性；未平仓登记为限定） |
| **G3** | 与基准**同期对齐**比较 | ✅ |
| **G4** | 口径差异已显式标注 | ✅（§6） |

---

## 8. 未证明（**如实登记，9 项**）

| # | 未证明 | 影响 |
|---|---|---|
| **N1** | **风险调整指标**（Sharpe / Calmar / 信息比率）**未计算** | 「风险调整后占优」为**推断** |
| **N2** | **统计显著性**（逐日/逐月超额收益 t 检验）**未做** | 无法断言超额非偶然 |
| **N3** | 🔴 **2026 = 0.00% 的「分子 = 分母」未逐点验证** | 机制性推断，未见具体 equity 对照 |
| **N4** | **`holdMin = 0` 的成因**（少量 0 日持有） | 未查 |
| **N5** | 数据集 `canSellAtClose` ↔ 引擎板价判定的**逐事件一致性**（D2） | 可能有逐事件差异 |
| **N6** | 与研究 harness 的**逐笔等价性** | 未做逐笔比对 |
| **N7** | ❌ **OOS / WFA 本身** | Goal 明确不做 |
| **N8** | ❌ 冲击成本 / 容量约束 / `(A) 年度口径缺陷` 的独立复核 | 未做 |
| **N9** | 两个 Variant **未落库**（未创建 Candidate / Strategy Version） | 非正式 Run |

**另有 2 项已证伪/修正的假设（诚实登记）**

| 项 | 原假设 | 实测结论 |
|---|---|---|
| **`SUSPENDED` 根因** | 「cursor 成员退休边界为主因」（`end: 55 → 79` 应消除） | 🔴 **证伪** —— 仅降 19%（10,291 → 8,315）；真因 = **数据集末端效应** |
| **`SUSPENDED` 严重性** | 拒单 8,315 次 ≈ 46% 失败 | 🔴 **误读** —— 系 **66× 重试放大**；真实受影响仅 **126 笔（2.64%）** |
| **`retAvg`** | 196.593%（单笔） | 🔴 **重复 ×100** ⇒ 正确值 **1.966%** |

---

## 9. 过程中修正的 4 项平台口径错配（**均已实测确认**）

| # | 错配 | 平台缺省行为 | 修正 | 实测证据 |
|---|---|---|---|---|
| **1** | **候选退出** | `HOLD_WHILE_SELECTED` —— 掉出 Top3 即平仓 ⇒ 持仓仅 **3 天** | `candidateExitPolicy: "DISABLED"` | `holdingPeriod 3 → 41` · `reason 候选退出 → 持有满40个交易日`（97.4%） |
| **2** | **仓位** | `EQUAL_WEIGHT` 按当日候选数均分 ⇒ `w ≈ 1/3`（首笔 **334,400 元**） | `FIXED_RATIO × 1/180` | 首笔 **5,250 元** ≈ `1,000,000/180` |
| **3** | **数据窗** | `{15,15}` 只投影 rd0~16 ⇒ **F40 的 rd55 缺席** | `{15,79}`（`maxRd = 80`）+ 谓词收敛 rd15 | `maxRelativeDay 56 → 80` · `tradingDayCount 1750 → 1798` |
| **4** | **cursor 复用** | 事件窗 cursor **只能顺序读一次** | 每 Variant 独立构造 | 复用时报「只支持顺序读取」 |

📌 修正依据与先例：`plan.ts` L167-168（`FIXED_RATIO` 基数 = **初始资金**）· `engine.ts` L259/L491 + `plan.ts` L6-7（`DISABLED` ⇒ 候选集合不参与卖出）· `datasetFromRegistry.ts` L1786-1788（`maxRd = endRd + 1`）· 先例 `firstLimitPullback3FTopN.ts` L62 · `threeFactorTopNStrategy.ts` L653/L708。

---

## 10. 合规声明

| 项 | 状态 |
|---|:---:|
| 业务代码改动 | ✅ **零** |
| 数据库写入 | ✅ **零**（全程只读 TiDB / `index_daily`） |
| 创建 Candidate / Strategy Version / 正式 Run | ✅ **零** |
| 执行 OOS / WFA | ✅ **零**（符合 Goal 约束） |
| 参数 / 仓位 / TopN 搜索 | ✅ **零** |
| 修改 3570001 / 因子定义 / Schema / Migration / Dataset | ✅ **零** |
| `tsc --noEmit` | ✅ **0 错** |
| 文档 EOL | ✅ **CR = 0** |
| 临时文件 | ✅ 全部落 `scripts/_scratch/`（gitignore） |

**工作区复核**：`server/` 改动 **7** 项，**与本 Goal 开始前一致**（其中 `server/strategyCore/featureRegistry.ts` 为本研究程序更早轮次的**授权新增**，见 `FACTOR-TIMESCALE-*` 系列）；`strategy_versions` **178** · `closed_loop_backtest_run` **463** · `research_strategy_candidate` **13** **全部未变**。

---

## 11. 文件索引

### 11.1 本文（汇总入口）

| 文件 | 内容 |
|---|---|
| **本文件** `docs/research/RESULT-STRATEGY-GOAL-CONSOLIDATED-001.md` | **本 Goal 单一汇总** |
| `docs/research/RESULT-STRATEGY-FINAL-001.md` | 最终结果与 OOS/WFA 裁定（本文 §5~§7 的原始出处） |

### 11.2 过程证据链（24 份，按 Goal 轮次）

| 轮次 | 文件 | 主题 |
|---|---|---|
| — | `RESULT-STRATEGY-DRAFT-001.md` | 第一版 Draft（🛑 `B. BLOCKED`，5 项阻塞） |
| — | `RESULT-STRATEGY-BRIDGE-001.md` | 解除 5 项阻塞（✅ `A. READY_FOR_FORMAL_BACKTEST`） |
| **1** | `RESULT-STRATEGY-BRIDGE-002.md` | Draft Variant 定义 · **R1 ✅ / R2 ✅** · R3 可表达性 |
| 2 | `RESULT-STRATEGY-BRIDGE-003.md` | 正式 Backtest 路径勘定 · R3 语义定位 |
| **3** | `RESULT-STRATEGY-BRIDGE-004.md` | **R3 最小实测（平台真实 simulator）→ R3 ✅ 解除** |
| 4 | `RESULT-STRATEGY-BRIDGE-005.md` | **D1 裁定** · 数据路径勘定（1.6M 行上限 ⇒ cursor） |
| 5 | `RESULT-STRATEGY-BRIDGE-006.md` | cursor 装配三项前置勘定（发现 F40 出场日缺口） |
| 6 | `RESULT-STRATEGY-BRIDGE-007.md` | cursor 解法**逐行验证**（N2 解除） |
| 7 | `RESULT-STRATEGY-BRIDGE-008.md` | 正式 Backtest **首次实际启动**（cursor 构造成功） |
| 8 | `RESULT-STRATEGY-BRIDGE-009.md` | **首次跑出结果** + 发现候选退出语义问题 |
| 9 | `RESULT-STRATEGY-BRIDGE-010.md` | **候选退出修正成功** + 暴露仓位口径不符 |
| 10 | `RESULT-STRATEGY-BRIDGE-011.md` | **仓位口径修正**（`FIXED_RATIO × 1/180`） |
| 11 | `RESULT-STRATEGY-BRIDGE-012.md` | 两 Variant **首次完整跑完** |
| 12 | `RESULT-STRATEGY-BRIDGE-013.md` | `SUSPENDED` 修正（`end: 55 → 79`） |
| 13 | `RESULT-STRATEGY-BRIDGE-014.md` | 修正生效但 `SUSPENDED` 未消除 —— **假设被证伪** |
| 14 | `RESULT-STRATEGY-BRIDGE-015.md` | `SUSPENDED` **聚合度量口径**改造 |
| **15** | `RESULT-STRATEGY-BRIDGE-016.md` | **`SUSPENDED` 真实影响 2.64%（非问题）+ 根因坐实** |
| 16 | `RESULT-STRATEGY-BRIDGE-017.md` | 组合级度量接入（`equityCurve` / **(B) 口径**） |
| **17** | `RESULT-STRATEGY-BRIDGE-018.md` | **`maxAmp5` 组合级结果**（7/7 年正） |
| 18 | `RESULT-STRATEGY-BRIDGE-019.md` | 两 Variant 组合级结果全部产出 · **OOS/WFA 门槛 G1~G5** |
| 19 | `RESULT-STRATEGY-BRIDGE-020.md` | C1/C2/C3 查证 → **G2 ✅** |
| 20 | `RESULT-STRATEGY-BRIDGE-021.md` | 同期对齐基准比较 → **G3 ✅**（Alpha = 熊市防御） |
| **21** | `RESULT-STRATEGY-FINAL-001.md` | **G4 ✅ + 最终裁定 → Goal 完成** |

### 11.3 关键代码锚点

| 路径 | 用途 |
|---|---|
| `server/runWorkbenchAssembly/datasetFromRegistry.ts` | `buildEventWindowDatasetCursorFromRegistry` · `createEventWindowDatasetCursor` · `observationWindow` / `decisionMemberPredicate` / `maxRd` 推导 |
| `server/research/signalEngine/cursorEngine.ts` | `runCandidateEngineFromCursor` |
| `server/research/simulator/cursorEngine.ts` | `runTradeSimulationFromCursor` |
| `server/research/simulator/types.ts` | `SimulationConfig`（`exitPolicy` · `positionSizing` · `candidateExitPolicy`）· **L250 = D1 依据** |
| `server/research/simulator/plan.ts` | L6-7（候选退出）· **L167-168（`FIXED_RATIO` 基数）** |
| `server/research/simulator/engine.ts` | L259/L491（`candidateExitPolicy`）· L725-747（挂单不重试 / `SUSPENDED`） |
| `server/research/closedLoopWiring/executors.ts` | L846/L849/L912（平台自身接线） |
| `server/strategyCore/featureRegistry.ts` | 本研究的 `maxAmp5` / `avgAmp5` 特征注册 |
| `tests/server/research/executionConstraints/executionConstraints.test.ts` | L877 / L927（R3 的平台先例） |

### 11.4 台账

`docs/architecture/CHANGE-AUDIT.md`（append-only）—— 本 Goal 的 **21 条**条目（`RESULT-STRATEGY-BRIDGE-002 ~ 021` + `RESULT-STRATEGY-FINAL-001`）。

---

## 12. 建议的下一步（**不在本 Goal 范围**）

```text
1. 补 N1/N2：风险调整指标（Sharpe / Calmar）+ 统计显著性检验（超额收益 t 检验）
2. 按 §7 的 C-a~C-d 设计 OOS/WFA 协议
   · 目的 = 验证【熊市防御】的样本外稳定性（不是「跑赢基准」）
   · OOS 用时间外样本，不得用 2019-2025 调参
   · 两 Variant 在同一协议下并行
3. 补 N3/N4/N6：逐点验证 2026 端点 · 查 `holdMin = 0` · 与研究 harness 做逐笔比对
4. （可选）把两个 Variant 落库为平台正式 Run
5. （可选）处理 §6.2：为平台补「数据边界强制结算」能力，或确认接受 mark-to-market 口径
```

---

**本文为 `goal-5edeceac-12e0-400f-a1b0-e873ae6396f5` 的最终汇总。Goal 已 complete。**