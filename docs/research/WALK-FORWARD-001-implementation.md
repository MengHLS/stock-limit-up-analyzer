# WALK-FORWARD-001 — Walk-Forward 验证完整闭环（最终报告）

> 编号 **`9bw`** ｜ 基线 **`v1.3.0` → `v1.4.0`** ｜ 日期 **2026-09-19** ｜ 状态 **COMPLETE**
>
> 本报告**只有一份**（规格 §24），并显式区分 **既有基线失败** 与 **本任务引入的新失败**。

---

## 1. Executive Summary

Walk-Forward 是**编排层**，不是新引擎：它按交易日滚动切窗，**每个 Fold 各自**在它自己的样本内窗口里
真实搜参数、冻结候选，再拿到**紧邻的、它没见过的**样本外窗口上**真实重跑回测并重算 canonical 指标**，
最后给出多 Fold 的**描述性**汇总。

**一句话结论**：链路 `历史数据 → IS Window → Parameter Search → 冻结候选 → 紧邻 OOS Window
→ 真实 Strategy Runtime + Backtest → OOS Metrics → 下一个 Window → 多 Fold 汇总 → Walk-Forward Result`
**已全链真实打通**，且**没有新建**任何 Backtest / Metrics / Strategy Runtime / Parameter Search Engine。

| 维度 | 结果 |
|---|---|
| 域层 | `server/research/walkForward/**` **11 文件** |
| 契约 | `shared/walkForwardContracts.ts`（zod + `z.infer` 同文件） |
| 持久化 | `drizzle/0044_walk_forward.sql` 两表（**33 / 36 列**、**0 FK**、**0 DML**、**0 ALTER**）+ `scripts/applyWalkForward.mjs`（三模式幂等） |
| API | **同域扩 6 端点**（零新 Router） |
| 前端 | `client/src/components/walkForward/WalkForwardPanel.tsx`（1051 行）+ 挂 `ParameterSearch.tsx` |
| 新增单测 | **84 / 84 PASS**（域 **48** + 静态边界 **36**） |
| 全量 vitest | **8 failed files / 17 failed tests = 基线，零新增** |
| `tsc --noEmit` | **exit 0** |
| `npm run build` | **exit 0**（`✓ 3042 modules transformed`、`dist/index.js 3.2mb`） |
| `checkEolDrift` | **0 漂移**（已跟踪 0 / 未跟踪 0） |
| 真实 TiDB E2E | `create` **7/7**、`run` **10/10**、**跨进程** `rerun` **11/11**、`clean` 归零 |
| 前端可达性 | DOM 探针 **`pass=true`**、**0 page error**、深链自渲染 |
| 验收标准 | 规格 §23 的 **28 项** 全满足 ⇒ **`WALK-FORWARD-001 = COMPLETE`** |

**本轮最值得记住的三件事**：

1. **镜像守卫有了第三方向**。`searchRobustness/**` 用 import **黑名单**（禁够到回测/评估端口，**零重跑**）；
   `oosValidation/**` 用 **必含清单**（必须够到 `createStrategyBacktestBridge` + `projectCanonicalMetrics`，**必须重跑**）；
   本域用**黑名单 + 「执行只能经由注入钩子」**——域层可以 import OOS **类型**（复用版本常量），
   但**不得**自行 import 回测/评估/闭环执行面，也**不得**自建第二套执行路径。
   三套守卫**互不可搬移**：把本域实现搬进 `searchRobustness/**` 会对侧测试立刻变红。
2. **执行靠注入，不靠自调用**：`WalkForwardExecutionHooks{ readCurrentContext, runFoldSearch, runFoldOos }`
   由组合根（`paramSearchRouter`）用**既有** PS / OOS application service 实现
   ⇒ **零复制策略 IO、零 HTTP 自调用**，规格 §15「禁 `WalkForward → HTTP → OOS API → HTTP → Backtest`」成立。
3. **杀掉了一个「被接受但从未生效」的死旋钮**：`createWalkForwardValidationInputSchema` 曾暴露
   `parameterSearchSpace`，实测**全仓只有 PS 端点与契约声明引用它**，WF 端点与钩子从不读
   ⇒ 从契约删除，并新增守卫**防再犯**（§13 无死旋钮）。

---

## 2. 规格 24 节逐条落点

| 规格 | 要求 | 落点 |
|---|---|---|
| §2 | 先审计现状，审计后**直接实现**不等确认 | 只读侦察 `docs/evidence/_probe_wf001_recon.mts`（4 条实测结论）→ 直接进实现 |
| §3 | 新增 `server/research/walkForward/**`；**不得复制** Backtest 执行逻辑 | 11 文件；执行面全走注入钩子，无一行回测/撮合代码 |
| §4 | Window Contract：`ROLLING` / `EXPANDING`；`isWindowDays`/`oosWindowDays`/`stepDays` 单位为**交易日个数**；硬约束 `isEnd < oosStart` 且 `oosStart = isEnd + 1 trading day` | `windowSchedule.ts`（复用既有 `generateWalkForwardSplits`）+ `WALK_FORWARD_WINDOW_CONFIG_INVALID` / `..._IS_OOS_NOT_ORDERED` |
| §5 | Fold 生命周期六态 + `FAILED` | `lifecycle.ts`：`WINDOW_CREATED→SEARCH_RUNNING→SEARCH_COMPLETED→CANDIDATE_FROZEN→OOS_RUNNING→OOS_COMPLETED`；`..._FOLD_STATUS_TRANSITION_INVALID` |
| §6 | Step A~E；**禁**新建 `WalkForwardMetrics` / `WalkForwardBacktestEngine` / `WalkForwardStrategyRuntime` | 规格 §22 禁建清单全文入静态守卫；执行面只调既有 service |
| §7 | **显式** Candidate Selection Policy；**禁**自动最佳/推荐/最优 Fold | `selection.ts` 两策略（`FIRST_ELIGIBLE_COMBINATION` / `EXPLICIT_PARAMETER_HASH`）；措辞守卫 |
| §8 | 持久化两表，**不加第三张表** | `walk_forward_run` + `walk_forward_fold`；E2E W14 断言「只写两表」 |
| §9 | TiDB Serverless；禁 `db:push` / `drizzle-kit generate`；手工幂等 migration + 独立 apply script；0 FK；soft references；不改历史数据；第二次执行安全 | `0044_walk_forward.sql` + `applyWalkForward.mjs`（`--check` / `--dry-run` / apply 三模式）；实测两次 apply 幂等 |
| §10 | 创建时冻结六项；不一致 ⇒ **FAIL LOUDLY** 不自动修复 | `run.ts#computeWalkForwardValidationRunFingerprint`；`WALK_FORWARD_STRATEGY_DEFINITION_DRIFT` / `..._DATASET_VERSION_DRIFT` |
| §11 | **Leakage Guard**（核心验收）4 条 + 明禁「先全量搜索再切 OOS」 | `leakage.ts`（见 §6） |
| §12 | Aggregate **只做描述性统计** | `aggregate.ts`；键里无 `best/worst/rank`（E2E W12 逐键断言） |
| §13 | 6 端点挂**现有** Router，不新建 Router | `server/paramSearchRouter.ts` +6 |
| §14 | 前端 Run List + Run Detail + Fold Matrix + 深链；**不加**最佳 Fold / 推荐参数排序或评级 | `WalkForwardPanel.tsx`；DOM 探针双轨禁词判据 |
| §15 | 优先复用 OOS-001 内部 domain/service executor；**禁** HTTP 自调用链 | 注入钩子由组合根实现（见 §9） |
| §16 | Determinism：同冻结配置 ⇒ 稳定 `schedule fingerprint` / fold 坐标；Candidate 的 DB 读取**必须明确排序** | `WALK_FORWARD_COMBINATION_ORDER_UNSTABLE`；E2E W11 + W15 |
| §17 | 真实 TiDB E2E，≥2 folds，**日期按数据集实际范围**，验证 12 条 | 14 条判据（规格 12 + W11 确定性 + W14 只写两表），实际 2 folds |
| §18 | 测试：Domain + Leakage(5 类 FAIL) + Freeze + Lifecycle + Persistence + E2E | 域 **48** + 边界 **36** = 84 |
| §19 | 静态边界：**禁** `WalkForward → SearchRobustness`；不得依赖独立 Backtest/Metrics 实现 | 边界测试三组守卫 |
| §20 | 性能：不得全量加载 Dataset、不得把全量 OHLC 拉进 Node 切 Window | 切窗只用交易日序列；回测在服务端既有引擎内按窗口进行 |
| §21 | 基线 `v1.3.0` → **`v1.4.0`**；更新 roadmap / baseline / task status / report / update log | 见 §15 与 §19 |
| §22 | 严格禁止清单 | 见 §13 风险节的自查表 |
| §23 | 28 项最终验收 | 见 §16 自评 |
| §24 | 只输出**一份**最终报告，区分既有失败与新失败 | 本文件；§12 显式区分 |

---

## 3. Existing Code Reuse（收敛而非新建）

| 复用对象 | 出处 | 复用方式 |
|---|---|---|
| 窗口几何生成 | 既有 `generateWalkForwardSplits(tradeDates, config)`（`rolling` / `anchored`） | **直接调用**，不重写切窗算法 |
| 交易日序列 | `index_daily`（唯一交易日历来源） | 只取**日期序列**，绝不把全量 OHLC 拉进 Node |
| 参数搜索执行 | PS application service（唯一参数搜索引擎） | 经 `hooks.runFoldSearch` 调用 |
| 样本外执行 | OOS application service（唯一「真重跑 + 真重算」端口） | 经 `hooks.runFoldOos` 调用 |
| 回测 / 撮合 | `server/backtest/**`（事实上的 Backtest Core，`simulator/engine.ts#runTradeSimulation`） | **间接**（经 OOS service），本域零回测代码 |
| canonical 指标 | `canonicalMetrics()` 唯一面 | **间接**（经 OOS service） |
| 版本常量 | `oosValidation/types` 的 `OOS_ENGINE_VERSION` / `OOS_METRICS_VERSION` | 只取**类型与常量**；守卫为此留**路径后缀级窄豁免**，并断言豁免面恰为 `["../oosValidation/types"]` |

**新建的东西只有**：编排状态机、窗口排程冻结与指纹、泄漏判定、候选选择策略、描述性汇总、
两表持久化、6 端点、1 前端面板、84 条测试、2 个证据脚本。

---

## 4. Domain Model

```
server/research/walkForward/
├── types.ts            (14186 B)  领域类型 + WalkForwardExecutionHooks（注入点）
├── windowSchedule.ts   (17077 B)  窗口排程：ROLLING/EXPANDING、坐标、双重指纹
├── lifecycle.ts         (8958 B)  Fold 六态状态机 + 迁移合法性
├── leakage.ts          (10299 B)  Leakage Guard（核心验收）
├── freeze.ts            (9070 B)  候选冻结：只认源组合行 + parameterHash 复核
├── selection.ts        (10472 B)  Candidate Selection Policy（显式、可描述、不择优）
├── aggregate.ts         (7279 B)  多 Fold **描述性**汇总
├── run.ts               (6929 B)  Run 身份与运行内容指纹（**FAIL LOUDLY** 判定）
├── persistence.ts      (21175 B)  两表读写（32/41 列映射、幂等 upsert）
├── executor.ts         (37688 B)  编排执行器（逐 Fold 串行；只经 hooks 触达执行面）
└── index.ts             (1461 B)  域内 barrel（**刻意不挂全域 `export *`**）
```

**barrel 纪律（本轮新增）**：本域有两个符号与既有 C-19.1 `server/research/walkForwardRun/**` 近同名
（`WALK_FORWARD_VALIDATION_RUN_ID_PREFIX = "WFV"` vs `WALK_FORWARD_RUN_ID_PREFIX = "WFA"`；
`WALK_FORWARD_VALIDATION_RUN_RECORD_KIND` vs `WALK_FORWARD_RUN_RECORD_KIND`）。
ESM 的 `export *` 遇同名导出**静默遮蔽**（不报错）⇒ 本域**提供域内 barrel，但一律按文件路径 import**，
不并入全域 `export *` 图。同一策略也用于 `oosValidation/**` / `searchRobustness/**`。

---

## 5. Leakage Guard（规格 §11，核心验收）

`leakage.ts` 的四条硬判据 + 「每 Fold 独立搜索」：

| # | 判据 | 领域码 |
|---|---|---|
| ① | `SearchEnd <= ISEnd`（搜索不得越出本 Fold 的 IS） | `WALK_FORWARD_SEARCH_WINDOW_EXCEEDS_IS` |
| ② | `ISEnd < OOSStart` 且顺序为正 | `WALK_FORWARD_IS_OOS_NOT_ORDERED` / `..._IS_OOS_OVERLAP` |
| ③ | `OOSEnd <= DatasetAvailableEnd` | `WALK_FORWARD_WINDOW_OUT_OF_DATASET_RANGE` |
| ④ | 搜索窗口==IS 窗口，搜索日期**非空且在 IS 内** | `WALK_FORWARD_SEARCH_DATES_OUTSIDE_IS` / `..._SEARCH_DATES_EMPTY` |
| ⑤ | **明禁**「先跑整个 Parameter Search 再把结果切成多 OOS Fold」⇒ 每 Fold 必须**独立搜索** | `WALK_FORWARD_SEARCH_NOT_INDEPENDENT`（E2E W4 断言 `sourceSearchRunId` **互不相同**） |

另有一道「未来函数」显式护栏：`WALK_FORWARD_FUTURE_DATA_LEAK`。

> 🔴 **诚实标注**：本域的 future-leak 防护是**几何级**（窗口不重叠 + 搜索不越界 + 每 Fold 独立搜索）。
> `STRATEGY-AUDIT-001` 已查明 `LeakageGuard` 对配方特征**恒通过**（`recipeRegistryAtoms.ts#samePointAvailability`
> 恒置 `1990-01-01`）⇒ **策略层没有独立未来函数防护**，安全性全靠**数据层 PIT**。本任务**未**改动该结论。

---

## 6. Window Schedule 与坐标（E2E 实测，非硬编码）

```ts
WINDOW_CONFIG = { startDate:"2025-01-02", endDate:"2025-06-30",
                  isWindowDays:40, oosWindowDays:25, stepDays:25,
                  windowMode:"ROLLING", maxFolds:2 }
SELECTION_POLICY = { kind: "FIRST_ELIGIBLE_COMBINATION" }
DATASET_VERSION_ID = 390002
```

| Fold | IS 窗口 | OOS 窗口 | 搜索 Run | OOS Run |
|---|---|---|---|---|
| #0 | `2025-01-02..2025-03-06` | `2025-03-07..2025-04-11` | `PSRUN-20260919-c5ff3d47` | `OOSV-20260919-56ede41d` |
| #1 | `2025-02-14..2025-04-11` | `2025-04-14..2025-05-21` | `PSRUN-20260919-39c9e094` | `OOSV-20260919-d8647bbc` |

- `scheduleFingerprint = e3451bfcb6e41f0d2464b6c6e40636ef8057f9080030ad8940ddedc30d8d2bd7`
- 日期**全部由真实交易日序列推导**（数据集 `390002` 可用区间 `2024-09-01..2026-09-01`；
  `2024-10-01..2025-06-30` 共 **178** 个交易日），**未硬编码任何不存在的日期**。
- `oosStart = isEnd + 1 个交易日` 由 W6 在**落库值**上核对（不是只在内存里算过）。

---

## 7. Candidate Freeze（规格 §6 Step C）

- 冻结信息 = **源 Search Run + `parameterHash`**；冻结参数集由服务端从**源组合行**读出，
  再**重算 `computeParameterHash` 复核**（E2E W9：库内 `32d942f7d755…` == 重算 `32d942f7d755…`）。
- 冻结参数集与组合行参数**语义相等**（按 key 排序比较，与 JSON 文本顺序无关）：
  `{"max_volume_ratio":1}` == `{"max_volume_ratio":1}`。
- 冻结不足 ⇒ **显式失败**（`WALK_FORWARD_CANDIDATE_RESULT_MISSING` / `..._EXPLICIT_CANDIDATE_NOT_FOUND` /
  `..._EXPLICIT_CANDIDATE_NOT_ELIGIBLE` / `..._NO_ELIGIBLE_CANDIDATE` / `..._CANDIDATE_RESULT_MISSING`），
  **禁**回读**当前**策略版本补全。
- Candidate DB 读取**必须明确排序**：`WALK_FORWARD_COMBINATION_ORDER_UNSTABLE`。

---

## 8. Database（规格 §9）

| 项 | 实测 |
|---|---|
| 表 | `walk_forward_run`（**33 列**）、`walk_forward_fold`（**36 列**） |
| 外键 | **0**（soft references） |
| DML | **0**（`0044_walk_forward.sql` 内零 INSERT/UPDATE/DELETE/TRUNCATE/DROP） |
| ALTER | **0** |
| 唯一约束 | `uq_walk_forward_run_id`（`walkForwardRunId`）⇒ 重放幂等收敛为一行；`(walkForwardRunId, foldIndex)` ⇒ 重执行覆盖同一 Fold，不堆重复 |
| 冻结列 | `scheduleJson` 冻结整份窗口排程；另有策略定义指纹 / `datasetVersionId` / `selectionPolicy` / `engineVersion` / `metricsVersion` |
| apply 脚本 | `scripts/applyWalkForward.mjs`：`-- @guard:` + 零 DML 静态断言 + **列签名逐列比对** + **索引比对** + 0 FK 校验；三模式 `--check` / `--dry-run` / apply；**第二次执行安全**（实测二次 apply 无副作用） |

> 🔴 **未做** `db:push`、未跑 `drizzle-kit generate`、未手写 `_journal.json`、未改任何历史数据。
> 迁移以**手工幂等 SQL + 独立 apply 脚本**落地。

---

## 9. Execution Flow（规格 §6 / §15）

```
paramSearchRouter (组合根)
   │  用【既有】PS / OOS application service 实现三个钩子
   ▼
WalkForwardExecutionHooks { readCurrentContext, runFoldSearch, runFoldOos }
   │
   ▼
walkForward/executor.ts   ← 逐 Fold 串行编排（零回测代码、零 HTTP 自调用）
   │
   ├─ Fold i : 校验窗口（leakage）→ hooks.runFoldSearch(该 Fold 的 IS 窗口)
   │            → 冻结候选（源组合行 + parameterHash 复核）
   │            → hooks.runFoldOos(紧邻 OOS 窗口, 冻结参数)
   │            → 读 canonical 指标 → 落 walk_forward_fold
   ▼
多 Fold 全部走完 → aggregate（描述性）→ 落 walk_forward_run
```

**为什么必须注入**：规格 §15 明禁 `WalkForward → HTTP → OOS API → HTTP → Backtest`。
注入钩子让**执行依赖在一个明确的接缝上被反转**：域层只知道「有个函数能跑搜索 / 能跑样本外」，
不知道它们背后是谁。因此静态守卫可以**同时**钉死两件事：
域层**不得** import 回测/评估/闭环执行面（黑名单），且**执行只能经由 `hooks`**（唯一通路）。

**幂等**：`COMPLETED` 后重复 `start` ⇒ `executed=false`，不重跑不重算（同一进程内 W13；
**换进程** W15）。实测二次执行耗时 **7 s**（首次 **193 s**）。

---

## 10. API（规格 §13，6 端点，零新 Router）

| # | 端点 | 作用 |
|---|---|---|
| 1 | `createWalkForwardRun` | 只冻结：排程 + 身份 + 六项坐标（**不跑任何回测**） |
| 2 | `listWalkForwardRuns` | 列表 |
| 3 | `getWalkForwardRun` | Run 详情（含 `schedule` / `aggregate` / `folds`） |
| 4 | `getWalkForwardFold` | 单 Fold 详情（逐 Fold 可追溯） |
| 5 | `startWalkForwardRun` | **执行**（逐 Fold 真实搜索 + 真实样本外） |
| 6 | `cancelWalkForwardRun` | 取消（在**下一个 Fold 边界**生效） |

**`create` 与 `start` 必须分开**（与 OOS-001 同一纪律）：创建只冻结、不消耗算力；
这样「先冻结后执行」可被独立验证，也让 E2E 能拆成 `create` / `run` 两段。

---

## 11. Frontend（规格 §14）

`client/src/components/walkForward/WalkForwardPanel.tsx`（**1051 行**），挂在 `/parameter-search`：

- **创建表单**：`#wf-strategy-id` / `#wf-strategy-version` / `#wf-dataset-version-id` / `#wf-window-mode` /
  `#wf-start-date` / `#wf-end-date` / `#wf-is-days` / `#wf-oos-days` / `#wf-step-days` / `#wf-max-folds` /
  `#wf-selection-kind` / `#wf-parameter-hash`；按钮 `#wf-create-button`。
  单位提示写明「窗口长度与步长的单位是**交易日个数**，不是日历天」。
- **Run 列表**（`tr[data-run-id]`）：进度 `完成 N · 失败 M`。
- **Run 详情**：窗口排程（创建时冻结）含 `scheduleFingerprint` / `tradeDatesFingerprint` /
  候选选择策略 / 逐 Fold 窗口清单 + `Fold 矩阵（按序号升序 · 不排序、不评级）`（`tr[data-fold-index]`）。
- **Fold 详情**（`[data-fold-detail]`）：该 Fold 的搜索 Run / 样本外 Run / 候选组合序号 + 冻结 hash /
  冻结参数集 / 读数来源 / IS×OOS 六项对照。
- **多 Fold 汇总**：五个计数（总数 / 完成 / 成交不足 / 失败 / 计入统计）+ 六行指标表
  （IS 均值 / IS 中位数 / OOS 均值 / OOS 中位数 / 可用 Fold / IS 观测区间 / OOS 观测区间）
  + 诚实空态说明「可用 Fold 为 0 时所有统计量显示「—」，不会退化成 0」。
- **深链**：`?walkForwardRunId=…&foldIndex=…`，刷新 / 分享后**连 Fold 选中一起还原**。
- **长请求换文案**：`#wf-start-button` pending 时显示「执行中…（逐 Fold 真实回测，分钟级）」。
- `null` 一律显示「—」，**不用 0 顶替**。

`INSUFFICIENT_TRADING_ACTIVITY` 显示为「成交不足（无可评判读数）」——**不是失败**，界面不渲染成红色错误。

---

## 12. Real E2E Evidence（规格 §17，禁 mock）

脚本 `docs/evidence/_e2e_walk_forward.mts`（约 1200 行），**真实 tRPC caller + 真实 TiDB + 真实回测**。
六模式：`create` / `run` / `full` / `verify` / `rerun` / `clean`；结论**按模式落盘**以免相互覆盖。

### 12.1 坐标来源（先用只读侦察探针实测，不猜）

`docs/evidence/_probe_wf001_recon.mts` 四条硬事实：

1. 数据集 `390002` 可用区间 `2024-09-01..2026-09-01`；`2024-10-01..2025-06-30` 有 **178** 个交易日。
2. 模板 `cand-360001@1.0.0` 有 3 个 TUNABLE；但 **`entryRuleGraph` 引用参数 = `[]`**。
3. 不传引用筛查 ⇒ `MAX_COMBINATIONS_EXCEEDED`（**1240 > 256**）；带引用筛查 ⇒
   `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`。
4. 参数声明在 `definition.parameters[]`（**不是** `definition.parameterSpace`）。

⇒ 结论：**要真搜参数，必须自建一个「规则图确实引用该参数」的策略版本**，这正是探针
`ensureOwnStrategy()` 做的事（克隆模板 → 把 `volume` 倍数条件改成
`bar.volumeRatio <= max_volume_ratio` 的 `PARAMETER_REFERENCE`，并自检规则图引用）。
参数域取 `{ min: 1, max: 1.75, step: 0.75 }`（**从 `{0.3,1,0.7}` 抬上来的**，理由见 12.5）。

### 12.2 阶段一 `create`：**7/7 PASS**

W1 未执行任何搜索/样本外（PS 3→3、OOS 0→0、Fold 全 `WINDOW_CREATED`、Run `CREATED`）、
W1b 两表有行（run=1/fold=2）、W2 窗口几何与落库一致、W3 六项冻结坐标齐备、
W11 同配置副 Run（`WFV-20260919-866b80c2`）指纹一致（确定性）、W12a 未执行时 `aggregate = null`（诚实空态）。

### 12.3 阶段二 `run`：**10/10 PASS**（耗时 **193 s**）

| 判据 | 结论 |
|---|---|
| W4 | 两 Fold 的 `sourceSearchRunId` **互不相同** ⇒ 每 Fold 独立搜索（§11 明禁项被证伪） |
| W5 | 落库搜索窗口 **==** `isStart..isEnd`（Fold#0 `2025-01-02..2025-03-06`；Fold#1 `2025-02-14..2025-04-11`） |
| W6 | 落库 OOS 窗口 **==** `oosStart..oosEnd`，且其源搜索窗口 == IS、`oosStart > isEnd` |
| W7 | 两个 OOS Run **真实存在**且 `status = COMPLETED`（真跑，不是伪造读数） |
| W8 | `oosMetricsSource = canonical` 且 **OOS 撮合指纹 ≠ 该 Fold IS 候选的撮合指纹** |
| W9 | 冻结 `parameterHash` 与组合行**重算**逐字节相等；冻结参数集与组合参数语义相等 |
| W10 | 策略定义指纹 / 数据集坐标在 Run 行与**每个 Fold 行**逐字节一致，且与副 Run 一致 |
| W12 | 汇总**只做描述性统计**：生命周期计数与结果计数**各按自己的字段**核对；键里无 `best/worst/rank` |
| W13 | 同进程重复执行 ⇒ `executed=false`，Fold 行逐字节不变 |
| W14 | **只写两表**：`parameter_search_run +2`、`oos_validation_run +2`、`walk_forward_run 2→2` |

**W8 是「真在不同数据上重跑」的主判据**：

| Fold | IS 撮合指纹 | OOS 撮合指纹 |
|---|---|---|
| #0 | `ad5f8dd3979c99fe…` | `e2f3665dec24c3ae…` |
| #1 | `c6f112eb801297ff…` | `38f49a283cac4d50…` |

> 🔴 用**撮合指纹差异**而不是**指标差异**当主判据：`tradeCount = 0` 时两侧指标天然相等
> （Fold#1 的 IS 就是 0 笔），只比指标会误判成「没重跑」。

**实测指标（仅如实呈现，不做好坏结论）**：

| Fold | 侧 | 总收益 % | 年化 % | 最大回撤幅度 % | 完成交易数 | 胜率 % | 盈亏比 |
|---|---|---|---|---|---|---|---|
| #0 | IS | −10.36 | −50.67 | 10.54 | 8 | 50.00 | 0.172 |
| #0 | OOS | +7.30 | +109.52 | 3.99 | 2 | 50.00 | 3.179 |
| #1 | IS | −3.65 | −21.34 | 3.65 | 0 | — | — |
| #1 | OOS | +21.66 | +683.70 | 0.30 | 1 | 100.00 | — |

汇总：`foldCount=2`、`completedFoldCount=2`、`insufficientTradingActivityCount=0`、
`failedFoldCount=0`、`contributingFoldCount=2`。

### 12.4 阶段三 跨进程 `rerun`：**11/11 PASS**（耗时 **7 s**）

**换一个进程**再执行同一个已 `COMPLETED` 的 Run（新判据 **W15**）：

```
执行前：parameter_search_run=5  oos_validation_run=2  walk_forward_run=2
执行完成，耗时 7 s  executed=false  status=COMPLETED
· 该 Run 已是 COMPLETED ⇒ 幂等返回（不重跑、不重算，规格 §12 / §17.11）。
W15 PASS  executed=false  status=COMPLETED  耗时 7 s
W14 PASS  parameter_search_run +0（期望 +0）  oos_validation_run +0（期望 +0）
```

W4~W12 全部在新进程里**逐条复现一致**（含四条撮合指纹）。

> 🔴 **W13 与 W15 不可互相替代**：W13 在**同一进程**内连调两次；W15 要求**换进程**。
> 若「已完成」的判定依赖模块级缓存 / 内存态，W13 会绿、W15 会露馅（重新真跑一遍分钟级回测）。

### 12.5 `clean`：幂等归零

`WF001_MODE=clean` **以 DB 为准**：按 `strategyId = 自建 id` 收录该前缀下**全部** Run（跨进程
`ownStrategyCreated` 可能为 `false`，不能据此判断）；策略删除只看 **id 硬前缀**。
实测两轮均归零：`walkForwardRun:0 / walkForwardFold:0 / strategies:0 / strategyVersions:0`。

> 🔴 **本轮真踩（探针缺陷，非产品缺陷）**：`run` 第一轮 7/10，FAIL = W9/W10/W12，逐条核实后**全是探针自身缺陷**：
> - **W9 根因**：`OWN_STRATEGY_ID` 用 `Date.now()` 生成 ⇒ `run` 阶段（**新进程**）重算 `parameterHash` 时
>   **用错了 strategyId**（`computeParameterHash` 的 `strategyVersionId` 参与哈希）⇒ 哈希必然不等。
>   修法：`ownStrategyId` 跨阶段**从状态文件解析**（环境变量 > 状态文件 > 新生成）。
> - **W10 根因**：同上。Run 行的 `strategyId` 是 `create` 阶段生成的旧 id，比对必然失败。
>   修法：`resolveOwnStrategyId(state)` + 把 W10 重写为「Run 行与逐 Fold 行自洽 + 与副 Run 一致」。
> - **W12 根因**：把 `completedFoldCount` 错当成 `SUCCEEDED` 计数。读 `aggregate.ts` 确认
>   `completed = folds.filter(f => f.status === "OOS_COMPLETED")`、
>   `contributing = folds.filter(f => f.outcome === "SUCCEEDED")` ⇒ 实测 `completed=2 / contributing=0`
>   是**正确**行为。修法：W12 **分别按生命周期字段与结果字段**核对。
> - **附带发现（非缺陷）**：首轮选中的候选是 `{"max_volume_ratio":0.3}`（参数域下界），两个 Fold 都 0 成交
>   ⇒ 汇总退化为「无贡献」。已把参数域抬到 `[1, 1.75]` 以取得有经济学含义的对照。

### 12.6 前端可达性（量 DOM，不截图）

`docs/evidence/_probe_walk_forward_dom.mjs` ⇒ **`pass=true` / 0 page error**：

- 面板锚点 `Walk-Forward 验证（时间滚动编排）· WALK-FORWARD-001` 唯一；
- 创建表单 **9 个输入位**（`input[id^="wf-"]`）+ 窗口模式 / 选择策略（`<select>`）+ 交易日单位提示；
- 等**列表查询落地**（Run 行 > 0 且至少一条「已完成」），点行打开详情 ⇒ 窗口排程 + 两条指纹 +
  选择策略 + Fold 窗口清单 + Fold 矩阵（2 行）；
- 点 Fold 行 ⇒ Fold 详情（逐 Fold 可追溯五项齐备）；
- **深链** `?walkForwardRunId=…&foldIndex=0` **无需点击**即渲染详情**且 Fold 选中一并还原**；
- **负向双轨**：`forbiddenInFreeText=[]`（自由文本里的禁词只能出现在否定句）
  + `forbiddenOnVerdictSurfaces=[]`（标题 / 表头 / 按钮 / 徽标上一律不得出现）；
- **作用域自证**：`rootDataSlot="card"`、`rootHasOosCreateButton=false`、
  `rootTextLen` 随详情展开 800 → 2593 → **4328** 增长（证明量的是本面板，不是整页）；
- 探针**只读**：`neverClickedWriteButtons=true`（绝不点 `#wf-create-button` / `#wf-start-button`）。

---

## 13. Tests（规格 §18）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `tests/server/research/walkForward/walkForward.test.ts` | **48** | Domain / Leakage（5 类 FAIL）/ Freeze / Lifecycle / Persistence / 窗口几何 / 选择策略 / 汇总 / 幂等 |
| `tests/server/research/walkForward/walkForwardBoundary.test.ts` | **36** | 静态边界：import 黑名单 + 豁免面最小 + 「执行只能经由 `hooks`」+ 命名不遮蔽 + §9 DB 纪律（语句起点判 DML）+ §13 无死旋钮 + §14 前端 |
| **合计** | **84 / 84 PASS** | |

**全量对照**：`vitest run` = **8 failed files / 17 failed tests**（283 文件 / 4805 用例）。
失败文件集合 = 既有基线 8 个，**无一含 `walkForward`**：

```
tests/server/image.uploadAndRecognize.test.ts
tests/server/dataHealth.test.ts
tests/server/researchCore/candidates.updateBoundary.test.ts
tests/server/limitUp.test.ts
tests/server/tushare.secret.test.ts
tests/server/limitUp.watch.test.ts
tests/server/marketData.test.ts
tests/server/tushareTradingCalendar.test.ts
```

> ✅ 判据是失败**文件集合**（先剥 ANSI）而非数字：**新失败 = 0**。

**本轮守卫抓到的 4 个真问题**（全部是守卫有效，而不是守卫误报）：

| # | 守卫 | 真相 | 修法 |
|---|---|---|---|
| ① | import 黑名单 | `walkForward/types.ts` 引用 `../oosValidation/types`（只取两个版本常量 = 规格要求的复用） | 加**路径后缀级窄豁免** `/oosValidation/types`，并**断言豁免面恰为 `["../oosValidation/types"]`** |
| ② | 措辞守卫 | `selection.ts` 的**字符串字面量**里含「最优」（`describeSelectionPolicy` 返回串；`stripComments` 剥不掉字符串） | 改写为「不读取任何指标 ⇒ 不存在按表现挑选的语义」 |
| ③ | §9 DB 纪律 | `0044_walk_forward.sql` 命中 `UPDATE `（实为 `ON UPDATE CURRENT_TIMESTAMP` **列定义**，属 DDL） | 检测器改为**语句起点**判定（`(?:^|;)[ \t]*(INSERT\|UPDATE\|…)\b`）+ **负例自测** |
| ④ | 命名不遮蔽 | `computeWalkForwardRunFingerprint` 与 C-19.1 `walkForwardRun/serialize.ts` **真实重名**（barrel 会静默互相遮蔽） | 改名 `computeWalkForwardValidationRunFingerprint`（类型同步改 `WalkForwardValidationRunFingerprintInput`） |

**本轮修正的真实产品缺陷（1 个）**：`parameterSearchSpace` 是**被接受但从未生效**的死旋钮 ——
`grep -rn parameterSearchSpace` 只命中 `paramSearchRouter.ts:1259`（PS 端点）与契约声明，
**WF 端点与钩子从不读它**。已从 `createWalkForwardValidationInputSchema` **删除**，
并新增 §13 守卫（断言每个创建键都在域执行器或 Router 端点段里被读到）**防再犯**。

---

## 14. Known Risks

| # | 风险 | 现状 | 处置建议 |
|---|---|---|---|
| 1 | **全仓库 11 个既有策略版本的规则图都不引用任何 TUNABLE 参数** | 搜历史候选**必被拒**（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`） | 要真搜参数必须**自建含参数引用的新版本**（E2E 已演示）。**属既有结构性事实，非本任务引入** |
| 2 | 参数组合数上限 `MAX_COMBINATIONS_EXCEEDED`（默认 **256**，**禁截断**） | 目标 `cand-360001@1.0.0` 的 3 个 TUNABLE 笛卡尔积 1240 超限 | 用**引用筛查**收窄到真正参与决策的参数；或缩小步长网格 |
| 3 | `LeakageGuard` 对配方特征**恒通过** | 策略层**无**独立未来函数防护，安全全靠数据层 PIT | 已在 §5 诚实标注；修 `available` 语义属独立任务 |
| 4 | 运行级复现快照缺失 | `strategy_versions.codeVersion` 实测 **11/11 = `1.0.0+gunknown`** | 已由 W10 断言「六项冻结坐标在 Run 与逐 Fold 行逐字节一致」**部分**兜住；完整运行级复现属独立任务 |
| 5 | 折叠间**参数不共享**（规格 §11 强制每 Fold 独立搜索） | 这是**设计要求**，不是缺陷；但会让 Fold 间指标不可直接相加 | 汇总只做描述性统计，**不做**跨 Fold 参数比较 |
| 6 | 长算期间不碰 DB ⇒ 结束时单次 `insert` 必失败 | 已有界重试 ≤3 次（**不抛**）；实测 `run` 段 193 s 一次成功 | 保持；长算探针支持 `WF001_VERIFY_ONLY=1` |
| 7 | 取消只在**下一个 Fold 边界**生效 | 设计如此（逐 Fold 串行） | 界面文案已写明 |

---

## 15. Deferred Items / 范围外（规格 §19 / §22）

**未做且按规格不该做**：未新建 Backtest / Metrics / Strategy Runtime / Parameter Search Engine；
未复制 OOS Engine；未改任何历史结果；未自动推荐参数；未自动选最佳策略；未做策略评级；
未隐藏 best-candidate；未使用未来数据；未「先全量搜索后切 OOS」；未 `db:push`；未 `drizzle-kit generate`；
未加 FK；**未再拆 `WALK-FORWARD-001.x`**。

**范围外但已记录**：跨 Fold 参数一致性检验、基于 Walk-Forward 结果的自动晋级（应属独立任务且有伦理风险）、
`LeakageGuard` 语义修复（见 §14 风险 3）。

---

## 16. Architecture Baseline Changes

基线 `v1.3.0` → **`v1.4.0`**（minor：新增 Domain 模块 + 2 表 + 1 契约 + 6 端点 + 1 前端面板，
既有执行链与核心契约**零破坏**）。已同步 **9 份**架构文档：

| 文档 | 更新 |
|---|---|
| `SYSTEM-BASELINE.md` | 版本行 + **新增「WALK-FORWARD-001 增量」节** |
| `system-manifest.yaml` | `walkForward` 域（sourcePaths / entryPoints / persistence / router / contract / tests / knownRisks） |
| `DOMAIN-MAP.md` | **§16** WALK-FORWARD-001 增量（含与 §7 / §15 的**三方并列**对照表：零重跑 / 必重跑 / 注入式编排） |
| `DATA-FLOW.md` | **D-91** WALK-FORWARD-001 数据流 |
| `EXECUTION-FLOW.md` | **E-92** Walk-Forward 执行链 + 注入钩子接缝 + 镜像守卫说明 |
| `DATABASE-MAP.md` | **D-93**（两表 33/36 列 + 约束遵守） |
| `CONTRACT-MAP.md` | **C-93**（契约纪律） |
| `DEPENDENCY-MAP.md` | **D-91** 新增边 + 第三方向镜像边 + 写入面白名单 + 命名不遮蔽纪律 |
| `CHANGE-AUDIT.md` | 新增 `2026-09-19 · WALK-FORWARD-001` 条目 |

**ROADMAP 三件套**：§44 覆盖式（只保留最近 1 条「上轮实查」，旧条目零改写）、
§44.5 队列（新增 `9bw.` 已完成项）、§47 append-only → `ROADMAP-CHANGELOG.md`。
**编号取号依据 = 台账行**「已用至 `9bv` ⇒ **下一个未占用 = `9bw`**」（**非「末条 +1」**）；
文件头铁律行与台账行**两处同步**。

---

## 17. 完成标准自评（规格 §23，28 项）

| # | 标准 | 自评 | 依据 |
|---|---|---|---|
| 1 | 链路全链真实打通（IS→Search→Freeze→OOS→Metrics→下一窗→汇总） | ✅ | E2E `run` 10/10 |
| 2 | 每 Fold **独立**搜索，不得先全量搜索后切 OOS | ✅ | W4（`sourceSearchRunId` 互不相同）+ `WALK_FORWARD_SEARCH_NOT_INDEPENDENT` |
| 3 | `SearchEnd <= ISEnd` | ✅ | W5 + 单测 Leakage |
| 4 | `ISEnd < OOSStart`（且为「紧邻下一个交易日」） | ✅ | W6 |
| 5 | `OOSEnd <= DatasetAvailableEnd` | ✅ | `windowSchedule.ts` + 单测 |
| 6 | 候选显式冻结（源 Run + hash + 复核），不足即失败 | ✅ | W9 |
| 7 | 显式 Candidate Selection Policy，禁自动最佳 | ✅ | `selection.ts` 两策略 + 措辞守卫 + DOM 双轨 |
| 8 | 不新建任何 Backtest / Metrics / Runtime / Search Engine | ✅ | 静态守卫 + 代码面无回测实现 |
| 9 | 不复制 OOS Engine（走注入钩子） | ✅ | §9 接缝 + 守卫「执行只能经由 hooks」 |
| 10 | 两表持久化，无第三张表 | ✅ | W14 |
| 11 | TiDB Serverless 纪律（0 FK / 手工幂等 migration / 无 `db:push`） | ✅ | §8 实测 0 FK / 0 DML / 0 ALTER |
| 12 | 创建时冻结六项，不一致 FAIL LOUDLY 不自动修复 | ✅ | W10 `drift` 六项全 true |
| 13 | Fold 六态生命周期 + 非法迁移被拒 | ✅ | `lifecycle.ts` + 单测 |
| 14 | fold 计数 / 结果计数**各自口径**诚实 | ✅ | W12（生命周期 `OOS_COMPLETED=2` / 结果 `SUCCEEDED=2`） |
| 15 | 汇总只做描述性统计，无 best/worst/rank 键 | ✅ | W12 逐键断言 |
| 16 | 6 端点挂现有 Router，零新 Router | ✅ | §10 |
| 17 | 前端可达 + 可深链（含 Fold 还原） | ✅ | DOM 探针 `pass=true` |
| 18 | 前端无排序 / 评级 / 择优语义 | ✅ | DOM 双轨禁词 + 静态守卫 |
| 19 | 无死旋钮（每个创建键都被真实读取） | ✅ | §13 守卫（本轮抓到并删除 `parameterSearchSpace`） |
| 20 | 确定性：同冻结配置 ⇒ 稳定指纹 / 坐标 | ✅ | W11 + **W15 跨进程** |
| 21 | Candidate DB 读取明确排序 | ✅ | `WALK_FORWARD_COMBINATION_ORDER_UNSTABLE` |
| 22 | 不污染源（只写两表 + 自己的子 Run） | ✅ | W14 计数 |
| 23 | 禁 `WalkForward → SearchRobustness` | ✅ | 边界守卫 |
| 24 | 性能：不全量加载 Dataset / 不拉全量 OHLC 切窗 | ✅ | 只取交易日序列 |
| 25 | 真实 TiDB E2E ≥2 folds 且日期按实际范围 | ✅ | 178 交易日实测；2 folds |
| 26 | 测试全覆盖（Domain/Leakage/Freeze/Lifecycle/Persistence/E2E） | ✅ | 84/84 + E2E |
| 27 | 不引入新的测试失败 | ✅ | 全量 8 文件 / 17 用例 = 基线 |
| 28 | 基线 `v1.3.0 → v1.4.0` 且五份文档同步 | ✅ | §16 |

**28 / 28 达成 ⇒ `WALK-FORWARD-001 = COMPLETE`。**

---

## 附：本任务交付物清单

### 生产代码

| 路径 | 说明 |
|---|---|
| `server/research/walkForward/{types,windowSchedule,lifecycle,leakage,freeze,selection,aggregate,run,persistence,executor,index}.ts` | 域层 **11 文件** |
| `shared/walkForwardContracts.ts` | 契约（zod + `z.infer` 同文件） |
| `drizzle/0044_walk_forward.sql` | 手工幂等 migration（两条 `CREATE TABLE IF NOT EXISTS`；33/36 列、0 FK） |
| `scripts/applyWalkForward.mjs` | 幂等应用脚本（`-- @guard:` + 零 DML 静态断言 + 列签名/索引比对 + 0 FK） |
| `client/src/components/walkForward/WalkForwardPanel.tsx` | 前端面板（1051 行） |
| `server/paramSearchRouter.ts` | **+6 端点**（零新 Router）+ 注入钩子的组合根实现 |
| `drizzle/schema.ts` | **+2 表** |
| `client/src/pages/ParameterSearch.tsx` | 挂载面板 |

### 测试

| 路径 | 例数 |
|---|---|
| `tests/server/research/walkForward/walkForward.test.ts` | **48** |
| `tests/server/research/walkForward/walkForwardBoundary.test.ts` | **36** |

### 证据

| 路径 | 用途 |
|---|---|
| `docs/evidence/_e2e_walk_forward.mts` | 真实 tRPC + TiDB 端到端（六模式） |
| `docs/evidence/_e2e_walk_forward.out.{txt,json}` | `create` 7/7 + `run` 10/10 |
| `docs/evidence/_e2e_walk_forward.rerun.out.{txt,json}` | **跨进程** 11/11（W15） |
| `docs/evidence/_e2e_walk_forward.clean.out.{txt,json}` | 归零 |
| `docs/evidence/_e2e_walk_forward.state.json` | 跨阶段交接坐标（含 `ownStrategyId`） |
| `docs/evidence/_probe_wf001_recon.mts` | 施工前只读侦察（4 条实测结论） |
| `docs/evidence/_probe_walk_forward_dom.mjs` + `.out.json` | 前端可达性（量 DOM） |

---

## 附：本任务真踩到的工程教训（供后续复用）

1. 🔴 **同一文件并行发多个 `Edit` 会静默丢改动** —— 必须**串行**，且改完 `grep` 回读复核。
2. 🔴 **在模板字符串内部写注释时不得出现反引号** —— 会把模板串提前闭合、造成语法错误；
   而**探针语法错误时旧产物仍在**，极容易把 stale `*.out.json` 当成新结论读。
   ⇒ 每写完证据脚本先 `node --check`，且**必须先确认 stdout 有内容**再解析产物。
3. 🔴 **探针作用域必须收窄到被测面板子树** —— 同页多面板时，兄弟面板的**免责文案本身就含禁词**
   （如参数搜索面板「不产出「最佳参数」结论」）⇒ 整页扫会把别的域判成本域违规；
   同理 `table tbody tr` 会把兄弟面板的指标表一起数进来（实测 6 → 12）。
   **收窄后必须自证**（`rootDataSlot` / `rootHasOosComponent` / 文本长度随交互增长）。
4. 🔴 **禁词扫描要区分「否定式免责」与「肯定式结论」** —— 本面板渲染的服务端 notes 原文即
   「也不称任何 Fold 为「最好 / 最差」」⇒ 裸扫会把**正确的免责声明**判成违规。
   双轨判据（自由文本须为否定句 + 结论承载面一律不得出现）才能真正钉住语义。
5. 🔴 **FAIL 必须先分类「探针缺陷 vs 产品缺陷」再动手** —— 本轮连续 4 次证明该分类法的价值：
   E2E 首轮 3 条 FAIL 与 DOM 首轮 2 条 FAIL **全是探针缺陷**，产品行为正确。
   放宽守卫是最坏选择。
