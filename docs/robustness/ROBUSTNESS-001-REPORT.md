# ROBUSTNESS-001 — Parameter Search 结果稳健性分析完整实现（最终报告）

> **状态**：`ROBUSTNESS-001 = COMPLETE`
> **编号**：`9bu` ｜ **日期**：`2026-09-19` ｜ **基线**：`v1.1.1 → v1.2.0`（minor）
> **证据目录**：`docs/evidence/`（探针与结论 JSON 均已登记在 `docs/evidence/README.md`）

---

## 1. Executive Summary

### 1.1 做了什么

在 `robustness:` 域下新增**第三个并列子模块** `server/research/searchRobustness/**`（11 文件），
对**已经算完**的 Parameter Search 结果做**冻结快照上的邻域稳定性分析**：

```text
Parameter Search（已跑完，4 组合）
        ↓  只读消费（Validity Gate）
冻结快照（参数空间 + FIXED 坐标 + 评估配置指纹，原样继承）
        ↓  纯函数分析
稳定性 / 敏感性 / 六指标邻域离散度 / 二维稳定性矩阵
        ↓  落库
search_robustness_run / _result / _parameter_analysis
        ↓
前端面板（含深链 ?robRunId=）
```

### 1.2 为什么是「并列」而不是改 `robustness/**`

`robustness:` 域下现在有**三个语义互不重叠**的模块：

| 模块 | 语义 | 是否重跑 | 落库 |
|---|---|---|---|
| `robustness/**`（C-18.1） | 成本/滑点/参数/执行**四轴扰动重估** | ✅ 注入式 evaluator ⇒ 重跑 | ❌（内存态 `ROBUSTNESS_RUN`） |
| `stochasticRobustness/**`（C-18.2） | Monte Carlo / Bootstrap / 成交顺序随机化**重估** | ✅ | ❌ |
| **`searchRobustness/**`（本任务）** | **冻结 Search 结果上的邻域稳定性分析** | **❌ 零重跑、零指标重算** | ✅ 三表 |

按规格 §2／§21 A·B，本域`要求「不重新执行 Backtest、不重新计算 canonical metrics」——
这与 C-18.1/C-18.2 的**输入与执行语义相反**。因此**不合并**（与 `robustness` 和 `stochasticRobustness`
既有的「并列兄弟」关系一致），也**未改**这两个模块任何一行。

### 1.3 规格 §25 点名的六个问题（逐条回答）

| 问题 | 回答 | 判据 |
|---|---|---|
| 是否**真正消费** Parameter Search Result？ | ✅ 是，且是**唯一输入事实源** | 输入只有 `parameter_search_run/combination/result`；`RobustnessAnalysisInput` 不接受任何其它来源 |
| 是否**重新执行** Backtest？ | ❌ **没有**（结构上不可能） | ① **静态守卫**：模块 import 黑名单（`backtest`/`strategyEvaluation`/`closedLoop`/`strategyCore`/`runWorkbenchAssembly`/`researchEngine`/`leaderCandidates`）+ 白名单，测试钉死；② **真机**：分析前后 `parameter_search_result` **全列快照逐字节相等**（digest 10,101 字节）、`closed_loop_backtest_run` 行数 **8 → 8** |
| 是否**重新计算** canonical metrics？ | ❌ **没有** | 每条稳健性结果的六指标与源结果**逐字段相等**（JSON 深度比对，0 条不一致） |
| 是否存在**结果串线**？ | ❌ **不存在** | ① 读入时校验行归属（出现非本源 `searchRunId` ⇒ `ROBUSTNESS_SOURCE_MISMATCH`）；② DB 层 `robustnessRunId × sourceSearchRunId` 交叉不一致行数 = **0**；③ 同一源上建两条 Run，各自结果行互不可见 |
| `tradeCount = 0` 如何处理？ | 判为 **`INSUFFICIENT_TRADING_ACTIVITY`**：**既不判稳定也不判不稳定**，且**不计入** `validNeighborCount` | 真机实测：零成交组合（`max_volume_ratio = 0.05`）状态 = `INSUFFICIENT_TRADING_ACTIVITY`、`stable = false`、`stabilityRatio = null`；其中被判 robust 的 = **0 条** |
| 参数引用验证如何继承？ | 从**源 Run 的冻结记录**继承（`referenceCheckApplied`），**不回读当前策略版本** | 新增列 + `referenceCheckApplied = true` ⇒ `parameterReferenceUnverified = false`；历史行（`NULL`）⇒ **`ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED`** 标记 + 说明文本（真机 9/9 PASS） |

### 1.4 验收数字（全部实测）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 error** |
| 新增单测 | **59 / 59**（域 54 + 静态守卫 5） |
| 全量 `vitest run` | 失败文件集合 **8 → 8（零新增）**；用例 4597 → **4656** |
| `npx vite build` | 成功（18.36 s） |
| **真实 2×2 E2E** | **42 / 42 PASS**（规格 §21 A~G 七条判据） |
| **§12 真实历史数据路径** | **9 / 9 PASS** |
| 前端可达性（无头量 DOM） | `pass = true`、**0 page error**、深链可自渲染 |
| migration | 首跑 4 executed；次跑 **0 executed / 4 skipped**（幂等）；**零 DML**；**0 FK** |
| `checkEolDrift` | **0 漂移** |

### 1.5 一句话结论

> **Parameter Search 结果的稳健性分析已落地并持久化；「零重跑」不是承诺而是结构事实；
> 真实 2×2 E2E 七条正确性判据全部通过；真跑过程中抓到一个真实缺陷（邻域被提前返回为空 +
> `stabilityRatio` 被算成 0）并已修复 + 加回归测试。可以进入 Robustness / OOS / Walk-Forward 的下一步决策。**

---

## 2. Existing Code Reuse（收敛而非新建）

| 复用什么 | 位置 | 怎么复用 |
|---|---|---|
| 源 Run / 组合 / 结果的读取 | `server/research/parameterSearch/persistence.ts` | **直接 import 既有读函数**（`getParameterSearchRunRow` / `listParameterSearchCombinationRows` / `listParameterSearchResultRows`）⇒ 不为同一张表写第二套 SQL |
| 状态机迁移表 | `server/research/parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS` | 规格 §14 的状态词表与 §7 **完全一致** ⇒ **不新建第二张迁移表**，只换领域码（`ROBUSTNESS_STATUS_TRANSITION_INVALID`） |
| canonical 序列化 | `server/researchDataset/version.ts#canonicalStringify` | 指纹与序列化共用同一实现 |
| 统计函数 | `shared/quant-stats#{mean,median,standardDeviation}` | 离散度统计**不自己写一套** |
| 错误类型 | `server/research/experimentValidation#ResearchValidationError` | 领域码统一载体（`toTrpcError` 会把 issues 拼进 message） |
| `null` 守卫 | `server/research/parameterSearch/persistence.ts#finiteOrNull` | 提升为 export 后**被 import 复用**（避免两处对「坏 double」的口径漂移） |
| 迁移 apply 引擎 | `scripts/applyParameterSearch.mjs` | 同一 `-- @guard:` 范式（先查 `information_schema` 再执行） |
| 前端通用组件 | `@/components/common`（`SectionCard` / `DataTable` / `MetricCard` / `StatusBadge` / `EmptyState`） | 不新造 UI 基元 |

**未复用（并说明原因）**：`server/research/parameterStability.ts` 统计的是「**参数取值**跨窗口的分布」，
本任务统计的是「**指标**在邻域上的分布」—— 输入与语义都不同，故不套用（这不是「第二套」）。

---

## 3. Robustness Domain Model

```text
SearchRobustnessRun ──1:N──▶ SearchRobustnessResult ──(JSON)──▶ 邻域 / 离散度 / 敏感性
        └─────────1:N──▶ SearchRobustnessParameterAnalysis
```

| 实体 | 关键字段 | 说明 |
|---|---|---|
| `SearchRobustnessRun` | `robustnessRunId` / `sourceSearchRunId` / 冻结快照 + 指纹 / FIXED 坐标 / `analysisConfig` / `summary` / `status` | 记录种类 `SEARCH_ROBUSTNESS_RUN`（**刻意不同于** C-18.1 的 `ROBUSTNESS_RUN`） |
| `SearchRobustnessResult` | `parameterHash` / `parameters` / 六指标副本 / `status` / `stable` / `stabilityRatio` / 邻居计数 / `neighbors` / `dispersion` / `sensitivity` | 身份 = 源组合的 `parameterHash`（**不重算 hash**） |
| `SearchRobustnessParameterAnalysis` | `parameterName` / `domainMode` / 取值数 / 稳定·不稳组合数 / `sensitivity` / `valueDispersion` / `verdict` | 行 = **一个参数**（不是组合） |

**状态机**（规格 §14，复用唯一权威迁移表）：
`CREATED → RUNNING → COMPLETED | FAILED | CANCELLED`；同态重放视为幂等；
`COMPLETED → CANCELLED` 被**响亮拒绝**（真机负例已验证）。

**判定状态**（单组合）：

| 状态 | 触发 | `stable` | `stabilityRatio` |
|---|---|---|---|
| `STABLE` | 有效邻居数达标 ∧ 全部在双容差内 | `true` | `[0,1]` |
| `UNSTABLE` | 有效邻居数达标 ∧ 存在超容差邻居 | `false` | `[0,1)` |
| `INSUFFICIENT_TRADING_ACTIVITY` | 基组合 `tradeCount = 0` | `false` | `null` |
| `INSUFFICIENT_NEIGHBORHOOD` | 有效邻居 < `minValidNeighbors` | `false` | `null` |
| `SOURCE_RESULT_UNAVAILABLE` | 源结果缺失 / 失败 / 容差指标缺一 | `false` | `null` |

---

## 4. Input Contract

**Validity Gate（规格 §10）—— 四条领域码，顺序固定、响亮拒绝：**

| 领域码 | 条件 |
|---|---|
| `ROBUSTNESS_SEARCH_RUN_NOT_FOUND` | 源 Run 不存在（不隐式创建） |
| `ROBUSTNESS_SEARCH_RUN_NOT_COMPLETED` | 状态 ≠ `COMPLETED`（也覆盖「状态列不是合法状态值」） |
| `ROBUSTNESS_NO_COMBINATIONS` | 源 Run 一行组合都没有 |
| `ROBUSTNESS_NO_RESULTS` | 源 Run 一行结果都没有 |
| `ROBUSTNESS_INVALID_RESULT_SOURCE` | 存在 `metricsSource ≠ canonical` 的结果（错误信息**带来源分布** `canonical / evaluators / other`，便于定位） |
| `ROBUSTNESS_SOURCE_MISMATCH` | 读到的行里出现不属于该 `searchRunId` 的行（**防串线**，规格 §8 / §21 G） |

**冻结快照（规格 §9）**：`searchSnapshotJson`（参数空间富定义）+ `searchSnapshotFingerprint`
（**逐字节等于源 Run 的 `parameterSpaceFingerprint`**，真机断言）+ `fixedCoordinatesJson`
（策略/数据集坐标、窗口、执行政策版本、评估配置指纹）全部**原样继承** ⇒
**分析不依赖当前 Strategy Version**，历史搜索不会被未来版本重新解释。

**参数引用状态继承（规格 §12）**：`sourceReferenceCheckApplied` 与
`sourceUnreferencedTunableCodes` 从源 Run 的冻结记录继承；`null`（历史行）⇒
`summary.parameterReferenceUnverified = true` + 说明文本含领域码
`ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED`。

---

## 5. Database

**三张新表 + 源表两列**（`drizzle/0042_search_robustness.sql`，手工、显式、幂等；apply = `scripts/applySearchRobustness.mjs`）

| 表 | 列数 | UNIQUE |
|---|---|---|
| `search_robustness_run` | 33 | `(robustnessRunId)` |
| `search_robustness_result` | 28 | `(robustnessRunId, parameterHash)` |
| `search_robustness_parameter_analysis` | 16 | `(robustnessRunId, parameterName)` |

`parameter_search_run` **ADD COLUMN**：`referenceCheckApplied`（`boolean NULL`）、
`unreferencedTunableCodesJson`（`longtext NULL`）。

🔴 **为什么必须补这两列**：PARAMETER-002 的死参数筛查结论原先**只进 API 回执、没有落库**；
而 §12 要求下游**继承**它、§9 又**禁止**回读当前策略版本来重新解释历史搜索。
补列后：新 Run 写 `true/false`，**历史行保持 `NULL` = 未知** ⇒ 下游如实标「未验证」，**不伪造「已验证」**。

**纪律落实（全部可断言）**：
- **0 FK**：三张新表 0 个；全库 FK 总数 = 0（脚本断言）；
- **零 DML 静态断言**：剥注释后只允许 `CREATE TABLE IF NOT EXISTS` 与 `ALTER TABLE ... ADD COLUMN`，
  出现 `DROP`/`MODIFY`/`CHANGE COLUMN`/`RENAME`/`TRUNCATE` 即失败 ⇒「不改历史行」是**静态事实**；
- **既有表保护**：16 张邻接表列签名**逐表完全一致**；`parameter_search_run` 只允许追加**预期的那两列**
  （幂等判据 = 「尚未存在的预期列被追加到末尾」）；
- **快照/口径冻结**：`searchSnapshotJson` / `analysisConfigJson` 不进 `ON DUPLICATE KEY UPDATE` 集合；
- **禁 `db:push` / `drizzle-kit generate`**：`drizzle/meta/_journal.json` 仍止于 `0023`，未改动。

---

## 6. API

**同域扩 6 个端点（零新 router）**——挂在既有 `paramSearchRouter.ts`：

| 端点 | 类型 | 说明 |
|---|---|---|
| `createRobustnessRun` | mutation | Gate + 冻结快照 + 落 Run 行（**不计算**） |
| `listRobustnessRuns` | query | 可按源 Run 过滤 |
| `getRobustnessRun` | query | Run + 进度 + 单参数分析 + **二维矩阵**（矩阵是读时**纯投影**，不落库 ⇒ 不可能与结果表不同步） |
| `startRobustnessRun` | mutation | 分析 + 落 Result / ParameterAnalysis；失败**必然收敛**为 `FAILED` + 领域码 |
| `cancelRobustnessRun` | mutation | 状态机守卫（`COMPLETED → CANCELLED` 响亮拒绝） |
| `getRobustnessResults` | query | 描述性排序 / 过滤（含「只看邻域不完整」） |

契约 = `shared/searchRobustnessContracts.ts`（zod + `z.infer` 同文件；复用 PS 契约里的值域 / 快照 / 状态 schema）。
排序字段固定为 `combinationIndex` / 六指标 / `stabilityRatio` —— **不含任何「排名 / 推荐」语义**。

---

## 7. Frontend

`client/src/components/robustness/SearchRobustnessPanel.tsx` 挂在 `/parameter-search`（`ParameterSearch.tsx`）。

| 区块 | 内容 |
|---|---|
| 创建 | 源 Search Run + 口径（收益容差 / 回撤容差 / 邻域半径）；**留空即不提交**（默认值归后端） |
| 列表 | Run / 源 / 状态 / 稳定·不稳·不可用计数 / 参数引用是否已验证 / 「查看详情」 |
| 详情 | 状态、进度、8 张指标卡、**参数引用未验证黄条**、已持久化的判定口径与冻结指纹、分析说明 |
| 单参数分析 | 参数 / 域形态 / 取值数 / 稳定·不稳组合数 / 平均·最大绝对变化 / 平均相对变化 / 判定 |
| **二维稳定性矩阵** | `P1 × P2` 网格；单元格显示 `stabilityRatio` + 状态文字；**缺格用虚线边框 + 「—」**、多命中标「多命中」，**不为「好坏」上色**（规格 §18） |
| 结果表 | 参数 / 状态 / 六指标 / 稳定邻居 ÷ 有效邻居（理论邻居） / 稳定性比例；排序 + 状态过滤 + **「查看邻域」**（邻居明细 + 离散度） |

**可达性（规格 §16 的四条自问 + 真机验证）**：
① 入口 = `/parameter-search`；② 详情 / 结果 / 矩阵被 `selectedRunId !== null` 包着 ⇒ 必须真点「查看详情」；
③ 判定条件用**库里真实数据**验证（4 条结果、4 格矩阵、2 条参数分析）；④ **深链 `?robRunId=<id>`** 可直接打开。
真机量 DOM 结果：`pass = true`、`matrixCells = 4`、`resultRows = 4`、`neighborhoodDetail = true`、
深链 `selectedWithoutClick = true`、**0 page error**。

**禁止词守卫**：模块 + 契约 + 面板 + router 的稳健性端点段，源码扫描**零命中**
（「最佳 / 最优 / 推荐 / winner / best / optimal」），且守卫**自带负例自测**。

---

## 8. Stability / Sensitivity Definition（口径的可复现定义）

### 8.1 邻域（规格 §3.2）

**轴对齐**：一次只沿**一个**参数轴移动 `±1 … ±neighborDistance` 步（不是全维笛卡尔积）。

> 为什么轴对齐：规格 §3.2 的示例是 `entryDay ± 1` / `pullbackDepth ± step`；轴对齐让每条邻居都有明确的
> `axis` 归属，敏感性才能按参数归因（全维笛卡尔积在 3 参数时是 26 条，且一条邻居同时改多个参数 ⇒ **归因不干净**）。

「相邻」的含义由**冻结搜索域的取值顺序**决定（`domainValues.ts`）：
`ENUM` 保持**声明顺序**（不重排）；`INTEGER/DECIMAL_RANGE` 按 `step` **定点展开**（消除 `0.1+0.2` 浮点漂移）。

**缺失邻居**：源 Search 里不存在 ⇒ `MISSING_COMBINATION` + `metrics/delta/withinTolerance` 全 `null`，
组合 `neighborhoodIncomplete = true`（**绝不假设、绝不插值**）。

### 8.2 稳定性（规格 §5.3 / §6）

```text
neighbor.withinTolerance := |ΔtotalReturnPct| <= returnTolerancePct
                          ∧ |ΔmaxDrawdownPct| <= drawdownTolerancePct
stabilityRatio            := stableNeighborCount / validNeighborCount     （valid = 0 ⇒ null）
stable                    := status === "STABLE"（= 有效邻居数达标 ∧ 全部在容差内）
valid neighbor            := 组合存在 ∧ 结果 SUCCEEDED ∧ tradeCount > 0 ∧ 两个容差指标非 null
```

**口径可配置、持久化到 Run、不写死前端、不随数据变化**（规格 §5.3）：
`returnTolerancePct`（缺省 5）/ `drawdownTolerancePct`（缺省 5）/ `neighborDistance`（缺省 1，整数 ≥1）/
`minValidNeighbors`（缺省 1）。
非法值（负数 / `NaN` / 半径非正整数 / 超上限）**响亮拒绝** `ROBUSTNESS_CONFIG_INVALID`，**不静默夹取**。

### 8.3 敏感性（规格 §5.2）

```text
absoluteChangePct := metric(neighbor) − metric(base)          // metric = totalReturnPct
relativeChange    := absoluteChangePct / |base|                // 仅数值型轴 ∧ 基值 ≠ 0，否则 null
```

🔴 **枚举 / 非数值参数只给离散变化**（`relativeChange` 恒 `null`）——
对 `"main" → "gem"` 算「相对变化百分比」是没有意义的。

### 8.4 离散度（规格 §5.1）

对「基准 + 有效邻居」的六指标（`totalReturnPct` / `annualizedReturnPct` / `maxDrawdownPct` /
`tradeCount` / `winRatePct` / `profitFactor`）给 `count / mean / median / min / max / stdDev / range`。
`count = 0` ⇒ 统计字段**全为 `null`**（不编造 0）。

### 8.5 多参数矩阵（规格 §7 / §18）

取搜索空间的**前两个**可变参数构成二维网格；`omittedParameters` 如实登记被略过的参数。
单元格状态：`MISSING`（源 Search 无该组合）/ `AMBIGUOUS`（>2 个可变参数导致一格命中多条，**不挑代表**）/
其余为单组合判定状态。矩阵**不落库**（读时纯投影）。

---

## 9. Execution Flow

```text
createRobustnessRun
  └─ 只读源（parameterSearch/persistence 既有读函数）
     └─ assertRobustnessGate（§10 四条 + 归属校验）
        └─ 冻结快照 + FIXED 坐标 + 解析并校验口径
           └─ INSERT search_robustness_run（status = CREATED，快照写入即冻结）

startRobustnessRun
  ├─ 断言迁移（复用 PS 唯一权威迁移表）→ status = RUNNING, startedAt
  ├─ **重新读源并重新过 Gate**（期间源若被 retry 到非 COMPLETED ⇒ 响亮拒绝，不拿半新半旧的网格出结论）
  ├─ analyzeSearchRobustness（纯函数；零 IO）
  │    ├─ buildNeighborhoodAxes（冻结域 → 有序取值）
  │    ├─ buildSourceIndex（键 → 源组合/结果；**不重算 parameterHash**）
  │    ├─ 逐组合 assessBaseCombination（邻域恒被构造）
  │    ├─ buildRobustnessMatrix
  │    └─ buildParameterAnalysis（敏感性 + 取值维离散度 + verdict）
  ├─ upsert 结果 + 参数分析（UNIQUE 键 ⇒ 重放覆盖同一批行）
  └─ status = COMPLETED + 汇总 + completedAt（**真实时刻**，不用 now() 冒充）
     异常 ⇒ status = FAILED + errorCode + errorMessage，然后**原样抛**（不吞）
```

🔴 **本链路不含、也拿不到**：Backtest 调用、评估端口、canonical metrics 重算、Dataset / 策略写入。

---

## 10. Real E2E Evidence

**脚**：`docs/evidence/_e2e_robustness_search.mts`（真实 tRPC → 真实 TiDB → 真实数据集 → **真实回测**，零 mock）
**结论文件**：`docs/evidence/_e2e_robustness_search.out.json`

### 10.1 上游构造（规格 §19：不得使用已知死参数文档）

只读复用 `cand-360001@1.0.0` 作为**模板**，把**两个**条件的右值改写为**参数引用**，
生成**新策略版本**（`rob-001-<ts>`，自建自清）：

| 原条件 | 改写后 | 语义 |
|---|---|---|
| `bar.low >= prefix.rd0.open`（字面量守线） | `bar.haircutFromEventLow <= max_drawdown` | `max_drawdown = 0` 时与「守线」同义 |
| `bar.volume <= prefix.rd0.volume * 0.3`（字面量缩量） | `bar.volumeRatio <= max_volume_ratio` | 决策日量能 / 首板日量能 ≤ 门槛 |

⇒ 规则图**确实存在 `PARAMETER_REFERENCE`**（死参数筛查 `referenceCheckApplied = true`，
`require_bullish` 因未被引用被**如实排除**）——被搜索的参数**真的被策略消费**（PARAMETER-002 的修法）。

### 10.2 2 参数 × 2 值 = 4 组合（规格 §20）

搜索域（⚠️ 数值型 `ENUM` **不可编译** ⇒ 用等步长区间恰好产生 2 个取值）：
`max_volume_ratio: DECIMAL_RANGE 0.05…1.0 step 0.95` → `{0.05, 1.0}`；
`max_drawdown: DECIMAL_RANGE 0.0…0.05 step 0.05` → `{0.0, 0.05}`。

**源结果（真实回测，35 s，4/4 成功，全部 `metricsSource = canonical`）：**

| `max_drawdown` | `max_volume_ratio` | `totalReturnPct` | `maxDrawdownPct` | `tradeCount` |
|---|---|---|---|---|
| 0.00 | 0.05 | 0 | 0 | **0** |
| 0.00 | 1.00 | **−10.358738565500014** | **10.538096070500018** | **8** |
| 0.05 | 0.05 | 0 | 0 | **0** |
| 0.05 | 1.00 | **−10.358738565500014** | **10.538096070500018** | **8** |

（⇒ 参数**确实影响执行**：`max_volume_ratio = 0.05` 恒 0 笔、`= 1.0` 恒 8 笔。）

**稳健性分析（2,313 ms）：汇总 = `2 稳定 / 0 不稳定 / 2 成交活动不足 / 0 邻域不足 / 0 源不可用`；**
矩阵 `2×2` 四格全部 present（无缺失格）；参数分析 `max_drawdown = insensitive(measured=2)`、
`max_volume_ratio = insufficient(measured=0)`（其轴邻居全是 0.05 ⇒ 无有效邻居 ⇒ **如实**判「证据不足」，
**不是**「该参数稳健」也不是「该参数不重要」）。

### 10.3 规格 §21 七条判据（真机断言，**42 / 42 PASS**）

| 判据 | 断言 | 实测 |
|---|---|---|
| **A** 未重跑 Backtest | 源 `parameter_search_result` 全列快照前后逐字节相等；`closed_loop_backtest_run` 行数不变 | digest 相等（10,101 字节）；**8 → 8** |
| **B** 未重算 canonical metrics | 每条结果六指标与源结果逐字段相等 | **0 条不一致** |
| **C** 确定性 | 二次 `start` 后结果指纹集合完全一致；行数不增长 | **4 条指纹逐条相等**、仍 4 行 |
| **D** 口径可变而源不变 | 收紧口径（`minValidNeighbors: 2`）⇒ 判定 `STABLE → INSUFFICIENT_NEIGHBORHOOD`；源快照仍不变 | `["…","STABLE",…,"STABLE"]` → `["…","INSUFFICIENT_NEIGHBORHOOD",…]`；源 digest 不变 |
| **E** 缺格不补值 | 不可用邻居零编造（指标 / 漂移 / 容差全 `null`）；本网格完整无 `MISSING` 格 | 违规 **0 条**；无 MISSING = true |
| **F** `tradeCount = 0` 不误判 robust | 零成交组合状态 = `INSUFFICIENT_TRADING_ACTIVITY` ∧ `stable = false` ∧ 不计入 `validNeighborCount` | 零成交 **2 条**、其中判 robust **0 条** |
| **G** 不串线 | 每条结果行 `sourceSearchRunId` 恒等于本 Run 声明的源；DB 层交叉不一致行数 = 0 | **0** |

**附加负例**：① 对 `COMPLETED` 的 Run 调 `cancelRobustnessRun` ⇒ 响亮拒绝
`ROBUSTNESS_STATUS_TRANSITION_INVALID`；② 从 `CREATED` 取消 ⇒ 生效。
**自建自清**：探针专属策略 / Search Run / 3 个 Robustness Run **全部归零**（`check` 断言通过）。

### 10.4 §12 真实历史数据路径

**脚本**：`docs/evidence/_probe_robustness_unverified_reference.mts`（**9 / 9 PASS**）

在**用户自有的真实历史 Run**（`PSRUN-20260919-15d3afc8`，`cand-360001@1.0.0`，4 条 canonical 结果，
`referenceCheckApplied = NULL`）上创建 + 执行稳健性分析，断言：
`sourceReferenceCheckApplied = null ∧ parameterReferenceUnverified = true`、
说明文本含 `ROBUSTNESS_PARAMETER_REFERENCE_UNVERIFIED` 与「不保证」、
执行完成后标记**不丢失**、且**源 Run 逐字节未被改写**。该 Run 的分析结果为
`4 × INSUFFICIENT_TRADING_ACTIVITY` —— 这正是 PARAMETER-001 记录的「该策略此窗口无撮合」的事实，
本域**如实**呈现，不粉饰。

### 10.5 前端可达性

**脚本**：`docs/evidence/_probe_robustness_dom.mjs`（无头 Edge + Node `WebSocket` 直连 CDP，**量 DOM**）
`pass = true`、**0 page error**；关键步：列表落地（3 条 run，2 条 COMPLETED）→ 点「查看详情」
→ `detailSection = true`、`matrixCells = 4`、`resultRows = 4`、排序/方向/过滤三控件齐备
→ 点「查看邻域」→ `neighborhoodDetail = true` → **深链 `?robRunId=` 直接打开**
→ `selectedWithoutClick = true`、`matrixCells = 4`、`resultRows = 4`。

---

## 11. Tests

**新增 2 个文件、59 个用例：**

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `tests/server/research/searchRobustness/searchRobustness.test.ts` | **54** | 口径解析（缺省 / 生效 / 非法响亮拒绝）；状态机（迁移合法性 / 非法迁移领域码 / 同态幂等 / ID / 进度）；Validity Gate 六条；参数引用继承两态；冻结域展开（枚举保序 / 定点区间 / `step<=0` 与 `min>max` 抛错 / 重复合并 / 索引查找）；离散度（六项统计 / `count=0` 全 null）；稳定性（全稳 / 全不稳 / 混合 / **零有效邻居** / 零成交 / 邻居零成交 / **缺格不补值** / 源结果失败 / 容差指标缺一 / 半径扩大）；**两条回归测试**（基组合不可判时邻域仍被构造 + `stabilityRatio` 为 `null`）；敏感性（数值给相对值 / 枚举不给 / 基值 0 不给 / 缺邻居全 null）；矩阵（全存在 / 缺格 `MISSING` / 多命中 `AMBIGUOUS` / 少于两轴退化）；**确定性**（同输入逐字节相同 / 口径可变而指标不变 / 入参不被修改 / 汇总自洽） |
| `tests/server/research/searchRobustness/robustnessBoundary.test.ts` | **5** | **静态守卫**：① 模块 import **不含**任何「会重跑」的模块；② import 白名单；③ 禁止词检测器**负例自测**（正例被抓、注释引用不算、干净样例不误报）；④ 域（模块+契约+面板）**零命中**；⑤ router 稳健性端点段**零命中** |

**全量回归**：`npx vitest run` ⇒ 失败文件集合 **8 → 8（零新增）**；用例 **4597 → 4656**（+59 = 本次新增）。
其余五层验收（`tsc` / 聚焦单测 / `vite build` / 只读探针 / 行尾哨兵）结果见 §1.4。

---

## 12. Known Risks

| 编号 | 风险 | 现状 |
|---|---|---|
| R-01 | **源 Run 必须是 `COMPLETED` 且结果全为 `canonical`** —— 非 canonical 一律拒绝（严格按规格 §10） | 有意设计；错误信息带来源分布便于定位 |
| R-02 | **历史 Run 的 `referenceCheckApplied = NULL`** ⇒ 结论带「参数引用未验证」标记 | 有意设计（不伪造）；`cand-3600xx` 系列全部属于此类 |
| R-03 | 搜索空间含 **> 2 个可变参数**时，矩阵只取前两个、多命中格标 `AMBIGUOUS` | 如实登记；未实现多维投影（见 §13） |
| R-04 | **数值型 `ENUM` 搜索域不可编译**（`PARAMETER_SEARCH_DOMAIN_UNCOMPILABLE`） | PARAMETER-001 既有口径（数值域只支持等步长区间）；用 `DECIMAL_RANGE` 表达小规模穷举 |
| R-05 | **物化列序与 schema 声明位置不同序**（`ALTER ADD COLUMN` 追加到表末） | 无功能影响（drizzle 一律显式列名）；apply 脚本按「原签名 + 追加列」比对 |
| R-06 | `analysisConfig` 变更**不会**自动失效已有 Robustness Run | 有意设计：口径随 Run 冻结；要换口径就再建一个 Run（真机已验证两条 Run 口径互不覆盖） |
| R-07 | 性能 | **本任务一行未碰**（归外部 Agent）。观测：4 组合搜索 35 s、稳健性分析 2.3 s（分析阶段与网格大小线性、无回测） |

---

## 13. Deferred Items

| # | 项 | 为什么推迟 |
|---|---|---|
| D-01 | **稳健性分析完成后自动回写/标记源 Search Run**（例如「已有几份稳健性分析」） | 会写 `parameter_search_*`，与「本域对源只读」的纪律冲突；当前靠 `listRobustnessRuns({ sourceSearchRunId })` 反查 |
| D-02 | **多维（>2 参数）稳定性投影**（切片/降维/热点图） | 规格 §7 只要求 P1 × P2；三维以上需要新的可视化与交互设计（`omittedParameters` 已如实登记） |
| D-03 | **稳定性口径的自动推荐 / 自适应** | 规格 §5.3 明确要求「不根据某一次数据动态改变」—— 本域刻意不做 |
| D-04 | **跨 Search Run 比较**（把两个 Run 的稳定性并排） | 规格 §8 明确**禁止**；未来若要，须先定义「跨 Run 坐标对齐」口径 |
| D-05 | `search_robustness_result.backtestRunId` 等**源侧追溯字段**的落库 | 源结果本身 `backtestRunId` 恒 `NULL`（PARAMETER-001 N-03 / DEFERRED 未变）；本域沿用「指纹 + 坐标」追溯 |
| D-06 | 稳健性结论**导出**（CSV / 报告） | 非规格要求；前端已有完整结果表与邻域明细 |
| D-07 | `robustness/**`（C-18.1）与 `stochasticRobustness/**`（C-18.2）的**落库** | 属那两个模块自身的技术债；本域**刻意不代其落库**（避免把两种鲁棒性混进同一组表） |

---

## 14. Architecture Baseline Changes

**`v1.1.1` → `v1.2.0`（minor：新增 Domain 子模块 + 3 表 + 1 契约 + 6 端点；既有执行链与核心契约零破坏）**

| 文档 | 变更 |
|---|---|
| `SYSTEM-BASELINE.md` | 版本行；§5 Robustness 行；新增「ROBUSTNESS-001 增量」节（含三模块对照表、新增表与列的**为什么**、7 条「不知道就会读错」的行为语义、前端可达性） |
| `system-manifest.yaml` | `robustness` 域：`sourcePaths`（+`searchRobustness/**`）、`entryPoints`（+3）、`inputs`/`outputs`、`persistence`（+3 表）、`router`、`contract`、`tests`（+1 目录）、`knownRisks`（+3） |
| `DOMAIN-MAP.md` | §7 能力表 + Parameter Search 的「不负责」行 |
| `DATA-FLOW.md` | 新增「Parameter Search → Robustness」数据流（含**无反向边**的说明与唯一反向字段） |
| `EXECUTION-FLOW.md` | 可达入口表新增 6 端点 + 「执行语义不重跑」标注 |
| `DATABASE-MAP.md` | 新增 `D-91` 节（三表 + 两列 + 纪律落实） |
| `CONTRACT-MAP.md` | 新增 `C-91`（契约纪律三条） |
| `DEPENDENCY-MAP.md` | 新增 4 条依赖边 + **1 条「禁止边」**（零重跑的结构证据） |
| `CHANGE-AUDIT.md` | 新增 `## 2026-09-19 · ROBUSTNESS-001` 条目 |
| `ROADMAP.md` | §44 覆盖式快照；§44.5 新增 `9bu`；编号台账两处同步（已用至 `9bu` ⇒ 下一个未占用 `9bv`） |
| `ROADMAP-CHANGELOG.md` | append-only 新增 `9bu` 条目 |

**`GLOBAL AUDIT REQUIRED：NONE`**（未改 Domain 边界、未改既有主链、未破坏核心契约）。

---

## 15. Next Step

**本任务到此停止，不自动开始下一阶段。**

- ✅ 前置条件已满足：Parameter Search 结果**已验证可被下游稳定消费**（七条正确性判据全过），
  且「哪些参数真的被策略消费」这一事实有**可继承的落库记录**。
- ⏭️ 由上层决定是否进入 `OOS-001` / `WALK-FORWARD-001` / `ROBUSTNESS-002`。
  **本任务不启动它们，也不继续拆任务。**
- ⚠️ 若下一步要消费稳健性结论，须先知道三件事：
  ① `stabilityRatio` 的 `null` 表示「没有可判的邻居」，**不是** 0；
  ② 结论的适用范围受**源 Run 的 `parameterReferenceCheckApplied`** 约束（`NULL` ⇒ 未验证）；
  ③ 口径随 Run 冻结，换口径请**另建 Run**，不要期待旧 Run 自动重算。

---

### 附：本任务的交付物清单

| 类别 | 文件 |
|---|---|
| 域层（新增） | `server/research/searchRobustness/{types,canonical,domainValues,neighborhood,matrix,gate,analysis,run,persistence,executor,index}.ts` |
| 契约（新增） | `shared/searchRobustnessContracts.ts` |
| 前端（新增） | `client/src/components/robustness/SearchRobustnessPanel.tsx` |
| 迁移（新增） | `drizzle/0042_search_robustness.sql` + `scripts/applySearchRobustness.mjs` |
| 测试（新增） | `tests/server/research/searchRobustness/{searchRobustness,robustnessBoundary}.test.ts` |
| 证据（新增） | `_e2e_robustness_search.mts` / `_probe_robustness_unverified_reference.mts` / `_probe_robustness_dom.mjs` / `_probe_rob001_template.mts` / `_probe_rob001_ps_runs.mts`（+ 各自 `.out.json`） |
| 既有文件（改） | `server/paramSearchRouter.ts`、`drizzle/schema.ts`、`server/research/parameterSearch/{persistence,executor}.ts`、`shared/parameterSearchContracts.ts`、`client/src/pages/ParameterSearch.tsx`、`client/src/lib/status.ts` |
