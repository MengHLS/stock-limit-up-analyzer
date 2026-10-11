# PLAN-CROSS-SECTIONAL-FACTOR-001 · 12 个既有因子的横截面排序能力 · 多持有周期预注册

> 任务：`CROSS-SECTIONAL-FACTOR-001`
> 状态：**BLOCKED_ON_CALIBER_RULING** —— 口径冲突未裁定前**不实施、不执行真实 Run**（详见 §3 / §6）
> 本阶段范围：**既有资产清查 → 口径确认 → 实验设计 → 预注册**（不执行真实 Run）
> 基线：HEAD `f8b6810`（工作区存在长期未提交改动，含 `server/researchExperiments/compositeDatasetProvider.ts`、`server/research/compositeRunner/index.ts`、`shared/researchExperimentsContracts.ts`）
> 依据：`.agents/research/SKILL.md` §3（机械约束）+ §3.5（P1–P6 科学有效性必答清单）· `docs/research/PLAN-RESEARCH-DESIGN-001.md`
> **本文档不改任何代码 / Dataset / Schema / 历史 Run；不创建 Candidate；不产生 Run。**

---

## 0. 研究问题与唯一交付

> 在同一交易日、同一有效候选池中，单个因子能否把未来表现更好的股票排到前面？
> 这种横截面排序能力分别对应 `T+1` / `T+5` / `T+10` / `T+20` 哪个持有周期？

**事件锚点**：`T0` = 每只股票**实际发生有效回踩**的事件日（**禁止**固定 `T+6`；不同股票允许不同 `T0`）。
**因子**：仅现有 12 个冻结因子（禁止新增 / 禁止组合 / 禁止权重优化）。
**档位**：`Top1` / `Top3` / `Top5` / `Top10` / `All` / `Bottom3` / `Random3`。
**周期**：`T+1` / `T+5` / `T+10` / `T+20`。
**输出**：`Mean` / `Median` / `WinRate` / `Top-vs-Bottom Spread` / `Rank IC` / `Top-K − All` / `≥+20%` / `≥+50%` / `≥+100%` / 样本数；全周期 + 年度切片。

---

## 1. 既有资产清查结果

### 1.1 平台事实（只读 DB 探针，本轮实查）

`research_experiment_run` = **48 个实验 / 165 条 Run**。`first_limit_pullback`（`datasetId=120001`）的版本：

| datasetVersionId | label | 窗口 | 事件数 | postWindowDays | 上市龄过滤 | 状态 |
|---|---|---|---|---|---|---|
| **660001** | `v5` | 2019-01-01 ~ 2026-09-04 | 73,003 | 20 | **NULL** | READY |
| 720001 | `v6` | 同 | 102,878 | 80 | **NULL** | READY（`boards=[]` 全板块） |
| 750001 | `v7` | 同 | 73,003 | 80 | **NULL** | READY |
| **780001** | `v8` | 同 | 73,003 | 80 | **NULL** | READY（T74 链在用） |
| 780002 | `v9-smoke` | 2019-01-02 ~ 2019-03-29 | 2,315 | 80 | **365 自然日** | READY |
| 780003 | `v9` | 2019-01-01 ~ 2026-09-04 | — | 80 | 365 自然日 | **FAILED（无数据）** |

🔴 **三个决定性事实**：
1. **12 个冻结因子全部历史 Run 都跑在 `v5`（660001）上**，而 `v5` 的 `excludeListedWithinDays = NULL` ⇒ **既有 12 因子池从未排除次新股**。
2. **全窗口的次新过滤数据集 `v9` 是 FAILED**；带数据的只有 3 个月 smoke（`v9-smoke`，2,315 事件）。
3. 🔴 **全仓唯一「消费带上市龄过滤数据集」的已注册实验 = `first-board-pullback/trend-entry-ma-v1`**（`experiment.ts` L195 `requiredDatasetVersionLabel: "v9"`，自述「主板 · 非 ST · **上市龄 ≥ 365 天**」）——而它指向的 `v9`（780003）**是 FAILED 版本**，且该实验在 `research_experiment_run` 中**零条 Run**。
   ⇒ **「带上市龄过滤的 12 因子类实验」在本仓既没有可用的数据集版本，也没有任何成功先例。**

### 1.2 已注册实验中与本问题相关的部分

| 实验 id | 回答的问题 | 决策锚点 | 入场 / 退出 | 单因子横截面 | 多周期 | Rank IC | 次新 |
|---|---|---|---|---|---|---|---|
| `first-board-pullback/single-factor-v1` | 单因子横截面 TopN 相对当日池有无超额 | 首板日 `T`（信息截止 T+5 收盘） | `T+6` 开盘 / `T+10` 收盘 | ✅ 12 因子（**原始值**） | ❌（`N` = 组合规模，**不是**持有周期） | ❌ | ❌ |
| `.../twelve-factor-topn-ranking-study` | 综合评分能否挑出前几名 | 同上 | `T+6` / `T+10` | 对照臂（**桶位分**） | ❌ | ❌ | ❌ |
| `.../twelve-factor-composite-study` | 评分分档有无梯度 | 同上 | `T+6` / `T+10` | 分桶表 | ❌ | 仅「档序 ↔ 档均值」Spearman | ❌ |
| `.../entry-aligned-exit-horizon-study` | 入场对齐的退出视界曲线 | `T+6` | 多退出日 | ❌ | ✅（但**非因子横截面**） | ❌ | ❌ |
| `.../composite-runner-newhigh3-t74-*`（14 个） | 组合层 P0–P10 旋钮 | Runner | Runner | ❌ | ❌ | ❌ | 仅 P10（opt-in 臂） |

> ⚠️ **必须防止的误读**：`single-factor-v1` 结果表里的 `N3 / N5 / N10 / N20` 是 **Top-N 组合规模**（取前 N 名），**不是持有周期**。既有 12 因子的横截面实验**只测过一个退出坐标（`T+10`）**。

### 1.3 历史结果文档（脚本驱动，非注册实验）

| 文档 | 因子 | Base Universe | T0 | 周期 | 指标 | Gate / 结论 |
|---|---|---|---|---|---|---|
| `RESULT-SINGLE-FACTOR-V1-12F-001.md` | **12 个冻结因子** | `first_limit_pullback` v5 入池池（70,236） | 首板日 `T` | 退出 `T+10` | 配对日度超额（12×8 组合）+ 年切片 | 96 格：POS 12 / NEG 31 / INC 53 / INSUF 0 |
| `RESULT-12F-TOPN-001.md` | 综合评分 + 12 单因子桶位分 | 同上 | 首日 `T` | 退出 `T+10` | 超额 / 随机基准 / 深度曲线 / 年度 | 6 档 × 2 日集 **全部 INCONCLUSIVE**；Top1 落在随机分布 **第 5.6 百分位** |
| `RESULT-CROSS-SECTIONAL-FACTOR-MINING-002.md` | **20 个新因子** | **RCP-P0-v1**（含 120 交易日上市龄过滤） | 任意信号日 `T` | `T+1/3/5/10` | Top1%/3%/5%/10%、Q1–Q5、Bottom10%、Pool、**Rank IC / ICIR**、三时期 | `NO_MONOTONE_FACTOR_FOUND`（A/B = 0/20） |
| `RESULT-HORIZON-REVALIDATION-001.md` | **39 个因子**（20+16+3） | RCP-P0-v1（FILTERED / FULL） | 任意 `T` | **`T+1/3/5/10/20/40/60`** | Top1%/3%/5% − Pool | `HORIZON_STRUCTURE_FOUND`：**27/39 多周期**，最佳多在 **T+40/T+60** |
| `RESULT-REALTIME-RANKING-001.md` | 11 个因子（**含 4 个与冻结因子同族**） | RCP-P0-v1 | 任意 `T` | `T+1/3/5/10` | **Rank IC / ICIR**、TopN/BottomN、Top−Bottom spread、胜率、MAE/MFE、**分年** | **`RANKING_FACTORS_FOUND`**：4 因子 8/8 年 IC 同号 + 单调性 ρ 0.61–0.95 |
| `RESULT-FILTERED-POOL-ALPHA-MINING-001.md` | `MINING-002` 的 20 个 | RCP-P0-v1 的 **Filtered Pool**（剔 `ret_5` 最高 20%） | 任意 `T` | `T+1/3/5/10` | Top1/3/5/10%、Q1–Q5、Bottom10%、Pool、Rank IC | `STRUCTURE_ONLY`：**A 正向 0 个** / B 反向 9 个；反向集中在**极端上端**（驼峰） |
| `RESULT-PR-TOPN-FORWARD-VALIDATION-001.md` | PR score | RCP-P0-v1 | 任意 `T` | `T+1` | Top3/Top5 − Pool、**Rank IC** | Top3/Top5 稳定跑赢 Pool，**但 `Top < Bottom10` 且 Rank IC ≈ 0** |
| `RESULT-3F-TOPN-NO-PULLBACK-GATE-001.md` | 3F | v5 | `T+6` | 策略退出 | 组合指标 | 移除回踩门槛略改善但仍显著为负 |

### 1.4 既有 Rank IC 实现

- **`research-experiments/**` 内零 Rank IC 实现**（全仓 grep `rankIc|RankIC|rank_ic` = 0 命中）。
- 唯一的逐日 Rank IC 来自 `scripts/_scratch/**` 的一次性脚本（`RESULT-CROSS-SECTIONAL-FACTOR-MINING-002` / `RESULT-HORIZON-REVALIDATION-001`），**未进实验框架、未注册、未纳入 Run 机制**。
- `twelve-factor-composite-study/result.ts#spearman` 算的是「十分位档序 ↔ 档均值」，**不是**逐日横截面 Rank IC。

### 1.5 既有「有效回踩」实现

| # | 位置 | 语义 | 是否给出**可定位的回踩日** |
|---|---|---|---|
| **A** | `research-experiments/first-board-pullback/twelve-factor-composite-study/derive.ts#deriveTwelveFactorSamples`（Pass D）· 原因码 `NO_PULLBACK_IN_OBSERVATION` | `T+1..T+5` 内**任一收盘 < 首板日收盘**（`bar.close < eventClose − ε`） | ❌ **布尔入池门**，不记录日 |
| **B** | `server/research/compositeRunner/index.ts#buildCompositeEvents`（L237） | 同上（窗口 `T+1..Te`，`Te` 可配） | ❌ 布尔门（`pullbackByTe: Map<Te, boolean>`） |
| **C** | `server/researchDataset/pullback.ts#screenSingleTarget` → `PullbackTargetResult.hitDate` | 目标位（`limitPrice`/`t0Open`/`t0Low`/`ma5`）**触及且不破**，容差可配；`hitDate` = **窗口内最低价所在日** | ✅ 有日，但：① 属**另一条 Dataset 链**（`server/researchDataset/**`，非 `first_limit_pullback`）；② 参考基准是**目标位**而非「首板收盘」；③ 需要**整窗**才能算出 ⇒ **回顾性**，不是 PIT 锚点 |
| **D** | `ds_first_limit_pullback_path.pullbackFromEventHigh = low / eventHigh` | 逐相对日的衍生比率，参考基准是**首板最高价** | ⚠️ 逐日有值但**实验取数面读不到**（`datasetPort.ts` 只映射 `event`/`prefix`/`post`，**不含 `path`**） |

⇒ **`first_limit_pullback` 规范事件体系里不存在「有效回踩事件日」这个概念**，只有「窗口内是否回踩过」的布尔门。

### 1.6 可复用资产（零重复建设）

| 复用对象 | 出处 | 方式 | 改动 |
|---|---|---|---|
| 样本口径 `Pass A~D` | `twelve-factor-composite-study/derive.ts#deriveTwelveFactorSamples` | 直接调用 | **零**（仅新增只读的「回踩日」派生视图，不改任何判定） |
| 12 因子定义 / 冻结桶 / 方向 | `twelve-factor-composite-study/result.ts`（`FROZEN-BUCKET-CONTRACT-001` 唯一落地处） | 直接 `import` | **零** |
| 因子目录 | `shared/singleFactor/factorResolver.ts#FROZEN_TWELVE_FACTOR_CATALOG` | 直接引用 | **零** |
| 横截面分组 / 取头 | `shared/singleFactor/ranker.ts#buildCrossSections` / `#selectTopN` | 复用分组；扩展档位集合 | 档位 `3/5/10/20` → `1/3/5/10/All/Bottom3/Random3` |
| 成本模型 | `shared/firstBoardPullback/cost.ts` + `shared/singleFactor/coordinate.ts` | 直接引用 | **零**（往返 20 bps，含 `assertTemplateCoordinate()`） |
| 日期聚类 Bootstrap | `shared/dateClusterBootstrap.ts#movingBlockBootstrapMean/Difference` | 直接引用 | **零**（iter=1000 / block=20 / 固定种子） |
| 判据模板 | `PLAN-12F-TOPN-001.md` §5（配对日度超额 + 随机基准 + 深度曲线 + 年切片） | 照搬 | 增 Rank IC / 尾部计数 / 多周期 |
| 结果装配 | `shared/singleFactor/resultWriter.ts` | 扩展 | 增 Rank IC / 尾部 / P1 / P3 表 |
| 公共底座 | `shared/firstBoardPullback/wrapExperiment.ts#withFirstBoardPullbackFoundation` | 直接引用 | **零** |
| 两个注册点 | `research-experiments/manifest.ts` + `client/src/researchExperiments/pages.ts` | 各 +1 行 | **零** |

### 1.7 需要**新建**的能力（既有资产均不具备）

1. 变周期持有（`T+1` / `T+5` / `T+10` / `T+20` 四个退出坐标）
2. 逐日横截面 **Rank IC**（`Spearman(factorValue, forwardReturn)` per day + 时序统计 + ICIR + IC 正日%）
3. **Top-vs-Bottom Spread**（`Top3 − Bottom3`）
4. 尾部计数：`≥+20%` / `≥+50%` / `≥+100%` 命中率
5. **排序分辨力四件套**（P3）—— 既有 `shared/singleFactor/**` 无任何 tie/分辨力诊断（grep `tie|distinct|uniqueValue` = 0）
6. **`excludedByReason` 桶的靶画像**（P1）
7. **「有效回踩日」作为 `T0` 的机制**（既有只有布尔门）

### 1.8 覆盖度判定：该问题是否已被已有 Run 直接回答？

**结论：未被直接回答；但存在两个必须引用的强先验。**

| 子问题 | 是否已回答 | 证据 |
|---|---|---|
| 12 个冻结因子能否横截面挑出更好的股票？ | ✅ **已答，但在 `T+6 → T+10` 单一坐标上** | `RESULT-SINGLE-FACTOR-V1-12F-001`（12 真实 Run）+ `RESULT-12F-TOPN-001` |
| 哪个持有周期最明显？ | ✅ **已答，但是在另一批因子 + 另一个池上** | `RESULT-HORIZON-REVALIDATION-001`（39 因子 / RCP-P0-v1 / T+1..T+60） |
| 「横截面排序 + Rank IC + 多周期 + 分年」的**完整方法学**是否已有先例？ | ✅ **已有，但全部在 RCP-P0-v1 上**（4 个独立研究，Gate 互相冲突） | `REALTIME-RANKING-001`（`RANKING_FACTORS_FOUND`）· `MINING-002`（`NO_MONOTONE_FACTOR_FOUND`）· `FILTERED-POOL-ALPHA-MINING-001`（`STRUCTURE_ONLY`）· `HORIZON-REVALIDATION-001`（`HORIZON_STRUCTURE_FOUND`） |
| 以**实际有效回踩日**为 `T0` 的横截面排序 | ❌ **从未做过** | §1.5：规范体系无「回踩日」概念 |
| 12 个冻结因子在 `T+1/T+5/T+10/T+20` 的横截面排序能力 | ❌ **从未做过** | §1.2：既有只测 `T+10` 一个退出 |
| 12 个冻结因子的 **Rank IC** | ❌ **从未做过** | §1.4 |
| **排除次新后**的 12 因子横截面排序 | ❌ **从未做过** | §1.1：既有 12 因子 Run 全在 `excludeListedWithinDays=NULL` 的 `v5` 上 |

**先验 A（同池同因子，不同坐标）**：`RESULT-SINGLE-FACTOR-V1-12F-001` 主判据下 96 格 = POS 12 / NEG 31 / INC 53；`RESULT-12F-TOPN-001` 全部 INCONCLUSIVE，且 `Top1` 落在随机分布第 5.6 百分位（比随机抓一只还差）。同时该坐标下**当日池自身等权日均 −0.370%** ⇒「挑不出来」与「挑出来也不赚钱」是两件事，必须分开读。
⇒ **先验预期：新实验若在四周期上发现显著排序能力，必须解释为何换了 `T0` 与周期后出现。**

**先验 B（多周期结构）**：`RESULT-HORIZON-REVALIDATION-001` ⇒ 横截面效应整体是**长周期现象**（最佳多在 `T+40/T+60`），`T+1` 上 20/20 判「无结构」。
⇒ **先验预期：`T+1` 最可能无结构，`T+20` 最可能显现。**

**先验 C（本实验保留的回踩门本身切掉了更肥的尾）**：`PLAN-RESEARCH-DESIGN-001` §1 缺口1 —— 回踩门剔掉的 **21,667 事件（29.8%）** 右尾**系统性更厚**（`rd20 ≥+100%` **0.26% vs 0.12%，+117%**）。
⇒ 本实验**继续保留**该门（样本资格第 3 条），因此结论只能声明为「**回踩子集内**的排序能力」，不得外推为「全候选池的排序能力」。此点进 P1。

**先验 D（🔴 4 个冻结因子的方向已被独立研究佐证）**：`RESULT-REALTIME-RANKING-001` 在 **RCP-P0-v1**（另一池、另一窗口定义）上判 `RANKING_FACTORS_FOUND`，4 个通过因子与冻结因子**同族**，且**方向与 `FROZEN-BUCKET-CONTRACT-001` 的 `orientation` 完全一致**：

| 独立研究因子 | 冻结因子 | 独立研究方向 | 冻结 `orientation` | 一致？ |
|---|---|---|---|---|
| `maxAmplitude20` | **F5** `maxAmplitude` | 负向 | `−1` | ✅ |
| `priorReturn20` | **F9** `preReturn10` | 负向 | `−1` | ✅ |
| `limitUpCount60` | **F12** `historyLimitCount` | 负向 | `−1` | ✅ |
| `limitUpGapDays` | **F8** `limitGap` | 正向 | `+1` | ✅ |

且该研究给出 **8/8 年 IC 同号** + 单调性 ρ ∈ [0.61, 0.95]。
⇒ **先验预期：F5 / F8 / F9 / F12 最可能是「有排序能力」的候选；其余 8 个因子（含 3 个 `priorVerified = false` 的 F6/F8/F9 中的未验证项）预期更弱。** 本实验若发现与上表相反的方向，必须显式讨论（因为那意味着池/窗口/锚点改变后方向翻转）。

**先验 E（🔴 为什么 `Rank IC` 与 `Top-K − All` 必须并列报）**：`RESULT-PR-TOPN-FORWARD-VALIDATION-001` 的实测反例 —— PR score 的 `Top3/Top5` **稳定跑赢 Pool**（t 3.0–3.4），但 **`Top < Bottom10` 且 `Rank IC ≈ 0`** ⇒ 其「优势」来自「Pool 被最差一组拖累」而非高分股本身更强。反之 `RESULT-CROSS-SECTIONAL-FACTOR-MINING-002` §426 的反例是 `dist_high20`：**Rank IC ≈ 0（+0.0014）却 Top−Bottom = −0.334%（t=−4.73）**，因为关系集中在最极端上端。
⇒ 该研究原文的结论可直接引用为本文档 P2 的依据：**「只看 IC 会漏判尾部驱动的结构；只看 Top/Bottom 又会忽略中段无区分度——两者必须并列报告」**。

---

## 2. 口径确认（已确认部分）

### 2.1 唯一运行时坐标

- `datasetCode = "first_limit_pullback"`；**必须显式记录真实 `datasetVersionId`**，禁止用 label 代替（SKILL.md §5-6）。
- 候选版本（待裁定，见 C6）：`v8`（780001，`postWindowDays=80`，无上市龄过滤）或新建带 `excludeListedWithinDays` 的版本。

### 2.2 12 个冻结因子的定义与分桶边界 —— **确认无歧义，零改动**

唯一权威 = `FROZEN-BUCKET-CONTRACT-001`，代码唯一落地 = `twelve-factor-composite-study/result.ts`。`Σk = 64` 桶，12 因子如下（`orientation`：`+1` = 桶越大分越高）：

| # | code | 定义 | 桶数 | 方向 | 先验 | **信息窗口（相对首板日 T）** |
|---|---|---|---|---|---|---|
| F1 | `bodyHeight` | `(close(T) − open(T)) / previousClose` | 6 | −1 | 有证据 | **T 日** |
| F2 | `turnover` | 首板日换手率 | 6 | −1 | 有证据 | **T 日** |
| F3 | `amountPercentile` | **同日**成交额分位 | 5 | −1 | 有证据 | **T 日**（本身即横截面量） |
| F4 | `meanAmplitude` | **`T+1..T+5`** 平均振幅 | 5 | −1 | 有证据 | 🔴 **需 T+5** |
| F5 | `maxAmplitude` | **`T+1..T+5`** 最大振幅 | 2 | −1 | 有证据 | 🔴 **需 T+5** |
| F6 | `holdStreak` | 守涨停价 streak（收盘口径，自 `T+1` 起、遇不满足即断） | 6 | +1 | ⚠️ 未验证 | 🔴 **需 T+5** |
| F7 | `t1VolumeRatio` | `volume(T+1) / volume(T)` | 5 | +1 | 有证据 | 需 T+1 |
| F8 | `limitGap` | 前次涨停间隔（`UNKNOWN` 为合法桶） | 6 | +1 | ⚠️ 未验证 | **T 日** |
| F9 | `preReturn10` | `close(T−1)/close(T−10) − 1` | 7 | −1 | ⚠️ 未验证 | **T−1 / T−10** |
| F10 | `drawdownDepth` | **`T+1..T+5`** 最低价 / `close(T) − 1` | 5 | −1 | 有证据 | 🔴 **需 T+5** |
| F11 | `t1OpenGap` | `open(T+1)/close(T) − 1` | 5 | +1 | 有证据 | 需 T+1 |
| F12 | `historyLimitCount` | 历史涨停次数 | 6 | −1 | 有证据 | **T 日** |

### 2.3 既有的「有效回踩」布尔门 —— **确认语义**

`T+1..T+5` 内**任一收盘价 < 首板日收盘价**（`derive.ts` Pass D；原因码 `NO_PULLBACK_IN_OBSERVATION`）。窗口上界 `T+5` 来自 `CONTEXT_DAYS = ENTRY_DAY − 1 = 5`。

### 2.4 执行坐标 —— **确认（复用冻结口径）**

| 项 | 取值 | 来源 |
|---|---|---|
| 入场 | `T0+1` **开盘**（条件 `canBuyAtOpen === true`，不成交则剔除，不顺延） | 镜像 `coordinate.ts#UNIFIED_ENTRY_POLICY` |
| 退出 | `close(T0+h)`，`h ∈ {1,5,10,20}`（条件 `canSellAtClose === true`，不可卖则顺延至其后第一个可卖日） | 镜像 `UNIFIED_EXIT_POLICY` |
| 成本 | **往返 20 bps**（单边 2.5 佣金 + 2.5 滑点 + 2.5 冲击，卖出印花税 5） | `FOUNDATION_ROUND_TRIP_COST_BPS`，已断言 `= ROUND_TRIP_COST_BPS` |
| 仓位 | 等权（每笔 `1/N` 名义本金，不做资金管理） | `POSITION_MODEL = "EQUAL_WEIGHT"` |
| 收益 | `netReturn_h = close(T0+h) / open(T0+1) − 1 − 20bps` | 与 `RESULT-HORIZON-REVALIDATION-001` 的 `close(T+N)/open(T+1)−1` 同构 |

> `h` = **持有交易日数**，`h=1` ⇒ `T0+1` 开盘买、`T0+1` 收盘卖（日内）。此约定同时与既有 `single-factor-v1`（`holdingDays = exit − entry + 1`）和 `RESULT-HORIZON-REVALIDATION-001` 一致。

---

## 3. 🔴 口径冲突（**阻断项**）—— 未裁定前不得设计定稿、不得执行

> 按任务要求：「如果发现现有 `first_limit_pullback` 的「有效回踩」定义、次新股定义、事件日定义存在歧义，**先停止设计并报告冲突，不自行决定**。」
> 以下 C1–C7 **全部未自行决定**，逐项列出证据与候选口径，等用户裁定。

### C1 · 「有效回踩事件日」**不存在 canonical 定义**（阻断 `T0` 本身）

**证据**：§1.5 —— 规范体系（A/B）只给出**布尔入池门**，**不记录日**；唯一有日的实现（C）在**另一条 Dataset 链**上，且语义不同、需要整窗（回顾性）。

**候选口径（互斥，必须选一）**：

| 选项 | 定义 | PIT 安全性 | 与既有门的一致性 |
|---|---|---|---|
| **C1-a** | `T0 = min{ k ∈ [1,5] : close(T+k) < close(T) }`（**首次触及日**） | ✅ 在 `T0` 当日即可判定 | ✅ 与布尔门同参考基准（首板**收盘**），且 `T0` 存在 ⟺ 门通过 |
| **C1-b** | `T0 = argmin_k close(T+k)`（窗口内**最低收盘**日） | ❌ 需整窗 | ✅ 同参考基准，但回顾性 |
| **C1-c** | `T0 = hitDate`（`researchDataset/pullback.ts`，窗口内**最低价**日，目标位 `limitPrice`/`t0Open`/`t0Low`/`ma5` + 容差 + 不破） | ❌ 需整窗 | ❌ 另一条链、另一参考基准 |

**影响**：同一只股票在三种口径下 `T0` 不同 ⇒ 横截面分组日、入场日、四个周期的收益窗口**全部不同** ⇒ 结果不可比。

### C2 · 观察窗上界 `T+5` 与任务示例「第 6 日回踩」**冲突**

**证据**：规范门窗口 = `T+1..T+5`（§2.3）。任务示例要求 `C 在首板后第 6 日回踩` 也必须是合法 `T0`。

**候选口径**：

| 选项 | 含义 | 代价 |
|---|---|---|
| **C2-a** | 维持 `T0 ∈ [1,5]`，**拒绝**第 6 日回踩（`C` 不入池） | 与任务示例冲突 |
| **C2-b** | 把观察窗扩到 `T+1..T+N`（`N ≥ 6`） | **改动冻结语义** ⇒ 需新 Dataset 版本 + 新契约版本；`derive.ts` 的 `CONTEXT_DAYS` 与 `decisionOffsetDays` 联动变更 |
| **C2-c** | 保留门在 `T+1..T+5`，但允许 `T0` 取 `[1, N]` 内首次触及日（门与锚点解耦） | 语义分裂：入池用 5 日门、`T0` 可到第 6 日 ⇒ 第 6 日回踩的股票**原本不入池**，需额外规则 |

### C3 · 「有效回踩」的**参考基准不唯一**

| 基准 | 出处 | 语义 |
|---|---|---|
| 首板日**收盘** | `derive.ts` Pass D（规范门） | `close(rd) < close(T)` |
| 首板日**最高价** | `ds_first_limit_pullback_path.pullbackFromEventHigh = low/eventHigh` | 逐日比率（实验面**读不到**） |
| 目标位（`limitPrice`/`t0Open`/`t0Low`/`ma5`）+ 容差 | `server/researchDataset/pullback.ts` | 触及且不破 |

⇒ 三种基准给出**三个不同的候选集**。本实验若沿用规范门，则必须明确声明「回踩」= 对**首板收盘**。

### C4 · 🔴 **4/12 因子与「变 `T0`」在 PIT 上不相容**（最严重的阻断项）

**证据**：§2.2 显示 **F4 `meanAmplitude` / F5 `maxAmplitude` / F6 `holdStreak` / F10 `drawdownDepth`** 的定义窗口是**整个 `T+1..T+5`**（契约 §2 逐字：`T+1..T+5` 平均振幅 / 最大振幅 / 守线 streak / 回撤深度）。

**冲突**：设 `T0 = T+k`，`k < 5` ⇒ 上述 4 个因子会用到 `rd ∈ (k, 5]` 的数据，即 **`T0` 之后的信息** ⇒ 在 `T0` 当日形成横截面时发生 **look-ahead**，直接违反不变量 **I-3（`decisionOffsetDays` 必须显式声明）** 与 **I-4（PIT 结构级闸门）**，也违反本任务「以 `T0` 为统一信息锚点」。

**候选口径（必须选一）**：

| 选项 | 含义 | 代价 / 是否违反任务约束 |
|---|---|---|
| **C4-a** | 限定 `T0 = T+5`（回踩必须发生在第 5 日） | 与「不同股票允许不同 `T0`」**直接冲突** ⇒ 等价于变相固定入场日 |
| **C4-b** | 保留 12 因子冻结定义，但把 `T0` 仅当**入场锚点**，横截面分组仍在**首板日 `T`** | `T0` 不再是「统一信息锚点」⇒ 未回答任务问的「以 `T0` 为锚点」 |
| **C4-c** | 把 4 个因子的窗口**截断到 `T+1..T0`** | ❌ **违反「保留现有 12 个因子的定义」** |
| **C4-d** | 只保留 6 个「`T` 日已知」因子（F1/F2/F3/F8/F9/F12）+ 2 个「`T+1` 已知」因子（F7/F11）做变 `T0` 实验，F4/F5/F6/F10 仅参与 `T0 = T+5` 子集 | ❌ 违反「保留现有 12 个因子」；且需新增子集规则 |
| **C4-e** | 承认「`T0` = 回踩日」与「12 因子冻结定义」**在本仓不可同时满足**，把本任务拆成两个问题分别做 | 需用户裁定拆分方式 |

> **本项的实质**：任务的两条硬要求——「`T0` = 每只股票实际回踩日」与「保留现有 12 个因子的定义」——**在 `T0 < T+5` 时数学上不相容**。这不是实现细节，是定义层面的冲突。

### C5 · 「次新股」**存在 4 个互相冲突的定义**（无唯一 canonical）

| # | 位置 | 阈值 | **单位** | **基准日** | 链路 | 测试锁定 |
|---|---|---|---|---|---|---|
| 1 | `server/datasetRegistry/filter.ts#isListingAgeExcluded`（调用点 `builder.ts` L688；年龄 `db.ts#resolveListingAgeDaysSync`） | 可配，默认 `null`，范围 1–3650（实部署 `v9` = 365） | **自然日** | **事件日** | Dataset 构建期（Universe 第三层） | ✅ 4 例 |
| 2 | `server/research/compositeRunner/index.ts#listingAgeDays` + `candidateListingFilter` | `minListingAgeDays`（T74 实跑 365/180/90） | **自然日** | **决策日** | compositeRunner 候选池（排序前剔除+递补） | ✅ 6+5 例 |
| 3 | `scripts/_scratch/_realtime_candidate_pool_001.mjs#MIN_AGE_TRADING_DAYS` | **120** | **交易日** | 池日期 `T` | RCP-P0-v1 → `MINING-002` / `HORIZON-REVALIDATION-001` 的 universe | ❌（脚本未跟踪） |
| 4 | `.../composite-runner-newhigh3-t74-subnew/experiment.ts#ageDaysOf` | 365（硬编码） | 自然日 | **建仓日** | 该实验**诊断列**（不参与过滤） | ⚠️ 仅 schema 形状 |

**三个最尖锐的冲突**：
1. **单位冲突**：`120 交易日 ≈ 175–182 自然日`，与 `365 自然日` 相差 **~2×** ⇒ 「剔次新」在两链上**不是同一批股票**。
2. **同一实验内基准日自相矛盾**：T74-subnew 的**过滤**用决策日（`experiment.ts` L228-230），**诊断**「次新成交」用建仓日（L262）⇒ 1,591 个被剔候选 ≠ 51 笔次新成交，两个数字不可互推。
3. **契约形状冲突**：`excludeListedWithinDays`（`min 1`）vs `minListingAgeDays`（`min 0`），同式异名、取值范围不一致（`0` 在数据集侧被拒、在臂侧合法 = 静默空操作）。

**最接近 canonical 的是 #1**（shared 契约 + DB 列 + migration 0056 + UI + 变更审计 + 多链路复用，且被 `trend-entry-ma-v1` 消费 `v9`），但：
- **只有「口径」canonical（自然日 / 事件日 / 未知放行并计数），没有「阈值」canonical**（默认 `null`，1–3650 可配；365 只是 `v9` 一个实例）。
- `GLOSSARY.md` 对 `次新|上市|listing|universe` **零匹配**；`docs/adr/` 无相关 ADR。
- ⚠️ **文档级 `BASELINE_DRIFT`（应登记，本轮不改代码）**：`RESULT-RCP-P0-NEWSTOCK-EXCLUSION-AUDIT-001.md` 的「**不存在其他次新股过滤**」（L59 / L229）只在**该脚本的 7 条规则内**成立；作为全仓陈述为**假**（本仓另有 #1/#2/#4 三套）。该文档同时是横截面因子实验的 universe 依据，容易被误读为全仓 canonical。

### C6 · 🔴 **次新排除在通用实验取数面不可达**（硬阻断）

**证据（结构性，非配置问题）**：
1. `ds_first_limit_pullback_event` 共 26 列，**无 `listedDate` / `listingAge` / `ageDays`**；`prefix` / `post` 同构表**同样无**。
2. 列白名单由 drizzle 表对象派生（`server/datasetRegistry/query.ts` L91/L93/L101），且 `server/researchExperiments/datasetPort.ts#assertDeclaredColumns`（L113-130）对**声明不存在的列当场抛 `EXPERIMENT_METADATA_INVALID`**（测试锁定：`tests/server/researchExperiments/datasetPort.test.ts` L231-242）。
   ⇒ 任何实验写 `requiredColumns.events: ["listedDate"]` 在 `createAccess` 阶段**即失败**。
3. 既有 12 因子 Run 全部跑在 `v5`（`excludeListedWithinDays = NULL`）⇒ **从未排除过次新**。
4. 全窗口带过滤的 `v9`（780003）**FAILED**，带数据的只有 3 个月 smoke（`v9-smoke`，2,315 事件）。
5. 全仓唯一消费带上市龄过滤数据集的已注册实验 `trend-entry-ma-v1` 指向 **FAILED 的 `v9`**，且**零条 Run** ⇒ 无成功先例可循。

**唯一受支持的替代通路**：`executionSurface: "COMPOSITE_PORTFOLIO"` + 至少一个非 `null` 阈值的臂 → `context.composite.listingDateBySecurityId`。但：
- 该 Map 只覆盖 **composite 候选集合**，不是任意证券集合，也不是具名字段声明；
- `includeListingDates` 虽在类型上存在，但 `server/researchExperiments/runner.ts`（L528-538）**从不从 descriptor 装配它** ⇒ 所有臂为 `null` 的实验拿到**空 Map**；
- 该通路属 **composite-runner 家族**，与本实验的「单因子横截面排序」形态不同。

**候选口径**：

| 选项 | 含义 | 代价 |
|---|---|---|
| **C6-a** | 用 `v8`（无上市龄过滤），**本轮不排除次新**，如实声明「样本含次新」 | ❌ 违反任务第 4/5 条样本资格 |
| **C6-b** | 新建一个带 `excludeListedWithinDays = N` 的**新 Dataset 版本**（全窗口），用它跑实验 | 需构建新 Dataset 版本（**非**修改既有 Dataset/Schema）；需先裁定 C5 的 `N` 与单位；`v9` 已 FAILED 一次 |
| **C6-c** | 用 `v9-smoke`（365 自然日）跑 | 窗口仅 2019-01-02 ~ 2019-03-29（2,315 事件）⇒ **不足以做年度稳定性**（P6 不可满足） |
| **C6-d** | 给 `ds_first_limit_pullback_event` 增加一个 build-time 派生列（如 `listedAgeDays`），走既有 `datasetPort` 通路 | **改动 Dataset 物理 Schema + I-1 语义** ⇒ 任务明令禁止（「不修改既有 Dataset / Schema」） |
| **C6-e** | 改走 `COMPOSITE_PORTFOLIO` 面 | 改变实验形态；需重构为组合层实验 |

> 附带发现（如实登记，**不建议默认采用**）：从 `research-experiments/**` 直接 `import server/security/repository.ts#loadListedDatesBySecurityIds` 在 TS 层可行（跨边界 import 已有先例），但违反 `datasetPort.ts` L24-25 明文纪律「**不给 DB 句柄**」，且**未找到**静态边界测试守卫它 ⇒ 属未受认可的新范式。

### C7 · 持有周期约定与「`T+1`」的语义

`T+1` 在两种常见约定下含义不同：① `close(T0+1)/open(T0+1)−1`（**日内**）；② `close(T0+1)/close(T0)−1`（**1 个完整交易日**）。
本预注册**采用 §2.4 的 ①**（与 `single-factor-v1` 的 `holdingDays = exit − entry + 1` 及 `RESULT-HORIZON-REVALIDATION-001` 的 `close(T+N)/open(T+1)−1` 一致）。**如用户意图是 ②，请裁定**，否则「哪个周期最明显」的结论会偏移一个交易日。

### 3.1 冲突汇总与阻断等级

| # | 冲突 | 阻断等级 | 阻断的是什么 |
|---|---|---|---|
| **C1** | 回踩日无 canonical 定义 | 🔴 **硬阻断** | `T0` 本身未定义 ⇒ 无法分组、无法定入场 |
| **C2** | `T+5` 上界 vs 「第 6 日」示例 | 🔴 **硬阻断** | 样本资格未定义 |
| **C3** | 回踩参考基准三选一 | 🟠 需声明 | 候选集不同 |
| **C4** | 4/12 因子与变 `T0` PIT 不相容 | 🔴 **硬阻断** | 任务两条硬要求在 `T0 < T+5` 时**数学上不相容** |
| **C5** | 次新 4 定义冲突（单位/阈值/基准日） | 🔴 **硬阻断** | 样本资格第 4/5 条未定义 |
| **C6** | 次新排除在通用取数面不可达 | 🔴 **硬阻断** | 即使 C5 裁定也无法实施 |
| **C7** | `T+1` 语义 | 🟡 需确认 | 周期结论偏移 1 日 |

---

## 4. P1–P6 预注册方案（**条件性**：以 C1–C7 裁定为前提）

### P2 · `targetMetric`（靶指标）与「为什么对应研究目标」

研究目标 = **横截面排序能力**（不是组合总收益）。因此靶指标必须是**排序类**量，不得用组合总收益充当主判据（`PLAN-RESEARCH-DESIGN-001` 缺口2 的教训：151.0958% = 9 笔）。

**主判据 A（唯一首选）**：逐日横截面 **Rank IC**
```
对每个 T0 日 d：IC_d = Spearman( factorValue_i , netReturn_h(i) )   over i ∈ 当日有效候选
主指标 IC_mean = mean_d(IC_d)
区间 = 日期聚类 Moving-Block Bootstrap 95%（block = 20 交易日，1 000 次，固定种子）
```
理由：排序能力 = 横截面单调关联，Rank IC 是其直接估计量；同日配对、对组合规模不敏感、用**全序**因而**不依赖破平键**（对 P3 稳健）。

**主判据 B（必须与 A 并列读，不得只报 A）**：**Top-K vs All 配对日度超额**
```
excess_d(K) = mean_{i ∈ TopK_d}( netReturn_h(i) ) − mean_{i ∈ All_d}( netReturn_h(i) )
```
理由：Rank IC 可以显著而 Top-K 无优势（梯度只在尾部/中部）；Top-K 可以显著而 Rank IC ≈ 0（只在极值端有信息）。这两种情形在既有资产上**各自出现过**（`RESULT-12F-TOPN-001` vs `RESULT-HORIZON-REVALIDATION-001`）。

**尾部判据（必报，因为研究问题含「表现更好」）**：`≥+20%` / `≥+50%` / `≥+100%` 的**命中率**（Top-K 与 All 的**差值 + 绝对值**），**并同时报 Mean**。理由：`bigWin50/100Count` 早在 schema 却从未作主判据（缺口2）。

**「哪个周期最明显」的判据（事前定义，禁止事后择优）**：因子 `f` 在周期 `h*` 上「最明显」⟺ `h*` 是四个周期中唯一同时满足
1. `IC_mean` 的 CI 不跨 0 **且**符号与 `orientation` 先验方向一致；
2. `excess_mean(K=3)` 的 CI 不跨 0；
3. `≥+50%` 命中率高于 `All` 的同期命中率。

若**多个**周期同时满足 ⇒ 报「**多周期**」，**不选单一最优**；若**无一**满足 ⇒ 报「**无可用周期**」。**事后不得修改此判据**（改动即视为新实验）。

### P1 · 每个 `excludedByReason` 桶在靶上的画像

对**每个**桶（`NOT_FIRST_LIMIT` / `NOT_MAIN_BOARD` / `MISSING_EVENT_DAY_BAR` / `INVALID_EVENT_DAY_OHLC` / `EVENT_NOT_EXACT_LIMIT_UP` / `MISSING_FACTOR_PATH` / **`NO_PULLBACK_IN_OBSERVATION`** / `MISSING_FORWARD_PATH` / `MISSING_PREFIX_PATH` / `ENTRY_UNFILLABLE` / `NO_EXECUTABLE_EXIT` / `MISSING_FACTOR` / `FACTOR_VALUE_MISSING` / **新增的次新剔除桶**）报告其在**四个周期靶**上的画像：

占比 / 均值 / 中位 / 胜率 / `≥+20%` / `≥+50%` / `≥+100%` / P5–P95 分位。

🔴 **必须显式讨论的两个桶**：
1. **`NO_PULLBACK_IN_OBSERVATION`**：既有证据（`PLAN-RESEARCH-DESIGN-001` §1 缺口1）显示该桶 **21,667 事件（29.8%）** 的右尾**系统性更厚**（`rd20 ≥+100%` **0.26% vs 0.12%**，**+117%**）。本实验**继续保留该门** ⇒ 结论区必须写明：本实验测的是「**回踩子集内**的排序能力」，**不是**「全候选池的排序能力」；且该门本身切掉了更肥的尾。
2. **次新剔除桶**（若 C5/C6 裁定启用）：既有证据（`RESULT-T74-SUBNEW-FILTER-001` / `RESULT-151PCT-WINNER-CONCENTRATION-001`）显示次新仅占池 **3.57%** 却对组合结果有**高杠杆**（剔除 365 日 ⇒ 151.10% → 65.39%）⇒ 属「小群高杠杆」，必须单独画像，不得只当一行计数。

> 账必须平：`eligible + excluded === candidate` 且 `Σ excludedByReason === excluded`（不变量 §3-3）。`unscannedEventCount` 必须为 `0`（声明 `eventScanPolicy: "FULL_DATASET"` + 流式分页）。

### P3 · 排序/评分在【入选边界】的分辨力四件套（**前置闸门**）

逐**因子 × 周期 × 档位 × 日**报告：
1. 当日**不同取值数**；
2. 当日**最大取值占比**；
3. **入选边界并列规模**（`Top-1/3/5/10` 的切点处有多少样本与切点同值）；
4. **破平键**及其经济含义。

🔴 **既有实现的破平键 = 不透明 UUID**：`shared/singleFactor/ranker.ts#compareByDirection` 同值时按 `left.eventId.localeCompare(right.eventId)`，而 `eventId` 形如 `sec_<uuid>::event:<code>@<date>`（`compositeRunner/index.ts#baseSecurityIdOf`）⇒ **档内次序由 UUID 决定，无经济含义**。这与 `RESULT-151PCT-WINNER-CONCENTRATION-001` 在 3F 上暴露的缺陷**同源**。

**可预期的风险因子**（离散取值）：`holdStreak`（整数 0–5）、`historyLimitCount`（整数）、`limitGap`（整数日 + `UNKNOWN`）、`amountPercentile`（步长 = 当日 peer 数的倒数，实测每日中位约 35 个候选 ⇒ ≤ ~35 档）。这四个因子在 `Top-1/3/5` 的**边界并列规模很可能 ≥ 入选名额**。

**闸门规则（SKILL.md §3.5 明文）**：
- 某「因子 × 周期 × 档位」的边界并列规模 ≥ 入选名额 ⇒ 该组合的 `Top-K` 结果**必须标注「实质在测破平键」**，且**不得**作为该因子排序能力的证据。
- `Rank IC`（主判据 A）用全序，**不依赖破平键** ⇒ 即使在上述情形下仍可报告。
- **P3 未达标（上述标注普遍成立）时，不得据 `Top-K` 结果下任何因子有效性结论。**

**建议的敏感性对照（待裁定，未实施）**：增加第二个破平键（如按 `symbol` 升序 + 一个固定随机种子）重算 `Top-K`，报告两种破平键下结果的差异；差异达到入选名额尺度 ⇒ 判该组合**不可判定**。

### P4 · 变动项的效应量 / 主导固定项的量级

本实验是**纯横截面排序**研究，**没有 Runner / 退出政策**这类主导固定项（四个周期共用同一入场价、同一成本，仅持有期不同）。因此必须报的效应量对照为：

| 项 | 定义 |
|---|---|
| **变动项** | `Δ_rank = mean(Top-K) − mean(All)`（排序带来的差） |
| **主导固定项（本实验的零假设基线）** | `Δ_pool = mean(All) − 0`（当日池自身相对「不交易」的水平；= 随机抽签的期望） |
| **比值** | `|Δ_rank| / |Δ_pool|` |

🔴 **关键**：既有证据显示该池在该坐标下**池自身均值是负的**（`RESULT-12F-TOPN-001` §1.2：`T+6→T+10` 池等权日均 **−0.370%**，即「买什么都是亏的」）。若新坐标下池均值仍显著为负，则「`Top-K` 比 `All` 好」可能只是「**亏得少**」——结论区**必须**区分「**排序有信息**」与「**可赚钱**」。

另需报：**跨周期 Δ 的量级**（`T+1` vs `T+20`）与**跨因子离散度**的对比，用于判断「周期效应」是否落在「因子间离散度」的噪声内。比值过低（< 10%）⇒ 结论必须标注「**该 Δ 落在主项噪声内，不足以支撑取舍**」。

🔴 **必须新增报的第三项（来自 `RESULT-FILTERED-POOL-ALPHA-MINING-001` 的实测教训）：`Top-K` 的名单换手率与成本拖累。**

| 项 | 定义 |
|---|---|
| 名单换手率 | 相邻决策日 `Top-K` 成员的变动比例（日均） |
| 成本对照 | 年化换手成本 vs `Top-K − All` 的年化价差 |

理由：该研究实测这些因子的 `Top3/Top5` 名单换手率高达 **21%–98%/日**（多数 > 40%），按 PR-T1 成本口径估算**年化成本可达 10%–27%**，**远超其价差幅度**（Top3 相对池的年化超额 −18% ~ −45%）⇒ 原文结论是「**任何方向都难以落地**」。
⇒ **本实验即使测得某因子在某周期有显著排序能力，也必须同时报「该能力的换手成本能否覆盖」**；若不能覆盖，结论区必须标注「**排序有信息但不可落地**」，并**不得**据此推进转正。这是 P4 与 P2 的交界处，两处都必须出现。

### P5 · 事前判据 / ABORT 条件 / 停止规则（**事后不得修改**）

**事前判据**（写死在代码常量 + 本文档）：

| 判据 | 口径 | 三态 |
|---|---|---|
| A · Rank IC | 逐日 Spearman → `IC_mean` + 日期聚类 MB-Bootstrap 95% CI | CI 下界 > 0 ⇒ POSITIVE；上界 < 0 ⇒ NEGATIVE；跨 0 ⇒ INCONCLUSIVE |
| B · Top-K vs All | 配对日度超额（`K = 1/3/5/10`）+ 同日聚类 CI | 同上 |
| C · 尾部 | `≥+20%` / `≥+50%` / `≥+100%` 命中率（Top-K − All，及绝对值） | 描述性 + CI |
| D · 样本量门槛 | 决策日 < **100** ⇒ `INSUFFICIENT`（沿用 `MIN_DECISION_DAY_COUNT`） | — |
| 方向 | **HIGH / LOW 两方向都必须跑**（静态枚举，一次 Run 全输出，**禁止事后择优**） | — |

**ABORT 条件**（任一触发 ⇒ 立即停止该因子/该周期/该档位，**如实记录**，不静默跳过）：

| # | 条件 | 停止范围 |
|---|---|---|
| ABORT-1 | 当日有效候选 `< 10` 的交易日占比 `> 50%` | 停止该**周期**（横截面样本太小，无意义） |
| ABORT-2 | 某因子在 `≥ 50%` 的交易日「当日不同取值数 `≤ 2`」 | 停止该**因子**的全部档位 |
| ABORT-3 | 某「因子 × 档位」在 `≥ 50%` 的交易日「边界并列规模 `≥` 入选名额」 | 停止该档位的 `Top-K` 判定（`Rank IC` 仍报） |
| ABORT-4 | 样本账不平，或 `unscannedEventCount ≠ 0` | **平台级失败**，不产出任何结论 |

**停止规则（这一族要问几次、什么条件下关闭）**：
- 本族 = **1 次 Run**（12 因子 × 4 周期 × 2 方向 × 7 档位**在一次 Run 内全部输出**；结构上禁止「跑多次挑最好」——沿用 `SINGLE_FACTOR_COMBOS` 的静态枚举范式）。
- **关闭条件**：四个周期**全部**判 `INCONCLUSIVE` 或 `NEGATIVE`（两方向）⇒ 判定「12 个冻结因子在该池上无可用横截面排序能力」，**关闭该方向**，不再追加因子 / 权重 / 组合 / 参数实验。
- 若某周期判 `POSITIVE` ⇒ 允许的唯一后续动作是**独立的 OOS / Holdout Run**（本实验**不做**）；**禁止**在同一批数据上做权重 / 组合 / 参数搜索。
- 🔴 **禁止**「下一轮做什么由上一轮结果决定」的广度堆叠（`PLAN-RESEARCH-DESIGN-001` 缺口5）。

### P6 · 靶指标按时间分层

- **全周期** + **年度切片**（按决策日 `T0` 的自然年，2019–2026），每年重算同一套口径。
- 另按 `RESULT-HORIZON-REVALIDATION-001` 的**三时期**分期（`2019-2022` / `2023-2024` / `2025-2026`）做同号检验，作为稳定性判据。
- 🔴 **判据**：效应集中在少数年份 ⇒ 必须标注「**regime 观察，非因子效应**」，并**禁止作为转正依据**。
- ⚠️ **复用既有年切片机制时必须继承的 caveat**（`RESULT-SINGLE-FACTOR-V1-12F-001` §十）：年切片与各档位**高度重叠**（同一批事件、同一持有期），**不构成独立证据**；各年各自做 Bootstrap 判定会再引入一批多重比较 ⇒ 只用于**描述**「是否只在某几年有效」。
- 既有先验：6/9 赢家落在 2025–2026、2025 单年 = 全期净利 61%、`maxDrawdownDurationDays = 907`（3.2 年空转）⇒ 该链的既有结果带 **regime 签名**。
- 与大盘状态交叉（更好，但需 `index_daily` 类数据；**当前实验取数面不可得** ⇒ 列为可选/待裁定）。

### 样本资格（`preRegisteredCriteria` 的样本侧）

候选必须**同时**满足：

1. `datasetCode = "first_limit_pullback"`，**显式记录真实 `datasetVersionId`**（禁用 label 代替）。
2. 通过 `derive.ts` **Pass A~D 全部入池条件**（首板 / 沪深主板 / 严格收盘涨停 / 因子路径完整 / 前缀路径完整 / 12 因子完备 / 入场可成交 / 退出可执行）。
3. **已发生有效回踩**（`hasObservationPullback`）—— 未回踩的**全部排除**（= 既有 `NO_PULLBACK_IN_OBSERVATION` 桶）。
4. **排除次新股** —— ⚠️ **口径待裁定（C5）+ 可行性待解决（C6）**。
5. 因子可评估（`factorValue !== null`；`limitGap` 的 `UNKNOWN` 是**合法桶**，不算缺失）。

**信息边界**：入池判定**只允许**用 `rd ≤ 5`（`decisionOffsetDays = 5`）；未来收益**只用于观察**，**不得回流**到入池（不变量 I-3 / I-4）。

### 已有实验复用关系

见 §1.6（可复用资产表）。**复用纪律**：样本口径 / 因子定义 / 桶边界 / 方向 / 成本 / Bootstrap / 公共底座一律**直接 import，零复制**；只**纯增量**新增「回踩日」只读派生视图与多周期/IC/尾部/P1/P3 输出。

**明确不复用、不重测（任务禁止）**：
- ❌ 151% 策略归因（`RESULT-151PCT-*`）—— 只引用结论
- ❌ F4 regime（`RESULT-F4-REGIME-001`）—— 只引用结论
- ❌ 组合因子 / 权重（`composite-factor-*`）—— 第一阶段禁止
- ❌ 新增因子 —— 第一阶段禁止
- ❌ 修改任何历史 Run / Dataset / Schema

---

## 5. 实验执行计划（**分阶段，逐阶段设闸门**）

| 阶段 | 内容 | 产物 | 闸门（不通过不进下一阶段） |
|---|---|---|---|
| **Phase 0** | **口径裁定**：C1–C7 逐项由用户裁定 | 本文档 §3 更新为「已裁定」 | C1/C2/C4/C5/C6 全部有明确裁定 |
| **Phase 1** | **P3 分辨力只读预检**（**不改代码、不建实验、不产生 Run**）：在候选 `datasetVersionId` 上算出 12 因子 × 逐日的分辨力四件套 | 只读探针报告（`scripts/_scratch/**`，仓外/未跟踪） | P3 达标：不存在「边界并列规模 ≥ 入选名额」的普遍情形；否则先修仪器（换破平键/加敏感性对照） |
| **Phase 2** | **实现**新实验 `first-board-pullback/cross-sectional-factor-v1`（复制 `template/` + 两个注册点各 +1 行；扩展 `shared/singleFactor/**` 为多周期/IC/尾部） | 实验四件套 + 单测 | `pnpm run check` 0 错；`pnpm run test:changed` 零新增失败；`checkEolDrift --strict` = 0 |
| **Phase 3** | **Dry run**：在最小窗口（如 `v9-smoke` 或 `v8` 的子窗口）跑 smoke | Run 信封 + 样本账 | 样本账平 + `unscannedEventCount = 0` + P1/P3 表非空 |
| **Phase 4** | **真实 Run**（**1 次**，全量，`EXPLORATORY`） | 1 条 `research_experiment_run` + 对象存储产物 | 12 因子 × 4 周期 × 2 方向 × 7 档位**全部**落进结果（含空组合占位行） |
| **Phase 5** | **结果文档** + P1–P6 结论区 + 停止规则判定 | `docs/research/RESULT-CROSS-SECTIONAL-FACTOR-001.md` | P1–P6 逐项回答；regime 标注到位 |

**Phase 0 / Phase 1 不需要任何 Dataset / Schema / 代码改动**（纯只读）。

---

## 6. 是否可以进入真实 Run

### 结论：**暂时不可以。** 当前只能进入 **Phase 0 + Phase 1（只读）**。

**理由（逐项）**：

1. 🔴 **C4 是定义层冲突，不是实现细节**：任务的两条硬要求——「`T0` = 每只股票实际回踩日（允许不同）」与「保留现有 12 个因子的定义」——在 `T0 < T+5` 时**数学上不相容**。F4/F5/F6/F10 的定义窗口是整个 `T+1..T+5`（契约 §2 逐字），在 `T0 < T+5` 时会用到 `T0` 之后的信息，直接违反 I-3 / I-4。任何绕过都会产出**look-ahead 污染的排序结果**。
2. 🔴 **C1 使 `T0` 本身未定义**：规范体系只有布尔入池门，不记录回踩日；唯一有日的实现在另一条 Dataset 链且为回顾性语义。
3. 🔴 **C2 使样本资格未定义**：规范窗口上界 `T+5` 与任务示例「第 6 日回踩」直接冲突。
4. 🔴 **C5 + C6 使「排除次新股」不可实施**：4 个互相冲突的定义（单位/阈值/基准日全不同），且通用实验取数面**结构性拿不到上市日**（`assertDeclaredColumns` 当场抛错；既有 12 因子 Run 全在 `excludeListedWithinDays = NULL` 的 `v5` 上；全窗口 `v9` **FAILED**）。
5. 🔴 **SKILL.md §3.5 的前置闸门未过**：明文「**P3 未达标时，不得开展任何排序/因子类实验** —— 否则测到的是破平键噪声，不是因子效应」。本仓**从未对 12 个冻结因子做过 P3 分辨力评估**（`shared/singleFactor/**` 无任何 tie 诊断），且已知破平键是**不透明 UUID**。Phase 1 未做之前执行 Run = 违反协议。
6. 🟡 **C7** 影响「哪个周期最明显」的结论偏移一个交易日，需确认。

**同时明确「可以做什么」**：
- ✅ Phase 0（口径裁定）：**纯讨论**
- ✅ Phase 1（P3 只读预检）：**只读探针，零代码改动、零 Dataset 改动、零 Run**
- ❌ Phase 2–5：**等 C1–C7 裁定**

### 需用户裁定清单（**本文件不自行决定**）

| # | 待裁定 | 建议（仅供参考，非决定） |
|---|---|---|
| **C1** | 回踩日取 `C1-a`（首次触及）/ `C1-b`（最低收盘）/ `C1-c`（legacy `hitDate`）？ | `C1-a`：唯一 PIT 安全、且与既有布尔门同参考基准 |
| **C2** | 维持 `T0 ∈ [1,5]`（`C2-a`）/ 扩窗（`C2-b`）/ 门与锚点解耦（`C2-c`）？ | 若必须允许第 6 日，则 `C2-b` 需新 Dataset 版本 + 新契约版本，代价最大 |
| **C3** | 回踩参考基准 = 首板**收盘**（规范门）/ 首板最高 / 目标位？ | 首板收盘（与既有门一致） |
| **C4** | `C4-a`（限 `T0=T+5`）/ `C4-b`（`T0` 仅作入场锚点）/ `C4-d`（子集因子）/ `C4-e`（拆成两个问题）？ | **必须由用户裁定**：这是任务内部两条硬要求的冲突，Agent 无权取舍 |
| **C5** | 次新阈值与单位：365 自然日（`v9`）/ 120 交易日（RCP-P0）/ 其他？基准日 = 事件日 / 决策日 / 建仓日？ | 若以 canonical 论，#1（自然日 @ 事件日）证据最强，但**阈值无 canonical** |
| **C6** | `C6-a`（不排除，如实声明）/ `C6-b`（新建带过滤的 Dataset 版本）/ `C6-c`（用 3 个月 smoke）/ `C6-d`（加 Dataset 列，**任务禁止**）/ `C6-e`（改走 COMPOSITE_PORTFOLIO）？ | `C6-b` 是唯一既满足样本资格又不动 Schema 的路径，但需构建 + 先定 C5 |
| **C7** | `T+1` = 日内（`close(T0+1)/open(T0+1)`）还是 1 个完整交易日（`close(T0+1)/close(T0)`）？ | 日内（与既有两套约定一致） |
| **附加** | 是否把 `PLAN-RESEARCH-DESIGN-001` 的 `targetMetric` / `preRegisteredCriteria` 正式写入 `ExperimentDefinition` 契约？ | 本文档的 P2/P5 可先落在 `customPayload`，不阻塞 |

### 需要登记但不改代码的发现

- **`BASELINE_DRIFT`（文档）**：`RESULT-RCP-P0-NEWSTOCK-EXCLUSION-AUDIT-001.md` 的「不存在其他次新股过滤」作为**全仓**陈述为假（另有 3 套定义）。按 AGENTS.md §2 应**修正文档**（不改代码）并记录原因 —— 建议在 Phase 0 一并处理。
- **数据卫生（只读观察）**：`research_experiment_run` 中 `single-factor-v1` 有 **27 条长期 `RUNNING`**（如 #1710003/#1710005/#1740001-12/#1830001-2）从未落终态。不影响本设计，但登记备查。

---

## 7. 附：本轮实查命令与产物（可复核）

- 只读 DB 探针：`scripts/_scratch/inventoryAll.mts`（既有）与一份仓外一次性 `.mjs`（读 `.env` 的 `DATABASE_URL`，仅 `SELECT`；零 DDL / DML）
- 关键实查：`research_experiment_run` 分组统计（48 实验 / 165 Run）· `single-factor-v1` 全部 39 条 Run · `dataset_version` 全量 12 行
- 代码实查：`derive.ts` · `result.ts`（12 因子契约）· `coordinate.ts` · `ranker.ts` · `universe.ts` · `pitAccess.ts` · `metrics.ts` · `types.ts` · `datasetPort.ts` · `datasetColumns.ts` · `plugins.ts`（五表 DDL）· `filter.ts` / `builder.ts` / `db.ts`（次新 #1）· `compositeRunner/index.ts`（次新 #2 + 回踩门 B）· `researchDataset/pullback.ts`（回踩 C）
- **本轮零代码改动、零 Dataset 改动、零 Schema 改动、零 Run、零 Candidate。**

---
---

# 【Phase 0 裁定增补】2026-10-08 · 口径裁定 + 预注册落地

> 本增补**不修改**上文 §3 的冲突原始记录（保留审计轨迹）；它把 C1–C7 **逐项结案**，并落地实验设计、P3 仪器与结果判据。
> 🔴 **本轮无真实 Run、无 Dataset/Schema 改动、无 Candidate/StrategyVersion。**

## 8. 锚点裁定（C1 / C2 / C3 / C4 / C7 结案）

### 8.1 主方案：沿用**既有**有效回踩门，零新定义

已从代码逐字确认规范门（`research-experiments/first-board-pullback/twelve-factor-composite-study/derive.ts` **Pass D，L394–406**）：

```ts
const hasObservationPullback = bars
  .slice(0, CONTEXT_DAYS)                       // bars[0..4] = rd 1..5
  .some(bar => bar !== null && bar.close < eventClose - EPSILON);
if (!hasObservationPullback) { reasonByEvent.set(..., "NO_PULLBACK_IN_OBSERVATION"); continue; }
```

⇒ **`hasObservationPullback = ∃k ∈ [1,5]: close(T+k) < close(T) − ε`**，参考基准 = **首板日收盘** `eventClose`。
✅ **本实验直接复用该门，不引入任何新的回踩定义。**

### 8.2 🔴 PIT-safe 的实际 `T0` 能否派生？——**分两种身份，答案相反**

| `T0` 的身份 | 能否 PIT-safe | 结论 |
|---|---|---|
| **信息锚点 / 横截面分组日** | ❌ **不能** | F4 `meanAmplitude` / F5 `maxAmplitude` / F6 `holdStreak` / F10 `drawdownDepth` 的冻结定义窗口是**整个 `T+1..T+5`**（`CONTEXT_DAYS = DECISION_OFFSET_DAYS = 5`）。任取 `T0 = T+k (k<5)` ⇒ 这 4 个因子会读到 `T0` **之后**的数据 ⇒ **look-ahead**，违反 I-3 / I-4。**这是定义层的不相容，不是实现细节。** |
| **决策时已知属性**（分层/条件变量） | ✅ **能，且严格 PIT-safe** | 在 `T+5` 收盘时整个 `[1,5]` 窗已完全已知 ⇒ `T0_i = min{ k ∈ [1,5] : close(T+k) < close(T) − ε }` 是**决策时点可知**的。且因为**池 ≡ 门通过者**，`T0_i` 在池内 **100% 有定义**。✅ 它**不是新定义**，而是既有布尔门的**日化投影**。 |

### 8.3 裁定结论

| 项 | 裁定 |
|---|---|
| **主锚点（信息锚点 = 分组日 = 决策日）** | 🔴 **`T0 ≡ T+5` close（固定偏移）**，即既有 `decisionOffsetDays = 5`。理由：它是**唯一**与冻结 12 因子定义相容的 PIT-safe 锚点；且池已由 Pass D 门（窗口 `T+1..T+5`）界定 ⇒ 锚点与样本资格**天然对齐** |
| **真实回踩日 `T0_i`** | ✅ **降级为「决策时已知属性」**，用于 **P1 / P6 的「回踩时点」分层维度**（早回踩 vs 晚回踩），**不作为横截面分组日** |
| **备选锚点 = 首板日 `T`** | ❌ **不可用（已记录原因）**：`T` 日仅 **6/12** 因子已知（F1/F2/F3/F8/F9/F12）；F7/F11 需 `T+1`；F4/F5/F6/F10 需 `T+1..T+5` ⇒ 锚在 `T` 会**无法计算 6/12 因子**，与「保留 12 因子定义」直接冲突。**故仅登记为不可用备选，不采用** |
| **C2（第 6 日回踩）** | **消解**：锚点固定 `T+5` 后，「第 6 日回踩」**不落在门窗口 `[1,5]` 内** ⇒ **明确不支持**，且**不为此扩窗、不新建 Dataset/契约版本**（= 原 `C2-a`） |
| **C3（参考基准）** | **消解**：= **首板日收盘**（与 Pass D 逐字一致，非新定义） |
| **C4（4 因子 PIT 不相容）** | **消解**：通过「锚点固定 `T+5` + `T0_i` 降级为属性」，任务的两条硬要求**同时满足、无一违反** |
| **C7（`T+1` 语义）** | **裁定为「持有长度」**，见 §9.2（原选项 ① 因锚点在 `T+5` 而不再适用） |

---

## 9. 实验设计固化（**预注册，事后不得修改**）

### 9.1 因子与方向

- **仅冻结的 12 个因子**：`bodyHeight` · `turnover` · `amountPercentile` · `meanAmplitude` · `maxAmplitude` · `holdStreak` · `t1VolumeRatio` · `limitGap` · `preReturn10` · `drawdownDepth` · `t1OpenGap` · `historyLimitCount`
- 🔴 **`orientation` 完全复用**（`twelve-factor-composite-study/result.ts#TWELVE_FACTOR_DEFINITIONS` 逐字 import）：`bodyHeight −1` · `turnover −1` · `amountPercentile −1` · `meanAmplitude −1` · `maxAmplitude −1` · `holdStreak +1` · `t1VolumeRatio +1` · `limitGap +1` · `preReturn10 −1` · `drawdownDepth −1` · `t1OpenGap +1` · `historyLimitCount −1`
- 🔴 **不允许重新找方向**：方向由 `orientation` 唯一决定；`HIGH/LOW` 仅作为**诊断列**并存，不用于挑选方向

### 9.2 执行坐标（**关键裁定**）

| 项 | 值 |
|---|---|
| 决策日（= 锚点 `T0`） | **`T+5` close** |
| 入场 | **`T+6` open**（决策后**第一个**可成交价，PIT 合规）；`canBuyAtOpen = false` ⇒ 剔除并计数 |
| 退出 | `close(T+6+N−1)` = `close(T+5+N)`；不可卖则顺延 ≤ **+10 交易日**且 ≤ `rd 80` |
| 周期 | **`N ∈ {1, 5, 10, 20}`（持有长度）** |
| 成本 | 沿用既有口径（往返 **20 bps**），另报毛收益 |

🔴 **裁定理由（必须与结论同读）**：任务书的字面「`T+1` / `T+5` / `T+10` / `T+20`」**不能**按 `rd = 1/5/10/20` 解读 —— `rd 1..5` **落在决策窗之内**，相对 `T+5` 锚点是**过去**，不构成可交易周期（且 `rd1..5` 正是 F4/F5/F6/F10 的输入窗 ⇒ 按字面读会得到「用因子自身窗口算收益」的循环）。
⇒ **裁定为「从入场起算的持有交易日数」`N`**。
✅ **自洽性校验**：`N = 5` ⇒ 退出 `rd 10` ⇒ 与平台冻结主坐标（research-002 主退出 **`T+10` close**）**自动一致**。

### 9.3 档位（七档）

`Top1` · `Top3` · `Top5` · `Top10` · `All`（全池基线） · `Bottom3` · **`Random3`**

🔴 **`Random3` = 逐日无放回均匀 3 子集 × 200 个固定种子**（复用既有 `pickUniformRandomSubset`）。
**不是** tie-break `RAND` —— 后者只是**同值破平键**，在连续因子上与 `ASC` 选出**完全相同的集合**（属复现而非对照），该缺陷已在前序轮次自检发现并修正。
分母不足 K 只的交易日 ⇒ **空组合占位行**（不得静默丢弃）。

### 9.4 指标（同时保留，全部落进结果）

| 类别 | 指标 |
|---|---|
| **排序类（主）** | **Rank IC**（逐日 Spearman(factorValue, netReturn_N)）· **ICIR** = `mean(IC)/std(IC)·√年` · **IC 正日率** |
| **排序类（辅）** | **Top-vs-Bottom Spread**（TopK − BottomK，同日配对） |
| **水平类** | **Top-K − All**（同日配对超额） · `Mean` · `Median` · `WinRate` |
| **尾部类** | **≥20% / ≥50% / ≥100% 尾部命中率**（TCR20/TCR50/TCR100）+ 相对 `All` 的 `Tail Lift` |
| **分层类** | **年度切片**（2019–2025 逐年，全部上述指标） |

区间：**日期聚类 Moving-Block Bootstrap，block = 20 交易日，1 000 次，固定种子**。
🔴 **不做**阈值 / 权重 / 组合 / 参数搜索。

---

## 10. 排序分辨力（P3）仪器与预注册判据

### 10.1 新增仪器（最小必要框架代码）

`research-experiments/shared/singleFactor/rankResolution.ts` —— **纯函数，零 I/O、零 Dataset 依赖**：

| 导出 | 作用 |
|---|---|
| `diagnoseDay(day, topK)` | 单日：`distinctCount` · `uniqueRatio` · `modalTieSize` · `modalShare` · **`boundaryTieSize`**（跨越第 K 名入选边界的并列组大小）· **`boundaryStraddles`** |
| `summarizeRankResolution({days, topK})` | 日聚合：`distinctCountMedian` · `modalShareMedian` · `modalDominatedDayShare` · `boundaryStraddleDayShare` · `insufficientDistinctDayShare` |
| `summarizeTieBreakSensitivity({days, topK})` | `J(ASC, DESC)` 中位 · **`J(ASC, 逐日无放回均匀子集)`** 中位 · `selectionChangedDayShare` |
| `judgeRankResolution({summary, sensitivity, thresholds?})` | → `RESOLUTION_OK` / `TIE_BREAK_DOMINATED` + 命中理由 |
| `DEFAULT_RANK_RESOLUTION_THRESHOLDS` | 预注册阈值（下） |
| `describeRankResolution(judgement)` | 报告用可读摘要（不参与判定） |

**预注册阈值（先定后用，不得事后放宽）**：

```text
minDistinctCount            = 5      # distinctCountMedian 必须 ≥
maxModalShareMedian         = 0.5    # modalShareMedian 必须 ≤
maxModalDominatedDayShare   = 0.5    # 「单值占比 ≥0.5」的交易日占比 必须 ≤
minJaccardAscDesc           = 0.9    # J(ASC,DESC) 中位 必须 ≥
任一命中 ⇒ TIE_BREAK_DOMINATED ⇒ 该因子不得进入任何排序类真实 Run（直至仪器修复）
```

**测试**：`tests/server/researchExperiments/crossSectionalRankResolution.test.ts`（合成夹具，**零 Dataset 依赖**）。
因沙箱 `spawn EPERM` 无法运行 vitest，本轮以**等价的可执行自检**（`scripts/_scratch/rankResolutionSelfCheck.cjs`，编译后 node 直跑）验证 ⇒ **21/21 PASS，exit 0**：
- 连续值 ⇒ `RESOLUTION_OK`（`distinctCountMedian 30`、`modalShareMedian 0.033`、`J(ASC,DESC)=1`）
- 离散值（对齐 `holdStreak` 实况：distinct 中位 3、单值占比 0.833）⇒ **`TIE_BREAK_DOMINATED`**，四条理由全部命中

### 10.2 🔴 自检发现的新语义（登记）

**当一个交易日的候选值【全部并列】时，更换破平键会选出【完全不相交】的集合**（实测 `J(ASC, DESC) = 0`，而非"换掉一部分成员"）。
⇒ 这比原先记载的「换键换掉 ~43% 成员」**更严重**：在极端离散日，入选集合 **100% 由破平键决定**，与因子取值**完全无关**。
⇒ 本仪器已把该情形显式量化（`boundaryStraddleDayShare` / `modalDominatedDayShare`）。

### 10.3 既有 P3 资产的复用

- 前序轮次已在 `v9` 上跑过 12 因子 P3 分辨力预检（结论：**11 `RESOLUTION_OK` + 1 `TIE_BREAK_DOMINATED`（`holdStreak`）**）。
- 🔴 但 `v9` 按本轮指令**被排除** ⇒ 该结论**不可直接迁移**；Phase 1 必须在**裁定后的数据集**上**重跑** P3（只读、零 Run）。
- `holdStreak` 的 `TIE_BREAK_DOMINATED` 结论在 `v9` 与 MVP 两次独立复现中一致（99.5% 交易日单值占比 ≥50%），**预期在新数据集上同样命中**，但**仍须实测确认**，不得预设。

---

## 11. 结果判据预注册（三类信号**分别判定**）

🔴 **核心纪律**：**排序能力**与**右尾暴露能力**是**两种不同的能力**，**不得互相替代**，也**不要求**任何因子同时具备 `Mean + Tail`。
🔴 Phase 1 的 P3 闸门**未过**的因子，**不参与**以下任何判定（测得的是破平键噪声）。

### 11.1 排序能力（Rank IC 主导）

| 判定 | 条件（`OR` 关系，逐因子 × 逐周期） |
|---|---|
| **`RANKING_CONFIRMED`** | `Rank IC` 的日簇 95% CI **不跨 0** **且** `\|IC_mean\| ≥ 0.02` **且** `IC 正日率` 与方向一致（> 55% 或 < 45%）**且**至少 **5/7 年**同号 |
| **`RANKING_WEAK`** | `Rank IC` 点估计非 0 但**任一条不满足** |
| **`RANKING_ABSENT`** | `\|IC_mean\| < 0.005` 且 CI 跨 0 |

### 11.2 右尾暴露能力（Tail 主导，**与均值无关**）

| 判定 | 条件 |
|---|---|
| **`TAIL_EXPOSURE_CONFIRMED`** | `TCR50` 相对 `All` 的 `Tail Lift` 日簇区间**下界 > 1** **且** **≥5/7 年**成立 **且** `Top3`/`Top5` **方向一致** |
| **`TAIL_EXPOSURE_WEAK`** | `Tail Lift` 点估计 > 1 但**任一条不满足** |
| **`TAIL_EXPOSURE_ABSENT`** | `Tail Lift` 点估计 ≤ 1 或 CI 上界 < 1 |

### 11.3 均值能力（Mean 主导）

| 判定 | 条件 |
|---|---|
| **`MEAN_CONFIRMED`** | `Top-K − All` 的日簇 95% CI **下界 > 0** **且** **≥5/7 年**为正 **且** `Median` 同向 |
| **`MEAN_WEAK`** | 点估计 > 0 但**任一条不满足** |
| **`MEAN_ABSENT`** | 点估计 ≤ 0 或 CI 上界 < 0 |

### 11.4 组合读法（**允许单类成立**）

```text
RANKING_* 与 TAIL_EXPOSURE_* 独立成立，互不要求：
  · 排序确认 + 尾部缺席  ⇒ 可作「排序型」候选
  · 排序缺席 + 尾部确认  ⇒ 只可作「右尾暴露识别器」（不可作选股信号）
  · 两者皆确认          ⇒ 最强（但不预设其存在）
  · 两者皆缺席          ⇒ 停止
🔴 不得因为「尾部确认但排序缺席」而调低判据去凑「排序确认」。
```

### 11.5 停止规则（事前）

- 任一因子若 `RANKING_ABSENT` **且** `TAIL_EXPOSURE_ABSENT` ⇒ **停止**该因子（不再投入）。
- 若 **12/12 因子**均 `RANKING_ABSENT` ⇒ 本问题的答案为「**冻结 12 因子不具备横截面排序能力**」，**停止**该方向，**不追加新因子/新组合**。

---

## 12. 阻断与下一步

### 12.1 🔴 唯一阻断项：**需要新建一个数据集版本**

**实查事实（只读探针，2026-10-08）**：

| `datasetVersionId` | `status` | 物理行（event/prefix/post） | 窗口 | `excludeListedWithinDays` | `preWindowDays` | 可否用 |
|---|---|---|---:|---:|---:|---:|---|
| **660001**（v5） | `READY` | **0 / 0 / 0** ❌ | — | `null` | 20 | ❌ **物理为空**（metadata 与物理不一致 ⇒ 登记 `BASELINE_DRIFT`） |
| **780001**（v8） | `READY` | 73,003 / **73,003（仅 `rd=0`）** / 5,733,817 | 2019-01-02 ~ 2026-09-04 | **`null`** ❌ | **0** ❌ | ⚠️ **不充分** |
| 780002 | `READY` | 2,315 / 80,088 / 185,200 | 2019-01-02 ~ 2019-03-29 | 365 | 60 | ❌ 仅 3 个月 |
| 780003（v9） | **`FAILED`** | 70,071 / 3,548,239 / 4,716,480 | 2019-01-02 ~ 2026-09-04 | 365 | 60 | ❌ 指令排除 |

- 🔴 **全库只有 `{780001, 780002, 780003}` 有物理行** —— 其余 `READY` 版本（390001/390002/540002/570001/630001/690001/720001/750001）**全部物理为空**。
- 🔴 **`660001` 的 `READY` 不可信**：四张物理表**全 0 行** ⇒ 「优先评估 660001」这一选项**被物理事实排除**。
- 🔴 **`780001` 缺 prefix 窗**：`preWindowDays = 0` ⇒ prefix 只有 `rd = 0` ⇒ **F9 `preReturn10`（= `close(−1)/close(−10) − 1`）不可计算** ⇒ 只能覆盖 **11/12 因子**；且**无上市龄过滤**。
- 🔴 **C6 结构性阻断复核成立**：`ds_first_limit_pullback_event` 共 27 列，**无任何 `listed*/listing*/age/ipo` 列** ⇒ 上市龄过滤**必须在构建期烘焙**，通用实验取数面拿不到。

### 12.2 结论

> ## 🔴 **仍 BLOCKED —— 唯一阻断项 = 数据集**
> **没有任何既有 `READY` 数据集能同时满足「12 因子可计算」与「上市龄过滤」**：
> - 660001 物理为空 · 780001 缺 prefix 且无过滤 · 780002 仅 3 个月 · 780003 被指令排除（`FAILED`）。
> **唯一出路 = 新建一个数据集版本**（属 Phase 0 之外的构建作业，**本轮不执行、不自行重建**）。
> ✅ **其余冲突项（C1/C2/C3/C4/C7）已全部结案**，且 **P3 仪器已就绪**（§10）。

### 12.3 需用户裁定的问题（**唯一**）

> **请裁定数据集路线（三选一）**：
>
> | 选项 | 内容 | 代价 / 风险 |
> |---|---|---|
> | **D-a（推荐）** | **新建 `first_limit_pullback` 新版本**：`excludeListedWithinDays = 365`（自然日 @ 事件日，canonical 口径 #1）、`preWindowDays ≥ 10`（覆盖 F9）、`postWindowDays = 80`、全窗口 `2019-01-02 ~ 2025-09-26` | 需一次全窗口构建（`v9` 曾在 `prefix` 插入阶段失败一次 ⇒ 需分批/重试）；**不动 Schema、不动既有版本** |
> | **D-b** | **授权复用 `780003`（v9）** —— 其物理数据**恰好满足全部要求**（prefix `rd −60..0` 完整、`excludeListedWithinDays=365`），唯一缺陷是 `status = FAILED`（已查明为**构建中断记账产物**，非数据缺失） | 与本次指令「不使用 FAILED 的 v9」**直接冲突** ⇒ **须由用户明确解除该限制** |
> | **D-c** | **接受降级**：在 `780001` 上跑 **11 因子**（弃 `preReturn10`）且**不排除次新**，报告中如实声明 | 违反样本资格第 4 条、且 12 因子不完整 ⇒ **不推荐** |
>
> **附需确认的一项**：§9.2 的执行坐标裁定（决策 `T+5` close / 入场 `T+6` open / 周期 = 持有长度 `N ∈ {1,5,10,20}`）。若用户意图不同，请指出。

### 12.4 若数据集裁定为 D-a 或 D-b ⇒ 下一条「正式真实 Run」指令（**待授权后才执行**）

```text
【Phase 1 · P3 只读预检】（零 Run、零代码改动）
  目标：在裁定后的 datasetVersionId 上，对 12 因子 × {Top3, Top5, Top10} 逐日算
        distinctCount / modalShare / boundaryTieSize / J(ASC,DESC) / J(ASC,均匀随机)
  工具：research-experiments/shared/singleFactor/rankResolution.ts（已就绪）
  闸门：任一因子 TIE_BREAK_DOMINATED ⇒ 该因子从 Phase 4 剔除并如实登记
  产物：只读报告（scripts/_scratch/**，未跟踪）

【Phase 2 · 实现】（Phase 1 通过后）
  新增 first-board-pullback/cross-sectional-factor-v1（复制 template + 两个注册点各 +1 行）
  扩展 shared/singleFactor/** 为多周期 / Rank IC / 尾部命中率
  闸门：tsc 0 错 · test:changed 零新增失败 · checkEolDrift --strict = 0

【Phase 3 · Dry run】（最小窗口 smoke）
  闸门：样本账平 + unscannedEventCount = 0 + P1/P3 表非空

【Phase 4 · 真实 Run ×1】（EXPLORATORY）
  12 因子 × 4 周期 × 7 档位 × 7 年 全部落进结果（含空组合占位行）

【Phase 5 · 结果文档】
  docs/research/RESULT-CROSS-SECTIONAL-FACTOR-001.md
  逐因子给出 §11 的三类独立判定 + 停止规则判定
```

### 12.5 本轮边界

- ✅ **零真实 Run** · ✅ **零 Dataset / Schema / Migration 改动** · ✅ **零 Candidate / StrategyVersion** · ✅ **零历史 Run 改动**
- ✅ **未重复审计** OOS / Parameter Search / Strategy 模块
- ✅ 代码改动**仅**：新增 `rankResolution.ts`（纯函数仪器）+ 其测试 + 一个未跟踪自检脚本
- ✅ `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json` = **0 错**
- ⚠️ `pnpm run test:changed` / `vitest` **未能运行**（沙箱 `spawn EPERM`，命名管道边界）；`checkEolDrift --strict` 同样受限，改逐字节核验 EOL
- ⚠️ `v9` 上的既有 P3 结论**不可迁移**（§10.3）；Phase 1 必须在裁定后的数据集上重跑

