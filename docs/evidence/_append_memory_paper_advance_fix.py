# -*- coding: utf-8 -*-
"""追加当日日志：本轮「推进」按钮修复（append-only，禁覆盖）。

纪律：2026-09-14.md 纯 LF ⇒ read_bytes().decode() + write_bytes()，写前后双向断言。
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
P = Path(r"C:\work\sourcecode\stock-limit-up-analyzer\.workbuddy\memory\2026-09-14.md")

BLOCK = """
## 17:38 GMT+8 — 「推进」按钮修复：补数 + 三态诊断加固 + 真实验证（`PAPER-TRADING-ADVANCE-NOOP-001`）

**用户裁定**（承 17:15 诊断）：「**补数据 + 代码加固（推荐）**」，补数源「**baostock（与现有一致）**」。

### 一、补数（`index_daily` 交易日历缺口）
- 命令：`MARKETDATA_PYTHON="C:/Python312/python.exe" npx tsx scripts/backfillIndex.ts --provider=baostock --start=2026-09-05 --end=2026-09-14 --force`
- 结果：**4 指数 × 6 交易日 = 24 行**（`index_master=4`）；补后 `index_daily` = **7,476 行 / 1,869 distinct 日 / 末端 2026-09-14**
  ⇒ 与 `stock_daily_prices` / `limit_up_records`（均 1,869 日、末端 09-14）**逐日一致**。
- 🔴 **`--force` 必需**：`backfillIndex.ts#isCoverageFresh` 容忍「末端相差 ≤ 30 天」即判「已覆盖」⇒
  不加 `--force` 会**静默不补**（这正是缺口能存活 6 个交易日的机制）。

### 二、代码加固（`server/**` 3 文件 + `client/**` 1 文件 + `tests/**`；零迁移 / 零新端点 / 零新依赖）
1. `server/paperTrading.ts` 新增**纯函数诊断层**（零 IO，第 699~807 行）：`classifyAdvanceKind()` 三态
   （`advanced` / `already-latest` / `calendar-stale`，判据 = `marketLastDate > calendarLastDate`
   ⇒ **参照物必须是行情末端**，因为「日历该不该更长」只能由行情回答）、
   `paperTradingAdvanceDiagnosis()`（人话结论）、`PaperTradingCalendarStaleError`（`code = "PAPER_TRADING_CALENDAR_STALE"`）。
2. `server/db.ts`：`advancePaperTradingRunToLatest` 返回类型改为 **`{ summary, diagnosis }`**
   （原 `PaperTradingSummary | null`），`datesToAdvance.length === 0` 时**返回诊断而非静默旧摘要**；
   `createPaperTradingRun` **前置校验**（`signalDate > calendarLastDate` 或日历为空 ⇒ 抛错、**不落库**）；
   `advanceAllActivePaperTradingRuns` 每条带 `diagnosis`。
3. `server/routers.ts`：建运行端点 catch 该错误并把**领域码写进 message**（`toTrpcError` 不带 `cause` 的既有铁律）。
4. `server/paperTradingScheduler.ts`：日志逐条 `#id=kind(N日)`；`calendar-stale` 时 `console.warn` 显式告警（不再静默）。
5. `client/src/pages/PaperTrading.tsx`：`advanceMutation.onSuccess` 按 `diagnosis.kind` **分流三种 toast**
   （`calendar-stale → toast.warning` / `advanced → success` / 其余 `info`）+ 三色 `advanceNotice` 横幅（可关闭）。

### 三、实证（真实 tRPC + 真库 + 真机 dev server；非纸面）
- `docs/evidence/_probe_paper_advance_e2e.mts` **17 / 17 PASS**（真实 tRPC 全链 `appRouter.createCaller`）：
  补数后 `#1` **推进 09-11、09-14 两日**（`filledCount=5` / `openPositionCount=3` / `exitedCount=2` /
  `finalEquity=100,468.08` / `tradingDayCount=2`）；`stateJson` **1,960 → 3,466 字符**、`equityCurve` 2 点；
  **二次推进如实报 `already-latest`**；不存在 id ⇒ `run-not-found`。
  ⚠️ 该探针**会写入** `paper_trading_runs`（推进职责所在，已在文件头声明）。
- `docs/evidence/_probe_paper_create_guard.mts` **5 / 5 PASS**：建运行**正向路径**可用（新守卫**不误锁**），
  探针行按**可识别命名域** `PROBE-CALENDAR-GUARD-` 自清理、零残留。
- 单测 `tests/server/paperTrading.test.ts` **10 → 22 例全过**（三态判定 5，含事故现场常量
  `CALENDAR_END=2026-09-04` / `MARKET_END=2026-09-14`；人话结论 6；错误类 1）。复跑确认 **22/22**。
- `npx tsc --noEmit` **exit 0**；全量 `npx vitest run` **242 文件 / 4,015 passed / 16 failed = 精确 7 基线文件、零新增**；
  `npx vite build` **RC=0**（3,030 模块 / 19.01s）。
- 真机 dev server（**3100**）取改动后模块 `HTTP 200`（139,211 bytes，含 `calendarStale` / `advanceNotice` /
  `toast.warning` / `AlertTriangle`）⇒ **不是只过类型检查**。

### 四、未做 / 未取证（诚实登记，勿当已完成）
1. 建运行守卫的**反向分支**（日历真落后 ⇒ 真抛 `PAPER_TRADING_CALENDAR_STALE`）**本轮未取证** ——
   需**篡改日历数据**才能构造；已证的是**正向路径不受影响**（不会误锁新建运行）。
2. `index_daily` **仍无自动同步**（属数据同步域的独立任务）；本轮只补数据 + 让下游如实报错，**未加定时任务**。

### 五、归档（总控三件套 + 配套）
- `ROADMAP.md`：§44 **插入** 17:38 条（旧条目一条未改）+ §44.5 追加 **`9ao`**
  （🔴 按「**下一个未占用**」判定 —— 实查已用到 `9an`，`9ao.` 出现 0 次；**非「末条 +1」**）。
- `ROADMAP-CHANGELOG.md`：append 17:38 条（含实证 / 可复用判据 / 诚实登记）。
- `.workbuddy/memory/PROJECT_RULES.md`：「数据源与回填」补 `index_daily` 无自动同步 + `--force`；
  新增一节「🔴 前向纸面交易『推进』恒 no-op 却报成功（PAPER-TRADING-ADVANCE-NOOP-001）」。
- `docs/evidence/README.md`：新分组 `papertradingadvance`（6 个）。
- `.workbuddy/memory/MEMORY.md`：新增「前向纸面交易（`/paper-trading`）」节 + 编号更新为 `9ao`。
- 归档脚本（均带锚点 / 行尾 / 回读断言）：`_append_archive_paper_advance.py`、
  `_append_rules_paper_advance.py`、`_verify_archive_paper_advance.py`（校验 **ALL PASS**）。
"""

raw = P.read_bytes()
text = raw.decode("utf-8")
before = len(text)
assert "\r\n" not in text, "当日日志出现 CRLF"
assert BLOCK not in text, "该小节已存在，勿重复追加"
assert "17:15 GMT+8 — 「前向交易闭环 · 推荐/推进按钮有点问题」诊断" in text, "缺少上轮小节锚点"

new_text = text + BLOCK
assert len(new_text) > before, "未增长"
P.write_bytes(new_text.encode("utf-8"))

back = P.read_bytes().decode("utf-8")
assert back.startswith(text), "非 append-only（前缀被改写）"
assert "\r\n" not in back, "回读出现 CRLF"
assert back.count("## 17:38 GMT+8 — 「推进」按钮修复") == 1
print(f"OK 2026-09-14.md: {before} -> {len(back)} chars (+{len(back) - before})")
print("DONE")
