# SYSTEM-BASELINE-002 — Round-2 全量审计报告

> **Task**：用户指令「现在再对全系统进行审计」
> **Baseline**：`v1.4.0` → **`v2.0.0`**（major）
> **Last Audit Time**：**2026-09-20**（真实库实查 2026-09-20T02:46Z / 10:46 GMT+8）
> **约束遵守**：代码变更 **0** · DB 变更 **0**（全程 SELECT）· migration **0** · 历史 Run 修改 **0**
> **执行方式**：先按 `v1.x` 协议做 **Baseline Drift 检测** → 判定触发 `GLOBAL AUDIT REQUIRED` → 才做全量审计（**这是基线机制第一次真正被使用**）

---

## 1. Executive Summary

**这次审计的第一件事是「判断该不该做全量审计」。** `SYSTEM-BASELINE-001` 建立的协议规定：除非触发 12 条 `GLOBAL AUDIT REQUIRED`，否则只做增量审计。10 小时后的复查显示**三条同时命中**：

| 触发条目 | 事实 |
|---|---|
| **#1 Domain 新增** | `searchRobustness` / `oosValidation` / `walkForward` 三个域**首次拥有表 + 契约 + 端点 + 前端面板** |
| **#4 核心数据流变化** | **判定日 `decisionOffsetDays` 成为新的信息边界**，贯穿 `Dataset → Run → Experiment → Analysis` 四级 |
| **#7 核心 Contract 变化** | **4 份新 shared 契约**（parameterSearch / searchRobustness / oosValidation / walkForward）+ **新增跨域语义契约** `shared/patternSemantics.ts` |

**五条核心结论**

1. **项目在 10 小时内完成了一次「从技术预览到生产可用」的跃迁。** `Parameter Search` 从 `PREPARATION/PARTIAL`（我当时判定「搜索结果不落库」）变成 **READY**：新增 3 张表 + `persistence.ts` 三层落库（run → combination → result），真库已有 **3 run / 12 combination / 8 result**。Robustness / OOS / Walk-Forward 同步落地（表存在、暂无真实数据）。

2. **最有价值的变更不是新功能，而是「把恒真的护栏改成真的」。** R1 修掉了两条**互相独立**的 look-ahead 缺陷，其中第二条任务书根本没提：`engine.ts#assertGroupPitSafe` 取 `evaluationOffset = Math.max(组内 offset)` 再断言 `offset ≤ max` —— **循环定义、恒真、生产路径从未触发**，而它自称是「OBSERVATION 角色存在的唯一防线」。实测这次修复让池子从 **52 → 70 行（+34.6%）**，直接量化了 survivor/look-ahead bias。

3. **`shared/patternSemantics.ts` 是本项目第一个「跨域语义契约」。** Pattern 声明（纯数据）→ **唯一 Expander** → 两侧投影（研究变量目录 / 策略特征）。研究侧已接生产；**策略侧仅测试可达** ⇒ 语义层目前是「半边通电」。

4. **闭环 `notWired` 的语义已经变了。** 编排器仍只实装 8/14 阶段，但那 6 个未装配域**现在全部另有「持久化端点 + 真实表」** ⇒ **`notWired` 不再等于「该域不可用」**。这是本基线必须修正的一条认知。

5. **基线自身出现了分叉（本次最重要的一条工程教训）。** 并发会话把 `SYSTEM-BASELINE.md` 升到 `v1.4.0` 并补了 4 份增量章节，**但另 9 份文件仍写 `v1.0.0`**，且 `63 表 / 60 声明 / 41 migration` 三处规模数字全部过期（实查 `73 / 70 / 45`）。
   ⇒ **结论：「一处变更要写多处」的文档体系，必须有一个可自动校验的一致性检查，否则必然分叉。**（本次已人工纠正，并把「引用规模数字前先实查」写进 `AGENT-GUIDE.md` 陷阱 20。）

---

## 2. 全局 Domain 状态（round-2）

| Domain | round-1 | **round-2** | 决定性证据 |
|---|---|---|---|
| Dataset | READY | **READY** | 记账闭合未变；新增决策日冻结在 `universeDefinitionJson` |
| Research | READY | **READY** | 新增 report artifact / 判定日护栏 / 语义投影（研究侧） |
| Strategy | READY | **READY** | 版本不可变未变；新增语义派生入口 |
| **Parameter Search** | PREPARATION/PARTIAL | ✅ **READY** | `parameter_search_{run,combination,result}` 真库 3/12/8 行 |
| Backtest | READY | **READY** | policy v1 + canonical 252 未变 |
| Evaluation | PARTIAL | **PARTIAL** | 两套口径仍在收口 |
| **Robustness** | FACT（无持久化） | ✅ **READY** | 3 张表 + 6 端点 + 前端面板 |
| **OOS** | FACT（无持久化） | ✅ **READY** | 2 张表 + 6 端点 + 面板（唯一「必须重跑」的消费边） |
| **Walk-Forward** | FACT（无持久化） | ✅ **READY** | 2 张表 + 每 Fold 真建子 Run |
| Overfitting | FACT（技术预览） | **FACT（仍无持久化）** | 无专属表/迁移/契约 |
| Simulation (Paper) | FACT | **FACT** | 未变 |
| Production | PLANNED | **PLANNED** | 无实现 |
| Market Regime / Lifecycle / Candidate / Review | FACT | **FACT** | 未变 |

**闭环装配度：仍 8/14**（未装配 `robustness`/`oos`/`overfitting`/`paper`/`review`/`discipline`）—— 但见 §1 结论 4。

---

## 3. 当前完整数据流（增量部分）

新增的**唯一核心数据流变化 = 判定日**：

```text
构建请求（pullback.decisionOffsetDays = d）
  → researchDataset/pullback.ts: decisionBars = loadedBars.slice(0, d)      ← 池子资格只用 T+1..T+d
  → dataset_version.universeDefinitionJson.pullbackDecisionOffsetDays       ← 随版本冻结（零新列）
  → researchEngine/datasetReader.ts#extractDecisionOffsetDays()             ← 取不到 = null（不默认整窗）
  → resolveEffectiveDecisionOffset()                                        ← 四级【同值】校验
  → assertGroupObservationPitSafe()                                         ← 护栏
  → tRPC BAD_REQUEST
```

**四级 = `analysis.config` / `run.config` / `experiment.config` / `dataset_version.universeDefinition`**；**不是优先级**，而是「都声明就必须同值，异值 ⇒ `DECISION_OFFSET_CONFLICT`」。

**代价（必须知道）**：① 一次构建 = 一个决策日的池子（比较 d=1..5 ⇒ 5 个数据集 / 5 次 Run）；② **老数据集（`hasDecisionOffset = 0`，实查 v1/v2 均如此）上一切观察日条件会被响亮拒绝** —— 包括 pattern `firstLimitPullbackHoldShrink` 的核心条件。

---

## 4. 当前完整执行流（增量 4 条边）

| 边 | 链路 | 可达性 |
|---|---|---|
| **A** 报告产物 | `engine.ts:407 emitReportArtifact`（best-effort 吞错）→ `report/service.ts:215` → `generator.ts:647`（纯投影、不读时钟） | ✅ 生产（已实测真实 Run 触发 `artifact=#60001`） |
| **R1** 判定日闸门 | `engine.ts#loadConditionSets`（**逐分析**解析）→ `variables.ts` 护栏 | ✅ 生产（五路真实 DB E2E 全绿） |
| **B** 语义投影 | Pattern 声明 → `semanticRegistry` → 唯一 Expander → 研究目录（✅）/ 策略特征（❌ 仅测试） | 半边通电 |
| **D** 结论→候选 | `createFromConclusion`（**默认派生**）→ `evidenceDerivation.ts#deriveCandidateRules` | ✅ 生产（真实 tRPC E2E 13/13） |

---

## 5. 数据库状态（round-2 实查）

| 项 | round-1 | **round-2** | 备注 |
|---|---|---|---|
| `schema.ts` | 2292 行 / 60 表 | **2947 行 / 70 表** | +10 表 |
| 真实库 BASE TABLE | 63 | **73** | = 70 + `__drizzle_migrations` + 2 `rd_rows_*` |
| migration | 41 | **45**（`0000…0044`） | 0041~0044 均 `-- @guard` 幂等 + `--dry-run`/`--check` |
| `db:push` | 不可用 | **仍不可用** | journal 止 0023 / snapshot 止 0015 |
| 外键 | 0 | **0** | 10 张新表同样零 FK |
| `research_artifact` | — | **31 行**（全 REPORT/INLINE） | ⚠️ **无唯一约束** |
| `parameter_search_*` | — | **3 / 12 / 8** | 唯一有真实数据的新域 |
| `search_robustness_*` / `oos_validation_*` / `walk_forward_*` | — | 表在，**全 0 行** | 机制已建，无真实运行 |
| `closed_loop_backtest_run` | 7 → 8 | **8**（8/8 PARTIAL_BLOCKED） | — |
| `research_strategy_candidate` | 13 | **13**（`sourceFindingIdsJson` 非空 **4**） | PHASE-D 写入 |
| `dataset_version` | 2 | **2**（均无决策日） | ⇒ 老数据集上观察日条件被拒 |

---

## 6. Contract 状态

| Contract | 状态 | 备注 |
|---|---|---|
| C-01~C-13（round-1） | READY / PARTIAL | 未变 |
| **C-94 判定日契约**（R1） | READY | 必填、无 default、`d = N` 时与修复前**逐字等价**（可作对照） |
| **C-95 Pattern 语义契约**（B） | 研究侧 READY / **策略侧 CODE_READY** | 16 项 operator 白名单；**唯一 Expander**；深冻结注册表 |
| **C-96 Report Artifact / Evidence Derivation**（A / D） | READY | 幂等在**应用层**（DB 无唯一约束） |
| C-90~C-93（PARAMETER/ROBUSTNESS/OOS/WFA） | READY | 并发会话已登记 |

**新错误码**：`OBSERVATION_WITHOUT_DECISION_DAY` / `INVALID_DECISION_OFFSET` / `DECISION_OFFSET_CONFLICT`（→ `BAD_REQUEST`）· `REPORT_RUN_NOT_COMPLETED`（→ `PRECONDITION_FAILED`）· `INVALID_PULLBACK_DECISION_OFFSET`（**未映射** ⇒ `INTERNAL_SERVER_ERROR`）。

---

## 7. Legacy / 双轨状态

| 项 | round-2 变化 |
|---|---|
| 闭环 6 域 `notWired` | **语义已变**：不再等于不可用（各有持久化端点） |
| **内存态预览端点 vs 持久化端点双轨并存** | 🆕 `paramSearch.run/rolling/robustness/stochastic`（跑完即弃）与 `createSearch/...`（落库）并列；`walkForwardRouter` 预览 vs `paramSearch.createWalkForwardRun`；前端同页双入口（`ParameterSearch.tsx:208-215` vs `:327-341`） |
| `runBacktestEngine2` / `engine/adapter.ts` / STEP 6.x 死服务 | 未变（仍保留） |
| legacy `LeakageGuard`（`EPOCH_FLOOR_DATE` 恒通过） | 未变；但**新语义投影已不再用它**（改用真实决策日） |
| B 体系 Dataset（`researchDataset`） | 未变；R1 的改动落在它的 `pullback.ts` 上 |

---

## 8. 当前 Architecture Risks（round-2）

### 高

| # | 风险 | 证据 |
|---|---|---|
| **AR-12** | **`pat_*` 语义变量无区分度**：声明写「归一化回撤比例」，投影按 `field:"low" + MIN` 取**最低价绝对值**（恒 > 0）⇒ 以它作条件的 Finding **必然产不出来** | 实测 `<=0` 命中 **0**、`>0` 命中**全样本**（`PHASE-D-001-implementation.md:128-142`） |
| **AR-13** | **结论不写 `findingIds`**：`engine.ts:370` 正常分支写空数组 ⇒ 证据链在**列上**断裂（实查 13 个候选仅 4 个有值） | `conclusion.ts:182/315` |
| **AR-9** | 新依赖边 `researchEngine → research/patternLibrary` **无测试守护** | `importBoundary.test.ts` 无该规则 |
| **AR-2** | R-06 剩余瓶颈 = **DB 读取 ≈95 s**（58 次往返） | `_probe_param001_stage_bench.**` |
| **AR-1** | 三段不可互换执行契约并存 | 未变 |
| **AR-3** | 止损三落点互不相通；`server/engine/**` 完全不执行止损 | 未变 |

### 中

`AR-10` `INVALID_PULLBACK_DECISION_OFFSET` 未映射 tRPC code · `AR-11` `research_artifact` 无唯一约束 · `AR-14` `strategyProjection` 未接线 · `AR-15` 双轨预览并存 · `AR-16` planner `patternId` 路径仍写空 `filterRule` · `R-02` 复现快照仍缺 `seed`/`universe`/`codeVersion` · `R-03` `codeVersion` 11/11 = `1.0.0+gunknown` · `R-04` `setVersionStatus` 绕过 §23 迁移表 · `R-05` `parameterRole` 门槛（PARAMETER-002 已加 `referenceCheckApplied` 列，需复核是否闭环） · `R-06` 两套 Metrics 口径 · `R-07` 数据集桥仅支持单一 datasetCode · `R-08` `prefix`/`post` 不在 migration 链内 · `R-09` 无 FK。

### 已解决 / 降级

- ✅ **`R-01` 搜索结果不落库** → **已解决**（三层落库）
- ⚠️ **`R-02` 运行级复现快照** → **部分解决**（已有参数空间/数据集坐标/窗口/执行政策/评估指纹/metricsVersion/engineVersion/runFingerprint；仍缺 `seed`/`universe`/`codeVersion`）

---

## 9. 当前 Roadmap

| 阶段 | round-2 状态 |
|---|---|
| STEP 12 / 12.5 / 12.6 | COMPLETED / CODE_READY / CODE_READY |
| STEP 13~15 | READY |
| STEP 16 Evaluation | PARTIAL |
| **STEP 17 Parameter Optimization** | ✅ **READY**（`9bs`/`9bt`：PARAMETER-001 + 有效性 Gate） |
| **STEP 18 Robustness** | ✅ **READY**（ROBUSTNESS-001 `9bu`） |
| **STEP 19 Walk-Forward / OOS** | ✅ **READY**（OOS-001 `9bv` + WALK-FORWARD-001 `9bw`） |
| STEP 20 Overfitting | 技术预览（仍无持久化） |
| STEP 21/22 Lifecycle / Regime | READY |
| STEP 23/24 Paper / Review | IN PROGRESS |
| STEP 25 Production | PLANNED |
| **四阶段 A/R1/B/D** | ✅ **全部 COMPLETE**（`9by`/`9bz`/`9ca`/`9cb`） |
| **编号台账** | 已用至 **`9cb`** ⇒ 下一个未占用 = **`9cc`** |
| 下一阶段（`system-manifest.nextStage`） | `ROBUSTNESS-PARAMETER-CONSUMPTION`（PLANNED） |

> ⚠️ `ROADMAP.md §44.4` 的「STEP 13~25 BLOCKED」**仍然滞后**（round-1 已登记，未修）。

---

## 10. Baseline 文件说明（round-2 之后的 12 份）

| 文件 | round-2 动作 |
|---|---|
| `SYSTEM-BASELINE.md` | 版本 → **v2.0.0**；规模数字纠错；新增 **§19 Round-2 全量审计**（7 小节） |
| `system-manifest.yaml` | 版本 + `scale` 纠错；新增顶层 **`roundTwo:`** 块（触发条目/四阶段/新契约/新表/新错误码/未守护边/已解决风险/新风险/验证基线/工程化变化） |
| `DATABASE-MAP.md` | 版本 → v2.0.0；规模表改为**双读数**（round-1 → round-2）；表清单标题更新 |
| `CONTRACT-MAP.md` | 版本 → v2.0.0；新增 **C-94 / C-95 / C-96** 三条契约 |
| `DOMAIN-MAP.md` | 版本 → v2.0.0；新增 **§17 四阶段增量**（职责边界 + 新增的「不负责」+ 3 条硬约束） |
| `DATA-FLOW.md` | 版本 → v2.0.0；新增 **D-94 判定日 = 新的信息边界**（含实测对照表） |
| `EXECUTION-FLOW.md` | 版本 → v2.0.0；新增 **E-93 四条新执行边** |
| `DEPENDENCY-MAP.md` | 版本 → v2.0.0；新增 **D-92 新依赖边 + 未被守护**（AR-9） |
| `AGENT-GUIDE.md` | 版本 → v2.0.0；陷阱 **17~20**；新增 **§9-A 工程化命令**（`test:changed` / `docs:tests` / 依赖图两条边 / 测试基线）与 **§9-B 项目记忆不再随仓库走** |
| `CHANGE-AUDIT.md` | 追加 round-2 条目 |
| `SYSTEM-BASELINE-001-REPORT.md` | 保留（round-1 历史报告，不改写） |
| `SYSTEM-BASELINE-002-REPORT.md` | **本文件** |

**只读探针**：`docs/evidence/_probe_baseline_v2_state.mts`（+ `.out.json` / `.out.txt`，`errors=0`，已登记 `README.md`）。

---

## 11. Incremental Audit 机制（round-2 已实践）

本轮是这套机制**第一次被真正使用**，流程与结果：

```text
1. 读 SYSTEM-BASELINE / system-manifest / CHANGE-AUDIT      → 拿到 v1.0.0~v1.4.0 的变化链
2. 侦察 delta（git log/diff、文件 mtime、新 migration、新表）  → 发现 331 文件改动 / HEAD 前进 / 4 个新 migration
3. 判定 GLOBAL AUDIT REQUIRED                                → #1 + #4 + #7 命中 ⇒ 做全量
4. 三轴并行只读审计 + 真实库探针（SELECT only）                → 覆盖新域 / 四阶段 / 基础设施
5. 修正 Baseline（纠正分叉与过期数字）+ 追加增量章节            → v1.4.0 → v2.0.0
6. 写 CHANGE-AUDIT + 本报告                                   → 下一次可直接从这里接着读
```

**成本对照**：全量重读（676 server + 213 client + 45 migration + 290 测试 + 232 文档）→ 本次实际只做了 **3 条并行审计轴 + 1 个探针**，且**只审计了有 delta 的部分**。

---

## 12. Global Audit 触发条件（round-2 实证）

本轮命中的三条已在 §1 列出。**给后续 Agent 的判据（本轮实操得出）**：

| 快速筛查动作 | 若命中 ⇒ 说明 |
|---|---|
| `git log --oneline <baselineHead>..HEAD` 有多个功能提交 | 可能触发 |
| `ls drizzle/*.sql` 数量 > 基线记录 | **新表 ⇒ 至少 Domain 级变化** |
| `ls shared/*.ts` 出现新契约文件 | **命中 #7** |
| `grep -c mysqlTable drizzle/schema.ts` 数值变化 | 命中 #6（若为大规模） |
| 新增 `server/<新模块>/` | **命中 #1** |
| 某条跨域数据（如本次的判定日）换了载体 | **命中 #4** |

---

## 13. Baseline Drift 机制（round-2 的 3 条新发现）

| # | drift | actual | 处置 |
|---|---|---|---|
| **BD-05** | 9 份文档版本号 `v1.0.0`，而 `SYSTEM-BASELINE.md` 已 `v1.4.0` | **基线自身版本分叉**（同一次变更只升了 1 份） | 11 份统一为 `v2.0.0` |
| **BD-06** | `63 表 / 60 声明 / 41 migration`（出现在 3 份文件 6 处） | 实查 **73 / 70 / 45** | 逐处改为双读数 |
| **BD-07** | `docs/testing/README.md` 头「288 测试文件」vs 命令表硬编码「277」 | `scripts/genTestDocs.mts:338` 硬编码 | **未修**（生成物禁手改）⇒ 登记 |

> 🔴 **可复用教训**：**「一处事实写多处」的文档体系必须有自动一致性校验**，否则并发编辑必然分叉。建议后续加一个 `scripts/checkBaselineConsistency.mts`（比对各文件的版本号 + 规模数字 vs 实查值）——**本任务不做**，仅登记。

---

## 14. 文档冲突处理结果

**原则不变**：历史报告全部保留；`docs/architecture/**` 为当前事实入口；旧报告与当前事实不同者登记为 drift。

round-2 新增/更新：

| # | 旧文档 | 旧说法 | 当前事实 |
|---|---|---|---|
| H-12 🆕 | `docs/architecture/DATABASE-MAP.md:13/14/16/48` · `SYSTEM-BASELINE.md:28/193/195/457` · `system-manifest.yaml:scale` | 63 表 / 60 声明 / 41 migration | **73 / 70 / 45**（已修） |
| H-13 🆕 | 9 份基线文档版本号 | `v1.0.0` | `v2.0.0`（已修） |
| H-14 🆕 | `docs/testing/README.md` | 命令表写死「277 个文件」 | 288/290（**未修**，硬编码） |
| H-15 🆕 | round-1 基线 §5 「Parameter Search = PREPARATION/PARTIAL」 | 搜索结果不落库 | **READY**，三层落库（已修） |
| H-16 🆕 | round-1 基线 §5「Robustness/OOS/WFA = 技术预览」 | 无持久化 | **READY**，各有表/契约/端点（已修） |
| H-1 ~ H-11 | round-1 登记的 11 条 | — | 多数仍未修（`PRODUCT_GAP_MATRIX` 等），保留登记 |

---

## 15. 当前 Baseline Version

**`v2.0.0`**（major）
依据 `SYSTEM-BASELINE.md` §15 的版本规则：命中「**核心数据流变化** + **核心 Contract 变化** + **Domain 新增**」三类 ⇒ major。

| 变更类型 | 版本动作 |
|---|---|
| Domain 新增/删除/边界变化 · 核心数据流/Contract/主链变化 | **major**（本轮的 `v1.4.0 → v2.0.0`） |
| Domain 状态跃迁 · 新增 entry point / contract | minor |
| 实现细节 | 不变（只更新 `CHANGE-AUDIT.md`） |

---

## 16. 后续 Agent 使用方法

```text
1. docs/architecture/SYSTEM-BASELINE.md        ← 先读 §19（round-2）与 §5（状态）与 §12（风险）
2. docs/architecture/system-manifest.yaml      ← 机器可读；看 roundTwo: 块
3. docs/architecture/CHANGE-AUDIT.md           ← 尾部两条（round-2 + 各阶段）
4. 本 Domain 文档（DOMAIN-MAP / DATA-FLOW / EXECUTION-FLOW / DATABASE-MAP / CONTRACT-MAP / DEPENDENCY-MAP 的相关章节）
5. 当前任务相关代码（定位用「路径 + 符号名」，不用行号）
6. 只有触发 GLOBAL AUDIT REQUIRED 才回全量
```

**日常命令**：`pnpm run test:changed`（**默认**，别跑全量）· `pnpm run docs:tests`（改测试后必跑）· `node scripts/checkEolDrift.mjs --strict`（收尾）

**开工前必查**：`git status --porcelain`（确认审计的是工作区还是 HEAD）· 引用规模数字前**先实查**（`grep -c mysqlTable drizzle/schema.ts` / `ls drizzle/*.sql`）

---

## 17. 本任务完成后的行为

> **不继续开发任何功能。** 已停止，仅输出：本报告 + Baseline Version + 各 Domain 状态 + 已解决/新增风险 + 下一次任务如何使用 Baseline。

| 项 | 值 |
|---|---|
| **Baseline Version** | **`v2.0.0`** |
| **各 Domain 状态** | Dataset/Research/Strategy/**Parameter Search**/Backtest/**Robustness**/**OOS**/**Walk-Forward**/Lifecycle/Regime = **READY**；Evaluation = **PARTIAL**；Overfitting = FACT（技术预览）；Simulation = FACT；**Production = PLANNED** |
| **解决的风险** | ✅ `R-01`（搜索结果不落库）；⚠️ `R-02` 部分解决 |
| **新增的高风险** | `AR-12` `pat_*` 无区分度 · `AR-13` 结论不写 `findingIds` · `AR-9` 新依赖边无守护 |
| **编号台账** | 已用至 **`9cb`** ⇒ 下一个未占用 **`9cc`**（**禁「末条 +1」**） |
| **下一次任务怎么用** | 读 `SYSTEM-BASELINE.md` §19 → `system-manifest.yaml` → `CHANGE-AUDIT.md` 尾部 → 本 Domain 文档 → 相关代码。**除非触发 `GLOBAL AUDIT REQUIRED`，不再全局重扫。** |

---

## 18. 本任务**未做**的事（边界）

- 未跑任何测试（本任务零代码变更；引用的是各阶段已跑读数）
- 未连库做写入（探针全程 SELECT，`errors=0`）
- 未修 `ROADMAP.md §44.4` 的滞后（属 ROADMAP 维护任务）
- 未修 `docs/testing` 硬编码 277（生成物禁手改）
- 未实现「基线一致性自动校验脚本」（已登记为建议）
- 未同步更新到项目协作资产（**需用户确认后再覆盖**）
