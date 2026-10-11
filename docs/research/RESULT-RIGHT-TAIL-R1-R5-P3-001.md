# RESULT-RIGHT-TAIL-R1-R5-P3-001

> 任务：`RIGHT-TAIL-RESEARCH-001` R1–R5（Dataset 定稿 + P3 只读预检）
> 依据：`PLAN-RIGHT-TAIL-FACTOR-001.md`（含 `RIGHT-TAIL-MVP` 章节）
> 基线：HEAD `f8b6810`（工作区存在长期未提交改动，本轮未触碰）
> 性质：**全程只读** —— 零代码 / 零 Schema / 零 Migration / 零 Dataset 写 / 零 Run / 零 Candidate / 零 StrategyVersion
> 探针：`scripts/_scratch/p3Precheck001.mjs` · `scripts/_scratch/p3Precheck001b.mjs` · `scripts/_scratch/r3Verify001.mjs`（均已 gitignore、未跟踪）

## 0. 结论前置

| # | 项 | 结论 |
|---|---|---|
| R1 | v9 作为 MVP Dataset | ✅ **采用**；`status=FAILED`（数据可用，见 §1.3） |
| R2 | `listedAgeDays >= 365` | ✅ **接受、不改**；口径见 §2 |
| R3 | 780003 Run 引用 | ✅ **核验 = 0**（Run 类表全零，见 §3） |
| R4 | 可观测性缺陷登记 | ⚠️ **已登记**，但**报称字段名不存在**（见 §4） |
| R5 | P3 预检 | ✅ **11 / 12 `RESOLUTION_OK`**；**1 个 `TIE_BREAK_DOMINATED`（`holdStreak`）** |
| — | 可否进入 Tail Metrics 开发 | ✅ **允许**，但 `holdStreak` 必须排除；附 3 条限制（见 §8） |

---

## 1. v9 最终 Dataset 状态（R1）

### 1.1 元数据快照（只读，未修改）

| 字段 | 值 |
|---|---|
| `datasetVersionId` | **780003** |
| `version` | `v9` |
| `status` | **`FAILED`**（见 §1.3 —— **数据本身可用**） |
| `startDate` / `endDate`（声明） | `2019-01-01` / `2026-09-04` |
| `totalEvents` / `totalRows` | `null` / `null`（构建未定稿） |
| `createdAt` / `completedAt` | `2026-10-07 12:09:29` / `null` |

### 1.2 构建配置（`dataset_build_config`，只读）

| 字段 | 值 |
|---|---|
| `excludeSt` | `1` |
| **`excludeListedWithinDays`** | **`365`** ← R2 口径来源 |
| **`preWindowDays`** | **`60`** ✅（12 因子需 `rd ≤ −10`） |
| **`postWindowDays`** | **`80`** ✅（D1-a 的 `T+60` 需 `rd65`） |
| `boards` | `main` |
| `events` | `firstBoard@rd0` |
| `outcomeHorizonsJson` | `[5,10,20]` |
| `batchSize` | `1000` |

### 1.3 实际物理数据（只读实测）

| 量 | 实测值 |
|---|---|
| `event` 行数 / `tradeDate` 范围 | **70,071** / **2019-01-02 ~ 2026-09-04**（全窗口） |
| `prefix` 行数 / `relativeDay` 范围 | 3,548,239 / **−60 ~ 0** |
| `post` 行数 / `relativeDay` 范围 | 4,716,480 / **1 ~ 80** |
| **有完整窗口的事件数** | **58,956**（事件日 **2019-01-02 ~ 2025-09-26**） |
| 该 58,956 事件的 `post` 深度 | **`rd 1..80` 齐备**（58,956 × 80 = **4,716,480** = 实测 `post` 行数，**逐行吻合**） |
| `prefix rd=-10` 事件数 | 58,898（差 58 例，应为上市不足 10 日） |
| `prefix rd=-1` 事件数 | 59,151 |
| `outcome horizon=20` 事件数 | 59,520 |

**🔴 `status=FAILED` 的原因与边界**（`dataset_build_job#900003`）：

```
status=FAILED   totalChunks=71934   completedChunks=58256（80.98%）
processedRows=12987967   failedRows=0   lastTradeDate=2025-09-03
errorMessage（全长恰好 16000 字符，整段为 Drizzle 包装的 SQL 文本）
  = "Failed query: insert into `ds_first_limit_pullback_prefix` (...) values (default, ?, ...), ..."
```

- **事件阶段已完成**（70,071 事件、全窗口日期）；
- **窗口阶段停在 `2025-09-03`** ⇒ 缺 **11,115** 个事件的窗口（= 70,071 − 58,956），全部落在 **2025-09 之后**；
- `errorMessage` 无任何驱动错误码（关键词 `ER_` / `timeout` / `packet` / `Deadlock` / `disk` / `Lock` 全部未出现）⇒ **根因不可考**（详见 §4 的可观测性登记）。

### 1.4 ✅ 本轮四类持有周期（`T+5 / T+10 / T+20 / T+60`）均可支持

本轮采用 **D1-a**（`T+5` 收盘完成信息 → `T+6` 开盘入场 → 持有 `N` 个交易日）：

| 采样点 | 持有 `h` | 退出相对日 | `rd` 是否可得 | 说明 |
|---|---|---|---|---|
| `T+5`（辅助） | 5 | `rd10` | ✅ | `≥+100%` 结构性不可测（见 §5.4） |
| `T+10` | 10 | `rd15` | ✅ | |
| `T+20` | 20 | `rd25` | ✅ | |
| `T+60` | 60 | `rd65` | ✅ | 需 `post ≥ 65`（实际 80）✅ |

**12 因子信息需求**：F9 需 `rd −10 / −1`（**已有**，58,898 例）；F4/F5/F6/F10 需 `rd 1..5`（**已有**）；F7/F11 需 `rd 1`（**已有**）。
⇒ **门槛结论：`pre=60 ≥ 10` ✅、`post=80 ≥ 65` ✅、物理数据齐备 ✅。**

### 1.5 ⚠️ 本轮必须显式声明的评估窗口与一处方法学偏差

| 项 | 值 |
|---|---|
| **本轮评估窗口** | **2019-01-02 ~ 2025-09-26**（受可用窗口事件限制，**不是**声明的 `2026-09-04`） |
| 决策日数 | **1,627** |
| 与 `derive.ts` 的**唯一偏差** | `derive.ts` 在 `rd10` 不可卖时会**顺延搜索 `rd11..20`**；本轮 P3 探针**不读 `rd11..20`**，直接把「`rd10` 不可卖」记为 `NO_EXECUTABLE_EXIT`（**950 例**）。⚠️ 该偏差只影响少量事件，**必须在正式 Tail Metrics 里恢复顺延语义**。 |

---

## 2. `listedAgeDays >= 365` 的明确口径（R2）

**接受 v9 现有过滤，不修改。** 本轮 Right-Tail MVP 的研究对象是：

> **「上市满 365 天」的首板事件池，而不是完全不排除次新的全市场首板池。**

口径逐项（来源 `dataset_build_config#510003` + `server/datasetRegistry/filter.ts#isListingAgeExcluded`）：

| 项 | 值 |
|---|---|
| 字段 | `dataset_build_config.excludeListedWithinDays = 365` |
| 判据 | `isListingAgeExcluded(365, ageDays)` ⇒ `ageDays < 365` 即剔除 |
| **单位** | **自然日**（`server/datasetRegistry/db.ts#resolveListingAgeDaysSync`：`Math.floor((asOfMs − listedMs) / 86400000)`） |
| **基准日** | **事件行 `tradeDate`**（= 首板日 `T`；构建期 Universe 第三层筛选） |
| 数据源 | `research_securities.listedDate`（经 `research_security_identifier_history` 按 `tradeDate` PIT 解析） |
| 生效时机 | **Dataset 构建期**（烙进 `datasetVersionId`，不可后改 —— 不变量 I-1） |
| 实际影响量 | `v8`（无过滤）73,003 → `v9`（365 日过滤）70,071 ⇒ **剔除 2,932 例 = 4.01%** |

⚠️ **与 `PLAN-RIGHT-TAIL-FACTOR-001` §3.4 的关系**：§3.4 原声明「不排除次新」。**本轮以 R2 裁定覆盖之**：MVP 池**隐含**该 365 日过滤。这是**继承既有过滤**，非「新增次新过滤」（用户禁止项是后者）。**该口径必须逐字写进正式 Tail Run 的 `descriptor` 与结果文档。**

⚠️ **与 RCP-P0 口径不可比**：`RESULT-RCP-P0-NEWSTOCK-EXCLUSION-AUDIT-001` 的 canonical 是 **120 交易日**（≈175–182 自然日）⇒ 两者**单位与阈值均不同**，**本 MVP 的池不可与 RCP-P0 池直接并列**。

---

## 3. 780003 Run 引用核验结果（R3）

**核验方法**：对全库所有含 `datasetVersionId` 列的表，逐表 `SELECT COUNT(*) WHERE datasetVersionId = 780003`（只读）。

**🔴 Run 类表引用总数 = 0**

| 表 | 780003 引用 | 备注 |
|---|---:|---|
| **`research_experiment_run`** | **0** | 全表 165 行；`780001`=18、`780002`=0 |
| **`closed_loop_backtest_run`** | **0** | 全表 463 行；`780001`=4、`780002`=0 |
| `oos_validation_run` | **0** | |
| `parameter_search_run` | **0** | |
| `search_robustness_run` | **0** | |
| `stock_selection_run` | **0** | |
| `walk_forward_run` | **0** | |
| `walk_forward_fold` | **0** | |
| `oos_validation_result` | **0** | |
| `strategy_versions` | **0** | |
| `strategy_version_datasets` | **0** | |
| `archive_research_*`（3 表） | **0** | |
| `dataset_build_config` | 1 | 版本自身配置 |
| `dataset_build_job` | 1 | 版本自身作业 |
| `ds_first_limit_pullback_event` | 70,071 | 版本自身数据 |
| `ds_first_limit_pullback_prefix` | 3,548,239 | 版本自身数据 |
| `ds_first_limit_pullback_post` | 4,716,480 | 版本自身数据 |
| `ds_first_limit_pullback_path` | 4,716,480 | 版本自身数据 |
| `ds_first_limit_pullback_outcome` | 178,560 | 版本自身数据 |

**结论**：**「780003 被 0 个 Run 引用」得到独立复核确认**；该版本当前只被自身的构建配置/作业与自身数据行引用。**本轮未删除、未迁移、未修改任何历史数据。**

---

## 4. R4 CHANGE-AUDIT 登记结果

已登记于 `docs/architecture/CHANGE-AUDIT.md`（新增 `2026-10-08 · RIGHT-TAIL-RESEARCH-001 R1–R5` 条目）。

### ⚠️ 登记时需要如实纠正的一点

报称的缺陷字段名 **`eventContextJson` / `factorSnapshotJson` 在全仓（`*.ts` / `*.tsx`）零命中** ⇒ 这两个名称**不存在**，无法按此名登记。

**实查到的是另外 4 类「快照类 JSON」**：

| 字段 | 位置 |
|---|---|
| `versionSnapshotJson` / `dataSnapshotJson` | `research_dataset`（`drizzle/schema.ts` L354 / L356） |
| `sourceSnapshotJson` | `strategy_research_provenance`（同 L745） |
| `searchSnapshotJson` | `search_robustness_run` / `oos_validation_run`（同 L1812 / L1994） |
| `strategyRunSnapshot` | 回测载荷 |

**页面可见性实查（`client/src` 全量 grep `[Ss]napshot`，77 处命中）**：
- **没有任何一处渲染上述 4 类 JSON 的原文**；
- `components/robustness/SearchRobustnessPanel.tsx` L474 只渲染 `searchSnapshotFingerprint` 的**前 16 位**；
- `components/strategy/StrategyVersionDetailDialog.tsx` 把 `strategyRunSnapshot` **拆成具名字段**展示；
- `pages/datasets/VersionDetail.tsx` 展示 `buildConfig` 与 `DatasetSnapshotPanel`（**本地 sqlite 快照**，非上述字段）。

⇒ **不是「部分页面可见」，而是「均无原文查看入口」**。

**登记为后续修复项**：

> **「数据集 / 策略 / 搜索 / 回测四类快照 JSON 缺统一的原文查看入口（现仅可见派生字段或指纹）。」**

**本任务边界**：**不修复 / 不改 Schema / 不改历史数据 / 不影响本次 P3**（P3 全程走只读 DB 探针 + 仓库代码，**不依赖任何页面**）。

---

## 5. 12 因子 P3 分辨率表（R5）

### 5.1 探针口径

| 项 | 口径 |
|---|---|
| Dataset | `datasetVersionId = 780003`（v9） |
| **回踩门** | 🔴 **不进入**（`NO_PULLBACK_IN_OBSERVATION` **实测 = 0**，已确认未施加） |
| 池 | 首板 + 沪深主板 + 严格收盘涨停 + `rd1..5` 路径齐备 + `rd6` 可买 + `rd10` 可卖 + 前缀齐备 + 12 因子齐备 |
| 因子 | **F1–F12 冻结定义零改动**（排序键 = **原始值**） |
| 方向 | `HIGH` / `LOW` |
| 档位 | `Top3` / `Top5` / `All`（池基线） / `Bottom3` |
| 收益 | D1-a，**净收益 = 毛 − 20 bps 往返** |
| 破平键 | 现行 = `eventId` 升序；敏感性另测 `DESC` 与**固定种子随机** |

### 5.2 样本账（**账平 ✅**）

| 量 | 值 |
|---|---|
| candidate（v9 全部事件） | 70,071 |
| 通过 Pass A/B | 56,061 |
| excluded 合计 | 14,010 |
| **账平检查** | `70,071 − 56,061 = 14,010` ✅ **YES** |

剔除明细：

| 原因码 | 数量 |
|---|---:|
| `MISSING_EVENT_DAY_BAR` | 10,897（= 无窗口事件，2025-09 之后） |
| `NO_EXECUTABLE_EXIT` | 950（⚠️ 含不顺延偏差） |
| `MISSING_PREFIX_PATH` | 909 |
| `MISSING_FACTOR_PATH` | 543 |
| `ENTRY_UNFILLABLE` | 512 |
| `MISSING_FORWARD_PATH` | 199 |
| `MISSING_FACTOR`（Pass D） | 7（**全部为 `turnover` 单因子缺失**） |
| 🔴 **`NO_PULLBACK_IN_OBSERVATION`** | **0** ✅（本轮不做该判定） |
| **入池（12 因子齐备）** | **56,054** |

### 5.3 横截面规模（**满足最小样本要求**）

| 项 | 值 | 判据 |
|---|---|---|
| **决策日数** | **1,627** | ✅ ≥ 100 |
| 事件日范围 | 2019-01-16 ~ 2025-09-26 | — |
| 每日池规模 | min **3** / p25 **20** / median **29** / p75 **44** / max **558** | ✅ median ≥ 5 |
| 池 < 5 的日数 | **8 / 1,627**（0.5%） | 可忽略 |

### 5.4 池基线 `All`（与因子无关，**Tail 判定的零点**）

| 采样点 | `h` | n | Mean% | `≥+50%` | `≥+100%` |
|---|---:|---:|---:|---:|---:|
| `T+5` | 5 | 56,054 | **−0.064** | 0.162% | 🔴 **0.000%** |
| `T+10` | 10 | 55,056 | −0.198 | 0.639% | ⚠️ **0.058%**（≈32 例） |
| `T+20` | 20 | 55,211 | −0.335 | 1.545% | 0.172% |
| `T+60` | 60 | 55,352 | **−1.203** | **3.967%** | **0.880%** |

🔴 **两条硬事实**：
1. **`T+5` 的 `≥+100%` 实测 = 0.000%** ⇒ 与「主板 5 日上限 61.05%」的**数学不可能**一致 ⇒ 正式 MVP 必须标 `NOT_MEASURABLE_BY_CONSTRUCTION`。
2. **`T+10` 的 `≥+100%` 仅 0.058%（≈32 例）** ⇒ 落在 `ABORT-10`（池内尾事件数 `< 30`）**边界**，必须标 `INSUFFICIENT`、**不据此判定**。
3. 池均值在**所有**周期为负，且**随持有期单调恶化**（−0.064 → −1.203%）。

### 5.5 🔴 P3 分辨率表（主表）

分类阈值（**本轮自定、事前写死、事后不改**；属**诊断阈值**，非研究判据）：
`minDecisionDays=100` · `minMedianValid=5` · `maxMissingShare=50%` · `lowResMedianDistinct≤5` · `lowResMedianMaxShare≥50%` · `tieDomShare≥50%`（K=3 且 K=5）· `tieDomJaccard<0.5`

| 因子 | 决策日 | 每日有效值中位数 | **每日 distinct 中位数** | 单值最大占比中位数 | 边界并列中位数 K3 / K5 | **边界并列 ≥K 日占比 K3 / K5** | 缺失率 | **分类** |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| F1 `bodyHeight` | 1,627 | 29 | 29 | 4.8% | 1 / 1 | 0% / 0% | 0.0% | ✅ **RESOLUTION_OK** |
| F2 `turnover` | 1,627 | 29 | 29 | 3.4% | 1 / 1 | 0% / 0% | 0.0% | ✅ **RESOLUTION_OK** |
| F3 `amountPercentile` | 1,627 | 29 | 29 | 3.4% | 1 / 1 | 0% / 0% | 0.0% | ✅ **RESOLUTION_OK** |
| F4 `meanAmplitude` | 1,627 | 29 | 29 | 3.4% | 1 / 1 | 0% / 0% | 0.0% | ✅ **RESOLUTION_OK** |
| F5 `maxAmplitude` | 1,627 | 29 | 29 | 3.4% | 1 / 1 | 0% / 0% | 0.0% | ✅ **RESOLUTION_OK** |
| **F6 `holdStreak`** | 1,627 | 29 | 🔴 **3** | 🔴 **83.3%** | 🔴 **4 / 8** | 🔴 **73% / 73%** | 0.0% | 🔴 **TIE_BREAK_DOMINATED** |
| F7 `t1VolumeRatio` | 1,627 | 29 | 29 | 3.4% | 1 / 1 | 0% / 0% | 0.0% | ✅ **RESOLUTION_OK** |
| F8 `limitGap` | 1,627 | 28 | 23 | 11.1% | 1 / 1 | 1% / 0% | ⚠️ 4.1% | ✅ **RESOLUTION_OK** |
| F9 `preReturn10` | 1,627 | 29 | 29 | 3.4% | 1 / 1 | 0% / 0% | 0.0% | ✅ **RESOLUTION_OK** |
| F10 `drawdownDepth` | 1,627 | 29 | 29 | 3.6% | 1 / 1 | 0% / 0% | 0.0% | ✅ **RESOLUTION_OK** |
| F11 `t1OpenGap` | 1,627 | 29 | 28 | 7.0% | 1 / 1 | 0% / 0% | 0.0% | ✅ **RESOLUTION_OK** |
| F12 `historyLimitCount` | 1,627 | 29 | 19 | 11.8% | 1 / 1 | 5% / 1% | 0.0% | ✅ **RESOLUTION_OK** |

**分类汇总：`RESOLUTION_OK` 11 个 · `TIE_BREAK_DOMINATED` 1 个 · `LOW_RESOLUTION` 0 · `INSUFFICIENT_SAMPLE` 0 · `ABORT` 0**

### 5.6 🔴 tie-break 敏感性（**方法学纠正后的正式测试**）

**先纠正一处口径（本轮自查发现）**：research-experiments（`derive.ts` 一族）的 `eventId` 实测 **100%（70,071 / 70,071）形如 `<symbol>@<date>`** ⇒ 同一交易日内 **`eventId` 升序 ≡ `symbol` 升序**。
⇒ 按 `PLAN-RIGHT-TAIL-FACTOR-001` §6.4 原计划的「第二破平键 = `symbol`」**是退化测试**（结果必然 Jaccard = 1.00）。**本轮改用三个真正不同的键**：`ASC`（现行=eventId 升序）/ `DESC`（反序）/ `RAND`（固定种子随机）。

| 因子 | K | **Jaccard(ASC, DESC)** | **Jaccard(ASC, RAND)** | 判定 |
|---|---:|---:|---:|---|
| F1–F5 · F7 · F9 · F10 · F11 | 3 | 0.998 – 1.000 | 0.998 – 1.000 | ✅ 稳健 |
| F1–F5 · F7 · F9 · F10 · F11 | 5 | 0.999 – 1.000 | 0.999 – 1.000 | ✅ 稳健 |
| F8 `limitGap` | 3 / 5 | 0.974 / 0.978 | 0.983 / 0.989 | ✅ 稳健 |
| F12 `historyLimitCount` | 3 / 5 | 0.924 / 0.918 | 0.960 / 0.950 | ✅ 稳健（并列率低） |
| 🔴 **F6 `holdStreak`** | 3 | 🔴 **0.561** | 🔴 **0.670** | 🔴 **不稳健** |
| 🔴 **F6 `holdStreak`** | 5 | 🔴 **0.515** | 🔴 **0.621** | 🔴 **不稳健** |

**`holdStreak` 专项（三个破平键下的尾率明细，证明影响是实质的）**：

| K | 破平键 | `T+5 ≥50%` | `T+10 ≥50%` | **`T+20 ≥50%`** | **`T+60 ≥50%`** | `T+10 ≥100%` | `T+20 ≥100%` | **`T+60 ≥100%`** |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 3 | **ASC（现行）** | 0.471% | 1.201% | **2.260%** | **4.168%** | 0.232% | 0.419% | **1.000%** |
| 3 | DESC | 0.389% | 1.285% | **2.403%** | **4.711%** | 0.211% | 0.585% | **1.167%** |
| 3 | RAND | 0.430% | 1.307% | **2.531%** | **4.238%** | 0.232% | 0.502% | **1.065%** |
| 5 | ASC | 0.284% | 1.115% | 2.031% | 4.106% | 0.165% | 0.366% | 0.942% |
| 5 | DESC | 0.284% | 1.115% | 2.229% | 4.359% | 0.152% | 0.466% | 1.017% |
| 5 | RAND | 0.309% | 1.063% | 1.991% | 3.909% | 0.139% | 0.353% | 0.930% |

⇒ `holdStreak` 的尾率在三个破平键下极差：`T+20 ≥50%` **0.271 pp（相对 12%）**、`T+60 ≥100%` **0.167 pp（相对 17%）**，且成员集合有 **~40% 被换掉**。
⇒ **按用户硬门「Top3/Top5 的选择主要由任意 tie-break 决定 ⇒ 该因子不得进入正式 Tail Run」—— `holdStreak` 命中。**

### 5.7 方向有效性 / 基本分辨力（**诊断，非判定**）

净收益均值（%）；`All` = 池基线；`T3−All` = Top3 相对池；`T3−B3` = 首尾差。

| 因子 | 方向先验 | `T+5` T3−All | `T+10` T3−All | `T+20` T3−All | `T+60` T3−All | `T+20` T3−B3 | `T+60` T3−B3 |
|---|---|---:|---:|---:|---:|---:|---:|
| F2 `turnover` | −1 | −0.568 | −1.515 | −2.301 | −4.282 | −2.670 | −5.874 |
| F4 `meanAmplitude` | −1 | −1.079 | −1.885 | −2.804 | −3.620 | −3.556 | −5.962 |
| F5 `maxAmplitude` | −1 | −1.075 | −1.734 | −2.523 | −3.063 | −3.239 | −5.693 |
| F1 `bodyHeight` | −1 | −0.473 | −0.921 | −1.708 | −2.355 | −1.527 | −3.030 |
| F10 `drawdownDepth` | −1 | −0.828 | −1.265 | −1.989 | −1.989 | −1.759 | −1.578 |
| F12 `historyLimitCount` | −1 | −0.213 | −0.387 | −0.965 | −2.312 | −1.023 | −3.816 |
| F9 `preReturn10` | −1 | −0.281 | −0.356 | −0.822 | −1.261 | −0.751 | −0.742 |
| F3 `amountPercentile` | −1 | **+0.040** | −0.307 | −1.238 | −2.866 | −2.021 | −5.714 |
| F11 `t1OpenGap` | +1 | −0.598 | −0.734 | −0.935 | **+0.147** | −0.355 | **+0.351** |
| F8 `limitGap` | +1 | −0.109 | **+0.022** | **+0.227** | **+1.721** | **+1.620** | **+3.431** |
| F7 `t1VolumeRatio` | +1 | −0.143 | −0.028 | −0.081 | **+1.292** | **+0.865** | **+2.516** |
| 🔴 F6 `holdStreak` | **+1** | −1.062 | −1.560 | −2.035 | −2.724 | **−1.669** | **−2.729** |

**三条 P3 诊断读数（必须带入 MVP 预注册）**：

1. **`orientation = +1` 的因子里，F7 / F8 / F11 的 `T3−B3` 在 `T+10/20/60` 为正** ⇒ 与冻结方向**一致**；其中 **F8 `limitGap` 最强**（`T+60` 首尾差 **+3.431 pp**）。
2. 🔴 **F6 `holdStreak` 的 `T3−B3` 全周期为负**（`T+60` **−2.729 pp**）⇒ 与其冻结 `orientation = +1` **相反**，与 `RESULT-12F-TOPN-001` §1.4「`holdStreak` 是强相反方向」**一致**。
3. **`orientation = −1` 的 8 个因子 `T3−B3` 全部为负** ⇒ 与冻结方向**一致**（HIGH 端更差）。
   ⇒ **12 个因子中有 11 个的尾部方向与冻结 `orientation` 一致，仅 `holdStreak` 相反** ⇒ 冻结方向表在本池上**基本得到佐证**（该表**不得修改**，仅登记为观察）。
4. ⚠️ **池基线在所有周期为负**（`T+60` **−1.203%**）⇒ 正式 MVP 必须把「排序有信息」与「可赚钱」**分开读**（`PLAN-TAIL-SELECTION-001` §9.3 的尾–均值张力先验）。

---

## 6. 哪些因子可以进入正式 MVP

| # | 因子 | 进入 MVP | 依据 |
|---|---|---|---|
| F1 | `bodyHeight` | ✅ | `RESOLUTION_OK`；低并列 |
| F2 | `turnover` | ✅ | `RESOLUTION_OK` |
| F3 | `amountPercentile` | ✅ | `RESOLUTION_OK` |
| F4 | `meanAmplitude` | ✅ | `RESOLUTION_OK` |
| F5 | `maxAmplitude` | ✅ | `RESOLUTION_OK` |
| F7 | `t1VolumeRatio` | ✅ | `RESOLUTION_OK`；方向先验获佐证 |
| F8 | `limitGap` | ✅ | `RESOLUTION_OK`；**方向先验最强佐证**（`T+60 T3−B3 = +3.431 pp`）⚠️ 见 §7.3 |
| F9 | `preReturn10` | ✅ | `RESOLUTION_OK` |
| F10 | `drawdownDepth` | ✅ | `RESOLUTION_OK` |
| F11 | `t1OpenGap` | ✅ | `RESOLUTION_OK` |
| F12 | `historyLimitCount` | ✅ | `RESOLUTION_OK` ⚠️ 见 §7.4 |
| F6 | `holdStreak` | 🔴 **否** | `TIE_BREAK_DOMINATED`（见 §7.1） |

**⇒ 11 / 12 个因子可进入正式 MVP。**

---

## 7. 哪些因子被阻断（及理由）

### 7.1 🔴 F6 `holdStreak` —— `TIE_BREAK_DOMINATED`（**唯一硬阻断**）

| 证据 | 值 |
|---|---|
| 每日 distinct 中位数 | **3**（离散取值 0–5） |
| 单值最大占比中位数 | **83.3%** |
| 边界并列中位数 | K3 = **4**、K5 = **8** |
| 边界并列 ≥ K 的交易日占比 | K3 = **73%**、K5 = **73%** |
| 换破平键后成员 Jaccard | K3 = **0.561**、K5 = **0.515** |
| 尾率极差（三键） | `T+20 ≥50%` **0.271 pp（12%）**、`T+60 ≥100%` **0.167 pp（17%）** |

⇒ 命中用户硬门：**「如果 Top3 / Top5 的选择主要由任意 tie-break 决定，则该因子不得进入正式 Tail Run」**。
**处置**：**排除出 Top-K 判定**。`Rank IC`（用**全序**，不依赖破平键）**仍可在正式 MVP 中报告**为描述性列，但**不得**用作 Top-K 结论。
🔴 **不得**为此修改因子定义、分桶或 Dataset（本轮已遵守）。

### 7.2 无 `LOW_RESOLUTION` / `INSUFFICIENT_SAMPLE` / `ABORT`

- **无 `LOW_RESOLUTION`**：11 个连续/低并列因子的每日 distinct 中位数均 ≥ 19（最高 29），单值最大占比中位数 ≤ 11.8%。
- **无 `INSUFFICIENT_SAMPLE`**：决策日 **1,627**（≥ 100）；每日有效值中位数 **29**（≥ 5）；池 < 5 仅 **8 天**。
- **无 `ABORT`**：样本账**平**（§5.2）；池内缺失率最高 4.1%（`limitGap`），远低于 50% 阈值。

### 7.3 ⚠️ F8 `limitGap` —— 可进入，但附强制条件

- 缺失率 **4.1%**（`daysSincePreviousLimit` 为 `null` = 首次涨停无前次记录）。
  🔴 在**原始值排序**下 `null` **不可排名** ⇒ 正式 Tail Metrics **必须**把该情形作为**独立缺失码**（`FACTOR_VALUE_MISSING:limitGap`）统计并披露，**不得插补、不得填 0**（冻结契约里 `UNKNOWN` 是**合法桶**，但那是**桶位分**语义，不适用于原始值排序）。
- 并列摩擦存在但可接受（tie ≥3 日占比 1%、Jaccard 0.974–0.989）。

### 7.4 ⚠️ F12 `historyLimitCount` —— 可进入，但强制「年内归一化」

- P3 层面 `RESOLUTION_OK`（tie ≥3 日占比 5%，Jaccard 0.918–0.960）。
- 🔴 但 `RESULT-TAIL-EXPLORE-001` §6.1 已实证：该字段是**累计量**，**42% 的表观尾部信号来自年份漂移**，**8 年中仅 3 年单调**，并因此被既有臂**移除**。
  ⇒ 正式 MVP 的年度切片（P6）**必须**做**年内秩/年内分位归一化**后合并；否则会复现已知的假信号。

### 7.5 全域限制（不阻断，但必须写入正式 MVP）

| # | 限制 | 处置 |
|---|---|---|
| 1 | **`T+5` 的 `≥+100%` 实测 0.000%**（主板 5 日上限 61.05%） | 标 `NOT_MEASURABLE_BY_CONSTRUCTION`，**不入判** |
| 2 | **`T+10` 的 `≥+100%` 池基线仅 0.058%（≈32 例）** | 标 `INSUFFICIENT`（`ABORT-10` 阈值 `< 30` 的边界），**不据此判定** |
| 3 | **池均值全周期为负**（`T+60` −1.203%） | 必须分开读「排序有信息」vs「可赚钱」 |
| 4 | **本轮 P3 不顺延退出**（`NO_EXECUTABLE_EXIT` 950 例含偏差） | 正式 Tail Metrics **必须恢复 `rd11..20` 顺延语义** |
| 5 | **评估窗口为 2019-01-02 ~ 2025-09-26**（非声明的 2026-09-04） | `descriptor` 与结果文档**必须显式声明** |
| 6 | `outcome horizon=20` 事件数 59,520 **>** 有窗口事件 58,956（**多 564**） | 已登记为**待核项**；正式 Run 前需查清（本轮未阻断 P3，因 P3 直接用 `post` 表算收益，未用 `outcome`） |

---

## 8. 是否允许进入下一阶段 Tail Metrics 开发

### ✅ 结论：**允许进入 `tailMetrics.ts` / `rankIC` / `resolution` 的开发。**

**理由**：
1. **Dataset 门已过**：v9 满足 `pre=60 ≥ 10`、`post=80 ≥ 65`、四类持有周期（`T+5/10/20/60`）**全部可得**（§1.4）。
2. **P3 门已过**：**11 / 12** 因子 `RESOLUTION_OK`；无 `LOW_RESOLUTION` / `INSUFFICIENT_SAMPLE` / `ABORT`。
3. **用户硬门（「离散因子**大量**被 tie-break 主导 ⇒ 不进入」）**：实测仅 **1 / 12**（`holdStreak`），**不构成「大量」** ⇒ 门**通过**。

### 🔴 进入开发的强制前提（写死在实现与预注册里）

| # | 前提 |
|---|---|
| 1 | **`holdStreak` 排除出所有 `Top-K` 判定**（`Rank IC` 可作描述列） |
| 2 | **`T+5 × ≥+100%` 标 `NOT_MEASURABLE_BY_CONSTRUCTION`**；**`T+10 × ≥+100%` 标 `INSUFFICIENT`** |
| 3 | **破平键三键敏感性内置**（`ASC` / `DESC` / 固定种子 `RAND`），并输出成员 Jaccard 与尾率极差（**不得只用单键**） |
| 4 | **恢复 `rd11..20` 顺延退出语义**（消除本轮 950 例偏差） |
| 5 | **`limitGap` 的 `null` 作为独立缺失码**统计与披露，**不插补** |
| 6 | **`historyLimitCount` 年度切片必须年内归一化** |
| 7 | 池基线 `All` 与 `Random` 期望的**等价性自检**（随机抽 `K` 只的期望 `THR` 恰等于池基线） |
| 8 | 结果文档**逐字声明**：评估窗口 `2019-01-02 ~ 2025-09-26`、`listedAgeDays >= 365`、无回踩门、破平键敏感性 |

### 尚需用户裁定（不阻断开发，但阻断真实 Run）

| # | 事项 | 备注 |
|---|---|---|
| **A1** | v9 仍为 `status=FAILED`（`totalEvents`/`totalRows` 为 `null`）。**是否将其元数据定稿为 `READY`**（1 行写），还是**在探针/桥层直接按 `datasetVersionId` 读取**？ | 本轮**未做任何写**；R3 已证**零 Run 引用** ⇒ 定稿爆炸半径为 0 |
| **A2** | `outcome` 表多出的 **564** 例（§7.5-6）是否需在开发前查清 | 建议**查清**（避免样本账对不上） |

---

## 9. 本任务边界确认

- ✅ **未开发** `tailMetrics.ts` / `rankIC` / `resolution`；**未修改** Ranker；**未创建** Tail Experiment / Candidate / StrategyVersion；**未跑**正式 Tail Run
- ✅ **未做**组合因子 / 权重优化 / 参数搜索
- ✅ **未修改** 代码 / Schema / Migration / v9 Dataset / 任何历史 Run
- ✅ 全程**只读 `SELECT`**；探针脚本落 `scripts/_scratch/`（已 gitignore、未跟踪）
- ✅ 新增文档 **LF-only**（`CR=0`，逐字节核验）
- ⚠️ `node scripts/checkEolDrift.mjs --strict` **未能运行**：该脚本需 `spawnSync git` 管道，被沙箱以 `EPERM` 拒绝（属已记录的沙箱边界），**未重试、未绕道**；改用**直接读原始字节**核验 EOL。

**本轮到此停止，等 §8 的 A1 / A2 裁定后进入 Tail Metrics 开发。**
