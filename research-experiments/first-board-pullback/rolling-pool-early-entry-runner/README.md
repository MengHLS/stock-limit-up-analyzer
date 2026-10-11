# `first-board-pullback/rolling-pool-early-entry-runner`

> **首板滚动观察池 × 连续观察买点 × `preReturn10` 排序 × 固定 Runner**
> 目标：[`docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md`](../../../docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md)
> 买点规则：[`docs/research/RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md`](../../../docs/research/RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md)
> S1/S2 门禁：[`docs/research/S1-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-GATE-002.md`](../../../docs/research/S1-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-GATE-002.md)
> S3 执行面门禁：[`docs/research/S3-FIRSTBOARD-EARLY-ENTRY-EXECUTION-GATE-002.md`](../../../docs/research/S3-FIRSTBOARD-EARLY-ENTRY-EXECUTION-GATE-002.md)

## 唯一研究问题

在首板触发的**滚动观察池**中，股票于 **T+10 以内**触发同一条明确买点后，按 `preReturn10` HIGH 排序，
能否在**固定退出政策**与**真实账户约束**下，比**同批候选随机选择**捕获更多**可实现右尾**？代价是什么？

**这是真实撮合口径（既有唯一 `runTradeSimulation`），不是投资建议，也不是盈利承诺。**

## 与 round-1（`rolling-pool-right-tail-mvp`）的关系

| 项 | 处置 |
|---|---|
| 入池 / 留池 `rd1..40` / 锚点（同股最早未过期）/ 状态账 | **复用**（`@experiments/shared/rollingPoolRightTail`，逐字节未改） |
| 因子口径 `preReturn10`（`close(rd−1)/close(rd−10)−1`） | **复用**（`deriveEventFactors`） |
| `maxAmp5` | **完全不参与**（规则 §1）：`MaxAmp5Computer` 恒返回 `null`，不读任何振幅特征 |
| round-1 的 `signalEligible` | **不使用**：它要求 `maxAmp5` 可评估 ⇒ 实际下界 `rd15`，照搬会让 T+10 之前的候选**恒为空**（S1 §1.2） |
| 收益标签（假设下一日开盘持有 20 日） | **替换**为真实账户执行（T+1 撮合 / 成本 / 持仓上限 / 20% 权益预算 / 冻结退出政策） |

## 买点（新研究假设，不是已验证买点）

规则库唯一实现：`@experiments/shared/rollingPoolEarlyEntry#evaluateEarlyEntry`。
处理顺序（目标 §4，分层不可混淆）：

```
当日池成员（rd1..40）
  → 数据资格（OHLCV 完整 / 非停牌 / 非零量）              ← 只用当日及之前
  → 观察分 S_d（四项单列）+ 六条件触发                     ← 只用当日及之前
  → 因子可评估（preReturn10 缺失 ⇒ R 与 Random 共同不进入）
  → 原始买点候选池（两臂完全相同）
  → 排序（R = preReturn10 降序 + symbol/eventId 破平）或随机（200 固定种子，均匀无放回）
  → 账户约束（同股持仓 / 空位 / 每日名额 / 现金 / 20% 权益预算）
  → 次一交易日开盘真实撮合（锚点 rd ≤ 10）
```

| # | 条件 | 实现 |
|---|---|---|
| 1 | `∃j∈[1,d−1]` 使 `C_j < C_0` | `pullbackFirstRd`（只用 j ≤ d−1） |
| 2 | `min(L_1..L_d) ≥ 0.98·O_0`（**路径**） | `supportBreachRd`（破位永久作废）+ `supportPathIncomplete` |
| 3 | `S_(d−2) ≥ 3 ∧ S_(d−1) ≥ 3` | 四分量各 1 分，两日都必须可评估 |
| 4 | `C_d > max(H_(d−2), H_(d−1))` | 收盘突破确认 |
| 5 | `V_d ≥ V_(d−1)` | 量能回升（独立于缩量） |
| 6 | `d ∈ [3,9]` 且存在 `rd ≤ 10` 的成交日 | `CONFIRM_MIN_RD / CONFIRM_MAX_RD / ENTRY_FILL_MAX_RD` |

🔴 **本轮必须声明 `volume` 列**：不声明 ⇒ 恒 `null` ⇒ 每个观察日都不可评估（`ZERO_VOLUME`）。

## 冻结配置

| 项 | 值 |
|---|---|
| Dataset | `780004` · `first_limit_pullback` · `v10-listed365-pre10-post80`（`READY`） |
| 主决策窗口 | `2024-01-02 ~ 2025-09-30`（与 round-1 同一窗口，**不是**新 OOS） |
| 读入 | `prefix rd −10/−1/0`；`post rd 1..80` |
| 每日候选 | ≤ 3（人数不足**不补齐**）；破平 = `symbol` 升序 → `eventId` 升序 |
| 账户 | 初始资金 100,000；最大并发持仓 5；每日最多新买 2；每笔 = 决策日收盘总权益 × **20%** |
| 成本 | 复用参考 Run 6210006 的真实账户成本（佣金 0.00025 / 印花税 0.0005 / 过户费 0.00001 / slippage 5bps / lotSize 100 / minCommission 5） |
| 退出 | **只继承** `strategy_versions.id=3600005` 的 `definition.exit`（`candidateExitPolicy=DISABLED` + 统一退出策略 + `runnerBridge{NEW_HIGH_3,5,74}`）与 `executionAssumptions`；指纹 `f6b61472…` 逐字符断言 |
| 仓位 | 统一 `EQUITY_RATIO` / `equity-fraction 0.20`（旧 3F 评分分档仓位 0.05/0.20/0.25 **不继承**） |
| 两臂 | `R` = `preReturn10` HIGH；`Random` = 同日同池同人数均匀**无放回** × 200 固定种子（`seedIndex = 20261010 + i`，每个种子 = 独立账户） |
| 统计 | 日期移动块 bootstrap（block20 主 / block40 敏感性 / 1000 次 / 固定种子）、95% 双侧 |

## 🔴 真实股票身份（目标 §2「不能通过不同 eventId 绕过」）

- Dataset 端口的 `symbol` 是**代码不是身份**；身份由 `resolveRollingPoolSecurityIds()`（唯一解析实现）给出 canonical `sec_<uuid>`。
- 既有约定会给每个事件拼 `::event:<code>@<date>` 后缀；**本实验刻意不使用该后缀**：
  `planDecisionDay` 的 `holdingSet` 按 `securityId` 判定「已持仓不加仓」，若同股两个事件用两个不同 id，
  同一只股票会被**重复建仓**。
- 因此 `securityId` = canonical **base** id，且所有执行/退出行按 `(tradeDate, baseSecurityId)` **去重**
  （同股重叠面板保留 `eventId` 升序的第一个 bar；值冲突如实计数）。
- 代价：放弃 `::event:` 消歧（同股重叠面板不再有独立行身份）。这是**有意**的取舍，写进 `customPayload.contractGaps`。

## 🔴 事件级「首发优先」

规则库返回**全部**确认日（规则 §4 允许「未成交后重新触发再参与排名」）。但 `sourceRun` 必须在
**撮合之前**组装完成、拿不到成交事实 ⇒ 本轮采用**首发优先**：每个锚点只在其**最早**确认日进入候选一次。
这自动满足目标 §5「同一锚点最多一次成功建仓」，代价是放弃「首次未成交后的重试」——如实披露，不伪称已实现。

## 🔴 成交截止 T+10（硬门禁）

`fillRd = confirmRd + 1 ≤ 10` 由规则库保证；账户层**再断言一次**：
`confirmRd + 1 > 10` 的意图**一律不进入** `sourceRun`，出现任一条即**中止**（不静默顺延）。
结果里报 `tPlusTenViolationCount`（必须为 0）。

## 🔴 数据覆盖：不能截短 Runner

780004 物理 `post ≤ rd80`；「rd4..10 成交 + Runner 续持至 74 持有日」最远约 `rd84`
⇒ 期末仍未平仓者按**最后有效收盘 MTM** 收尾。引擎**没有**覆盖信号（S3 门禁 B），
因此实验侧自检并标记 `DATA_COVERAGE_BLOCKED`：

- `openAtEnd === true` 的笔数；
- 持有期达到 Runner 续持上界（74 持有日）的笔数；
- 两者交集。

**不**缩短 74 日政策、**不**在 rd80 强制卖出、**不**剔除需要长持有的赢家（目标 §6 处置 C-1）。

## 产物

> 产物 `name` **只写文件名**（角色段由平台拼：Object Key = `experiments/<id>/runs/<runId>/<role>/<name>`）。

| 产物（role: name） | 内容 |
|---|---|
| `result.json`（信封） | 逐账户指标（R + 200）、尾部读数与配对差、随机分布、覆盖账、年度分层、逐日候选池、判定 |
| `table: candidate-days.csv` | 两臂共同的原始买点候选池（含 200 次抽样被抽中次数） |
| `table: observation-ledger-<year>.csv` | 逐事件逐观察日评分账（四项**单列**；不可评估日 `score=null` + 原因） |
| `table: random-draws.csv` | 200 次随机抽样的逐次成员（种子可复现） |
| `table: account-metrics.csv` | 逐账户指标（唯一出口 `canonicalMetrics`） |
| `table: account-trades-R.csv` / `table: account-trades-part-NN.csv` | 交易台账（按账户分片，避免单产物超 64MB） |
| `artifact: early-entry-runner-config.json` | 冻结配置、坐标、执行投影规模与全部边界断言计数 |

## 契约缺口（如实登记，本轮不修）

1. `decisionOffsetDays` 是**单标量** ⇒ 逐日决策坐标只能由内存投影表达；本实验声明 `10`（成交上界）。
2. `observation(rd)` 无 `eventId` / 日期参数 ⇒ 逐日池只能从「整层 rd」投影；`freezeSelection` 一次性。
3. 逐日 ST / 上市龄不在 Dataset 端口内 ⇒ 事件日口径由构建期保证；逐日 ST 记 `UNAVAILABLE`。
4. 🔴 **Dataset 端口不提供成交额 `amount`** ⇒ 执行滑点只能走 base 5bps，缺少引擎的流动性分层加成
   （`amountAdjustedSlippageBps`：<1 亿 +20bps 等）⇒ 相对参考 Run 6210006，成本被**系统性低估**。
   不伪造 `amount`（那等于编造成本输入）。
5. `executionSurface` 保持缺省 `SINGLE_EVENT`（S3：`COMPOSITE_PORTFOLIO` provider 不可用）；
   本实验经零实现桥调用既有唯一引擎，**不新建**引擎 / 指标出口 / 策略语义。

## 复现与验收

```bash
pnpm run check
pnpm exec vitest run tests/server/researchExperiments/rollingPoolEarlyEntryRunner.test.ts
```

单元测试只用**合成 fixture**（手建 `ResearchDataset` + 手建 `sourceRun`），**不碰真实 DB / Dataset 端口**。
真实 Run（780004 + 3600005）由 Lead 在 S5 阶段执行。
