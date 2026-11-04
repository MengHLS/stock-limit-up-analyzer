# PLAN-12F-COMPOSITE-001 · 十二因子等权综合评分实验规格（第一版）

> **状态 = 已实施（代码已落，待跑 Run）** · 编制日期 **2026-09-25**
> **契约**：`docs/research/FROZEN-BUCKET-CONTRACT-001.md`（桶边界 / 方向表 / 权重，**FROZEN**）
> **实验 id**：`first-board-pullback/twelve-factor-composite-study`
> **输入**：`FIRST-BOARD-PULLBACK-EXPERIMENT-CURATION.md`（12 组冻结桶的来源）· `FROZEN-BUCKET-CONTRACT-001.md`（契约）
> **与既有方案的关系**：本文件只定义「十二因子等权综合评分」这一条新增实验；`PLAN-FACTOR-EXP-001.md` 的 Phase 0（首板收口）/ Phase 3（正交性）/ Phase 4（逐层叠加）**不受影响、也不被本文件取代**。
>
> **用户已锁定（继承，不重开）**：① 第一版做**等权**综合评分，**不做权重优化** ② 六条 Frozen Bucket Contract 全部生效 ③ 每轮结论必须与既有实验横向比较 ④ 必须输出结果 md。

---

## 1. 一句话定义

> 把 12 个**已冻结**的首板因子各自按**桶位**映射成分数，**等权**（各 `1/12`）求和得到 `composite ∈ (0,1)`；
> 在**同一份样本、同一入场/退出、同一成本**下看 `composite` 的十分位净收益是否单调，
> 并与 12 个单因子分桶结果**逐一对齐比较**。
> **不做归因、不做权重优化、不重估边界**。

---

## 2. 坐标系（冻结）

| 项 | 取值 | 理由 / 出处 |
|---|---|---|
| Dataset | `first_limit_pullback` / version label **`v5`** | 由 `withFirstBoardPullbackFoundation` 强制（`wrapExperiment.ts:31-32` + `foundation.ts:32-42` 的 `assertCoreDatasetV5`） |
| 事件定义 | `v5` 全部事件（首板语义）；去重 `eventId`；按 `(tradeDate, eventId)` 升序 | 与 22 个首板实验同源，才可能横向比较 |
| 事件过滤 | 见 §2.1 | — |
| **入场** | **`T+6` 开盘价** | 🔴 F4/F5/F6/F10 用 `T+1..T+5` 的信息 ⇒ 决策时点必须晚于 `T+5`；`T+6` 是既有实验里现成的锚（`entry-aligned-exit-horizon-study`） |
| **退出** | 主口径 **`T+10` 收盘**（= holding day 5）；`T+10` 不可卖 ⇒ 取 `T+11..T+20` 内**第一个可卖收盘**；20 日内无 ⇒ 剔除 | 沿用 `entry-aligned-exit-horizon-study` 的「目标退出日不可卖则顺延」规则 |
| 持有期曲线 | holding day `1..5`（`T+6..T+10`） | 本版只输出这一条曲线；更长视界属契约 §5.2 可变项 |
| 成本 | 往返 **20 bps**（`DEFAULT_FOUNDATION_COST` 四项合计 = 2.5×2 + 2.5×2 + 2.5×2 + 5） | 首板侧统一口径，**不**采用组合侧分层滑点 |
| Bootstrap | 日期聚类 Moving Block：`1000` 次 / `block = 20` 交易日 / **固定种子 `20260925`** | 唯一实现 `shared/dateClusterBootstrap.ts`，不重写 |
| 判定阈值 | 桶/档内可用样本 **`< 100`** ⇒ 强制「样本不足」，不给判定 | 与 `PLAN-FACTOR-EXP-001 §4` 同一阈值 |

### 2.1 事件过滤（逐条，按顺序）

| # | 条件 | 排除码 |
|---|---|---|
| 1 | `isFirstLimit === true` | `NOT_FIRST_LIMIT` |
| 2 | `boardType === "main"` 且 `market ∈ {SH, SZ}` | `NOT_MAIN_BOARD` |
| 3 | 首板日 bar 存在且 `open/high/low/close > 0`，OHLC 结构合法（`high ≥ max(open,close)`、`low ≤ min(open,close)`） | `MISSING_EVENT_DAY_BAR` / `INVALID_EVENT_DAY_OHLC` |
| 4 | `\|close − limitUpPrice\| ≤ 1e-9`（严格收盘涨停） | `EVENT_NOT_EXACT_LIMIT_UP` |
| 5 | `T+1..T+5` 逐日 `barPresent ∧ ¬suspended` 且 OHLC/`limitUpPrice` 合法（因子所需） | `MISSING_FACTOR_PATH` |
| 6 | `T+6..T+10` 逐日 `barPresent ∧ ¬suspended` 且 OHLC 合法（入场 + 主退出所需） | `MISSING_FORWARD_PATH` |
| 7 | `T+6` `canBuyAtOpen === true` | `ENTRY_UNFILLABLE` |
| 8 | `T-1` 与 `T-10` 收盘可得且 `> 0`（F9 所需） | `MISSING_PREFIX_PATH` |
| 9 | 12 个因子**全部非缺失**（F8 的 `UNKNOWN` 是**合法桶**，不算缺失） | `MISSING_FACTOR` |

> ⚠️ **F8 的 `UNKNOWN` 桶评分最低**（`idx=0`，`o=+1`）⇒ 「前次涨停间隔未知」会被判为最差。这是契约 §2 表格已把 `UNKNOWN` 列为桶的直接后果，**报告必须披露**。

### 2.2 样本账守恒（平台强制）

`eligibleCount + excludedCount === candidateCount` 且 `Σ excludedByReason === excludedCount`（否则 `EXPERIMENT_RESULT_INVALID`）。
声明 `FULL_DATASET` ⇒ 必须给 `unscannedEventCount`（`null ≠ 0`）。

---

## 3. 因子派生规格（12 条，逐条冻结）

变量定义：`eventClose` = 首板日收盘；`limitUpPrice_d` = 第 `d` 日涨停价；`preClose_d` = `d=1 ? eventClose : close_{d-1}`。

| # | 因子 | 派生式 | 缺失条件 |
|---|---|---|---|
| F1 | `bodyHeight` | `(eventClose − eventOpen) / previousClose` | `previousClose ≤ 0` 或缺 |
| F2 | `turnover` | `event.turnover`（**百分数**，如 `22.45` 表示 22.45%） | 缺 |
| F3 | `amountPercentile` | 首板日成交额在**同一 `tradeDate`** 样本内百分位 `= count(peer ≤ v) / N`；样本 = **通过 §2.1 第 1~8 条的全部事件**（与 `dynamic-state` 同法） | 首板日成交额缺 |
| F4 | `meanAmplitude` | `mean_{d=1..5} (high_d − low_d) / preClose_d` | 任一日缺 |
| F5 | `maxAmplitude` | `max_{d=1..5} (high_d − low_d) / preClose_d` | 任一日缺 |
| F6 | `holdStreak` | 自 `d=1` 起连续满足 `close_d ≥ limitUpPrice_d − 1e-9` 的天数，遇不满足即断，上限 5 | `limitUpPrice` 缺 |
| F7 | `t1VolumeRatio` | `volume_1 / volume_T` | 任一为 `≤0` 或缺 |
| F8 | `limitGap` | `event.daysSincePreviousLimit`（交易日数）；`null` ⇒ **`UNKNOWN` 桶** | 永不缺失 |
| F9 | `preReturn10` | `close_{-1} / close_{-10} − 1` | 任一 `≤0` 或缺 |
| F10 | `drawdownDepth` | `min_{d=1..5} low_d / eventClose − 1`（恒 `≤ 0`） | 任一日缺 |
| F11 | `t1OpenGap` | `open_1 / eventClose − 1` | 缺 |
| F12 | `historyLimitCount` | `event.historicalLimitCount` | 缺 |

🔴 **F3 的口径注意**：同一 `tradeDate` 的 peer 集合取「已通过第 1~8 条过滤的事件」。这是 `dynamic-state-factor-expansion-study/experiment.ts:313-333` 的既有做法，**沿用、不改**。
🔴 **F3 ≠ 换手率分位**：`turnover` 列是换手率（F2 已用），成交额取首板日 `feature(0).amount`。

桶边界与方向**一律见契约 §2 / §3**，代码里为硬编码常量；实验内**没有任何**分位搜索 / 最优切点 / 聚类。

---

## 4. 评估设计

### 4.1 主输出：`composite` 十分位表

| 列 | 定义 |
|---|---|
| `bucket` / 档 | `D1`（最低）… `D10`（最高），**按 `composite` 秩等份** |
| `sampleCount` / `eventDateCount` | 档内事件数 / 事件日数 |
| `meanNetReturn` | 均值（已扣 20bps） |
| `trimmedMeanNetReturn` | 去最高 5% 后的均值 |
| `medianNetReturn` | 中位 |
| `winRateNet` | 净胜率 |
| `p5 / p25 / p75 / p95` | 分位 |
| `meanMfe` / `meanMae` | 入场后最高/最低浮盈浮亏 |
| `bootstrapCi95Low/High` / `clusterCount` | 日期聚类 Bootstrap 95% CI |
| `verdict` | 三态判定（见 §4.3） |

同时输出 **5 档**（`Q1..Q5`）版本作为单调性读法的稳健性对照。

### 4.2 单调性

- `Spearman ρ`（档序 ↔ 档均值净收益），10 档与 5 档各算一次；
- 头部尾部差 `spread = mean(D10) − mean(D1)`，**并给该差的 Bootstrap 95% CI**；
- ⚠️ `spread` 是**样本内极值**，天然乐观 ⇒ 报告中**不得**当作「有效区间」。

### 4.3 三态判定（写死、可复现）

| 判定 | 条件 |
|---|---|
| `POSITIVE`（有效·正向） | 该档净收益 95% CI **下界 > 0** |
| `NEGATIVE`（有效·负向） | CI **上界 < 0** |
| `INCONCLUSIVE`（不确定） | CI 跨 0 |
| `INSUFFICIENT`（样本不足） | 档内样本 `< 100` ⇒ 强制不判定 |

### 4.4 对照变体：9 因子子评分（契约 §6.2）

剔除 **F6 / F8 / F9**（三个「先验未验证方向」因子）后重算等权子评分，输出同样十分位表。
**判据**：若 `spread_12` 与 `spread_9` 的 CI 都跨 0，或只有 9 因子版显著 ⇒ 说明 12 因子版的信号**不是来自那 3 个未验证方向**。

---

## 5. 横向比较设计（FBC-5）

输出三张对照表：

1. **单因子分桶表**：12 因子 × 各自桶（共 **64 行**），每行给样本 / 事件日数 / 均值 / 中位 / 净胜率 / CI95 —— 与综合评分**同一样本、同一入场退出、同一成本、同一 Bootstrap 参数**。
2. **横向比较表**（12 行，每行一个因子）：

   | 列 | 定义 |
   |---|---|
   | 因子 | code + 名 |
   | 方向置信 | `先验·有证据` / `⚠️ 先验未验证` |
   | 桶数 / 可用桶数 | `k` / `sampleCount ≥ 100` 的桶数 |
   | `spreadSingle` | 可用桶中「最大均值 − 最小均值」；可用桶 `< 2` ⇒ `null` + 标样本不足 |
   | 单因子 CI 是否跨 0 | 该因子最优桶的 CI 下界是否 `> 0` |
   | 原实验结论（定性） | 引自 `FIRST-BOARD-PULLBACK-EXPERIMENT-CURATION.md §5.4` |

3. **综合 vs 单因子汇总行**：`spread_composite`（`D10 − D1`）与 12 个 `spreadSingle` 并列，回答「等权综合有没有比任何单因子更好」。

⚠️ **口径声明**：单因子数字是**在同一份新样本上重算**的结果，**不是**直接引用原实验 Run 的历史数字（两者窗口/样本/入场不同，直接并列不可比）。定性结论才引用原实验。

---

## 6. 交付物

| 类型 | 路径 |
|---|---|
| 实验代码（四件套） | `research-experiments/first-board-pullback/twelve-factor-composite-study/{experiment.ts,result.ts,page.tsx,README.md}` |
| 注册 | `research-experiments/manifest.ts`、`client/src/researchExperiments/pages.ts` |
| Run 产物 | 平台既有机制：元数据 → `research_experiment_run`；结果信封 → 对象存储（**零新表 / 零 migration / 零新依赖**） |
| **结果 md（FBC-6）** | `docs/research/RESULT-12F-COMPOSITE-001.md` |

---

## 7. 判据（可执行，逐条可复核）

1. `node node_modules/typescript/bin/tsc --noEmit --incremental false` = **0 错**；
2. `node scripts/checkEolDrift.mjs` = **0 漂移**（本沙箱该脚本会 `EBUSY` ⇒ 用 Python 直数 `\r\n` 作替代判据）；
3. 代码中的桶边界 / 方向 / 权重与 `FROZEN-BUCKET-CONTRACT-001.md §2/§3` **逐字一致**（人工核对 + 表格回显）；
4. Run 后：`eligible + excluded === candidate`；`Σ excludedByReason === excluded`；`unscannedEventCount === 0`（声明了 `FULL_DATASET`）；
5. 每个档 / 每个桶要么给 CI，要么显式标「样本不足」——**不得留空**；
6. 结果 md 必备四段：**结论 + CI + 样本账 + 窗口限定**；结尾固定写「**探索性 / 非 OOS / `v5` 窗口限定**」；
7. 交付前按正常导航在真实浏览器量 DOM（不是只调通 API）。

---

## 8. 已知风险（不藏）

1. 🔴 **综合评分是加权和**（契约 §6.1 三条缺陷仍在）⇒ 本版**禁止**任何归因表述；要做归因走 `PLAN-FACTOR-EXP-001` Phase 3/4。
2. 🔴 **多重比较**：64 个桶 + 10 档 + 12 个 spread ≈ **90 个判定**，`α=0.05` 下假阳性期望 ≈ 4.5 ⇒ 全部结论只能声明为**探索性**；出现「长期有效 / 稳定有效」直接判不合格。
3. 🔴 **`v2~v5` 全为已读数据** ⇒ 既不是 OOS，也不是 Holdout；桶边界本身可能含样本内选择（契约 §6.5）。
4. ⚠️ **F6/F8/F9 方向先验未验证**，占 `3/12` 权重 ⇒ 9 因子子评分是必需的对照（§4.4）。
5. ⚠️ **F8 的 `UNKNOWN` 被评最低分**（§2.1 注）⇒ 若 `UNKNOWN` 占比高，会系统性压低综合评分。
6. ⚠️ **入场固定 `T+6`**：这不是全部原实验的入场点 ⇒ 单因子对照数字与原实验 README 数字**必然不完全一致**，这是设计使然，不是缺陷。
7. ⚠️ **F3 的非平稳性**：同日成交额分位依赖当日的候选池成分；`v5` 跨 8 年，早期与近期市场结构不同 ⇒ 分位含义随时间漂移。

---

## 附：本规格的事实来源

- 桶边界：`docs/research/FIRST-BOARD-PULLBACK-EXPERIMENT-CURATION.md §5.1`（含逐条代码坐标）。
- 方向证据：同上 `§5.4`。
- 事件过滤与「严格收盘涨停」判据：`entry-aligned-exit-horizon-study/experiment.ts:216-330`。
- 同日分位算法：`dynamic-state-factor-expansion-study/experiment.ts:313-333` + `result.ts:205-222`。
- 前置窗口读取法：`pre-event-context-study/experiment.ts:179-193,236-248`。
- 公共底座契约：`shared/firstBoardPullback/{types,wrapExperiment,foundation}.ts`。
- **本文件编制时零源码改动；代码实现见同日提交。**
