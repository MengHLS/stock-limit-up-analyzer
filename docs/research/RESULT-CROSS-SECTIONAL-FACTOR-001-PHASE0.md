# RESULT-CROSS-SECTIONAL-FACTOR-001-PHASE0 · 最终口径裁定 + BLOCKED 状态

> 任务：`CROSS-SECTIONAL-FACTOR-001` Phase 0 —— **只做口径裁定 + 预注册落地，禁止真实 Run**
> 主文档：[PLAN-CROSS-SECTIONAL-FACTOR-001.md](PLAN-CROSS-SECTIONAL-FACTOR-001.md)（本轮追加 §8–§12）
> 基线：HEAD `f8b6810` · **本轮零真实 Run、零 Dataset/Schema 改动、零 Candidate/StrategyVersion、零历史 Run 改动**
> 🔴 非平台正式 Run（沙箱 `spawn EPERM`）；已完成的 OOS / Parameter Search / Strategy 模块**未重复审计**

---

## 1. 最终口径裁定

| # | 冲突 | **裁定** | 依据 |
|---|---|---|---|
| **C1** | 回踩日无 canonical 定义 | 🔴 **锚点固定 `T0 ≡ T+5` close**（= 既有 `decisionOffsetDays = 5`）；**真实回踩日降级为「决策时已知属性」**，仅用于分层，**不作分组日** | 见下方 §2 的 PIT 论证 |
| **C2** | `T+5` 上界 vs 「第 6 日」 | **不支持第 6 日回踩**；**不扩窗、不新建 Dataset/契约版本** | 锚点固定后该问题消解 |
| **C3** | 回踩参考基准三选一 | **首板日收盘** `close(T)`（与 Pass D 逐字一致，**非新定义**） | `derive.ts` L400-402 |
| **C4** | 4/12 因子与变 `T0` PIT 不相容 | **消解**：锚点固定 `T+5` + `T0_i` 降级为属性 ⇒ 两条硬要求**同时满足、无一违反** | 见 §2 |
| **C5** | 次新 4 定义冲突 | **采用 canonical #1**：374→**365 自然日 @ 事件日**（`filter.ts#isListingAgeExcluded` 口径） | 唯一有 shared 契约 + DB 列 + migration + 多链路复用者 |
| **C6** | 次新排除在取数面不可达 | **消解路径 = 构建期烘焙**（过滤写进 Dataset，**不改 Schema**）⇒ 但落入 §3 的数据集阻断 | 实查：event 表 27 列**无任何** `listed*/age/ipo` 列 |
| **C7** | `T+1` 语义 | **裁定为「持有长度」`N`**，不是 `rd` 偏移 | 见 §4 |

### 锚点主方案（**沿用既有门，零新定义**）

```
既有门（derive.ts Pass D，逐字复用）：
  hasObservationPullback = ∃ k ∈ [1,5] : close(T+k) < close(T) − ε     # 基准 = 首板日收盘
本实验锚点：
  信息锚点 = 分组日 = 决策日 = T+5 close
```

---

## 2. 🔴 PIT-safe 的实际 `T0` 能否派生？——**不能（作为锚点）；能（作为属性）**

| `T0` 的身份 | 能否 PIT-safe | 理由 |
|---|:---:|---|
| **信息锚点 / 横截面分组日** | ❌ **不能** | `F4 meanAmplitude` / `F5 maxAmplitude` / `F6 holdStreak` / `F10 drawdownDepth` 的冻结定义窗口 = **整个 `T+1..T+5`**（`CONTEXT_DAYS = 5`）。任取 `T0 = T+k (k<5)` ⇒ 这 4 个因子读到 `T0` **之后**的数据 ⇒ **look-ahead**，违反 **I-3 / I-4**。**这是定义层不相容，不是实现细节。** |
| **决策时已知属性**（分层变量） | ✅ **能，严格 PIT-safe** | `T+5` 收盘时整个 `[1,5]` 窗已完全已知 ⇒ `T0_i = min{ k ∈ [1,5] : close(T+k) < close(T) − ε }` **决策时可知**；且池 ≡ 门通过者 ⇒ 池内 **100% 有定义**。**它不是新定义，是既有布尔门的日化投影。** |

### 备选锚点 = 首板日 `T`：❌ **不可用（原因已记录）**

`T` 日仅 **6/12** 因子已知（F1/F2/F3/F8/F9/F12）· F7/F11 需 `T+1` · F4/F5/F6/F10 需 `T+1..T+5`
⇒ 锚在 `T` 将**无法计算 6/12 因子**，与「保留 12 因子定义」**直接冲突**。**仅登记，不采用。**

---

## 3. 🔴 是否解除 BLOCKED？

> # ❌ **仍 BLOCKED —— 唯一阻断项 = 数据集**

### 3.1 实查事实（只读探针，2026-10-08）

| `datasetVersionId` | `status` | 物理行 `event / prefix / post` | 窗口 | `excludeListedWithinDays` | `preWindowDays` | 可用 |
|---|---|---|---:|---:|---:|---:|---|
| **660001**（v5） | `READY` | **0 / 0 / 0** ❌ | — | `null` | 20 | ❌ **物理为空** |
| **780001**（v8） | `READY` | 73,003 / **73,003（仅 `rd=0`）** / 5,733,817 | 2019-01-02 ~ 2026-09-04 | **`null`** ❌ | **0** ❌ | ⚠️ **不充分** |
| 780002 | `READY` | 2,315 / 80,088 / 185,200 | 2019-01-02 ~ 2019-03-29 | 365 | 60 | ❌ 仅 3 个月，不满足年度切片 |
| 780003（v9） | **`FAILED`** | 70,071 / 3,548,239 / 4,716,480 | 2019-01-02 ~ 2026-09-04 | 365 | 60 | ❌ **指令排除** |

### 3.2 三条决定性事实

1. 🔴 **`660001` 的 `READY` 不可信** —— 四张物理表**全 0 行** ⇒ 「优先评估 660001」**被物理事实排除**。
2. 🔴 **全库只有 `{780001, 780002, 780003}` 有物理行** —— 其余 8 个 `READY` 版本（390001/390002/540002/570001/630001/690001/720001/750001）**全部物理为空** ⇒ **metadata 与物理大面积不一致（`BASELINE_DRIFT` 级）**。
3. 🔴 **`780001` 缺 prefix 窗**（`preWindowDays = 0` ⇒ prefix 仅 `rd=0`）⇒ **F9 `preReturn10`（= `close(−1)/close(−10) − 1`）不可计算** ⇒ 只能覆盖 **11/12 因子**；且**无上市龄过滤**。

⇒ **没有任何既有 `READY` 数据集能同时满足「12 因子可计算」+「上市龄过滤」**。
⇒ **唯一出路 = 新建一个数据集版本**（**本轮不执行、不自行重建**）。

---

## 4. 已落地的预注册内容（不依赖数据集裁定）

| 项 | 内容 |
|---|---|
| **因子 / 方向** | 仅冻结 12 因子；**`orientation` 逐字 import，不允许重找方向** |
| **执行坐标（裁定）** | 决策 `T+5` close · 入场 **`T+6` open** · 退出 `close(T+5+N)` · 顺延 ≤ +10 且 ≤ rd80 |
| **周期（裁定）** | **持有长度 `N ∈ {1, 5, 10, 20}`**。🔴 字面 `rd 1/5/10/20` **不可用**：`rd 1..5` 在决策窗内（是过去，且正是 F4/F5/F6/F10 的输入窗）⇒ 按字面读会「用因子自身窗口算收益」。✅ 自洽校验：`N=5` ⇒ 退出 `rd10` = 平台冻结主退出 **`T+10` close** |
| **档位** | `Top1` / `Top3` / `Top5` / `Top10` / `All` / `Bottom3` / **`Random3`** |
| **`Random3`** | **逐日无放回均匀 3 子集 × 200 固定种子**（复用 `pickUniformRandomSubset`）；**不是** tie-break `RAND`；不足 K 只 ⇒ **空组合占位行**，不静默丢弃 |
| **指标** | Rank IC · ICIR · IC 正日率 · Top−Bottom Spread · Top-K − All · Mean/Median/WinRate · ≥20%/≥50%/≥100% 命中率 · 年度切片；Bootstrap block=20 / 1000 次 |
| **禁止** | 阈值 / 权重 / 组合 / 参数搜索（全部不做） |

---

## 5. 排序分辨力（P3）仪器 —— 已就绪并**实测通过**

**新增最小必要框架代码**：`research-experiments/shared/singleFactor/rankResolution.ts`（**纯函数，零 I/O、零 Dataset 依赖**）
**测试**：`tests/server/researchExperiments/crossSectionalRankResolution.test.ts`（合成夹具）

**预注册阈值（先定后用，不得事后放宽）**：

```text
minDistinctCount = 5 · maxModalShareMedian = 0.5 · maxModalDominatedDayShare = 0.5 · minJaccardAscDesc = 0.9
任一命中 ⇒ TIE_BREAK_DOMINATED ⇒ 该因子不得进入任何排序类真实 Run
```

**验证**：沙箱无法运行 vitest（`spawn EPERM`）⇒ 以**等价可执行自检**（`scripts/_scratch/rankResolutionSelfCheck.cjs`）验证 ⇒ **21/21 PASS，exit 0**：
- 连续值 ⇒ `RESOLUTION_OK`（`distinctCountMedian 30` · `modalShareMedian 0.033` · `J(ASC,DESC) = 1`）
- 离散值（对齐 `holdStreak` 实况：distinct 中位 3、单值占比 0.833）⇒ **`TIE_BREAK_DOMINATED`**，四条理由**全部命中**

### 🔴 自检发现的新语义（已登记）

> **当一个交易日的候选值【全部并列】时，更换破平键会选出【完全不相交】的集合**（实测 `J(ASC,DESC) = 0`）。
> 这比原先记载的「换键换掉 ~43% 成员」**更严重** —— 在极端离散日，入选集合 **100% 由破平键决定**，与因子取值**完全无关**。
> 仪器已将该情形显式量化（`boundaryStraddleDayShare` / `modalDominatedDayShare`）。

### 既有 P3 结论**不可迁移**

`v9` 上既有预检（11 `RESOLUTION_OK` + 1 `TIE_BREAK_DOMINATED` = `holdStreak`）因 `v9` 被排除而**不可直接迁移**；Phase 1 必须在**裁定后的数据集**上**重跑**（只读、零 Run）。`holdStreak` 的结论**预期**同样命中，但**仍须实测确认，不得预设**。

---

## 6. 需要你裁定的**唯一**问题

> ### 请裁定数据集路线（三选一）
>
> | 选项 | 内容 | 代价 / 风险 |
> |---|---|---|
> | **D-a（推荐）** | **新建 `first_limit_pullback` 新版本**：`excludeListedWithinDays = 365`（自然日 @ 事件日）· `preWindowDays ≥ 10`（覆盖 F9）· `postWindowDays = 80` · 全窗口 `2019-01-02 ~ 2025-09-26` | 需一次全窗口构建；`v9` 曾在 `prefix` 插入阶段失败一次 ⇒ 需分批/重试。**不动 Schema、不动既有版本** |
> | **D-b** | **授权复用 `780003`（v9）** —— 其物理数据**恰好满足全部要求**（prefix `rd −60..0` 完整 3,548,239 行、`excludeListedWithinDays = 365`），唯一缺陷是 `status = FAILED`（已查明为**构建中断记账产物**，非数据缺失） | 与本次指令「不使用 FAILED 的 v9」**直接冲突** ⇒ **须你明确解除该限制** |
> | **D-c** | 接受降级：在 `780001` 上跑 **11 因子**（弃 `preReturn10`）且**不排除次新**，报告中如实声明 | 违反样本资格第 4 条 + 12 因子不完整 ⇒ **不推荐** |
>
> **附需确认一项**：§4 的执行坐标裁定（决策 `T+5` close / 入场 `T+6` open / 周期 = 持有长度 `N ∈ {1,5,10,20}`）。若意图不同请指出。

### 若裁定为 **D-a 或 D-b** ⇒ 下一条「正式真实 Run」指令

```text
Phase 1（P3 只读预检 · 零 Run · 零代码改动）  ← 下一条指令的起点
  在裁定后的 datasetVersionId 上，对 12 因子 × {Top3, Top5, Top10} 逐日算
  distinctCount / modalShare / boundaryTieSize / J(ASC,DESC) / J(ASC,均匀随机)
  工具已就绪：shared/singleFactor/rankResolution.ts
  闸门：任一因子 TIE_BREAK_DOMINATED ⇒ 该因子从 Phase 4 剔除并如实登记
Phase 2 实现 → Phase 3 Dry run → Phase 4 真实 Run ×1（EXPLORATORY）→ Phase 5 结果文档
```

---

## 7. 本轮边界

- ✅ **零真实 Run** · ✅ **零 Dataset / Schema / Migration 改动** · ✅ **零 Candidate / StrategyVersion** · ✅ **零历史 Run 改动**
- ✅ **未重复审计** OOS / Parameter Search / Strategy 模块
- ✅ 代码改动**仅**：`rankResolution.ts`（纯函数仪器）+ 其测试 + 一个未跟踪自检脚本
- ✅ `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json` = **0 错**
- ⚠️ `pnpm run test:changed` / `vitest` **未能运行**（沙箱命名管道边界）；`checkEolDrift --strict` 同样受限，改逐字节核验 EOL
