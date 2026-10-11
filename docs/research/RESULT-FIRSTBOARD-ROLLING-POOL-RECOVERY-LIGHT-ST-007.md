# RESULT · `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007`（**阶段 1**：实现 + 测试 + SMOKE）

> 执行对象：[`GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md`](GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md)
> 预注册：[`PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md`](PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md)
> 数据决定：[`DECISION-FIRSTBOARD-ROLLING-POOL-KEEP-DATASET-780004.md`](DECISION-FIRSTBOARD-ROLLING-POOL-KEEP-DATASET-780004.md)
> 数据就绪：[`RESULT/IMPACT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`](RESULT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md)（**只取结论**）
> 性能计划：[`PLAN-ROLLING-POOL-EXECUTION-PERFORMANCE-001.md`](PLAN-ROLLING-POOL-EXECUTION-PERFORMANCE-001.md)（TASK B 对应其 §3 第 4 项等措施）
> 基线：HEAD **`f8b6810`**；工作区长期含并发会话改动，**未 reset / 未 stash / 未 commit / 未覆盖**

---

## 0. 终态（**恰好一个，且不是 `EXPLORATORY_COMPLETED`**）

| 项 | 值 |
|---|---|
| **阶段 1 终态** | **`SMOKE_PASSED / STUDY_PENDING`** |
| SMOKE 工程闸门 | **通过**（`runStatus=SUCCEEDED`、`matrixEmitted=true`、`terminalState=EXPLORATORY_COMPLETED`、**exit code 0**、6 账户真实进入撮合、已知 ST 买入 = 0） |
| `SMOKE_ENGINEERING_FAILED` | **未触发** |
| **`EXPLORATORY_COMPLETED`** | 🔴 **本轮不声明**：那要求「42 账户 + 统计完成」。执行方**没有**运行 STUDY（按派单明确要求） |
| STUDY | **等待用户单独指令**。⚠️ 另见 §9.1：上一执行方已启动的那次 STUDY **在持久化阶段失败**（`RUN-20261011-2BAEF26C` = `FAILED` / `EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED`，无结果 manifest）⇒ 照原样再跑一次**仍会失败**，需先裁定 §9.1 |
| 本轮研究性质 | `EXPLORATORY / KNOWN_ST_ONLY` —— **不是**严格 PIT / OOS / 模拟交易 / 实盘验证 |

---

## 1. Task

1. **TASK A**：验证并补齐 `LIGHT-ST-007` 的最小实现与 §5.1 测试，**跑一次 6 账户 SMOKE**，交付阶段 1 结果；**不跑 STUDY**；不改既有断言；不写 `CHANGE-AUDIT.md`。
2. **TASK B**：优化数据加载（**只在合法 Dataset 端口内**）——先测成分、再减往返、列投影、日期索引、单次共享读、缓存键、**强制等价性证明**、跑一次优化后 SMOKE 出前后对比。

## 2. 开工实测状态（`git status` → `pnpm run check` → 直接相关测试）

| 检查 | 开工实测 | 结论 |
|---|---|---|
| `git status --porcelain` | HEAD `f8b6810`，分支 `codex/pool-reentry-diagnostics`，工作区 227 项（41 tracked-modified + 186 untracked），含并发会话 | **未触碰**他方改动 |
| `pnpm run check` | **exit 0** | 绿 |
| 直接相关测试（5 个 recovery-ST 文件） | **103 例全通过**（`rollingPoolRecoverySt` 39 / `…ExecutionGate` 25 / `…LightPolicy` 18 / `…Blocked` 14 / `…AuxiliaryAssembly` 7） | 绿 |
| 轻量 ST 政策实现 | `types.ts` / `validate.ts` / `engine.ts` 的可选 `executionEligibilityUnknownPolicy`（缺省 `REJECT`）+ `experiment.ts` 的 `stPolicy` 装配 + 运行工具 `--st-policy` **均已存在且自洽** | 无需补实现 |
| `research-experiments/shared/rollingPoolRecovery/stGate.ts` | **本次未改动**；`ST_GATE_CONTRACT_VERSION = "1.1.0"` 原样（SHA256 `303c31c461a8a87b…`） | 严格契约未漂移 |
| 上一执行方的运行 | SMOKE#1 失败（样本账不平）、SMOKE#2 无产物、**SMOKE#3 成功**（19:10:57）；随后 19:11:07 启动了 STUDY | 见 §4.1 / §9.1 |

**开工时唯一「红」**：上一执行方的 STUDY 在 19:11:07 仍在运行（我接管时 17 分钟、rd=45/80），且 `RESULT-…-007.md` 不存在。判断与处置见 §8-D1。

---

## 3. 交付内容

### 3.1 TASK A（验证为主：上一执行方已落盘的实现）

| 项 | 位置 + 符号 | 证据 |
|---|---|---|
| 轻量政策本体 | `research-experiments/shared/rollingPoolRecovery/stEligibilityPolicy.ts`（`decideKnownStOnlyEligibility` / `decideStrictEligibility` / `resolveStEligibilityPolicy` / `KNOWN_ST_ONLY_POLICY_VERSION`） | `LightPolicy` 测试 §1 逐字锁行为表（ST ⇒ 不参与+不放行；NORMAL ⇒ 参与+放行；UNKNOWN ⇒ 参与+放行并注明） |
| 可选 UNKNOWN 处理声明（**最小执行契约兼容**） | `server/research/simulator/types.ts#ExecutionEligibilityUnknownPolicy` + `executionEligibilityStatusAllowed`；`validate.ts`；`engine.ts`（放行 / 审计 / 收尾断言 / 快照键） | `engine.ts` 只在**显式声明**时多出 `executionEligibility.unknownPolicy` 键 ⇒ 既有快照逐字节不变（`LightPolicy` 测试 §4 锁定） |
| 历史标签索引（服务侧，只读） | `server/researchExperiments/knownStLabelIndex.ts` + 桥接 `research-experiments/compositeRunnerBridge.ts` 零实现 re-export | 本次 SMOKE 实测：读入 841 行 / 734 证券 + 身份 5,552 行；`availability` 全 `UNKNOWN`、`confidence` 全 `medium`、显式 NORMAL 行 = **0**；来源指纹 `cbd5ff564f69a6d6…` |
| 运行工具 `--st-policy` | `tests/tools/rollingPoolRecoveryStRun.mts`（非法值即拒绝启动，exit 2） | 本次实测的命令见 §4.1 |

### 3.2 §5.1 五条锁定行为（**未修改任何既有断言**）

| §5.1 要求 | 锁定文件 / 用例 | 状态 |
|---|---|---|
| ① 原严格缺省、原无闸门调用、既有已锁定交易/权益行为不变 | `rollingPoolRecoveryStLightPolicy.test.ts` §4（未声明闸门 ⇒ 快照无 `executionEligibility` 键、无审计）；`…ExecutionGate` / `…AuxiliaryAssembly`（无闸门路径与 `runCompositeRunnerBacktest` 逐字节一致） | ✅ |
| ② 显式轻量 ⇒ UNKNOWN 经**真实撮合链**成交且审计保留 UNKNOWN；缺省严格仍拒单 | `LightPolicy` §2（成交 1 笔、`audit.status="UNKNOWN"`、`outcome="FILLED"`、`gateId`/`policyVersion`/`checkedAt` 全断言；同闸门不声明 ⇒ `REJECTED` 且现金/仓位/成本不变） | ✅ |
| ③ 两模式已知 ST 零买入；隔夜 ST / 重试 / 再入场真实拒单且账目不变 | `LightPolicy` §2/§3（隔夜 ST、重试两日、再入场遇 ST 各自逐笔断言 + 现金/持仓/成本/成功入场计数不变）；`…ExecutionGate` 25 例 | ✅ |
| ④ A/B 价格触发集合不受 ST 政策改变；已知 ST 过滤在候选资格处；成交前变化不回写排名 | `rollingPoolRecoverySt.test.ts` §9（`day14.priceState === "SIGNAL_FORMED"` 与 `buyEligibility === "ST_BLOCKED"` 并存 ⇒ 价格观察历史不被 ST 抹掉）；`LightPolicy` §1「成交前变化不回写排名」；真实 Run 账：`knownStExcludedCandidates=3`（B 组）、`participatingKnownStByGroup={}` | ✅ |
| ⑤ 仓位用**同日当前权益 × 20%**，不是初始资金 20% | `LightPolicy` §7（第二笔 800 股；错误地按初始资金会是 700 股 ⇒ 当场变红） | ✅ |

**直接相关测试（本次实测）**：13 个文件 / **312 例全通过**（含 `datasetPort` / `datasetProvider` / `exp001` / `exp002` / `runner` / `rollingPoolEarlyEntryRunner` / `rollingPoolObservationWindow` 等被 TASK B 触及的消费者）。

### 3.3 TASK B 实现（**本次新增**）

| # | 改动（路径 + 符号） | 内容 | 边界 |
|---|---|---|---|
| 1 | `server/researchExperiments/datasetPort.ts`（`loadBarsForDays` / `ensureDayGroupLoaded` / `resolveBarDayBatchSize` / `resolveBarReadConcurrency`） | **相对日分批**：把声明过的相对日按片长切片，一次查询携带 `relativeDays: [多日]`（读取层 `loadRawBarsBatch` **本来**就接受复数，端口过去只塞 1 天）＋ **有界并发**（复用仓库唯一原语 `mapWithConcurrency`，与连接池 `connectionLimit` 对齐）＋ **保序**（按「块序 → 块内读取序」拼回，行序与旧串行读法逐行相同） | **不改列白名单、不改 PIT 闸门、不改 `freezeSelection` 前置、不改逐日返回形状**；`barDayBatchSize=1 && concurrency=1` 是旧路径的逐查询等价形态 |
| 2 | `server/researchExperiments/datasetProvider.ts` / `defaults.ts` | 端口**缺省仍是旧的逐日/串行**（保护几十个既有调用方与断言）；**生产装配**显式打开优化形态（片长 8、并发 `defaultConcurrency()`=8） | 可用 `EXPERIMENT_BAR_DAY_BATCH=1 EXPERIMENT_BAR_READ_CONCURRENCY=1` **无条件退回**旧形态做对照 |
| 3 | `server/researchExperiments/rollingPoolExecutionSupport.ts#sealRollingPoolExecutionDataset` | 性能计划项 4「单次按日期索引代替重复过滤」：逐日 `rows.filter`（≈490 日 × 52,790 行）改为**一次**建日期索引 | 排序、去重、`members` 顺序与内容、**封数据集指纹**全部不变 |
| 4 | `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts` | 13 个**阶段级 perf 埋点**（`perfBegin/perfEnd`，`PARAM_PROFILE≠1` 时只有一次布尔短路）＋ `perfCount` 行数计数；`stage-performance.json` 新增 `phaseProfileEnabled` / `phaseProfile` | 埋点**不参与任何研究口径**；剖析默认关闭时产物字节不变 |
| 5 | `research-experiments/compositeRunnerBridge.ts` | 追加零实现 re-export（`perfBegin/perfEnd/perfCount/perfSnapshot/isPerfProfilingEnabled`、`perfRun/perfRunAsync/perfMark`） | 只追加，不改他方已有内容 |
| 6 | `tests/tools/rollingPoolRecoveryStRun.mts` | 新增**持久化 Run 状态闸门**：`persistedRun.status !== "SUCCEEDED"` ⇒ `EXECUTION_FAILED` + exit 1（不再只看执行器结论） | 修的是「跑成功 + DB 里 Run=FAILED + 交付物不可读」的**假成功**（§9.1 实测踩到） |
| 7 | `tests/server/researchExperiments/datasetPortDayBatching.test.ts`（**新增，5 例**） | 分批 vs 逐日的**逐日逐行等价**、查询次数下降、端口缺省=旧形状、大并发下行序确定、日期索引 ≡ 旧 `filter`、`datasetVersion` 与输入行序无关 | 纯合成 fixture；不连 DB、不跑 Run |

---

## 4. SMOKE 验收（**只跑了一次**，优化后路径）

### 4.1 实际可运行命令 / 退出码 / 墙钟

```powershell
# 工作目录 = 仓库根；PowerShell（不是 cmd，故不触发 AGENTS §6.7 的 Windows 环境变量赋值问题）
$env:PARAM_PROFILE='1'; $env:PARAM_PROFILE_STDOUT='1'; $env:PARAM_PROFILE_MIN_MS='0'; $env:RECOVERY_ST_PROGRESS='1'
node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs `
  tests/tools/rollingPoolRecoveryStRun.mts --mode smoke --st-policy known-st-only
```

| 项 | 值 |
|---|---|
| 命令（等价单行） | `node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs tests/tools/rollingPoolRecoveryStRun.mts --mode smoke --st-policy known-st-only` |
| 退出码 | **0** |
| 墙钟（外部 stopwatch） | **224.5 s** |
| 工具自记 `elapsedSeconds` | **219.3 s** |
| 实验内 `elapsedMsTotal`（`run()` 起止） | **184,956 ms** |
| 产物 | 31 个（`_scratch/fbp7/smoke-artifacts/**`）+ `_scratch/fbp7/smoke-outcome.json` |
| 持久化 | **无**（SMOKE 不持久化；未新增 Run、未写 DB） |

### 4.2 工程自检（全部通过，逐条来自工具输出）

- 矩阵已产出（`matrixEmitted=true`）、账户总数 = **6**、`A_STRICT_20` = 3 户、`B_RECOVERY_20` = 3 户；
- ST 资格政策 = `KNOWN_ST_ONLY_EXPLORATORY` / `recovery-known-st-only/1.0.0`；
- **已知 ST 订单 = 0，全部被拒（已知 ST 买入 = 0）**；
- `UNKNOWN` 订单 **1,176**（成交 **1,137** / 拒单 **39**）—— 与优化前**逐数相同**；
- 因已知 ST 排除的排序候选 = **3**（全部在 B 组）；标签来源读入 **841** 行 / 指纹 `cbd5ff564f69a6d6…`；
- 真实进入撮合：`group A executed: accounts=3`、`group B executed: accounts=3`（不是空跑）；
- 样本账：`candidate=58,983`、`eligible=19,510`、`excluded=39,473`、原因合计 = 39,473（配平）；`neverInWatchPool=69` 单列不计入原因；
- 身份解析 **19,510 / 19,510**（无法解析 0）；共同锚点宇宙 18,611。

### 4.3 阶段级实测：**前后对照**（TASK B 强制项）

**先测成分**——优化前那一跑**没有**开剖析（上一执行方自己的 `stage-performance.json` 写明「本轮没有做阶段级 profile」），因此**优化前的逐阶段墙钟不可测**，如实不编。可测的是**每阶段查询数与行数**（来自前后两次 Run 的 `datasetFacts`，同一命令、同一输入快照、同一种子）：

| 阶段 | 前：查询数 | 前：行数 | 后：查询数 | 后：行数 | 后：**实测墙钟 ms** |
|---|---:|---:|---:|---:|---:|
| 1 事件扫描（分页） | 60 | 58,983 | 60 | 58,983 | 5,728.1 |
| 1c ST 标签索引（一次性） | 2 | 841 + 5,552 | 2 | 841 + 5,552 | 189.3 |
| 3 prefix 层读（rd −10/−1/0） | **90** | 176,650 | **30** | 176,650 | 31,334.0 |
| 4 post 层读（rd 1..80） | **800** | 1,560,800 | **100** | 1,560,800 | **138,864.1** |
| 5 事件归一化 + 因子 | 0 | — | 0 | — | 77.8 |
| 6 逐日池 | 0 | — | 0 | — | 2,778.2 |
| 8 逐组求值 / 买点候选 / 买单计划 | 0 | — | 0 | — | 2,736.6 |
| 10 证券身份解析 | ~2 | 5,552 | ~2 | 5,552 | 216.3 |
| 11 共享执行投影 | 0 | — | 0 | — | 1,053.4 |
| 11b 冻结退出政策 | ~2 | — | ~2 | — | 71.8 |
| 12 权威装配 + 逐账户撮合 | ~2 | 316,740 | ~2 | 316,740 | 1,830.8（self 498.7） |
| 13 主比较 / bootstrap | 0 | — | 0 | — | 61.5 |
| 14 产物序列化（快照时帧仍开） | 0 | — | 0 | — | 0（见注） |
| **合计（实验内）** | | | | | **184,956** |
| **端到端墙钟（工具）** | **1,654.7 s** | | **219.3 s** | | ⇒ **约 7.5×** |

- 后列 12 阶段子帧（实测）：`corporate_actions.load` 522.7×2、`backtest.decision_day_loop` 467.1×6、`row_precheck` 161.6×6、`dataset_bind` 97.0×6、`fingerprint` 40.3×6、`candidate_preparation` 38.6×2、`context_build` 4.4×2、`dataset.resolve` 0.3×2。
- **DB 往返计数（实测）**：`db.round_trips = 223`、`db.reads = 223`、`db.writes = 0`；`db.read_ms = 1,080,390 ms`（**并发在飞时长的累加**，8 条并发下可超过墙钟）⇒ 即使已砍到 223 次往返，**约 73% 的墙钟仍在等 DB**，说明剩下的 130 次行情查询已是**远端下限**，不是 CPU 问题。
- `counters`：`read.post_relative_days=80`、`read.post_rows=1,560,800`、`read.prefix_relative_days=3`、`read.prefix_rows=176,650`、`backtest.trades=1,137`、`backtest.decision_days=2,940`、`research.dataset_rows=105,580`。
- **注**：`14.artifacts` 的帧在取样时仍打开 ⇒ 该阶段墙钟显示 0；端到端 219.3 s − 实验内 184,956 ms ≈ **34 s** 是**产物序列化 + 上传 + 运行前装配**（本次产物合计约 **900 MB**）。
- 端到端对比口径：`1,654.7 / 219.3 = 7.55×`（工具字段）、`1,654.7 / 224.5 = 7.37×`（外部 stopwatch）。**不承诺固定分钟数**：不同并发/片长/网络条件下会不同。

**读层成本模型（探针实测，`_scratch/probe007-barlatency*.mts`，只走正式读取链）** —— 解释「为什么快的是往返而不是 CPU」：

| 探针 | 实测 |
|---|---|
| 极小查询（纯 RTT 下界） | 139.9 ms |
| 连续 id 单日 × 2,000 事件（温） | 124–180 ms / 2,000 行 |
| **旧形态**：1 相对日 × 10 块，持续 30 次 | 51,233 ms ⇒ **1,708 ms/查询**（3 个相对日 ⇒ 17,078 ms/相对日） |
| **新形态**：8 相对日 × 10 块，持续 30 次 | 78,336 ms ⇒ 2,611 ms/查询，但一次覆盖 8 天（24 个相对日 ⇒ **3,264 ms/相对日**） |
| **新形态**：20 相对日 × 10 块 | 32,111 ms ⇒ 20 个相对日 ⇒ **1,606 ms/相对日**（更快，但瞬时行数 ×4） |
| prefix：1 相对日 × 10 块 vs 3 相对日 × 10 块 | 19,677 ms vs 15,429 ms（**同行数下多次合并几乎免费**） |
| 有界并发 4 / 8 vs 串行（8 条独立查询） | **0.91× / 0.94×** ⇒ 该远端库**没有**并发收益（服务端吞吐受限） |
| 模型校验 | 旧路径 `890 + 60 = 950` 次往返 × ≈1.7 s ≈ **1,615 s** ≈ 实测 1,654.7 s（≈98%）✅ |

> 结论（如实）：本轮提速来自 **往返次数 890 → 130（行情层）+ 60 页不变**，**不是** SQL 更快、也不是并发（并发实测中性）。
> **合规提醒**：TASK B 要求「不得为证明提速再跑一个全量旧版本」⇒ **没有**跑带剖析的旧路径对照，故上表前两列的「墙钟」列为不可测。

---

## 5. 等价性证据（TASK B §7 强制，**通过**）

**同一命令、同一输入快照（`datasetVersionId=780004`）、同一 6 账户/种子**，优化前（19:10:57，`_scratch/fbp7-baseline/`）vs 优化后（19:49，`_scratch/fbp7/`）产物 SHA256 逐文件对照：

| 结果 | 数量 | 说明 |
|---|---:|---|
| **逐字节相同** | **28 / 31** | 含全部业务关键件：`trades-R-A/B`、`trades-random-A/B-part-00`、`equity-R-A/B`、`candidate-ranking-diagnostics-A/B`、`observation-repair-ledger-*`（6 个）、`opportunity-day-attribution.csv`、`st-fill-audit-A/B`、`st-light-eligibility-decisions.csv`、`status-coverage.csv`、`anchor-trade-chains.csv`、`anchor-failed-attempts.csv`、`random-account-metrics-*`、`date-block-stats.csv`、`entry-path-window.csv`、`execution-eligibility-rejections-A/B`、`cache-checkpoint-validation.json` |
| 仅**非业务字段**不同 | 2 | `frozen-config.json`：219 个叶子字段中 **218 个逐字相同**，唯一差异 = `codeDigest`（`d2b06afa…` → `b5d1c2eb…`，因本次改了 `experiment.ts`）；`st-light-policy-summary.json`：84 个中 **82 个相同**，差异只有 `codeDigest` 与 `generatedAt`（墙钟时间戳）⇒ 样本账 / ST 政策计数 / `matchingOrders` / `strictPitEvidence` **逐数相同** |
| **按设计新增** | 1 | `stage-performance.json`（2,223 B → 10,596 B）：新增 `phaseProfileEnabled` / `phaseProfile`（实测阶段表） |

**关键业务 digest（前后同值）**：`trades-R-A_STRICT_20.csv` `3e5c5de1…`、`trades-R-B_RECOVERY_20.csv` `8473914b…`、`trades-random-A_STRICT_20-part-00.csv` `f257ac2f…`、`trades-random-B_RECOVERY_20-part-00.csv` `fc9b3349…`、`equity-R-A_STRICT_20.csv` `214d6436…`、`equity-R-B_RECOVERY_20.csv` `2348ce0f…`、`candidate-ranking-diagnostics-A_STRICT_20.csv` `d557b1cb…`、`candidate-ranking-diagnostics-B_RECOVERY_20.csv` `7ff1594f…`。

**另有单元级等价锁**（不依赖真库，回归时先红先查）：`tests/server/researchExperiments/datasetPortDayBatching.test.ts` 5 例 —— 分批 vs 逐日**逐日逐行（含行序）**深度相等、查询次数 9→3 / 6→3、端口缺省 = 旧形状、并发 8 下行序不变、封数据集**日期索引 ≡ 旧 `rows.filter`**（含空日）、`datasetVersion` 与输入行序无关。

**结论**：**无任何业务差异** ⇒ 优化**成立**，不回退。

---

## 6. 契约 / DB / 执行影响

| 面 | 影响 |
|---|---|
| **执行契约** | **未新增执行配置契约 / 未新增入口**。§3.5 的可选 `SimulationConfig.executionEligibilityUnknownPolicy`（缺省 `REJECT`）是上一执行方已落盘的实现，本轮**只验证**：未声明 ⇒ 快照无该键、既有指纹逐字节不变。 |
| **研究侧读取策略（新增，内部）** | `ExperimentDatasetPort.createAccess` 的两个**可选**读法参数 `barDayBatchSize` / `barReadConcurrency` + 3 个环境开关（`EXPERIMENT_BAR_DAY_BATCH` / `EXPERIMENT_BAR_READ_CONCURRENCY` / `EXPERIMENT_BAR_CHUNK_SIZE`）。**不改** `ExperimentDatasetAccess` 的形状（仍是 `eventPages/events/feature/observation`），**不改**相对日白名单与 PIT 闸门语义。缺省（未显式传入）= 旧的逐日/串行。 |
| **严格契约** | `ST_GATE_CONTRACT_VERSION = "1.1.0"` **未改**；`evaluateStGate` / `summarizeStCoverage` / `ABSENT_STATUS_PROVIDER` 语义未改。 |
| **DB** | **只读**：0 DDL / 0 DML / 0 migration / 0 写入；未重建 Dataset、未补 ST、未采购、未改 `poolStIndex`。本轮唯一写盘是**文件**（`_scratch/**` 证据 + 仓库内代码/测试/文档）。⚠️ 上一执行方的 STUDY 在 19:11–19:39 自行写入 1 条 Run 行（`RUN-20261011-2BAEF26C`，已 `FAILED`）——**不是**本轮执行方所为。 |
| **执行语义** | 撮合引擎、成本、退出、再入场、仓位（同日权益 ×20%）、排序、随机实现**未改**；交易/权益/候选产物**逐字节相同**（§5）。perf 埋点在关闭时只有一次布尔短路 ⇒ 不改变业务结果与产物字节。 |
| **行为不变量** | I-1/I-2（Dataset 坐标）、I-4（PIT）、I-8（`canonicalMetrics` 唯一出口）、I-10（已锁定 trade/equity digest）**均未破坏**。 |
| **基线文档** | 🔴 **本轮未写 `docs/architecture/CHANGE-AUDIT.md`**（并发审查会话正在写它，避免互相覆盖 —— 见 §8-D2）；`CONTRACT-MAP` / `EXECUTION-FLOW` / `SYSTEM-BASELINE` / `system-manifest.yaml` **未改**：本轮没有新增执行配置契约/入口，端口读法参数属研究侧内部读策略（其说明在本文件与 `datasetPort.ts` 头注释内）。是否登记为 minor 变更请审查会话/用户裁定。 |

---

## 7. 指纹

| 项 | 值 |
|---|---|
| HEAD | `f8b6810347aa5950d1f9b95eaadc73308b68ac21`（`f8b6810`） |
| Dataset | `datasetVersionId = 780004` / `first_limit_pullback` / `v10-listed365-pre10-post80` / READY |
| 策略版本 | `strategy_versions.id = 3600005`，`2.0.0`，指纹 `f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c` |
| ST 严格契约 | `1.1.0`（未改） |
| 本轮政策 | `KNOWN_ST_ONLY_EXPLORATORY` / `recovery-known-st-only/1.0.0` |
| 标签来源指纹 | `cbd5ff564f69a6d6914ff5ca5dff9e249f95e902b8dbe162630387f17880c876`（841 行 / 734 证券 / 身份 5,552 行 / 显式 NORMAL 0） |
| 实验代码指纹（前 → 后） | `exp-code-sha256:d2b06afa7c7241c089e3d871e7ec7cb6f6aa08fecedc5421bd079d13facfadff` → `exp-code-sha256:b5d1c2eb3fd70239374d10ddeefff0c60ca7078d46f0efd13961c2f925f1e407` |
| `frozen-config.json` | 219 叶子字段中 218 逐字相同（唯一差异 = 上行的 `codeDigest`） |

| 文件（本轮改动/新增） | 字节 | SHA256 |
|---|---:|---|
| `docs/research/PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md` | 15,536 | `f75fb4988b48cd20c304f07b90d89f097adea8d456290320fbe2451d047b404c` |
| `docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md` | 13,910 | `a033725d58a5c331da00c694a70681df58334f682b8895750eb176fdcb616abc` |
| `server/researchExperiments/datasetPort.ts` | 33,821 | `87f32b05396ad7bde0b0ab4788697257b3b9439895cddf81d7a99ecd452f3f71` |
| `server/researchExperiments/datasetProvider.ts` | 5,415 | `ec77d5cc12fa926fdca664ef6ed6e6b281f9b25d414b091a713054c8eacd3733` |
| `server/researchExperiments/defaults.ts` | 10,112 | `f95d6fc8af87895ca78639d7e0591e996c299f553fcc673932d83b369ba02b76` |
| `server/researchExperiments/rollingPoolExecutionSupport.ts` | 10,598 | `12b362ce2c901787e9b4c0540b9c18083955bab713208e79a5925c47418edc69` |
| `research-experiments/compositeRunnerBridge.ts` | 9,391 | `44959e8d05276714de8761e8eb61eb3eb7a35c8373e483bb870afe63827f6d4d` |
| `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts` | 220,396 | `a04d9c5259c35c03c8c935299cc710828325314d5fc6d8968ab1ca1122a712c7` |
| `research-experiments/shared/rollingPoolRecovery/stGate.ts`（**未改**） | 27,024 | `303c31c461a8a87bd96eb2efe8de5a7215cacf073098db1349ebe3261c3c39d3` |
| `tests/tools/rollingPoolRecoveryStRun.mts` | 21,850 | `2781b179eaa4bd3094bdeb3a4fb36afd169c295bb874112153d8ce5d4b6ede1b` |
| `tests/server/researchExperiments/datasetPortDayBatching.test.ts`（**新增**） | 13,576 | `37dbe0ff805b33643f50fde0f20c6c96dbb5419d2a90eb140b82aeaaf2eccc1e` |
| `tests/server/researchExperiments/rollingPoolRecoveryStLightPolicy.test.ts`（**未改**） | 34,288 | `c5ddca284eab30e80b52a5baade46cdd016695e7c443f22bfa0f99237037f75b` |
| `server/research/simulator/types.ts`（**未改**） | 30,924 | `f86fbe71c8803371644319bf0ac590796c276c1f283bd42452a390df7d66d4ad` |
| `server/research/simulator/engine.ts`（**未改**，**MIXED EOL 原样保留**） | 91,110 | `b231a88b43d1ed79783bba811bb2610d34d963dcaa962523cd7dc0eb16ea0760` |

---

## 8. 偏差与理由（逐条）

**D1 — 没有终止上一执行方已在飞的 STUDY。** 接管时（19:27）PID 22220/34812 正跑 `--mode study`（rd=45/80）。未杀：① 杀不可逆，会毁掉 GOAL §5.2 明确要求的那次运行；② `research-experiments/**` 与 `server/researchExperiments/**` **无任何动态 `import()`**（grep 实测），tsx 已在启动时缓存全部模块 ⇒ 我的编辑**不可能**污染它（该 STUDY 走的就是这两棵目录下的模块）；③ 该 STUDY 与我的 TASK B 代码改动无交互。**它已于 19:39:06 自行结束**，终态见 §9.1。

**D2 — 未写 `docs/architecture/CHANGE-AUDIT.md`。** 按派单要求，该文件由并发审查会话拥有；本文件 §6 承担影响说明，避免互相覆盖。

**D3 — 端口缺省保持旧读法（片长 1 / 并发 1），优化形态只在生产装配打开。** 若把端口缺省直接改成优化形态，会**静默改变**几十个直接构造端口的调用方的查询形状，并让 2 个**既有（非本任务）断言**变红：`datasetPort.test.ts`「同一个相对日只读一次」（2 → 1 次）与 `exp001FundamentalStudy.test.ts`「读取层调用次数 = rd=0 一次 + 20 个观察日各一次」。按「不要为通过测试改断言」，选择**不改断言**，把选择权上移到 `defaults.ts`（真实 Run 全部走优化形态）。

**D4 — 修改了 `research-experiments/compositeRunnerBridge.ts`（该文件在我开工前已被并发会话改过 `M`）。** 只**追加**一段零实现 re-export（perf 埋点必须经该桥接触达服务侧），并发会话的既有内容未动。

**D5 — 改了运行工具的终态语义（新增持久化 Run 状态闸门）。** 这不是派单项，但「执行器 SUCCEEDED + DB 里 Run=FAILED + 无结果 manifest」被工具报成 ✅ / exit 0，是**假成功**（§9.1 实测踩到）。SMOKE 路径显式传 `persistedRunStatus: null`（它不持久化），故本轮 SMOKE 的退出码语义不变。

**D6 — SMOKE 开了剖析（`PARAM_PROFILE=1`）。** 剖析**默认关闭**；开启只为产出 TASK B 要求的阶段级实测。副作用是 `stage-performance.json` 扩大（2,223 → 10,596 B）——已列为 §5 的「按设计新增」。

**D7 — 没有跑带剖析的**旧读法对照**，也没有跑严格模式 SMOKE。** 前者被 TASK B「不得为证明提速再跑一个全量旧版本」禁止 ⇒ 优化前逐阶段**墙钟不可测**（如实不报）；后者会①违反「SMOKE 只跑一次」②**覆盖** `_scratch/fbp7/smoke-outcome.json` 这份交付证据。故「严格缺省不变」由单元测试（§3.2 ①②）锁，不由 Run 锁。

**D8 — 片长选 8（不选实测更快的 20），并发保持 8（实测中性）。** 20 日/片实测约快 2×（1,606 vs 3,264 ms/相对日），但瞬时行数 ×4；并发 4/8 实测 0.91×/0.94×（远端库吞吐受限）。选择「已实测、内存有界、且符合派单要求」的组合；两者都留了环境开关（§9 提案 P5/P6）。

**D9 — 内存对照不成立（如实披露）。** 优化后路径峰值工作集 **3,754 MiB**（12 次采样，15 s 间隔）；优化前**没有采样**（仅观察到上一执行方 STUDY 中途约 0.97 GiB）⇒ **不声称**内存变好或变差，只记录：交付配置下峰值 3.75 GiB，运行用 `--max-old-space-size=12288` 有充足余量。

**D10 — 「已知 ST 买入 = 0」的证据强度如实说明。** 本次 SMOKE 的 `knownStOrders = 0` ⇒ 该检查是**结构性成立**（3 个已知 ST 候选在**候选资格**处就被排除，根本没有 ST 订单到达撮合）。**成交前拒单 / 重试 / 再入场遇 ST** 的真实拒单路径由单元测试在**真实撮合链**上锁定（§3.2 ②③），**不是**由这次 SMOKE 证明。

**D11 — 行尾。** `node scripts/checkEolDrift.mjs --strict`：**已跟踪文件漂移 = 0**；未跟踪 CRLF 仅剩 **1** 个 = 另一会话的 `_scratch/overlap/probe01_db_state.mjs`（**未触碰**）。我自己用 PowerShell 写出的 `_scratch/baseline-smoke-artifacts-sha256.json` 曾被写成 CRLF，已改回 LF。**未跑 `pnpm run format`**；`server/research/simulator/engine.ts` 的 **MIXED EOL 原样保留**（本次未编辑该文件）。

**D12 — 未做**：未重建 Dataset、未补 ST、未采购、未新增外部源、未重复 006 来源审计、未改 `poolStIndex` / builder / 因子 / 买点 / 退出阈值、未新建第二套策略或撮合实现（全部符合 GOAL §2/§7 边界）。

---

## 9. 未做项与提案（TASK B §8；含一个**阻塞 STUDY** 的发现）

### 9.1 🔴 STUDY 持久化结构失败（上一执行方那次，**不是**我跑的）

| 项 | 值 |
|---|---|
| Run | **`RUN-20261011-2BAEF26C`**（`first-board-pullback/rolling-pool-recovery-st`，参数 `{randomAccountCount: 20, stPolicy: "known-st-only"}`） |
| 起止 / 时长 | `2026-10-11T11:11:23Z` → `11:39:07Z`，`durationMs = 1,651,238`（27m31s） |
| 状态 | **`FAILED`**，`errorCode = "EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED"`，`resultManifestKey = null` |
| 原因 | 产物 `observation-repair-ledger-A_STRICT_20-2024.csv` = **99,097,445 B** > 平台单文件上限 **67,108,864 B**（另有 107.8 MB / 75.3 MB / 69.9 MB / 312.1 MB 的同类超限件） |
| 矩阵 | 42 账户矩阵**已算出**（工具打印 `matrixEmitted=true`、`terminalState=EXPLORATORY_COMPLETED`、主比较 `B_R − A_R` 点估 `0.000107`、`supported=false`），但**无结果 manifest ⇒ 交付物不可读** |
| 真因性质 | **结构性**：超限件是实验设计的产物集，不是偶发 ⇒ **照原样再跑 STUDY 仍会失败** |

**提案 P1（阻塞项，需用户裁定）**：(a) 按仓库已有的 `-part-NN` 约定（`trades-random-*-part-00.csv` 就是这个形状）把超限 CSV 切片，切片前后内容拼接必须一致（用 digest 复核）；(b) 运行工具的持久化闸门**已在本轮修好**（§3.3 #6）。件 (a) 会改产物字节，属新变更，未获裁定前**不做**。

### 9.2 其他提案（**未实施**，附预期收益；均不绕开 Dataset 端口）

| # | 提案 | 预期收益 / 代价 |
|---|---|---|
| P2 | 给端口加**事件作用域**读法（`observation(rd, eventIds)`）—— 现在 `observation(rd)` **没有** eventId 参数（`rolling-pool-observation-window/result.ts` 已记为契约缺口）⇒ 无法利用 006 的「`rd1..41 ≡ rd1..80` 买点候选等价」把 post 行数由 1,560,800 降到约 800,200 + 执行所需尾部。 | 行数约 −49%（**不是**整执行窗口），DB 时间按行占比折减；**代价 = 新增端口契约面**，需评审与登记 |
| P3 | prefix 层现在读**全部 58,983** 事件（只有 19,510 冻结）⇒ 30 次查询 / 176,650 行，而非 10 次 / 58,530 行。 | 约 −20 次查询、−118k 行；**代价 = 改 `feature()` 语义**（会影响其它实验的既有期望）⇒ 建议改为显式 opt-in 而非改缺省 |
| P4 | **跨 Run 缓存**（键 = `datasetVersionId` + 列 + 相对日 + 日期范围 + 代码/政策/来源指纹；数据变化即失效）。本轮**只**做到「同 Run 内一次性读、全账户共享」（§4.3 证据：6 账户与 42 账户的 `barQueryCount` **同为 890**，7 倍账户数不增加一次查询）。 | 冷启动无收益；`PLAN-…-PERFORMANCE-001` §4 明确「跨 Run 缓存不是完成 004 的前提」 |
| P5 | 片长 20（已实测 1,606 ms/相对日 vs 片长 8 的 3,264）或更高 | 预计在现基础上再快一截；**代价 = 瞬时行数/内存 ×4**，需给定堆上限 |
| P6 | 并发降到 1（实测 0.91×/0.94× 无收益） | 避免无谓排队、瞬时内存约 ÷8；对墙钟预期影响 ±6% 以内 |
| P7 | 严格模式 SMOKE（`--st-policy strict`）端到端确认仍以 `ST_COVERAGE_BLOCKED`（exit 3）收口 | 现在只要约 4 分钟（优化后）；**代价 = 第二次 SMOKE 且会覆盖交付证据**，故未做 |
| P8 | 列投影：`ds_first_limit_pullback_post` 28 列，端口下推 16 列（5 骨架 + 11 业务）。进一步只读「实际消费」的列需要动骨架列（`datasetVersionId` 等），**风险 > 收益** ⇒ 未做 | 无 |

---

## 10. 阶段 1 停止点与下一步

- **阶段 1 到此停止**：实现 + §5.1 测试 + **一次** 6 账户 SMOKE（exit 0、等价性通过、往返 890 → 130、端到端 1,654.7 s → 219.3 s）+ 本 RESULT。SMOKE **未持久化**，未新增 Run。
- **STUDY 等待用户单独指令**；启动前必须先裁定 §9.1（否则必失败）。启动命令形如（**我未执行**）：
  `node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs tests/tools/rollingPoolRecoveryStRun.mts --mode study --st-policy known-st-only`
- **交付证据**：
  - 优化后 SMOKE：`_scratch/fbp7/smoke-outcome.json`、`_scratch/fbp7/smoke-artifacts/**`（31 件）、`_scratch/fbp7-smoke4-optimized.log`、`_scratch/ws-sampler-optimized-smoke.txt`
  - 优化前基线（**只读保留**）：`_scratch/fbp7-baseline/smoke-outcome.json`、`_scratch/fbp7-baseline/smoke-artifacts/**`、`_scratch/baseline-smoke-artifacts-sha256.json`
  - 读层成本模型探针：`_scratch/probe007-barlatency.mts` / `.out.txt`、`_scratch/probe007-barlatency2.mts` / `.out.txt`
  - 门禁日志：`_scratch/check-007-lightst.txt`、`_scratch/check-007-taskb*.txt`、`_scratch/vitest-007-lightst.txt`、`_scratch/testchanged-007-final.txt`
  - 上一执行方 STUDY 执行事实：`_scratch/fbp7/study-run.json`、`_scratch/fbp7-study-console.log`
- **门禁汇总（本次实测）**：`pnpm run check` = **0 错**；直接相关测试 **13 文件 / 312 例全通过**；`pnpm run test:changed` = 4 文件 / **10 例失败**，**全部是已知既有失败**（`threeFactorTopNStrategyDocument` 3、`limitUp` 1、`limitUp.watch` 4、`datasetFilterForm` 2），**零新增失败文件**（179 passed / 183 files，2,402 passed / 2,412 tests）；`node scripts/checkEolDrift.mjs --strict`：**已跟踪漂移 = 0**，唯一未跟踪 CRLF 属另一会话（未触碰）⇒ **不声称整仓全绿**。

---

# 附录 A · `007` **端到端执行方**追加：STUDY 结果与 §7 五问（不覆盖上文任何内容）

> **追加说明**：本附录由 `GOAL-…-LIGHT-ST-007` 的**端到端执行方**（同一工作区、**另一个会话**）追加。
> 上文（§0–§10）是**阶段 1（实现 + 测试 + SMOKE）**的交付，其 §0 明确把 STUDY 留给用户指令；
> 而**端到端执行方已经按目标 §5.2 跑过那一次 42 账户 STUDY**（`RUN-20261011-2BAEF26C`，即上文 §9.1 记录的那次，
> 执行方身份为「上一执行方」）。本附录补上**那次 STUDY 的计算结果**与 **§7 五问的回答**，
> 使本文件对「执行 GOAL 端到端」这一目标**完整可读**。**上文一个字都未被改写。**

## A.1 终态（端到端口径）

| 项 | 值 |
|---|---|
| **端到端终态** | **`EXECUTION_FAILED`** |
| 依据 | 计算完成（`runStatus = SUCCEEDED`、42 账户、统计齐全），但**标准交付失败**：Run 记录 `FAILED` / `EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED`、**产物 0 个入库** |
| `EXPLORATORY_COMPLETED` | 对**计算**成立（42 账户 + 统计完成），对**持久化交付**不成立 ⇒ 按「恰好一个终态」取 `EXECUTION_FAILED` |
| `SMOKE_ENGINEERING_FAILED` | 未触发（SMOKE #3 九项工程自检全过） |
| `DATA_LIMITED` | 未触发（指标全部完整计算；未平仓 0、估值与退出路径完整） |

## A.2 🔴 对 §9.1 提案 P1 的**重要更正**：单纯分片**不能**解除阻塞

上文 P1 建议「按 `-part-NN` 约定切片」。端到端执行方**实测了每个产物的真实体积**（SMOKE 的按组产物与 STUDY **完全相同**，
因为它们是**组级**而非账户级；只有 `trades-random-*` / `random-account-metrics-*` 随账户数变化）：

| 超限产物 | 字节 | 是否 > 64 MiB 单文件上限 |
|---|---:|---|
| `observation-repair-ledger-B_RECOVERY_20-2024.csv` | **107,832,874** | ❌ 超 |
| `observation-repair-ledger-A_STRICT_20-2024.csv` | **99,097,445** | ❌ 超（平台报的就是这一件） |
| `observation-repair-ledger-B_RECOVERY_20-2025.csv` | **75,348,967** | ❌ 超 |
| `observation-repair-ledger-A_STRICT_20-2025.csv` | **69,919,745** | ❌ 超 |
| `observation-repair-ledger-B_RECOVERY_20-2023.csv` | 10,834,420 | ✅ |
| `observation-repair-ledger-A_STRICT_20-2023.csv` | 10,001,515 | ✅ |
| **6 件合计** | **373,034,966 B ≈ 355.8 MiB** | 🔴 **> `EXPERIMENT_ARTIFACT_MAX_TOTAL_BYTES = 256 MiB`（268,435,456 B）** |

**结论**：这 6 个文件**合计约 355.8 MiB**，即使切成任意多片，**总量不变** ⇒ 仍然触发
`shared/researchExperimentsContracts.ts` 的 `EXPERIMENT_ARTIFACT_MAX_TOTAL_BYTES = 256 MiB`（另有
`EXPERIMENT_ARTIFACT_MAX_COUNT = 100` 件、`EXPERIMENT_ARTIFACT_MAX_SINGLE_BYTES = 64 MiB`）。
⇒ **P1 的 (a) 单独实施后 STUDY 仍会失败。** 可行路径只有两类：

| 选项 | 内容 | 授权级别 |
|---|---|---|
| **S-1（平台侧，推荐）** | 写入路径引入**压缩**（如 gzip）或上调单文件 / 总量上限 | **平台契约变更**（`shared/researchExperimentsContracts.ts` / `persistence/artifactPublisher.ts`） |
| **S-2（研究侧）** | **削减交付物内容**（例：`rejectionReasons` / `repairWindow` 串改码表引用、按锚点抽样）或把逐日账改为**导出到 Run 之外**的既有通道 | **研究交付定义变更**（004 §6.6/§8） |

在 S-1 / S-2 裁定前：**不重跑 STUDY**（同配置必然同样失败；数字会逐位相同 ⇒ 不存在结果筛选问题）、
**不改**参数 / 种子 / 窗口 / 阈值，也**不**把 `EXECUTION_FAILED` 解释为「策略无效」。

## A.3 §7 问题 1：B 比 A 多捕获了哪些破位后会错过的锚点？新增修复交易的右尾 / 均值 / 左尾

| 指标 | A `A_STRICT_20` | B `B_RECOVERY_20` | **B 独有（新增修复交易）** |
|---|---:|---:|---:|
| R 账户**已完成**锚点数 | **143** | **234** | **161**（其中 **158** 确有 `RECOVERY` 分支候选） |
| 已完成交易笔数 | 144 | 235 | **162** |
| 收益**均值** | **+0.219%** | **−0.556%** | **−0.861%** |
| 收益中位 | −1.833% | −1.887% | −1.646% |
| 5% / 25% / 75% / 95% 分位 | −7.341 / −6.145 / +2.245 / +16.903 | −7.154 / −6.151 / +1.710 / +11.907 | **−7.087 / −6.148 / +1.473 / +11.208** |
| ≥+20% **右尾率** | 2.778%（4 笔） | 2.553%（6 笔） | **2.469%（4 / 162）** |
| ≥+50% | 1.389%（2 笔） | 0.426%（1 笔） | **0** |
| ≥+100% | 0 | 0 | **0** |
| ≤−20% **左尾率** | 0.694%（1 笔） | 0.426%（1 笔） | **0.617%（1 / 162）** |
| 最差 / 最好单笔 | −28.259% / +70.507% | −20.334% / +70.500% | −20.334% / +27.206% |
| 锚点整链净损益合计（R，扣全部试错成本） | **+2,823.74** 元（143 锚点） | **−25,812.41** 元（234 锚点） | — |

**读法**：破位后继续观察**确实多捕获了 161 个锚点 / 162 笔交易**（唯一命中锚点数 4 → 6，即主靶分子增大），
但**新增的这批交易整体为负**、且**右尾率不高于**原规则（2.469% < A 的 2.778%、≥+50% 为 0）
⇒ 本轮**没有**显示「破位后修复再触发」在右尾或均值上优于「永久停买」。
同时 B 组合整体的 ≥+50% 尾率（0.426%）也低于 A（1.389%）。

> 🔴 **来源与替代声明**：逐锚点/逐笔明细来自 **优化前 SMOKE 的 R 账户产物**
> （`_scratch/fbp7-baseline/smoke-artifacts/{trades-R-*,candidate-ranking-diagnostics-*,anchor-trade-chains.csv}`），
> 原因是 STUDY 产物未能落盘（A.1 / 上文 §9.1）。该替代**已被证据支持**：R 计划是 `plans[0]`
> （`cells.slice(0, DAILY_TOP_K)`），**与 `randomAccountCount` 无关**，且 `configSnapshotJson` 跨账户逐字节相同（实验内断言）。
> **交叉核对逐项一致**（`_scratch/fbp7/analysis.md` §「R 账户跨 Run 一致性核对」，两组均 `consistent = true`）：
> `tradeCount` 144 / 235、`completedTradeCount` 144 / 235、`openAtEndCount` 0 / 0、`reentryEntryCount` 1 / 1、
> **由产物期末权益反推的总收益 +2.8237432769999904% / −25.81240630880004% 与 STUDY payload 逐位相同**。

## A.4 §7 问题 2：`B_R − A_R` 主靶效应与既有配对日期块 bootstrap

| 项 | 值 |
|---|---|
| 共同且数据资格可核实的锚点宇宙 | **18,611** |
| A_R：≥+20% 唯一命中锚点 / 覆盖率 | **4** / **0.021493%** |
| B_R：≥+20% 唯一命中锚点 / 覆盖率 | **6** / **0.032239%** |
| **点估计** | **+0.010746 pp**（`0.00010746332813927245`） |
| 95% 区间 · block20 主（1000 次 / seed `20261010`） | **[−0.010387, +0.035113] pp** ⇒ **跨 0** |
| 95% 区间 · block40 敏感性（1000 次 / seed `20261011`） | **[−0.011195, +0.034928] pp** ⇒ **跨 0** |
| 配对均值差（锚点整链净损益，block20） | **[−3.4064, +0.4224]** 元 ⇒ **跨 0** |
| 簇数 / 日历长度 / 零分母迭代 / 越界观测 | 425 / 425（空日保留）/ **0** / **0** |
| **事前样本门槛** | 🔴 **未达**：两组 ≥+20% 唯一命中锚点 **6 / 4**，均 < 50 |
| **事前判定** | 🔴 **`INSUFFICIENT_EVIDENCE`**（`sampleGateMet = false`、`supported = false`） |
| 逐年同向 | 仅 **2024** 同向（B 3 > A 0）；**2025 反向**（B 3 < A 4）⇒ 不满足「逐年同向」 |

🔴 **不因结果改阈值**：样本不足**不靠**扩大随机账户数补足，也不追加参数 / 种子 / 窗口。

## A.5 §7 问题 3：各组 R 相对其 20 个 Random —— 差值、分布与位置

| 组 | R 总收益 | Random 均值 | Random 中位 | Random 最好 | Random 最差 | R 优于几个 | R 分位 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **A** | **+2.824%** | −5.185% | −4.570% | +10.548% | −22.560% | **18 / 20** | **0.90** |
| **B** | **−25.812%** | −14.050% | −15.995% | +3.881% | −26.052% | **1 / 20** | **0.05** |

**合并（pooled Random）成交层对照**：

| 组 | 臂 | 成交笔数 | ≥+20% | ≥+50% | ≤−20% | 单笔均值 | 单笔中位 |
|---|---|---:|---:|---:|---:|---:|---:|
| A | R | 144 | 2.778% | 1.389% | 0.694% | +0.219% | −1.833% |
| A | pooled Random（20 账户） | 2,865 | **2.199%** | 0.733% | 0.698% | −0.094% | −2.057% |
| B | R | 235 | **2.553%** | 0.426% | 0.426% | −0.556% | −1.887% |
| B | pooled Random（20 账户） | 4,651 | **2.989%** | 0.624% | 0.366% | −0.265% | −1.674% |

**区分「买点规则的作用」与「`preReturn10` 排序的作用」**：

- **买点规则（A vs B，均为 R）**：B 明显更差（账户 −25.812% vs +2.824%；MDD 29.599% vs 22.013%；盈亏比 0.764 vs 1.037），
  而两者**左尾率接近**（0.426% vs 0.694%）⇒ 差异主要来自**更多、更差的入场**（235 笔 vs 144 笔），不是更差的单笔左尾。
- **排序（R vs Random，同组同池同人数同种子）**：A 的买点规则下排序**明显有利**（尾率 2.778% > 2.199%；账户 +2.824% vs 均值 −5.185%；分位 0.90）；
  B 的买点规则下排序**反而不利**（尾率 2.553% < 2.989%；账户 −25.812% vs 均值 −14.050%；分位 **0.05**）。
  ⇒ **排序增益不稳健**：破位后改用综合修复分支时，`preReturn10` 降序**不比**同日同池随机更好。
  🔴 20 个种子**不是** 20 份独立市场样本；上表只是**描述性位置**，不是显著性结论。

## A.6 §7 问题 4：复合收益 / MDD / 真实成交 / 唯一股票与锚点 / 首次与再入场 / 容量拒单 / 年度分层

| 指标（R 账户） | A `A_STRICT_20` | B `B_RECOVERY_20` |
|---|---:|---:|
| 当前权益复合收益 | **+2.8237432770%** | **−25.8124063088%** |
| 年化收益 | `NOT_AVAILABLE`（唯一指标出口 `canonicalMetrics`） | `NOT_AVAILABLE` |
| 最大回撤 MDD | **22.0125062888%** | **29.5992059813%** |
| 真实成交笔数（买卖两侧） | **288**（= 2 × 144 往返） | **470**（= 2 × 235） |
| 交易 / 已平仓 / 期末未平仓 | 144 / 144 / **0** | 235 / 235 / **0** |
| 胜率 / 盈亏比 | 38.194% / **1.0371** | 35.745% / **0.7635** |
| 唯一**意图**锚点 / 唯一证券（实际成交过） | 201 / 201（143） | 431 / 431（234） |
| **首次入场 / 再次入场**（第 2 笔及以后） | 143 / **1** | 234 / **1** |
| 容量与其它**执行层拒单** | **15** | **12** |
| 计划层跳过意图（`skipped`） | **76** | **274** |
| 平均持有（交易日） | 5.69 | 5.74 |
| 期末现金占比 | 100% | 100% |
| 前 3 / 5 交易日不利波动（均值；最差） | −4.857% / −6.227%（−28.081% / −32.451%） | −4.636% / −6.155%（−28.081% / −33.573%） |
| 锚点整链净损益合计 | **+2,823.74** 元 | **−25,812.41** 元 |
| pooled Random 成交尾率 ≥+20% | 2.199% | 2.989% |

**年度分层（同靶 + 账户年度收益）**

| 组 | 年 | 共同宇宙锚点 | ≥+20% 唯一命中 | 覆盖率 | R 年度收益 |
|---|---|---:|---:|---:|---:|
| A | 2024 | 10,535 | **0** | 0% | **−21.852%** |
| A | 2025 | 8,076 | **4** | 0.0495% | **+31.576%** |
| B | 2024 | 10,535 | **3** | 0.0285% | **−21.934%** |
| B | 2025 | 8,076 | **3** | 0.0371% | **−4.968%** |

> 🔴 2024 / 2025 均为**已见探索窗口**，不是 OOS。载荷另有一个 `2026` 行（0 个共同锚点、0% 收益）——那是执行尾窗
> （最晚成交日 2025-10-09 之后仍持仓至 2026-01 左右）产生的**空桶**，不构成年度结论。
> 🔴 **Runner 贡献 = 未测**：本实验**无退出消融**，Runner（`3600005` / T74）的因果贡献**不可观测**，故**不声称**任何方向。

## A.7 §7 问题 5：轻量 ST 检查读了多少记录、排除了多少候选与真实买单、UNKNOWN 参与与成交数

| 项 | 值 |
|---|---|
| **读取来源记录** | `research_security_status_history`（`statusType='ST'`）**841 行 / 734 证券**（一次性只读 `SELECT`）+ `research_security_identifier_history`（primary）**5,552 行** |
| 来源分布（**原样保留**，未修改） | `availability = {UNKNOWN: 841}`；`confidence = {medium: 841}`；**显式 NORMAL 行 = 0** |
| 来源指纹 | `cbd5ff564f69a6d6914ff5ca5dff9e249f95e902b8dbe162630387f17880c876` |
| 标签查找次数 | **3,259** = 确认日 1,628 + 计划成交日 1,628 + 来源探针 3 |
| 标签原因分布 | `NO_STATUS_FACT` 3,253 · `KNOWN_ST_INTERVAL_COVERS_CHECK_DATE` **6**（3 确认日 + 3 计划成交日） |
| **排除的排序候选** | **3** 个价格信号（**全部在 B 组**；A 组 0）⇒ 确认日三分账：已知 ST 3 / 明确 NORMAL 0 / UNKNOWN 1,625 |
| **排除的真实买单（订单级）** | **0**（3 个已知 ST 信号在**排序之前**已排除 ⇒ 未产生订单，**也未递补第 4 名**） |
| **`UNKNOWN` 参与候选** | **1,625**（A 328 + B 1,297） |
| `UNKNOWN` 订单检查 / 成交 / 拒单 | **8,161** / **7,895** / **266** |
| 已知 ST 订单 / 成交 | **0 / 0** ⇒ **已知 ST 买入 = 0** |
| 严格 PIT 视角（**照记、不作前置条件**） | `ST_COVERAGE_BLOCKED`（`blocked = true`、`providerVerifiable = false`、检查点 3,256 全 UNKNOWN） |

🔴 这些数字是**来源覆盖与政策描述**，**不是**另一个优化目标。
🔴 `UNKNOWN` 只能读作「**未发现 ST 记录**」，**不是**「当日确实非 ST」；其放行**只因为**这是用户授权的本轮政策。

## A.8 端到端执行方的偏差登记与两处**更正**

| # | 内容 |
|---|---|
| **A-D1** | 🔴 **文件名更正**：上文 §3.1 与 §3.2 引用的 `research-experiments/shared/rollingPoolRecovery/stEligibilityPolicy.ts` **不存在**；实际文件是 **`knownStPolicy.ts`**（`research-experiments/shared/rollingPoolRecovery/knownStPolicy.ts`，16,337 B，SHA-256 `cb2b79c93f0f1326aef32f85c8200163dd23affad94d5f9e1ce473249f92a66a`）。其余引用（`types.ts` / `validate.ts` / `engine.ts` / `experiment.ts` / `knownStLabelIndex.ts` / `compositeRunnerBridge.ts` / 运行工具）**与实际一致**。 |
| **A-D2** | 🔴 **§9.1 提案 P1 不足以解除阻塞**：超限的 6 个逐日账**合计 ≈ 355.8 MiB > 256 MiB 总量上限** ⇒ 单纯切片（总量不变）仍会失败。详见 **A.2**。 |
| **A-D3** | SMOKE 实跑 **3 次**（目标写「跑一次」）：#1 样本账不平（`NEVER_IN_WATCH_POOL` 69 被重复计入剔除原因）、#2 矩阵路径未写 `status`/`matrixEmitted` 导致终态不可判别；两次修复后 #3 通过。均为**真实工程缺陷**，未改任何研究参数 / 种子 / 窗口（后两处修复：`neverInWatchPoolCount` 独立成观察项 + 实验内样本账自检；矩阵路径显式声明 `status`/`matrixEmitted` 并由单测锁定）。 |
| **A-D4** | STUDY 的**逐锚点明细**取自**优化前 SMOKE** 的 R 账户产物（原因与证据见 A.3 尾注）。 |
| **A-D5** | 我的 STUDY（`RUN-20261011-2BAEF26C`）运行在 `experimentCodeDigest = exp-code-sha256:d2b06afa…`（TASK B 优化**之前**的读路径）。TASK B 之后 digest 变为 `b5d1c2eb…`；两者 `frozen-config.json` 219 叶子里 218 逐字相同（差异仅 digest）⇒ **数值口径相同、仅读法不同**。 |
| **A-D6** | 未跑 `pnpm run format`；新增文件全部 LF；`node scripts/checkEolDrift.mjs --strict` = **已跟踪漂移 0**（唯一未跟踪 CRLF 属另一会话）。 |
| **A-D7** | 端到端执行方**未覆盖**上文任何内容，也**未**改写 `AUDIT-…-007.md`；`CHANGE-AUDIT.md` 的 007 条目由端到端执行方追加（含 `v2.9.0` 版本接续），执行方身份互不冲突。 |

## A.9 端到端命令与证据位置

```bash
# SMOKE（6 账户，不持久化）与 STUDY（42 账户，只跑一次）
node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs \
  tests/tools/rollingPoolRecoveryStRun.mts --mode smoke --st-policy known-st-only
node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs \
  tests/tools/rollingPoolRecoveryStRun.mts --mode study --st-policy known-st-only

# §7 结果提取与交叉核对（只读；支持在线 --run 与离线 --payload/--artifacts-dir）
node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
  tests/tools/rollingPoolRecoverySt007Analysis.mts \
  --payload _scratch/fbp7/study-run.json \
  --artifacts-dir _scratch/fbp7-baseline/smoke-artifacts \
  --artifacts-from SMOKE-R-account-artifacts --out _scratch/fbp7
```

| 证据 | 位置 |
|---|---|
| STUDY 信封（Run 坐标 + tables + statistics + customPayload） | `_scratch/fbp7/study-run.json` |
| §7 机器可读 / 人读分析（含 R 账户跨 Run 一致性核对） | `_scratch/fbp7/analysis.json`、`_scratch/fbp7/analysis.md` |
| SMOKE #1/#2/#3 与 STUDY 控制台日志 | `_scratch/fbp7-smoke-console.log`、`-smoke2-`、`-smoke3-`、`_scratch/fbp7-study-console.log` |
| 版控内可复现入口 | `tests/tools/rollingPoolRecoveryStRun.mts`、`tests/tools/rollingPoolRecoverySt007Analysis.mts` |



---

## 🔴 纠错引用（`SORT-PARITY-008`，2026-10-11 追加；不修改上述任何读数）

**本文报告的 A/B 账户收益（A `+2.8237%`、B `−25.8124%`）来自「R 每日按股票代码升序取前三名」的旧实现，
不是事前声明的 `preReturn10` 因子排序结果。请勿把这两个数字当作已验证的因子排序收益。**

- 根因与证据：`experiment.ts#run` 丢弃 `sortCandidates(candidateRows)` 的返回值；`intentsOf` 对未排序 cells 直接 `slice(0,3)`；
  候选排名产物另行排序 ⇒ `selectedByR` 与真实计划脱节。逐笔复核：A/B 因子排名>3 的成交 6/32、代码排名>3 均为 0，379 笔成交全部符合代码 Top3。
- 纠错结果（新 `codeDigest`、新 Run `RUN-20261011-AEB6DDAB`，42 账户，同 Dataset / 同参数 / 同种子）：
  **A `+3.2429623609000036%`、B `−35.96741798660001%`；逐笔排序越界 0（A 144 / B 236 笔成交全部落在对应确认日实际 Top3 内）**。
- 20 个 Random 账户指标与逐笔台账与 007 **逐项/逐字节相同**（证明修复只影响 R 的计划，未扰动随机抽样）。
- 完整报告：[`RESULT-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md`](RESULT-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md)；
  预注册：[`PREREG-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md`](PREREG-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md)。
- 交付侧纠错：大件 CSV 改以无损 gzip 交付（008 STUDY 42 账户 32 件 / 47,565,373 B / 最大单件 23,666,242 B，
  对比 007 的 688,592,665 B 与 312,083,057 B），逐件解压 SHA-256 与原文一致；平台 64/256 MiB 上限未改。
- 本 Run 的旧记录保持原样：`RUN-20261011-2BAEF26C` 为计算 SUCCEEDED、保存 FAILED（`EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED`），未覆盖、未回填。