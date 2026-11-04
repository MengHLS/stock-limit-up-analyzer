# RESEARCH-006.3 — Strategy Candidate → Strategy Promote（实施报告）

> **状态**：`RESEARCH-006.3 = COMPLETE`
> **唯一架构基准**：`docs/research/RESEARCH-006.0-architecture.md`
> **前序实施**：`RESEARCH-006.1-implementation.md`（DB + Domain Model）· `RESEARCH-006.2-implementation.md`（Conclusion → Candidate Service）
> **完成时间**：2026-09-12 20:45 GMT+8
> **本 STEP 一句话**：把 006.2 建好的「候选」接上**唯一的转正入口** —— `ACCEPTED 候选 → promote() → 构建 StrategyDefinition → 校验 → Dataset Registry 校验 → 创建 Strategy + Version → 写 provenance → 候选 CONVERTED`。
> **明确不做**：`cloneVersion` / `origin = INHERITED` / Promote UI / Backtest / Parameter Search / 任何第三处转换入口。

---

## 1. Objective / 交付范围（§0 ~ §3）

006.0 审计裁定（方案 C「Candidate 即 Draft」）确定：`CONVERTED` 只能由 **promote** 到达（006.2 的 `transition()` 已按裁定一律拒绝 `CONVERTED`，专属错误码 `STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE`）。006.2 交付了「候选从哪来」，本 STEP 交付「候选如何变成策略」。

| 交付 | 说明 |
| --- | --- |
| ✅ `server/research/strategyCandidate/definitionBuild.ts` | **唯一** `Candidate → StrategyDefinition` 转换器（纯函数 / 确定性 / 无 DB 副作用） |
| ✅ `server/research/strategyCandidate/strategyPromotionPort.ts` | 桥内**唯一**允许 import `strategyPersistence` / `strategySchema` 的生产文件 |
| ✅ `StrategyCandidateService.promote()` | 12 步全链（含幂等闸门、跨存储失败恢复） |
| ✅ `research.strategyCandidate.promote` | `adminProcedure`（**不开放 public**） |
| ✅ `scripts/verifyStrategyCandidatePromote.mts` | 真实 TiDB 全链验收（**41 项 / 0 失败**） |
| ✅ `docs/research/RESEARCH-006.3-implementation.md` | 本文档 |
| ❌ `cloneVersion` / `origin = INHERITED` | 本 STEP **明确不做**（§32 / §2） |
| ❌ Promote UI | 本 STEP **不做完整前端**（§36） |
| ❌ Backtest / Parameter Search / OOS / WFO / Robustness | 后续 STEP |

**§3 独占性已确认**：全库**不存在**第二个 `Candidate → Strategy` 转换入口（见 §16 全局搜索证据）。

---

## 2. 架构基准与冲突审查（§1）

**§1 要求**：若代码与 006.0 架构裁定冲突 ⇒ **停止实施并报告冲突，不得自行改变架构**。

**逐条核对结果：无冲突。**

| 006.0 裁定 | 006.3 规格 | 判定 |
| --- | --- | --- |
| Candidate 输入 `overrides` 为**闭集**，不含完整 Definition | §4 只列 `datasetBinding` + `datasetDivergenceReason` | 006.3 是 006.0 的**子集** ⇒ 不冲突 |
| `CONVERTED` 只能由 `promote` 到达 | §5 前置条件「必须 ACCEPTED」 | 一致 |
| Provenance 是 Strategy 侧**独立 display-only 切面**，零 FK 快照 | §20~§22 | 一致 |
| `datasetVersionId = dataset_version.id` 是跨模块**唯一** Dataset 坐标 | §11~§16 | 一致 |
| 不建第二套 SoT | 复用 `strategy_versions.strategyDocumentJson` | 一致 |
| 桥 = 唯一允许同时 import 两侧的目录 | `strategyPromotionPort.ts` 在桥内 | 一致 |

**结论**：未触发「停止实施并报告冲突」，按规格实施。

---

## 3. 唯一转正链路（§0 ~ §2）

```
research_conclusion
      │  (006.2) createFromConclusion
      ▼
research_strategy_candidate  ── DRAFT → REVIEW → ACCEPTED
      │  (006.3) promote()  ← 全库唯一入口
      │    ① definitionBuild            （纯函数，Candidate → StrategyDefinition）
      │    ② validateCanonicalStrategyDefinition（既有校验，失败即零写入）
      │    ③ Dataset Registry 只读校验    （存在 ∧ READY，唯一坐标 dataset_version.id）
      │    ④ StrategyService.create + saveVersion（含 5 投影 + Binding 校验，同事务）
      │    ⑤ provenance.create           （STRATEGY_RESEARCH_PROVENANCE，DIRECT）
      │    ⑥ 候选 → CONVERTED + strategyDefinitionId
      ▼
strategies / strategy_versions / strategy_research_provenance
```

**关键顺序约束（§17 / §23）**：`CONVERTED` **最后**写 —— 只有 Strategy + Version + Provenance **全部成功**之后才允许回写候选终态（§23 / §24）。任何前置步骤失败 ⇒ 候选**保持 ACCEPTED**，且**零 Strategy 数据**。

---

## 4. 输入契约（§4）

```ts
{
  candidateId: number;                       // 必填，正整数
  overrides?: {
    datasetBinding?: { datasetVersionId: number };   // 执行 Dataset 覆盖（唯一键）
    datasetDivergenceReason?: string;                // 仅当「执行 ≠ 研究来源」时允许
  };
}
```

🔴 **严禁**允许调用方提交完整 `StrategyDefinition`。两道防线：

1. **传输层**：zod `strictObject` ⇒ 未知键（含 `definition` / `entry` / `strategyDocument`）在入参解析处即被拒（`unrecognized_keys` → `BAD_REQUEST`）；
2. **服务层**：`assertPromoteOverrideKeys` + `assertPromoteDatasetBindingKeys`（`candidateTypes.ts`，闭集语义「凡不在此列一律点名拒绝」）⇒ `INVALID_INPUT`，**不静默丢弃**。

> 单测 `2b) overrides 出现未知键（含完整 definition）→ 响亮拒绝` 锁定此纪律。

**定义所有权归属结论**：`StrategyDefinition` 的**全部内容只能来自候选草稿**（`entryRule` 及其 `extra` 扩展槽）—— 调用方只能动「用哪份数据集执行」这一件事。这从结构上保证了「转正是转换，不是编排注入」。

---

## 5. 前置条件顺序（§5）

固定顺序，逐条响亮失败：

| # | 判据 | 失败错误码 |
| --- | --- | --- |
| 0 | `candidateId` 为正整数；`overrides` 键合法 | `INVALID_INPUT` |
| 1 | 候选存在 | `CANDIDATE_NOT_FOUND` |
| 2 | **幂等闸门**：`provenance.getBySourceCandidateId(candidateId)` 命中 ⇒ 走幂等返回 | 见 §10 |
| 3 | `status === "ACCEPTED"` | `CANDIDATE_NOT_ACCEPTED` |
| 4 | 来源完整性（provenance 必填锚） | `PROMOTE_SOURCE_INCOMPLETE` |
| 5 | 执行 Dataset 合法（存在 ∧ READY） | `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` |
| 6 | `buildStrategyDefinition` | `PROMOTE_SKETCH_INCOMPLETE` / `PROMOTE_SKETCH_INVALID` |
| 7 | `validateCanonicalStrategyDefinition` | `PROMOTE_DEFINITION_INVALID` |
| 8~12 | 写 Strategy / provenance / 回写 / 复核 | `PROMOTE_STRATEGY_ID_CONFLICT` / `PROMOTE_VERSION_CONFLICT` / `PROMOTE_WRITEBACK_FAILED` / `PROMOTE_STATE_INCONSISTENT` |

**幂等优先于状态门槛**：已是 `CONVERTED` 的候选走到第 2 步即返回既有结果，**不会**在第 3 步被 `CANDIDATE_NOT_ACCEPTED` 挡下（§18 要求第二次 promote 幂等成功）。

**状态门槛的负例覆盖**：`DRAFT` / `REVIEW` / `REJECTED` / `ARCHIVED` 四种状态各有一例单测，且断言「**零 Strategy 数据**」。

---

## 6. `definitionBuild.ts` —— 唯一转换器（§6 ~ §9）

位置：`server/research/strategyCandidate/definitionBuild.ts`（809 行）。
性质：**确定性、纯函数、可测试、无 DB 副作用**（单测 `确定性` / `输入不被修改` 两组共 5 例锁定）。

### 6.1 为什么需要「具名扩展槽」

`StrategyDefinition` 的必填面（`observationWindow` / `trigger` / `execution.quantityMethod` / `position.sizingMethod` / `riskRule.maxPositions` …）**在 Research 词表里没有对应字段**。若两者是「两套不可能同构的词表」，那么「不猜测」与「必填」会正面冲突。

**解法（零 migration）**：把 `Candidate.entryRule.extra` 定义为**唯一具名扩展槽**，键为**闭集**：

```ts
CANDIDATE_SKETCH_EXTENSION_KEYS = [
  "observationWindow", "trigger", "eventParams",
  "execution", "position", "risk", "document",
] as const;
```

- 出现此列之外的键 ⇒ `PROMOTE_SKETCH_INVALID`（**不静默忽略**）；
- `exitRule.extra` / `riskRule.extra` **非空即失败**（写了就是走错地方，不是静默丢弃）；
- 复用既有 `extra?: Record<string, unknown>` 列 ⇒ **零 migration**。

### 6.2 字段映射表（§9 要求「可单测的映射写入实施报告」）

| StrategyDefinition 字段 | 来源（候选草稿路径） | 映射规则 | 缺省 / 缺失行为 |
| --- | --- | --- | --- |
| `schemaVersion` | 常量 | `STRATEGY_DEFINITION_SCHEMA_VERSION` | — |
| `entry.event.type` | `entryRule.event` | 必须 ∈ `STRATEGY_EVENT_TYPES` | 缺失 ⇒ `INCOMPLETE` |
| `entry.event.params` | `entryRule.extra.eventParams` | 仅 string/number/boolean；**键字典序**输出 | 可空 ⇒ 省略 |
| `entry.observationWindow` | `entryRule.extra.observationWindow` | `{start,end,unit}`；`unit` 必须 ∈ `STRATEGY_WINDOW_UNITS`，**禁默认** | 缺失 ⇒ `INCOMPLETE` |
| `entry.conditions` | `filterRule` | 逐条件组展开；操作符经 `CONDITION_OPERATOR_MAP`（8 项） | 空 ⇒ `[]` |
| `entry.trigger.type` | `entryRule.extra.trigger` | 字符串简写或 `{type}`；必须 ∈ `STRATEGY_TRIGGER_TYPES` | 缺失 ⇒ `INCOMPLETE` |
| `exit.rules[]` | `exitRule.{stopLoss,takeProfit,holdingDays}` | **固定实现口径表** `EXIT_REALIZATION`（见下） | 全缺 ⇒ `[]` |
| `position.sizingMethod` | `entryRule.extra.position.sizingMethod` | 必须 ∈ `STRATEGY_POSITION_SIZING_METHODS` | 缺失 ⇒ `INCOMPLETE` |
| `position.maxPositions` | `riskRule.maxPositions` | **唯一权威**（`extra.position.maxPositions` 若同时出现 ⇒ 响亮拒绝） | 缺失 ⇒ `INCOMPLETE` |
| `position.maxSinglePosition` | `riskRule.maxPositionWeight` **或** `extra.position.maxSinglePosition` | **二选一**（同时声明 ⇒ 响亮拒绝） | 都缺 ⇒ 省略 |
| `position.{positionRatio,fixedAmount,maxExposure}` | `entryRule.extra.position.*` | 有限数字直传 | 可空 ⇒ 省略 |
| `risk.*` | `entryRule.extra.risk.*` | `stopLoss` / `maxDrawdown` / `maxExposure` / `maxSinglePosition` / `maxPositions` / `dailyLossLimit` / `concentrationLimit` + `extensions` | 无 `extra.risk` ⇒ `{}` |
| `execution.{signalTiming,executionTiming,priceType}` | `entryRule.timing` | **显式映射表** `ENTRY_TIMING_TO_EXECUTION` | 未知取值 ⇒ `INVALID` |
| `execution.{quantityMethod,lotSize}` | `entryRule.extra.execution.*` | `lotSize` 必须为正整数 | 缺失 ⇒ `INCOMPLETE` |
| `execution.{slippageModel,commissionModel,executionConstraints}` | `entryRule.extra.execution.*` | 枚举 / 非空字符串数组 | 可空 ⇒ 省略 |
| `parameters[]` | `parameterSpace` | 见 §6.4（`parameterRole` **恒 `TUNABLE`**） | 空 ⇒ `[]` |
| `datasets[0]` | **执行** Dataset（promote 注入） | `role: "PRIMARY"`，`datasetVersionId` = Registry 坐标 | 必填（promote 已校验） |

**`ENTRY_TIMING_TO_EXECUTION`（显式映射，不是推断）**

| Research `entryRule.timing` | `signalTiming` | `executionTiming` | `priceType` |
| --- | --- | --- | --- |
| `NEXT_OPEN` | `T_CLOSE` | `T_PLUS_1_OPEN` | `OPEN` |
| `NEXT_CLOSE` | `T_CLOSE` | `T_PLUS_1_CLOSE` | `CLOSE` |
| `SAME_CLOSE` | `T_CLOSE` | `T_CLOSE` | `CLOSE` |

**`EXIT_REALIZATION`（固定表，同一草稿必得同一 Definition）**

| 草稿字段 | `id` | `type` | `trigger` | `thresholdUnit` | `priority` |
| --- | --- | --- | --- | --- | --- |
| `exitRule.stopLoss` | `exit-stop-loss` | `STOP_LOSS` | `INTRADAY` | `RATIO` | 1 |
| `exitRule.takeProfit` | `exit-take-profit` | `TAKE_PROFIT` | `INTRADAY` | `RATIO` | 2 |
| `exitRule.holdingDays` | `exit-time-exit` | `TIME_EXIT` | `ON_CLOSE` | `TRADING_DAY` | 3 |

**`CONDITION_OPERATOR_MAP`（8 项）**：`>` `>=` `<` `<=` `==` `!=` `IN` `NOT_IN` → `GREATER_THAN` / `GREATER_THAN_OR_EQUAL` / `LESS_THAN` / `LESS_THAN_OR_EQUAL` / `EQUAL` / `NOT_EQUAL` / `IN` / `NOT_IN`。

### 6.3 「不允许猜测」的边界（§8 / §9）

**两类失败、语义分开**（单测 3-a~3-j 与 2-a~2-h 分别锁定）：

| 错误码 | 语义 | 调用方该做什么 |
| --- | --- | --- |
| `PROMOTE_SKETCH_INCOMPLETE` | 草稿**缺**必填内容（`undefined` / `null`） | 回去**补**草稿 |
| `PROMOTE_SKETCH_INVALID` | 草稿**写错**了（类型错 / 取值不在词表 / 结构不成立） | 回去**改**草稿 |

**前置响亮拒绝（比等到定义校验阶段报结构性错误更易定位）**：

- **字段引用语法**：`parseStrategyFieldReference(field)` 返回 `unknown` ⇒ 拒绝（「Promote 不会替你猜字段属于哪个时间域」）；
- **TUNABLE 范围**：`parameterRole` 恒 `TUNABLE`（待 Parameter Search）⇒ 数值参数**必须同时给 `min` 与 `max`**；非数值参数必须给**非空 `allowedValues`**；
- **词表不支持**：`BETWEEN` / `IS_NULL` / `IS_NOT_NULL` ⇒ 拒绝；
- **`riskRule.regimeGate`** ⇒ 拒绝（`RiskDefinition` 无对应条件组字段，**不静默丢弃**，提示改写成 `entry.conditions` 或 `extensions` 具名阈值）。

### 6.4 `parameterRole` 恒 `TUNABLE`

候选草稿的参数一律落 `TUNABLE`：**转正不是定参** —— 转正产出的是「待搜索空间的初始策略」，`parameterRole = FIXED/DERIVED` 的判定属 Parameter Search 阶段（006.4+）。因此范围声明是**必填**而非可缺省（§6.3）。

### 6.5 文档级执行假设（`buildExecutionAssumptions`）

`backtestConfig` / `costModel` **无法从 `definition` 派生**（`map.ts#alignDefinitionViews` 明确要求显式提供），因此同样只能来自草稿 —— 本函数把「读草稿」这一步也固定成纯函数，便于单测。

---

## 7. Build 之后必须执行既有 validate（§10）

`promote` 第 7 步调用**既有** `validateCanonicalStrategyDefinition`（`strategySchema` 侧，**不新写第二套校验**）。

- 失败 ⇒ `PROMOTE_DEFINITION_INVALID`，携带 `{ stage, issueCount }`；
- **不得产生任何 Strategy 数据**；
- **Candidate 保持 `ACCEPTED`**（不回写、不改状态）。

> 单测 `8) 构建出的 definition 未过既有校验 → PROMOTE_DEFINITION_INVALID，零 Strategy 数据，候选保持 ACCEPTED` 锁定。

构造与校验**分离**：`buildStrategyDefinition` 成功 ≠ 合法 —— 保证「构建器只做映射，不做判断」。

---

## 8. Dataset Binding（§11 ~ §16）

### 8.1 两个 Dataset 概念（§30）

| 概念 | 含义 | 落点 |
| --- | --- | --- |
| **研究来源 Dataset**（Research Dataset） | 这条结论是**基于哪份数据**研究出来的 | `candidate.sourceDatasetVersionId` → 原样进 `provenance.sourceDatasetVersionId` |
| **执行 Dataset**（Execution Dataset） | 这个 Strategy Version **将来用哪份数据**回测 / 执行 | `definition.datasets[0]`（`role=PRIMARY`）+ `strategy_version_datasets` |

**两者允许不同**，但必须显式说明原因（§12）。

### 8.2 三条绑定规则（§11 ~ §16）

| 情形 | `datasetBinding` | `datasetDivergenceReason` | 结果 |
| --- | --- | --- | --- |
| 缺省（继承） | 未提供 | 未提供 | 执行 = `candidate.sourceDatasetVersionId`；`divergence=false`；**原因必须 NULL** |
| 指定 **相同** | = 来源 | — | 同缺省；**填原因即拒绝**（`INVALID_INPUT`） |
| 指定 **不同** | ≠ 来源 | **必填** | `divergence=true`；原因落入 `candidate.sourceDatasetDivergenceReason` |
| 指定 **不同** | ≠ 来源 | 缺失 | `DATASET_DIVERGENCE_REASON_REQUIRED`（**零 Strategy 数据**） |

🔴 **一致时填原因是造假**（§14）：「研究在旧版本上验证机制、执行改用新版本」是事实；同版本却写一句 `N/A` / `same dataset` 是**占位文本**，一律 `INVALID_INPUT`（单测 13 含占位文本负例）。

🔴 **执行 Dataset 必须存在 ∧ READY**（§15），经 `DatasetVersionReadPort` 只读校验；**唯一坐标 `dataset_version.id`**（§16）—— 不使用 `datasetId + version` 组合、不使用 `label` 字符串比对、不新增第二套 ID。

> 单测 10~15 共 6 例覆盖全部四条路径 + 两种负例。

---

## 9. 事务边界与 11 步顺序（§17）

**§17 给出的 11 步顺序**，实际**事务边界按真实连接方式设计**：

```
① 载入候选 + 幂等闸门            （读，Research 库）
② 状态门槛 ACCEPTED              （内存判据）
③ 来源完整性                     （内存判据）
④ Dataset Registry 只读校验       （读，Registry 库）
⑤ buildStrategyDefinition        （纯函数）
⑥ validateCanonicalStrategyDefinition（纯函数）
⑦ buildExecutionAssumptions       （纯函数）
⑧ StrategyService.create + saveVersion ──┐
                                         ├─ 同一个 DB 事务（Strategy 侧）
   └ 内含 5 张投影写入 + Binding 校验 ────┘
⑨ provenance.create               （写，Research 侧；独立写）
⑩ 候选 update → CONVERTED + strategyDefinitionId（写，Research 侧）
⑪ 复核（§31）
```

**真实连接方式下的边界事实**：

- 步骤 ①~⑦ **零写入** ⇒ 任何失败都在「未产生任何数据」阶段响亮退出；
- 步骤 ⑧ 内部是 Strategy 侧**同事务**（`db.ts#saveVersion`：版本行 + 5 投影 + Binding 校验一起提交）⇒ 不存在「Strategy 保存成功但投影缺失」；
- 步骤 ⑧ → ⑨ → ⑩ 是**三次跨存储写**，**非原子** —— 这就是 §25 的跨存储失败场景，由幂等闸门 + 指纹幂等兜底（见 §11）。

**注释登记的残留窗口**：`strategyId` 冲突（`PROMOTE_STRATEGY_ID_CONFLICT`）与 `version` 冲突（`PROMOTE_VERSION_CONFLICT`）都是**显式错误码**，不做「自动重试 / 自动改号」——身份与版本号一旦确定就必须可复现。

---

## 10. 幂等（§18 ~ §19）

### 10.1 闸门

**幂等闸门 = `strategy_research_provenance.sourceCandidateId`**（`provenance.getBySourceCandidateId`，`UNIQUE(strategyVersionId)` + 该查询构成应用层唯一性）。

流程（第 2 步）：

1. `getBySourceCandidateId(candidateId)` 未命中 ⇒ 正常转正路径；
2. 命中 ⇒ 读取 `existing.strategyVersionId` → `strategyPromotionPort.findVersion(strategyId, version)`：
   - **找不到版本行** / `datasetVersionId` 为 NULL ⇒ `PROMOTE_STATE_INCONSISTENT`（**响亮失败，不假装幂等成功**）；
   - 找到 ⇒ 返回 `{ …, idempotent: true, fingerprint: inspected.fingerprint }`。

### 10.2 🔴 第二次 promote 绝对不能产生第二个 Strategy Version

由三层保证：

1. 闸门命中即**不再进入** ⑧~⑩ 的写入路径；
2. `strategyId` 由**确定性派生** `deriveStrategyId(candidateId) = "cand-${candidateId}"` ⇒ 同一候选永远同一个策略身份；
3. 版本号固定 `PROMOTE_INITIAL_STRATEGY_VERSION = "1.0.0"` ⇒ 同一候选永远同一版本号。

> **真实库证明**（验收脚本第 5 节）：第二次 promote 后 `strategy_versions` / `strategy_version_datasets` / `strategy_research_provenance` **均为 1 行（与第一次相同）** ⇒ **没有产生任何新行**。

### 10.3 🔴 幂等路径不静默忽略调用方输入（§53）

幂等返回**前**先做 overrides 相容性核对：

| 幂等时的 overrides | 行为 |
| --- | --- |
| 未提供 | 幂等返回 |
| 提供**同一** `datasetVersionId` | 幂等返回 |
| 提供**不同** `datasetVersionId` | `INVALID_INPUT`（「转正是不可逆写；要换 Dataset 请新建候选」） |
| 一致却填了 `datasetDivergenceReason` | `INVALID_INPUT` |
| 已 divergence、重复传**同一个**原因 | 幂等返回 |
| 已 divergence、传**新**原因 | `INVALID_INPUT`（历史事实不可改写） |

> 单测 21 / 21b / 21c 三例锁定；21 是**测试抓到的真缺陷**（原实现静默忽略 overrides）。

### 10.4 单测抓到的真 bug（两层指纹混用）

`strategyPromotionPort.findVersion` 初版用 `repo.getVersion().fingerprint`。那是 §17 的**追溯记录指纹**，摘要里含 `codeVersion` / `createdAt` 等**每次注入都可能不同**的元数据 ⇒ 会把「同一份内容、换了个时间戳」误判成 `PROMOTE_VERSION_CONFLICT`，**让整个幂等恢复路径失效**。

**修复**：改用 `repo.getVersionBundle().fingerprint`（= `strategy_versions.fingerprint`，**document 内容指纹**，也是 `saveVersion` 判定幂等/冲突所用的同一个）。这是**测试抓到的真 bug**，不是测试写错。

---

## 11. 跨存储失败与恢复（§25 ~ §26）

### 11.1 契约

| 要求 | 实现 |
| --- | --- |
| ① 返回 `PROMOTE_WRITEBACK_FAILED` | ✅ 三个写入点（版本写 / provenance 写 / 候选回写）任一失败都翻译成该码 |
| ② 携带 `strategyId` / `strategyVersionId` | ✅ `details = { strategyId, strategyVersionId, strategyVersion, stage, cause }`；Router 把它拼进 message |
| ③ 下次 promote 能通过 `sourceCandidateId` 找到已有结果 | ✅ 闸门在 `provenance` 表上 |
| ④ 禁止再次创建第二个 Strategy | ✅ §10.2 三层保证 |
| ⑤ 能恢复一致 | ✅ 重试时：provenance 在 ⇒ 走幂等；provenance 不在但 Strategy 在 ⇒ 版本写幂等自愈（内容指纹相同，返回既有行）+ 补写 provenance + 补回写候选 |
| 🔴 **禁止删除已创建的 Strategy 做「回滚」** | ✅ 代码中**没有任何** delete 调用；`writebackFailure()` 只抛错 |

### 11.2 `stage` 取值

`STRATEGY_WRITE` / `PROVENANCE_WRITE` / `CANDIDATE_WRITEBACK` —— 让「卡在哪一步」可判。

### 11.3 失败注入测试（§39：禁止只靠真实库偶然失败验证）

三条注入用例（端口注入，**不依赖真实库碰巧出错**）：

| 用例 | 注入点 | 断言 |
| --- | --- | --- |
| **22** | `provenance.create` 抛错 | 抛 `PROMOTE_WRITEBACK_FAILED`（带 `strategyId` / `strategyVersionId`）；**Strategy 仍在**；候选仍 `ACCEPTED`；重试后 `versionCount === 1` |
| **23** | `candidates.update` 在 `status==="CONVERTED"` 时抛错 | 抛 `PROMOTE_WRITEBACK_FAILED`；**Strategy + provenance 都在**；重试**只补回写** |
| **24 / 25** | 人为构造「候选 CONVERTED 但溯源消失」/「溯源在但状态不是 ACCEPTED/CONVERTED」 | `PROMOTE_STATE_INCONSISTENT`（**不假装幂等成功**） |

注入方式（示例）：

```ts
const flakyRepos: ResearchRepositories = {
  ...h.repos,
  candidates: {
    ...original,
    update: (async (...args) => {
      const patch = args[1] as { status?: string };
      if (failNextConvertedWrite && patch.status === "CONVERTED") {
        failNextConvertedWrite = false;
        throw new Error("注入故障：候选回写不可用");
      }
      return originalUpdate(...args);
    }) as typeof original.update,
  },
};
```

---

## 12. Provenance 字段与纪律（§20 ~ §22）

位置：`server/research/strategyCandidate/provenance.ts` / `provenanceContract.ts` / `types.ts`（006.1 已建，本 STEP **首次写入**）。

### 12.1 字段（≥11 项，实为 13 列）

| 字段 | 含义 |
| --- | --- |
| `id` | 主键 |
| `strategyVersionId` | **权威行锚** → `strategy_versions.id`（`UNIQUE`，一版本最多一条） |
| `strategyId` | 冗余便于直查（`cand-<n>`） |
| `strategyVersion` | semver 冗余快照（`1.0.0`） |
| `sourceCandidateId` | **幂等闸门** → `research_strategy_candidate.id`（快照值，非 FK） |
| `sourceConclusionId` | 来源结论 id（快照） |
| `sourceExperimentId` | 来源实验 id（快照） |
| `sourceResearchRunId` | 来源 Run id；**可空**（Conclusion 无 `runId` 列，部分证据提不出 ⇒ 如实承认） |
| `sourceDatasetVersionId` | **研究来源** Dataset 坐标（≠ 执行绑定） |
| `sourceDatasetLabel` | 来源 label（`v1` / `v2`），**仅显示** |
| `sourceSnapshotJson` | `sourceTraceJson` 副本（含免责声明摘要），display-only |
| `origin` | **恒 `DIRECT`**（本 STEP 只做 DIRECT） |
| `createdAt` | 仓储注入 |

### 12.2 三条纪律

1. **历史事实快照**：所有 `sourceXxx` 是**快照值、零 FK** —— 上游（Experiment / Conclusion / Candidate）被删后仍能回答「这个策略从哪来」。**无 `update` 能力**（可改即伪造历史）。
2. **display-only，不参与任何计算**：不进 `StrategyDefinition` / `StrategyDocument` / `fingerprint` / 5 投影 / `validate` / `backtest` / Parameter Search / 模拟 / 执行。**Research 模块整个不可用，Strategy Version 仍必须能独立运行**。
3. **`origin = DIRECT`**（§32 明确禁止本 STEP 实现 `INHERITED`）。

> 单测 16（锚与快照逐项）/ 17（候选终态两处一致）/ 18（上游被删后 provenance 仍可读）= 3 例。
> 单测 26（Strategy 独立性：Research 侧登记录被删后 Strategy 版本仍可读）= §41 要求。

---

## 13. `CONVERTED` 写入时机（§23 ~ §24）

**只有 Strategy + Version + Provenance 全部成功之后**才写 `CONVERTED`：

- 第 11 步：`candidates.update(candidateId, { status: "CONVERTED", strategyDefinitionId: strategyId })`；
- 写入失败 ⇒ 抛 `PROMOTE_WRITEBACK_FAILED`（**不是**静默成功）；
- 成功后第 12 步复核：`status === "CONVERTED"` ∧ `strategyDefinitionId === strategyId`，不满足 ⇒ `PROMOTE_STATE_INCONSISTENT`。

`assertCandidateConversionCoherence`（006.1 既有）保证 `CONVERTED` 必挂 `strategyDefinitionId`、非 `CONVERTED` 不得挂 —— 本 STEP 是它唯一的生产写入者。

---

## 14. 复用既有 StrategyService（§27 ~ §29）

**§27 要求：必须复用现有 `StrategyService`，不得直接 INSERT `strategy_versions`。**

实现方式：新增 `strategyPromotionPort.ts`（272 行），桥内**唯一**允许 import `strategyPersistence` / `strategySchema` 的生产文件。

```ts
export interface StrategyPromotionPort {
  ensureStrategy(input): Promise<...>;                 // 幂等：已存在则复用
  createStrategyVersion(input): Promise<...>;          // 内含 5 投影 + Binding 校验（同事务）
  findVersion(strategyId, version): Promise<ExistingStrategyVersion | undefined>;
  inspectPromotedVersion(strategyId, version): Promise<PromotedVersionInspection | undefined>;
  getVersionBundle?(...): Promise<...>;                // 供幂等复核
}
```

- 真实实现 `StrategyServicePromotionPort` 走既有 `StrategyService`；
- `CreatePromotedStrategyVersionInput` **刻意不含** `codeVersion` / `createdAt` / `status` —— 由端口构造注入，**调用方（`promote`）无权决定**；
- 端口捕获 `ResearchValidationError` 并翻译成 `PROMOTE_DEFINITION_INVALID`（带 `{ stage: "STRATEGY_WRITE", issueCount }`）；
- **§28 / §29**：桥**不**直接写 `strategy_versions`（`importBoundary.test.ts` 断言「生产源文件里不得出现 `strategyVersions` / `strategy_version_datasets` / `INSERT INTO strateg`，跳过 `.test.ts` 自身」）。

---

## 15. 成功路径复核（§31）

第 12 步逐项断言：

- `strategy` 存在 ∧ `strategy_versions` 行存在 ∧ `definition` 存在 ∧ Dataset Binding 存在 ∧ `provenance` 存在；
- **`provenance.sourceCandidateId === candidate.id`**。

任一不满足 ⇒ `PROMOTE_STATE_INCONSISTENT`（**绝不返回「看起来成功」的结果**）。

---

## 16. Router / API（§33 ~ §36）

### 16.1 新端点

```ts
research.strategyCandidate.promote   // mutation, adminProcedure（🔴 不开放 public）
```

输出（≥ 5 项）：

```ts
{
  candidateId, strategyId, strategyVersionId, strategyVersion, provenanceId,
  // 附：sourceDatasetVersionId / executionDatasetVersionId / datasetDivergence / origin / fingerprint / idempotent
}
```

**§35**：`adminProcedure` —— 转正是**产生策略本体**的动作，不属只读消费面。

### 16.2 领域错误 → tRPC code 映射（全部 11 个 promote 错误码）

| 领域错误码 | tRPC code |
| --- | --- |
| `CANDIDATE_NOT_ACCEPTED` / `PROMOTE_SOURCE_INCOMPLETE` / `PROMOTE_SKETCH_INCOMPLETE` / `PROMOTE_DEFINITION_INVALID` | `PRECONDITION_FAILED` |
| `PROMOTE_SKETCH_INVALID` / `DATASET_DIVERGENCE_REASON_REQUIRED` / `DATASET_BINDING_INVALID` | `BAD_REQUEST` |
| `PROMOTE_STRATEGY_ID_CONFLICT` / `PROMOTE_VERSION_CONFLICT` / `PROMOTE_STATE_INCONSISTENT` | `CONFLICT` |
| `PROMOTE_WRITEBACK_FAILED` | `INTERNAL_SERVER_ERROR`（message 含 `strategyId` / `strategyVersionId` / `stage`） |

装配：`createDefaultStrategyCandidateRouter({ codeVersion })` 在 `server/researchRouter.ts` 注入 `CODE_VERSION`（`strategyCandidateRouter` 常量保留）。

### 16.3 不做 Promote UI（§36）

本 STEP **不新增任何前端文件**。若「不做 UI」被违反，可从 `git status` 与 `client/**` 无改动方向验证。

---

## 17. 测试（§37 ~ §41）

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `definitionBuild.test.ts` | **35** | 正常映射 10（1-a~1-j）；缺失 8（2-a~2-h）；不可无损映射 10（3-a~3-j）；确定性 2；输入不被修改 3；`validateBuiltStrategyDefinition` 2 |
| `service.promote.test.ts` | **30** | A 前置条件 9；B Dataset 绑定 6（10~15）；C provenance 3（16~18）；D 幂等 4（19 / 20 / 21 / 21b / 21c）；E 跨存储失败 4（22~25）；F Strategy 独立性 2（26 / 27） |
| `router.test.ts` | **16** | 端点集合（006.2 的 4 + 006.3 的 promote，**恰好 5 个**）；promote 权限 / 入参 / 领域错误 / 端到端 + 幂等 4 例；防偷跑（不得出现 `clone` / `inherit` / `strategy` / `publish` 等其他入口） |
| `importBoundary.test.ts` | **10** | 006.1 六例 + 006.3 的四条：**允许清单式**跨界断言（`strategyPromotionPort.ts` 是唯一可 import `strategyPersistence` 的文件；`+ definitionBuild.ts` 可 import `strategySchema`）、清单成员确实存在、不得直接写 `strategy_versions`、Strategy 侧不得反向认识 `researchCore` / `strategyCandidate` |
| `service.test.ts`（006.2 既有） | 49 | 未改 |
| `provenance.test.ts`（006.1 既有） | 4 | 未改 |

**桥聚焦合计 = 144 例全过**（6 文件）。

**§37 覆盖对照**：definitionBuild 5 例 ✅（实际 35）；promote 15 例 ✅（实际 30）；幂等 ✅（19/20/21/21b/21c）；**跨存储失败注入** ✅（22/23，不靠真实库偶然失败）；provenance ✅（16~18）；Strategy 独立性 ✅（26/27）。

---

## 18. 真实 TiDB 验收（§42 ~ §45）

脚本：`scripts/verifyStrategyCandidatePromote.mts`（601 行，**自建自清**）
命令：`npx tsx scripts/verifyStrategyCandidatePromote.mts`
结果：**exit 0 · 41 项 / 0 失败 / PASS**（日志 `docs/evidence/_r0063_verify.log`）

| 组 | 证据 |
| --- | --- |
| **0. 只读选取执行 Dataset** | `dataset_version` 实查 `390002`（`first_limit_pullback @ v2`，**READY**）；同定义另一版本 `390001`（`v1`） |
| **1. 自建研究侧登记录** | `experimentId=330001` / `conclusionId=420001`，自带 `[VERIFY-0063]` 标记 |
| **2. 登记候选 → ACCEPTED** | `candidateId=180001`；`sourceDatasetVersionId=390002`（**复制自 Experiment**）；裸 SQL：`status=ACCEPTED` ∧ `strategyDefinitionId=null` |
| **3. 第一次 promote** | `strategyId=cand-180001` / `strategyVersionId=300001` / `1.0.0` / `provenanceId=90001`；`origin=DIRECT`；`idempotent=false`；缺省继承 ⇒ `divergence=false` ∧ 原因为 NULL |
| **4. 裸 SQL 独立复核（绕过应用层）** | `strategy_versions` 恰好 1 行且 id / 指纹与返回一致；canonical definition 可直接读出 `event=FIRST_LIMIT_UP` / `execTiming=T_PLUS_1_OPEN` / `exit0=STOP_LOSS`；doc 级 Dataset 坐标 = 执行绑定；`status=Draft`（C-21.1 genesis 白名单）；`universeId=research-dataset:v2`；`strategy_version_datasets` 1 条 PRIMARY；provenance 四锚齐全 ∧ `origin=DIRECT`；候选 `status=CONVERTED` ∧ `strategyDefinitionId=cand-180001`；无 divergence 时原因 **NULL** |
| **5. 行数证明** | 第一次：`strategies=1` / `strategy_versions=1` / `strategy_version_datasets=1` / `strategy_parameters=1` / `strategy_entry_rules=1` / `strategy_exit_rules=3` / `strategy_execution_rules=1` / `provenance=1`；**第二次 promote：全部不再增加**（`idempotent=true`，同 `strategyVersionId`、同 `provenanceId`） |
| **6. divergence 路径** | 显式指定不同 Dataset + 提供原因 ⇒ `divergence=true`；执行绑定改用指定版本；**来源坐标保持原样**（`provenance.sourceDatasetVersionId=390002`）；原因按人可读文本落列；候选 `CONVERTED`；`origin=DIRECT` |
| **7. 自建自清** | 精确按 id / strategyId 删除两套策略（含溯源与 5 类投影）+ 候选 + conclusion + experiment |
| **8. 行数守恒（前后逐表 15 张）** | `research_experiment 2→2` / `research_run 10→10` / `research_analysis 55→55` / `research_conclusion 9→9` / `research_strategy_candidate 0→0` / `strategies 0→0` / `strategy_versions 0→0` / `strategy_version_datasets 0→0` / `strategy_parameters 0→0` / `strategy_entry_rules 0→0` / `strategy_exit_rules 0→0` / `strategy_execution_rules 0→0` / `strategy_research_provenance 0→0` / `dataset_version 2→2` / `dataset_definition 1→1` ⇒ **全部守恒**；残留自建实验行 `leftovers=0` |

> ⚠️ **如实登记（并行会话影响）**：本轮验收时真实库 `research_run=10` / `research_analysis=55` / `research_conclusion=9`，高于 006.2 时点（9 / 26 / 8）—— 这是**另一条并行工作线（WORKSPACE 内 `_r007_*` 探针，另一会话的 RESEARCH-007 分析建设）**的写入，**不是本 STEP 的写入**。本 STEP 的写入严格限于「自建自清的两套策略 + 两个候选 + 一个实验/结论」。脚本为此**动态发现**当前真实坐标而非硬编码旧值。

---

## 19. §46 防偷跑全局搜索 / Boundary Test（§46 ~ §47）

### 19.1 全局搜索（确认唯一入口）

| 搜索目标 | 结果 |
| --- | --- |
| `createStrategyVersion(` 的生产调用点 | **仅** `strategyPromotionPort.ts`（桥端口）|
| `provenance.create(` 的生产调用点 | **仅** `service.ts`（promote 第 10 步）|
| `CONVERTED` 的**生产写入**点 | 仅桥 + `researchCore/candidates.ts`（状态机常量）|
| `promote` 的**生产定义**点 | 仅桥内 + `server/researchRouter.ts`（装配）|
| **不存在**第二处「Candidate → Strategy」完整业务链 | 已确认 |

### 19.2 Boundary Test（§47）

`importBoundary.test.ts` 的 006.3 段落改为**允许清单式**（比 006.2 的「一律禁止」更强的表达力）：

```
STRATEGY_PERSISTENCE_ALLOWLIST = ["strategyPromotionPort.ts"]
STRATEGY_SCHEMA_ALLOWLIST      = ["strategyPromotionPort.ts", "definitionBuild.ts"]

① 只允许清单内文件跨界 import
①-b 清单成员确实存在（防「清单写错文件名导致断言恒真」）
② 不得直接写 strategy_versions（跳过 .test.ts 自身）
③ Strategy 侧不得反向认识 researchCore / strategyCandidate
```

> 为什么 006.3 要**改写** 006.2 的断言：006.2 的「桥不得 import Strategy 领域」是**该 STEP 的阶段纪律**（promote 属 006.3），不是架构铁律。006.3 落地后必须放开这一条，同时把「放开到哪」写成**可枚举的清单**，避免「一句 `eslint-disable` 式全面放开」。

---

## 20. 未触碰 Dataset Registry（§48 ~ §49）

- **Dataset Registry 零改动**：本 STEP 未修改 `server/datasetRegistry/**` 任何文件；
- **禁止重新引入 `researchDataset` / `rd-*`**：本 STEP 无任何 `rd-*` 字面量参与绑定判定；`datasetVersion`（`v1`/`v2`）仅作 `label` 落 `definition.datasets[].datasetVersion`，坐标一律用 `datasetVersionId`；
- `universeId` 由 `deriveUniverseIdForDataset(label) = "research-dataset:<label>"` 派生，与 Dataset 侧口径一致（验收第 4 节实证 `research-dataset:v2`）。

---

## 21. 指纹机制（§50）

**复用既有机制，不新造**：

- `buildStrategyDefinition` **不产出指纹**（构造与指纹分离）；
- 指纹由 `StrategyService.saveVersion` 在写入时按 document 内容计算 ⇒ `strategy_versions.fingerprint`；
- 幂等/冲突判定使用**同一个** document 指纹（`getVersionBundle().fingerprint`）；
- **Provenance 永远不参与 fingerprint** —— `strategy_research_provenance` 的任何字段都不进入 document 摘要（否则「研究侧不可用 ⇒ Strategy 不可用」）。

---

## 22. 未实施（明确留给后续 STEP）

| 项 | 归属 |
| --- | --- |
| `cloneVersion` / `origin = INHERITED` | **§32 明确不做** |
| Promote UI（转正按钮 / 候选详情页 / provenance 展示） | 006.4 |
| Candidate 前端（登记 / 编辑 / 列表） | 006.4 |
| Backtest / Parameter Search / OOS / WFO / Robustness | 后续 STEP |
| `parameterRole` 由 `TUNABLE` 收敛为 `FIXED` | Parameter Search 阶段 |

---

## 23. Known Limitations / 发现的问题

1. **`PROMOTE_SKETCH_INCOMPLETE` vs `INVALID` 的语义分离是测试逼出来的** —— 初版把「缺失」报成「非法」，会让调用方以为草稿写错了（实际要做的是补齐）。已修正并写入两组单测。
2. **两层指纹混用是测试抓到的真 bug**（§10.4）—— 已在代码注释里明写「为什么必须用 document 指纹」。
3. **幂等路径曾静默忽略 overrides**（§10.3）—— 违反 §53，已重写为相容性核对。
4. **`regimeGate` 无法无损映射** —— `RiskDefinition` 无条件组字段。本 STEP 选择**响亮拒绝**（而非丢弃或塞进 `extensions` 冒充等价物）。若未来需要，应作为 `RiskDefinition` 的结构性扩展单独设计。
5. **跨存储仍非原子** —— 三次写（Strategy / provenance / 候选）无跨库事务。已按 §25 设计恢复路径，并由注入测试双路证明；但**理论上**存在「进程在 ⑧ 与 ⑨ 之间被杀死」的窗口 ⇒ 由「重试即幂等自愈」兜底（`strategyId` 确定性派生 + 版本号固定 + document 指纹幂等）。
6. **`sourceResearchRunId` 可为 NULL** —— 设计使然（Conclusion 无 `runId` 列，证据提不出即如实承认），非缺陷。
7. **`agent-browser` 在本机不可用** —— 本 STEP 无前端，不受影响。

---

## 附 A：文件清单

### 新增（4 源文件 + 2 测试 + 1 脚本）

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `server/research/strategyCandidate/definitionBuild.ts` | 809 | **唯一** Candidate → StrategyDefinition 转换器（纯函数） |
| `server/research/strategyCandidate/strategyPromotionPort.ts` | 272 | 桥内唯一跨界端口（复用 `StrategyService`） |
| `server/research/strategyCandidate/definitionBuild.test.ts` | 642 | **35 例** |
| `server/research/strategyCandidate/service.promote.test.ts` | 783 | **30 例** |
| `scripts/verifyStrategyCandidatePromote.mts` | 601 | 真实 TiDB 验收（41 项） |

### 修改（6 个）

| 文件 | 改动 |
| --- | --- |
| `server/research/strategyCandidate/service.ts` | 450 → **995** 行：新增 `promote()` 12 步 + 幂等 + 跨存储恢复；删除 `StrategyCandidateServiceDeps.now` |
| `server/research/strategyCandidate/candidateTypes.ts` | 214 → **310** 行：新增 11 个 promote 错误码 + `PROMOTE_OVERRIDE_KEYS` / `PROMOTE_DATASET_BINDING_KEYS` + 闭集校验 |
| `server/research/strategyCandidate/router.ts` | 199 → **307** 行：新增 `promote` 端点 + 11 个错误码映射 + `createDefaultStrategyCandidateRouter` |
| `server/research/strategyCandidate/router.test.ts` | 269 → **449** 行：16 例（端点集合 4 → 5 + promote 段落） |
| `server/research/strategyCandidate/importBoundary.test.ts` | 追加 006.3 允许清单式断言（10 例） |
| `server/research/strategyCandidate/index.ts` | barrel 加 `export * from "./definitionBuild";` |
| `server/researchRouter.ts` | 装配 `createDefaultStrategyCandidateRouter({ codeVersion: CODE_VERSION })` |

### 证据文件

`docs/evidence/_r0063_verify.log`（真实库 41 项）· `docs/evidence/_r0063_bridge_tests.log`（桥聚焦 6 文件 / 144 例）· `docs/evidence/_r0063_fulltest.log`（全量）· `docs/evidence/_r0063_tsc.log`（tsc exit 0）。

---

## 附 B：验收汇总

| 项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **exit 0** |
| 桥聚焦 `server/research/strategyCandidate` | **6 文件 / 144 例全过** |
| 真实 TiDB `verifyStrategyCandidatePromote.mts` | **exit 0 · 41 ✓ / 0 ✗** |
| 行数守恒 | **15/15 张表前后一致**；残留自建行 **0** |
| 幂等行数证明 | 第二次 promote **零新增行** |
| `npx vitest run`（全量） | **224 文件 / 3624 例；15 失败 / 7 文件 —— 与既有基线逐项一致 ⇒ 零新增失败** |
| §46 防偷跑 | `createStrategyVersion` / `provenance.create` / `CONVERTED` / `promote` 生产源全部收敛在桥内 |
| Dataset Registry | **零改动**；无 `rd-*` 参与绑定判定 |
| 前端 | **零改动**（§36 不做 Promote UI） |
