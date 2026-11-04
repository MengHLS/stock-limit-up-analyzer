# RESEARCH-EXPERIMENT-002 — 生产链迁移与旧 Research 解耦（最终报告）

> 单一最终报告（规格 §18 要求只生成这一个文件）。
> 前置：`RESEARCH-EXPERIMENT-001 = COMPLETE`（编号 `9ce`，`docs/research/RESEARCH-EXPERIMENT-001-final.md`）。
> 本任务编号 `9cf`。日期：2026-09-20。

---

## 1. Old Research dependency map（依赖地图，按 A~E 分类）

**审计方式**：读真实代码 + **本地 import 图可达性**（`tests/server/research/_importGraph.ts`，TS AST），
不采信任何历史报告的转述。判据文件：`docs/evidence/_probe_experiment_legacy_reach.mts`。

| 依赖点 | 位置 | 分类 | 处置 |
| --- | --- | --- | --- |
| `strategyCandidate/service.ts#createFromConclusion` 的硬前置（必须存在 conclusion / experiment / Dataset READY / 状态 ∈ {DRAFT,FINAL}） | `server/research/strategyCandidate/service.ts:664-732` | **A 真正的生产依赖** | **已解除**：新增 Experiment → Strategy 桥（不要求任何旧 Research 行） |
| `promote` 的「来源完整性」门槛（`conclusionId` / `experimentId` 必须为正整数） | `service.ts:1049-1058` | **A** | 保留（仅对**旧体系**候选成立）；新桥走独立路径 |
| `evidenceDerivation.ts` 入参强绑 `ResearchConclusion` | `evidenceDerivation.ts:302-312` | **D 兼容** | 保留不动（旧链路自己的派生桥；新路径不使用） |
| `strategy_research_provenance` 三锚 `notNull` | `schema.ts`（旧定义） | **A** | **已放宽为可空**（migration 0045）+ 新增 5 列承载 Experiment provenance |
| 启动期 `reclaimOrphanResearchWork(createDbResearchRepositories())` | `server/_core/index.ts:202` | **D** | 保留（只收敛**既有**孤儿，不产生新数据；003 可评估移除） |
| `researchPlannerRouter.*`（11 端点）/ `researchEngineRouter.*`（38 端点） | 两个 router | **B UI 依赖** | 端点保留、UI 标 Legacy；**写端点不再被正式入口引导**（见 §10） |
| `research_*` 七表历史数据 | TiDB | **C 历史数据** | **只读保留**（本任务零删除） |
| `server/research/index.ts` 的 `export * from "./persistence"`（复数表仓储） | `server/research/index.ts:24` | **E 归 003** | 生产 router（`researchRunRouter`）只是**连带加载**，不读写 ⇒ 列入 003 删除清单 |
| `researchEngine/datasetReader`（Dataset 读取层） | `server/researchEngine/datasetReader.ts` | **D 兼容（有意保留）** | 001 起就被新体系复用为「唯一 Dataset 读取层」—— 是**读取层**，不是旧 Research 分析实体 |
| `researchEngine/readRetry`（纯工具） | 原 `server/researchEngine/readRetry.ts` | **A（曾为真实传递依赖）** | **已搬出**到 `server/readRetry.ts`（旧路径保留为转出口 ⇒ 零破坏） |
| `patternLibrary/index → project → researchEngine/planner/moduleRegistry`（**再导出**造成的传递依赖） | `server/research/patternLibrary/index.ts` | **A（曾为真实传递依赖）** | **已切断**：查询函数下移到 `patternLibrary/catalog.ts`，`strategyConsumption` 改指 catalog |

### 1.1 解耦前后的可达性实测（本任务的主判据）

```
解耦前：entries=14  reachableFiles=326  edges=746
        可达旧 Research 文件 1 个：server/researchEngine/readRetry.ts        ← 判据工具漏了 export 再导出边（假通过一次）
改用 AST 后：可达旧 Research 文件 2 个：
        server/researchEngine/planner/moduleRegistry.ts（经 patternLibrary/index 再导出）
        server/researchEngine/readRetry.ts（经 server/db.ts 的一行工具 import）
解耦后：entries=14  reachableFiles=487  edges=1431
        可达旧 Research 文件 **0**；到 researchCore / researchEngine 均**不可达**；
        从 drizzle/schema import 旧表对象的文件 **0**
```

> 🔴 **判据工具自身的缺陷也被记录下来**：第一版用正则抓 import，**漏掉 `export { … } from "./x"` 这类再导出**
> ⇒ 把「经 barrel 再导出」的传递依赖判成不可达（**假 PASS**）。改用 TS AST（同时正确排除 `import type`）。

---

## 2. Production chain dependency audit（生产链逐域审计）

| 域 | 是否依赖旧 Research | 证据 |
| --- | --- | --- |
| Parameter Search | **否** | 读 `parameter_search_{run,combination,result}` + `dataset_version`（只读）；策略取自 `Strategy Version`（`DbStrategyRepository.getVersionBundle`） |
| OOS | **否** | 源上下文只读 `parameter_search_*`；参数哈希由源组合行**重算复核** |
| Walk-Forward | **否** | 只写 `walk_forward_{run,fold}`；执行 hooks 由组合根 `paramSearchRouter` 提供（走 PS / OOS 应用服务） |
| Robustness | **否** | 只写 `search_robustness_*`；零重跑（边界测试另有静态守卫） |
| Backtest（评估端口 / 闭环） | **否** | 入参 = 策略文档 + 参数覆写 + 日期区间 + `datasetVersionId`；读 `stock_daily_prices` / `limit_up_records` / 研究身份主数据 |
| Paper / Review（journal / discipline / paperAccount） | **否** | 纯函数透传（`reviewRouter` 零 DB import）；`buildJournalDraftsFromRun` 消费的是 `SignalToPnlRun`（内存态），不是 `research_run` |
| Strategy / StrategyVersion 本体 | **否** | `strategy_*` 与 `strategyCore`/`strategySchema` 里**零**旧 Research 字段（`grep` 零命中） |
| Dataset 读取 | 经 `researchEngine/datasetReader`（**读取层**） | 001 的既成设计；不是旧 Research 分析实体 |

**结论**：生产链对旧 Research 的**真实运行时依赖只有两条**（§1 最后两行），均已切断；
其余全部是「UI 依赖 / 历史数据 / 兼容层」。

---

## 3. Strategy migration（Strategy 迁移）

**问题**：002 之前，创建策略的**唯一生产路径**是
`Research Conclusion → Strategy Candidate → Strategy Version`；
`createFromConclusion` 的硬前置使得「没有旧结论就没有策略」。

**新链路（已落地）**：

```text
Independent Experiment（真实跑一次，走 001 的 Runner）
        ↓  一次调用内完成（tRPC: experimentStrategy.createFromExperiment）
Strategy Version（复用既有 createStrategyVersion：幂等 + 冲突检测 + canonical 组装 + 5 投影 + Dataset 绑定校验）
        ↓
strategy_research_provenance（sourceKind = INDEPENDENT_EXPERIMENT）
```

**三条「复用而非重写」**（不造第二套）：
1. 执行入口 = `ExperimentRunner`（不接受调用方自报结果）；
2. 草稿 → 策略定义 = 既有 `buildStrategyDefinition` / `buildExecutionAssumptions` / `buildStrategyRecipe`；
3. 策略落库 = 既有 `StrategyPromotionPort.createStrategyVersion`。

**新增文件**：`server/researchExperiments/strategyBridge.ts`（桥）+ `strategyBridgeRouter.ts`（1 个写端点）。

**边界（不改 Strategy Core）**：`StrategyDefinition` / `StrategyCoreDefinition` / `StrategyVersionRecord`
**零改动**；`grep sourceConclusion|researchRef|conclusionId|findingId|candidateId` 在这三处**零命中**。

---

## 4. Provenance migration（Experiment provenance）

**落点选择**：`strategy_research_provenance`（既有「溯源独立切面」，**display-only**：不参与
`StrategyDefinition` / 指纹 / 5 投影 / validate / backtest / 参数搜索 / 模拟 / 执行）。
**没有**改 `strategy_versions.versionRecordJson` —— 那是 §17 追溯指纹的一部分，动它风险更高。

**§6 六问的逐条答案（真库实测，E2E 输出原文可查）**：

| 问题 | 字段 | 实测值 |
| --- | --- | --- |
| 这个 Strategy 从哪个 Experiment 来？ | `experimentRef` | `first-board-pullback/entry-day` |
| 使用了哪个 Dataset？ | `sourceDatasetVersionId` + `sourceDatasetLabel` | `390002` / `v2` |
| Experiment version 是什么？ | `experimentVersion` | `1.0.0` |
| Experiment parameters 是什么？ | `experimentParametersJson` | `{"entryDays":[1,2,3],"exitRelativeDay":5,"maxEvents":300}` |
| 生成时间是什么？ | `createdAt` | `2026-09-20T10:29:53.000Z` |
| （额外）结果可复核吗？ | `experimentResultDigest` | `exp-sha256:56060f5144c15b40` — **服务端真实重跑后算出**，非调用方自报 |

**不伪造来源坐标（结构保证）**：`assertProvenanceInput` 按 `sourceKind` 分派 ——
`INDEPENDENT_EXPERIMENT` 时三个旧锚**必须为 null**（填任何真实 id 都会被拒），
且 `experimentRef` / `experimentVersion` / `experimentResultDigest` / `experimentParametersJson` 必填。

**上游存活探测按体系分派**：只探测**非空**的锚；`INDEPENDENT_EXPERIMENT` 另探测
「实验定义是否仍在注册表里」（不在 ⇒ `SOURCE_EXPERIMENT_REF`）。
未注入注册表时**不做探测、也不谎报 missing**（「没探测」≠「不存在」，这是两件事）。

---

## 5. Parameter Search migration

- **不依赖旧 Research**：读表仅 `parameter_search_*` + `dataset_version`（只读）；
  **零** `research_analysis` / `research_finding` / `research_conclusion`（全仓 grep 命中仅旧 Research 自身）。
- 直接依赖：**Strategy Version** + **Dataset Version** + **参数定义**（来自策略参数投影 `parameterRole`）。
- **死参数守卫（既有，本轮验证其真实生效）**：对「规则图从未引用」的 TUNABLE 赋搜索域会被**响亮拒绝**
  （`PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER`）—— 本脚本第一版就撞上它，证明守卫有效。

---

## 6. Backtest migration

- 直接依赖 **Strategy Version + Dataset Version + 执行配置**；**不因缺少** `research_conclusion` /
  `research_finding` 而无法运行（§2 已证）。
- **真实 E2E 判据（本轮采用）**：PS 端口的每行结果都带 `backtestFingerprint`（真实撮合指纹）；
  两组合指纹**互不相同** ⇒ 参数差异真的进入了撮合。实测：
  `6b2c6999ba2f990c…` vs `2495d37505351e2e…`。

---

## 7~9. OOS / WFA / Robustness migration

| 域 | 是否读旧 Research 结果作为计算依据 | 真实 E2E 结果 |
| --- | --- | --- |
| OOS | **否**（源只读 `parameter_search_*`；本次真实重跑） | `OOSV-20260920-b36ea82d` **COMPLETED** |
| WFA | **否**（每 Fold 真建自己的 PS / OOS Run） | `WFV-20260920-1d5175d2` **COMPLETED**，**2/2 Fold 走完样本外** |
| Robustness | **否**（零重跑，冻结快照邻域统计） | `SROB-20260920-55c20770` **COMPLETED** |

provenance 只读新体系的 Experiment / Strategy snapshot（`sourceKind=INDEPENDENT_EXPERIMENT`）。

---

## 10. Frontend migration（入口收敛 + Legacy 标识）

**新正式入口 = `/research-experiments`**（001 的独立实验体系）。

| 改动 | 位置 | 说明 |
| --- | --- | --- |
| **修掉一处错误跳转** | `components/robustness/SearchRobustnessPanel.tsx` | 原 `href="/research?searchRunId=…"` 文案写「参数搜索页」却指向旧 Research 列表、且绕过 `basePath` ⇒ 改为复用 `buildPanelLocation`（与本面板深链同源） |
| **Legacy 只读标识条**（新组件） | `components/research/LegacyResearchNotice.tsx` | 照 `pages/WalkForwardAnalysis.tsx` 的既有范式（纯 div + 语义色 + `ShieldAlert` + 指向新入口的 `Link`），不新造 UI 语言 |
| 挂载标识条 | `pages/research/ResearchList.tsx`、`ResearchAsk.tsx`、`pages/findings/FindingList.tsx`、`pages/conclusions/ConclusionList.tsx`、`pages/candidates/CandidateList.tsx` | 只替换「return 最外层容器的开标签」⇒ **JSX 结构逐字不变**（零包裹层） |
| 侧栏标注 | `AppShell.tsx` | 旧 5 项改名为 `提问研究（Legacy）` / `研究实验（Legacy）` / `Findings（Legacy）` / `Conclusions（Legacy）` / `Candidates（Legacy）`；「独立实验」保持在前 |
| 策略详情溯源面板 | （无需改动） | 既有 `StrategyResearchProvenancePanel` 直接复用；适配器按 `sourceKind` 分派显示面（旧体系显示三锚，独立实验显示实验坐标） |

**为什么不删旧页面**：规格 §14 要求「历史数据允许查看 + 明确 UI 标识 Legacy」，
且 §16 明禁「删除旧 Research」⇒ 采取「保留 + 标识 + 不再作为入口引导」。

---

## 11. DB impact（migration ledger）

| 项 | 结论 |
| --- | --- |
| 新增表 | **0** |
| **手工 migration** | **1 个**：`drizzle/0045_experiment_provenance.sql`（8 条语句：5 ADD COLUMN + 3 MODIFY 放宽为 NULL） |
| `db:push` / `drizzle-kit generate` | **未执行** |
| 历史行改写 | **0**（**零 DML**：只有 ALTER；`sourceKind` 靠 `DEFAULT 'RESEARCH_CONCLUSION'` 让既有 9 行语义正确，**无 backfill UPDATE**） |
| 幂等实测 | 首次 `8 executed / 0 skipped`；第二次 `0 executed / 8 skipped`；`--check` → `pass: true` |
| 语义断言 | `scripts/verifyExperimentProvenanceMigration.mjs`（**只读**）**20 PASS / 0 FAIL**：5 新列签名 + 3 锚已可空 + 10 个既有列未受影响 + `sourceKind` 覆盖既有行 + 全库 FK=0 |
| ledgers | `drizzle/meta/_journal.json` **仍 24 条**（末条 `0023_security_identity_unification`，未动 —— 自 0024 起该文件停维护）；`drizzle/0045_*.sql` 为本项目既有的**手工 migration 序列**第 0045 号 |
| 回滚 | 已在 SQL 文件头写明：`DROP COLUMN`（倒序）+ `MODIFY … NOT NULL`；⚠️ 回滚前必须确认**没有** `sourceKind='INDEPENDENT_EXPERIMENT'` 的行（否则 NOT NULL 会失败 —— 刻意的，避免回滚悄悄丢新来源行） |

---

## 12. Legacy boundary（旧 Research = LEGACY_READ_ONLY）

| 原则（规格 §14） | 落地方式 |
| --- | --- |
| 不再创建新的 Analysis / Finding / Conclusion | 旧链路**写端点**仍在（未删，规格禁删），但**已不在正式入口引导**；新策略创建**不经过**它们 |
| 不再作为正式研究入口 | 侧栏 5 项标注 `（Legacy）`；5 个旧页面挂 `LEGACY 只读` 标识条并指向 `/research-experiments` |
| 不再被生产计算链读取 | §1.1 图可达性实测：**0 个旧 Research 文件可达**；E2E 全链 `research_*` 七表 **Δ=0** |
| 历史数据允许查看 | 零删除、零改写；`getVersionProvenance` 对历史行仍可读 |
| 明确 UI 标识 Legacy | 见 §10 |

**「删除 Gate」的可执行形态**（规格 §13）：`tests/server/research/legacyFreeProductionChain.test.ts`
（4 条断言：① 可达集无旧 Research 目录；② 可达集无旧表对象 import；③ 入口清单必须真实解析到
—— 防「清单写错导致前两条假通过」；④ 旧 Research 子图**确实存在** —— 防「Gate 变成空断言」）。

---

## 13. Real E2E results

脚本：`docs/evidence/_e2e_experiment_strategy_chain.mts`（三模式：`bridge` / `chain` / `clean`）。

### 13.1 `bridge`（Experiment → Strategy）：**11 PASS / 0 FAIL**

真实运行数据（v2 数据集 `390002`，实验参数 `{entryDays:[1,2,3],exitRelativeDay:5,maxEvents:300}`）：

- 实验**真实执行** 15.9 s（`eventCount=20000` / `prefixRowCount=20000` / `postRowCount=100000`）；
- 策略版本 `1050002`（`strategyId=e2e-re2-20260920103537@1.0.0`）真实落库；
- 溯源行 `570002`：`sourceKind=INDEPENDENT_EXPERIMENT`，三个旧锚**全为 null**，
  `experimentRef` / `experimentVersion` / `experimentParameters` / `experimentResultDigest` 齐全；
- `missingUpstreams=[]`（不回把「本来就没有的旧锚」误报成 missing）；
- **旧 Research 七表 Δ=0**；溯源表 +1（本桥的正当写入）。

### 13.2 `chain`（Strategy → PS → Backtest → OOS → WFA → Robustness）：**9 PASS / 0 FAIL**

| 环节 | 实测 |
| --- | --- |
| Parameter Search | `PSRUN-…` 组合数 2 / **2 个不同指纹** / 6.4 s；死参数筛查如实报告 `["max_drawdown","require_bullish"]` 未引用 |
| Backtest | 两组合各自 `backtestFingerprint` **互不相同**（`6b2c6999…` vs `2495d375…`）⇒ 真跑了两次回测且参数真的进入撮合 |
| OOS | `COMPLETED`（真实样本外重跑） |
| Robustness | `COMPLETED`（零重跑邻域统计） |
| Walk-Forward | `COMPLETED`，**2/2 Fold 走完样本外** |
| 全链旧 Research 守恒 | **Δ=0**（八表，含 `research_strategy_candidate`） |

**如实登记的四处边界（都不是静默降级）**：

1. **`researchRun.loopRun(useRealData=true)` 在本策略上不可用** ——
   `resolvedParameterSet 尚未产生：本决策源至少被求值一次后才有解（拒绝伪造一份「解析结果」）`
   （`strategyCore/production/coreDecision.ts:345`）。属**闭环编排入口的前置条件**，与旧 Research 无关；
   规格 §16 禁改 Backtest ⇒ 本轮**不改**、**如实记录**，并改用「PS 端口的真实回测指纹」作为 Backtest 主判据。
2. **该入口的 `experimentId` 契约仍是旧格式** `EXP-YYYYMMDD-XXXXXXXX`，**装不下**独立实验的
   `<group>/<key>` 身份 ⇒ 独立实验来源坐标由 provenance 行承载（`experimentRef`），不依赖该字段。
3. **WFA 每 Fold 组合上限**必须先看过派生域（模式草图派生 20 个组合；首轮设 4 被
   `MAX_COMBINATIONS_EXCEEDED` 响亮拒绝 —— 禁止截断，行为正确）。
4. **E2E 夹具**：条件里必须引用 TUNABLE 参数（`bar.volume < max_volume_ratio`）否则 PS 拒绝执行；
   这是**验收夹具**，不是交易建议。

---

## 14. Tests

| 层 | 内容 | 结果 |
| --- | --- | --- |
| 新增单测 | 依赖 Gate 4 条（import 图可达性）+ 新体系白名单 3 条 + 桥单测 11 条 | **+18** |
| 既有测试更新 | `strategyCandidateAdapter.test.ts`：溯源行新增「来源体系」+ 独立实验来源新用例（**旧断言随之更新并注释说明**） | 51/51 |
| 新体系全量 | `tests/server/researchExperiments` + Gate + `tests/server/research/strategyCandidate` | **14 文件 / 250 用例全过** |
| `tsc --noEmit` | 全仓 | **0 error** |
| 全量 `vitest run` | 与既有基线逐项比对 | 见下 |
| `vite build` | 生产构建 | 见下 |
| 行尾哨兵 | `scripts/checkEolDrift.mjs` | **0 漂移** |

**失败分类（规格 §15 要求区分 pre-existing / environment-dependent / regression）**：

- **pre-existing + environment-dependent（7 文件 / 16 例，与既有基线一致）**：
  `dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` /
  `tushare.secret` / `tushareTradingCalendar` —— 全部依赖外部环境（Tushare 额度、图片识别、真实库时点）。
- **regression（1 例）**：`tests/client/src/adapters/strategyCandidateAdapter.test.ts` 的
  「10-a) 完整溯源…一项不少」—— 因**有意扩展**溯源显示面（新增「来源体系」行）而失败。
  **已当场修正断言**（补「来源体系」行 + 新增独立实验来源用例），修正后 51/51。
  ⇒ 最终全量失败集合 = **7 文件 / 16 例 = 既有基线，零新增**。

---

## 15. 003 deletion list（待删清单）

| # | 对象 | 删除前置 | 影响面 |
| --- | --- | --- | --- |
| 1 | `server/research/index.ts:24` 的 `export * from "./persistence"` 带来的**复数表仓储连带加载**（`research_experiments` / `research_runs` / `research_experiment_batches`） | 确认 `researchRunRouter` 只需要 `registerBuiltInResearchStrategies` 等少数导出 ⇒ 改为显式点名导出 | 低（纯加载路径） |
| 2 | 启动期 `reclaimOrphanResearchWork(createDbResearchRepositories())`（`server/_core/index.ts:202`） | 确认库内无遗留孤儿（或一次性收敛后） | 低（只读+收敛） |
| 3 | 旧 Research 的**写端点**（`researchEngine.*` 的 create/update/delete/run*/detectFindings/reviewFinding/testHypothesis/createCandidateFromHypothesis/`*Template`，`researchPlanner.createQuestion/runResearch*`） | 用户确认「不再需要从 UI 产生新研究数据」 | 中（前端旧页面会失去写能力 → 需同步改 UI） |
| 4 | `server/researchCore/repository/db.ts` 对旧表对象的使用 | 表行数按用户意愿归档后 | 高（唯一落点） |
| 5 | 旧 Research **表**（`research_experiment/run/analysis/analysis_condition/analysis_metric/result/finding/conclusion/artifact/strategy_candidate/hypothesis/question/plan`）与复数三表 | 数据归档 + 用户明确同意 | 高（**本任务明禁删除**） |
| 6 | 旧 Research 前端页面与适配器（`pages/research|findings|conclusions|candidates`、`adapters/researchEngineAdapter` 的研究 VM 部分） | 3 完成后 | 中 |
| 7 | `server/research/strategyCandidate/evidenceDerivation.ts`（Conclusion → Candidate 派生桥） | 3 完成后（新路径不走它） | 中 |

---

## 16. Remaining risks（如实登记）

1. **`loopRun(useRealData=true)` 的决策源前置**（§13.2-1）：**未修**（属 Backtest/闭环范畴，规格禁改）。
   影响：新策略暂时无法通过该入口跑「闭环全链编排」；**已验证**参数搜索 / OOS / WFA / Robustness
   四条真实路径不受影响。
2. **闭环 lineage 的 `experimentId` 仍是旧格式**（§13.2-2）：新体系身份只能落在 provenance 行。
   若要打通，需要放宽该字段格式（属 Backtest 契约变更 ⇒ 003 排期）。
3. **`server/research/index.ts` 的连带加载**（§15-1）：**不是依赖，但是无谓的模块图污染**；
   003 处理。
4. **旧 Research 写端点仍在**（未删，规格要求）：若用户在旧页面继续创建数据，`research_*` 表会继续增长
   —— 但这**不影响**生产链（已证明零依赖）。
5. **`strategy_research_provenance` 的列顺序**：新列由 ALTER 追加在**末尾**，而 `drizzle/schema.ts`
   把它们写在中间（drizzle 按名 SELECT ⇒ 运行时无影响；按序比对的脚本需按名比对）。
   本轮 `scripts/verifyExperimentProvenanceMigration.mjs` 就是**按名**比对的。
6. **桥的「载体」是旧行形状**（为复用唯一转换器）：已用两条补偿断言钉住「旧字段只允许 null / 0」
   （`manifest.test.ts` + `legacyFreeProductionChain.test.ts`），但**若将来转换器开始读旧锚**，
   仍是桥需要跟进的地方。
7. **`EXP-...` 锚点是新生成的 id**（§13.2-2）：不指向任何既有行 —— 这是「为新运行生成新身份」，
   不是伪造既有行；已在脚本注释与本节写明。
8. **数据窗口**：E2E 用的是 v2 数据集（`2024-09-01..2026-09-01`）、搜索区间 `2024-09-02..2025-06-25`、
   OOS `2025-09-02..2025-11-17`；**不等于**「全窗口验收」。全窗口验收需另行排期（耗时数量级不同）。

---

## 附：COMPLETE Gate 逐条核对（规格 §19）

| 条件 | 状态 | 证据 |
| --- | --- | --- |
| Strategy 不再运行时依赖 Analysis/Finding/Conclusion | ✅ | §1.1 图可达性 0 命中；§3 新桥不要求任何旧行；真库 E2E 11/11 |
| Parameter Search 不依赖旧 Research | ✅ | §5 + E2E `PSRUN-…` 真实执行 + 全链 Δ=0 |
| Backtest 不依赖旧 Research | ✅ | §6 + 两组合回测指纹互异（真实跑过两次回测） |
| OOS 不依赖旧 Research | ✅ | §7 + E2E `COMPLETED` |
| WFA 不依赖旧 Research | ✅ | §8 + E2E `COMPLETED`（2/2 Fold） |
| Robustness 不依赖旧 Research | ✅ | §9 + E2E `COMPLETED` |
| Experiment provenance 可追溯 | ✅ | §4 六问逐条有答案（真库实测） |
| 新 Experiment 成为正式研究入口 | ✅ | §10（侧栏 + 旧 5 项标 Legacy + 标识条） |
| 旧 Research = Legacy Read Only | ✅ | §12（零删除 + 标识 + 零被读） |
| 真实 E2E PASS | ✅ | §13（bridge 11/11 + chain 9/9） |
| build / typecheck / tests PASS | ✅ | §14（tsc 0 / build exit 0 / 零新增失败） |
| migration ledger 正确 | ✅ | §11（手工 0045 + 幂等 + 只读语义断言 20/20 + `_journal.json` 未动） |
| ROADMAP 更新 | ✅ | §44 状态 + §44.5 `9cf` + `ROADMAP-CHANGELOG.md`（§47 实施日志） |
| 单一最终报告 | ✅ | 本文件 |
