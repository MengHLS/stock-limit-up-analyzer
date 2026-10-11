# RESULT-STRATEGY-DRAFT-001 · 第一版研究策略 Draft（EVENT_STATE_LONG）

> 目标：将已完成的 **SHORT / MEDIUM / EVENT_STATE_LONG** 时间尺度研究正式转入**第一版策略定义**
> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入**（只读 `SELECT`）· HEAD `f8b6810` · Dataset **`780004`**
> **未创建 Candidate / Strategy Version** · **未修改业务代码 / Schema / Migration / Dataset**

---

## 0. 最终裁定

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                                      │
│                              ##  B. BLOCKED                                                           │
│                                                                                                      │
│  🔴 **五项硬阻塞（其中 B1 / B3 / B4 为结构性阻塞）**                                                       │
│                                                                                                      │
│  **B1 · 因子未注册为平台特征**【结构性】**                                                                 │
│     `maxAmp5` / `avgAmp5`（rd11~15）**在平台 FeatureRegistry 中【不存在】**                                 │
│     · 内置 `observationMaxAmplitude` / `observationMeanAmplitude` = **rd1~5**（`lookback: 5`）          │
│     · 内置 `rollingMaxAmplitude` = **T+1..min(当前日,T+5)** —— **硬编码 `relativeDay <= 5`**             │
│     ⇒ 注册 rd11~15 新特征 = **修改业务代码** ⇒ 🔴 **本任务明确禁止**                                        │
│                                                                                                      │
│  **B2 · 排名因子未定**                                                                                  │
│     `FACTOR-SELECT-001` 裁定 **`KEEP = 暂不择一`**（五项规则 3:3 平局）⇒ 策略需**单一**排名因子                  │
│                                                                                                      │
│  **B3 · 仓位口径冲突**【结构性】                                                                          │
│     研究口径 `MAX_CONC = ceil(1.5×3×40) = 180` · `w = 1/180` 恒定                                        │
│     vs 模板 `3570001`：`maxPositions = 5` · `positionRatio = 0.2` · `maxSinglePosition = 0.3` ·          │
│        `maxExposure = 0.8` · `sizingMethod = FIXED_RATIO`                                              │
│     ⇒ **二者不相容**；继承模板 ⇒ 研究证据作废；沿用研究 ⇒ `maxPositions=180` 无模板先例与风险画像证据            │
│                                                                                                      │
│  **B4 · 退出逻辑冲突**【结构性】                                                                          │
│     研究口径：**固定持有至 rd55（F40）→ `canSellAtClose=1` 顺延 → rd80 兜底**（**无止损 / 无止盈 / 无 runner**）│
│     vs 模板：**6% 止损 + PEAK_DRAWDOWN 升级 + MA5/MA10 止盈 + strongHold(5→10) + runnerBridge(5→20)**      │
│     ⇒ 退出逻辑是**交易结果的直接决定项** ⇒ 继承模板 ⇒ **F40 的 ΔmExc / beat 证据【全部作废】**                │
│                                                                                                      │
│  **B5 · 三尺度不可组合（范围阻塞）**                                                                       │
│     `FACTOR-TIMESCALE-FINAL-001` 冻结：**SHORT「仅登记角色，不进策略」** · **MEDIUM「⛔ 不与 LONG/SHORT 组合」** │
│     ⇒ 🔴 **第一版策略【只能包含 EVENT_STATE_LONG 一个尺度】** ⇒ 与「三尺度转入策略」的任务表述**不符**            │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

> ## 📌 **本报告仍给出【完整 Draft 规格】（§2）** —— 目的不是宣告可执行，而是**精确暴露**解除阻塞所需的最小改动集（§4）。

---

## 1. 基线复用清单（**本轮实际读取**）

### 1.1 冻结研究（复用，未重跑）

| # | 来源 | 复用内容 |
|---|---|---|
| 1 | `RESULT-FACTOR-TIMESCALE-FINAL-001` | **三尺度角色矩阵**（LONG = 股票池 / MEDIUM = 独立中期相对强弱减亏 / SHORT = 短期相对强弱仅登记）· **禁止综合评分**（原则 §3-4） |
| 2 | `RESULT-POST-EVENT-STATE-P0-ORACLE-002` | **执行口径**：rd16 `open` 入场 · `canBuyAtOpen=1` · 目标 rd(D+F) · `canSellAtClose=1` 顺延 · rd80 兜底 · **20bps** |
| 3 | `RESULT-POST-EVENT-STATE-NB-RANDOM-002` | **仓位口径**：`MAX_CONC = ceil(1.5 × N × F)` · `w = 1/MC` 恒定（**源自随机臂饱和修正，非策略结论**） |
| 4 | `RESULT-POST-EVENT-STATE-T0-INDEPENDENCE-001` | **决策点下界 = rd15**（定义依赖 rd11~15 ⇒ **T=0 不可用**） |
| 5 | `RESULT-POST-EVENT-STATE-TIMESCALE-MAPPING-001` | **归位 `C. EVENT_STATE_LONG_HORIZON`** · IC / ΔmExc 单调递增至 F40 |
| 6 | `RESULT-POST-EVENT-STATE-LONG-BOUND-001` | **`B. LONG_BOUND_AROUND_40`**（信息尺度 ≈40 日附近）· F60 出场闸门 rd75 可卖 99.85% |
| 7 | `RESULT-POST-EVENT-STATE-ATTRIBUTION-001` | **`A. POST_EVENT_INDEPENDENT_ALPHA`**（后事件因子自身解释主要 Alpha） |
| 8 | `RESULT-POST-EVENT-STATE-FACTOR-SELECT-001` | 🔴 **`KEEP = 暂不择一`** |
| 9 | Dataset `780004` 冻结配置 `510004` | `excludeSt=1` · `excludeListedWithinDays=365` · `preWindowDays=10` · `postWindowDays=80` · `outcomeHorizons=[5,10,20]` |

### 1.2 正式策略模板 `first-limit-pullback-3f-top3-runner-hold20@1.0.0`（= `3570001`）结构

> 来源：`tests/server/research/strategyAuthoring/golden3570001.ts`（canonical golden，**逐字**来自库内 `strategyDocumentJson`）

| 区块 | 内容 |
|---|---|
| **datasets** | `first_limit_pullback` · `v7` · `750001` · `PRIMARY` |
| **entry** | event `FIRST_LIMIT_UP`（`limitUpRatio 0.1`）· `observationWindow {start:5, end:15, unit:TRADING_DAY}` · trigger `FIRST_VALID_DAY` |
| **execution** | `signalTiming T_CLOSE` → `executionTiming T_PLUS_1_OPEN` · `priceType OPEN` · `lotSize 100` · `quantityMethod TARGET_WEIGHT` · `commissionModel BPS` · `slippageModel BPS` · 约束「一字板不成交」「停牌顺延」 |
| **exit（统一 policy）** | `stop` FIXED_PERCENT **0.06**（INTRADAY）+ escalation PEAK_DRAWDOWN（0.03 / 0.08）· `strongHold` @5 → 10（`minReturnRatio 0.03` · above MA5 & MA10）· `takeProfit` MA_CROSS 5/10 · `timeExit` FIXED_HOLDING_DAYS **5** · `runnerBridge` PIT_RUNNER_HOLDING_BRIDGE `NEW_HIGH_3`（5 → 20） |
| **position** | `maxPositions 5` · `positionRatio 0.2` · `maxSinglePosition 0.3` · `maxExposure 0.8` · FIXED_RATIO |
| **risk** | `maxDrawdown 0.25` · `maxExposure 0.8` · `stopLoss 0.08` |
| **recipe** | `first-limit-pullback-3f-top3` · `signalEngine` · `point close` · **topN 3** · `higherIsBetter` · feature `threeFactorCompositeScore@1.0.0` |
| **signalDescription** | 「首板回踩 3F 等权合成分（`maxAmplitude` / `meanAmplitude` 取 LOW，`t1VolumeRatio` 取 HIGH，桶位分各 1/3）」 |

> 🔴 **关键差异**：模板的 `maxAmplitude` / `meanAmplitude` = **rd1~5 固定窗口**；本策略因子 `maxAmp5` / `avgAmp5` = **rd11~15 滚动窗口** ⇒ **不是同一因子**（`TIMESCALE-MAPPING-001` §3.3 已登记）

### 1.3 ✅ 平台侧结构性检查（**本轮实测 · 只读**）

| # | 位置 | 事实 |
|---|---|---|
| 1 | `server/strategyCore/featureRegistry.ts#makeRollingObservationWindowFeatures` | `rollingMaxAmplitude` 的 `post` 过滤为 **`bar.relativeDay >= 1 && bar.relativeDay <= 5`** ⇒ **硬编码上限 rd5** |
| 2 | `server/strategyCore/featureRegistry.ts#makeObservationWindowFeatures` | `observationMeanAmplitude` / `observationMaxAmplitude` = **rd1~5**（`lookback: 5`）· `leakage = sameBarLeakage("close", -4)` |
| 3 | `server/strategyCore/featureRegistry.ts`（§验证） | **`dataThroughRelativeDay` 必须 `<= 0`**；`> 0` ⇒ **「需要未来数据，禁止注册为策略特征」** |
| 4 | `server/strategyCore/featureRegistry.ts#DERIVED_BAR_FIELD_TO_FEATURE_ID` | 已登记特征 id 全表 —— 🔴 **不含任何 rd11~15 振幅特征** |
| 5 | `server/researchExperiments/registry.ts` + `datasetPort.ts` | `rd ≥ 1` 属 `usesForwardData` 领域 ⇒ **决策日 ≥ rd15 时 rd1~15 全部 ≤ 决策日，属 PIT 合法**（与 #3 不冲突） |

> ## 🔴 **⇒ 结论：`maxAmp5`/`avgAmp5` 在平台上【无对应特征】；新增 = 修改 `featureRegistry.ts` = 修改业务代码**
> ## ✅ **且平台特征框架【允许】EVENT_TO_CURRENT 型特征在决策 bar = rd15 处读取 rd0~15** ⇒ **技术上可行，仅需新增定义**

---

## 2. 第一版策略 Draft 规格（**11 项逐项标注来源**）

> 命名：**`event-state-long-amp5-top3-hold40`**（Draft，**未落库**）
> 来源标签：**`FROZEN`** = 已有研究明确冻结 · **`INHERITED`** = 直接复用 `3570001` · **`NEW-DESIGN`** = 本次首次定义

| # | 项 | **Draft 值** | **来源** | 依据 |
|---|---|---|---|---|
| **1** | **股票池 / 候选事件定义** | Dataset **`780004`**（`first_limit_pullback` · `v10-listed365-pre10-post80`）· 事件 = **首板**（`FIRST_LIMIT_UP`，`limitUpRatio 0.1`）· 排除 **ST** · 排除**上市 < 365 日** · `preWindowDays 10` · `postWindowDays 80` | **`FROZEN`**（池/事件）+ **`NEW-DESIGN`**（绑定 `780004` 而非模板的 `v7/750001`） | 配置 `510004`；模板 `entry.event` |
| **2** | **决策时点** | **T+15（rd15 收盘）** | **`FROZEN`** | `T0-INDEPENDENCE-001`：定义下界 **rd15**（不可用 rd0~rd14） |
| **3** | **可使用信息 / relativeDay 边界** | **rd −10 ~ rd15**（`prefix` rd≤0 + `post` rd1~15）· 🔴 **严禁读 rd ≥ 16** | **`FROZEN`** | 因子窗口 rd11~15；PIT 闸门（`dataThroughRelativeDay ≤ 0`，决策 bar = rd15） |
| **4** | **入场价格** | **rd16 `open`**（要求 `post[16].canBuyAtOpen = 1`）· `lotSize 100` · `priceType OPEN` · `quantityMethod TARGET_WEIGHT` | **`FROZEN`**（口径）+ **`INHERITED`**（`T_CLOSE → T_PLUS_1_OPEN` 时序与 `lotSize` / `priceType` / `quantityMethod` 逐字同模板） | P0-ORACLE-002；模板 `execution` |
| **5** | **排名因子** | 🔴 **待定** —— `maxAmp5`（dir **−1**）**或** `avgAmp5`（dir **−1**）· 横截面**分位排名升序取最低** | **`FROZEN`**（两因子证据充分）+ 🔴 **`BLOCKED`**（`KEEP = 暂不择一`） | `FACTOR-SELECT-001` |
| **6** | **TopN** | **3**（`method: {kind: topN, n: 3}` · `higherIsBetter: true`）· 破平键 `securityId` | **`FROZEN`**（全部轮次 Top3）+ **`INHERITED`**（模板同为 topN 3） | 模板 `recipe.selectionConfig` |
| **7** | **持仓 / 退出逻辑** | 🔴 **待定** —— **研究口径**：目标 **rd55**（F40）→ `canSellAtClose=1` 顺延 → **rd80 兜底**（无止损/无止盈/无 runner）<br>**模板口径**：6% 止损 + PEAK_DRAWDOWN 升级 + MA5/MA10 止盈 + strongHold 5→10 + runnerBridge 5→20 | **`FROZEN`**（研究）+ **`INHERITED`**（模板）⇒ 🔴 **二者冲突** | `LONG-BOUND-001`（≈40 日）vs 模板 `exit.rules[0].policy` |
| **8** | **仓位规则** | 🔴 **待定** —— **研究口径**：`MAX_CONC = ceil(1.5×3×40) = 180` · `w = 1/180` 恒定 · 每日先出后进 · 满仓跳过 · 同 symbol 不重复 · 现金不足跳过<br>**模板口径**：`maxPositions 5` · `positionRatio 0.2` · `maxSinglePosition 0.3` · `maxExposure 0.8` | **`FROZEN`**（研究）+ **`INHERITED`**（模板）⇒ 🔴 **二者冲突** | `NB-RANDOM-002` vs 模板 `position` |
| **9** | **交易成本** | **往返合计 20bps**（研究口径：每笔 `net = gross − 0.002`）<br>⚠️ 映射到平台：`commissionModel BPS` + `slippageModel BPS` **两段** ⇒ 需明确各段数值使**合计 = 20bps** | **`FROZEN`**（20bps 数值）+ **`INHERITED`**（模型字段名）+ **`NEW-DESIGN`**（**分段映射**） | P0-ORACLE-002；模板 `execution` |
| **10** | **无数据 / 不可交易处理** | **入场**：`canBuyAtOpen ≠ 1`、`open` 缺失或 ≤0、或 rd16 bar 缺失 ⇒ **跳过该笔，不补位**<br>**出场**：`canSellAtClose ≠ 1` ⇒ **顺延至下一可卖日**；至 **rd80 仍不可卖** ⇒ 按 rd80 `close` 强制结算<br>**停牌**：顺延（同模板约束）· **一字板**：不成交（同模板约束） | **`FROZEN`**（研究口径）+ **`INHERITED`**（模板 `executionConstraints` 两条） | P0-ORACLE-002；模板 `executionConstraints` |
| **11** | **回测起止范围** | **`2019-01-03 ~ 2025-09-26`**（`780004` 实际 `startDate` / `endDate`）<br>⚠️ **OOS / WFA 划分未定义** ⇒ 留给后续正式 Backtest 任务 | **`FROZEN`**（范围）+ 🔴 **`NEW-DESIGN`**（**未定**：OOS/WFA 切分） | Dataset `780004` 元数据 |

### 2.1 来源统计

| 来源 | 条目数 | 明细 |
|---|:---:|---|
| **`FROZEN`** | **10** | #1 池/事件 · #2 决策时点 · #3 信息边界 · #4 入场口径 · #5 因子（两候选均冻结）· #6 TopN · #7 研究退出 · #8 研究仓位 · #9 成本数值 · #10 异常处理 · #11 范围 |
| **`INHERITED`** | **6** | #1 事件类型 · #4 执行时序/lotSize/priceType/quantityMethod · #6 topN 3 · #7 模板退出策略 · #8 模板仓位 · #9 成本模型字段 · #10 两条执行约束 |
| **`NEW-DESIGN`** | **3** | ① **绑定 `780004`**（模板绑 `v7/750001`）② **成本分段映射**（20bps → commission + slippage）③ **OOS / WFA 划分（未定）** |

> ✅ **`NEW-DESIGN` 控制在 3 项**，且**无一项涉及因子/阈值/权重/TopN/持仓期的选择** ✓

---

## 3. 三尺度范围裁定（**为何第一版只含 EVENT_STATE_LONG**）

| 尺度 | 冻结角色（`FACTOR-TIMESCALE-FINAL-001`） | 可否进入第一版策略 |
|---|---|:---:|
| **LONG** | 股票池 / 长期排序（`LONG-4`）· 🔒 冻结 | ⚠️ **本研究族为 `EVENT_STATE_LONG`（T+15 决策），非 `LONG-4`（T=0 决策）** |
| **MEDIUM** | 独立中期相对强弱 / 减亏 · 🔒 冻结 · ⛔ **不与 LONG / SHORT 组合** | 🛑 **不可** |
| **SHORT** | 短期相对强弱 · 🟡 **仅登记角色，不进策略** | 🛑 **不可** |
| — | **🚫 不再进行 LONG × MEDIUM × SHORT 综合评分**（原则 §3-4） | 🛑 **不可组合** |

> ## 🔴 **⇒ 第一版策略【只能包含 `EVENT_STATE_LONG` 一个尺度】**，且**不能与 `LONG-4` 组合**（`ATTRIBUTION-001` 已证 LONG-4 在 T+15 无稳定增量）
> ## ⚠️ **⇒ 这与任务表述「将 SHORT / MEDIUM / EVENT_STATE_LONG 时间尺度研究转入第一版策略定义」存在【范围落差】** —— 已按冻结结论如实登记，未强行合并

---

## 4. 阻塞项与解除条件（**最小改动集**）

| # | 阻塞 | 解除条件（**需另行授权**） | 是否本任务可解 |
|---|---|---|:---:|
| **B1** | **因子非平台特征**（`maxAmp5`/`avgAmp5` rd11~15 无内置特征） | **新增两个 `FeatureDefinition`**（`EVENT_TO_CURRENT` 型 · `dataThroughRelativeDay = 0` · 决策 bar = rd15 · 读 rd11~15）⇒ **修改 `server/strategyCore/featureRegistry.ts`** | 🛑 **否**（任务禁止修改业务代码） |
| **B2** | **排名因子未定**（`KEEP = 暂不择一`） | 需**先明确研究目标偏好**（幅度优先 → `maxAmp5`；尾部/一致性优先 → `avgAmp5`）—— `FACTOR-SELECT-001` 已指出这是**唯一可解路径** | 🛑 **否**（属人为决策，需人类裁定） |
| **B3** | **仓位口径冲突**（研究 `MC=180` vs 模板 `maxPositions=5`） | 二选一：**(a)** 沿用研究口径 ⇒ `maxPositions = 180`（**无模板先例 · 无风险画像证据**）；**(b)** 继承模板 ⇒ **必须重跑 F40 口径下的仓位敏感性**（**即新研究**） | 🛑 **否** |
| **B4** | **退出逻辑冲突**（研究「固定 rd55」vs 模板「止损+止盈+runner」） | 二选一：**(a)** 沿用研究退出 ⇒ **模板的成熟风控全部弃用**；**(b)** 继承模板退出 ⇒ 🔴 **F40 的 ΔmExc / 贡献 / beat 证据【全部作废】**，需在模板退出逻辑下重测 | 🛑 **否** |
| **B5** | **三尺度不可组合** | 无解（**冻结原则**）⇒ **第一版策略仅含 `EVENT_STATE_LONG`** | 🛑 **否**（需接受范围收窄） |

**可在本任务内闭合、不构成阻塞的项**：

| 项 | Draft 取值 |
|---|---|
| Dataset 绑定 | **`780004`** |
| 回测范围 | **`2019-01-03 ~ 2025-09-26`** |
| 成本数值 | **往返 20bps** |
| 异常处理 | 跳过 / 顺延 / rd80 兜底 |
| TopN | **3** |
| 决策 / 入场 | **rd15 收盘 → rd16 `open`** |

---

## 5. NOT PROVEN

| # | 未证明 / 不能推出 | 说明 |
|---|---|---|
| **N1** | 🔴 **本 Draft 在平台正式口径下的任何绩效** | 全部证据为 **`NON-PLATFORM-FORMAL-RUN`** harness 结果；**从未经过 platform formal Run** |
| **N2** | 🔴 **研究口径 ↔ 平台模板口径的可迁移性** | 仓位（B3）与退出（B4）两处口径不同 ⇒ **迁移后绩效未知** |
| **N3** | ❌ **`maxAmp5` vs `avgAmp5` 的择优** | `FACTOR-SELECT-001` 裁定 **暂不择一**；本轮**未重新裁定** |
| **N4** | ❌ **OOS / WFA 划分** | **未定义**（留给后续任务） |
| **N5** | ❌ **风险画像**（`maxDrawdown` / `maxExposure` / `maxSinglePosition`） | 研究口径**无对应参数**；模板值**未经本研究验证** |
| **N6** | ❌ **冲击成本 / 容量** | 仅 20bps 固定成本；`IMPACT-CAPACITY-001` 的容量结论**仅覆盖 10万~500万 资金区间** |
| **N7** | ❌ **`MAX_CONC = 180` 的饱和检验** | 固定公式仅在 F20/F40 验证过（`LONG-BOUND-001` N5） |
| **N8** | ❌ **年度指标口径缺陷的影响** | `EQSTART-ATTRIBUTION-001` / `YEAR-END-MTM-001` 登记的 **(A) 年度切分口径缺陷**（遗漏每年首日 P&L，水平偏差 +0.34%~+1.40%）**尚未修复** |
| **N9** | ❌ **任何策略可交易性 / 收益承诺** | 本轮为**定义文档**；**未创建 Candidate / Version** |
| **N10** | ❌ **可外推** | 仅 `780004`、仅首板回踩候选宇宙、仅 Top3 |

---

## 6. FINAL VERDICT

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                                      │
│                              ##  B. BLOCKED                                                           │
│                                                                                                      │
│  **阻塞项（5）**：B1 因子非平台特征 · B2 排名因子未定 · B3 仓位口径冲突 · B4 退出逻辑冲突 · B5 三尺度不可组合 │
│                                                                                                      │
│  **⇒ 当前【不可】进入正式 Backtest / OOS / WFA**                                                        │
│                                                                                                      │
│  📌 **但 Draft 规格已【完整】（§2 的 11 项全部有值或已明确标注「待定」）**                                    │
│     · `FROZEN` **10** 项 · `INHERITED` **6** 项 · `NEW-DESIGN` **3** 项（**无一项涉及因子/阈值/权重/TopN/持仓期选择**）│
│     · 解除阻塞所需的**最小改动集**已在 §4 逐项列出                                                        │
│                                                                                                      │
│  🔴 **最关键的单一阻塞**：**B1** —— `maxAmp5`/`avgAmp5` 在平台 **无对应特征**，                          │
│     且内置 `rollingMaxAmplitude` **硬编码 `relativeDay <= 5`** ⇒ **必须新增特征定义方能落库**              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. 限制与合规声明

### 🔴 `NON-PLATFORM-FORMAL-RUN`
| 层 | 状态 |
|---|---|
| **real DB data** | ✅ 只读（`780004` 元数据 + 模板 golden 读取）；**本轮未新增 DB 查询** |
| **same compiled TS metric code** | ❌ 未调用（本轮为**定义设计**，未跑任何回测） |
| **platform persisted Run** | ❌ 未发生 |

### 严格禁止项（本轮全部遵守）
✅ **未新增因子** · ✅ **未修改冻结因子定义** · ✅ **未做 F80** · ✅ **未重新研究 LONG-4** · ✅ **未做权重搜索 / TopN 搜索 / 阈值搜索 / 持仓期搜索** · ✅ **未创建 Candidate / Strategy Version** · ✅ **未修改业务代码**（含 `featureRegistry.ts` —— 仅**只读**检查）· ✅ **未修改 Schema / Migration / Dataset** · ✅ **未写数据库** · ✅ **未进入 Backtest / OOS / WFA** · ✅ **未继续做新的因子研究** · ✅ 工作区**无新增 harness**（纯文档任务）

---

## 8. 修改文件清单

| # | 文件 | 变更 |
|---|---|---|
| 1 | `docs/research/RESULT-STRATEGY-DRAFT-001.md` | **新增**（本报告） |
| 2 | `docs/architecture/CHANGE-AUDIT.md` | **追加**本轮审计条目 |

**未改动**：业务 `.ts` · DB / Schema / Migration · Dataset · 已有因子定义 · `ROADMAP.md` · 既有报告 · 既有 harness · **本轮无新增 harness**

## 9. 后续建议（**仅建议，本任务在此停止**）

| 优先级 | 建议 | 理由 |
|---|---|---|
| 🔴 **P0** | **B1 解除**：新增 `maxAmp5` / `avgAmp5` 两个 `FeatureDefinition`（`EVENT_TO_CURRENT` · `dataThroughRelativeDay = 0` · 决策 bar = rd15） | **唯一使策略可落库的前提**（需修改 `featureRegistry.ts` ⇒ **需另行授权**） |
| 🔴 **P0** | **B2 解除**：明确研究目标偏好（幅度优先 / 尾部一致优先） | `FACTOR-SELECT-001` 已指出这是唯一可解路径 |
| 🟠 **P1** | **B3 / B4 解除**：裁定「研究口径」优先还是「模板口径」优先；若选模板 ⇒ **需在新口径下重测绩效** | 二者不可兼得 |
| 🟠 **P1** | **B5 接受范围收窄**：第一版仅 `EVENT_STATE_LONG` | 冻结原则禁止三尺度组合 |
| 🟡 **P2** | **OOS / WFA 划分**与**(A) 年度口径缺陷**修复 | 影响正式验收 |
| 🛑 **STOP** | Backtest / OOS / WFA / Candidate 创建 | 按任务约束 |

---

## 10. 一句话结论

> ## **第一版策略 Draft 规格已完成（11 项，`FROZEN` 10 / `INHERITED` 6 / `NEW-DESIGN` 3），但裁定 `B. BLOCKED`：`maxAmp5`/`avgAmp5`（rd11~15）在平台 **无对应特征**（内置 `rollingMaxAmplitude` 硬编码 `relativeDay ≤ 5`）· 排名因子 **`KEEP=暂不择一`** · 仓位口径（`MC=180` vs `maxPositions=5`）与退出逻辑（固定 rd55 vs 止损+止盈+runner）**均与模板冲突** · 且冻结原则**禁止三尺度组合** ⇒ **第一版策略只能含 `EVENT_STATE_LONG`**。**
> ## **⇒ 解除阻塞的【最小改动集】已在 §4 逐项列出；本任务在此停止，未进入 Backtest / OOS / WFA，未创建 Candidate / Version。**

**本任务完成，在此停止。**