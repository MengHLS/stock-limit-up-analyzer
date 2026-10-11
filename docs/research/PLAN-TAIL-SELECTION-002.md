# PLAN-TAIL-SELECTION-002 — 3F **取向翻转**选股实验（预注册 · 已启动执行）

> 任务号：`ROADMAP` §44.5 **`9cq`**（重定向后的内容）。
> 目标（用户原话）：**「本质还是想选出更多的右尾的超级股票」**。
> 证据基础：[`RESULT-TAIL-EXPLORE-001`](RESULT-TAIL-EXPLORE-001.md)（右尾住在**高振幅**里；冻结 3F 反尾）
> · [`RESULT-151PCT-ATTRIBUTION-001`](RESULT-151PCT-ATTRIBUTION-001.md)（Runner = 89.5% 的 151.10pp）
> · [`RESULT-151PCT-WINNER-CONCENTRATION-001`](RESULT-151PCT-WINNER-CONCENTRATION-001.md)
> 口径：`cash-v2`（`IMPACT-NETPNL-SIGN-001` 已修，`BACKTEST_EXECUTION_POLICY_VERSION = 2`）

---

## §-1 🔴 既有资产清查（**新增强制门禁的首次应用**）

> 门禁来源：`PLAN-EXIT-POLICY-001.md` §-2 ——「写任何 `PLAN-*.md` 前必须先清查既有资产」。

清查结果：`research_experiment_run` = **47 个实验 / 162 条 Run**。

### 选股侧**已经测过**的（不得重复）

| 既有资产 | 规模 | 结论/范围 |
|---|---|---|
| `single-factor-v1` | **39 条 Run** | 每个 3F 因子**单独**测过：`maxAmplitude` · `meanAmplitude` · `t1VolumeRatio` · `turnover` · `preReturn10` · `drawdownDepth` · `holdStreak` · `t1OpenGap` · `historyLimitCount` · `amountPercentile` · `limitGap` · `bodyHeight`（ds 660001） |
| `twelve-factor-composite-study` / `-topn-ranking-study` | 2 | 十二因子合成分与 TopN 排名可用性 |
| `composite-factor-*`（2F/3F/4F/12F · equal/weighted · OOS） | 11 | 组合因子评分族 |
| **t74 P0 / P0-2 / P1** | 3 | 3F 排序 **× 趋势评分融合** / 趋势分门槛 / 趋势 v2 |
| **t74 P4 / P6 / P7 / P8 / P9 / P10** | 7 | 选股广度 TopN 3→5 / 跨日候选池 / 重评分 / 延迟入场+滚动 3F / 事件 gate / 上市龄过滤 |
| `pre-event-context-study` | 2 | 首板前空窗期与前期涨幅（≈ 我 9cp 的 `daysSincePreviousLimit`） |
| `oversold-gap-reversal-validation` | 3 | 超跌长间隔首板（≈ 长间隔方向） |
| `post-event-amplitude-study` | 2 | 首板后振幅（振幅维度） |
| `turnover-study` · `body-*` · `volume-*` · `fundamental-study` | 18 | 单维度研究 |
| **退出侧** P2 / P3 · `entry-aligned-exit-horizon-study` 等 | 1+1+9+… | 车位 / 扩大止损 / 退出视界 —— **已答，9cq 原方案因此作废** |

### ✅ 真正的缺口（本方案唯一依据）

> **没有任何既有实验把 `maxAmplitude` / `meanAmplitude` 的取向从 LOW 翻成 HIGH，
> 也没有任何实验把排序目标从「均值」换成「尾部」。**
>
> P0/P1 是在**同取向**的 3F 排序**之上叠加**趋势分；P4 是加宽度；P6–P8 改池/入场时点；
> P9 是 gate；P10 是池过滤。**没有一个是动取向或动目标的。**

### ⚠️ 先验（负面，必须记录）

1. 既有程序试过两次「换排序」（P0 趋势融合 / P1 趋势 v2）⇒ **−166 ~ −228pp**。
2. 我 9cp 池级实测：反向取向 `rd60 ≥+100%` 命中 **70 vs 44（+59%）**，但 `rd60` 均值从 **+0.858% → −3.06%**。
3. 支持它的唯一理由：退出政策会把尾巴转成 P&L（Runner 38 笔 = 80%），而**池级均值测不到这件事**
   （`RESULT-151PCT-ATTRIBUTION-001` §3：单笔均值说退出 −0.66pp，组合净额 +135.31pp）。

## 0. 要回答的唯一问题

> **把 3F 的振幅取向翻过来（`1 − Σ(oriented)/3`），在冻结已验证的 Runner 退出政策下，
> 能不能在组合层拿到更多的右尾超级股票（`≥+50%` / `≥+100%`），代价是什么？**

## 1. 事前固定口径（**事后不改**）

| 项 | 值 |
|---|---|
| 数据集 | 扩展 ds **780001**（v8）；基线 ds 660001；与 run `6210006` 同坐标 |
| 窗口 | `2019-01-01 .. 2026-09-04` |
| 组合 | 初始 100,000 · `topN = 3` · `maxPositions = 5` · 成本模型逐项同基准 |
| 执行 | `NEXT_OPEN` · `blockLimitUpBuys = true` · 策略政策 **v2** |
| Runner | `{ kind: "PIT_RUNNER_HOLDING_BRIDGE", state: "NEW_HIGH_3", decisionHoldingDays: 5, extendToHoldingDays: 74 }` |
| 唯一自变量 | **排序键取向**（正交项：Runner 延长上限） |
| 口径 | `cash-v2` |

## 2. 臂（🔴 **B 与 C 在数学上合并为一臂**，见下）

```
翻转取向：排序键 = 1 − Σ(oriented)/3，再取 topN
        ⇔ 按 Σ(oriented)/3 升序取前 N
        ⇔ 「现行 top-3 的反向」
```
**`1 − x` 是严格单调递减变换 ⇒ 选中集合与破平顺序逐笔相同。**
⇒ 原方案的「臂 B 取向翻转」与「臂 C 排序目标反向」**是同一件事，合并为 B**。

| 臂 | 内容 | 作用 |
|---|---|---|
| **A0** | 控制（冻结 3F top3）· **无** Runner | 给 A 的 runner trigger 做差；同时验证 `CONTROL_A = 15.7876907121%` |
| **A** | 控制（冻结 3F top3）· **有** Runner | **ABORT 门禁臂**：必须复现 `151.0958341843399%` / 1434 笔 / trigger 161 |
| **B0** | **取向翻转** · **无** Runner | 给 B 做差 |
| **B** | **取向翻转** · **有** Runner | 🔴 **回答用户目标的臂** |
| **D** | 取向翻转 · **Runner 延长上限 14 → 30** · 有 Runner | 两杠杆耦合（`strongHold.runnerExitAtHoldingDays`） |

**每臂必报**：`总收益%` · `MaxDD%` · `笔数` · 🔴 **`≥+50%` 笔数** · 🔴 **`≥+100%` 笔数** ·
`胜率%` · `runnerTrigger` · `Runner 对 50+ 组的 P&L 占比%` · `亏损均值%` · `最差笔%` · `P5%`。

## 3. 事前判据（**事后不改**）

| 观察 | 判定 |
|---|---|
| **A 复现** `151.0958341843399`（容差 `1e-6`）**且** 1434 笔 **且** trigger 161 **且** A0 = `15.7876907121` | ✅ 门禁过，结果可解读 |
| **B 的 `≥+50%` 笔数 > A 的** · 且 **B 的总收益 ≥ A 的** | ✅ **取向翻转同时增尾与增收** ⇒ 该方向成立，值得推进 |
| **B 的 `≥+50%` 笔数 > A 的** · 但 **B 总收益 < A 的** | ⚠️ **「尾–均值张力」在组合层成立**：选出了更多超级股票，但被其余仓位的均值恶化吃掉 ⇒ **如实登记，方向不成立** |
| B 的 `≥+50%` 笔数 ≤ A 的 | ❌ 翻转**不增尾** ⇒ 9cp 的池级 +59% 在组合层不成立（容量/退出把它抹平） ⇒ 关闭该方向 |
| B 的 `MaxDD%` 比 A 恶化 **> 15pp** | ⚠️ 该臂收益不可用（靠风险换来的），如实登记 |
| 任一臂笔数 ≈ 1434（容量饱和） | ✅ 预期；`1863 天 × 5 车位 ÷ 中位持有 6 天 ≈ 1433` |
| D 优于 B | ✅ 延长上限与取向翻转**正耦合** ⇒ 记录为下一轮方向 |

## 4. 🔴 ABORT 条件

**A 臂必须同时满足**：`|ret − 151.0958341843399| < 1e-6` · `trades === 1434` · `trigger === 161` · `|A0 − 15.7876907121| < 1e-6`。
**任一不符 ⇒ 立即停止，不解读任何其他臂**（说明装配漂移或口径变化）。

## 5. 不变量与红线

- 🔴 **冻结契约 `FROZEN-BUCKET-CONTRACT-001` 不得修改**：桶边界 / 方向表 / 桶位分公式 / 等权公式**逐字不动**。
  翻转只能通过**新增 opt-in 特征**表达（`1 − x`，数学等价于三方向全翻，浮点同源）。
- 🔴 **不改正式 N3/N5**：正式策略仍用冻结特征与正式版本号（1.9.0）。
- 🔴 **不改数据集 / 窗口 / 成本模型 / 执行政策 / 选股宽度 / 车位 / 止损 / 时间退出 / MA 止盈**。
- 🔴 **不做网格**：仅上述 5 臂；看过结果后**不得**加臂（那是参数搜索）。
- 🔴 **不得用单笔均值下结论**（`RESULT-151PCT-ATTRIBUTION-001` §3 的教训）。
- ✅ 本步为**纯计算**（`runCompositeRunnerBacktest` 只算不写）⇒ **0 DB 写入、0 新 Run 行**；
  若结果值得留档，再按既有实验范式建正式实验入口与持久化 Run。

## 6. 实现落地（**修正版**：落在真正生效的层）

### 6.1 🔴 第一次尝试失败（如实登记）：pattern 层实现**够不到目标**

初版把翻转实现在 **pattern / 特征层**（`PatternFeatureKey` 新增 `threeFactorCompositeInverted`
+ `recipeRegistryAtoms` 变体 + 模式变体 + 文档装配开关，共 6 处纯增量 + 6/6 测试）。
**首轮 5 臂执行被 §4 ABORT 门禁拦下**：`A0 ≡ B0`、`A ≡ B ≡ D` **逐位完全相同**。

**根因**：`server/research/compositeRunner/index.ts` 的 `scoreRankCandidates`（`:381-400`）
与扫描期 `threeFactorCompositeScoreOf`（`:371` 附近）**各自持有 3F 排序**，
**完全不读 StrategyDocument 的配方排序特征** ⇒ 改文档排序对该路径**零影响**。
（顺带查出一处平台隐患：研究路径的百分位合成分与文档声明的桶位分合成分**方向相同、公式不同**，
所以「改文档排序失效」这个陷阱一直存在，只是所有既有实验都用默认取向而未被暴露。）

🔴 **该 pattern 层实现已按用户裁定 (一a) 全部回退** —— 它没有消费者，
而仓库明确反对「声明了却无效」的静默面（`recipeRegistryAtoms.ts:253-255`）。

### 6.2 ✅ 修正版实现（落在真正排序的层，2 处纯增量）

| 文件 | 改动 |
|---|---|
| `server/research/compositeRunner/index.ts` | ① 新增导出 `orientAmplitudeScore(score, orientation)`：`"LOW"` = 恒等（**缺省，逐位不变**）、`"HIGH"` = `1 − score`；② `buildCompositeEvents(dataset, maxAmplitude, { amplitudeOrientation })` —— 扫描期桶位分经该函数取向化；③ `buildFirstLimitPullback3FTop3SourceRun(…, { amplitudeOrientation })` 作为 opt-in 入口（与既有 `rankFusion` / `candidateGate` / `candidateScoreV2` / `candidateListingFilter` 同范式，缺省 = 既有行为逐字不变） |
| `tests/server/research/compositeRunner/amplitudeOrientation.test.ts` | 4 例：缺省恒等 / `HIGH = 1 − s` / 对合性与严格反序（TopN→BottomN）/ **与「三方向全翻」等价**（`1 − mean(oriented) = mean(1 − oriented)`） |

🔴 **冻结契约 `FROZEN-BUCKET-CONTRACT-001` 未被修改**：桶边界与方向表仍在
`recipeFeatures/threeFactorScoreFeatures.ts` 原处不动，本层只做取补。
`rebuildCompositeRun` **不重新扫描**（只换坐标 + 重算指纹）⇒ 翻转必须在源码构造处生效（已如此）。

**登记义务**（AGENTS.md §8，新 contract ⇒ minor）：`CHANGE-AUDIT.md` + `SYSTEM-BASELINE.md` + `system-manifest.yaml`。

## 7. 执行状态

| 步骤 | 状态 |
|---|---|
| 既有资产清查（§-1） | ✅ |
| 预制预注册（臂 / 判据 / ABORT 冻结） | ✅ |
| pattern 层实现 | 🔴 已回退（够不到目标，见 §6.1） |
| `compositeRunner` 层实现 + 测试 | ✅ 4/4 · `check` 0 错 |
| **5 臂真实执行** | 🔴 **被 ABORT 门禁拦下，结果不可解读**（见 §7.1） |
| DB 写入 | **0**（`closed_loop_backtest_run` 最新仍 `6210006`；`research_experiment_run` 仍 162 条） |

### 7.1 ABORT 门禁记录（**第二次开火**）

`scripts/_scratch/runInvertedArms.mts`（纯计算）实测：

| 臂 | 实测 | §4 期望 | 笔数 |
|---|---|---|---|
| A0 控制·无 Runner | 13.2676340956% | 15.7876907121% | 1359（期望 1619） |
| A 控制·有 Runner | 15.4987447563% | **151.0958341843399%** | **21**（期望 1434） |

⇒ **门禁失败 ⇒ 按 §4 不解读任何臂。**
🔴 **这次门禁拦下的是一个错误结论**：若无门禁，会得出「翻转取向毫无影响」——
而真实原因是**我的脚手架装配与既有实验不一致**（Runner 臂退化到 21 笔），
以及翻转当时尚未落在生效层。**两次开火都避免了假结论。**

### 7.3 ✅ 修正后有效运行（`RUN-20261007-A5B5DC3D` · COMPLETED · 163s）

根因修复：给 `CompositeExtensionSelectionArm`（`server/researchExperiments/compositeDatasetProvider.ts`
**及** `shared/researchExperimentsContracts.ts`）新增 `amplitudeOrientation`，
provider 改为**按取向分组建候选**（每个用到的取向只扫一次，取并集装载 rd17..80）；
本实验声明 **两个** 取向臂。缺省（无臂声明 HIGH）行为逐字不变。

**ABORT 门禁（§4）：5/5 通过** —— A0 `15.7876907121299`（差 3e-11）· 1619 笔 ·
A `151.09583418434`（差 1e-10）· 1434 笔 · trigger 161 ⇒ **`pass = true`**。
且 A0/A 与上一轮**逐位相同** ⇒ 并集面板未扰动控制臂，对照干净。

| 臂 | 取向 | Runner | 收益% | MaxDD% | 笔数 | **≥+50%** | **≥+100%** | trigger |
|---|---|---|---:|---:|---:|---:|---:|---:|
| A0 | LOW | 无 | 15.79 | 54.81 | 1619 | **4** | 0 | — |
| **A** | LOW | 有 | **+151.10** | **43.30** | 1434 | **9** | **2** | 161 |
| B0 | HIGH | 无 | **−31.13** | 60.41 | 1210 | **6** | 0 | — |
| **B** | HIGH | 有 | **−29.99** | 60.34 | 1180 | **9** | **0** | 45 |
| D | HIGH | 有（延长 30） | −29.99 | 60.34 | 1180 | **9** | 0 | 45 |

### 7.4 🔴 结论（对照 §3 事前判据）

| §3 判据 | 实际 | 判定 |
|---|---|---|
| B 的 `≥+50%` 笔数 **>** A 的 | **9 vs 9 — 持平** | ❌ **未增尾** |
| B 的 `≥+100%` | **0 vs 2 — 更少** | ❌ **更差** |
| B 的总收益 ≥ A 的 | **−29.99% vs +151.10%（差 181pp）** | ❌ 远差 |
| B 的 MaxDD 恶化 > 15pp | 60.34% vs 43.30%（**+17.0pp**） | ⚠️ 收益不可用（靠风险换） |
| 笔数 ≈ 1434（容量饱和） | B 为 1180（**未饱和**） | — |

> **⇒ 「靠翻转取向选出更多右尾超级股票」在组合层不成立，方向关闭。**

### 7.5 🔴 机制（为什么池级 +59% 到组合层变成 0）

1. **持有期结构上够不到 rd60 的尾巴**：组合中位持有约 6 天，而 `9cp` 的 +59% 是 **rd60** 口径 —— 已登记的局限在组合层兑现。
2. **高振幅 + −6% 固定止损结构性对立**：高振幅名字更频繁触及 −6% 止损，
   **波动被当成亏损收割掉，而不是让尾巴长出来**。证据：
   - **Runner 触发 161 → 45**（延长机制几乎失效）
   - **≥+100% 命中 2 → 0**
   - MaxDD **43.30% → 60.34%**
3. **尾–均值张力第四次出现**：B0（无 Runner）−31.13% vs A0 +15.79%，**差 47pp**。

**⇒ 结论：** 在**已验证的退出政策**（−6% 止损 + 6 天中位持有）下，
**提高振幅取向只会把波动换成止损，不会换成超级股票。**
若要利用高振幅池的厚尾，**必须同时改退出政策**（放宽/取消固定止损 + 显著延长持有），
那是另一个自变量，本实验**未测**（且 §5 红线禁止在同一实验里再放第二个自变量）。
