# RESULT · `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` 首板滚动池续研：早期入场 × 因子排序 × 固定 Runner

> **Task**：执行 [`GOAL-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md`](GOAL-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md) 的 S1–S6。
> **买点规则**：[`RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md`](RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md)（第一轮提案，**不是**已验证买点）。
> **Baseline**：HEAD `f8b6810` + 工作区（含并发会话未提交改动；本任务未触碰其文件）。
> **Datasset**：`datasetVersionId = 780004` · `first_limit_pullback` · `v10-listed365-pre10-post80` · **READY**。
> **正式 Run**：`RUN-20261010-4BFF13C2`（`COMPLETED` / `SUCCEEDED`，`durationMs = 1,678,458`）。
> **判定**：**`INSUFFICIENT_EVIDENCE`**（R 的唯一 ≥+20% 命中锚点只有 **8** 个，事前判据要求 ≥ 50）。

---

## 1. 结论摘要

**「首板后回撤 → 连续两日观察合格 → 局部突破确认」这条买点，配上 `preReturn10 HIGH` 排序，
在本窗口内没有给出可辨别的右尾增量；而且这条买点在滚动池里极少触发。**

| 项 | 结果 |
|---|---|
| 买点触发频率 | 19,510 个池内事件中，**664 个**产生原始买点候选行，分布在 **241 个决策日** |
| R 账户（20bps 等价的真实账户成本） | 总收益 **−4.59%**、年化 −2.37%、**MDD 29.70%**、250 笔已平仓、胜率 35.6%、盈亏比 0.966 |
| R 的 ≥+20% 尾率 | **8/250 = 3.20%** |
| Random（200 账户汇总）≥+20% 尾率 | **1,382/50,004 = 2.764%** |
| **R − Random 尾率差** | **+0.436pp**，**95% 双侧**块 bootstrap（189 簇；**两臂独立重采样**，见 §4.2 更正）：block20 `[−2.377pp, +3.608pp]`、block40 `[−2.810pp, +3.433pp]` ⇒ **跨 0** |
| 净均值差 | **+0.388pp**，block20 `[−1.189pp, +2.075pp]` ⇒ **跨 0** |
| 年度 | 2024：R −6.78% vs Random 均值 −6.18%（R 略差）；2025：R **+2.34%** vs Random 均值 −12.40%（R 明显好）⇒ **不同向** |
| 判定 | **`INSUFFICIENT_EVIDENCE`**：唯一 ≥+20% 命中锚点 **8 < 50** |

**三条必须一起读的事实**：

1. **买点在滚动池里是稀有事件**：664 个候选行 / 19,510 个池内事件 ≈ **3.4%**，
   排除原因主要是 **支撑破位（144,902 行）** 与 **两日观察分不足（126,251 行）**、**尚未回撤（115,250 行）**。
   ⇒ 这条规则**不是**「每天都有候选」的日常选择器。
2. **冻结的 74 日 Runner 在本配置下从未生效**：R 账户 `maxHoldingPeriod = 17`、
   `runnerExtensionReachedCount = 0`；全部 50,254 笔交易 `openAtEnd = 0`、`dataCoverageBlockedSharePct = 0%`。
   ⇒ 按目标 §7「**没有退出消融时，明确无法量化 Runner 的因果贡献**」：
   本轮**不能**声称 Runner 带来或未带来任何东西；而且它**在本配置里没有被触发过**。
3. **工程门禁 C 被实测关闭**：rd80 vs 需要的 rd84 缺口虽然在结构上存在（S1/S2 已量化），
   但 50,254 笔交易中 **0 笔**触及该边界 ⇒ **不需要**新建更长 post 的 Dataset。

---

## 2. 冻结配置（实际执行值）

| 项 | 冻结值 | 实际执行 |
|---|---|---|
| 数据入口 | `780004` 只读核 READY | ✅ READY / `v10-listed365-pre10-post80` |
| 主决策窗口 | 2024-01-02 ~ 2025-09-30 | ✅ **241 个决策日**（有买点候选者） |
| 事件扫描 | 从 2023-09-01 起（留 40 交易日预热） | ✅ 候选池 19,510 / 数据集声明 58,983；`eventScanTruncated=false` |
| 池规则 | 复用 round-1：最早未过期锚点、rd1..40、新首板不刷新年龄 | ✅ 复用 `buildDailyPool`，未改一行 |
| 买点规则 | RULE-001 全条款（守线 0.98·O₀ / 缩量 0.5·V₀ / 四项各 1 分 / 连续两日 ≥3 / 突破前两日高点 / 量能回升 / d∈[3,9]） | ✅ `evaluateEarlyEntries`（本轮新库，**15 例**测试） |
| 成交截止 | 锚点 **rd ≤ 10** | ✅ **`T+10 违规 0`** |
| 排序 | R = `preReturn10` 原始值降序（破平 symbol→eventId） | ✅ |
| 控制 | 同日同池同人数均匀无放回 × **200 固定种子**（`20261010 + i`） | ✅ 200 个独立账户，现金/持仓不共享 |
| 仓位 | **决策日收盘总权益 × 20%** | ✅ `EQUITY_FRACTION fraction 0.2`（实测 `simulationConfig`） |
| 账户约束 | `maxPositions=5` / `maxDailyBuys=2` / 初始资金 100,000 | ✅ 逐字节继承 3600005 的 `executionAssumptions` |
| 成本 | 佣金 0.00025 · 印花税 0.0005 · 过户费 0.00001 · `slippageBps=5` · `lotSize=100` · `minCommission=5` | ✅ 同源继承 |
| 退出政策 | 3600005 的 `definition.exit`（含 `runnerBridge NH3/5/74`、`candidateExitPolicy=DISABLED`） | ✅ **指纹断言** + `exit` 与源**深度相等** |
| 指标出口 | `canonicalMetrics` | ✅ 唯一 |
| 性质 | 事后固定的探索性诊断，不称全新 OOS | ✅ `researchPhase=EXPLORATORY`，`protocolFingerprint=null` |
| 身份 | canonical `sec_<uuid>`（**不是** code） | ✅ 19,510/19,510 解析成功，**0 无法解析** |

### 2.1 冻结遗留策略版本复核（本轮唯一继承物）

```
strategy_versions.id = 3600005 · first-limit-pullback-3f-top3-runner-t74@2.0.0
fingerprint = f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c   ✅ 断言通过
versionRowId = 3600005                                                          ✅ 断言通过
```

**只继承** `definition.exit` 与 `executionAssumptions`。
**明确不继承**（目标 §5）：旧入场门（一字板/T 字板排除、`observationMaxAmplitude < 0.14`）、
旧观察窗 `{5,15}` + `FIRST_VALID_DAY`、**3F 评分分档仓位（0.05/0.20/0.25）**、3F 配方与 TopN。
仓位改为**统一 20% 权益比例**（`positionTiers: []`）。

---

## 3. 数据覆盖与执行面

| 项 | 实测 |
|---|---|
| `eventCount` / `prefixRowCount` / `postRowCount` | 58,983 / 176,650 / **1,560,800**（= 19,510 × 80，逐层无缺口） |
| `maxPostRelativeDayRead` | **80** |
| 身份解析 | identifiers 5,552；已解析 **19,510**；**无法解析 0** |
| 执行投影 | 证券 **596**、行 **52,823**、交易日 **496**（2024-01-02 ~ **2026-01-19**）、**bar 值冲突 0** |
| 账户数 | **201**（R + 200 随机） |
| 全账户交易数 | **50,254** |
| `tradesOpenAtEnd` | **0** |
| `runnerExtensionReachedTrades` | **0** |
| **`dataCoverageBlockedSharePct`** | **0%** |
| 成交日日历不一致 | **0** |
| R 账户 `fillCount / rejectedOrderCount / skippedIntentCount` | 500 / 13 / 216 |
| R 账户 `maxHoldingPeriod` | **17** |

### 3.1 🔴 门禁 C 的实测结论（不需要新建 Dataset）

S1/S2 量化了「T+10 入场 + Runner 74 持有日 ⇒ 最远约 rd84 > 物理上界 rd80」这一**结构性**缺口，
并列出 C-1/C-2/C-3 三个处置选项。**正式 Run 的实测把它关闭了**：

- 全 **50,254** 笔交易中，`openAtEnd = 0`、`runnerExtensionReachedTrades = 0`、
  `dataCoverageBlockedSharePct = 0%`；R 账户最长持有 **17** 个持有日；
- 原因：冻结退出政策里 `runnerBridge` 要求 `NEW_HIGH_3` 状态，
  而止损（6% / 3% 激活后 8% 峰值回撤）与 MA5×MA10 交叉退出**先于**续持条件成立
  ⇒ **74 日续持在本配置下从未被触发**。

⇒ 按 C-1 处置执行（期末未平仓 MTM、`DATA_COVERAGE_BLOCKED` 单列、不缩短政策、不在 rd80 强卖、
不剔除长持赢家），**实测该处置未被用到**。**未申请、未构建任何新 Dataset 版本。**

⚠️ 同时如实登记：**这也意味着本轮无法评估 Runner 的因果贡献**（目标 §7）——
它既没触发、也没有做退出消融。

---

## 4. 主结果

### 4.1 账户层（`canonicalMetrics`，唯一指标出口）

| 指标 | **R** | Random（200 账户汇总） |
|---|---|---|
| 决策日 | 241 | 241 |
| 意图 / 唯一锚点 / 唯一证券 | 454 / 454 / 424 | — |
| 总收益 | **−4.5945%** | 全窗均值 **−17.9033%** / 中位 **−18.8096%**（R 位于 **87 分位**）；逐年均值 2024 −6.1823% / 2025 −12.3965%（逐年为另口径，**不可与 R 的全窗复合直接并列**） |
| 年化 | −2.3660% | — |
| **MDD** | **29.7033%** | — |
| 已平仓笔数 | 250 | 50,004 |
| 胜率 | **35.6%** | — |
| 盈亏比 | 0.9660 | — |
| 平均盈利 / 平均亏损 | +8.477% / −4.619% | — |
| 期末现金占比 | 100% | — |
| `openAtEnd` | 0 | 0 |

> Random 的「均值/中位」按目标 §7 用**逐年以上一年末权益为基数**的账户收益统计；
> 200 个随机账户的**分布**是描述性对照，**不等于**通过随机种子取得市场历史独立性。

### 4.2 实现右尾（主判据）

| 阈值 | R 命中 / 笔数 | R 尾率 | Random 命中 / 笔数 | Random 尾率 | **差值点估计** | block20 CI | block40 CI |
|---|---|---|---|---|---|---|---|
| **≥+20%** | **8 / 250** | **3.200%** | 1,382 / 50,004 | 2.764% | **+0.436pp** | `[−2.377pp, +3.608pp]` | `[−2.810pp, +3.433pp]` |
| ≥+50% | 2 / 250 | 0.800% | 323 / 50,004 | 0.646% | +0.154pp | `[−0.943, +1.359]` | `[−0.974, +1.514]` |
| ≥+100% | 1 / 250 | 0.400% | 133 / 50,004 | 0.266% | +0.134pp | `[−0.580, +1.177]` | `[−0.615, +0.988]` |
| 净均值 | — | +0.0431% | — | −0.3446% | **+0.388pp** | `[−1.189, +2.075]` | `[−0.925, +1.597]` |
| ≤−20% | 0 / 250 | 0% | 0 / 50,004 | 0% | 0 | `[0, 0]` | `[0, 0]` |

统计口径：**逐笔二元指示序列按真实入场日聚簇** → 既有唯一原语 `movingBlockBootstrapDifference`；
block20 主 / block40 敏感性 / **1000 次** / 95% 双侧 / 固定种子（20261010 / 20261011）；簇数 **189**。

### 4.3 年度

| 年 | R 收益 | Random 均值 | Random 中位 | Random 为正的比例 |
|---|---|---|---|---|
| 2024 | **−6.778%** | −6.182% | −6.590% | 26% |
| 2025 | **+2.342%** | −12.396% | −13.743% | 13% |
| 2026 | 0 | 0 | 0 | 0% |

⇒ **年度不同向**（2024 R 略差、2025 R 明显好），这与尾率差 CI 跨 0 一致。

### 4.4 买点候选的逐层排除（`observation` 账，逐桶可归因）

| 层 | 行数 |
|---|---|
| 两日观察分不足（`PREV_TWO_DAY_SCORE_INSUFFICIENT`） | 126,251 |
| 支撑破位（`SUPPORT_BREACHED`） | 144,902 |
| 尚未回撤（`NO_PULLBACK_YET`） | 115,250 |
| 非确认日（`NOT_TRIGGER_DAY`） | 33,673 |
| 未突破前两日高点（`NO_CLOSE_BREAKOUT`） | 23,637 |
| 量能未回升（`VOLUME_NOT_RECOVERED`） | 1,368 |
| 支撑路径不可评估（`SUPPORT_PATH_INCOMPLETE`） | 1,801 |
| 重试被跳过（`RETRY_TRIGGER_SKIPPED`） | 176 |
| `preReturn10` 缺失 | 4 |
| **最终原始买点候选** | **664** |

### 4.5 配对差 / 分布 / P1–P6

- **排除群画像（P1）**：绝大多数池内事件在「支撑全程未破」或「连续两日 ≥3 分」上被排除；
  这两层合计占排除量的 65%。⇒ 规则的**选择性主要来自守线与观察分**，不是突破条件。
- **尾部靶（P2）**：本轮主指标 `≥+20% 已实现净收益`，与 round-1 的「路径机会率」严格区分；
  未使用未来最高价。
- **入选边界分辨力（P3）**：R 与 Random 共享**完全相同**的原始候选池（664 行）；
  差异只来自排序，账户约束后的成交差异单列（`skippedIntentCount 216`）。
- **排序效应相对固定退出机制的量级与限制（P4）**：排序带来的尾率差 +0.436pp **小于**随机对照自身的
  离散（CI 半宽 ≈ 3pp）⇒ 本样本**无法分辨**；且**没有退出消融** ⇒ 无法把差异归因于排序或退出。
- **停止规则（P5）**：唯一命中锚点 8 < 50 ⇒ 按事前判据直接收口，**不追加**买点 / TopK / 方向 / 退出参数。
- **年度分层（P6）**：见 §4.3，**不同向**。

---

## 5. 判定（事前收口规则）

| 臂 | 判定 | 依据 |
|---|---|---|
| **R** | **`INSUFFICIENT_EVIDENCE`** | ① 尾率差 **95% 双侧** CI **跨 0**（block20 与 block40 同时跨 0）；② **年度不同向**；③ **唯一 ≥+20% 命中锚点 8 < 50**（事前判据）；④ 200 随机账户的整体离散远大于点估计 |

**为什么不是 `NO_SUPPORT`**：CI 上界为正且点估计为正、2025 年 R 明显好于随机 ⇒ 证据不足以**否定**，
但同样不足以**支持**。这是「无法判断」，不是「无效」。
**为什么不是 `RIGHT_TAIL_EVIDENCE`**：命中计数（8）远低于事前门槛（50），且 CI 跨 0、年度不同向。
**为什么不是 `RISK_TRADEOFF`**：该判定要求**先**满足右尾证据；本轮不满足。

⇒ 按目标 §7 **正常收口**：不追加买点、不改 TopK、不反向、不补退出参数。

---

## 6. 与既有结论的关系（本轮不是新矿脉）

| 既有结论 | 本轮复核 |
|---|---|
| `preReturn10 HIGH` 是**纯右尾暴露**、**不是正期望信号**（round-1 与 `RESULT-PURE-RIGHT-TAIL-VALIDATION-001`） | ✅ 一致：R 的净均值为正但极小（+0.043%）、胜率仅 35.6%、盈亏比 < 1、总收益为负 |
| 同日依赖主导 ⇒ 禁用 `sd/√n`（`RESULT-EVENT-OVERLAP-CLUSTER-001`） | ✅ 全部区间走**日期聚簇**块 bootstrap（189 簇），未用朴素标准误 |
| `maxAmp5 LOW` 是防御性参照、不得当正 Alpha | ✅ 本轮 `maxAmp5` **完全不参与**（规则 §1 强制），未复现该臂 |
| round-1：滚动池 + 固定 20 日持有，R 尾率差跨 0 | ✅ **方向一致**：换到「早期入场 + 真实账户 + 固定 Runner 退出」后，结论仍是证据不足 |

🔴 **本轮新增的结构性发现**：把买点从「每天都有候选」换成「必须满足回撤 + 连续两日稳定 + 突破」后，
候选数从 round-1 的每日池成员（中位 745/日）塌缩到**全窗 664 个候选行**；
在固定退出政策下，**没有任何一笔持有到 74 日**（触发与否**不可观测**，见 §15）。这两点比尾率本身更有信息量。

---

## 7. 风险与「不能推出」

1. ❌ **不能**说「早期入场买点有效」或「无效」：CI 跨 0、年度不同向、命中锚点 8 < 50。
2. ❌ **不能**说「`preReturn10` 排序有增量」：点估计 +0.436pp 远小于对照自身离散。
3. ❌ **不能**量化 Runner 的因果贡献：**无退出消融**；且「是否触发过 Runner」在本契约下**不可观测**（§15 更正 D3）。
4. ❌ **不能**把 Random 的 200 个账户当成「市场历史独立性」：它们是**描述性对照**。
5. ❌ **不能**声称已实现**每日非 ST 控制**：逐日 ST 不在 Dataset 端口内 ⇒ 记 `UNKNOWN`。
6. ⚠️ **成本口径系统性低估**：Dataset 端口不提供 `amount` ⇒ 执行行 `amount = null`
   ⇒ 只有 base 5bps 滑点，**缺少引擎的流动性分层加成**（<1 亿成交额 +20bps）。
   **未伪造 amount**；如实披露（见 §8 契约缺口）。
7. ⚠️ 不能外推到创业板/科创板/北交所、其他上市龄口径、其他数据集或其他时间窗。
8. ⚠️ 不是 OOS：`researchPhase=EXPLORATORY`；780004 的全区间在既往研究中已被反复使用。
9. ⚠️ 买点规则是**第一轮研究提案**（RULE-001 v0.1），阈值（0.98 / 0.50 / 四项等权 / 两日 ≥3）
   均为**研究假设**，不是已证明最优；本轮冻结后**未搜索**。

---

## 8. 契约缺口与如实偏离（本轮登记）

1. **`amount` 不在 Dataset 端口内** ⇒ 成本缺少流动性分层加成（系统性低估）。需要 port 提供 `amount`
   或另立口径 —— 属**新增契约**，未自行扩面。
2. **`decisionOffsetDays` 是单标量**，无法表达滚动池逐日决策坐标：本实验声明 `10`（= 成交相对日**上界**），
   逐日坐标由内存投影表达。（与 round-1 同源缺口。）
3. **同股身份 vs 面板唯一键的取舍**：执行行按 **canonical base id**（`sec_<uuid>`）作键，
   从而同股两个事件共享 `holdingSet` ⇒ 只允许一次建仓（目标 §5 要求）。
   代价：放弃 `::event:` 后缀对**重叠事件面板**的行级消歧（按 `(tradeDate, baseId)` 去重，冲突如实计数，实测 0）。
4. **锚点「首发优先」**：规则 §4 允许「首次未成交后可重试」，但 `sourceRun` 必须在撮合前组装、
   拿不到成交事实 ⇒ 本实现每个锚点只在**最早**确认日进候选一次。这自动满足「同锚点最多一次成功建仓」，
   但**未实现**「未成交后重试」；已如实披露（`RETRY_TRIGGER_SKIPPED 176`）。
5. **`executionSurface` 保持缺省 `SINGLE_EVENT`**：已核实 `COMPOSITE_PORTFOLIO` 的 provider
   硬编码本地 660001 缓存工件并忽略 `baselineDatasetVersionId` ⇒ 不可用（见 S3 门禁）。
   身份改走服务侧唯一实现 `resolveRollingPoolSecurityIds`。
6. **大形态数据装配需服务侧**：`ResearchDataset` 的 `datasetVersion` 必须内容寻址
   ⇒ 由 `sealRollingPoolExecutionDataset`（服务侧、复用 `computeDatasetVersionStreaming` +
   `derivePolicySet`）封存；实验侧**不自行拼版本号**。
7. **`result.ts` 持有三个字面量副本**（仓位 0.2 / Runner 74 / 冻结指纹与版本行主键）——
   因 `result.ts` 不得运行时 import `server/**`；`experiment.ts` 在 run 开头**断言它们等于服务侧唯一导出**，
   漂移即抛错。

---

## 9. 🔴 预检抓出的真实缺陷（本轮最有价值的工程证据）

**首跑预检 `FAILED`：`原始买点候选 0 行；诊断 {"NO_TRIGGER": 87110}`。**

根因：守线锚点 `O_0` 与缩量分母 `V_0` 都取自**首板日 bar**，而首板日 bar 属 **`feature`（prefix）层**；
实现只把 `volume` 声明在 `requiredColumns.observation`，`feature` 漏了它 ⇒ `V_0 = null`
⇒ `EVENT_DAY_BAR_UNUSABLE` ⇒ **每个锚点每个观察日都不可评估** ⇒ 候选恒为 0。

**为什么差点被掩盖**：诊断只输出 `NO_TRIGGER` 一个桶，把「**不可评估**」与「评估了但没触发」混为一类，
看起来像「规则本身不触发」。

**独立复算（不经过实验代码，直接 registry 读真实行情 + 规则库）**：
窗口内 3,801 个事件中 **220 个触发（5.8%）** ⇒ 证明规则确实会触发，缺陷在列投影声明。

**修复**：① `requiredColumns.feature` 补 `"volume"`；
② `NO_TRIGGER` 诊断拆桶为 ``NO_TRIGGER__<finalState>__<finalReason>``，
使「不可评估」再也无法伪装成「不触发」。

---

## 10. 写入清单与副作用

| 类别 | 内容 |
|---|---|
| **DB 写入** | `research_experiment_run` **+1 行**：`RUN-20261010-4BFF13C2`（COMPLETED / SUCCEEDED）。**无其他 DB 写入** |
| **对象存储** | `research` 桶本 Run 前缀内 `result.json` + `manifest.json` + **19 个声明产物** |
| **新增代码** | `research-experiments/shared/rollingPoolEarlyEntry/{types,entry,index}.ts`；`research-experiments/first-board-pullback/rolling-pool-early-entry-runner/{experiment,result}.ts(x)` + `README.md`；`server/researchExperiments/{rollingPoolExecutionSupport,frozenRunnerExitPolicy}.ts`；`tests/server/researchExperiments/{earlyEntryObservation,rollingPoolEarlyEntryRunner}.test.ts`；`tests/tools/rollingPoolEarlyEntryRun.mts` |
| **修改代码** | `research-experiments/compositeRunnerBridge.ts`（**零实现 re-export**）、`research-experiments/manifest.ts`（+1 注册 + 具名 v5 底座豁免）、`client/src/researchExperiments/pages.ts`、`client/src/pages/researchExperiments/experimentModes.ts`、`tests/client/src/pages/researchExperimentModeGrouping.test.ts`（49→50 / 30→31）、`research-experiments/shared/rollingPoolRightTail/projection.ts`（`PoolBar` **追加** `volume`）+ round-1 `experiment.ts` 的 `normalizeBar` 补一行（旧实验未声明该列 ⇒ 恒 `null` 且不读 ⇒ **旧实验行为与产物不变**） |
| **未做** | 未执行 DDL / migration；**未修改 780004 内容**；未改历史 Run；未改策略版本 3600005；**未构建任何新 Dataset**；未建账户、无资金交易、未接 Paper/Production；**未触碰**并发会话文件与 `.agent/task-state.yaml` |

---

## 11. 复现指令

```bash
# S5 技术预检（真实 Dataset 端口 + 真实撮合；不持久化）
node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
  tests/tools/rollingPoolEarlyEntryRun.mts --mode precheck

# S5 正式对照 Run（经既有 startRun 入口；主窗口 241 个有候选决策日 × 201 账户，≈28 分钟）
node --max-old-space-size=10240 node_modules/tsx/dist/cli.mjs \
  tests/tools/rollingPoolEarlyEntryRun.mts --mode formal

# 受影响测试
node node_modules/vitest/vitest.mjs run \
  tests/server/researchExperiments/earlyEntryObservation.test.ts \
  tests/server/researchExperiments/rollingPoolEarlyEntryRunner.test.ts \
  tests/server/researchExperiments/rollingPoolRightTailMvp.test.ts \
  tests/server/researchExperiments/manifest.test.ts \
  tests/client/src/pages/researchExperimentModeGrouping.test.ts
```

---

## 12. 唯一下一步

**关闭本方向。**

买点触发过稀（664 个候选 / 19,510 个池内事件）、排序尾率差 CI 跨 0 且年度不同向、
唯一命中锚点 8 < 50，且**本条买点在固定退出政策下没有任何一笔持有到 74 日 Runner 上界**
⇒ 按目标 §7 收口：不追加买点、不改 TopK、不反向排序、不补退出参数、不接 Runner、不建 Candidate、
不延长窗口、**不**启动前向账户。

若将来仍要在这条线上推进，**唯一**被本轮证据支持的动作是（需另立任务与新授权）：

1. 先补 **`amount`（成交额）端口**，让成本与参考 Run 6210006 可比；
2. 再补 **退出消融**（固定持有 vs 固定 Runner），否则无法把任何差异归因于排序或退出；
3. 且必须换到**真正未见**的样本并在**事前**登记判据 —— 否则只是在同一份已被反复挖掘的数据上继续调参。

---

## 15. 🔴 更正记录（`OBSERVATION-WINDOW-003` S1 审计，2026-10-10）

> 依据 AGENTS §2 证据优先级（**真实 DB 状态 > 实际运行结果 > 实际代码 > 自动化测试 > 文档 > 设计假设**），
> 对本文与正式 Run `RUN-20261010-4BFF13C2` 的产物做逐项核对，登记 **4 处 `BASELINE_DRIFT`**。
> **历史 Run 不回填、产物不改**；本节只更正**文档**。

| 编号 | 原文（已更正处） | 产物事实 | 处置 |
|---|---|---|---|
| **D1** | §4.1 把 R 的**全窗复合收益**与 Random 的**逐年均值**并列，写作「均值 −6.40%」 | `randomDistribution.totalReturnPct`：**mean −17.903346317707587 / p50 −18.809598246680018**（min −43.138 / max +37.140，`rValue −4.5945`，`rPercentile 87`）。`−6.40%` **不可复现**（两年均值 −9.289%、三年含 2026 均值 −6.193%、全窗均值 −17.903%） | 已改为**同口径**：全窗 mean/p50 + R 的百分位 |
| **D2** | §1/§5 写「**97.5%** 块 bootstrap」 | 代码路径 `quantiles: DEFAULT_BOOTSTRAP_QUANTILES = {low:0.025, high:0.975}` ⇒ **95% 双侧**；且 `MovingBlockBootstrapResult` **不含 `quantiles` 字段** ⇒ 载荷无法自证 | 已改为 95% 双侧；003 已把 `quantiles` 写入结果对象使其自证 |
| **D3** | 「74 日 Runner **从未触发**/从未生效」 | 载荷只有 `runnerExtensionReachedTrades = 0`（口径 = `holdingPeriod >= 74`）⇒ 只能支持「**没有任何一笔持有到 74 日**」。引擎的 `runnerBridgeExtendedToBySecurity` 是**函数局部 Map**，**不写审计、不进任何记录字段** ⇒ 「触发过且提前退出」与「从未触发」**不可区分** | 已改为「没有任何一笔持有到 74 日」，并明示**触发与否不可观测**；003 的 RESULT 将单列该不可观测性 |
| **D4** | §4.2 引用 `movingBlockBootstrapDifference` 时未披露抽样结构 | 该原语对 `positive` / `negative` **各自独立重采样**（`resampleMean` 每次自抽块起点）= **非配对**，与目标 §6.1「同步抽样各比较臂、分子分母共同抽样」不符 | 已在 §4.2 就地披露「两臂独立（非配对）」；003 新增**配对**实现（共享块索引 + 分子分母同步），**旧函数逐字节不变**以保历史复现 |

**未漂移（已逐项核对一致）**：Run 头（`RUN-20261010-4BFF13C2` / `COMPLETED` / `SUCCEEDED` / `durationMs 1,678,458`）、
`eventCount 58,983` / `prefixRowCount 176,650` / `postRowCount 1,560,800` / `maxPostRelativeDayRead 80`、
执行投影（596 证券 / 52,823 行 / 496 交易日 / 2024-01-02~2026-01-19 / bar 值冲突 0）、
候选池 19,510 / 决策日 241 / 候选行 664 / 意图 454·454·424 / 账户 201、
R 全部 canonical 指标、5 行尾率表（block20+block40 全部区间）、簇数 189、种子 20261010/20261011、
年度三行、`openAtEnd 0`、9 个排除桶、判定 `INSUFFICIENT_EVIDENCE`。

### 15.1 另两处**代码**偏差（003 已修正，本文历史结论不受影响）

1. **首次触发截断**：`experiment.ts` 只保留 `evaluation.triggers[0]`（`RETRY_TRIGGER_SKIPPED = 176`，
   占原始触发日 664+176=840 的 **20.95%**）⇒ 规则 §4 允许的「未成交后重试」被实现层面截断。
2. **`amount` 未投影**：原文 §8.1 称「Dataset 端口不提供 `amount`」——**该归因错误**。
   实测 `ds_first_limit_pullback_post.amount` 存在（`double`，单位**千元**），
   端口白名单 `datasetPort.ts#COLUMN_TABLES` 即 drizzle 表对象，`assertDeclaredColumns` 会放行；
   既有实验（如 `dynamic-state-factor-expansion-study`）**已在 observation 层声明 `amount`**。
   ⇒ 缺陷是**本实验漏声明**，不是端口缺口。003 已声明并透传，恢复引擎的流动性分层滑点。
