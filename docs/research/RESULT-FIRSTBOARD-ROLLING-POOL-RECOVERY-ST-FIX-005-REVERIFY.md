# RESULT · `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005` 第二阶段复验（SMOKE 数据前置）

> 执行者：DeepSeek Harness 桌面应用（本会话）· 日期：2026-10-11
> 前置验收：[`AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md`](AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md)（Codex：专项代码验收通过，**允许一次 SMOKE 数据前置复验，当前不批准收益矩阵**）
> 修复方案：[`PLAN-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md`](PLAN-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md) §4
> 第一阶段交付：[`RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md`](RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md)
> 研究目标/预注册：[`GOAL-…-ST-004.md`](GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md) · [`PREREG-…-ST-004.md`](PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md) · [004 审计 §9](AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md#9-执行结果复核2026-10-11)

---

## 1. 结论

**实际执行到：SMOKE 数据前置复验（PLAN §4 第 1 步）。终态 `ST_COVERAGE_BLOCKED`，退出码 3。**

| 问题 | 答案 |
|---|---|
| 执行到哪一步 | 只到 **SMOKE 的只读数据前置/资格闸门**。**未进入 6 账户撮合**，**未进入 STUDY** |
| 是否产生收益矩阵 | **没有**。`matrixEmitted = false`；`primaryComparison = null`；`groups = []`；无任何交易/权益/收益读数 |
| 阻断原因 | **ST provider 明确缺失**（`ABSENT_STATUS_PROVIDER`，`configured=false`，`providerVerifiable=false`）⇒ 每个计划检查时点都只能是 `UNKNOWN_BLOCKED` |
| 是否重复运行 | **否**。按指令只跑一次，核对真实产物后即停止 |
| 是否用空仓收益评价策略 | **否**。目标 §4 明文禁止，本轮未做 |

这是**合规的诚实暂停**，不是失败、也不是策略无效的结论。

---

## 2. 执行记录

```
命令: node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs tests/tools/rollingPoolRecoveryStRun.mts --mode smoke
工作目录: C:\work\sourcecode\stock-limit-up-analyzer
HEAD: f8b6810（docs: 归档区统一入口表（INDEX §11）+ 清理 15 个零字节证据文件）
工作区: 220 项（35 tracked-modified + 185 untracked，含并发会话）
退出码: 3  （0 = 产出矩阵 / 1 = 工程失败 / 3 = ST_COVERAGE_BLOCKED 刻意暂停）
耗时: 25.6 s（墙钟，含进程启动与 DB 连接）；工具自报 `smoke elapsed=18.1s`
产物: 6 个（见 §4）
输出落盘（未接管道）: scripts/_scratch/recovery-st-reverify/smoke.log
命令/元数据: scripts/_scratch/recovery-st-reverify/{command.txt,run-meta.txt}
```

### 指纹

| 项 | 值 |
|---|---|
| 代码指纹 `codeDigest` | **`exp-code-sha256:d98415a905bd257273d122fd4fc22f0092a8f03a45fb1489d37b5a208f2dd3ca`** |
| Dataset 输入 | **`datasetVersionId = 780004`** / `first_limit_pullback` / `v10-listed365-pre10-post80` |
| 运行模式 | `SMOKE`：`randomAccountCount=2`、`accountsPerGroup=3`、`groupCount=2`、**`totalAccountCount=6`**、`seedIndexes=[20261010, 20261011]` |
| ST 契约版本 | `1.1.0`（F2 修复后） |
| provider | `ABSENT_STATUS_PROVIDER`，`configured=false`，`providerVerifiable=false`，`probeCount=4`，`probeUnknownCount=4` |

---

## 3. 阻断原因（逐条，实测）

**早诊断路径已触发**（FIX-005 / F3），关键证据：

| 项 | 实测值 |
|---|---|
| `eventScanPerformed` | **true** |
| `scannedEventCount` | **58,983**（已实测，数据集声明 58,983 一致） |
| `postRelativeDayReads` | **`[]`** —— **未读任何 post rd≥1** |
| `postMaxRelativeDayDeclared` | 80（仅声明，未读取） |
| `selectionFrozen` | **false** |
| `identityResolved` | **false** |
| `matchingExecuted` | **false** |
| `measurement` | **`NOT_SCANNED_PROVIDER_ABSENT`** |

四条 provider 探针（窗口两端 × 两个时点）**全部 UNKNOWN**：

| tradeDate | timepoint | outcome | reason |
|---|---|---|---|
| 2024-01-02 | `CONFIRM_CLOSE_ELIGIBILITY` | UNKNOWN | `NO_STATUS_PROVIDER` |
| 2024-01-02 | `PRE_FILL` | UNKNOWN | `NO_STATUS_PROVIDER` |
| 2025-09-30 | `CONFIRM_CLOSE_ELIGIBILITY` | UNKNOWN | `NO_STATUS_PROVIDER` |
| 2025-09-30 | `PRE_FILL` | UNKNOWN | `NO_STATUS_PROVIDER` |

**`blockedReasons`（原文三条）**：

1. ST provider 明确缺失（`configured=false`，`providerId=ABSENT_STATUS_PROVIDER`）：每个计划检查时点都只可能是 `UNKNOWN_BLOCKED`（`NO_STATUS_PROVIDER`）。
2. 按 FIX-005 / F3 走**早诊断**收口：不读 post rd≥1、不解析证券身份、不执行任何撮合，也不为再次证明同一缺口重复扫描全量 post80。
3. 未扫描 ⇒ 计划候选数 / 覆盖分母为 `null`（**未测**），不用 0 冒充。

---

## 4. 🔴 已测 vs 未测（严格区分）

| 类别 | 字段 | 值 | 性质 |
|---|---|---|---|
| **已测** | `scannedEventCount` | **58,983** | 实测（与数据集声明一致） |
| **已测** | `excludedByReason.EVENT_OUTSIDE_POOL_WINDOW` | **39,473** | 实测 |
| **已测** | provider 探针 4 条 | 4 × UNKNOWN | 实测 |
| **未测** | `plannedCandidateCount` | **`null`** | 未扫描 post rd≥1 |
| **未测** | `candidatesWithPlannedFillCount` | **`null`** | 同上 |
| **未测** | `candidatesWithoutPlannedFillCount` | **`null`** | 同上 |
| **未测** | `unknownBlockedCandidateCount` | **`null`** | 同上 |
| **未测** | `fullyVerifiedNormalCandidateCount` | **`null`** | 同上 |
| **未测** | `stRejectedCandidateCount` | **`null`** | 同上 |
| **未测** | `timepointChecks` / `unknownTimepointChecks` / `unknownByTimepoint` / `unknownByReason` | **`null`** | 同上 |
| **未测** | `watchPoolEventCount` / `watchPoolDecisionDateCount` | **`null`** | 同上 |
| **未测** | `coverageDenominator` | **`null`** | 同上 |

⇒ **未扫描的计数一律为 `null`（未测），没有任何一处写成 0。** `st-coverage-counts.csv` 的计数列为空并以 note 注明「计数为 null（未测），不是 0」。
`statistics` 中 `plannedCandidateCount` 的 `value = null`，note 明写「**未测**（`null`）：provider 明确缺失 ⇒ 早诊断路径不读 post rd≥1」。

**未产出指标清单（`notEmittedMetrics`，9 项）**：主指标 `B_R − A_R` 覆盖率差及其 block20/block40 区间、≥+20/50/100% 尾率、唯一命中锚点/股票数、单笔净收益与锚点整链净损益、账户复合收益/年化/MDD/现金占比/容量/次数/持有期、前 3/5 日不利波动、配对日期块 bootstrap 全部区间、逐年同靶覆盖率与账户年度收益、逐笔执行 ST 审计与全部 S5 明细产物。

---

## 5. 交付产物（6 个，均已核对）

| 产物 | 大小 | 内容 |
|---|---:|---|
| `st-coverage-gap-summary.json` | 5,515 B | 状态字面量 + 计数（含 null）+ 涉及时点 + 缺失 provider 身份 + 3 条阻断原因 + 9 项未产出指标 |
| `st-early-diagnostic.json` | 1,729 B | 早诊断：`scanPlan`（未读 post / 未冻结 / 未解析身份 / 未撮合）、`unscanned` 全 null、`untouched`（groups=[]、accounts/trades/equityCurve=null）、`nextStepRequirement` |
| `status-coverage.csv` | 253 B | 逐 symbol/逐时点状态覆盖证据表头（**0 数据行** —— 未扫描，未伪造任何 NORMAL 行） |
| `st-gap-samples.csv` | 53 B | 缺口样例（仅表头，封顶） |
| `st-coverage-counts.csv` | 482 B | 覆盖计数三分账；计数列全空 + note「null（未测），不是 0」 |
| `frozen-config.json` | 5,055 B | 冻结配置与来源 manifest（暂停时也交付，便于核对本轮声明与坐标） |

另有工具级汇总 `_scratch/fbp4/smoke-outcome.json`（25,767 B）与 `_scratch/fbp4/smoke-artifacts/**`。

---

## 6. 冻结参数未被改动（本轮零改动）

**本轮未改任何代码、策略规则或历史数据；未构建新 Dataset；未写数据库；未产生 Run。**
保持：T+20、破位修复买点（ΣQ_j ≥ 15/20、`d≤19`、`d−5>p`、无新低、确认日 `C_d > max(H_(d−2),H_(d−1))` 且 `V_d ≥ V_(d−1)`）、二次入场、**当日收盘权益 × 20% 仓位**、因子排序（`preReturn10` 降序 → symbol → eventId，Top3）、冻结 Runner 退出（`strategy_versions.id=3600005`）、成本、seed（`20261010+i`）、主指标与停止判据。

---

## 7. 解除阻断所需的数据与步骤

### 7.1 数据要求（必须由用户按 PLAN §4 / 目标 §1 授权）

| # | 要求 | 现状 |
|---|---|---|
| 1 | **可 PIT 核验的逐日 ST 状态**：每个区间同时带**生效时间**与**公告可获知时间** + 来源 + 证据指纹 | ST 行 `availability` 全 `UNKNOWN`；**窗口内可获知时间 = 0**；`retrievedAt` 全在 2026-09-06~09 单批次 |
| 2 | **ST 维度的 `NORMAL` 语义必须存在**（当前 0 行） | `resolveStSync` 永远无法返回 NORMAL ⇒「要求历史 NORMAL」无满足路径 |
| 3 | **穷尽性证据**（否则 absence ≠ NORMAL） | **2,378 / 2,827（84%）** symbol 无任何 ST 行 |
| 4 | 解释并修正 **948 格矛盾**（ST 区间 vs `limitRuleUp=10%`/`canBuyAtOpen=1`） | 根因已定位：`builder.ts` 在 `checkpoint.phase==='windows'` 时跳过 `buildEvents` ⇒ `loadSecurityIndexes()` 未执行 ⇒ ST/停牌/上市龄静默退化 |
| 5 | 处理 `poolStIndex.ts#createPoolStIndexFromRows` 无区间返回 `"NORMAL"` 的默认 | 直接违反「absence ≠ NORMAL」，未修 |
| 6 | 决定无覆盖 symbol 的处置 | 目标 §4：接受特定覆盖子集须**另冻版本并披露删样本影响** |

### 7.2 步骤顺序

1. **用户授权数据引入**（新数据源 + 新 Dataset 版本；DDL/历史回填须另行影响报告与授权）。
2. 接入**可核验 provider**（注入点：`experiment.ts#resolveStatusProvider()`），契约版本显式记录。
3. 重跑 **SMOKE 一次**，验证：可靠 ST 覆盖 + 执行行情字段 + **尾部覆盖**（理论 rd94/95 与不可卖尾部，**不得**借旧规则「post80 零暴露」推断足够）。
4. 通过后做**同输入性能等价对照**（6 账户；优化前后交易/权益 digest 一致）。
5. 以上全通过，才运行**一次** 42 账户 `--mode study`。
6. 若仍未通过，再次交付具体阻断与最小补数清单，**不重复运行同一缺口**。

### 7.3 最小补数清单（下一步可只读产出，无需授权）

按**两组冻结价格候选所需的 symbol / 日期 / 检查时点**去重后生成清单，批量读取具有明确 NORMAL/ST 观测与时点证据的来源。注意：即使压缩为区间，**2,378 个没有 ST 片段的 symbol 也需要各自覆盖依据**；「约 500 个 NORMAL 区间即可覆盖全部 2,827 symbols」的粗估**不可**直接用于实施预算。

---

## 8. 影响与边界

| 项 | 结论 |
|---|---|
| 代码 | **零改动**（本轮只调用既有工具） |
| 策略/研究口径 | **零改动**（T+20、修复规则、二次入场、仓位、排序、Runner、成本、seed 全部保持） |
| 数据库 | **零写入**（无 SELECT 之外的任何操作，无 DDL/DML/migration，无历史 Run 回填） |
| Dataset | **未构建新版本**，未改 780004 |
| Run | **未产生 Run**（工具为诊断模式，未走 `startRun` 持久化） |
| 历史 Run | **未覆盖** |

---

## 9. 终态

**`ST_COVERAGE_BLOCKED`（预期且合规）。**

- 已执行到 **SMOKE 数据前置**；**未产出收益矩阵**；**未运行 STUDY**；**未重复运行**。
- `BLOCKED` 表示**尚无收益结果**，**不能**解读为策略无效，也**不能**视为任务全部完成。
- 下一步需**用户明确授权数据引入**；在此之前任何 42 账户运行都只会在同一闸门处以同一原因收口。
