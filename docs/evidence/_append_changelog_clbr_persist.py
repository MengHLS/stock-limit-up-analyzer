# -*- coding: utf-8 -*-
"""
ROADMAP-CHANGELOG.md **append-only** 追加 —— CLOSED-LOOP-BACKTEST-PERSIST-001。

注意：ROADMAP-CHANGELOG.md 是**纯 LF**（与 ROADMAP.md 的纯 CRLF 相反）⇒ 追加内容必须用 "\\n"。
用法：python docs/evidence/_append_changelog_clbr_persist.py [--dry-run]
"""
import io
import sys

PATH = "ROADMAP-CHANGELOG.md"
DRY = "--dry-run" in sys.argv

raw = open(PATH, "rb").read().decode("utf-8")
assert raw.count("\r\n") == 0, "ROADMAP-CHANGELOG.md 应为纯 LF，实际含 CRLF ⇒ 拒绝追加"
assert raw.endswith("\n"), "文件末尾无换行"
before_lines = raw.count("\n")

MARK = "## 2026-09-14 13:22 GMT+8 — 闭环回测"
assert MARK not in raw, "本条目已追加过（防重复追加）"

BLOCK = """## 2026-09-14 13:22 GMT+8 — 闭环回测「每次都有结果、且有地方可看」：新增留档表 `closed_loop_backtest_run` + `loopRun` 自动落档 + 「回测历史」页面（迁移 `0037` · `server/**` 2 新 + 1 改 · `shared/**` 1 改 · `client/**` 3 新 + 2 改，CODE_READY）

### 一、触发与诊断（读代码得出，非推断）

用户原话：「**我需要现在的回测每次都有回测结果，并且有地方可以展示**」。拆成两件可验收的事：① **每次回测都要有结果**（= 闭环运行必须自动落档留痕）；② **有地方可以展示**（= 前端可回看的「回测历史」入口）。

**「没地方看」的根因不在前端，而在服务端设计本身**：

| # | 实查事实 | 证据 |
| --- | --- | --- |
| ① | `loopRun` 注释**原文就写着「无状态、不落库；一次调用的完整可审计轨迹」** ⇒ 跑完即弃 | `server/researchRunRouter.ts` |
| ② | 仓库**已有**一套「保存 + 历史页」的 legacy `backtest_runs`（`/backtest` 页「历史记录」页签） | 真实库实查 |
| ③ | 但 ② **只服务龙头候选 `LeaderCandidateBacktestResult`**：全表**仅 1 行**、单条 `resultJson` **5,610,196 字符 ≈ 5.6 MB** | `docs/evidence/_probe_backtest_storage_state.mts` / `.json` |
| ④ | `research_run.executionLogJson` 存的是**批次日志**（`ResearchRunExecutionLogEntry[]`：`sequence` / `mode` / `analysisIds` / `sampleCount` / `status` / `startedAt` / `completedAt`） | 表结构实查 |

⇒ 结论：两套互不相通，闭环结果**确实无处落、无处看**。**禁把 legacy `backtest_runs` 与闭环结果互灌**（不同表、不同口径）。

### 二、建表（`drizzle/0037_closed_loop_backtest_run.sql`：23 列 / 3 索引 / 零 FK）

| 列组 | 列 |
| --- | --- |
| 坐标 | `runId`（**UNIQUE**） / `experimentId` / `strategyId` / `strategyVersion` / `startDate` / `endDate` / `datasetVersion` / `datasetVersionId` / `datasetSource` / `recipeId` |
| 摘要 | `status` / `executedStageCount` / `blockedStageCount` / `skippedStageCount` / `firstBlockedReasonCode` / `initialCapital` / `finalEquity` / `tradeCount` / `equityCurvePointCount` / `summaryJson` |
| 明细 | `resultJson`（longtext） |
| 时间 | `createdAt` |

索引：`uq_..._run`（UNIQUE `runId`） / `idx_..._created`（`createdAt`） / `idx_..._strategy`（`strategyId`, `createdAt`）。**零 FK**（沿用项目 soft-reference 原则）。

流程遵项目铁律：`drizzle/schema.ts`（**唯一权威、纯 CRLF**，行级追加由带 **3 处断言**的 `docs/evidence/_apply_schema_clbr.py` 执行）→ 手写迁移 SQL（带 `-- @guard:`）→ 幂等 `scripts/applyClosedLoopBacktestRun.mjs`（真实库 `information_schema` 断言 + 既有 **23 张表列签名自比对** + 行数前后比对 + `--dry-run` / `--check`）。**禁 `db:push` / `drizzle-kit generate` / 手写 `_journal.json`**。

⚠️ 一处**断言误判**已修：`createdAt` 是 `idx_..._created` 的**首列** ⇒ TiDB 标 `key=MUL` 而非空串；把 `EXPECTED_COLUMNS` 里 `createdAt` 的 `key` 改为 `"MUL"` 后 **`PASS=True`**（表结构本身一直是对的）。

### 三、服务端（3 新 + 2 改）

- ① **`server/closedLoopBacktestRun/summary.ts`**（纯函数、无 DB、**不抛错**）：`readBacktestStageOutput()` 只在 `stageId==="backtest" && state==="EXECUTED" && output.kind==="backtestSummary"` 时取值；🔴 `asFiniteNumber` **只接受 `number` 且有限**（字符串 `"133"` 一律 `null`，**不做隐式转换**）⇒ 从结构上杜绝「假数字」进历史。
- ② **`server/closedLoopBacktestRun/repository.ts`**：`saveClosedLoopBacktestRun()` 走 `insert().onDuplicateKeyUpdate()`（**除 `runId` 外全列覆盖**）⇒ **同一次运行的重试幂等收敛为一行**；`listClosedLoopBacktestRuns()` **只 SELECT 摘要列、绝不 SELECT `resultJson`**（limit 收敛到 **1..200**、默认 50）；`getClosedLoopBacktestRun(id)` 不存在返回 `null`、🔴 **`resultJson` 损坏则抛错**（**不把「记录坏了」伪装成「没跑过」**）。
- ③ **`shared/researchContracts.ts`** 新增 3 个契约：`closedLoopBacktestRunRecordSchema`（20 字段）/ `...DetailSchema = ...extend({ result: nullable })` / `...ListInputSchema`（`{limit?: 1..200, strategyId?}`）。
- ④ **`server/researchRunRouter.ts`**：`loopRun` 尾部由 `return {...}` 改为 `const result: ClosedLoopRunResult = {...}` → `await persistClosedLoopBacktestRun(...)` → `return result`；`persistClosedLoopBacktestRun` **try/catch 吞错 + `console.warn`** ⇒ 🔴 **best-effort：留档失败绝不阻断回测**（结果已算出来，不能因写历史失败而丢弃；代价是「历史少一条」，是**如实可见的降级**）；新增 `listBacktests` / `getBacktest` 两个 `publicProcedure`（均带 `output()` 契约）。

### 四、前端（3 新 + 2 改）

- ① **`client/src/adapters/closedLoopBacktestRunAdapter.ts`**：分层 `API(DTO) → Adapter → ViewModel → UI`，人话码表 `STATUS_LABEL` / `DATASET_SOURCE_LABEL`，缺失一律显示「—」**不显示 0**；🔴 **ViewModel 不含收益率** —— 收益率需重算口径，展示层**只搬运不重算**，故列表并列展示「初始资金 / 期末权益」**原始值**。
- ② **`client/src/pages/BacktestRuns.tsx`**：URL 坐标 `?id=<留档行 id>`（点同一行再点 = 收起）；详情走 `buildClosedLoopRunViewModel(detail.result)` → `<ClosedLoopRunResultPanel>` ⇒ 与运行工作台**同一套渲染、零口径漂移**；空态写明「到「策略」页点「运行策略」—— 跑完之后这次回测会自动出现在这里（**无需手动保存**）」。
- ③ **`client/src/App.tsx`** 新增路由 `/backtest-runs`。
- ④ **`client/src/components/AppShell.tsx`**：「量化回测」组新增「回测历史」入口（`FileClock` 图标，插在「组合回测」与「前向纸面交易」之间）。

### 五、实证（`docs/evidence/_probe_closed_loop_persist_e2e.mts`，**19 项断言全绿 / 0 失败 / PASS**，**108,961 ms**）

走**真实 tRPC `loopRun` 同一条服务端路径**（非直连绕过）：

| # | 断言 | 结果 |
| --- | --- | --- |
| ① | `loopRun` 返回后留档表行数 **+1**（**无需手动保存**） | **2 → 3 行** ✅ |
| ② | 列表摘要 `status` = 运行结果 | `PARTIAL_BLOCKED` ✅ |
| ③ | 阶段计数（executed / blocked / skipped） | **5 / 9 / 0** ✅ |
| ④ | `datasetSource` | `rebuild` ✅ |
| ⑤ | `datasetVersionId` | **390002** ✅ |
| ⑥ | `recipeId` | `first-limit-pullback-hold-shrink` ✅ |
| ⑦ | `tradeCount` | **90** ✅ |
| ⑧ | `finalEquity` | **97718.8467249** ✅ |
| ⑨ | `equityCurvePointCount` | **36** ✅ |
| ⑩ | 列表条目**不携带** `result`（长文本只在详情） | ✅ **结构性保证「列表轻」** |
| ⑪ | 详情 `result.stages` 长度 = canonical 14 阶段 | **14** ✅ |
| ⑫ | 详情含成交明细 / 权益曲线 | **trades=90 / equityCurve=36** ✅ |
| ⑬ | Part B：同 `runId` 写两次 ⇒ 仍**只 1 行**，读回**后一次**的值 | ✅ 幂等收敛 |
| ⑭ | Part B 结束后探针数据**自清理** | ✅ 不留污染 |

🔴 探针第一版曾崩在 `Output validation failed`（`result.wiring.requestedStages` / `uncoveredStages` expected array, received undefined）—— 原因是探针自造的最小 `ClosedLoopRunResult` 缺 `closedLoopWiringSummarySchema` 的 2 个必填数组。**这恰好证明 tRPC `output()` 契约校验真实生效**；补齐 `wiring` 六个字段后复跑全绿。

### 六、验收与边界

- `npx tsc --noEmit` **exit 0**（服务端改动后、客户端改动后各一次）。
- `npx vitest run` = **238 文件 / 3,971 例通过 / 16 例失败**，失败**文件集合**逐项 = 既有基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）⇒ **零新增失败**。
- 新增单测 `tests/server/closedLoopBacktestRun/summary.test.ts`（**6 例**）全通过 —— 锁住「**真实 0 与『取不到』必须区分**」「字符串数字 / `NaN` 一律 `null`（**不做隐式转换**）」「`backtest` 非 `EXECUTED` 时权益与成交为 `null` 而非 `0`」。
- `npx vite build` **exit 0**（17.76 s，产物 `index-D5GdQkdM.js` 2,656.74 kB / gzip 650.14 kB）。
- 迁移 apply：**`PASS=True`**（**23/23 列、3/3 索引、零 FK、既有 23 表零变化、行数零变化**；二次执行 `executed=[]` ⇒ 幂等已验证）。
- **边界**：零新依赖、零 `db:push`；`server/**` 有改动 ⇒ 已在**确认无在途研究 Run** 后执行；⚠️ 本机 `agent-browser` 不可用、仓库无 `jsdom` ⇒ **无浏览器截图**，前端验收口径 = 真实 tRPC 取数 + 纯函数复用 + 真实 DB。

### 七、诚实登记

- ⚠️ **本轮 `overall=PARTIAL_BLOCKED`、首阻塞 `CL_RUNNER_NOT_INJECTED`**（阶段 `optimization` 未注入执行器）—— 这是**既有覆盖缺口**（**14 阶段仅 6 个有执行器**），**本轮未处理、也不影响本轮结论**；本轮窗口**部分阻塞、留档照样完整落下来**，这恰恰是「每次都有结果」要保证的性质。
- ⚠️ 探针**首次**崩溃时留下过 1 行幂等测试残留（`experimentId=EXP-PROBE-IDEM` / `strategyId=probe-strategy`，`resultJson` 仅 451 字符的假对象），会污染产品页。已新增 `docs/evidence/_probe_clbr_rows.mts`（默认**只读**；`--clean-probe-rows` 时按**双重命名守卫**「`experimentId LIKE 'EXP-PROBE%'` **且** `strategyId LIKE 'probe-%'`」删除，并额外列出「只命中单侧守卫」的可疑行**不自动删**）⇒ 已清掉 1 行，现留档 **2 行全为真实运行**（`cand-360001@1.0.0`，`resultJson` 39,808 字符）。
- ⚠️ 「**留档失败 ⇒ 历史少一条**」的降级目前**只在服务端日志可见、前端尚未提示**（属可改进项，本轮未做）。
- 登记：§44.5 新编号取 **`9aj`**（按「**下一个未占用**」判定 —— `9aj` 全仓库未占用；**非「末条 +1」**；`9ae` 错位、`9v` 重复的历史问题本轮未动）。
- 新增探针（`docs/evidence/`，不进 `tsc` / vitest）：`_probe_closed_loop_persist_e2e.mts`（端到端留档链路 + 幂等）、`_probe_clbr_rows.mts`（留档行巡检 / 残留清理）、`_apply_schema_clbr.py`（schema 行级追加，带断言）、`_apply_roadmap_clbr_persist.py`（ROADMAP CRLF 手术，带断言）。
"""

raw2 = raw + BLOCK
after_lines = raw2.count("\n")
assert raw2.count("\r\n") == 0, "追加后出现 CRLF"
assert raw2.startswith(raw), "append-only 被破坏（原文被改写）"
assert raw2.count(MARK) == 1, "新条目写入异常"

print(f"[ok] append-only：行数 {before_lines} → {after_lines}（+{after_lines - before_lines}）")
print(f"[ok] 字节 {len(raw.encode('utf-8'))} → {len(raw2.encode('utf-8'))}")
print("[ok] 纯 LF 保持、原文前缀逐字未变")

if DRY:
    print("[dry-run] 未写盘")
    sys.exit(0)

with io.open(PATH, "wb") as f:
    f.write(raw2.encode("utf-8"))
print(f"[done] 已追加到 {PATH}")
