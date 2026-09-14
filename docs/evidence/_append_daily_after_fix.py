# -*- coding: utf-8 -*-
"""append-only 追加本轮条目到当日工作日志（LF 文件，带字节断言）。"""
PATH = ".workbuddy/memory/2026-09-13.md"

ENTRY = """
## 22:35 GMT+8 — 运行策略「前端什么都没有」：根因闭环（16:55 直读桥静默回归）+ 产出可视化（`server/**` 3 文件 + `client/**` 2 文件，CODE_READY）

> 承接本文件 **15:13** 那条「零代码改动的诊断」（当时已查实「结果确实渲染了，但全是 0」）。本轮把**「为什么全是 0」**查到根、修掉，并把产出真正画出来。

### 根因（有数字支撑）

- **这是 16:55「优先直读 `ds_*`」引入的静默回归**。直读桥产物是「首板**事件窗口**」形状 —— **每事件恰一行**，OHLCV 只取 `prefix` 的 **rd=0**。
- 撮合却在**决策日的下一交易日**执行订单（`server/backtest/simulator/engine.ts` 第 9(c) 步按执行日 `dayBars.get(securityId)` 取 bar）⇒ **执行日根本不在 rows 里** ⇒ 全单拒为 `SUSPENDED`。
- 实测（`docs/evidence/_probe_backtest_zero_trades.mts`，A/B 对照）：**registry 直读 = 59/59 `SUSPENDED`、0 成交、曲线恒 100,000**；逐单核对「执行日有没有行」**意图 60 → 有行 0**。**同策略同窗口强制 rebuild = 意图 255 → 有行 250、133 笔成交、期末 112,169.43（+12.17%）**。
- 第二层原因：`summarizeTradeSimulationRun`（`closedLoop/adapters.ts`）**只投影 12 个标量**，`executionStats.byReason` / `skippedCounts` / `trades` 被整段丢弃 ⇒ **「0 成交」在界面上无法解释** —— 这正是用户观感「什么都没有」。

### 修法（判据在装配层，不是把直读一禁了之）

- `datasetFromRegistry.ts` 显式回填 **`executionBarsAvailable: false`**（桥只**如实声明自身能力**）。
- `assemble.ts#resolveDataset` 据此**回落 `rebuildDataset`**，原因**如实写进 `datasetSourceNote`**，并**保留 `registry` 对象**（`datasetVersionId` 仍可显示）。
- `closedLoop/types.ts` 给 `ClosedLoopBacktestSummary` 增补**全部可选**字段；`adapters.ts` 把明细如实投影（上限 `BACKTEST_TRADE_DETAIL_LIMIT = 500`）。
- 前端：`closedLoopRunAdapter.ts` 新增 `extractBacktestArtifacts()`（仅 `backtest`+`EXECUTED`+`kind="backtestSummary"`；曲线点缺 `date`/`equity` **丢弃、不补 0**）；`ClosedLoopRunResultPanel.tsx` 新增「策略产出」区块（成交笔数 / 期末权益 / 权益曲线 / 撮合统计与拒单原因分布 / 跳过原因 / 成本 / 成交明细）+ 人话码表。
- 「14 阶段不合理」⇒ 阶段表**主表只列 `EXECUTED`**、其余折叠，并写明「**14 阶段仅 6 个有执行器**，其余属功能未覆盖、不是本次出错、也不会产出数据」。

### 实证（真实 tRPC `researchRun.loopRun`，`_probe_after_fix_backtest_output.mts` **6/6 PASS**，489.4 s）

- `source=rebuild` / 390002 / **292,489 行** / `gate=PASS` / 配方 `first-limit-pullback-hold-shrink`。
- **`tradeCount=133` / `finalEquity=112169.43` / `curvePoints=57`（54 个不同取值，非平）**。
- `byReason={INSUFFICIENT_CASH:6}` ⇒ **零 `SUSPENDED`**；`skippedCounts` = `FROZEN_EXIT_DEFERRED 91` / `BUDGET_BELOW_MIN_LOT 9` / `NON_LONG_DIRECTION 8` / `NO_NEXT_TRADING_DAY 7`。

### 🔴 代价（必须记住，不能用「切回直读」换速度）

回落重建把该窗口耗时从 **6.2 s（直读）拉到 489 s**。这是「**跑得对**」换「跑得快」，符合铁律（**禁 mock、禁错误口径**）。要提速只能**为撮合侧预建逐日面板**，**不得切回直读** —— 直读产物只可用于「研究 / 候选」语义。

### 验收

- `npx tsc --noEmit` **exit 0**；`vitest run tests/client` **22 文件 / 528 例全通过**；闭环服务端聚焦 **3 文件 / 80 例全通过**。
- 全量 `npx vitest run` = **7 文件 / 16 例失败**（235 文件 / 3,895 例通过），失败**文件集合**逐项 = 既有基线（`dataHealth`/`image.uploadAndRecognize`/`limitUp`/`limitUp.watch`/`marketData`/`tushare.secret`/`tushareTradingCalendar`）⇒ **零新增**。日志 `docs/evidence/_vitest_after_fix.log`。
- `npx vite build` **exit 0**（3,025 模块 / 14.85 s）。`shared/**` 契约零改动、零迁移、零新端点、零新依赖；**无浏览器截图**（无 `agent-browser` / 无 `jsdom`）。

### 可复用的坑（本轮新抓到）

- 🔴 **「谁该回落」是装配层的判据，不是数据源的属性禁令**：桥**声明能力**、装配层**决定回落**。若反过来「因为不可撮合所以禁直读」，会把「研究 / 候选」这条合法快路径一起砍掉（6.2 s vs 489 s）。
- 🔴 **投影层丢字段 = 故障不可解释**：只投影标量的摘要在「全 0」时把唯一的诊断线索（`byReason`）扔掉 ⇒ **凡是「全 0 / 全空」类故障，先检查投影层是否把原因字段丢了**。
- 🔴 **`ROADMAP.md` 是纯 CRLF**（2590 行 CRLF / 0 LF）⇒ 行级手术必须 `splitlines(keepends=True)`，并在写前写后断言 `CRLF 行数 == 总行数`。本轮写入器 `docs/evidence/_apply_roadmap_after_fix.py`（2590 → 2593 行，断言全过）。
- 🔴 **`vitest` 输出含 ANSI 颜色码** ⇒ 直接 `grep "FAIL .*tests/"` 命中 0；**必须先 `re.sub(r'\\x1b\\[[0-9;]*[A-Za-z]','',txt)` 再统计**，否则会误判「没有失败文件」。
- **§44.5 编号取 `9ah`**（按「下一个未占用」判定；`9ae` 错位、`9v` 重复的历史问题未动）。
"""

data = ENTRY.encode("utf-8")
before = len(open(PATH, "rb").read())
with open(PATH, "ab") as f:
    f.write(data)
after = len(open(PATH, "rb").read())
assert after == before + len(data), "写入字节数不符"
print("OK: bytes %d -> %d (+%d)" % (before, after, len(data)))
