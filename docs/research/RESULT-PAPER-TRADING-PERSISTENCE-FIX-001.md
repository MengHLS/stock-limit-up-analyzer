# RESULT-PAPER-TRADING-PERSISTENCE-FIX-001

> 目标：修复 `closed_loop_backtest_run` 扩展载荷读取缺陷，使 `6000001` 的 `paperTradingState` 稳定可读，并正确作为 `paper-3570001-forward` 的历史基线。
> **结论：完成。** 读取路径修复 → 基线恢复 → Forward Run 保持 `WAITING_FOR_NEW_DATA`（零新增记录、账户不变）→ 前端区块可读。
> 未修改 Strategy / Runner / simulator / 历史结果；未伪造行情；未进实盘。

---

## 1. 根因（已定位）

`closed_loop_backtest_run.resultJson` 现在同时承载两类载荷：① 旧版闭环结果；② 后续任务的扩展载荷（`paperTradingState` / `paperTradingForwardState` / `evaluationDetail`）。
旧读取路径（单条 `getClosedLoopBacktestRun` 与批量 `getClosedLoopBacktestRunsByIds`）**都**会走 `reconcileArchivedClosedLoopResult`：
扩展载荷不满足旧闭环 schema ⇒ 被判为 `result: null`（注释自述的「留了但读不出来」），尽管 DB 中 JSON 完整（`CHAR_LENGTH(resultJson)=1,187,600`）。

## 2. 修复文件

| 文件 | 改动 |
| --- | --- |
| `server/closedLoopBacktestRun/rawPayload.ts` | **新增**：`parseRawArchivedPayload()`（纯函数）+ `getClosedLoopBacktestRunRawResult(runId)` —— 按 `runId` 直读 `resultJson` 并**原样**解析，不经任何 reconcile；空 / 非对象 ⇒ `null`（不伪造、不抛错） |
| `server/paperTrading3fTop3Runner/service.ts` | `loadForwardState` / `resetForwardState` / `runNextAvailableDay` 的基线读取改为 raw-by-runId；新增常量 `PAPER_FORWARD_3570001_HISTORICAL_RUN_ID` |
| `server/researchRunRouter.ts` | `getPaperTrading3570001` 与 `getFinalEvaluation` 改为 raw-by-runId 读取（旧路径与摘要列语义**未改动**） |
| `tests/server/closedLoopBacktestRun/rawPayload.test.ts` | **新增** 4 例：扩展载荷原样保留 / 旧版载荷兼容 / 空载荷 ⇒ null / 非对象 ⇒ null |

## 3. raw payload 读取结果

```
6000001 → resultJson 长度 1,187,600
top-level keys: [runId, createdAt, chainFingerprint, fingerprint, overall, runnerInjected,
                 stages, blockedSummary, wiring, assembly, paperTradingState]
paperTradingState.account = { equity: 199036.53223581993, cash: 5381.532235819941, marketValue: 193655, ... }
```

## 4. `6000001` 恢复结果（reseed）

| 项 | 值 |
| --- | ---: |
| equity | **199,036.53** ✓（目标一致） |
| cash | **5,381.53** ✓ |
| marketValue | 193,655.00 |
| 持仓 | **5** 笔 ✓ |
| 累计收益 | +99.0365% |
| lastProcessedTradingDate | **2026-09-04** ✓ |
| daily / history | 407 日 / 306 笔 |

**未再从 100,000 初始化**（修复前的前向状态即为此缺陷，已由 reseed 覆盖）。

## 5. `paper-3570001-forward` 最终状态

```
status                  = WAITING_FOR_NEW_DATA
latestDataDate          = 2026-09-04
lastProcessedTradingDate= 2026-09-04
nextTradingDate         = null
account.equity          = 199036.53223581993   （与 6000001 末日一致）
account.cash            = 5381.532235819941    （一致）
carriedPositions        = 5                    （一致）
forwardDaily / forwardHistory = 0 / 0
newDays = 0 · newSignals = 0 · newFills = 0 · newExits = 0
lastError               = null
```

**是否保持 `WAITING_FOR_NEW_DATA`：是**（数据仍止于 2026-09-04，未制造 09-05 之后的行情，未修改账户余额）。

## 6. 前端四个区块

| 区块 | 数据来源（均来自持久化） | 状态 |
| --- | --- | --- |
| 历史基线（账户 / 权益曲线 / 历史交易 / Runner 标记） | `6000001.paperTradingState`（raw 直读） | ✅ 407 日权益曲线、306 笔历史、5 笔在仓、Runner 标记可用 |
| 账户 | 同上 + `forward.account` | ✅ |
| Forward（latest / last / next / status / 统计 / equity / 当前持仓） | `paper-3570001-forward`（raw 直读） | ✅ 状态与统计可读；**Forward equity 曲线为空是正确结果**（新增交易日 = 0，不用历史数据冒充前向） |
| 对照区 Historical vs Forward | 上述两者 | ✅ 历史列有值；Forward 列在无新数据时为「—」（显式提示） |

页面 `/paper-trading-3570001` 经 `trpc.researchRun.getPaperTrading3570001` 读取；已核验**无硬编码业务数字**（无 199036 / 5381 / 193655 / 0.990365 之类字面量）。

## 7. 回归与测试

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | **exit 0** |
| `npm run build`（vite + esbuild） | **成功** |
| `tests/server/paperTrading3fTop3Runner`（14 例）+ `tests/server/researchRunRouter.test.ts`（20 例）+ `tests/server/closedLoopBacktestRun` + `tests/client` | **386 passed / 35 files** |
| 新增覆盖 | raw result 正确读取（4 例，含空载荷/旧载荷兼容）；此前已覆盖 6000001 恢复、reset 不重置、无新数据零写入、Forward 幂等、页面接口非空 payload |
| 原有 5970001 / 5970002 | 仍可读（`baselineId=5970001`、`promotedId=5970002`、`evaluationDetail` 非空、promoted full return 129.68604118474002） |

## 8. 未做

未修改 `3570001`、`1.62.1`、Runner 参数、simulator 语义；未重跑历史研究；未伪造新行情；未自动进入实盘；未新增第二套 Paper Trading 引擎（仍是同一份 sim/投影实现）。
