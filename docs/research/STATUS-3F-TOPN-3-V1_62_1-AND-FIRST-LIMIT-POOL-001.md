# 3F Top3 v1.62.1 与「首板股票池」现状报告

> 生成日期：**2026-10-01**（Asia/Shanghai）。
> 证据来源：仓库内已留档文档（`docs/research/*`、`ROADMAP-CHANGELOG.md`、源码注册表）+ 对真实库（TiDB）的**只读**实查。
> 本报告**只做现状陈述**，不写入任何库内数据、不推进任何版本状态、不下「能否上线」结论。

---

## 0. TL;DR

| 对象 | 一句话现状 |
| --- | --- |
| `first-limit-pullback-3f-top3@1.62.1` | **当前全窗口探索的最优 3F 组合**（2019-01-01~2026-09-04 累计 **+57.73%**、最大回撤 **47.96%**），但只是**样本内全窗口探索结果**，尚未做 OOS / Walk-Forward / 成本压力 / 阈值稳健性，库内状态仍是 **Draft**。 |
| 「首板股票池」概念 | 概念、策略文档、数据（v6）、流式装配、ST 排除、再入场三旋钮、覆盖广度诊断**均已落地并跑通链路**；但**主研究结论是失败的**——2019–2024 rolling-pool 长窗口 **-55.18% / 回撤 67.92%**，远低于 v1.62.1 基线，**不得执行 2025–2026 留出验证、不得推进 Candidate/Production**。当前只剩「归因 + 稳健性澄清」。 |

一句话总结：**v1.62.1 是「已跑出来的最好数字」，股票池是「已接通但结论为负的新机制」。**

---

## 一、3F Top3 v1.62.1 现状

### 1.1 身份

| 项 | 值 |
| --- | --- |
| 策略 id | `first-limit-pullback-3f-top3` |
| 版本 | `1.62.1` |
| 名称 | 首板回踩 · 3F 综合评分 Top3 |
| 模式族 | `c6-b4-14-best-combination`（c6+b4-14 当前最佳组合族） |
| 族内 arm | `c6b4-14`（`c6-b4-max-amp-14`） |
| 谱系父版本 | `1.59.6`（c6+b4） |
| 策略类型 | `THREE_FACTOR_TOPN` |

### 1.2 策略配置（库内 `strategy_versions#2850009.strategyDocumentJson` 实读）

- **因子**：3F 等权合成分 = `maxAmplitude`(LOW) + `meanAmplitude`(LOW) + `t1VolumeRatio`(HIGH)。
- **排名**：决策日按合成分降序，**取前 3 名**（TopN=3）。
- **决策/执行**：观察窗口 `rd ∈ [5, 15]`（`start=5` 是唯一语义端；`end=15` 仅决定读面板深度）→ **T+5 收盘出信号 → T+6 开盘成交**（`signalTiming=T_CLOSE` / `executionTiming=T_PLUS_1_OPEN`）。
- **入场资格**：保留首板回踩门槛（`requirePullback=true`）+ 排除 T 日一字板 / T 字板（`open<high`）。
- **入场风险过滤**：观察窗 **最大振幅 < 14%**（本版本的唯一新维度）。
- **仓位**：`EQUITY_RATIO` 分层——**高分 ≥0.7167 → 25% / 中分 0.55~0.7167 → 20% / 低分 <0.55 → 5%**；最大持仓 5、单日最多买 2。
- **退出**（沿用统一 exitPolicy，池化族也复用这一套）：
  - 止损：固定 **-6%**，盘中确认；
  - 峰值回撤止盈：盈利 3% 激活、从峰值回撤 **8%**；
  - 强持有：持有满 5 日且满足（收益 ≥3% 且站上 MA5/MA10）→ 延长至 10 日；
  - 时间退出：持有满 5 个交易日；
  - `candidateExitPolicy=DISABLED`（评分不触发卖出）。
- **成本**：佣金 2.5bps、最低 5 元、滑点 5bps、印花税 5bps（卖出）、过户费 0.1bps、整手 100 股。
- **数据坐标**：`first_limit_pullback` **v5**（`datasetVersionId=660001`）。

### 1.3 回测结果（全窗口，库内留档 `closed_loop_backtest_run#2880001`）

| 指标 | 值 |
| --- | ---: |
| 窗口 | 2019-01-01 ~ 2026-09-04 |
| runId | `clrun-3f-top3-v5-v1_62_1-c6-b4-max-amp-14-20260927` |
| 状态 | `ALL_EXECUTED`（5 阶段执行 / 0 阻塞 / 9 跳过） |
| 期末权益 | 157,733.04（初始 100,000） |
| **累计收益** | **+57.73%** |
| **最大回撤** | **47.96%** |
| CAGR | 6.36% |
| Profit Factor | 1.1366 |
| 夏普 / 索提诺 / 卡玛 | 0.3804 / 0.5509 / 0.1326 |
| 成交 | 1,359 笔（研究口径「完成交易」1,354 笔） |
| 覆盖广度 | 成交个股 1,004 只、重复交易 355 笔（26.12%）、单票最多 6 次、同代码并发对 2、立即买回 3 次 |

### 1.4 版本演进背景（它是怎么来的）

1. 起点对照 `v1.44.1`（+27.96% / 回撤 51.68% / PF 1.0909）。
2. B 组绝对风险过滤：只有 **b4「最大振幅 <12%」** 优于对照（+30.21%）。
3. C 组分档仓位：**c6「高25/中20/低5」** 最优（+42.24%）。
4. 组合 **c6+b4**（+46.74%）→ 振幅阈值搜索发现 **0.14 为区间最优**（0.12→0.14 收益 +46.74%→+57.73%、回撤再降 1.76pp）→ 转正为 **1.62.1**。
5. 后续 c7/c8/c9（低分档归零）**全部负优化**，结论是保持 c6 档位不动。

### 1.5 🔴 现状风险与边界（必须写清）

- **只是样本内全窗口探索结果**：2019–2026 同时被用于选择 arm、阈值与档位；**未做 OOS / Walk-Forward / 过拟合检测 / 2 倍成本压力**。
- **阈值不稳健**：`maxMaxAmplitude` 搜索**非单调**，0.11→0.12 出现 **+2.24% → +46.74%** 的断点；0.14 是该区间最优但属「尖峰型」最优，跨样本很可能塌陷。研究侧注解明确要求：「转入正式候选前必须完成 OOS、walk-forward、成本扰动和阈值敏感性验证」。
- **回撤极大**：最大回撤 **47.96%**，卡玛仅 0.1326，风险端没有任何缓冲。
- **库内状态 = Draft**：`strategy_versions#2850009.status = Draft`，`strategies#1140001.currentVersionId = 2850009`、`latestVersion = 1.62.1`，**未进入 Candidate/Production**，也无 2025–2026 留出验证留档。
- **它当前的角色是「基线」**：3F 事件窗族与股票池族都把 v1.62.1 当作 `baseVersion`（`strategyFamilyRegistry.ts`）。

---

## 二、「首板股票池」概念现状

### 2.1 概念定义（已写进版本快照的语义）

> 首板（`FIRST_LIMIT_UP`）**事件日 T 入池** → **T+1 起每个交易日滚动评分**（滚动 3F）→
> **低于最低分 / 连续不可评分 / 达到池龄上限 / 硬资格破坏时移出** →
> 每个有效决策日在池内按分排序取 TopN 买入 → **评分只影响买入，不影响退出**（退出沿用 v1.62.1 统一 exitPolicy）。

与 v1.62.1 的**四点关键差异**（`firstLimitPoolDailyScore.ts` 文件头）：
1. 事件窗触发 → **池化逐日触发**；
2. 固定 T+5 的 3F → **逐 N 校准的滚动 3F**；
3. **移除回踩资格门槛**；
4. T+1..T+5 最大振幅 → **当日可见窗口的滚动最大振幅**。

### 2.2 默认参数（`FirstLimitPoolDefinition`）

| 项 | 默认值 |
| --- | ---: |
| TopN / 最大持仓 / 单日最多买入 | 3 / 5 / 2 |
| 池龄上限 | 60 个交易日 |
| 最低分（移池线） | 0.55 |
| 滚动最大振幅上限 | 14% |
| 连续不可评分失效 | 3 个交易日 |
| 首次评分日 / 评分窗口 | T+1 / 5 日（满窗后固定） |
| 退出尾部数据 | 20 个交易日 |
| 板块范围 | `["main"]`（主板，对齐 v5 正式 universe） |
| 排除 ST | 默认 `true`（PIT：事件日 + 池期逐日） |
| 面板预算 | 1 万成员 / 160 万行（超限稳定失败，不静默截断） |
| 评分影响退出 | 恒 `false` |

### 2.3 已落地的实现面

**策略与数据层**
- 策略类型 `FIRST_LIMIT_POOL_ROLLING_3F`，策略族「首板股票池 · 滚动 3F」（`strategyFamilyRegistry.ts`）。
- tRPC 配置接口 + 前端「模式族配置」区已实现。
- 池化流式日游标（`ResearchDatasetCursor`）：research / backtest **不再要求一次性物化完整池化面板**；research 期间按候选身份保留 retained rows，backtest 直接复用（修复了「restart 后读不到行」的数据源漂移）。
- `first_limit_pullback` **v6** 数据集已完成并 READY：`datasetVersionId=720001`，`postWindowDays=80`，**102,878 个事件**。
- 板块过滤在身份解析前生效（严格对齐 v5 universe）。

**近两轮新增（2026-09-30 ~ 10-01 的提交）**
- **ST 永久排除（PIT）**：新增 `poolStIndex`（`research_security_status_history` 区间索引）——事件日 ST 不入池、池期内转 ST 当日移池、池行写真实 PIT 值；统计入 research 审计（ST 事件排除数 / ST 移池数）。
- **再入场三旋钮**（`definition.firstLimitPool.reentryPolicy`，只约束新建仓、不影响退出与已持仓）：
  - `securityCooldownTradingDays`（同代码出场后 K 日冷却）
  - `maxEntriesPerMember`（同一成员累计买入次数上限，1 = 一次性）
  - `maxConcurrentOpenPerCode`（同代码并发在仓上限）
  - 未声明该字段时，文档指纹 / 回测指纹 / skip 账目**逐字节不变**。
- **覆盖广度诊断**（`breadthMetrics`）：覆盖个股 / 重复占比 / 单票最多 / 同代码并发 / 最长买回链 / 立即买回 / 再入场间隔；只写 `summaryJson`，已接 DTO / 目录投影 / 对比页 / 详情面板。
- **快照导出页大小覆盖 + 内容来源审计**（最新提交 `f19ec31`，改 `snapshot/exporter.ts` 等）。

**库内版本（均 `Draft`）**
| id | strategyId | version | datasetVersion | codeVersion |
| ---: | --- | --- | --- | --- |
| 2880001 | `first-limit-pool-daily-score` | 1.0.0 | v5 | `first-limit-pool-daily-score-20260929` |
| 3090001 | `first-limit-pool-rolling-3f-top3` | 1.0.0 | v6（720001） | `first-limit-pool-rolling-3f-20260930` |

### 2.4 研究结果现状

**短窗冒烟（链路验证，不构成结论）——全部 `ALL_EXECUTED`**

| 臂 | 窗口 | 累计收益 | 回撤 | 成交 | 留档 |
| --- | --- | ---: | ---: | ---: | ---: |
| baseline（同数据集 v1.62.1 配置） | 2025Q1 | +13.67% | 5.75% | 49 | #2940007 |
| no-pullback-event | 2025Q1 | +10.62% | 5.59% | 46 | #3030001 |
| fixed-pool | 2025Q1 | +8.26% | 0.77% | 8 | #2940003 |
| calibrated-event | 2025Q1 | -0.77% | 1.44% | 5 | #2940004 |
| **rolling-pool（主策略）** | 2025Q1 | **-7.35%** | 9.96% | 47 | #2970001 |

**长窗口主研究（2019-01-01 ~ 2024-12-31）——未通过**

| 臂 | 累计收益 | 最大回撤 | 成交 | 留档 |
| --- | ---: | ---: | ---: | ---: |
| **rolling-pool（主策略）** | **-55.18%** | **67.92%** | 996 | #3120001 |
| rolling-pool-oneshot（成员限 1 次） | -21.56% | 29.91% | 178 | #3150001 |
| rolling-pool-cooldown-5 | -52.93% | 62.29% | 509 | #3180001 |
| rolling-pool-cooldown-10 | -39.40% | 49.38% | 396 | #3180002 |
| rolling-pool-cooldown-20 | -40.27% | 43.43% | 311 | #3210001 |

**结论（研究侧已冻结）**：主策略结果**远低于 v1.62.1 基线**且回撤远超转正门槛 ⇒
**不得推进 Candidate/Production，也不得执行 2025–2026 留出验证**；下一步**只做归因 / 参数稳健性澄清**。
再入场三旋钮的初步证据也显示：**单靠限制再入场无法救活**（4 个诊断臂全部为负，最好的 oneshot 仍 -21.56%）。

### 2.5 未完成 / 待澄清

- **转正门槛**（`PLAN-FIRST-LIMIT-POOL-ROLLING-3F-001.md`）：留出段优于 v1.62.1、回撤恶化 ≤5pp、Calmar 不降、邻域不翻负且 ≥4/6 年份为正、2 倍成本不亏——**目前一条都没验证（也尚不该验证）**。
- **再入场诊断仍有 3 个臂未跑**：脚本已声明 `rolling-pool-cooldown-20-oneshot`、`rolling-pool-single-position`、`rolling-pool-clean`，但库内（截至实查时 `closed_loop_backtest_run` max id = 3210001）**尚无留档**。
- **再入场三旋钮尚未进「模式族配置」参数面**：`ROLLING_POOL_PARAMETERS` 未暴露这三个参数，前端目前只能通过脚本 / 研究臂使用（server 层已贯通）。
- **归因缺失**：为什么池化在长窗口是灾难，目前只有「再入场」这一条线索，尚未形成归因结论。
- 同窗口 baseline 全量重跑曾遇到装配阶段 `ECONNRESET`（`index_daily` 查询）中断，**不能把中断当结果**。

---

## 三、两者关系与建议

- **v1.62.1 是基线，不是候选**：它是全窗口最优，但缺 OOS/稳健性；把它当「已证明的好策略」会犯样本内过拟合的错误。
- **股票池是对 v1.62.1 的机制性改造**：把「T+5 一次性事件窗」改成「60 日滚动池 + 逐日评分」，共享同一套退出与仓位配置。改造后**收益腰斩为负**，说明**「3F 分数在池内长期滚动」这一前提目前不成立**。
- **建议优先级**：
  1. 先做 v1.62.1 的 **OOS / WFA / 成本扰动 / 阈值敏感性**，把它从「样本内最优」升级为「可判定的基线」；
  2. 股票池只保留**归因**工作（拆解池化 vs 事件窗、滚动评分 vs 固定 T+5、再入场 vs 首次入场），**不要**在未归因前扩参数或做留出；
  3. 归因若无法解释 -55% 的来源，应明确将「滚动池化」标记为**未通过研究**并归档结论。

---

## 附：证据索引

- 概念与规格：`docs/research/PLAN-FIRST-LIMIT-POOL-ROLLING-3F-001.md`
- 流式闭环 + 长窗口：`docs/research/RESULT-FIRST-LIMIT-POOL-STREAMING-001.md`
- 短窗冒烟：`docs/research/RESULT-FIRST-LIMIT-POOL-SMOKE-001.md`
- 3F 入场研究（含 v1.62.1 来源）：`docs/research/RESULT-3F-TOPN-ENTRY-STRATEGIES-001.md`
- 谱系：`server/research/patternLibrary/threeFactorTopNVersionLineage.ts`
- 族定义：`server/research/patternLibrary/threeFactorTopNFamilies.ts`、`server/research/strategyFamilyRegistry.ts`
- 池化文档构造：`server/research/patternLibrary/firstLimitPoolDailyScore.ts`
- 再入场诊断臂：`scripts/runFirstLimitPoolRollingStudy.mts`
- 库内实查：`strategy_versions#2850009 / #2880001 / #3090001`、`closed_loop_backtest_run#2880001 / #3120001 / #3150001 / #3180001 / #3180002 / #3210001`
