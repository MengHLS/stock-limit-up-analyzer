# RESULT · Event-State Long 正式执行一致性收口

> 目标标识：`EVENT-STATE-LONG-EXECUTION-PARITY-001`
> 规格：[GOAL-EVENT-STATE-LONG-EXECUTION-PARITY-001](GOAL-EVENT-STATE-LONG-EXECUTION-PARITY-001.md)
> 状态：✅ **COMPLETE（S1–S6 全部完成）**。用户裁定已全部落地：① 780005 区间按 `2026-01-29 ~ 2026-09-04` 接受为最终口径；② provenance 暂缓（不伪造）；③ `3600006` 已由 `Validated` 改为 **`Retired`**（§5.3，原内容与指纹保留）。执行一致性（定义 ≡ 执行 ≡ 证据）达成，S3 未解释差异 = 0，两条正式 Run 已留档（`6210013` / `6210014`）。
> 最后更新：2026-10-10

本文件是 §6 要求的唯一结果汇总。**工程核验通过不等于投资验证通过**：完成本目标后不得自动转
Paper / Approved / Production。

---

## 0. 代码坐标（不能只记 HEAD）

| 项 | 值 |
|---|---|
| HEAD | `f8b6810347aa5950d1f9b95eaadc73308b68ac21` |
| 分支 | `codex/pool-reentry-diagnostics` |
| 工作区 | **含大量未提交改动**（含并发会话产物）。本次只读核验的正是「HEAD + 该工作区」 |
| 存储版本代码坐标 | `strategy_versions.codeVersion = 1.0.0+gunknown`（如实表达「未解析代码版本」，非编造） |

本目标本轮**新改**的文件（SHA-256 = 该文件当前内容指纹，含行数）：

| 文件 | 行数 | SHA-256 |
|---|---:|---|
| `server/research/recipeRegistry.ts` | 644 | `ae6e202c5b2370045186aaa67a395c727f1774800e6d0219949ce10639b1d80f` |
| `server/research/recipeRegistryAtoms.ts` | 435 | `e24a4d8d46c74db3abe887857ed0b8d3410eeefc14b0fc4796b5c9c0945d8925` |
| `server/research/strategyAuthoring/presetRegistry.ts` | 863 | `63b1f5079190bf4b3c4f4e9c813f8fdc7a81f2c0cd74df6313c7565abb403c3f` |
| `server/runWorkbenchAssembly/datasetFromRegistry.ts` | 2330 | `395dbcfad3905a17d15405a4a92fc73cc23ad0a36594612ae7b72eeea4150c2c` |
| `server/runWorkbenchAssembly/assemble.ts` | 1610 | `2de43dbb42481bc3620e35485da4a0badf764f5e005c1ac7ea39a093590be95c` |
| `shared/researchContracts.ts` | 1888 | `a048be9794ae5e9b33618db2caa2948810f191414de072ded9592ddd9673a2b0` |
| `tests/server/research/eventStateLongRecipeRegistration.test.ts` | 166 | `fb971789b8200e5c1f1b518c7a3f5af2540736c1de9394094e66b5182e42ba49` |
| `tests/server/runWorkbenchAssembly/eventWindowExecutionTail.test.ts` | 275 | `269b54b0d04a53835a38be925988d15c28eb599f1a8b1cad713965b256b11cb4` |
| `tests/server/research/patternLibrary/patternLibrary.test.ts` | 471 | `2c74a8061019845e6f0645d377f945c69d2809b56de9b39fc7ab18a5a65f37bc` |

本轮**只读依赖**的关键文件坐标（未改动，仅供复核）：

| 文件 | 行数 | SHA-256 |
|---|---:|---|
| `server/strategyCore/featureRegistry.ts` | 816 | `5d52a47f628e33d36a87178983be76233185b413c6d3bc7ca276c02cf66d515a` |
| `server/runWorkbenchAssembly/assemble.ts` | 1520 | `a22ca662dfbaab03d900ec7372aeab3cd34f14148c792413cc1338c4060a7deb` |
| `server/runWorkbenchAssembly/datasetFromRegistry.ts` | 2283 | `f7a59e0393cb6605c07e313b78fb3124db3a0b6c46ade0c8a187db1d042f8e71` |
| `server/research/simulator/cursorEngine.ts` | 408 | `cc1cce68b094fe26408ff9c21a2a7f76cd189d4c6678778472aca32986a41d0f` |

> ⚠️ `server/strategyCore/featureRegistry.ts` 在 HEAD 之后被**上一个会话**加入
> `makeEventStateAmplitudeFeatures()`（+103 行，未提交）。本目标**不改动**它，只消费它。

---

## 1. 基线（本轮实查，非历史快照）

### 1.1 策略版本 `3600006`

| 字段 | 值 |
|---|---|
| `strategyId` | `event-state-long-maxamp5-top3` |
| `version` | `1.0.0` |
| `status` | `Validated` |
| `datasetVersionId` | `780004` |
| `codeVersion` | `1.0.0+gunknown` |
| `fingerprint`（= **document** 指纹） | `7e863012181ff0e9a85a0e257b0b4d2a66a447acf16386e287f4fb22666a1cba` |
| `versionRecordJson.fingerprint`（§17 记录指纹） | `3eefde7a6f0e2bf9df7d6ede65fbe0bae2435963d1ceeabf0ae6885b712c6876` |
| `createdAt` / `updatedAt` | `2026-10-09 09:41:14` / `2026-10-09 18:15:09` |

`strategy_versions` 中该 `strategyId` **只有这一行**。

### 1.2 数据集

| id | version | status | 事件区间 | totalEvents | totalRows |
|---|---|---|---|---:|---:|
| `780004` | `v10-listed365-pre10-post80` | READY | 2019-01-02 ~ 2025-09-26 | 58,983 | 10,320,499 |
| `780005` | `v11-bear2026-pre10-post80` | READY | 2026-01-01 ~ 2026-09-04 | 8,572 | 1,303,740 |

两者 `filterDefinitionJson` 同为 `first_limit_pullback` / `preWindowDays=10` / **`postWindowDays=80`**
⇒ 事件后行情上限 **rd ≤ 80**。§3 的「历史区间」是**执行区间**（= 事件区间 + post 尾窗）。

### 1.3 证据留档现状

- `strategy_research_provenance WHERE strategyVersionId=3600006` → **0 行**。
- `closed_loop_backtest_run WHERE strategyId='event-state-long-maxamp5-top3'` → **0 行**。

⇒ 该版本**从未通过正式入口执行过**，也无 provenance。§3 的历史数值全部来自研究 harness，不是正式 Run。

### 1.4 正式配方解析（本轮实调用，非静态推断）

```
resolveStrategyRecipe(document.recipe)  → RECIPE_NOT_REGISTERED
assembleStrategySide(...)               → RECIPE_NOT_REGISTERED
```

修复前，装配在 `requireRecipe` 路径 1（`assemble.ts#requireRecipe`）**第一步就抛错**。

---

## 2. 差异表（§3 固定配置 vs 存储 3600006）

权威代码列给出「该差异由哪段代码决定」。验收证据列为**本轮已完成 / 待完成**。

| # | 字段 | 存储 3600006 | 研究 harness | 正式执行（装配后） | 权威代码 | §3 目标 | 修复方式 | 验收证据 |
|---|---|---|---|---|---|---|---|---|
| 1 | 配方注册 | 文档声明 `recipeId=event-state-long-amp5-top3` | 直调 `runCandidateEngineFromCursor`（无配方） | **抛 `RECIPE_NOT_REGISTERED`** | `recipeRegistry.ts#strategyRecipeDefinitions` / `assemble.ts#requireRecipe` | 正式入口可装配 | **已修**：注册该 recipeId（特征复用 Core） | ✅ 本轮实调用：`registeredNow=true`，`resolveStrategyRecipe` OK，`assembleStrategySide` OK，`engine=strategy-core` |
| 2 | 仓位口径 | `definition.position.sizingMethod=EQUAL_WEIGHT` → `mapDeclaredPositionSizing` → `EQUAL_WEIGHT` → 引擎 `EQUAL_WEIGHT_CASH_BUDGET`（现金预算） | `FIXED_RATIO` × `1/180`（初始资金固定比例） | `EQUAL_WEIGHT` | `assemble.ts#mapDeclaredPositionSizing` / `backtest/context.ts#mapPositionSizing` | 初始资本固定比例 `1/180`，不按当日权益复利 | **已修（新版本 2.0.0 草稿）**：`sizingMethod=FIXED_RATIO` + 显式 `positionRatio=1/180`（canonical 校验器强制要求显式比例） | ✅ 装配输出 `sizingMethod=FIXED_FRACTION`、`fraction=0.005555555555555556`、`effective=FIXED_FRACTION_OF_INITIAL_CAPITAL` |
| 3 | 候选退出 | 文档**无** `definition.exit.candidateExitPolicy` | 显式 `DISABLED` | `HOLD_WHILE_SELECTED`（默认值） | `assemble.ts:1301` `?? "HOLD_WHILE_SELECTED"` | `DISABLED`（排名变化不触发卖出） | **已修（新版本 2.0.0 草稿）**：显式声明 `candidateExitPolicy: "DISABLED"` | ✅ 装配输出 `candidateExitPolicy=DISABLED` |
| 4 | 策略观察窗（决策） | `{start:15,end:15}` | `{15,79}` + `decisionMemberPredicate rd===15` | `{15,15}` | `datasetFromRegistry.ts#resolveObservationWindow` | **保持 rd15**（不得把观察窗改成 rd79） | 保持不动 | ✅ 装配输出 `observationWindow={15,15,TRADING_DAY}`；尾窗测试证明 rd15 可见 bar 仍恰为 rd0..15 |
| 5 | **执行行情覆盖** | 由观察窗派生：`rd ≤ end+1 = 16`（另有 30 交易日 Execution Overlay） | cursor 覆盖 `rd ≤ 80` | **rd ≤ 16**（材料化路径）/ 覆盖窗 + 30 日 overlay（流式路径） | `datasetFromRegistry.ts` `maxRd = endRd+1`（1788）、`neededMaxRelativeDay = window.end+1`（1348）、`simulator/cursorEngine.ts#EXECUTION_OVERLAY_HORIZON_TRADING_DAYS=30` | 决策仍只读 rd15 及之前；**持仓执行覆盖须支撑 40 交易日持有** | **已修**：把「执行覆盖」与「决策窗」解耦（见 §4.2） | ✅ 派生尾窗 = 60 ⇒ 覆盖 `rd ≤ 76`（`16 + 60`）；决策成员仍严格 `rd ∈ [15,15]` |
| 6 | 出场 | `TIME_EXIT` 40 `TRADING_DAY` `ON_CLOSE` | `maxHoldingDays=40`；但 harness 记 `rd(D+F)` **收盘**成交 | `maxHoldingDays=40` | `assemble.ts#mapDeclaredExitPolicy` / `simulator/types.ts` | 40 交易日 TIME_EXIT，**收盘触发、下一交易日开盘成交** | 无需改文档；语义由执行层提供 | 待 S3：触发日 + 次日开盘成交对拍 |
| 7 | 止损 / 止盈 / runner | 无 | 无 | `stopLossRatio=null` / `takeProfitRatio=null` / `strongHold=null` | `assemble.ts#mapDeclaredExitPolicy` | 无 | 无需改 | ✅ 装配输出全部为 null |
| 8 | 末端 | 平台未平仓 mark-to-market | `rd80` 强制结算（`forced` 标记），12 笔 / 0.021% | 平台 MTM 口径 | `backtest/backtestResult.ts#canonicalMetrics` | 遵循平台 MTM，**与 rd80 强制结算差异单列，不伪造成交** | 无需改 | 待 S5：差异表登记 |
| 9 | 成本 | `commission 0.00025` / `slippage 7.5bps` / `stamp 0` / `transfer 0` / `minCommission 0` / `lotSize 100` | 同 | 同 | `assemble.ts#requireCostModel` | 同（用于复现，**不称真实账户费率**） | 无需改 | ✅ 装配输出逐字段一致 |
| 10 | 初始资金 / 持仓上限 | `initialCapital 1,000,000` / `maxPositions 180` | 同 | 同 | `assemble.ts` `executionAssumptions.backtestConfig` | 同 | 无需改 | ✅ 装配输出一致 |
| 11 | 指标 | — | 第二套公式（`CAGR/annualizedVol` 当 Sharpe、365.25 自然日 CAGR、Sortino 仅负日分母、`.cjs` 用 244） | `canonicalMetrics` | `backtest/backtestResult.ts#canonicalMetrics`、`shared/quant-stats.ts#sharpeRatio`、`research/riskAdjustedMetrics/analyze.ts#computeSortinoRatio` | 只用权威口径，252 交易日 | 无需改代码；新结果用 canonical | 待 S5 |
| 12 | 排序方向 / TopN | `rankingConfig.higherIsBetter=false`、`selectionConfig topN=3` | 升序 Top3 | 同（由新注册配方提供） | `recipeRegistry.ts` 新配方定义 | 同一决策日升序 Top3 | 已随 #1 落地 | ✅ 配方投影与文档一致（测试锁定） |
| 13 | 因子 | 文档声明 `maxAmp5@1.0.0` | 各 harness **各自手写** `amp5()`（4 份副本） | Core `makeEventStateAmplitudeFeatures` | `strategyCore/featureRegistry.ts` | `amp(rd)=(high-low)/close(rd-1)`，rd11–15 取最大 | **已修**：配方特征由 Core 定义直接产出（无第二套实现） | ✅ 测试：适配器值与 Core 定义逐值相同、与独立复算链式前收一致、rd14 为 null、rd16+ 不改变 rd15 值 |

**冻结项无 UNKNOWN。** 未决项只有 #5（执行行情覆盖）——它是**合同缺口**，不是未知事实。

---

## 3. 实际 Pipeline（正式入口，符号级）

```
tRPC researchRun.loopRun            server/researchRunRouter.ts#loopRun
  → executeClosedLoopRun            （useRealData=true 时走真实数据）
    → assembleRunWorkbenchInputs    server/runWorkbenchAssembly/assemble.ts
        ├─ resolveDataset           → buildEventWindowDatasetCursorFromRegistry（流式，行数 > 1.6M 时）
        │                             / buildResearchDatasetFromRegistry（材料化，默认）
        └─ assembleStrategySide     → requireRecipe → resolveStrategyRecipe(document.recipe)
                                      → mapDeclaredPositionSizing / mapDeclaredExitPolicy
                                      → strategy13 / simulationConfig / strategyRunContext
    → buildClosedLoopWiringInputs
    → createStreamingClosedLoopWiring（有 cursor）/ createClosedLoopWiring（无 cursor）
        ├─ runCandidateEngineFromCursor | runCandidateEngine   server/research/signalEngine/**
        └─ runTradeSimulationFromCursor | runTradeSimulation   server/research/simulator/**
    → runClosedLoop                 （纯函数，无 IO）
    → persistClosedLoopBacktestRun  server/researchRunRouter.ts → closedLoopBacktestRun/repository.ts
```

关键事实（本轮读码确认）：

- **决策成员**与**行情覆盖**目前都是同一个 `{start,end}` 的硬编码派生：
  成员 = `rd ∈ [startRd, endRd]`；面板/游标 = `rd ∈ [0, end+1]`。
- 唯一既能收窄决策成员、又不动行覆盖的机制是 `decisionMemberPredicate`；但它由装配层按
  `CUSTOM_EVENT + STRONG_TREND_REENTRY_V1` 注入，**首板事件策略拿不到**。
- 流式路径另有 Execution Overlay（`simulator/cursorEngine.ts#loadPositionExecutionOverlay`），
  从「首次 positionIntent 日」起 **+30 交易日**补齐日线；**材料化路径没有 overlay**。
- 780004 在 `{15,15}` 下材料化行数上界 ≈ 58,983 × 17 ≈ **1.00M ≤ 1.6M** ⇒ 走**材料化路径**
  ⇒ 目前**没有任何 rd>16 的行情**。40 交易日持有在正式链路上**结构性不可能**。

---

## 4. 阶段状态

### 4.1 S1（COMPLETE）

- 只读实查 `3600006` 文档 / 指纹 / Dataset / provenance / 正式 Run（§1）。
- 实调用 `resolveStrategyRecipe` 与 `assembleStrategySide` 复现 `RECIPE_NOT_REGISTERED`（§1.4）。
- 读关键 harness（`scripts/_scratch/stage1run.ts` / `stage3run.ts` / `stage4run.ts` /
  `variantBacktest.ts` 与 `.cjs` 系列）并与 §3 逐字段比较（§2）。
- 完成条件核对：每个差异有具体定位与最小修复边界 ✅；冻结项无 UNKNOWN ✅；
  已有相关实验与修复清查完毕 ✅；harness/缓存缺失情况已登记（§4.3）✅。

### 4.2 S2（IN_PROGRESS）

**已完成：**

1. `server/research/recipeRegistry.ts#makeEventStateLongMaxAmp5Top3RecipeDefinition`
   —— 注册文档已声明的 `event-state-long-amp5-top3`。
2. `server/research/recipeRegistryAtoms.ts#buildEventStateAmplitudeFeatureProvider`
   —— 由 **Strategy Core 注册表**取回 `maxAmp5` 的 `FeatureDefinition` 并直接调用其 `compute`；
   bar 序列 → Core 时间语义走唯一入口 `strategyCore/production/barWindow.ts#toCoreBarWindow`。
   **不复制振幅公式**，因此不存在第二套实现。
3. `tests/server/research/eventStateLongRecipeRegistration.test.ts`（8 项，全绿）锁定上述行为。

**本轮验证记录（真实执行）：**

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `node node_modules/typescript/bin/tsc --noEmit` | **exit 0** |
| 新增测试（配方注册） | `vitest run tests/server/research/eventStateLongRecipeRegistration.test.ts` | **8/8 PASS** |
| 新增测试（执行尾窗） | `vitest run tests/server/runWorkbenchAssembly/eventWindowExecutionTail.test.ts` | **7/7 PASS** |
| 既有游标回归 | `vitest run tests/server/runWorkbenchAssembly/eventWindowDatasetCursor.test.ts` | **8/8 PASS**（缺省尾窗行为不变） |
| 装配/模拟/信号/留档回归 | `vitest run tests/server/runWorkbenchAssembly tests/server/research/simulator tests/server/research/signalEngine tests/server/closedLoopBacktestRun tests/server/researchRunRouter.test.ts` | **exit 0** |
| 增量全量 | `pnpm run test:changed` | 见下方归因（**新增失败 0**） |
| 运行时探针（配方） | `tsx scripts/_scratch/goalParityS2Runtime.mts` | 注册后装配 **OK**（`engine=strategy-core`） |
| 运行时探针（修正版） | `tsx scripts/_scratch/goalParityS2Version.mts` | canonical 校验 **0 issue**；§3 比对 **22 项 / 不一致 0** |
| EOL | `node scripts/checkEolDrift.mjs --strict` | **tracked 漂移 0**；全仓 exit 1（仅其他会话未跟踪文件的 CRLF） |

`test:changed`（**166 文件 / 2039 测试**；4 文件失败 / 10 测试失败）归因 —— **本目标新增失败 = 0**：

| 失败文件 | 失败数 | 归因 | 证据 |
|---|---:|---|---|
| `researchExperiments/threeFactorTopNStrategyDocument.test.ts` | 3 | **既有失败，与本目标无关**：期望对象缺 `recoveryPath` 键 | `server/runWorkbenchAssembly/exitPolicy.ts` 与**该测试文件**均 `git diff HEAD` 为空；`recoveryPath` 在 HEAD 第 96/107/154 行即已存在 ⇒ HEAD 上即失败 |
| `limitUp.test.ts` | 1 | **环境失败，与本目标无关**：无可用数据库 | 断言面为 `数据库不可用`；本目标未触及 limitUp 任何文件 |
| `limitUp.watch.test.ts` | 4 | 同上 | 同上 |
| `components/datasetRegistry/datasetFilterForm.test.ts` | 2 | **既有失败，与本目标无关**：`buildFilterPayload` 多出 `excludeListedWithinDays: null` 键 | 该测试文件与 `client/src/components/datasetRegistry/**`、`shared/datasetRegistryContracts.ts` 均 `git diff HEAD` 为空 ⇒ HEAD 上即失败；本目标未触及数据集筛选链路任何文件 |

> 上一轮由本目标引起并已修复的 2 项（`patternLibrary.test.ts` 配方 id 穷举清单、
> `strategyAuthoring/vocabulary.test.ts` 中文名登记）现已 **PASS**。
>
> 🔴 未采用「改测试契约让实现通过」的做法：那两处测试改动都是**穷举清单 / 显示名登记的同步维护**
> （`patternLibrary.test.ts` 注释与 `presetRegistry.ts` 明确要求「新增配方必须顺手起个中文名」）。

**EOL 行尾门禁（`node scripts/checkEolDrift.mjs --strict`）：**

- 结果：**exit 1**；**已跟踪文件漂移 = 0**；唯一失败是**未跟踪**的
  `_scratch/overlap/probe01_db_state.mjs`（CRLF，其他会话的探针）。
- 按规格要求：**如实报告全仓门禁未通过**，且**不覆盖其他会话文件**，故本轮不修该文件。
  本目标新增/修改的所有文件均为 LF。

**已完成（本轮新增）——执行行情覆盖解耦：**

4. **合同缺口已修**：事件窗投影新增可选 `exitTailTradingDays`（缺省 `0`）。
   - `datasetFromRegistry.ts`：`EventWindowCursorOptions` / `BuildDatasetFromRegistryRequest` 新增该字段；
     `createEventWindowDatasetCursor` 的 `maxRd = endRd + 1 + exitTailTradingDays`；
     `buildResearchDatasetFromRegistry` 的 `neededMaxRelativeDay = window.end + 1 + exitTailTradingDays`；
     `estimateEventWindowPanelRowsUpperBound` 第 4 参与之同步（否则会**低估**行数而错误地走材料化路径）。
   - `assemble.ts#resolveEventWindowExitTailTradingDays`：由策略**已声明的出场政策**派生
     （`definition.exit.rules` 里启用中的 `TIME_EXIT`(TRADING_DAY) + 顺延缓冲 20），
     复用**同一个** `mapDeclaredExitPolicy`；无 `TIME_EXIT` ⇒ `0`（既有策略行为逐字节不变）；
     池化策略有自己的退出尾部 ⇒ 不叠加。
   - 装配摘要新增 `assembly.eventWindowExitTailTradingDays`（进 tRPC 契约，可审计）。
5. **§3 修正版（不可变新版本，内存草稿）**：
   - 经**既有文档级不可变版本流程** `cloneStrategyDocument(base, patch, bump)`（与
     `StrategyService.createVersion` 同一条）：`1.0.0 → 2.0.0`。
     `minor` 被**语义闸门响亮拒绝**（结构性变化必须 major）——闸门行为符合规格，未绕过。
   - 内容差异**仅三项**：`definition.position.sizingMethod: EQUAL_WEIGHT → FIXED_RATIO`；
     `definition.position.positionRatio: 新增 1/180`（canonical 校验器强制要求显式比例）；
     `definition.exit.candidateExitPolicy: 缺省 → DISABLED`。v1 视图同步派生为
     `{kind:"fixed-fraction", fraction:0.005555555555555556, maxPositions:180}`。
   - **canonical 校验器**：`validateCanonicalStrategyDefinition` = **0 issue**；
     `validateStrategyDocument` = **0 issue**。
   - **装配逐字段等于 §3**：脚本比对 **22 项，不一致 = 0**；`engine=strategy-core`、
     `recipeSource=strategy-document`、`features=[maxAmp5@1.0.0]`、`candidateExitPolicy=DISABLED`、
     `positionSizing={FIXED_FRACTION, 1/180}`、`maxHoldingDays=40`、`maxPositions=180`、
     `initialCapital=1,000,000`、成本六项、`executionModel=NEXT_OPEN` 全部一致。
   - **尾窗生效**：由该文档的 `TIME_EXIT 40` 派生尾窗 **60** ⇒ 行情覆盖 `rd ≤ 15 + 1 + 60 = 76`
     （数据集 post 上限 80），足以覆盖 40 交易日持有 + 20 交易日顺延余量。

**指纹与不可变性证据：**

| 对象 | 值 |
|---|---|
| 3600006 document 指纹（未变） | `7e863012181ff0e9a85a0e257b0b4d2a66a447acf16386e287f4fb22666a1cba` |
| 新版本 `2.0.0` document 指纹 | `5cc5c74e2d726ccbf88446badd87455002f193985d6e1cd51d5c86f92ce0444a` |
| 3600006 Core 行为指纹 | `6cf31b267b145f1b65a431a8288e3349bbb3e489ad4e7dbe00e9d343b23280f9` |
| 新版本 Core 行为指纹 | `4244d9a7af51a1c770165103431867c9a884ffb88b191ee946954b5ead86df2f` |
| 行为确有变化 | **是**（Core 行为指纹不同）⇒ 必须新版本，不可原地改 |

> ⚠️ 版本号取 **2.0.0** 而非 `1.1.0`：平台既有语义闸门把该内容变化归类为 major。这是**平台的版本化
> 规则在起作用**，本目标未绕过；GOAL §3 只要求「通过新版本表达」，未指定版本号。

**待完成（下一轮 = S4）：**

1. **S4 正式复现与证据留档**：对 `780004`（`2019-01-03~2026-01-28`）与 `780005`（`2026-01-29~2026-10-09`）
   **各运行一次固定配置**（策略版本 `2.0.0`），经正式装配入口 + 既有持久化端口留档；
   长任务日志落盘、不接输出管道；检查在途任务，避免热重启杀死 Run。
2. S4 统计全区间的**成交层拒绝原因分布**（涨停/停牌/无量）、**跌停拒卖顺延**与
   **TopN 边界并列规模**（S3 片段未出现的路径；见 §7.3 未覆盖登记）。
3. provenance：只用真实证据（若要复用证据桥，先用最小复现入口产生真实 `research_experiment_run`），
   **不得**给 `3600006` 回填伪来源。
4. （已完成，保留备查）§7.1 的阻断性缺陷**已修复** —— 见 §7.1「根因（本轮定位并已修复）」。

### 4.3 研究 harness 的不可用/不可复现来源（如实登记）

- 全部关键 harness 位于 `scripts/_scratch/**`，被 `.gitignore:154:/scripts` **整目录忽略**；
  `git ls-files scripts/_scratch` = **0**，磁盘上 1,526 个未跟踪文件。
  ⇒ 冻结配置**无法从任何 commit 复现**，只能从本机磁盘副本复现。
- 4 份 `.ts` harness 各自**手写 `amp5()`**，与 Core 定义是两份实现（本轮已用 Core 版本替代正式链路）。
- `.cjs` harness 的输出落在 `%TEMP%`；`.ts` harness 明确「不落盘」。
- 本目标**不**把 harness 当正式证据；正式证据必须来自 §3 的正式入口。

---

## 5. 授权来源与写入清单

| 项 | 内容 |
|---|---|
| 授权来源 | 用户在 `EVENT-STATE-LONG-EXECUTION-PARITY-001` 会话中明确选择「授予完整 §2 授权」：①按 §3 固定配置做代码修复；②经既有不可变版本流程新建修正版（保留 3600006）；③经既有业务端口新增必要的实验证据与正式 Run 留档 |
| 明确不授权 | 回填/修改历史记录、DDL、migration 修改、批量生产数据写入、已有账户状态修改、资金交易 |
| 已发生的写入 | ① 代码/测试/工具文件（§0 表 + `tests/tools/eventStateLongFormalRun.mts`）；② `strategy_versions` 新增 1 行 `id=3600007`（`2.0.0`/`Draft`）+ `strategies` 实体指针更新（§5.2）；③ **`closed_loop_backtest_run` 新增 2 行**：`id=6210013`（780004）与 `id=6210014`（780005）（§6.2） |
| 计划写入（剩余） | provenance（当前**无合法可指向记录**，见 §6.4 ⇒ 保持未接） |
| 生命周期 | 存量 `3600006.status = Validated` **不改**。研究最新裁定是 `RESEARCH_CANDIDATE`；两者不一致的呈现属 S6，需超出本轮授权时先提交方案 |

### 5.1 写入影响报告（执行前，2026-10-10 · S2 修正版落库）

按 §2「新增记录和新版本必需的生命周期操作必须在执行前报告影响并留下审计」，先报告再执行。

| 维度 | 内容 |
|---|---|
| 触发原因 | §3 修正版必须作为**可运行的真实版本行**存在，S4 的正式 Run 才能引用它（`executeClosedLoopRun` 按 `(strategyId, version)` 读库） |
| 写入目标表 | `strategy_versions`（**新增 1 行**）；`strategies`（策略实体指针更新，非新增行） |
| 新增行内容 | `strategyId=event-state-long-maxamp5-top3`、`version=2.0.0`、`status=Draft`、document 指纹 `5cc5c74e…`、`datasetVersionId=780004`、`parentVersionId=3600006 的行 id`、`codeVersion` 取**真实工作区坐标**（不再写 `gunknown`） |
| 经哪个既有端口 | `StrategyService.save` → `createStrategyDocument`（重算指纹）→ `persistDocument` → `DbStrategyRepository.saveVersion`（事务内 + 5 类投影 + 同一 `(strategyId,version)` 指纹不同即 `conflict` 拒绝覆盖） |
| 实体指针影响 | `refreshEntityPointer` 会把 `strategies.currentVersionId` / `latestVersion` 指向 `2.0.0`，并把实体 `status` 同步为该版本的 `Draft`。**这是新增版本的正常副作用**，非「修改已有账户状态」；旧版本行**不受影响** |
| 不写入 | 不改 `3600006` 任何列（内容 / 指纹 / status / updatedAt 均应保持不变）；无 DDL / migration；无批量写；无账户与资金操作；不创建 Candidate / Paper / Production |
| 可回滚性 | 新增行可删（本目标不执行删除）；实体指针由 `latestVersion` 大小决定，删除新行后指针回落需另行处理 —— **因此执行前一次性确认** |
| 执行后必须对账 | ① 新行存在且指纹 = 草稿指纹；② `3600006` 指纹/status 未变；③ 无其他行被改动；④ 生命周期的合法入口 |
| 生命周期操作 | **不需要**：新行初始 `Draft` 由 `saveVersion` 的既有缺省值给出；未做任何状态迁移 |

### 5.2 写入对账（执行后，只读复核）

探针：`scripts/_scratch/goalParityS3PersistVersion.mts`（写）+ `goalParityS3Reconcile.cjs`（只读复核）。

| 对账项 | 预期 | 实测 | 结论 |
|---|---|---|---|
| 新版本行 | `version=2.0.0`、`status=Draft`、document 指纹 = 草稿指纹 | `id=3600007`、`2.0.0`、`Draft`、`5cc5c74e…` | ✅ |
| 代码坐标 | 真实工作区坐标（非 `gunknown`） | `codeVersion=1.0.0+gf8b6810.dirty`（由 **canonical** `composeCodeVersion` 组合，dirty=true 如实反映未提交工作区） | ✅ |
| 谱系锚点 | `parentVersionId` = 原版本行 | 初写为 `null`（`save()` 不带父链）→ 用平台**明确允许的**谱系元数据端口 `updateVersionParent` 补齐为 `3600006` | ✅（修复动作已登记） |
| 旧版本未变 | `3600006` 内容 / 指纹 / status / `updatedAt` 全不变 | 指纹 `7e863012…`、`Validated`、`updatedAt=2026-10-09 18:15:09`、`codeVersion=1.0.0+gunknown` **逐项未变** | ✅ |
| 实体指针 | 指向新版本 | `latestVersion=2.0.0`、`currentVersionId=3600007`、`status=Draft` | ✅（新增版本的正常副作用） |
| 5 类投影 | 与 canonical 一致 | `strategy_version_datasets/entry_rules/exit_rules/execution_rules` 各 1 行；`strategy_parameters` 0 行（文档未声明参数） | ✅ |
| 全局行数预算 | +1 | `strategy_versions` 总行数 179 → **180** | ✅ 恰为 +1 |
| 不越界 | 无 DDL / migration / 批量写 / 回填 | `strategy_research_provenance`(3600006)=0、`closed_loop_backtest_run`(该 strategyId)=0（未新增）；未执行任何 DDL | ✅ |
| 校验器 | 落库前 canonical 校验通过 | `validateCanonicalStrategyDefinition` / `validateStrategyDocument` = 0 issue；`codeVersion` 格式由平台 validator 拒绝过一次不合规取值后改用 canonical 函数 | ✅ |

---

### 5.3 生命周期写入对账（执行后，只读复核）

**授权来源**：用户本轮直接指令「3 可以修改」；执行前影响报告见 §10.1.1（先报告、后执行）。
**入口**：`StrategyService.setVersionStatus`（源码标注「唯一允许的 UPDATE；内容仍不可变」）。
**执行工具**：`tests/tools/eventStateLongLifecycle.mts`（`--dry-run` 先跑通，再执行；断言 4/4 通过）。

| 行 | 列 | 执行前 | 执行后 | 判定 |
|---|---|---|---|---|
| `strategy_versions.id=3600006` | `status` | `Validated` | **`Retired`** | ✅ 本次**唯一**内容性变化 |
| 同上 | `codeVersion` | `1.0.0+gunknown` | `1.0.0+gunknown` | ✅ 未变 |
| 同上 | `fingerprint`（文档） | `7e863012…66a1cba` | `7e863012…66a1cba` | ✅ **原内容与历史指纹保留** |
| 同上 | `parentVersionId` / `datasetVersionId` / `createdAt` | `null` / `780004` / `2026-10-09 09:41:14` | 同 | ✅ 未变 |
| 同上 | `updatedAt` | `2026-10-09 18:15:09` | `2026-10-10 12:36:28` | ⚠️ 预期：UPDATE 会刷新该列（**不含内容语义**） |
| `strategy_versions.id=3600007` | 全部列 | — | 逐列未变（`Draft`，指纹 `5cc5c74e…`） | ✅ |
| `strategies.id=1770005` | `status`/`latestVersion`/`currentVersionId`/`updatedAt` | `Draft` / `2.0.0` / `3600007` / `2026-10-10 10:43:43` | 同 | ✅ **未被旧版本迁移覆盖**（符合服务层「非当前版本不覆盖首页状态」的设计） |
| 全表 | `strategy_versions` 行数 | 180 | **180** | ✅ 未增未删 |
| `closed_loop_backtest_run` | 6210013 / 6210014 | `ALL_EXECUTED` | 同 | ✅ |
| `strategy_research_provenance` | 3600006/3600007 | 0 | **0** | ✅ 用户暂缓，不伪造 |

**未做**：未新增/删除版本；未回填任何历史记录；未改 DDL / migration；未做批量写；
未改 document / definition / 指纹 / 谱系 / 数据集坐标。

## 6. Run / 产物索引

| 类别 | 位置 | 说明 |
|---|---|---|
| 本轮 DB 只读快照 | `_scratch/goalParityS1.json` + `scripts/_scratch/goalParityS1.cjs` | 本次实查原始行（strategy_versions / dataset_version / provenance / cl_run） |
| 本轮运行时探针（修复前） | `scripts/_scratch/projectReview20261010-runtime.mts` | 实调用配方解析与装配 |
| 本轮运行时探针（修复后） | `scripts/_scratch/goalParityS2Runtime.mts` | 同上，验证注册后装配通过 |
| 正式 Run | **2 条（S4 产出）** | 见 §6.2 |
| 版控内的复现工具 | `tests/tools/eventStateLongFormalRun.mts` | **可版本管理**（非 `scripts/_scratch`）：读回版本 → 正式装配 → 闭环 → 既有持久化端口；`--no-persist` 供诊断复算 |

> ⚠️ 临时探针位于 `.gitignore` 的 `scripts/_scratch/`，**不作为唯一交付证据**；
> 结论以本文件 + 版本控制的测试为准。

### 6.1 S4 前置检查（只读，2026-10-10 11:33）

| 检查项 | 结果 | 处置 |
|---|---|---|
| 本策略的正式 Run | `closed_loop_backtest_run WHERE strategyId='event-state-long-maxamp5-top3'` = **0** | 无冲突，可开跑 |
| 本策略 provenance | `strategy_research_provenance`(3600006 / 3600007) = **0** | S4 需新建真实证据 |
| 全库闭环留档 | 463 条，最新 `createdAt=2026-10-04 12:25:55` | 无近期在途闭环 Run |
| **长期 RUNNING（异常）** | `research_experiment_run` 中 **16 条** `status='RUNNING'`，全部属 `first-board-pullback/single-factor-v1`，`updatedAt` 停在 **2026-09-25**（已逾 15 天） | 🔴 **属其他实验的历史遗留**；按 §7「不授权修改/回填历史记录」**本轮不改动、不改其状态**；仅登记为需人工核查项。**不影响本次 Run**（不同实验） |
| 策略版本行 | `3600006`（`Validated`，指纹 `7e863012…`，未变）与 `3600007`（`Draft`，指纹 `5cc5c74e…`，`parentVersionId=3600006`） | 与 §5.2 对账一致 |

### 6.2 S4 正式 Run 索引（两条，真实执行 + 既有端口留档）

复现命令（需 `DATABASE_URL`；长任务日志落盘、不接管道）：

```
node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongFormalRun.mts --dataset 780004
node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongFormalRun.mts --dataset 780005 --start 2026-01-29 --end 2026-09-04
```

| 项 | 780004 | 780005 |
|---|---|---|
| `runId` | `clrun-parity-780004-20261010034703535` | `clrun-parity-780005-20261010040556985` |
| **留档 ID（`closed_loop_backtest_run.id`）** | **6210013** | **6210014** |
| `experimentId` | `EXP-20261010-PARITY01` | 同 |
| 请求区间 | `2019-01-03 ~ 2026-01-28`（= §3，**未裁剪**） | `2026-01-29 ~ 2026-09-04`（**裁剪**，见 §6.3） |
| 实际权益区间 | `2019-01-03 ~ 2026-05-28`（1792 点，含执行尾窗） | `2026-01-29 ~ 2026-09-04`（146 点） |
| 数据集 / 来源 | `780004` / `registry` | `780005` / `registry` |
| 数据集内容版本 | `rd-1.0.0-1-a960094c19198ef9` | （见证据 JSON） |
| 策略 | `event-state-long-maxamp5-top3@2.0.0`，document 指纹 `5cc5c74e…` | 同 |
| 代码坐标 | `1.0.0+gf8b6810.dirty` | 同 |
| 决策日 / 候选指纹 | 1716 / `d7989503…` | 146 / `90994aa7…` |
| 闭环指纹 | `chain=24ace0a7…` / `run=ad1157d9…` | `chain=9bf4c408…` |
| 成交 / 期末 | 4825 笔 / 期末 0 未平仓 | 423 笔 / 期末 **117 未平仓（MTM）** |
| 期末权益 / 总收益 | 1,650,970.37 → **+65.10%** | 945,376.19 → **−5.46%** |
| 成交层拒绝 | **56**：`LIMIT_UP 7 · LIMIT_DOWN 18 · NO_LIQUIDITY 26 · OTHER 5` | 0（该区间无事态） |
| `skipped` | `BUDGET_BELOW_MIN_LOT 77 · NON_LONG_DIRECTION 1` | `BUDGET_BELOW_MIN_LOT 11 · NO_NEXT_TRADING_DAY 6 · NON_LONG_DIRECTION 1` |
| 模拟内容指纹 | `3d22f577…` | `b675191c…` |
| 证据 JSON | `_scratch/goalParityS4-780004.json` | `_scratch/goalParityS4-780005.json` |

**留档对账（只读复核）**：`closed_loop_backtest_run WHERE strategyId='event-state-long-maxamp5-top3'` = **2**；
`strategy_versions` 总行数 **仍为 180**（未新增版本）；`3600006` / `3600007` 逐列未变；
`strategy_research_provenance` **仍为 0**（见 §6.4）。

### 6.3 🔴 780005 区间裁剪（具体契约缺口，如实登记）

- 平台在 `research/datasetAccess/session.ts#createDatasetSession` 强制
  **「实验日期范围 ⊆ 数据集窗口」**（`dataSnapshot.request.startDate/endDate`）。
- **物化直读路径**把该窗口取为 `dataset_version` 的**事件窗**（`datasetFromRegistry.ts` 内
  `version.startDate/endDate` = `2026-01-01 ~ 2026-09-04`）⇒ 超出最后一个事件日的运行区间被**拒绝**
  （实测错误：`CL_STAGE_EXECUTION_ERROR` / `实验日期范围 [2026-01-29, 2026-10-09] 超出数据集窗口 [2026-01-01, 2026-09-04]`）。
- **流式游标路径**的窗口是 `cursorStart..cursorEnd`（含执行尾窗）⇒ **能**接受 §3 的 `2026-10-09`
  —— 这正是 780004 未被裁剪的原因（行数上界 4.5M > 1.6M 护栏 ⇒ 自动走流式）。
  780005 的行数上界约 `8572 × 77 = 0.66M < 1.6M` ⇒ 走**物化**路径 ⇒ 区间被拒。
- **本轮处置**：按 §3「使用实际可用日历」将 780005 区间裁剪为 `2026-01-29 ~ 2026-09-04`
  （= 数据集窗口内），并**如实登记**：裁剪使最后约 25 个交易日无法出场，
  期末 117 笔按**平台 MTM 口径**计（§3 允许）。
- **未在本轮修复该共享守卫**（理据：属既有平台契约，修它会改变所有物化直读策略的数据集窗口口径，
  需独立影响评估 + 回归证明；已在 §10 登记为后续项，不在 S4 内静默绕过）。

### 6.4 provenance 契约缺口（S4 未完成项）

- `strategy_research_provenance` 唯一写入点 = `DbStrategyResearchProvenanceRepository.create`。
  `sourceKind="INDEPENDENT_EXPERIMENT"` 要求：`experimentRef / experimentVersion /
  experimentResultDigest / experimentParametersJson` 非空，且**证据桥**
  （`researchExperiments/strategyBridge.ts#createStrategyFromEvidenceRuns`）要求证据 Run
  满足 `status=COMPLETED` + `researchPhase=HOLDOUT` + `confirmatoryGate.status=PASS` + 同 `protocolFingerprint`。
- 本目标的 Run 是**工程执行一致性复现**，不是 HOLDOUT 确证实验 ⇒ **不存在可合法指向的 provenance 记录**。
- 按 §3/§5 门禁：**不伪造**（不给 `3600006` 回填来源、不把历史报告文件当实验 Run、不把工程 Run 冒充 HOLDOUT）。
  ⇒ **本阶段 provenance 保持未接，登记为具体契约缺口**，S4 不标记为完全完成。

---

### 6.5 🔴 留档可读性缺陷（本轮发现并已修复 —— **纠正 §6.2/§11 早先的「可取回」结论**）

**现象（用户实测反馈）**：前端「回测对比」页对这两条留档显示
**「该留档已落库，但结果读不出来（不符合当前契约）」**。

**根因（本目标自身缺陷，非平台既有 bug）**：复现工具初版**自己拼**了
`result.wiring = { requested, streaming }`。而 `closedLoopBacktestRun` 的**读路径**
`researchRun.getBacktests` 会按契约校验该字段，实测返回：

```
wiring.requestedStages / wiredStages / unwiredStages / coveredStages / uncoveredStages：
  Invalid input: expected array, received undefined
wiring.executorBound：Invalid input: expected boolean, received undefined
```

⇒ `result` 被判为不可读（`resultIssue` 非空、`result` 返回 null）⇒ 前端拿不到 `equityCurve`
⇒ `buildVersionCompareCurve` 的 `pointCount = 0` ⇒ **折线图与交易明细都渲染不出来**。
**根因是 `researchRunRouter.ts#toWiringSummary` 当时未导出**，复现工具无法复用唯一实现。

**修复（两处）**：
1. `server/researchRunRouter.ts`：把 `toWiringSummary` **导出**（并在注释里写明「读路径校验该形状，
   不要自己拼」），复现工具改为**复用平台唯一实现**（`tests/tools/eventStateLongFormalRun.mts`）。
2. `tests/tools/eventStateLongFormalRunRepair.mts`：用**同一实现**重建这两条留档的 `result.wiring`
   并**就地只替换该子对象**（`6210013` / `6210014`，按 id 精确限定）。

**修复后核验（走页面同一段代码）**：

| 留档 | `resultIssue` | `equityCurve` 点数 | 成交笔数 | `totalReturnPct` | 图表 series `pointCount` |
|---|---|---|---:|---:|---:|---:|
| `6210013`（780004） | **null** | 1792 | 4825 | +65.097 | **1792** |
| `6210014`（780005） | **null** | 146 | 423 | −5.462 | **146** |

折线图数据行 **1862**，日期跨度 `2019-01-03 ~ 2026-09-04` ⇒ `drawable` 两条曲线均 > 0，
**收益曲线与交易明细可正常显示**。修复时 `stages`（含 equityCurve / trades / costs /
executionStats）、`assembly`、`fingerprint`、`chainFingerprint` **逐字节未变**
（工具内断言 `stagesUnchanged = true`）。

**如实更正的早先表述**：§6.2 曾写「台账随留档可取回（`tradesTruncated=false`）」——
该结论在**数据库层面**成立，但在**平台读契约层面当时不成立**（前端读不出来）。
现已修复，该结论现在两个层面都成立。

**平台观察（未改，仅登记）**：写入口 `persistClosedLoopBacktestRun` **不**校验
`result` 是否符合读契约 ⇒ 存在「写入成功、读取失败」的不对称。修它属共享契约变更，
超出本目标范围，登记为后续项。

## 7. 对拍结果

**S3 通过。** 对拍顺序（§3 要求）：候选身份/分数 → Top3 → 下单/拒单 → 成交日期/价/量/费用 → 每日现金/持仓/权益。

浮点容限（**看结果前声明**）：离散量（身份、笔数、日期、拒单原因）必须**精确一致**；
本因子为 `Math.max`（无求和），分数相对容差取 **1e-12**；
金额/权益容差按「整手取整 + 双精度累加」定为相对 `1e-9`、绝对 `1e-4 元`，
且**不得靠放宽容限掩盖账本差异**。

### 7.1 🔴 S3 阻断性发现：正式 Core 判定路径对真实事件窗数据集**产出 0 个候选**

**复现**（只读探针 `scripts/_scratch/goalParityS3Parity.mts`；数据集 780005，窗口 2026-02-01~2026-02-05）：

| 观测 | 值 |
|---|---|
| 正式装配 | `datasetSource=registry`、`datasetRowCount=575,297`、`eventWindowExitTailTradingDays=60`、`recipeSource=strategy-document`、`strategyDecisionEngine=**strategy-core**` |
| 候选引擎 | `candidateDays=4`、`signalCount=**0**`、`selectedCount=**0**`、`universeMembers` 非空 4/4 |
| 剔除原因 | **全部** `INSUFFICIENT_FEATURES`（= `framework/pipeline.ts` 中 `signalBuilder` 返回 `null`，**不是**特征缺失） |
| 参考方（同 Core 特征 + 无尾窗游标 rd15 可见 bar） | 决策成员 1,058、取值成功 1,043 ⇒ 决策数据本身完好 |

**逐点诊断**（对同一成员 `sec_…::event:603969.SH@2026-01-12`，决策日 2026-02-02，16 根 bar）：

| 环节 | 结果 |
|---|---|
| rd0 事件日 bar | `preClose=10.37 / close=11.41` ⇒ **确为首板涨停**（10.37×1.1≈11.41） |
| recipe 特征 `maxAmp5`（走 Core 定义） | `0.046598322460391424`（**非 null**） |
| `recipeRuntime.rankValueOf(features)` | `0.046598322460391424`（**非 null**） |
| `strategy13.signalBuilder(...)` | **`null`**（**未抛错**） |
| 同一 builder 在 rd14（15 根 bar） | `prevSignal = null` |

**🔴 根因（本轮定位并已修复）**：文档声明的观察窗在「无 enabled 入场条件」时被**丢出规则图** ——
`strategyCore/adapters/legacyDefinition.ts#fromLegacyStrategyDefinition` 原先只在
`conditionNodes.length > 0` 时才 push `WINDOW` 节点。而 `LAST_VALID_DAY` / `FIRST_VALID_DAY`
的**候选日集合由窗口定义**（`ruleGraph.ts#triggerCandidateDays` 读 WINDOW journal 的 `validDays`）
⇒ 无 WINDOW 时 `validDays` 为空 ⇒ 触发退化为「当前日即候选日」，**每个决策日都成立**；
生产决策源（`coreDecision.ts#createCoreDecisionSource`）用「**首个成立日**」转移判据
（`satisfiedToday && !satisfiedBefore`），而事件窗数据集**只在决策日**暴露成员 ⇒
**转移日永不出现 ⇒ 0 信号**。

**修复**：无条件入场也**必须**产出 WINDOW；子节点用**显式恒真条件**占位
（`entry.window.always`，`Expr.constant(1) EQ Expr.constant(1)`）——
空 `ALL` 被 `validateRuleGraph` 拒绝且求值恒为 `false`，恒真条件既过校验又不引入数据依赖、
也不触发事件判定计数。**未放松任何既有守卫**（新增测试断言空 `ALL` 仍被拒绝）。

**修复后 Core 层实测**（同一上下文）：rd15 `satisfied=true` / `signals=1`（触发说明「窗口成立日=[15]」）；
rd14 与 rd1 均 `satisfied=false`；`firesToday=true`。（修复前 rd1/rd14/rd15 **全部** `satisfied=true`。）

**修复前**：候选层未解释差异 **100%**。**修复后**：见 §7.2 —— 差异 **0**。

**定位到的可疑面（下一轮首要动作）**：
- `server/strategyCore/production/coreDecision.ts#createCoreDecisionSource`（判定 + `firesToday` 判据）；
- `assemble.ts` 事件源构造 `createDatasetEventResolver({ eventAnchored: true, eventTypes:["FIRST_LIMIT_UP"], limitUpRatio:0.1 })` —— 事件解析器是否把**当前 bar**当成事件日（而非锚定的 rd0）；
- `coreVersionFromDocument` 对 `definition.entry.observationWindow{15,15}` + `trigger: LAST_VALID_DAY` → Core `ruleGraph` 的映射；
- `coreDatasetCapability` 未传 `datasetHorizonRelativeDay`（缺省 ⇒ 跳过视界校验）是否影响判定。

**未解释差异（修复前）**：候选层 **100%**（0/1,043）。按 §3 门禁「S3 未解释差异 = 0」，
当时判 **S3 未通过** —— 属**产品缺陷**而非容许差异，不能用容差吸收。**已修复，见 §7.2。**

**其余**：Top3 并列边界、下单/拒单计数、成交价量费逐笔、每日现金/持仓/权益 —— 部分已在 §7.3 覆盖，余项下一轮补齐。

### 7.2 ✅ 修复后：候选身份 / 分数 / Top3 对拍 = 0 差异

数据集 780005，`dateRange 2026-02-01~2026-04-30`，正式装配（材料化路径）+ 既有原语 `runCandidateEngine`；
参考方 = 同一 Core 特征（`buildEventStateAmplitudeFeatureProvider` → Core 注册表）在**无尾窗游标**
的 rd15 可见 bar（rd0..15）上独立复算，再按同一「升序 + securityId 破平 + TopN=3」规则选取。

| 指标 | 值 |
|---|---|
| 决策日（对拍） | **57** |
| 引擎信号数 / 选中数 | 2,567 / **171**（= 57×3，逐日恰好 Top3） |
| 参考方决策成员 / 取值成功 | 3,445 / 3,396（49 个 null 与引擎剔除一致） |
| **身份不匹配日数** | **0** |
| **分数不匹配数** | **0**（相对容差 1e-12） |
| 未解释差异 | **0** |

### 7.3 ✅ 下单 / 成交 / 账本（同片段，既有原语 `runTradeSimulation`，与闭环 wiring 同调用）

| 检查项 | 结果 |
|---|---|
| 成交笔数 / 权益点数 | **163** / 57（区间 2026-02-02 ~ 2026-04-30） |
| **整手约束** | **0 违规**（如首笔 `quantity=200`，均为 100 的整数倍） |
| **§3 仓位口径** | 名义额 / 初始资本 ∈ **[0.00280, 0.00561]**，目标 **1/180 = 0.005556** ⇒ 明确是**初始资本固定比例**，**不是**等权现金预算（后者在该场景约为 1/3）。低值端由**整手向下取整**在高价股上造成（符合预期） |
| **40 日 TIME_EXIT + 收盘触发次日开盘** | 首笔：决策 2026-02-02 → 入场 **2026-02-03 开盘**；`exitTime=2026-04-09`、`holdingPeriod=41`、`reason="持有满40个交易日"` ⇒ 与平台「收盘触发、下一交易日开盘成交」一致，并与研究报告登记的 `holdAvg=41.01` 相互印证 |
| 期末未平仓 | `openAtEnd` 计数 = 115；期末权益以 **MTM** 计（`equity=987,717.37 = cash 421,045.37 + marketValue 566,672`）⇒ 平台未平仓口径，**未伪造 rd80 结算** |
| `candidateExitPolicy=DISABLED` | 出场原因全部为 TIME_EXIT（无「排名变化」类卖出） |
| **拒绝/顺延（不静默丢弃）** | `executionStats`：211 signal → 211 order → **211 fill**，`rejectedOrders=0`、`partialFills=0`；`skipped` 共 **11** 条：`BUDGET_BELOW_MIN_LOT`×5（整手预算不足拒买）、`NO_NEXT_TRADING_DAY`×6（区间末端无次日 ⇒ **不伪造成交**） |
| **持仓上限** | `openPositions` 峰值 **117 < 180** ⇒ 本片段未触顶；期末 115 |
| **同股票多事件** | 167 个不同 canonical 证券被选中，其中 **4 个被选中 2 次**（同股票的不同事件各自独立成身份、独立计位）⇒ 与 `allowMultipleMembersPerSecurity` 语义一致 |
| **边界并列规模** | 本片段 57 个决策日中 **与第 3 名同分者 = 0** ⇒ 无边界并列；**全区间并列规模留待 S4 报告** |
| **确定性** | 同输入重跑（候选引擎 + 模拟各两次）⇒ `fingerprint` 逐位相同 `2289d6fb…` ⇒ **确定性成立** |

**本片段未覆盖的可成交性路径（如实登记，非「未解释差异」）**：`rejectedOrders=0` 表示本片段
**未出现**涨停/停牌/无量（`NO_LIQUIDITY`）等成交层拒绝，也未出现跌停拒卖后的顺延重估。
该路径需在有此类事态的片段上验证，或在 S4 全区间统计 —— **不得据此声称已覆盖**。

**S3 结论**：对拍顺序的**候选身份/分数 → Top3 → 下单/拒单 → 成交日期/价量/费用 → 每日权益**
已逐层核验，**未解释差异 = 0**；离散量精确一致；浮点容差在看结果前声明且未用于掩盖账本差异；
重复运行确定。**S3 通过**（上述未覆盖路径已在 S4 待办中显式登记）。

---

## 8. canonical 指标（S5 · 已核验）

**来源**：已留档 Run 的 `evaluation` 阶段输出（`metricsSource="canonical"`）；**无第二套公式** ——
下表同时给出「用**同一份**权威实现（`research/riskAdjustedMetrics/analyze.ts` 与
`shared/quant-stats.ts#sharpeRatio`）从**同一份**已留档权益曲线独立重算」的结果。

**口径披露**：年化交易日 **252**（`annualizationBasis.daysPerYear`）；无风险年利率 **0%**；
下行目标 `downsideTarget=0`（超额收益空间）；权益起点 = 权益曲线首点（初始资金 1,000,000）；
比率类在「样本 < 2 / 波动=0 / 下行偏差=0 / 回撤=0」时按权威实现返回 **null**（本两次均非 null）；
期末未平仓**不进**胜率与盈亏比，另按 MTM 计入权益。

| 指标（权威口径） | 780004（Run `6210013`） | 780005（Run `6210014`） |
|---|---:|---:|
| `totalReturnPct` | **+65.097** | **−5.462** |
| `cagrPct` | +7.309 | −9.301 |
| `maxDrawdownPct`（**正数幅度**，项目口径） | 16.085 | 12.628 |
| `sharpeRatio`（rf=0，252） | 0.7175 | −0.7568 |
| `sortinoRatio` | 0.9787 | −1.0029 |
| `calmarRatio` | 0.4544 | −0.7365 |
| `winRatePct` / `profitFactor` | 48.60 / 1.5624 | 32.35 / 0.4387 |
| `completedTradeCount` / 期末未平仓 | **4825** / 0 | **306** / **117**（MTM） |
| 年化波动 / 下行偏差 | 10.621% / 7.787% | 11.958% / 9.023% |
| 权益点 / 区间 | 1792 / `2019-01-03~2026-05-28` | 146 / `2026-01-29~2026-09-04` |
| 费用合计（`totalCost`） | 53,682.66（佣金 12,410.04 + 滑点 41,272.62） | 4,419.69（佣金 894.53 + 滑点 3,525.16） |

**逐项一致性核验**（`tests/tools/eventStateLongMetrics.mts`，7 项 × 2 run）：**全部 match = true**，
含独立交叉核对 `shared/quant-stats#sharpeRatio` ⇒ `allChecksMatch = true`。
**`tradesTruncated = false`** ⇒ 完整成交台账确实在留档里，Run 可由库内记录重建。

> 🔴 工程核验通过 **不改变投资结论**：780005 的绝对收益仍为负，原 **Stage 1 FAIL 未被推翻**（见 §9）。

---

## 9. 旧报告 / 正式新结果 / 差异原因

| 项 | 旧研究报告 | 正式新结果 | 差异 | 差异原因（可定位） |
|---|---:|---:|---:|---|
| 780004 `totalReturnPct` | +53.88% | **+65.10%** | **+11.22pp** | ① 执行层真实约束与旧 harness 近似不同：整手取整（本 run `BUDGET_BELOW_MIN_LOT` 拒买 77 次）、涨停/跌停/无量拒买（本 run 56 次）、跌停拒卖顺延；② 出场时点：平台「收盘触发 + 次日开盘」，旧 harness 记 `rd(D+F)` **收盘**；③ 末端：平台未平仓 MTM，旧 harness `rd80` 强制结算；④ 旧 harness 的候选预筛（先剔 `canBuyAtOpen≠1`）与平台「先占 TopN 再在成交层跳过」不同 |
| 780004 MDD（幅度） | 18.08% | **16.08%** | −2.00pp（更浅） | 同上；且正式区间含执行尾窗（权益至 `2026-05-28`），末端 MTM 段不同 |
| 780004 成交笔数 | 4811 | **4825** | +14 | 拒单/顺延与整手取整共同改变成交集合；笔数差异极小（0.29%） |
| 780005 `totalReturnPct` | −7.54% | **−5.46%** | **+2.08pp** | ① **区间差异（主因）**：正式的物化路径被平台守卫限制在数据集窗口内（`2026-01-29~2026-09-04`，§6.3），旧报告到 `2026-10-09`；末段约 25 个交易日无法出场，117 笔按 MTM 计；② 同上执行语义差异 |
| 780005 MDD（幅度） | 13.33% | **12.63%** | −0.70pp（更浅） | 同上 |
| 780005 成交笔数 | 468 | **423** | −45 | 窗口短约 19 个交易日（每交易日成交率相近：2.84 vs 2.90 笔/日），主要为区间差异 |
| 旧报告风险调整指标 | 780004：Sharpe **0.553** · Sortino **0.500** · Calmar **0.348** · 年化波动 **11.36%**（[`RESULT-STAGE4-001.md`](RESULT-STAGE4-001.md)）；780005：Calmar **−0.803** · 年化波动 **11.77%** · Alpha −7.39%（[`RESULT-VALIDATION-FINAL-001.md`](RESULT-VALIDATION-FINAL-001.md)） | canonical：780004 Sharpe **0.7175** / Sortino **0.9787** / Calmar **0.4544** / 年化波动 **10.621%**；780005 Calmar **−0.7365** / 年化波动 **11.958%** | **口径不同，不可直接比较** | 旧报告口径：**Sharpe = CAGR / 年化波动**（非 `mean / sample sd`）；CAGR 用 **365.25 自然日**；Sortino 分母**只对负收益日取均值**（非全样本下行偏差）。数值上可验证：780004 `0.553 × 11.36% ≈ 6.28%` = 旧 CAGR₃₆₅（正式 CAGR₂₅₂ = **7.309%**）；780005 `−0.803 × 13.33% ≈ −10.70%` = 旧 CAGR₃₆₅（正式 CAGR₂₅₂ = **−9.301%**）。正式一律 **252** 且 Sharpe = `mean/sample sd × √252`、Sortino 分母 = **全样本**下行偏差 |

**验证强度（如实声明）**：
- 本次**没有**旧权益/成交产物 ⇒ **不声称全历史逐笔等价**；执行语义的等价性只由 **S3 的直接对拍**
  （候选身份/分数/Top3 未解释差异 = 0、整手/仓位/出场时点/期末口径逐项核验）证明。
- 两条正式 Run 的指标、台账、配置、指纹均可从 `closed_loop_backtest_run` 重建（§8）。

**投资结论不变（必须保持可见）**：
- 780005 正式结果 **−5.46% < 0** ⇒ 原 **Stage 1 FAIL**（门槛 S1-P1「绝对收益 > 0」）**未被推翻**，
  工程一致性通过**不等于**投资验证通过。
- **样本独立性仍是显式假定**：780004 的因子发现使用过 2019–2025 全长区间；780005 不是严格未见样本。
- 780005 本次区间被裁剪（§6.3），其指标**不能**与旧报告的 165 交易点报告直接等价比较。

---

### 9.1 旧报告明细与基准（预登记，保留）

| 旧报告值 | 性质 | 与正式执行的可预期差异来源 |
|---|---|---|
| 780004：+53.88% / MDD −18.08% / 4,811 笔 | 研究 harness | 整手取整；成交可行性预筛（harness 先剔 `canBuyAtOpen≠1`，平台先占 TopN 再在成交层跳过，≈2% 候选差异）；出场时点（harness 记持有到期**收盘**成交，平台「收盘触发 + 次日开盘」）；rd80 强制结算 vs 平台未平仓 MTM |
| 780005：−7.54% / MDD −13.33% / 468 笔 / **Stage 1 FAIL** | 研究 harness | 同上 |
| 基准 000300.SH：+59.13% / −9.18% | 指数 | — |

**原 Stage 1 FAIL（S1-P1 绝对收益 > 0 未通过）必须继续可见，不得因本轮工程 PASS 而改写。**
样本独立性仍是**显式假定**：780004 的因子发现用过 2019–2025 全区间，780005 不是严格未见样本。

---

## 10. S6 · 状态呈现与可达性（只读实证，**未改任何界面**）

S6 要求「用户能从策略入口到达新 Run 与证据，且**没有把正式复现 PASS 呈现为 OOS PASS**」。
本轮**不新增界面**，直接核验**既有入口**消费的服务端口（`tests/tools/eventStateLongReachability.mts`，只读；`problems = []`）：

| 既有入口 | 消费端口 | 本轮实测返回 |
|---|---|---|
| `client/src/pages/BacktestRuns.tsx`（回测历史） | `closedLoopBacktestRun/repository.ts#listClosedLoopBacktestRuns({strategyId})` | **2 条**：`6210013` / `6210014`，`strategyVersion=2.0.0`、`status=ALL_EXECUTED`、`datasetVersionId` 与 `dateRange` 齐备，记录内已含 `totalReturnPct`/`maxDrawdownPct`/`cagrPct`/`finalEquity`/`tradeCount`/`equityCurvePointCount`/`recipeId`/`datasetSource` |
| `/strategies/:strategyId?version=…&tab=evaluation`（策略 → 版本） | `research/strategyPersistence/service.ts#listVersions` | **2 个版本**：`1.0.0`（`Validated`）· `2.0.0`（`Draft`，`parentVersionId=3600006`） |
| `BacktestCompare.tsx`（多版本对比） | `closedLoopBacktestRun` 适配器 | 可用同一 strategyId 两版本留档对比 |

⇒ **旧版本生命周期、修正版与两条正式 Run 均经既有状态/证据结构可见**，无需改动 `client/**`；
因此「界面变化经过实际渲染验收」在本轮**不适用**（无界面变化）——本条如实声明，不冒充已渲染验收。

### 10.1 ✅ 用户裁定与本轮处置

**用户裁定（本轮直接指令）**：
1. 「到 20260904 即可」⇒ **接受** 780005 区间裁剪为 `2026-01-29 ~ 2026-09-04`（§6.3 的产物即为最终口径）；
   **不**统一物化路径的数据集窗口口径（不埋共享守卫改动）。
2. 「如果暂时不用的话可以先不用」⇒ provenance **暂缓**，不作为本目标门禁；`strategy_research_provenance` 保持 0（不伪造）。
3. 「可以修改」⇒ **授权**修正 `3600006` 的生命周期状态。

#### 10.1.1 执行前影响报告（生命周期操作，先报告后执行）

| 项 | 内容 |
|---|---|
| 入口 | `server/research/strategyPersistence/service.ts#StrategyService.setVersionStatus` —— 源码标注「**STRATEGY-003 — 版本生命周期状态迁移（唯一允许的 UPDATE；内容仍不可变）**」 |
| 守卫 | 内部用 `research/lifecycle/types.ts#isStrategyLifecycleStatus` 校验 **C-21.1 八态**（`Draft/Research/Candidate/Validated/Paper/Approved/Production/Retired`），非法值抛错 |
| 目标 | `event-state-long-maxamp5-top3@1.0.0`：`Validated` → **`Retired`** |
| 为何选 `Retired` | 该版本**已被后续独立验证判为 FAIL**（780005 Stage 1 FAIL，正式复现 −5.46% 仍未转正）且**已被修正版 `2.0.0` 取代**（`parentVersionId=3600006`）。`Retired` 是八态中唯一表达「不再在用」的终态；`Draft/Research/Candidate` 会误导为「仍在预验证阶段」，`Paper/Approved/Production` 是晋升。 |
| **不改什么** | document / definition / 指纹（`7e863012…`）/ `datasetVersionId` / `parentVersionId` / `codeVersion` / `createdAt` **一律不动**；**不新增/不删除**任何版本；**不回填**历史记录；无 DDL / migration |
| 实体投影 | 服务层注释明确：`strategies.status` 只在**迁移当前版本**时同步，旧版本状态迁移**不得覆盖首页状态** ⇒ 迁移 `1.0.0` 预期 `strategies.status` **保持 `Draft`**（不动） |
| 预期副作用 | 仅 `strategy_versions` 单行 `status` 列由 `Validated` → `Retired`（服务层允许的列） |
| 工具 | `tests/tools/eventStateLongLifecycle.mts`（**版控内**；`--dry-run` 只报告不写库） |

#### 10.1.2 执行与对账

已执行（用户授权后）：`1.0.0` `Validated` → **`Retired`**；断言 **4/4 通过**
（`statusChanged` / `contentUntouched` / `otherVersionsUnchanged` / `entityStatusUnchanged`）；
行级对账见 **§5.3**。干跑（`--dry-run`）实测目标行 `1.0.0` 当前 `status=Validated`、实体 `status=Draft`、
`currentVersionId=3600007` ⇒ 与上表预期一致。

**效果**：策略入口不再把该版本呈现为「已验证」；结合 §9 的 Stage 1 FAIL 与两条正式 Run
（`−5.46%` / `+65.10%`），使用者可同时看到「版本已退役」与「后续验证 FAIL」。

## 11. 最终报告

| 项 | 结论 |
|---|---|
| **执行一致性** | ✅ **达成**：正式装配可跑（`engine=strategy-core`、`recipeSource=strategy-document`）；执行快照逐字段等于 §3（§3 检查 22 项 / 0 不一致）；S3 未解释差异 = **0**；两条正式 Run 五阶段 `EXECUTED` 并留档；canonical 指标 7 项 × 2 run **全部 recompute match**；台账随留档可取回（`tradesTruncated=false`，**并经 §6.5 修复后前端可读**） |
| **证据可追溯** | ✅ `6210013`（780004）· `6210014`（780005）；复现工具在版控内（`tests/tools/eventStateLong…`）；代码坐标 `1.0.0+gf8b6810.dirty`（非 `gunknown`、非仅 HEAD）。**⚠️ 期间发现并修复了留档可读性缺陷（§6.5）：初版工具自拼 `result.wiring` 导致前端读不出结果，已用平台唯一实现 `toWiringSummary` 重建并就地修复；修后 `equityCurve` 1792/146、成交 4825/423 均正常可读。** |
| **旧记录未变** | ✅ `3600006` 逐列未变；`strategy_versions` 总数仍 180；无 DDL / migration |
| **写入逐项对账** | ✅ `strategy_versions` +1（`3600007`）· `closed_loop_backtest_run` +2（6210013 / 6210014）· 实体指针 1 处 · **生命周期 1 处**（`3600006` `Validated`→`Retired`，§5.3，用户授权 + 执行前影响报告） |
| **最终状态** | ✅ **COMPLETE** —— 见下 |

**原三项待裁定项已全部闭合（用户裁定 + 已执行）**：

1. **780005 区间裁剪** → 用户「到 20260904 即可」⇒ **接受**为最终口径（§6.3 的留档即最终结果）；
   不统一物化路径数据集窗口口径（不埋共享守卫改动）。
2. **provenance** → 用户「暂时不用的话可以先不用」⇒ **暂缓**，不作为本目标门禁；
   `strategy_research_provenance` 保持 0（**未伪造**）。契约缺口描述保留在 §6.4，供将来需要时使用。
3. **`3600006` 生命周期** → 用户「可以修改」⇒ 已执行 `Validated` → **`Retired`**（§5.3 / §10.1），
   **原内容与历史指纹保留**。

**总验收逐条对照（§6）**：`tsc --noEmit` = 0 ✅；受影响测试零新增失败 ✅；EOL tracked 漂移 = 0 ✅
（全仓 exit 1 仅因其他会话未跟踪文件）；新行为有测试锁且既有守卫未放松 ✅；
旧策略/旧 Run/旧 Dataset 无内容变化、无 migration ✅；正式装配不报未注册配方 ✅；
执行快照与 §3 一致（22/0）✅；S3 未解释差异 = 0 ✅；两数据集正式结果已留档且可重建 ✅；
代码坐标 `1.0.0+gf8b6810.dirty`（非 `gunknown`、非仅 HEAD）✅；Contract/DB/Execution 影响与写入逐项对账 ✅。

**唯一保留的告知项（非门禁）**：`research_experiment_run` 中 **16 条逾 15 天未更新的 `RUNNING`**
属**其他实验**的历史遗留（2026-09-25），本目标按「不修改历史记录」**未动**，建议人工另行核查。

**后续队列（§3 要求：只登记，不启动）**：

| 顺序 | 目标 | 启动条件 | 必须先明确 |
|---|---|---|---|
| B | `maxAmp5` 是否优于「降低市场暴露＋现金」 | 本目标已 COMPLETE ⇒ **满足启动条件，但需用户选择** | 对照规则、事前判据、真实费用、Alpha 置信区间与自相关处理；780005 已被看过 ⇒ 新增对照仅为事后诊断 |
| C | 冻结策略的前向观察 | B 有增量价值证据，且用户批准观察方案 | 未见样本边界、计划资金、运行日历、费用与成交约束、停止规则；优先无资金交易的前向观察 |

**B 的最小预注册建议（仅建议，不启动）**：以「同区间、同费用、同成交约束」把冻结配置与
「等额现金/降低市场暴露」基准对照；事前登记判据（超额收益符号 + 置信区间 + 自相关处理）；
明确 780005 已见样本 ⇒ 任何新增对照只算**事后诊断**，不得当作 OOS 证据。

**投资结论（不得被工程 PASS 覆盖）**：780005 正式 **−5.46% < 0** ⇒ 原 **Stage 1 FAIL 未被推翻**；
样本独立性仍是**显式假定**；本目标**不**把任何版本转为 Paper / Approved / Production。

## 12. 环境与并发记录

- `.agent/task-state.yaml` 当前属于**另一个仍在 ACTIVE 的 Goal**（`FRONTEND-IA-001`）。
  按规格要求**未覆盖**；本目标的阶段状态记于本文件。如需 Orchestrator 状态文件，
  应另建独立文件而非改写他人状态。
- 工作区含并发会话未提交改动（`client/**`、`research/**`、`tests/**` 等），本目标**未触碰**它们。
- 全仓 EOL 严格检查的既有失败（未跟踪的 `_scratch/overlap/probe01_db_state.mjs` CRLF）
  属**其他会话文件**，本目标不覆盖，亦不借本任务隐藏全仓失败；收尾时重新核查归属。
