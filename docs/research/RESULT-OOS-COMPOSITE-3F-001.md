# RESULT-OOS-COMPOSITE-3F-001 —— 3F 双振幅+量比等权组合排序键的按年份后置窗口验证

> 本文件由 `_oos_report.mjs` **机械生成**，全部数字直接取自 6 个 Run 的结果信封 JSON，
> 不存在人工转录；生成后由 `_oos_verify.mjs` 独立回校（见 §13）。

- 任务书：`TASK-OOS-COMPOSITE-3F-001.md`（冻结口径来源）
- 生成时间：2026-09-25T16:05:12.628Z
- 主 Run：**RUN-20260925-76FA1DCC**（3F / HOLDOUT）；负对照 RUN-20260925-E4BA89C4（12F-EQ / HOLDOUT）
- 数据末端：Dataset v5 实查 `endDate = 2026-09-04`（见 §7 与 §11.7）

## 0. 一句话结论

在**只读一次**的验证段（2024-01-01 .. 2026-09-04）上，
3F 等权组合在 `FIXED` 日集四档中 **4/4 档 POSITIVE**（N3/N5/N10/N20），
条件 1 成立、条件 2 成立、条件 3 成立
（N3/N5/N10 中 3/3 档优于 12F-EQ 同档，需 ≥2）⇒ 判定 = **强通过**。

## 1. Lineage（Run / Dataset / 指纹）

### 1.1 三个实验实例

| 角色 | experimentId | 成员 | 成员指纹 | 桶词表指纹 | 权重和 |
| --- | --- | --- | --- | --- | --- |
| 主方案（3F） | `first-board-pullback/composite-factor-3f-amplitude-volume-oos-study` | maxAmplitude · meanAmplitude · t1VolumeRatio（等权 1/3 各） | `fnv1a32:27e759d7` | `fnv1a32:4eae4835` | 1 |
| 参照（4F-EQ） | `first-board-pullback/composite-factor-4f-equal-weight-oos-study` | maxAmplitude · meanAmplitude · t1VolumeRatio · limitGap（等权 1/4 各） | `fnv1a32:bbcbb61c` | `fnv1a32:abc25319` | 1 |
| 负对照（12F-EQ） | `first-board-pullback/composite-factor-12f-equal-weight-oos-study` | FROZEN_TWELVE_FACTOR_MEMBERS 全 12 个（等权 1/12 各） | `fnv1a32:c258fe26` | `fnv1a32:f0500413` | 1 |

成员逐项展开（取自各 Run 的 `customPayload.composition.members`）：

- **3F**（3 成员）
  - maxAmplitude（LOW，权重 33.3333%，先验已验证=true，契约 fnv1a32:17cbaa14）
  - meanAmplitude（LOW，权重 33.3333%，先验已验证=true，契约 fnv1a32:784ec6b0）
  - t1VolumeRatio（HIGH，权重 33.3333%，先验已验证=true，契约 fnv1a32:ee5ec2d9）
- **4F-EQ**（4 成员）
  - maxAmplitude（LOW，权重 25.0000%，先验已验证=true，契约 fnv1a32:17cbaa14）
  - meanAmplitude（LOW，权重 25.0000%，先验已验证=true，契约 fnv1a32:784ec6b0）
  - t1VolumeRatio（HIGH，权重 25.0000%，先验已验证=true，契约 fnv1a32:ee5ec2d9）
  - limitGap（HIGH，权重 25.0000%，先验已验证=false，契约 fnv1a32:a6b57b58）
- **12F-EQ**（12 成员）
  - bodyHeight（LOW，权重 8.3333%，先验已验证=true，契约 fnv1a32:cf6d4142）
  - turnover（LOW，权重 8.3333%，先验已验证=true，契约 fnv1a32:b9ab1e12）
  - amountPercentile（LOW，权重 8.3333%，先验已验证=true，契约 fnv1a32:8d5d168f）
  - meanAmplitude（LOW，权重 8.3333%，先验已验证=true，契约 fnv1a32:784ec6b0）
  - maxAmplitude（LOW，权重 8.3333%，先验已验证=true，契约 fnv1a32:17cbaa14）
  - holdStreak（HIGH，权重 8.3333%，先验已验证=false，契约 fnv1a32:3bddcad2）
  - t1VolumeRatio（HIGH，权重 8.3333%，先验已验证=true，契约 fnv1a32:ee5ec2d9）
  - limitGap（HIGH，权重 8.3333%，先验已验证=false，契约 fnv1a32:a6b57b58）
  - preReturn10（LOW，权重 8.3333%，先验已验证=false，契约 fnv1a32:51386bfe）
  - drawdownDepth（LOW，权重 8.3333%，先验已验证=true，契约 fnv1a32:683eee94）
  - t1OpenGap（HIGH，权重 8.3333%，先验已验证=true，契约 fnv1a32:e9f99bc4）
  - historyLimitCount（LOW，权重 8.3333%，先验已验证=true，契约 fnv1a32:8dd9292f）

### 1.2 6 个 Run

| 方案 | 角色 | 阶段 | runId | Dataset | 标签 | 评估窗口 | 父 Run | 耗时 | 参数 | resultManifestKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3F | 主方案 | OBSERVATION | `RUN-20260925-220C7F89` | 660001 | v5 | 2019-01-01 .. 2023-12-31 | — | 320.0s | `{}` | `experiments/first-board-pullback/composite-factor-3f-amplitude-volume-oos-study/runs/RUN-20260925-220C7F89/manifest.json` |
| 3F | 主方案 | HOLDOUT | `RUN-20260925-76FA1DCC` | 660001 | v5 | 2024-01-01 .. 2026-09-04 | RUN-20260925-220C7F89 | 231.6s | `{}` | `experiments/first-board-pullback/composite-factor-3f-amplitude-volume-oos-study/runs/RUN-20260925-76FA1DCC/manifest.json` |
| 4F-EQ | 参照 | OBSERVATION | `RUN-20260925-76FC74F4` | 660001 | v5 | 2019-01-01 .. 2023-12-31 | — | 317.5s | `{}` | `experiments/first-board-pullback/composite-factor-4f-equal-weight-oos-study/runs/RUN-20260925-76FC74F4/manifest.json` |
| 4F-EQ | 参照 | HOLDOUT | `RUN-20260925-509DEF49` | 660001 | v5 | 2024-01-01 .. 2026-09-04 | RUN-20260925-76FC74F4 | 211.1s | `{}` | `experiments/first-board-pullback/composite-factor-4f-equal-weight-oos-study/runs/RUN-20260925-509DEF49/manifest.json` |
| 12F-EQ | 负对照 | OBSERVATION | `RUN-20260925-001BDF48` | 660001 | v5 | 2019-01-01 .. 2023-12-31 | — | 359.6s | `{}` | `experiments/first-board-pullback/composite-factor-12f-equal-weight-oos-study/runs/RUN-20260925-001BDF48/manifest.json` |
| 12F-EQ | 负对照 | HOLDOUT | `RUN-20260925-E4BA89C4` | 660001 | v5 | 2024-01-01 .. 2026-09-04 | RUN-20260925-001BDF48 | 250.7s | `{}` | `experiments/first-board-pullback/composite-factor-12f-equal-weight-oos-study/runs/RUN-20260925-E4BA89C4/manifest.json` |

### 1.3 协议与代码身份

| 方案 | protocolFingerprint | experimentCodeDigest |
| --- | --- | --- |
| 3F | `protocol-sha256:56471b14de27243cb355a03b50c85d2ec5d29fe7a914f797d2c71d12487db8e8` | `exp-code-sha256:652d26ce893f8b8e3f535e4f8ead512d6abb814b648800f0ccacb43e30bd753d` |
| 4F-EQ | `protocol-sha256:146999e2943146cb9a737ec4a8b5835d548b8ae0c6ff3b45efe989638f3fd0a1` | `exp-code-sha256:326d8f248d8917e28fc94627e31a4cae066dd011e487ad6a8abf81f4df8b12a5` |
| 12F-EQ | `protocol-sha256:040d2012d6316891e1ecc454080d91e7fc54f62de1abd82d14b112b91fd516e3` | `exp-code-sha256:7dc0769db9251e5d4a112a12fc0e74a86079fba8c79c7883c97b70d9d1249d9f` |

同一方案的 OBSERVATION 与 HOLDOUT **协议指纹相同**——因为平台指纹的 body 只含 `protocolId / protocolVersion / hypothesisCode / observationWindow / holdoutWindow / experimentId / datasetVersionId / parameters`，**不含 `phase` 与 `parentRunId`**（`server/researchExperiments/protocol.ts#computeProtocolFingerprint`）。
三方案指纹互不相同 ⇒ 各自的 HOLDOUT 配额互不占用。

## 2. 主表：验证段（HOLDOUT）各档超额与 95% CI

### 2.1 主日集 `FIXED`（统一门槛 20）—— 主判据所在

| 档位 | 3F 超额均值 | 3F CI95 下 | 3F CI95 上 | 3F 判定 | 3F 日胜率 | 纳入日数 |
| --- | --- | --- | --- | --- | --- | --- |
| N3（Top-3） | **+0.4090%** | +0.0056% | +0.8319% | POSITIVE | 53.1303% | 591 |
| N5（Top-5） | **+0.4898%** | +0.1563% | +0.8575% | POSITIVE | 55.4992% | 591 |
| N10（Top-10） | **+0.3061%** | +0.0353% | +0.6029% | POSITIVE | 56.1760% | 591 |
| N20（Top-20） | **+0.1906%** | +0.0049% | +0.3819% | POSITIVE | 56.0068% | 591 |

### 2.2 `OWN` 日集（各档自身门槛）

| 档位 | 3F 超额均值 | 3F CI95 | 3F 判定 | 日胜率 | 纳入日数 |
| --- | --- | --- | --- | --- | --- |
| N3 | +0.4532% | [+0.0857%, +0.8120%] | POSITIVE | 53.6210% | 649 |
| N5 | +0.4540% | [+0.1142%, +0.7961%] | POSITIVE | 55.1618% | 649 |
| N10 | +0.2925% | [+0.0431%, +0.5380%] | POSITIVE | 55.8140% | 645 |
| N20 | +0.1906% | [+0.0055%, +0.3805%] | POSITIVE | 56.0068% | 591 |

### 2.3 N20 的 `OWN` 与 `FIXED`：同一样本、同一**点估计**，但 CI 端点不同

因为 `FIXED` 门槛 = 最大档 20，N20 的两条 `scope` 纳入**完全相同的决策日集合**。
但 Bootstrap 种子按 `契约|档位|日集|用途`（`seedKey = ${comboId}/${scope}`，见 `analyse.ts:429`）计算 ⇒ 两边抽到的随机块不同 ⇒ **CI 端点不同**。

| Run | 日数（必须相同） | 超额均值（必须相同） | 日胜率（必须相同） | CI95 下 | CI95 上 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| 3F/OBSERVATION | 920 ✅ | 0.0023260778 ✅ | 56.5217% ✅ | +0.1325% / +0.1355% | +0.3311% / +0.3234% | POSITIVE / POSITIVE |
| 3F/HOLDOUT | 591 ✅ | 0.0019062252 ✅ | 56.0068% ✅ | +0.0055% / +0.0049% | +0.3805% / +0.3819% | POSITIVE / POSITIVE |
| 4F-EQ/OBSERVATION | 920 ✅ | 0.0019707209 ✅ | 54.5652% ✅ | +0.0949% / +0.1068% | +0.2920% / +0.2921% | POSITIVE / POSITIVE |
| 4F-EQ/HOLDOUT | 591 ✅ | 0.0028633516 ✅ | 60.4061% ✅ | +0.0995% / +0.0976% | +0.4730% / +0.4850% | POSITIVE / POSITIVE |
| 12F-EQ/OBSERVATION | 920 ✅ | 0.0011238282 ✅ | 51.4130% ✅ | +0.0009% / -0.0031% | +0.2351% / +0.2276% | POSITIVE / 🔴 INCONCLUSIVE |
| 12F-EQ/HOLDOUT | 591 ✅ | 0.0008257349 ✅ | 52.2843% ✅ | -0.0917% / -0.0967% | +0.2845% / +0.2844% | INCONCLUSIVE / INCONCLUSIVE |

（每格「OWN / FIXED」。点估计列已由生成器**机械断言**必须逐位相同，不同即抛错。）

🔴 **重要**：6 个 Run 中有 **1 例**在**同一样本、同一超额均值**下因 CI 端点差异导致**判定翻转**。
这说明判定在 CI 边缘**不稳健**——凡是 CI 下界贴近 0 的档位，其 `POSITIVE` 声明都应附带这条说明。
本报告 §3 的条件 1/2 依赖判定字符串，因此这条不确定性直接传导到最终裁定。

## 3. §四 主判据逐条判定

| # | 判据 | 阈值 | 实测 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | `FIXED` 四档中 ≥3 档 POSITIVE（CI 不跨 0 且均值 > 0） | ≥3/4 | 4/4（N3 / N5 / N10 / N20） | ✅ 成立 |
| 2 | N3 或 N5 至少一档 POSITIVE | ≥1 | N3 / N5 | ✅ 成立 |
| 3 | N3/N5/N10 中 ≥2 档优于 12F-EQ 同档 | ≥2/3 | 3/3（优于：N3 / N5 / N10） | ✅ 成立 |

### 3.1 条件 3 的逐档明细（FIXED 日集）

| 档位 | 3F 超额 | 12F-EQ 超额 | 差值（3F − 12F） | 是否优于 |
| --- | --- | --- | --- | --- |
| N3 | +0.4090% | -0.0355% | +0.4446% | ✅ |
| N5 | +0.4898% | -0.0686% | +0.5584% | ✅ |
| N10 | +0.3061% | +0.0058% | +0.3003% | ✅ |

### 3.2 裁定

- **通过（§4.3 三条全成立）**：是
- **强通过**（通过 且 N3/N5 均 POSITIVE 且 FIXED 四档全部优于 12F-EQ）：是
- N3/N5 均 POSITIVE：是；FIXED 四档全部优于 12F-EQ：是

### 3.3 裁定 = **强通过**

**判定裕度（机械取最薄档）**：四档中 `CI95 下界` 最小的是 **N20**，其下界 = **+0.0049%**（距 0 仅 0.49 bp，占其超额均值 +0.1906% 的 2.6%）。
⇒ 该档的 `POSITIVE` 属**边缘成立**：CI 端点对 Bootstrap 种子敏感（§2.3 已给出同点估计下判定翻转的实例）。

**先看 §10 的限制再引用本裁定。**

## 4. 年度切片（验证段，逐档）

⚠️ **口径警告**：模板的年度切片固定跑在 **`OWN` 日集**（`analyse.ts:435` 注释「按年 × 各档 × OWN 日集」，`scope: "OWN"`，`minDaySize = combo.size`），
与主判据的 `FIXED` 口径**不同**，且各年纳入日数不同 ⇒ 跨年数字是「不同日集上的描述性统计」，不可当作同一条序列比较。

| 年份 | 档位 | 纳入日数 | 组合日均 | 当日池基准 | 超额 | CI95 | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2024 | N3 | 242 | -0.2137% | -0.2422% | **+0.6399%** | [-0.0531%, +1.2790%] | INCONCLUSIVE |
| 2024 | N5 | 242 | -0.3925% | -0.2422% | **+0.4611%** | [-0.1777%, +1.0192%] | INCONCLUSIVE |
| 2024 | N10 | 239 | -0.4332% | -0.2422% | **+0.4193%** | [-0.0642%, +0.8364%] | INCONCLUSIVE |
| 2024 | N20 | 194 | -0.6441% | -0.2422% | **+0.2349%** | [-0.1144%, +0.5710%] | INCONCLUSIVE |
| 2025 | N3 | 243 | +0.5443% | +0.1033% | **+0.5115%** | [+0.1299%, +0.9004%] | POSITIVE |
| 2025 | N5 | 243 | +0.5597% | +0.1033% | **+0.5269%** | [+0.2000%, +0.8557%] | POSITIVE |
| 2025 | N10 | 242 | +0.4260% | +0.1033% | **+0.3650%** | [+0.0346%, +0.6852%] | POSITIVE |
| 2025 | N20 | 237 | +0.2729% | +0.1033% | **+0.2647%** | [+0.0810%, +0.4443%] | POSITIVE |
| 2026 | N3 | 164 | -0.5150% | -0.5954% | **+0.0913%** | [-0.8382%, +1.1907%] | INCONCLUSIVE |
| 2026 | N5 | 164 | -0.2709% | -0.5954% | **+0.3354%** | [-0.5046%, +1.3670%] | INCONCLUSIVE |
| 2026 | N10 | 164 | -0.6054% | -0.5954% | **+0.0009%** | [-0.5218%, +0.7040%] | INCONCLUSIVE |
| 2026 | N20 | 160 | -0.5504% | -0.5954% | **+0.0272%** | [-0.3807%, +0.5643%] | INCONCLUSIVE |

## 5. 跨年份同号率

**定义（本文件自定，逐字执行）**：对每个档位，以该档 **HOLDOUT 全段 `FIXED` 超额符号**为参照，
统计 3 个年份中 `OWN` 口径 `excessMean` **与参照同号**的年份数；
同号率 = Σ 各档同号年份数 ÷ （3 年 × 4 档）= 分母 12。

| 档位 | 全段 FIXED 参照符号 | 逐年符号（2024 / 2025 / 2026） | 同号年份数 |
| --- | --- | --- | --- |
| N3 | + | 2024:+ / 2025:+ / 2026:+ | 3/3 |
| N5 | + | 2024:+ / 2025:+ / 2026:+ | 3/3 |
| N10 | + | 2024:+ / 2025:+ / 2026:+ | 3/3 |
| N20 | + | 2024:+ / 2025:+ / 2026:+ | 3/3 |

- **平均跨年份同号率 = 100.0000%**
- **三年全部同号的档位数 = 4/4**
- 逐格正号率（12 格中 `excessMean > 0`）= 100.0000%

## 6. 随机选择检验分位（验证段 `FIXED` 日集）

「随机抽 N 个」的期望恒等于当日池均值 ⇒ 该检验问的是「排序键是否比随机抽签更好」。
`FIXED` 日集对四档是**同一个日集**，所以「当日池基准」四档相同；差别来自随机 P50 与观测组合日均。

| 档位 | 观测组合日均 | 当日池基准（＝随机期望） | 随机 P50 | 观测分位 | 隐含 p 值 | 模拟次数 |
| --- | --- | --- | --- | --- | --- | --- |
| N3 | -0.0326% | -0.4416% | -0.4543% | **0.978** | 0.022 | 1000 |
| N5 | +0.0481% | -0.4416% | -0.4453% | **1** | 0 | 1000 |
| N10 | -0.1355% | -0.4416% | -0.4457% | **0.999** | 0.001 | 1000 |
| N20 | -0.2510% | -0.4416% | -0.4385% | **0.999** | 0.001 | 1000 |

## 7. 样本账守恒校验

设计上，两段的候选/入池数之和应恰等于全窗口锚点（同一份样本派生被窗口切成两半，
且两窗口无交集、并集 = Dataset v5 全窗）。

| 量 | OBSERVATION（2019-01-01..2023-12-31） | HOLDOUT（2024-01-01..2026-09-04） | 两段之和 | 全窗口锚点 | 守恒 |
| --- | --- | --- | --- | --- | --- |
| candidateCount | 43156 | 29847 | **73003** | 73003 | ✅ |
| eligibleCount | 41204 | 29032 | **70236** | 70236 | ✅ |

- Dataset v5 声明：`startDate = 2019-01-01`、`endDate = 2026-09-04`、`totalEvents = 73003`。
  ⚠️ 任务书草案写「数据末端 2026-09-25」，与实查不符 ⇒ 本轮 HOLDOUT 上界取 **2026-09-04**。
- 参与守恒的量取自各 Run `customPayload.sampleAccounting`；全窗口锚点取自 `referenceCheck.referenceCandidateCount / referenceEligibleCount`。

### 7.1 剔除原因分布

| 原因 | OBSERVATION | HOLDOUT |
| --- | --- | --- |
| ENTRY_UNFILLABLE | 431 | 295 |
| MISSING_FACTOR | 2 | 5 |
| MISSING_FACTOR_PATH | 240 | 164 |
| MISSING_FORWARD_PATH | 145 | 79 |
| MISSING_PREFIX_PATH | 1134 | 269 |
| NO_EXECUTABLE_EXIT | 0 | 3 |

## 8. 与选择段（OBSERVATION）的对照

OBSERVATION 段**不是**独立样本，它只是冻结口径的载体；这里列出来是为了看「验证段是否塌掉」。

| 档位 | OBS FIXED 超额 | OBS 判定 | HOLDOUT FIXED 超额 | HOLDOUT 判定 | 落差（验证 − 选择） |
| --- | --- | --- | --- | --- | --- |
| N3 | +0.3730% | POSITIVE | +0.4090% | POSITIVE | +0.0360% |
| N5 | +0.4217% | POSITIVE | +0.4898% | POSITIVE | +0.0681% |
| N10 | +0.3798% | POSITIVE | +0.3061% | POSITIVE | -0.0737% |
| N20 | +0.2326% | POSITIVE | +0.1906% | POSITIVE | -0.0420% |

选择段日数 1204（FIXED 920），验证段日数 649（FIXED 591）。

## 9. 多重比较与 α 控制

- 主判定只用 3F 四档，α = 0.05，每个档位 1 次比较；
- 3F/HOLDOUT 信封共 29 行带判定 ⇒ 若全部当独立检验，α=0.05 下假阳性期望 ≈ 1.45 ⇒ 除主判据外的所有行只能声明为**探索性**；
- 4F-EQ / 12F-EQ 的对照按 §五 纪律**降级为描述性**；
- ⚠️ **纪律修正（如实登记）**：§五 允许「判 `4F-EQ` 时用 Bonferroni α=0.025」，但模板的 CI 固定为 **95%**，信封里不存在 97.5% 端点 ⇒
  在不重跑实验的前提下，`4F-EQ` 的**确认性**判定**无法从本信封算出**。因此本报告对 4F-EQ 一律只作描述性对照，这不是选择而是必要条件。

## 10. 平台 confirmatoryGate 的边界（必须知道）

3F/HOLDOUT 的 `confirmatoryGate` 实测 = **INSUFFICIENT**；逐项 check：

| code | 状态 | value | threshold |
| --- | --- | --- | --- |
| `evaluation_window_applied` | PASS | — | — |
| `fixed_day_sample_sufficiency` | PASS | 591 | 100 |
| `condition_1_pos_at_least_3_of_4` | PASS | 4 | 3 |
| `condition_2_n3_or_n5_positive` | PASS | 3 | 1 |
| `condition_3_beats_12f_equal_weight` | INSUFFICIENT | — | 2 |

- 条件 3（优于 12F-EQ 同档）在 Gate 里被如实标为 `INSUFFICIENT`，因为 `run()` 的 `ExperimentRunContext` **没有跨 Run 读口**；
- ⇒ **Gate ≠ 最终裁定**：Gate 只能判定条件 1/2（以及窗口与样本充分性），条件 3 由本文件（§3.1）承担。
  本报告 §3 的裁定才是完整的三条判定。

## 11. 限制（不得外推的结论）

1. **不是干净 OOS**：3F 的成员是在全窗口可见的前提下选出来的，验证段仍可能被「成员选择」间接看过（准 OOS）。
2. **年度切片口径不可比**：固定 `OWN`，各年日数不同（见 §4 警告）。
3. **跨 Run 对照无 CI**：3F 与 12F-EQ/4F-EQ 的差值只是两个点估计之差，**没有差值 CI**，不能声称显著。
4. **条件 3 的阈值是人为的**（≥2/3），不是统计检验。
5. **`EQUAL` 与 `CUSTOM` 浮点路径不同**，本报告结论不外推到加权版。
6. **模板不给档位间差值 CI**，故「N5 比 N3 好」这类话在本轮**不允许**出现。
7. 验证段含 2026 年**不完整年**（至 09-04），§4 已单列；不得因不完整而删除年份（§八 停止条件）。
8. **判定在 CI 边缘不稳健**：§2.3 已给出「同一样本、同一点估计、仅种子不同 ⇒ 判定翻转」的实测例；
   因此「N3 / N5 / N10 / N20 档 POSITIVE」这句话只应理解为**在本次种子下**成立。

## 12. 复现与回校

- 生成器：`_oos_report.mjs`（仓外，一次性）；
- 独立回校：`_oos_verify.mjs` —— 重新解析 6 个 JSON 并解析本 md 的表格，逐格比对；
- 运行脚手架：`oos_run.mts`（`--mode facts|in-flight|run|dump`）；
- 复现命令（每方案一个进程）：

```bash
node node_modules/tsx/dist/cli.mjs oos_run.mts --mode run --preset 3F    --phase OBSERVATION
node node_modules/tsx/dist/cli.mjs oos_run.mts --mode run --preset 3F    --phase HOLDOUT --parent RUN-20260925-220C7F89
node node_modules/tsx/dist/cli.mjs oos_run.mts --mode run --preset 4F-EQ --phase OBSERVATION
node node_modules/tsx/dist/cli.mjs oos_run.mts --mode run --preset 4F-EQ --phase HOLDOUT --parent RUN-20260925-76FC74F4
node node_modules/tsx/dist/cli.mjs oos_run.mts --mode run --preset 12F-EQ --phase OBSERVATION
node node_modules/tsx/dist/cli.mjs oos_run.mts --mode run --preset 12F-EQ --phase HOLDOUT --parent RUN-20260925-001BDF48
```

## 13. 附录

### 13.1 三方案同档对照（验证段 `FIXED`）

| 档位 | 3F | 4F-EQ | 12F-EQ | 3F−4F | 3F−12F |
| --- | --- | --- | --- | --- | --- |
| N3 | +0.4090% | +0.2547% | -0.0355% | +0.1543% | +0.4446% |
| N5 | +0.4898% | +0.3576% | -0.0686% | +0.1322% | +0.5584% |
| N10 | +0.3061% | +0.3705% | +0.0058% | -0.0644% | +0.3003% |
| N20 | +0.1906% | +0.2863% | +0.0826% | -0.0957% | +0.1080% |

### 13.2 三方案同档对照（选择段 `FIXED`）

| 档位 | 3F | 4F-EQ | 12F-EQ | 3F−12F |
| --- | --- | --- | --- | --- |
| N3 | +0.3730% | +0.4799% | +0.0328% | +0.3402% |
| N5 | +0.4217% | +0.3728% | +0.0958% | +0.3259% |
| N10 | +0.3798% | +0.4338% | +0.0815% | +0.2983% |
| N20 | +0.2326% | +0.1971% | +0.1124% | +0.1202% |

### 13.3 共享坐标（三个 Run 必须逐字段一致，机械断言见 `_oos_verify.mjs`）

| 坐标 | 值 |
| --- | --- |
| entryDay | `6` |
| exitRelativeDay | `10` |
| roundTripCostBps | `20` |
| decisionOffsetDays | `5` |
| informationCutoffRelativeDay | `5` |
| observationRelativeDays | `[1,2,3,4,5]` |

排序键：`{"key":"composite","direction":"HIGH","topNSizes":[3,5,10,20],"dayScopes":["OWN","FIXED"],"fixedDayMinSize":20,"minDayCount":100,"unit":"决策日 = 首板日 T（信息截止 T+5 收盘）"}`

标准化：`BUCKET_POSITIONAL` / 桶契约 `FROZEN-BUCKET-CONTRACT-001` / 桶指纹 `fnv1a32:4eae4835`

### 13.4 产物清单（验证段 3F）

- `RUN-20260925-76FA1DCC/result.json`（645027 B，present=true）
- `RUN-20260925-76FA1DCC/tables/composite/trades-n3-own.csv.gz`（69829 B，present=true）
- `RUN-20260925-76FA1DCC/tables/composite/daily-n3-own.csv.gz`（7873 B，present=true）
- `RUN-20260925-76FA1DCC/tables/composite/trades-n5-own.csv.gz`（113607 B，present=true）
- `RUN-20260925-76FA1DCC/tables/composite/daily-n5-own.csv.gz`（7891 B，present=true）
- `RUN-20260925-76FA1DCC/tables/composite/trades-n10-own.csv.gz`（221351 B，present=true）
- `RUN-20260925-76FA1DCC/tables/composite/daily-n10-own.csv.gz`（7821 B，present=true）
- `RUN-20260925-76FA1DCC/tables/composite/trades-n20-own.csv.gz`（399547 B，present=true）
- `RUN-20260925-76FA1DCC/tables/composite/daily-n20-own.csv.gz`（7181 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T1_OPEN-2024.csv.gz`（5597918 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T2_OPEN-2024.csv.gz`（5783105 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T3_OPEN-2024.csv.gz`（5624662 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T4_OPEN-2024.csv.gz`（5447444 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T5_OPEN-2024.csv.gz`（5196197 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T6_OPEN-2024.csv.gz`（4950391 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-DYNAMIC_PULLBACK_V1-2024.csv.gz`（3163743 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T1_OPEN-2025.csv.gz`（5559401 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T2_OPEN-2025.csv.gz`（5529157 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T3_OPEN-2025.csv.gz`（5398355 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T4_OPEN-2025.csv.gz`（5182849 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T5_OPEN-2025.csv.gz`（4964106 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T6_OPEN-2025.csv.gz`（4713287 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-DYNAMIC_PULLBACK_V1-2025.csv.gz`（3282191 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T1_OPEN-2026.csv.gz`（4993820 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T2_OPEN-2026.csv.gz`（4895235 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T3_OPEN-2026.csv.gz`（4710153 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T4_OPEN-2026.csv.gz`（4478295 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T5_OPEN-2026.csv.gz`（4261435 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-FIXED_T6_OPEN-2026.csv.gz`（4026602 B，present=true）
- `RUN-20260925-76FA1DCC/tables/foundation/panel-DYNAMIC_PULLBACK_V1-2026.csv.gz`（2745065 B，present=true）
- `RUN-20260925-76FA1DCC/logs/run.log`（553 B，present=true）

### 13.5 主 Run 的 disclosures（逐字）

- 🔴 持仓重叠：持有期 T+6 开盘 → T+10 收盘（5 个交易日），相邻决策日的持仓**互相重叠** ⇒ 「日度序列」不是独立观测。置信区间用日期聚类 Moving-Block Bootstrap（block = 20 交易日）吸收这一点，但**不得**把 N 个决策日当作 N 个独立实验。
- 🔴 等权口径：组合日收益 = 当日 Top-N 的**等权**平均；主指标 = 各日组合收益的**等权**平均（每个决策日一单位资金）。复利只用于「累计收益 / 最大回撤」的定义，不是实盘资金曲线。
- 🔴 基准 = 当日池：配对基准是同一天**全部可排名样本**的等权均值。随机抽 N 个的**期望**恒等于该值 ⇒ 「正超额」等价于「平均意义上优于随机抽签」，**不是**跑赢指数。
- ⚠️ 日集口径：`OWN` 下各档只纳入「当日可用样本 ≥ 该档 N」的日子 ⇒ **不同 N 的日集不同**，跨 N 的深度比较必须读 `FIXED`（统一门槛 = 最大档 N）。
- ⚠️ 决策日 = 首板日 T（决策发生在 T+5 收盘）。同一天可能有多个首板事件，因此「每天挑前 N 名」就是「在每个 T 的横截面按合成分排序取头部」。
- ⚠️ 方向来自 FROZEN-BUCKET-CONTRACT-001 的方向表，**不在组合里重估**（`assertMemberDirections` 强制）；其中 3 个因子的方向属「先验未验证」，合计占 3/12 权重。
- ⚠️ 标准化方法：冻结桶位分 (idx+0.5)/k（FROZEN-BUCKET-CONTRACT-001 §3.1）。方法一旦更换即等于更换排序键，结果不可与旧 Run 混引。
- ⚠️ Bootstrap 种子为**稳定哈希**（`hash.ts`，按 `契约|档位|日集|用途` 计算）⇒ 与既有 Top-N 实验的游标式种子不同，**CI 端点不会逐位相同**；但点估计（组合均值 / 基准均值 / 超额均值 / 笔数 / 胜率 / 日胜率）与种子无关，可与既有实验逐位对拍。
- ⚠️ 多重比较：本次共 29 个带判定的行，α=0.05 下假阳性期望 ≈ 1.5 ⇒ 所有结论只能声明为**探索性**。
- 🔴 本 Run 是平台协议 Run（HOLDOUT，协议指纹 protocol-sha256:56471b14de27243cb355a03b50c85d2ec5d29fe7a914f797d2c71d12487db8e8），评估窗口 [2024-01-01..2026-09-04]。窗口由**取数层**施加（`datasetPort` 的 `fromDate/toDate`），实验内不做二次过滤 ⇒ 窗口内事件集合与全窗口 Run 的同名统计**不可逐格对拍**。
- 🔴 组合分是加权和，三条已知缺陷在本版依然存在：① 因子互相掩蔽；② 分数区间被压缩；③ 阈值卡在合成分上时改动无法归因 ⇒ 本版只做描述性统计，不做任何归因。

（其余 Run 的 disclosures 除窗口、指纹、行数外与之同构，逐字见各自 `result.json`。）

### 13.6 失败 / 非 COMPLETED Run 登记（从 DB 机械读取，**不隐藏**）

本实验族共产生 7 条 Run 行，其中非 COMPLETED 的有 1 条：

| runId | 方案 | 阶段 | 状态 | errorCode | errorMessage 长度 | 窗口 |
| --- | --- | --- | --- | --- | --- | --- |
| `RUN-20260925-94B822B7` | composite-factor-12f-equal-weight-oos-study | OBSERVATION | FAILED | `EXPERIMENT_RUN_FAILED` | 48464 字符 | 2018-12-31T16:00:00.000Z .. 2023-12-30T16:00:00.000Z |

- `RUN-20260925-94B822B7`：信封只留下**失败 SQL 原文**（48464 字符，前 160 字符：`Failed query: select `datasetVersionId`, `eventId`, `relativeDay`, `symbol`, `tradeDate`, `open`, `high`, `low`, `close`, `volume`, `limitUpPrice`, `barPresent`…`），**没有携带根因**（无 `ETIMEDOUT` / `ECONNRESET` 之类）。

判定为**跨境取数瞬时失败**的依据：
1. 三个方案共享同一份样本派生，对同一 Dataset v5、同一窗口发出**同一条** `ds_first_limit_pullback_post` 查询，
   3F 与 4F-EQ 在同一窗口上连续成功 ⇒ 查询形状本身合法；
2. 失败发生在**取数阶段**，与因子数无关（12 个成员并不改变该查询）；
3. 重跑同一 `experimentId` + 同一窗口**成功**（见 §1.2 的 12F-EQ 行）。

⚠️ 该失败 **不占** HOLDOUT 配额：`EXPERIMENT_PROTOCOL_PHASE_CONFLICT` 只统计**同协议指纹下 `researchPhase === "HOLDOUT"`** 的行
（`runService.ts:393-407`），失败的 OBSERVATION 行不影响后续 HOLDOUT。

### 13.7 生成环境

- 数据集：`first_limit_pullback` v5（`datasetVersionId = 660001`）
- 坐标：入 T+6 开盘 / 出 T+10 收盘 / 往返成本 20 bps / 信息截止 T+5 收盘 / 观察窗 T+1..T+5
- 日集：`OWN` 与 `FIXED`（统一门槛 = 最大档 20）
- 判定门槛：每个日集最少 `100` 个决策日

