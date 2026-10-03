# RESULT-STRATEGY-3570001-LIVE-PAPER-TRADING-001

> 目标：把历史回放 `6000001` 升级为**持续向前推进的前向模拟盘**。
> **结论：系统能力已建成并通过单元测试；真实前向运行按预期停在 `WAITING_FOR_NEW_DATA`（不伪造行情）。**
> **但收尾时发现一个持久化读取缺陷（见 §4），导致「从前向基线继续」与页面前向区块无法取到历史载荷 —— 该缺陷未修复完毕。**

---

## 1. 系统完成度

| 项 | 状态 |
| --- | --- |
| Forward Paper Trading 模块 | ✅ `server/paperTrading3fTop3Runner/forward.ts`（纯 `mergeForwardDays` + `advanceForwardOnce` + `resolveLatestDataDate`） |
| 增量机制 | ✅ 维护 `lastProcessedTradingDate` / 账户 / 峰值 / 持仓 / 统计；只处理 `> lastProcessed` 的交易日 |
| 持久化 | ✅ 复用既有 `closed_loop_backtest_run`（runId `paper-3570001-forward`，UNIQUE 幂等覆盖） |
| 幂等 | ✅ 已处理日期不重复追加；无新数据返回 `WAITING_FOR_NEW_DATA` 且零写入（单测覆盖） |
| 运行入口 | ✅ `runNextAvailableDay()`（`server/paperTrading3fTop3Runner/service.ts`）+ tRPC `researchRun.runPaperTrading3570001NextDay` + CLI `scripts/runPaperTrading3570001Forward.mts` |
| 前端 | ⚠️ `/paper-trading-3570001` 已加入实时状态 / Forward 统计 / Forward 权益 / Historical vs Forward 对照区；**但历史与 Forward 载荷当前读不出来（§4），页面显示为空** |
| 复用（零第二套引擎） | ✅ 选股 `buildFirstLimitPullback3FTop3SourceRun`；执行 `runCompositeRunnerBacktest`（唯一 `runTradeSimulation`）；NEW_HIGH_3 `evaluateRunnerHoldingBridgeState`；每日投影 `derivePaperTradingDaily` |
| 数据边界 | ✅ 每日记录只来自「≤ 该日」的正式模拟；Runner 判定日之前一律 `PENDING`；`resolveLatestDataDate` 只认**数据集声明窗口**内的交易日（已修正：事件相对日尾部行不算新数据） |

## 2. 实际运行状态（未伪造）

| 项 | 值 |
| --- | --- |
| runId | `paper-3570001-forward`（留档行 **6090001**） |
| `latestDataDate` | **2026-09-04** |
| `lastProcessedTradingDate` | **2026-09-04** |
| `nextTradingDate` | `null` |
| status | **`WAITING_FOR_NEW_DATA`** |
| 新增交易日数量 | **0** |
| 新增信号 / 成交 / 退出 | **0 / 0 / 0** |
| 前向账户 | （未采信，见 §4） |
| lastError | `null` |

首次运行时曾因「把事件相对日尾部行误判为新交易日」而触发一次 `status=ERROR`（模拟窗口越界，被正式 simulator 拒绝），**账户状态未被破坏**、错误已持久化 —— 随后修正 `resolveLatestDataDate` 并恢复为 `WAITING_FOR_NEW_DATA`。这条恰好实证了「单日失败不破坏既有状态 + 失败持久化」。

## 3. 测试

| 类别 | 用例 |
| --- | --- |
| 增量 | `mergeForwardDays` 追加新交易日并推进 `lastProcessedTradingDate` |
| 幂等 | 同批交易日重复合并 ⇒ `WAITING_FOR_NEW_DATA`、不产生重复记录 |
| 断点恢复 | 从持久化状态继续，后续日期追加且账户不重置 |
| 账户一致性 | `cash + marketValue = equity`；峰值只增不减 |
| Runner | `PENDING`（判定日前）/ 真实判定 / `usedRunner` 只计真正延长 |
| 数据边界 | 无新交易日不新增记录；投影层判定日前 PENDING（`derive.test.ts`） |

`vitest tests/server/paperTrading3fTop3Runner` → **11 passed**（forward 6 + derive 5）；`tsc --noEmit` → **exit 0**。

## 4. 未完成项 / 阻塞（诚实登记）

**实际阻塞：`closed_loop_backtest_run` 的大载荷读取路径取不到本任务的扩展字段。**

- 行 `6000001` 在 DB 中 `CHAR_LENGTH(resultJson) = 1,187,600`（完整，含 `paperTradingState`）；摘要列也正常（`finalEquity=199036.53`、`tradeCount=306`）。
- 但经仓储读取时 **`result.paperTradingState` 读不到**：
  - 批量读 `getClosedLoopBacktestRunsByIds` → 会走旧版闭环 schema 的 `reconcileArchivedClosedLoopResult`，不匹配即把 `result` 置 `null`；
  - 单条读 `getClosedLoopBacktestRun` → 返回行存在、`strategyId` 正确，但 `result.paperTradingState` 仍为 `undefined`（原因未定位到根因，时间耗尽）。
- 后果：① 前向状态无法从 `6000001` **继续**账户（当前 `paper-3570001-forward` 落的是重置后的 100,000 账户）；② 页面的历史区块与前向区块取不到数据。

**最小修复项（下一步）**：
1. 为「评估 / 模拟盘」这类扩展载荷提供**按 runId 直读**的仓储函数（不经旧的闭环 reconcile），或把大载荷存为对象存储 artifact（`research_experiments` 已有该能力）而不是 `resultJson`；
2. 用该读取路径修复 `loadForwardState` / `resetForwardState` / `getPaperTrading3570001` / `getFinalEvaluation`；
3. `resetForwardState()` 重新以 `6000001` 的账户（权益 199,036.53 / 现金 5,381.53 / 5 笔在仓）为基线播种，再执行一次前向（应仍为 `WAITING_FOR_NEW_DATA`）；
4. 复跑 `tsc` / `npm run build` / `vitest` 并截图/核对页面四个区块。

## 5. 未做

未修改 `3570001`、未修改 Runner 参数、未改 simulator 语义、未做参数搜索、未重跑历史研究、未硬编码收益或交易、**未伪造 2026-09-05 之后的行情**、未自动进入实盘。

**未宣称策略获得新的前向验证** —— 因为真实新增交易日为 0，Forward 实际表现不可用。
