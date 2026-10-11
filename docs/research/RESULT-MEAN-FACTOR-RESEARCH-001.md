# RESULT-MEAN-FACTOR-RESEARCH-001

> 任务：`MEAN-FACTOR-RESEARCH-001` — 在**冻结的 12 因子体系**内重新寻找真正的 `CROSS_SECTIONAL_MEAN_SIGNAL`
> 前置：`RESULT-RIGHT-TAIL-CROSS-SECTIONAL-EXCESS-001`（8 因子均为 `TAIL_ONLY_NO_MEAN`）· `RESULT-RIGHT-TAIL-SELECTION-RULE-001`（选股规则方向已停止）
> 基线：HEAD `f8b6810`（工作区含长期未提交改动；本轮**未触碰任何既有业务代码**，只在 `research-experiments/shared/singleFactor/` 内**增量追加**纯函数）
> 数据坐标：`datasetVersionId = 780003`（v9）· **`status` 保持 `FAILED` 不变** · **只读** · 窗口 **2019-01-02 ~ 2025-09-26**
> 🔴 **非平台正式 Run**：沙箱以 `spawn EPERM`（命名管道边界）拒绝 `tsx`/`esbuild`/`vitest`；沿用只读 DB 适配器驱动**同一份已 `tsc` 通过的模块**。

---

## 0. 结论前置

### 0.1 唯一的答案

> **12 个冻结因子中，谁是真正的横截面均值因子？**

## 🔴 答案是 **7 个**，但必须立刻附上一条决定性限定：

> ### 这 7 个「均值因子」**不是新维度，而是 8 个右尾因子的【冻结方向】**。
> ### **每一个右尾方向，都恰好是同一个因子的均值方向的严格反向。**

**关键对拍（`twelve-factor-composite-study/result.ts` L177–380 的冻结 `orientation`）：**

| 对拍项 | 结果 |
|---|---|
| 有 A 类均值信号的因子数 | **7** |
| 其中「均值方向 = 冻结 `orientation` 方向」 | 🔴 **7 / 7 = 100%** |
| 有 B 类右尾信号的因子数 | **10** |
| 其中「尾部方向 = 冻结 `orientation` 的**严格反向**」 | 🔴 **9 / 10 = 90%**（唯一例外 `t1OpenGap`） |

⇒ **冻结 `orientation` 表编码的是「均值方向」**；整个「右尾」研究线（rounds 1–8）发现的尾部方向，**就是它的反向**。
⇒ 所以 `TAIL_ONLY_NO_MEAN` **从来不是谜团**：**均值与尾部住在同一根横截面轴的两端**。把因子翻向，右尾信号就变成均值信号。

### 0.2 12 因子 → 四类

```text
12 Factors（11 可测 × 2 方向 = 22 格；holdStreak 按 P3 排除）
    ↓
A. MEAN SIGNAL       : 7 格   amountPercentile·LOW · maxAmplitude·LOW · meanAmplitude·LOW
                             turnover·LOW · limitGap·HIGH · historyLimitCount·LOW · t1VolumeRatio·HIGH
    ↓
B. RIGHT-TAIL SIGNAL : 10 格  meanAmplitude·HIGH · maxAmplitude·HIGH · limitGap·LOW · preReturn10·HIGH
                             bodyHeight·HIGH · drawdownDepth·HIGH · turnover·HIGH · t1VolumeRatio·LOW
                             historyLimitCount·HIGH · t1OpenGap·HIGH
    ↓
C. RISK SIGNAL       : 3 格（主类）+ 11 格（含与 B 重叠者）
                             amountPercentile·HIGH · preReturn10·LOW · t1OpenGap·LOW（主类）
                             + bodyHeight/meanAmplitude/maxAmplitude/drawdownDepth/historyLimitCount·HIGH · limitGap/t1VolumeRatio·LOW
    ↓
D. NO SIGNAL         : 2 格   bodyHeight·LOW · drawdownDepth·LOW
```

🔴 **A 与 B 在 22 格中占 17 格，且**——**没有任何一格同时是 A 和 B**。均值与右尾在这套因子上**严格互斥**。

### 0.3 `NO_MEAN_SIGNAL_FOUND_IN_FROZEN_12_FACTORS`？

> **不适用** —— 均值信号**存在且很强**（7 个方向，`ExcessMean` 最高 **+3.02 pp**，年度 **7/7**）。
> **但正确的表述是：均值信号【不是独立维度】，它就是右尾信号的反向。**

### 0.4 最稳定的均值因子（§9-Q4/Q5）

> ## `amountPercentile`（同日成交额分位）· **LOW 方向**
> 
> | 项 | 值 |
> |---|---|
> | `ExcessMean`（Top3 − 同日随机 Top3） | H5 **+0.391** · H10 **+0.761** · H20 **+1.422** · H60 **+3.022**（**4 个持有期全部 CI 下界 > 0**） |
> | 年度为正 | H5 5/7 · H10 6/7 · **H20 7/7** · **H60 7/7** |
> | Top3 / Top5 一致性 | H20 +1.422 / +0.921 · H60 +3.022 / +2.395 ⇒ **同向** ✅ |
> | 尾部信号 | `ExcessTCR50` H60 **+0.086（不显著）**· `Lift` 1.020（CI 跨 1）⇒ **完全没有尾部信号** |
> | 冻结 `orientation` | **−1 = LOW** ⇒ **与冻结方向一致** ✅ |
> | **期限** | **全周期（SHORT → LONG 单调增强，峰值 LONG/H60）** |
> 
> 次稳：`maxAmplitude LOW`（4 期全显著，**4 个持有期全部 7/7 年**）· `limitGap HIGH`（3 期显著，6–7/7 年）

---

## 1. 数据与口径

| 项 | 值 |
|---|---|
| Dataset | `first_limit_pullback` v9 · `datasetVersionId = 780003` · **`status = FAILED` 未修改** |
| 窗口 | 2019-01-02 ~ 2025-09-26 |
| 上市龄 / 回踩门 | `listedAgeDays >= 365`（构建期生效）· **不使用** pullback gate |
| 决策 / 入场 / 成本 | `T+5` close（`T` = 首板日）· **`T+10` open** · 往返 **20 bps** |
| 持有期 | **H5 / H10 / H20 / H60**（`Exit = close(Entry + N)`；不可卖则顺延 ≤ +10 交易日且 ≤ rd80） |
| 档位 | **Top3（主）/ Top5（辅）/ Bottom3（仅判方向）** |
| 12 因子定义 / 边界 / 方向 | **零改动**（含 `holdStreak`，仅按既有 P3 结论排除） |
| 样本 | `candidate = 70,071` · **`eligible = 56,987`** · 决策日 **1,627** · parity **PASS** |
| 入场日不可买剔除 | 270（0.47%）· 逐臂无可卖退出 27 / 43 / 52 / 85 |

### 1.1 🔴 核心指标口径（本轮的**唯一**判据）

```text
ExcessMean = TopK Mean − 同日随机 TopK Mean

随机 TopK = 每个交易日从当日候选池中【无放回均匀随机】抽 K 只
          × 200 个固定种子，取该日统计量的平均
          ⇒ 在期望上等于当日池均值（K 子集均值是池的无偏估计）
          ⇒ 200 次仅用于压低 Monte-Carlo 噪声，不是第二套基线口径
bootstrap = 日期作为 cluster（Moving-Block，block=20，1000 次，固定种子）95% CI
```

- 随机参考**只依赖 `(持有期, K)`**，与因子/方向无关 ⇒ 每个 `(持有期, K)` **只构建一次并复用**（构建耗时 ~1.2s/格）。
- 🔴 **随机对照使用 `RIGHT-TAIL-CROSS-SECTIONAL-EXCESS-001` 修正后的「逐日均匀无放回 K 子集」实现**（`pickUniformRandomSubset`）；**未使用**旧的 tie-break `RAND`（该键只是同值破平键，连续因子上与 `ASC` 选出完全相同的集合）。
- 必须报告项全部给出：`ExcessMean` + 95% 日簇 CI、`Mean`、`Median`、`Win Rate`、`ExcessTCR50` + CI、`Lift`。

### 1.2 `holdStreak` 排除条件的**再确认**（本轮不参与任何 Top-K 测试）

| 量 | P3（历史） | **本轮重测** |
|---|---|---|
| 平均不同取值数 / 日 | 中位数 3 | **3.25** |
| 「单一取值占比 ≥ 50%」的交易日占比 | 73% | 🔴 **99.5%** |
| `J(ASC, DESC)` Top3 | 0.515 ~ 0.670 | **0.566** |
| `J(ASC, DESC)` Top5 | — | **0.521** |

⇒ **`TIE_BREAK_DOMINATED` 结论被强化确认**（99.5% 的交易日里，一半以上候选共享同一个 `holdStreak` 值；换一个破平键就换掉约 43% 的 Top3 成员）。
⇒ **按任务书继续排除，未为了本实验强行恢复。**

---

## 2. 主表：`ExcessMean` vs 同日随机 Top3（Top3 口径）

`*` = 95% 日簇 CI 不跨 0。单位 pp。

| 因子 | 方向 | H5 | H10 | **H20** | **H60** | `ExcessTCR50`(最佳 H) | 冻结方向 |
|---|---:|---:|---:|---:|---:|---|---|
| **`amountPercentile`** | **LOW** | **+0.391\*** | **+0.761\*** | **+1.422\*** | **+3.022\*** | +0.086 (H60，不显著) | ✅ −1 |
| | HIGH | −0.196 | −0.609 | **−1.183\*** | **−3.594\*** | +0.339 (H20，不显著) | |
| **`maxAmplitude`** | **LOW** | **+0.365\*** | **+0.409\*** | **+0.617\*** | **+1.974\*** | −0.344 (H60) | ✅ −1 |
| | HIGH | **−0.604\*** | **−0.912\*** | **−1.258\*** | **−2.861\*** | **+0.974\*** (H20) | |
| **`meanAmplitude`** | **LOW** | **+0.276\*** | **+0.511\*** | **+0.697\*** | **+1.747\*** | −0.856 (H60) | ✅ −1 |
| | HIGH | **−0.698\*** | **−0.957\*** | **−1.635\*** | **−3.201\*** | **+1.609\*** (H20) | |
| **`turnover`** | **LOW** | **+0.277\*** | **+0.463\*** | **+0.731\*** | **+1.464\*** | −0.262 (H60) | ✅ −1 |
| | HIGH | **−0.653\*** | **−1.048\*** | **−1.712\*** | **−4.002\*** | **+0.461\*** (H20) | |
| **`limitGap`** | **HIGH** | +0.236 | **+0.474\*** | **+0.699\*** | **+1.445\*** | −1.204 (H60) | ✅ +1 |
| | LOW | −0.278 | **−0.560\*** | **−0.922\*** | **−1.723\*** | **+0.902\*** (H20) | |
| **`historyLimitCount`** | **LOW** | +0.054 | +0.163 | +0.409 | **+1.270\*** | −0.836 (H60) | ✅ −1 |
| | HIGH | −0.063 | −0.295 | **−0.941\*** | **−3.050\*** | +0.175 (H20，不显著) | |
| **`t1VolumeRatio`** | **HIGH** | +0.129 | +0.253 | +0.291 | **+1.122\*** | −0.201 (H60，不显著) | ✅ +1 |
| | LOW | −0.258 | −0.205 | −0.373 | **−1.049\*** | **+0.280\*** (H10) | |
| `bodyHeight` | HIGH | **−0.417\*** | **−0.613\*** | **−1.027\*** | **−2.313\*** | **+0.584\*** (H20) | |
| | LOW | −0.162 | −0.128 | +0.143 | +0.577 | −0.057 (H60) | ✅ −1 |
| `preReturn10` | HIGH | −0.068 | −0.182 | −0.444 | **−1.717\*** | **+1.260\*** (H20) | |
| | LOW | +0.113 | +0.143 | −0.086 | **−1.037\*** | +0.031 (H20) | ✅ −1 |
| `drawdownDepth` | HIGH | **−0.395\*** | **−0.639\*** | **−1.019\*** | **−1.691\*** | **+0.424\*** (H10) | |
| | LOW | +0.011 | +0.049 | −0.070 | −0.836 | +0.011 (H10) | ✅ −1 |
| `t1OpenGap` | HIGH | −0.032 | −0.036 | +0.023 | +0.555 | +0.373 (H60，不显著) | ✅ +1 |
| | LOW | −0.114 | −0.323 | −0.335 | **−0.695\*** | +0.011 (H5) | |

**读数（三条）**
1. 🔴 **A 类（均值）与 B 类（右尾）在同一因子的两个方向上严格分离，且从不同时成立。**
2. 🔴 **A 类的 `ExcessTCR50` 全部 ≤ 0 或不显著；B 类的 `ExcessMean` 全部为负。** —— 均值与尾部是**同一根轴的两端**的直接证据。
3. ✅ **`amountPercentile LOW` 是唯一「4 个持有期全部显著、且完全没有尾部信号」的因子**（`ExcessTCR50` 最高才 +0.086）。

---

## 3. 时间维度：SHORT / MEDIUM / LONG

| 因子 | 方向 | 显著的持有期 | 年度为正（H5/H10/H20/H60） | **判定** |
|---|---|---|---|---|
| `amountPercentile` | LOW | **H5, H10, H20, H60（全 4 期）** | 5/6/**7**/**7** | **全周期，峰值 LONG** |
| `maxAmplitude` | LOW | **H5, H10, H20, H60（全 4 期）** | **7/7/7/7** | **全周期，峰值 LONG** |
| `meanAmplitude` | LOW | **H5, H10, H20, H60（全 4 期）** | 7/7/5/6 | **全周期，峰值 LONG** |
| `turnover` | LOW | **H5, H10, H20, H60（全 4 期）** | 5/6/6/6 | **全周期，峰值 LONG** |
| `limitGap` | HIGH | H10, H20, H60（H5 不显著） | 6/7/6/7 | **MEDIUM→LONG** |
| `historyLimitCount` | LOW | **仅 H60** | 4/5/5/**5** | **纯 LONG** |
| `t1VolumeRatio` | HIGH | **仅 H60** | 4/5/5/**7** | **纯 LONG** |

🔴 **7 个均值因子的峰值持有期全部是 `H60`** ⇒ 按「最大 `ExcessMean`」判定，全部属于 **LONG**。
⚠️ **但必须分开读**：其中 **4 个在 `H5` 就已经显著**（`amountPercentile` +0.391、`maxAmplitude` +0.365、`meanAmplitude` +0.276、`turnover` +0.277）⇒ 它们是**全周期**因子，只是**幅度随持有期单调放大**（池在 H60 的负漂移最大 −0.483%，低波动组躲开的最多）。
⇒ **只有 `historyLimitCount LOW` 与 `t1VolumeRatio HIGH` 是「纯 LONG」**（短中期完全不显著）。
✅ 按任务书要求「不要因为某一个 horizon 表现好就直接认定为均值因子」——**本轮的 7 个因子里 5 个至少在 3 个持有期上同时成立**，不是单点偶然。

---

## 4. Top3 / Top5 / Bottom3

### 4.1 Top5 一致性（`ExcessMean` 点估计，Top3 → Top5）

| 因子 | 方向 | H5 | H10 | H20 | H60 | 同向？ |
|---|---|---:|---:|---:|---:|:---:|
| `amountPercentile` | LOW | +0.391 → +0.179 | +0.761 → +0.457 | +1.422 → **+0.921** | +3.022 → **+2.395** | ✅ |
| `maxAmplitude` | LOW | +0.365 → +0.334 | +0.409 → +0.509 | +0.617 → **+0.719** | +1.974 → +1.603 | ✅ |
| `meanAmplitude` | LOW | +0.276 → +0.244 | +0.511 → +0.414 | +0.697 → **+0.602** | +1.747 → +1.554 | ✅ |
| `turnover` | LOW | +0.277 → +0.261 | +0.463 → +0.462 | +0.731 → **+0.777** | +1.464 → +1.338 | ✅ |
| `limitGap` | HIGH | +0.236 → +0.166 | +0.474 → +0.376 | +0.699 → **+0.603** | +1.445 → +1.509 | ✅ |
| `historyLimitCount` | LOW | +0.054 → +0.060 | +0.163 → +0.213 | +0.409 → +0.506 | +1.270 → +1.131 | ✅ |
| `t1VolumeRatio` | HIGH | +0.129 → +0.126 | +0.253 → +0.253 | +0.291 → +0.352 | +1.122 → +0.956 | ✅ |

⇒ **7/7 全部 Top3 与 Top5 同向**（满足判定标准第 3 条）。
⚠️ 与 `RIGHT-TAIL-SELECTION-RULE-001` 相反：**均值信号的 `Top5` 不弱于 `Top3`**（`amountPercentile` / `maxAmplitude` / `limitGap` 的 `Top5` 甚至**更强**）—— 因为均值优势**不是集中在最极端几只**，而是**一整片低波动区域的共同属性**。这与「尾部优势集中在最极端几只（Top3 强于 Top5）」形成镜像。

### 4.2 Bottom3 方向诊断（非策略候选）

**恒等式（本轮实测逐格成立）**：`Bottom3(冻结方向) ≡ Top3(反向)`。
例：`maxAmplitude HIGH` 的 `Bottom3` `ExcessMean` = **+0.617** = `maxAmplitude LOW` 的 `Top3` `ExcessMean` **+0.617** ✅

⇒ `Bottom3` 只用来**确认方向**：**取「最差 3 只」反而跑赢随机**，印证「均值在低端、尾部在高端」。
⇒ 反向理解：**`Top3(尾部方向)` 与 `Bottom3(均值方向)` 是同一批股票** —— 即「右尾因子选出的正是均值最差的一群」。

---

## 5. 判定标准与稳定性

**预注册判定树**（先定后用）：

```text
meanSig(h)       = K=3 ExcessMean > 0 且 日簇 95% CI 下界 > 0
top5Agree(h)     = K=5 ExcessMean > 0
yearsPos(h)      = 「ExcessMean > 0」的年份数（K=3，共 7 年）
meanConsistent(h)= meanSig ∧ top5Agree ∧ yearsPos ≥ 5

A  CROSS_SECTIONAL_MEAN_SIGNAL = ∃h: meanConsistent(h)
   REGIME_DEPENDENT（标记，非 A）= ∃h: meanSig(h) ∧ yearsPos < 5
B  RIGHT-TAIL SIGNAL           = ∃h: ExcessTCR50 > 0 且 CI 下界 > 0
C  RISK / LEFT-TAIL SIGNAL     = ∃h: ExcessMean < 0 且 CI 上界 < 0 且（7 − yearsPos）≥ 5
D  NO USEFUL CROSS-SECTIONAL SIGNAL = 以上皆不成立

判定优先级：A → B → C → D（按「因子 × 方向」逐格判定）
```

**本轮的 `REGIME_DEPENDENT` 命中数 = 0** —— 所有 `meanSig` 成立的格都同时满足 `top5Agree` 与 `yearsPos ≥ 5`。**没有任何均值信号是「只靠少数年份」成立的。**

### 5.1 年度明细（7 个 A 类方向 × 最佳持有期）

| 因子 | 方向 | 持有 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 正年 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`amountPercentile`** | LOW | H60 | +1.34 | +1.32 | +2.98 | +4.91 | +2.88 | +2.76 | **+5.55** | **7/7** |
| **`maxAmplitude`** | LOW | H60 | +3.44 | +1.61 | +0.64 | +3.90 | +0.55 | +1.49 | +2.34 | **7/7** |
| **`t1VolumeRatio`** | HIGH | H60 | +0.64 | +0.76 | +0.99 | +1.41 | +1.36 | +0.82 | +2.11 | **7/7** |
| **`limitGap`** | HIGH | H60 | +2.18 | +2.39 | +1.58 | +1.53 | +0.71 | +0.95 | +0.56 | **7/7** |
| `meanAmplitude` | LOW | H60 | +2.38 | +1.90 | −0.20 | +4.11 | +1.82 | +1.41 | +0.54 | 6/7 |
| `turnover` | LOW | H60 | +2.03 | +2.03 | +0.65 | +2.39 | +0.67 | −0.17 | +3.07 | 6/7 |
| `historyLimitCount` | LOW | H60 | +4.09 | +4.55 | −0.02 | +0.46 | +0.20 | +0.37 | −1.34 | 5/7 |

✅ **4 个因子在最佳持有期上 7/7 年为正**；最弱的 `historyLimitCount` 也有 5/7。

---

## 6. 与现有 8 个右尾因子的区分

任务书要求：**不要重新把 8 个右尾因子定义为均值因子，除非严格的 `ExcessMean` 标准实际证明它们成立。**

**实测结果（严格标准下）：**

| 因子 | 冻结方向（= 尾部方向） | `ExcessMean` | 是否成为均值因子 | 其**反向**是否成为均值因子 |
|---|---|---:|:---:|:---:|
| `meanAmplitude` | HIGH | **−1.635\*** (H20) | ❌ | ✅ **LOW = A** |
| `maxAmplitude` | HIGH | **−1.258\*** (H20) | ❌ | ✅ **LOW = A** |
| `preReturn10` | HIGH | −0.444 (H20) | ❌ | ❌（LOW 也不显著） |
| `limitGap` | LOW | **−0.922\*** (H20) | ❌ | ✅ **HIGH = A** |
| `bodyHeight` | HIGH | **−1.027\*** (H20) | ❌ | ❌（LOW 不显著） |
| `turnover` | HIGH | **−1.712\*** (H20) | ❌ | ✅ **LOW = A** |
| `drawdownDepth` | HIGH | **−1.019\*** (H20) | ❌ | ❌（LOW 不显著） |
| `t1VolumeRatio` | LOW | −0.373 (H20) | ❌ | ✅ **HIGH = A** |

⇒ **8 个右尾因子本身在严格标准下【全部不成立】为均值因子（预期被证实）。**
⇒ **但其中 5 个的反向成立**（`meanAmplitude` / `maxAmplitude` / `limitGap` / `turnover` / `t1VolumeRatio`）—— 这是本轮的新发现。
⇒ **`preReturn10` / `bodyHeight` / `drawdownDepth` 是「纯右尾因子」**：**两个方向都没有均值优势**，反向也不显著（`bodyHeight LOW` +0.143、`preReturn10 LOW` −0.086、`drawdownDepth LOW` −0.070）。
🔴 **这三个才是真正的「独立的右尾因子」** —— 它们的均值信息**不能**由方向翻转回收。这一点对后续研究有直接价值。

---

## 7. 四类最终分类

```text
12 Factors
    ↓
A. MEAN SIGNAL          : 7 格（冻结方向）
    amountPercentile·LOW  maxAmplitude·LOW  meanAmplitude·LOW  turnover·LOW
    limitGap·HIGH  historyLimitCount·LOW  t1VolumeRatio·HIGH
    ↓
B. RIGHT-TAIL SIGNAL    : 10 格（= 8 个「右尾因子」方向 + historyLimitCount·HIGH
                                        + t1OpenGap·HIGH；其中 9/10 是冻结方向的反向）
    meanAmplitude·HIGH  maxAmplitude·HIGH  limitGap·LOW  preReturn10·HIGH
    bodyHeight·HIGH  drawdownDepth·HIGH  turnover·HIGH  t1VolumeRatio·LOW
    historyLimitCount·HIGH  t1OpenGap·HIGH
    ↓
C. RISK / LEFT-TAIL SIGNAL : 主类 3 格 · 含重叠共 11 格
    主类：amountPercentile·HIGH  preReturn10·LOW  t1OpenGap·LOW
    重叠（同时是 B）：bodyHeight·HIGH  meanAmplitude·HIGH  maxAmplitude·HIGH
                      drawdownDepth·HIGH  historyLimitCount·HIGH  limitGap·LOW  t1VolumeRatio·LOW
    ⇒ 「应当回避」的一侧：11/22 格的 ExcessMean 显著为负且 ≥5/7 年为负
    ↓
D. NO USEFUL CROSS-SECTIONAL SIGNAL : 2 格
    bodyHeight·LOW   drawdownDepth·LOW
```

| 分类 | 格数 | 占 22 格 |
|---|---:|---:|
| **A** MEAN SIGNAL | **7** | 31.8% |
| **B** RIGHT-TAIL SIGNAL | **10** | 45.5% |
| **C** RISK（主类） | 3 | 13.6% |
| **D** NO SIGNAL | 2 | 9.1% |
| （C 重叠口径） | 11 | 50.0% |

🔴 **A ∩ B = ∅** —— **没有任何一格同时是均值信号与右尾信号。**

---

## 8. 特别检查（逐问作答）

### Q1 · 之前的 12 因子研究为什么最终形成 `3F Top3`？

**事实链（全部来自既有冻结文档）：**
1. `RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001`（2026-09-25）在 2F / **3F** / 4F-W / 4F-EQ / 12F-EQ 之间并列比较，**3F = `maxAmplitude` 33.33% + `meanAmplitude` 33.33% + `t1VolumeRatio` 33.33% 等权**；
2. 选择依据是 **跨档同号率最高（四档平均 1.000；2F 0.906 / 4F-W 0.969）**，且三方案都优于 12F 等权；
3. ⚠️ 该报告自述：**成员集合是「事后按上一轮已读数据挑出来的」，不是 OOS**；
4. 用的是**冻结 `orientation`**：`maxAmplitude` −1、`meanAmplitude` −1（**LOW 振幅**）、`t1VolumeRatio` +1（**HIGH 量比**）。

**🔴 本轮给出的机理解释：**
`3F` 的三个成分在其冻结方向上都**恰好是本轮确认的 A 类均值因子**：

| 3F 成分 | 冻结方向 | 本轮 `ExcessMean`（H60） | 年度为正 | 尾部信号 |
|---|---|---:|---:|---|
| `maxAmplitude` | LOW | **+1.974\*** | **7/7** | 无（`ExcessTCR50` −0.344） |
| `meanAmplitude` | LOW | **+1.747\*** | 6/7 | 无（`ExcessTCR50` −0.856） |
| `t1VolumeRatio` | HIGH | **+1.122\*** | **7/7** | 无（`ExcessTCR50` −0.201） |

⇒ **3F 之所以「同号率最高」，是因为它恰好把三个均值因子按正确方向等权相加。**
⇒ **3F 的形成与「右尾」毫无关系 —— 它是均值方向的产物。** 后续研究线把它当作尾部工具来评估，才产生了「3F 反尾」的困惑。

### Q2 · `3F Top3` 在当前严格 `ExcessMean` 标准下属于 Mean Signal 还是 Right-Tail Signal？

## 🔴 **属于（弱）MEAN SIGNAL —— 明确不是 Right-Tail Signal。**

**证据 ①（历史冻结，方向级）**
- `PLAN-RESOLVING-RANK-3F-001` 步骤 ②（全候选池 50,907）：`rho = +0.0574 (rd10) → +0.1116 (rd60)`，**随持有期上升、高度显著** ⇒ 弱但真实的**正向均值**信号；
- `RESULT-TAIL-EXPLORE-001`：`Spearman(3F, rd40 ≥+50%) = −0.0365`；**最低分位尾率 4.15%（lift 1.51）是最高分位 1.94%（lift 0.71）的 2.14×** ⇒ **系统性反尾**；
- `PLAN-TAIL-SELECTION-001` 臂 B：3F 均值 **+0.441%**（五臂最好）vs 无排序对照 **−0.889%**。

**证据 ②（本轮成分级，与冻结方向对拍）**
- 三个成分在其冻结方向上**全部为 A 类均值因子**（`ExcessMean` +1.12 ~ +1.97 pp，年度 7/7、6/7、7/7）；
- 三个成分在冻结方向上**全部没有尾部信号**（`ExcessTCR50` −0.344 / −0.856 / −0.201，均不显著）。

**🔴 口径警告（必须与结论同读）**：历史 `rho` 测于 **ds 660001 / v5 + 回踩门池（50,907 / 可排名 70,236）+ 入场 rd6 + rd10/rd40/rd60**；本轮测于 **ds 780003 / v9 + 无门池（56,987）+ 入场 T+10 + H5/H10/H20/H60**。
⇒ **两者数值不可直接比较，只可比「方向 / 定性」。** 定性一致：**均值正向、尾部反向。**

**🔴 补充（有价值的副结论）**：3F 的**弱**是**装配问题，不是成分无信号**——成分级 `ExcessMean` 达 **+1.12 ~ +1.97 pp**，而组合 `rho` 仅 +0.057~+0.112。根因已在 `RESULT-151PCT-WINNER-CONCENTRATION-001` §10.2 定位：三因子被冻结成 **2/5/5 档分桶 ⇒ 合成分只有 18 个取值、3 档覆盖 86.9% 的成交、最高分并列 262 笔**，破平键为不透明 `securityId`。**低分辨力把强成分稀释成了弱组合。**

### Q3 · 原 12 因子中是否存在真正独立的 Mean Signal？

## 🔴 **存在 7 个均值信号，但【没有一个是独立的】。**

- **7/7** 的 A 类均值方向 **等于冻结 `orientation` 方向**；
- **9/10** 的 B 类尾部方向 **等于冻结 `orientation` 的严格反向**；
- **22 格中 A 与 B 严格互斥**（A ∩ B = ∅）；
- ⇒ **均值与右尾是同一根横截面轴（振幅 / 换手 / 成交额 / 量比的相对高低）的两端。** 「选低波动 → 均值占优但尾部更薄；选高波动 → 尾部更厚但均值更差」。
- 🔴 **唯一的例外维度是 `preReturn10` / `bodyHeight` / `drawdownDepth`**：三者**反向也不构成均值信号**（+0.143 / −0.086 / −0.070，均不显著）⇒ **它们是纯右尾信息**。
- 🔴 **`t1OpenGap` 是唯一「双向都无信号」的因子**（HIGH：均值 +0.023 / 尾部 +0.373 皆不显著；LOW：均值 −0.335 / 尾部 +0.011 皆不显著）⇒ **D 类**。

### Q4 · 如果存在，哪个因子最稳定？

## 🔴 **`amountPercentile`（同日成交额分位）· LOW 方向 —— 最稳定的均值因子。**

| 判据 | 实测 |
|---|---|
| `ExcessMean` 显著性 | **H5 / H10 / H20 / H60 全部 CI 下界 > 0**（+0.391 / +0.761 / +1.422 / **+3.022**） |
| 年度稳定性 | H5 5/7 · H10 6/7 · **H20 7/7** · **H60 7/7** |
| Top3 / Top5 一致 | ✅（H20 +1.422 / +0.921；H60 +3.022 / +2.395） |
| 「不是仅由单一年份贡献」 | ✅ **7/7 年**，最弱年 +1.32，最强年 +5.55 |
| 尾部副作用 | ✅ **无**（`ExcessTCR50` 最高 +0.086，不显著；`Lift` 1.020，CI 跨 1） |
| 与冻结方向一致 | ✅ **`orientation = −1 = LOW`** |
| `REGIME_DEPENDENT` | ❌ 未命中 |

**次稳**：`maxAmplitude LOW`（4 个持有期全部显著，**4 个持有期全部 7/7 年**）· `limitGap HIGH`（3 期显著，6–7/7 年）。

### Q5 · 它属于 SHORT / MEDIUM / LONG 哪个时间尺度？

| 因子 | 判定 |
|---|---|
| `amountPercentile` LOW | **全周期（SHORT→LONG 单调增强，峰值 LONG/H60 +3.022）** |
| `maxAmplitude` LOW | **全周期，峰值 LONG**（4 期 7/7 年） |
| `meanAmplitude` LOW | **全周期，峰值 LONG** |
| `turnover` LOW | **全周期，峰值 LONG** |
| `limitGap` HIGH | **MEDIUM→LONG**（H5 不显著） |
| `historyLimitCount` LOW | **纯 LONG**（仅 H60 显著） |
| `t1VolumeRatio` HIGH | **纯 LONG**（仅 H60 显著，7/7 年） |

⇒ **按「最大 `ExcessMean`」判：7/7 全部为 LONG。**
⇒ **按「显著持有期覆盖」判：4 个是全周期、1 个是 MEDIUM→LONG、2 个是纯 LONG。**

### Q6 · 若不存在则报告 `NO_MEAN_SIGNAL_FOUND_IN_FROZEN_12_FACTORS`

## **不适用。**
均值信号**存在且很强**（7 个方向；最高 `ExcessMean` **+3.02 pp**；4 个因子在最佳持有期 **7/7 年为正**）。
**但必须同时声明**：`MEAN_SIGNAL_FOUND = 7 directions`，且 **`INDEPENDENT = NO`** —— 它们是 **8 个右尾因子的冻结方向**，与右尾信号共享同一根轴。
**准确的单一结论句**：

> ## 🔴 `MEAN_SIGNAL_FOUND (7) — BUT NOT INDEPENDENT OF THE TAIL AXIS`

---

## 9. `3F Top3` 的重新定性结论（独立章节）

| 项 | 结论 |
|---|---|
| **定性** | 🔴 **弱 `CROSS_SECTIONAL_MEAN_SIGNAL`（且系统性反尾），不是 Right-Tail Signal。** |
| 组成 | `maxAmplitude` LOW + `meanAmplitude` LOW + `t1VolumeRatio` HIGH（等权）—— **三个成分全部是 A 类均值因子** |
| 历史证据 | `rho` +0.0574→+0.1116（随持有期上升）；`Spearman(3F, rd40≥+50%) = −0.0365`；最低分位尾率 = 最高分位的 2.14× |
| 本轮证据 | 三个成分的冻结方向 `ExcessMean` = +1.97 / +1.75 / +1.12 pp（H60，7/7 / 6/7 / 7/7 年），且**全部无尾部信号** |
| 为什么"弱" | **装配导致**：2/5/5 桶 ⇒ 仅 18 档、3 档覆盖 86.9%、最高分并列 262 笔、破平键 = 不透明 `securityId` ⇒ **低分辨力把强成分稀释成弱组合** |
| 为什么"反尾" | 🔴 **不是缺陷，是设计的必然**：它由三个「低波动/高量比」方向组成，而**低波动端的右尾本就最薄** ⇒ **反尾是「选均值方向」的直接推论** |
| 是否曾被误用 | 是。后续研究线（`9cp`/`9cq`/rounds 1–8）把它当作**尾部工具**来评估，才产生「3F 反尾」的困惑 —— 而它从来不是尾部工具 |

---

## 10. 限制与边界确认

### 10.1 限制

| # | 限制 | 影响 |
|---|---|---|
| 1 | 🔴 **非平台正式 Run** | 沙箱 `spawn EPERM`；只读 DB 适配器驱动同一份已 `tsc` 通过的模块，未生成 Run 行/产物 |
| 2 | 窗口缺最后 ~12 个月 | 2019-01-02 ~ 2025-09-26 |
| 3 | `v9 status = FAILED` 未改 | 平台 `datasetPort` 要求 `READY` ⇒ 平台 Run 仍会被拒 |
| 4 | 池含 `listedAgeDays >= 365` | 非全市场首板池 |
| 5 | **与历史 3F 口径不可比** | 历史测于 ds 660001/v5 + 回踩门池 + 入场 rd6 + rd10/40/60；本轮 ds 780003/v9 + 无门池 + 入场 T+10 + H5/10/20/60 ⇒ **只可比方向，不可比数值** |
| 6 | 未构建 3F 复合分 | 任务书禁止「多因子组合」⇒ §8-Q2/§9 的 3F 定性**基于历史冻结证据 + 成分级本轮证据**，**不是**本轮重跑的组合 |
| 7 | `holdStreak` 未测 | 按 P3 `TIE_BREAK_DOMINATED` 排除（本轮重测强化确认：99.5% 交易日单值占比 ≥50%、J(ASC,DESC)=0.566） |
| 8 | `H60` 的 `ExcessMean` 幅度最大 | 因池在 H60 的负漂移最大（−0.483%）⇒ 「7/7 判为 LONG」部分由幅度驱动，已同时给出「显著持有期覆盖」口径 |
| 9 | 未做 OOS / Parameter Search / 权重 / 阈值 / 组合 | 硬约束；**所有数字均为样本内** |

### 10.2 边界确认

- ✅ **未修改** Dataset / Schema / Migration / 12 因子定义 / 方向 / 桶边界 / 任何历史 Run / 任何既有实验结果；`status` 保持 `FAILED`
- ✅ **未新增**因子 / 未修改因子定义 / 未修改 bucket / **未做**权重搜索 / 参数搜索 / 多因子组合 / OOS / WFA
- ✅ **未创建** Candidate / StrategyVersion；**未再次优化 3F Top3**；**未为了改善 Mean 添加任何过滤条件**
- ✅ `holdStreak` **未参与**任何 Top-K 测试（仅做排除条件再确认）
- ✅ **复用现有模块**：`rightTailMetrics` 新增 `buildRandomTopKReference` / `summarizeAgainstRandomTopK` / `RandomTopKReferenceDay` / `AgainstRandomTopKDay` / `AgainstRandomTopKResult`（**增量，向后兼容**）；并复用既有 `pickUniformRandomSubset` / `rankCandidates` / `excessOf` / `bootstrapLift`
- ✅ **RAND 使用修正后的「逐日均匀无放回 K 子集」**（200 个固定种子），**未使用**旧 tie-break `RAND`
- ✅ 全程**只读 `SELECT`**（post 2,770,932 行 + event + prefix）
- ✅ `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json` = **0 错**
- ⚠️ `pnpm run check` / `vitest` **未能运行**（沙箱命名管道边界）；`checkEolDrift --strict` 同样受限，改逐字节核验 EOL

**复现命令**（只读）：

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json
node node_modules/typescript/bin/tsc --outDir $env:TEMP\tailbuild --module commonjs `
  --target es2022 --moduleResolution node --skipLibCheck --incremental false --strict `
  research-experiments/shared/singleFactor/rightTailTypes.ts `
  research-experiments/shared/singleFactor/rightTailMetrics.ts `
  research-experiments/shared/singleFactor/rightTailUniverse.ts `
  research-experiments/shared/dateClusterBootstrap.ts
node --max-old-space-size=8192 scripts/_scratch/meanFactorRun.cjs      # 主实验
node scripts/_scratch/meanFactorSummary.cjs                            # 分类 + 冻结方向对拍
```

**产物**：`%TEMP%\mean_factor.json` · `mean_factor.txt` · `mean_factor_summary.txt`。

---

## 11. 结论与下一步判定

### 11.1 一句话结论

> **12 个冻结因子中确实存在 7 个横截面均值因子（`ExcessMean` 最高 +3.02 pp、4 个因子年度 7/7），但它们【不是独立维度】—— 它们就是 8 个右尾因子的冻结方向。反转方向即在「均值端」与「尾部端」之间切换。`3F Top3` 因此在定性上属于【弱 Mean Signal、系统性反尾】，其弱来自 2/5/5 分桶的装配损失，而非成分无信号。**

### 11.2 是否继续做组合实验？

**❌ 不做。** 依据：
1. 均值信号已确认其**唯一来源**（= 冻结方向），**不存在「第三个独立维度」可通过组合引入**；
2. 组合只能在同一根轴的两端之间插值 —— `RIGHT-TAIL-SELECTION-RULE-001` 已实测：7 条规则中 0 条能让均值不再显著为负，且「共同极端」只是减少劣势而非消除；
3. 任务书明令禁止多因子组合、权重搜索、Parameter Search。

### 11.3 建议的下一步（不在本任务范围，需另立任务）

| 优先级 | 建议 | 依据 |
|---|---|---|
| 🔴 **P1** | **修复 3F 的装配分辨力**（2/5/5 桶 ⇒ 18 档），让已确认的强成分（+1.12~+1.97 pp）不再被稀释成 `rho` +0.057 | §8-Q2；`RESULT-151PCT-WINNER-CONCENTRATION-001` §10.2 已定位 |
| 🔴 **P1** | 把 `amountPercentile LOW` 作为**独立**候选验证（它同时是最强均值因子、无尾部副作用、与冻结方向一致） | §8-Q4 |
| 🟠 **P2** | 为 `preReturn10` / `bodyHeight` / `drawdownDepth` 单独研究 —— 它们是**唯一「反向也不构成均值信号」的纯右尾信息** | §6 / §8-Q3 |
| 🟠 **P2** | 把 **C 类风险方向（11/22 格）** 用于**下行风险控制**（`ExcessMean` 显著为负且 ≥5/7 年为负） | §7 |
| ⚪ **P3** | `t1OpenGap` 归入 D 类，**停止在其上投入** | §8-Q3 |

**🔴 明确停止的三项**：
1. 停止在 12 因子内部寻找「独立于右尾轴的均值维度」—— **已证不存在**；
2. 停止对 8 个右尾因子做方向/组合/权重搜索（`RIGHT-TAIL-SELECTION-RULE-001` 已关闭）；
3. 停止把 `3F Top3` 当作尾部工具评估 —— **它的正确用途是（弱）均值选股**。
