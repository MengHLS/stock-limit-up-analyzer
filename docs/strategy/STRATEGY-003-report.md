# STRATEGY-003 实施报告 — Strategy Domain Model & Persistence Architecture

> 任务：把 Strategy 从「基础 CRUD + Versioning」升级为完整、稳定、可被 Research / Parameter Search /
> Backtest 消费的 **Strategy Domain Model**。
> 状态：**COMPLETE**（§29 的 14 项验收判据全部 PASS；详见 §16）。
> 日期：2026-09-12 GMT+8。
> 前置：`docs/strategy/STRATEGY-003-difference-report.md`（STEP 1–5 只读审计 + 差异矩阵 + F1–F10 发现 + D1–D3 提案）。

---

## 1. 任务定位与用户裁定（D1 / D2 / D3）

| 编号 | 裁定 | 落地方式 |
|---|---|---|
| **D1** | 在既有 `strategyDocumentJson` 内**演进**富模型，**不得**新建独立 `strategy_definitions` / `strategyDefinition` 表作为第二套 Source of Truth | 新增 `StrategyDefinition` 子树挂在 `strategyDocumentJson` 内；未新建定义表 |
| **D2** | **不修改**物理列名（`strategyDocumentJson` / `fingerprint`）；Domain 层用 `definition` / `definitionHash` 语义映射 | 物理列名零改动；Domain 层类型名 `StrategyDefinition` + 函数 `computeStrategyDefinitionFingerprint`；映射登记在 §5.4 |
| **D3** | 复用 C-21.1 八态（Draft→…→Retired），不得新造 `DRAFT/RESEARCHING/ACTIVE/ARCHIVED` | `strategy_versions.status` 默认 `'Draft'`，写入/迁移前一律经 `isStrategyLifecycleStatus()` 校验；**无任何新枚举** |

---

## 2. 交付概览

一句话：**Canonical Definition（唯一 SoT） + 不可变版本 + 两层指纹 + 5 张单向派生投影 + Look-Ahead 静态校验 + 可 clone 的版本体系**，全部在真实 TiDB 上端到端跑通。

| 维度 | 结果 |
|---|---|
| Migration | `drizzle/0034_strategy_domain_model.sql`，15 条语句；apply 脚本幂等（15 executed → 0 executed / 15 skipped），7 表实查存在 |
| Domain Model | `StrategyDefinition{entry, exit, position, risk, execution, parameters, datasets}` + 全程 `readonly` + `deepFreeze` |
| 投影 | 5 张表，`Definition → Projection` **单向**；两级独立验证（Repository 读回 + 裸 SQL 读回）均零漂移 |
| 指纹 | 两层：文档级（落 `fingerprint` 列）与定义级（`computeStrategyDefinitionFingerprint`） |
| 校验 | 复用 `ResearchValidationResult` / `ResearchValidationIssue`；Look-Ahead 8 条规则（L1–L8） |
| clone | `cloneVersion(strategyId, fromVersion, options)`：可从**任意历史版本** clone；幂等三态 |
| 测试 | 新增 **132 例**（79 + 53）；策略相关 **202 例全过**；全量回归见 §14 |
| 真实 TiDB | `scripts/verifyStrategyDomainModel.mts` **89 项检查 / 0 失败 / exit 0**，零残留 |
| 未越级 | 未做 Strategy UI / Research 页面 / Parameter Search / Backtest / Evaluation / Robustness / OOS / Walk-Forward / Simulation；未改 Dataset Registry；未删旧数据 |

---

## 3. Database（STEP 6）

### 3.1 Migration 文件

`drizzle/0034_strategy_domain_model.sql`（196 行，15 条语句），采用 **`-- @guard:` 守卫式幂等 DDL**：
每条语句前置 `-- @guard: <column|index|table> <target>`，apply 脚本先查 `information_schema` 再决定是否执行
（MySQL/TiDB 对 `ADD COLUMN IF NOT EXISTS` 支持不一致，因此不依赖方言特性）。
**未使用** `npm run db:push` 与 `drizzle-kit generate`（`journal`/`snapshot` 自 0024 起停维护，重放会损坏 schema 历史）。

| 目标 | 内容 |
|---|---|
| `strategies` +3 列 | `description` varchar(512) NULL、`strategyType` varchar(32) NULL、`currentVersionId` int NULL（**权威当前版本指针**）+ `idx_strategies_current_version` |
| `strategy_versions` +4 列 | `parentVersionId` int NULL（版本演进链软引用）、`status` varchar(32) NOT NULL DEFAULT 'Draft'、`description` varchar(512) NULL、`updatedAt` timestamp ON UPDATE CURRENT_TIMESTAMP + `idx_strategy_versions_parent` / `idx_strategy_versions_status` |
| 新表 1/5 | `strategy_parameters`，`UNIQUE(strategyVersionId, code)` |
| 新表 2/5 | `strategy_entry_rules`，`UNIQUE(strategyVersionId, ruleId)`；event/window/trigger 冗余到每行 |
| 新表 3/5 | `strategy_exit_rules`，`UNIQUE(strategyVersionId, ruleId)` |
| 新表 4/5 | `strategy_execution_rules`，`UNIQUE(strategyVersionId)`（1:1） |
| 新表 5/5 | `strategy_version_datasets`，`UNIQUE(strategyVersionId, datasetId, datasetVersion, role)` |

命名风格与现有 Drizzle schema 一致（`strategyId`/`strategyVersion` 冗余列便于直查；`id` int AUTO_INCREMENT 主键；`createdAt` timestamp）。

### 3.2 幂等与实查证据

`scripts/applyStrategyDomainModel.mjs` 三模式（`apply` / `--dry-run` / `--check`），从 SQL 解析 guard 指令后断言。

```
首次 apply：executed 15 / skipped 0 / pass true
复跑   apply：executed 0  / skipped 15 / pass true   ← 幂等已验证
7 表 rowCounts：strategies 0, strategy_versions 0, strategy_parameters 0,
                strategy_entry_rules 0, strategy_exit_rules 0,
                strategy_execution_rules 0, strategy_version_datasets 0
```

`strategies` / `strategy_versions` 迁移前即为 0 行 ⇒ **无回填、无兼容转换、无 truncate**，SPEC §38（向后兼容）自动满足。

### 3.3 `drizzle/schema.ts` 同步

继续作为**唯一权威 schema 声明**：`strategies` 增 3 列 + 索引；`strategyVersions` 增 4 列 + 2 索引；新增 5 张表导出 + `$inferSelect` 类型。文件头写明 Source of Truth 铁律。

---

## 4. Domain Model（STEP 7）

`server/research/strategySchema/definition.ts`（635 行，**类型权威源**）：

```
StrategyDefinition
├── schemaVersion: "1.0"
├── entry: EntryDefinition
│   ├── event: { type: FIRST_LIMIT_UP | LIMIT_UP | … | CUSTOM_EVENT, description? }
│   ├── observationWindow: { start ≥ 1, end ≥ start, unit: TRADING_DAY | CALENDAR_DAY }
│   ├── trigger: { type: FIRST_VALID_DAY | LAST_VALID_DAY | EVERY_VALID_DAY | NEXT_TRADING_DAY }
│   └── conditions: ConditionDefinition[]   // { id?, field, operator, value, valueType, enabled, description? }
├── exit: ExitDefinition { rules: ExitRuleDefinition[] }   // 每条：type/trigger/threshold|parameter/thresholdUnit/priority/enabled/condition?
├── position: PositionDefinition   // sizingMethod(FIXED_RATIO|FIXED_AMOUNT|EQUAL_WEIGHT|VOLATILITY_TARGET) + parameter|positionRatio|fixedAmount + maxPositions + maxExposure + maxSinglePosition
├── risk: RiskDefinition           // maxPositions / maxExposure / maxSinglePosition / stopLoss
├── execution: ExecutionDefinition // 🔴 signalTiming 与 executionTiming **分离**；priceType / quantityMethod / lotSize / slippageModel / commissionModel / executionConstraints
├── parameters: ParameterDefinition[]  // code / name / dataType / parameterRole(FIXED|TUNABLE|DERIVED) / defaultValue / min / max / step / unit / required / derivedFrom
└── datasets: StrategyDatasetBinding[] // datasetId / datasetVersion(rd-…) / role(PRIMARY|VALIDATION|OOS) / note
```

关键设计：

- **`signalTiming` vs `executionTiming` 强制分离**（SPEC §15）：`T_CLOSE` 出信号 → `T_PLUS_1_OPEN` 成交，是本项目 T+1 模型的语义底座。
- **`parameterRole`** 三值（FIXED / TUNABLE / DERIVED）为后续 Parameter Search 预留：TUNABLE **必须**带搜索边界（min&max 或 step），否则校验失败（见 §9 与 §12 的测试）。
- **规范化是确定性的**：parameters 按 `code` 升序、datasets 按 (role, datasetId, datasetVersion) 升序、exit.rules 按 (priority, id) 升序、**entry.conditions 保持声明顺序**（求值顺序即语义）；缺省 id 由下标派生（`cond-<n>` / `exit-<n>`）保证同输入必得同 id。
- 校验后 `deepFreeze`，全程 `readonly`。

### 4.1 旧消费者不被破坏（Adapter / 派生视图）

**没有**一次性砍掉 `StrategyDocument` / `DeclaredRule[]` / `executionAssumptions` / `executionModel` / `backtestConfig` / `costModel`。

`server/research/strategySchema/legacyViews.ts`（256 行，**叶子模块**，只依赖 `definition.ts` 与 type-only `types.ts`）：

```
Canonical Definition ──deriveLegacyViews()──► entryRules / exitRules / riskRules /
                                              positionSizing / parameters / executionModel / datasetVersion
```

- 被 `map.ts`（组装时**缺则补、显式提供且不一致则报 `SCHEMA_DEFINITION_VIEW_CONFLICT`**）与 `validate.ts`（反序列化后复核，漂移报 `SCHEMA_DEFINITION_VIEW_DRIFT`）共用；
- 抽成叶子模块是为了避免 `map → validate → map` 的运行时循环依赖；
- **有损派生逐项登记**：`T_PLUS_2_OPEN → NEXT_OPEN`（⚠ 有损）、`T_CLOSE → LIMIT_PRICE`（⚠ 有损）；
- 新增入口 `createStrategyDocumentFromDefinition()`（推荐）与既有 `createStrategyDocument()` 并存；`cloneStrategyDocumentToVersion()` 在源文档**有** definition 时**不传** v1 视图（由派生层重新生成），**无** definition 时透传 v1 字段（不伪造富定义）。

---

## 5. Source of Truth 架构

### 5.1 唯一权威

```
strategy_versions.strategyDocumentJson  ──►  唯一完整 StrategyDefinition（Canonical）
                                            │
                        buildStrategyProjections()  （单向派生，纯函数）
                                            ▼
    strategy_parameters / strategy_entry_rules / strategy_exit_rules /
    strategy_execution_rules / strategy_version_datasets      （查询投影）
```

**铁律**：投影**永远**由 `StrategyDefinition` 生成；**禁止** `DB Projection → Canonical`；需要权威语义时必须回到 canonical JSON。投影只用于「按参数 / 规则 / 角色 / 事件查询」，**不得拼成第二套 Definition**。

### 5.2 一致性「闸门」位于读取路径

- 写入：`saveVersion` 在**同一事务**内写 canonical + §17 追溯记录 + 5 类投影（§7）。
- 读取：`getVersion` / `getLatestVersion` / `getVersionBundle` **全部**经 `assertStoredVersionConsistency()`；不一致即抛错，**不静默修复、不择一覆盖**。
- 审计：`checkStoredVersionConsistency(row): string[]` 返回漂移明细（解析失败也作为漂移条目上报，便于一次性列全）。

### 5.3 F1「双份定义」的最终处置

`versionRecordJson.strategy` 是 `strategyDocumentJson` 的完整内嵌副本（§17 追溯契约，**本任务不删除**）。处置方式：**降级为「可检测的冗余」**，每次读取/审计断言三处一致：

1. `versionRecordJson.strategy.fingerprint == 列 fingerprint`
2. `strategyDocumentJson` 重算指纹 `== 列 fingerprint`
3. `versionRecordJson.strategy.definition` 与 `strategyDocumentJson.definition` **canonical 串逐字段相等**

任一不满足 → **FAIL**（`assertStoredVersionConsistency` 抛错，`verifyStrategyDomainModel.mts` 计入 failures 并 `exit 1`）。

### 5.4 D2 语义映射表（物理列名零改动）

| 物理列 / 表 | Domain 层语义名 | 说明 |
|---|---|---|
| `strategy_versions.strategyDocumentJson` | `definition`（子树） | 同一个 JSON 列，新增 `definition` 键承载富模型 |
| `strategy_versions.fingerprint` | `definitionHash`（语义） | 实际是**文档级**指纹；定义级指纹由 `computeStrategyDefinitionFingerprint()` 独立计算，不落列 |
| `strategy_versions.currentVersionId` 的对应（在 `strategies`） | 权威当前版本指针 | `latestVersion` 降级为兼容性冗余列，二者由 `refreshEntityPointer()` 保持不漂移 |

---

## 6. Fingerprint（STEP 9）

`server/research/strategySchema/serialize.ts`：

```ts
computeStrategyDocumentFingerprint(document)      // 文档级：剔除 fingerprint 后的全字段 canonical JSON → sha256
computeStrategyDefinitionFingerprint(definition)  // 定义级：只覆盖 definition 子树 → sha256
serializeStrategyDefinition(definition)           // canonical JSON（同内容必同串）
```

- 底层复用既有 `canonicalStringify`（键字典序）⇒ **不依赖对象键插入顺序**；
- **包含 dataset binding**：`datasets` 是 `definition` 子树的一部分，任一绑定变化 ⇒ 定义级指纹变化（测试逐项覆盖）；
- 反序列化时**重算并比对**，篡改响亮抛 `STRATEGY_FINGERPRINT_MISMATCH`；
- 两层指纹的分工：文档级 = `strategy_versions.fingerprint` 的实际取值（version / description 参与 ⇒ 新版本必新指纹）；定义级 = 判「两份定义是否同一套规则」（clone 后定义级指纹**不变**，验证见 §10）。

---

## 7. Persistence（STEP 8）

`server/research/strategyPersistence/`：

| 文件 | 变更 |
|---|---|
| `contract.ts` | `StrategySummary` +`description`/`strategyType`/`currentVersionId`；`StrategyVersionSummary` +`status`/`parentVersionId`/`description`；新增 `StrategyVersionBundle`（canonical + §17 记录 + 5 投影 + `hasDefinition` + `versionRowId` + status/parent/description/时间戳）；`SaveVersionResult` +`versionRowId`/`projectionRowCount`；Repository 接口 +`getVersionRowId`/`getVersionBundle`/`updateVersionStatus` |
| `db.ts` | `saveVersion` 改为 `db.transaction(async (tx) => …)`，canonical + 追溯 + 5 投影**同一事务**，任一步失败整体回滚（杜绝「Canonical 已写、投影没写」的中间态）；`writeProjections(tx, …)`；`loadProjections`（5 查询并发 + ordinal/priority 排序）；`deleteStrategy` 事务内先删 5 投影 → 版本 → 实体；`getVersion`/`getLatestVersion`/`getVersionBundle` 走一致性断言 |
| `inMemory.ts` | 与 DB 实现**镜像**的契约行为（同样由 canonical 派生投影），供单元测试验证逻辑 |
| `service.ts` | 新增 `cloneVersion` / `loadBundle` / `validateVersion` / `setVersionStatus`；`refreshEntityPointer` 维持 `latestVersion` 与 `currentVersionId` 不漂移；`persistDocument` 支持 parentVersionId / description |
| `consistency.ts` | **新建**：F1 三方指纹 + 双份定义一致性（§5.3） |
| `index.ts` | 导出 `consistency` |

**投影方向**：`strategyPersistence` 层只做「领域对象 → 投影行」的映射与落库，派生逻辑在 `strategySchema/projection.ts`（纯函数、不碰 DB）。5 张投影行字段与 `drizzle/schema.ts` 逐列对应。

**版本的不可变性**：内容禁 UPDATE；唯一允许 UPDATE 的列是 `status`（+ `updatedAt` 随状态迁移刷新）。`setVersionStatus` 在写入前校验 C-21.1 八态。

---

## 8. Projection（派生与漂移检测）

`server/research/strategySchema/projection.ts`（314 行）：

- `buildStrategyProjections(definition)`：确定性纯函数。parameters 带 `ordinal`；entryRules **每条 condition 一行**（`priority` = 求值顺序）、**无 condition 时仍写一行**（`ruleId="entry"` / `ruleType="EVENT_OBSERVATION"`）以承载 event/window/trigger —— 否则「研究什么事件、观察多久、何时触发」会在无条件下凭空丢失；exitRules 带 `ordinal`；executionRule 1:1；datasetBindings 只落引用。
- `verifyStrategyProjections(expected, actual): string[]`：逐行逐字段 diff（按稳定键 `code` / `ruleId` / `(datasetId,datasetVersion,role)`），**同时检出「缺失」与「多余」**；返回空数组 = 一致。调用方（审计脚本 / 测试）在漂移非空时必须**响亮失败**，不得自动修复。

---

## 9. Validation 与 Look-Ahead（STEP 10）

`server/research/strategySchema/definitionValidation.ts`（793 行）：

- **复用**既有 `ResearchValidationResult` / `ResearchValidationIssue` / `ResearchValidationError`（**不新建第二套框架**）；`validateCanonicalStrategyDefinition()` 返回结果、`assertValidCanonicalStrategyDefinition()` 失败即抛。
- 参数数值自洽性（defaultValue 越界 / min>max / step）**委托**既有 `validateParameterSchema`，本层只补 Strategy 特有规则；**委托错误码保持原样**（如 `VALUE_ABOVE_MAX`），仅把路径从 `parameterSchema.*` 重映射为 `parameters.*`。
- ⚠️ **`issue.path` 以 `StrategyDefinition` 根为基准**（如 `exit.rules[0].thresholdUnit`），**不含** `definition.` 前缀；嵌入 `StrategyDocument` 时由调用方（`map.ts` / `validate.ts` / `service.ts`）rebase —— 避免同一路径被前缀两次（`definition.definition.exit.…`）。

### 9.1 Look-Ahead 静态校验（本任务重点）

判定依据是**字段时间域目录**（`definition.ts` 的 `parseStrategyFieldReference` / `resolveFieldTimeDomain`），**白名单而非黑名单** —— 后者可被命名绕过。

| 规则 | 错误码 | 语义 |
|---|---|---|
| L1 | `UNKNOWN_FIELD_TIME_DOMAIN` | 引用无法判定时间域（根不合法 / 形态不匹配）→ **默认拒绝** |
| L2 | `UNKNOWN_FIELD_REFERENCE` | 时间域可判定但字段不在该层白名单内（防拼写漂移） |
| L3 | `INVALID_FUTURE_REFERENCE` | 引用 `path.*` / `outcome.*`（Dataset 明示「前视，仅打标签」）→ 拒绝 |
| L4 | `INVALID_FUTURE_REFERENCE` | 引用 `post.rd{n}` 且 `n > resolveSignalTimeline().maxReferencableOffset` → 拒绝 |
| L5 | `SIGNAL_TIMELINE_UNRESOLVABLE` | 窗口单位非 `TRADING_DAY` ⇒ 无法映射到 Dataset 的交易日坐标系 ⇒ 任何 `post.rd{n}` 一律拒绝（宁严不宽） |
| L6 | `SIGNAL_EXECUTION_TIMING_CONFLICT` | 成交不得早于信号（`signalTiming=T_CLOSE` 时禁止同 bar 收盘成交） |
| L7 | `TRIGGER_EXECUTION_INCONSISTENT` | `trigger=NEXT_TRADING_DAY`（信号已顺延）时 `executionTiming` 必须 `T_PLUS_1_*` 或更晚 |
| L8 | `PRICE_TYPE_TIMING_MISMATCH` | `priceType` 必须与 `executionTiming` 的开关盘语义一致（`VWAP` 作代理价例外放行） |

**信号时间线**：`resolveSignalTimeline(trigger, window)` → `earliestSignalOffset`（FIRST/EVERY = windowStart、LAST = windowEnd、NEXT_TRADING_DAY = windowStart+1），其值即 `post.rd{n}` 的 n 上界。

**Dataset 真实五层语义**（`server/datasetRegistry/naming.ts`）被严格遵守：`event`（时点身份，**不含 OHLCV**）、`prefix`（rd∈[-pre,0]，后视 PIT 安全）、`post`（rd∈[1,post]，前视）、`path`（衍生指标，前视仅打标签）、`outcome`（按 horizon 聚合）。
⇒ 首板日开盘价是 **`prefix.rd0.open`**，**不是** `event.open`。时间语义不明 → `UNKNOWN` → 默认不允许作为 Signal 条件引用（SPEC §26）。

**⚠️ 诚实边界**：以上都是**声明层静态**检查，只能证明「Definition 声明的引用不越界」，**不能**证明运行时执行器没有旁路读取未来数据。该边界在此显式声明，不冒充已解决。

---

## 10. Clone（STEP 11）

`StrategyService.cloneVersion({ strategyId, fromVersion, targetVersion?, bump?, description?, status? })`：

- **源版本可以是任意历史版本**（不限于 latest）；`parentVersionId` 指向**源版本行**（`strategy_versions.id`），而非 latest；
- 目标版本号缺省 = 源版本按 `bump`（缺省 major）递增；
- **复制内容** = 完整 Canonical Definition（parameters / entry / exit / execution / dataset 绑定）+ universe / datasetVersion / executionAssumptions / recipe / metadata；随后**重算指纹**（version / description 参与 ⇒ 文档级指纹必变；**定义级指纹不变**，证明复制的是同一套规则）；
- **幂等三态**：目标版本不存在 → `inserted`；存在且内容一致 → `idempotent-skip`；存在但内容不同 → `conflict`（**绝不覆盖既有版本**，返回 `existingFingerprint`）。并发兜底走 `ER_DUP_ENTRY(1062)` 后的 `raced` 查询。

---

## 11. Golden Sample：首板回踩（SPEC §25）

`server/research/strategySchema/goldenSample.ts`（228 行）——**测试/验证用 fixture**，不注册进任何 registry、不进 `index.ts` 导出。

| 要素 | 取值 |
|---|---|
| Event | `FIRST_LIMIT_UP` |
| Observation | T+1 ~ T+5（TRADING_DAY） |
| Condition | `bar.low >= prefix.rd0.open`（回踩不破首板开盘价）、`bar.volume < prefix.rd0.volume`（缩量） |
| Trigger | `FIRST_VALID_DAY`（首个满足条件的交易日） |
| Signal | T 收盘（`signalTiming = T_CLOSE`） |
| Execution | T+1 开盘（`executionTiming = T_PLUS_1_OPEN`、`priceType = OPEN`） |
| Exit | `TIME_EXIT(holdingDays)` + `STOP_LOSS(stopLoss)` + `TAKE_PROFIT(takeProfit)`，按 priority 1/2/3 |
| Position | `FIXED_RATIO` + `parameter: positionRatio`，`maxPositions=5` |
| Risk | `maxPositions=5` / `maxExposure=0.8` / `maxSinglePosition=0.3` / `stopLoss=0.08` |
| Parameters | 5 个 TUNABLE（`holdingDays` / `stopLoss` / `takeProfit` / `positionRatio` / `pullbackWindow`）+ 1 个 FIXED（`limitUpThreshold`） |
| Dataset | `ds_first_limit_pullback` @ `rd-1.0.0-1-cffc2a0e66efbf0b`，role `PRIMARY` |

该样本被用作：领域测试的基线定义、`verifyStrategyDomainModel.mts` 真实库全链的输入、以及「新 Domain Model 真能表达首板回踩」的存在性证明。

---

## 12. 测试（STEP 12）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `strategyDefinition.test.ts`（新建，949 行） | **79** | A Golden Sample 存在性；B 序列化/反序列化（含篡改拒绝、无 definition 兼容）；C 指纹（同内容同串 / 规范化同串 / 8 项突变必变 / 两层指纹区分）；D 结构校验（约 26 项 it.each + 委托错误码与路径重映射 + 根相对路径不变量）；E **Look-Ahead 15 例**（含正例控制：合法引用必须零误报）；F 视图一致性闸门；G `cloneStrategyDocumentToVersion`；H 引用解析 / 信号时间线 / 派生视图 |
| `strategyDomainPersistence.test.ts`（新建，768 行） | **53** | A 5 类投影派生 + **行形状契约**（列增删必须同步 migration）；B 漂移检测（字段漂移 / 缺失 / 多余 / 顺序 / 时序 / binding）；C **F1 三方指纹 + 双份定义漂移**；D Service 编排（create/save/read/list/bundle/validateVersion + v1 老文档 + `definition.` 路径语义）；E clone（任意源版本 / parentVersionId / 指纹重算 / **幂等三态** / 冲突不覆盖 / 状态）；F 版本不可变 + 状态迁移 |
| `strategyPersistence.test.ts`（既有） | 12 | STRATEGY-002 契约逻辑，零改动通过 |
| `strategySchema.test.ts`（既有） | 28 | C-15.1 声明式定义，零改动通过 |
| `lifecycle.test.ts`（既有） | 30 | C-21.1 八态，零改动通过 |

**Source of Truth 专项**：canonical → projection 的「逐版本比对」在 §13 的真实库脚本里两级执行（Repository 读回 + 裸 SQL 读回）；`validateVersion()` 把三类结果合并为单一 `valid`（文档校验 ∧ 定义校验 ∧ 零投影漂移）。

---

## 13. 真实 TiDB 验证（STEP 13）

`scripts/verifyStrategyDomainModel.mts`（477 行）：Migration → Create → Version → Save → Read → Validate → Clone → Verify Hash → Verify Projection → information_schema → 清理。

**实测输出（`_s003_verify.log`）**：

```
总检查项 89，失败 0；VERDICT=PASS      SCRIPT_EXIT=0
```

| 阶段 | 代表性命中 |
|---|---|
| ① Migration | 7 表存在；**期望集由 0034 SQL 的 `-- @guard:` 指令解析而来**（不手抄 ⇒ 不会与 migration 漂移）；15 条 guard 目标全部存在 |
| ② Create/Save/Read | Save 幂等（两次重复不产生重复版本）；`currentVersionId` 指向版本行；`latestVersion` 与之一致；读回 Canonical Definition 逐字段一致；F1 双份一致 |
| ③ Validate | `valid = true`（含 Look-Ahead）、零投影漂移 |
| ④ Clone | 首次 `inserted`；重复 `idempotent-skip`（不返回新 versionRowId）；同目标版本不同内容 `conflict` + 返回既有指纹 + **既有版本未被覆盖**；`parentVersionId` 指向源版本行；定义级指纹不变、文档级指纹已重算 |
| ⑤ Verify Hash | 裸 SQL 读原始列，2 行版本**三方指纹 + 双份定义**全部一致 |
| ⑥ Verify Projection | **两级证据**：Repository 读回零漂移 **+ 裸 SQL 独立读回零漂移**；逐类行数与 canonical 一致；`strategy_execution_rules` 每版本恰好 1 行；**漂移检测器自证**（人为篡改投影后必须报出漂移，证明检测非空转） |
| ⑦ 状态迁移 | Draft → Research 生效；**内容指纹不变**（status 是唯一可变列）；迁移后仍通过全量校验 |
| ⑧ 清理 | `deleteStrategy` 级联删除；**7 张表行数全部回到基线 0**，零残留（独立复核确认） |

**副作用控制**：以唯一 `strategyId = s003-verify-<ts>` 写入，`finally` 中逆序清理；`--check` 模式只读。

**踩坑与修复（如实记录）**：

1. 🔴 **TiDB 保留字 `maxValue`**：裸 SQL `SELECT … maxValue …` 报 `You have an error in your SQL syntax`（`MAXVALUE` 是 MySQL/TiDB 分区保留字，与既有 `cursor`/`rows`/`rank` 同类陷阱）。首次运行因此 57/58 通过、脚本按设计 `exit 1`。**修复**：脚本对全部列名统一加反引号。
2. 🔴 **成功路径未显式 `process.exit()` ⇒ 脚本永久挂起**：`getDb()` 的 drizzle 连接池会一直占住事件循环；首轮因为走了 `exit 1`（失败路径）才掩盖了该问题。**修复**：无论成功失败都 `process.exit(0|1)`。

---

## 14. Regression（STEP 14）

### 14.1 类型检查

`npx tsc --noEmit` → **exit 0（0 error）**。开发过程中修复的真实类型问题：

- `definitionValidation.ts`：`inWhitelist()` 改为泛型类型守卫（否则 `executionTiming` 停留在 `unknown` → TS18046）；
- 变量作用域：`timelineResolvable` / `maxForwardOffset` 提到 Entry 段之外（Exit 段复用）；
- `map.ts`：补回被误删的 `type DeclaredRule` / `type PositionSizingDeclaration` 导入；
- 🔴 **等价模块导出冲突（真实发现）**：`server/research/experimentValidation.ts` 已有 `validateStrategyDefinition` / `assertValidStrategyDefinition`（属 STEP 6.1 `strategyContract`），而 `research/index.ts` 用 `export *` 聚合 ⇒ 与 `strategySchema` 的新同名导出冲突。已将新校验器改名为 `validateCanonicalStrategyDefinition` / `assertValidCanonicalStrategyDefinition`。

### 14.2 测试

| 范围 | 结果 |
|---|---|
| 策略相关（`strategySchema` + `strategyPersistence` + `lifecycle`） | **5 文件 / 202 例全过** |
| 全量 vitest（`npx vitest run`） | **216 文件 / 3400 例，15 失败 / 7 文件** |

**失败集合与既有基线逐项一致（零新增失败）**：

| 失败文件 | 例数 | 性质 |
|---|---|---|
| `server/dataHealth.test.ts` | 1 | 真实文件证据（G0/G4 分层语义） |
| `server/image.uploadAndRecognize.test.ts` | 1 | 真实行情同步 |
| `server/limitUp.test.ts` | 1 | 真实 DB 直连 |
| `server/limitUp.watch.test.ts` | 4 | 真实 DB 直连 |
| `server/marketData.test.ts` | 4 | 真实 DB 直连 |
| `server/tushare.secret.test.ts` | 1 | 外部 API（Tushare 积分受限） |
| `server/tushareTradingCalendar.test.ts` | 3 | 外部 API / 临时缓存 |

⇒ **15 例 = 并行会话（RESEARCH-005，ROADMAP §47 16:05 条）记录的同一条基线**；其中**无一条**触及 `strategySchema` / `strategyPersistence` / `server/strategy`。

> ⚠️ 并行会话在 16:05 的全量回归中曾看到 `strategyDomainPersistence.test.ts` 2 例失败（其记录的本文件 mtime 为 16:01/16:02）。该 2 例是**本会话写测试时的真实缺陷**（误用 `createStrategyDocumentFromDefinition` 构造「无 definition」的历史文档，导致组装层退化成 `definition = { schemaVersion: "1.0" }` 后抛 `Cannot read properties of undefined`）。**已修复并复跑通过（53/53）**；顺带在 `createStrategyDocumentFromDefinition` 加了 definition 缺失守卫，让该错误响亮失败（`SCHEMA_DEFINITION_REQUIRED`）而不是抛底层 TypeError。⇒ 对并行会话而言属「零新增失败」，且其 2 例已消失。

---

## 15. 变更文件清单

### 15.1 新建（11）

| 文件 | 行数 | 职责 |
|---|---|---|
| `drizzle/0034_strategy_domain_model.sql` | 196 | 守卫式幂等 migration（15 语句） |
| `scripts/applyStrategyDomainModel.mjs` | 193 | apply / `--dry-run` / `--check` + information_schema 断言 |
| `scripts/verifyStrategyDomainModel.mts` | 477 | 真实 TiDB 全链验证（89 项） |
| `server/research/strategySchema/definition.ts` | 635 | Domain 类型权威源 + 规范化 + 字段时间域目录 + 信号时间线 |
| `server/research/strategySchema/definitionValidation.ts` | 793 | 结构 + Look-Ahead 校验（复用既有结果类型） |
| `server/research/strategySchema/legacyViews.ts` | 256 | 叶子模块：Definition → v1 兼容视图单向派生 |
| `server/research/strategySchema/projection.ts` | 314 | Definition → 5 类投影 + 漂移比对 |
| `server/research/strategySchema/goldenSample.ts` | 228 | 首板回踩 Golden Sample（fixture） |
| `server/research/strategySchema/strategyDefinition.test.ts` | 949 | 79 例 |
| `server/research/strategyPersistence/consistency.ts` | 106 | F1 三方指纹 + 双份定义一致性 |
| `server/research/strategyPersistence/strategyDomainPersistence.test.ts` | 768 | 53 例 |

### 15.2 修改（12）

| 文件 | 变更要点 |
|---|---|
| `drizzle/schema.ts` | +3 / +4 列 + 3 索引；新增 5 张表声明 + `$inferSelect` |
| `server/research/strategySchema/types.ts` | `StrategyDocument` 增可选 `readonly definition?` |
| `server/research/strategySchema/map.ts` | `alignDefinitionViews()`、`createStrategyDocumentFromDefinition()`、`createStrategyDefinition()`、`cloneStrategyDocumentToVersion()`；补 definition 缺失守卫 |
| `server/research/strategySchema/serialize.ts` | +`computeStrategyDefinitionFingerprint` / `serializeStrategyDefinition` |
| `server/research/strategySchema/validate.ts` | +`checkDefinitionViewConsistency()`；definition 校验 rebase 到 `definition.*` |
| `server/research/strategySchema/compare.ts` | `isMajorChangePath` 增 `"definition"`（definition 任何改动 → major bump） |
| `server/research/strategySchema/index.ts` | 导出 definition / definitionValidation / legacyViews / projection（**不导出** goldenSample） |
| `server/research/strategyPersistence/contract.ts` | 契约扩展（见 §7） |
| `server/research/strategyPersistence/db.ts` | 同事务写入 + 投影读写 + 一致性断言 + 级联删除 |
| `server/research/strategyPersistence/inMemory.ts` | 与 DB 镜像的契约行为 |
| `server/research/strategyPersistence/service.ts` | `cloneVersion` / `loadBundle` / `validateVersion` / `setVersionStatus` |
| `server/research/strategyPersistence/index.ts` | 导出 `consistency` |

---

## 16. 验收判据（§29，14 项）

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| 1 | Migration 幂等 + 7 表实查 | ✅ | §3.2、§13 ① |
| 2 | Domain Model 完整（entry/exit/position/risk/execution/parameters/datasets） | ✅ | §4 |
| 3 | Persistence 同事务（canonical + 5 投影） | ✅ | §7、代码 `db.transaction` |
| 4 | Projection 单向派生（禁止反向） | ✅ | §5.1、§8 |
| 5 | 两层 Fingerprint（含 dataset binding） | ✅ | §6、测试 C 组 |
| 6 | Validation 复用既有框架（无第二套） | ✅ | §9 |
| 7 | Look-Ahead 规则 1–4（白名单、时序一致性、时间概念分离） | ✅ | §9.1（L1–L8） |
| 8 | Clone 可从任意历史版本 + 复制全部 + 重算指纹 | ✅ | §10、§13 ④ |
| 9 | Clone 幂等三态 | ✅ | §13 ④ |
| 10 | 测试覆盖 SPEC §36 + SoT 一致性 | ✅ | §12 |
| 11 | 真实 TiDB 全链 + 7 表 + 漂移 `exit 1` | ✅ | §13（89/89，exit 0） |
| 12 | `npx tsc --noEmit` 无错误 | ✅ | §14.1 |
| 13 | 全量 vitest 无业务回归 | ✅ | §14.2 |
| 14 | 文档（本报告）+ ROADMAP 同步 | ✅ | 本文件 + ROADMAP §44/§47 |

---

## 17. 已知风险 / 兼容问题 / 未完成

| 编号 | 类型 | 内容 | 处置 |
|---|---|---|---|
| **F1** | 设计 | `strategyDocumentJson` 与 `versionRecordJson.strategy` 双份定义 | **已处置**：降级为可检测冗余 + 三方指纹断言（§5.3）。**未删除**冗余副本（§17 追溯契约） |
| **F7** | 兼容 | `server/strategy/` legacy 双策略并存（5 个硬编码策略 + `leaderCandidates`） | **仅登记，本任务不处理**（§21/§35/§43 禁止为迁入新模型而重写 Backtest） |
| **F9** | 环境 | `research_run.id=330003` 永久 `RUNNING`（自 2026-09-11 06:58Z 停更） | **仅登记**，属 RESEARCH-002D（Run Recovery）；§20 明确本任务不为其强杀在途 Run |
| **F2** | 兼容 | `research_experiments.strategyId/strategyVersion` 仍是自由文本冗余列，未接 `strategies` 外键 | 保留现状（避免外键级联 + 未到 Research 集成阶段） |
| **新** | 架构 | 投影表存在**冗余**（`strategyId` / `strategyVersion` / `conditionCount` 等） | 刻意为之：避免 JOIN（§40），且 `strategyVersionId` 为权威列 |
| **新** | 边界 | Look-Ahead 仅覆盖**声明层**，无法证明运行时执行器无旁路 | 已在 §9.1 显式声明，不冒充已解决 |
| **新** | 运维 | drizzle 连接池使脚本不自动退出；TiDB 保留字（`maxValue` 等） | 已写入脚本注释；建议后续新增裸 SQL 脚本统一「列名反引号 + 显式 `process.exit`」 |
| **新** | 未做 | 未为 `strategy_versions.status` 建立 C-21.1 状态机**迁移守卫**（只校验取值合法性） | 本任务范围是「可迁移」；完整状态机属 C-21.1 lifecycle（既有模块），未强绑 |

---

## 18. 后续任务建议

**STRATEGY-004（建议）**：把 Domain Model 接进 Research / Backtest 消费侧 ——
① `StrategyDefinition` → 可执行实例的解析器（Signal/Exit 求值语义）；
② Strategy 与 Dataset 绑定的**引用完整性校验**（`strategy_version_datasets` → `dataset_version` 存在性）；
③ `strategy_versions.status` 接入 C-21.1 完整状态机（迁移守卫 + 审计）；
④ `research_experiments.strategyId/strategyVersion` 与 `strategies` / `strategy_versions` 的绑定收紧（F2）；
⑤ Parameter Search 消费 `parameterRole=TUNABLE` + `min/max/step`（本任务已铺好投影与校验）。

**不要**在本任务之后直接跳入 Parameter Search / Backtest / Evaluation —— 严格按 STEP 序列推进（§28）。
