# PRE-REG · 漏选与卖出过早归因（`FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001`）

> 承接 [`RESULT-FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003.md`](RESULT-FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003.md)
> 与正式 Run **`RUN-20261010-572243F5`**（COMPLETED / SUCCEEDED / 70 产物）。
> **本文件在实现之前冻结**：标签定义、漏斗分桶、优先级、输出口径。
> 🔴 **纪律**：本文任何「未来信息」只用于**事后归因**；**绝不回流**改动资格、评分、排序、仓位、退出或任何规则。
> 归因结果**不得**用作调参依据（需另立任务与新授权）。

---

## 1. 要回答的问题

**把「后来大涨」的股票分清：支撑破位被永久排除、评分不达标、排序未选中、账户无法买入，
还是买入后提前退出。**

⇒ 需要一个**互斥漏斗**：每条机会只能落进**一个**桶，且桶的判定顺序 = 决策链的真实执行顺序。

---

## 2. 数据来源（全部为**已持久化产物 + 只读行情**，不重跑实验）

| 用途 | 来源 | 关键列 |
|---|---|---|
| 逐日观察分 / 破位 / 触发组 | `RUN-…/tables/observation-ledger-{2023,2024,2025}.csv` | `anchorEventId, symbol, eventDate, relativeDay, tradeDate, support, shrink, lowStable, closeImprove, score, missingReason, supportBreached, triggerGroups, isCandidateAnchor` |
| 触发日 / 因子 / 计划成交日 | `RUN-…/tables/group-{A..E}-candidate-days.csv` | `date, anchorEventId, symbol, securityId, eventAge, confirmRd, fillRd, fillDate, preReturn10, triggerOrdinal, isLaterTriggerDay` |
| R 的实际成交与退出 | `RUN-…/tables/group-{A..E}-trades-R.csv` | `securityId, anchorEventId, entryTime, entryPrice, exitTime, exitPrice, returnPct, netPnl, fees, holdingPeriod, openAtEnd, reason` |
| 账户**为何买不到** | `RUN-…/tables/group-{A..E}-reentry-failed-attempts.csv` | `accountId, anchorEventId, attemptedConfirmDate, plannedFillDate, skipCode, reason, priorEntryOrdinalActual, priorActualExitDate` |
| 池规模 / 每日 R 选中数 | `RUN-…/tables/pool-daily-summary.csv` | `date, poolSize, candidateA..E, rSelected` |
| 逐层排除计数 | `RUN-…/tables/group-{A..E}-exclusion-ledger.csv` | `group, layer, code, count, unit, note` |
| **未来行情（标签用）** | Dataset `780004` **只读** `ds_first_limit_pullback_post`（rd1..80） | `eventId, relativeDay, tradeDate, open, high, low, close` |

**参考组 = D**（`N=5 / L=20 / SIGNAL_REENTRY`，即 003 的主配置）；A/B/C/E 作为对照同表输出。

---

## 3. 🔴 标签定义（事前冻结；只用于归因）

### 3.1 主标签 `BIG50_ACTIONABLE`（**进入漏斗的机会**）

对某锚点的某个**触发日** `d`（来自 `candidate-days`，即真实计划成交日 `fillRd = d+1`）：

```
max( close(rd_{d+1} … rd_{d+1+20}) ) / open(rd_{d+1}) − 1  ≥  +50%
```

含义：**如果我们按其真实计划成交价（次一交易日开盘）入场，其后 20 个交易日确实提供了 ≥+50% 的空间**。
⇒ 这正是「我们本可抓到、但没抓到」的机会。

**机会单元** = `锚点事件 × 首个满足上式的触发日`（每个锚点最多贡献 1 条机会）。
若同一锚点有多个触发日均满足 ⇒ 取**最早**的那个（最早可入场时点）。

### 3.2 背景标签 `BIG50_PATH`（**不进漏斗**，仅报数量）

```
max( close(rd1 … rd40) ) / close(rd0) − 1  ≥  +50%
```

含义：该股首板后确实大涨，**与我们的入场时点无关**。用于回答「大涨的股票里有多少根本不在我们的可入场集合内」。

### 3.3 稀疏层级

同口径再报 `BIG100_ACTIONABLE` / `BIG50_ACTIONABLE_H20` 的变体（+100% 阈值）作为稀疏性检查；
**不因样本少而放宽阈值**。

---

## 4. 🔴 漏斗分桶（**互斥；1→8 首次命中即止**）

| 序 | 桶 | 判定 | 依据 |
|---:|---|---|---|
| 1 | `S1_SUPPORT_INVALIDATED` | 该锚点在**首个满足条件的触发日之前**已有 `supportBreached = true`（或终态 `INVALIDATED_SUPPORT`） | `observation-ledger` |
| 2 | `S2_SCORE_INSUFFICIENT` | 未破位，但从未触发且首要拒绝原因是 **N 日观察分不足**（`PREV_TWO_DAY_SCORE_INSUFFICIENT`） | 规则库终态 + `exclusion-ledger` |
| 3 | `S3_NO_OTHER_TRIGGER` | 未触发，原因为 `NO_PULLBACK_YET` / `NO_CLOSE_BREAKOUT` / `VOLUME_NOT_RECOVERED` / `SUPPORT_PATH_INCOMPLETE` | 同上 |
| 4 | `S4_NOT_RANKABLE` | 触发过，但**该触发日** `preReturn10` 缺失（无法进入排序） | `candidate-days`（`preReturn10` 空） |
| 5 | `S5_RANK_NOT_SELECTED` | 触发且可排序，但**所有**触发日在 R 的**当日横截面排名 > TopK(3)** | 由 `candidate-days` 逐日重排（`preReturn10` 降序 → symbol 升序 → eventId 升序），并用 `pool-daily-summary.rSelected` 交叉校验 |
| 6 | `S6_ACCOUNT_UNABLE_TO_BUY` | 至少一次进入 R 的 TopK，但 R 账户**该锚点无成交**。再按**首要原因**细分：<br>`S6a_CAPACITY`（`MAX_POSITIONS_REACHED`）<br>`S6b_SAME_STOCK`（`CONCURRENT_CODE_POSITION_LIMIT`）<br>`S6c_REENTRY_BLOCKED`（`MEMBER_ENTRY_LIMIT_REACHED`，仅 E 组可能）<br>`S6d_NO_FILL`（计划成交日无可行 bar / 涨停 / 停牌）<br>`S6e_OTHER`（现金、整手、无次一交易日…） | `reentry-failed-attempts` 的 `skipCode` + `trades-R` 缺失 |
| 7 | `S7_BOUGHT_EXITED_EARLY` | R **买过**该锚点，且 `returnPct < +20%`，而**入场后 20 个交易日的最大收盘涨幅 ≥ +50%**。再按 `reason` 细分：`止损` / `MA_CROSS`（趋势出场）/ `时间退出` / `strongHold` / `期末` | `trades-R` |
| 8 | `X_CAPTURED` | R 买过且 `returnPct ≥ +20%`（对照桶：系统确实抓到了一部分） | `trades-R` |

**优先级理由**：桶序 = 决策管线施加顺序（池 → 支撑 → 观察分 → 突破 → 因子可评估 → 排序 → 账户 → 退出）。
首次命中即止 ⇒ 每桶的计数 = 「**卡在这一层、且后面本有机会**」的机会数，可直接读作「这一层的漏失量」。

---

## 5. 🔴 必须分开统计的两类「被阻断」（目标 (d)）

| 情形 | 归属 | 说明 |
|---|---|---|
| **支撑破位永久失效** | `S1` | 规则本身导致，**与本账户是否买过无关**，且**不恢复** |
| **因曾被买入而阻断** | `S6c`（仅 `SINGLE_ENTRY`） | 账户政策导致；A–D 组 `maxEntriesPerMember = null` ⇒ **结构上不可能出现** |

另出**交叉表**：`S1` 桶中「同时曾有过真实成交（`trades-R` 有该锚点记录 / `priorActualExitDate` 非空）」的机会数 ——
这类机会**两个原因并存**，报告时必须拆开，**不得**把「后续上涨」直接说成「因为买过而错过」。

---

## 6. 输出（口径冻结）

1. **漏斗主表**：桶 × 机会数 × 占 `BIG50_ACTIONABLE` 的百分比，**参考组 D**；A/B/C/E 同表对照。
2. **每桶的未来收益画像**：该桶机会的 `max20`（入场后 20 日最大涨幅）中位/均值/分位。
3. **`S7` 的「让出多少」量化**：逐笔 `realized returnPct` vs `max forward return（自入场起 20 日）`，
   报**让出额**的合计/中位/均值，并按退出原因分组。
4. **`S6` 的原因分布**：`skipCode` 计数 + 占 `S6` 的百分比。
5. **逐机会 CSV**：`anchorEventId, symbol, eventDate, big50Path, big50Actionable, bucket, subReason,
   triggerDays, rRankBest, rSelectedDays, tradeEntryDate, tradeExitDate, tradeReturnPct, exitReason,
   maxForwardFromEntryPct, giveUpPct`。
6. **不可观测项单列**：Runner **触发与否不可观测**（沿用 003 结论）；
   `S7` 的「是否本可续持更久」**不能**据此推断。
7. **诚实声明**：标签为**事后**口径；漏斗只描述「在哪一层失去」，**不证明**任何改动会改善结果；
   覆盖窗口 2024-01-02 ~ 2025-09-30（**探索性，非 OOS**）。

---

## 7. 硬边界

- ❌ 不改历史 Run / 旧 Dataset / 策略版本；不改 `server/**` 执行语义。
- ❌ **不重跑**五组矩阵（复用 `RUN-20261010-572243F5` 的持久化产物）；行情只做**只读** SELECT。
- ❌ 不据归因结果**反改**任何规则、阈值、N/L、TopK、仓位或退出参数。
- ✅ 归因实现放在**版控内工具**（`tests/tools/**`）+ 纯分析库（`research-experiments/shared/**`），
  不新增实验、不新建引擎或指标出口。
