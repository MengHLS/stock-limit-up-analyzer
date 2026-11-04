# RESULT-STRATEGY-3570001-PAPER-TRADING-001

> 目标：把 `Strategy Version 3570001` 接入正式模拟盘，形成可每日执行、可持久化、可在前端查看的闭环。
> **结论：完成。** 每日模拟盘已持久化（407 个交易日）并在前端 `/paper-trading-3570001` 可读。未改策略定义、未改 Runner 参数、未新增第二套引擎、未硬编码数据、未伪造任何成交。

---

## 1. 模拟盘模块 / 文件

| 文件 | 作用 |
| --- | --- |
| `server/paperTrading3fTop3Runner/run.ts` | 每日模拟盘核心：**不实现任何选股 / 退出 / Runner 逻辑**，只把**同一次正式模拟**按交易日投影成每日记录（signals / fills / positions / exits / account） |
| `server/paperTrading3fTop3Runner/selection.ts` | 留档选择的纯函数（可单测，无 DB） |
| `server/research/simulator/engine.ts` | 仅新增 `export` 到既有 `evaluateRunnerHoldingBridgeState`（**同一函数**，零语义改动） |
| `server/researchRunRouter.ts` | 新增只读端点 `researchRun.getPaperTrading3570001` |
| `client/src/pages/PaperTrading3570001.tsx` | 前端页面（AppShell「策略」组导航「模拟盘 3570001」） |
| `scripts/_createPaperTrading3570001.mts` | 真实数据生成 + 持久化脚本 |
| `tests/server/paperTrading3fTop3Runner/derive.test.ts` | 投影链路单测（5 例） |

**复用（零第二套引擎）**：选股与 sourceRun ← `buildFirstLimitPullback3FTop3SourceRun`；组合执行 / 资金循环 / T+6 开盘 / 止损 / MA5-MA10 / strongHold / Runner ← `runCompositeRunnerBacktest`（内部唯一调用 `runTradeSimulation`）；NEW_HIGH_3 ← 模拟器同一函数。

**为什么是投影而不是逐日重跑**：正式模拟本身已是「只用 ≤ 该日信息」的逐日推进；逐日重跑要重放 O(交易日) 次完整模拟，昂贵且无语义增量。

## 2. Run ID

| 项 | 值 |
| --- | --- |
| 留档行 id | **`6000001`** |
| runId | **`paper-3570001-2025-01-01-2026-09-04`** |
| 存储 | 既有 `closed_loop_backtest_run`（`experimentId=STRATEGY-3570001-PAPER-TRADING-001`，`runId` UNIQUE ⇒ 重跑幂等覆盖，不产生重复行） |
| 载荷 | `result.paperTradingState`（每日明细） |
| 窗口 | `2025-01-01 ~ 2026-09-04`（**407 个交易日**） |

## 3. 当前模拟账户

| 指标 | 值 |
| --- | ---: |
| 总权益 | **199,036.53** |
| 现金 | 5,381.53 |
| 持仓市值 | 193,655.00 |
| 累计收益 | **+99.0365%** |
| 今日收益 | −0.5595% |
| MaxDD | **16.3391%** |
| 当前回撤 | −10.7605% |
| 初始资金 / 单仓比例 / maxPositions | 100,000 · 20% · 5 |

（累计收益与 MaxDD 与 HOLDOUT 段 3570001 的 standalone 结果 99.0365% / 16.3391% 一致 —— 同一 simulator、同一口径。）

## 4. 信号 / 成交 / 退出

| 项 | 数量 |
| --- | ---: |
| 历史信号总数（每日 Top3） | **1,219** |
| 今日信号（2026-09-04） | **3** |
| 模拟成交（买+卖） | **617** |
| 退出记录（已平仓） | **306** |
| 其中 NEW_HIGH_3 判定为真（Runner 延长） | **85** |

退出原因分类：`STOP_LOSS 119` / `TREND_EXIT 126` / `RUNNER_BRIDGE_TIME_EXIT 8` / `TIME_EXIT 46` / `STRONG_HOLD 7`。

## 5. 当前持仓（5 笔，2026-09-04）

| 股票 | 入场日 | 入场价 | 现价 | 持仓天数 | Runner 状态 | 浮盈亏 |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| 601177.SH | 2026-08-31 | 13.4201 | 13.98 | 4 | PENDING | +1,847.67 |
| 603032.SH | 2026-09-01 | 20.1302 | 19.21 | 3 | PENDING | −1,748.38 |
| 002880.SZ | 2026-09-02 | 22.4336 | 22.20 | 2 | PENDING | −350.40 |
| 605258.SH | 2026-09-04 | 30.4459 | 29.38 | 0 | PENDING | −1,385.67 |
| 000951.SZ | 2026-09-04 | 21.4421 | 21.96 | 0 | PENDING | +932.22 |

五笔的判定日（第 5 个持有日）均尚未到达 ⇒ 一律 `PENDING`（**不读判定日之后的数据**，杜绝未来信息）。

## 6. 前端页面

| 项 | 值 |
| --- | --- |
| 路径 | **`/paper-trading-3570001`** |
| 数据来源 | `trpc.researchRun.getPaperTrading3570001` → `closed_loop_backtest_run.result.paperTradingState`（**无硬编码**） |

实际展示：**策略运行状态**（Strategy Version 3570001 / Runner NEW_HIGH_3·5→20 / Dataset / Data Date / 最近运行时间 / Run Status / 数据缺失或异常 / 溯源 provenance 660001 + HOLDOUT `RUN-20261002-BD1D7332`）· **账户**（总权益 / 现金 / 持仓市值 / 累计收益 / 今日收益 / MaxDD / 当前回撤 / 初始资金与单仓比例）· **今日策略池**（股票 / Top3 排名 / NEW_HIGH_3 / 计划入场 / 实际模拟成交 / 状态）· **当前持仓**（入场价 / 现价 / 持仓天数 / Runner 状态 / 浮盈亏 / 退出条件）· **权益曲线** · **历史交易**（日期 / 股票 / 退出价 / 退出原因 / 持仓天数 / PnL / 是否 Runner）。

## 7. 可追溯关系

所有记录保存在留档载荷内并带 `strategyVersionId=3570001`、`provenanceId=660001`、`holdoutRunId=RUN-20261002-BD1D7332`；Strategy Definition 由 `strategy_versions#3570001` 承载（本任务未修改）。

## 8. 验证

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | **exit 0** |
| `npm run build` | **成功** |
| `vitest tests/server/paperTrading3fTop3Runner`（5 例）+ `tests/server/researchRunRouter.test.ts`（20 例） | **25 passed** |
| 汇总（paper + router + closedLoopBacktestRun + client） | **371 passed / 32 files** |
| 真实模拟盘数据创建 | **是**（row 6000001 / `paper-3570001-2025-01-01-2026-09-04`） |
| 前端真实读取该记录 | **是**（端点实测返回 407 日 / 账户 / 5 持仓 / 306 历史） |
| 刷新后仍存在 | **是**（持久化在 `closed_loop_backtest_run`） |

口径一致性（与历史评估同源，非重新实现）：T+6 开盘入场、NEW_HIGH_3 判定、Runner 5→20、STOP_LOSS、MA5-MA10 TREND_EXIT、strongHold、T+1 冻结、maxPositions=5、成本模型 —— 全部由 `runTradeSimulation` 与投影层复用同一实现；端到端投影链路（行情 → signal → order/fill → position → runner → exit → equity）由 `derive.test.ts` 5 例覆盖。

## 9. Gate

**是否完成「3570001 可每日执行的模拟盘闭环」：完成。** 每日记录（signal / order-fill / position / exit / account）均已持久化、可读、可在前端查看；未自动进入实盘。

### 本轮修正登记（诚实记录）

投影层在生成真实数据时暴露并修正了三处自身缺陷（均已重新生成数据后确认）：① 期末未平仓被误记为「退出」；② `usedRunner` 曾用「持仓日 > 5」的启发式，改为 `evaluateRunnerHoldingBridgeState` 的真实判定；③ Runner 判定缺少 `low`/`volume` 导致恒为 false；另将每日 Runner 状态改为「判定日之前一律 PENDING」，杜绝未来信息泄漏。
