# -*- coding: utf-8 -*-
"""向 docs/evidence/README.md 追加 `backtestpersist` 分组（探针索引登记）。

幂等：已含 `backtestpersist` 则跳过。
"""
import sys

README = "docs/evidence/README.md"
MARKER = "backtestpersist"

BLOCK = """
---

### `backtestpersist` —— 4 组（2026-09-13 闭环回测「零成交」根因修复 + 2026-09-14「每次回测自动留档」）

> **背景**：用户先报「运行策略后前端没有任何东西产生」（2026-09-13），修复后又报
> 「每次回测的结果应该保存，并有地方可以展示」（2026-09-14）。两轮指向同一件事：
> **闭环 `loopRun` 此前是无状态调用，跑完即弃** —— 结果既不展示、也不落库。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_backtest_zero_trades.mts` | 🔴 **「0 成交」根因取证（改动前）**：registry 直读 23,978 行 ⇒ **59/59 单全 `SUSPENDED`、0 成交、权益曲线恒 100,000**；同一策略同窗口强制 rebuild ⇒ **133 笔成交 / 期末 112,169.43（+12.17%）**；「执行日有没有行」逐单核对：registry 意图 60 → 有行 **0**、rebuild 意图 255 → 有行 **250** | `ROADMAP.md` §44 |
| `_probe_after_fix_backtest_output.mts` + `.json` | ✅ **修复后真实 tRPC 复验（6/6 PASS，8m21s）**：`datasetSource=rebuild` / **292,489 行** / `tradeCount=133` / `finalEquity=112169.43` / 曲线 57 点中 **54 个不同取值（非平）** / `byReason={INSUFFICIENT_CASH:6}`（**零 `SUSPENDED`**） | `ROADMAP.md` §44 |
| `_probe_backtest_storage_state.mts` + `.json` | 🔴 **留档现状取证**：legacy `backtest_runs` 真实库**存在但仅 1 行**（2026-09-04 16:27，单条 `resultJson` **5,610,196 字符 ≈ 5.6MB**）；`research_run` 实查 13 列（`executionLogJson` 是**批次日志**、非结果）⇒ 证明闭环结果**无处可落** | 本轮 `ROADMAP.md` §44 |
| `_probe_closed_loop_persist_e2e.mts` + `.json` | ✅ **留档端到端（真实 tRPC + 真库）**：跑一次 ⇒ 留档 **+1 行**；列表摘要**逐字段等于**运行结果（9 项比对）；详情含完整 `stages`（14 阶段）与权益曲线/成交明细；**列表不携带长文本结果**；同 `runId` 写两次**仍只有一行**（幂等收敛），且探针自清理不留污染 | 本轮 `ROADMAP.md` §44 |
"""

text = open(README, "r", encoding="utf-8").read()
if MARKER in text:
    print("SKIP：README 已含 %s" % MARKER)
    sys.exit(0)
if not text.endswith("\n"):
    text += "\n"
open(README, "w", encoding="utf-8", newline="\n").write(text + BLOCK)
print("OK：README 追加 %d 字符，总行数 = %d" % (len(BLOCK), len(open(README, encoding="utf-8").read().splitlines())))
