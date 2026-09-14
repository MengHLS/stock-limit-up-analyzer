# -*- coding: utf-8 -*-
"""
ROADMAP.md 行级手术（CRLF 安全）—— CLOSED-LOOP-BACKTEST-PERSIST-001 总控更新。

做两件事：
  1. §44 覆盖式：新增「上轮实查（2026-09-14 13:22）」条目，并把原「上轮实查（2026-09-13 22:53）」
     降级为 `> **【...】**` 形式（与 22:35 那条同格式）⇒ 只有一条 `上轮实查`。
  2. §44.5 队列：在 `9ai.` 之后新增 `9aj.`（**下一个未占用编号**，非「末条 +1」）。

铁律：ROADMAP.md 是**纯 CRLF** ⇒ 必须 `splitlines(keepends=True)`，禁 `split("\\n")`。
用法：python docs/evidence/_apply_roadmap_clbr_persist.py [--dry-run]
"""
import io
import sys

PATH = "ROADMAP.md"
DRY = "--dry-run" in sys.argv

raw = open(PATH, "rb").read().decode("utf-8")

# --- 前置断言：CRLF 纯度 --------------------------------------------------------
lf_only = raw.count("\n") - raw.count("\r\n")
assert lf_only == 0, f"ROADMAP.md 非纯 CRLF（裸 LF 行数 = {lf_only}）⇒ 拒绝手术"

# --- 1) §44：新增本轮（插在原 22:53 条目之前，沿用既有 `上轮实查：` 格式）------------
# 说明：本文件历史上**每轮条目都保留** `> 上轮实查：` 前缀（共 13 条，非「仅最新一条」）
# ⇒ 本轮沿用同格式**只插入**，不改写既有条目（避免自创格式造成风格漂移）。
ANCHOR = "> 上轮实查：**2026-09-13 22:53 GMT+8 · 策略规则编辑器"
assert raw.count(ANCHOR) == 1, f"§44 锚点出现次数异常：{raw.count(ANCHOR)}"

NEW_HEAD = (
    "> 上轮实查：**2026-09-14 13:22 GMT+8 · 闭环回测「每次都有结果、且有地方可看」：新增留档表 + `loopRun` 自动落档 + 「回测历史」页面 · 状态 CODE_READY**（`CLOSED-LOOP-BACKTEST-PERSIST-001`）。"
    "触发 = 用户「**我需要现在的回测每次都有回测结果，并且有地方可以展示**」。"
    "**一、诊断（读代码得出，非推断）：「没地方看」的根因不在前端** —— `server/researchRunRouter.ts` 的 `loopRun` 注释**原文就写着「无状态、不落库；一次调用的完整可审计轨迹」**，跑完即弃；"
    "而仓库里**已有**一套「保存 + 历史页」的 legacy `backtest_runs`（`/backtest` 页「历史记录」页签），但它**只服务龙头候选 `LeaderCandidateBacktestResult`**"
    "（真实库实查 **仅 1 行**、单条 `resultJson` **5,610,196 字符 ≈ 5.6 MB**，见 `docs/evidence/_probe_backtest_storage_state.mts`），与闭环结果**不同表、不同口径**；"
    "另 `research_run.executionLogJson` 存的是**批次日志**（`ResearchRunExecutionLogEntry[]`：`sequence` / `mode` / `analysisIds` / `sampleCount` / `status` / `startedAt` / `completedAt`），**语义不同、不能复用**。"
    "⇒ 两套互不相通，闭环结果**确实无处落、无处看**。"
    "**二、建表（`drizzle/0037_closed_loop_backtest_run.sql`：23 列 / 3 索引 / 零 FK）**：新表 `closed_loop_backtest_run` = 坐标列（`runId` **UNIQUE** / `experimentId` / `strategyId` / `strategyVersion` / `startDate` / `endDate` / `datasetVersion` / `datasetVersionId` / `datasetSource` / `recipeId`）"
    "+ 摘要列（`status` / `executedStageCount` / `blockedStageCount` / `skippedStageCount` / `firstBlockedReasonCode` / `initialCapital` / `finalEquity` / `tradeCount` / `equityCurvePointCount` / `summaryJson`）"
    "+ `resultJson`(longtext) + `createdAt`；索引 `uq_..._run`(UNIQUE) / `idx_..._created` / `idx_..._strategy`。"
    "流程遵项目铁律：`drizzle/schema.ts`（**唯一权威、纯 CRLF**，行级追加由带 **3 处断言**的 `docs/evidence/_apply_schema_clbr.py` 执行）→ 手写迁移 SQL（带 `-- @guard:`）→ 幂等 `scripts/applyClosedLoopBacktestRun.mjs`"
    "（真实库 `information_schema` 断言 + 既有 **23 张表列签名自比对** + 行数前后比对 + `--dry-run` / `--check`）；**禁 `db:push` / `drizzle-kit generate` / 手写 `_journal.json`**。"
    "**三、服务端（3 新 + 2 改）**：① `server/closedLoopBacktestRun/summary.ts`（纯函数、无 DB、**不抛错**）：`readBacktestStageOutput()` 只在 `stageId===\"backtest\" && state===\"EXECUTED\" && output.kind===\"backtestSummary\"` 时取值；"
    "`asFiniteNumber` **只接受 `number` 且有限**（字符串 `\"133\"` 一律 `null`，**不做隐式转换**）⇒ 从结构上杜绝「假数字」进历史。"
    "② `server/closedLoopBacktestRun/repository.ts`：`saveClosedLoopBacktestRun()` 走 `insert().onDuplicateKeyUpdate()`（**除 `runId` 外全列覆盖**）⇒ **同一次运行的重试幂等收敛为一行**；"
    "`listClosedLoopBacktestRuns()` **只 SELECT 摘要列、绝不 SELECT `resultJson`**（limit 收敛到 **1..200**、默认 50）；`getClosedLoopBacktestRun(id)` 不存在返回 `null`、**`resultJson` 损坏则抛错**（**不把「记录坏了」伪装成「没跑过」**）。"
    "③ `shared/researchContracts.ts` 新增 3 个契约（列表 / 详情 / 入参），详情 = 摘要 `extend({ result: nullable })`。"
    "④ `server/researchRunRouter.ts`：`loopRun` 尾部由 `return {...}` 改为 `const result: ClosedLoopRunResult = {...}` → `await persistClosedLoopBacktestRun(...)` → `return result`；"
    "`persistClosedLoopBacktestRun` **try/catch 吞错 + `console.warn`** ⇒ 🔴 **best-effort：留档失败绝不阻断回测**（结果已算出来，不能因写历史失败而丢弃；代价是「历史少一条」，是**如实可见的降级**）；新增 `listBacktests` / `getBacktest` 两个 `publicProcedure`（均带 `output()` 契约）。"
    "**四、前端（3 新 + 2 改）**：① `client/src/adapters/closedLoopBacktestRunAdapter.ts`：分层 `API(DTO) → Adapter → ViewModel → UI`，人话码表 `STATUS_LABEL` / `DATASET_SOURCE_LABEL`，缺失一律显示「—」**不显示 0**；"
    "🔴 **ViewModel 不含收益率** —— 收益率需重算口径，展示层**只搬运不重算**，故列表并列展示「初始资金 / 期末权益」**原始值**。"
    "② `client/src/pages/BacktestRuns.tsx`：URL 坐标 `?id=<留档行 id>`（点同一行再点 = 收起）；详情走 `buildClosedLoopRunViewModel(detail.result)` → `<ClosedLoopRunResultPanel>` ⇒ 与运行工作台**同一套渲染、零口径漂移**；"
    "空态写明「到「策略」页点「运行策略」—— 跑完之后这次回测会自动出现在这里（**无需手动保存**）」。③ `client/src/App.tsx` 新增路由 `/backtest-runs`；④ `client/src/components/AppShell.tsx`「量化回测」组新增「回测历史」入口（插在「组合回测」与「前向纸面交易」之间）。"
    "**五、实证（`docs/evidence/_probe_closed_loop_persist_e2e.mts`，走真实 tRPC `loopRun` 同一条服务端路径，**19 项断言全绿 / 0 失败 / PASS**，**108,961 ms**）**：`runId=clrun-20260914052059240`；"
    "留档 **2 → 3 行**（自动 +1，**无需手动保存**）；`listBacktests` 命中的**摘要 9 项逐一等于运行结果**（`status=PARTIAL_BLOCKED` / `executed=5` / `blocked=9` / `skipped=0` / `datasetSource=rebuild` / `datasetVersionId=390002` / `recipeId=first-limit-pullback-hold-shrink` / `tradeCount=90` / `finalEquity=97718.8467249` / `equityCurvePointCount=36`）；"
    "**列表条目不携带 `result`**（长文本只在详情）；`getBacktest(id=30001)` 拿回 **`stages=14` + `trades=90` + `equityCurve=36`**；Part B 直连仓储 **同 `runId` 写两次仍只 1 行**、读回的是**后一次**的值、且探针自清理干净 ⇒ ✅ **「列表轻」是结构性保证，不是口头承诺**。"
    "⚠️ **必须如实说清的一件事**：本轮 `overall=PARTIAL_BLOCKED`、首阻塞 `CL_RUNNER_NOT_INJECTED`（阶段 `optimization` 未注入执行器）—— 这是**既有覆盖缺口**（**14 阶段仅 6 个有执行器**），**本轮未处理、也不影响本轮结论**；"
    "本轮窗口**部分阻塞、留档照样完整落下来**，这恰恰是「每次都有结果」要保证的性质。"
    "**六、验收**：`npx tsc --noEmit` **exit 0**（服务端改动后、客户端改动后各一次）；`npx vitest run` = **238 文件 / 3,971 例 / 16 例失败**，失败**文件集合**逐项 = 既有基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）⇒ **零新增失败**"
    "（新增单测 `tests/server/closedLoopBacktestRun/summary.test.ts` **6 例**全通过，含「真实 0 与『取不到』必须区分」「字符串数字一律 `null`」）；`npx vite build` **exit 0**（17.76 s，产物 `index-D5GdQkdM.js` 2,656.74 kB / gzip 650.14 kB）；迁移 apply **`PASS=True`**（**23/23 列、3/3 索引、零 FK、既有 23 表零变化、行数零变化**、二次执行 `executed=[]` 幂等）。"
    "**七、边界与遗留**：`server/**` 有改动（新增 2 文件 + 改 1 个路由）⇒ 已在**确认无在途研究 Run** 后执行；零新依赖、零 `db:push`、无浏览器截图（本机 `agent-browser` 不可用）。"
    "遗留：① 探针**首次**崩溃时留下过 1 行幂等测试残留（`exp=EXP-PROBE-IDEM` / `strategyId=probe-strategy`），已用**双重命名守卫**的 `docs/evidence/_probe_clbr_rows.mts --clean-probe-rows` 清掉 ⇒ 现留档 2 行**全为真实运行**；"
    "② 「留档失败 ⇒ 历史少一条」的降级目前**只在服务端日志可见、前端尚未提示**（属可改进项，本轮未做）。\r\n"
    ">\r\n"
)

raw2 = raw.replace(ANCHOR, NEW_HEAD + ANCHOR, 1)
assert raw2 != raw, "§44 替换未发生"

# 写后断言：两侧原标记仍在
for marker in ("# 44. 项目真实状态映射（数据快照）", "触发 = 用户「**我不需要Json高级模式"):
    assert marker in raw2, f"§44 手术破坏了既有内容：{marker} 丢失"
assert raw2.count("> 上轮实查：") == raw.count("> 上轮实查：") + 1, (
    f"「上轮实查」应恰 +1 条：{raw.count('> 上轮实查：')} → {raw2.count('> 上轮实查：')}"
)

# --- 2) §44.5：在 `9ai.` 之后插入 `9aj.` ----------------------------------------
lines = raw2.splitlines(keepends=True)

idx_9ai = None
for i, ln in enumerate(lines):
    if ln.startswith("   - **9ai."):
        idx_9ai = i
        break
assert idx_9ai is not None, "在 §44.5 找不到 `9ai.` 锚点行"
assert lines[idx_9ai + 1].strip() == "", "`9ai.` 之后应为空行（编号序列边界）"
assert lines[idx_9ai + 2].startswith("10. "), "空行之后应为 `10.` 条目（确认这是 9* 序列末尾）"

NEW_9AJ = (
    "   - **9aj. （闭环回测线 · `CLOSED-LOOP-BACKTEST-PERSIST-001`）「每次回测都有结果、且有地方可看」：新增留档表 + `loopRun` 自动落档 + 「回测历史」页面** ✅ **已完成（2026-09-14 13:22 GMT+8，CODE_READY）**："
    "触发 = 用户「**我需要现在的回测每次都有回测结果，并且有地方可以展示**」。"
    "**根因（读代码得出）** = `loopRun` 注释**原文「无状态、不落库」**，跑完即弃；legacy `backtest_runs` **已有**保存 + 历史页但**只服务龙头候选**（真实库仅 **1 行**、`resultJson` **5.6 MB**），两者**不同表不同口径、禁互灌**；`research_run.executionLogJson` 是**批次日志**、**不能复用**。"
    "**做法**：① 新表 `closed_loop_backtest_run`（**23 列 / 3 索引 / 零 FK**，迁移 `0037` + 幂等 apply 脚本 + 真实库 `information_schema` 断言）；"
    "② `server/closedLoopBacktestRun/`（`summary.ts` 纯函数「字符串数字一律 null」+ `repository.ts` 仓储「列表只读摘要列」）；"
    "③ `loopRun` 尾部 **best-effort 自动留档**（try/catch 吞错 ⇒ 留档失败**绝不阻断回测**；`runId` UNIQUE + `ON DUPLICATE KEY UPDATE` ⇒ **重试幂等收敛**）；"
    "④ 新增 `listBacktests` / `getBacktest` 两端点（带 `output()` 契约）；⑤ 前端 adapter + `/backtest-runs` 页面（**复用** `ClosedLoopRunResultPanel` ⇒ **零口径漂移**）+ 侧栏「回测历史」入口。"
    "**实证（19 项断言全绿 / PASS / 108,961 ms，真实 tRPC 同路径）**：留档 **2→3 行自动 +1**；列表摘要 **9 项逐一等于**运行结果；**列表不携带 `resultJson`**（结构性保证「列表轻」）；详情 **`stages=14` + `trades=90` + `equityCurve=36`**；同 `runId` 写两次**仍 1 行**。"
    "**验收**：`tsc` **exit 0**；全量 `vitest` **238 文件 / 16 例失败 = 既有基线、零新增**；`vite build` **exit 0**（17.76 s）；迁移 apply **`PASS=True`**。"
    "**边界**：零新依赖、零 `db:push`。**遗留**：`overall=PARTIAL_BLOCKED`（首阻塞 `CL_RUNNER_NOT_INJECTED`）属**既有覆盖缺口**、不影响留档链路；留档失败的降级目前**只在服务端日志可见、前端未提示**。\r\n"
)

assert "9aj." not in raw2, "`9aj.` 已被占用（编号冲突）⇒ 应改用下一个未占用编号"
lines.insert(idx_9ai + 2, NEW_9AJ)
raw3 = "".join(lines)

# 写后断言
assert raw3.count("   - **9aj.") == 1, "`9aj.` 写入异常"
assert "   - **9ai." in raw3 and "10. **（RESEARCH-003 硬前置）" in raw3, "§44.5 手术破坏了相邻条目"
assert raw3.count("\n") - raw3.count("\r\n") == 0, "写入后出现裸 LF"
assert len(raw3) > len(raw2), "内容未增长"

print(f"[ok] §44 新增本轮条目 1 条（沿用既有 `上轮实查：` 格式，不改写旧条目）")
print(f"[ok] 字节 {len(raw.encode('utf-8'))} → {len(raw3.encode('utf-8'))}")
print(f"[ok] 行数 {raw.count(chr(10))} → {raw3.count(chr(10))}")

if DRY:
    print("[dry-run] 未写盘")
    sys.exit(0)

with io.open(PATH, "wb") as f:
    f.write(raw3.encode("utf-8"))
print(f"[done] 已写入 {PATH}")
