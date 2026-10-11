# S1 · 资产与数据 Gate —— `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001`

> 阶段：**S1 · 资产与数据 Gate**（只读，零写入）。
> 基线：HEAD `f8b6810` + 工作区（并发会话 `FRONTEND-IA-001` 的未提交改动共存，本阶段未触碰）。
> 本文件只登记**实查事实**：字段 → 权威来源 → 实际可取端口；已有资产复用；数据影响。
> 所有数值来自 2026-10-10 的真实只读 DB `SELECT`（探针见 `_scratch/fbpool/probe0*.mjs`），不是文档转引。

---

## 0. 结论（Gate 判定）

| 项 | 判定 |
|---|---|
| `datasetVersionId=780004` 可用性 | ✅ **READY**，实查（非名称推断） |
| 构建口径是否满足冻结范围 | ✅ `excludeSt=1` · `excludeListedWithinDays=365` · `preWindowDays=10` · `postWindowDays=80` · `boards=["main"]` · 事件 `firstBoard` |
| 每日池所需行情覆盖 | ✅ `post` rd1..80 对全部 58,983 事件齐备；本 MVP 只需 rd1..70 |
| 标签视界（决策后 ≥ 30 交易日） | ✅ 决策年龄 ≤ 40 + 持有 20 + 顺延 10 = rd70 ≤ rd80 |
| `preReturn10` 前缀窗 | ✅ `prefix` rd −10..0 物理齐备（rd−10 覆盖 58,707/58,983 = 99.532%） |
| 每日 PIT ST 事实 | ⚠️ **部分**：事件日 ST 由构建期 `excludeSt=1` 保证；**逐日** ST 有 `research_security_status_history`（15,688 行）可按日解析，但覆盖不保证完整 ⇒ 不可得时记 `UNKNOWN`（不伪造） |
| 逐日跌停/可买卖事实 | ✅ `post` 自带 `limitDownPrice` / `closeAtLimitDown` / `oneWordLimitDown` / `canBuyAtOpen` / `canSellAtClose` / `suspensionStatus` / `barPresent` |
| 「可达」判定 | ✅ **Gate 通过** —— 六阶段可继续；无需新建 Dataset、无需改契约、无需 DDL |

🔴 **本阶段零持久化写入**：全部 `SELECT` / `information_schema` 查询；未创建 Run、未改 Dataset、未改 Schema。

---

## 1. 字段 — 权威来源 — 实际可取端口（三列表）

「端口」列指实验作者面 `context.dataset` 的三条读取通道：
`events()`（事件行）、`feature(rd)`（**prefix**，rd ≤ 0）、`observation(rd)`（**post**，rd ≥ 1）。
**列投影即声明**：未写进 `requiredColumns` 的列在结构上不存在。

| 研究所需字段 | 权威来源（实查） | 实际可取端口 | 备注 |
|---|---|---|---|
| 首板事实 | `ds_first_limit_pullback_event.isFirstLimit=1` + 构建配置 `dataset_build_config_event.relativeDay=0/kind=firstBoard` | `events()` → `values.isFirstLimit` | 权威定义 = 今日涨停且前一交易日非涨停（**不是**上市以来第一次涨停） |
| 板块 = 沪深主板 | `event.boardType='main'` + `event.market∈{SH,SZ}`；构建配置 `dataset_build_config_board.board='main'`（1 行） | `events()` → `values.boardType` / `values.market` | 构建期已限定 `boards=["main"]`；实验侧再核一次（防口径漂移） |
| 事件日非 ST | 构建配置 `excludeSt=1`（Universe 层剔除） | **无逐事件 ST 列** | ⇒ 只能声明「**事件日非 ST**」，不能声明「每日非 ST」 |
| 逐日 ST（PIT） | `research_security_status_history`（`statusType='ST'`，`effectiveFrom/effectiveTo`，15,688 行） | **不在 Dataset 端口内** ⇒ 本 MVP 记 `DAILY_ST_UNAVAILABLE` | 契约缺口，见 §4 |
| 上市龄 ≥ 365 自然日 | 构建配置 `excludeListedWithinDays=365`；构建期用 `research_securities.listedDate` 按**事件日**计算 | **不在 Dataset 端口内**（已固化） | ⇒ 声明「事件日上市龄 ≥ 365 自然日」，不能从今天状态回推 |
| 事件日 / 事件身份 | `event.tradeDate` / `event.eventId` / `event.symbol` | `events()`（骨架列，恒有） | `eventId` 形态 `<symbol>@<date>`（实测一致） |
| rd→交易日映射（每日池的核心） | `ds_first_limit_pullback_post.tradeDate`（**逐事件逐 rd**） | `observation(rd)` → `row.tradeDate` | 🔴 **必须用每行自己的 `tradeDate`**，不能用「事件日 + rd 个自然/交易日」外推（实测 rd11 距事件日 15~26 自然日 ⇒ 有停牌缺口） |
| 事件年龄 rd | `post.relativeDay`（1..80） | `observation(rd)` | 年龄 = 该事件自己的相对日 |
| `preReturn10` 输入 | `prefix` rd−1 与 rd−10 的 `close` | `feature(-1)` / `feature(-10)` | 冻结公式 `close(rd−1)/close(rd−10) − 1`（既有两份逐字相同实现） |
| `maxAmp5` 输入 | `event` 日收盘（`prefix` rd0 `close`）+ `post` rd1..15 的 `high/low/close` | `feature(0)` + `observation(1..15)` | 冻结定义：rd11~15 链式前收振幅最大值；**决策时点下界 = rd15** |
| 入场可买 | `post.canBuyAtOpen`（next open） | `observation(rd)` | 权威执行事实 |
| 出场可卖 / 顺延 | `post.canSellAtClose` + `limitDownPrice`（开盘价高于跌停价即可卖） | `observation(rd)` | 复用 `firstBoardPullback/panel.ts#findExecutableExit` 规则 |
| 连续跌停（仅描述） | `post.closeAtLimitDown` / `oneWordLimitDown` / `limitDownPrice` | `observation(rd)` | 本轮**仅描述**，不过滤、不删样本 |
| 停牌 | `post.suspensionStatus` / `barPresent` | `observation(rd)` | 未知数据与真实停牌严格分开 |
| 三天两板/五天三板（仅描述） | 由 `post.close ≈ limitUpPrice` 逐日判定（权威涨停事实） | `observation(rd)` | **不使用**已失效的 `boardCount` 字段 |
| 成交额/换手（背景画像） | `event.turnover` / `event.floatMarketCap` | `events()` | 仅画像 |
| 未来 20 日路径最高价 | `post.high` | `observation(rd)` | 标签 B（辅助，非可实现收益） |

### 1.1 实查的 780004 口径（`dataset_build_config.id=510004`）

| 字段 | 实查值 |
|---|---|
| `datasetVersionId` / `version` / `status` | `780004` / `v10-listed365-pre10-post80` / **`READY`** |
| `datasetCode` | `first_limit_pullback` |
| `startDate` / `endDate` | `2019-01-02` / `2025-09-26` |
| `totalEvents` / `totalRows` | `58,983` / `10,320,499` |
| `excludeSt` | `1` |
| `excludeListedWithinDays` | `365`（自然日） |
| `preWindowDays` / `postWindowDays` | `10` / `80` |
| `outcomeHorizonsJson` | `[5,10,20]` |
| `batchSize` / `configVersion` | `1000` / `1` |
| 事件 spec | `{relativeDay: 0, kind: "firstBoard"}`（1 条） |
| 板块 | `["main"]`（1 条） |
| 物理 `prefix` rd | `−10 .. 0`（11 层；rd−10 = 58,707 行 ⇒ 覆盖率 99.532%） |
| 物理 `post` rd | `1 .. 80`（80 层，**每层恒 58,983 行**，无缺口） |

### 1.2 主研究窗口所需的额外实证

| 项 | 实查值 |
|---|---|
| 事件日 ∈ `2023-10-01 .. 2025-09-26` 的事件数 | **20,009**（= 滚动池在整个主研究窗口内可能用到的候选上界） |
| `post` 单层分页读成本（2000 个 eventId 一批） | rd1 **2.78s** · rd15 **2.28s** · rd30 **1.60s** · rd61 **0.25s**（跨境链路，冷读） |
| 本 MVP 需读 `post` 层数 | `1..70`（= 年龄 40 + 入场 1 + 持有 20 − 1 + 顺延 10 = 70） |
| 本 MVP 需读 `prefix` 层数 | `−10, −1, 0`（preReturn10 两端 + maxAmp5 链式前收起点） |
| 本地 Dataset 快照 | ❌ **780004 无本地快照**（`.cache/datasets/` 仅有 `660001`/`750001`）⇒ 内容读走 TiDB 直读 |

---

## 2. 已有资产复用表

| 需求 | 复用资产（实查路径 + 符号） | 处置 |
|---|---|---|
| 每日池 → 股票级研究面板 | 无现成实现（`pooledDatasetCursor.ts` 是**事件级多成员**池，`allowMultipleMembersPerSecurity` 缺省 `true`，且零 `anchor` 概念） | **新增纯投影**（研究投影，不建生产池表）；契约缺口见 §4 |
| 权威 `maxAmp5` | `server/strategyCore/featureRegistry.ts#makeEventStateAmplitudeFeatures` · `EVENT_STATE_AMPLITUDE_FEATURE_IDS` · `EVENT_STATE_AMPLITUDE_WINDOW {11,15}` | **经新增零实现 bridge 调用 Core `FeatureDefinition.compute`**，不逐字复制公式 |
| 冻结 `preReturn10` | `research-experiments/shared/singleFactor/rightTailUniverse.ts`（`RIGHT_TAIL_PREFIX_RELATIVE_DAYS=[-10,-1]`，`close(-1)/close(-10)-1`）与 `twelve-factor-composite-study/derive.ts`（同式） | **复用同一公式**；两份既有副本逐字相同，本轮调用 `rightTailUniverse` 侧的公开常量，不新增第三份实现 |
| 出场顺延原语 | `research-experiments/shared/firstBoardPullback/panel.ts#findExecutableExit` | **最小扩展**：加可选 `maxRelativeDay` 形参（缺省 = 既有 20 ⇒ 既有 25 个实验逐字节不变），使「顺延最多再 10 交易日」可表达 |
| 成本原语 | `research-experiments/shared/firstBoardPullback/cost.ts#netReturn` | **复用**：以 `{commission:0, slippage:0, impact:bps/2, stampDuty:bps/2}` 表达固定往返 bps |
| 持有期口径 | `panel.ts`：`holding_day = exitDay − entryDay + 1` | **复用同一口径** ⇒ 「持有 20 交易日」= 目标出场 rd = 入场 rd + 19 |
| 同日随机对照（200 固定种子、均匀无放回） | `research-experiments/shared/singleFactor/rightTailMetrics.ts#pickUniformRandomSubset`（`draws ?? 200` 的 `buildRandomTopKReference` 同族） | **复用**（🔴 不用 `rankCandidates(..., "RAND")` —— 那是同值破平键，连续因子上等于复制） |
| 日期移动块 Bootstrap | `research-experiments/shared/dateClusterBootstrap.ts#movingBlockBootstrapMean` / `#movingBlockBootstrapDifference` | **最小扩展**：加可选 `quantiles`（缺省 `0.025/0.975` ⇒ 既有 22 个实验数字不变），以支持 Bonferroni 97.5% 双侧 CI |
| 破平敏感度诊断 | `research-experiments/shared/singleFactor/rankResolution.ts` | 复用（披露边界并列规模） |
| Run 持久化 | `server/researchExperiments/persistence/runService.ts#start` / `#execute`；表 `research_experiment_run`（实查 164 行） | **复用既有 startRun 入口**，不新增端口 |
| 对象存储产物 | `server/researchExperiments/persistence/artifactPublisher.ts`（MinIO 桶 `research`，env 已配） | 复用 |
| 前端外壳 + 页面注册 | `research-experiments/manifest.ts` + `client/src/researchExperiments/pages.ts` + `client/src/pages/researchExperiments/experimentModes.ts` | 复用（3 个注册点 + 1 处计数断言） |
| 既有「滚动池」研究 | `PLAN-FIRST-LIMIT-POOL-ROLLING-3F-001.md` / `RESULT-FIRST-LIMIT-POOL-STREAMING-001.md`（v6/`720001`，**`preWindowDays=0`**） | **不重复**：那是**组合级闭环回测**（累计 −55.18% / MDD 67.92%），且其数据集**算不出 `preReturn10`** |
| 既有纯右尾研究 | `RESULT-PURE-RIGHT-TAIL-VALIDATION-001.md`（780003，固定 rd 坐标） | **不重复**；本轮只换「滚动池 + 逐日年龄」坐标，并沿用其 `STOP` 边界（不得把 `preReturn10 HIGH` 当正期望信号） |

---

## 3. 数据影响报告

| 项 | 影响 |
|---|---|
| Dataset 读取 | 只读。`eventScanPolicy: "FULL_DATASET"`（声明式，非删阀）+ `freezeSelection(候选并集)`。预计读 `events` 58,983 行、`prefix` 3 层、`post` 70 层 × ≤ 20,009 事件 ≈ **≤ 1.40M post 行** |
| 持久化写入 | 仅 ① `research_experiment_run` **1 行**（本实验首次 Run）；② MinIO `research` 桶本 Run 前缀下的 `result.json` / `manifest.json` / `logs/run.log` / 显式声明的 CSV 产物 |
| **不写入** | 无 DDL / migration；无 Dataset 写入；无 `dataset_version` / `dataset_build_*` 改动；无历史 Run / Strategy / Candidate 改动；无账户、无资金、无 Paper/Production；策略 `3600005` / `3600006` / `3600007` 与历史 Dataset 内容一行不动 |
| 代码改动 | 新增实验 + 共享纯库 + 测试 + 前端页面注册；**2 处最小扩展**（`findExecutableExit` 可选形参、bootstrap 可选 `quantiles`，缺省行为逐字节不变）；`manifest.ts` 注册 1 行 + 1 处 v5 底座豁免 |
| 契约影响 | **无契约变更**。`decisionOffsetDays` 为**单标量**，无法表达逐日变化的决策坐标 ⇒ 本轮按规格 §S2 以**纯投影**表达，并把缺口登记在 §4（不谎报固定坐标、不新开 legacy 路径） |
| Execution 影响 | 无 Runner / Backtest / Paper 接入；本轮产物是**研究标签**，不是平台 `NEXT_OPEN` 策略回测 |

---

## 4. 契约缺口（如实登记，不在本轮修）

1. **`decisionOffsetDays` 是单标量**（`shared/researchExperimentsContracts.ts` §`experimentDatasetRequirementSchema`）。
   滚动池的样本资格边界**逐日变化**（当日年龄 rd ∈ [1,40]），无法用一个标量表达。
   ⇒ 本实验声明 `decisionOffsetDays = 40`（**上界**：资格判定在任何一天都不会用到 rd ≥ 41 的数据），
   并在结果与页面明确标注「声明是**上界**，不是逐日精确坐标」。**不新增字段、不改契约**。
2. **`observation(rd)` 无 eventId / 日期参数**，只有「整层 rd」。
   ⇒ 逐日池只能在内存里从「rd 层」投影出来（本实验这样做）。
3. **`freezeSelection` 一次性**，且冻结集 = 候选宇宙（不是逐日成员）。
   ⇒ 冻结「主研究窗口内可能入池的事件并集」，逐日成员由投影决定；冻结发生在**第一次读 post 之前**。
4. **逐日 ST / 上市龄不在 Dataset 端口内**（只在 DB 侧表里）。
   ⇒ 本实验不直连 DB。事件日非 ST 由构建期保证；逐日 ST 记 `DAILY_ST_UNAVAILABLE` / `UNKNOWN`，**不声称实现了每日非ST控制**。

---

## 5. 未做的事（本阶段边界）

- 未创建新 Dataset / 新契约 / migration；未执行任何写操作。
- 未触碰并发会话 `FRONTEND-IA-001` 的工作区改动与 `.agent/task-state.yaml`。
- 未据预检收益修改任何研究配置（预检只用来看「池/时点/计算/确定性」）。
