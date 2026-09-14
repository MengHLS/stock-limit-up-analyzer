"""归档本轮「运行结果刷新即丢」诊断 + 修复。

四个文件（**全部纯 LF**，故用 `\n` 拼接；`ROADMAP.md` 的 CRLF 规则不适用于这里）：

1. `.workbuddy/memory/PROJECT_RULES.md` —— ① **更正**第 64 行失效的「本机 3000」端口判据；
   ② 末尾追加「运行结果刷新即丢」章节。
2. `ROADMAP-CHANGELOG.md` —— append-only 追加本轮条目。
3. `.workbuddy/memory/2026-09-14.md` —— append-only 追加当日条目。
4. `docs/evidence/README.md` —— 追加 `runrestore` 证据分组。

用法：
    python docs/evidence/_append_archive_run_restore.py --dry-run
    python docs/evidence/_append_archive_run_restore.py
"""

from __future__ import annotations

import sys
from pathlib import Path

DRY = "--dry-run" in sys.argv
LF = "\n"

RULES = Path(".workbuddy/memory/PROJECT_RULES.md")
CHANGELOG = Path("ROADMAP-CHANGELOG.md")
DAILY = Path(".workbuddy/memory/2026-09-14.md")
EVIDENCE = Path("docs/evidence/README.md")

# ===========================================================================
# 1) PROJECT_RULES：更正端口判据（3000 已不可 bind）+ 追加新章节
# ===========================================================================

RULES_PORT_OLD = (
    "- 端口取 `.env` 的 `PORT`，本机 **3000**。🔴 **8000~9000 段不可用**"
    "（Windows 保留段，bind 报 `EACCES` 而非 `EADDRINUSE` ⇒ 连扫 20 个全败并报"
    "「No available port found starting from 8080」）；"
    "查段 `netsh interface ipv4 show excludedportrange protocol=tcp`。"
)

RULES_PORT_NEW = (
    "- 端口取 `.env` 的 `PORT`（= **3000**），但 **2026-09-14 起 `2980~3079` 亦进 Windows 保留段** ⇒ "
    "`bind(3000)` 直接 **`EACCES`**（**不是** `EADDRINUSE`，且 `netstat` **看不到**任何进程占用它 ⇒ "
    "极易误判成「服务没起」）⇒ `server/_core/index.ts#findAvailablePort` **静默回落**"
    "（实测落 **3100 / 3101**），只打一行 `Port 3000 is busy, using port <n> instead`。"
    "🔴 **访问端口必须取启动日志里打印的那个**；访问 `:3000` = 全站不可达（前端表现是 "
    "**Failed to fetch / 白屏**，不是错误码）。🔴 保留段会变 ⇒ **每次启动先看日志**；"
    "查段 `netsh interface ipv4 show excludedportrange protocol=tcp`（带 `*` 者为受管段）。"
    "另：**8000~9000 段亦不可用**（同 `EACCES`，连扫 20 个全败报「No available port found starting from 8080」）。"
)

RULES_SECTION = LF + (
    "## 🔴 运行结果「刷新即丢」（RUN-RESULT-RESTORE-001 · 2026-09-14）"
    + LF
    + LF
    + "**症状**：用户报「我刚才跑过的回测，结果又没了」。**实查结论：数据没丢，丢的是展示层。**"
    + LF
    + LF
    + "- **根因（展示层）**：`client/src/pages/StrategyDetail.tsx#RunTab` 把 `loopRun` 结果**只**写进 "
    "`useState`；而 `dev` = **单进程** `tsx watch server/_core/index.ts` ⇒ 任何 `server/**` 改动触发的"
    "**整站热重启**（或用户手动刷新）都会**整页重载** ⇒ 结果从内存消失，而空态原文写着「**还没跑过。**」"
    "——**看起来就像「跑过的回测又没了」**。⇒ **判据：凡「跑完才有」的结果，绝不能只活在前端内存里**，"
    "必须有「可回查的落点」+「重载后能恢复」。"
    + LF
    + "- **定案（恢复口径）**：`RunTab` 现为 **本次运行结果优先；无本次结果时，从「回测留档」恢复该策略"
    "最近一次**：`researchRun.listBacktests({strategyId, limit:1})` → `researchRun.getBacktest({id})` → "
    "`buildClosedLoopRunViewModel` → `ClosedLoopRunResultPanel`（与运行工作台**同一函数 + 同一面板**）"
    "⇒ 零口径漂移。"
    + LF
    + "- **展示优先级（固定，勿改序）**：**本次运行结果 → 留档恢复 → 明说原因 → 读取中 → 空态**。"
    "（本次结果永不被旧留档顶掉。）"
    + LF
    + "- 🔴 **禁谎**：无留档时空态只能写「这个策略还**没有运行记录**」，**禁**写「还没跑过」"
    "（有留档但未恢复时会变成假话）；「有留档但 `resultJson` 为空」必须**明说**，**不得**伪装成「没跑过」。"
    + LF
    + "- 落点：`tests/client/src/pages/strategyRunResultPersist.test.ts`（**静态扫源码 + 真实 `appRouter` "
    "端点断言**，7 例）钉住上述不变量；端到端走 `docs/evidence/_probe_run_tab_hydration.mts`。"
    + LF
    + "- 同类症状排查顺序（**先环境、再展示层、最后才怀疑引擎**）：① 端口是否回落（看启动日志）；"
    "② 前端结果是否只活内存；③ 库中留档是否真有那行（`docs/evidence/_probe_clbr_rows.mts`）。"
    + LF
)

# ===========================================================================
# 2) ROADMAP-CHANGELOG：append-only
# ===========================================================================

CHANGELOG_SECTION = LF + (
    "## 2026-09-14 14:05 GMT+8 — 「刚才跑过的回测，结果又没了」三层归因 + 展示层修复："
    "策略页运行结果从「只活内存」改为「从留档恢复最近一次」"
    "（`RUN-RESULT-RESTORE-001` · 纯 `client/**` + `tests/**`，CODE_READY）"
    + LF
    + LF
    + "- 触发 = 用户「**我刚才跑过的回测，结果又没了，是什么问题**」。"
    "**实查结论：运行没失败、数据没丢，丢的是展示层。**"
    + LF
    + "- 🔴 三层归因（全部有实查锚点）：① **环境层** —— 端口 3000 落在 Windows 保留段 `2980–3079`，"
    "`node` 直接 `listen(3000)` 返回 **`EACCES`**（**非** `EADDRINUSE`，且 `netstat` 看不到占用者）"
    "⇒ dev server 静默回落 **3101**；② **展示层** —— `StrategyDetail.tsx#RunTab` 结果只存 `useState`，"
    "而 `dev` 是单进程 `tsx watch` ⇒ 整页重载即丢，空态还写着「还没跑过」；③ **数据层** —— "
    "`closed_loop_backtest_run#id=60001`（`cand-270001@1.0.0`、窗口 `2025-01-02~2025-03-31`、"
    "`PARTIAL_BLOCKED`、**208 笔**、期末 **96,481.05**、`stages=14`、曲线 57 点）就是那次运行，"
    "**完整在库**。"
    + LF
    + "- 修复（纯 `client/**`，零迁移、零新端点、`server/**` 一行未改）：新增留档恢复链路，"
    "展示优先级固定「本次 > 留档恢复 > 明说原因 > 读取中 > 空态」；空态不再谎称「还没跑过」并给出 "
    "`/backtest-runs` 入口；`resultJson` 为空**明说**；跑完 `listBacktests.invalidate()`。"
    + LF
    + LF
    + "### 一、实证（真实库 + 真实 dev server）"
    + LF
    + LF
    + "- 新探针 `docs/evidence/_probe_run_tab_hydration.mts` **0 失败 / PASS**：列表按 `createdAt` 倒序、"
    "列表行**不带** `result`、按 `strategyId` 过滤命中、详情摘要与列表**逐字段一致**、"
    "`buildClosedLoopRunViewModel` 构建成功且 `stages=14`、`trades=208/208`、曲线 57 点；"
    "首笔 `sec_314d87cf-…` → **欣天科技 300615.SZ**（名称链路同时可用）。"
    + LF
    + "- **真实 dev server（3101）** 编译并服务改动后模块 **HTTP 200**，响应内含 `restoredFromArchive`×3 / "
    "`listBacktests`×2 / `getBacktest`×1 / `backtest-runs`×3（**不是只过类型检查**）。"
    + LF
    + "- 新增 `tests/client/src/pages/strategyRunResultPersist.test.ts` **7/7 通过**。"
    + LF
    + "- `tsc --noEmit` **exit 0**；`vite build` **15.77s exit 0**；全量 `vitest` 失败**文件集合** = "
    "既有 7 基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / "
    "`tushare.secret` / `tushareTradingCalendar`），**零新增**。"
    + LF
    + "- migration：**无**（本轮零表结构改动）。"
    + LF
    + LF
    + "### 二、可复用的判据"
    + LF
    + LF
    + "- 🔴 **「结果只在内存里」是缺陷，不是实现细节**：凡「跑完才有」的结果必须可从落点恢复，"
    "否则任何热重启 / 刷新都表现为「结果没了」。"
    + LF
    + "- 🔴 **端口回落是静默的**：`netstat` 看不到占用者 + `EACCES` ⇒ 是 Windows 保留段，"
    "**看启动日志而不是猜端口**。"
    + LF
    + "- 🔴 恢复路径**必须复用同一套 ViewModel 构建 + 面板**，否则「恢复出来的」与「刚跑完的」"
    "会漂移成两种口径。"
    + LF
    + LF
    + "### 三、诚实登记"
    + LF
    + LF
    + "- ⚠️ 端口保留段是 **Windows 层现实**（非本仓库可控）：本轮**未**改 `.env` 的 `PORT`，"
    "是否把服务端口固定到保留段之外**待用户决定**。"
    + LF
    + "- ⚠️ 恢复只覆盖「该策略最近一次」；同策略多版本历史仍需去 `/backtest-runs` 逐条看。"
    + LF
    + "- ⚠️ 端口回落目前**只有启动日志一行提示**，前端不可见（可改进项）。"
    + LF
    + "- 登记：§44.5 新编号取 **`9al`**（按「**下一个未占用**」判定 —— 全仓库未占用；**非「末条 +1」**）。"
    + LF
)

# ===========================================================================
# 3) 当日日志：append-only
# ===========================================================================

DAILY_SECTION = LF + (
    "## 14:05 GMT+8 — 「刚才跑过的回测，结果又没了」诊断 + 展示层修复"
    "（`RUN-RESULT-RESTORE-001` · CODE_READY）"
    + LF
    + LF
    + "### 一、结论先说：数据没丢，丢的是展示层"
    + LF
    + LF
    + "- 实查 `closed_loop_backtest_run` 共 **3** 行；`id=60001`（`cand-270001@1.0.0`、"
    "窗口 `2025-01-02~2025-03-31`、`PARTIAL_BLOCKED`、**208 笔**、期末 **96,481.05**、`stages=14`、"
    "曲线 **57** 点）**就是用户那次运行**（`createdAt = 2026-09-14 05:36:41Z` = GMT+8 **13:36**）。"
    + LF
    + "- ⇒ 问题不在「跑」、也不在「落库」。"
    + LF
    + LF
    + "### 二、三层归因"
    + LF
    + LF
    + "- ① **环境**：`listen(3000)` = **`EACCES`**（`netsh` 证实 `2980–3079` 在保留段），"
    "dev server 静默回落 **3101**；`netstat` 里**看不到**任何进程占 3000 ⇒ 极易误判「服务没起」。"
    + LF
    + "- ② **展示层（真缺陷）**：`StrategyDetail.tsx#RunTab` 的 `runResult` 只在 `useState`；"
    "`dev` = 单进程 `tsx watch` ⇒ 改 `server/**` / 刷新 ⇒ 整页重载 ⇒ 结果消失，"
    "空态还写着「**还没跑过。**」。"
    + LF
    + "- ③ **数据层**：无咎（见上）。"
    + LF
    + LF
    + "### 三、修复（纯 `client/**`；`server/**` 一行未改、零迁移、零新端点）"
    + LF
    + LF
    + "- `RunTab` 增留档恢复：`listBacktests({strategyId, limit:1})` → `getBacktest({id})` → "
    "`buildClosedLoopRunViewModel` → `ClosedLoopRunResultPanel`（与运行工作台同一套）。"
    + LF
    + "- 展示优先级固定：**本次运行结果 > 留档恢复 > 明说原因 > 读取中 > 空态**；"
    "空态改「这个策略还没有运行记录」+ `/backtest-runs` 入口；`resultJson` 为空**明说**；"
    "跑完 `invalidate()`。"
    + LF
    + "- 文件：`client/src/pages/StrategyDetail.tsx`（唯一生产文件）+ "
    "`tests/client/src/pages/strategyRunResultPersist.test.ts`（新，7 例）。"
    + LF
    + LF
    + "### 四、实证"
    + LF
    + LF
    + "- `docs/evidence/_probe_run_tab_hydration.mts`（新）**0 失败 / PASS**：`stages=14`、"
    "`trades=208/208`、首笔 → **欣天科技 300615.SZ**。"
    + LF
    + "- **真实 dev server（3101）** 取改动模块 **HTTP 200**，含 `restoredFromArchive`×3 / "
    "`backtest-runs`×3（真机编译服务，非仅 tsc）。"
    + LF
    + "- `tsc` exit 0；`vite build` 15.77s exit 0；全量 `vitest` 失败**文件集合** = 既有 7 基线零新增；"
    "新增契约测试 7/7。"
    + LF
    + "- 本轮起的临时实例（落 **3101**）已用后台任务**停止**，未留残留。"
    + LF
    + LF
    + "### 五、可复用的坑"
    + LF
    + LF
    + "- 🔴 **`netstat` 看不到占用 + `EACCES` = Windows 保留段**，不是「服务没起」；"
    "`EADDRINUSE` 才是被占用。"
    + LF
    + "- 🔴 **凡「跑完才有」的结果，绝不能只活在前端内存**：热重启 / 刷新必然表现为「结果没了」，"
    "且空态会说反话。"
    + LF
    + "- 🔴 恢复路径**必须复用同一套 VM + 面板**，否则恢复出来的与刚跑完的会漂移成两种口径。"
    + LF
    + "- 🔴 **入口文案不得撒谎**：无留档时才能说「没有运行记录」；有留档但缺结果必须**明说**，"
    "不能伪装成「没跑过」。"
    + LF
    + LF
    + "### 六、遗留"
    + LF
    + LF
    + "- ⚠️ 是否把 `.env` `PORT` 移出 Windows 保留段 —— **系统层现实，待用户决定**（本轮未改）。"
    + LF
    + "- ⚠️ 恢复只覆盖「该策略最近一次」；多版本历史去 `/backtest-runs`。"
    + LF
    + "- ⚠️ 端口回落**只有启动日志一行提示**，前端不可见。"
    + LF
)

# ===========================================================================
# 4) 证据索引：追加 runrestore 分组
# ===========================================================================

EVIDENCE_SECTION = LF + (
    "### `runrestore` —— 3 个（2026-09-14 「运行结果刷新即丢」诊断 + 展示层修复）"
    + LF
    + LF
    + "> 触发 = 用户「**我刚才跑过的回测，结果又没了，是什么问题**」（2026-09-14）。"
    + LF
    + "> 核心事实：**数据没丢**（留档 `id=60001` 完整在库），丢的是**展示层**"
    "（结果只存 `useState`，而 `dev` 是单进程 `tsx watch` ⇒ 整页重载即丢）。"
    + LF
    + LF
    + "| 文件 | 结论要点 | 被引用于 |"
    + LF
    + "|---|---|---|"
    + LF
    + "| `_probe_run_tab_hydration.mts` + `.json` | ✅ **刷新恢复路径（真实 tRPC + 真库）· 0 失败 PASS**："
    "`listBacktests({strategyId,limit:1})` 按策略命中且**倒序**；**列表行不带 `result`**；"
    "详情摘要与列表**逐字段一致**；`buildClosedLoopRunViewModel`（**前端同一函数**）构建成功 ⇒ "
    "`stages=14`、`trades=208/208`、曲线 57 点；首笔 `sec_314d87cf-…` → **欣天科技 300615.SZ**；"
    "同时实查 `closed_loop_backtest_run#id=60001`（`cand-270001@1.0.0`、208 笔、期末 96,481.05）"
    "证明「数据没丢」 | 本轮 `ROADMAP.md` §44 |"
    + LF
    + "| `tests/client/src/pages/strategyRunResultPersist.test.ts`（**不在本目录**，登记于此便于溯源） | "
    "✅ **7/7 通过**：静态扫真实源码 + 真实 `appRouter` 端点断言，钉住「留档恢复存在 / 按策略取最近一次 / "
    "**本次结果优先**（分支顺序）/ 复用同一套 VM + 面板 / 空态**禁**谎称「还没跑过」/ `resultJson` 为空"
    "必须明说 / 跑完 `invalidate`」 | 同上 |"
    + LF
    + "| `_dev_boot_check.log` | 🔴 **端口取证**：实测 `Port 3000 is busy, using port 3101 instead` "
    "⇒ 3000 落在 Windows 保留段 `2980–3079`（`node` 直接 `listen(3000)` = **`EACCES`**、"
    "**非** `EADDRINUSE`；`netstat` **看不到**占用者）⇒ **必须按启动日志打印的端口访问** | 同上 |"
    + LF
)

# ===========================================================================
# 执行
# ===========================================================================

failures: list[str] = []
patched: dict[Path, str] = {}


def patch(path: Path, old: str | None, new: str, label: str) -> None:
    # 🔴 同一文件连续 patch 时必须基于**内存中的前序结果**，否则第二次改动会覆盖第一次。
    raw = patched.get(path) or path.read_bytes().decode("utf-8")
    assert raw.count("\r\n") == 0, f"{path} 不是纯 LF"
    before = raw.count(LF)
    if old is None:
        assert not raw.endswith("\n\n\n"), f"{path} 尾部异常"
        out = raw + new
    else:
        assert raw.count(old) == 1, f"{label} 锚点出现次数异常：{raw.count(old)}"
        out = raw.replace(old, new, 1)
        assert out != raw, f"{label} 替换未发生"
    assert out.count("\r\n") == 0, f"{label} 写入引入了 CRLF"
    delta = out.count(LF) - before
    print(f"[ok] {path} | 行 {before} → {out.count(LF)}（+{delta}）| {label}")
    patched[path] = out


patch(RULES, RULES_PORT_OLD, RULES_PORT_NEW, "PROJECT_RULES 更正端口判据")
patch(RULES, None, RULES_SECTION, "PROJECT_RULES 追加「运行结果刷新即丢」章节")
patch(CHANGELOG, None, CHANGELOG_SECTION, "CHANGELOG append")
patch(DAILY, None, DAILY_SECTION, "当日日志 append")
patch(EVIDENCE, None, EVIDENCE_SECTION, "证据索引 append")

# 写后复核：基于**内存结果**（dry-run 也要能复核）
assert "本机 **3000**。🔴 **8000~9000 段不可用**" not in patched[RULES], "旧的端口判据未被更正"
assert patched[RULES].count("RUN-RESULT-RESTORE-001") == 1
assert patched[RULES].count("2980~3079") == 1
assert patched[CHANGELOG].count("RUN-RESULT-RESTORE-001") >= 1
assert patched[DAILY].count("RUN-RESULT-RESTORE-001") == 1
assert patched[EVIDENCE].count("`runrestore`") == 1
for p, text in patched.items():
    assert text.count("\r\n") == 0, f"{p} 行尾被污染"

print("\n[ok] 四个文件全部通过写后断言（纯 LF 保持）")
if DRY:
    print("[dry-run] 未写盘")
else:
    for p, text in patched.items():
        p.write_bytes(text.encode("utf-8"))
    print("[written] 已写盘")
