# FRONTEND CURRENT STATE AUDIT
## STEP 13/15/16 前端产品化 · Phase 1 现状审计

> 审计日期：2026-09-07
> 审计范围：`client/` 全部源码 + `shared/` 契约 + `server/` 相关 router/类型
> 目标：把「工程验证型前端」升级为「专业量化研究工作台」，且**不破坏任何后端 Contract / 数据模型 / PIT / Gate / Audit 语义**。

---

## 1. 总体架构

```
client/            React 19 SPA（Vite 7）
server/            Express + tRPC 11（530 个 .ts）
shared/            前后端共享契约（9 个 .ts）
drizzle/           ORM migration
scripts/           数据回填 / 认证脚本
```

**前端技术栈**（`package.json`）：

| 层 | 选型 |
|---|---|
| 框架 | React 19.2 + TypeScript 5.9 |
| 构建 | Vite 7 + `@vitejs/plugin-react` + `@tailwindcss/vite` |
| 路由 | wouter 3.3（`client/src/App.tsx` 内 `<Switch>/<Route>`） |
| 数据层 | tRPC 11 + TanStack React Query 5（`client/src/lib/trpc.ts` 单一 `createTRPCReact<AppRouter>`） |
| UI | shadcn/ui（Radix）+ Tailwind CSS 4 + lucide-react |
| 表单/校验 | react-hook-form 7 + zod 4 + `@hookform/resolvers` |
| 图表 | recharts 2.15 |
| 动画 | framer-motion |

**状态管理**：无 zustand/redux。页面状态为局部 `useState`；服务端状态走 React Query 缓存。无全局 store。

**别名**：`@` → `client/src`，`@shared` → `shared`（`vite.config.ts`）。

---

## 2. 路由与页面清单（16 条路由，`App.tsx`）

| 路由 | 页面 | 归属 |
|---|---|---|
| `/` | Home | legacy 复盘 |
| `/upload` | Upload | legacy |
| `/market` | Market | legacy |
| `/market-data-input` | MarketDataInput | legacy |
| `/sentiment-alerts` | SentimentAlerts | legacy |
| `/sentiment-analysis` | SentimentAnalysis | legacy |
| `/leader-candidates` | LeaderCandidates | legacy |
| `/backtest` | Backtest | legacy 量化回测（组合回测，与「策略回测」不同物） |
| `/paper-trading` | PaperTrading | legacy |
| `/operation-logs` | OperationLogs | legacy |
| `/stock-sync` | StockSync | legacy |
| `/data-health` | DataHealth | **FE-1 研究链路** |
| `/historical-state` | HistoricalState | **FE-2 研究链路** |
| `/dataset-builder` | DatasetBuilder | **FE-3（本任务重点）** |
| `/strategy-editor` | StrategyEditor | **FE-4（本任务重点）** |
| `/404` | NotFound | — |

导航在 `client/src/components/AppShell.tsx`，侧栏「研究数据」分组含 FE-1~FE-4 四个入口。

---

## 3. 已有组件盘点

### 3.1 通用 UI 库（`client/src/components/ui/`，60+，shadcn/ui 标准集）
Card、Badge、Tabs、Table、Alert、Button、Input、Label、Textarea、Select、Checkbox、Dialog、Collapsible、Separator、Skeleton、Progress、ScrollArea、Tooltip、Accordion、Sidebar… 全部可用，**是本项目可直接复用的设计基础**。

### 3.2 业务组件（`client/src/components/`）
- `AppShell.tsx`（侧栏导航）、`ErrorBoundary.tsx`
- `SentimentAlertBell.tsx`、`AIChatBox.tsx`、`ManusDialog.tsx`
- 图表组件：`CandidateInsightCharts`、`CandidatePhaseFunnel`、`CandidatePremiumChart`
- `StrategyEvaluationPanel.tsx`（legacy 回测评估）
- `ContinuousRangeSlider.tsx`、`CorrectStockDialog.tsx`、`DateRangeSyncDialog.tsx`、`MarkSuspensionDialog.tsx`、`Map.tsx`

### 3.3 页面内私有展示组件（**未抽为公共，是本次改造的候选复用点**）
这些组件目前以函数形式定义在各页面文件内部，无法跨页复用：

| 组件 | 所在文件 | 作用 |
|---|---|---|
| `STATUS_META` / `StatusBadge` / `StatTile` | `pages/DataHealth.tsx` | 状态徽标 + 统计瓦片（PASS/PENDING/FAIL） |
| `GateBadge` | `pages/DatasetBuilder.tsx` | FAIL/PASS/INCONCLUSIVE 徽标 |
| `statusBadgeClass` | `pages/StrategyEditor.tsx` | 生命周期状态徽标（Draft/…/Production/Retired） |
| `Kv` / `PolicyValueView` / `SnapshotView` / `UniverseView` / `PolicySetView` | `pages/DatasetBuilder.tsx` | 防御性只读渲染 |
| `Metric`（回测指标卡） | `pages/Backtest.tsx` | 指标卡 |

→ **结论**：状态颜色目前有 **3 套并行定义**（DataHealth 的 `STATUS_META`、DatasetBuilder 的 `GateBadge`、StrategyEditor 的 `statusBadgeClass`），语义色值未统一，对应任务 §2-12 与 §12 的诉求。

---

## 4. 已有 API / tRPC 契约（后端为权威）

`server/routers.ts` → `appRouter`（`AppRouter = typeof appRouter`）。与本任务相关：

### 4.1 `research.strategy`（`server/researchRouter.ts`）
| procedure | 类型 | 说明 |
|---|---|---|
| `validate` | mutation | `{document}` → `{valid, issues[]}`（§16 全字段 + §17 追溯） |
| `bump` | mutation | `{version, bump:major/minor/patch}` → `{version}` |
| `compare` | mutation | `{left, right}` → `{equal, differences[]}` |

### 4.2 `research.lifecycle`（`server/researchRouter.ts`）
| procedure | 类型 | 说明 |
|---|---|---|
| `describe` | query | → `{statuses[], transitions{}}`（状态机常量，唯一事实来源） |
| `transition` | mutation | `{record, input}` → 新 record（append-only，§23 四要素校验） |

### 4.3 `researchDataset.build`（`server/researchDatasetRouter.ts`）
mutation，入参 `{name, startDate, endDate, asOfPerTradeDate?, asOf?, coreIndexCodes?, maxTradingDays?, maxSecuritiesPerDay?, dataReady?}`；
返回摘要 `ResearchDatasetSummary`（**不含 rows**）：
```ts
{ datasetVersion, universeDefinition: unknown, policySet: unknown,
  dataSnapshot: unknown, gate: "FAIL"|"PASS"|"INCONCLUSIVE", gateNotes: string[], rowCount: number }
```

### 4.4 `dataHealth.*`（`server/dataHealthRouter.ts`）
`overview` / `evidence` / `liveCounts`（只读，与本任务间接相关）。

### 4.5 尚未暴露的后续能力（关键差距）
- **Run / Backtest Result**：当前**没有**「策略级 Run Workbench / Backtest Result」tRPC 端点。FE-4 页面仅有 validate/bump/compare/lifecycle，没有 run 端点。
- 因此 Run Workbench 与 Backtest Result 只能做**结构预留 + Empty State**（任务 §4/§5 明确要求不伪造数据）。

---

## 5. 已有 Contract / 类型权威源

### 5.1 传输契约（shared，前后端共享）
- `shared/researchContracts.ts`：`isoDateSchema`、`strategyDocumentSchema`（`z.custom` 透传）、`strategyBump/Compare`、`STRATEGY_LIFECYCLE_STATUS_VALUES`、`lifecycleTransitionInputSchema`、`researchDatasetBuildInputSchema`、`RESEARCH_DATASET_RPC_DEFAULTS`、`ResearchDatasetSummary`。
- `shared/dataHealthContracts.ts`：`GateStatus`(PASS/PENDING/FAIL)、`DomainHealth`、`DataHealthOverview` 等。

### 5.2 领域类型（后端权威，前端不得复制 schema）
- `server/research/strategySchema/types.ts` → **`StrategyDocument` 全字段已完整类型化**（可直接被前端 import 类型做 1:1 映射，无需自造结构）：

```ts
StrategyDocument {
  recordKind: "STRATEGY_DOCUMENT"; recordVersion: 1;
  strategyId, version, name, description?;
  universe: { universeId, members?, description? };
  entryRules: DeclaredRule[]; exitRules: DeclaredRule[]; riskRules: DeclaredRule[];
  positionSizing: { kind:"equal-weight",maxPositions } | { kind:"fixed-fraction",fraction,maxPositions } | { kind:"rank-weighted",maxPositions };
  parameters: { parameters: ResearchParameterDefinition[] };
  datasetVersion: string;
  executionAssumptions: { backtestConfig:{initialCapital,maxPositions?}, costModel:CostModel, executionModel:string };
  recipe?; metadata?; fingerprint: string;
}
DeclaredRule { id, kind:"threshold"|"time-based"|"state"|"event", description, field?, operator?:">="|">"|"<="|"<"|"=="|"!=", operand?:number|string|null, note? }
CostModel { commissionRate, stampDutyRate, transferFeeRate, slippageBps, lotSize, minCommission }
```

- `server/researchDataset/types.ts` → `DataSnapshot`、`UniverseDefinition`、`DomainSnapshot` 已完整类型化（字段见 §6.2）。
- `server/engine/domain.ts` → `CostModel`、`PerformanceMetrics`（`totalReturnPct`、`annualizedReturnPct`、`sharpeRatio`、`maxDrawdownPct`、`tradeCount`、`completedTradeCount`…）——Backtest Result UI 的指标**口径**已在后端定义。

### 5.3 关键纪律（前端不可违反，源自 `researchContracts.ts` 头注 + 各页面头注）
1. `dataSnapshot` / `universeDefinition` / `policySet` 在 shared 契约是 `unknown`（RPC 透传，**无第二份口径**）。
2. 前端**不得重算** fingerprint / gate / datasetVersion / lifecycle hash。
3. `validate` 只校验，fingerprint 是占位，真实指纹由后端序列化层重算。
4. rows 永不回传，只回 `rowCount`。
5. `dataReady=false` 时 gate 至多 INCONCLUSIVE。

---

## 6. 目标页面现状详析

### 6.1 StrategyEditor.tsx（FE-4，688 行）

现状结构：**单 Card + 3 个 Tabs**（策略编辑器 / 版本化 / 生命周期），全页 JSON-first。

| 区域 | 现状 | 问题（对应任务 §2/§3） |
|---|---|---|
| Header | 无独立 Header；只有 CardTitle + 说明 | 缺「名称/ID/版本/数据集/状态」摘要头；缺「保存/保存新版本/运行」操作条（§3.1） |
| 策略编辑 | `EditorTab`：`<Textarea>` 贴整段 JSON + 「载入模板」「校验文档」按钮 | **过度暴露 JSON**，无可视化条件编辑器（§2-1/2/3，§3.3） |
| 版本化 | `VersionTab`：bump（major/minor/patch）+ compare（左右两个 JSON Textarea） | 可用但 JSON 驱动 |
| 生命周期 | `LifecycleTab`：describe 状态机表 + transition 表单 | 可用；`statusBadgeClass` 是本地函数，未统一 |
| Run Workbench | **完全缺失** | 无运行区/回测配置/运行状态（§4） |
| Backtest Result | **完全缺失** | 无指标卡/曲线/交易记录（§5） |
| 数据源 | `TEMPLATE_DOCUMENT` / `TEMPLATE_LIFECYCLE_RECORD` 前端硬编码常量 | 非从后端加载，仅演示 |

**已确认可 1:1 映射**：`StrategyDocument` 类型完整，Entry/Exit/Risk rules 的 `DeclaredRule`（field/operator/operand）、`positionSizing`、`parameters`、`executionAssumptions.costModel` 全部有后端权威类型，可视化编辑器**可以且应当**直接映射，不改变 Contract。

### 6.2 DatasetBuilder.tsx（FE-3，692 行）

现状结构：左侧「构建配置」表单 + 右侧「构建结果」（`ResultOverview` + 3 Tabs：数据快照 / 9 类口径 / 成员决议）。

**后端真实返回的数据已具备**（`DataSnapshot` / `UniverseDefinition` 类型化）：

```
DataSnapshot {
  capturedAt, request:{startDate,endDate,asOfPerTradeDate,asOf,coreIndexCodes},
  calendarName, calendarFirstDate, calendarLastDate, tradingDays,
  domains: DomainSnapshot[],      // 每域：domain, rowsLoaded, securitiesCovered, datesCovered, datesExpected, note
  coverageGaps: string[]
}
UniverseDefinition { rule, asOfDescription, days: [{tradeDate,isTradingDay,members[],excludedByReason{}}] }
```

| 区域 | 现状 | 问题（对应任务 §2/§6/§7/§8/§9/§10） |
|---|---|---|
| 配置 | 表单字段齐全（name/起止/PIT/护栏/dataReady） | 未分「常用/高级」，无「Dataset Configuration → Source Validation → Build Pipeline → Build Summary → Diagnostics」纵向结构（§6） |
| Source Validation | 隐含在「数据快照」Tab 的域表里 | 无独立「每个数据源：状态/加载行数/验证行数/日期范围」卡片（§6.2） |
| Build Pipeline | **缺失** | 无 Source→Universe→Calendar→PIT→…→Final Dataset 诊断链（§7） |
| INCONCLUSIVE | `GateBadge` 只显示黄色字 | 无原因/解释/「查看诊断」联动（§8） |
| Source vs Final Rows | `SnapshotView` 域表 + `rowCount` 分散 | 无「Source Rows 55,XXX vs Final Rows 0」的显式对照，易误读（§9） |
| Build Summary | `ResultOverview` 仅 datasetVersion + gate + rowCount | 无汇总卡（Trading Days/Universe/Source Rows/PIT/DATA_READY/Duration）（§10） |
| 错误诊断 | 只显示 `build.error.message` 或 `gateNotes` | 无「状态码 + 用户解释 + 技术详情 + 建议」结构化错误（§11） |

---

## 7. 技术债与风险

### 7.1 技术债
1. **无 Adapter 层**：页面直接消费 tRPC 返回，`unknown` 字段靠页面内 `pickStr/pickNum/isRecord` 防御性取值（`DatasetBuilder.tsx` L54-115）。任务 §17 要求建立 `strategyAdapter / datasetAdapter / buildResultAdapter / runResultAdapter` 隔离。
2. **状态颜色 3 套并行**：无统一 `StatusBadge`（§12）。
3. **无公共展示组件**：`MetricCard / EmptyState / ErrorState / TechnicalDetails / DataTable / SectionCard` 均不存在，各处内联实现（§16）。
4. **页面信息层级扁平**：一级业务结果与三级工程字段（fingerprint/datasetVersion/hash）同屏平铺，无「技术详情」折叠（§13）。
5. **无前端单测**：`vitest.config.ts` 存在，但 200+ 个 `.test.ts` 全部在 `server/` 与 `shared/`，**`client/` 零测试**（§19 要求补至少 UI 逻辑测试）。
6. **无 Lint 脚本**：`package.json` 无 `lint`（有 prettier）。`check` = `tsc --noEmit`。
7. **TEMPLATE_DOCUMENT 前端硬编码**：演示数据源，非真实加载（§18 无伪造要求虽针对指标，但这里也需标注为「模板/演示」而非「真实策略」）。

### 7.2 风险（改造红线）
- **`unknown` 透传字段**：`dataSnapshot/universeDefinition/policySet` 在 shared 是 `unknown`；Adapter 必须保持防御性，**不得**为 UI 便利去「补全/猜测」结构，否则破坏「无第二份口径」铁律。
- **StrategyDocument 完整性**：可视化编辑器必须能 **无损往返** 全字段（含 `recipe`、`metadata`、`parameters`、`executionAssumptions`），不能只暴露 entry/exit/risk/position 就丢弃其余字段（否则视觉编辑 → JSON 往返会丢数据）。
- **fingerprint/hash 不重算**：JSON 模式下前端仍标注 fingerprint 为占位，真实指纹后端算。
- **Run/Backtest 无后端**：不得伪造收益率/Sharpe/回撤。只能 Empty State + 结构预留。
- **`/backtest`（legacy 组合回测）≠ 策略级 Run Workbench**：二者是不同物，不可混用其数据。

---

## 8. 与任务 §2 十二项问题的映射结论

| # | 问题 | 现状确认 | 改造方向 |
|---|---|---|---|
| 1 | 过度暴露 JSON | ✅ 确认 | 双模式（可视化默认 + JSON 高级） |
| 2 | 规则看不懂 | ✅ 确认 | 结构化条件表（字段/操作/数值） |
| 3 | JSON 占空间 | ✅ 确认 | 折叠进「高级模式」 |
| 4 | Run 区不突出 | ✅（Run 区根本不存在） | 新建 Run Workbench |
| 5 | INCONCLUSIVE 解释不足 | ✅ 确认 | 状态 + 原因 + 解释 + 诊断 |
| 6 | NO_ROWS_BUILT 认知冲突 | ✅ 确认 | Source vs Final 严格区分 |
| 7 | 原始/最终 rows 不清 | ✅ 确认 | 双区块对照 |
| 8 | 缺诊断链 | ✅ 确认 | Build Pipeline 可视化 |
| 9 | 信息层级不明显 | ✅ 确认 | 三级信息分层 |
| 10 | 技术字段混入业务 | ✅ 确认 | 「技术详情」折叠 |
| 11 | 空白多、核心权重不足 | ✅ 确认 | Layout + 权重重排 |
| 12 | 状态色不统一 | ✅（3 套并行） | 统一 StatusBadge |

---

## 9. 结论

- **基础极好**：shadcn/ui 完整、tRPC 契约清晰、`StrategyDocument`/`DataSnapshot`/`UniverseDefinition` 已完整类型化，足以支撑「可视化编辑器 1:1 映射」与「Dataset 诊断链」而不改后端。
- **主要工作量在前端信息架构**，不是后端重构（符合任务边界）。
- **两个硬前提**：① Run/Backtest Result 无后端 → 只做结构预留 + Empty State；② `unknown` 字段的 Adapter 必须防御性、不补全。
- **推荐执行顺序**（任务 §22 的 8 Phase，已在任务列表建立跟踪）：
  - Phase 1 现状审计（**本文件，已完成**）
  - Phase 2 公共组件 + Adapter 层
  - Phase 3 Strategy Editor 双模式改造
  - Phase 4 Dataset Builder 产品化
  - Phase 5 统一状态/错误/诊断系统
  - Phase 6 Run Workbench 结构预留
  - Phase 7 响应式/可用性打磨
  - Phase 8 全量回归（tsc + build + tests）

> 未破坏项承诺：本审计未改动任何源码；后续改造将遵循「不破坏后端 API Contract / 数据模型 / StrategyDocument / Dataset / PIT / Gate / Audit 语义」铁律，每 Phase 输出 §22 要求的 9 项报告。
