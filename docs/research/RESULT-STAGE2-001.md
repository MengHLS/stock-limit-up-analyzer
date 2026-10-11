# RESULT-STAGE2-001 · 阶段 2 完成：正式 Strategy Version 已形成并核验（Goal round 6）

> Goal：`Event-State Long Alpha → 可交易策略` · **阶段 2 = 确定主策略 + 形成正式 Strategy Version + 保留完整基准结果**
> 🔴 **本次为【正式生产写入】**（经 Goal 明确授权：「OOS/WFA 通过后，确定主策略并形成正式 Strategy Version」）
> Dataset **`780004`** · HEAD **`f8b6810`** · 日期 **2026-10-09**

---

## 0. 阶段 2 裁定

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **阶段 2 完成** —— 主策略已形成为【正式 Strategy Version】并经 DB 权威核验                            │
│                                                                                                      │
│   strategy_versions 行 : id=**3600006** · strategyId=**event-state-long-maxamp5-top3** · version=1.0.0 │
│                          status=**Validated** · datasetVersionId=**780004**                            │
│                          fingerprint=**7e863012181ff0e9a85a0e257b0b4d2a66a447acf16386e287f4fb22666a1cba**│
│                          codeVersion=1.0.0+gunknown · createdAt=2026-10-09 09:41:14                    │
│   strategies 主表      : id=**1770005** · name="EVENT_STATE_LONG · maxAmp5 · Top3 · hold40"            │
│                          status=**Validated** · latestVersion=1.0.0 · currentVersionId=**3600006**     │
│   strategy_versions 总数: **178 → 179** ✓                                                             │
│                                                                                                      │
│  ⇒ **满足进入阶段 3 的条件**（策略优化：建仓仓位 / 总仓位 / 入场时点 / 持仓退出机制 / 市场状态适应）           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT · 正式 Strategy Version（**DB 权威核验**）

### 1.1 版本行

| 列 | 值 |
|---|---|
| `id` | **3600006** |
| `strategyId` | **`event-state-long-maxamp5-top3`** |
| `version` | **`1.0.0`** |
| **`status`** | **`Validated`** |
| **`datasetVersionId`** | **`780004`** |
| **`fingerprint`** | **`7e863012181ff0e9a85a0e257b0b4d2a66a447acf16386e287f4fb22666a1cba`** |
| `codeVersion` | `1.0.0+gunknown` |
| `createdAt` | `2026-10-09 09:41:14` |

### 1.2 策略主表

| 列 | 值 |
|---|---|
| `id` | **1770005** |
| `strategyId` | `event-state-long-maxamp5-top3` |
| `name` | `EVENT_STATE_LONG · maxAmp5 · Top3 · hold40` |
| **`status`** | **`Validated`** |
| `latestVersion` / `currentVersionId` | `1.0.0` / **3600006** |

### 1.3 转正后复核（端口 `inspectVersion` 输出）

```json
{"versionRowId":3600006,
 "fingerprint":"7e863012181ff0e9a85a0e257b0b4d2a66a447acf16386e287f4fb22666a1cba",
 "hasDefinition":true,
 "datasetBindingCount":1,
 "universeId":"research-dataset:v10-listed365-pre10-post80",
 "datasetVersionId":780004,
 "status":"Validated"}
```

⇒ ✅ `hasDefinition = true`（canonical 定义随版本落库）· ✅ `datasetBindingCount = 1` · ✅ `datasetVersionId = 780004` 与 PRIMARY 绑定一致

### 1.4 转正路径（**正式端口，无裸写**）

```
createStrategyPromotionPort({ codeVersion, now })
  → findVersion(strategyId, version)            // 幂等闸门：落库前 = (不存在)
  → createStrategyVersion(input)                // → StrategyService.create
      → StrategyRepository.saveVersion          // 同事务 5 投影 + Dataset Binding 校验
  → inspectVersion(strategyId, version)         // 转正后复核
```
依据 `server/research/strategyCandidate/strategyPromotionPort.ts`（文件头：「本文件**不**出现任何 `INSERT strategy_versions` 之类的裸写」）

### 1.5 状态迁移（**唯一允许的 UPDATE**）

```
Draft → Validated
```
依据 `StrategyService.setVersionStatus`（`strategyPersistence/service.ts` L373-374）：
> 「版本生命周期状态迁移（**唯一允许的 UPDATE**；内容仍不可变）」

八态 = `Draft / Research / Candidate / Validated / Paper / Approved / Production / Retired`
**语义依据**：**OOS/WFA 已 PASS**（`RESULT-OOS-WFA-001`）⇒ 定义经样本外验证 ⇒ **`Validated`**；尚未 Paper / Approved / Production。

### 1.6 提交的 canonical 内容（摘要）

| 项 | 值 |
|---|---|
| `schemaVersion` | `1.0` |
| 数据集 | `first_limit_pullback` · `v10-listed365-pre10-post80` · `datasetVersionId 780004` · `PRIMARY` |
| 观察窗 | `{ start: 15, end: 15, unit: "TRADING_DAY" }`（决策日 rd15） |
| 出场 | `TIME_EXIT` · `trigger ON_CLOSE` · `threshold 40` · `TRADING_DAY`（**无 `policy` 对象**） |
| 仓位 | `EQUAL_WEIGHT` · `maxPositions 180` · `maxExposure 1` · `maxSinglePosition 1/180` |
| 执行 | `signalTiming T_CLOSE` → `executionTiming T_PLUS_1_OPEN` · `priceType OPEN` · `lotSize 100` |
| `recipe` | `kind signalEngine` · `recipeId event-state-long-amp5-top3` · `point close` · `signalFrequency daily` · `featureVersions [{maxAmp5, 1.0.0}]` · `rankingConfig {higherIsBetter:false}` · `selectionConfig topN n=3` · **`requiredData ["OHLCV"]`** |
| `executionAssumptions` | `backtestConfig {initialCapital 1,000,000, maxPositions 180}` · `costModel {commission 0.00025, stampDuty 0, transferFee 0, slippageBps 7.5, lotSize 100, minCommission 0}` |
| 文档 5 投影 | `entryRules` · `exitRules` · `riskRules` · `positionSizing` · `parameters` **全部组装成功** |

---

## 2. 完整基准结果（**保留 · 采用修正后数值**）

> 同区间 **`2019-01-03 ~ 2026-01-28`**（各 **1,716** 交易日）· 年度 **(B) 严格口径** · 成本 **往返 20bps**
> 🔴 数值取自 `RESULT-OOS-WFA-002`（**已修正** MDD 公式错误与 `dateRange` 截断伪影）

| 项 | **`maxAmp5`（主策略）** | `avgAmp5` | **沪深300** |
|---|---:|---:|---:|
| **TOTAL** | **+53.88%** | +43.68% | **+59.13%** |
| **MDD** | **−18.08%** | −18.53% | **−45.60%** |
| TOTAL ÷ \|MDD\|（**非年化，仅指示**） | **2.98** | 2.36 | 1.30 |
| **正年份** | **7/7** | 6/7 | 6/8 |
| 2019 / 2020 | +4.05% / +8.76% | +3.90% / +9.41% | +38.17% / +27.21% |
| 2021 / 2022 / 2023 | **+11.42% / +0.67% / +1.58%** | +8.15% / −1.23% / +2.54% | −5.20% / −21.63% / −11.38% |
| 2024 / 2025 | +8.21% / +9.94% | +6.25% / +8.56% | +14.68% / +17.66% |
| `trades` / `winRate` | 4,811 / 46.1% | 4,838 / 45.4% | — |
| `holdAvg` | **41.01** | 40.94 | — |

### 2.1 分段 / OOS / WFA（`RESULT-OOS-WFA-001`）

| 段 | 基准 TOTAL | **`maxAmp5`** TOTAL / excess |
|---|---|---|
| S1 牛市（2019-01-03~2020-12-31） | +75.77% | +13.16% / **−62.61pp** |
| S2 熊市（2021-01-04~2023-12-29） | **−34.87%** | **+13.06%** / **+47.92pp** |
| **S3（OOS）**（2024-01-02~2026-01-28） | +39.32% | **+18.99%** / −20.33pp |

**判定**：**OOS `PASS`**（P1/P2/P3/P5 ✅ · **P4 = N/A**）· **WFA `PASS`**（W-a ✅ 4/4 · **W-b ✅ 2/2 熊市段跑赢** · W-c ✅）

### 2.2 🔴 必须随基准结果一并声明的限定

| # | 限定 |
|---|---|
| **L-a** | **S3 内基准无下跌年份 ⇒ P4 = N/A** ⇒ OOS 留出段**未能独立验证**熊市防御 |
| **L-b** | **绝对收益跑输基准 5.25pp**；价值主张 = **熊市防御 + 更浅回撤（浅 27.52pp）** |
| **L-c** | 因子发现用 2019-2025 全区间 ⇒ **非严格「未见数据」OOS** |
| **L-d** | 无可拟合参数 ⇒ WFA 为滚动窗口表现聚合 |
| **L-e** | **D1**：`TIME_EXIT` 收盘触发 → **次日开盘成交**（`holdAvg 41.01` 实测）⇒ 与研究的 rd55 `close` 出场**差 1 日** |
| **L-f** | **mark-to-market** 口径（末端未平仓 1/3 笔 ⇒ 影响极小） |
| **L-g** | 版本行 `fingerprint` = **文档指纹**；`loadVersion` 返回的指纹不同（见 §3 N3） |

---

## 3. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | ⚠️ **P4 未获独立验证**（S3 内基准无下跌年份） |
| **N2** | ⚠️ **风险调整指标**（Sharpe / Calmar / 信息比率）与**统计显著性**（t 检验）**未做** |
| **N3** | 🔴 **`loadVersion` 返回的指纹（`3eefde7a…`）≠ 版本行 `fingerprint`（`7e863012…`）** —— **未查证**（疑为文档指纹 vs 定义指纹之别；`researchEvidence.ts` L17 称「`strategy_versions.fingerprint` = `computeDefinitionFingerprint(definition)`」） |
| **N4** | ⚠️ **Dataset Binding 投影表名未定位**（端口报 `datasetBindingCount = 1`，但 `LIKE '%binding%'` 查无表）—— **未查证** |
| **N5** | ⚠️ **`avgAmp5` 未落库**（仅主策略落库；备选 Variant 保留为研究记录） |
| **N6** | ⚠️ 与研究 harness 的**逐笔等价性**未验证 |
| **N7** | ❌ 成本 / 容量 / 滑点 / 资金规模（**阶段 4**） |
| **N8** | ❌ 冲击成本 · `(A) 年度口径缺陷` 独立复核 |

---

## 4. 合规声明

| 项 | 状态 |
|---|:---:|
| 业务代码改动 | ✅ **零** |
| **数据库写入** | 🔴 **本次为授权写入**（Goal 明确要求「形成正式 Strategy Version」）—— **仅 2 类**：① `strategy_versions` +1 行（含 5 投影，同事务）② 该行 `status` 迁移 `Draft → Validated`（**唯一允许的 UPDATE**） |
| 修改既有行 / 删除 | ✅ **零**（`strategyId` 为新占用；幂等闸门确认落库前不存在） |
| 未调因子 / TopN / 仓位 / 持仓期 / 参数 | ✅ |
| 未做参数暴力搜索 | ✅ |
| 未为通过门槛而修改研究口径 | ✅ |
| Schema / Migration / 既有策略（3570001 等） | ✅ **未触碰** |

---

## 5. 阶段 3 目标（**Goal 原则 3**）

```text
阶段 3 = 策略优化 —— 重点研究：
  · 实际建仓仓位（当前 w = 1/180 恒定；是否应随信号强度/波动分层）
  · 总仓位（当前无总仓位择时；是否应引入市场状态调节）
  · 入场时点（当前 rd16 开盘；是否 rd15 收盘更优）
  · 实际持仓 / 退出机制（当前固定 40 日；是否应加止损/移动止盈/强势持有）
  · 市场状态适应（Alpha 来源 = 熊市防御 ⇒ 是否应显式识别并调整暴露）

🔴 纪律（Goal 原则 6）：所有优化必须建立在【已通过 OOS/WFA 的冻结基准】之上；
   禁止参数暴力搜索；每项优化须单独登记改动前后的对照，不得同时改多项。
🔴 基准（不可移动）：主策略 `event-state-long-maxamp5-top3@1.0.0`
   （`strategy_versions.id = 3600006` · fingerprint `7e863012…66a1cba` · status `Validated`）
```

---

## 6. 下一步（**Goal 保持 active**）

```text
1. 查证 N3（指纹差异）与 N4（Binding 表名）—— 阶段 2 收尾的完整性
2. 【阶段 3】策略优化（按 §5 的五项，逐项单变量推进）
3. 【阶段 4】成本 / 容量 / 滑点 / 资金规模 ⇒ 真实可交易性
```

**本轮在此停止，Goal 继续。**