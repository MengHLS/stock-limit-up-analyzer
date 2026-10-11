# S3 · `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` 执行面门禁与已完成实现

> 承接 [`S1-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-GATE-002.md`](S1-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-GATE-002.md)。
> 基线 HEAD `f8b6810` + 工作区。**本文只登记实测事实、已完成的实现与剩余工作**，不含收益结论。

---

## 1. 已完成并已验证

| 项 | 状态 | 证据 |
|---|---|---|
| S1 现有链路审计与买点收口 | ✅ 完成 | `S1-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-GATE-002.md` §1 |
| S2 只读数据与退出政策指纹预检 | ✅ 完成 | 同上 §2（指纹 `f6b61472…` 逐字符复核通过） |
| 早期入场规则库（纯研究投影） | ✅ 实现 | `research-experiments/shared/rollingPoolEarlyEntry/{types,entry,index}.ts` |
| 规则库 fixture 测试（S4 部分） | ✅ **15/15 通过** | `tests/server/researchExperiments/earlyEntryObservation.test.ts` |
| 实验侧桥接（零实现 re-export） | ✅ 实现 | `research-experiments/compositeRunnerBridge.ts` 追加段 |
| 服务侧**真实证券身份** + **数据集封存** | ✅ 实现 | `server/researchExperiments/rollingPoolExecutionSupport.ts` |
| 冻结退出政策**唯一读取器**（含指纹 + 版本行主键断言） | ✅ 实现并**真实跑通** | `server/researchExperiments/frozenRunnerExitPolicy.ts` |
| 🔴 **真实行情端到端执行链** | ✅ **跑通**（见 §1.2） | `_scratch/fbpool2/probe_e2e_real.mts` |
| 类型检查 | ✅ `pnpm run check` **0 错** | — |
| 受影响测试 | ✅ **73/73 通过**（规则 15 + 右尾 34 + manifest 9 + 分档 15） | — |
| 右尾实验原样性 | ✅ `PoolBar` 仅**追加** `volume`；旧实验未声明该列 ⇒ 恒 `null` 且不读 ⇒ 行为与产物不变 | `rollingPoolRightTail/projection.ts` + round-1 `normalizeBar` |

### 1.2 🔴 真实行情端到端执行链已验证（本轮最重要的去风险证据）

用 **780004 的真实行情**（6 个 2024-01 主板首板事件 × rd0..60）跑通了完整链路，**没有用任何桩数据**：

```
真实身份（唯一实现 loadPrimaryIdentifiers + resolveSecurityIdsByEvent）
  identifier 行 5,552 · 解析 6/6 · **未解析 0**（不回落为 code）
→ sealRollingPoolExecutionDataset
  rows 366（按 canonical base id 去重）· tradingDates 61（2024-01-02 → 2024-04-03）
  datasetVersion = rd-1.0.0-1-7d5c669fdf69c095   ← **内容寻址**，非手写
→ 手造 sourceRun（2 只、2024-01-03 决策）
  fingerprint 由 computeCandidateEvaluationRunFingerprint 产出并被引擎**接受**
→ runCompositeRunnerBacktest（冻结政策 + 真实桥接）
→ runTradeSimulation（唯一撮合引擎）
```

实测 `simulationConfig` **逐项与冻结配置一致**：

| 项 | 实测 |
|---|---|
| `positionSizing` | `{sizingMethod: "EQUITY_FRACTION", fraction: 0.2, fixedAmount: null}` ✅ 统一 20% 权益 |
| `maxPositions` / `maxDailyBuys` | `5` / `2` ✅ |
| `exitPolicy.runnerBridge` | `{kind:"PIT_RUNNER_HOLDING_BRIDGE", state:"NEW_HIGH_3", decisionHoldingDays:5, extendToHoldingDays:74}` ✅ |
| `candidateExitPolicy` | `DISABLED` ✅ |
| `cost` | `commissionRate 0.00025 · stampDutyRate 0.0005 · transferFeeRate 0.00001 · slippageBps 5 · lotSize 100 · minCommission 5` ✅ |

撮合与指标：`initialCapital 100000 → finalEquity 97589.56`；`trades 2`；`executionStats {totalSignals:4, totalOrders:4, totalFills:4, rejectedOrders:0}`；
`skipped 1`（`2024-01-04 · FROZEN_EXIT_DEFERRED` —— **如实记录，不静默**）；
`canonicalMetrics` 正常产出（`totalReturnPct −2.4104 · tradeCount 2 · completedTradeCount 2 · openAtEndCount 0 · annualizationBasis TRADING_DAYS/252`）。
**`openAtEnd` 自检通道可用**（`run.trades.filter(t => t.openAtEnd === true)`），这是门禁 B/C 的处置依据。

⇒ 结论：**「实验自建候选集 → 真实撮合 → canonicalMetrics」在真实数据上可行且口径正确**，
   门禁 A 已通过实现消除；剩余工作只是把它扩到主窗口的 425 个决策日 × 201 个账户。



### 1.3 规则库实现的规则条款映射

| 规则条款 | 实现 |
|---|---|
| §2 四项各 1 分、**单列存档** | `observationScores()` → `ObservationDayScore.flags{support,shrink,lowStable,closeImprove}` + `score` |
| §2 守线 `L_d ≥ 0.98·O_0` | `SUPPORT_RATIO=0.98`，锚点 = `prefix.get(0).open`（**首板日开盘**） |
| §2 缩量 `V_d ≤ 0.50·V_0` | `SHRINK_RATIO=0.5`，`V_0 = prefix.get(0).volume` |
| §3-1 确实发生过回撤 `∃j∈[1,d−1], C_j<C_0` | `pullbackFirstRd` + 触发时要求 `pullbackFirstRd ≤ d−1` |
| §3-2 支撑全程未失守 | 逐日 `runningMinLow` + `supportBreachRd`（**破位即永久作废，不恢复**）+ `supportPathIncomplete`（任何一日不可评估 ⇒ 不能声称全程未破） |
| §3-3 连续两日 `S_(d−2)≥3 ∧ S_(d−1)≥3` | 两日都必须**非 null**（停牌/零量日 ⇒ `score=null` ⇒ 条件不成立） |
| §3-4 `C_d > max(H_(d−2),H_(d−1))` | `closePrev2High` |
| §3-5 `V_d ≥ V_(d−1)` | 独立于缩量（确认日放量不会被 50% 缩量误杀） |
| §3-6 `d∈[3,9]` + T+10 成交 | `CONFIRM_MIN_RD=3` / `CONFIRM_MAX_RD=9` / `ENTRY_FILL_MAX_RD=10`；返回 `triggers[].fillRd ≤ 10` |
| §4 状态与失败处理 | `finalState ∈ {TRIGGERED, INVALIDATED_SUPPORT, ENTRY_EXPIRED, UNASSESSABLE}` + `finalReason` |
| §4 缺失/停牌/零量 | `missingReason ∈ {BAR_MISSING, BAR_SUSPENDED, BAR_INVALID, ZERO_VOLUME, PREV_BAR_MISSING, EVENT_BAR_UNUSABLE}`，**不打 0 分、不插值** |
| §5 观察分**不与** `preReturn10` 混合排序 | 规则库不产出任何排序值；排序在账户层前的独立步骤 |
| §1 `maxAmp5` 完全不参与 | 规则库**不 import** 任何振幅特征 |

🔴 **实现中发现的一条结构事实（已写入测试注释）**：当 `L_0 < 0.98·O_0`（首板日低点已在支撑位下方）时，
「低点稳定 `L_d ≥ L_(d−1)`」被「守线 `L_d ≥ 0.98·O_0`」**蕴含** ⇒ 四分项中可独立失分的是
**缩量**与**收盘改善**两条。这不是缺陷，是规则本身的含义；已在测试中固定下来，避免误读。

---

## 1.4 ✅ S3 实现完成 + S5 预检通过（并通过预检抓出并修复一个真实缺陷）

### 交付面

| 文件 | 作用 |
|---|---|
| `research-experiments/first-board-pullback/rolling-pool-early-entry-runner/experiment.ts` | descriptor（冻结配置 + `targetMetric: TAIL` + `preRegisteredCriteria`）+ 全流程编排 |
| `.../result.ts` | payload schema + 信封组装（账户/尾率/配对差/分布/覆盖/年度/池 表 + `customPayload`） |
| `.../page.tsx`、`.../README.md` | 页面 + 规格与裁决记录 |
| `tests/server/researchExperiments/rollingPoolEarlyEntryRunner.test.ts` | **18 例**合成 fixture（不碰 DB / 不碰 Dataset 端口） |
| `tests/tools/rollingPoolEarlyEntryRun.mts` | S5 预检 / 正式 Run 工具（版控内） |
| 登记面 4 处 | `manifest.ts`（+ 具名 v5 底座豁免）、`client/src/researchExperiments/pages.ts`、`experimentModes.ts`（`other-scope`）、分档计数 49→50 |

### 🔴 预检抓出的真实缺陷（本轮最有价值的一条：一个系统性缺陷曾被诊断标签掩盖）

**首跑预检**：`runStatus=FAILED`，`原始买点候选：0 行；诊断 {"NO_TRIGGER": 87110}`。

**根因**：观察规则的守线锚点 `O_0` 与缩量分母 `V_0` 都取自**首板日 bar**，而首板日 bar 属
**`feature`（prefix）层**；实现把 `volume` 只声明在 `requiredColumns.observation`，
`requiredColumns.feature` 漏了它 ⇒ `V_0 = null` ⇒ `EVENT_DAY_BAR_UNUSABLE`
⇒ **每个锚点每个观察日都不可评估** ⇒ 候选恒为 0。

**为什么差点被掩盖**：诊断只输出 `NO_TRIGGER` 一个桶，
把「**不可评估**」和「评估了但没触发」混成一类，看起来像「规则本身不触发」。

**独立复算（不经过实验代码，直接用 registry 读真实行情 + 规则库）**：
窗口内 **3,801** 个事件中 **220 个触发（5.8%）**，原因分布
`NO_PULLBACK_YET 1244 · SUPPORT_BREACHED 1273 · PREV_TWO_DAY_SCORE_INSUFFICIENT 894 ·
NO_CLOSE_BREAKOUT 157 · VOLUME_NOT_RECOVERED 12 · SUPPORT_PATH_INCOMPLETE 5 · TRIGGERED 216`
⇒ 证明规则在真实数据上**确实会触发**，缺陷在实验的列投影声明。

**两处修复**：
1. `requiredColumns.feature` 加入 `"volume"`（并就地写明「只声明在 `observation` 不够」的原因）；
2. `NO_TRIGGER` 诊断**拆桶**为 ``NO_TRIGGER__<finalState>__<finalReason>``，
   使「不可评估」再也无法伪装成「不触发」。

### 修复后预检实测（`--mode precheck`，事件窗 2023-11-01~2024-03-29）

| 项 | 值 |
|---|---|
| `runStatus` | **SUCCEEDED**（41.8 秒） |
| 产物 | **15 个** |
| 事件 / 冻结集 | 3,801 / 3,801；`eventScanTruncated=false`；`prefixRowCount 11,403`；`postRowCount 304,080`；`maxPostRelativeDayRead 80` |
| 身份解析 | identifiers **5,552**；已解析 **3,801**；**无法解析 0** |
| 原始买点候选 | **80 行 / 25 个决策日** |
| 诊断（已拆桶） | `NO_PULLBACK_YET 34,571 · SUPPORT_BREACHED 26,349 · PREV_TWO_DAY_SCORE_INSUFFICIENT 17,985 · NOT_TRIGGER_DAY 4,708 · NO_CLOSE_BREAKOUT 3,026 · VOLUME_NOT_RECOVERED 268 · SUPPORT_PATH_INCOMPLETE 104 · RETRY_TRIGGER_SKIPPED 18 · PRE_RETURN10_MISSING 1` |
| **`T+10 违规`** | **0** ✅（目标 §8 硬门禁） |
| 成交日日历不一致 | **0** |
| 执行投影 | 证券 **80**、行 **6,389**、交易日 **138**（2024-01-02 ~ 2024-07-29）；**bar 值冲突 0** |
| 账户 | **201**（R + 200 随机）；R 总收益 −5.75% / MDD 8.67% / 已平仓 26 / ≥+20% 0；判定 `INSUFFICIENT_EVIDENCE` |
| 覆盖自检 | `tradesTotal 5,211` · `tradesOpenAtEnd **0**` · `runnerExtensionReachedTrades 0` · `dataCoverageBlockedSharePct **0%**` · `physicalPostMaxRelativeDay 80` · `requiredPostRelativeDayForFullRunner 84` |

⇒ 预检片段内**没有任何** Runner 尾部覆盖阻断（该片段远离数据集物理末端，符合预期）；
主窗口末端的实际占比只能在正式 Run 里实测（这是门禁 C 的判定依据）。



### 门禁 A · 实验侧**没有**任何通道把候选集交给真实撮合引擎

- `runTradeSimulation` 的入参是 `{dataset: ResearchDataset, sourceRun: CandidateEvaluationRun, simConfig}`；
  三者在 `research-experiments/**` 上都**没有**既有导出（§S1 审计已逐条核对）。
- 🔴 更关键：**`buildCompositeSourceRun` 无法表达本轮的候选集**。它按 `kind`（`bucket_t5` / `rank_fixed_t5` /
  `rank_te_only` / `rank_dynamic_first`）从 **3F 候选映射**里取候选，并用 `scoreRankCandidates` 把排序值
  **重算成 3F 分位**（`scoreRankCandidates` 内部三因子分位平均）⇒ 塞进去的 `preReturn10` 排序会被**覆盖**。
- ⇒ 结论：**候选集必须由实验自己构造**，`buildCompositeSourceRun` 只能复用其「逐日 dayRecords →
  `evaluateCandidateRun` → `computeCandidateEvaluationRunFingerprint`」的**收尾机制**，不能复用其候选来源。
- ✅ 已处置：在 `compositeRunnerBridge.ts` **追加零实现 re-export**
  （`runTradeSimulation` / `evaluateCandidateRun` / `computeCandidateEvaluationRunFingerprint` /
  `canonicalMetrics` + 相关 type），**未新增任何逻辑、未新增第二套引擎、未新增第二套指标出口**。

### 门禁 B · Runner 尾窗**静默 MTM**，且新尾窗推导**不读 `runnerBridge.extendToHoldingDays`**

- 实测（`server/research/simulator/engine.ts`）：**行情缺失既不抛错也不截断** ——
  执行日无 bar 的订单记 `REJECTED/SUSPENDED` 并在**下一个决策日**重排；
  回测结束时按 `portfolio.finalizeOpenTrades(lastClosePrices)` 记
  `{openAtEnd: true, reason: "回测结束仍持仓", exitPrice: 最后有效收盘}`。
  **引擎内不存在任何 `DATA_COVERAGE_BLOCKED` 或覆盖率错误信号。**
- 🔴 未提交的 `server/runWorkbenchAssembly/assemble.ts#resolveEventWindowExitTailTradingDays` 把尾窗推导为
  `max(maxHoldingDays, max(strongHold.extendToHoldingDays, strongHold.runnerExitAtHoldingDays)) + 20`，
  **从不读 `policy.runnerBridge.extendToHoldingDays`**。
  以 3600005 的政策（`maxHoldingDays=5`、`strongHold 5→10`、无 `runnerExitAtHoldingDays`）推导出 **30**，
  而 `runnerBridge.extendToHoldingDays = 74` ⇒ **尾部被静默截断成 `openAtEnd`**，而且**看起来像正常期末持仓**。
- ⇒ 处置：本轮**显式注入** `runnerBridge` 并**显式声明执行尾窗**；
  且必须在实验侧**独立断言覆盖**（统计 `openAtEnd === true` 且 `holdingPeriod` 未达预期者），
  **不得**把静默 MTM 当成正常期末持仓。

### 门禁 C · 780004 物理**不能**覆盖「早期入场 + hold=74」

- 780004 `post ≤ rd80`（`DATASET_POST_MAX_RELATIVE_DAY = 80`）。
  早期入场（rd3..9 确认、rd4..10 成交）+ Runner 最长 74 持有日 ⇒ 最远约 **rd84**。
- 变体路径同样封死：`buildPooledDatasetCursorFromRegistry` 要求
  `poolAgeCapTradingDays + exitTailTradingDays ≤ postRange.max`，即 `10 + 74 = 84 > 80` ⇒ `POOL_AGE_CAP_EXCEEDED`。
- 🔴 **本条与 S1/S2 的量化一致但不是同一件事**：S1/S2 量化的是「**实际**可能受影响的笔数」
  （潜在事件 **119 个 / 0.58%**，需同时满足触发∧入选∧买入∧持有到第 75 天），
  而本条是**结构性上界**。两者都成立。

**门禁 C 的处置选项（需用户裁定，本文不自行选择）**

| 选项 | 内容 | 代价 / 风险 |
|---|---|---|
| **C-1（推荐，本轮可执行）** | 模拟窗口终点 = 数据集物理末端；期末未平仓按**最后有效收盘** MTM 并在报告中**单列**；对「本应继续持有但行情已用尽」的持仓标记 **`DATA_COVERAGE_BLOCKED`**（实验侧自检，引擎无此信号）；**不缩短 74 日政策、不在 rd80 强制卖出、不剔除需要长持有的赢家** | 结论窗口末端约 3 个交易日的 Runner 尾部不可观测；**不改变**其余 99.4% 事件的可观测性 |
| **C-2** | 先出一份「更长 post（≤120）新数据集版本」的构建影响与预计行数报告，**经明确授权后**走正式 Dataset 构建 | 需新版本 + 一次全量构建；**未获授权前不得执行**（目标 §6 明确） |
| C-3（不建议） | 缩短 Runner 政策 / 在 rd80 强制卖出 / 剔除长持赢家 | **目标 §6 明文禁止** |

---

## 3. 剩余工作（S3 其余 / S5 / S6），按依赖顺序

1. **服务侧滚动池面板与身份装配**（新增 server 模块，**不新建引擎/指标出口**）：
   复用 `datasetFromRegistry` 的读取层 + `datasetIdentityProvider#resolveSecurityIdsByEvent`
   （canonical `sec_<uuid>`）+ `eventScopedSecurityId`；产出实验可消费的
   `{rows, canonicalSecurityIdByEventId, tradingDays}`，并给出**紧凑**数据集
   （只保留 `sourceRun` 意图涉及的证券，与 `buildCompactResearchDatasetFromCursor` 同构）。
2. **冻结退出政策的唯一读取器**：按 `id=3600005` 读 `strategyDocumentJson`，
   **断言指纹 `f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfc`（响亮失败）**，
   取 `definition.exit.rules[0].policy` 原样使用；仓位改为**统一** `EQUITY_RATIO / equity-fraction 0.20`
   （旧 `positionTiers` 0.05/0.20/0.25 **不继承**）。
3. **实验编排**：`buildDailyPool`（复用）→ `evaluateEarlyEntries`（本轮）→ 每日触发候选 →
   R 排序 / 200 固定种子随机 → 逐账户 sourceRun → `runTradeSimulation` → `canonicalMetrics`。
4. **S4 账户层测试**（目标 §8 剩余项）：T+10 成交上限、停牌不跨截止、锚点不刷新、
   同股多事件不重复持仓、同锚点已买不再买、20% 预算随权益变化且同日基数一致、
   Runner 尾部缺口**响亮失败**、候选退出 `DISABLED`、随机同池且确定性。
5. **S5**：预检（账平/边界/资金/确定性，**不据预检收益改规则**）→ 单个正式对照 Run（R + 200 随机账户）。
6. **S6**：`RESULT-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md` + baseline / CHANGE-AUDIT。

---

## 4. 已登记但**未做**（边界声明）

- ❌ 未执行任何 DDL / DML 批量写 / 数据构建；**未修改 780004 / 历史 Run / 策略版本 3600005**
- ❌ 未新增或修改任何契约字段（`executionSurface` 沿用默认 `SINGLE_EVENT`；
  🔴 已核实 `COMPOSITE_PORTFOLIO` **不可用**：其 provider 硬编码本地 660001 缓存工件并**忽略**
  `baselineDatasetVersionId`，扩展行只覆盖 3F 选中事件的 `rd17..80`）
- ❌ 未启动任何 Experiment Run（S3/S4 未完成前不进入 S5）
- ✅ 未新建第二套回测引擎 / 指标出口 / 策略语义 / Dataset 注册坐标
