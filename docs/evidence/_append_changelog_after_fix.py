# -*- coding: utf-8 -*-
"""append-only 追加本轮条目到 ROADMAP-CHANGELOG.md（LF 文件，带前后字节断言）。"""
PATH = "ROADMAP-CHANGELOG.md"

ENTRY = """---

## 2026-09-13 22:35 GMT+8 — 运行策略「前端什么都没有」根因修复 + 策略产出可视化（`server/**` 3 文件 + `client/**` 2 文件，CODE_READY）

用户指令：「**现在策略运行后，在前端没有任何东西产生。十四个阶段也不合理，现在需要你运行策略后把产生的数据展示出来**」。

### 一、根因（有数字支撑，非推断）

- 这是 **2026-09-13 16:55「优先直读 `ds_*`」修复引入的静默回归**。直读桥产物是「首板**事件窗口**」形状：**每事件恰一行**，OHLCV 取 `prefix` 的 **rd=0**。
- 而交易模拟在**决策日的下一交易日**执行订单（`server/backtest/simulator/engine.ts` 第 9(c) 步按执行日 `dayBars.get(securityId)` 取 bar，取不到即拒单 `SUSPENDED`）⇒ **执行日根本不在 rows 里**。
- 后果：探针 `docs/evidence/_probe_backtest_zero_trades.mts` 实测 **59/59 单全部 `SUSPENDED` ⇒ 0 成交、`equityCurve` 恒 = 100,000、指标全 0**。逐单核对「执行日有没有数据集行」：**registry 路径意图 60 条 → 有行 0**；同一策略同窗口强制 rebuild **意图 255 条 → 有行 250**、**133 笔成交 / 期末权益 112,169.43（+12.17%）**。
- 结论：直读在「研究 / 候选」语义上成立，但与撮合所需的**逐日面板不共用同一数据面**（且 `runTradeSimulation` 强校验两者 `datasetVersion` 一致）⇒ **不能只换数据源，必须整体回落重建**。
- 附带发现：`executionStats.byReason` / `skippedCounts` / `trades` 在交接摘要投影里**被整段丢弃**（原只投影 12 个标量）⇒ 「0 成交」在界面上**根本无法解释**，这也是用户只看到「什么都没有」的第二层原因。

### 二、修法（判据落在装配层，不是把直读一禁了之）

- `server/runWorkbenchAssembly/datasetFromRegistry.ts`：`BuildDatasetFromRegistryResult` 显式回填 **`executionBarsAvailable: false`** —— **桥只负责如实声明自身能力**。
- `server/runWorkbenchAssembly/assemble.ts#resolveDataset`：在「直读成功但 `executionBarsAvailable === false`」时**回落 `rebuildDataset`**，并把不可撮合原因**如实写进 `datasetSourceNote`**；同时**保留 `registry` 对象**（`datasetVersionId` 仍可显示）。**不硬禁直读**。
- `server/research/closedLoop/types.ts`：给 `ClosedLoopBacktestSummary` 增补**全部可选**字段（`equityCurve` / `executionStats` / `skippedCounts` / `trades` / `tradesTruncated` / `costs`）⇒ 不破坏任何既有构造点。
- `server/research/closedLoop/adapters.ts#summarizeTradeSimulationRun`：由「只投影 12 标量」扩为「标量 + 真实明细」（明细上限 `BACKTEST_TRADE_DETAIL_LIMIT = 500`）。

### 三、前端：把产出真的展示出来（用户诉求 ①③）

- `client/src/adapters/closedLoopRunAdapter.ts`：新增 5 个 View 类型 + `extractBacktestArtifacts()`，**只在** `stageId="backtest"` 且 `state==="EXECUTED"` 且 `output.kind==="backtestSummary"` 时解析；曲线点缺 `date` / `equity` 即丢弃、**绝不补 0**（展示层只做恒等搬移，不估计、不重算）。
- `client/src/components/strategy/ClosedLoopRunResultPanel.tsx` 新顺序：**全链概要 → 真实数据装配摘要 → 🔴 策略产出（成交笔数 / 期末权益 / 权益曲线 / 撮合统计与拒单原因分布 / 跳过原因 / 成本 / 成交明细）→ 阶段口径四卡 → 首阻塞 → 评估标量 → 执行器装配 → 阶段表**；并新增人话码表（`SUSPENDED` = 「执行日无行情（停牌 / 当日不在数据集证券池内）」等）。
- 用户诉求 ②「十四个阶段不合理」：阶段表改为**主表只列 `EXECUTED`**、其余进 `<details>` 折叠，并显式写明「**14 阶段仅 6 个有真实执行器**，其余属**功能未覆盖、不是本次运行出错**，它们也不会产出任何数据」—— 平铺会把 6 个真跑过的阶段淹没在恒 `BLOCKED` 里。
- 合规内容保留： 「以上是一次回测运行的**原始产出**，不是策略结论：未做多重比较校正、未通过 `RESEARCH_READY` 门禁，不得据此下单。」

### 四、实证（修复后走真实 tRPC `researchRun.loopRun`，6/6 PASS，489.4 s）

- `docs/evidence/_probe_after_fix_backtest_output.mts` ⇒ `assembly: source=rebuild versionId=390002 rows=292489 gate=PASS recipe=first-limit-pullback-hold-shrink`。
- `datasetSourceNote` 逐字说明「直读成功但该数据集不可用于撮合…已回落 `buildResearchDataset` 重建逐日面板」——**回落原因对用户可见**。
- **`tradeCount=133` / `finalEquity=112169.43` / `curvePoints=57`（54 个不同取值，曲线非平）**。
- `executionStats={"totalSignals":266,"totalOrders":266,"totalFills":260,"rejectedOrders":6,"partialFills":0,"byReason":{"INSUFFICIENT_CASH":6}}` ⇒ **零 `SUSPENDED`**。
- `skippedCounts` = `FROZEN_EXIT_DEFERRED 91` / `BUDGET_BELOW_MIN_LOT 9` / `NON_LONG_DIRECTION 8` / `NO_NEXT_TRADING_DAY 7`；成交明细 133 条已进入阶段产出（`truncated=false`）。
- ⚠️ **代价必须如实记住**：回落重建使该窗口耗时由 **6.2 s（直读）升到 489 s** —— 这是「跑得对」换「跑得快」，符合项目铁律（**禁 mock、禁错误口径**）；提速只能靠「为撮合侧预建逐日面板」，**不能靠切回直读**。

### 五、验收与边界

- `npx tsc --noEmit` **exit 0**；`npx vitest run tests/client` **22 文件 / 528 例全通过**；闭环服务端聚焦 **3 文件 / 80 例全通过**。
- 全量 `npx vitest run` = **235 文件（7 失败 / 228 通过） / 16 例失败 / 3,895 例通过**，失败**文件集合**逐项 = 既有基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）⇒ **零新增失败**（日志 `docs/evidence/_vitest_after_fix.log`）。
- `npx vite build` **exit 0**（3,025 模块 / 14.85 s）。
- `shared/**` 契约**零改动**（新增字段全部可选 ⇒ 既有构造点不受影响）；零迁移、零新端点、零新依赖。
- `server/**` 改动集中在 3 文件（`closedLoop/types.ts`、`closedLoop/adapters.ts`、`runWorkbenchAssembly/{datasetFromRegistry,assemble}.ts`）。
- ⚠️ 本机 `agent-browser` 不可用、仓库无 `jsdom` ⇒ **无浏览器截图**；前端验收口径恒为「真实 tRPC 取数 + 纯函数复用 + 真实 DB」。

### 六、沉淀与诚实登记

- `PROJECT_RULES.md`「运行工作台必须优先直读已绑定数据集」新增 **§五**：本回归的成因、判据落点（**「能不能撮合」由装配层 `resolveDataset` 判定，不是把直读一禁了之**）与推广结论（**桥产物只可用于「研究 / 候选」语义；需 T+N 窗口撮合 / 逐日持仓估值的消费方一律以 `executionBarsAvailable` 为闸门回落重建**）。
- 更正一条**已过时**陈述：`PROJECT_RULES.md`「配方与参数」原写「真正『逐日撮合出收益曲线』的回测仍未做（实测 `tradeCount=0`）」⇒ 实际执行器早已存在，**`tradeCount=0` 的真实成因正是本桥故障**，已改为「已闭环」。
- 登记：`MEMORY.md` 因超注入上限被截断，本轮做体积治理 —— 「策略定义枚举」「页面坐标」细则移入 `PROJECT_RULES.md`（后者已有同名章节、前者新增），「性能与缓存」降为指针（其内容与 `PROJECT_RULES.md:58` 重复）；文件由 **12,434 → 11,403 字节**，**内容零丢失**。
- 登记：§44.5 新编号取 **`9ah`**（按「下一个未占用」判定，非「末条 +1」；`9ae` 错位、`9v` 重复的历史问题未动）。
- 新增探针（`docs/evidence/`，不进 `tsc` / vitest）：`_probe_inflight_state.mts`（动手前在途检查）、`_probe_backtest_zero_trades.mts`（根因 A/B 取证）、`_probe_after_fix_backtest_output.mts`（修复后复验）；另加 `_apply_roadmap_after_fix.py`（CRLF 安全写入器）与 `_vitest_after_fix.log`。
"""

data = ENTRY.encode("utf-8")
before = len(open(PATH, "rb").read())
with open(PATH, "ab") as f:
    f.write(data)
after = len(open(PATH, "rb").read())
assert after == before + len(data), "写入字节数不符"
lines = open(PATH, "rb").read().decode("utf-8").splitlines()
print("OK: bytes %d -> %d (+%d), lines=%d" % (before, after, len(data), len(lines)))
print("最后一行标题:", [l for l in lines if l.startswith("## 2026-09-13 22:35")])
