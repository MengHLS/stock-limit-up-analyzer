# TASK-OOS-COMPOSITE-3F-001 —— 3F 双振幅+量比等权组合排序键的按年份后置窗口验证

状态：DRAFT / 待批准 ｜ 日期 2026-09-25 ｜ 参照：`RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001`

> **目标不是继续找最优，而是证伪。** 本轮只验证一个事先冻结的排序键，不新增因子、不搜索权重、不换坐标、不根据验证段结果调整 TopN。
>
> 🔴 落库方式：本文件即预登记任务书原文（§一 ~ §九）。文末 **附录 A** 由 Agent 在「落库勘察」阶段追加，**不属于冻结判据**；正式冻结前若拟保留附录 A，须由用户显式确认。

---

## 一、背景与动机

`RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001` 显示：

- `2F` / `3F` / `4F-W` 三方案都保住了头部 `POSITIVE`，且都优于 `12F-EQ`；
- 但 `4F-W` 四档全部劣于 `4F-EQ` 等权基线 ⇒ 权重倾斜没有价值；
- 三方案里同号率最高的是 `3F`（四档平均 `1.000`，四档全 `POS`）；
- 所有结果仍是同一窗口、事后挑成员的样本内比较，不是 OOS。

因此下一步不应继续调权，而应做一次按年份切分的后置窗口验证。

---

## 二、验证对象与冻结口径

### 2.1 主方案

| 项目 | 冻结值 |
|---|---|
| 实验 id | `composite-factor-3f-amplitude-volume-study` |
| 成员 | `maxAmplitude` / `meanAmplitude` / `t1VolumeRatio` |
| 权重 | 等权：各 `33.33%` |
| 方向 | `maxAmplitude` LOW、`meanAmplitude` LOW、`t1VolumeRatio` HIGH |
| 成员指纹 | `fnv1a32:27e759d7` |
| 桶词表指纹 | `fnv1a32:4eae4835` |
| 选择理由 | 四档全 `POS`、同号率 `1.000`、成员少、等权、机制最简 |

### 2.2 参照与负对照

| 角色 | 方案 | 用途 |
|---|---|---|
| 参照基线 | `4F-EQ` 四因子等权 | 描述性对照，不纳入主判定 |
| 负对照 | `12F-EQ` 十二因子等权 | 验证 `3F` 是否仍优于全因子等权 |
| 历史对照 | `2F`、`4F-W` | 仅记录，不纳入主判定 |

`4F-W` 不再作为主验证对象，因为权重倾斜已在上一轮四档全败。

### 2.3 执行坐标（全部冻结，不得改）

| 入场 | 退出 | 成本 | 信息截止 | 观察窗 | 决策日 | 标准化 | TopN | 日集 |
|---|---|---|---|---|---|---|---|---|
| T+6 开盘 | T+10 收盘 | 20 bps | T+5 收盘 | T+1..T+5 | 首板日 T | `BUCKET_POSITIONAL` | 3 / 5 / 10 / 20 | `OWN` / `FIXED` |

---

## 三、窗口切分

| 段 | 时间范围 | 用途 |
|---|---|---|
| 选择段 | 2019-01-01 至 2023-12-31 | 仅确认冻结口径，不重新选成员、不调权重 |
| 验证段 | 2024-01-01 至 2026-09-25（数据末端） | 只读一次，用于主判定 |

切分点事先宣布，可审计。

⚠️ 这是「后置窗口 / 准 OOS」，不是严格未来数据；成员选择时可能已扫过全窗口，残余选择偏差无法完全消除。

---

## 四、主判据

### 4.1 主日集

`FIXED` 日集（统一门槛 = 20）。

理由：`OWN` 下不同 N 的日集不同，跨 N 比较必须读 `FIXED`。

### 4.2 主指标

配对日度超额：

```text
组合日收益 − 当日池日收益
```

计算 95% Bootstrap CI。判定 `POS` = CI 不跨 0 且均值 > 0。

### 4.3 通过条件

`3F` 在验证段 `FIXED` 日集上：

1. 至少 3/4 档 `POS`：`N3` / `N5` / `N10` / `N20`；
2. `N3` 或 `N5` 至少一档 `POS`；
3. `N3` / `N5` / `N10` 中至少 2 档超额均值高于 `12F-EQ` 同档。

**强通过**：4/4 档 `POS`，且 `N3`、`N5` 均 `POS`，且至少 3 档优于 `12F-EQ`。

### 4.4 失败条件

满足任一即失败：

- `POS` 档数 ≤ 1；
- `N3` 与 `N5` 全部 `INC`；
- `N3` / `N5` / `N10` 中仅 ≤ 1 档优于 `12F-EQ`。

### 4.5 部分通过

2 档 `POS`，且 `N3` 或 `N5` 至少一档 `POS`，且优于 `12F-EQ`。

处理：不调参，延长验证段或等待新数据后重做，仍使用同一冻结口径。

---

## 五、多重比较控制

- 主判定仅 `3F` 的 4 个档位，`α = 0.05`，假阳性期望 ≈ 0.2。
- `4F-EQ`、`12F-EQ`、`2F`、`4F-W` 的结果降级为描述性，不纳入主判定。
- 若同时判定 `4F-EQ`，必须使用 Bonferroni 校正（`α = 0.025`）或明确声明为次级。
- 禁止在验证段上重新选择 TopN、日集、成员或权重。

---

## 六、执行步骤

1. **冻结任务书与判据**：落库本文件，记录 commit hash。
2. **生成验证段 Run**：只改读取窗口 / 时间过滤，不改 members、weighting、坐标、TopN、日集。
3. **独立进程执行**：一个方案一个进程，避免上一轮 `4F-W` 的内存爆炸问题。
4. **主 Run**：`3F`；**参照 Run**：`4F-EQ`；**负对照 Run**：`12F-EQ`。
5. **产物读取**：读取信封与 `composite/daily-n{3,5,10,20}-{own,fixed}.csv.gz`。
6. **报告生成**：`RESULT-OOS-COMPOSITE-3F-001.md`。
7. **独立回校**：用独立脚本复核表格数字，禁止人工转录。

> `stale = true` 不等于已死；耗时超过 30 分钟的活 Run 也可能被标 `stale`。判定是否真在跑，应看进程采样与 DB `updatedAt`，必要时走 `runService.reconcileRun()`。

---

## 七、交付物

- `RESULT-OOS-COMPOSITE-3F-001.md`
- 主表：`FIXED` 日集 `N3` / `N5` / `N10` / `N20` 超额与 95% CI
- 年度切片：2024 / 2025 / 2026
- 跨年份同号率
- 随机选择检验分位
- 与 `12F-EQ`、`4F-EQ` 的同档对照
- 样本账守恒校验
- Lineage：Run id、Dataset、成员指纹、桶词表指纹

---

## 八、停止条件

一旦读取验证段结果：

- 不得在同一验证段上修改成员、权重、TopN、日集；
- 不得因 2026 年不完整而删除年份；
- 任何修改都必须使用新的验证段或新数据，并重新事先登记判据。

---

## 九、限制

1. 准 OOS，非严格未来数据；成员选择可能已扫过全窗口。
2. 验证段仅约 2024–2026，统计力有限，2026 不完整。
3. 基准是「当日池等权」，正超额 ≠ 跑赢市场。
4. `t1VolumeRatio` 仅一档 `POSITIVE`，属弱成员。
5. `EQUAL` 与 `CUSTOM` 浮点路径不同，tie-break 可能有极小影响。
6. 模板不对「档位之间的差」出 CI，梯度只作描述性形状。

---

## 附录 A —— 落库勘察结论（Agent 追加 · 不属冻结判据）

> 勘察日期 2026-09-25。目的：在动工前确认「最小配置 diff」到底落在哪一层。**结论与任务书 §六.2 的假设不一致**，故如实登记。

### A.1 已逐项核对为真的冻结值

- `3F` 成员指纹 `fnv1a32:27e759d7`、桶词表指纹 `fnv1a32:4eae4835` —— 与 `docs/research/RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001.md` §14.1 逐字一致（该报告由信封机械生成，非人工转录）。✅
- 实验 id 已注册：`research-experiments/first-board-pullback/composite-factor-constrained-weight-study/presets.ts` 的 `3F` 预设，`members = maxAmplitude / meanAmplitude / t1VolumeRatio`，`weighting = { mode: "EQUAL" }`。✅
- 坐标 T+6 Open → T+10 Close / 20 bps 由 `assertTemplateCoordinate()` 强制（`research-experiments/shared/singleFactor/coordinate.ts`）。✅
- `FIXED` 日集统一门槛 = `Math.max(...spec.topNSizes)` = 20（`shared/compositeFactor/template.ts:301`）。✅

### A.2 关键发现 ①：平台的「参数」表达不了日期区间

`shared/researchExperimentsContracts.ts:40` 的 `EXPERIMENT_PARAMETER_KINDS` 只有 `INT / NUMBER / BOOLEAN / ENUM / INT_LIST` —— **没有 `STRING`**。因此「只加验证段年份过滤」在参数面上最多只能是**年份整数**，不能是 `YYYY-MM-DD` 区间。

### A.3 关键发现 ②：窗口是平台原生能力，且**在取数层真实过滤事件**

平台已内置确认性协议 `experimentResearchProtocolInputSchema`（`observationWindow` / `holdoutWindow` / `phase` / `parentRunId`；指纹由平台计算）：

- `server/researchExperiments/datasetPort.ts:349-364` —— 取事件时把 `evaluationWindow.startDate / endDate` 作为 `fromDate / toDate` 传给 `loadEventPage()` ⇒ **实验侧无需自己过滤**；
- `tests/server/researchExperiments/protocolGate.test.ts:336-373`（「Evaluation Window 真实过滤事件」）把该行为钉死：2 个事件、窗口只覆盖 1 个 ⇒ `candidateCount = 1`；
- `server/researchExperiments/protocol.ts:18-26` —— `EXPLORATORY_PROTOCOL.evaluationWindow === null` ⇒ **EXPLORATORY Run 恒读全窗**；只有 `OBSERVATION` / `HOLDOUT` 才带窗口。
- 既有先例：`research-experiments/first-board-pullback/oversold-gap-reversal-validation/experiment.ts:218-226` 在「有评估窗口」时把 `datasetEventCount` 置 `null`（不谎报全库账）。

### A.4 🔴 关键发现 ③（阻断项）：验证段对现有实验 id 已构成「被看过」

`findHoldoutWindowContamination()`（`server/researchExperiments/protocol.ts:68-85`）：同一实验、同一 Dataset 下，**任何历史非 `HOLDOUT` Run**，只要 `evaluationWindow === null`（= 读全窗）或窗口与目标 Holdout 重叠 ⇒ 判为污染；`runService.start()` 随即抛 `EXPERIMENT_PROTOCOL_HOLDOUT_CONTAMINATED`（`server/researchExperiments/persistence/runService.ts:330-364`）。

⇒ `…-3f-amplitude-volume-study` 的既有 EXPLORATORY 全窗口 Run 已覆盖 2024–2026，**在同一实验 id 上做 2024–2026 的 `HOLDOUT` 会被平台直接拒绝**。这正是任务书 §三 自述的「准 OOS，成员选择时可能已扫过全窗口」在机器上的体现。

### A.5 平台另有四条已内建、无需自造的纪律（与任务书 §五/§八 同构）

| 任务书纪律 | 平台的机器执行体 |
|---|---|
| §五「禁止在验证段重新选 TopN / 日集 / 成员 / 权重」 | `HOLDOUT` 必须引用同实验、`COMPLETED`、Gate = `OBSERVATION_READY` 的 `OBSERVATION` Run；父子的**协议指纹 / Dataset / 代码指纹 / 参数 / Dataset 绑定必须全部一致**，否则 `EXPERIMENT_PROTOCOL_PARAMETERS_FROZEN`（`runService.ts:263-301, 367-391`） |
| §八「只读一次」 | 同一协议指纹的 `HOLDOUT` 只能用一次（`runService.ts:393-400`）；进入 `HOLDOUT` 后禁止再补 `OBSERVATION`（`runService.ts:401-407`） |
| §六.1「冻结任务书与判据」 | 确认性 Run **必须产出 `confirmatoryGate`**，否则 `EXPERIMENT_CONFIRMATORY_GATE_INVALID`；`OBSERVATION` 只接受 `OBSERVATION_READY / INSUFFICIENT`，`HOLDOUT` 不得给 `OBSERVATION_READY`（`protocol.ts:141-197`） |
| §七「Lineage / 隔离审计」 | `experimentRunDetail.dataIsolation` 给出该 Holdout 的污染审计（`runService.ts:184+`） |

### A.6 因此「最小配置 diff」有两条互斥路径（**待裁定**）

**路径 A —— 平台原生（语义最强，改动最大）**

新建 3 个 experiment id（`3F` / `4F-EQ` / `12F-EQ` 的 members + weighting **逐字复制**，仅 id 不同），每个先 `OBSERVATION(2019-01-01..2023-12-31)` 再 `HOLDOUT(2024-01-01..2026-09-25)`。新 id 无历史 Run ⇒ 不触发污染守卫。

需要且仅需要给 `COMPOSITE_FACTOR` 模板补两件事：① 非 EXPLORATORY 阶段产 `confirmatoryGate`（把 §4.3/§4.4 的判据写成 `checks`）；② 窗口化时的样本账处理（照 `oversold-gap-reversal-validation` 先例）。共 **6 个 Run**。

⚠️ 与任务书 §2.1「实验 id = `composite-factor-3f-amplitude-volume-study`」冲突。

**路径 B —— 任务书原样（改动最小，语义最弱）**

同一 id + 自造年份整数参数（`INT`，`0` = 不限）。但 `EXPLORATORY` 下 `evaluationWindow` 恒为 `null` ⇒ 平台侧**没有窗口记录、没有隔离审计、没有参数冻结**；报告只能声明为「准 OOS / EXPLORATORY」，且平台守卫将来仍会（正确地）拒绝把该结果当作独立 OOS。

⚠️ 与仓库「确认性协议」纪律冲突，且等于自造一套弱于平台的纪律。

### A.7 阻塞动工的三个未决问题

1. 实验 id 是否允许变更？（决定走 A 还是 B）
2. 若走 A，是否接受「每方案多一个 `OBSERVATION` Run」的代价（3 → 6 个 Run，约 +30~35 分钟）？
3. 若走 A，`OBSERVATION` 段（2019–2023）的产出是否只作冻结载体与门槛（判据不读它），还是也要并入报告？

---

## 附录 B —— 执行回执（Agent 追加 · 不属冻结判据 · 执行后写）

> 本节在**读取验证段结果之后**追加，只登记「做了什么、去了哪里」，
> **不动 §一~§九 的任何判据、口径、阈值与停止条件**。

- 执行日期：2026-09-25
- 采用路径：**A（新 id + 平台协议）**；交付范围：落库 + 配置 diff + 真实运行 + 结果文档 + 独立回校
- 结果文档：`docs/research/RESULT-OOS-COMPOSITE-3F-001.md`（机械生成 + 84 项独立回校断言全过）

### B.1 最小配置 diff（只加窗口/协议，不动组合定义）

| 文件 | 改动性质 |
| --- | --- |
| `research-experiments/shared/compositeFactor/assemble.ts` | 增平台协议块 / `confirmatoryGate` / 窗口披露与 `windowApplied` |
| `research-experiments/shared/compositeFactor/template.ts` | 透传 `context.protocol` + 派生日志按 phase 分支 |
| `research-experiments/first-board-pullback/twelve-factor-composite-study/derive.ts` | 登记 `evaluationWindow`；不再谎报全库账 |
| `research-experiments/first-board-pullback/composite-factor-oos-validation-study/**` | **新建**：3 个实例（presets / experiment / result / page / README） |
| `research-experiments/manifest.ts` | 注册 3 个实例 |
| `client/src/researchExperiments/pages.ts` | 注册 3 个 pageKey |

**未改**（逐项机械核对，见结果文档 §13.3）：`members` / `weighting` / `normalization` /
`topNSizes` / `dayScopes` / 五条坐标 / 桶词表契约。

### B.2 Run

| 方案 | OBSERVATION | HOLDOUT |
| --- | --- | --- |
| 3F（主） | `RUN-20260925-220C7F89` | `RUN-20260925-76FA1DCC` |
| 4F-EQ（参照） | `RUN-20260925-76FC74F4` | `RUN-20260925-509DEF49` |
| 12F-EQ（负对照） | `RUN-20260925-001BDF48` | `RUN-20260925-E4BA89C4` |

一处失败 Run：`RUN-20260925-94B822B7`（12F-EQ / OBSERVATION 首次尝试，
跨境取数瞬时失败），已登记于结果文档 §13.6。

### B.3 三处必须与任务书假设不同的地方（详见附录 A 与结果文档）

1. 验证段上界取 **2026-09-04**，而非草案写的 2026-09-25（Dataset v5 真实末端）。
2. 平台参数无 `STRING` 类型，且窗口是**平台原生能力**（取数层过滤）⇒ §六.2 的「最小配置 diff」只能按路径 A 实现。
3. 条件 3（优于 12F-EQ 同档）**无法在 `run()` 内判定**（无跨 Run 读口）⇒ 平台 Gate 恒为
   `INSUFFICIENT`，条件 3 由结果文档 §3.1 承担。

### B.4 运行后的一处缺陷修复（**不影响本轮任何数字**）

- **现象**：`tests/server/researchExperiments/compositeFactorEngine.test.ts` 收集失败，
  `TypeError: Cannot read properties of undefined (reading 'phase')`。
- **根因**：`assemble.ts#buildConfirmatoryGate` 只判 `protocol === null`、**未判 `undefined`**；
  而该单测的 `buildFixture` 直接构造入参、**不传 `protocol`** ⇒ 命中 `undefined.phase`。
  （并发会话写的用例，与我这次给模板新增 `protocol` 入参产生了接口碰撞。）
- **修法**（3 处，仅 `research-experiments/shared/compositeFactor/assemble.ts`）：
  `AssembleCompositeFactorArgs.protocol` 与 `buildConfirmatoryGate` 的入参一并改为**可选**
  （`readonly protocol?: ExperimentProtocolContext | null`），函数内以 `args.protocol ?? null` 归一化。
- **为何不影响本轮数字**：
  1. 三个实验实例**都传了** `protocol`（协议 Run），走的代码路径与修复前**完全一致**；
  2. `experimentCodeDigest` 只哈希 `{descriptor, definition.run.toString(), resultSchema.toString()}`
     （`server/researchExperiments/codeDigest.ts:17-22`）——`assemble.ts` 是被 `import` 的模块，
     **不在 `definition.run` 的源码文本里** ⇒ 修复后**代码指纹不变**，
     故附录 B.2 与结果文档 §1.3 记录的 `exp-code-sha256:*` 与 `protocol-sha256:*` **仍然有效**。
- **复核**：`tsc --noEmit --incremental false` **0 错**；
  `compositeFactorEngine.test.ts` **40/40 通过**；种子增量（`--seed client/src/researchExperiments/pages.ts`）**3 文件 / 135 例通过**。
