# STRATEGY-ARCH-002 — Strategy Runtime Production Wiring & Persistence

> 实施报告（唯一交付）。执行模式：Phase A 映射 → Phase B 一次性接线+持久化 → Phase C 完整测试 → Phase D 本报告。
> 全程遵守：禁 `db:push` / `drizzle-kit generate` / 新依赖 / 手改 `_journal.json`。

---

## 1. Executive Summary

**结论：`STRATEGY-ARCH-002` = COMPLETE（附 4 条如实登记的剩余项）。**

- ✅ **Core 已通电**：真实生产链路的策略判定**由 `StrategyRuntime.evaluate` 产出**。
  接线点在 STEP 10 的既有注入槽 `Strategy13.signalBuilder`（`framework/signal.ts`）——
  **没有新增分支、没有复制任何撮合/排序/选择逻辑**，`runCandidateEngine` /
  `runResearchPipeline` 仍是唯一编排。
- ✅ **每次运行留档可复现坐标**：`closed_loop_backtest_run.resultJson.strategyRun`
  = `{strategyRunSnapshot, strategyDecision, executionMetadata}`。**零 schema 变更、零迁移。**
- ✅ **零回归**：`tsc --noEmit` **0 error**；全量 vitest **8 失败文件 / 17 用例**，
  与改造前基线**逐项一致（新增失败 = 0）**，用例数 4304 → 4471（+167）；
  `vite build` 成功（15.91s）。
- ⚠️ **没有完成**：`StrategyRunSnapshot` 的 `runtimeConfig` 是**运行级**而评估是**逐决策日**
  的（N-05）；`N-03`（阈值型出场）、`N-04`（`ALL_DAYS` legacy 不可表达）**仍存在**；
  Core 与 legacy **语义确实存在一处差异**（§7），未静默抹平。
- ❌ **不做**（规格 §13）：Parameter Search / WFO / OOS / Paper / Live / 前端大改 / 新表。

---

## 2. Implementation Mapping

| 旧入口 | 新入口 | 接入方式 |
|---|---|---|
| `recipeRuntime.buildSignalBuilder(paramSet)`（门槛型配方在 `recipeRegistry.ts` 里 `if` 判特征） | **`createCoreSignalBuilder`** → `StrategyRuntime.evaluate` | `assemble.ts#assembleStrategySide` 替换 `strategy13.signalBuilder` 槽位 |
| `document.definition`（legacy JSON） | `StrategyVersion`（Core） | `coreVersionFromDocument()` → `fromLegacyStrategyDefinition()`（ARCH-001 既有适配器） |
| `eventBaselineOf(bars)=bars[0]` 隐式锚定 | `EventAnchorPolicy = "SERIES_START"`（显式登记 + 进快照） | `toCoreBarWindow()` |
| `pullbackFeatures` 的 `availability=EPOCH_FLOOR_DATE`（守卫恒通过） | `FeatureLeakageDeclaration`（相对当前 bar）+ PIT 访问关卡 | ARCH-001 已建，本轮在生产路径**真正启用** |
| 无运行坐标留档（实测 `resultJson` 里 `parameterSet/codeVersion/engineVersion` 命中数 = 0） | `buildStrategyRunRecord()` | `researchRunRouter#loopRun` 写进既有 `resultJson` |

---

## 3. Production Wiring

**已切换到 `StrategyRuntime` 的真实路径**（逐条给证据）：

| 真实路径 | 现状 |
|---|---|
| `researchRunRouter.loopRun`（`useRealData=true`）→ `assembleRunWorkbenchInputs` → `strategy13.signalBuilder` | ✅ 走 Core（`assemble.ts` 内 `createCoreDecisionSource`） |
| 闭环 `research` 阶段（`runCandidateEngine` → `runResearchPipeline`，逐个决策日 × 逐证券） | ✅ 判定来自 Core，编排未改 |
| 参数搜索 / 走查的同步评估器（`createStrategyParameterEvaluator` → `assembleStrategySide`） | ✅ 同一装配函数 ⇒ 同一 Core 判定 |
| 评估端口 `evaluateStrategyParameters` | ✅ 同上（复用装配层） |
| `strategyEvaluation/backtestBridge.ts` | ✅ 同上 |

**回落（例外，且必须带原因出网）**：文档缺 `definition` 段（存量 `limit-up-baseline` ×2）
⇒ `assembly.strategyDecisionEngine = "legacy-recipe"` + `strategyDecisionEngineNote`（原因码 `NO_LEGACY_DEFINITION`）。

**契约改动（全部向后兼容）**：
- `framework/signal.ts`：`SignalBuilderInput` **新增可选** `bars?` / `point?`（既有构造器不读，行为逐字不变）；
- `framework/pipeline.ts`：把 `bars` + `point` 传给构造器；
- `recipeRegistry.ts`：`StrategyRecipeRuntime` **新增** `rankFeatureId`（Core 不产排序值 ⇒ 必须**读**配方声明，禁在接线层硬编码）；
- `shared/researchContracts.ts`：新增 `strategyRunRecordSchema`；`assembly` 增 `strategyDecisionEngine(+Note)`；`closedLoopRunResultSchema` 增**可选** `strategyRun`。

---

## 4. Persistence

| 内容 | 存在哪里 |
|---|---|
| Strategy Run（一次执行） | `closed_loop_backtest_run` 一行（既有表，`runId` 唯一键，幂等 upsert） |
| `StrategyRunSnapshot` | `resultJson.strategyRun.strategyRunSnapshot` |
| `StrategyDecision` | `resultJson.strategyRun.strategyDecision`（**摘要**：全量计数 + 行为面滚动指纹 + 有界样本 24 条） |
| Fingerprint | 定义指纹 `computeDefinitionFingerprint`（Core 唯一实现）；决策摘要指纹 `decisionDigestFingerprint`（**明确不是策略指纹**，见 `runRecord.ts` 注释） |
| Dataset Reference | `…strategyRunSnapshot.datasetReference`（`datasetVersionId` / label / source / 内容指纹）；**Definition 内不出现**（有守卫） |
| 引擎 / 代码版本 | `…executionMetadata.engineVersion`（`strategy-core/1.0.0`）/ `codeVersion`（调用方注入，如实标注） |

**为什么是摘要而不是全量决策**：一次运行可达 10^5 条决策 × 每条含 `ruleTrace` ⇒ 全量会把
`resultJson` 撑到数百 MB。摘要保留「跑出了什么」（指纹，可逐字节比对）与「为什么」（抽样）。

---

## 5. Database Changes

```text
新增 migration：0
新增表：        0
新增字段：      0
DB Schema Change = 0
```

理由（规格 §7.1 要求先证明「现有持久化无法承载」才能新建表）：本记录的**生命周期**
（一次运行一行、随运行消亡）、**查询模式**（详情页按 `runId` 读一次）、**并发模型**
（与运行同事务边界）、**领域职责**（「这次运行用了什么」）与 `closed_loop_backtest_run`
**完全一致**；`resultJson` 本就是「本次运行的完整留档」，JSON 扩展足够
（实测单条 `resultJson` 规模见 §6）。⇒ 新建表只会制造第二套 SoT。

---

## 6. Existing Data Safety

只读核验（`docs/evidence/_probe_arch002_documents.out.json`，全程 SELECT、零 DML、`errors: 0`）：

| 表 | 行数 | 结论 |
|---|---|---|
| `strategies` | 10 | 未被触碰 |
| `strategy_versions` | 11 | 未被覆盖（`strategyDocumentJson` 只读） |
| `closed_loop_backtest_run` | 6 | **历史留档未被删改**；新写入是 `ON DUPLICATE KEY UPDATE` 按 `runId` upsert |
| `dataset_version` | 2 | 未变 |

本轮**未执行任何写库操作**（未起 dev server、未跑真实运行）⇒ 历史行数由构造保证守恒。
`resultJson` 新增的 `strategyRun` 是**可选字段**，旧留档解析不受影响（zod `optional`）。

---

## 7. Reproducibility

```text
Original Run → Snapshot → verify(V1..V6) → replay → Decision comparison
```

- `verifyStrategyRunSnapshot` 六项判据全绿（`checks.every(ok)`），
  V3「定义指纹」在定义被换掉时**如实转红**并拒绝复现（测试 `Test F2`）。
- `replayRunSnapshot` 返回的 `resolvedParameterSet` 与快照**逐键相等**（含 DERIVED 参数）。
- 重跑等价性：同一配置两次独立运行 ⇒ `decisionDigestFingerprint` 逐字节相同（Test B / F）。
- 🔴 **判据落点**：`buildStrategyRunRecord` 会拿**装配层解析的参数**与**快照重算结果**逐键比对，
  不一致即抛错 —— 防「留档一份复现出来是另一个策略的记录」。

**Legacy / Core 语义差异（**已定位，未抹平**）**

| 侧 | 行为 |
|---|---|
| legacy 门槛型配方 | **逐日**看当天门槛，满足就出信号（`makeGatedSignalBuilder`，无窗口/触发概念） |
| Core | 按文档声明的 `observationWindow {1..N}` + `trigger` 判定；`FIRST_VALID_DAY` 只在**首个成立日**出信号 |

实测（同一份 bars、门槛对齐到文档声明的条件）：legacy 出 `[2,3]`，Core 出 `[2]`；
**首个有效日一致**。⇒ 差异根因是 **legacy 执行侧没有实现自己文档声明的 trigger**，
不是 Core 判错。生产已切 Core（= 按声明语义执行）；该差异会让「逐日重复信号」消失，
**历史回测数字不可直接对比**，已如实登记。

---

## 8. Test Results

| 项 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **0 error** |
| Strategy Core（含生产层） | `npx vitest run tests/server/strategyCore` | **10 文件 / 158 用例 / 0 failed / 0 skipped**（ARCH-001 为 112） |
| Production wiring | `tests/server/strategyCore/production/coreDecision.test.ts` | Test A–F 全绿（含「未注入事件判定器 ⇒ 响亮抛错」） |
| Persistence | `production/runRecord.test.ts` | 快照自洽 / zod 契约 / 参数不一致即抛 |
| Replay | 同上 Test F / F2 | verify 全绿；定义被换 ⇒ 拒绝复现 |
| Legacy/Core 对比 | `coreDecision.test.ts §15` | 差异形状被**钉死**（legacy `[2,3]` vs Core `[2]`，首个有效日一致） |
| Build | `npx vite build` | 成功（15.91s） |
| 全量回归 | `npx vitest run` | 8 失败文件 / 17 用例，基线 8 / 17 ⇒ **新增失败 = 0**；用例 4304 → 4471 |

新增测试文件：`tests/server/strategyCore/production/{barWindowAndEvent,coreDecision,runRecord,versionFromDocument}.test.ts`

### 实施期抓出并修掉的 3 个**真实阻塞缺陷**（先定性再改产品）

1. **适配器对全部真实文档必崩**：真实文档 `definition` 段**没有** `position` / `risk`
   （仓位在文档顶层 `positionSizing`），而适配器读 `legacy.position.sizingMethod` ⇒ TypeError。
   ⇒ `normalizeLegacyDefinition()` 从**同一份文档的顶层字段**补全并写 note（不猜）。
2. **`valueType=CONSTANT` 的值其实是表达式文本**：真实文档里
   `value: "prefix.rd0.volume * 0.3"` ⇒ 按字面翻译会变成「数字 ≤ 字符串」。
   ⇒ 保守判定 `looksLikeExpressionText`（含字段根或算术符号才当表达式）+ 修复
   `parseExpression` **不支持字段引用**的缺口（新增 `field` 记号，**严格向后兼容**）。
3. **「今天出不出信号」不能只看 `ruleEvaluation.satisfied`**：`WINDOW(ANY_DAY)` 一旦成立，
   后续每个决策日都「已成立」⇒ 同一触发被重复消费。⇒ 判据改为
   **首个成立日 = 今天成立 ∧ 昨天尚未成立**（额外求一次截到昨天的窗口，**用不计数解析器**，
   避免把探针求值计进 Run Record）。

另有 1 处是**测试判据自身错**（把 rd0 当窗口非空；`applyDefinitionChange` 幂等对象写错），
按纪律改判据并记录。

---

## 9. Remaining Issues

| # | 状态 | 说明 |
|---|---|---|
| **N-01** | ✅ **已解决** | `StrategyRunSnapshot` 已落库（`resultJson.strategyRun`），零 schema 变更 |
| **N-02** | ✅ **已解决** | Core 已接生产链路（`loopRun` / 闭环 `research` 阶段 / 参数评估器三条路径共用同一装配） |
| **N-03** | ⚠️ 仍存在 | 阈值型出场（TAKE_PROFIT / STOP_LOSS / TIME_EXIT）需「入场价/入场日」运行态引用 ⇒ 仍以 `exitRules` **声明**保留，未进 `exitRuleGraph`；`unmappedExitRuleIds` 已如实落库 |
| **N-04** | ⚠️ 仍存在 | `ALL_DAYS` 在 legacy 侧不可表达 ⇒ 适配器一律译 `ANY_DAY` 并写 note |
| **N-05** | ⚠️ **新增** | `StrategyRunSnapshot.runtimeConfig` 是**运行级**，而评估是**逐决策日**（`currentRelativeDay` 逐日不同）⇒ 逐决策坐标记在 `strategyDecision.samples[]`。复现需按样本逐条重建，运行级配置不能单独复现全量 |
| **N-06** | ⚠️ **新增** | `datasetHorizonRelativeDay` 逐决策日**不可知** ⇒ 兼容性报告不做视界校验（不编造）；运行级视界校验建议在装配层用整份数据集做一次（本轮未接） |
| **N-07** | ⚠️ **新增** | 事件源声明（`eventAnchored: true`）由装配层给出 —— 目前是「绑定了 `datasetVersionId` 即视为事件窗」；**未从 `dataset_definition` 机器读取**该事实 |
| **N-08** | ⚠️ **新增** | 「首板性」（rd-1 非涨停）**不在事件窗内可验证** ⇒ 委托给数据集定义，运行期只校验「rd0 涨停」 |

---

## 10. Final Readiness

```text
Strategy Core:                  READY
Strategy Runtime Production:    READY（附 §7 语义差异说明 —— 已切换、差异已定位）
Strategy Run Persistence:       READY（零 schema 变更）
Strategy Module:                READY
```

**下一步能否进入 Parameter Search / Backtest 阶段？**

**可以进入，且比本轮之前更有把握**：参数搜索所需的三件——「同一份策略文档 × 参数覆写 →
走真实子链 → 绩效标量」——已经存在（`strategyEvaluation`），且其策略判定现在**由 Core 产出**。
但需带着两条已知边界进入：

1. **逐日重复信号的消失**会让参数搜索结果与历史数字不可直接对比（§7）；
2. **单次运行的可复现性仍不完整**（N-05 / N-06）—— 同配置重跑等价（有指纹），
   但「拿一份快照独立复现**全量**决策」还缺逐决策坐标的完整留档。

---

## 附录 A — 本轮新增/修改文件

**新增**：`server/strategyCore/production/{barWindow,eventSource,coreDecision,versionFromDocument,runRecord,index}.ts`
（约 1.5k 行）+ `tests/server/strategyCore/production/{4 个测试}`（46 用例）
+ `docs/evidence/_probe_arch002_documents.mts` + `.out.json`。

**修改**（均为最小侵入）：`framework/signal.ts`、`framework/pipeline.ts`、`recipeRegistry.ts`、
`strategyCore/adapters/legacyDefinition.ts`、`strategyCore/expression.ts`、
`runWorkbenchAssembly/assemble.ts`、`researchRunRouter.ts`、`shared/researchContracts.ts`。

## 附录 B — 证据

- `docs/evidence/_probe_arch002_documents.out.json` — 11 份真实策略文档的
  `entry / observationWindow / trigger / conditions / exit / execution / parameters` 逐字段取证（零 DML，`errors: 0`）；
- `docs/evidence/_probe_strategy_audit_state.out.json` — ARCH-001 的表行数与 `resultJson` 键命中统计（本轮沿用）。
