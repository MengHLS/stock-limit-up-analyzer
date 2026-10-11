# 首板滚动池 × 连续观察窗口（N × 最晚成交 L） × 再入场政策 × 固定 Runner

> 任务标识：`FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003`
> 规格：`docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003.md`
> 规则：`docs/research/RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md`（本轮按目标 §3.2 覆盖「固定两日 / T+10」）
> 前序：`rolling-pool-right-tail-mvp`（round-1）、`rolling-pool-early-entry-runner`（round-002，**未改动**）

本实验**只新增一个实验目录**，不修改 round-1 / round-2 的任何实验文件，也不修改 `server/**`、`docs/**`、
Dataset / Run / 策略版本。共享能力的扩展一律是**向后兼容的追加**（规则库 N/L 参数化、配对 bootstrap 原语、
桥的零实现 re-export）。

---

## 1. 唯一研究问题

把**连续观察窗口 N**（2 / 3 / 5 日）与**最晚实际成交期限 L**（T+10 / T+20）拉开后：

1. 相对「同日同池**随机选择**」的**排序/选择增量**是否仍成立？
2. 允许**平仓后由新买点再次入场**（SIGNAL_REENTRY）相对「一次入场」（SINGLE_ENTRY）的净增量是什么？

**唯一主要比较 = `D_R − B_R`**（同 T+20、同允许再入场下，5 日观察 vs 2 日观察的 ≥+20% 尾率差）。
`D_R − E_R`（再入场增量）、`B_R − A_R`（期限延长）、`C_R − B_R`（三日观察）与各组 `R − Random`
都是**次要 / 描述性**读数，不作为独立确认性判据。

---

## 2. 五组矩阵（**一个正式 Run** 内全部执行）

| 组 | N | L | 确认 rd | 再入场政策 | 用途 |
|---|---:|---:|---|---|---|
| A | 2 | T+10 | 3..9 | SIGNAL_REENTRY | 原期限参照（**已允许再入场** ⇒ 不是 round-002 的精确重跑） |
| B | 2 | T+20 | 3..19 | SIGNAL_REENTRY | 单独观察延长期限的影响 |
| C | 3 | T+20 | 4..19 | SIGNAL_REENTRY | 三日观察对照（描述性） |
| D | 5 | T+20 | 6..19 | SIGNAL_REENTRY | 五日观察**主配置** |
| E | 5 | T+20 | 6..19 | SINGLE_ENTRY | 与 D 同买点池，量化「禁止再次入场」的代价 |

- 每组 **R + 200 个固定种子 Random = 201** 个账户 ⇒ 合计 **1005**；全部**独立**（从 100,000 元各自起步，
  不承接任何持仓与现金）。
- Random 种子 = `20261010 + i`（i = 0..199）⇒ **五组同一个 i 是同一个「随机账户编号」**。
- 五组**共享一次端口读取**的滚动池（事件扫描 / prefix rd −10,−1,0 / post rd1..80 各一次）；
  只有 N / L / 再入场政策随组变化。
- `N=2/3/5` 的最早可能成交分别是 T+4 / T+5 / T+7，**不是固定买入日**（由历史成熟决定）。

---

## 3. 买点规则（唯一变动 = N 与 L）

`S_j = 1[L_j ≥ 0.98·O_0] + 1[V_j ≤ 0.50·V_0] + 1[L_j ≥ L_{j-1}] + 1[C_j > C_{j-1}]`

确认日 d 收盘后必须同时满足：

1. `N+1 ≤ d ≤ L−1`；
2. 存在 `j ∈ [1, d−1]` 使 `C_j < C_0`（确实回撤过）；
3. `min(L_1..L_d) ≥ 0.98·O_0`（支撑全程未失守，**可靠破位永久作废该锚点本轮资格**）；
4. 紧邻确认日的 **N 个**观察日 `d−N..d−1` **每天分别** `S_j ≥ 3`（都必须**可评估**，停牌/零量不跳过）；
5. `C_d > max(H_{d−2}, H_{d−1})` —— **突破参照恒为前两日高点，不随 N 改成前 N 日**；
6. `V_d ≥ V_{d−1}`。

🔴 **保留全部确认日**（修正 1）：每个决策日只要触发就产出候选；「不是首个确认日」只记
`LATER_TRIGGER_DAY_RETAINED`，**不**丢弃。引擎的持仓 + 再入场政策决定它最终是否成为一笔成交。

---

## 4. 账户、执行与退出（与 round-002 一致）

| 项 | 冻结值 |
|---|---|
| 初始资金 | 100,000 元 |
| 持仓上限 / 每日新买 | 5 / 2 |
| 仓位 | **决策日收盘总权益 × 20%**（`EQUITY_FRACTION`，不是初始本金比例） |
| 候选退出 | `DISABLED` |
| 退出政策 | 继承 `strategy_versions.id = 3600005`（`first-limit-pullback-3f-top3-runner-t74@2.0.0`，指纹 `f6b614…fef3c`） |
| 撮合 | 唯一入口 `runTradeSimulation`；成交价 = 次一交易日开盘价 |
| 指标 | **唯一出口** `canonicalMetrics` |
| 因子 | 只排序已触发候选：R = `preReturn10` 降序（破平 symbol 升序 → eventId 升序）；`maxAmp5` **完全不参与** |

### 4.1 🔴 修正 2：事件作用域证券身份

`securityId = sec_<uuid>::event:<symbol>@<eventDate>`（平台自身惯例，
`server/eventIdentity.ts#eventScopedSecurityId`）。为什么这不是 hack：

- `server/research/panelIdentity.ts#panelCodeOf` 会把 `::event:<code>@<date>` **剥回 symbol**
  ⇒ `ReentryPolicy.maxConcurrentOpenPerCode = 1` 仍然约束**同一真实股票**的并发持仓；
- `maxEntriesPerMember` 的次数键是 `securityId` ⇒ 恰好等于「账户 ＋ **锚点事件**」，正好是 E 组语义；
- 行唯一性仍是 `(tradeDate, securityId)` ⇒ 同一只股票的两个重叠锚点在同一交易日**合法地**产生两行。

### 4.2 🔴 修正 3：`reentryPolicy` 与「组内字节相同」

| 组 | `securityCooldownTradingDays` | `maxEntriesPerMember` | `maxConcurrentOpenPerCode` |
|---|---|---|---|
| A/B/C/D | `null` | `null` | `1` |
| E | `null` | `1` | `1` |

`runCompositeRunnerBacktest` **不接受** `reentryPolicy`（它在更底层的 `SimulationConfig` 上）。因此每组：
先调用**一次**该函数拿到权威装配的 `simulationConfig`（它自身跑出的 run **不进入**结果），
再对**全部 201 个账户（含 R）**用**同一个对象引用**调用 `runTradeSimulation`。
运行期断言：五组的装配配置（去掉 `name`）字节相同；组内 201 个账户的 `run.config` 快照字节相同。

### 4.3 🔴 修正 4：`amount` 透传（单位千元）

`requiredColumns.observation` 声明 `amount`；`normalizeBar` 取真实值；执行投影写 `amount: bar.amount`
（不是 `null`），并把它计入 bar 值冲突比较。引擎据此走 `amountAdjustedSlippageBps` 的流动性分层
（< 100,000 千元 ⇒ +20 bps；< 500,000 ⇒ +10；< 2,000,000 ⇒ +5；否则基础值）。缺值如实为 `null`（回落基础滑点），**不填 0**。

---

## 5. 统计（修正 5 / 8）

- **配对日期移动块 bootstrap**（`research-experiments/shared/dateClusterBootstrap.ts` 的**唯一**实现）：
  全部比较臂共享**同一组交易日块索引**；分子（hits）/ 分母（completed）/ 收益和（sumReturn）在**同一个日期簇**内一起重采样。
  1000 次、95% 双侧（`DEFAULT_BOOTSTRAP_QUANTILES`）、block20 主（种子 20261010）/ block40 敏感性（种子 20261011）。
- 另有**配对均值差**与「**整条锚点链归属其首笔入场日**」的敏感性。
- 零分母迭代次数（`zeroDenominatorIterations`）与越界观测数（`ignoredObservationCount`）逐项单列。
- 日历 = 执行投影的**完整交易日序列**（含无入场日）。
- **年度判据换靶（修正 5）**：同向判据用 `tail20RateDifference`（**实际成交 ≥+20% 尾率差**），
  只看 **2024 / 2025**；账户年度权益收益在**另一张表**里报告。
  2026 只有在主决策窗口内确有新入场时才进闸门，否则只作退出尾部单列。

### 5.1 收口规则（事前冻结）

- 主比较需 `D_R`、`B_R` 各 ≥ **50 个唯一 ≥+20% 命中锚点** 且日期重采样有足够有效观测；否则 `INSUFFICIENT_EVIDENCE`。
- 称「本窗口五日观察有右尾改善证据」必须同时满足：主尾率差 95% 区间下界 > 0、block40 不反向、
  2024 与 2025 同靶差均为正。这是**探索性历史证据**，**不能**升级为 OOS 通过。
- 尾率改善但单笔均值 / 账户复合收益恶化 ⇒ `RISK_TRADEOFF`（分开结论，不能称可交易）。
- 零买点 ⇒ `NO_TRIGGER_IN_WINDOW`（尾率不可定义，空仓收益 0；不是数据失败，也不是有效性通过）。

---

## 6. 覆盖与可观测性（修正 6 / 7）

- **`openAtEnd` 三分类**（实验侧**启发式**，因为引擎不暴露「行情用尽」与「停牌卖不掉」的区别）：
  - `MTM_VALID`：`openAtEnd === true && exitPrice !== null` ⇒ **正常期末 MTM**（不是数据缺口）；
  - `SUSPENDED_CANNOT_SELL`：反查到「卖不出去」的证据（`run.audit.orders` 的卖出 `REJECTED` 且理由 ∈
    {SUSPENDED, LIMIT_DOWN, NO_LIQUIDITY}，或 `run.skipped[].code` ∈ {FROZEN_EXIT_DEFERRED,
    NO_NEXT_TRADING_DAY, ZERO_VOLUME}）—— **运行级 + 证券级**，不是逐笔因果；
  - `NO_EXECUTION_BAR`：`openAtEnd === true && exitPrice === null`。
  - 两类判据可能重叠，重叠笔数单列（`mtmValidWithRejectedSellEvidenceCount`）。
- 另报 `requiredPostRelativeDayForFullRunner = L + 74` 与 `physicalPostMaxRelativeDay = 80`。
- **Runner 可观测性 = `UNOBSERVABLE`**：`runnerBridgeExtendedToBySecurity` 是引擎内的**函数局部 Map**
  ⇒「触发过」「触发后提前退出」在 `TradeSimulationRun` 上**不可区分**。
  只报 `heldToExtendedCapCount`（`holdingPeriod ≥ 74` 或退出原因命中 `Runner Bridge持有满<k>个交易日`）。
  **绝不**写「Runner 从未触发」，也**未**做退出消融（Runner 的因果贡献**未量化**）。

---

## 7. 产物

### 7.1 信封表（页面直接渲染）

`observation-window-group-overview` / `-tail-rates` / `-paired-bootstrap` / `-candidate-headcount` /
`-fill-age` / `-nl-boundary` / `-exclusion-ledger` / `-reentry` / `-reentry-anchors` /
`-yearly-tail` / `-yearly-account-returns` / `-coverage` / `-random-distribution` / `-daily-pool` /
`-account-metrics`（1005 行） / `-verdicts`。

### 7.2 文件产物（`context.artifact`，逐行明细）

| 名称 | 内容 |
|---|---|
| `group-<A..E>-accounts.csv` | 201 × 组：canonical 指标 + 再入场 / 覆盖计数 |
| `group-<g>-candidate-days.csv` | 原始买点候选池（**含全部确认日**） |
| `group-<g>-reentry-ledger.csv` | 再入场账：`accountId, group, anchorEventId, symbol, entryOrdinal, previousActualExitDate, newConfirmDate, newFillDate, entryEquity, targetBudget, exitReason, netPnl` |
| `group-<g>-reentry-failed-attempts.csv` | 未成交 / 被阻断的建仓尝试（**不**增加序号） |
| `group-<g>-exclusion-ledger.csv` | 逐层排除账（观察 → 回撤 → 支撑 → N 日得分 → 突破 → 候选 → 信号 → 下单 → 成交 → 退出）；**首次失效**与**重复拒绝日**分开 |
| `group-<g>-p3-ranking-diagnostics.csv` | P3：不同取值数 / 最大取值占比 / 边界并列规模 / 破平键 |
| `group-<g>-fill-age-distribution.csv` | 成交年龄分布 |
| `group-<g>-trades-R.csv`、`group-<g>-trades-random-part-<nn>.csv` | 交易台账（按账户分片） |
| `observation-ledger-<year>.csv` | 逐事件逐观察日四项分项（跨组共享；`triggerGroups` 标出确认组） |
| `coverage-observability.csv` | 三分类 + Runner 可观测性（分组 + 合计） |
| `pool-daily-summary.csv` | 逐日池大小与各组候选数 |
| `paired-bootstrap.csv` | 全部比较 × 四个口径的区间与零分母 / 越界观测 |
| `frozen-config.json` | 冻结配置、Dataset 事实、种子、执行契约、组级 `configSnapshot`、实现指纹 |

🔴 与 round-002 的一处**有意不同**：逐行明细**不**进 `customPayload`（round-002 把
`candidateDays` / `randomDraws` 整包放进 payload；五组会把它放大 5 倍并触到 `result.json` 的 8 MiB 配额）。
关键数字仍然全部在 `tables` / `statistics` 里。

---

## 8. 测试

`tests/server/researchExperiments/rollingPoolObservationWindow.test.ts`（纯合成 fixture，**无 DB、无 Dataset 端口**）覆盖：

- N=2/3/5 的最早确认日与最早成交日；T+19 确认 ⇒ T+20 成交**允许**，T+20 确认 ⇒ T+21 **禁止**；
- 中间无效（停牌/零量）日**打断** N 连续要求；N 日合格但未突破 ⇒ **不触发**；突破仍看**前两日**高点；
- **全部确认日保留**（3 个确认日的 fixture ⇒ 3 个候选）；
- E 阻断同锚点第二次入场、D 允许；**同股不同锚点**不被 E 误伤；`maxConcurrentOpenPerCode=1` 约束同真实股票；
- `amount` 进入执行行并在真实 `runTradeSimulation` 上产生滑点差异；
- 配对 bootstrap 的零分母计数与共享日历配对；`openAtEnd` 三分类；确定性输出。

---

## 9. 运行

在「独立实验」列表里选择本实验 → Dataset `first_limit_pullback` /
`v10-listed365-pre10-post80`（期望 `datasetVersionId = 780004` 且 READY）→ 运行。

> 长任务进度：置环境变量 `OBSERVATION_WINDOW_PROGRESS=1` 可把进度写到 stderr（**不改变研究语义**）。
> 正式 Run（1005 个账户）由 Lead 执行；本目录**不**自行触发正式 Run。

## 10. 已知偏差与限制

- 与 round-002 的差异**同时**包含「8 条修正」与「再入场政策」⇒ 旧 002 → 新 A 不能宣称是纯修正归因，
  也不能把旧收益直接与新组相减。
- 支撑永久破位仍然不复原 ⇒ 「止损后跌破首板支撑、后来收复」的路径仍可能无法再次入场；
  本轮把这类事件与「仅因曾经买过而被阻断」事件**分开统计**，但不取消支撑门。
- `decisionOffsetDays = 20` 是**上界声明**（单标量契约缺口），逐日坐标由内存投影表达。
- 期末未平仓按最后有效收盘 MTM 收尾；不缩短 74 日 Runner 政策、不在 rd80 强平、不剔除长持赢家。
