# RESULT · `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005`（phase 1 · 代码 / 测试 / 文档）

> 目标标识：`FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005`（[PLAN-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md](PLAN-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md) 第一阶段）
> 上游证据：[AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md §9](AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md#9-执行结果复核2026-10-11)（§9.2 = F1 / §9.3 = F2 / §9.4 = 数据边界）
> 预注册：[PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md](PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md)（判据 / 冻结矩阵 / 停止规则未改）
> 基线：HEAD `f8b6810`；工作区 210 项（35 tracked-modified + 175 untracked）= 既有并发基线
> 终态：**`READY_FOR_CODEX_REVIEW`**

## 0. 本轮**没有**做什么（先声明）

- ❌ **没有**跑真实 SMOKE / STUDY（**一次都没有**调用 `tests/tools/rollingPoolRecoveryStRun.mts` 或任何 Run 入口）；
- ❌ **没有**写数据库（0 DDL / 0 DML / 0 migration / 0 连接；所有测试与探针均为纯合成 fixture）；
- ❌ **没有**构建 Dataset、**没有**创建 Run、**没有**覆盖历史产物、**没有**回填历史数据；
- ❌ **没有**改 A/B 规则、T+20、五日综合分、排序因子、TopK、Runner、成本、seed、主指标、bootstrap、停止判据；
- ❌ **没有**动 `_scratch/overlap/probe01_db_state.mjs`（其他会话的 CRLF 探针）、**没有**扩大 EOL 忽略范围、**没有**跑 `pnpm run format`、**没有** `git reset/stash/commit/checkout`；
- ✅ 所有"运行"都是**合成 fixture 的单元/集成测试**与**仓外只读探针**（脚本落在 `scripts/_scratch/recovery-st-fix005/`，已 gitignore）。

---

## 1. STEP 0：改动前复现（证据先于修改）

### 1.1 STEP 0.1 — F2 边界缺陷复现（纯合成，无 DB）

探针：`scripts/_scratch/recovery-st-fix005/probe-f2-interval-boundary.mts`（10 个用例）
命令：`pnpm exec tsx scripts/_scratch/recovery-st-fix005/probe-f2-interval-boundary.mts`
日志：`probe-f2-before.log`（改动前，exit 0）/ `probe-f2-after.log`（改动后，exit 0）

**改动前实测（`outcomeMismatchAgainstFrozenSemantics = 6 / 10`）：**

| # | 检查时刻 / 区间 | 改动前实测 | 冻结语义要求 |
|---|---|---|---|
| A | PRE_FILL `09:15`，NORMAL `当日00:00 → 09:00`（**已失效**） | **`NORMAL / VERIFIED_NORMAL`**（错误放行） | `UNKNOWN / NOT_EFFECTIVE_ON_TRADE_DATE` |
| B | PRE_FILL `09:15`，NORMAL `当日08:00 → 23:59:59`（**已生效**） | **`UNKNOWN / NOT_EFFECTIVE_ON_TRADE_DATE`**（错误拒绝） | `NORMAL / VERIFIED_NORMAL` |
| C | PRE_FILL `09:15`，日期形式 `effectiveFrom = effectiveTo =` 当日 | `NORMAL / VERIFIED_NORMAL` | 同（未暴露） |
| D | CONFIRM_CLOSE `15:00`，日期形式 `effectiveTo =` 当日 | `NORMAL / VERIFIED_NORMAL` | 同（未暴露，见 §5 偏差 D-1） |
| E | PRE_FILL `09:15`，精确端点 `effectiveTo = 09:15:00`（失效含） | **`UNKNOWN / NOT_EFFECTIVE_ON_TRADE_DATE`**（错误拒绝） | `NORMAL / VERIFIED_NORMAL` |
| F | PRE_FILL `09:15`，精确端点 `effectiveFrom = 09:15:00`（生效含） | **`UNKNOWN / NOT_EFFECTIVE_ON_TRADE_DATE`**（错误拒绝） | `NORMAL / VERIFIED_NORMAL` |
| G | PRE_FILL `09:15`，`effectiveFrom = 09:15:01`（尚未生效） | `UNKNOWN / NOT_EFFECTIVE_ON_TRADE_DATE` | 同（正确） |
| H | 无效日期 `effectiveTo = 2024-13-45` | **`NORMAL / VERIFIED_NORMAL`**（字典序放行） | `UNKNOWN / INVALID_STATUS_TIME_FORMAT` |
| I | 不支持格式 `effectiveTo = 2024-1-04` | **`NORMAL / VERIFIED_NORMAL`**（字典序放行） | `UNKNOWN / INVALID_STATUS_TIME_FORMAT` |
| J | `availableAsOf = 2025-01-01`（过晚） | `UNKNOWN / NOT_AVAILABLE_AS_OF` | 同（正确） |

⇒ 与 AUDIT §9.3 的两条结论**逐字一致**（09:00 失效被放行、08:00 生效被拒绝），并**额外**复现了
「精确端点两侧被误拒」与「无效日期/格式靠字典序放行」两个同源缺陷。

**改动后实测（`outcomeMismatchAgainstFrozenSemantics = 0 / 10`）**：10 个用例全部落在
「冻结语义要求」列（A→`NOT_EFFECTIVE_ON_TRADE_DATE`、B/E/F→`NORMAL`、
C/D→`NORMAL`、G→`NOT_EFFECTIVE_ON_TRADE_DATE`、H/I→`INVALID_STATUS_TIME_FORMAT`、J→`NOT_AVAILABLE_AS_OF`）。

### 1.2 STEP 0.2 — 改动前既有失败（在本工作区复现，不凭记忆归因）

命令：`pnpm run test:changed`（输出 `scripts/_scratch/recovery-st-fix005/baseline-test-changed.log`）
**改动前结果：`exit 1`；`Test Files 4 failed | 171 passed (175)`；`Tests 10 failed | 2218 passed (2228)`**

| 失败文件 | 失败数 | 属性 |
|---|---:|---|
| `tests/server/researchExperiments/threeFactorTopNStrategyDocument.test.ts` | 3 | **在本工作区实测复现**（不是凭记忆断言） |
| `tests/server/limitUp.test.ts` | 1 | 需真实 DB 状态 |
| `tests/server/limitUp.watch.test.ts` | 4 | 需真实 DB 状态 |
| `tests/client/src/components/datasetRegistry/datasetFilterForm.test.ts` | 2 | 前端表单既有失败 |

（另注：Codex 交接日志 `codex-before-tests.log` 只跑了 9 个文件 / 141 例，全部通过 —— 因此
`test:changed` 的这 10 例失败**只能**由本轮在工作区实测确认，本轮已完成该确认。）

### 1.3 STEP 0.3 — 固定合成输入的 digest 基线（供"缺省不变"取证）

探针：`scripts/_scratch/recovery-st-fix005/probe-digest-baseline.mts`（真实 `runTradeSimulation`，无闸门）
改动前输出：`probe-digest-before.json`；改动后两次输出：`probe-digest-after.json` / `probe-digest-after2.json`

| 项 | 改动前 | 改动后（两次一致） |
|---|---|---|
| `run.fingerprint` | `fefd610464fe50f3a33bf1e6a5fb0dbce96a43ff342885497b9937d07302c4da` | **完全相同** |
| `sourceFingerprint` | `0dad48a0b5563eaf9bcf29f9dfc10d4080edfb4b10fe7f4005215d779958f35f` | **完全相同** |
| `tradeDigest`（`trade/v1` 配方，同 `backtestResult.ts#rollingDigest`） | `d2b52157226aaf6ed2cb1d5db8eec7eb40cbbe6c047c435274610a381fed2644` | **完全相同** |
| `equityDigest`（`equity/v1` 配方） | `6aacf974abad078038d8635479931a2cc7ec6b446996df831584ec455e1d0a29` | **完全相同** |
| `canonicalMetrics` | `totalReturnPct=1.849999999999996` · `annualizedReturnPct=151.90458954383158` · `maxDrawdownPct=0` · `tradeCount=2` · `completedTradeCount=0` · `openAtEndCount=2` · 其余 `NOT_AVAILABLE` | **完全相同** |
| `run.config` 键集 | 17 键 | **完全相同**（无 `executionEligibility`） |

⇒ 「新增可选输入缺省 ⇒ 旧路径逐字节不变」**在改动前就留下可复核的锚点**，并由 §4 的场景 8 常量化钉住。

---

## 2. 改了什么（文件 + 符号 + 前后 SHA-256）

行尾：除 `engine.ts` 保持 `MIX(crlf=1)`（与改动前一致）外，其余全部 `LF`（新增文件一律 LF）。
`before/` 目录：`scripts/_scratch/recovery-st-fix005/before/`（含 `manifest-before.txt` 的逐文件字节数 / SHA-256(16) / EOL）。

### 2.1 平台执行层（`server/research/simulator/**`）

| 文件 | 改动符号 | before | after |
|---|---|---|---|
| `server/research/simulator/types.ts` | **新增** `ExecutionEligibilityCheckInput` / `ExecutionEligibilityDecision` / `ExecutionEligibilityGate` / `ExecutionEligibilityAuditEntry`；`SimulationConfig.executionEligibilityGate?`；`SimulationConfigSnapshot.executionEligibility?`；`TradeSimulationRun.executionEligibilityAudit?` | 22358 B `e32c648f92c20b64c51fc90856174316696987a2eb8cf9013ebc548240b169f2` | 27978 B `81f3cd1d6ee59b6fb52e1c6c0063c60851bfe81b1ce3ac130a2b589257d33d97` |
| `server/research/simulator/engine.ts` | `runTradeSimulation`（due-order 循环买入前调用闸门 + 收尾硬断言）；`buildConfigSnapshot`（条件式身份字段） | 80478 B `112be9a7de7e7080196a7c00f215f9ceefd3fb3a788ac897e7907c1ffb5f187c` | 87963 B `663bed6304460a7694779ec22e9e2339e1866e298be4f8cc055dd8d708f35aed` |
| `server/research/simulator/validate.ts` | `validateSimulationConfig`（闸门形状校验）；`validateTradeSimulationRun`（审计数组 + `FILLED ⇒ NORMAL`） | 41781 B `c9c59f47bc9123be64ecb88ed98fdc20eefd414cbb339e77e08a9f24d22a846d` | 46161 B `113cf7ff26f4457f42070d3f1bc9db263f9751bca2becf4d8d84e85891d23205` |

### 2.2 研究实验侧

| 文件 | 改动符号 | before | after |
|---|---|---|---|
| `research-experiments/shared/rollingPoolRecovery/stGate.ts` | `ST_GATE_CONTRACT_VERSION`（1.0.0→1.1.0）；`ST_GATE_REASONS`（+`INVALID_STATUS_TIME_FORMAT`）；**新增** `ST_EXECUTION_ELIGIBILITY_POLICY_VERSION`；`normalizedIntervalStart` / `normalizedIntervalEnd`（替代 `instantKey`）；`evaluateStGate`（区间有效性改用 `effectiveAt`） | 20719 B `d9f54aa75857d7ab0823e7f253fc70225dcae6b1bcdec4b76e5af724a5b5e120` | 27024 B `303c31c461a8a87bd96eb2efe8de5a7215cacf073098db1349ebe3261c3c39d3` |
| `research-experiments/shared/rollingPoolRecovery/index.ts` | barrel 追加 `ST_EXECUTION_ELIGIBILITY_POLICY_VERSION` | 1504 B `214dbb280200b99059d049372e2ddd28011468117e666ffb7990d7f83f94a06c`（重建，见 §5 D-2） | 1547 B `51250df6550ed039424a6cb1cdb95523fd84bcbece1019e2a11a90f3eb6c4dac` |
| `research-experiments/compositeRunnerBridge.ts` | 零实现 re-export 4 个执行资格类型 | 5948 B `e15bf7ce7f39be78438434a643eb94d88acae2af58c90cbf2547111b6e6cfdbb`（重建，见 §5 D-2） | 6282 B `79ff864af7119ec72c887fd84e772760443dc50587e82d2c3ba056205c746aef` |
| `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts` | **新增** `ST_EXECUTION_ELIGIBILITY_GATE_ID` / `ST_PROVIDER_ABSENT_PROBE_SYMBOL` / `createStExecutionEligibilityGate`；`stCoverageReportLiteral`（+`measurement`）；`run()`：**早诊断**分支、`stExecutionEligibilityGate` 注入 `groupSimConfig`、真实成交审计 + 硬失败、`execution-eligibility-rejections-{group}.csv`、分工表述纠正 | 137352 B `2ca55c3c658a7798abdf91bfcce389e0202f5b2a6871efc5c753cae7a879c53b` | 166987 B `eefaa0be58b4efaa6562e7aab712b10ec353ada15e108d5136fb5eb591c7c0b3` |
| `research-experiments/first-board-pullback/rolling-pool-recovery-st/result.ts` | **新增** `StCoverageUnscannedReport` / `StCoverageReading` / `unscannedStCoverageReport`；`RecoveryStBlockedOutput` 计数可空；`recoveryStCustomPayloadBaseSchema`（`measurement` + `superRefine` 一致性）；`assembleRecoveryStBlockedResult`；`RECOVERY_ST_BLOCKED_ARTIFACTS` / `RECOVERY_ST_S5_ARTIFACTS` 名单 | 71120 B `693352c4498878700545658036d2c221f5603cb8e9b90d02dbc2457874e4d1f0` | 78930 B `e4847ac20581abeb77b0380f270088202e5ab90569270b1bf71b1b004c3c9563` |
| `research-experiments/first-board-pullback/rolling-pool-recovery-st/README.md` | §0 分工表 + 早诊断 + 产物清单；新增 §0.1（执行资格闸门）/§0.2（F2 区间语义）；§6 测试清单 | 13365 B `1e7a0f0617a2ef126748894b95458befe5f81c9fbfbce94aba6dedd29566812a` | 18639 B `1c0fd874e07577888e4963b288156d03aa65c8fc20a61b57d20deb8a04ff7dc7` |

（未改：`rollingPoolRecovery/types.ts` `0673e73a…`、`rollingPoolRecovery/entry.ts` `eb693a52…`、`simulator/plan.ts` `9bb47e1d…` —— 三者保持改动前字节。）

### 2.3 测试

| 文件 | 改动 | before | after |
|---|---|---|---|
| `tests/server/researchExperiments/rollingPoolRecoveryStExecutionGate.test.ts` | **新增**（25 例，真实 `runTradeSimulation`） | — | 43434 B `6c8ccab85470d2c96cd75c59b9e97b31e2bbc060098275377837fa35f52d2ce8` |
| `tests/server/researchExperiments/rollingPoolRecoverySt.test.ts` | +11 例 F2 边界（§12）；修正 fixture 非法日历日（§5 D-3） | 44759 B `d34fd7d8c73f6a058e1d9f63ea398d2ab604b3e3f62f49a9b4b8c6743cb17ef5` | 50826 B `8cf42529c1369e6e6e6c13dbf0a7550369ff3dcfd41d70889eae070ffe0c38aa` |
| `tests/server/researchExperiments/rollingPoolRecoveryStBlocked.test.ts` | 改钉「早诊断 / 未测 ≠ 0」新契约；新增已实测路径直接组装用例（§5 D-4） | 22068 B `e6186df6a2c4168fd951e7b7c1fc59e9ae949077982dd59212f3c40f099fe3a7` | 28569 B `6ae782e1c0c5286a67f9a80b8c2f94357768df979a0a7e80d07e2f8e3aa3decb` |

### 2.4 架构文档 / 审计

| 文件 | before | after |
|---|---|---|
| `docs/architecture/CHANGE-AUDIT.md` | 1098315 B `850317fb0dca5709929e4f110ad3faceaaa22a690d1e3e47fdf23dc2d6dd944f` | 1102981 B `9da493e0172163ca448502c5137a3338617021d5893bf1c8183ff56ba472fa22` |
| `docs/architecture/SYSTEM-BASELINE.md` | 68832 B `d8e0836800f58e62ba8a0e01472d46026422aa8c74c0be91d0538e4e0b83a47d` | 71920 B `c37b04589dfd049aeb6dd51500416397dc36b844c336ea1349b368c5063e92ce` |
| `docs/architecture/EXECUTION-FLOW.md` | 26459 B `210c13ded0951712e9cc644d76336669083d3d539129fe9f98f03f858fbd8356` | 29080 B `6e3024b0e52a0262bb8b9412fe48bf169f171d2575d60abf2299722d53a4fce6` |
| `docs/architecture/CONTRACT-MAP.md` | 37428 B `78998be4f8ea214758ab5a475b98bd313aa4aa2cd714b41d339438acb4be77a5` | 39364 B `ebf247631d3bb9aa9f3b3802f76ebcc7d2866e8a8d6b72f5f074acad33feae1f` |
| `docs/architecture/system-manifest.yaml` | 66860 B `555d5e7b158cc04eb9277fa9d09d49dbbc3ee4136f276249c2a601e112e8e0c7` | 70460 B `5f37ee6d54ccb7dd518aff6fc1a9bbd3391218e37ed13e0f7f8f709c7e89658e` |

架构章节：`EXECUTION-FLOW.md` **E-94**（成交前执行资格闸门）、`CONTRACT-MAP.md` **C-100**（可选契约）、
`SYSTEM-BASELINE.md` 新增「FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005 增量」节、
`system-manifest.yaml` `baselineVersion v2.3.0 → v2.4.0`（minor，新增 platform 级可选 contract/entry point）。

---

## 3. 三个修复的落点

### 3.1 F1 — 成交前 ST 拒单真的进入权威撮合链

```text
experiment.ts#createStExecutionEligibilityGate(provider)            ← 研究装配层（政策唯一实现）
  policyVersion = recovery-st-execution-eligibility/1.0.0
  decideBuy → evaluateStGate(PRE_FILL, checkedAt = <executionDate>T09:15:00)
        ↓ 注入
groupSimConfig.executionEligibilityGate
        ↓
engine.ts#runTradeSimulation  逐日 due-order 循环（side === "buy"）
        ① 早于 dayBars 查找 / executionModel.quote / portfolio.buy / computeTradeCost / stats.totalFills
        ② status !== "NORMAL" || allowed !== true ⇒ audit.recordOrder(REJECTED) + stats.rejectedOrders + continue
        ③ 收尾硬断言：任何 outcome === "FILLED" 的买入必须 status === "NORMAL"，否则 throw
            EXECUTION_ELIGIBILITY_VIOLATION（整轮失败）
```

- **分工**：确认日收盘资格（`confirmCloseBuyEligibility`）**只**决定候选池 / Top3 / Random 抽样；
  成交日结论**不在前一日使用**（`plannableByDate` 不变 ⇒ 不删股票、不递补 rank4）。
- **不越界**：纯撮合层**零** `research-experiments/**` import、**零** DB 访问；卖出与已持仓退出
  走原分支，**完全不经过**闸门。
- **可审计**：`TradeSimulationRun.executionEligibilityAudit`（gateId / policyVersion / providerId /
  evidenceFingerprint / checkedAt / **plannedCheckDate vs executionDate** / outcome）+ `run.config.executionEligibility`
  （只有可序列化身份，**函数不入 JSON**）+ `frozen-config.json.stGate`。
- **拒单产物**：`execution-eligibility-rejections-{group}.csv`（symbol / anchor / account / orderId /
  plannedDate / plannedCheckDate / actualCheckDate / checkedAt / status / reason / providerId / gateId /
  policyVersion / evidenceFingerprint / `rejectedBy`∈{EXECUTION_ELIGIBILITY_GATE, DOWNSTREAM_MATCHING_CONSTRAINT}）。
- **研究侧硬失败**：`st-fill-audit-{group}.csv` 的成交前一格**取自引擎真实调用记录**
  （不再是候选阶段预计算值）；任何真实成交缺判决记录、或 `status !== "NORMAL"` ⇒ **抛错**（整轮失败）。

### 3.2 F2 — 区间有效性与可知性统一用真正 `effectiveAt`

| 写法 | `effectiveFrom` | `effectiveTo` |
|---|---|---|
| `YYYY-MM-DD` | 当地 `00:00:00` | **覆盖整日** ⇒ 当地 `23:59:59`（闭区间含端点） |
| `YYYY-MM-DDTHH:mm:ss` | 原样 | 原样（**精确时间不扩展到整日**） |
| 其它 / 非法日历日 | `INVALID_STATUS_TIME_FORMAT` ⇒ UNKNOWN | 同左 |

判定式 `from <= checkedAt && (to === null || checkedAt <= to)`（**生效含、失效含**）；
时区统一为中国市场当地时间（**字面量比较**，不 `new Date()`、不做时区换算）；
UNKNOWN 失败关闭、无界 NORMAL 仍记 `NORMAL_INTERVAL_UNBOUNDED` —— 证据强度与"无界即未知"规则**未放宽**。
`ST_GATE_CONTRACT_VERSION` 升为 `1.1.0`（provider 形状未变、**时间语义变了** ⇒ 显式升版；
仍声明 `1.0.0` 的 provider 记 `PROVIDER_CONTRACT_MISMATCH`，即 UNKNOWN）。

### 3.3 F3 — 文档与诊断收口

- README / 代码注释 / 日志中「候选必须两个时点 NORMAL 才生成意图」这类**超出实现**的叙述已改为
  「确认日资格与排序」vs「成交前拒单」的分工表（README §0 + `experiment.ts` 处理顺序与就地注释）。
- **早诊断**：`resolveStatusProvider() === null`（provider 明确缺失）⇒ `run()` 在**事件扫描之后、
  任何 rd≥1 读取之前**收口：不 `freezeSelection`、不读 post rd1..80、不解析身份、不撮合。
  未扫描的候选数 / 覆盖分母一律 `null`（**未测**），并交付
  `st-coverage-gap-summary.json` + **`st-early-diagnostic.json`** + `status-coverage.csv`（0 数据行）
  + `st-coverage-counts.csv`（未测行计数列留空）+ `st-gap-samples.csv`（0 行）+ `frozen-config.json`，
  终态仍是 `ST_COVERAGE_BLOCKED`（**不伪装成收益研究完成**）。
- `stCoverageBlocked.measurement ∈ {MEASURED, NOT_SCANNED_PROVIDER_ABSENT}`，并由 zod `superRefine`
  **强制**「未测 ⇒ 计数全 `null`」/「已实测 ⇒ 真实计数（不得为 null）」——「未测 ≠ 0」写进契约，不只是注释。

---

## 4. 测试与闸门（命令 + 退出码）

| # | 命令 | 退出码 | 结果 |
|---|---|---:|---|
| 1 | `pnpm run check` | **0** | `tsc --noEmit` 0 错（日志 `gate-check.log`） |
| 2 | `pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoveryStExecutionGate.test.ts` | **0** | **25 / 25 通过**（新增，日志 `test-new-04.log`） |
| 3 | `pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoverySt.test.ts` | **0** | **39 / 39 通过**（28 → 39） |
| 4 | `pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoveryStBlocked.test.ts` | **0** | **14 / 14 通过**（12 → 14） |
| 5 | `pnpm exec vitest run ...rollingPoolRecoverySt ...rollingPoolObservationWindow ...rollingPoolEarlyEntryRunner tests/server/research/simulator` | 0 | 9 文件 / 147 例（含 simulator 34 例、observation-window 31 例、early-entry-runner 18 例） |
| 6 | `pnpm run test:changed` | **1** | `Test Files 4 failed \| 176 passed (180)`；`Tests 10 failed \| 2372 passed (2382)` —— **失败集合与 §1.2 改动前完全同一（4 文件 / 10 例，零新增失败）**；通过数 2218 → 2372（其中 38 例是本轮新增/追加的用例，其余来自工作区里其他会话的改动文件进入 `test:changed` 集合：175 → 180 个文件）。日志 `gate-test-changed.log` / `gate-test-changed-2.log` |
| 7 | `node scripts/checkEolDrift.mjs --strict` | **1** | `已跟踪文件中疑似行尾漂移：0`；`未跟踪新文件中 CRLF：1` = **其他会话的 `_scratch/overlap/probe01_db_state.mjs`**（本轮**未触碰**，mtime 2026-10-10 21:41，未扩大忽略范围）⇒ **因此不声称全仓绿** |
| 8 | `pnpm exec tsx scripts/_scratch/.../probe-f2-interval-boundary.mts` | 0 | 改动前 6/10 不符；改动后 **0/10 不符** |
| 9 | `pnpm exec tsx scripts/_scratch/.../probe-digest-baseline.mts` | 0 | 三次运行 digest 与 §1.3 基线**逐字节相同** |

### 4.1 §3 验收场景 → 用例映射（全部走**真实 `runTradeSimulation`**）

| PLAN §3 场景 | 用例（`rollingPoolRecoveryStExecutionGate.test.ts`） | 证明 |
|---|---|---|
| 确认日 NORMAL、成交日 ST | §1（2 例） | `trades=0`、`totalFills=0`、`rejectedOrders=1`、逐日 `cash/equity=100000`、`positions=0`；`executionEligibilityAudit[0]={status:ST,reason:VERIFIED_ST,checkedAt:<fill>T09:15:00}`；订单审计留具名原因 |
| 成交日 UNKNOWN | §2（2 例） | `status=UNKNOWN` 且 `reason` 原样保留（`NO_STATUS_FACT` / 不覆盖当日）；无成交、无扣款 |
| 平仓后再入场、次日 ST | §3 | 第一笔完整交易（D1 买 / D3 卖）**保留**；D5 二次入场 `REJECTED(ST)`，无新成交 |
| R 与 Random 同政策、账户独立 | §4 | 同一 `policyVersion` / `gateId`；R 空仓 `equity=100000`，Random 真实成交，互不影响 |
| rank1 隔夜 ST、rank4 正常 | §5 | 意图仅 Top3；rank1 `REJECTED(ST)`；rank4 **连订单都没有**（无递补、无额外订单） |
| 两时点均 NORMAL | §6（含正对照） | 真实买卖 + 成本（`fees>0`、`costs.totalCost>0`）+ 成交日现金下降 + `canonicalMetrics` 可读 |
| 持有中变 ST | §7 | 不新增买入；候选退出**照常卖出**（D1 买 / D3 卖）；卖出侧零"执行资格"拒绝 |
| 8 | 未提供可选接口 | §8（5 例） | **指纹 / tradeDigest / equityDigest / canonicalMetrics 与 §1.3 基线完全相同**；`executionEligibilityAudit === undefined`；`config` 无该字段；非法闸门形状**响亮失败**；`status=ST` 却自称 `allowed=true` 仍拒单（失败关闭）；带闸门记录 `serialize`/`deserialize` 往返指纹自洽 |
| 日内与日期边界 | §9（10 例） | 09:00 到期拒单、08:00 生效放行、精确端点两侧放行、09:15:01 拒单、日期终点覆盖整日、隔夜转 ST 拒单、`availableAsOf` 过晚拒单、无效日期/格式拒收；且与单时点 `evaluateStGate` 判决同源 |

另：`rollingPoolRecoverySt.test.ts` §12 用**纯函数**层再钉一遍同一组边界（生效含 / 失效含 / 日期终点 /
无效日期 / 契约升版），`rollingPoolRecoveryStBlocked.test.ts` §5 直接组装**已实测**暂停路径，
断言 schema 既拒绝「未测却填数字」也拒绝「已实测却填 `null`」。

---

## 5. Expected / Unexpected / Unknown 差异表 + 偏差登记

### 5.1 Expected（按 PLAN 刻意造成的行为差异）

| # | 差异 | 位置 | 为什么是预期的 |
|---|---|---|---|
| E-1 | 隔夜转 ST 的买单现在**真的被拒**（此前会成交） | 引擎 due-order 循环 | F1 的核心要求；缺省不声明闸门时**不发生** |
| E-2 | 日内失效/生效区间在 09:15 判对（此前误放行 / 误拒绝） | `evaluateStGate` | F2 要求；AUDIT §9.3 已复现 |
| E-3 | 无效日期 / 不支持格式**不再**靠字典序放行 | `normalizedInterval*` | PLAN F2 明文要求 |
| E-4 | 日期形式 `effectiveTo` 覆盖**整日**（23:59:59 闭区间） | `normalizedIntervalEnd` | 若不这样，15:00 的确认日检查会误判"已失效"（§5.2 偏差 D-1） |
| E-5 | `ST_GATE_CONTRACT_VERSION` `1.0.0 → 1.1.0`；旧版本 provider 记 `PROVIDER_CONTRACT_MISMATCH` | `stGate.ts` | 语义变更必须显式（模块自身第 3 条纪律）；失败关闭 |
| E-6 | `SimulationConfig` / `Snapshot` / `Run` 出现**新可选**字段 | `simulator/*` | 新 platform 级可选 contract；缺省时字段**不出现**（digest 不变） |
| E-7 | provider 缺失时 `run()` **不再**读 post rd1..80、不再 `freezeSelection` | `experiment.ts` 早诊断 | F3 要求：不为同一缺口重复全量扫描 |
| E-8 | 该路径下候选数 / 覆盖分母 = `null`（未测），统计行 `value=null` | `result.ts` + envelope | F3：「禁止伪造 0」 |
| E-9 | 暂停产物由 5 份变 6 份（新增 `st-early-diagnostic.json`）；`status-coverage.csv` 0 数据行、`st-coverage-counts.csv` 新增 `note` 列 | `experiment.ts` / `result.ts` | 让「未测」可对账、可追溯 |
| E-10 | `st-fill-audit-*.csv` 成交前一格取自**引擎真实调用记录**，并新增 4 列 + `execution-eligibility-rejections-*.csv` | `experiment.ts` | F1 第 6 条 |
| E-11 | 既有测试 fixture 的**非法日历日**（`2024-02-41`）改为合法日期 `ST_FAR_END=2024-03-31` | `rollingPoolRecoverySt.test.ts` | 旧 fixture 依赖 F2 已禁止的字典序放行（§5.2 D-3） |
| E-12 | 暂停路径测试断言由「带计数」改为「未测 + null」 | `rollingPoolRecoveryStBlocked.test.ts` | 契约按 PLAN F3 变更；同文件新增已实测路径直接用例以保住旧覆盖 |

### 5.2 Unexpected（本轮实际发生的意外，全部已处理并登记）

| # | 意外 | 处置 |
|---|---|---|
| D-1 | 若只把比较对象换成 `effectiveAt` 而不定义「日期形式 `effectiveTo` 覆盖整日」，`CONFIRM_CLOSE 15:00` 会把当日仍生效的 NORMAL 区间误判为已失效（探针用例 D 会由 `NORMAL` 变 `UNKNOWN`） | 按 PLAN 明文实现整日归一化；用例 C/D 钉住 |
| D-2 | `rollingPoolRecovery/index.ts` 与 `compositeRunnerBridge.ts` 是**先改后备份**（各 1 处 additive 行） | 用「删除该行再哈希」重建改动前内容，`before/` 里存的是**重建后的**改动前副本，`manifest-before.txt` 同时保留两行原始记录以便复核（`index.ts` before sha16 = `214DBB280200B990`、`compositeRunnerBridge.ts` = `E15BF7CE7F39BE78`） |
| D-3 | 既有测试用 `2024-02-40`/`2024-02-41` 这类**算术溢出的非法日期**当"远期端点"，F2 之后它们被判 `INVALID_STATUS_TIME_FORMAT` ⇒ 3 例由绿转红 | **不是改测试掩盖失败**：这是 F2 明确禁止的放行方式，属 fixture 缺陷；改为合法远期日期后语义不变（`ST_FAR_END = 2024-03-31`，仍覆盖全窗口），并在结果文件登记 |
| D-4 | 早诊断使 `run()` 的「已实测暂停路径」在无 provider 时**不可达**（`resolveStatusProvider()` 恒 `null`），原有 run 级计数断言失去着力点 | 保留同一组装函数的**直接调用**用例（`rollingPoolRecoveryStBlocked.test.ts` §5）钉住已实测计数语义 + schema 双向约束 |
| D-5 | `edit` 工具把 `engine.ts` 唯一的行尾 CRLF（文件末空行）翻成 LF ⇒ 记录形态由 `MIX(crlf=1)` 变 `LF` | 已**逐字节恢复**该处 CRLF（复核：尾部 `3B 0A 7D 0A 0D 0A`，`crlf=1/lf=2144`），与改动前一致 |
| D-6 | F2 探针首版漏传 `availableAsOf` 覆盖（用例 J 实际上仍用默认值，得出假"通过"） | 修正探针后**重跑改动前**基线，得到 §1.1 的真实 6/10；改动前的错误结论未进入任何判断 |

### 5.3 Unknown / 本轮**未**验证

| # | 未验证项 | 原因 / 边界 |
|---|---|---|
| U-1 | 非暂停（`ST_COVERAGE_VERIFIED`）**完整真实路径** | 需要可 PIT 核验的 provider + Security Master（DB 身份解析）；phase 1 明确不连库、不跑 Run。本轮用「研究装配层同一个闸门对象 + 真实 `runTradeSimulation`」覆盖其**撮合段**（§3 验收全部用真实引擎） |
| U-2 | 真实 provider 数据的 ST 覆盖率 / 时点可得性 | 数据缺口未解除（见 §7）；代码修复 ≠ 数据已满足 |
| U-3 | SMOKE / STUDY 的收益、矩阵、账户表现 | 本轮**不跑**；没有收益结论，也**不**声称策略有效或无效 |
| U-4 | 性能（相对旧路径的提速） | 本轮没有真实性能基准，**不承诺**任何提速；早诊断只声明"不再重复读 post80"，未测耗时 |
| U-5 | `Random` 抽样/Top3 在**真实 42 账户**下的等价性 | 本轮只做结构级论证（闸门仅在撮合时点被调用，排序/抽样代码路径未改）+ 引擎级用例；未跑真实矩阵 |
| U-6 | 生产闭环路径（未声明闸门）的端到端 | 结构上不可能受影响（字段缺省 ⇒ 快照/记录/指纹不变，§1.3 + 场景 8 已证）；未跑生产 Run |

### 5.4 与"禁止事项"的对照

| 禁止项 | 本轮事实 |
|---|---|
| 事后删交易 / 改收益 / 把 ST 写成停牌 / 改涨停字段 / 另造第二套撮合循环 | ✅ 未做（拒单发生在成交前，不触碰任何已成交记录；未新增第二循环，只加一个前置分支） |
| 用次日 ST 事实在前日删股票 / 递补第 4 名 | ✅ 未做（`plannableByDate` 只用 `confirmCloseBuyEligibility`；用例 §5 断言 rank4 连订单都没有） |
| 拒绝函数进入持久化 JSON | ✅ 未做（快照只放 `{gateId, policyVersion}`；判决以纯数据进 `executionEligibilityAudit`） |
| 纯撮合层 import `research-experiments/**` / 直连 DB | ✅ 未做（新增类型只在 `simulator/types.ts`，实现由调用方注入） |
| 缺省行为被改动（001/002/003 与正式策略） | ✅ 未做（§1.3 digest 恒定 + 场景 8 常量化） |
| 为通过测试而修改测试 | ✅ 未做（见 D-3/D-4：改动均因契约按 PLAN 变更，且旧失败在改动前已实测复现、改动后仍是同一集合） |
| 把未扫描计数写成 0 | ✅ 未做（一律 `null` + `measurement` 判别 + schema 强制） |

---

## 6. 契约 / 数据库 / 执行影响

- **契约**：新增可选 `SimulationConfig.executionEligibilityGate`（platform 级 additive，缺省不变）；
  `SimulationConfigSnapshot.executionEligibility?`；`TradeSimulationRun.executionEligibilityAudit?`；
  `ST_GATE_CONTRACT_VERSION` 1.1.0；`ST_GATE_REASONS` 新增 `INVALID_STATUS_TIME_FORMAT`（**只增不改**）；
  研究信封：`stCoverageBlocked` 计数改为可空 + `measurement` + `superRefine` 一致性约束（未测/已实测双向钉死）。
- **数据库**：**0** schema / **0** migration / **0** DDL / **0** DML / **0** 连接。未改历史数据、
  未回填、未新建 Dataset、未创建 Run。`datasetVersionId = 780004` 与 `strategy_versions.id = 3600005`
  **均未被触碰**。
- **执行**：仅当**显式声明**闸门时，`runTradeSimulation` 的买入路径多一次成交前资格检查
  （早于报价/现金/持仓/成本/成交计数）；卖出与原退出规则不变。研究实验 `run()` 在 provider 缺失时
  提前收口（少读 80 个相对日）。生产闭环（未声明闸门）路径**行为不变**。
- **基线**：minor（新增 platform 级可选 contract / entry point）⇒ 已同步
  `SYSTEM-BASELINE.md` + `system-manifest.yaml`（`v2.4.0`）+ `EXECUTION-FLOW.md`（E-94）+
  `CONTRACT-MAP.md`（C-100）+ `CHANGE-AUDIT.md`。

---

## 7. 剩余数据 Gate（代码修复 ≠ 数据已满足）

`ST_COVERAGE_BLOCKED` 的**根因未变**，它只能由数据供给解除：

1. **可 PIT 核验的逐日 ST 状态**：需要「区间 + 生效时刻 + **可获知时刻**（公告/可得）+ 来源 + 证据指纹」；
   现状：唯一 ST 源 ST 行 `availability` 全 `UNKNOWN`、窗口内可获知时间 = 0（AUDIT §1.2 E1）。
2. **覆盖面**：2,378 / 2,827（84%）symbol 窗口内无任何 ST 行 ⇒ **absence ≠ NORMAL**（E3）；
   需要 2,827 个 symbol 各自的覆盖依据，不能靠"约 500 个区间/千行"的粗估。
3. **数据集字段一致性**：948 个平台判定 ST 格 `limitRuleUp` 仍为 10%、`canBuyAtOpen=1`（E2）；
   执行行情字段与 ST 状态不一致的问题**本轮未修**（属构建期口径，需单独影响报告 + 授权）。
4. **注入点就绪**：`experiment.ts#resolveStatusProvider()` 仍是唯一注入点；补齐后返回真实 provider
   即可走完整路径（**无需再改撮合层**）。
5. **行情尾部**：组合执行理论上需约 rd94，Dataset 物理上界 rd80；理论 rd94/95 与"无法卖出尾部"检查
   **保持**，不得用旧规则的"post80 零暴露"外推。
6. 以上任一条未满足前：`SMOKE`/`STUDY` 不得产出收益矩阵，`ST_COVERAGE_BLOCKED` 是**合法终态**而非失败。

---

## 8. 复现指引（Codex 验收用）

```bash
# 1) 类型闸门
pnpm run check                                        # 期望 exit 0

# 2) 新增 / 受影响的定向测试
pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoveryStExecutionGate.test.ts   # 25 例
pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoverySt.test.ts                # 39 例
pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoveryStBlocked.test.ts         # 14 例

# 3) 增量回归（应与 §1.2 的既有 4 文件 / 10 例完全同一集合，零新增）
pnpm run test:changed

# 4) 行尾哨兵（非 0 只因其他会话未跟踪的 CRLF 探针；tracked 漂移 0）
node scripts/checkEolDrift.mjs --strict

# 5) F2 边界与 digest 基线探针
pnpm exec tsx scripts/_scratch/recovery-st-fix005/probe-f2-interval-boundary.mts
pnpm exec tsx scripts/_scratch/recovery-st-fix005/probe-digest-baseline.mts
```

日志与探针：`scripts/_scratch/recovery-st-fix005/`
（`probe-f2-before.log`、`probe-f2-after.log`、`probe-digest-before.json`、`probe-digest-after*.json`、
`baseline-test-changed.log`、`gate-check.log`、`gate-eol.log`、`gate-test-changed.log`、`gate-test-changed-2.log`、
`test-new-04.log`、`test-st-rules-02.log`、`test-blocked-02.log`、`before/`）。

---

## 9. 终态

**`READY_FOR_CODEX_REVIEW`**

- phase 1（F1 + F2 + F3 + 测试 + 文档）已完成：`pnpm run check` exit 0；定向测试 78 例全绿
  （25 + 39 + 14）；`test:changed` **零新增失败**（与改动前同一 4 文件 / 10 例既有失败）；
  `checkEolDrift --strict` **非 0 仅因其他会话未跟踪的 CRLF 探针**（tracked 漂移 0，已单独披露，不声称全仓绿）。
- phase 1 **没有**跑真实 SMOKE/STUDY、**没有**写数据库、**没有**构建 Dataset、**没有**创建 Run。
- 下一步（**需 Codex 在本会话发出明确复验指令后**才进入）：按 PLAN §4 调用 004 运行工具的 SMOKE，
  先做只读前置/资格/行情尾部检查；合法矩阵未产出时报告 `ST_COVERAGE_BLOCKED` 与具体行情 Gate，
  **不反复重跑同一缺口**，也不创建空仓收益研究冒充完成。

---

# 10. phase 1 **续修**（2026-10-11 · 代码评审两条发现：Finding A / Finding B）

> 本轮**只**关闭两条代码评审发现。§1–§9（上一轮 F1/F2/F3 的全部证据与结论）**逐字保留，未覆盖**。
> 边界不变：**没有**跑真实 SMOKE/STUDY（一次都没有）、**没有**连接数据库（0 SELECT / 0 DML / 0 DDL /
> 0 migration）、**没有**构建 Dataset、**没有**创建 / 覆盖 Run、**没有**跑 `pnpm run format`、
> **没有** `git reset/stash/commit/checkout`（HEAD 仍 `f8b6810`）、**没有**触碰
> `_scratch/overlap/probe01_db_state.mjs`。所有"运行"仍只是**合成 fixture 的单元测试**与**仓外探针**。

## 10.1 Finding A（🔴 真实漏洞）：辅助匹配路径没有 ST 闸门 —— 已**结构性**关闭

### 10.1.1 洞是什么（代码坐标 + 前置事实）

```text
experiment.ts#run 第 12 步（逐组）
  → runCompositeRunnerBacktest({ dataset, sourceRun, strategyDocument, …, runnerBridge })   ← 只为拿 simulationConfig
      → server/research/compositeRunner/index.ts#runCompositeRunnerBacktest
          → assembleRunWorkbenchInputs(...)                       （装配：不含执行资格闸门）
          → runTradeSimulation({ dataset, sourceRun, simConfig })  ← 🔴 **真的撮合一次**，结果被丢弃
```

- 那次辅助撮合的 `simulationConfig` 由 `assembleRunWorkbenchInputs` 装配，**不携带**
  `executionEligibilityGate` ⇒ 同一份合成 fixture 下，未声明闸门确实会**买进**成交日已转 ST 的票
  （§10.1.4 的实测正对照就是这条：`totalFills = 1`）。
- 因此「正式账户已受闸门保护」**不足以**排除该洞：这条辅助路径仍可能买一笔隔夜 ST。

### 10.1.2 选择了哪个方案、为什么

**选了首选方案（1）：拆出「只装配、不撮合」的权威入口**，而不是 fallback（给 composite-runner 加可选闸门再透传）。

| 判据 | 首选方案（已实施） | fallback（未采用） |
|---|---|---|
| 洞是否结构性消失 | ✅ 辅助路径**不再有撮合** ⇒ 不存在「未声明闸门的买入」 | ⚠️ 仍保留一次无用撮合，只是**要求调用方记得注入**闸门 |
| 是否引入第二套配置口径 | ✅ 两入口**共用同一段装配实现**（`runCompositeRunnerBacktest` = 装配入口 + `runTradeSimulation`） | ✅ 同样共用，但多一条可选参数透传路径 |
| 性能（PLAN 的「复用权威装配」） | ✅ 每组少一次全账户级真实撮合 | ❌ 无用撮合照旧 |
| 缺省 digest 不变的可证性 | ✅ 同一实现 ⇒ 配置逐字节同（测试实测） | ✅ 同 |

**未采用 fallback 的原因**：它把「辅助路径不该撮合」这件事继续留在代码里，只靠「谁记得注入」；
而首选方案让它**不可能**发生（结构上没有撮合产物）。这也是 PLAN F3「不重复做无用扫描」的同一取向。

### 10.1.3 新入口 + 契约版本 + 指纹

| 项 | 内容 |
|---|---|
| 入口 | `server/research/compositeRunner/index.ts#assembleCompositeRunnerSimulationConfig` |
| 契约版本 | ✅ `COMPOSITE_ASSEMBLY_CONFIG_CONTRACT_VERSION = "composite-assembly-config/1.0.0"`（随产物返回，进留档） |
| 入参 | `Omit<RunCompositeRunnerBacktestInput, "sourceRun">`（+ 可选 `corporateActionResolver`） |
| 产物 | `{ contractVersion, simulationConfig, assemblyConfigFingerprint, assembly }` —— **结构上不存在** `run` / 交易 / 权益曲线 |
| 指纹 | `fingerprintSimulationConfig(config) = sha256(canonicalJson(配置可序列化面))`；函数以 `fn:<name>` 占位（**不静默丢弃**）；⚠️ **不是** `run.fingerprint` |
| 旧入口 | `runCompositeRunnerBacktest` = 该入口 + `runTradeSimulation`（**唯一**撮合入口不变） |
| 实验侧落点 | `experiment.ts#run` 每组改用新入口；`frozen-config.json` 新增 `auxiliaryAssembly`（入口名 / 契约版本 / 每组配置指纹 / `matchingExecuted: false`） |
| 反向依赖 | 纯撮合层 `server/research/simulator/**` **零改动**：不 import `research-experiments/**`、不连 DB |

### 10.1.4 真实匹配证据（不是布尔标志）

新增 `tests/server/researchExperiments/rollingPoolRecoveryStAuxiliaryAssembly.test.ts`（**7 例**，全部走真实装配 + 真实 `runTradeSimulation`；
其中「装配期间撮合调用次数」用 `vi.mock` 包一层**计数器**（不改行为、仍调用真实实现）取证）：

| # | 用例 | 实测结果 |
|---|---|---|
| 1 | 装配期间 `runTradeSimulation` 调用计数 | **0**；产物键集恰为 `assembly / assemblyConfigFingerprint / contractVersion / simulationConfig`；`"run" in result === false` |
| 2 | 对照：`runCompositeRunnerBacktest` 同输入 | 调用计数 **1** ⇒ 差别**恰好**是那次被丢弃的撮合 |
| 3 | 两入口配置同一性（无 / 有 `runnerBridge`） | `simulationConfig` **深层相等** + **配置指纹相等**；`runnerBridge` 合并口径一致 |
| 4 | 缺省（无闸门）真实撮合 | `totalFills = 1`、真实成交 1 笔；与旧路径 `tradeDigest` / `equityDigest` / `run.fingerprint` / `sourceFingerprint` / `canonicalMetrics` **逐字节相同**；`run.config` **无** `executionEligibility` 键；`executionEligibilityAudit === undefined` |
| 5 | 🔴 **装配配置 + 注入闸门（确认日 NORMAL / 成交日 ST）** | **0 成交、0 持仓、`totalFills = 0`、`rejectedOrders = 1`**；逐日 `cash = marketValue = equity = 100000` 不变；审计 1 条：`securityId` = 锚点、`status = "ST"`、`outcome = "REJECTED"`、`gateId = recovery-st-004/pre-fill-st-gate`、`plannedCheckDate = D0`、`executionDate = D1`、`checkedAt = D1T09:15:00`；订单审计留具名原因「执行资格闸门拒绝…status=ST」 |
| 6 | 正对照：两时点 NORMAL | 同一配置**真的会成交**（`totalFills = 1`、`fees > 0`、`rejectedOrders = 0`）⇒ 用例 5 的零成交不是「永远不买」 |

**结论（可复核）**：辅助 / 装配路径**不再产生任何撮合结果**（用例 1、2），
而它的配置一旦被真实撮合（这正是上一轮「被丢弃的那一次」做的事），在**缺省**下确实会买进隔夜 ST（用例 4），
在**注入闸门**后零成交（用例 5）——因此该洞**既被结构性消除，也有真实撮合输出取证**。

### 10.1.5 「缺省不变 / digest 逐字节相同」的三条证据（证明，不是断言）

1. **同输入配置同一性**：`assembleCompositeRunnerSimulationConfig` 与 `runCompositeRunnerBacktest`
   的 `simulationConfig` 深层相等 + 配置指纹相等（用例 3；含 `runnerBridge` 分支）。
2. **真实撮合结果同一性**：缺省下两者的 `tradeDigest` / `equityDigest` / `run.fingerprint` /
   `sourceFingerprint` / `canonicalMetrics` 完全相同（用例 4）。
3. **固定合成输入探针复核**（§10.4 表 5）：`probe-digest-before.json` / `probe-digest-after.json` /
   `probe-digest-after2.json` **仍逐字节相同**（三者 SHA-256 一致），本轮新增的复核运行
   `probe-digest-after3.json` 在剥掉旧文件里混入的两行 shell 输出后 **payload SHA-256 完全相同**
   （`d3727b79…`，1743 B）：`runFingerprint = fefd6104…`、`tradeDigest = d2b52157…`、
   `equityDigest = 6aacf974…` —— 与 §1.3 基线逐字节一致。

## 10.2 Finding B（`BASELINE_DRIFT`）：基线版本链分叉 —— 已合并为 **`v2.8.0`**

### 10.2.1 事实（改动前）

| 文件 | 改动前 |
|---|---|
| `docs/architecture/SYSTEM-BASELINE.md` | `Baseline Version = v2.7.0`（上一版 `v2.6.0`；历史 `v2.2.0` / `v2.0.0`） |
| `docs/architecture/system-manifest.yaml` | `baselineVersion = v2.4.0`（`baselineHistory` 止于 `… v2.2.0, v2.3.0, v2.4.0`） |

⇒ 同一时间点两份基线文件的版本链**分叉**：manifest 停在 `v2.4.0`，基线头部已在 `v2.7.0`。

### 10.2.2 drift 原因（登记的原文口径）

> **`BASELINE_DRIFT`**：`system-manifest.yaml` 的 `baselineVersion` 落后于 `SYSTEM-BASELINE.md` 的版本链。
> 上一轮的 `v2.3.0 → v2.4.0` 递增是从 **manifest 自身陈旧的 `v2.3.0`** 起算的，
> **而不是**接续基线头部的 `v2.7.0` ⇒ 编号链断裂（`v2.7.0 → v2.4.0` 不是合法接续）。

处置（按 `AGENTS.md` §2：「发现文档说 A / 文档是 B ⇒ 标 `BASELINE_DRIFT` → **修正文档**（不改代码）→ 记录原因」）：
**合并两份文件的版本历史并统一为 `v2.8.0`**，使 `v2.7.0 → v2.8.0` 成为唯一接续。

### 10.2.3 合并后的版本链（历史**一条未删**）

```text
v1.0.0 → v1.1.0~v1.4.0 → v2.0.0 → v2.1.0 → v2.2.0 → v2.3.0
   → v2.6.0 (T74-LATE-ENTRY-P8-001)
   → v2.7.0 (T74-EVENT-GATE-P9-001)
   → v2.4.0 ⚠️ BASELINE_DRIFT：由 manifest 自身陈旧的 v2.3.0 递增而来；内容已并入 v2.8.0，**编号保留、不删历史**
   → v2.8.0 (FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005 续修：权威装配配置入口 + 版本链合并)   ← 本轮
```

| 文件 | 改动后 | 具体改动 |
|---|---|---|
| `SYSTEM-BASELINE.md` | `v2.8.0`（上一版 `v2.7.0`；历史 `v2.6.0` / **`v2.4.0`（新增条目 + drift 标注）** / `v2.2.0` / `v2.0.0`）；`Last Change Time = 2026-10-11`；「审计方式」行同步 | 头部版本块 + 新增加量节（§`v2.8.0`）+ 旧 `v2.4.0` 增量节**标注**（内容逐字保留） |
| `system-manifest.yaml` | `baselineVersion: v2.8.0`；`baselineHistory` **10 条**（原 6 条全部保留 + `v2.6.0` + `v2.7.0` + `v2.4.0`（drift 标注）+ `v2.8.0`） | 顶部版本块 + drift 注释 + 新增 `recoveryStFix005FindingA:` 节；旧 `recoveryStFix005:` 节**逐字保留** + drift 注释 |

- **观测到的断号（如实登记，不回填）**：`v2.5.0` 在仓库任何文件（基线头部 / manifest 历史 / `CHANGE-AUDIT.md`）中
  **都没有登记**（全仓 grep 命中 0）⇒ 作为**断号**记录，**不**臆造条目补链。
- 两份文件的版本历史**没有互相覆盖**：manifest 原有 6 条 + 基线头部原有 4 条全部保留，合并结果 10 条。
- `SYSTEM-BASELINE.md` 头的「审计方式」行仍写明本轮**不连库**（0 写入 / 0 migration）。

## 10.3 本轮改动清单（before → after：字节数 / SHA-256 / 行尾）

行尾：全部 `LF`（新增文件一律 LF；`server/research/simulator/engine.ts` 本轮**未触碰**，其 `MIX(crlf=1)` 保持不变）。
`before/` 快照：`scripts/_scratch/recovery-st-fix005/before/`（`manifest-before.txt` 已**追加**本轮 9 条，未覆盖旧记录）。

| # | 文件 | before | after |
|---|---|---|---|
| 1 | `server/research/compositeRunner/index.ts` | 44023 B `12434c22b37e6720af5f421ab94039d4eab19ad3076dd47b974c4336432f6cc0` | 51026 B `24e03e0ffdaffcbaf0bb6523d899ca8c5ad462785de11f30b4b8b29fa35faaef` |
| 2 | `research-experiments/compositeRunnerBridge.ts` | 6282 B `79ff864af7119ec72c887fd84e772760443dc50587e82d2c3ba056205c746aef` | 6879 B `646a45b53830859e602ec8c8402afd293f6c17185751901a117a84911bff02f0` |
| 3 | `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts` | 166987 B `eefaa0be58b4efaa6562e7aab712b10ec353ada15e108d5136fb5eb591c7c0b3` | 170687 B `af3b9cbeaa5496a8fa6cb9500508634e8dd1a4f2652c163bf9cadfd73d60aae4` |
| 4 | `tests/server/researchExperiments/rollingPoolRecoveryStAuxiliaryAssembly.test.ts`（**新增**） | — | 24101 B `8abf91241a8cea6a5c030b3ca7dcdc4d4d6a708981f0e02bbed4d72d8388d649` |
| 5 | `docs/architecture/SYSTEM-BASELINE.md` | 71920 B `c37b04589dfd049aeb6dd51500416397dc36b844c336ea1349b368c5063e92ce` | 77115 B `e3d3ce9108d36558219943f56ccd51d52e9e2b40e54a3341e6d5d1b4fd71edee` |
| 6 | `docs/architecture/system-manifest.yaml` | 70460 B `5f37ee6d54ccb7dd518aff6fc1a9bbd3391218e37ed13e0f7f8f709c7e89658e` | 75933 B `8d9b10b9d0bc60e8c1c0054d1773adda9c15935fc33c0c0cd574db3785f268f0` |
| 7 | `docs/architecture/CHANGE-AUDIT.md` | 1102981 B `9da493e0172163ca448502c5137a3338617021d5893bf1c8183ff56ba472fa22` | 1107996 B `d5df063a2d5276acafbd8e55b56e98a189b9058fadc6ffa217042ff308436e6e` |
| 8 | `docs/architecture/EXECUTION-FLOW.md`（**E-95**） | 29080 B `6e3024b0e52a0262bb8b9412fe48bf169f171d2575d60abf2299722d53a4fce6` | 32065 B `af84b987a7ccc94f4196283332843aa3e3b42e3e89afba94812e0028f3b52c53` |
| 9 | `docs/architecture/CONTRACT-MAP.md`（**C-101**） | 39364 B `ebf247631d3bb9aa9f3b3802f76ebcc7d2866e8a8d6b72f5f074acad33feae1f` | 41823 B `1e2cf80edbd54c9e4d69d4dfb06836cc7eb0bc3bb23e56ebb95705e01f44367c` |
| 10 | `docs/research/RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md`（本文件） | 33864 B `032c6adcb7c79b8e89598a9ef92d839605075edb354644429c6b2f7fd98715d5` | 见 §10.8（本节追加后的收尾读数） |

未改（明确声明）：`server/research/simulator/{engine,types,validate,plan}.ts`、
`research-experiments/shared/rollingPoolRecovery/**`、`research-experiments/first-board-pullback/rolling-pool-recovery-st/result.ts`、
`paperTrading3fTop3Runner/**`、其它 `research-experiments/**` 实验（**零改动**）。

## 10.4 闸门（命令 + 退出码 + 计数）

| # | 命令 | 退出码 | 结果（日志） |
|---|---|---:|---|
| 1 | `pnpm run check` | **0** | `tsc --noEmit` 0 错（`gate-check-01.log`；收尾在**最终工作区**复跑 `gate-check-final.log`，同 0 错） |
| 2 | `pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoveryStAuxiliaryAssembly.test.ts` | **0** | **7 / 7 通过**（新增；`test-finding-a-03.log`） |
| 3 | 定向 4 文件（`rollingPoolRecoverySt` / `StBlocked` / `StExecutionGate` / `StAuxiliaryAssembly`） | **0** | **4 文件 / 85 例全绿**（39 + 14 + 25 + 7；`test-targeted-01.log`；收尾复跑 `test-targeted-final.log` 同 85/85） |
| 4 | `pnpm run test:changed` | **1** | `Test Files 4 failed \| 177 passed (181)`；`Tests 10 failed \| 2379 passed (2389)` —— 失败集合 = `threeFactorTopNStrategyDocument`(3) / `limitUp`(1) / `limitUp.watch`(4) / `datasetFilterForm`(2)，**与 §1.2 改动前完全同一，零新增失败**（`gate-test-changed-01.log`；收尾在**最终工作区**复跑 `gate-test-changed-final.log`，同一 4 文件 / 10 例 / 2379 passed） |
| 5 | `pnpm exec tsx scripts/_scratch/recovery-st-fix005/probe-digest-baseline.mts` | **0** | `probe-digest-before/after/after2.json` 三者 SHA-256 **仍完全相同**（`c5811df379cd0432c63012dcc1b0eff490f880b623f451d3863eee8518748928`）；本轮复核运行 `probe-digest-after3.json` 剥掉旧文件混入的两行 shell 输出后 **payload SHA-256 相同**（`d3727b79bf36ffa5c12b4a326349bf261c34fbb8a05b1c777f8098129d5d4f82`，1743 B） |
| 6 | `node scripts/checkEolDrift.mjs --strict` | **1** | `已跟踪文件中疑似行尾漂移：0`；`未跟踪新文件中 CRLF：1` = **其他会话的 `_scratch/overlap/probe01_db_state.mjs`**（本轮**未触碰**、未扩大忽略范围）⇒ **因此不声称全仓绿**（`gate-eol-01.log`） |

## 10.5 续修 Expected / Unexpected / Unknown

### 10.5.1 Expected（本轮刻意造成的行为差异）

| # | 差异 | 位置 | 为什么是预期的 |
|---|---|---|---|
| N-1 | 研究实验的**辅助装配不再撮合**（每组少一次真实撮合及其全部副作用） | `experiment.ts#run` + 新入口 | Finding A 的核心要求；洞由此**结构性**消失 |
| N-2 | 新增 platform 级入口与契约 `composite-assembly-config/1.0.0`（+ 配置指纹） | `compositeRunner/index.ts` | 首选方案；契约版本 + 指纹可审计 |
| N-3 | `RunCompositeRunnerBacktestInput` 新增**可选** `corporateActionResolver` | 同上 | 仅供调用方复用解析器 / 纯合成测试不连库；未提供时请求对象**不多键** ⇒ 缺省行为不变 |
| N-4 | `frozen-config.json` 新增 `auxiliaryAssembly` 块 | `experiment.ts` | 让「辅助路径不撮合」成为**产物事实**而非日志里的说法 |
| N-5 | `system-manifest.yaml` / `SYSTEM-BASELINE.md` 双双变为 `v2.8.0`，历史合并为 10 条（含 `v2.4.0` drift 标注） | 两份基线文件 | Finding B 要求（合并链 + 保留历史） |
| N-6 | 新增 `EXECUTION-FLOW.md` **E-95** / `CONTRACT-MAP.md` **C-101** / `CHANGE-AUDIT.md` 条目 | 架构文档 | 新增 entry point + contract ⇒ 按 `AGENTS.md` §8 登记 |

### 10.5.2 Unexpected（本轮实际发生的意外，全部已处置并登记）

| # | 意外 | 处置 |
|---|---|---|
| X-1 | `probe-digest-{before,after,after2}.json` 里**混入了两行 shell 输出**（`[WARN] The "pnpm" field …` 与 `EXIT=0`）—— 这是上一轮落盘命令把包装 shell 的输出一起重定向进文件所致，**与探针 payload 无关** | **未修改**这三个既有文件（保持原样）；本轮复核输出落到新文件 `probe-digest-after3.json`，并**证明**剥掉那两行后 payload SHA-256 与三者**完全相同**（§10.4 表 5） |
| X-2 | 对 `experiment.ts` 的一次 `edit` 工具调用报 `ReplaceFileW EIO (Win32 1175)`（Windows 文件替换瞬时占用） | 立刻复核文件完整性（字节数 + SHA-256 正常、无残留临时文件），随后**同参数重试成功**；未产生半写状态 |
| X-3 | 新测试首版把策略文档的 `datasetVersion` 写成自定义串 `fix005-finding-a`，被文档校验响亮拒绝（`SCHEMA_DATASET_VERSION_INVALID`：必须形如 `rd-<builder>-<rowSchema>-<16hex>`） | 改为使用**sealed fixture 自己的** `dataset.datasetVersion`（更贴近真实：文档与数据集坐标一致）；语义未变 |
| X-4 | 在 `frozen-config.json` 字面量里插入 `auxiliaryAssembly` 块时，**第一次编辑误删了相邻的 `commonAnchorUniverseSize: commonAnchorIds.size,` 行** | 立即重读该区域发现缺失并**当轮恢复**；最终该区域相对改动前的净差异**只有**新增的 `auxiliaryAssembly` 块（可由 §10.3 的第 3 行 SHA-256 与实际 diff 复核） |
| X-5 | runnerBridge 相等性用例初版用了「只声明 kind + 天数」的 runnerBridge，`runCompositeRunnerBacktest` 的真实撮合被校验拒绝（`SIM_CONFIG_EXIT_POLICY_INVALID`：必须且只能声明 `state` 或 `stateCondition`） | 补上 `state: "NEW_HIGH_3"`（合法值域内）⇒ 该用例通过；这也**顺带证明**「旧入口仍会真的撮合」这一事实 |
| X-6 | **自指限制**：本文件要把自己的 after SHA-256 写进自己（Finding A/B 的交付要求），而写入本身会改变该 SHA-256 | 不再试图"恰好相等"，也**不再引用任何会被后续文字作废的中间读数**：§10.8 声明**最终值以 `hash-after-phase1b.log` 末行为准**（本轮在最后一次写入之后复算并落盘），并在任务回执里给出同一读数；§10.3 的其余 9 个文件不受自指影响 |

### 10.5.3 Unknown / 本轮**未**验证

| # | 未验证项 | 原因 / 边界 |
|---|---|---|
| Y-1 | 42 账户**真实完整路径**（含真实 provider / Security Master） | phase 1 明确不连库、不跑 Run。本轮用「研究装配层同一个闸门对象 + 真实 `runTradeSimulation` + 真实装配链」覆盖其**装配段与撮合段**（§10.1.4 全部断言走真实装配 / 真实撮合） |
| Y-2 | 上一轮那次被丢弃的辅助撮合**在真实数据上是否真的买过隔夜 ST** | 该调用已被删除 ⇒ **不可再复现**；只能给出「该配置在缺省下确实会成交、注入闸门后零成交」的等价实测（§10.1.4 用例 4/5）+ AUDIT-004 §9.2 的原始证据 |
| Y-3 | `assemblyConfigFingerprint` 的**跨进程**稳定性 | 函数值以 `fn:<name>` 占位 ⇒ 依赖函数名；本轮只在单测试进程内比对。跨进程对账未验证（如需，应改为只对**可序列化身份**取指纹） |
| Y-4 | `v2.5.0` 到底是什么变更 | 全仓无任何登记（基线头部 / manifest / CHANGE-AUDIT 均无）⇒ 如实登记为**断号**，不回填臆造条目 |
| Y-5 | `system-manifest.yaml` 是否有机器消费者依赖 `v2.4.0` | 全仓 grep 未发现代码 / 测试解析该文件（它是**文档工件**）⇒ 改版本号无机器影响；未逐一对全部工具脚本做穷尽审计 |

## 10.6 与「禁止事项」的对照（本轮）

| 禁止项 | 本轮事实 |
|---|---|
| 跑真实 SMOKE / STUDY | ✅ 未做（0 次调用运行入口） |
| 写数据库 / 建 Dataset / 创建 Run | ✅ 未做（0 连接 / 0 DDL / 0 DML / 0 migration） |
| 改 A/B 规则、T+20、五日综合分、排序因子、TopK、Runner、成本、seed、主指标、bootstrap、停止判据 | ✅ 未做（`git diff` 不触及任何这些口径；`research-experiments/shared/**` 零改动） |
| 纯撮合层 import `research-experiments/**` / 直连 DB | ✅ 未做（`server/research/simulator/**` **零改动**） |
| 用「辅助结果被丢弃」当借口不改 | ✅ 未做（**首选方案**把辅助路径的撮合整个去掉） |
| 为通过测试而修改测试 | ✅ 未做（新测试**新增**；既有测试与失败集合未变，§10.4 表 4 与 §1.2 一致） |
| 用假版本号/覆盖历史来"修"基线 | ✅ 未做（历史 10 条全保留；`v2.4.0`/`v2.5.0` 断号如实登记，不回填） |
| 声称全仓 EOL 绿 | ✅ 未做（tracked 漂移 0，但未跟踪 CRLF 1 属其他会话，已单独披露） |

## 10.7 复现指引（Codex 验收 · 续修部分）

```bash
# 类型闸门
pnpm run check                                                                   # 期望 exit 0

# Finding A：新入口 + 辅助装配路径（7 例，真实装配 + 真实 runTradeSimulation）
pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoveryStAuxiliaryAssembly.test.ts

# 上一轮 + 本轮定向集合（4 文件 / 85 例）
pnpm exec vitest run tests/server/researchExperiments/rollingPoolRecoverySt.test.ts \
  tests/server/researchExperiments/rollingPoolRecoveryStBlocked.test.ts \
  tests/server/researchExperiments/rollingPoolRecoveryStExecutionGate.test.ts \
  tests/server/researchExperiments/rollingPoolRecoveryStAuxiliaryAssembly.test.ts

# 增量回归（应与 §1.2 的 4 文件 / 10 例既有失败完全同一集合，零新增）
pnpm run test:changed

# 缺省 digest 恒等（固定合成输入）
pnpm exec tsx scripts/_scratch/recovery-st-fix005/probe-digest-baseline.mts

# 行尾哨兵（非 0 只因其他会话未跟踪的 CRLF 探针；tracked 漂移 0）
node scripts/checkEolDrift.mjs --strict
```

日志与探针（本轮新增）：`scripts/_scratch/recovery-st-fix005/`
（`gate-check-01.log`、`gate-check-final.log`、`test-finding-a-0{1,2,3}.log`、`test-targeted-01.log`、
`test-targeted-final.log`、`gate-test-changed-01.log`、`gate-test-changed-final.log`、
`gate-eol-01.log`、`gate-eol-final.log`、`probe-digest-after3.json`、`backup-before-phase1b.mjs`、
`hash-after-phase1b.mjs`、`hash-after-phase1b.log`）。

## 10.8 收尾读数（本文件自身）

| 项 | 值 |
|---|---|
| `docs/research/RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md` before | 33864 B `032c6adcb7c79b8e89598a9ef92d839605075edb354644429c6b2f7fd98715d5`（LF，357 行） |
| 本文件 after（**最终**） | 🔴 自指限制：SHA-256 **不可能**写进被它度量的同一份文件（写进去就变了）⇒ 本行**不引用**任何中间读数。**最终值以 `scripts/_scratch/recovery-st-fix005/hash-after-phase1b.log` 的末行为准** —— 该行在**本文件最后一次写入之后**复算（同一读数亦由本轮执行者在任务回执里给出）。所有其它文件的 after 读数不受此限制（见 §10.3，行尾均 `LF`） |

## 10.9 终态（续修后）

**`READY_FOR_CODEX_REVIEW`**

- **Finding A 已关闭**：新增权威装配配置入口 `assembleCompositeRunnerSimulationConfig`
  （契约 `composite-assembly-config/1.0.0`，**只装配、不撮合**）；研究实验的辅助装配路径
  **不再产生任何撮合结果**；真实撮合输出证明「缺省会买隔夜 ST、注入闸门后零成交」，
  且缺省 digest / 配置指纹与旧路径**逐字节相同**（§10.1.4 / §10.1.5）。
- **Finding B 已关闭**：`SYSTEM-BASELINE.md` 与 `system-manifest.yaml` 的版本链**合并统一为 `v2.8.0`**
  （`v2.7.0 → v2.8.0`），历史条目一条未删，`BASELINE_DRIFT` 原因与 `v2.5.0` 断号如实登记（§10.2）。
- **闸门**：`pnpm run check` exit 0；定向 4 文件 / 85 例全绿；`test:changed` exit 1 但**失败集合与改动前完全同一**
  （4 文件 / 10 例，零新增）；缺省 digest 恒等已复核；`checkEolDrift --strict` tracked 漂移 0
  （非 0 只因其他会话未跟踪的 CRLF 探针，**不声称全仓绿**）。
- 本轮**没有**跑真实 SMOKE/STUDY、**没有**写数据库、**没有**构建 Dataset、**没有**创建 Run。
- 下一步（**需 Codex 在本会话发出明确复验指令后**才进入）：同 §9 —— 先只读前置 / 资格 / 行情尾部检查，
  合法矩阵未产出时报告 `ST_COVERAGE_BLOCKED` 与具体行情 Gate，不反复重跑同一缺口，
  不创建空仓收益研究冒充完成。
