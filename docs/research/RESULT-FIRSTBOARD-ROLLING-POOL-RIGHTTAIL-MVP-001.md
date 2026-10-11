# RESULT · `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` 首板滚动观察池与每日右尾识别

> **Task**：执行 [`GOAL-FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001.md`](GOAL-FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001.md) 的 S1–S6。
> **Baseline**：HEAD `f8b6810` + 工作区（含并发会话 `FRONTEND-IA-001` 的未提交改动；本任务未触碰其文件）。
> **Dataset**：`datasetVersionId = 780004` · `first_limit_pullback` · `v10-listed365-pre10-post80` · **READY**。
> **正式 Run**：`RUN-20261010-D9210EBC`（`COMPLETED`，`durationMs = 1,535,203`）。
> **判定（预先登记）**：`R = INSUFFICIENT_EVIDENCE` · `M = NO_SUPPORT`。

---

## 1. 结论摘要（先读这一段）

**在首板触发的滚动观察池里，「当天收盘可知」的单因子每日选 3 只，没有跑赢同日同池同人数的随机对照。**

| 臂 | 主右尾判据（20bps，≥+20%） | 相对同日 Random 的配对差（97.5% 双侧 CI） | 判定 |
|---|---|---|---|
| **R** `preReturn10` HIGH | 12.31% / Random 10.14% | **+2.17pp** `[−2.20pp, +7.07pp]`（block40：`[−2.91, +7.80]`） | **INSUFFICIENT_EVIDENCE** |
| **M** `maxAmp5` LOW | 3.76% / Random 10.14% | **−6.38pp** `[−9.65pp, −3.96pp]`（block40：`[−9.37, −3.86]`） | **NO_SUPPORT** |

两条不能省的补充读数：

1. **R 的「右尾暴露识别力」是真的**：`+20% 路径机会率` 37.71% vs Random 24.33%，
   差值 **+13.37pp**，block20 `[+7.00pp, +20.30pp]`、block40 `[+6.46pp, +21.53pp]` —— **两端都显著为正**。
   但这条**不是可实现收益**（用未来最高价），且**换成可实现标签后差值就跨 0 了**。
2. **R 的代价没有变好、方向是「两头都厚」**：`≤−10%` 概率 25.41% vs 19.65%（**+5.76pp**，
   CI `[−0.54pp, +12.18pp]` —— 未达显著，但点估计一致为正）；净均值 0.82% vs 1.58%（−0.76pp）；
   Q05 −9.55% vs −6.68%（−2.88pp）。
   **这与既有全部 `preReturn10 HIGH` 结论一致，并把它们延伸到了「滚动池 + 逐日年龄」新坐标。**

**M 是明确的负面结果**：低振幅臂把 `≤−10%` 概率压低了 5.38pp（CI `[−11.05pp, +0.32pp]`）、
把 Q05 抬高了 1.39pp，**但同时把 ≥+20% 概率砍掉 6.38pp 且 CI 上界 ≤ 0** ——
即「以明显牺牲右尾为代价换取一点左尾保护」。这正是既有证据登记里
「`maxAmp5` 是防御性参照，**不把相对防御当正 Alpha**」在滚动池坐标下的复现。

**工程完成不依赖结果为正**：本轮的资产、数据、协议、实现、验证、正式 Run、产物与前端路径全部完整可复现，
因此按规格 §1 判 **COMPLETE**；研究结论本身是**「证据不足（R）」+「无支持（M）」**。

---

## 2. 冻结配置（实际执行值）

| 项 | 冻结值 | 实际执行 |
|---|---|---|
| 数据入口 | `780004`，只读核 READY 与真实 build config | ✅ `status=READY`；`excludeSt=1` · `excludeListedWithinDays=365` · `preWindowDays=10` · `postWindowDays=80` · `boards=["main"]` · 事件 `{rd:0, kind:firstBoard}` |
| 板块 | 既有权威分类的沪深主板 | ✅ 构建期 `main` + 实验侧二次核 `boardType==="main" && market∈{SH,SZ}` |
| ST / 上市龄 | 事件日非 ST；事件日上市龄 ≥ 365 自然日 | ✅ 由构建期固化（`excludeSt=1` + `excludeListedWithinDays=365`）；**不能**从今天状态回推历史 |
| 首板 | 权威 `firstBoard` = 今日涨停 ∧ 前一交易日非涨停 | ✅ `values.isFirstLimit === true` |
| 主研究日期 | 2024 首个交易日 ~ 2025-09-30 的**决策日** | ✅ **425** 个决策日（实际落在窗口内的交易日） |
| 预检片段 | 2024-01-02 ~ 2024-03-29 | ✅ S3 用真实 Dataset 端口 + 受控事件窗（2023-11-01~2024-03-29）跑通，98 个决策日 |
| 入池 | 合格首板 T 日收盘入池；次一交易日开始观察 | ✅ 池成员由「该事件自己的 rd 的 `tradeDate`」决定 |
| 留池 | 事件年龄 rd1..40 | ✅ 日账年龄 `min=1 max=40` |
| 可选候选 | rd5..40（两规则均需完整既有 5 日特征） | ⚠️ **实际下界 = rd15**（见 §3 解释），交集由规格自身条款确定 |
| 每日节奏 | 当日收盘更新/排名；入场在下一交易日开盘 | ✅ 因子只读 `prefix(rd≤0)` 与 `post(rd1..15)` |
| TopK | ≤3，人数不足不补齐；不比较 Top5/10 | ✅ 每日取 `min(3, 池大小)`；Random 同人数 |
| 未来标签 | 决策后下一交易日开盘起算，观察 20 交易日 | ✅ 入场 = rd(age+1) 开盘；持有 20 交易日（`holding_day = exitDay − entryDay + 1`） |
| 研究成本 | 往返 20bps 主 + 50bps 敏感性 | ✅ 两档均报；口径 = 既有 `cost.ts#netReturn` |
| 两固定选择臂 | R = `preReturn10` HIGH；M = `maxAmp5` LOW | ✅ 两臂独立、不组合、不择优替换 |
| 控制 | 同日同池同人数均匀无放回 Random，200 固定种子 | ✅ `seedIndex = 20261010 + drawIndex(0..199)`，逐次留档 |
| 排序破平 | 确定性 `symbol` 升序 + `eventId` 升序；披露边界并列规模 | ✅ 见 §5.3（R：0/425 天有边界并列；M：2/425 天，最大并列 2） |
| 性质 | 事后固定的探索性诊断，**不称全新 OOS** | ✅ `researchPhase=EXPLORATORY`，`protocolFingerprint=null` |

### 2.1 关于「可选候选 rd5..40」与 `maxAmp5` 下界的口径说明

规格 §3 同时规定了两条：

- 「可选候选 rd5..40；rd1..4 保留观察但不参与选择，**确保两规则均有完整既有 5 日特征**」；
- 「两主臂及 Random 共同使用『**两因子均可评估**』的当日池」。

而权威 `maxAmp5` 的**决策时点下界 = rd15**（`server/strategyCore/featureRegistry.ts`
的 `EVENT_STATE_AMPLITUDE_WINDOW = {start:11, end:15}` 与 `T0-INDEPENDENCE-001` 结论 C），
即 rd5..14 上该因子**不可得**。两条条款的**唯一自洽解**就是「两因子均可评估」的交集：
**有效可选年龄 = rd15..40**。

这不是执行模型私自改值：`rd5..40` 是**上界声明**，`rd15` 由权威特征定义决定，
交集由规格自己的条款确定。rd5..14 **仍完整留在观察账里**，
拒绝原因码 = `MAXAMP5_NOT_AVAILABLE_BEFORE_RD15`（全窗口 21,506 行），
并且**该年龄段的每日账里 `maxAmp5` 记 `null`**（当时拿不到，不把事后算好的值搬回当时）。

---

## 3. 资产复用（先查已有资产）

| 需求 | 复用资产 | 处置 |
|---|---|---|
| 权威 `maxAmp5`（rd11~15 链式前收振幅最大值） | `server/strategyCore/featureRegistry.ts#makeEventStateAmplitudeFeatures` + `EVENT_STATE_AMPLITUDE_WINDOW` | **新增零实现 bridge** `research-experiments/strategyCoreBridge.ts` 调用 Core 的 `FeatureDefinition.compute`；**未复制公式** |
| PIT 唯一关卡 | `server/strategyCore/temporal.ts#createDayScopedBarAccess` | 同一 bridge 引出；`maxAmp5` 的可见 bar 由 Core 访问器 `barsUpTo(15)` 给出，越界会被 Core 记录并**响亮抛错** |
| 冻结 `preReturn10` = `close(rd−1)/close(rd−10)−1` | `shared/singleFactor/rightTailUniverse.ts`（与 `twelve-factor-composite-study/derive.ts` 两份逐字相同） | 复用同一公式与同一 `PREFIX_RELATIVE_DAYS`，**未新增第三份实现** |
| 顺延出场原语 | `shared/firstBoardPullback/panel.ts#findExecutableExit` | **最小扩展**：加可选 `maxRelativeDay`（缺省 = 既有 20）以表达「顺延最多再 10 交易日」；**缺省行为逐字节不变**，带平价测试 |
| bar 结构有效性 | `shared/firstBoardPullback/dataset.ts` | 把内联条件提取为 `foundationBarStructurallyValid`（唯一实现），两处共用 |
| 成本 | `shared/firstBoardPullback/cost.ts#netReturn` | 复用；`{c:0,s:0,i:0,stampDuty:bps}` ⇒ 精确往返 bps |
| 同日随机 Top-K（200 固定种子、均匀无放回） | `shared/singleFactor/rightTailMetrics.ts#pickUniformRandomSubset` | 复用（🔴 **未用** `rankCandidates(..., "RAND")` —— 那是同值破平键，在连续因子上是复制而非对照） |
| 日期移动块 Bootstrap | `shared/dateClusterBootstrap.ts` | **最小扩展**：加可选 `quantiles`（缺省 0.025/0.975）以支持 Bonferroni 97.5% 双侧；缺省行为与既有完全一致，带平价测试 |
| 并列/破平诊断 | `shared/singleFactor/rankResolution.ts` | 复用（`summarizeRankResolution` / `summarizeTieBreakSensitivity` / `judgeRankResolution`）于正式 Run 自持久化的日账 |
| Run 持久化与产物 | `server/researchExperiments/persistence/runService.ts#execute` | 直接复用（真实 Run 行 + MinIO 产物 + manifest 校验） |
| 前端外壳 | `client/src/pages/researchExperiments/*` + `research-experiments/manifest.ts` + `client/src/researchExperiments/pages.ts` + `experimentModes.ts` | 复用；**新页面只是登记**，结果走通用信封渲染器 |

### 3.1 明确**未**复用的东西（避免重复研究）

- **不复用** `PLAN-FIRST-LIMIT-POOL-ROLLING-3F-001` / `RESULT-FIRST-LIMIT-POOL-STREAMING-001` 的
  组合级滚动池研究：那是**资金循环闭环回测**（v6/`720001`，累计 −55.18% / MDD 67.92%），
  且其数据集 `preWindowDays=0` **算不出 `preReturn10`**。本实验是**事件级信息研究**。
- **不复用** `RESULT-PURE-RIGHT-TAIL-VALIDATION-001`（780003，固定 rd 坐标）的实验本身；
  只沿用其**结论与 STOP 规则**，并换到滚动池坐标复核。
- **未接** Runner / Backtest / Candidate / Paper / Production；**未**调既有 151% 策略；
  **未**建账户；**未**做参数搜索或多因子评分。

---

## 4. 数据覆盖（实查）

| 项 | 实查值 |
|---|---|
| `event` 行（扫描） | **58,983**（= `dataset_version.totalEvents`，`eventScanTruncated=false`） |
| `prefix` 读入行 | **176,650**（rd −10 / −1 / 0 三层，各 58,707 / 58,960 / 58,983） |
| `post` 读入行 | **1,425,900**（rd 1..70，每层 20,370 事件） |
| `maxPostRelativeDayRead` | **70**（= 年龄 40 + 入场 1 + 持有 19 + 顺延 10） |
| `barQueryCount` / `eventPageCount` | 860 / 60 |
| 冻结样本（`freezeSelection`） | **20,370** 个事件（`selectionFrozen=true`） |
| 每个事件读到的 `post` 层 | 1..70（全程无缺口，`postRowCount / (20,370 × 70) = 1.0000`） |
| 标签视界 | 决策后 20 交易日 + 顺延 10 ⇒ 最远 rd70 ≤ 数据集物理上限 rd80 ✅ |
| 右删失 / 未退出 MTM | **0 / 0**（该窗口内每个信号都有完整可成交出场） |
| 逐日 ST 事实 | ⚠️ **不可得**（不在 Dataset 端口内）⇒ 全部记 `UNAVAILABLE`，**未声称实现每日非ST控制** |

---

## 5. 池状态验证（S3）

### 5.1 真实预检片段（2024-01-02 ~ 2024-03-29 决策窗）

预检走**平台 Runner 本体**（`defaultExperimentRunner().runDetailed`）+ 真实 Dataset 端口 +
受控事件扫描窗（2023-11-01~2024-03-29）：**3,801 个事件、98 个决策日、87,110 行日账、40.4 秒**。
预检**只看**池 / 身份 / 年龄 / 因子值 / 信号 / 标签，**未据预检收益修改任何研究设计**。

| 检查 | 结果 |
|---|---|
| 每日同 `symbol` 唯一 | ✅ 重复 0 行 |
| 年龄范围 | ✅ 1..40 |
| `age<15` 却带 `maxAmp5` | ✅ **0** 行 |
| `signalEligible=true` 但因子缺失 | ✅ **0** 行 |
| 两因子齐全且年龄合法却不可选 | ✅ **0** 行（67 行差额全部归因于 `CURRENT_BAR_UNUSABLE`） |
| **未解释状态差异** | ✅ **0** |
| 每日 ST 状态 | 全部 `UNAVAILABLE`（如实，非伪造） |
| 连续跌停仍在池 | ✅ 2,164 行 `limitDownStreak>0`，**未删样本** |
| 两天真实重放 | ✅ `sampleSummary` + `tables` + `customPayload` **逐字节一致**（仅时间戳不同） |

**人工逐日核对真实重复事件股票**（预检账，`000004.SZ`，3 个首板事件）：

```
2024-04-22 age=37 anchor=000004.SZ@2024-02-27 changed=false related=[2024-03-06|2024-03-14] elig=true
2024-04-24 age=39 anchor=000004.SZ@2024-02-27 changed=false related=[2024-03-06|2024-03-14] elig=true
2024-04-25 age=40 anchor=000004.SZ@2024-02-27 changed=false related=[2024-03-06|2024-03-14] elig=true
2024-04-26 age=35 anchor=000004.SZ@2024-03-06 changed=true  related=[2024-03-14]               elig=true
```

⇒ 锚点 = **最早尚未过期**成员（rd 最大者）；新首板**不刷新**旧锚点年龄；
旧锚点到 rd40 后切换到当时最早的未过期成员并 `anchorChanged=true`；
同锚点期间年龄严格递增（实查 `strictly-increasing=true`）。

### 5.2 正式 Run 里的池状态（主窗口）

| 项 | 值 |
|---|---|
| 决策日 | **425** |
| 每日账行数 | **447,726** |
| 锚点切换次数 | **15,937**（显式记账） |
| 每日可评估池大小 | 最小 **373** / 中位 **745** / 最大 **1,424** |
| 年龄分布（占比） | rd1 1.74% · rd5 1.83% · rd14 2.08% · rd15 2.11% · rd20 2.31% · rd30 2.83% · rd40 3.98% |
| 拒绝原因分布 | `MAXAMP5_NOT_AVAILABLE_BEFORE_RD15` 21,506 · `AGE_BELOW_SELECT_MIN` 5,664 · `MISSING_PREFIX_PATH` 414 · `MISSING_MAXAMP5_PATH` 374 · `CURRENT_BAR_UNUSABLE` 150 |

### 5.3 排序破平与边界并列规模（规格 §3 要求）

用**既有唯一**的 `rankResolution.ts` 原语，在正式 Run **自己持久化的日账**上重建逐日候选集：

| 臂 | 判定 | 边界并列日占比 | 最大边界并列规模 | 众数占比中位 | J(ASC,DESC) 中位 |
|---|---|---|---|---|---|
| R | **`RESOLUTION_OK`** | **0.000**（0/425 天） | **0** | 0.0065 | 1.000 |
| M | **`RESOLUTION_OK`** | 0.005（2/425 天） | **2** | 0.0026 | 1.000 |

⇒ 确定性 `symbol`+`eventId` 破平**没有在任何一天悄悄决定 Top-3 的边界**（R 全域为 0；M 仅 2 天、并列 2 只）。

---

## 6. 正式 Run 与产物（S4）

| 项 | 值 |
|---|---|
| `runId` | **`RUN-20261010-D9210EBC`** |
| 状态 / 耗时 | `COMPLETED` / `1,535,203 ms`（约 25 分 35 秒） |
| `experimentCodeDigest` | 见 Run 行（`codeDigest` 由平台计算，不接受实验自报） |
| Dataset 绑定 | `primary` = `780004` / `v10-listed365-pre10-post80` |
| 研究阶段 | `EXPLORATORY`（`protocolFingerprint=null`） |
| 结果对象 | `result.json`（39,721 B）+ `manifest.json` |
| 声明产物 | **13 个**（+ result/manifest = 15 个对象），合计 **77,209,999 B**（≈73.6 MiB） |

| 产物 | 大小 | 说明 |
|---|---|---|
| `tables/daily-pool-ledger-2024Q1.csv` | 8,961,548 B | 每日股票级观察账（**按季度分片**，避免单产物 > 64MB） |
| `tables/daily-pool-ledger-2024Q2.csv` | 9,290,409 B | 同上 |
| `tables/daily-pool-ledger-2024Q3.csv` | 6,585,286 B | 同上 |
| `tables/daily-pool-ledger-2024Q4.csv` | 13,910,484 B | 同上 |
| `tables/daily-pool-ledger-2025Q1.csv` | 10,041,403 B | 同上 |
| `tables/daily-pool-ledger-2025Q2.csv` | 9,947,531 B | 同上 |
| `tables/daily-pool-ledger-2025Q3.csv` | 9,956,795 B | 同上 |
| `tables/signal-ledger.csv` | 439,116 B | R/M 逐信号标签（NO_FILL / 右删失 / MTM 全部保留） |
| `tables/random-draws.csv` | 7,873,892 B | 200 次随机抽样的逐次成员 + 种子（可复现） |
| `tables/daily-arm-stats.csv` | 186,957 B | 逐日逐臂统计（配对差序列的输入） |
| `tables/opportunity-segments.csv` | 15,223 B | 唯一机会段（离线合并口径） |
| `artifacts/rolling-pool-config.json` | 787 B | 冻结配置 / Dataset 坐标 / 规模 |
| `logs/run.log` | 568 B | 运行日志 |

**200 随机种子的固定生成规则（留档）**：
`seedIndex = 20261010 + drawIndex`（`drawIndex` 0..199），
逐日种子 = `FNV-1a("uniform-random"|seedIndex|date)`（既有原语 `rightTailMetrics.ts#seedOf`）。
逐次抽样结果全部落在 `random-draws.csv`。

### 6.1 一次技术中止（如实登记，不掩盖）

| Run | 状态 | 原因 |
|---|---|---|
| `RUN-20261010-745C38AA` | `FAILED` · `EXPERIMENT_RUN_RECONCILED` | **技术中止**：读取阶段超过 30 分钟无可观测进展（CPU/内存/查询均不推进），进程被终止后按规格重跑同配置；**该 Run 未产出结果、未参与任何结论** |

中止后加入**长任务进度落盘**（`ROLLING_POOL_PROGRESS=1` ⇒ stderr 逐层输出），
重跑可全程观测（prefix 3 层 ≈48s/层；post 每层 ≈19s）。

### 6.2 S5 UI 验收 Run（同配置）—— 兼作主窗口真实数据的第二次重放

`RUN-20261010-762EBADF` —— 由**浏览器真实点击「运行」**产生（Dataset 选择器默认 = `780004`），
**`COMPLETED`**（29 分钟），用于验证「选择 Dataset → 启动 → 状态 → 结果 → 历史回查」整条前端路径。

🔴 **确定性交叉验证（真实数据、主窗口、两条独立 Run）**：把两条 Run 的 `result.json`
逐项比对 —— `sampleSummary` · `tables` · `statistics` · `customPayload`
**逐字节一致**（`deterministic-content-equal = true`），且两 Run 的
`experimentCodeDigest` **相同** ⇒ 同一份代码 + 同一份数据 ⇒ 同一条研究结论，
与 S3 在预检片段上的确定性结论一致（那是片段级，这是**主窗口级**）。

---

## 7. 主结果（20bps 主口径 / 50bps 敏感性）

### 7.1 三臂同面板

| 指标 | **R** `preReturn10` HIGH | **M** `maxAmp5` LOW | **Random**（同日同池同人数） |
|---|---|---|---|
| 决策日 | 425 | 425 | 425 |
| 信号数 | 1,275 | 1,275 | 1,275（期望） |
| **≥+20% 概率（主）** | **12.31%** | **3.76%** | **10.14%** |
| ≥+20% @50bps | 12.00% | 3.69% | 9.85% |
| ≥+50% | 1.18% | 0.16% | 1.45% |
| ≥+100% | 0.078% | 0.078% | 0.22% |
| **+20% 路径机会率（辅）** | **37.71%** | **10.16%** | **24.33%** |
| 净均值 | 0.82% | −0.03% | 1.58% |
| 净中位 | −0.18% | −0.77% | 0.39% |
| 胜率 | 50.51% | 46.98% | 48.82% |
| ≤−10% 概率 | 25.41% | 14.27% | 19.65% |
| Q05 | −9.55% | −5.29% | −6.68% |
| NO_FILL 率 | 0.63% | 0.86% | 0.60% |

### 7.2 逐日配对差（臂 − 同日 Random）· Bonferroni 97.5% 双侧

| 指标 | R 点估计 | R block20 | R block40 | M 点估计 | M block20 | M block40 |
|---|---|---|---|---|---|---|
| **≥+20%** | **+2.17pp** | `[−2.20, +7.07]` | `[−2.91, +7.80]` | **−6.38pp** | `[−9.65, −3.96]` | `[−9.37, −3.86]` |
| ≥+20% @50bps | +2.15pp | `[−2.11, +7.05]` | `[−2.72, +7.46]` | −6.16pp | `[−9.37, −3.78]` | `[−9.00, −3.78]` |
| ≥+50% | −0.28pp | `[−1.47, +1.58]` | `[−1.40, +1.48]` | −1.30pp | `[−2.19, −0.64]` | `[−2.22, −0.59]` |
| ≥+100% | −0.14pp | `[−0.35, +0.05]` | `[−0.30, +0.01]` | −0.14pp | `[−0.41, +0.12]` | `[−0.43, +0.13]` |
| **+20% 路径机会率** | **+13.37pp** | **`[+7.00, +20.30]`** | **`[+6.46, +21.53]`** | **−14.18pp** | `[−16.97, −11.08]` | `[−17.32, −10.84]` |
| 净均值 | −0.76pp | `[−3.90, +2.72]` | `[−4.37, +2.93]` | −1.61pp | `[−3.42, −0.09]` | `[−3.29, +0.01]` |
| 净中位 | −0.57pp | `[−3.85, +2.86]` | `[−4.53, +3.06]` | −1.16pp | `[−2.61, +0.19]` | `[−2.54, +0.07]` |
| 胜率 | +1.69pp | `[−5.26, +9.45]` | `[−6.64, +10.22]` | −1.84pp | `[−7.04, +3.96]` | `[−7.01, +3.93]` |
| ≤−10% 概率 | +5.76pp | `[−0.54, +12.18]` | `[−0.46, +12.61]` | −5.38pp | `[−11.05, +0.32]` | `[−10.47, −0.24]` |
| Q05 | −2.88pp | `[−5.88, +0.06]` | `[−5.91, +0.19]` | +1.38pp | `[−0.73, +3.22]` | `[−0.66, +3.21]` |
| NO_FILL 率 | +0.03pp | `[−0.73, +0.98]` | `[−0.73, +1.00]` | +0.27pp | `[−0.39, +1.16]` | `[−0.41, +1.13]` |

### 7.3 年度片段（主右尾判据）

| 臂 | 2024（242 日 / 726 信号） | 2025（183 日 / 549 信号） | 同向？ |
|---|---|---|---|
| R | 臂 16.53% vs Random 11.44% ⇒ **+5.09pp** | 臂 6.74% vs Random 8.42% ⇒ **−1.68pp** | ❌ **不同向** |
| M | 臂 5.92% vs Random 11.44% ⇒ **−5.52pp** | 臂 0.91% vs Random 8.42% ⇒ **−7.51pp** | ✅ 同向（都为负） |

### 7.4 覆盖 / 成交 / 退出 / 重复信号

| 臂 | 信号 | 可成交 | NO_FILL | 未退出 MTM | 右删失 | 唯一股票 | 重复信号率 | 唯一机会段 | 含右尾命中段 |
|---|---|---|---|---|---|---|---|---|---|
| R | 1,275 | 1,267 | 8 | 0 | 0 | 144 | **88.71%** | 157 | **28** |
| M | 1,275 | 1,264 | 11 | 0 | 0 | 116 | **90.90%** | 128 | **18** |
| Random | 1,275 | 1,267 | 8 | 0 | 0 | — | — | — | — |

🔴 **重复信号率 ~89–91%**：每日 Top-3 高度集中在少数股票上（R 的 1,275 条信号只覆盖 **144** 只股票），
因此「1,275 条信号」**不是** 1,275 个独立赢家 —— 这也是规格要求用
「唯一 symbol-上涨机会段」而不是信号数计数的直接原因（R 只有 **157** 段，其中 28 段含右尾命中）。

---

## 8. 判定（事前收口规则，规格 §5.3）

| 臂 | 判定 | 逐条依据 |
|---|---|---|
| **R** | **`INSUFFICIENT_EVIDENCE`** | ① 主差值 97.5% CI **跨 0**（下界 −2.20pp）；② block40 敏感性区间下界 **≤ 0**（−2.91pp）；③ **年度片段不同向**（2024 +5.09pp / 2025 −1.68pp）；④ 唯一机会段命中 **28 < 50**。⇒ **区分「无效」与「无法判断」：这里是无法判断** || **M** | **`NO_SUPPORT`** | 主差值 97.5% CI **上界 = −3.96pp ≤ 0**，block40 上界 −3.86pp ⇒ **明确本配置无支持** |

两条都**不是** `RIGHT_TAIL_EVIDENCE`，也都**不触发** `RISK_TRADEOFF`（后者要求先满足右尾证据）。
按规格 §5.3「所有主臂研究负面或不足即收口」：**不追加变量、期限、TopK 或门槛**。

**即便满足右尾证据也不算可交易**；本轮的结论上限就是上面这两行。

### 8.1 与既有结论的一致性（本轮不是新矿脉）

| 既有结论 | 本轮在滚动池坐标下的复核 |
|---|---|
| `preReturn10 HIGH` 是**纯右尾暴露**、**不是正期望信号**（`ExcessMean` 4/4 为负、`ExcessMedian`/`ExcessWinRate` 8/8 为负、左尾更差） | ✅ 方向一致：路径机会率显著更高（+13.37pp），但可实现右尾差值跨 0、净均值点估计为负、`≤−10%` 点估计 +5.76pp |
| `maxAmp5 LOW` 是**防御性参照**，不得当独立 Alpha / 不得把相对防御当正 Alpha | ✅ 复现：左尾更浅（`≤−10%` −5.38pp、Q05 +1.38pp）但右尾显著更差（−6.38pp，CI 上界 ≤ 0） |
| 同日依赖主导（ICC ≈ +0.19、有效 n 远小于事件数）⇒ 禁用 `sd/√n` | ✅ 全部区间走日期移动块 bootstrap；重复信号率 ~90% 进一步印证 |
| 事件重叠/簇内重复会让点估计与「独立样本数」错位 | ✅ 用「唯一机会段」而非信号数作命中计数（R 1,275 信号 → 157 段） |

---

## 9. S5 前端（真实浏览器验证）

**环境**：`node node_modules/tsx/dist/cli.mjs server/_core/index.ts` ⇒ 启动日志打印
`Server running on http://localhost:4000/`（端口以**启动日志实际打印**为准）；
无头 Edge `Edg/156.0.4314.15` + CDP `9222`。

| 验收项 | 结果 |
|---|---|
| 实验列表页可打开、本实验已注册 | ✅ 9,933 字符 |
| 实验详情页：Dataset 选择器可见 | ✅ |
| **普通运行只选兼容 Dataset** | ✅ 修复后**默认选中 `v10-listed365-pre10-post80`（id=780004）** |
| 固定参数可见 / 运行入口可见 / 运行历史区可见 | ✅ |
| **启动**（真实点击「运行」） | ✅ 创建 `RUN-20261010-762EBADF` |
| **状态** | ✅ 页面显示 `RUNNING` + code digest + Dataset 坐标；后台队列随后收敛为 **`COMPLETED`** |
| **跳转** | ✅ `/research-experiments/first-board-pullback/rolling-pool-right-tail-mvp/runs/RUN-20261010-762EBADF`（首次轮询早于跳转完成，属探针时序而非缺陷；复检通过） |
| **结果**（Run 详情） | ✅ 渲染三臂同面板表（`preReturn10`/`maxAmp5`/Random、≥+20%）、判定表、样本账、证据限制（两个 Run 详情页文本长度一致 51,784 字符） |
| 历史回查 | ✅ 运行历史列出 3 条 Run（COMPLETED / FAILED / COMPLETED） |
| **确定性（真实数据、主窗口）** | ✅ 两条独立 Run 的 `sampleSummary+tables+statistics+customPayload` **逐字节一致**，`experimentCodeDigest` 相同 |

**S5 浏览器验证合计 9/9 PASS**（两次独立执行：正式 Run 与 UI Run）。

### 9.1 本轮修复的前端缺口（S5「普通运行只选兼容 Dataset」）

修复前：Dataset 选择器**永远默认最新版**（这里是 `780005` / `v11-bear2026-pre10-post80`），
而本实验冻结 `requiredDatasetVersionLabel = v10-listed365-pre10-post80` ⇒
点「运行」会被后端**响亮拒绝**。

修复：`client/src/pages/researchExperiments/ExperimentDetail.tsx` 在选择器层
按 `descriptor.datasetRequirement.requiredDatasetVersionLabel` **过滤并默认选中兼容版本**；
深链指向不兼容版本时**保留 URL 权威**并在页面上红字说明「运行会被平台拒绝」；
该标签不存在时给出可见的停止提示而不是让用户误跑。
**未声明该字段的实验行为完全不变**（选项 = 全部，默认 = 最新）。

> 诚实登记：UI 触发的 `RUN-20261010-762EBADF` 是**同配置的第二次完整 Run**，
> 用途有两个 —— ①验证「启动 → 状态 → 结果」前端路径；②作为**主窗口真实数据上的第二次重放**
> （与 `RUN-20261010-D9210EBC` 逐字节一致，见 §6.2）。
> 它**不是**参数变体、**不是**失败重试，两 Run 完全可比；研究报告的数值一律引用两者一致的结论。

---

## 10. 风险、限制与「不能推出」

1. ❌ **不能**说「滚动池比随机好」。R 的差值区间跨 0、年度反向、机会段不足；M 明确无支持。
2. ❌ **不能**说 R「有效」。`INSUFFICIENT_EVIDENCE` 是「无法判断」，不是「无效」；反之亦然。
3. ❌ **不能**把 `+20% 路径机会率`（+13.37pp）当作收益或可交易性：它是**未来最高价**口径，**不可实现**。
4. ❌ **不能**声称实现了**每日非 ST 控制**：Dataset 只固化「事件日非 ST」，逐日 ST 事实不可得 ⇒ 记 `UNAVAILABLE`。
5. ❌ **不能**把 `1,275 条信号`当独立样本：重复信号率 88.7%/90.9%，R 仅覆盖 144 只股票。
6. ❌ **不能**外推到创业板/科创板/北交所、非 365 日上市龄、其他 Dataset 或其他时间窗。
7. ❌ **不能**当 OOS：`researchPhase=EXPLORATORY`，且 780004 的全区间在既往研究中已被反复使用。
8. ⚠️ **成本口径是研究标签**（固定往返 20/50bps），**不是**真实账户费率、滑点或冲击模型；
   `maxAmp5 LOW` 的策略集中在低振幅股 ⇒ 真实冲击成本可能显著。
9. ⚠️ **`decisionOffsetDays` 是上界声明而非逐日精确坐标**（契约缺口，见 §12）。
10. ⚠️ **一次技术中止已如实登记**（§6.1）；其未产出任何结果。
11. ⚠️ **运行成本**：主窗口一次完整读 = 860 次查询 / 1.43M post 行 / 约 **25–29 分钟**（跨境链路，780004 无本地快照）。
    前端直接启动同一 Run 会占用服务端进程约 25 分钟。

---

## 11. 唯一下一步

**关闭本方向，不追加任何变体。**

R 的右尾证据不足且年度反向，M 明确无支持 —— 按规格 §5.3 的收口规则，
「不追加变量、期限、TopK 或门槛」，也**不**接 Runner、不建 Candidate、不延长窗口、**不**启动前向账户。

若将来仍想在这条线上推进，**唯一**被本轮证据支持的动作是（需另立任务与新授权）：

- 先补 **逐日 PIT ST / 上市龄** 端口（当前是 `UNKNOWN`），再谈「买得到」；
- 再补 **冲击成本/容量**建模（低振幅集中度是已知风险）；
- 且必须换到**真正未见**的样本（例如 `780005` / 2026 段）并在**事前**登记判据，
  否则只是在同一份已被反复挖掘的数据上继续调参。

---

## 12. 契约缺口（本轮如实登记，未擅自修改）

1. **`decisionOffsetDays` 是单标量**，无法表达滚动池**逐日变化**的决策坐标。
   本实验声明 `40`（资格判定的**上界**），逐日坐标由**内存投影**表达。
2. **`observation(rd)` 无 eventId / 日期参数**，只有「整层 rd」；`freezeSelection` **一次性**且冻结集 = 候选宇宙
   ⇒ 逐日成员只能在内存里从整层 rd 投影出来。
3. **逐日 ST / 上市龄不在 Dataset 端口内**（只在 DB 侧表），实验侧**不直连 DB** ⇒ 记 `UNAVAILABLE`。
4. **并列诊断不在 Run 信封内**：本轮用既有 `rankResolution.ts` 在 Run 自持久化的日账上**离线**复算
   （§5.3），未改 Run 结构。
5. 每日账产物需**按季度分片**（单产物 64MB 上限）：完整窗口约 44.8 万行 / ≈78MB。

---

## 13. 写入清单与副作用（如实登记）

| 类别 | 内容 |
|---|---|
| **DB 写入** | `research_experiment_run` **3 行**：`RUN-20261010-745C38AA`（FAILED/技术中止）· `RUN-20261010-D9210EBC`（COMPLETED，主结论）· `RUN-20261010-762EBADF`（COMPLETED，S5 UI 验收 + 主窗口第二次重放，与前者逐字节一致）。**无其他 DB 写入** |
| **对象存储写入** | `research` 桶下**两条 COMPLETED Run** 前缀内的 `result.json` + `manifest.json` + 13 个声明产物（各 ≈73.6 MiB） |
| **代码** | 新增：`research-experiments/strategyCoreBridge.ts`、`research-experiments/shared/rollingPoolRightTail/**`、`research-experiments/first-board-pullback/rolling-pool-right-tail-mvp/**`、`tests/server/researchExperiments/rollingPoolRightTailMvp.test.ts`、`tests/tools/rollingPoolRightTailRun.mts`、`tests/tools/rollingPoolReconcile.mts`、`tests/tools/rollingPoolTieDiagnostic.mts`；修改：`research-experiments/manifest.ts`（注册 + v5 底座具名豁免）、`client/src/researchExperiments/pages.ts`、`client/src/pages/researchExperiments/experimentModes.ts`、`tests/client/src/pages/researchExperimentModeGrouping.test.ts`（分档计数）、`client/src/pages/researchExperiments/ExperimentDetail.tsx`（兼容版本过滤）、`research-experiments/shared/firstBoardPullback/{panel,dataset}.ts`（两处**缺省行为不变**的最小扩展）、`research-experiments/shared/dateClusterBootstrap.ts`（同上） |
| **未写入 / 未改动** | 无 DDL / migration；无 Dataset 改动（`780004` / `780005` 内容一行未动）；无历史 Run / Strategy / Candidate 改动；策略 `3600005` / `3600006` / `3600007` 未动；未建账户、无资金交易、未接 Paper/Production；**未触碰**并发会话 `FRONTEND-IA-001` 的文件与 `.agent/task-state.yaml` |

---

## 14. 复现指令

```bash
# S3 技术预检（只读；走平台 Runner，不持久化）
node --max-old-space-size=6144 node_modules/tsx/dist/cli.mjs \
  tests/tools/rollingPoolRightTailRun.mts --mode precheck

# S4 正式研究（经既有 startRun 入口持久化 1 条 Run + 产物）
ROLLING_POOL_PROGRESS=1 node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
  tests/tools/rollingPoolRightTailRun.mts --mode formal

# 边界并列诊断（从正式 Run 自持久化的日账复算，不重跑研究）
node node_modules/tsx/dist/cli.mjs tests/tools/rollingPoolTieDiagnostic.mts \
  --run RUN-20261010-D9210EBC

# 卡住的 RUNNING Run 收敛为 FAILED（必须给 reason）
node node_modules/tsx/dist/cli.mjs tests/tools/rollingPoolReconcile.mts \
  --run <runId> --reason "<原因>"

# 受影响测试
node node_modules/vitest/vitest.mjs run \
  tests/server/researchExperiments/rollingPoolRightTailMvp.test.ts \
  tests/server/researchExperiments/manifest.test.ts \
  tests/server/researchExperiments/firstBoardPullbackFoundation.test.ts \
  tests/client/src/pages/researchExperimentModeGrouping.test.ts
```

**环境限制（如实登记）**：会话**早期**的受限沙箱下 `esbuild` 无法 `spawn`（`EPERM`）⇒
`vitest` / `tsx` 无法启动；文件访问放开后全部可执行，上述测试与工具均在此状态下跑出。
同一限制曾使 `tsc --noEmit` 因**无法写** `node_modules/typescript/tsbuildinfo` 而报 `TS5033`；
文件访问放开后 **`pnpm run check`（= `tsc --noEmit`）实跑 exit 0（0 错）**，
`--tsBuildInfoFile` 重定向只是该限制下的**等价替代判据**（已核实同样 0 错）。
