# PLAN-EXIT-POLICY-001 — `9cq` 退出政策参数实验（🔴 **已作废 · 未执行 · 四臂全部重复**）

> # 🔴 §-1 作废声明（2026-10-07 · **用户已授权执行，但侦察后被我主动中止**）
>
> **用户授权了「授权跑」。我在第 1 步门禁（读 `server/strategyCore/**` 与既有实验）时发现：
> 本方案的四臂全部与既有实验重叠，且既有实验已给出确定结论。因此我没有执行，也没有发任何新 Run。**
>
> ## 证据：`research_experiment_run` 里已有 **162 条 Run / 约 50 个实验**
>
> 其中 t74 家族 = **12 个实验 / 16 条 Run**（P0–P10 + carryover/refresh）：
>
> | 我的臂 | 既有实验 | 状态 | 既有结论 |
> |---|---|---|---|
> | **A** 基准复现 | 每个实验内置的「控制臂 parity（对齐 `composite-runner-newhigh3-t74` 留档）」 | ✅ 已有 | 控制 A `15.7876907121%` / 控制 C `151.0958341843399%` —— **连常量都写死在实验里** |
> | **B** T+5 截断（禁用 Runner） | 同上「控制臂 A」 | ✅ 已有 | 无 Runner = **15.7877%** / 1619 笔 |
> | **C** 延长 Runner | **`composite-runner-newhigh3-hold20`**（3 条 Run）· 另有 `…-runner-hold20@1.0.0` 留档 | ✅ 已跑 | `hold20` 留档 **+129.69%**（1453 笔，ds 750001）vs t74 **+151.10%** ⇒ **延长更差**（⚠️ ds 不同，非严格同基） |
> | **D** 止损放宽 −8% | **`composite-runner-newhigh3-t74-stopwide`**（`p3-stopwide`） | ✅ **已跑真实 Run** | 🔴 **8/10/12% 全部更差**：151.10% → **64.64 / 76.53 / 45.13%**，且回撤**更大** 43.30% → 49.88 / 45.88 / 47.02%（见 `CHANGE-AUDIT.md:1941-1962`，Run `RUN-20261004-670F0677`） |
>
> **另有两处方法学重叠**：
> - 我设计的「ABORT parity 门禁」**就是该项目的既有范式**（每个实验都有控制臂 parity）。
> - 退出视界本身也已被研究过：**`entry-aligned-exit-horizon-study`（9 条 Run）** ·
>   `threshold-race-policy-study`（3）· `conditional-pullback-state-exit-study`（2）·
>   `hold-streak-amplitude-t10-study` · `limit-up-close-hold-study` · `limit-up-price-hold-streak-study`。
>
> ## 既有程序自己的合并结论（`CHANGE-AUDIT.md:1957`）
>
> > 「这条链上**没有免费降回撤的旋钮** —— 换排序（−166~−228pp）、多买（DD 43→45~56%）、
> > 扩大止损（DD 43→46~50%）全部更差。
> > ⇒ 降回撤只能走**降低暴露**（每笔仓位比例 ↓ / 保留现金）或**组合层择时**（大盘状态 / 净值回撤熔断），
> > 两者均属「收益-回撤」取舍。」
>
> ## 我的过程缺陷（如实登记）
>
> **我写了一份完整的预注册方案，却没有先查既有实验清单。** 这恰好是用户第一条消息里抱怨的
> 「广度优先堆叠、零垃圾回收」的熵 —— 我差点往一个已有 **162 条 Run** 的程序里再加 4 条冗余 Run。
>
> **⇒ 固化为规则（见 §-2）：任何新实验方案，第一步必须查 `research_experiment_run` + `closed_loop_backtest_run` 的既有清单。**
>
> ## §-2 新增前置门禁（本方案产出的最有价值的东西）
>
> **写任何 `PLAN-*.md` 之前，必须先完成「既有资产清查」并写入方案：**
>
> | 清查项 | 命令/位置 |
> |---|---|
> | 既有实验 Run | `SELECT experimentId, COUNT(*) FROM research_experiment_run GROUP BY experimentId` |
> | 既有闭环 Run | `SELECT strategyId, strategyVersion FROM closed_loop_backtest_run` |
> | 既有实验定义 | `research-experiments/**/experiment.ts`（含 `tags` 里的 P 编号） |
> | 既有结论 | `CHANGE-AUDIT.md` 里对应的 `TASK-ID` 条目 |
>
> **若目标问题已被既有实验回答 ⇒ 不得新建实验，只登记「已答」并给出结论出处。**
>
> ## §-3 真正未被执行的杠杆（本方案的重定向结论）
>
> 按既有程序自己的说法，只剩两条**未被执行**的路：
> 1. **降低暴露**：每笔仓位比例 ↓ / 保留现金（**Note：`maxPositionAmountRatio` 已存在于 `Portfolio` 构造参数**）
> 2. **组合层择时**：大盘状态 gate / 净值回撤熔断
>
> ⇒ **`9cq` 的编号保留，但内容应改为上述两条之一**；具体方案需重新预注册（且必须带 §-2 清查）。

---

## 以下为**原方案（未执行 · 已被判定重复）**，保留作证据

> 状态：**未执行**。未发任何新 StrategyVersion、未跑任何新 Run、未改代码。
> 任务号：`ROADMAP` §44.5 **`9cq`**（`9cp` 的唯一后继）。
> 证据基础：[`RESULT-151PCT-ATTRIBUTION-001`](RESULT-151PCT-ATTRIBUTION-001.md)（**Runner = 151.10pp 的 89.5%**；去掉只剩 +15.79%）
> · [`RESULT-151PCT-WINNER-CONCENTRATION-001`](RESULT-151PCT-WINNER-CONCENTRATION-001.md) · [`RESULT-TAIL-EXPLORE-001`](RESULT-TAIL-EXPLORE-001.md) · [`IMPACT-NETPNL-SIGN-001`](IMPACT-NETPNL-SIGN-001.md)（口径 `cash-v2`）

---

## 0. 要回答的唯一问题

> **Runner 的「延长幅度」与「止损阈值」这两个已量化的一阶杠杆，各自的最优区间在哪？**

已知（`RESULT-151PCT-ATTRIBUTION-001` §1.5，平台自带受控消融）：

| 量 | 值 |
|---|---:|
| 无 Runner（`1.62.1`） | **+15.7877%** |
| 有 Runner（`2.0.0`） | **+151.0958%** |
| `directPnlIncrement`（延长的直接 P&L） | **+250,337.01** |
| `capitalCycleResidual`（**占用仓位的代价**） | **−115,028.87** |
| ⇒ 净额 | **+135,308.14** |
| `extraHoldingDays` total / mean / median | 960 / 5.96 / 4 |
| 止损 | 579 笔、**−86,256**、中位 −6.047% |
| 容量 | `1863 × 5 ÷ 6.5 ≈ 1,433 ≈ 实际 1,434 笔` ⇒ **饱和** |

**⇒ 消融已做过，不重复。本实验只做参数级。**

## 1. 事前固定口径（**事后不改**）

| 项 | 值 |
|---|---|
| Dataset | `datasetVersionId = 780001`（唯一） |
| 窗口 | `2019-01-01 .. 2026-09-04`（与基准 run 一致） |
| 初始资金 | `100,000` |
| 成本模型 | 佣金 2.5bp · 印花 5bp · 过户 0.1bp · 滑点 5bp · lot 100 · minCommission 5（**与基准逐项一致**） |
| 执行模型 | `NEXT_OPEN`，`blockLimitUpBuys = true`（`BACKTEST_EXECUTION_POLICY_VERSION = 2`） |
| 指标出口 | `canonicalMetrics()`（I-8）· 口径 **`cash-v2`** |
| 选股 | **冻结不动**（3F `topN=3`）—— 本实验**只放开退出参数**，这是唯一自变量 |

## 2. 四臂（**预注册 · 不做网格**）

| 臂 | 相对基准的唯一改动 | 想测什么 |
|---|---|---|
| **A · 基准** | 无（现状 `2.0.0`：基础持有 5 日 + Runner 延长至 11 日 + 止损 −6% + MA 趋势止盈） | **复现**（同时是 ABORT 门禁，见 §4） |
| **B · T+5 截断** | **禁用 Runner 延长**（等价 `1.62.1` 行为） | 对照锚点，验证 §1.5 的 15.79% |
| **C · 延长至 16 日** | Runner 延长上限 11 → **16** 交易日 | 延长幅度的**边际收益 vs 容量代价** |
| **D · 止损放宽至 −8%** | 止损阈值 −6% → **−8%**（其余全同） | 止损这一阶杠杆的方向与量级 |

**每臂必报（缺一不可）**：

| 指标 | 为什么必需 |
|---|---|
| `totalReturnPct` / `cagrPct` | 主判据 |
| `maxDrawdownPct` | Runner 会同时抬高回撤（基准失败臂显示 −11.5pp 差） |
| 🔴 `runner.capitalCycleResidual` | **延长的隐性价格**；只报 `directPnlIncrement` 会系统性高估 |
| 🔴 `runner.directPnlIncrement` / `extraHoldingDaysTotal` | 机制项，与上项配对 |
| `top10SharePct` | 集中度（基准已是 438.7% 量级，须防「靠更极端集中换收益」） |
| `tradeCount` / `turnover` / `cost` | 容量与成本审计 |
| OOS 段（`2025-01-01..`）`totalReturnPct` | 样本外一致性 |

## 3. 事前判据（**事后不改**）

| 观察 | 判定 |
|---|---|
| 基线臂 A **未复现** +151.0958%（容差见 §4） | 🔴 **HARNESS/DIGEST 异常 ⇒ 全部作废**，先查 I-10 是否被破坏 |
| C 优于 A，且 `capitalCycleResidual` 恶化幅度 **小于** `directPnlIncrement` 的增幅 | ✅ 延长有正边际 ⇒ 继续沿该方向细分 |
| C 优于 A，但净额增益 **≥ 80% 来自单一交易** | ⚠️ **不可采信为「参数更优」**，须报集中度并视为个案 |
| D 优于 A | ✅ 止损放宽更优（但那意味着基准的 −6% 过紧） |
| 任一臂 `maxDrawdownPct` 恶化 **> 15pp** 或 `top10SharePct` 上升 **> 100pp** | ⚠️ 该臂的收益改善**不可用**（靠风险换来的），如实登记 |
| B 未复现 `1.62.1` 的 +15.79%（容差内） | 🔴 对照锚点失效 ⇒ 停 |

## 4. 🔴 ABORT 条件

1. **复现门禁**：臂 A（零改动的 `2.0.0`）必须复现 `totalReturnPct = 151.0958341843399`（浮点容差 `1e-6`）
   **且 `chainFingerprint` / `tradeDigest` / `equityDigest` 与 run `6210006` 一致**（I-10）。
   **不一致 ⇒ 立即停止**，不得解读任何其他臂。
2. `datasetVersionId = 780001` 不可读或被改动 ⇒ 停止。
3. 成本模型任一项与 §1 不符 ⇒ 停止（成本不同则不可比）。

## 5. 不变量与红线

- ❌ **不改选股**（3F 冻结桶边界 / 方向表 / 权重 / `topN`）—— `FROZEN-BUCKET-CONTRACT-001`。
- ❌ **不改数据集**、不改窗口、不改成本模型、不改执行政策。
- ❌ **不做网格/自动搜索**（4 臂即止）。**不得**在看过结果后再加臂（那就是参数搜索）。
- ❌ **不用单笔均值下结论** —— `RESULT-151PCT-ATTRIBUTION-001` §3 已证它会给出**方向相反**的错觉。
- ❌ **不接线** `threeFactorContinuousScoreFeatures.ts`。
- ✅ 每个臂 = **一次** `applyDefinitionChange()` → 新 StrategyVersion（AGENTS.md **I-5**），
  因为 `runtimeOverrides` 白名单只有 `initialCapital / costModel / executionModel`
  ⇒ **退出参数不在 override 范围内，必须走版本化**，不得用运行时覆盖绕过。
- ✅ 新 Run 一律**新增**，**不修改/不删除** run `6210006`（AGENTS.md §5）。

## 6. 执行顺序（**授权后**）

1. 读 `server/strategyCore/**` 确认 3F top-3 runner 策略文档里**退出规则的可参数化点**
   （Runner 延长上限、止损阈值），确认它们是 `TUNABLE` 而非硬编码；若硬编码，**先报告再决定**。
2. 臂 A：**零改动复现** → 过 §4 门禁（**不过就停**）。
3. 臂 B/C/D：各自 `applyDefinitionChange()` → 新版本 → 各跑 **1 次** Run。
4. 出 §2 的完整指标表（**含 `capitalCycleResidual`**）→ 对照 §3 判据 → 写 RESULT + CHANGE-AUDIT。

## 7. 明确不做

- ❌ 不重做 Runner 消融（已由 `evaluationDetail` 提供，§1.5）。
- ❌ 不调选股、不调数据集、不做 OOS 挑参。
- ❌ 不因某臂更优就直接改生产策略（须过 §3 全部判据 + 集中度/回撤检查）。
- ❌ 不在本实验里顺带做 WFA / Robustness（那是独立阶段）。

## 8. 授权与影响（**执行前必须确认**）

| 项 | 内容 |
|---|---|
| **DB 影响** | 新增 **3~4 条** `closed_loop_backtest_run`（+ 对应 StrategyVersion 行）。**无 DDL、无 migration、无历史修改** |
| **契约影响** | 新增 **3 个** StrategyVersion（I-5 流程）。**不改任何既有契约** |
| **执行链影响** | 无（复用现成 simulator 路径） |
| **算力** | 每次 Run 覆盖 2019–2026 全窗、ds 780001 ⇒ 与 run `6210006` 同量级 |
| **不可逆性** | Run 只增不改 ⇒ **可回退**（按 `runId` 区分，不参与任何生产默认） |
| **需要用户明确授权** | ✅ **是** —— 这是本仓库「生成持久化 Run」的操作，`9cp` 的只读授权**不覆盖**它 |
