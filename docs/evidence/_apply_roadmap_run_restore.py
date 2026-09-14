"""把「运行结果刷新即丢」的诊断 + 修复写入 ROADMAP.md §44 / §44.5。

规范：
- `ROADMAP.md` 是**纯 CRLF** ⇒ 只能 `read_bytes().decode()` / `write_bytes()`，
  绝不用 `read_text()`（会静默把 CRLF 转成 LF —— 2026-09-14 已实测踩过）。
- §44 条目是**单行**（既有条目最长 5,148 字符）⇒ 本轮同样单行，不引入多行块。
- §44「上轮实查：」条目**只插入、不改写**（前缀每轮都保留）⇒ 本轮插到最上方。
- §44.5 编号取**下一个未占用**（已实查 `9al` 未占用），**禁「末条 +1」**。

用法：
    python docs/evidence/_apply_roadmap_run_restore.py --dry-run
    python docs/evidence/_apply_roadmap_run_restore.py
"""

from __future__ import annotations

import sys
from pathlib import Path

DRY = "--dry-run" in sys.argv
TARGET = Path("ROADMAP.md")

CRLF = "\r\n"

# --- §44：插到最上方那条「上轮实查」之前（条目为**单行**） ---------------------------
SEC44_ANCHOR = "> 上轮实查：**2026-09-14 13:58 GMT+8 · 成交明细展示「证券名称 + 代码」"

SEC44_ENTRY = (
    "> 上轮实查：**2026-09-14 14:05 GMT+8 · 「刚才跑过的回测结果又没了」三层归因 + 展示层修复："
    "策略页运行结果从「只活内存」改为「无本次结果时从留档恢复该策略最近一次」 · 状态 CODE_READY**"
    "（`RUN-RESULT-RESTORE-001`）。触发 = 用户「**我刚才跑过的回测，结果又没了，是什么问题**」。"
    "**一、三层归因（全部有实查锚点，不猜）**：① **环境层**："
    "`netsh interface ipv4 show excludedportrange protocol=tcp` 显示 **`2980–3079` 被 Windows 保留**，"
    "`node` 直接 `listen(3000)` 返回 **`EACCES: permission denied`**（**不是** `EADDRINUSE`）⇒ "
    "`server/_core/index.ts#findAvailablePort` **静默回落 3101**；若仍访问 `:3000` 则整站不可达。"
    "② **展示层（真正的缺陷）**：`client/src/pages/StrategyDetail.tsx#RunTab` 原先把 `loopRun` 结果"
    "**只**写进 `useState`，而 `dev` = 单进程 `tsx watch server/_core/index.ts` ⇒ 任何 `server/**` "
    "改动触发的热重启、或用户手动刷新，**整页重载即丢结果**，且空态还写着「还没跑过」——这正是"
    "「跑过的回测又没了」的观感来源。③ **数据层无咎**：实查 `closed_loop_backtest_run` 共 3 行，"
    "其中 `id=60001`（`cand-270001@1.0.0`、窗口 `2025-01-02~2025-03-31`、`PARTIAL_BLOCKED`、"
    "**208 笔成交**、期末权益 **96,481.05**、`stages=14`、权益曲线 57 点）**就是用户那次运行，"
    "完整在库**。**二、修复（纯 `client/**`，`server/**` 零改动、零迁移、零新端点）**：`RunTab` 增"
    "「留档恢复」链路 —— `listBacktests({strategyId, limit:1})` → `getBacktest({id})` → "
    "`buildClosedLoopRunViewModel`（与运行工作台**同一个**函数）→ `ClosedLoopRunResultPanel`"
    "（**同一个**面板）⇒ **零口径漂移**。展示优先级固定为：**本次运行结果 > 留档恢复 > 明说原因 > "
    "读取中 > 空态**（本次结果永不被旧留档顶掉）。空态**不再谎称**「还没跑过」，改为「这个策略还没有"
    "运行记录」并给出 `/backtest-runs` 入口；「有留档但缺完整结果（`resultJson` 为空）」**明说原因**，"
    "不把「记录坏了」伪装成「没跑过」；运行成功后 `listBacktests.invalidate()` 让留档列表即时对齐。"
    "**三、验收（真实库 + 真实 dev server，非纸面）**：新探针 "
    "`docs/evidence/_probe_run_tab_hydration.mts` **0 失败 / PASS**（列表按 `createdAt` 倒序、"
    "列表行**不带** `result`、按 `strategyId` 过滤命中、详情摘要与列表**逐字段一致**、VM 构建成功且 "
    "`stages=14`、`trades=208/208`、首笔 `sec_314d87cf-…` → **欣天科技 300615.SZ**，名称链路同时可用）；"
    "**真实 dev server（3101）** 编译并服务改动后模块 HTTP 200（含 `restoredFromArchive`×3 / "
    "`listBacktests`×2 / `getBacktest`×1 / `backtest-runs`×3）；新增契约测试 "
    "`tests/client/src/pages/strategyRunResultPersist.test.ts` **7/7 通过**；`tsc --noEmit` **exit 0**、"
    "`vite build` **15.77s exit 0**、全量 `vitest` 失败**文件集合** = 既有 7 基线"
    "（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / "
    "`tushare.secret` / `tushareTradingCalendar`）**零新增**。**四、如实登记的未决项**：① 端口保留段是 "
    "**Windows 层现实**（`netsh` 可查、非本仓库可控），本项目**未**改 `.env` 的 `PORT` —— 是否把服务"
    "端口固定到保留段之外需用户决定；② 恢复只覆盖「该策略最近一次」，同策略多版本历史仍需去 "
    "`/backtest-runs` 逐条看；③ 端口回落当前**只有启动日志一行提示**，前端不可见（可改进项）。"
)

# --- §44.5：追加队列项（编号 = 下一个未占用 = 9al；条目为单行） ----------------------
SEC445_ANCHOR = "10. **（RESEARCH-003 硬前置）`ds_*` 口径核对 + 版本可用性修复**"

SEC445_ENTRY = (
    "   - **9al. （闭环回测线 · `RUN-RESULT-RESTORE-001`）「刷新后运行结果就没了」：策略页运行结果"
    "从「只活内存」改为「无本次结果时从留档恢复该策略最近一次」** ✅ **已完成（2026-09-14 14:05 GMT+8，"
    "CODE_READY）**：触发 = 用户「**我刚才跑过的回测，结果又没了，是什么问题**」。**根因三层**："
    "① `StrategyDetail.tsx#RunTab` 结果只存 `useState`，而 `dev` 是单进程 `tsx watch`（改 `server/**` "
    "即整站热重启）⇒ 整页重载即丢，空态还谎称「还没跑过」；② 数据**没丢** —— "
    "`closed_loop_backtest_run#id=60001`（`cand-270001@1.0.0`、208 笔、期末 96,481.05）就是那次运行；"
    "③ 环境另有暗坑：端口 3000 落在 Windows 保留段 `2980–3079`（`listen` 返回 **`EACCES`**），"
    "dev server **静默回落 3101**。**修复**（纯 `client/**`，零迁移）："
    "`listBacktests({strategyId,limit:1})` → `getBacktest` → `buildClosedLoopRunViewModel` → "
    "`ClosedLoopRunResultPanel`（与运行工作台**同一套**，零口径漂移）；优先级「本次 > 留档恢复 > "
    "明说原因 > 读取中 > 空态」；`resultJson` 为空**明说**，不伪装「没跑过」；跑完 "
    "`listBacktests.invalidate()`。**验收**：探针 `_probe_run_tab_hydration.mts` **PASS / 0 失败**"
    "（`stages=14`、`trades=208/208`、首笔 → 欣天科技 300615.SZ）；真实 dev server（3101）编译服务"
    "改动模块 HTTP 200；新增 `tests/client/src/pages/strategyRunResultPersist.test.ts` **7/7**；"
    "`tsc` 0、`vite build` 15.77s、全量 `vitest` 失败文件集合 = 既有 7 基线零新增。**未决**：是否把 "
    "`.env` `PORT` 移出 Windows 保留段（系统层现实，需用户决定）。"
)

assert SEC44_ENTRY.count("\n") == 0, "§44 条目必须是单行（与既有条目一致）"
assert SEC445_ENTRY.count("\n") == 0, "§44.5 条目必须是单行（与既有条目一致）"

raw = TARGET.read_bytes().decode("utf-8")  # noqa: 必须 bytes，禁 read_text（会静默转 LF）

# ---------- 前置断言 ----------
assert raw.count("\n") - raw.count("\r\n") == 0, "ROADMAP.md 本轮写入前已不是纯 CRLF，拒绝继续"
assert raw.count(SEC44_ANCHOR) == 1, f"§44 锚点出现次数异常：{raw.count(SEC44_ANCHOR)}"
assert raw.count(SEC445_ANCHOR) == 1, f"§44.5 锚点出现次数异常：{raw.count(SEC445_ANCHOR)}"
assert raw.count("9al.") == 0, f"编号 9al 已被占用：{raw.count('9al.')}"
assert raw.count("9ak.") == 1, f"9ak 锚点异常：{raw.count('9ak.')}"
assert raw.count("9aj.") == 1, f"9aj 锚点异常：{raw.count('9aj.')}"
lines_before = raw.count("\n")
upstream_before = raw.count("> 上轮实查：")

# ---------- §44：在最上方「上轮实查」之前插入本轮条目 + 一条 `>` 分隔 ----------
raw2 = raw.replace(SEC44_ANCHOR, SEC44_ENTRY + CRLF + ">" + CRLF + SEC44_ANCHOR, 1)
assert raw2 != raw, "§44 替换未发生"

# ---------- §44.5：在 `10.` 之前追加 `9al.`（空行 + 条目 + 空行，与既有风格一致） ----------
raw3 = raw2.replace(SEC445_ANCHOR, CRLF + SEC445_ENTRY + CRLF + SEC445_ANCHOR, 1)
assert raw3 != raw2, "§44.5 替换未发生"

# ---------- 写后断言 ----------
expected_delta = SEC44_ENTRY.count("\n") + 2 + SEC445_ENTRY.count("\n") + 2
assert raw3.count("\n") - raw3.count("\r\n") == 0, "写后 CRLF 纯度被破坏"
assert raw3.count(SEC44_ANCHOR) == 1, "§44 旧条目丢失"
assert raw3.count(SEC445_ANCHOR) == 1, "§44.5 旧锚点丢失"
assert raw3.count("> 上轮实查：") == upstream_before + 1, (
    f"「上轮实查」应恰 +1 条：{upstream_before} → {raw3.count('> 上轮实查：')}"
)
assert raw3.count("9al.") == 1, f"9al 应恰 1 处：{raw3.count('9al.')}"
assert raw3.count("9ak.") == 1 and raw3.count("9aj.") == 1, "既有编号被破坏"
for marker in ("# 44. 项目真实状态映射（数据快照）", "触发 = 用户「**我不需要Json高级模式"):
    assert marker in raw3, f"手术破坏了既有内容：{marker} 丢失"
delta = raw3.count("\n") - lines_before
assert delta == expected_delta, f"行数增量应为 {expected_delta}，实际 {delta}"

print(f"[ok] 行数 {lines_before} → {raw3.count(chr(10))}（+{delta}）")
print("[ok] §44 新增 1 条「上轮实查」（单行，插在最上方；旧条目原样保留）")
print("[ok] §44.5 新增 `9al.`（下一个未占用编号，插在 `10.` 之前）")

if DRY:
    print("[dry-run] 未写盘")
else:
    TARGET.write_bytes(raw3.encode("utf-8"))
    print("[written] ROADMAP.md 已更新")
