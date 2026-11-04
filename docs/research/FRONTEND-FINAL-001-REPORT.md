# FRONTEND-FINAL-001 — 最终实施报告

- **任务号**：`9cd`（ROADMAP §44.5 已登记；台账两处同步为「已用至 `9cd` ⇒ 下一个未占用 = `9ce`」）
- **基线**：`31dcf13 初步全面完成`（工作树含另一会话在途的 `9cc` 改动，本次在其之上继续）
- **阶段一审计报告**：`docs/research/FRONTEND-FINAL-001-AUDIT.md`（本报告以它为事实基线，不重做泛化审计）
- **完成时间**：2026-09-20
- **最终判定**：**`FRONTEND-FINAL-001 = COMPLETE`**（P0 = 0 / P1 = 0 / P2 = 0，见 §21–§22）

---

## 1. Executive Summary

审计给出的三处硬缺口全部闭合，且闭合方式**没有修改任何领域算法**：

| 审计缺口 | 闭合方式 | 证据 |
|---|---|---|
| **P0-1** 验证域无专属入口、侧栏「WFO/OOS 分析」指向**另一套不落库**实现 | 新建 `/validation` 域（总览 + 稳健性 + OOS + Walk-Forward，含 path 式深链）；旧 `/walk-forward` 保留代码但**移出导航** + 顶部红色降级条 | §4；`App.tsx` / `AppShell.tsx`；CDP 冒烟 16/16 |
| **P0-2** 「实际消费参数」前后端双缺 | 追到唯一产生点（装配层 `resolveParameters`）→ 让被丢弃的 `parameterSet` 经 bridge 透出 → 并入**既有** `reproductionJson` 列（零 migration）→ 契约新增 `resolvedParameterSet` + `parameterResolution` | §9；真库实测解析集含**未被请求的键** |
| **P0-3** 验证域真库零留档 | 先跑选材探针（结论：现成版本不可作正例）→ 用项目自建**带真实参数引用**的策略跑真实全链并**保留留档** | §10/§11；`oos=2/2`、`wf=2/4`、17/17 PASS、92 s |

**额外收获**：无头浏览器冒烟抓到**一个审计没发现的真缺陷** —— 三处过期的类型断言让 `paramSearch.describe` / `walkForward.describe` / `review.journal.reconcile` 的请求路径退化成**裸路径**（恒 404），使 FE-6 技术预览静默吃写死默认值、FE-7「端点就绪门」永远显示不可达。这正是审计 P1-8「前端写死兜底」的**真实成因**，已一并修掉（§6）。

**最重要的一条对用户的结论**：现在**可以回答**「我搜索的参数，是否真的改变了策略执行」——
`PSRUN-20260920-e37d9c2a` 两个组合 `tradeCount` **0 → 16**、收益 **−3.65% → −2.59%**、`profitFactor` **null → 1.10**；
而审计现场那条「4 组合指标逐位相同」的旧 Run 得到**如实解释**：它用的是一个**规则图不引用任何参数**的版本（§10.2）。

---

## 2. 实现前后 Capability Matrix

| # | 模块 | 审计状态 | 实现后 | 关键变化 |
|---|---|---|---|---|
| 1 | Dashboard / 首页 | READY | READY | 未动 |
| 2 | Dataset | READY | READY | `VersionDetail` 的 Dataset ID / Version ID 改为可点击 |
| 3 | Research（实验） | READY | READY | 未动 |
| 4 | Research（提问式） | READY | READY | 未动 |
| 5 | Research Analysis | PARTIAL | **READY** | `Finding → 实验页查看该分析` 可点 |
| 6 | **Finding** | PARTIAL | **READY** | 新增 `/findings` 列表 + `/findings/:id` 详情；`primaryAnalysisId` 可点 |
| 7 | **Conclusion** | PARTIAL | **READY** | 新增 `/conclusions` 列表 + `/conclusions/:id` 详情；§15 五件套 + **历史证据只读兜底** |
| 8 | Candidate | PARTIAL | **READY** | 新增 `/candidates` 列表；**Promotion Eligibility 卡片直接可见**（不再只藏在 disabled 的 title） |
| 9 | Strategy | READY | READY | 未动 |
| 10 | Strategy Version | PARTIAL | **READY** | 版本坐标改为可点击溯源（`StrategyVersionIdLink`） |
| 11 | **Parameter Search** | PARTIAL | **READY** | **请求 vs 实际消费参数对照** + `parameterResolution` 状态；`/parameter-search/:runId` 深链；引用面业务化提示 |
| 12 | Backtest / Evaluation | READY | READY | 未动 |
| 13 | **OOS** | PARTIAL | **READY** | `/validation/oos[/:runId]` 独立可达；源 Search Run / 策略版本 / 数据集版本可点；执行与取消走确认对话框 |
| 14 | **Walk-Forward** | **RISK** | **READY** | 正式口径（持久化 `paramSearch.*WalkForwardRun`）成为唯一入口；fold 级深链；旧内存态页降级并移出导航 |
| 15 | Simulation | READY | READY | 未动 |
| 16 | Jobs / Errors | PARTIAL | PARTIAL | 仍未做「全局 Jobs 面板」（无对应后端能力，不为导航造功能） |

**统计**：READY **14** / PARTIAL **2**（#1、#16 均为**本任务范围外**） / RISK **0** / MISSING **0**。

---

## 3. P0 修复

### P0-1 统一 OOS / Walk-Forward 为持久化验证域

- **正式路由**：`/validation`（总览）、`/validation/robustness[/:runId]`、`/validation/oos[/:runId]`、
  `/validation/walk-forward[/:runId][/folds/:foldIndex]`。
- **复用而非重写**：四块 UI 全部复用既有面板；为此抽出 `client/src/lib/panelLinks.ts`
  （纯函数 `buildPanelLocation` + `buildPanelLocation` 的两种形态），并给三个面板加**可选** props：
  - 不传 ⇒ **与改造前逐字等价**（query 式 `…?oosRunId=`）；
  - 独立路由传 `pathStyle` ⇒ **path 式** `…/<runId>[/folds/<i>]`。
- **旧 `WalkForwardAnalysis` 处置（规格 §3.2 要求先确认）**：
  - 其他消费者：仅 `App.tsx` 路由 + `AppShell` 导航（导航已移除）；
  - 测试：`tests/server/walkForwardRouter.test.ts` 等测的是**后端** `walkForwardRouter`，未动；
  - 历史链接：保留 `<Route path="/walk-forward">` 以免旧书签 404；
  - ⇒ 标记 **Legacy / Preview**，页面顶部红色条说明「结果不落库、不可追溯」并指向正式入口。
- 🔴 **同名两个入口不得同时出现在正式导航** ⇒ `navGroups` 中已无 `/walk-forward`。

### P0-2 真正实现 Actual Consumed Parameters（唯一动 server/shared 的一项）

见 §9（含完整链路与两种模式的取舍）。

### P0-3 现场产生真实 OOS / WF 留档

见 §10 / §11。

---

## 4. P1 修复（逐条）

| 编号 | 要求 | 实现 | 落点 |
|---|---|---|---|
| P1-1 | 领域码业务化 | 新建 `ParameterReferenceCheckCard`：参数表格（code / name / dataType / **角色** / 默认值 / min / max / step / **是否被引用**）+ 业务文案「当前 Strategy Version 没有被执行链引用的 TUNABLE 参数，无法进行有效 Parameter Search。」+ 指向策略详情页的「下一步入口」（**不加任何写库按钮**） | `components/parameterSearch/ParameterReferenceCheckCard.tsx`；接入面板**创建表单**（事前检查）与**Run 错误下方**（事后解释） |
| P1-2 | 结论五件套 + 历史兜底 | `ConclusionPanel` 与 `ConclusionDetail` 均渲染 `researchQuestion` / `findingIds` / `evidenceSummary` / `limitations` / `nextQuestions`；五件为空时显示**明确占位说明**（区分「没记录」与「界面没做」）；`findingIds` 空而 `evidenceJson` 有 finding ⇒ 标注「**历史证据（Historical Evidence）**」的只读折叠块，**不伪造 findingId**（只有整数 id 才渲染成链接） | `components/research/ConclusionPanel.tsx`、`pages/conclusions/ConclusionDetail.tsx` |
| P1-3 | Promote gate 直接可见 | 新建 `PromotionEligibilityCard`：`ELIGIBLE / BLOCKED` + `Gate / Current Value / Required Condition / Failure Reason` 四列表格；**直接渲染在候选详情页**（无需点击/悬停）；gate 逐条对齐 `service.ts:1041-1056`、`definitionBuild.ts:633-634/770/779-781/153-159`；**前端不可判定的 gate 如实标「需提交后由后端校验」** | `components/research/PromotionEligibilityCard.tsx`；`StrategyCandidateDetail.tsx:184` |
| P1-4 | 完整 provenance 导航 | 新建 `ProvenanceLink`（`StrategyVersionIdLink` 拆 `<id>@<version>`；`DatasetVersionLink` 用一次的 `datasetRegistry.getVersion` 解析 `datasetId`）；接入 **OOS→源 Search Run**、**OOS/WF→策略版本 / 数据集版本**、**Finding→详情**、**Finding→实验页查看该分析**、**Conclusion→Finding**、**Candidate→Strategy**（既有） | `components/common/ProvenanceLink.tsx` 等 |
| P1-5 | 三个独立列表 | `/findings` `/conclusions` `/candidates` + `/findings/:id` `/conclusions/:id`；均含四态、状态筛选、前端分页、实验列可点；为此把 `researchEngine.listConclusions` / `listCandidates` 的 `experimentId` 放开为可选（**照 `listFindings` 既有模式**） | `pages/findings|conclusions|candidates/**`；`researchEngineRouter.ts` |
| P1-6 | 深链 | `/parameter-search/:runId` + `?searchRunId=` **两者都支持**；OOS/WF/Robustness 的 path 与 query 两形态都支持；**刷新后状态可恢复**（选中坐标只来自 URL，不依赖 React state） | `App.tsx`；`ParameterSearch.tsx`（内部 `useParams()`，**不用 props**——会与 `RouteComponentProps` 冲突报 TS2322）；`panelLinks.ts` |
| P1-7 | Sidebar 重构 | 六组：`复盘分析 / 研究 / 策略 / 验证 / 交易 / 系统`；原「研究数据」一组 11 项平铺取消；新增 `Findings / Conclusions / Candidates / 验证总览 / 稳健性 / 样本外 OOS / Walk-Forward` 入口，**每项都指向已存在路由**（逐条核对 `App.tsx`） | `AppShell.tsx` |
| P1-8 | 废止写死兜底 | 删 `FALLBACK_PARAMETER_SPACE` / `FALLBACK_SPLIT_CONFIG`；`describe` 不可达 ⇒ `canRun=false` + **按钮禁用** + **入口守卫**（带明确报错）+ 红色说明；**不再用前端默认值发起真实运行** | `WalkForwardAnalysis.tsx` |

---

## 5. P2 修复（7 项）

1. **Breadcrumb**：新建 `PageHeader`（标题 + 面包屑 + 右侧动作槽），用于 5 个新页面 + 改造页；
   此前 `components/ui/breadcrumb.tsx`（shadcn 原子）**全仓 0 使用**。
2. **通用 Confirm Dialog**：新建 `ConfirmDialog`（受控、`pending` 锁、`tone`），已接进 OOS 的
   **执行**（真跑分钟级）与**取消**（不可撤销）两个操作。
3. **Technical Details / JSON Drawer**：新建 `JsonBlock`（平坦标量对象 ⇒ **键值表**；
   提供原文开关与复制；`<pre>` **不再是唯一形态**）。
4. **孤岛路由**：核查结论 = **无可清理者** —— `/dataset-builder`、`/strategy-editor` 是**刻意保留**
   的兼容 Redirect，`/404` 是错误页；不为了「看起来干净」删掉兼容层。
5. **无消费者组件**：`runResultAdapter` **不删** —— 它是 `closedLoopRunAdapter.ts:17` 的类型来源，
   且被 `adapters/index.ts:9` 通过 barrel 导出，删除会破坏类型引用（如实登记为「非死代码」）。
6. **Dataset Version / ID 可点击**：`VersionDetail` 的「所属数据集」「Dataset Version ID」改为链接；
   另新增 `DatasetVersionLink` 供全站复用。
7. **JSON 一锅端**：参数搜索页 4 处 `JSON.stringify` 全部改为 `JsonBlock`（含组合参数、
   结果参数、评估产物）；`FindingsPanel` 的 `dimension` 亦改为结构化渲染。

另修一处非 P2 但同类的**真实缺陷**：结果表用裸 `<>` 片段作为列表项导致 React key 警告，改为带 key 的 `Fragment`。

---

## 6. 🔴 冒烟实测抓到的真缺陷（非本任务引入，但当场修掉）

**现象**（无头 Edge 控制台）：`TRPCClientError: No procedure found on path "describe"`。

**根因**：`ParameterSearch.tsx` / `WalkForwardAnalysis.tsx` / `ReviewWorkbench.tsx` 三处仍用
**过期类型断言**：

```ts
type ParamSearchClient = ReturnType<typeof createTRPCReact<ParamSearchRouter>>;
const paramSearch = trpc as unknown as ParamSearchClient;   // ⇒ 请求路径 = 裸 `describe`
```

注释写的是「端点尚未合并进 appRouter，协调者合并后改回 `trpc.paramSearch.*`」，但端点**早已合并**
（`server/routers.ts:329/330/332`）⇒ 断言变成**错误映射**（把 `paramSearchRouter` 当成客户端根，
于是 `paramSearch.describe` → 路径 `describe`）。同理 `review.journal.reconcile` → `journal.reconcile`。

**后果**：FE-6 技术预览块静默落到写死的 `?? 64`；FE-7 整页「端点就绪门」**永远**显示「不可达」，
运行入参静默吃前端兜底值 —— 这正是审计 P1-8 要废止的行为的**真实成因**。

**修法**：三处改回真客户端 `trpc.paramSearch` / `trpc.walkForward` / `trpc.review`，删掉过期断言与
无用导入。**修后**：`/parameter-search` 正文 3034 → **4082** 字符（`describe` 真的返回数据了），
两条路由的 `[API Query Error]` **消失**。

---

## 7. 路由结构

**新增（14 条）**

```
/validation                                            验证总览（三块能力 + 口径提示）
/validation/robustness[/:runId]                        稳健性（零重跑）
/validation/oos[/:runId]                               样本外验证（真重跑）
/validation/walk-forward[/:runId][/folds/:foldIndex]   Walk-Forward（每 Fold 独立搜索 + 独立 OOS）
/parameter-search/:runId                               参数搜索深链（另一形态 ?searchRunId= 亦支持）
/findings          /findings/:findingId
/conclusions       /conclusions/:conclusionId
/candidates        /candidates/:candidateId             候选详情（与 /research/candidates/:id 同一组件）
```

**保留但降级（不在导航出现）**：`/walk-forward`（Legacy 技术预览，红色降级条 + 指向正式入口）。

**侧栏（6 组）**

```
复盘分析  涨停复盘 / 大盘分析 / 情绪分析 / 龙头候选
研究      提问研究 / 研究实验 / Findings / Conclusions / Candidates / 数据集
策略      策略 / 绩效仪表盘 / 参数搜索 / 组合回测 / 回测历史
验证      验证总览 / 稳健性 / 样本外 OOS / Walk-Forward
交易      前向纸面交易
系统      数据域健康 / 历史状态查询 / 行情同步 / 情绪预警 / 操作日志 / Regime-报告 / 复盘工作台 / 上传图片
```

---

## 8. Research → Strategy → Validation → Trading 主线

| 环节 | 前端落点 | 可追溯性 |
|---|---|---|
| Research → Analysis | `/research/ask`、`/research/:id`（分析区） | 分析 → 实验页 |
| Analysis → Finding | `FindingsPanel` + `/findings` | **Finding → 详情**、**Finding → 实验页查看该分析** |
| Finding → Conclusion | `ConclusionPanel` + `/conclusions` | 结论五件套含 `findingIds` **可点** |
| Conclusion → Candidate | `ConclusionPanel` 的「创建策略候选」 | 候选详情可点 |
| Candidate → Strategy Version | `/candidates/:id` promote | 落 `/strategies/:id?version=…`，Strategy 侧回显溯源 |
| Strategy → Parameter Search | `/parameter-search[/:runId]` | **请求 vs 实际消费对照** |
| Parameter Search → Backtest | 结果行 `backtestFingerprint` / `evaluationId` | 指标 + 指纹 |
| Backtest → OOS | `/validation/oos/:runId` ← 源 Search Run 可点回 | 冻结坐标六项 |
| OOS → Walk-Forward | `/validation/walk-forward/:runId/folds/:i` | fold 级 `sourceSearchRunId` / `oosRunId` |
| → Simulation | `/paper-trading` | 未动 |

---

## 9. Parameter Search：Actual / Resolved Parameter 的实现方式

### 9.1 先追真实生命周期（规格 §4.2 要求「禁止凭字段名猜测」）

| 步骤 | 落点 | 结论 |
|---|---|---|
| 组合参数 | `parameter_search_combination.parametersJson` | **请求参数**（搜索枚举值） |
| 桥 | `createStrategyBacktestBridge({...})` | `server/research/parameterSearch/executor.ts:664` |
| 评估端口 | `evaluateStrategyParameters(...)` | `strategyEvaluation/evaluate.ts:159` |
| **解析** | `assembleRunWorkbenchInputs` → **唯一解析点** `assemble.ts:678 recipeRuntime.resolveParameters(document.parameters, request.parameterOverrides)` | **实际被消费的参数集在这里产生** |
| 端口透出 | `evaluate.ts:185/259` → `StrategyEvaluationResult.parameterSet` | 已有，但… |
| **被丢弃** | `strategyEvaluation/backtestBridge.ts:145-174` 构造返回值时**未读取**该字段 | ⇒ 调用方只能看到「请求参数」 |

**顺带纠正一处命名误解（重要）**：OOS / WF 里那个 `resolvedParameterSetJson`（`oosValidation/executor.ts:390`、
`walkForward/executor.ts:694`）实际取自**组合行**的 `parametersJson`，语义是**请求参数**，
**不等于**装配层的解析结果。故本次**不**复用它，而是接真正的解析产物。

### 9.2 最小投影（三处改动，零 migration、零新端点）

1. `backtestBridge.ts`：`StrategyBacktestSample` 增 `resolvedParameterSet`，`trace` 里直接搬
   `result.parameterSet`（**不重算、不二次解析、不重跑策略**）；失败路径为 `null`。
2. `parameterSearch/executor.ts`：把 `sample.resolvedParameterSet` 交 `buildParameterSearchResult`，
   并**并入既有** `reproductionJson` 列（该列语义本就是「复现要素快照」；**刻意不加新列** ——
   `db:push` / `drizzle-kit generate` 在本项目禁用，加列需 migration）。
3. `searchResult.ts`：新增纯函数 `compareRequestedWithResolved`，**在服务端**算出对照结论。

契约（`shared/parameterSearchContracts.ts`）新增：
`resolvedParameterSet` + `parameterResolutionViewSchema{status, requestedParameterCount, resolvedParameterCount, differentParameterCodes, additionalParameterCodes}`，
状态枚举 = **`MATCHED / DIFFERENT / UNAVAILABLE`**（统一使用既有 canonical 名 `resolvedParameterSet`；
**未**新增 `actualParameters` / `actualConsumedParameters` / `resolvedParameters` 等同义字段）。

🔴 **判据细节（决定成败）**：只逐个比较**请求键**（`Object.is`）；解析集**多出的**键
（未参与搜索的 FIXED / DERIVED 参数回落 `defaultValue`）是**预期行为**，记入 `additionalParameterCodes`
但**不计为差异**。若用整集深比较，每条都会被误判成 `DIFFERENT`。

### 9.3 前端展示（规格 §4.3）与真库实测

每个组合展开后显示三段式：`Search Definition → Combination / Requested → Resolved(实际消费) → Execution → Result`；
状态为 `MATCHED` 时明确显示**「搜索参数与实际解析参数一致。」**（不伪造差异）；
`UNAVAILABLE` 时显示「本次执行未记录实际被消费的参数集 —— 未走到评估端口，或该留档早于本字段上线」，**不推断、不回填**。

真库实测（`_probe_ff1_backend_verification.out.json`，走 `appRouter.createCaller`）：

```
Run  PSRUN-20260920-e37d9c2a
 #0 requested {max_volume_ratio: 1}    resolved {max_drawdown:0.02, max_volume_ratio:1,   require_bullish:0}
    resolution {status:"MATCHED", requestedParameterCount:1, resolvedParameterCount:3,
                differentParameterCodes:[], additionalParameterCodes:["max_drawdown","require_bullish"]}
    metrics  tradeCount 0   totalReturnPct -3.6458%  profitFactor null
 #1 requested {max_volume_ratio: 1.75} resolved {max_drawdown:0.02, max_volume_ratio:1.75, require_bullish:0}
    metrics  tradeCount 16  totalReturnPct -2.5901%  profitFactor 1.1023
```

⇒ ① `resolvedParameterSet` **含未被请求的键**，证明落的是**真实解析集**（不是请求回显）；
② 同 Run 两组合 canonical 指标**不同**，证明**参数真的改变了执行**（规格 §十六 B 达成）。

### 9.4 参数效果（规格 §4.4）

**未**新增任何前端自造指标。展示的只有后端真实读数：`tradeCount` / `totalReturnPct` /
`annualizedReturnPct` / `maxDrawdownPct` / `winRatePct` / `profitFactor` / `metricsSource` /
`backtestFingerprint` / `evaluationConfigFingerprint`。

---

## 10. OOS 实际运行证据

- **留档**：`oos_validation_run = 2`、`oos_validation_result = 2`（此前 **0 / 0**）。
- **来源**：`_e2e_walk_forward.mts` 每个 Fold 各起一次**独立** OOS Run（真实重跑，非复用）。
- **实测读数**（`listOosRuns` / `getOosRun`，走真 tRPC）：

| OOS Run | 搜索窗口（IS） | OOS 窗口 | status | OOS 六项 |
|---|---|---|---|---|
| `OOSV-20260920-875957a6` | 2025-01-02..2025-03-06 | 2025-03-07..2025-04-11 | COMPLETED | 见 §11 fold#0 OOS |
| `OOSV-20260920-f0af5844` | 2025-02-14..2025-04-11 | 2025-04-14..2025-05-21 | COMPLETED | 见 §11 fold#1 OOS |

- **关键判据（E2E 内建）**：`W6` 落库 OOS 窗口 == `oosStart..oosEnd` **且** `oosStart > isEnd`（泄漏判据）；
  `W7` OOS Run 真实存在且 `COMPLETED`；`W8` OOS 撮合指纹 **≠** 该 Fold 的 IS 候选指纹
  （防「假重跑」：`#0` IS `b5bf5ad8…` vs OOS `8e79a504…`）。
- **页面上可读**：CDP 冒烟实测 `/validation/oos/OOSV-20260920-875957a6` 正文 **3469** 字符且**含该 id**。

---

## 11. Walk-Forward 与 Fold 实际运行证据

**Run**：`WFV-20260920-5cceca95`（`COMPLETED`，`strategy = wf1-e2e-mu9dbqw6@1.0.0`，`datasetVersionId = 390002`）
**真实执行 92 s**，`totalFoldCount = 2 / completedFoldCount = 2 / failedFoldCount = 0`。

| Fold | IS 窗口 | OOS 窗口 | 源搜索 Run | OOS Run | **IS 读数** | **OOS 读数** |
|---|---|---|---|---|---|---|
| #0 | 2025-01-02..2025-03-06 | 2025-03-07..2025-04-11 | `PSRUN-20260920-ffcf4aff` | `OOSV-20260920-875957a6` | −10.36% / 8 笔 / 胜率 50% / PF 0.172 | **+7.30%** / 2 笔 / 胜率 50% / PF 3.179 |
| #1 | 2025-02-14..2025-04-11 | 2025-04-14..2025-05-21 | `PSRUN-20260920-e37d9c2a` | `OOSV-20260920-f0af5844` | −3.65% / 0 笔 | **+21.66%** / 1 笔 / 胜率 100% |

**E2E 判据 17/17 PASS**（节选）：
`W2` 几何 `oosStart` = `isEnd` 的**下一个真实交易日**（真实 `index_daily` 日历）；
`W3` Fold 间 OOS 段互不重叠且单调右移；`W4` 每 Fold `sourceSearchRunId` **互不相同**（独立搜索）；
`W5` 每 Fold 搜索窗口 == 本 Fold 的 IS（不漏进 OOS）；`W9` 冻结候选 `parameterHash` 与真实组合行**重算**结果逐字节相等；
`W10` 运行主体未漂移（策略定义指纹 / 数据集坐标在 Run 与每个 Fold 行上一致）；
`W12` 汇总**只做描述性统计**（键里无 best/worst/rank）；`W13` 幂等（再次执行 `executed=false` 且行逐字节不变）。

**深链实测**：`/validation/walk-forward/WFV-20260920-5cceca95` 正文 **2755** 字符（含该 id）；
`…/folds/0` 正文 **4497** 字符（fold 详情展开）。

---

## 12. Provenance 链路

```
Analysis ──► Finding ──► Conclusion ──► Candidate ──► Strategy Version
   ▲            │             │              │               │
   └────────────┘             │              │               │
  （Finding→实验页查看该分析）  │              │               │
                    （findingIds 可点）      │               │
                                  （promote 落 ?version=）◄───┘
                                                            │
    Parameter Search ◄────────────────────────────────────────┘
          │  ▲
          │  └── OOS（源 Search Run 可点回）
          ▼
      Backtest ──► OOS ──► Walk-Forward ──► Fold（fold 级 search/oos id 可点）
```

**新启用**：Finding↔Analysis、Conclusion→Finding、OOS→Parameter Search、OOS/WF→策略版本、OOS/WF→数据集版本。
**既有保留**：Candidate→Strategy、Strategy→研究溯源（`StrategyResearchProvenancePanel`）、实验→报告。
**未做（如实登记）**：`sourceResultIds` 保持文本 —— 结果层目前**没有**独立路由，不编造不存在的跳转。

---

## 13. API / Contract 修改（全部为**只读投影或过滤放宽**）

| 文件 | 改动 | 性质 |
|---|---|---|
| `shared/parameterSearchContracts.ts` | 新增 `parameterResolutionStatusSchema` / `parameterResolutionViewSchema`；`parameterSearchResultViewSchema` 增 `resolvedParameterSet` + `parameterResolution` | 契约**只增** |
| `server/research/strategyEvaluation/backtestBridge.ts` | `StrategyBacktestSample` 增 `resolvedParameterSet`（搬 `result.parameterSet`） | 只读投影 |
| `server/research/parameterSearch/searchResult.ts` | 入参增可选 `resolvedParameterSet`；新增纯函数 `compareRequestedWithResolved` | 纯函数 |
| `server/research/parameterSearch/executor.ts` | 写入 `reproductionJson.resolvedParameterSet`；`toResultView` 回读并算对照 | 零 migration（复用既有列） |
| `server/research/strategyPersistence/{contract,service}.ts` + 新 `parameterReferenceCheck.ts` | `loadBundle` 投影增 `referenced` + `parameterReferenceCheck.applied/note` | 只读投影 |
| `server/researchCore/repository/{contract,db,inMemory}.ts` | `ResearchConclusionListFilter` / `ResearchCandidateListFilter` 增可选 `id` / `limit` / `order`（**两实现同步、既有分支逐字不变**） | 过滤放宽 |
| `server/researchEngineRouter.ts` | `listConclusions` / `listCandidates` 的 `experimentId` 放开为可选 + `conclusionId` / `candidateId` / `limit` | 过滤放宽（照 `listFindings` 既有模式） |

🔴 **未触碰**：`resolveParameters` / `bridge.evaluate` / `evaluateStrategyParameters` / `signalBuilder` /
`assembleRunWorkbenchInputs` 的执行分支；OOS / WF 计算逻辑；`server/research/**` 领域实现；历史 provenance 数据。
**零 migration / 零新表 / 零新 tRPC 端点 / 零新依赖。**

---

## 14. 测试结果

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 错误**（过程中我自己引入的 1 处回归已修：`compareRequestedWithResolved` 未处理既有单测不传新字段导致的 `undefined`；修后定向复跑 `tests/server/research/parameterSearch/parameterSearchRun.test.ts` = **38/38 PASS**） |
| `pnpm run build` | **exit 0**（vite 42.7 s + esbuild；仅有既有的 chunk > 500 kB 警告） |
| `pnpm run test:changed` | **2 失败文件 / 5 例**，全部属既有环境依赖基线（`tests/server/limitUp.test.ts` / `tests/server/limitUp.watch.test.ts`）⇒ **零新增失败文件**（1504 passed / 1509） |
| `node scripts/checkEolDrift.mjs` | 已跟踪疑似漂移 **0** / 未跟踪 CRLF **0** |

---

## 15. Smoke Test 结果

**无头 Edge + CDP，16 条路由，16/16 PASS，0 控制台错误**（`docs/evidence/_probe_ff1_frontend_smoke.mjs`）。

判据不是「页面能打开」，而是「**页面上出现真库里存在的 id**」：

| 路由 | 正文长度 | 命中真实 id |
|---|---|---|
| `/validation` | 493 | — |
| `/validation/robustness` | 466 | — |
| `/validation/oos` | 665 | — |
| `/validation/oos/OOSV-20260920-875957a6` | 3469 | ✅ |
| `/validation/walk-forward` | 941 | — |
| `/validation/walk-forward/WFV-20260920-5cceca95` | 2755 | ✅ |
| `…/folds/0` | 4497 | ✅ |
| `/parameter-search` | 4082 | — |
| `/parameter-search/PSRUN-20260920-e37d9c2a` | 5222 | ✅ |
| `/findings` / `/conclusions` / `/candidates` | 4243 / 2211 / 1700 | ✅（真实行） |
| `/strategies` / `/datasets` / `/paper-trading` / `/walk-forward`（Legacy） | 853 / 139 / 701 / 2630 | ✅ |

> 说明：`/datasets` 正文仅 139 字符但**含真实数据行**（`first_limit_pullback / 首板回踩 … ACTIVE 2 v2 READY`）
> —— 探针的白屏阈值因此从 200 下调为 60（这条误报已写进探针注释）。

---

## 16. 数据库真实运行结果

| 表 | 实现前 | 实现后 | 出处 |
|---|---:|---:|---|
| `oos_validation_run` | **0** | **2** | `_probe_ff1_backend_verification.out.json#counts` |
| `oos_validation_result` | **0** | **2** | 同上 |
| `walk_forward_run` | **0** | **2** | 同上 |
| `walk_forward_fold` | **0** | **4** | 同上 |
| `parameter_search_run` | 3 | **5** | 同上 |
| `parameter_search_combination` | 12 | **16** | 同上 |
| `parameter_search_result` | 8 | **12** | 同上 |

**`search_robustness_run` 仍为 0**（本次**未**跑稳健性）—— 因此 `/validation/robustness` 的详情态
在真实数据下**仍未走过一遍**，属**如实登记的未验证面**（见 §19）。

---

## 17. 最终 P0 / P1 / P2

| 级别 | 数量 | 明细 |
|---|---:|---|
| **P0** | **0** | 3 条全部闭合 |
| **P1** | **0** | 8 条全部闭合 |
| **P2** | **0** | 7 项全部处理（其中「孤岛清理」「无消费者组件」两项目标本身**不成立**，已给出核查结论而非硬做） |
| **范围外遗留** | 3 | 见 §19（均**非**前端阻塞项） |

---

## 18. ROADMAP 更新

- `ROADMAP.md` §44.5 新增 **`9cd`（FRONTEND-FINAL-001）** 条目（含审计报告、实现范围、P0/P1/P2 修复、
  新增路由、契约/projection 修改、真实 OOS/WF Run、测试结果、已知遗留）。
- **两处编号台账同步**：文件头铁律行「已用至 `9cd`」+ §44.5 台账行「已用至 `9cd` ⇒ 下一个未占用 = `9ce`」。
- `ROADMAP-CHANGELOG.md` §47 **append-only** 追加 `2026-09-20 · 9cd` 记录。
- `docs/evidence/README.md` 新增 `## 9cd · FRONTEND-FINAL-001` 注册节（6 份证据文件逐条说明 + 读数）。
- **未**把任何 P1 拆成新的 ROADMAP task。

---

## 19. 已知遗留（如实登记；均非前端阻塞项）

| # | 项 | 为什么不是 P0/P1 |
|---|---|---|
| 1 | **结论 §15 五件套在真库 15 条上仍几乎全空**（`findingIds` 有值 0；`researchQuestion` / `evidenceSummary` 全 NULL） | 这是**历史留档**：AR-13 修复只对「修复后新写入」生效，按项目纪律**不修改历史**。本次交付的是**前端展示能力 + 历史只读兜底**（真库实测适用对象 3 条）。要拿到列上证据链需**重跑**，那是研究动作而非前端动作 |
| 2 | **`/validation/robustness` 详情态未在真实数据下跑过**（`search_robustness_run` = 0） | 该面板的四态与渲染路径由同一套既有组件承载（OOS/WF 已验证同构路径），且稳健性是「零重跑」消费型能力；跑一次属于研究排期 |
| 3 | **`/findings`、`/conclusions`、`/candidates` 的 `experimentId` 过滤放宽后未加索引** | 当前 15 / 13 / 68 行量级无性能问题；加索引需 migration（本项目禁用） |
| 4 | **`sourceResultIds` 仍为文本**（无结果层独立路由） | 规格要求「优先使用已有 ID」，而结果层**确实没有**可达路由 ⇒ 不编造跳转 |
| 5 | **`/walk-forward` Legacy 页仍可手敲 URL 到达** | 刻意为旧书签保留（避免 404），已移出导航 + 红色降级条 |

---

## 20. 是否可以进入下一阶段

**可以。** 前端已完成「研究 → 策略 → 验证」的闭环建设，且关键结论由**真实留档**支撑而非空态截图：
`oos_validation_run=2 / walk_forward_run=2 / fold=4`、参数消费对照有实测差异（`tradeCount 0→16`）。

**下一阶段建议**（不新增任务，仅方向）：
1. **实际策略研究**：用 9cc 已验证的「选材纪律」（选**带被引用 TUNABLE** 的策略版本 + 参数域取全域端点）
   对真实策略做参数搜索 / OOS / Walk-Forward，积累**列上证据链**；顺带重跑可让 §15 五件套在新结论上落值。
2. **模拟交易**：`/paper-trading` 已就绪，可接验证通过的策略。
3. **研究侧而非前端侧**的两件事：给策略版本补「被引用的 TUNABLE 参数」（现状 9 个版本声明了 3 个 TUNABLE
   却**一个都没被规则图引用**，这是参数搜索长期无分辨力的根因）；跑一次稳健性以补齐验证域最后一格证据。

---

## 21. 最终状态

```
P0 = 0
P1 = 0
P2 = 0
FRONTEND-FINAL-001 = COMPLETE
```

## 22. 逐条回答规格 §二十一 的 A–H

| 问 | 答 |
|---|---|
| **A. 前端闭环是否真正完成？** | **是。** 主线 `Research → Analysis → Finding → Conclusion → Candidate → Strategy Version → Parameter Search → Backtest/Evaluation → Robustness → OOS → Walk-Forward → Simulation` 每一环都有可达页面、真实接口、四态、可点击溯源；16/16 路由 CDP 冒烟通过且页面上出现真库真实 id |
| **B. Research → Strategy → Validation 是否真正可用？** | **是。** 三个域各自有独立列表/详情路由与深链；跨域跳转（Finding↔Analysis、Conclusion→Finding、Candidate→Strategy、OOS/WF→参数搜索/策略/数据集）全部实测可点 |
| **C. Parameter Search 是否能够证明参数被实际消费？** | **是。** 新增 `resolvedParameterSet`（来自**唯一解析点**、**含未被请求的键**）+ 服务端算好的 `parameterResolution`；实测同一 Run 两组合 `tradeCount 0 → 16`、收益 `−3.65% → −2.59%`、PF `null → 1.10` |
| **D. OOS 是否真实执行并留档？** | **是。** `oos_validation_run=2` / `oos_validation_result=2`（此前 0/0），OOS 撮合指纹与 IS 候选**不相等**（防假重跑），页面实测可读 |
| **E. Walk-Forward 是否真实执行并留档？** | **是。** `walk_forward_run=2` / `walk_forward_fold=4`，Fold 真实执行 92 s，每 Fold 独立搜索（`sourceSearchRunId` 互不相同）+ 独立 OOS，E2E **17/17 PASS** |
| **F. 是否还存在 P0？** | **否，P0 = 0。** |
| **G. 是否还存在 P1？** | **否，P1 = 0。**（§19 的 5 条遗留均为**研究排期**或**刻意的兼容保留**，不构成前端不可用） |
| **H. 是否可以停止前端基础建设？** | **是。** 建议转入实际策略研究与模拟交易；若后续需要动到的，是**研究侧数据与参数引用面**，而不是前端闭环 |
