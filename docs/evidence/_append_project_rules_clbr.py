# -*- coding: utf-8 -*-
"""
PROJECT_RULES.md **append-only** 追加 —— 闭环回测留档细则（CLOSED-LOOP-BACKTEST-PERSIST-001）。

注意：PROJECT_RULES.md 是**纯 LF** ⇒ 追加内容用 "\\n"。
用法：python docs/evidence/_append_project_rules_clbr.py [--dry-run]
"""
import io
import sys

PATH = ".workbuddy/memory/PROJECT_RULES.md"
DRY = "--dry-run" in sys.argv

raw = open(PATH, "rb").read().decode("utf-8")
assert raw.count("\r\n") == 0, "PROJECT_RULES.md 应为纯 LF ⇒ 拒绝追加"
assert raw.endswith("\n"), "文件末尾无换行"
before_lines = raw.count("\n")

MARK = "## 🔴 闭环回测留档（CLOSED-LOOP-BACKTEST-PERSIST-001"
assert MARK not in raw, "本节已追加过（防重复）"

BLOCK = """

## 🔴 闭环回测留档（CLOSED-LOOP-BACKTEST-PERSIST-001 · 2026-09-14）

**判据：闭环 `loopRun` 每次执行都必须留下一行可回看的记录。** 页面 = `/backtest-runs`（侧栏「量化回测」组的「回测历史」）。

- **表 = `closed_loop_backtest_run`**（迁移 `0037`；**23 列 / 3 索引 / 零 FK**）。坐标列（`runId` **UNIQUE** / `experimentId` / `strategyId` / `strategyVersion` / `startDate` / `endDate` / `datasetVersion` / `datasetVersionId` / `datasetSource` / `recipeId`）+ 摘要列 + `resultJson`(longtext) + `createdAt`。
- 🔴 **禁与 legacy `backtest_runs` 互灌**：后者只服务龙头候选 `LeaderCandidateBacktestResult`（真实库仅 **1 行**、`resultJson` **5.6MB**），**不同表、不同口径**。`research_run.executionLogJson` 是**批次日志**（非结果）⇒ **也不能复用**。
- 🔴 **落档是 best-effort 旁路**：`loopRun` 尾部的 `await persistClosedLoopBacktestRun(...)` **try/catch 吞错 + `console.warn`** ⇒ **留档失败绝不阻断回测**（结果已算出来，不能因写历史失败而丢弃）。代价 = 「**历史少一条**」，是**如实可见的降级**；目前**只在服务端日志可见、前端未提示**。
- 🔴 **幂等靠 `runId` UNIQUE + `ON DUPLICATE KEY UPDATE`**（除 `runId` 外全列覆盖）⇒ **同一次运行的重试收敛为一行**，读回的是**后一次**的值。
- 🔴 **列表端点禁读 `resultJson`**：`listClosedLoopBacktestRuns` 只 SELECT 摘要列（limit 收敛 **1..200**、默认 50）；长文本只在 `getClosedLoopBacktestRun(id)`。⇒ **「列表轻」是结构性保证，不是口头承诺。**
- 🔴 **坏记录要响亮报错**：`resultJson` 为 `NULL` = 「本次未留完整结果」；文本存在但解析失败 / 结构非法 ⇒ **抛错**（**不把「记录坏了」伪装成「没跑过」**）。
- 🔴 **摘要取值不做隐式转换**（`summary.ts#asFiniteNumber` 只接受 `number` 且有限；字符串 `"133"` 一律 `null`）；**「真实 0」与「取不到」必须区分**（`backtest` 阶段非 `EXECUTED` ⇒ 权益 / 成交为 `null` **而非 `0`**）。
- **前端**：`client/src/pages/BacktestRuns.tsx`，URL 坐标 `?id=<留档行 id>`（点同一行再点 = 收起）；详情**复用** `buildClosedLoopRunViewModel` + `ClosedLoopRunResultPanel` ⇒ 与运行工作台**同一套渲染、零口径漂移**；列表**不显示收益率**（需重算口径）⇒ 只并列展示「初始资金 / 期末权益」**原始值**；缺失显示「—」**不显示 0**。
- **探针**：`docs/evidence/_probe_closed_loop_persist_e2e.mts`（端到端 **19 项断言** + 幂等）、`_probe_clbr_rows.mts`（行巡检；`--clean-probe-rows` 按**双重命名守卫**「`experimentId LIKE 'EXP-PROBE%'` **且** `strategyId LIKE 'probe-%'`」清理，**只命中单侧守卫的行只列出、不自动删**）。
- ⚠️ **探针必须自清理，且清理判据要绑「可识别命名域」而不是「本次 `runId`」**：首跑崩溃时注入的幂等行（`EXP-PROBE-IDEM`）**次跑的自清理删不掉**（它只删自己那次的新 `runId`）⇒ 残留会污染产品页。
"""

raw2 = raw + BLOCK
assert raw2.count("\r\n") == 0, "追加后出现 CRLF"
assert raw2.startswith(raw), "append-only 被破坏"
assert raw2.count(MARK) == 1, "新章节写入异常"

print(f"[ok] append-only：行数 {before_lines} → {raw2.count(chr(10))}")
print(f"[ok] 字节 {len(raw.encode('utf-8'))} → {len(raw2.encode('utf-8'))}（纯 LF 保持）")

if DRY:
    print("[dry-run] 未写盘")
    sys.exit(0)

with io.open(PATH, "wb") as f:
    f.write(raw2.encode("utf-8"))
print(f"[done] 已追加到 {PATH}")
