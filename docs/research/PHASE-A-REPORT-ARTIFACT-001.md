# PHASE-A-001 — Research Report Artifact 最小闭环 · 实施报告

| 项 | 值 |
| --- | --- |
| 任务 | `PHASE-A-001 — Research Report Artifact 最小闭环`（事项 `rCsha3`） |
| 上游计划 | `docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001-REVISED.md` |
| 实施范围 | 仅 Phase A：`Research Run → Report → research_artifact(REPORT) → ResearchDetail 查看` |
| 交付物 | 本文件（单份最终报告，不拆分阶段报告） |
| 实施时间 | 2026-09-19 |
| 结论 | **闭环已打通**；A-1 / A-2 / A-3 / A-4 / A-6 / A-7 / A-8 **通过**；**A-5 未达成字面 `exit 0`（既有基线冲突，与本任务无关，详见 §11 / §14）** |

---

## 0. 结论速览

1. **闭环成立**：真实 Run 750003 已产出 `artifactType = REPORT`、`storageType = INLINE` 的持久化报告（artifact `#30001`，正文 336,830 字节，checksum `ac31f742…`），并经真实浏览器从 `ResearchDetail → 查看研究报告 → /research/report/750003` 完整查看。
2. **一个完成的 Run 对应一个最终 REPORT Artifact**：全库 15 个 `COMPLETED` Run **全部**恰好各有 1 份 REPORT artifact，`completedRunsWithoutReport = 0`。
3. **幂等成立**：同 Run 重复生成 ⇒ 同 checksum ⇒ 复用既有 artifact，行数不增加（连续两次 CLI 调用均返回 `REUSED`，artifact 仍为 `#30001`）。
4. **零 schema 变更**：`drizzle/`、`shared/`、`server/db.ts` 无任何改动；无新增 migration、无新表、无新列。
5. **未新建第二套体系**：只复用既有 `research_result / research_finding / research_conclusion / research_artifact` 与既有 Repository；未新增幂等表。
6. **唯一未达标项 = A-5 的字面 `tsc --noEmit` exit 0**。当前 23 个 tsc 错误全部落在 **本任务从未触碰的 4 个文件**（parameterSearch / searchRobustness 遗留），属既有基线，非本任务引入。这是任务书 A-5 与仓库既有状态之间的冲突，如实记录于此，不掩盖（§11、§14）。

---

## 1. 任务目标

把 Research 已产出的 `Result → Finding → Conclusion` 沉淀为**可持久化、可追溯、可重新查看**的 Research Report Artifact，打通：

```text
research_run → research_analysis → research_result → research_finding → research_conclusion
  → Report Generator → research_artifact → ResearchDetail → 查看 / 下载报告
```

完成标志：一个真实 Research Run 能产生 `artifactType = REPORT` 的持久化研究报告。

---

## 2. 实施范围

### 2.1 做了什么

- 新增 **纯投影层** Report Generator（读既有结果 → markdown 正文 + metadata + checksum）。
- 新增报告**装配 + 幂等落库**服务（只用既有 Artifact Repository 方法）。
- 在 Research Engine 生命周期**收口处**（Run 落 `COMPLETED` 之后）以 **best-effort** 方式自动产出报告。
- 新增**只读** `researchEngine.getReport` 端点。
- 前端新增报告查看页 `ReportView` 与 `ResearchDetail` 入口。
- 新增回填 CLI（历史已完成 Run 一次性补齐 / 人工重生成）。
- 新增 10 个单元测试 + 4 个只读证据探针。

### 2.2 刻意没做（遵守 §12）

| 禁止项 | 状态 |
| --- | --- |
| Pattern Semantic Extension（`variables.ts`、语义 DSL、operator whitelist） | ❌ 未触碰 |
| Analysis Registry 重构（`analysisConfig.ts` / `analysisPlan.ts` / PATH executor） | ❌ 未触碰 |
| Conclusion → Candidate 自动派生 | ❌ 未实现 |
| Dataset Plugin Discovery | ❌ 未触碰 |
| Strategy Core 收敛（legacy-recipe / strategy-core 双路径） | ❌ 未处理 |
| 任何 DB 迁移 / schema 变更 / 新表 | ❌ 零改动 |
| PDF / 复杂图表 / 对象存储 / 报告编辑器 | ❌ 未做 |
| Phase B / C / D、R1 look-ahead 修复 | ❌ 未开始 |

### 2.3 没有触发停止规则

任务书 §16 的 8 条停止条件均未触发：现有 Artifact Repository 足以支撑最小闭环（不需要改 schema），无需为报告重算 Research，无在途 Run 阻塞。

---

## 3. 实际修改文件

### 3.1 新增（源码）

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `server/researchEngine/report/types.ts` | 182 | 纯数据契约（零 IO）：常量、`ResearchReportSource`、`ResearchReportMetadata`、`ResearchReportDraft` |
| `server/researchEngine/report/generator.ts` | 782 | **纯投影层**：Result/Finding/Conclusion → markdown 正文 + metadata + checksum |
| `server/researchEngine/report/service.ts` | 264 | 只读装配（`loadReportSource`）+ 幂等落库（`generateResearchReport`） |
| `server/researchEngine/report/index.ts` | 18 | barrel |
| `client/src/pages/research/ReportView.tsx` | 290 | 报告查看页（`/research/report/:runId`） |
| `scripts/generateResearchReport.mts` | 196 | 回填 CLI（`--runId` / `--experimentId` / `--all-completed` / `--dryRun`） |
| `tests/server/researchEngine/reportGenerator.test.ts` | 435 | 10 个测试（投影纯度 / 幂等 / COMPLETED 门 / 不伪造 / 两跳结论） |

### 3.2 修改（源码，7 文件 +169 / −1）

```text
server/researchEngine/types.ts                  | 10 ++   （+ REPORT_RUN_NOT_COMPLETED 错误码）
server/researchEngine/index.ts                  |  2 ++   （+ export * from "./report"）
server/researchEngine/engine.ts                 | 63 ++   （+ generateReportOnRun 依赖；+ emitReportArtifact；§10.5 接入）
server/researchEngineRouter.ts                  | 72 ++   （+ 只读 getReport；+ 错误码映射）
client/src/pages/research/index.ts              |  3 ++   （+ 导出 ReportView）
client/src/App.tsx                              |  5 +-   （+ /research/report/:runId 路由）
client/src/pages/research/ResearchDetail.tsx    | 15 ++   （+「查看研究报告」入口）
```

> 说明：`git status` 中另有 `README.MD` / `ROADMAP*.md` / `Dashboard.tsx` / `package.json` 等改动，经核对**非本任务产出**（仓库本身带有他人未提交的改动），本报告只对本清单内的文件负责。

### 3.3 新增（证据 / 探针，只读，不参与产品逻辑）

```text
docs/evidence/_probe_report_scope.mts           # 报告体积实测
docs/evidence/_probe_report_artifact.mts        # artifact 落库事实核对（A-1 / A-2 / A-8）
docs/evidence/_probe_report_traceability.mts    # 溯源字段 ⟷ 源表逐条交叉核对（A-3）
docs/evidence/_probe_report_frontend.mjs        # 真实浏览器 CDP 前端验收（A-4）
docs/evidence/_probe_frontend_diag.mjs          # 前端未登录态诊断（排查用）
docs/evidence/_probe_frontend_repeat.mjs        # 前端稳定渲染率量化（排查用）
docs/evidence/_report_body_630001.md            # 一份完整报告正文快照（章节 / policy / disclaimer 证据）
docs/evidence/_report_frontend/                 # CDP 截图 + DOM 文本 + evidence.json
```

---

## 4. Artifact 现有能力复用情况（实施前审计结论）

任务书 §4 要求「先审计、以当前代码为准、不要因为计划文档写了『需要新增』就盲目新增」。审计结果：

| 审计项 | 事实（以代码为准） | 结论 |
| --- | --- | --- |
| `artifactType` 枚举 | `RESEARCH_ARTIFACT_TYPES` 已含 `REPORT` | ✅ 直接复用，未新增类型 |
| `storageType` 语义 | `INLINE` = 小体积内容落 `metadataJson`，不引入对象存储（`RESEARCH-001-SCHEMA`） | ✅ 选 `INLINE`（本任务禁对象存储） |
| Repository 能力 | `ResearchArtifactRepository` **只有** `create / getById / list / delete` | ⚠️ **没有** create-or-ignore，**没有** checksum 唯一约束 ⇒ 幂等需在服务层实现 |
| checksum 唯一性 | `drizzle/0031_research_core.sql` 的 3 条索引**均为非唯一** | ⚠️ 不能依赖 DB 约束去重 |
| 查询能力 | `artifacts.list({ runId, artifactType })` 已可过滤 | ✅ 直接复用 |
| 既有 API pattern | 现有 router 已有 `publicProcedure` 只读查询范式 | ✅ 直接复用 |
| `research_conclusion` 与 Run 的关系 | **无 `runId` 列** | ⚠️ 只能两跳解析（见 §5.5），不能伪造 |

**关键审计结论**：不存在「可复用的现成幂等机制」。按任务书「禁止新建额外幂等表」，幂等在服务层用既有 `list / delete / create` 实现（§9）。

### 4.1 目录选址为什么不按计划文档的 `server/research/report/`

任务书 §5 推荐 `server/research/report/`，但同时要求「先检查现有目录结构，避免创建重复语义目录」。实际：

- `server/research/` 是**遗留的、仅回测的旧子系统**；
- 当前 Research 领域在 `server/researchCore/` + `server/researchEngine/`；
- Report 的语义归属是「Research Engine 的产物投影」，放进 `server/research/` 会被误读为旧子系统功能。

因此落在 **`server/researchEngine/report/`**，与 `finding/`、`analyses/`、`planner/` 同级。全仓 `find server -type d -name "report*"` 只有这一处，无重复语义目录。

---

## 5. Report Generator 设计

### 5.1 分层与依赖方向（严格单向）

```text
service.ts   装配（只读 IO）+ 幂等落库
   ↓
generator.ts 纯投影（无 IO、无 Repository、无 engine）
   ↓
types.ts     纯数据契约
```

`generator.ts` 的 import 仅 4 项 —— 这是「不重算」的**结构性保证**（不是靠人工纪律）：

```ts
import { createHash } from "node:crypto";
import { FINDING_DISCLAIMER } from "../../researchCore/findings";
import { renderConclusionPolicy, type ConclusionPolicy } from "../conclusion";
import { ... } from "./types";
```

**没有** import 任何 Repository / datasetReader / engine / metrics ⇒ Generator **在编译期就不可能**去重新查询行情或重算收益。同时 `report` **不反向** import `engine.ts`，故无 `engine ↔ report` 循环依赖。

### 5.2 输入（`ResearchReportSource`）

全部来自**已落库的只读快照**，缺失即 `null`：`experiment`、`run`（含 `inputSnapshot`）、`dataset`（版本上下文）、`analyses`、`resultsByAnalysisId`、`findings`、`conclusion`、`patterns`、`conclusionResolution`。

### 5.3 输出（`ResearchReportDraft`）

```ts
{ body: string; format: "markdown"; generatorVersion: "1.0.0";
  checksum: string;            // sha256(body, utf8)
  metadata: ResearchReportMetadata;
  warnings: string[]; }        // 如「某分析没有结果行」
```

### 5.4 报告正文结构（对齐 §6.1 – §6.6）

| 章节 | 内容 | 纪律 |
| --- | --- | --- |
| 抬头 | 「本报告是既有 Research 结果的展示层投影…未重新查询原始行情、未重算收益或条件统计、未重算 Finding。**报告不包含最佳参数、策略推荐、收益承诺或买卖建议**；指标名称一律使用 `metricCode` 原文，不做业务化改名。」 | §13 内容纪律前置声明 |
| `## 1. 基本信息` | Report / Experiment / Run / Dataset Version / Pattern / Generated At / Generator Version | 取不到写「不可达」，不编造 |
| `## 2. Research Analysis 清单` | 逐个：id / 类型 / 名称 / 目标 / 状态 / 配置摘要 | **只列本 Run 实际存在的 Analysis** |
| `## 3. Research Result` | 逐分析引用 `research_result` | **原文数值，不四舍五入、不改名、不重算** |
| `## 4. Finding` | `research_finding` 的类型 / 效应 / 样本 / 周期 / 稳定性 / 单调性 / 交互 / 强度 | 按当前类型定义字段 |
| `## 5. Conclusion` | 结论正文 + 置信度 + `evidenceJson` 结构化要点 + **`policy` 原文** + **`disclaimer` 原文** | §13：**不得删除已有 policy / disclaimer** |
| `## 6. Limitations / Open Questions` | 6.1 样本/数据限制 · 6.2 结论 `limitationsJson` 原文 · 6.3 Finding `limitationsJson` 原文 · 6.4 `nextQuestionsJson` 原文 · 6.5 未能可靠取得的溯源字段 | **不自行推导新策略结论** |
| `## 7. 免责声明` | 引用 `FINDING_DISCLAIMER` 原文 + 指向结论层 `evidence.disclaimer` | 保留既有 disclaimer |

> **实证**：完整正文快照见 `docs/evidence/_report_body_630001.md`（16,449 字符 / 22,383 字节），7 个章节齐全，`policy` 与 `disclaimer` 均在，全文 **0 处「胜率」**。

### 5.5 两处「取不到就不伪造」的诚实处理

1. **结论归属**（`research_conclusion` 无 `runId` 列）
   唯一允许路径：`evidenceJson.primaryAnalysis.analysisId → research_analysis.runId` 两跳。命中多条时**确定性取 id 最大者**并把规则写进 `conclusionResolution`；一条都不命中时置 `null` + 写明原因（「无法归属，不冒充」），**绝不用「实验下最新结论」顶替**。
2. **Pattern 反查**（Run ↔ pattern 无直接列）
   只能经 `analysis.moduleKey → findPatternByResearchModuleKey()` 反查代码声明库。反查不到即空数组，并写入 `unresolvedTraceFields`。实测 15 个 Run 中仅 2 个能反查出 pattern（其余 `patternIds = []`，如实标注 unresolved）。

### 5.6 `patternId` 为何可能为 `null`

实测 Run 750003 同时跑了 `PULLBACK_EFFECTIVENESS` + `EVENT_RETURN_RESEARCH` 两个 module。单值字段无法诚实表达，故：**恰好 1 个**时才填 `patternId`，否则置 `null` 并把全集放进 `patternIds`（未为满足格式而改 schema）。

---

## 6. Report 写入流程

### 6.1 接入点（侵入最小）

`ResearchEngine.run()` 在 Run / Experiment **已落 `COMPLETED` 之后**执行 §10.5：

```ts
// ---- 10.5 PHASE-A-001：研究报告产物（research_artifact · artifactType = REPORT）----
await this.emitReportArtifact(run.id!);
```

- **位置刻意靠后**：报告只建立在已完成的 Run 上，不在 Analysis / Finding / Conclusion 未收敛时提前出「最终报告」（§9）。
- **best-effort**：`emitReportArtifact` 内部 try/catch，失败只 `console.warn`，**绝不**把一条已跑出结果的 Run 判死（与 Finding 层同一纪律）。
- 可用 `ResearchEngineDeps.generateReportOnRun = false` 关闭（测试 / 特殊回放）。
- **零循环依赖**：`report` 不反向 import `engine`。

### 6.2 门禁

`loadReportSource` 对非 `COMPLETED` 的 Run 直接抛 `REPORT_RUN_NOT_COMPLETED`（新增错误码），**不产出「进行中」的报告**。

### 6.3 回填路径

`scripts/generateResearchReport.mts` 复用**同一个** `generateResearchReport()`（无第二条实现），支持 `--runId` / `--experimentId` / `--all-completed` / `--dryRun`。本任务用它完成了 15 个历史已完成 Run 的回填。

---

## 7. API

新增**只读**端点 `researchEngine.getReport`（`publicProcedure`，与既有只读查询范式一致）：

```ts
getReport: publicProcedure
  .input(z.object({ runId: z.number().int().positive() }))
  .query(...)   // 返回 { run, artifact, traceability, report, reportArtifactIds }
```

- **只读**：不创建 Run、不重算 Research、不修改 artifact；
- 同一 Run 存在多份 REPORT 时取 `id` 最大者，并返回 `reportArtifactIds` 供前端展示「同 Run REPORT 数量」（用于暴露异常）；
- 找不到报告 ⇒ `NOT_FOUND`，消息含「尚未生成研究报告」+（若 Run 已完成）回填指引；
- Run 未完成 ⇒ 映射为 `PRECONDITION_FAILED`（`REPORT_RUN_NOT_COMPLETED`）；
- `traceability` 剥掉正文本体（避免与 `report.body` 重复传输）。

---

## 8. Frontend

### 8.1 入口

`ResearchDetail` 的「分析」卡片头部新增 **查看研究报告** 链接（与既有「看结论 / 创建候选」并列）：

```text
ResearchDetail → 查看研究报告 → /research/report/:runId → ReportView
```

### 8.2 路由顺序（易错点）

`/research/report/:runId` **必须**排在 `/research/:experimentId` 之前，否则 wouter 会把 `report` 当成 `experimentId`。已按此排序（与既有 `/research/ask`、`/research/candidates/:id` 同一处理）。

### 8.3 `ReportView` 能力（对齐 §11）

- 正常导航可达；能看到完整报告正文；
- 能看到**报告生成时间 = `artifact.createdAt`**（不是前端渲染时间）；
- 能看到 Run / Dataset / Pattern / Analysis·Finding·Conclusion 计数 / Generator Version；
- 能看到**溯源区**（artifact id、`artifactType / storageType`、`uri`、字节数、checksum、同 Run REPORT 数量、结论归属解析、unresolved 字段）；
- 正文可切换 **渲染视图 / 原文视图**（原文视图保证 markdown 渲染差异不挡住「看到完整报告」）；
- 下载走前端 Blob + anchor（**未引入对象存储、未新增后端下载端点**）——与 §11「下载不是核心」一致。

---

## 9. Checksum / 幂等实现

### 9.1 checksum

`sha256(body, "utf8")`，hex 64 位。为保证确定性（同 run 同内容 ⇒ 同 checksum），metadata 的序列化使用**递归键排序**的 `stableJson`，避免对象键顺序漂移导致 checksum 抖动。`checksum.scope = "report-body-utf8"` 写进 metadata 供人工复核「hash 覆盖的是哪一段」。

### 9.2 幂等（不新建表）

审计确认既有仓储**无** create-or-ignore、DB **无**唯一约束，故在 `service.ts` 用既有方法实现等价语义：

| 情形 | 处置 | outcome |
| --- | --- | --- |
| 同 Run 已存在 REPORT 且 **checksum 相同** | 直接复用，**一行都不写** | `REUSED` |
| 同 Run 无 REPORT | 新建 | `CREATED` |
| 同 Run 有 REPORT 但 checksum 全不同（结果被重算/补跑） | 先 `delete` 旧 REPORT，再 `create` | `SUPERSEDED` |

第三条是刻意的：A-1 要求「一个完成的 Run 对应一个**最终** REPORT Artifact」，若只追加不清理，重复补跑会让同一 Run 挂出多份互相矛盾的「最终报告」。「删旧建新」只用既有 `artifacts.delete`，零新表零新列。

### 9.3 实证

连续两次调用回填 CLI（Run 750003）：

```text
run 1 → outcome = REUSED, artifactId = 30001, checksum = ac31f742…
run 2 → outcome = REUSED, artifactId = 30001, checksum = ac31f742…
```

事后 artifact 事实核对：REPORT 总数仍为 **15**，Run 750003 的 `reportCount` 仍为 **1**。⇒ **checksum 相同、行数不增加**，A-2 成立。

---

## 10. 真实 Run 验证

### 10.1 全量落库结果（15 个 COMPLETED Run）

| Run | Experiment | Analysis | Finding | Conclusion | 正文字节 | artifact |
| --- | --- | --- | --- | --- | --- | --- |
| 270001 | 180001 | 7 | 0 | 180001 | 95,610 | #30002 |
| 270002 | 180001 | 1 | 0 | 180002 | 40,918 | #30003 |
| 300001 | 180001 | 1 | 0 | 210001 | 31,886 | #30004 |
| 330002 | 180001 | 1 | 0 | 210002 | 27,957 | #30005 |
| 390001 | 240002 | 1 | 0 | 270001 | 22,382 | #30006 |
| 420001 | 240002 | 2 | 0 | 300001 | 45,483 | #30007 |
| 450001 | 240002 | 5 | 0 | 330001 | 78,753 | #30008 |
| 480001 | 240002 | 7 | 0 | 360001 | 94,060 | #30009 |
| 510001 | 240002 | 29 | 0 | 390003 | 341,301 | #30010 |
| 540001 | 240002 | 180 | 0 | 480001 | 1,378,137 | #30011 |
| 570001 | 240002 | 13 | 13 | 510001 | 150,651 | #30012 |
| 600001 | 240002 | 18 | 0 | 540001 | 384,356 | #30013 |
| 630001 | 360001 | 1 | 0 | 570001 | 22,383 | #30014 |
| 750001 | 480001 | 28 | 24 | 660001 | 336,792 | #30015 |
| 750003 | 480003 | 28 | 24 | 660003 | 336,830 | #30001 |

结论：`completedRuns = 15`，`completedRunsWithoutReport = 0`；全程 `failed = 0`（14 `CREATED` + 1 `REUSED`）。

### 10.2 主验收样本 Run 750003

| 项 | 值 |
| --- | --- |
| artifact | `#30001`，`artifactType = REPORT`，`storageType = INLINE` |
| uri | `inline://research-report/run/750003` |
| checksum | `ac31f7422c22c055a2a682934a08fe839bdb77d4cf590c6a08fa1ea4963e540a` |
| 正文 | 336,830 字节（markdown） |
| 溯源 | datasetVersionId 390002 · analysis 28 · finding 24 · conclusion 660003 · patternIds `[event-return-research, first-limit-pullback-hold-shrink]` |
| 落库时间 | 2026-09-19 13:59:53 |

---

## 11. A-1 ~ A-8 验收结果

| 编号 | 判据 | 结果 | 证据 |
| --- | --- | --- | --- |
| **A-1** | 存在 `artifactType = REPORT`；**一个完成 Run 对应一个最终 REPORT** | ✅ **通过** | `_probe_report_artifact.mts`：`artifactByType = [REPORT/INLINE ×15]`；`reportPerRun` 每个 Run 恒为 1；`completedRuns=15, completedRunsWithoutReport=0` |
| **A-2** | 同 Run 重复生成 ⇒ checksum 相同、artifact 数量不增加 | ✅ **通过** | 连续两次 CLI 均 `REUSED`（同 checksum、同 `#30001`）；复核 REPORT 总数仍 15、Run 750003 仍 1 行 |
| **A-3** | 可追溯 Run/Experiment/Dataset/Analysis/Finding/Conclusion，**不得伪造** | ✅ **通过** | `_probe_report_traceability.mts`：15/15 artifact 的 `analysisIds`/`findingIds` 与源表**集合完全相等**；runId/experimentId/datasetVersionId 一致；`conclusionId` **独立重算**两跳后逐一吻合；`forged*` 全为空；`allPass=true`，exit 0 |
| **A-4** | 正常导航进入 ResearchDetail → 查看研究报告 必须成功；**须浏览器/CDP 验 DOM** | ✅ **通过** | `_probe_report_frontend.mjs`（真实 Chrome + CDP，`ok=true`）：ResearchDetail 渲染出入口且 `href=/research/report/750003`（`element.click()` 触发**真实导航**）→ 路由切到 `/research/report/750003` → 正文渲染 **242,481 字符**，7 章节齐全、生成时间与 Dataset 可见；原文视图 258,105 字符；**反例**：`/research/report/1` 显示明确错误态（「研究报告加载失败 / 未找到…」）且**无**报告正文。截图与 DOM 文本见 `docs/evidence/_report_frontend/` |
| **A-5** | `tsc --noEmit` **exit 0** | ❌ **未达成（既有基线冲突）** | 当前 **23 个错误 / 6 个文件**，**全部**落在本任务从未触碰的文件：`PersistedParameterSearchPanel.tsx`(13)、`parameterSearch/executor.ts`(4)、`parameterSearch/persistence.ts`(3)、`searchRobustness/persistence.ts`(3)。即 **本任务新增 0 个 tsc 错误**，但字面 `exit 0` 因既有错误无法满足。详见 §12.1 / §14 |
| **A-6** | 零新增失败文件 | ✅ **通过** | 基线 `8 failed / 269 passed (277)` ↔ 实施后 `8 failed / 270 passed (278)`；失败文件集合**逐一相同**（8 个），新增失败文件 = `[]`；新增的 `reportGenerator.test.ts` **10 tests 全过** |
| **A-7** | `checkEolDrift.mjs` 0 drift | ✅ **通过** | `node scripts/checkEolDrift.mjs --strict` → 「已跟踪文件中疑似行尾漂移：0」「未跟踪新文件中 CRLF：0」，exit 0（含本轮对 CRLF 文件 `client/src/App.tsx` 的编辑） |
| **A-8** | `drizzle/` 无新增 migration，schema 无修改，无新表 | ✅ **通过** | `git status --short drizzle/ shared/ server/db.ts` 为空；`git diff --stat HEAD -- drizzle shared server/db.ts` 为空；落库只用 `research_artifact` 既有列 |

**验收小结：8 项中 7 项通过；A-5 因既有基线冲突未达字面要求（本任务零新增 tsc 错误），已按要求如实记录，不掩盖。**

---

## 12. TypeScript / Vitest / EOL 基线对比

### 12.1 TypeScript

| | 值 |
| --- | --- |
| 命令 | `node node_modules/typescript/bin/tsc --noEmit` |
| 退出码 | `1` |
| 错误数 | **23**（与实施前基线一致） |
| 分布 | `client/src/components/parameterSearch/PersistedParameterSearchPanel.tsx` ×13；`server/research/parameterSearch/executor.ts` ×4；`server/research/parameterSearch/persistence.ts` ×3；`server/research/searchRobustness/persistence.ts` ×3 |
| 与本任务关系 | **无关**：上述 4 个文件**均不在** `git status` 的改动集合内（未被本任务改动过一行） |
| 结论 | **本任务新增 tsc 错误 = 0**；但字面 `exit 0` 未达成 —— 属仓库既有遗留（parameterSearch / searchRobustness 缺 schema 导出等），需独立任务处理 |

> 说明：未采用 `git stash` 构造「纯前基线」（仓库带有他人未提交改动，stash 有污染风险）。改用等价且更安全的判据：**所有 tsc 报错文件均未被本任务触碰** ⇒ 错误不可能由本任务引入。

### 12.2 Vitest

| | 基线 | 实施后 |
| --- | --- | --- |
| Test Files | 8 failed / 269 passed (**277**) | 8 failed / 270 passed (**278**) |
| Tests | 17 failed / 4,590 passed | 17 failed / 4,590 passed |
| 失败文件集合 | dataHealth、image.uploadAndRecognize、limitUp、limitUp.watch、marketData、parameterSearchEffectiveness、tushare.secret、tushareTradingCalendar | **完全相同（8 个）** |
| 新增失败文件 | — | **`[]`** |
| 唯一增量 | — | `tests/server/researchEngine/reportGenerator.test.ts`（**10 tests 全过**） |

> 基线口径说明（诚实交代）：基线日志（`_tmp_vitest_base.txt`，277 个文件）captured 于本任务新增测试文件落盘**之前**，故不含 `reportGenerator.test.ts`。`researchEngine/` 目录下前后差异**只有**这一个文件（已逐一比对文件名），且它全过。失败集合前后逐一相同 ⇒ **零新增失败文件**，A-6 成立。

### 12.3 EOL

| | 值 |
| --- | --- |
| 命令 | `node scripts/checkEolDrift.mjs --strict` |
| 已跟踪文件漂移 | **0** |
| 未跟踪新文件 CRLF | **0** |
| 退出码 | `0` |
| 备注 | 仓库仅 `client/src/App.tsx`、`AppShell.tsx`、`PROJECT_RULES.md` 三处为有意 CRLF；本轮编辑 `App.tsx` 后 CRLF 未被破坏 |

---

## 13. Migration / Schema 证明

```text
$ git status --short drizzle/ shared/ server/db.ts
(空)

$ git diff --stat HEAD -- drizzle shared server/db.ts
(空)
```

- **0 migration**、**0 schema change**、**0 new table**、**0 new column**；
- 落库仅使用 `research_artifact` 既有列（`experimentId / runId / artifactType / storageType / uri / checksum / metadataJson`）；
- 未新增唯一索引，幂等由服务层保证（§9）；
- 未新增 `runId` 到 `research_conclusion`（两跳解析代替，§5.5）。

---

## 14. 未完成事项

| # | 事项 | 性质 | 说明 |
| --- | --- | --- | --- |
| 1 | **A-5 字面 `tsc --noEmit` exit 0 未达成** | 🔴 **为验收项，未达标** | 23 个既有错误（parameterSearch / searchRobustness 等）与本任务无关，但任务书要求字面 0。**需独立任务修复既有遗留**后方可宣称 A-5 通过。本任务侧「零新增错误」已证明 |
| 2 | 报告体积上限未定策略 | 🟡 风险 | Run 540001 的报告为 **1,378,137 字节**，以 `INLINE` 落在 `metadataJson`（longtext，可容纳），但单行已超 1MB。当前可接受，后续若要限制需另开任务（涉及策略选择，不在本任务边界内） |
| 3 | 报告生成无重试 / 无补偿 | 🟡 设计取舍 | best-effort + 一次性；失败只 `console.warn`，不留失败记录。已有回填 CLI 可人工补偿，但无自动重试 |
| 4 | 多数 Run 的 Pattern 无法反查 | 🟡 数据现状 | 15 个 Run 中仅 2 个能由 `analysis.moduleKey` 反查出 pattern；其余如实写入 `unresolvedTraceFields`（不伪造）。根因在声明库覆盖度，属 Phase B 范畴 |
| 5 | 多结论命中时取 id 最大者 | 🟡 已知口径 | 属确定性启发式，规则已写入 `conclusionResolution` 并展示在前端。更严格的口径需要 `research_conclusion.runId`（会动 schema ⇒ 本任务禁止） |
| 6 | 下载为前端 Blob，无后端下载端点 | 🟢 符合范围 | 任务书明示「下载不是本任务核心」，且禁止为下载引入对象存储 |
| 7 | 前端探针早期存在**假失败** | ✅ 已修复 | 探针曾把「外壳已渲染但内容区未加载」误判为「被登录门拦住」（详见 §附注）。已改为「只等入口 + 超时后诊断 + 超时 120s」，并另用重复导航探针证明页面 **5/5 稳定渲染**。属**探针健壮性问题**，非产品缺陷 |

### 附注：A-4 排查过程中的一次假失败（诚实记录）

首次 A-4 探针报 `state=unauthenticated`。诊断结论：`AppShell` 在 `useAuth()` 返回前 `user` 为 `null`，会**先**渲染「登录」按钮；探针当时一见「登录」即判定未登录并抛错。并行跑 `tsc` 时 Vite 冷启动变慢，外壳远早于内容区渲染 ⇒ 直接误报。修复后：

- 主探针：只等「查看研究报告」入口（超时 120s），超时**之后**才做分类诊断；
- 重复导航探针：5 次全新导航 **5/5** 成功渲染（其中 1 次服务端返回 207 仍正常渲染）；
- 服务端侧复核：`auth.me` 恒返回本地管理员（id=1），批处理中单个子调用失败返回 207 且不影响 `auth.me` 解析。

---

## 15. 后续建议

1. **优先单开一个「既有 tsc 遗留清零」任务**（parameterSearch / searchRobustness 缺 schema 导出、`StrategyBacktestSample` 字段缺失、`PersistedParameterSearchPanel` 路由类型不匹配），把 `tsc --noEmit` 真正打到 exit 0，届时 A-5 可自动转绿。
2. **报告体积策略**：`INLINE` 在 Run 540001 已达 1.38 MB。建议后续评估「大报告切 `FILE`/分页/摘要 + 全量」的策略——但需先立任务，避免在本任务边界外扩张。
3. **补 Pattern 声明覆盖**：让 `moduleKey → pattern` 反查在多数 Run 上都能命中，可显著减少 `unresolvedTraceFields`。这天然落在 **Phase B（Pattern Semantic Extension）**，不在本任务。
4. **报告生成的失败可观测性**：为 best-effort 失败补一条轻量运行日志（不改 schema），便于运维发现「已完成但缺报告」的 Run。
5. **不要把 `conclusionId` 的两跳解析当成长期方案**。若要根治，应在 Phase B 起评估「结论 ↔ Run」的一等关系；本任务已恪守「不改 schema」边界。
6. **保持 Report Generator 的纯投影纪律**：任何「顺手在生成器里算一下」的改动都会破坏本任务最重要的技术边界（§2.2），建议在 Code Review 清单里固化该检查（例如禁止 `report/generator.ts` 出现除 `node:crypto` 外的运行时依赖）。

---

## 附录 A：证据文件清单

| 文件 | 对应验收 |
| --- | --- |
| `docs/evidence/_probe_report_scope.mts` | 报告体积实测（INLINE 可行性） |
| `docs/evidence/_probe_report_artifact.mts` | A-1 / A-2 / A-8（落库事实） |
| `docs/evidence/_probe_report_traceability.mts` | A-3（溯源交叉核对，exit 0） |
| `docs/evidence/_probe_report_frontend.mjs` | A-4（真实浏览器 CDP，`ok=true`） |
| `docs/evidence/_report_frontend/` | A-4 截图 + DOM 文本 + `evidence.json` |
| `docs/evidence/_probe_frontend_diag.mjs` / `_probe_frontend_repeat.mjs` | A-4 排查（未登录态根因 / 稳定渲染率 5/5） |
| `docs/evidence/_report_body_630001.md` | 报告正文 7 章节 + `policy` / `disclaimer` 完整快照 |

## 附录 B：复现命令

```bash
# 1) 类型检查（预期仍有 23 个既有错误）
node node_modules/typescript/bin/tsc --noEmit

# 2) 完整测试（预期 8 failed / 270 passed，与基线同集合）
node node_modules/vitest/vitest.mjs run

# 3) EOL 漂移（预期 0）
node scripts/checkEolDrift.mjs --strict

# 4) 只读证据探针
node node_modules/tsx/dist/cli.mjs docs/evidence/_probe_report_artifact.mts
node node_modules/tsx/dist/cli.mjs docs/evidence/_probe_report_traceability.mts

# 5) 报告回填 / 重生成（幂等）
node node_modules/tsx/dist/cli.mjs scripts/generateResearchReport.mts --runId 750003
node node_modules/tsx/dist/cli.mjs scripts/generateResearchReport.mts --all-completed

# 6) 前端验收（需先以开发模式起服务：NODE_ENV=development，端口 3000）
node docs/evidence/_probe_report_frontend.mjs --experimentId 480003 --runId 750003 --port 3000
```

---

**报告结束。** 本任务只交付此一份最终报告。Phase B / C / D 与 R1 look-ahead 修复均未开始。
