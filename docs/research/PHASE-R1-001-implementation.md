# PHASE-R1-001 — 首板回踩 Sample Selection / Look-ahead 修复 · 实施报告

| 项 | 值 |
| --- | --- |
| 任务 | `PHASE-R1-001 — 首板回踩 Sample Selection / Look-ahead 修复`（事项 `rH3f0u`，`STRATEGY-EXTENSION-001` 第 2 阶段） |
| ROADMAP 编号 | **`9bz`**（原拟 `9by`；因 PHASE-A-001 补登拿走 `9by` 而顺移） |
| 前置 | `PHASE-A-001 — Research Report Artifact 最小闭环`（`9by`，✅ 已完成 2026-09-20） |
| 实施时间 | 2026-09-20 |
| 结论 | **实现 / 测试 / 真实数据池对照 / 真实 DB 端到端全部通过**；过程中发现一个**结构性阻塞并已由用户裁定消解**（见 §7） |

---

## 1. 任务目标

消除首板后回踩研究里最重要的数据正确性风险：

> 若研究在 `T+d` 判定，却用完整 `T+1..T+N` 的**未来数据**决定样本是否进入研究池，
> 会产生 survivor / look-ahead bias —— 之后一切统计都建立在「事后已知会成立」的样本上。

要求：`decision day = T+d` 时，样本资格与观察日变量**只能使用 T+1..T+d 之前或当天已可获得的信息**。

## 2. 根因（两条互相独立，均在真实代码中证实）

### 2.1 数据集层（主缺陷）

- `server/researchDataset/pullback.ts#buildWindowBars`(:190-205) 生成**整段** T+1..T+N；
- `#screenSingleTarget`(:116-126) 遍历**全部** bars 判 `broken` / `hitLow`；
- `#screenFirstBoardRow`(:286-298) 的 `windowComplete` 还要求 **N 根齐备**，`matched = windowComplete && results.some(hit)`。

⇒ 池子语义 = 「T+1..T+5 内触及且不破」，**与「在 T+d 决策」在样本层就已用未来**。构建时**完全没有决策日概念**。

### 2.2 研究层（**任务书未提及，审计发现**）

- `server/researchEngine/engine.ts#assertGroupPitSafe`(:1032-1043) 取
  `evaluationOffset = Math.max(组内观察日变量的 offset)`，随后断言「每个 `offset ≤ 该 max`」
  ⇒ **循环定义、恒真，生产路径永不触发**（只有测试手工传 `evaluationOffset: 3` 才抛）。
- 而 `variables.ts#assertObservationConditionsPitSafe`(:1495-1515) 本身完全正确，其注释写明它
  「是整个 OBSERVATION 角色存在的**唯一防线**……没有它，『用 T+5 的形态筛出 T+3 该买的样本』
  会静默产生一组漂亮但不可交易的数字」。

⇒ 那句注释担心的情形**正是修复前的实际行为**。

## 3. 设计（一个关键发现把修复面大幅缩小）

观察日变量**按名字自带窗口**：`pullback_{stat}_{k}d` ⇒ `availableFromOffset = k`、
`postRelativeDays = dayWindow(1, k)`，resolver 只读 `1..k`（`variables.ts:560-583`）；`obs_{k}d.*` 只读 `postBars.get(k)`。
且加载侧本就按引用收窄（`sampleSet.ts:179` → `datasetFromRegistry.ts:1042`）。

⇒ **只要护栏是真的**（`availableFromOffset ≤ 决策日 d`），每个被引用的观察值窗口自然 ⊆ `T+1..T+d`；
**无需给 `ObservationSources` 加 `asOfOffset`、无需改任何 resolver**。

**决策日的载体（用户裁定）**：由「分析 → Run → Experiment → Dataset Version」四级声明，**取唯一值**；
多处异值 ⇒ 响亮拒绝（比缺声明更危险：同一份样本被两套信息边界解释）。
四级全空 ⇒ 引用观察日变量一律拒绝，**绝不退回「整窗可判定」这种恒真的假护栏**。

**一次数据集构建 = 一个决策日的池子**；比较 d=1..5 ⇒ 5 个数据集 / 5 次 Run（与既有 SoT
「一次运行只读一个 `datasetVersionId`」不冲突，也正是 R1.6 要的五个 horizon）。

## 4. 实际修改文件（14 个，**零 migration / 零新表 / 零新列**）

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 契约 | `shared/researchContracts.ts` | `pullbackScreenConditionSchema` 增 `decisionOffsetDays`（**必填、刻意无 default**，min 1 / max 10） |
| 数据集 | `researchDataset/types.ts` | `PullbackScreenCondition.decisionOffsetDays: number`（必填 + doc 说明「样本资格的唯一信息边界」） |
| 数据集 | `researchDataset/pullback.ts` | 新增 `resolveDecisionOffsetDays()`（唯一实现，非法即 **throw**，绝不静默夹取）；`screenFirstBoardRow` 改判 `decisionBars = loadedBars.slice(0, d)`、`windowComplete` 改「前 d 根齐备」；verdict 增 `decisionOffsetDays`/`decisionBars`/`loadedBars`（原 `windowBars` 取消，全仓无消费者） |
| 数据集 | `researchDataset/validate.ts` | normalize **不给默认**；新增 `INVALID_PULLBACK_DECISION_OFFSET`（须 `[1, observationWindowDays]` 整数） |
| 数据集 | `researchDataset/builder.ts` | `universeDefinition` 落 `pullbackDecisionOffsetDays`（随版本冻结、可追溯）；`rule` 文案写明「决策日=T+d（样本资格只用 T+1~T+d）」 |
| 研究 | `researchEngine/types.ts` | 新增 3 个错误码：`OBSERVATION_WITHOUT_DECISION_DAY` / `INVALID_DECISION_OFFSET` / `DECISION_OFFSET_CONFLICT`；`ResearchDatasetVersionContext` 增 `decisionOffsetDays: number \| null` |
| 研究 | `researchEngine/datasetReader.ts` | 新增 `extractDecisionOffsetDays()`（只认真实落库值，取不到 = `null`）；`getVersionContext` 顺带返回 —— **零新查询** |
| 研究 | `researchEngine/variables.ts` | 新增**唯一护栏实现** `assertGroupObservationPitSafe()` + 判定日解析 `readDecisionOffsetDays()` / `resolveEffectiveDecisionOffset()`（四级取值 + 冲突校验 + 非法值响亮拒绝） |
| 研究 | `researchEngine/engine.ts` | **删掉恒真的私有 `assertGroupPitSafe`**；`loadConditionSets` 改为**逐分析**解析判定日（分析 → Run → Experiment → Dataset），两处调用点（`run()` / `runIncremental()`）传入 config 来源 |
| 路由 | `researchEngineRouter.ts` | 3 个新码 → `BAD_REQUEST` |
| 客户端 | `adapters/researchEngineAdapter.ts` | 3 条诊断文案（标题 / 解释 / 可执行建议） |
| 脚本 | `scripts/verifyFirstBoardPullback.mts` | 补 `decisionOffsetDays: 5` |
| 测试 | `researchEngine/testFixtures.ts` | 新增 `decisionOffsetDays?: number \| null` 选项，缺省 = `maxPathDay`（既有用例行为不变） |
| 测试 | `tests/server/researchDataset/pullback.test.ts` | 既有 2 处补字段 + 新增 4 例 |
| 测试 | `tests/server/researchEngine/observationDecisionDay.test.ts` | **新文件 12 例**（含两条**反证**断言） |

## 5. 验收读数

| 判据 | 结果 |
| --- | --- |
| 样本池不再使用 decision day 之后的数据 | ✅ `decisionBars = loadedBars.slice(0, d)`，判定只消费前 d 根 |
| T+1..T+5 五个 horizon 均有独立时序逻辑 | ✅ 单测逐个断言 `decisionBars` 为 `[T+1] / [T+1,T+2] / … / [T+1..T+5]`，`loadedBars` 恒为 5 |
| 负向 look-ahead test 通过 | ✅ 「改 T+4/T+5 ⇒ d=2 资格逐字段不变」，且附**反证**（同数据在 d=5 下结论不同） |
| 真实 Research Run 通过 | ✅ 五路真实 DB E2E（见 §6），含**正向跑通** |
| Finding / Conclusion 可正常生成 | ✅ Run#2 / Run#3 各产出 `conclusionId`（`870001` / `870002`，`REJECTED`）、报告 artifact |
| 无新的测试失败（失败**文件集合**不变） | ✅ 全量 `vitest run` = **7 失败文件 / 16 用例（285 文件 → 7 failed / 278 passed）**，与基线逐个相同（全为环境依赖） |
| `tsc` / build | ✅ `tsc --noEmit` = **0 错 / exit 0** |
| EOL drift = 0 | ✅ `checkEolDrift.mjs --strict` = 0 漂移 / exit 0 |
| 最终报告完成 | ✅ 本文件 |
| ROADMAP 更新 | ✅ `ROADMAP.md` §44.5 `9bz` 条目 + 台账行 + 铁律行 + `ROADMAP-CHANGELOG.md` |

## 6. 真实数据证据

### 6.1 样本池「修复前 vs 修复后」（只读；`buildResearchDataset` 经核对**无写库**）

同窗口 `2026-08-10..2026-08-21`、同目标位 `[limitPrice/ma5]`、同容差 2%、`N=5`，**唯一变量 = 决策日**。
「修复前」语义 = 整窗判定，在修复后代码里 `decisionOffsetDays = N` 与它**逐字等价**（构造等价，非近似）。

| | 决策日 | 入池行数 | `PULLBACK_NOT_MATCHED` | `PULLBACK_INCOMPLETE` |
| --- | --- | --- | --- | --- |
| 修复前（等价） | `d=5` | **52** | 333 | 3 |
| 修复后 | `d=2` | **70** | 317 | 1 |

⇒ **旧池子把 18 只「未来 5 天内会跌破」的样本预先踢出了池子**（+34.6%）—— survivor / look-ahead bias 的直接度量。

### 6.2 真实 DB 端到端（`docs/evidence/_e2e_r1_decision_day.mts`，已登记 `docs/evidence/README.md`）

同一 Dataset Version `390002`（`first_limit_pullback`、READY、post 覆盖 1..20）、窗口 `2025-01-02..2025-02-28`：

| 实验 | Run | 条件 | 结果 |
| --- | --- | --- | --- |
| A（**无**决策日声明） | #1 | `pullback_min_low_2d >= 0` | 抛 `OBSERVATION_WITHOUT_DECISION_DAY`；Run `FAILED`、`startedAt=null`（**预检拒绝**，无半成品） |
| A | #2 | `turnover >= 3`（纯特征，**对照**） | `COMPLETED`、12.9 s、`sampleCount=1720`、`resultCount=16`、`conclusionId=870001` |
| B（`experiment.config.decisionOffsetDays=2`） | #3 | `pullback_min_low_2d >= 0`（offset=2 ≤ d） | **`COMPLETED`**、13.1 s、`sampleCount=1720`、`resultCount=16`、`conclusionId=870002` |
| B | #4 | `pullback_min_low_3d >= 0`（offset=3 > d） | 抛 `VARIABLE_ROLE_VIOLATION`；`FAILED`、`startedAt=null` |
| B | #5 | `run.config.decisionOffsetDays=3` 与实验的 2 冲突 | 抛 `DECISION_OFFSET_CONFLICT`；`FAILED`、`startedAt=null` |

**对照法的意义**：同实验换条件能跑通（#2 vs #1）、同实验换 offset 被拦（#3 vs #4）、
同值放行 / 异值拒绝（#3 vs #5）⇒ 拒绝原因唯一地钉在「观察日变量的信息边界」上，
排除「数据集没数据 / 版本不可用 / 引擎坏了」。所有拒绝都发生在**预检阶段**（`startedAt=null`），
符合引擎既有设计意图「配置错误不留跑了一半的状态」。自建自清（`purgedAfter=2`）。

## 7. 过程中发现的结构性阻塞与消解（**必须留档**）

初版实现把决策日只放在数据集层，E2E 立刻暴露阻塞，三条已核实证据：

1. 引擎读的是 registry 的 `dataset_version`（`RegistryResearchDatasetReader` → `DbDatasetRegistry.getVersionById`）；
2. STEP 12.6 的落库表 `research_dataset`（`persistResearchDataset`）**在 `server/researchDataset/` 之外零引用** ⇒ 引擎从不读它；
3. registry `createVersion` 写入的 `universeDefinition` / `filterDefinition` **都不含决策日**，且该路径**没有回踩筛选**。

⇒ `decisionOffsetDays` 恒为 `null` ⇒ 现有数据集上**一切观察日条件都会被拒绝**（含 pattern
`firstLimitPullbackHoldShrink` 的核心条件）⇒ 研究链被阻塞。**用户裁定：判定日下沉为 Run / 分析级声明**
（理由：registry 数据集的「池子」= 首板事件本身、无筛选，决策日只是「本研究在 T+d 判定」的分析意图，
语义上不属于数据集）。已按此实施并五路跑通（§6.2）。

## 8. 附带修正与副产品

- 🟢 **`emitReportArtifact` 钩子在真实 Run 上确实会触发**（Run#2 输出 `artifact=#60001`）⇒
  推翻 PHASE-A 复核遗留⒝「钩子从未被观测到触发」。
- ⚠️ 全仓仍有重复/镜像（本阶段**未动**，已登记）：数据集层 `pullback.ts` 与研究层 `variables.ts`
  **各写一份窗口实现**（无共享）；`client/src/components/research/ConditionGroupsEditor.tsx:67` 是
  `variables.ts` 正则的 UI 镜像；执行侧 `recipeFeatures/pullbackFeatures.ts`（只看当根）与研究侧
  （累积全窗）是 `firstLimitPullbackHoldShrink.ts:13-17` **已显式登记**的口径差异，**不可自动同步**。

## 9. 未完成 / 留待后续

1. ⬜ **`research_dataset`（STEP 12.6）路径与引擎的对接**：目前引擎只读 registry 版本，STEP 12.6 的
   回踩筛选池子没有消费者 ⇒ 「数据集层截断」当前只对构建链路生效。是否要把两条路径合流，属架构决策。
2. ⬜ 老版本 `390001` / `390002` 的池子仍是**未做回踩筛选**的首板事件池；若要按 d 筛选，需新建版本。
3. ⬜ `docs/testing/**` 生成物需在新增测试后重跑（`pnpm run docs:tests`）。
4. ⬜ 三个研究域 E2E（OOS / WALK-FORWARD / robustness）与本次改动无交集，未复跑（不受影响）。

## 10. 证据清单

| 文件 | 内容 |
| --- | --- |
| `docs/evidence/_e2e_r1_decision_day.mts` + `.out.json` | §6.2 五路真实 DB E2E（已登记 `docs/evidence/README.md`） |
| 仓外 `_scratch/_probe_r1_pool_delta.mts` + `r1_pool_delta.json` | §6.1 真实数据样本池对照（只读） |
| `_scratch/tsc_r1*.txt` / `vitest_r1*_full.out.txt` / `eol_20260920.txt` | tsc / 全量测试 / 行尾哨兵读数 |
| `.workbuddy/memory/2026-09-20.md` | 逐轮审计与实施记录（含四条工具教训） |
