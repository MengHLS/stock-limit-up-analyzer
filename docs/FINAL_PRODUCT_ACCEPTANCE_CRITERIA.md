# FINAL PRODUCT ACCEPTANCE CRITERIA — 最终产品验收标准

> 版本：v1.0 | 日期：2026-09-09 | 状态：ACTIVE
> 依据：Master Directive §51（Q1-Q20）＋ §52（闭环验收）。
> 口径：`YES`=真实数据已验证；`CONDITIONAL`=代码就绪但未真实验证；`NO`=未实现；`NOT READY`=明确不达标。

---

## 1. Q1-Q20 逐项验收（§51）

| # | 验收问题 | 当前答案 | 证据 / 缺口 |
|---|---------|---------|------------|
| Q1 | 用户能否把自己的主观交易模式输入系统？ | CONDITIONAL | StrategyEditor 双模式已建；保存/运行后端无端点（诚实禁用）；策略无持久化版本 |
| Q2 | 能否自动转换为机器可执行规则？ | CONDITIONAL | `strategySchema` + DeclaredRule 契约已 CODE_READY；无真实策略实例化 |
| Q3 | 能否使用 PIT 正确历史数据？ | CONDITIONAL | `historicalState/asOf` + PIT 审计 CODE_READY；Industry PIT 缺口（effectiveFrom 单点） |
| Q4 | 能否避免 Survivorship Bias？ | CONDITIONAL | securities 含退市 337；历史 universe 未真正构建 |
| Q5 | 能否进行完整 Baseline Backtest？ | CONDITIONAL | 多套引擎并存；生产 baseline 只 BUY 无 SELL → 回测失真 |
| Q6 | 能否评价风险与收益？ | CONDITIONAL | `performanceMetrics`/`riskAdjustedMetrics` CODE_READY；无真实 PnL |
| Q7 | 能否进行 Parameter Search？ | CONDITIONAL | `parameterSearch` CODE_READY；无真实运行 |
| Q8 | 能否判断参数稳定性？ | CONDITIONAL | `parameterStability` CODE_READY；无真实运行 |
| Q9 | 能否进行 Robustness？ | CONDITIONAL | `robustness`/`stochasticRobustness` CODE_READY；无真实扰动 |
| Q10 | 能否进行 WFO？ | CONDITIONAL | `walkForwardRun` CODE_READY；无真实窗口 |
| Q11 | 能否真正执行 OOS？ | NO | OOS 隔离未冻结；无真实 OOS 运行 |
| Q12 | 能否检测 Overfitting？ | CONDITIONAL | `overfittingDetection`/`pbo` CODE_READY；无真实 PBO |
| Q13 | 能否分析 Regime？ | CONDITIONAL | `marketRegime` CODE_READY；部分用 0 代替缺失数据风险 |
| Q14 | 能否生成正式 Strategy Verdict？ | NO | `lifecycle` CODE_READY；无真实 verdict 产出 |
| Q15 | 能否进入 Paper Trading？ | NO | `paper_trades` 表缺失；无持久化 |
| Q16 | 能否记录实际交易？ | NO | 无实际交易记录表 |
| Q17 | 能否复盘？ | CONDITIONAL | `reviewRouter` 存在；`trade_journal_entries` 表缺失 |
| Q18 | 能否评价交易纪律？ | NO | `disciplineFeedback` CODE_READY；无纪律评分闭环 |
| Q19 | 能否形成 Strategy V2/V3？ | NO | `strategy_versions` 表缺失；版本演化不可持久化 |
| Q20 | 能否完整复现过去的研究？ | NO | `research_experiments`=0、`research_runs`=0、`experiment_artifacts` 表缺失 |

**汇总**：YES 0 / CONDITIONAL 11 / NO 9 / NOT READY 0（明确标记）。

> 说明：11 项 CONDITIONAL 均因「代码 CODE_READY 但真实数据 E2E=0」。这恰是 CODE_READY≠VALIDATED 的核心证据——能力已编码，但无一经真实数据认证。

---

## 2. 闭环验收（§52）

```
USER HYPOTHESIS → STRATEGY V1 → DATASET V1 → BASELINE RUN → METRICS
→ PARAMETER SEARCH → ROBUSTNESS → WFO → OOS → OVERFIT → REGIME
→ VERDICT → PAPER TRADING → REVIEW → DISCIPLINE → STRATEGY V2
```

**当前闭环状态**：整条链的模块均已 CODE_READY，但**零段真实跑通**（research_runs=0，backtest_runs=1 为 legacy）。闭环验收 = `NOT READY`。

---

## 3. 最小可验收（MVP）定义

在完整 Q1-Q20 之前，先满足以下 P0 硬门槛（对应 Gap Matrix §6）：

1. G0 gate 独立判定（废除假 RESEARCH_READY）
2. Industry PIT 修复（securityId + effectiveFrom 历史区间）
3. 生产引擎 BUY+SELL 退出策略
4. 第一条真实研究 E2E（research_runs ≥1）

满足以上 4 项后，Q3/Q4/Q5/Q6 才可升为 YES，闭环首段（Hypothesis→Baseline→Metrics）才算真正打通。

---

## 4. 更新记录（append-only）

| 时间 | 变更 | 说明 |
|------|------|------|
| 2026-09-09 13:43 | 建立 | Q1-Q20 逐项验收，YES 0 / CONDITIONAL 11 / NO 9 |
