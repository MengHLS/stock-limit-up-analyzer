# AUDIT-COMBO-BT-EXP-001 · 组合回测「原始策略」独立实验化 · 现状审计

> 审计日期：2026-09-24（工作区 clean，HEAD = `0cc303b`）
> 审计范围：把 `/backtest` 组合回测里的「原始策略」搬进 `research-experiments/` 之前，**现有代码到底已做到哪一步、差在哪**。
> 方法：读源码 + 直连库实测（`dataset_version` 表）+ 派探子交叉审计；**零代码改动**。
> 配套方案：`docs/research/PLAN-COMBO-BT-EXP-001.md`

---

## 0. 结论摘要（先看这段）

| # | 结论 | 证据 |
|---|---|---|
| 1 | 🔴 **「原始策略」不是 `leader-candidate-baseline`**。「原始策略」= 五策略面板里的 `baseline`（`server/downsideRisk.ts:785`，label 字面就是「原始策略」），跑的是 **research-legacy 模拟器**（`simulateRealisticTPlus1ToTPlus2`）。而 `leader-candidate-baseline` 是**生产 Strategy Engine** 的策略，语义是 hold-while-selected，**与 legacy 明确不等价**（`server/research/legacyTransactionSimulator.ts:17-27`，且有 `engineNonEquivalence.test.ts` 钉死）。现有实验名叫 `leader-candidate-baseline`，**名字指向的是另一个东西**。 | 见 §1 |
| 2 | ✅ **骨架已经建好了，不是从零开始**：实验目录四件套齐全、`manifest.ts` 已注册、前端 `pages.ts` 已注册、单测已存在、数据集 `combo-v1` 已构建且 `READY`。 | 见 §2 |
| 3 | 🔴 **它是「重写」不是「复刻」**：实验在 Experiment 层**重新实现**了评分与撮合，与服务端口径存在 **8 处已核实差异**（准入门槛、连板数、滑点、最低佣金、分仓分母、开盘门槛基准价、停牌/复牌、schema 自述），⇒ **现在跑出来的数字与 `/backtest` 的原始策略不可比**。不先做等价性对拍就直接做研究分析，结论没有锚。 | 见 §3 |
| 4 | 🔴 **`parameters: []` ⇒ 做不了任何参数研究**。所有口径硬编码在 `experiment.ts` 里（阈值 65、持有 5 日、5 仓、10bps…）。用户要的「研究分析」= 敏感性 / 消融 / 稳健性，**当前形态一个都跑不了**。 | 见 §3.9 |
| 5 | ⚠️ **数据窗口只有 11 个月、单区间**：`combo-v1` = 2025-11-01..2026-09-23，**16,221 事件**。没有牛熊切换、没有跨年 ⇒ 任何「策略好不好」的结论都只在这一个区间内成立。 | 见 §4 |
| 6 | ⚠️ **合规小缺口**：已声明 `eventScanPolicy: "FULL_DATASET"`，但结果**未输出 `unscannedEventCount`**（规范 §E.6 / §H.4 要求：声明全量就要给出「0 = 全量成立」的证据）。 | 见 §5 |

**一句话**：东西在，但它是「一个能跑的近似品」，不是「原始策略的可信镜像」。要做研究分析，必须先花一个 Phase 把它变成**可证明等价**且**可调参**的形态。

---

## 1. 「原始策略」到底指什么（三个易混概念，务必分清）

| 概念 | 位置 | 交易语义 | 状态 |
|---|---|---|---|
| **原始策略（baseline）** ← 本次目标 | `server/downsideRisk.ts:785` `run("baseline", "原始策略", …)`；分叉点 `:727` / `:812`（`key === "baseline" ? experimentRows : scaleRows(...)` ⇒ **不施加高位连板仓位缩放**） | **research-legacy**：T 收盘信号 → T+1 开盘买入 → 风险管理退出（开盘止损 / 动态止盈回撤 / 强势续持 / 最多持有 N 日强平），**支持资金循环复用** | `/backtest` 五策略面板中的对照组 |
| **生产策略 leader-candidate-baseline** | `server/leaderCandidateStrategyBacktest.ts`（ARCH-002 接线） | long-only + **hold-while-selected**（持仓不再入选当日候选池即卖出） | 生产运行时，与上面**非等价** |
| **实验 `combo-backtest/leader-candidate-baseline`** | `research-experiments/combo-backtest/leader-candidate-baseline/` | 实现的是 **legacy riskManagedHold**（退出原因文案「开盘触发止损 / 动态回撤止盈 / T+2收盘未满足强势续持条件 / 达到最多续持5个交易日」逐条对上 legacy） | **语义其实对应①，名字却写着②** |

调用链（服务端原始策略）：

```
routers.ts:1384 getLeaderCandidateResearch
  → db.ts:2683 getLeaderCandidateResearch
      → loadBacktestBaseContext(recentBacktestRange(365))     // db.ts:2943，唯一 DB 边界
      → leaderCandidates.ts:1139 buildLeaderCandidateBacktest(..., includeResearch=true)
          → 逐日 buildLeaderCandidatesForDate(records, date, { candidateLimit: null })   // :1182
          → appliedMinScore 过滤                                                        // :1300-1316
          → leaderCandidates.ts:1333 兜底 → RESEARCH_LEGACY_SIMULATION_SOURCE.simulate
              → realisticBacktest.ts:246 simulateRealisticTPlus1ToTPlus2
      → downsideRisk.ts:1128 buildDownsideRiskResearch → :706 buildExperiments → :785 baseline
```

⚠️ 生产路径（`includeResearch=false`）会 `throwProductionOverrideRequired()`，**不走 legacy**；`/backtest` 走的是研究路径。⇒ 对拍对象 = `buildExperiments` 的 `baseline`。

**纯函数性**：`buildLeaderCandidatesForDate`（`:596`）、`simulateRealisticTPlus1ToTPlus2`（`:246`）、`allocatePlannedBudgets`（`positionBudget.ts:47`）**都是纯函数**，DB 只在 `db.ts:2688`。⇒ **抽取复用在技术上无障碍**，这是好消息。

---

## 2. 已存在什么（实测，非推断）

| 项 | 状态 | 位置 |
|---|---|---|
| 实验四件套 | ✅ 齐 | `research-experiments/combo-backtest/leader-candidate-baseline/{experiment.ts,result.ts,page.tsx,README.md}` |
| 服务端注册 | ✅ | `research-experiments/manifest.ts:44`（import）/` :70`（数组项）。⚠️ `:80-84` 只对 `first-board-pullback/` 前缀套 `withFirstBoardPullbackFoundation`，本实验**不套底座** |
| 前端注册 | ✅ | `client/src/researchExperiments/pages.ts:93`（共 24 个 pageKey）；未注册会降级提示、不白屏 |
| 单测 | ✅ 1 例 | `tests/server/researchExperiments/leaderCandidateBaselineMigration.test.ts`（9 事件 → 成交 3 笔，退出原因全为「T+2收盘未满足强势续持条件」）。**只覆盖 happy path，不覆盖口径等价性** |
| 数据集 | ✅ `READY` | `dataset_version` id **690001**，version **`combo-v1`**，16,221 事件 / 1,016,684 行，2025-10-31..2026-09-22（UTC） |

---

## 3. 口径差异清单（本审计的核心；全部已逐行核实）

> 左 = `/backtest` 原始策略真源；右 = 现有实验实现。

| # | 维度 | 服务端真源 | 实验实现 | 等价? | 影响 |
|---|---|---|---|---|---|
| 3.1 | **候选准入** | 两层：① `candidate` 层 `score >= 52` **或**（题材≥3 家 且 封板 ≤13:30）（`leaderCandidates.ts:807-814`）；② 再叠加 `appliedMinScore`（`[45,50,55,60,65]` 中按**前 70% 日期校准、后 30% 样本外**选优，`options.minScore ?? recommended?.threshold ?? null`，`:1300-1316`） | 单层固定 `score >= 65`（`experiment.ts:244-245`） | ❌ | **最大差异**。服务端阈值是**数据校准出来的**，不是常量；且存在「题材共振」这条**不走评分**的准入路径。当前实验的候选池 ≠ `/backtest` 的候选池 ⇒ 成交笔数与收益不可比 |
| 3.2 | **连板数 boards** | `calculateBoards` 用**交易日历索引**遍历（`leaderCandidates.ts:633-644`） | 用「**事件日期集合**」倒序回溯（`experiment.ts:220-226`） | ❌ | 若某交易日全市场零涨停，该日不在事件日期集合里 ⇒ 连板链被误判为连续。低频但真实；且 boards 直接进评分（×7）与高位风控 |
| 3.3 | **买入滑点** | `amountAdjustedSlippageBps(10, 成交额)`：成交额 <1亿 +20bps / 1~5亿 +10 / 5~20亿 +5 / ≥20亿 +0（`realisticBacktest.ts:199-205`，用于 `:476` 买入、`:333` 卖出） | 固定 10bps（`experiment.ts:30, 493`） | ❌ | 小成交额标的实验侧**系统性高估成交价优势**（少算最多 20bps 单边） |
| 3.4 | **最低佣金** | **无**：`buyFees = grossEntry * (rate)`（`:494`）、`sellFees = grossExit * (…)`（`:336`） | **有**：`Math.max(5, …)`（`experiment.ts:31, 408-411, 502-505`） | ❌ | 服务端不存在 5 元下限。等权约 2 万/笔时佣金 6 元，边界接近；但若参数化后仓数变多/资金变小，差异放大 |
| 3.5 | **分仓分母** | 先过滤（缺 T+1 开盘价 / 开盘溢价 < −2% / 同一股票已持仓）⇒ `selected = available.slice(0, slots)` ⇒ `allocatePlannedBudgets({ strategy:"equal", cash, count })` = `cash / count`（`realisticBacktest.ts:389-431` + `positionBudget.ts:47-62`） | **先分仓再过滤**：`budgetPerPosition = cash / selected.length`，其后在循环里 `continue` 掉 −2% 门槛与不足一手的（`experiment.ts:480-492`） | ❌ | 实验侧被丢弃标的仍占分母 ⇒ **每笔预算偏小、现金闲置** ⇒ 资金利用率与服务端不同 |
| 3.6 | **开盘溢价门槛基准价** | 信号日**收盘价** `signalClosePrice`（`realisticBacktest.ts:390-392`） | 事件行 `limitUpPrice`（`experiment.ts:487-490`） | ≈ | 收盘涨停时 `close == limitUpPrice` ⇒ 实践上等价；但这是**巧合等价**，不是同一字段。若将来事件口径放宽到「盘中触及涨停」就会分叉，需在注释里写死 |
| 3.7 | **停牌 / 复牌** | 有 `suspendedDatesByStock`，停牌后取**复牌首日**作为可离场观察日（`leaderCandidates.ts:1199-1218`） | 无停牌概念；缺 bar 就 `continue` | ❌ | 极端停牌路径的退出时点不同 |
| 3.8 | **schema 自述** | `maxHoldingDays` 默认 **5**（`realisticBacktest.ts:270`） | 实现里硬编码 `>= 5`（`experiment.ts:589`），但 `result.ts:8` `MAX_HOLDING_DAYS = 30` 且 `result.ts:63` schema 声明 `maxHoldingDays: literal(30)` ⇒ **对外自述 30、实际 5** | ❌ | 结果载荷本身在说谎；下游任何人读 `customPayload.rule.maxHoldingDays` 都会被误导 |
| 3.9 | **可调参数** | 阈值 / 持有日 / 仓数 / 费率 / 滑点 / 分仓口径全部可由 `RealisticBacktestOptions` 传入 | `descriptor.parameters = []`（`experiment.ts:274`），全部硬编码 | ❌ | **研究分析的致命缺口**：做不了阈值敏感性、退出政策对比、分仓对比 |
| 3.10 | 其它默认关闭项 | `blockLimitUpBuys` / `blockLimitDownSells` / `enableIntradayStopLoss` / `detectExRights` / `maxPositionAmountRatio` **默认全 false/0** | 实验同样没有 | ✅ | 一致，可不动 |
| 3.11 | 评分公式 | `min(boards,6)*7 + min(sectorCount,6)*4 + timeScore + turnoverScore + marketCapScore`，封顶 100（`leaderCandidates.ts:694-703`） | 同（`experiment.ts:227-234`） | ✅ | 一致。**但 boards 与 sectorCount 的输入不同（3.2），所以分数不必然相同** |
| 3.12 | 主板判定 | `!/^(300\|301\|688\|920)/`（`leaderCandidates.ts:493-495`）⇒ **不排除 ST**，也**不排除 `43/83/87/88/4/8` 开头北交所** | `boardType !== "main"`，Dataset 侧 = `classifyBoard`（`server/data/boardRules.ts:76`：`main 60/000/001/002/003`、`chinext 300/301`、`star 688/689`、`bse 920\|43\|83\|87\|88\|4\|8`） | ❌（已核实 2026-09-24） | **Dataset `main` ⊂ 服务端放行集**，差集 = 北交所(`43/83/87/88/4/8`) + `689` ⇒ 数据集里没有这些票 ⇒ 对拍存在不可覆盖区。详见 §8.1② |

---

## 4. 数据集现状（**直连库实测**，`dataset_version` 表全量 9 行）

```
id 690001 | version combo-v1 | READY | 2025-10-31 .. 2026-09-22 | events 16,221 | rows 1,016,684
universeDefinitionJson : {"universe":"all-a-shares","source":"stock_daily_prices","boards":["main"],"excludeSt":false}
filterDefinitionJson   : {"kind":"build-config","builder":"first_limit_pullback","configVersion":1,
                          "events":[{"relativeDay":0,"kind":"limitUp"}],
                          "preWindowDays":0,"postWindowDays":30,"pathHorizon":30,
                          "outcomeHorizons":[1,5,10,20],"batchSize":1000}
```

对比同表的其它版本：

| 版本 | 事件定义 | 窗口 | 事件数 | ST |
|---|---|---|---|---|
| **combo-v1** | **`limitUp`（全部收盘涨停，含连板）** | 2025-11 .. 2026-09（**11 个月**） | 16,221 | **不排除** |
| v5 | `firstBoard`（仅首板） | 2018-12 .. 2026-09（**近 8 年**） | 73,003 | 排除 |
| v4-validation / v3-confirmatory / v2 / v1 | firstBoard | 各段 | — | 排除 |

⇒ **两条关键推论**：

1. `combo-v1` 的事件定义（全部涨停）**确实匹配**原始策略的 universe（服务端也覆盖连板），**这点是对的**；但它**只有 11 个月、且不排除 ST**，而 `v5` 有 8 年但事件定义是首板。⇒ 长周期研究需要另一版数据集，但 ✅ **2026-09-24 用户已裁定：不建 `combo-v2`**（当日 23:24 更正，早前一版误记为「建」）⇒ **研究窗口锁定 `combo-v1`，结论不可外推**。缓解措施见方案 §0.1 D3（日期聚类 Bootstrap + 强制区间限定）。
2. `preWindowDays: 0` ⇒ **没有前置行情**。原始策略的评分只用信号日及以前的涨停记录（PIT 安全），所以这没问题；但如果后续研究要加「前期涨幅 / 均线支撑」这类因子，**数据不够，得重建**。

---

## 5. 实验体系合规缺口

| 项 | 要求 | 现状 | 判定 |
|---|---|---|---|
| 样本账 | `eligible + excluded === candidate` 且 `Σ excludedByReason === excluded` | `assembleLeaderCandidateBaselineResult` 用 `excludedCount = candidateCount - eligibleCount`（`result.ts:180`），`excludedByReason` 由 `exclude()` 累计 | ✅ 结构成立 |
| 全量声明 | 声明 `FULL_DATASET` 就必须出 `unscannedEventCount`（`0` = 全量成立，`null` = 总数未知） | **未输出** | ❌ 缺 |
| 未来数据 | 未声明 `usesForwardData: true` 时读 `rd ≥ 1` 直接抛错 | 已声明 `true` + `forwardDataPurpose`（`experiment.ts:301-303`） | ✅ |
| 旧链路字段 | 不得出现 `analysisId` / `findingIds` / `conclusion` / `candidateId` | 无 | ✅ |
| 引桥纪律 | 只有 `robustnessBridge.ts` 能 reach `server/**` | 实验不引 server | ✅ |

---

## 6. 未迁移（`/backtest` 里还在、实验里没有的）

| 内容 | 位置 | 规模 | 是否本次目标 |
|---|---|---|---|
| 五策略面板其余 4 个策略（风险扣分 / 高风险硬过滤 / 质量复合 / 质量门控） | `downsideRisk.ts:706-791` | ~1261 行文件的一部分 | ❌ 本次不做（先只搬 baseline） |
| 因子消融 / 滚动窗口 / 走前验证 / 稳健性 | `downsideRisk.ts:840/971/1027/1080` | 同上 | ❌ 不在实验里重做，Phase 3 用实验自己的参数化替代 |
| 过拟合防护 | `server/overfittingGuard.ts` | 310 行 | ❌ |
| 参数搜索页 | `client/src/pages/ParameterSearch.tsx` | 1026 行 | ❌ 独立页，不动 |
| 样本外 / Walk-Forward 页 | `client/src/pages/WalkForwardAnalysis.tsx` | 独立页 | ❌ 不动 |
| 前端 `/backtest` 页面本体 | `client/src/pages/Backtest.tsx` | **1145 行 / 162KB** | ❌ **不删、不改**（实验是加法，不是替换） |

---

## 7. 前置阻塞与风险

1. **🔴 命名误导（最需要先澄清的）**：实验 id `combo-backtest/leader-candidate-baseline` 与 `pageTitle`「组合回测主模式迁移」，但它实现的是 **legacy 原始策略**，而 `leader-candidate-baseline` 在服务端是**另一个（生产、非等价）策略**。继续用这个名字，后续任何读者都会误判它的对拍对象。
2. **🔴 等价性未证明**：目前**没有任何测试**把实验输出与 `simulateRealisticTPlus1ToTPlus2` 的输出做过对拍。
3. **⚠️ 改 `server/**` 会热重启**：本方案的 Phase 0 若要抽出纯函数放进 `shared/`，属于 `server/**` 改动 ⇒ 须先跑在途 Run 闸门（`docs/evidence/_probe_inflight_runs.mts`）。
4. **⚠️ 结论外推**：单区间 11 个月 ⇒ 任何「策略有效/无效」的结论只能在该区间内陈述（裁定 4 不建长窗口后，此为**必须承受的已知边界**）。
5. 🔴 **研究口径已于 2026-09-24 23:50 变更**：由「策略镜像 + 综合评分敏感性」改为「**每个因子单独测试**」（用户裁定 5，见方案 §0）⇒ 本审计 §3 的 8 处口径差异**对本次范围不构成阻塞**（单因子分桶研究不涉及策略语义），但**仍然真实存在**，将来重启策略回测研究时仍是必读。数据侧的新事实（列可用性 / 命名撞车 / ST 不可及 / 缺失偏斜）见 **§9** 与方案 §0.1 D1~D4。

---

## 8. 待用户裁定 —— ✅ 已于 2026-09-24 全部裁定

| # | 问题 | 裁定 |
|---|---|---|
| 1 | 实验要不要改名？ | **保留 id，改展示名**（`name` / `pageTitle` / README；目录名、`descriptor.id`、`manifest.ts`、`pages.ts` key **一律不动**） |
| 2 | 口径基调？ | **A 严格对齐服务端**（包括数据校准出的阈值） |
| 3 | ST / 北交所 / 创业板 / 科创板口径？ | **全部排除**（研究样本 = 沪深主板非 ST） |
| 4 | 是否建 `combo-v2`？ | **不建**（2026-09-24 23:24 用户更正；上一轮误记为「建」）⇒ **研究窗口锁定 `combo-v1`（11 个月），结论不可外推** |

### 8.1 由裁定派生的两个事实修正（2026-09-24 补核）

**① 「严格对齐服务端」与「全部排除」在样本口径上直接冲突 ⇒ 必须双档化**

服务端 `isMainBoardStock`（`leaderCandidates.ts:493`、`db.ts:2049`）= `!/^(300|301|688|920)/`，**不排除 ST**，也**不排除 `43/83/87/88/4/8` 开头的北交所**。故「默认对齐服务端」与「默认全排除」不能同时成立。方案已把样本口径做成参数：`universeRule = server-legacy`（默认，对拍档）/ `strict-main`（研究档）+ `excludeSt`（默认 `false` / 研究 `true`）。详见方案 §0.1 D1。

**② 两套「主板」定义的差集使对拍存在不可覆盖区（原 §3.12「⚠️待核」已核实）**

```
服务端放行 S = 非 300/301/688/920 开头  = {60*, 000*, 001*, 002*, 003*, 43*, 83*, 87*, 88*, 4*, 8*, 689*}
Dataset main D = classifyBoard(code)==="main"（server/data/boardRules.ts:76）
               = {60*, 000*, 001*, 002*, 003*}   // 另有 chinext 300/301、star 688/689、bse 920|43|83|87|88|4|8
⇒ D ⊂ S，差集 S\D = 北交所(43/83/87/88/4/8) + 689
```

`combo-v1` 按 `boards:["main"]` 构建 ⇒ 数据集内**没有 `S\D` 的事件** ⇒ 实验侧无法复现服务端买入这些票的行为。
⇒ **Phase 0 对拍的作用域 = 沪深主板 `60/000/001/002/003`（含 ST）**，`S\D` 不在覆盖内，须显式声明，**不得**把「作用域内逐笔全等」表述为「完全等价」。详见方案 §0.1 D2。

**③ 裁定 4 = 不建 `combo-v2` ⇒ 单区间风险从"可缓解"变为"必须承受"**

`combo-v1` = **11 个月**（≈ 3.7 个季度）⇒ 无牛熊切换、无跨年样本。后果：

- 原「两窗口同号才写进报告」这条最有力的反过拟合判据**作废**，须换更弱的替代（**日期聚类 Bootstrap 95% CI** + **R6 随机基准** + **强制区间限定**，三条都在单窗口内可做 —— 详见方案 §0.1 D3）。
- ⚠️ **`v5` 不能当替代窗口**：它是 `firstBoard`（仅首板）事件定义 ⇒ 原始策略评分里的 `boards`（连板数）会**恒为 1**、高位连板风控全部失效 ⇒ **不是同一个策略**，强行对比是伪结论。
- ⚠️ R7「子区间稳健性」降级为 `combo-v1` 内**季度切片**（仅 3~4 段、段内样本更小）⇒ 只能作描述性观察，**不得**据此宣称「稳健」。

✅ 附带结论（留档备查）：裁定 3 的「创业板 + 科创板 + 北交所」三项由 `boards:["main"]` **天然覆盖**，将来若条件触发要建 `combo-v2`，**无需改构建器**，只需显式置 `excludeSt: true`（`combo-v1` 为 `false`）。

---

## 9. 数据侧补充实测（2026-09-24 23:30~23:45，只读直查；为「因子独立测试」口径新增）

> 背景：研究口径变更为「每个因子单独测试」（裁定 5）后，**因子能不能取出正确的那一列**成为地基问题。以下全部为直查实测。

### 9.1 🔴 命名撞车：`turnover` 是**换手率**，成交额在 `sourceTurnoverAmount`

| 列 | 真实含义 | 源 | 实测值 |
|---|---|---|---|
| `turnover` | **换手率 %** | `liquidity.turnoverRate`（`builder.ts:279`） | `22.4465` / `8.7136` / `7.6323` |
| `sourceTurnoverAmount` | **成交额（亿元）** | `limit_up_records.turnover`（`builder.ts:283`） | `42.9` / `10.2` / `1.4` |
| `sourceCirculationValue` | **流通市值（亿元）** | `limit_up_records.circulationValue`（`builder.ts:284`） | `203` / `119` / `21` |

服务端 `turnoverScore` 的档位（`≥20 亿 → 8 分`）用的是**成交额** ⇒ 因子研究必须取 `sourceTurnoverAmount`。取错即研究另一个因子。

### 9.2 `combo-v1` 事件列填充率（决定每个因子的可用样本）

```
16,221 事件 / 220 交易日 / 2025-11-03..2026-09-23 / boardType 100% = main（SZ 8,297 + SH 7,924）
limitUpTime 13,373 (82.4%) | sector 13,373 (82.4%) | sourceTurnoverAmount 13,368 (82.4%)
sourceCirculationValue 13,366 (82.4%) | turnover 15,473 (95.4%) | historicalLimitCount 16,221 (100%)
marketCap / floatMarketCap = 0 (0%)  ❌ 完全不可用
isFirstLimit=1 12,484 (77.0%) ⇒ 连板事件 3,737 (23.0%)
post rd=1：16,177 行 / barPresent 16,105 / canBuyAtOpen 14,468 (89.2%) / 停牌 67
```

### 9.3 🔴 缺失是**系统性**的（单调偏向早期）

`sector` / `limitUpTime` / `sourceTurnoverAmount` / `sourceCirculationValue` **四个字段同批缺失**（前两者计数完全相等 ⇒ 同一采集来源），且按月**单调改善**：2025-11 缺 22.5% → 2026-08 缺 4.1% → 2026-09 缺 1.2%（2026-05 有 27.9% 的局部高点）。
⇒ 因子可用样本**在时间上偏向近期**；Bootstrap 按交易日聚类可部分缓解，**不能消除**。

### 9.4 `limit_up_records.boardCount` **不可作连板数真源**（再次实证）

窗口内 15,491 行，`null` 仅 2 行，取值：`"1"` → 10,731；`"2"` → **1**；`"3"` → **0**；`"4"` → **0**；其余 1,353（多为两位数字符串）。分布明显不合理 ⇒ 与项目既有结论一致：「连板数必须自行派生」（派生规则见方案 §4 F1）。

### 9.5 🔴 排除 ST 在**实验内做不到**（裁定 3 的落空项）

- `combo-v1` 构建配置 `excludeSt: false` ⇒ 未排除 ST；
- dataset 事件表 **27 列里无任何 ST 信号**（无 `stockName` / `isSt` / 状态列）⇒ 实验只读 dataset ⇒ **无从判定**；
- ST 状态本身存在：`research_security_status_history` 中 `statusType='ST'` 共 **841** 行，但属**服务端表**，实验读不到；
- 「名称前缀」这条也断了：窗口内 `limit_up_records.stockName LIKE 'ST%'` 仅 **1** 行、`LIKE '*ST%'` **0** 行。

⇒ 三选项（接受并登记 / 改构建器重建 / 反查）与建议见方案 §0.2 D3、§10。

### 9.6 ✅ 「排除北交所 / 创业板 / 科创板」已天然满足

`combo-v1` 的 `boards:["main"]` 由 `classifyBoard` 判定，实测 `boardType` **100% = `main`**（`chinext` / `star` / `bse` 零条）⇒ 裁定 3 的三项无需任何额外过滤。

### 9.7 ✅ 题材归一化可合法复用（`shared/` 纯函数，已有先例）

- `normalizeSectorName()`（`shared/stockDataNormalization.ts:2`）剥离 `sector` 里 OCR 附带的 `*N` 计数后缀（实测 `"海南*5"` / `"其他*6"` / `"存储/半导体*4"`）；
- `resolveThemeWithFallback({sector, keywords})`（`shared/fieldAvailability.ts:247-262`）—— 优先 `sector`，缺失回落 `keywords` 首个非「其他」token，全缺返回 `null`；
- ✅ **现有实验已在 import**（`research-experiments/combo-backtest/leader-candidate-baseline/experiment.ts:7` import `@shared/fieldAvailability`）⇒ 无合规障碍。

⚠️ 但**分母口径不同**：服务端用 `limit_up_records` **全量**（含创业板 / 科创板 / 北交所 / ST）算同日同题材家数；实验读的是已按 `boards:["main"]` 过滤的事件表 ⇒ 实验算出的家数**系统性偏小**。方案采用「主板内家数」（更符合裁定 3）并显式声明 ≠ 服务端口径。

---



- 源码逐行（已在本文件各处标注 `文件:行号`）。
- 数据库直查：一次性只读脚本 `C:\work\sourcecode\_scratch\probe_combo_dataset.mjs` → `probe_combo_dataset.out.txt`（查询 `dataset_definition` / `dataset_version` 全量，无写入）。⚠️ 该脚本在仓外临时目录，不属于交付物。
- 交叉审计：一路 Explore 子代理独立复核 `/backtest` 服务端链路与前端注册点，结论与本人直读一致。
