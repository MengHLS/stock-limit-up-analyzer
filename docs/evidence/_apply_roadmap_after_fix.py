# -*- coding: utf-8 -*-
"""把本轮「运行策略产出为空」修复写入 ROADMAP.md（CRLF 安全，带前后断言）。"""
import sys, re

PATH = "ROADMAP.md"

ENTRY = (
    "> **【运行策略「前端什么都没有」根因修复 + 策略产出可视化 · 2026-09-13 22:35 GMT+8 · 状态 CODE_READY】** "
    "触发 = 用户「**现在策略运行后，在前端没有任何东西产生。十四个阶段也不合理，现在需要你运行策略后把产生的数据展示出来**」。"
    "**一、根因（有数字支撑，非推断）**：2026-09-13 16:55 的「优先直读 `ds_*`」修复引入**静默回归** —— 直读桥产物是「首板**事件窗口**」形状"
    "（每事件恰一行、OHLCV 仅取 `prefix` 的 **rd=0**），而 `runTradeSimulation` 在**决策日的下一交易日**按下单执行日取 bar"
    "（`server/backtest/simulator/engine.ts` 第 9(c) 步 `dayBars.get(securityId)`，取不到即拒单 `SUSPENDED`）⇒ **执行日不在数据集内** ⇒ "
    "探针 `docs/evidence/_probe_backtest_zero_trades.mts` 实测 **59/59 单全 `SUSPENDED`、0 成交、`equityCurve` 恒 = 100,000、指标全 0**；"
    "同一策略同窗口强制 rebuild 则 **133 笔成交 / 期末 112,169.43（+12.17%）**（「执行日有没有行」逐单核对：registry 意图 60 → 有行 **0**；"
    "rebuild 意图 255 → 有行 **250**）。⇒ 直读在「研究 / 候选」语义上成立，但与撮合所需的**逐日面板不共用同一数据面**"
    "（且 `runTradeSimulation` 强校验两者 `datasetVersion` 一致）⇒ **不能只换数据源、必须整体回落重建**。"
    "**二、修复（判据落在装配层，不是把直读一禁了之）**：① `server/runWorkbenchAssembly/datasetFromRegistry.ts` 的 "
    "`BuildDatasetFromRegistryResult` 显式回填 **`executionBarsAvailable: false`**（桥只负责**如实声明自身能力**）；"
    "② `server/runWorkbenchAssembly/assemble.ts#resolveDataset` 在「直读成功但 `executionBarsAvailable === false`」时**回落 `rebuildDataset`**，"
    "并把不可撮合原因**如实写进 `datasetSourceNote`**（同时**保留 `registry` 对象** ⇒ `datasetVersionId` 仍可显示）；"
    "③ `server/research/closedLoop/types.ts` 给 `ClosedLoopBacktestSummary` 增补**全部可选**字段"
    "（`equityCurve` / `executionStats` / `skippedCounts` / `trades` / `tradesTruncated` / `costs`）⇒ **不破坏任何既有构造点**；"
    "④ `server/research/closedLoop/adapters.ts#summarizeTradeSimulationRun` 由**只投影 12 个标量**扩为「标量 + 真实明细」"
    "（明细上限 `BACKTEST_TRADE_DETAIL_LIMIT = 500`）—— 此前 `executionStats.byReason` / `skipped` / `trades` 被整段丢弃，"
    "导致「0 成交」在界面上**根本无法解释**。**三、前端（用户诉求③「把产生的数据展示出来」）**：`client/src/adapters/closedLoopRunAdapter.ts` "
    "新增 5 个 View 类型 + `extractBacktestArtifacts()`（只在 `stageId=\"backtest\"` 且 `state===\"EXECUTED\"` 且 `output.kind===\"backtestSummary\"` "
    "时解析；曲线点缺 `date` / `equity` 即丢弃、**绝不补 0**）；`client/src/components/strategy/ClosedLoopRunResultPanel.tsx` 新顺序 = "
    "**全链概要 → 真实数据装配摘要 → 🔴 策略产出（成交笔数 / 期末权益 / 权益曲线 / 撮合统计与拒单原因分布 / 跳过原因 / 成本 / 成交明细）→ "
    "阶段口径四卡 → 首阻塞 → 评估标量 → 执行器装配 → 阶段表**，并新增人话码表（`SUSPENDED` = 「执行日无行情（停牌 / 当日不在数据集证券池内）」）。"
    "**四、用户诉求②「十四个阶段不合理」**：阶段表改为**主表只列 `EXECUTED`**、其余进 `<details>` 折叠，并显式写明"
    "「**14 阶段仅 6 个有真实执行器**（`data`/`research`/`strategy`/`backtest`/`evaluation`/`regime`），其余属**功能未覆盖、不是本次运行出错**，"
    "它们也不会产出任何数据」—— 平铺会把 6 个真跑过的阶段淹没在恒 `BLOCKED` 里。**五、实证（修复后走真实 tRPC `researchRun.loopRun`，"
    "`docs/evidence/_probe_after_fix_backtest_output.mts` **6/6 PASS**，489.4 s）**：`source=rebuild` / 版本 390002 / **292,489 行** / `gate=PASS` / "
    "配方 `first-limit-pullback-hold-shrink`；`sourceNote` 逐字说明「直读成功但不可撮合…已回落 `buildResearchDataset` 重建逐日面板」；"
    "**`tradeCount=133` / `finalEquity=112169.43` / `curvePoints=57`（54 个不同取值，非平）**；"
    "`executionStats={\"totalSignals\":266,\"totalOrders\":266,\"totalFills\":260,\"rejectedOrders\":6,\"byReason\":{\"INSUFFICIENT_CASH\":6}}`"
    "（**零 `SUSPENDED`**）；`skippedCounts` = `FROZEN_EXIT_DEFERRED 91` / `BUDGET_BELOW_MIN_LOT 9` / `NON_LONG_DIRECTION 8` / `NO_NEXT_TRADING_DAY 7`；"
    "成交明细 133 条已进入阶段产出（未截断）。⚠️ **代价必须如实记住**：回落重建使该窗口耗时由 **6.2 s（直读）升到 489 s** —— 这是「跑得对」换「跑得快」，"
    "符合项目铁律（**禁 mock、禁错误口径**）；提速只能靠「为撮合侧预建逐日面板」，**不能靠切回直读**。"
    "**六、验收**：`npx tsc --noEmit` **exit 0**；`vitest run tests/client` **22 文件 / 528 例全通过**；闭环服务端聚焦 **3 文件 / 80 例全通过**；"
    "全量 `npx vitest run` = **7 文件 / 16 例失败**，失败文件集合逐项 = 既有基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / "
    "`limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）⇒ **零新增失败**（228 文件 / 3,895 例通过）；"
    "`npx vite build` **exit 0**（3,025 模块 / 14.85 s）。**七、边界**：`shared/**` 契约**零改动**（新增字段全部可选）；零迁移、零新端点、零新依赖；"
    "`server/**` 改动集中在 3 文件（`closedLoop/types.ts`、`closedLoop/adapters.ts`、`runWorkbenchAssembly/{datasetFromRegistry,assemble}.ts`）；"
    "**无浏览器截图**（本机 `agent-browser` 不可用、仓库无 `jsdom`），前端验收口径 = 真实 tRPC 取数 + 纯函数复用 + 真实 DB。"
    "**八、沉淀**：`PROJECT_RULES.md`「运行工作台必须优先直读已绑定数据集」新增 §五（本回归的成因、判据落点与推广结论），"
    "并把「逐日撮合回测仍未做」这条**已过时**陈述更正为「已闭环」—— 此前 `tradeCount=0` 的真实成因正是本桥故障，**不是回测缺失**。"
)

QUEUE = (
    "   - **9ah. （运行工作台线）「运行策略前端什么都没有」根因修复 + 策略产出可视化** "
    "✅ **已完成（2026-09-13 22:35 GMT+8，CODE_READY）**：触发 = 用户「**现在策略运行后，在前端没有任何东西产生。十四个阶段也不合理，"
    "现在需要你运行策略后把产生的数据展示出来**」。**根因 = 16:55「优先直读 `ds_*`」引入的静默回归**：直读桥产物为「首板事件窗口」形状"
    "（每事件恰一行、OHLCV 仅 `prefix` rd=0），而撮合在**决策日下一交易日**取执行 bar ⇒ 执行日无行 ⇒ **59/59 单 `SUSPENDED`、0 成交、曲线恒平**"
    "（对照：同策略 rebuild = **133 笔 / 期末 112,169.43 / +12.17%**）。**修法**：桥回填 `executionBarsAvailable: false` ⇒ "
    "`assemble.ts#resolveDataset` **自动回落重建**并把原因写进 `datasetSourceNote`（判据在装配层，**不是把直读一禁了之**）；"
    "`closedLoop/adapters.ts` 把成交明细/权益曲线/拒单原因分布/跳过原因/成本从「被丢弃」改为「如实投影」；前端 adapter 直搬 + 面板新增"
    "「策略产出」区块，阶段表**只列 EXECUTED**、其余折叠（**14 阶段仅 6 个有执行器**）。**实证（真实 tRPC，6/6 PASS，489.4 s）**："
    "`source=rebuild` / 292,489 行 / `tradeCount=133` / `finalEquity=112169.43` / 曲线 57 点（54 个不同取值）/ "
    "`byReason={INSUFFICIENT_CASH:6}`（**零 `SUSPENDED`**）。**代价（如实）**：直读 6.2 s → 重建 **489 s**，提速须「为撮合预建逐日面板」，"
    "**不得切回直读**。**验收**：`tsc` exit 0；`tests/client` 22 文件 / 528 例全通过；全量 7 文件 / 16 例失败 = **既有基线零新增**；`vite build` exit 0。"
    "**边界**：`shared/**` 零改动、零迁移、零新端点、零新依赖；`server/**` 3 文件。"
)

raw = open(PATH, "rb").read()
text = raw.decode("utf-8")
lines = text.splitlines(keepends=True)

crlf_before = sum(1 for l in lines if l.endswith("\r\n"))
assert crlf_before == len(lines), "文件并非纯 CRLF，中止"

# 锚点 A：§44 头部第一条（龙头候选）—— 新条目插到它前面（最新在上）
aidx = [i for i, l in enumerate(lines) if "**【龙头候选页加载提速 · 2026-09-13 17:14 GMT+8" in l]
assert len(aidx) == 1, "锚点 A 命中数 != 1: %r" % aidx
# 锚点 B：§44.5 队列末条 9ag
bidx = [i for i, l in enumerate(lines) if re.match(r"\s+- \*\*9ag\.", l)]
assert len(bidx) == 1, "锚点 B 命中数 != 1: %r" % bidx

# 先插 B（下标更大），避免 A 的插入影响 B 的位置
lines.insert(bidx[0] + 1, QUEUE + "\r\n")
lines.insert(aidx[0], ENTRY + "\r\n")
lines.insert(aidx[0] + 1, ">\r\n")

out = "".join(lines).encode("utf-8")

crlf_after = sum(1 for l in lines if l.endswith("\r\n"))
assert crlf_after == len(lines), "插入后出现非 CRLF 行"
lf_only = sum(1 for l in lines if l.endswith("\n") and not l.endswith("\r\n"))
assert lf_only == 0, "插入后出现纯 LF 行: %d" % lf_only

open(PATH, "wb").write(out)
print("OK: lines %d -> %d (CRLF %d -> %d, LF-only %d)" % (len(text.splitlines()), len(lines), crlf_before, crlf_after, lf_only))
