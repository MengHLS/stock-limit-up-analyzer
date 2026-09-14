# -*- coding: utf-8 -*-
"""把 PAPER-TRADING-ADVANCE-NOOP-001 归档进 Master Control。

纪律：
  - ROADMAP.md 纯 CRLF ⇒ read_bytes().decode() + write_bytes()
  - §44「上轮实查」= 只插入、不改写既有条目（新条目插在最新条目之前）
  - §44.5 编号按「下一个未占用」（实查已用到 9an ⇒ 本轮 9ao；禁「末条 +1」）
  - ROADMAP-CHANGELOG.md / docs/evidence/README.md 纯 LF
  - 写前后都做断言（锚点、行数增量、行尾）
"""
from pathlib import Path

ROOT = Path(r"C:\work\sourcecode\stock-limit-up-analyzer")

# ---------------------------------------------------------------------------
# §44 正文（单行）
# ---------------------------------------------------------------------------
S44 = (
    "> 上轮实查：**2026-09-14 17:38 GMT+8 · 「前向交易闭环」页「推进」按钮「提示成功但结果不对」——"
    "推进的交易日历 `index_daily` 停更 ⇒ 推进恒 no-op，而 UI 谎报成功；本轮补数 + 让 UI 如实说话 "
    "· 状态 CODE_READY**（`PAPER-TRADING-ADVANCE-NOOP-001`）。"
    "触发 = 用户「**前向交易闭环，推荐按钮有点问题**」（经两轮澄清锁定：「推荐按钮」= 「**推进 / 推进到最新**」按钮；"
    "现象 = 「**提示成功但结果明显不对**」；裁定 = 「**补数据 + 代码加固（推荐）**」、补数源「**baostock（与现有一致）**」）。"
    "**一、根因三层（真库实查，非推断）**：① **数据层** —— 前向推进的**交易日历唯一来源 = `index_daily`**"
    "（`db.ts#loadBacktestTradingDates` 取 distinct `tradeDate`，**刻意与候选价格行解耦**，"
    "防个股窗口不连续破坏持仓推进），而该表**只有手动脚本 `scripts/backfillIndex.ts` 写入、全仓无任何自动同步**；"
    "实查停更在 **2026-09-04**（`retrievedAt=2026-09-06 09:22:54`、7,452 行 / 1,863 distinct 日），"
    "而 `stock_daily_prices` / `limit_up_records` 均已到 **2026-09-14**（1,869 distinct 日）"
    "⇒ **日历比行情整整落后 6 个交易日**。"
    "② **代码层（真正的缺陷）** —— 推进集合 = `tradingDates.filter(d => d > lastProcessedDate)`，"
    "日历停更时该集合**恒为空** ⇒ `advancePaperTradingRunToLatest` 原样返回**旧摘要**、"
    "`advancePaperTradingRun` 照常返回 `success` ⇒ **结构性 no-op 却报成功**，"
    "且**无法区分**「本来就已最新」与「日历落后」；实查两条运行 `lastProcessedDate`（`#1` = 09-10、`#30001` = 09-14）"
    "**均在日历末端之后**，且 **`updatedAt == createdAt`** ⇒ 首次创建后**从未成功落过新状态**。"
    "③ **建运行层** —— 新建运行的锚点取「最新涨停信号日」（与价格表对齐），**可以越过日历末端**"
    "⇒ 一创建就是「注定推不动」的孤儿运行。"
    "**二、补数（按用户裁定的 baostock 源）**：`MARKETDATA_PYTHON=\"C:/Python312/python.exe\" npx tsx "
    "scripts/backfillIndex.ts --provider=baostock --start=2026-09-05 --end=2026-09-14 --force` "
    "⇒ **4 指数 × 6 交易日 = 24 行**（`index_master=4`）；"
    "🔴 **`--force` 是必需的** —— `backfillIndex.ts#isCoverageFresh` 允许「末端相差 ≤ 30 天」即判「已覆盖」，"
    "不加 `--force` 会**静默认为无需回填**（这正是缺口能悄悄存在 6 个交易日的机制）。"
    "复核后 `index_daily` = **7,476 行 / 1,869 distinct 日 / 末端 2026-09-14**，与另两表**逐日一致**。"
    "**三、代码加固（`server/**` 3 文件 + `client/**` 1 文件 + `tests/**`；零迁移、零新端点、零新依赖）**："
    "① `server/paperTrading.ts` 新增**纯函数诊断层**（零 IO）：`classifyAdvanceKind()` 三态判定 = "
    "`advanced`（推进集合非空）/ `already-latest`（日历末端 ≥ 行情末端且无待推日）/ "
    "`calendar-stale`（日历末端 **<** 行情末端，或日历取不到）—— 判据是「**日历该不该更长**」，"
    "所以必须拿**行情末端**当参照物；`paperTradingAdvanceDiagnosis()` 由 kind + 两个末端产出**人话结论**；"
    "新增错误类 `PaperTradingCalendarStaleError`（`code = \"PAPER_TRADING_CALENDAR_STALE\"`）。"
    "② `server/db.ts`：`advancePaperTradingRunToLatest` 返回类型由 `PaperTradingSummary | null` 改为 "
    "**`{ summary, diagnosis }`**，`datesToAdvance.length === 0` 时**返回诊断而非静默旧摘要**"
    "（`marketLastDate` 由候选价格行 `reduce` 求得）；`createPaperTradingRun` 新增**前置校验** —— "
    "信号日 > 日历末端（或日历为空）即抛 `PaperTradingCalendarStaleError`，**不创建注定推不动的运行**；"
    "`advanceAllActivePaperTradingRuns` 每条带 `diagnosis`。"
    "③ `server/routers.ts`：建运行端点 catch 该错误并把**领域码写进 message**"
    "（形如 `[PAPER_TRADING_CALENDAR_STALE] 原文`）—— 依据本项目既有铁律"
    "「**`toTrpcError` 只透传 `message`、不带 `cause` ⇒ 领域码必须写进 message**」才能跨 tRPC 边界"
    "（与 `rpcErrorToDigest` 的 `/[([A-Z_]{3,})]/` 抠码约定一致）；推进端点透出 `{ summary, diagnosis }`。"
    "④ `server/paperTradingScheduler.ts` 日志改为逐条 `#id=kind(N日)`，`calendar-stale` 时 `console.warn` "
    "**显式告警**（不再静默）。"
    "⑤ `client/src/pages/PaperTrading.tsx`：`advanceMutation.onSuccess` 按 `diagnosis` **分流三种 toast**"
    "（`calendar-stale → toast.warning` / `advanced → success` / 其余 `info`）+ 页面内三色（amber / emerald / slate）"
    "横幅 `advanceNotice`（可关闭）⇒ **UI 不再一律谎报成功**。"
    "**四、验收（三件套 + 真实推进）**：单测 `tests/server/paperTrading.test.ts` 由 10 → **22 例全通过**"
    "（新增「三态判定」5 例，含事故现场常量 `CALENDAR_END=2026-09-04` / `MARKET_END=2026-09-14`；"
    "「人话结论」6 例；错误类 1 例）；`npx tsc --noEmit` **exit 0**；全量 `npx vitest run` "
    "**242 文件 / 4,015 通过 / 16 失败 = 精确既有 7 基线文件、零新增**；`npx vite build` **RC=0**（3,030 模块 / 19.01s）。"
    "**真实推进实证**（`docs/evidence/_probe_paper_advance_e2e.mts`，真实 tRPC 全链 `appRouter.createCaller`，"
    "**17 / 17 PASS**）：补数后 `#1` **真的推进了 09-11、09-14 两日**"
    "（`filledCount=5` / `openPositionCount=3` / `exitedCount=2` / `finalEquity=100,468.08` / `tradingDayCount=2`），"
    "`stateJson` **1,960 → 3,466 字符**、`equityCurve` 2 点；连推第二次**如实报 `already-latest`**；"
    "不存在 id ⇒ `run-not-found`。建运行正向路径 `_probe_paper_create_guard.mts` **5 / 5 PASS**"
    "（探针行按**可识别命名域** `PROBE-CALENDAR-GUARD-` 自清理，零残留）。"
    "真机 dev server（**3100**）取改动后模块 `HTTP 200`（139,211 bytes），"
    "响应内含 `calendarStale` / `advanceNotice` / `toast.warning` / `AlertTriangle`"
    "⇒ **不是只过类型检查**。"
    "**五、诚实登记（未取证者明说）**：⚠️ 建运行校验的**反向分支**（日历真的落后 ⇒ 真抛 "
    "`PAPER_TRADING_CALENDAR_STALE`）**需要篡改日历数据才能构造，本轮未取证**"
    "（正向路径已证该守卫**不会误锁**新建运行）；⚠️ `_probe_paper_advance_e2e.mts` **会写入** "
    "`paper_trading_runs`（推进职责所在，已在文件头声明）。"
    "零迁移、零新端点、零新依赖。详见 §44.5 第 9ao 条 / `ROADMAP-CHANGELOG.md` 17:38 条。"
)

# ---------------------------------------------------------------------------
# §44.5 队列条目（单行）
# ---------------------------------------------------------------------------
S445 = (
    "   - **9ao. （前向纸面交易线 · `PAPER-TRADING-ADVANCE-NOOP-001`）"
    "「推进」按钮提示成功却什么都没发生：交易日历 `index_daily` 停更 ⇒ 推进恒 no-op，UI 谎报成功** "
    "✅ **已完成（2026-09-14 17:38 GMT+8，CODE_READY）**："
    "触发 = 用户「**前向交易闭环，推荐按钮有点问题**」（澄清后 = 「**推进 / 推进到最新**」按钮、"
    "现象「**提示成功但结果明显不对**」）。"
    "**根因三层**：① **数据层** —— 推进日历**唯一来源 = `index_daily`**（与候选价格行**刻意解耦**），"
    "而它**只有手动 `scripts/backfillIndex.ts` 写、无自动同步** ⇒ 实查停更 **2026-09-04**，"
    "行情表已到 **2026-09-14**（落后 6 个交易日）；"
    "② **代码层** —— `datesToAdvance = tradingDates.filter(d => d > lastProcessedDate)` 恒空 ⇒ "
    "返回**旧摘要** + `success`，**无法区分**「已最新」与「日历落后」（两条运行 `updatedAt == createdAt`）；"
    "③ **建运行层** —— 锚点取最新涨停日，**可越过日历末端** ⇒ 造出推不动的孤儿运行。"
    "**补数**：`backfillIndex.ts --provider=baostock --start=2026-09-05 --end=2026-09-14 --force` ⇒ **24 行**"
    "（4 指数 × 6 交易日）；🔴 `--force` 必需（`isCoverageFresh` 容忍末端差 ≤ 30 天 ⇒ 默认误判「已覆盖」）；"
    "补后 `index_daily` **7,476 行 / 1,869 日 / 末端 09-14**。"
    "**代码加固**：`paperTrading.ts` 新增纯函数 `classifyAdvanceKind()` 三态（`advanced` / `already-latest` / "
    "`calendar-stale`，判据 = 「日历该不该更长」故以**行情末端**为参照）+ `paperTradingAdvanceDiagnosis()` "
    "人话结论 + `PaperTradingCalendarStaleError`；`db.ts` 推进返回 **`{ summary, diagnosis }`**、"
    "`createPaperTradingRun` **前置拒绝**信号日越界（`signalDate > calendarLastDate` 即抛）；"
    "`routers.ts` 把**领域码写进 message**（`toTrpcError` 不带 cause 的既有铁律）；"
    "`paperTradingScheduler.ts` 逐条 `#id=kind(N日)` + `calendar-stale` 时 `console.warn`；"
    "`PaperTrading.tsx` 按 `diagnosis` **分流三种 toast** + 三色 `advanceNotice` 横幅。"
    "**实证**：`_probe_paper_advance_e2e.mts` 真实 tRPC **17/17 PASS** —— `#1` **推进 09-11、09-14 两日**"
    "（`filled=5` / `open=3` / `exited=2` / `finalEquity=100,468.08` / `tradingDayCount=2`）、"
    "`stateJson` **1,960 → 3,466**、第二次推**如实 `already-latest`**、坏 id ⇒ `run-not-found`；"
    "`_probe_paper_create_guard.mts` **5/5 PASS**（命名域自清理）；真机 dev server **3100** 取模块 **HTTP 200**。"
    "**验收**：`tsc` 0 / 全量 `vitest` 失败文件集合 **零新增**（7 基线；本文件 **22 例全过**）/ `vite build` **RC=0**。"
    "**未决**：① 建运行守卫的**反向分支**（日历真落后）需篡改日历数据才能构造，**未取证**；"
    "② `index_daily` **仍无自动同步**（属数据同步域的独立任务）。"
)

# ---------------------------------------------------------------------------
# ROADMAP-CHANGELOG.md 条目（append）
# ---------------------------------------------------------------------------
SCHANGELOG = (
    "\n- **2026-09-14 17:38** — **WORK PAPER-TRADING-ADVANCE-NOOP-001：前向纸面交易「推进」按钮"
    "「提示成功但结果不对」—— 交易日历 `index_daily` 停更导致推进恒 no-op + UI 谎报成功；"
    "补数 + 三态诊断加固（`server/**` 3 文件 + `client/**` 1 文件 + `tests/**`；零迁移、零新端点、零新依赖）**。"
    "触发 = 用户「**前向交易闭环，推荐按钮有点问题**」（澄清锁定 = 「**推进 / 推进到最新**」按钮、"
    "现象「**提示成功但结果明显不对**」、裁定「**补数据 + 代码加固**」+ 补数源「**baostock（与现有一致）**」）。"
    "**一、根因三层（真库实查）**：① **数据层** —— 前向推进的交易日历**唯一来源 = `index_daily`**"
    "（`db.ts#loadBacktestTradingDates` 取 distinct `tradeDate`，**刻意与候选价格行解耦**，"
    "防个股窗口不连续破坏持仓推进）；该表**只有手动脚本 `scripts/backfillIndex.ts` 写入、全仓无自动同步**，"
    "实查停更 **2026-09-04**（`retrievedAt=2026-09-06 09:22:54`、7,452 行 / 1,863 日），"
    "而 `stock_daily_prices` / `limit_up_records` 均已到 **2026-09-14**（1,869 日）⇒ **日历落后行情 6 个交易日**。"
    "② **代码层（真正的缺陷）** —— 推进集合 = `tradingDates.filter(d => d > lastProcessedDate)`，"
    "日历停更时**恒为空** ⇒ 原样返回**旧摘要** + `success` ⇒ **结构性 no-op 却报成功**，"
    "且**无法区分**「本来就已最新」与「日历落后」；实查 `#1`（09-10）/ `#30001`（09-14）的 `lastProcessedDate` "
    "**均在日历末端之后**，且 **`updatedAt == createdAt`** ⇒ 从未成功落过新状态。"
    "③ **建运行层** —— 锚点取「最新涨停信号日」（与价格表对齐）**可越过日历末端** ⇒ 一创建即「注定推不动」。"
    "**二、补数**：`MARKETDATA_PYTHON=\"C:/Python312/python.exe\" npx tsx scripts/backfillIndex.ts "
    "--provider=baostock --start=2026-09-05 --end=2026-09-14 --force` ⇒ **4 指数 × 6 交易日 = 24 行**"
    "（`index_master=4`）；🔴 **`--force` 必需** —— `isCoverageFresh` 允许「末端相差 ≤ 30 天」即判「已覆盖」，"
    "不加 `--force` **静默不补**（这正是缺口能悄悄存在 6 个交易日的机制）。"
    "复核后 `index_daily` = **7,476 行 / 1,869 distinct 日 / 末端 2026-09-14**，与另两表逐日一致。"
    "**三、代码加固**：① `server/paperTrading.ts` 新增**纯函数诊断层**（零 IO）—— "
    "`classifyAdvanceKind()` 三态 = `advanced` / `already-latest` / `calendar-stale`"
    "（判据 = 「日历该不该更长」⇒ 必须拿**行情末端**当参照物：`marketLastDate > calendarLastDate` 即 stale）、"
    "`paperTradingAdvanceDiagnosis()` 产出人话结论、`PaperTradingCalendarStaleError`"
    "（`code=\"PAPER_TRADING_CALENDAR_STALE\"`）。"
    "② `server/db.ts`：`advancePaperTradingRunToLatest` 返回类型改为 **`{ summary, diagnosis }`**，"
    "`datesToAdvance.length === 0` 时**返回诊断而非静默旧摘要**；`createPaperTradingRun` **前置校验**"
    "（信号日 > 日历末端或日历为空即抛），**不创建注定推不动的运行**；批推每条带 `diagnosis`。"
    "③ `server/routers.ts` 建运行端点 catch 该错误并把**领域码写进 message**"
    "（形如 `[PAPER_TRADING_CALENDAR_STALE] 原文`）—— 依据既有铁律「`toTrpcError` 只透传 `message`、"
    "不带 `cause` ⇒ 领域码必须写进 message」才能跨 tRPC 边界，与 `rpcErrorToDigest` 的 `/[([A-Z_]{3,})]/` 抠码约定一致。"
    "④ `server/paperTradingScheduler.ts` 逐条 `#id=kind(N日)` 日志，`calendar-stale` 时 `console.warn` 显式告警。"
    "⑤ `client/src/pages/PaperTrading.tsx` 按 `diagnosis` **分流三种 toast**"
    "（`calendar-stale → toast.warning` / `advanced → success` / 其余 `info`）+ 三色 `advanceNotice` 横幅（可关闭）"
    "⇒ **UI 不再一律谎报成功**。"
    "**四、实证（真实 tRPC + 真库）**：`docs/evidence/_probe_paper_advance_e2e.mts` **17 / 17 PASS**"
    "（`appRouter.createCaller` admin ctx）：补数后 `#1` **真的推进 09-11、09-14 两日**"
    "（`filledCount=5` / `openPositionCount=3` / `exitedCount=2` / `finalEquity=100,468.08` / `tradingDayCount=2`），"
    "`stateJson` **1,960 → 3,466 字符**、`equityCurve` 2 点；**连推第二次如实报 `already-latest`**；"
    "不存在 id ⇒ `run-not-found`。诊断探针 `_probe_paper_trading_state.mts`（只读，三日历末端对比）、"
    "`_probe_paper_trading_advance_dryrun.mts`（内存干跑、**不 persist**）、`_probe_index_daily_freshness.mts`。"
    "建运行正向路径 `_probe_paper_create_guard.mts` **5 / 5 PASS**，探针行按**可识别命名域** "
    "`PROBE-CALENDAR-GUARD-` 自清理（零残留）。**真机 dev server（3100）** 取改动后模块 **HTTP 200**"
    "（139,211 bytes，含 `calendarStale` / `advanceNotice` / `toast.warning` / `AlertTriangle`）。"
    "**五、验收**：`tests/server/paperTrading.test.ts` **10 → 22 例全过**"
    "（三态判定 5，含事故现场常量 `CALENDAR_END=2026-09-04` / `MARKET_END=2026-09-14`；人话结论 6；错误类 1）；"
    "`npx tsc --noEmit` **exit 0**；全量 `npx vitest run` **242 文件 / 4,015 passed / 16 failed / "
    "失败文件集合 = 既有 7 基线（dataHealth / image.uploadAndRecognize / limitUp / limitUp.watch / marketData / "
    "tushare.secret / tushareTradingCalendar）零新增**；`npx vite build` **RC=0**（3,030 模块 / 19.01s）；"
    "migration：**无**（本轮零表结构改动）。"
    "**六、诚实登记（未取证 / 未决）**：⚠️ 建运行守卫的**反向分支**（日历真的落后 ⇒ 真抛 "
    "`PAPER_TRADING_CALENDAR_STALE`）**需要篡改日历数据才能构造，本轮未取证**"
    "（正向路径已证守卫**不会误锁**新建运行）；⚠️ `_probe_paper_advance_e2e.mts` **会写入** `paper_trading_runs`"
    "（推进职责所在，已在文件头声明）；⚠️ `index_daily` **仍无自动同步**（属数据同步域的独立任务，"
    "本轮只补数据 + 让下游如实报错）。见 `ROADMAP.md` §44 / §44.5 第 9ao 条。\n"
)

# ---------------------------------------------------------------------------
# docs/evidence/README.md 新增分组（append）
# ---------------------------------------------------------------------------
SREADME = (
    "\n### `papertradingadvance` —— 6 个（2026-09-14：前向纸面交易「推进」按钮「提示成功但没变化」）\n"
    "\n"
    "> 触发 = 用户「**前向交易闭环，推荐按钮有点问题**」（澄清后 = 「**推进 / 推进到最新**」按钮；"
    "现象「**提示成功但结果明显不对**」）。\n"
    "> 核心事实：推进的**交易日历唯一来源 = `index_daily`**，而它**只有手动脚本写入、全仓无自动同步**，"
    "实查停更在 **2026-09-04**，而行情表已到 **2026-09-14**；\n"
    "> 推进集合 `tradingDates.filter(d => d > lastProcessedDate)` 因此**恒为空** ⇒ 结构性 no-op 却报成功"
    "（`updatedAt == createdAt` 是「从未落过新状态」的旁证）。\n"
    "\n"
    "| 文件 | 结论要点 | 被引用于 |\n"
    "|---|---|---|\n"
    "| `_probe_paper_trading_state.mts` | ✅ 只读实查：列运行状态 + `stateJson` 解析规模 + "
    "**三个日历末端对比**（`index_daily` 09-04 vs `stock_daily_prices` 09-14 vs `limit_up_records` 09-14）；"
    "两条运行 `lastProcessedDate` 均在日历末端之后、`updatedAt == createdAt` | `ROADMAP.md` §44 17:38 条 |\n"
    "| `_probe_paper_trading_advance_dryrun.mts` | 内存干跑推进循环（**不 persist**，复刻 `db.ts` 循环）⇒ "
    "`datesToAdvance = []` ⇒ 证明「无待推日」是**结构性的**、不是撮合失败 | 同上 |\n"
    "| `_probe_index_daily_freshness.mts` | `index_daily` 新鲜度：行数 / distinct 日 / 末端 / `retrievedAt` "
    "⇒ 定位「日历停更」这一**数据面**根因 | 同上 |\n"
    "| `_probe_paper_advance_e2e.mts` + `.log` | ✅ **17 / 17 PASS**（真实 tRPC `appRouter.createCaller`）："
    "补数后 `#1` **推进 09-11、09-14 两日**（`filled=5` / `open=3` / `exited=2` / `finalEquity=100,468.08` / "
    "`tradingDayCount=2`）、`stateJson` **1,960 → 3,466**、`equityCurve` 2 点；二次推进**如实 `already-latest`**；"
    "坏 id ⇒ `run-not-found`。⚠️ **会写入** `paper_trading_runs`（推进职责所在，已在文件头声明） | 同上 |\n"
    "| `_probe_paper_create_guard.mts` + `.log` | ✅ **5 / 5 PASS**：建运行**正向路径**（信号日 ≤ 日历末端）"
    "可正常创建 ⇒ 证明新守卫**不会误锁**新建运行；探针行按**可识别命名域** `PROBE-CALENDAR-GUARD-` 自清理、零残留 | 同上 |\n"
    "| `_append_memory_paper_advance_diag.py` | 当日日志追加脚本（append-only + 纯 LF 双向断言） | `.workbuddy/memory/2026-09-14.md` |\n"
    "\n"
    "| 关联测试（**不在本目录**，登记于此便于溯源） | 结论要点 |\n"
    "|---|---|\n"
    "| `tests/server/paperTrading.test.ts` | ✅ **22 / 22**（原 10 例 + 新增 12 例）：`classifyAdvanceKind` "
    "三态判定 5（含事故现场常量 `CALENDAR_END=2026-09-04` / `MARKET_END=2026-09-14`）+ "
    "`paperTradingAdvanceDiagnosis` 人话结论 6 + `PaperTradingCalendarStaleError` 1 |\n"
    "\n"
    "> 归档脚本（同轮）：`_append_archive_paper_advance.py`（`ROADMAP.md` §44 插入 + §44.5 `9ao` + "
    "`ROADMAP-CHANGELOG.md` append + 本 README 分组）、"
    "`_append_rules_paper_advance.py`（`PROJECT_RULES.md`：数据源与回填补一条 + 新增一节）。\n"
)


def patch(path: Path, *, must_contain: list[str], transform, keepends_check: str):
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    before_len = len(text)
    for marker in must_contain:
        assert marker in text, f"{path.name}: 缺少锚点 {marker!r}"
    new_text = transform(text)
    assert new_text != text, f"{path.name}: 未发生改动"
    assert len(new_text) > before_len, f"{path.name}: 未增长"
    path.write_bytes(new_text.encode("utf-8"))
    # 回读断言
    back = path.read_bytes().decode("utf-8")
    crlf = back.count("\r\n")
    lf = back.count("\n") - crlf
    if keepends_check == "crlf":
        assert lf == 0, f"{path.name}: 出现裸 LF（{lf}）"
    else:
        assert crlf == 0, f"{path.name}: 出现 CRLF（{crlf}）"
    print(f"OK {path.name}: {before_len} -> {len(back)} chars (crlf={crlf} lf={lf})")
    return back


# --- 0) 前置断言：单行 + 编号「下一个未占用」---------------------------------
assert S44.count("\n") == 0, "S44 必须是单行"
assert S445.count("\n") == 0, "S445 必须是单行"
assert SCHANGELOG.count("\n") <= 8, "SCHANGELOG 行数超预期"

_rm = (ROOT / "ROADMAP.md").read_bytes().decode("utf-8")
assert "9ao." not in _rm, "9ao 已被占用（编号不再是「下一个未占用」）"
assert "9an. " in _rm, "9an 应已存在（用于定位插入点）"

# --- 1) ROADMAP.md：§44 插入 + §44.5 插入（一次读、一次写）----------------
anchor44 = "> 上轮实查：**2026-09-14 15:05 GMT+8"
anchor445 = "   - **9an. （闭环回测线 · `DATASET-WINDOW-PROJECTION-001`"


def transform_roadmap(text: str) -> str:
    # §44：插在最新条目之前
    idx44 = text.index(anchor44)
    line_start44 = text.rfind("\n", 0, idx44) + 1
    text = text[:line_start44] + S44 + "\r\n>\r\n" + text[line_start44:]
    # §44.5：插在 9an 条目之后（9an 条目是单行，取其行尾 \r\n 之后）
    idx445 = text.index(anchor445)
    line_end445 = text.index("\r\n", idx445) + 2
    text = text[:line_end445] + S445 + "\r\n" + text[line_end445:]
    return text


back_roadmap = patch(
    ROOT / "ROADMAP.md",
    must_contain=[anchor44, anchor445, "# 44. 项目真实状态映射", "## 44.5 下一任务队列（§38 优先级）"],
    transform=transform_roadmap,
    keepends_check="crlf",
)
# 回读结构断言
assert back_roadmap.index(S44) < back_roadmap.index(anchor44), "S44 未插在 15:05 条之前"
assert back_roadmap.count(S44) == 1, "S44 出现次数 != 1"
assert back_roadmap.count(S445) == 1, "S445 出现次数 != 1"
assert back_roadmap.index(anchor445) < back_roadmap.index(S445), "S445 未插在 9an 之后"
# 既有条目零改写：新旧锚点仍在
for keep in ("DATASET-SCOPE-INHERIT-001", "SECURITY-LABELS-001", "RUN-RESULT-RESTORE-001",
             "DATASET-WINDOW-PROJECTION-001"):
    assert keep in back_roadmap, f"既有条目 {keep} 丢失"

# --- 2) ROADMAP-CHANGELOG.md：append ---------------------------------------
back_cl = patch(
    ROOT / "ROADMAP-CHANGELOG.md",
    must_contain=["## 更新记录（append-only）", "2026-09-14 15:05"],
    transform=lambda t: t + SCHANGELOG,
    keepends_check="lf",
)
assert back_cl.rstrip().endswith("见 `ROADMAP.md` §44 / §44.5 第 9ao 条。"), "changelog 末尾不符"

# --- 3) docs/evidence/README.md：append ------------------------------------
back_rd = patch(
    ROOT / "docs/evidence/README.md",
    must_contain=["### `datasetwindow` —— 6 组"],
    transform=lambda t: t + SREADME,
    keepends_check="lf",
)
assert "_probe_paper_advance_e2e.mts" in back_rd and "_probe_paper_create_guard.mts" in back_rd

print("DONE")
