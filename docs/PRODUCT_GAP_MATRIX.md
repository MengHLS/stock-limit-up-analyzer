# PRODUCT GAP MATRIX — 产品能力差距矩阵

> 版本：v1.0 | 日期：2026-09-09 | 状态：ACTIVE
> 依据：本次独立实查（TiDB 直连 + 源码 + git 安全扫描），非历史文档。
> 状态口径：`GAP`=缺失/未实现；`CODE_READY`=代码存在+单测通过但未真实数据验证；`PARTIAL`=部分可用；`OK`=真实数据已验证。

---

## 1. 九大工作区差距总览（§4/§5）

| 工作区 | 当前实现 | 状态 | 证据 | 差距 | 优先级 | 目标 |
|--------|---------|------|------|------|--------|------|
| Dashboard | `Home.tsx` + `DataHealth.tsx`（数据健康看板） | PARTIAL | 21 页前端；dataHealth 已接 `dataHealthRouter` | 无「研究系统总状态」聚合看板；无策略/研究/纸面/纪律一览 | P1 | 单页回答「系统处于什么状态」 |
| Data Center | 数据域已回填 + `researchDataset`/`historicalState` | PARTIAL | OHLCV 8.89M/5796 股、liquidity 9.01M、CA 31,641、AF 31,337 全 FULL | 缺 `research_datasets` 持久化表；industry PIT 缺口（见 §3） | P0 | Raw→Normalized→Dataset 三层可见可认证 |
| Strategy Lab | `StrategyEditor.tsx` + `strategySchema` | PARTIAL | 编辑器双模式 + adapter；`strategy_versions` 表**缺失** | 策略无持久化版本；保存/运行按钮后端无端点（诚实禁用） | P1 | 版本化策略，禁止覆盖历史版本 |
| Backtest | `backtest/` + `strategyBacktest` + `realisticBacktest` 多套 | CODE_READY | 多套引擎并存；生产 baseline 只产 BUY 无 SELL | 无 canonical 引擎；无退出策略 → 胜率/回撤失真 | P0 | 唯一生产引擎 + BUY/SELL 完整生命周期 |
| Optimization | `parameterSearch` + `rollingOptimization` | CODE_READY | 模块存在（29 子模块之一）；无真实运行产物 | 未接真实 E2E；未输出「稳定区域」 | P1 | 稳定参数区域，非收益尖峰 |
| Validation | `robustness`/`walkForwardRun`/`oosIsolation`/`overfittingDetection` | CODE_READY | 模块存在 + 44 测试文件；真实 E2E=0 | 全部 synthetic fixture；无真实 WFO/OOS 运行 | P0 | 真实 IS/OOS 隔离 + 过拟合判定 |
| Paper Trading | `paperTrading.ts`（legacy）+ `paperAccount` | CODE_READY | `paper_trades` 表**缺失** | 无持久化；planned vs actual 不可追踪 | P2 | 全链路纸面 + 日志持久化 |
| Review & Discipline | `reviewRouter` + `tradeJournal` + `disciplineFeedback` | CODE_READY | `trade_journal_entries` 表**缺失** | 无持久化；无纪律评分闭环 | P2 | 执行质量 + 纪律量化 |
| Research Archive | `experimentRegistry` + `experimentLineage` | CODE_READY | `research_experiments`=0、`research_runs`=0、`experiment_artifacts` 表缺失 | 无任何真实实验归档；不可 replay/audit | P0 | 每条研究可重放/审计/复现 |

---

## 2. 数据域差距矩阵（§6/§10/§11）

| 数据域 | 表 | 当前 | 状态 | 证据 | 差距 | 优先级 |
|--------|-----|------|------|------|------|--------|
| OHLCV | stock_daily_prices | 8,891,500 行 / 5,796 股 | OK | 实查 2026-09-09；1863 交易日、缺口 0、重复 0 | 无 | — |
| Security Master | research_securities | 5,552（含退市 337） | OK | anti-survivorship 已含退市股 | OHLCV 5,796 > master 5,552（~244 只含 BJ/退市）对账待澄清 | P1 |
| Identifier History | research_security_identifier_history | 5,552 一一对应 | OK | 实查 | 无 | — |
| Historical Status | research_security_status_history | 10,373 行 / 1,830 股（事件态） | OK | SUSPENDED+ST 齐备 | 事件态非全市场 LISTING 快照（边界由 securities 承载） | — |
| **Industry** | industry_assignments | 5,212 行 | **GAP** | `securityId` 全 NULL；`effectiveFrom` 单点 2026-08-31 | 无历史 PIT；当前快照≠历史序列 | **P0** |
| Index | index_daily | 4 核心指数 2019-2026 | OK | 实查 | 无 | — |
| Liquidity | liquidity_daily | 9,015,158 行 / 5,131 股 | OK | 实查（已全量，非 09-07 的 25%） | 无 | — |
| Corporate Actions | corporate_actions | 31,641 行 / 4,824 股 | OK | 事件态表；缺口 201 股=无分红送转事件（实查） | 无 | — |
| Adjustment Factors | adjustment_factors | 31,337 行 / 5,025 股 | OK | 逐股复权因子 | 无 | — |
| Trading Calendar | 无独立表（index_daily 为准） | 1,800+ 交易日 | OK | canonical 交易日 | 无 | — |

---

## 3. PIT / Survivorship / Identity 差距（§10/§11/§35）

| 能力 | 当前 | 状态 | 证据 | 差距 | 优先级 |
|------|------|------|------|------|--------|
| PIT（asOf 只读 T 时已知） | `historicalState/asOf` + PIT 审计 | CODE_READY | 12 项 checker + 23 计划 smoke；gate=INCONCLUSIVE | 未真实数据 VALIDATED | P0 |
| Survivorship 控制 | securities 含退市 337 | OK | 实查 | 历史 universe 未真正构建（依赖 dataset） | P1 |
| Identity（securityId 统一） | `stockIdentity.ts` + 身份铁律 | PARTIAL | industry 表 securityId 全 NULL 违反身份铁律 | code→securities 桥接未回填 | **P0** |
| 代码复用 / code format dual-track | identifier history 承载 | OK | 实查 | 无 | — |

---

## 4. 研究链路差距矩阵（§15/§16/§18~§26）

| 能力 | 当前实现 | 状态 | 证据 | 差距 | 优先级 |
|------|---------|------|------|------|--------|
| Research Dataset | `researchDataset`（构建器 + policy 9 类） | CODE_READY | 模块 + 单测；`research_datasets` 表缺失 | 无持久化；无 datasetFingerprint 落库 | P0 |
| Dataset 可复现性 | 构建器版本快照 | CODE_READY | 未验证同输入两次一致 | 无真实 diff 证据 | P0 |
| 正式 Research Path（Dataset→…→OOS） | `research/` 29 模块 50,537 行 | CODE_READY | 44 测试文件、1,104 用例 | **零真实 E2E**（research_runs=0） | **P0** |
| Legacy 收敛 | `backtest/`+`realisticBacktest`+`strategyBacktest`+`research/*` | VALIDATED | `getLeaderCandidateBacktest`→Strategy Engine（生产引擎），4 研究 router legacy 调用=0；legacy 降级为 research-only 唯一出口 | 研究路径（下行风险报表）仍有意保留 legacy（语义不同） | P1 |
| Exit Model（BUY+SELL） | `leaderCandidateBaseline` hold-while-selected 退出 | CODE_READY | `exitMode` + `buildHoldWhileSelectedExitSignals`；端到端 closed trade | 真实数据验证待 P5-T1；`trade.reason` 未传递（随 K1 止损止盈接入时贯通） | **P0** |
| 回测边界条件 | `edgeCases.test.ts`（18 用例）逐项验证 | CODE_READY | 12 项边界：8 覆盖（T+1/涨跌停可成交/停牌/板块幅度/滑点/费用/资金/退出）+ 4 KNOWN_GAP | K1 止损止盈待 P4-T1；K2 除权复权；K3 一字板概率；K4 板块 limitRules 未注入生产引擎 | P1 |
| Performance Evaluation | `performanceMetrics`/`riskAdjustedMetrics` | CODE_READY | 模块 + 单测 | 无真实 PnL 运行 | P1 |
| Parameter Search | `parameterSearch`/`rollingOptimization` | CODE_READY | 模块 + 单测 | 未输出稳定区域 | P1 |
| Robustness | `robustness`/`stochasticRobustness` | CODE_READY | 模块 + 单测 | 无真实扰动运行 | P1 |
| WFO/OOS | `walkForwardRun`/`oosIsolation` | CODE_READY | 模块 + 单测 | OOS 未冻结验证 | P1 |
| Overfitting | `overfittingDetection`/`pbo` | CODE_READY | 模块 + 单测 | 无真实 PBO/ablation | P1 |
| Market Regime | `marketRegime` | CODE_READY | 模块 + 单测 | 部分用 0 代替缺失数据风险 | P2 |
| Strategy Verdict | `lifecycle` | CODE_READY | 模块 | 无真实 verdict 产出 | P1 |

---

## 5. 生产化差距矩阵（§28~§34/§46）

| 能力 | 当前 | 状态 | 证据 | 差距 | 优先级 |
|------|------|------|------|------|--------|
| Paper Trading 持久化 | `paperTrading.ts` | GAP | `paper_trades` 表缺失 | 无 planned vs actual | P2 |
| Review/Discipline 持久化 | `reviewRouter`/`tradeJournal` | GAP | `trade_journal_entries` 表缺失 | 无纪律评分 | P2 |
| 前端真实标注 | 21 页，部分 legacy | PARTIAL | 无「真实/预览/legacy/空壳」四类标注 | 页面类别未显式区分 | P2 |
| 安全 | .env 未跟踪；token 走 env | OK | git 扫描；`tushare.secret.test.ts` 读 `process.env` | 无硬编码 secret | — |
| 类型安全 | 跨层边界部分 schema | PARTIAL | 未全量审计 `any`/`as any` | 边界 schema 待固化 | P2 |
| 性能基线 | Recent 2y price query 曾 ~16.8s | UNVERIFIED | 未重测 | 需建立 Performance Baseline | P2 |
| 幂等性 | backfill/resume 幂等 | PARTIAL | 断点续传已实现 | Dataset/Research run 幂等待验证 | P2 |

---

## 6. P0 硬门槛汇总（本矩阵导出的 Top 阻断项）

| # | 差距 | 影响 | 对应 Gate |
|---|------|------|-----------|
| P0-1 | Research Ready Gate 语义膨胀（只查 dataScope） | 假 RESEARCH_READY | G0 重构 |
| P0-2 | Industry 无历史 PIT + securityId 全 NULL | 历史 asOf 行业不可信 | G1 |
| P0-3 | 生产引擎无退出策略（只 BUY） | 回测胜率/回撤失真 | G3（P3-T1 CODE_READY：hold-while-selected 退出已接入） |
| P0-4 | 研究链零真实执行 + 无持久化 | 无正式研究结论 | G4 |

---

## 7. 状态口径说明

- 本矩阵 `CODE_READY` = 代码存在 + 单测通过，**不代表** `VALIDATED`（真实数据验证）。
- 数据域「OK」仅指行数/覆盖达标（G0 数据地基），不自动等于「可做正式研究」（G4）。
- 所有数字为 2026-09-09 实查快照，推进时在对应 Gate 证据目录更新。
