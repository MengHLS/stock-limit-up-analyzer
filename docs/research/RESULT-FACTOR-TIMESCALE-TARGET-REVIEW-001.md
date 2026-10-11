# RESULT-FACTOR-TIMESCALE-TARGET-REVIEW-001 · Target 口径复核

> **任务**：只做「Target 口径复核」，不重新构建数据集、不重新选择 12 个因子、不做无关审计。
> **重点**：复核 `RESULT-FACTOR-TIMESCALE-TOPN-001` 与 `RESULT-MEDIUM-REAL-001` 的 observation window、entry/target 定义、持有期，以及 target 是否与因子观察窗口发生机械重叠/信息泄漏；对照 `EVENT-OVERLAP-CLUSTER-001` 的结论判定 `VALID` / `PARTIALLY_AFFECTED` / `NEEDS_TARGET_RE-RUN`。
> **数据坐标**：`datasetVersionId = 780004`（`first_limit_pullback` · `v10-listed365-pre10-post80` · `READY`）。
> **基线 HEAD**：`f8b6810`。
> 🔴 **本轮零数据库写入 · 零业务代码改动 · 未重跑任何实验/策略/数据集**。全部为只读文档/代码复核。

---

## 1. 任务与范围

只复核下列两项：

1. `RESULT-FACTOR-TIMESCALE-TOPN-001`（SHORT T+1~T+5 / MEDIUM T+6~T+20 / LONG T+21~T+60 三组横截面 TopN 排名验证）
2. `RESULT-MEDIUM-REAL-001`（MEDIUM 真实净值，T+6~T+20）

以及与 `RESULT-EVENT-OVERLAP-CLUSTER-001` 的结论对照。不做其它任何审计。

---

## 2. 实验口径复核

### 2.1 `RESULT-FACTOR-TIMESCALE-TOPN-001`

| 项 | 内容 | 来源 |
|---|---|---|
| Dataset | `780004` / `v10-listed365-pre10-post80` / `READY` | 文档 §1 |
| 面板 | 决策日 1,627 · 候选 57,612 | 文档 §1 |
| 因子 | 12 个冻结因子（定义/分桶/orientation 全部未修改） | 文档 §1 |
| **Observation window（因子侧）** | 全部 12 个因子取自 `prefix`（rd−10..rd0）+ `event` 静态字段，**不含任何 `post` rd≥1 的 bar** | 上游 `derive.ts` 逐字复核（`RESULT-FACTOR-TIMESCALE-001` §2 表格） |
| **决策时点** | T+5 收盘 | 平台实验定义 `first-board-pullback/twelve-factor-topn-ranking-study/experiment.ts` L41 |
| **入场** | T+6 开盘 | 同上 |
| **持有期** | T+6 开盘 → T+10 收盘（5 个交易日），不可卖则顺延至 T+20 | 同上 |
| **Target `holdRet`** | `close(W 末日)/open(W 首日) − 1 − 20bps`，W = 目标窗口 | 文档 §1.2 |
| **Target `maxRet`** | `max(high in W)/open(W 首日) − 1`，未扣费 | 文档 §1.2 |
| 目标窗口 W | SHORT = T+1~T+5 · MEDIUM = T+6~T+20 · LONG = T+21~T+60 | 文档 §1.1 |
| 显著性 | date-cluster moving-block bootstrap（block=20，1000 次）95% CI | 文档 §1 |

**机械重叠判定**：因子观察窗（rd≤0）与 target 窗口（SHORT 从 rd1 起 / MEDIUM 从 rd6 起 / LONG 从 rd21 起）**完全不相交**。12 个冻结因子全部来自 `prefix` 与 `event`，未读任何 `post` rd≥1 的 bar ⇒ **与三组 target 均无机械重叠、无信息泄漏**。

**事件依赖统计**：文档已明确使用 `date-cluster moving-block bootstrap`（block=20）——与 `EVENT-OVERLAP-CLUSTER-001` §8 建议 2「区间估计一律走 `movingBlockBootstrapMean`」一致 ✅。

**判定**：`VALID`

---

### 2.2 `RESULT-MEDIUM-REAL-001`

| 项 | 内容 | 来源 |
|---|---|---|
| Dataset | `780004` | 文档 §1 |
| 候选 / 决策日 | 58,707 / 1,627 | 文档 §1.3 |
| 因子 | MEDIUM 六因子（`limitGap`/`turnover`/`amountPercentile`/`preReturn10`/`historyLimitCount`/`bodyHeight`），定义/分桶/orientation 全部冻结 | 文档 §1 |
| **Observation window（因子侧）** | 同 §2.1，六因子全部来自 `prefix` + `event`，**不依赖 rd1..5 bar** | 文档 §1.3 已披露 |
| **持有窗口** | rd6 `open` → rd20 `close`（15 个交易日） | 文档 §1 口径映射表 |
| **Target** | 真实净值（CAGR / Sharpe / MDD / PF / totalReturn / winRate），非 `holdRet`/`maxRet` 窗口收益 | 文档 §2 |
| **入场/出场** | rd6 open 入场 · rd20 close 出场，不可卖顺延至 rd80 | `scripts/_scratch/medium.cjs` L22-25, L110-121 |
| `MAX_CONC` | 主口径 75（= 5 × 15，规则一致）；字面 200 作稳健性对照 | 文档 §1.2 |
| 中性基准 | 同宽度 NB-Random-5，100 种子 | 文档 §3 |

**机械重叠判定**：六因子观察窗（rd≤0）与持有窗口（rd6~rd20）**完全不相交**。文档 §1.3 明确「6 因子均不依赖 rd1..5 bar」⇒ **与 target 无机械重叠、无信息泄漏**。

**事件依赖统计**：文档使用真实净值引擎（含资金循环、持仓重叠由 `MAX_CONC` 显式控制），NB-Random 基准 100 种子报告 p05/p95 分位——属于**独立随机化对照**，不依赖 `sd/√n` ⇒ 与 `EVENT-OVERLAP-CLUSTER-001` 的依赖结构要求兼容。

**判定**：`VALID`

---

## 3. 对照 `EVENT-OVERLAP-CLUSTER-001` 的结论

`EVENT-OVERLAP-CLUSTER-001` 的核心方法学发现是：**`r40`（事件收盘基准）与标记窗口 rd1–15 机械重叠，会产生伪失败路径；`t40`（rd16 open 可交易基准）才是忠实口径**。逐条对照本次两个实验：

| EVENT-OVERLAP-CLUSTER-001 要求 | RESULT-FACTOR-TIMESCALE-TOPN-001 | RESULT-MEDIUM-REAL-001 |
|---|---|---|
| ① **优先区分 event-close `r40` 与真实可交易 `t40`** | ✅ target `holdRet`/`maxRet` 均以 `open(W 首日)` 为基准，**是真实可交易入场价**，不是 event-close `r40` 口径 | ✅ rd6 `open` 入场，同样是**真实可交易入场价**，不是 event-close 口径 |
| ② **避免 observation path 与 outcome target 的机械重叠** | ✅ 12 因子全部 rd≤0（`prefix`+`event`），SHORT target 从 rd1 起 / MEDIUM rd6 起 / LONG rd21 起 ⇒ **零重叠** | ✅ 六因子 rd≤0，持有窗 rd6~rd20 ⇒ **零重叠** |
| ③ **事件依赖统计继续使用 date-cluster / moving-block bootstrap** | ✅ 已用 `date-cluster moving-block bootstrap`（block=20，1000 次） | ✅ NB-Random 100 种子独立随机化对照（不依赖 `sd/√n`） |

三条要求**全部满足**，未发现需要重跑的 target 口径问题。

---

## 4. 最终判定

| 实验 | 原 target | 是否与因子观察窗口重叠 | 是否需要重跑 | 最终处理决定 |
|---|---|---|---|---|
| `RESULT-FACTOR-TIMESCALE-TOPN-001`（SHORT/MEDIUM/LONG） | `holdRet` = close(W 末日)/open(W 首日) − 1 − 20bps；`maxRet` = max(high in W)/open(W 首日) − 1；W = T+1~5 / T+6~20 / T+21~60 | ❌ **无重叠**（因子全 rd≤0，target 从 rd1/rd6/rd21 起） | ❌ **不需要** | **`VALID`** —— 结果可继续用于短/中/长期时间尺度判断 |
| `RESULT-MEDIUM-REAL-001` | 真实净值（CAGR/Sharpe/MDD/PF/totalReturn），持有 rd6 open → rd20 close | ❌ **无重叠**（六因子全 rd≤0，不依赖 rd1..5 bar） | ❌ **不需要** | **`VALID`** —— 结果可继续用于中长期时间尺度判断 |

---

## 5. 最小重跑清单

**无。** 两个实验的 target 口径均未与因子观察窗口发生机械重叠，均未发现信息泄漏，事件依赖统计口径与 `EVENT-OVERLAP-CLUSTER-001` 的建议一致 ⇒ **无需任何重跑**。

---

## 6. 合规声明

- ✅ 未修改任何策略 / 未创建 Candidate / 未修改冻结因子定义 / 未改 Dataset
- ✅ 未重新构建 `780004`
- ✅ 未重跑全部 12 因子
- ✅ 零数据库写入（纯只读 `SELECT` + 文档/代码复核）
- ✅ 零业务 `.ts` 代码改动
- 本报告为时间尺度研究的 Target 口径复核阶段，**不再重复做同类审计**；下一步直接进入时间尺度研究下一阶段。
